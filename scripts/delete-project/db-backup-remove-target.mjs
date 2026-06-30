#!/usr/bin/env node
// db-backup-remove-target.mjs - Surgically remove a project entry from the
// shared db-backup worker's BACKUP_TARGETS list, then redeploy the worker.
//
// Usage:
//   node db-backup-remove-target.mjs --project <name>
//
// The shared db-backup worker lives in ~/.db-backup-worker/wrangler.toml.
// Its `BACKUP_TARGETS` env var is a JSON string containing the array of
// projects to back up. This script:
//   1. Reads wrangler.toml
//   2. Parses BACKUP_TARGETS as JSON
//   3. Removes the entry where name === <project>
//   4. Writes wrangler.toml back with surgical replacement (only the
//      BACKUP_TARGETS line changes; comments and other config preserved)
//   5. Runs `wrangler deploy` in the worker directory to push the update
//
// Exits 0 on success, 1 on any error. Prints a JSON report to stdout.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

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
