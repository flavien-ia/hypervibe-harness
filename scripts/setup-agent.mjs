#!/usr/bin/env node
// setup-agent.mjs - Deterministic core for /add-agent.
//
// Scaffolds an Anthropic-powered agent into a Turborepo monorepo as
// `apps/{agent-name}/`, ready to deploy on Render Background Worker.
//
// Pipeline (12 sub-steps, all run in parallel when possible):
//   1. preflight        - args, paths, Next.js detection, monorepo check
//   2. anthropicKey     - read or self-heal ANTHROPIC_API_KEY at User scope
//   3. ensureMonorepo   - convert to Turborepo if not already (delegates to caller)
//   4. scaffoldAgent    - copy templates/agent/* → apps/{name}/ with subst
//   5. patchSystemPrompt- inject the user's system prompt into loop.ts
//   6. patchAgentName   - set TEMPLATE_AGENT_NAME = "<slug>" in loop.ts and memory-kv.ts
//   7. patchTools       - remove tools the user opted out of
//   8. patchMemory      - comment out memory-kv import if user chose stateless
//   9. mergeSchema      - append schema-snippet.ts to main src/server/db/schema.ts
//  10. installDeps      - pnpm install (workspace-wide)
//  11. drizzlePush      - pnpm db:push to create the agent_* tables in Neon
//  12. handoff          - print structured JSON for Claude to consume
//
// Usage:
//   node setup-agent.mjs \
//     --name "newsletter-summarizer" \
//     --description "Summarize my RSS feeds every morning and send me a brief" \
//     --web-dir "apps/web" \
//     --trigger "cron"      # cron | continuous | manual
//     --memory "kv"          # none | kv (pgvector for v1.5)
//     --model "claude-sonnet-4-6"
//
// Output: live logs on stderr, final JSON object on stdout last line.
//
// Exit codes:
//   0 - success
//   1 - preflight failed
//   2 - pipeline failed mid-way (handoff JSON has details)

import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readUserEnv } from "./_read-user-env.mjs";
import { writeUserEnv } from "./_write-user-env.mjs";

import { ensureToolsInPath } from "./_ensure-tools-path.mjs";

// Prepend common CLI install dirs to process.env.PATH so subprocess invocations
// (pnpm, gh, vercel, git, node) find their binaries even if Claude Code
// inherited a stale PATH (typical when tools were just installed via /start).
ensureToolsInPath();

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../templates/agent");

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  name: "",
  description: "",
  webDir: "apps/web",
  trigger: "cron",
  memory: "kv",
  model: "claude-sonnet-4-6",
  systemPrompt: "",
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = args[i + 1];
  switch (a) {
    case "--name": opts.name = next; i++; break;
    case "--description": opts.description = next; i++; break;
    case "--web-dir": opts.webDir = next; i++; break;
    case "--trigger": opts.trigger = next; i++; break;
    case "--memory": opts.memory = next; i++; break;
    case "--model": opts.model = next; i++; break;
    case "--system-prompt": opts.systemPrompt = next; i++; break;
    default: fail(`Unknown arg: ${a}`);
  }
}

const REPO_ROOT = process.cwd();
const AGENT_DIR = join(REPO_ROOT, "apps", opts.name);

// ─── handoff state ────────────────────────────────────────────────────
const STEPS = [
  "preflight", "anthropicKey", "ensureMonorepo", "scaffoldAgent",
  "patchSystemPrompt", "patchAgentName", "patchTools", "patchMemory",
  "mergeSchema", "installDeps", "drizzlePush", "handoff",
];
const completed = [];
const warnings = [];
const state = {
  anthropicKeyJustCreated: false,
  monorepoConverted: false,
  schemaPatched: false,
};
let current = null;

async function step(name, fn) {
  current = name;
  log(name);
  await fn();
  completed.push(name);
  current = null;
}
function log(msg) { process.stderr.write(`\n▸ ${msg}\n`); }
function ok(msg) { process.stderr.write(`  ✅ ${msg}\n`); }
function warn(msg) { process.stderr.write(`  ⚠️  ${msg}\n`); warnings.push(msg); }
function fail(msg) {
  process.stderr.write(`\n❌ ${msg}\n`);
  if (completed.length || current) dumpHandoff(false, msg);
  process.exit(completed.length || current ? 2 : 1);
}
function dumpHandoff(success, errMsg) {
  const remaining = STEPS.filter(s => !completed.includes(s) && s !== current);
  process.stderr.write(`\n────────────────────────────────────────────────────────\n`);
  process.stderr.write(`setup-agent handoff state\n`);
  process.stderr.write(`────────────────────────────────────────────────────────\n`);
  process.stderr.write(`✅ Completed (${completed.length}/${STEPS.length}): ${completed.join(", ") || "none"}\n`);
  if (current) process.stderr.write(`❌ Failed at: ${current}\n`);
  if (remaining.length) process.stderr.write(`⏸  Not attempted: ${remaining.join(", ")}\n`);
  if (warnings.length) {
    process.stderr.write(`\n⚠️  ${warnings.length} warning(s):\n`);
    for (const w of warnings) process.stderr.write(`   - ${w}\n`);
  }
}

