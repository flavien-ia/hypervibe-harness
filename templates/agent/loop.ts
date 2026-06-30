// agent/loop.ts - Generic Anthropic-powered agent loop.
//
// Drop-in pattern for an agent that:
//   - Uses Anthropic Claude (Sonnet 4.6 by default) with prompt caching
//   - Loops on tool use until end_turn or max_iterations
//   - Tracks cost per turn (input + output + cache hits)
//   - Persists every turn (decisions, tool calls, results) to Postgres
//   - Honors a daily/monthly cost circuit breaker (kills runs over budget)
//   - Sends an email on failure or budget breach
//
// Each agent has its own SYSTEM_PROMPT, TOOLS array, and config (model,
// max_iterations, budget). The loop is reusable as-is.
//
// Replace the TEMPLATE_AGENT_NAME below with your agent's slug (used as the
// `agentName` column key in `agent_invocations` table). Keep it kebab-case.

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  TextBlock,
  ToolUseBlock,
  Tool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { db } from "./db.js";
import {
  agentInvocations,
  agentTurns,
} from "./schema.js";
import { eq } from "drizzle-orm";
import { trackCost, checkCircuitBreaker, type CostBreakdown } from "./cost-tracker.js";
import { sendAgentFailureEmail } from "./mail.js";

// ─── Per-agent config (override per agent) ────────────────────────────
const TEMPLATE_AGENT_NAME = "my-agent";              // slug, replace
const TEMPLATE_MODEL = "claude-sonnet-4-6";          // Sonnet 4.6 default
const TEMPLATE_MAX_ITERATIONS = 10;
const TEMPLATE_MAX_TOKENS_PER_CALL = 4096;

// System prompt - kept in a top-level const so prompt caching kicks in.
const TEMPLATE_SYSTEM_PROMPT = `You are an autonomous agent. Your goal is X.
You have access to tools. Use them to accomplish the goal. When done, respond
with a clear final answer. If you encounter an unrecoverable error, explain it
in plain text and stop.`;

// ─── Tool registry (replace with your real tools) ─────────────────────
// Each tool has: definition (schema sent to Claude) + handler (JS impl).
// See ./tools/*.ts for ready-to-use tools (http-fetch, send-email, db-query).
import { tools as TEMPLATE_TOOLS } from "./tools/index.js";
type ToolName = keyof typeof TEMPLATE_TOOLS;

// ─── Types ─────────────────────────────────────────────────────────────
export interface AgentInput {
  /** Free-form description of what the agent should do this run.
   *  Becomes the first user message. */
  prompt: string;
  /** Optional structured context (will be JSON-stringified into the user
   *  message). Use for things like {emails: [...], rss: [...]}. */
  context?: Record<string, unknown>;
  /** Set to false to skip cost tracking (rare - testing only). */
  trackCosts?: boolean;
  /** Triggered by: "cron" | "manual" | "webhook" | "event". Logged for stats. */
  triggeredBy?: string;
}

export interface AgentResult {
  invocationId: string;
  status: "success" | "max_iterations_reached" | "budget_killed" | "error";
  finalText: string | null;
  iterations: number;
  totalCost: CostBreakdown;
  errorMessage?: string;
}

