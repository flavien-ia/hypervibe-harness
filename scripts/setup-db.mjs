#!/usr/bin/env node
// setup-db.mjs - Deterministic core for /add-db (Neon + Drizzle, single-project mode).
//
// Provisions a Neon Postgres project via REST API (NEON_API_KEY env var, no MCP),
// installs the Neon serverless driver in the Next.js app, swaps the Drizzle client
// to use neon-http, pushes the schema, and pushes DATABASE_URL via push-env-vars.mjs.
//
// MONOREPO is NOT supported in this v1 - the script refuses --monorepo with a clear
// message; Claude is expected to handle that case manually (it's rare and involves
// non-trivial code moves into packages/db/).
//
// Usage:
//   node setup-db.mjs --name <project-name> [--web-dir .] [--description "..."] [--monorepo]
//
// Args:
//   --name        Neon project name + (informational) table prefix
//   --web-dir     Directory containing package.json + next dep (default: cwd)
//   --description Optional, currently unused (Neon API doesn't store description on free tier)
//   --monorepo    If passed, the script fails - monorepo handling is Claude-piloted in v1.
//
// stdout layout:
//   - Live logs: ▸ <step>, ✅ <result>, ⚠️ <warning>
//   - Handoff banner at the end (success OR failure)
//   - Last line on success: a single JSON object Claude can parse:
//       {"success": true, "projectId": "...", "host": "...", "projectName": "..."}
//
// Exit codes:
//   0 = success
//   1 = preflight failed (bad args, missing env, in monorepo)
//   2 = a step failed mid-pipeline; partial state on disk; handoff banner explains

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./_render.mjs";
import { readUserEnv } from "./_read-user-env.mjs";
import { getSecret } from "./vault/vault.mjs";

import { ensureToolsInPath } from "./_ensure-tools-path.mjs";

// Prepend common CLI install dirs to process.env.PATH so subprocess invocations
// (pnpm, gh, vercel, git, node) find their binaries even if Claude Code
// inherited a stale PATH (typical when tools were just installed via /start).
ensureToolsInPath();

// Resolve the Neon API key. Source of truth = the Bitwarden vault (item NEON, field api_key).
// Falls back to the legacy NEON_API_KEY env var (process.env then OS User scope) during the
// migration period. The skill (/add-db) ensures the vault is unlocked + the key present before
// calling this script (via the _get-secret pattern), so the non-interactive read here succeeds.
function resolveNeonKey() {
  try {
    return getSecret("NEON", "api_key");
  } catch {
    // locked/expired/not-in-vault → fall back to the legacy env var.
    return readUserEnv("NEON_API_KEY");
  }
}
const NEON_API_KEY = resolveNeonKey();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let name = "";
let webDir = ".";
let description = "";
let monorepoFlag = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--name" && args[i + 1]) name = args[++i];
  else if (a === "--web-dir" && args[i + 1]) webDir = args[++i];
  else if (a === "--description" && args[i + 1]) description = args[++i];
  else if (a === "--monorepo") monorepoFlag = true;
  else fail(`Unknown arg: ${a}`);
}

if (!name) {
  fail('Usage: node setup-db.mjs --name NAME [--web-dir .] [--description "..."] [--monorepo]');
}
if (!/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(name)) {
  fail(`--name must be kebab-case (lowercase a-z, 0-9, -), 2-50 chars. Got: ${name}`);
}

const WEB_DIR = resolve(process.cwd(), webDir);

// ─── helpers ──────────────────────────────────────────────────────────
const STEPS = [
  "preflight",
  "listProjects",
  "createProject",
  "installDriver",
  "swapDriver",
  "pushSchema",
  "pushEnvVars",
];
const completed = [];
const warnings = [];
let current = null;
// State accumulated during the run; emitted as JSON on success.
const state = {
  projectName: name,
  projectId: null,
  host: null,
  connectionUri: null,
};

async function step(stepName, fn) {
  current = stepName;
  await fn();
  completed.push(stepName);
  current = null;
}

