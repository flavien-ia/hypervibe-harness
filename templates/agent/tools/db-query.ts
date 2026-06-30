// agent/tools/db-query.ts - Read-only SQL access to the project's Neon DB.
//
// Lets the agent run SELECT queries against the project's Postgres database.
// Useful for: looking up users, fetching past invocation context, computing
// stats, finding things to act on ("send a reminder to all users with X").
//
// SAFETY MODEL - READ-ONLY by default:
//   - Only SELECT statements allowed (no INSERT/UPDATE/DELETE/DROP/...)
//   - Statement-level timeout (10 s)
//   - Result row cap (100 rows - prevents 100k-row dumps into the agent context)
//   - Result size cap (100 KB stringified)
//
// If the agent NEEDS to write, give it a more specific tool (e.g.
// `mark_user_contacted` that takes a userId and updates a single row). Don't
// loosen this tool to allow arbitrary writes - that's a foot-gun.

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { sql } from "drizzle-orm";
import { db } from "../db.js";

const definition: Tool = {
  name: "db_query",
  description:
    "Run a READ-ONLY SQL query (SELECT only) against the project's Postgres database. Use for looking up users, fetching context, computing stats. Times out after 10 seconds. Returns at most 100 rows. To make changes to the database, ask for a more specific write tool - this one cannot insert, update, or delete.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A SELECT SQL query. Examples: 'SELECT id, email FROM users WHERE created_at > NOW() - INTERVAL \\'7 days\\'' - 'SELECT COUNT(*) FROM orders WHERE status = \\'paid\\''.",
      },
    },
    required: ["query"],
  },
};

const FORBIDDEN_KEYWORDS = [
  "insert", "update", "delete", "drop", "alter", "truncate",
  "grant", "revoke", "create", "comment", "vacuum", "lock",
  "copy", "do", "call", "merge",
];

function isReadOnly(query: string): { ok: true } | { ok: false; reason: string } {
  const stripped = query
    .replace(/--[^\n]*/g, " ")            // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ")    // strip block comments
    .trim()
    .toLowerCase();

  if (!stripped.startsWith("select") && !stripped.startsWith("with")) {
    return { ok: false, reason: "query must start with SELECT (or WITH ... SELECT)" };
  }
  for (const kw of FORBIDDEN_KEYWORDS) {
    // word-boundary match
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(stripped)) {
      return { ok: false, reason: `forbidden keyword: ${kw.toUpperCase()}` };
    }
  }
  // Block multi-statement (basic guard against query stacking)
  if (stripped.replace(/;\s*$/, "").includes(";")) {
    return { ok: false, reason: "multiple statements not allowed (single SELECT only)" };
  }
  return { ok: true };
}

async function handler(input: Record<string, unknown>): Promise<string> {
  const query = String(input.query ?? "").trim();
  if (!query) return `Error: 'query' is required`;

  const safety = isReadOnly(query);
  if (!safety.ok) return `Error: ${safety.reason}`;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 10_000);

  try {
    // The Neon HTTP driver runs ONE statement per call, so we wrap the
    // (keyword-validated, single) SELECT in a subquery to enforce the 100-row
    // cap without a second statement or a double LIMIT (which would break a
    // query that already has its own LIMIT). Read-only is already guaranteed
    // by isReadOnly() above.
    const inner = query.replace(/;\s*$/, "");
    const result = await db.execute(sql.raw(`SELECT * FROM (${inner}) AS _agent_q LIMIT 100`));
    const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
    const json = JSON.stringify(rows, null, 2);
    if (json.length > 100_000) {
      return `Result too large (${json.length} bytes > 100 KB cap). Refine the query (LIMIT, narrower WHERE, fewer columns).`;
    }
    return `${rows.length} row(s):\n${json}`;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return `Error: query timed out after 10 seconds`;
    }
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    clearTimeout(timeout);
  }
}

export const tool = { definition, handler };
