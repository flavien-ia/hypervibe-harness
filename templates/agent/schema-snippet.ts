// agent/schema-snippet.ts - Drizzle table definitions for agent persistence.
//
// Append this snippet to your project's `src/server/db/schema.ts` (or import
// it from there). The setup-agent.mjs script does this automatically when
// scaffolding the agent.
//
// Tables:
//   - agent_invocations    : one row per agent run (status, cost, final answer)
//   - agent_turns          : one row per loop iteration (decisions, tools, cost)
//   - agent_memory_kv      : per-agent key/value store (used by memory-kv.ts)
//   - agent_memory_vector  : per-agent semantic memory (pgvector - only added
//                            if the agent uses memory-pgvector.ts)
//   - agent_trigger_queue  : pending manual triggers from dashboard / external
//
// pgvector NOTE: if any agent uses semantic memory, the setup script also
// runs `CREATE EXTENSION IF NOT EXISTS vector;` against the Neon DB. The
// extension is included by default on Neon - no provisioning needed.
//
// Naming follows the project's `createTable` prefix convention. The `{prefix}_`
// prefix is added automatically by Drizzle's pgTableCreator.
//
// IMPORTANT: after appending, run `pnpm db:push` to apply to Neon.

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  jsonb,
  numeric,
  primaryKey,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

// Reuse the project's createTable if it exists. Replace `pgTable` with your
// project's `createTable` to inherit the table-name prefix.

// ─── invocations ──────────────────────────────────────────────────────
export const agentInvocations = pgTable(
  "agent_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentName: text("agent_name").notNull(),
    status: text("status").notNull(), // running | success | error | budget_killed | max_iterations_reached
    triggeredBy: text("triggered_by").notNull().default("manual"), // manual | cron | webhook | event
    promptPreview: text("prompt_preview"), // first 500 chars of the user prompt
    finalText: text("final_text"),         // the agent's last text response (if success)
    iterations: integer("iterations").notNull().default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_invocations_started_idx").on(t.startedAt),
    index("agent_invocations_agent_idx").on(t.agentName, t.startedAt),
  ],
);

// ─── turns ────────────────────────────────────────────────────────────
export const agentTurns = pgTable(
  "agent_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invocationId: uuid("invocation_id")
      .notNull()
      .references(() => agentInvocations.id, { onDelete: "cascade" }),
    turnNumber: integer("turn_number").notNull(),
    stopReason: text("stop_reason").notNull(), // end_turn | tool_use | max_tokens | refusal
    content: jsonb("content").notNull(),       // raw Anthropic content blocks (text + tool_use)
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("agent_turns_invocation_idx").on(t.invocationId, t.turnNumber)],
);

// ─── KV memory ────────────────────────────────────────────────────────
export const agentMemoryKv = pgTable(
  "agent_memory_kv",
  {
    agentName: text("agent_name").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [primaryKey({ columns: [t.agentName, t.key] })],
);

// ─── Vector memory (semantic search) - INTENTIONALLY NOT IN DRIZZLE ──
// The agent_memory_vector table is created by setup-agent.mjs via raw SQL
// when --memory=pgvector is chosen. It is NOT declared here because Drizzle's
// pgTable can't model `vector(1024)` natively - and partial declarations
// trigger db:push to drop the embedding column it doesn't know about.
//
// All reads/writes to agent_memory_vector go through templates/agent/memory-
// pgvector.ts which uses raw SQL via db.execute(). The dashboard does NOT
// query this table - vector entries are an internal concern of each agent.
//
// Raw SQL run by setup-agent.mjs:
//   CREATE EXTENSION IF NOT EXISTS vector;
//   CREATE TABLE agent_memory_vector (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     agent_name text NOT NULL,
//     content text NOT NULL,
//     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
//     embedding vector(1024) NOT NULL,
//     created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
//   );
//   CREATE INDEX agent_memory_vector_agent_idx ON agent_memory_vector(agent_name);
//   CREATE INDEX agent_memory_vector_embedding_idx ON agent_memory_vector
//     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

// ─── Trigger queue (dashboard "Run now" + external triggers) ─────────
export const agentTriggerQueue = pgTable(
  "agent_trigger_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentName: text("agent_name").notNull(),
    status: text("status").notNull().default("pending"), // pending | running | done | failed
    source: text("source").notNull().default("manual"),  // manual | webhook | api | …
    prompt: text("prompt").notNull(),
    context: jsonb("context"),
    invocationId: uuid("invocation_id"), // populated when picked up + run
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_trigger_queue_pending_idx").on(t.status, t.createdAt),
  ],
);
