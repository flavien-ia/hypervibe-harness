#!/usr/bin/env node
// check-deploy.mjs - Wait for a Vercel deployment to settle, then report.
//
// Replaces the ad-hoc bash polling loops (`for i in $(seq 1 20); do vercel ls ...`)
// that die on the 2-minute Bash timeout, and the `sleep N &&` chains that the
// harness blocks. All waiting happens INSIDE this process, so the caller runs a
// single command (use run_in_background for long deploys).
//
//   node check-deploy.mjs                          # last production deploy of ./
//   node check-deploy.mjs --project-dir C:/DEV/app --timeout 600
//   node check-deploy.mjs --sha $(git rev-parse HEAD)   # wait for THIS commit
//   node check-deploy.mjs --target preview
//
// Auth: REST API using the Vercel CLI login (or $VERCEL_TOKEN). The CLI's stored
// access token expires while the CLI itself keeps working (it refreshes silently
// without rewriting auth.json), so on 401/403 we fall back to parsing `vercel ls`.
//
// Output (stdout): a single JSON object.
// Exit codes: 0 = READY, 1 = ERROR/CANCELED/not-found, 2 = timeout, 3 = not configured.

import { spawnSync } from "node:child_process";
import { loadAuthToken, readLinkedProject } from "../_vercel-auth.mjs";

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const PROJECT_DIR = arg("--project-dir", process.cwd());
const TARGET = arg("--target", "production");
const SHA = arg("--sha", null);
const TIMEOUT_S = Number(arg("--timeout", "300"));
const INTERVAL_S = Number(arg("--interval", "5"));
const FORCE_CLI = args.includes("--force-cli"); // skip the REST path (debug / dead token)

