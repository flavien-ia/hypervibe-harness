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
//   (prefer the DATABASE_URL environment variable: a --conn argument is visible in the
//   process list and in the shell history, the variable is not)
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
// DESTRUCTIVE STATEMENTS: any DROP, TRUNCATE, DELETE/UPDATE without a real WHERE
// clause, and a DO block running dynamic SQL are refused unless --destructif is
// passed. The database reached by DATABASE_URL can be production itself, and these
// mistakes are not recoverable between two backups. The flag makes the intent
// explicit, which is the whole point: a guard you can pass on purpose, never by
// accident.
//
// The check lives here, and not only in the Bash guardrail, because a hook only
// sees the command line: SQL arriving through a file, a heredoc or a pipe would
// slip past it, and hosts without hooks (Codex) have no guardrail at all. The two
// guards read the same file (../db/sql-guard.mjs), and hooks/test-hooks.mjs replays both.
//
// THE HOST IS CHECKED BEFORE ANYTHING IS SENT: the whole connection string, password
// included, travels in a header of the request. A DATABASE_URL pointing anywhere else
// (another Postgres, a stale .env, a pasted value) is refused, never posted to
// whatever web server answers at that name.
//
// Output (stdout): JSON. Single statement → { rows, rowCount, command } (unchanged).
// Several statements → { statements: [{ command, rowCount, rows }], statementCount, atomic }.
// Exit 0 ok, 1 error.

import { readFileSync, existsSync } from "node:fs";
import { hoteDuFournisseur } from "./neon-host.mjs";
import { splitStatements, statementsDestructrices } from "../db/sql-guard.mjs";

const args = process.argv.slice(2);
let conn = null;
let query = null;
let noTx = false;
let destructifOk = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--conn") {
    conn = args[++i];
    console.error(
      "[run-sql] --conn met l'URL de connexion dans la liste des processus et l'historique du shell : preferer la variable d'environnement DATABASE_URL.",
    );
  }
  else if (args[i] === "--no-tx") noTx = true;
  else if (args[i] === "--destructif" || args[i] === "--destructive") destructifOk = true;
  else if (query === null) query = args[i];
}

// The statements and the destructive-SQL check: ONE definition, in scripts/db/sql-guard.mjs,
// which the Bash guardrail reads too (rule 6). Exported from here as before.
export { splitStatements, statementsDestructrices };

// L'hote d'une chaine de connexion est-il bien celui du fournisseur ? Une seule
// definition, dans neon-host.mjs, que schema-drift.mjs interroge aussi.
export { hoteDuFournisseur };

// Importing this file (e.g. to unit-test splitStatements) must not run the query.
// ─── Launched as a script, or imported ────────────────────────────────────────
// Node gives a module its real path and keeps in argv[1] the path as it was typed. Compared as
// they come, the two differ as soon as the plugin is reached through a symbolic link (macOS's
// temporary folder, a ~/.claude kept by a configuration repository): the script then did
// nothing and exited 0, "I could not" read as "nothing to report" (outside review, 3.3.9).
// Both are read to their real path. The same block in every script, held by
// scripts/tests/test-entry-point.mjs.
import { realpathSync as realPathOf } from "node:fs";
import { fileURLToPath as pathOfUrl } from "node:url";
function launchedDirectly() {
  try {
    if (!process.argv[1]) return false;
    const self = realPathOf(pathOfUrl(import.meta.url));
    const launched = realPathOf(process.argv[1]);
    return process.platform === "win32" ? self.toLowerCase() === launched.toLowerCase() : self === launched;
  } catch {
    return false;
  }
}

const isMain = launchedDirectly();

if (isMain) {
  if (!query) {
    console.error('Usage: run-sql.mjs [--conn <url>] [--no-tx] [--destructif] "<SQL>"');
    process.exit(1);
  }

  const danger = statementsDestructrices(query);
  if (danger.length > 0 && !destructifOk) {
    console.error(
      `Refuse : instruction destructrice (${danger.join(", ")}).\n` +
        "La base atteinte par DATABASE_URL peut etre la production, et rien de cela ne se rattrape entre deux sauvegardes.\n" +
        "Si c'est bien voulu, relancer la meme commande avec le drapeau --destructif (une confirmation sera demandee).\n" +
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
  if (!hoteDuFournisseur(host)) {
    // Le nom d'hote n'est pas un secret, la chaine si : on ne montre que lui.
    console.error(
      `Refuse : l'hote de DATABASE_URL (${host}) n'est pas une base Neon.\n` +
        "run-sql.mjs parle le SQL sur HTTP de Neon : la chaine de connexion entiere, mot de passe compris,\n" +
        "part dans la requete. Elle n'est jamais envoyee a un autre hote. Verifier le DATABASE_URL du projet\n" +
        "(.env), ou passer par le pilote PostgreSQL du projet pour une base hebergee ailleurs.",
    );
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
