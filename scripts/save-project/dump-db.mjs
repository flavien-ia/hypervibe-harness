#!/usr/bin/env node
// dump-db.mjs - Dump a Postgres database to JSON files (one per table) + schema.
//
// Usage:
//   node dump-db.mjs --conn-string <postgres-url> --out-dir <dir> [--project-dir <path>]
//
// Writes:
//   <out-dir>/schema.json          - list of tables + columns + types
//   <out-dir>/<schema>.<table>.json - data rows for each user table
//   <out-dir>/_summary.json        - quick summary (table count, total rows)
//
// Driver detection: tries @neondatabase/serverless, pg, then postgres (in that order),
// resolved from the project's node_modules via createRequire.
//
// Exits 0 on success, 1 on error. Final stdout line is a JSON status report.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const CONN = arg("--conn-string");
const OUT = arg("--out-dir");
const PROJECT_DIR = arg("--project-dir") || process.cwd();

if (!CONN || !OUT) {
  console.error("Usage: node dump-db.mjs --conn-string <url> --out-dir <dir> [--project-dir <path>]");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// Try drivers from the project's node_modules
const pkgJson = resolve(PROJECT_DIR, "package.json");
if (!existsSync(pkgJson)) {
  console.log(JSON.stringify({ status: "error", reason: `package.json not found in ${PROJECT_DIR}` }));
  process.exit(1);
}
const projectRequire = createRequire(pkgJson);

async function tryDriver(name) {
  try {
    const pkgPath = projectRequire.resolve(name);
    return await import(pathToFileURL(pkgPath).href);
  } catch {
    return null;
  }
}

async function getQueryFn() {
  // 1) @neondatabase/serverless - Hypervibe default
  const neon = await tryDriver("@neondatabase/serverless");
  if (neon && (neon.neon || neon.default?.neon)) {
    const neonFn = neon.neon || neon.default.neon;
    const sql = neonFn(CONN, { fullResults: false });
    return {
      driver: "@neondatabase/serverless",
      query: async (text) => {
        // Recent @neondatabase/serverless refuses the conventional call
        // `sql(text)` and requires either a tagged template or `sql.query()`.
        // `sql.query(text)` returns the rows array directly.
        if (typeof sql.query === "function") return await sql.query(text);
        return await sql(text); // older driver versions
      },
      end: async () => {},
    };
  }
  // 2) pg
  const pg = await tryDriver("pg");
  if (pg) {
    const PgClient = pg.Client || pg.default?.Client;
    if (PgClient) {
      const client = new PgClient({ connectionString: CONN });
      await client.connect();
      return {
        driver: "pg",
        query: async (text) => (await client.query(text)).rows,
        end: async () => client.end(),
      };
    }
  }
  // 3) postgres (postgres.js)
  const pgjs = await tryDriver("postgres");
  if (pgjs) {
    const postgresFn = pgjs.default || pgjs;
    const sql = postgresFn(CONN);
    return {
      driver: "postgres",
      query: async (text) => await sql.unsafe(text),
      end: async () => sql.end({ timeout: 5 }),
    };
  }
  return null;
}

let qfn;
try {
  qfn = await getQueryFn();
} catch (e) {
  console.log(JSON.stringify({ status: "error", reason: `driver init failed: ${e.message}` }));
  process.exit(1);
}
if (!qfn) {
  console.log(JSON.stringify({ status: "error", reason: "No Postgres driver found in project node_modules (looked for @neondatabase/serverless, pg, postgres)" }));
  process.exit(1);
}

try {
  // List user tables
  const tables = await qfn.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name
  `);

  // Columns metadata
  const columns = await qfn.query(`
    SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default, ordinal_position
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name, ordinal_position
  `);

  const schema = {
    driver: qfn.driver,
    dumpedAt: new Date().toISOString(),
    tables: tables.map((t) => `${t.table_schema}.${t.table_name}`),
    columns,
  };
  writeFileSync(resolve(OUT, "schema.json"), JSON.stringify(schema, null, 2));

  // Dump table data
  const tablesDumped = [];
  let totalRows = 0;
  for (const t of tables) {
    const fullName = `${t.table_schema}.${t.table_name}`;
    const safeName = fullName.replace(/[^\w.-]/g, "_");
    let rows;
    try {
      rows = await qfn.query(`SELECT * FROM "${t.table_schema}"."${t.table_name}"`);
    } catch (e) {
      tablesDumped.push({ name: fullName, error: e.message });
      continue;
    }
    writeFileSync(resolve(OUT, `${safeName}.json`), JSON.stringify(rows, null, 2));
    tablesDumped.push({ name: fullName, rows: rows.length });
    totalRows += rows.length;
  }

  writeFileSync(resolve(OUT, "_summary.json"), JSON.stringify({
    driver: qfn.driver,
    tableCount: tables.length,
    totalRows,
    tables: tablesDumped,
  }, null, 2));

  console.log(JSON.stringify({
    status: "ok",
    driver: qfn.driver,
    tableCount: tables.length,
    totalRows,
  }));
} catch (e) {
  console.log(JSON.stringify({ status: "error", reason: e.message }));
  process.exit(1);
} finally {
  try { await qfn.end(); } catch {}
}