// Never call process.exit() here: on Windows it races with the open undici
// socket and aborts the process with a libuv assertion (exit code 127 instead
// of the real status). We return the verdict and let the event loop drain.
class Verdict {
  constructor(obj, code) {
    this.obj = obj;
    this.code = code;
  }
}
function out(obj, code) {
  throw new Verdict(obj, code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");

// Vercel exposes the lifecycle as `state` (v6) and historically `readyState`.
const TERMINAL_OK = new Set(["READY"]);
const TERMINAL_KO = new Set(["ERROR", "CANCELED"]);

// ─── REST path ─────────────────────────────────────────────────────────
const linked = readLinkedProject(PROJECT_DIR);
const token = loadAuthToken({ onWarn: (m) => process.stderr.write(`[vercel] ${m}\n`) });

let restUrl = null;
if (linked && token && !FORCE_CLI) {
  const teamQuery = linked.orgId ? `&teamId=${linked.orgId}` : "";
  restUrl =
    `https://api.vercel.com/v6/deployments?projectId=${linked.projectId}` +
    `&target=${encodeURIComponent(TARGET)}&limit=20${teamQuery}`;
}

function shaMatches(candidate) {
  if (!candidate) return false;
  return candidate === SHA || candidate.startsWith(SHA) || SHA.startsWith(candidate);
}

function summarizeRest(d) {
  const meta = d.meta || {};
  return {
    state: d.state || d.readyState || "UNKNOWN",
    uid: d.uid,
    url: d.url ? `https://${d.url}` : null,
    target: d.target || TARGET,
    createdAt: d.created ? new Date(d.created).toISOString() : null,
    commitSha: meta.githubCommitSha || meta.gitlabCommitSha || meta.bitbucketCommitSha || null,
    commitMessage:
      meta.githubCommitMessage || meta.gitlabCommitMessage || meta.bitbucketCommitMessage || null,
    inspectorUrl: d.inspectorUrl || null,
  };
}

// Returns { deployment } | { authFailed: true } | { retry: true } | { empty: true }
async function probeRest() {
  let res;
  try {
    res = await fetch(restUrl, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { retry: true };
  }
  if (res.status === 401 || res.status === 403) return { authFailed: true };
  if (!res.ok) return { retry: true };

  const body = await res.json();
  const deployments = (body.deployments || []).map(summarizeRest);
  if (!SHA) {
    return deployments.length ? { deployment: deployments[0] } : { empty: true };
  }
  const match = deployments.find((d) => shaMatches(d.commitSha));
  return match ? { deployment: match } : { empty: true };
}

// ─── CLI fallback ──────────────────────────────────────────────────────
// `vercel ls` prints a table: Age | Project | Deployment | Status | Environment | ...
const CLI_STATE = {
  ready: "READY",
  error: "ERROR",
  canceled: "CANCELED",
  cancelled: "CANCELED",
  building: "BUILDING",
  queued: "QUEUED",
  initializing: "INITIALIZING",
};

function probeCli() {
  // Single command string (not an args array): with shell:true, Node 24 emits a
  // DEP0190 deprecation warning when both are combined.
  const r = spawnSync("vercel ls", {
    cwd: PROJECT_DIR,
    encoding: "utf8",
    shell: true,
    timeout: 90_000,
  });
  if (r.error || r.status !== 0) {
    return { retry: true, detail: stripAnsi((r.stderr || r.stdout || r.error?.message || "").slice(0, 200)) };
  }
  // The CLI splits its output: bare URLs on stdout (pipe-friendly), and the
  // human table carrying Status + Environment on stderr. We need the table.
  const lines = stripAnsi(`${r.stderr || ""}\n${r.stdout || ""}`).split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("https://")) continue;
    const cols = line.trim().split(/\s{2,}/);
    const url = cols.find((c) => c.startsWith("https://"));
    if (!url) continue;
    const idx = cols.indexOf(url);
    if (cols.length < idx + 3) continue; // bare-URL line from stdout, no status
    const statusRaw = (cols[idx + 1] || "").replace(/[●•]/g, "").trim().toLowerCase();
    const environment = (cols[idx + 2] || "").trim().toLowerCase();
    if (environment && !environment.startsWith(TARGET.slice(0, 4))) continue; // prod/preview
    return {
      deployment: {
        state: CLI_STATE[statusRaw] || statusRaw.toUpperCase() || "UNKNOWN",
        uid: null,
        url,
        target: environment || TARGET,
        createdAt: null,
        commitSha: null,
        commitMessage: null,
        inspectorUrl: null,
        age: cols[idx - 2] || null,
      },
    };
  }
  return { empty: true };
}

// ─── Preflight + poll loop ─────────────────────────────────────────────
async function main() {
if (!linked) {
  out(
    { status: "not-configured", reason: `No .vercel/project.json in ${PROJECT_DIR}. Run \`vercel link\` first.` },
    3,
  );
}

let mode = restUrl ? "rest" : "cli";
if (mode === "cli" && SHA) {
  out(
    {
      status: "not-configured",
      reason:
        "No Vercel REST token, and commit-level verification (--sha) cannot be done from the CLI table. " +
        "Run `vercel whoami` (that alone usually refreshes the stored token), `vercel login` only if it fails, " +
        "or drop --sha to check the latest deployment instead.",
    },
    3,
  );
}

const startedAt = Date.now();
const deadline = startedAt + TIMEOUT_S * 1000;
let polls = 0;
let lastState = null;
let fellBack = false;
let consecutiveFailures = 0;

while (true) {
  polls++;
  const r = mode === "rest" ? await probeRest() : probeCli();

  // Never loop silently on a broken probe: a repeated failure is a real error,
  // not "still building". Surface it instead of reporting a timeout at the end.
  if (r.retry) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      out(
        {
          status: "error",
          method: mode,
          reason:
            mode === "cli"
              ? `\`vercel ls\` failed ${consecutiveFailures}x: ${r.detail || "no output"}`
              : `Vercel API unreachable ${consecutiveFailures}x in a row.`,
          polls,
        },
        1,
      );
    }
  } else {
    consecutiveFailures = 0;
  }

  if (r.authFailed) {
    // The stored token is dead but the CLI can still refresh itself.
    if (SHA) {
      out(
        {
          status: "not-configured",
          reason:
            "Vercel REST token rejected (401/403) and --sha needs the REST API. " +
            "Run `vercel whoami` (that alone usually refreshes the stored token), `vercel login` only if it fails, then retry.",
        },
        3,
      );
    }
    process.stderr.write("[vercel] REST token rejected, falling back to the CLI. Run `vercel whoami` to restore the fast path (`vercel login` only if that fails).\n");
    mode = "cli";
    fellBack = true;
    continue;
  }

  if (r.deployment) {
    lastState = r.deployment.state;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const base = {
      method: mode,
      ...(fellBack ? { note: "REST token expired; state read from the Vercel CLI. Run `vercel whoami` to restore the REST path (`vercel login` only if that fails)." } : {}),
      waitedSeconds: elapsed,
      polls,
      deployment: r.deployment,
    };
    if (TERMINAL_OK.has(lastState)) out({ status: "ready", ...base }, 0);
    if (TERMINAL_KO.has(lastState)) out({ status: "failed", ...base }, 1);
  } else if (r.empty && !SHA) {
    // Without --sha the question is "what is the state of the latest deployment",
    // so an empty list is a definitive answer: report it now instead of burning
    // the whole timeout. With --sha we keep waiting: the build may still be queued.
    out({ status: "not-found", reason: `No ${TARGET} deployment found for this project.`, method: mode, polls }, 1);
  }

  if (Date.now() >= deadline) {
    out(
      {
        status: "timeout",
        reason: SHA
          ? `No settled deployment for commit ${SHA.slice(0, 8)} after ${TIMEOUT_S}s (last state: ${lastState || "not created"}).`
          : `Still ${lastState || "not created"} after ${TIMEOUT_S}s.`,
        method: mode,
        waitedSeconds: Math.round((Date.now() - startedAt) / 1000),
        polls,
        deployment: r.deployment || null,
      },
      2,
    );
  }

  process.stderr.write(`[vercel] ${lastState || "waiting for deployment"}... (${polls})\n`);
  await sleep(INTERVAL_S * 1000);
}
}

try {
  await main();
} catch (e) {
  if (e instanceof Verdict) {
    process.stdout.write(JSON.stringify(e.obj, null, 2) + "\n");
    process.exitCode = e.code;
  } else {
    process.stdout.write(JSON.stringify({ status: "error", reason: e?.message || String(e) }, null, 2) + "\n");
    process.exitCode = 1;
  }
}