function log(msg) {
  console.log(`\n▸ ${msg}`);
}
function ok(msg) {
  console.log(`  ✅ ${msg}`);
}
function warn(msg) {
  console.warn(`  ⚠️  ${msg}`);
  warnings.push(msg);
}

function dumpHandoff(success) {
  const remaining = STEPS.filter((s) => !completed.includes(s) && s !== current);
  console.log("\n────────────────────────────────────────────────────────");
  console.log("setup-db handoff state");
  console.log("────────────────────────────────────────────────────────");
  console.log(`✅ Completed (${completed.length}/${STEPS.length}): ${completed.join(", ") || "none"}`);
  if (current) console.log(`❌ Failed at: ${current}`);
  if (remaining.length) console.log(`⏸  Not attempted: ${remaining.join(", ")}`);
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s) during the run:`);
    for (const w of warnings) console.log(`   - ${w}`);
  }
  if (!success) {
    console.log(
      "\nFor the agent picking this up:\n" +
        `  - Web dir: ${WEB_DIR}\n` +
        `  - Neon project (if created): ${state.projectId || "not created"}\n` +
        "  - Each step in this script maps 1:1 to a section of add-db SKILL.md.\n",
    );
  }
  console.log("────────────────────────────────────────────────────────");
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  if (completed.length || current) dumpHandoff(false);
  process.exit(completed.length || current ? 2 : 1);
}

process.on("uncaughtException", (e) => {
  console.error(`\n❌ Unhandled exception: ${e.message}`);
  if (e.stack) console.error(e.stack);
  dumpHandoff(false);
  process.exit(2);
});

function run(cmd, cwd, opts = {}) {
  const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : cmd;
  const res = spawnSync(cmdStr, {
    cwd,
    stdio: opts.capture ? "pipe" : "inherit",
    shell: true,
    encoding: "utf8",
  });
  if (res.status !== 0 && !opts.allowFail) {
    if (opts.capture) {
      if (res.stdout) process.stderr.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
    }
    fail(`Command failed (exit ${res.status}): ${cmdStr}`);
  }
  return res;
}

function capture(cmd, cwd) {
  return run(cmd, cwd, { capture: true, allowFail: true });
}

async function neonApi(method, path, body) {
  if (!NEON_API_KEY) fail("NEON_API_KEY not found (neither in process.env, nor in User scope) - see the Step 1 preflight error.");
  const res = await fetch(`https://console.neon.tech/api/v2${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NEON_API_KEY}`,
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const detail = data?.message || data?.error || text || `HTTP ${res.status}`;
    fail(`Neon API ${method} ${path} → ${res.status}: ${detail}`);
  }
  return data;
}

