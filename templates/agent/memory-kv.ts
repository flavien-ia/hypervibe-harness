// agent/memory-kv.ts - Simple key/value memory for agents.
//
// Stores arbitrary JSON values per agent + key. Use when an agent needs to
// remember things between invocations:
//   - "last email I replied to" (string)
//   - "users I've already contacted this month" (array)
//   - "current state of the conversation" (object)
//   - "counters" (number)
//
// Persists to Postgres (`agent_memory_kv` table). Per-agent scoped to avoid
// collisions when multiple agents share the same DB.
//
// For semantic memory ("find similar things from past invocations"), use
// memory-pgvector.ts instead - adds embeddings via pgvector. KV is enough
// for ~80 % of agents.
//
// Usage:
//   import { mem } from "./memory-kv.js";
//   await mem.set("last_email_id", "abc123");
//   const last = await mem.get<string>("last_email_id");      // "abc123" | null
//   await mem.delete("last_email_id");
//   const all = await mem.list("user_*");                     // all keys matching prefix

import { db } from "./db.js";
import { agentMemoryKv } from "./schema.js";
import { and, eq, like } from "drizzle-orm";

// ─── Per-agent config ─────────────────────────────────────────────────
// Replace with your agent's slug. Memory is scoped to this name so multiple
// agents don't accidentally share or overwrite each other's state.
const AGENT_NAME = "my-agent";

// ─── Public API ───────────────────────────────────────────────────────
export const mem = {
  /** Read a value. Returns null if the key doesn't exist. */
  async get<T = unknown>(key: string): Promise<T | null> {
    const [row] = await db
      .select({ value: agentMemoryKv.value })
      .from(agentMemoryKv)
      .where(and(eq(agentMemoryKv.agentName, AGENT_NAME), eq(agentMemoryKv.key, key)))
      .limit(1);
    return (row?.value as T) ?? null;
  },

  /** Write (or overwrite) a value. */
  async set(key: string, value: unknown): Promise<void> {
    await db
      .insert(agentMemoryKv)
      .values({ agentName: AGENT_NAME, key, value })
      .onConflictDoUpdate({
        target: [agentMemoryKv.agentName, agentMemoryKv.key],
        set: { value, updatedAt: new Date() },
      });
  },

  /** Delete a key. No-op if it doesn't exist. */
  async delete(key: string): Promise<void> {
    await db
      .delete(agentMemoryKv)
      .where(and(eq(agentMemoryKv.agentName, AGENT_NAME), eq(agentMemoryKv.key, key)));
  },

  /** List all keys (or those matching a SQL LIKE pattern, e.g. "user_%"). */
  async list(pattern?: string): Promise<string[]> {
    const rows = await db
      .select({ key: agentMemoryKv.key })
      .from(agentMemoryKv)
      .where(
        pattern
          ? and(eq(agentMemoryKv.agentName, AGENT_NAME), like(agentMemoryKv.key, pattern))
          : eq(agentMemoryKv.agentName, AGENT_NAME),
      );
    return rows.map((r) => r.key);
  },

  /** Read multiple keys at once. Missing keys are absent from the returned object. */
  async getMany<T = unknown>(keys: string[]): Promise<Record<string, T>> {
    if (keys.length === 0) return {};
    const rows = await db
      .select({ key: agentMemoryKv.key, value: agentMemoryKv.value })
      .from(agentMemoryKv)
      .where(and(eq(agentMemoryKv.agentName, AGENT_NAME)));
    const wanted = new Set(keys);
    const out: Record<string, T> = {};
    for (const r of rows) {
      if (wanted.has(r.key)) out[r.key] = r.value as T;
    }
    return out;
  },

  /** Increment a numeric counter atomically. Initializes to `delta` if absent. */
  async increment(key: string, delta = 1): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + delta;
    await this.set(key, next);
    return next;
  },
};