process.on("uncaughtException", (e) => {
  process.stderr.write(`\n❌ Uncaught: ${e.message}\n`);
  if (e.stack) process.stderr.write(e.stack + "\n");
  dumpHandoff(false, e.message);
  process.exit(2);
});

function run(cmd, cwd, capture = false) {
  const res = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (res.status !== 0 && !capture) fail(`Command failed: ${cmd}`);
  return res;
}

// ─── Step 1 - preflight ──────────────────────────────────────────────
async function preflight() {
  if (!opts.name || !/^[a-z][a-z0-9-]{1,40}$/.test(opts.name)) {
    fail(`--name must be kebab-case, 2-41 chars (got: "${opts.name}")`);
  }
  if (!["cron", "continuous", "manual"].includes(opts.trigger)) {
    fail(`--trigger must be cron|continuous|manual (got: "${opts.trigger}")`);
  }
  if (!["none", "kv", "pgvector"].includes(opts.memory)) {
    fail(`--memory must be none|kv|pgvector (got: "${opts.memory}")`);
  }
  if (existsSync(AGENT_DIR)) {
    fail(`apps/${opts.name}/ already exists. Pick a different --name or remove it first.`);
  }
  // Check templates dir
  if (!existsSync(TEMPLATE_DIR)) fail(`Templates not found at ${TEMPLATE_DIR}`);
  // Check web app exists (Next.js)
  const webPkg = join(REPO_ROOT, opts.webDir, "package.json");
  if (!existsSync(webPkg)) fail(`No package.json at ${opts.webDir}/. Pass --web-dir if your Next.js app is elsewhere.`);
  ok(`agent will be scaffolded at: apps/${opts.name}/`);
  ok(`web app detected at: ${opts.webDir}/`);
}

// ─── Step 2 - anthropicKey (self-heal) ───────────────────────────────
async function anthropicKey() {
  let key = readUserEnv("ANTHROPIC_API_KEY");
  if (key && key.startsWith("sk-ant-")) {
    state.anthropicKey = key;
    ok("ANTHROPIC_API_KEY found at User scope");
    return;
  }
  // Self-heal: prompt the orchestrator (Claude) to ask the user. The script
  // can't open a browser dialog, so it returns a status; the SKILL.md flow
  // catches this status, asks the user for the key, then re-runs the script.
  fail(`ANTHROPIC_API_KEY missing. The /add-agent SKILL must prompt the user to paste it (from https://console.anthropic.com/settings/keys), persist via _write-user-env.mjs, then re-run this script.`);
}

// ─── Step 3 - ensureMonorepo ─────────────────────────────────────────
async function ensureMonorepo() {
  // Detect: workspace defined in pnpm-workspace.yaml AND apps/web exists?
  const wsFile = join(REPO_ROOT, "pnpm-workspace.yaml");
  const isMonorepo = existsSync(wsFile) && existsSync(join(REPO_ROOT, "apps", "web"));
  if (isMonorepo) {
    ok("Monorepo detected - apps/web/ ready");
    return;
  }
  // Not a monorepo. We can't convert from inside this script (the
  // _convert-to-turborepo SKILL is interactive). Bail with a clear status.
  fail(`Project is not yet a Turborepo monorepo. The /add-agent SKILL must invoke _convert-to-turborepo before re-running this script.`);
}

// ─── Step 4 - scaffoldAgent ──────────────────────────────────────────
async function scaffoldAgent() {
  mkdirSync(AGENT_DIR, { recursive: true });
  copyDirRecursive(TEMPLATE_DIR, AGENT_DIR, [
    // Don't copy the schema-snippet to apps/agent - it goes to the main schema (Step 9).
    "schema-snippet.ts",
    // Pages template: belongs to /add-agent-dashboard, not here.
    "pages",
  ]);

  // Variable substitution on text files
  const vars = {
    AGENT_NAME: opts.name,
    PROJECT_NAME: detectProjectName(),
  };
  walkAndSubstitute(AGENT_DIR, vars);
  ok(`Scaffolded ${countFiles(AGENT_DIR)} files into apps/${opts.name}/`);
}