// ─── Step 1: preflight ────────────────────────────────────────────────
async function preflight() {
  log("Preflight");

  if (monorepoFlag) {
    fail(
      "MONOREPO_NOT_SUPPORTED_IN_V1: setup-db.mjs only handles single-project setups. " +
        "For monorepos (apps/web + packages/db pattern), Claude must scaffold the shared " +
        "packages/db package manually following the add-db SKILL.md instructions.",
    );
  }

  if (!NEON_API_KEY) {
    fail(
      "NEON_API_KEY not found (neither in the Bitwarden vault item NEON.api_key, nor in an environment variable).\n" +
        "Create a key at https://console.neon.tech/app/settings/api-keys, then store it in the vault:\n" +
        '  node scripts/vault/launch.mjs add --name NEON --service Neon --fields api_key:secret\n' +
        "(if the vault is not set up, run the _add-keyring skill first). Then re-run this script.",
    );
  }

  const pkgPath = join(WEB_DIR, "package.json");
  if (!existsSync(pkgPath)) {
    fail(`No package.json at ${WEB_DIR}. Pass --web-dir <path-to-nextjs-app> if needed.`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.next) fail(`${WEB_DIR} doesn't depend on Next.js - add-db requires a Next.js project.`);
  if (!deps["drizzle-orm"]) {
    fail(
      `${WEB_DIR} doesn't depend on drizzle-orm - this script assumes a T3 scaffold has run first. ` +
        "Run /bootstrap before /add-db, or install Drizzle manually.",
    );
  }

  // pnpm available?
  const pnpm = capture("pnpm --version", WEB_DIR);
  if (pnpm.status !== 0) fail("pnpm CLI is missing or broken.");

  ok(`Web dir OK: ${WEB_DIR}`);
}

// ─── Step 2: list projects ────────────────────────────────────────────
// Surfaces an early warning if the user is approaching the free-tier limit.
// Doesn't block - Neon free tier currently caps at 100 projects, free users typically
// have 0-5, but this guards against the "I have 100 projects" edge case where the
// next step would otherwise fail with a less-clear error.
async function listProjects() {
  log("Listing existing Neon projects");
  const data = await neonApi("GET", "/projects?limit=100");
  const count = (data?.projects || []).length;
  ok(`${count} existing project(s) on the account`);

  if (count >= 95) {
    warn(
      `NEON_QUOTA_NEAR_LIMIT: ${count}/100 projects used on the free tier. ` +
        "Creating a new project may fail. Consider deleting an unused one first.",
    );
  }

  // Detect name conflict - Neon allows duplicate project names but it's bad UX.
  const conflict = (data?.projects || []).find((p) => p.name === name);
  if (conflict) {
    warn(
      `NEON_PROJECT_NAME_CONFLICT: a project named "${name}" already exists (id=${conflict.id}). ` +
        "A new project with the same name will be created (Neon allows duplicates), " +
        "but consider renaming or deleting the existing one for clarity.",
    );
  }
}

// ─── Step 3: create project ───────────────────────────────────────────
async function createProject() {
  log(`Creating Neon project "${name}" in aws-eu-central-1 (Frankfurt)`);
  const data = await neonApi("POST", "/projects", {
    project: {
      name,
      // Pin to Frankfurt - same datacenter region as our Vercel functions
      // (fra1, set in vercel.json by bootstrap). Neon's default region is
      // US East, which adds ~140-160ms RTT per query for EU-resident
      // serverless functions, defeating the point of running in fra1.
      // Other EU regions: aws-eu-west-2 (London), azure-germanywestcentral.
      region_id: "aws-eu-central-1",
    },
  });

  state.projectId = data?.project?.id;
  if (!state.projectId) fail("Neon API returned no project.id - unexpected response shape.");

  // Pick the pooled connection URI when available - better for serverless / edge runtimes.
  const uris = data?.connection_uris || [];
  const pooled = uris.find((u) => u.connection_uri?.includes("-pooler.")) || uris[0];
  state.connectionUri = pooled?.connection_uri;
  if (!state.connectionUri) fail("Neon API returned no connection_uri - unexpected response shape.");

  // Extract host for human-readable summary.
  try {
    const u = new URL(state.connectionUri);
    state.host = u.host;
  } catch {
    state.host = "(parse failed)";
  }

  ok(`Project ${state.projectId} created · host: ${state.host}`);
}

// ─── Step 4: install Neon driver ──────────────────────────────────────
async function installDriver() {
  log("Installing @neondatabase/serverless");
  run("pnpm add @neondatabase/serverless", WEB_DIR);
  // T3 (postgres dbProvider) installs the `postgres` package as the driver. Once we
  // swap to neon-http we don't need it anymore - but uninstalling can break user code
  // that imported postgres elsewhere. Safer to leave it as an unused dep; the user
  // can `pnpm remove postgres` later if they want.
  ok("@neondatabase/serverless installed");
}

// ─── Step 5: swap Drizzle client to neon-http ─────────────────────────
async function swapDriver() {
  log("Swapping Drizzle client to neon-http");
  const dbIndexPath = join(WEB_DIR, "src/server/db/index.ts");
  if (!existsSync(dbIndexPath)) {
    fail(
      `${dbIndexPath} not found - T3 may have moved the db client. ` +
        "Locate the db client manually and swap its driver to:\n" +
        '  import { neon } from "@neondatabase/serverless";\n' +
        '  import { drizzle } from "drizzle-orm/neon-http";\n' +
        "  const sql = neon(env.DATABASE_URL);\n" +
        "  export const db = drizzle(sql, { schema });",
    );
  }

  // Overwrite with the canonical Neon-flavored client (template: templates/db/index.ts).
  // We intentionally don't try to preserve user edits to this file - at /add-db time
  // it's the T3 default.
  writeFileSync(dbIndexPath, render("db/index.ts", {}));
  ok("src/server/db/index.ts rewritten for Neon serverless");
}

// ─── Step 6: push schema ──────────────────────────────────────────────
async function pushSchema() {
  log("Pushing schema with drizzle-kit");
  // Use --force (drizzle-kit 0.30+) to skip the interactive "ALTER vs DROP+CREATE"
  // prompt on a fresh empty DB. If --force is rejected on older versions, retry without.
  const env = { ...process.env, DATABASE_URL: state.connectionUri };
  const probe = spawnSync("npx drizzle-kit push --help", {
    cwd: WEB_DIR,
    stdio: "pipe",
    shell: true,
    encoding: "utf8",
    env,
  });
  const supportsForce = probe.stdout?.includes("--force");
  const cmd = supportsForce ? "npx drizzle-kit push --force" : "npx drizzle-kit push";

  const res = spawnSync(cmd, {
    cwd: WEB_DIR,
    stdio: "inherit",
    shell: true,
    env,
  });
  if (res.status !== 0) {
    fail(
      `drizzle-kit push failed (exit ${res.status}). ` +
        "The Neon project IS provisioned, but the schema didn't push. " +
        "You can retry manually with: `cd " +
        WEB_DIR +
        " && DATABASE_URL='<conn>' npx drizzle-kit push`",
    );
  }
  ok("Schema pushed");
}

// ─── Step 7: push DATABASE_URL via the env helper ─────────────────────
async function pushEnvVars() {
  log("Pushing DATABASE_URL to .env and Vercel");
  const helper = join(__dirname, "push-env-vars.mjs");
  if (!existsSync(helper)) fail(`Sibling script missing: ${helper}`);
  // Quote the connection URI in case it contains shell-special chars (it does - `?`, `&`, etc.).
  // push-env-vars handles the quoting fine when we pass a single argv entry, but our run()
  // helper currently joins with spaces. We use the explicit array form via spawnSync.
  const res = spawnSync(
    "node",
    [helper, `DATABASE_URL=${state.connectionUri}`],
    { cwd: WEB_DIR, stdio: "inherit", shell: false },
  );
  if (res.status !== 0) {
    fail(
      "push-env-vars.mjs failed to push DATABASE_URL. " +
        "The Neon project IS provisioned and the schema IS pushed; only the env var didn't land. " +
        "You can retry manually with: `node " +
        helper +
        " 'DATABASE_URL=" +
        state.connectionUri +
        "'`",
    );
  }
  ok("DATABASE_URL written locally + pushed to Vercel");
}

// ─── MAIN ─────────────────────────────────────────────────────────────
await step("preflight", preflight);
await step("listProjects", listProjects);
await step("createProject", createProject);
await step("installDriver", installDriver);
await step("swapDriver", swapDriver);
await step("pushSchema", pushSchema);
await step("pushEnvVars", pushEnvVars);

dumpHandoff(true);

console.log(`
🎉 setup-db complete.

   Neon project: ${state.projectName} (${state.projectId})
   Host:         ${state.host}
   Schema:       pushed
   Env vars:     DATABASE_URL written to .env + Vercel

Next: Claude takes over for the CLAUDE.md update (via _update-claude-md) and the user-facing summary.
`);

// Last line: structured JSON for Claude to parse.
console.log(
  JSON.stringify({
    success: true,
    projectId: state.projectId,
    host: state.host,
    projectName: state.projectName,
  }),
);
