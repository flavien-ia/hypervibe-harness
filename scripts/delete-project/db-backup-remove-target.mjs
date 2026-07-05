#!/usr/bin/env node
// db-backup-remove-target.mjs - Remove a project from the scheduled Neon
// backups. Two generations of infrastructure are supported:
//
//   1. UNIFIED (current): the "hypervibe-jobs" shared worker. Its registry
//      (~/.hypervibe-jobs/jobs.js, git-versioned) holds a "neon-backups" job
//      with a targets[] array. When the project is found there, removal is
//      delegated to scripts/shared-worker/register.mjs
//      (--kind snapshot --remove-target <name>), which updates the registry,
//      commits it, and redeploys the worker.
//
//   2. LEGACY (fallback): the standalone db-backup worker
//      (~/.db-backup-worker/wrangler.toml). Its `BACKUP_TARGETS` env var is a
//      JSON string containing the array of projects to back up. This path:
//        1. Reads wrangler.toml
//        2. Parses BACKUP_TARGETS as JSON
//        3. Removes the entry where name === <project>
//        4. Writes wrangler.toml back with surgical replacement (only the
//           BACKUP_TARGETS line changes; comments and other config preserved)
//        5. Runs `wrangler deploy` in the worker directory to push the update
//
// Usage:
//   node db-backup-remove-target.mjs --project <name>
//
// Exits 0 on success, 1 on any error. Prints a JSON report to stdout
// (same shape as always: { status: "ok" | "skipped" | "error", ... }).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const PROJECT = arg("--project");
if (!PROJECT) {
  console.error("Usage: node db-backup-remove-target.mjs --project <name>");
  process.exit(1);
}

// ── 1. Unified shared worker (hypervibe-jobs) ──────────────────────────────
// Read the registry defensively: any parse problem here means "not handled by
// the unified worker" and we fall back to the legacy path below.
const jobsPath = join(homedir(), ".hypervibe-jobs", "jobs.js");

function readUnifiedTargets() {
  if (!existsSync(jobsPath)) return null;
  try {
    const raw = readFileSync(jobsPath, "utf8");
    const m = raw.match(/export default\s*([\s\S]*?);?\s*$/);
    if (!m) return null;
    const registry = JSON.parse(m[1]);
    const job = (registry.jobs || []).find((j) => j.name === "neon-backups");
    return job && Array.isArray(job.targets) ? job.targets : null;
  } catch {
    return null;
  }
}

const unifiedTargets = readUnifiedTargets();
const unifiedEntry = (unifiedTargets || []).find(
  (t) => (t.name || "").toLowerCase() === PROJECT.toLowerCase(),
);

if (unifiedEntry) {
  // Delegate to the shared-worker management script (this file lives in
  // scripts/delete-project/, register.mjs in scripts/shared-worker/).
  const registerPath = join(__dirname, "..", "shared-worker", "register.mjs");
  const r = spawnSync(
    "node",
    [registerPath, "--kind", "snapshot", "--remove-target", unifiedEntry.name],
    { encoding: "utf8" },
  );
  // register.mjs prints a single JSON line on stdout (logs go to stderr).
  let report = null;
  try {
    const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop();
    report = line ? JSON.parse(line) : null;
  } catch {
    report = null;
  }

  if (r.status === 0 && report && report.ok) {
    console.log(JSON.stringify({
      status: "ok",
      removed: PROJECT,
      targetsBefore: unifiedTargets.length,
      targetsAfter: typeof report.targetCount === "number" ? report.targetCount : unifiedTargets.length - 1,
      workerDeployed: report.deployed === true,
      source: "hypervibe-jobs",
    }));
    process.exit(0);
  }

  console.log(JSON.stringify({
    status: "error",
    reason: (report && report.error) || `shared-worker register.mjs exited with code ${r.status}`,
    stderr: (r.stderr || "").slice(0, 500),
    source: "hypervibe-jobs",
  }));
  process.exit(1);
}

// ── 2. Legacy standalone worker (~/.db-backup-worker) ──────────────────────
const workerDir = join(homedir(), ".db-backup-worker");
const tomlPath = join(workerDir, "wrangler.toml");

if (!existsSync(tomlPath)) {
  console.log(JSON.stringify({ status: "skipped", reason: "wrangler.toml not found" }));
  process.exit(0);
}

const original = readFileSync(tomlPath, "utf8");

// Find the BACKUP_TARGETS = '<json>' line and parse the JSON
const match = original.match(/^BACKUP_TARGETS\s*=\s*'(\[[\s\S]*?\])'\s*$/m);
if (!match) {
  console.log(JSON.stringify({ status: "error", reason: "BACKUP_TARGETS line not found or not parseable" }));
  process.exit(1);
}

let targets;
try {
  targets = JSON.parse(match[1]);
} catch (e) {
  console.log(JSON.stringify({ status: "error", reason: `BACKUP_TARGETS JSON invalid: ${e.message}` }));
  process.exit(1);
}

const beforeCount = targets.length;
const filtered = targets.filter((t) => t.name.toLowerCase() !== PROJECT.toLowerCase());
const removed = beforeCount - filtered.length;

if (removed === 0) {
  console.log(JSON.stringify({ status: "skipped", reason: "project not in BACKUP_TARGETS", project: PROJECT, totalTargets: beforeCount }));
  process.exit(0);
}

// Surgically rewrite the BACKUP_TARGETS line, preserve everything else
const newTargetsJson = JSON.stringify(filtered);
const newToml = original.replace(
  match[0],
  `BACKUP_TARGETS = '${newTargetsJson}'`,
);

writeFileSync(tomlPath, newToml);

// Redeploy the worker
const r = spawnSync("wrangler", ["deploy"], {
  cwd: workerDir,
  shell: true,
  encoding: "utf8",
});

if (r.status !== 0) {
  // Rollback the toml
  writeFileSync(tomlPath, original);
  console.log(JSON.stringify({
    status: "error",
    reason: "wrangler deploy failed - wrangler.toml rolled back",
    stderr: (r.stderr || "").slice(0, 500),
    stdout: (r.stdout || "").slice(0, 500),
  }));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "ok",
  removed: PROJECT,
  targetsBefore: beforeCount,
  targetsAfter: filtered.length,
  workerDeployed: true,
}));
