#!/usr/bin/env node
// run-sql.mjs - Execute SQL against a Neon database over HTTP. Cross-OS, dependency-free
// (plain fetch - no psql, no driver install).
//
// Neon serves SQL over HTTP at https://<host>/sql (the protocol used by
// @neondatabase/serverless). Validated empirically 2026-05-29: POST with the connection
// string in the Neon-Connection-String header → {fields, rows, rowCount, command}.
//
//   node run-sql.mjs "SELECT count(*) FROM users"          # conn from ./.env DATABASE_URL
//   node run-sql.mjs --conn "postgres://..." "SELECT 1"    # explicit connection string
//   node run-sql.mjs "ALTER TABLE t ADD COLUMN a int; ALTER TABLE t ADD COLUMN b int"
//
// MULTI-STATEMENT: a single POST is one prepared statement, so Postgres rejects
// several commands in one query ("cannot insert multiple commands into a prepared
// statement"). We therefore split the input on top-level semicolons and send the
// statements as ONE Neon batch, which is ATOMIC (verified 2026-07-25: a batch whose
// last statement fails rolls back the earlier CREATE TABLE). A half-applied schema
// migration is thus impossible by default.
//   --no-tx  run the statements one by one instead, for commands that cannot run
//            inside a transaction block (CREATE INDEX CONCURRENTLY, VACUUM, ...).
//
// DESTRUCTIVE STATEMENTS: DROP, TRUNCATE, and DELETE/UPDATE without a WHERE
// clause are refused unless --destructif is passed. On this stack the database
// reached by DATABASE_URL is very often production itself, and these mistakes
// are not recoverable between two backups. The flag makes the intent explicit,
// which is the whole point: a guard you can pass on purpose, never by accident.
//
// The check lives here, and not only in the Bash guardrail, because a hook only
// sees the command line: SQL arriving through a file, a heredoc or a pipe would
// slip past it, and hosts without hooks (Codex) have no guardrail at all.
//
// Output (stdout): JSON. Single statement → { rows, rowCount, command } (unchanged).
// Several statements → { statements: [{ command, rowCount, rows }], statementCount, atomic }.
// Exit 0 ok, 1 error.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let conn = null;
let query = null;
let noTx = false;
let destructifOk = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--conn") conn = args[++i];
  else if (args[i] === "--no-tx") noTx = true;
  else if (args[i] === "--destructif" || args[i] === "--destructive") destructifOk = true;
  else if (query === null) query = args[i];
}

// ─── Split on top-level semicolons ─────────────────────────────────────
// Skips: '...' strings (with '' doubling), E'...' backslash escapes, "..."
// identifiers, $$ / $tag$ dollar-quoted bodies (function definitions), -- line
// comments and /* nestable */ block comments.
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? n : nl + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    // Block comment (nestable in Postgres)
    if (c === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Single-quoted string; E'' enables backslash escapes
    if (c === "'") {
      const escaped = /[eE]$/.test(buf);
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; } // '' literal quote
          j++;
          break;
        }
        j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Double-quoted identifier
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Dollar-quoted string: $$ ... $$ or $tag$ ... $tag$
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        buf += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    // Statement separator
    if (c === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Les instructions qu'on refuse d'executer sans intention explicite.
 *
 * L'analyse se fait par instruction (via splitStatements, qui connait deja les
 * chaines, les commentaires et les corps dollar-quotes) : un `DELETE FROM t
 * WHERE ...` legitime au milieu d'un lot ne doit pas etre confondu avec le
 * `DELETE FROM t` nu qui le suit. Les mots-cles sont cherches hors chaines,
 * pour qu'un `INSERT INTO log VALUES ('DROP TABLE')` passe sans encombre.
 */
export function statementsDestructrices(sql) {
  const trouve = [];
  for (const stmt of splitStatements(sql)) {
    // Neutralise chaines et commentaires avant de chercher les mots-cles.
    const nu = stmt
      .replace(/'(?:[^']|'')*'/g, "''")
      .replace(/"(?:[^"])*"/g, '""')
      .replace(/--[^\n]*/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    if (/\bDROP\s+(TABLE|SCHEMA|DATABASE|INDEX|VIEW|TYPE|COLUMN)\b/i.test(nu)) {
      trouve.push("DROP");
      continue;
    }
    if (/\bTRUNCATE\b/i.test(nu)) {
      trouve.push("TRUNCATE");
      continue;
    }
    if (/\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i.test(nu)) {
      trouve.push("ALTER ... DROP");
      continue;
    }
    if (/\bDELETE\s+FROM\b/i.test(nu) && !/\bWHERE\b/i.test(nu)) {
      trouve.push("DELETE sans WHERE");
      continue;
    }
    if (/\bUPDATE\b[\s\S]*\bSET\b/i.test(nu) && !/\bWHERE\b/i.test(nu)) {
      trouve.push("UPDATE sans WHERE");
      continue;
    }
  }
  return [...new Set(trouve)];
}

