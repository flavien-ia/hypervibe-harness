// agent/cost-tracker.ts - Cost tracking + circuit breaker for agents.
//
// Two budgets enforced:
//   - DAILY (USD per day)   - protects against runaway loops
//   - MONTHLY (USD per month) - protects against slow drift
//
// Whichever fires first trips the breaker. The agent loop calls
// checkCircuitBreaker() at the start of every invocation and skips the run
// if tripped. trackCost() is called at the end to accumulate.
//
// All amounts in USD (the Anthropic API bills in USD). The dashboard / email
// templates can convert to EUR locally if you want - keep one currency
// internally for simplicity.

import { db } from "./db.js";
import { agentInvocations } from "./schema.js";
import { and, eq, gte, sql } from "drizzle-orm";

// ─── Default budgets (override per agent if needed) ───────────────────
// Set via env vars at deploy time, with sensible defaults baked in.
const DAILY_BUDGET_USD = Number(process.env.AGENT_DAILY_BUDGET_USD ?? "5");
const MONTHLY_BUDGET_USD = Number(process.env.AGENT_MONTHLY_BUDGET_USD ?? "50");

// USD/EUR rough conversion (only for the human-readable email).
// This is a soft signal, not a billing reference.
const USD_TO_EUR = 0.92;

// ─── Types ────────────────────────────────────────────────────────────
export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  usd: number;
}

export interface BreakerStatus {
  tripped: boolean;
  reason?: string;
  spentTodayUsd: number;
  spentThisMonthUsd: number;
  dailyLimit: number;
  monthlyLimit: number;
}

// ─── Public API ───────────────────────────────────────────────────────
/**
 * Should be called at the start of every agent invocation. Returns
 * { tripped: true, reason } if the agent should NOT run.
 */
export async function checkCircuitBreaker(agentName: string): Promise<BreakerStatus> {
  const { spentToday, spentThisMonth } = await getSpend(agentName);

  if (spentToday >= DAILY_BUDGET_USD) {
    return {
      tripped: true,
      reason: `Plafond journalier atteint : ${spentToday.toFixed(2)} USD / ${DAILY_BUDGET_USD} USD (≈ ${(spentToday * USD_TO_EUR).toFixed(2)} EUR / ${(DAILY_BUDGET_USD * USD_TO_EUR).toFixed(2)} EUR)`,
      spentTodayUsd: spentToday,
      spentThisMonthUsd: spentThisMonth,
      dailyLimit: DAILY_BUDGET_USD,
      monthlyLimit: MONTHLY_BUDGET_USD,
    };
  }
  if (spentThisMonth >= MONTHLY_BUDGET_USD) {
    return {
      tripped: true,
      reason: `Plafond mensuel atteint : ${spentThisMonth.toFixed(2)} USD / ${MONTHLY_BUDGET_USD} USD (≈ ${(spentThisMonth * USD_TO_EUR).toFixed(2)} EUR / ${(MONTHLY_BUDGET_USD * USD_TO_EUR).toFixed(2)} EUR)`,
      spentTodayUsd: spentToday,
      spentThisMonthUsd: spentThisMonth,
      dailyLimit: DAILY_BUDGET_USD,
      monthlyLimit: MONTHLY_BUDGET_USD,
    };
  }

  return {
    tripped: false,
    spentTodayUsd: spentToday,
    spentThisMonthUsd: spentThisMonth,
    dailyLimit: DAILY_BUDGET_USD,
    monthlyLimit: MONTHLY_BUDGET_USD,
  };
}

/**
 * Records that this agent just spent `usd` (in USD). The actual recording
 * is done via the agentInvocations row's totalCostUsd column (already
 * persisted by the loop). This function is kept for future expansion (e.g.,
 * pushing to an external metrics service) and as an explicit "after-spend"
 * hook for symmetry with the breaker check.
 */
export async function trackCost(agentName: string, usd: number): Promise<void> {
  // No-op for now: spending is captured in agent_invocations.total_cost_usd
  // when the loop calls finalizeInvocation(). This function exists as the
  // canonical "I spent money, react if needed" hook - useful if you later
  // want to push to PostHog / Datadog / Slack alerts on threshold crossings.
  void agentName;
  void usd;
}

// ─── Spend aggregation (sums recent invocations) ─────────────────────
async function getSpend(agentName: string): Promise<{ spentToday: number; spentThisMonth: number }> {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [todayRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${agentInvocations.totalCostUsd}::numeric), 0)`,
    })
    .from(agentInvocations)
    .where(and(eq(agentInvocations.agentName, agentName), gte(agentInvocations.startedAt, dayStart)));

  const [monthRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${agentInvocations.totalCostUsd}::numeric), 0)`,
    })
    .from(agentInvocations)
    .where(and(eq(agentInvocations.agentName, agentName), gte(agentInvocations.startedAt, monthStart)));

  return {
    spentToday: Number(todayRow?.total ?? 0),
    spentThisMonth: Number(monthRow?.total ?? 0),
  };
}
