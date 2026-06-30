#!/usr/bin/env node
// setup-agent-dashboard.mjs - Deterministic core for /add-agent-dashboard.
//
// Adds dashboard pages + tRPC router for monitoring agents from the Next.js
// admin area. Idempotent - safe to re-run.
//
// Pipeline (5 steps):
//   1. preflight        - args, paths, admin auth detection, agent tables exist
//   2. copyPages        - copy templates/agent-dashboard/pages/* into the
//                         project's app/admin/agents/ tree
//   3. copyRouter       - copy router.ts into src/server/api/routers/
//   4. registerRouter   - patch root.ts to register `agentDashboard: agentDashboardRouter`
//   5. handoff          - print structured JSON
//
// Idempotency: every step checks-then-acts. If a file already exists with
// the dashboard's marker comment, skip. If root.ts already includes the
// router, skip.
//
// Usage:
//   node setup-agent-dashboard.mjs --web-dir "apps/web"

import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureToolsInPath } from "./_ensure-tools-path.mjs";

// Prepend common CLI install dirs to process.env.PATH so subprocess invocations
// (pnpm, gh, vercel, git, node) find their binaries even if Claude Code
// inherited a stale PATH (typical when tools were just installed via /start).
ensureToolsInPath();

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../templates/agent-dashboard");

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let webDir = "apps/web";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--web-dir" && args[i + 1]) webDir = args[++i];
}
const REPO_ROOT = process.cwd();
const WEB_DIR = join(REPO_ROOT, webDir);

// ─── handoff state ────────────────────────────────────────────────────
const STEPS = ["preflight", "ensureTextarea", "copyPages", "copyRouter", "registerRouter", "handoff"];
const completed = [];
const warnings = [];
let current = null;
const filesCopied = [];

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
  if (completed.length || current) dumpHandoff(false);
  process.exit(completed.length || current ? 2 : 1);
}
function dumpHandoff() {
  const remaining = STEPS.filter(s => !completed.includes(s) && s !== current);
  process.stderr.write(`\nCompleted (${completed.length}/${STEPS.length}): ${completed.join(", ") || "none"}\n`);
  if (current) process.stderr.write(`Failed at: ${current}\n`);
  if (remaining.length) process.stderr.write(`Not attempted: ${remaining.join(", ")}\n`);
}

// ─── Step 1 - preflight ──────────────────────────────────────────────
async function preflight() {
  if (!existsSync(WEB_DIR)) fail(`No web app at ${webDir}/`);
  if (!existsSync(join(WEB_DIR, "package.json"))) fail(`Not a Node project: ${webDir}/`);
  if (!existsSync(TEMPLATE_DIR)) fail(`Templates not found at ${TEMPLATE_DIR}`);

  // Admin auth required (the dashboard pages call adminProcedure)
  const authPath = join(WEB_DIR, "src/server/auth.ts");
  if (!existsSync(authPath)) {
    fail(`No src/server/auth.ts found. The agent dashboard requires admin auth - run /add-auth (admin mode) first.`);
  }
  const authContent = readFileSync(authPath, "utf8");
  if (!/isAdmin|adminProcedure/.test(authContent)) {
    fail(`src/server/auth.ts doesn't export isAdmin/adminProcedure. The agent dashboard needs admin auth - run /add-auth in admin mode first.`);
  }

  // Agent tables must already exist (set up by /add-agent at least once)
  const schemaPath = join(WEB_DIR, "src/server/db/schema.ts");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf8");
    if (!/agentInvocations/.test(schema)) {
      fail(`Agent tables not in schema.ts - run /add-agent first to create at least one agent.`);
    }
  } else {
    warn(`No schema.ts found at expected path. Continuing but the router may have unresolved imports.`);
  }
  ok("preflight passed");
}