// Importing this file (e.g. to unit-test splitStatements) must not run the query.
const isMain =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (!query) {
    console.error('Usage: run-sql.mjs [--conn <url>] [--no-tx] [--destructif] "<SQL>"');
    process.exit(1);
  }

  const danger = statementsDestructrices(query);
  if (danger.length > 0 && !destructifOk) {
    console.error(
      `Refuse : instruction destructrice (${danger.join(", ")}).\n` +
        "Sur cette stack, la base atteinte par DATABASE_URL est souvent la production.\n" +
        "Si c'est bien voulu, relancer la meme commande avec le drapeau --destructif.\n" +
        "Pour un DELETE ou un UPDATE, ajouter une clause WHERE suffit le plus souvent.",
    );
    process.exit(6);
  }
  // Resolve the connection string: --conn > env DATABASE_URL > ./.env / apps/web/.env.
  if (!conn) conn = process.env.DATABASE_URL || null;
  if (!conn) {
    for (const f of [".env", "apps/web/.env", ".env.local"]) {
      if (existsSync(f)) {
        const m = readFileSync(f, "utf8").match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
        if (m) { conn = m[1].trim().replace(/^["']|["']$/g, ""); break; }
      }
    }
  }
  if (!conn) {
    console.error("No connection string. Pass --conn <url>, set DATABASE_URL, or run from a project with DATABASE_URL in .env.");
    process.exit(1);
  }

  let host;
  try {
    host = new URL(conn).hostname;
  } catch {
    console.error("Invalid connection string.");
    process.exit(1);
  }

  const headers = {
    "Content-Type": "application/json",
    "Neon-Connection-String": conn,
    "Neon-Raw-Text-Output": "true",
    "Neon-Array-Mode": "false",
  };
  const endpoint = `https://${host}/sql`;

  async function post(body, extra = {}) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
    return res;
  }

  function fail(res, text, label) {
    console.error(`SQL HTTP ${res.status}${label ? ` (${label})` : ""}: ${text.slice(0, 400)}`);
    process.exit(1);
  }

  const statements = splitStatements(query);

  if (statements.length <= 1) {
    // Unchanged single-statement path: same request and same output shape as before.
    const res = await post({ query: statements[0] ?? query, params: [] });
    if (!res.ok) fail(res, await res.text());
    const data = await res.json();
    process.stdout.write(JSON.stringify({ rows: data.rows, rowCount: data.rowCount, command: data.command }));
  } else if (!noTx) {
    // Atomic batch: all statements commit together or none do.
    const res = await post(
      { queries: statements.map((q) => ({ query: q, params: [] })) },
      { "Neon-Batch-Isolation-Level": "ReadCommitted" },
    );
    if (!res.ok) {
      const text = await res.text();
      console.error(
        `SQL HTTP ${res.status} in a ${statements.length}-statement atomic batch (nothing was applied): ${text.slice(0, 400)}`,
      );
      process.exit(1);
    }
    const data = await res.json();
    const results = (data.results || []).map((r, i) => ({
      statement: statements[i].slice(0, 120),
      command: r.command,
      rowCount: r.rowCount,
      rows: r.rows,
    }));
    process.stdout.write(JSON.stringify({ statements: results, statementCount: results.length, atomic: true }));
  } else {
    // Sequential: for statements that cannot run inside a transaction block.
    const results = [];
    for (let i = 0; i < statements.length; i++) {
      const res = await post({ query: statements[i], params: [] });
      if (!res.ok) {
        const text = await res.text();
        console.error(
          `SQL HTTP ${res.status} on statement ${i + 1}/${statements.length} (${statements[i].slice(0, 80)}): ${text.slice(0, 300)}`,
        );
        console.error(`Statements 1..${i} were already applied and are NOT rolled back (--no-tx).`);
        process.exit(1);
      }
      const data = await res.json();
      results.push({
        statement: statements[i].slice(0, 120),
        command: data.command,
        rowCount: data.rowCount,
        rows: data.rows,
      });
    }
    process.stdout.write(JSON.stringify({ statements: results, statementCount: results.length, atomic: false }));
  }
}
