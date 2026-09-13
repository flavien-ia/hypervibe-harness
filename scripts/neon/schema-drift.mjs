#!/usr/bin/env node
// schema-drift.mjs - Say, BEFORE a schema push, what the push would destroy.
//
// On this stack the database reached by DATABASE_URL is production, and a
// `drizzle-kit push` makes the live database look like schema.ts. Anything the
// database holds that the schema does not declare is therefore dropped: a
// column added by hand or by another tool, a table a previous skill created.
// With `--force` (which the setup scripts pass, to get past the interactive
// prompt), drizzle-kit accepts those data-loss statements without asking, and
// it also TRUNCATES a populated table when a NOT NULL column without a default
// is added to it. Real case: studio-entremondes, 2026-08-30, an `api_token`
// column present in the database and missing from schema.ts was one push away
// from being dropped.
//
// drizzle-kit 0.x has no dry run (`push --explain` only arrives in v1), so this
// script builds the comparison itself, read-only:
//   - schema side: `drizzle-kit export` prints the CREATE statements of
//     schema.ts without connecting to anything;
//   - database side: one catalogue query over SQL-over-HTTP (same protocol as
//     run-sql.mjs, no driver, no psql);
//   - both restricted to what push itself looks at: `schemaFilter` (default
//     "public") and `tablesFilter` read from drizzle.config.
//
//   node schema-drift.mjs                    # project in the current directory
//   node schema-drift.mjs --dir apps/web     # folder that holds drizzle.config.*
//   node schema-drift.mjs --json             # machine output
//
// Exit codes:
//   0  safe: the push only adds (or there is nothing to push)
//   3  DATA LOSS: the push would drop a table or a column, or truncate a table
//   4  warnings only: a column type would change, or the filter misses tables
//   1  the check could not run (no config, no DATABASE_URL, export failed)
//
// Scope, stated so nobody over-trusts a green light: tables and columns only.
// Indexes, constraints, enum values and views are not compared (push rarely
// loses data through them, and never silently).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── drizzle.config: where it is, and which filters push applies ──────────

const CONFIG_NAMES = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs", "drizzle.config.cjs"];

export function findConfig(dir) {
  for (const n of CONFIG_NAMES) {
    const p = join(dir, n);
    if (existsSync(p)) return p;
  }
  return null;
}

