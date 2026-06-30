#!/usr/bin/env node
// setup-cron-dispatcher.mjs - Manage the shared "cron-dispatcher" Cloudflare Worker
// that runs every minute and pings registered HTTP endpoints when their cron matches.
//
// Two modes:
//
//   1. --init                              First-time install.
//      --cf-account-id <id>                  Required.
//      Creates $HOME/.cron-dispatcher/ with index.js (copied from
//      cron-dispatcher-worker.js) and wrangler.toml (TASKS = []).
//      Idempotent: returns ok=true with action="exists" if already there.
//
//   2. --add-task                          Register a task in the dispatcher.
//      --task-name <name>                    Kebab-case unique key.
//      --cron-expr "<5-field UTC cron>"      e.g. "0 9 * * 1".
//      --app-url <https://...>               Where the API route lives.
//      --project-name <slug>                 Project owning this task.
//      --web-dir <path>                      Where to create the Next.js route. Default ".".
//      Adds (or replaces by name) an entry in TASKS, creates the Next.js route file,
//      and prints the secret name expected for this project. Does NOT call wrangler;
//      the calling skill is responsible for `wrangler secret put` and `wrangler deploy`.
//
// Output: a single JSON line on stdout describing what happened, suitable for the skill
// to parse and decide next shell steps. All log/diagnostic output goes to stderr.

import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DISPATCHER_DIR = join(homedir(), ".cron-dispatcher");
const WORKER_SOURCE = join(SCRIPT_DIR, "cron-dispatcher-worker.js");

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--init") opts.init = true;
  else if (a === "--add-task") opts.addTask = true;
  else if (a === "--cf-account-id" && args[i + 1]) opts.cfAccountId = args[++i];
  else if (a === "--task-name" && args[i + 1]) opts.taskName = args[++i];
  else if (a === "--cron-expr" && args[i + 1]) opts.cronExpr = args[++i];
  else if (a === "--app-url" && args[i + 1]) opts.appUrl = args[++i];
  else if (a === "--project-name" && args[i + 1]) opts.projectName = args[++i];
  else if (a === "--web-dir" && args[i + 1]) opts.webDir = args[++i];
  else {
    fail(`Unknown arg: ${a}`);
  }
}

if (opts.init && opts.addTask) fail("Use either --init or --add-task, not both.");
if (!opts.init && !opts.addTask) fail("Specify --init or --add-task.");

if (opts.init) doInit();
else doAddTask();

// ─── modes ────────────────────────────────────────────────────────────

function doInit() {
  if (!opts.cfAccountId) fail("--cf-account-id is required for --init.");

  if (existsSync(join(DISPATCHER_DIR, "wrangler.toml"))) {
    out({ ok: true, action: "exists", dispatcherPath: DISPATCHER_DIR });
    return;
  }

  mkdirSync(DISPATCHER_DIR, { recursive: true });

  if (!existsSync(WORKER_SOURCE)) {
    fail(`Worker source not found at ${WORKER_SOURCE}`);
  }
  copyFileSync(WORKER_SOURCE, join(DISPATCHER_DIR, "index.js"));

  const wranglerToml = `name = "cron-dispatcher"
main = "index.js"
compatibility_date = "2024-12-01"
account_id = "${opts.cfAccountId}"

[triggers]
crons = ["* * * * *"]

[vars]
TASKS = '[]'
`;
  writeFileSync(join(DISPATCHER_DIR, "wrangler.toml"), wranglerToml);

  out({
    ok: true,
    action: "created",
    dispatcherPath: DISPATCHER_DIR,
    nextSteps: [
      `cd "${DISPATCHER_DIR}" && wrangler deploy`,
    ],
  });
}

function doAddTask() {
  for (const k of ["taskName", "cronExpr", "appUrl", "projectName"]) {
    if (!opts[k]) fail(`--${kebab(k)} is required for --add-task.`);
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(opts.taskName)) {
    fail(`--task-name must be kebab-case. Got: ${opts.taskName}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(opts.projectName)) {
    fail(`--project-name must be kebab-case. Got: ${opts.projectName}`);
  }

  const wranglerPath = join(DISPATCHER_DIR, "wrangler.toml");
  if (!existsSync(wranglerPath)) {
    fail(`Dispatcher not initialized. Run with --init first. Expected at ${wranglerPath}`);
  }

  const webDir = opts.webDir || ".";
  const routeDir = join(webDir, "src/app/api/cron", opts.taskName);
  const routePath = join(routeDir, "route.ts");
  const routeCreated = !existsSync(routePath);

  if (routeCreated) {
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(routePath, renderRoute(opts.taskName));
  }

  const tomlBefore = readFileSync(wranglerPath, "utf8");
  const tasks = extractTasks(tomlBefore);

  const secretName = `CRON_SECRET_${slugUpper(opts.projectName)}`;
  const newTask = {
    name: opts.taskName,
    cron: opts.cronExpr,
    url: `${stripTrail(opts.appUrl)}/api/cron/${opts.taskName}`,
    secretName,
    project: opts.projectName,
  };

  const existingIdx = tasks.findIndex((t) => t.name === opts.taskName);
  const replaced = existingIdx !== -1;
  if (replaced) tasks[existingIdx] = newTask;
  else tasks.push(newTask);

  const tomlAfter = writeTasks(tomlBefore, tasks);
  writeFileSync(wranglerPath, tomlAfter);

  out({
    ok: true,
    action: replaced ? "replaced" : "added",
    dispatcherPath: DISPATCHER_DIR,
    taskName: opts.taskName,
    secretName,
    routePath,
    routeCreated,
    taskCount: tasks.length,
    nextSteps: [
      `# Upload the project's CRON_SECRET to the dispatcher (one-time per project)`,
      `cd "${DISPATCHER_DIR}" && printf '%s' "$CRON_SECRET" | wrangler secret put ${secretName}`,
      `# Redeploy the dispatcher with the updated task list`,
      `cd "${DISPATCHER_DIR}" && wrangler deploy`,
    ],
  });
}

// ─── toml task helpers ────────────────────────────────────────────────

// Find the TASKS = '<json>' line and parse it.
function extractTasks(toml) {
  const match = toml.match(/^TASKS\s*=\s*'([\s\S]*?)'\s*$/m);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[1]);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    fail(`TASKS is not valid JSON: ${err.message}`);
  }
}

function writeTasks(toml, tasks) {
  const json = JSON.stringify(tasks);
  if (/^TASKS\s*=\s*'/m.test(toml)) {
    return toml.replace(/^TASKS\s*=\s*'[\s\S]*?'\s*$/m, `TASKS = '${json}'`);
  }
  // Append under [vars] section, or create section if missing.
  if (/^\[vars\]/m.test(toml)) {
    return toml.replace(/^\[vars\]\s*\n/m, `[vars]\nTASKS = '${json}'\n`);
  }
  return `${toml.trimEnd()}\n\n[vars]\nTASKS = '${json}'\n`;
}

// ─── route template ───────────────────────────────────────────────────

function renderRoute(taskName) {
  return `import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = \`Bearer \${process.env.CRON_SECRET}\`;

  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // YOUR CRON LOGIC HERE (${taskName})
    console.log(\`[CRON:${taskName}] Executed at \${new Date().toISOString()}\`);

    return NextResponse.json({
      success: true,
      task: "${taskName}",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[CRON:${taskName}] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
`;
}

// ─── utils ────────────────────────────────────────────────────────────

function slugUpper(s) {
  return s.replace(/-/g, "_").toUpperCase();
}

function kebab(s) {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

function stripTrail(url) {
  return url.replace(/\/+$/, "");
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}
