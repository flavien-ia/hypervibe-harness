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
//
// The connection string for a project is normally in its .env (DATABASE_URL). To run SQL
// on an arbitrary Neon project, fetch a connection string first via the Neon REST API
// (GET /projects/{id}/connection_uri?database_name=&role_name=) using NEON.api_key from the vault.
//
// Output (stdout): JSON { rows, rowCount, command }. Exit 0 ok, 1 error.

import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
let conn = null;
let query = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--conn") conn = args[++i];
  else if (query === null) query = args[i];
}
if (!query) {
  console.error('Usage: run-sql.mjs [--conn <url>] "<SQL>"');
  process.exit(1);
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

const res = await fetch(`https://${host}/sql`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Neon-Connection-String": conn,
    "Neon-Raw-Text-Output": "true",
    "Neon-Array-Mode": "false",
  },
  body: JSON.stringify({ query, params: [] }),
});

if (!res.ok) {
  console.error(`SQL HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}
const data = await res.json();
process.stdout.write(JSON.stringify({ rows: data.rows, rowCount: data.rowCount, command: data.command }));