// ─── Main entry point ─────────────────────────────────────────────────
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The agent cannot run without it.",
    );
  }
  const client = new Anthropic({ apiKey });

  // Step 1 - Circuit breaker check BEFORE any API call.
  const breakerStatus = await checkCircuitBreaker(TEMPLATE_AGENT_NAME);
  if (breakerStatus.tripped) {
    const invocationId = await createInvocation(
      input,
      "budget_killed",
      `Circuit breaker tripped: ${breakerStatus.reason}`,
    );
    await sendAgentFailureEmail({
      agentName: TEMPLATE_AGENT_NAME,
      invocationId,
      reason: `Plafond budgétaire atteint (${breakerStatus.reason}). L'agent a été mis en pause auto.`,
    });
    return {
      invocationId,
      status: "budget_killed",
      finalText: null,
      iterations: 0,
      totalCost: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, usd: 0 },
      errorMessage: breakerStatus.reason,
    };
  }

  // Step 2 - Create invocation row (status="running" → updated at end).
  const invocationId = await createInvocation(input, "running");

  // Step 3 - Build initial messages.
  const initialUserContent = input.context
    ? `${input.prompt}\n\n<context>${JSON.stringify(input.context, null, 2)}</context>`
    : input.prompt;
  const messages: MessageParam[] = [
    { role: "user", content: initialUserContent },
  ];

  // Step 4 - Build tool defs WITH cache_control on the LAST tool (caches
  // the entire tools block - Anthropic's caching is "prefix-based": adding
  // cache_control on the last item caches everything before it too).
  const toolDefs: Tool[] = Object.values(TEMPLATE_TOOLS).map((t) => t.definition);
  if (toolDefs.length > 0) {
    // cache_control is accepted by the API; cast so this type-checks whether or
    // not the installed SDK version already surfaces it on the Tool union
    // (avoids a stale @ts-expect-error breaking the build on newer SDKs).
    (toolDefs[toolDefs.length - 1] as Tool & { cache_control?: unknown }).cache_control = {
      type: "ephemeral",
      ttl: "5m",
    };
  }

  // Step 5 - Loop.
  const totalCost: CostBreakdown = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    usd: 0,
  };

  let iterations = 0;
  let finalText: string | null = null;
  let lastError: string | undefined;

  try {
    while (iterations < TEMPLATE_MAX_ITERATIONS) {
      iterations++;

      const response: Message = await client.messages.create({
        model: TEMPLATE_MODEL,
        max_tokens: TEMPLATE_MAX_TOKENS_PER_CALL,
        system: [
          {
            type: "text",
            text: TEMPLATE_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
        ],
        tools: toolDefs,
        messages,
      });

      // Track usage for this turn
      const turnCost = computeTurnCost(response, TEMPLATE_MODEL);
      totalCost.inputTokens += turnCost.inputTokens;
      totalCost.outputTokens += turnCost.outputTokens;
      totalCost.cacheCreationTokens += turnCost.cacheCreationTokens;
      totalCost.cacheReadTokens += turnCost.cacheReadTokens;
      totalCost.usd += turnCost.usd;

      // Persist this turn (decisions + cost + content)
      await persistTurn(invocationId, iterations, response, turnCost);

      // End conditions
      if (response.stop_reason === "end_turn") {
        finalText = extractText(response);
        await finalizeInvocation(invocationId, "success", finalText, iterations, totalCost);
        if (input.trackCosts !== false) await trackCost(TEMPLATE_AGENT_NAME, totalCost.usd);
        return { invocationId, status: "success", finalText, iterations, totalCost };
      }

      if (response.stop_reason === "tool_use") {
        // Append assistant message + execute tools + append tool_result message
        messages.push({ role: "assistant", content: response.content });
        const toolResults = await executeToolCalls(response);
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Unexpected stop reason (max_tokens, refusal, etc.)
      lastError = `Unexpected stop_reason: ${response.stop_reason}`;
      break;
    }

    // Either max iterations reached or unexpected stop
    if (lastError) {
      await finalizeInvocation(invocationId, "error", null, iterations, totalCost, lastError);
      if (input.trackCosts !== false) await trackCost(TEMPLATE_AGENT_NAME, totalCost.usd);
      await sendAgentFailureEmail({
        agentName: TEMPLATE_AGENT_NAME,
        invocationId,
        reason: lastError,
      });
      return { invocationId, status: "error", finalText: null, iterations, totalCost, errorMessage: lastError };
    }

    await finalizeInvocation(invocationId, "max_iterations_reached", null, iterations, totalCost);
    if (input.trackCosts !== false) await trackCost(TEMPLATE_AGENT_NAME, totalCost.usd);
    return { invocationId, status: "max_iterations_reached", finalText: null, iterations, totalCost };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeInvocation(invocationId, "error", null, iterations, totalCost, message);
    if (input.trackCosts !== false) await trackCost(TEMPLATE_AGENT_NAME, totalCost.usd);
    await sendAgentFailureEmail({
      agentName: TEMPLATE_AGENT_NAME,
      invocationId,
      reason: message,
    });
    return { invocationId, status: "error", finalText: null, iterations, totalCost, errorMessage: message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────
async function executeToolCalls(response: Message): Promise<ToolResultBlockParam[]> {
  const toolUses = response.content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use",
  );
  const results: ToolResultBlockParam[] = [];
  for (const tu of toolUses) {
    const tool = TEMPLATE_TOOLS[tu.name as ToolName];
    if (!tool) {
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: `Error: unknown tool "${tu.name}"`,
        is_error: true,
      });
      continue;
    }
    try {
      const out = await tool.handler(tu.input as Record<string, unknown>);
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: typeof out === "string" ? out : JSON.stringify(out),
      });
    } catch (e) {
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: e instanceof Error ? e.message : String(e),
        is_error: true,
      });
    }
  }
  return results;
}

function extractText(response: Message): string {
  return response.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Pricing (USD per 1M tokens). Update when Anthropic changes pricing.
// cacheWrite = 1.25x input (5-min TTL); cacheRead = 0.1x input. Keys are the
// model aliases passed as the model string.
const PRICING_PER_MTOK: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-opus-4-7": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
};

function computeTurnCost(response: Message, model: string): CostBreakdown {
  const u = response.usage;
  const p = PRICING_PER_MTOK[model] ?? PRICING_PER_MTOK["claude-sonnet-4-6"]!;
  const inputTokens = u.input_tokens || 0;
  const outputTokens = u.output_tokens || 0;
  const cacheCreationTokens = u.cache_creation_input_tokens || 0;
  const cacheReadTokens = u.cache_read_input_tokens || 0;
  const usd =
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheCreationTokens * p.cacheWrite +
      cacheReadTokens * p.cacheRead) /
    1_000_000;
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, usd };
}

// ─── DB persistence ───────────────────────────────────────────────────
async function createInvocation(
  input: AgentInput,
  status: string,
  errorMessage?: string,
): Promise<string> {
  const [row] = await db
    .insert(agentInvocations)
    .values({
      agentName: TEMPLATE_AGENT_NAME,
      status,
      promptPreview: input.prompt.slice(0, 500),
      triggeredBy: input.triggeredBy ?? "manual",
      errorMessage: errorMessage ?? null,
    })
    .returning({ id: agentInvocations.id });
  return row!.id;
}

async function persistTurn(
  invocationId: string,
  turnNumber: number,
  response: Message,
  cost: CostBreakdown,
) {
  await db.insert(agentTurns).values({
    invocationId,
    turnNumber,
    stopReason: response.stop_reason ?? "unknown",
    content: response.content,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    cacheCreationTokens: cost.cacheCreationTokens,
    cacheReadTokens: cost.cacheReadTokens,
    costUsd: cost.usd.toFixed(6),
  });
}

async function finalizeInvocation(
  invocationId: string,
  status: string,
  finalText: string | null,
  iterations: number,
  totalCost: CostBreakdown,
  errorMessage?: string,
) {
  await db
    .update(agentInvocations)
    .set({
      status,
      finalText,
      iterations,
      totalCostUsd: totalCost.usd.toFixed(6),
      finishedAt: new Date(),
      errorMessage: errorMessage ?? null,
    })
    .where(eq(agentInvocations.id, invocationId));
}