// ─── Step 1.bis - ensureTextarea ─────────────────────────────────────
// The dashboard's trigger-form uses ~/components/ui/textarea, which is NOT
// installed by /bootstrap by default. Idempotent: if the file exists, skip.
// Run a shell command. capture=true pipes stdout/stderr (returned as strings);
// otherwise it inherits the parent stdio. Cross-platform via shell:true.
function run(cmd, cwd, capture = false) {
  return spawnSync(cmd, { cwd, shell: true, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
}

async function ensureTextarea() {
  const textareaPath = join(WEB_DIR, "src/components/ui/textarea.tsx");
  if (existsSync(textareaPath)) {
    ok("shadcn textarea already installed");
    return;
  }
  log("Installing shadcn textarea component");
  // npx shadcn add textarea - must be run from the web app dir, not the
  // monorepo root, otherwise shadcn doesn't find components.json.
  const r = run(`npx shadcn@latest add textarea --yes`, WEB_DIR, true);
  if (r.status !== 0) {
    warn(`shadcn add textarea failed (exit ${r.status}). The trigger form will fail to import - install manually with 'npx shadcn add textarea' from ${webDir}/.`);
    if (r.stderr) process.stderr.write(r.stderr.slice(0, 400) + "\n");
  } else {
    ok("shadcn textarea installed");
  }
}

// ─── Step 2 - copyPages ──────────────────────────────────────────────
async function copyPages() {
  const targets = [
    {
      src: "pages/agents-list.tsx",
      dst: "src/app/admin/agents/page.tsx",
      marker: "AgentsListPage",
    },
    {
      src: "pages/agent-detail.tsx",
      dst: "src/app/admin/agents/[name]/page.tsx",
      marker: "AgentDetailPage",
    },
    {
      src: "pages/trigger-form.tsx",
      dst: "src/app/admin/agents/[name]/trigger-form.tsx",
      marker: "TriggerForm",
    },
    {
      src: "pages/invocation-detail.tsx",
      dst: "src/app/admin/agents/[name]/invocations/[id]/page.tsx",
      marker: "InvocationDetailPage",
    },
  ];

  for (const t of targets) {
    const srcP = join(TEMPLATE_DIR, t.src);
    const dstP = join(WEB_DIR, t.dst);
    if (existsSync(dstP)) {
      const existing = readFileSync(dstP, "utf8");
      if (existing.includes(t.marker)) {
        ok(`already in place: ${t.dst}`);
        continue;
      }
      warn(`${t.dst} exists but doesn't have our marker - leaving it alone (manual review needed).`);
      continue;
    }
    mkdirSync(dirname(dstP), { recursive: true });
    copyFileSync(srcP, dstP);
    filesCopied.push(t.dst);
    ok(`wrote ${t.dst}`);
  }
}

// ─── Step 3 - copyRouter ─────────────────────────────────────────────
async function copyRouter() {
  const srcP = join(TEMPLATE_DIR, "router.ts");
  const dstP = join(WEB_DIR, "src/server/api/routers/agent-dashboard.ts");
  if (existsSync(dstP)) {
    ok("router already in place: src/server/api/routers/agent-dashboard.ts");
    return;
  }
  mkdirSync(dirname(dstP), { recursive: true });
  copyFileSync(srcP, dstP);
  filesCopied.push("src/server/api/routers/agent-dashboard.ts");
  ok("wrote src/server/api/routers/agent-dashboard.ts");
}

// ─── Step 4 - registerRouter ─────────────────────────────────────────
async function registerRouter() {
  const rootPath = join(WEB_DIR, "src/server/api/root.ts");
  if (!existsSync(rootPath)) fail(`Could not find ${rootPath}`);
  let content = readFileSync(rootPath, "utf8");

  // Already registered?
  if (/agentDashboardRouter|agentDashboard:/.test(content)) {
    ok("router already registered in root.ts");
    return;
  }

  // Add import
  const importLine = `import { agentDashboardRouter } from "./routers/agent-dashboard";`;
  if (!content.includes(importLine)) {
    // Insert after the last existing import
    const lastImportMatch = [...content.matchAll(/^import .+ from .+;$/gm)].pop();
    if (lastImportMatch && typeof lastImportMatch.index === "number") {
      const idx = lastImportMatch.index + lastImportMatch[0].length;
      content = content.slice(0, idx) + "\n" + importLine + content.slice(idx);
    } else {
      content = importLine + "\n" + content;
    }
  }

  // Register inside createTRPCRouter({...}) call
  const replaced = content.replace(
    /createTRPCRouter\(\s*\{/,
    `createTRPCRouter({\n  agentDashboard: agentDashboardRouter,`,
  );
  if (replaced === content) {
    fail("Could not find createTRPCRouter({...}) in root.ts - register the router manually: add `agentDashboard: agentDashboardRouter,` inside the router object.");
  }
  writeFileSync(rootPath, replaced, "utf8");
  ok("agentDashboardRouter registered in root.ts");
}

// ─── Step 5 - handoff ────────────────────────────────────────────────
async function handoff() {
  ok("Pipeline complete.");
}

// ─── MAIN ────────────────────────────────────────────────────────────
await step("preflight", preflight);
await step("ensureTextarea", ensureTextarea);
await step("copyPages", copyPages);
await step("copyRouter", copyRouter);
await step("registerRouter", registerRouter);
await step("handoff", handoff);

dumpHandoff();
process.stdout.write(JSON.stringify({
  success: true,
  filesCopied,
  warnings,
  routes: [
    "/admin/agents               - liste de tous tes agents avec leurs stats",
    "/admin/agents/<name>        - détail d'un agent + bouton trigger manuel",
    "/admin/agents/<name>/invocations/<id> - chaîne de pensée tour-par-tour",
  ],
  nextSteps: filesCopied.length > 0
    ? ["pnpm dev pour voir le dashboard sur /admin/agents"]
    : ["Le dashboard était déjà installé - rien à faire."],
}) + "\n");
