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
// guards must agree: hooks/test-hooks.mjs replays the same statements through both.
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
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hoteDuFournisseur } from "./neon-host.mjs";

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
// Tout DROP, quel que soit l'objet. Une liste d'objets (TABLE, SCHEMA, INDEX...) en
// oublie toujours un : DROP FUNCTION, DROP POLICY, DROP MATERIALIZED VIEW passaient.
// Le garde-fou (hooks/rules.mjs) porte la MEME expression : ne pas changer l'une sans l'autre.
const DROP_ANYTHING = /\bDROP\s+[A-Za-z_]/i;
// Un WHERE qui ne borne rien (WHERE true, WHERE 1=1) vaut une absence de WHERE.
const WHERE_TOUJOURS_VRAI = /\bWHERE\s+(?:TRUE|1\s*=\s*1|''\s*=\s*'')\s*(?:RETURNING\b[\s\S]*)?$/i;

function sansCommentaires(stmt) {
  return stmt.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function motifDestructeur(texte) {
  if (DROP_ANYTHING.test(texte)) return /\bALTER\b/i.test(texte) && !/^\s*DROP\b/i.test(texte) ? "ALTER ... DROP" : "DROP";
  if (/\bTRUNCATE\b/i.test(texte)) return "TRUNCATE";
  const borne = /\bWHERE\b/i.test(texte) && !WHERE_TOUJOURS_VRAI.test(texte.trim());
  if (/\bDELETE\s+FROM\b/i.test(texte) && !borne) return "DELETE sans WHERE";
  if (/\bUPDATE\b[\s\S]*\bSET\b/i.test(texte) && !borne) return "UPDATE sans WHERE";
  return null;
}

export function statementsDestructrices(sql) {
  const trouve = [];
  for (const stmt of splitStatements(sql)) {
    // Neutralise chaines et commentaires avant de chercher les mots-cles.
    const nu = sansCommentaires(
      stmt.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"])*"/g, '""'),
    );
    const motif = motifDestructeur(nu);
    if (motif) {
      trouve.push(motif);
      continue;
    }
    // Un bloc DO s'execute tout de suite, et son SQL dynamique vit dans des chaines :
    // `DO $$ BEGIN EXECUTE 'DROP TABLE clients'; END $$` etait invisible une fois les
    // chaines neutralisees. On relit donc le bloc AVEC ses chaines. Et quand le SQL est
    // fabrique a l'execution (concatenation, format), le controle ne peut pas le voir :
    // il refuse, il ne laisse pas passer.
    if (/^\s*DO\b/i.test(nu)) {
      const brut = sansCommentaires(stmt);
      const dansLeBloc = motifDestructeur(brut);
      if (dansLeBloc) trouve.push(`${dansLeBloc} (dans un bloc DO)`);
      else if (/\bEXECUTE\b/i.test(nu)) trouve.push("SQL dynamique (EXECUTE dans un bloc DO)");
    }
  }
  return [...new Set(trouve)];
}

// L'hote d'une chaine de connexion est-il bien celui du fournisseur ? Une seule
// definition, dans neon-host.mjs, que schema-drift.mjs interroge aussi.
export { hoteDuFournisseur };

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
