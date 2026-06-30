// agent/memory-pgvector.ts - Semantic memory backed by pgvector + Cloudflare Workers AI.
//
// When to use this instead of memory-kv.ts:
//   - The agent needs to "remember" facts/conversations/documents
//     and later find them by *semantic similarity* (not exact key match)
//   - "Find similar past invocations to this one"
//   - "What did the user mention about X in the last 3 months?"
//   - RAG pattern: "search my knowledge base for relevant chunks"
//
// Stack:
//   - pgvector extension in Neon (free, included)
//   - Cloudflare Workers AI embeddings - model @cf/baai/bge-large-en-v1.5
//     (1024 dims). Reuses the project's CLOUDFLARE_API_TOKEN - no new vendor.
//     Free tier: 10 000 Neurons/day on Cloudflare's free plan, which is
//     ~5 000 embeddings/day for bge-large.
//
// Required env vars (set by /add-agent at scaffold time):
//   - CLOUDFLARE_API_TOKEN  - must include scope "Workers AI:Read"
//   - CLOUDFLARE_ACCOUNT_ID - auto-detected at scaffold time, passed to Render
//
// Usage:
//   import { vmem } from "./memory-pgvector.js";
//   await vmem.add("user said: I'm allergic to peanuts", { source: "email_123" });
//   const hits = await vmem.search("does this user have allergies?", 5);
//   // hits = [{ id, content, score, metadata }, ...]

import { db } from "./db.js";
import { sql } from "drizzle-orm";

// ─── Per-agent config ─────────────────────────────────────────────────
// Replace with your agent's slug. Memory is scoped to this name to avoid
// cross-agent contamination of search results.
const AGENT_NAME = "my-agent";

// Embedding model. bge-large-en-v1.5 is 1024 dims (matches our pgvector
// schema). Switch to "@cf/baai/bge-base-en-v1.5" for 768 dims if you want
// to save storage. NOTE: changing this REQUIRES re-creating the
// agent_memory_vector table with a different vector(N) dim - old embeddings
// become incompatible.
const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";
const EMBEDDING_DIMS = 1024;

// ─── Types ────────────────────────────────────────────────────────────
export interface MemoryEntry {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  /** Cosine similarity, 0..1 (higher = more similar). */
  score: number;
}

// ─── Embedding helper (Cloudflare Workers AI) ─────────────────────────
async function embed(text: string): Promise<number[]> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set. They're configured automatically by /add-agent - if missing, your token may not have the 'Workers AI:Read' scope. Regenerate at https://dash.cloudflare.com/profile/api-tokens.",
    );
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 403 || /scope|permission/i.test(t)) {
      throw new Error(
        `Cloudflare Workers AI: 403 (probably missing "Workers AI:Read" scope on the token). Regenerate at https://dash.cloudflare.com/profile/api-tokens with the scope added. Raw: ${t.slice(0, 200)}`,
      );
    }
    throw new Error(`Cloudflare Workers AI error (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    result?: { data?: number[][]; shape?: [number, number] };
    success?: boolean;
    errors?: Array<{ message?: string }>;
  };
  if (!json.success || !json.result?.data) {
    const errMsg = json.errors?.[0]?.message ?? "unknown error";
    throw new Error(`Cloudflare Workers AI returned no embedding: ${errMsg}`);
  }
  const vec = json.result.data[0];
  if (!vec || vec.length !== EMBEDDING_DIMS) {
    throw new Error(
      `Cloudflare Workers AI returned an unexpected embedding (got ${vec?.length ?? 0} dims, expected ${EMBEDDING_DIMS}).`,
    );
  }
  return vec;
}

// ─── Public API ───────────────────────────────────────────────────────
export const vmem = {
  /**
   * Store a piece of content. Computes its embedding via Cloudflare Workers
   * AI and inserts a row in `agent_memory_vector` (raw SQL - table isn't in
   * Drizzle schema because Drizzle doesn't model `vector(1024)` natively).
   * Returns the inserted row id.
   */
  async add(content: string, metadata: Record<string, unknown> = {}): Promise<string> {
    const embedding = await embed(content);
    const vectorLiteral = "[" + embedding.join(",") + "]";
    const result = await db.execute(sql`
      INSERT INTO agent_memory_vector (agent_name, content, metadata, embedding)
      VALUES (${AGENT_NAME}, ${content}, ${JSON.stringify(metadata)}::jsonb, ${vectorLiteral}::vector)
      RETURNING id::text
    `);
    const rows = (result as unknown as { rows: { id: string }[] }).rows ?? [];
    if (!rows[0]?.id) throw new Error("Insert into agent_memory_vector did not return an id");
    return rows[0].id;
  },

  /**
   * Find the K most similar entries to the query, scoped to this agent.
   * Uses cosine distance (1 - cosine_similarity) under the hood, returns
   * the score as similarity (1 = identical, 0 = orthogonal).
   */
  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const queryEmbedding = await embed(query);
    const vectorLiteral = "[" + queryEmbedding.join(",") + "]";

    // pgvector's cosine distance operator: <=>
    const result = await db.execute(sql`
      SELECT
        id::text,
        content,
        metadata,
        1 - (embedding <=> ${vectorLiteral}::vector) AS score
      FROM agent_memory_vector
      WHERE agent_name = ${AGENT_NAME}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `);
    const rows = (result as unknown as { rows: { id: string; content: string; metadata: unknown; score: number }[] }).rows ?? [];
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      score: Number(r.score),
    }));
  },

  /** Delete a specific memory by its id (returned from add()). */
  async delete(id: string): Promise<void> {
    await db.execute(sql`DELETE FROM agent_memory_vector WHERE id = ${id}::uuid AND agent_name = ${AGENT_NAME}`);
  },

  /** Wipe ALL vector memory for this agent. Irreversible. */
  async clear(): Promise<void> {
    await db.execute(sql`DELETE FROM agent_memory_vector WHERE agent_name = ${AGENT_NAME}`);
  },

  /** Count entries (for stats / debugging). */
  async count(): Promise<number> {
    const result = await db.execute(sql`SELECT COUNT(*)::int AS n FROM agent_memory_vector WHERE agent_name = ${AGENT_NAME}`);
    const rows = (result as unknown as { rows: { n: number }[] }).rows ?? [];
    return rows[0]?.n ?? 0;
  },
};