function copyDirRecursive(src, dst, exclude = []) {
  for (const entry of readdirSync(src)) {
    if (exclude.includes(entry)) continue;
    const sp = join(src, entry);
    const dp = join(dst, entry);
    if (statSync(sp).isDirectory()) {
      mkdirSync(dp, { recursive: true });
      copyDirRecursive(sp, dp, []);
    } else {
      copyFileSync(sp, dp);
    }
  }
}

function walkAndSubstitute(dir, vars) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { walkAndSubstitute(p, vars); continue; }
    if (!/\.(ts|tsx|js|json|yaml|yml|md|env)$/i.test(entry)) continue;
    let content = readFileSync(p, "utf8");
    let changed = false;
    for (const [k, v] of Object.entries(vars)) {
      const re = new RegExp(`\\{\\{${k}\\}\\}`, "g");
      if (re.test(content)) { content = content.replace(re, v); changed = true; }
    }
    if (changed) writeFileSync(p, content, "utf8");
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    n += statSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

function detectProjectName() {
  try {
    const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    return (root.name ?? "project").replace(/^@/, "").replace(/\//g, "-");
  } catch { return "project"; }
}

// ─── Step 5 - patchSystemPrompt ──────────────────────────────────────
async function patchSystemPrompt() {
  if (!opts.systemPrompt) {
    warn("No --system-prompt provided - keeping the placeholder. Edit apps/" + opts.name + "/loop.ts later.");
    return;
  }
  const p = join(AGENT_DIR, "loop.ts");
  let content = readFileSync(p, "utf8");
  // Replace the multi-line template literal
  const escaped = opts.systemPrompt.replace(/`/g, "\\`").replace(/\$/g, "\\$");
  const re = /const TEMPLATE_SYSTEM_PROMPT = `[\s\S]*?`;/;
  if (!re.test(content)) fail("Could not locate TEMPLATE_SYSTEM_PROMPT in loop.ts");
  content = content.replace(re, `const TEMPLATE_SYSTEM_PROMPT = \`${escaped}\`;`);
  writeFileSync(p, content, "utf8");
  ok("System prompt injected into loop.ts");
}

// ─── Step 6 - patchAgentName ─────────────────────────────────────────
async function patchAgentName() {
  for (const file of ["loop.ts", "memory-kv.ts"]) {
    const p = join(AGENT_DIR, file);
    if (!existsSync(p)) continue;
    let content = readFileSync(p, "utf8");
    // Match TEMPLATE_AGENT_NAME = "..." or AGENT_NAME = "..."
    content = content
      .replace(/const TEMPLATE_AGENT_NAME = "[^"]*";/, `const TEMPLATE_AGENT_NAME = "${opts.name}";`)
      .replace(/const AGENT_NAME = "[^"]*";/, `const AGENT_NAME = "${opts.name}";`);
    writeFileSync(p, content, "utf8");
  }
  ok(`Agent slug "${opts.name}" set in loop.ts and memory-kv.ts`);
}

// ─── Step 7 - patchTools (no-op for v1: keep all 3 default tools) ────
async function patchTools() {
  // v1: the user gets http_fetch, send_email, db_query by default. The
  // /add-agent SKILL flow will later inject extra tools (gmail, calendar)
  // when the description warrants it - that's a Claude-driven post-process,
  // not handled here.
  ok("Default tools kept: http_fetch, send_email, db_query");
}

// ─── Step 8 - patchMemory ────────────────────────────────────────────
async function patchMemory() {
  const kvPath = join(AGENT_DIR, "memory-kv.ts");
  const vecPath = join(AGENT_DIR, "memory-pgvector.ts");

  if (opts.memory === "kv") {
    // Keep memory-kv.ts (already scaffolded), clear memory-pgvector.ts
    if (existsSync(vecPath)) {
      writeFileSync(vecPath, "// Vector memory not selected at scaffold time - use memory-kv instead, or re-run /add-agent with --memory pgvector.\nexport {};\n");
    }
    ok("Memory mode: KV (Postgres table agent_memory_kv)");
    return;
  }

  if (opts.memory === "pgvector") {
    // Vector memory uses Cloudflare Workers AI (model bge-large-en-v1.5, 1024
    // dims). We need:
    //   - CLOUDFLARE_API_TOKEN with the "Workers AI:Read" scope (validated below)
    //   - CLOUDFLARE_ACCOUNT_ID (extracted from the token via /accounts API)
    const cfToken = readUserEnv("CLOUDFLARE_API_TOKEN");
    if (!cfToken) {
      fail(`CLOUDFLARE_API_TOKEN missing. Vector memory uses Cloudflare Workers AI for embeddings, which needs this token (already configured by /start for most users - re-run /start if you skipped Cloudflare).`);
    }
    state.cfToken = cfToken;

    // Resolve account ID
    log("Resolving Cloudflare account ID");
    const accRes = spawnSync(
      `curl -sS -H "Authorization: Bearer ${cfToken}" https://api.cloudflare.com/client/v4/accounts`,
      { shell: true, encoding: "utf8" },
    );
    let accountId = null;
    try {
      const parsed = JSON.parse(accRes.stdout || "{}");
      accountId = parsed?.result?.[0]?.id ?? null;
    } catch {}
    if (!accountId) {
      fail(`Could not resolve Cloudflare account ID from the token. Either the token is invalid or it lacks access to /accounts. Re-create at https://dash.cloudflare.com/profile/api-tokens with the scopes from /start checklist + add 'Workers AI:Read'.`);
    }
    state.cfAccountId = accountId;
    ok(`Cloudflare account ID resolved: ${accountId.slice(0, 8)}...`);

    // Smoke test: try a tiny embedding to confirm the token has Workers AI scope
    log("Verifying Workers AI scope on the token");
    const smokeRes = spawnSync(
      `curl -sS -X POST -H "Authorization: Bearer ${cfToken}" -H "Content-Type: application/json" -d '{"text":"test"}' https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-large-en-v1.5`,
      { shell: true, encoding: "utf8" },
    );
    let smokeOk = false;
    try {
      const smokeJson = JSON.parse(smokeRes.stdout || "{}");
      smokeOk = !!smokeJson.success && Array.isArray(smokeJson.result?.data);
    } catch {}
    if (!smokeOk) {
      fail(`Cloudflare Workers AI smoke test failed. Your token probably lacks the 'Workers AI:Read' scope. Regenerate at https://dash.cloudflare.com/profile/api-tokens and ADD that scope. Raw response: ${(smokeRes.stdout || "").slice(0, 300)}`);
    }
    ok("Workers AI scope confirmed on the token");

    // Run raw SQL: enable extension + create table + indexes
    const webPath = join(REPO_ROOT, opts.webDir);
    log("Enabling pgvector extension + creating agent_memory_vector table");
    const ddlScript = `import { neon } from "@neondatabase/serverless";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL not set");
const sql = neon(databaseUrl);
await sql\`CREATE EXTENSION IF NOT EXISTS vector\`;
await sql\`CREATE TABLE IF NOT EXISTS agent_memory_vector (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
)\`;
await sql\`CREATE INDEX IF NOT EXISTS agent_memory_vector_agent_idx ON agent_memory_vector(agent_name)\`;
await sql\`CREATE INDEX IF NOT EXISTS agent_memory_vector_embedding_idx ON agent_memory_vector USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)\`;
console.log("OK pgvector + agent_memory_vector ready");
`;
    const tmpScript = join(webPath, "_pgvector_init.mjs");
    writeFileSync(tmpScript, ddlScript);
    try {
      const r = run(`node _pgvector_init.mjs`, webPath, true);
      if (r.status !== 0) {
        warn(`pgvector init failed (exit ${r.status}). You may need to run the SQL manually. stderr: ${(r.stderr ?? "").slice(0, 300)}`);
      } else {
        ok("pgvector enabled + agent_memory_vector table created");
      }
    } finally {
      try { writeFileSync(tmpScript, ""); } catch {}
      try { spawnSync("rm", ["-f", tmpScript], { shell: true }); } catch {}
    }

    // Disable the kv module so nothing imports it
    if (existsSync(kvPath)) {
      writeFileSync(kvPath, "// Vector memory selected at scaffold time - use memory-pgvector instead.\nexport {};\n");
    }
    ok("Memory mode: vector (Cloudflare Workers AI embeddings + pgvector)");
    return;
  }

  // none → stateless
  if (existsSync(kvPath)) {
    writeFileSync(kvPath, "// Memory disabled at scaffold time - agent runs stateless.\nexport {};\n");
  }
  if (existsSync(vecPath)) {
    writeFileSync(vecPath, "// Memory disabled at scaffold time - agent runs stateless.\nexport {};\n");
  }
  ok("Memory mode: stateless");
}

// ─── Step 9 - mergeSchema ────────────────────────────────────────────
async function mergeSchema() {
  const mainSchema = join(REPO_ROOT, opts.webDir, "src/server/db/schema.ts");
  if (!existsSync(mainSchema)) {
    warn(`No main schema at ${mainSchema} - agent tables NOT added to the main app. The agent worker has its own schema.ts copy and will work, but the Next.js app won't have direct Drizzle access to agent_* tables.`);
    return;
  }
  const snippet = readFileSync(join(TEMPLATE_DIR, "schema-snippet.ts"), "utf8");
  const main = readFileSync(mainSchema, "utf8");
  // Idempotent: skip if already present
  if (main.includes("agent_invocations")) {
    ok("Agent tables already present in main schema - skipping");
    return;
  }
  // Append at end with a clear marker
  const marker = `\n\n// ─── Agent tables (added by /add-agent on ${new Date().toISOString().slice(0, 10)}) ───\n`;
  // Strip the snippet's imports - the main schema usually has its own
  const body = snippet
    .replace(/^[\s\S]*?(?=export const agentInvocations)/, "")  // strip header
    .trim();
  writeFileSync(mainSchema, main.trimEnd() + marker + body + "\n", "utf8");
  state.schemaPatched = true;
  ok("Agent tables appended to main schema");
}

// ─── Step 10 - installDeps ───────────────────────────────────────────
async function installDeps() {
  log("Running pnpm install (workspace) - this can take 30-60 s");
  run("pnpm install", REPO_ROOT);
  ok("Dependencies installed");
}

// ─── Step 11 - drizzlePush ───────────────────────────────────────────
async function drizzlePush() {
  if (!state.schemaPatched) {
    warn("Schema not patched - skipping drizzle push (run pnpm db:push manually if you wired it up).");
    return;
  }
  log("Running pnpm db:push to create agent tables in Neon");
  // From the web app dir (where drizzle.config is)
  const r = run("pnpm db:push", join(REPO_ROOT, opts.webDir), true);
  if (r.status !== 0) {
    warn(`db:push failed (exit ${r.status}). Run manually from ${opts.webDir}.`);
    if (r.stderr) process.stderr.write(r.stderr.slice(0, 500) + "\n");
  } else {
    ok("Agent tables created in Neon");
  }
}

// ─── Step 12 - handoff ───────────────────────────────────────────────
async function handoff() {
  ok("Pipeline complete. Returning structured handoff to Claude.");
}

// ─── MAIN ─────────────────────────────────────────────────────────────
await step("preflight", preflight);
await step("anthropicKey", anthropicKey);
await step("ensureMonorepo", ensureMonorepo);
await step("scaffoldAgent", scaffoldAgent);
await step("patchSystemPrompt", patchSystemPrompt);
await step("patchAgentName", patchAgentName);
await step("patchTools", patchTools);
await step("patchMemory", patchMemory);
await step("mergeSchema", mergeSchema);
await step("installDeps", installDeps);
await step("drizzlePush", drizzlePush);
await step("handoff", handoff);

dumpHandoff(true);

// Final JSON on stdout (Claude parses this for the user-facing summary)
process.stdout.write(JSON.stringify({
  success: true,
  agentName: opts.name,
  agentDir: relative(REPO_ROOT, AGENT_DIR),
  trigger: opts.trigger,
  memory: opts.memory,
  model: opts.model,
  schemaPatched: state.schemaPatched,
  warnings,
  nextSteps: {
    commit: `git add . && git commit -m "feat(agent): scaffold ${opts.name} agent"`,
    push: "git push",
    renderSetup: [
      "Go to https://dashboard.render.com/blueprints",
      "Click 'New Blueprint Instance'",
      "Select your GitHub repo",
      "Render automatically detects apps/" + opts.name + "/render.yaml",
      "Fill in the env vars listed below",
      "Click 'Apply'",
    ],
    envVarsToSet: [
      "ANTHROPIC_API_KEY (already known by /add-agent - will be passed automatically)",
      "DATABASE_URL (from your web .env)",
      "BREVO_API_KEY + BREVO_SENDER_EMAIL + BREVO_SENDER_NAME (or RESEND_API_KEY)",
      "ADMIN_EMAIL (for agent error emails)",
      "AGENT_DAILY_BUDGET_USD (default 5)",
      "AGENT_MONTHLY_BUDGET_USD (default 50)",
      opts.trigger === "cron" ? "AGENT_CRON_SCHEDULE (e.g.: '0 7 * * *' for 7am every morning)" : null,
      opts.trigger === "cron" ? "AGENT_CRON_PROMPT (the prompt sent to the agent at each cron tick)" : null,
      opts.memory === "pgvector" ? "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (for embeddings via Cloudflare Workers AI - already known, will be propagated automatically to Render)" : null,
    ].filter(Boolean),
  },
}) + "\n");