function quotedStrings(src) {
  return [...src.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
}

/**
 * Reads tablesFilter / schemaFilter from the config source. Only literal
 * values can be read; anything computed (`${prefix}_*`) comes back as
 * `unreadable`, and the caller then refuses to call a missing table a loss.
 */
export function readFilters(configSrc) {
  const out = { tables: null, schemas: ["public"], unreadable: [] };
  for (const [key, field] of [["tablesFilter", "tables"], ["schemaFilter", "schemas"]]) {
    const m = new RegExp(`${key}\\s*:\\s*(\\[[^\\]]*\\]|"[^"]*"|'[^']*'|\`[^\`]*\`|[A-Za-z_$][\\w$.]*)`).exec(configSrc);
    if (!m) continue;
    const raw = m[1];
    if (/\$\{/.test(raw) || /^[A-Za-z_$]/.test(raw)) {
      out.unreadable.push(key);
      continue;
    }
    const values = quotedStrings(raw);
    if (values.length) out[field] = values;
  }
  return out;
}

/** drizzle-kit globs: `*` and `?`, a leading `!` excludes. */
export function globToRegex(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`);
}

export function tableMatches(name, patterns) {
  if (!patterns || patterns.length === 0) return true;
  const pos = patterns.filter((p) => !p.startsWith("!"));
  const neg = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  const inPos = pos.length === 0 || pos.some((p) => globToRegex(p).test(name));
  return inPos && !neg.some((p) => globToRegex(p).test(name));
}

// ─── schema side: parse `drizzle-kit export` ──────────────────────────────

const unq = (s) => s.replace(/^"|"$/g, "").replace(/""/g, '"');

function splitQualified(q) {
  const parts = [...q.matchAll(/"((?:[^"]|"")+)"|([^."\s]+)/g)].map((m) => (m[1] ?? m[2]).replace(/""/g, '"'));
  return parts.length === 2 ? { schema: parts[0], table: parts[1] } : { schema: "public", table: parts[0] };
}

/** Returns [{ schema, table, columns: [{ name, type, notNull, hasDefault }] }]. */
export function parseExport(sql) {
  const tables = [];
  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+((?:"(?:[^"]|"")+"|[\w]+)(?:\.(?:"(?:[^"]|"")+"|[\w]+))?)\s*\(([\s\S]*?)\n\);/g;
  for (const m of sql.matchAll(re)) {
    const { schema, table } = splitQualified(m[1]);
    const columns = [];
    for (let line of m[2].split("\n")) {
      line = line.trim().replace(/,$/, "");
      const c = /^"((?:[^"]|"")+)"\s+(.*)$/.exec(line);
      if (!c) continue; // CONSTRAINT, PRIMARY KEY(...), etc.
      const rest = c[2];
      const cut = rest.search(/\s+(PRIMARY KEY|NOT NULL|NULL|DEFAULT|UNIQUE|GENERATED|REFERENCES|CONSTRAINT|CHECK|COLLATE)\b/i);
      const type = (cut === -1 ? rest : rest.slice(0, cut)).trim();
      columns.push({
        name: c[1].replace(/""/g, '"'),
        type,
        notNull: /\bNOT NULL\b|\bPRIMARY KEY\b/i.test(rest),
        hasDefault: /\bDEFAULT\b|\bGENERATED\b/i.test(rest) || /^(small|big)?serial$/i.test(type),
      });
    }
    tables.push({ schema, table, columns });
  }
  return tables;
}

// ─── type comparison ──────────────────────────────────────────────────────

/** Brings a drizzle-kit type and a Postgres format_type() to the same spelling. */
export function normalizeType(t) {
  let s = String(t).trim().toLowerCase();
  let arr = "";
  while (s.endsWith("[]")) { arr += "[]"; s = s.slice(0, -2).trim(); }
  // enum / custom type written "public"."role" by drizzle-kit, public.role or role by Postgres
  s = s.replace(/"/g, "").replace(/^public\./, "");
  const alias = {
    serial: "integer", serial4: "integer", int: "integer", int4: "integer",
    bigserial: "bigint", serial8: "bigint", int8: "bigint",
    smallserial: "smallint", serial2: "smallint", int2: "smallint",
    bool: "boolean", float8: "double precision", float4: "real",
    decimal: "numeric", timestamptz: "timestamp with time zone", timetz: "time with time zone",
  };
  if (alias[s]) s = alias[s];
  s = s.replace(/^varchar\b/, "character varying").replace(/^char\b/, "character");
  s = s.replace(/^decimal\b/, "numeric");
  // timestamp / time without an explicit zone are "without time zone" in Postgres
  s = s.replace(/^(timestamp|time)(\(\d+\))?$/, "$1$2 without time zone");
  s = s.replace(/^(timestamp|time)(\(\d+\))? with time zone$/, "$1$2 with time zone");
  s = s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").replace(/\s*\(\s*/g, "(").replace(/\s*\)/g, ")");
  // the modifier reattaches to "timestamp(3) with time zone" once the spaces are gone
  return s + arr;
}

// ─── database side ────────────────────────────────────────────────────────

export function resolveConn(dir, env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  let d = resolve(dir);
  for (let i = 0; i < 4; i++) {
    for (const f of [".env", ".env.local", "apps/web/.env"]) {
      const p = join(d, f);
      if (!existsSync(p)) continue;
      const m = readFileSync(p, "utf8").match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

async function sqlHttp(conn, query) {
  const host = new URL(conn).hostname;
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
  if (!res.ok) throw new Error(`SQL HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).rows;
}

const qi = (s) => `"${s.replace(/"/g, '""')}"`;
const ql = (s) => `'${s.replace(/'/g, "''")}'`;

async function liveColumns(conn, schemas) {
  return sqlHttp(
    conn,
    `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS "column",
            format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname IN (${schemas.map(ql).join(", ")})
      ORDER BY 1, 2, a.attnum`,
  );
}

// ─── the comparison (pure, unit-tested) ───────────────────────────────────

/**
 * schemaTables: parseExport() output. live: rows { schema, table, column, type }.
 * populated: Set of "schema.table" known to hold rows (only asked for the
 * tables where it matters). filters: readFilters() output.
 */
export function compare(schemaTables, live, filters, populated = new Set()) {
  const key = (s, t) => `${s}.${t}`;
  const tablesFilterKnown = !filters.unreadable.includes("tablesFilter");
  const inScope = (t) => tablesFilterKnown && tableMatches(t, filters.tables);

  const liveMap = new Map();
  for (const r of live) {
    const k = key(r.schema, r.table);
    if (!liveMap.has(k)) liveMap.set(k, new Map());
    liveMap.get(k).set(r.column, r.type);
  }
  const schemaMap = new Map(schemaTables.map((t) => [key(t.schema, t.table), t]));

  const report = {
    droppedTables: [],     // in the database, in push's scope, not in schema.ts
    droppedColumns: [],    // column in the database, not in schema.ts
    truncatedTables: [],   // NOT NULL column without default added to a populated table
    typeChanges: [],       // same column, different type
    outsideFilter: [],     // schema.ts tables that tablesFilter does not cover
    addedTables: [],
    addedColumns: [],
    unreadableFilters: filters.unreadable,
    liveTablesInScope: 0,
  };

  for (const t of schemaTables) {
    if (filters.tables && tablesFilterKnown && !tableMatches(t.table, filters.tables)) {
      report.outsideFilter.push(key(t.schema, t.table));
    }
  }

  for (const [k, cols] of liveMap) {
    const table = k.slice(k.indexOf(".") + 1);
    const declared = schemaMap.get(k);
    if (!declared) {
      if (inScope(table)) report.droppedTables.push(k);
      continue;
    }
    report.liveTablesInScope++;
    const declaredCols = new Map(declared.columns.map((c) => [c.name, c]));
    for (const [col, type] of cols) {
      const d = declaredCols.get(col);
      if (!d) { report.droppedColumns.push(`${k}.${col}`); continue; }
      if (normalizeType(d.type) !== normalizeType(type)) {
        report.typeChanges.push({ column: `${k}.${col}`, database: type, schema: d.type });
      }
    }
    for (const c of declared.columns) {
      if (cols.has(c.name)) continue;
      report.addedColumns.push(`${k}.${c.name}`);
      if (c.notNull && !c.hasDefault && populated.has(k)) {
        report.truncatedTables.push({ table: k, column: c.name });
      }
    }
  }
  for (const t of schemaTables) {
    const k = key(t.schema, t.table);
    if (!liveMap.has(k)) report.addedTables.push(k);
  }

  report.dataLoss =
    report.droppedTables.length + report.droppedColumns.length + report.truncatedTables.length > 0;
  report.warnings =
    report.typeChanges.length + report.outsideFilter.length + report.unreadableFilters.length > 0;
  return report;
}

/** Tables that would get a NOT NULL column without default: do they hold rows? */
function tablesNeedingRowCheck(schemaTables, live) {
  const liveCols = new Set(live.map((r) => `${r.schema}.${r.table}.${r.column}`));
  const liveTables = new Set(live.map((r) => `${r.schema}.${r.table}`));
  const out = [];
  for (const t of schemaTables) {
    const k = `${t.schema}.${t.table}`;
    if (!liveTables.has(k)) continue;
    if (t.columns.some((c) => c.notNull && !c.hasDefault && !liveCols.has(`${k}.${c.name}`))) out.push(t);
  }
  return out;
}

// ─── orchestration ────────────────────────────────────────────────────────

/**
 * Runs the whole check. Never throws: returns { status, exitCode, report?, error? }.
 * status: "safe" | "data-loss" | "warnings" | "error".
 */
export async function driftReport({ dir = process.cwd(), env = process.env } = {}) {
  const cfg = findConfig(dir);
  if (!cfg) return { status: "error", exitCode: 1, error: `No drizzle.config.* in ${dir}` };
  const filters = readFilters(readFileSync(cfg, "utf8"));

  const conn = resolveConn(dir, env);
  if (!conn) return { status: "error", exitCode: 1, error: "No DATABASE_URL (env or .env)" };

  // export never connects; SKIP_ENV_VALIDATION keeps an unrelated missing env
  // var (T3 validates them all when drizzle.config imports ~/env) from failing it.
  const exp = spawnSync("npx drizzle-kit export", {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    env: { ...env, DATABASE_URL: conn, SKIP_ENV_VALIDATION: "1" },
    timeout: 120000,
  });
  if (exp.status !== 0 || !/CREATE TABLE/i.test(exp.stdout || "")) {
    const why = `${exp.stderr || ""}${exp.stdout || ""}`.trim().split("\n").slice(-4).join(" | ");
    return {
      status: "error",
      exitCode: 1,
      error: `drizzle-kit export failed or printed no table (needs drizzle-kit >= 0.26): ${why.slice(0, 300)}`,
    };
  }
  const schemaTables = parseExport(exp.stdout);
  const schemas = [...new Set([...filters.schemas, ...schemaTables.map((t) => t.schema)])];

  let live;
  try {
    live = await liveColumns(conn, schemas);
  } catch (e) {
    return { status: "error", exitCode: 1, error: `Could not read the database catalogue: ${e.message}` };
  }

  const populated = new Set();
  try {
    for (const t of tablesNeedingRowCheck(schemaTables, live)) {
      const rows = await sqlHttp(conn, `SELECT EXISTS (SELECT 1 FROM ${qi(t.schema)}.${qi(t.table)}) AS has_rows`);
      if (rows[0] && (rows[0].has_rows === true || rows[0].has_rows === "t" || rows[0].has_rows === "true")) {
        populated.add(`${t.schema}.${t.table}`);
      }
    }
  } catch (e) {
    return { status: "error", exitCode: 1, error: `Could not count rows: ${e.message}` };
  }

  const report = compare(schemaTables, live, filters, populated);
  if (report.dataLoss) return { status: "data-loss", exitCode: 3, report };
  if (report.warnings) return { status: "warnings", exitCode: 4, report };
  return { status: "safe", exitCode: 0, report };
}

/**
 * The decision the setup scripts need before `drizzle-kit push --force`.
 *   block: true      -> do not push at all, show `text` and stop
 *   allowForce: true -> --force is safe (nothing would be lost)
 *   otherwise        -> the check could not run: push WITHOUT --force, so that
 *                       drizzle-kit asks (and fails in a non-interactive shell)
 *                       instead of accepting a data loss nobody saw.
 */
export async function checkBeforeForcePush({ dir, env = process.env }) {
  const res = await driftReport({ dir, env });
  return {
    status: res.status,
    block: res.status === "data-loss",
    allowForce: res.status === "safe" || res.status === "warnings",
    text: formatReport(res),
  };
}

export function formatReport(res) {
  if (res.status === "error") return `Schema drift check could not run: ${res.error}`;
  const r = res.report;
  const L = [];
  if (r.dataLoss) {
    L.push("DATA LOSS: pushing schema.ts as it is would destroy data in the live database.");
    for (const t of r.droppedTables) L.push(`  - table ${t} exists in the database but not in schema.ts: it would be DROPPED`);
    for (const c of r.droppedColumns) L.push(`  - column ${c} exists in the database but not in schema.ts: it would be DROPPED`);
    for (const t of r.truncatedTables)
      L.push(`  - ${t.table} holds rows and gets a NOT NULL column "${t.column}" without a default: --force would TRUNCATE the table`);
    L.push("  Fix: declare what the database already has in schema.ts (or give the new column a default),");
    L.push("  or have the user confirm explicitly that this data can go. Never push with --force past this.");
  }
  for (const t of r.typeChanges)
    L.push(`Type change: ${t.column} is ${t.database} in the database, ${t.schema} in schema.ts (the push will ALTER it; check the data converts).`);
  if (r.outsideFilter.length)
    L.push(`tablesFilter in drizzle.config does not cover ${r.outsideFilter.join(", ")}: push does not see them in the database and may try to recreate them.`);
  for (const f of r.unreadableFilters)
    L.push(`${f} is computed in drizzle.config and could not be read: tables absent from schema.ts were not reported as losses.`);
  if (!r.dataLoss && !r.warnings) {
    const adds = r.addedTables.length + r.addedColumns.length;
    L.push(adds ? `Safe: the push only adds (${r.addedTables.length} table(s), ${r.addedColumns.length} column(s)).` : "Safe: schema.ts and the database already match.");
  }
  return L.join("\n");
}

// ─── CLI ──────────────────────────────────────────────────────────────────

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  let dir = process.cwd();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") dir = resolve(args[++i]);
    else if (args[i] === "--json") json = true;
  }
  const res = await driftReport({ dir });
  if (json) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  else console.log(formatReport(res));
  process.exit(res.exitCode);
}
