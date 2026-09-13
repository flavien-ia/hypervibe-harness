#!/usr/bin/env node
// test-worker-check.mjs - The shared worker check run by the update skill.
//
//   node scripts/tests/test-worker-check.mjs
//
// What must hold, on any machine:
//   - no worker folder: "absent", and nothing gets created (creating a worker
//     is /start's call, never an update's);
//   - a worker.js identical to the plugin's: "up_to_date", left untouched;
//   - the R2 storage bug of the old workers is recognised by name, and a
//     fixed worker is never mistaken for it;
//   - a stale copy is repaired through ensure.mjs and committed locally.
//
// Temporary folders only. The repair runs ensure.mjs with --no-deploy, so
// nothing reaches Cloudflare, and the global git config is neutralised so that
// no hook of this machine runs on the throwaway commits.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(ROOT, "scripts", "shared-worker", "worker-check.mjs");
const LATEST = readFileSync(join(ROOT, "scripts", "shared-worker", "worker.js"), "utf8");

// The storage query as the old workers shipped it.
const R2_BUG = `const query = \`query R2Storage($accountTag: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) {
      max { payloadSize metadataSize objectCount }
    }
  } }
}\`;
`;

const temps = [];
const scratch = mkdtempSync(join(tmpdir(), "hv-worker-check-"));
temps.push(scratch);
const emptyGitConfig = join(scratch, "gitconfig");
writeFileSync(emptyGitConfig, "");
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: emptyGitConfig,
  GIT_CONFIG_NOSYSTEM: "1",
  // ensure.mjs wants a token before anything else, even with --no-deploy.
  // Used only when the vault is locked, and never sent anywhere.
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "test-token-never-used",
};

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

function run(dir, ...flags) {
  const r = spawnSync(process.execPath, [CHECK, "--dir", dir, ...flags], { encoding: "utf8", env: ENV });
  let json = null;
  try {
    json = JSON.parse((r.stdout || "").trim().split("\n").pop());
  } catch {
    // Left null: the checks below report the raw output.
  }
  return { json, raw: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

function workerDir(source) {
  const dir = mkdtempSync(join(tmpdir(), "hv-jobs-"));
  temps.push(dir);
  writeFileSync(join(dir, "wrangler.toml"), 'name = "hypervibe-jobs-test"\nmain = "worker.js"\n');
  writeFileSync(join(dir, "jobs.js"), 'export default {"jobs": []};\n');
  writeFileSync(join(dir, "worker.js"), source);
  return dir;
}

try {
  {
    const dir = join(scratch, "no-worker-here");
    const r = run(dir);
    check("no worker: status absent", r.json?.ok === true && r.json?.status === "absent", r.raw);
    check("no worker: nothing created", !existsSync(dir));
  }

  {
    const dir = workerDir(LATEST);
    const r = run(dir);
    check("same worker.js: status up_to_date", r.json?.ok === true && r.json?.status === "up_to_date", r.raw);
    check("same worker.js: left untouched", !existsSync(join(dir, ".git")));
  }

  {
    const dir = workerDir(R2_BUG);
    const r = run(dir, "--dry-run");
    check("R2 bug: status stale", r.json?.ok === true && r.json?.status === "stale", r.raw);
    check(
      "R2 bug: recognised by name",
      Array.isArray(r.json?.knownBugs) && r.json.knownBugs.some((b) => b.id === "r2-storage-single-bucket"),
      r.raw,
    );
    check("R2 bug: a dry run changes nothing", readFileSync(join(dir, "worker.js"), "utf8") === R2_BUG);
  }

  {
    // The fixed worker, one comment apart: stale, but no bug claimed.
    const dir = workerDir(`${LATEST}\n// an older build\n`);
    const r = run(dir, "--dry-run");
    check("other difference: status stale", r.json?.status === "stale", r.raw);
    check(
      "other difference: the fixed worker is not mistaken for the R2 bug",
      Array.isArray(r.json?.knownBugs) && r.json.knownBugs.length === 0,
      r.raw,
    );
  }

  const wrangler = spawnSync("wrangler --version", { shell: true, encoding: "utf8" });
  if (wrangler.status !== 0) {
    console.log("  skip  repair (wrangler is not installed on this machine, ensure.mjs requires it)");
  } else {
    const dir = workerDir(R2_BUG);
    const r = run(dir, "--no-deploy");
    check("repair: status updated", r.json?.ok === true && r.json?.status === "updated", r.raw);
    check(
      "repair: the fixed bug is named",
      Array.isArray(r.json?.knownBugs) && r.json.knownBugs.some((b) => b.id === "r2-storage-single-bucket"),
      r.raw,
    );
    check("repair: worker.js is now the plugin's", readFileSync(join(dir, "worker.js"), "utf8") === LATEST);
    const history = spawnSync("git", ["log", "--format=%s"], { cwd: dir, encoding: "utf8", env: ENV });
    check(
      "repair: committed in the local repo",
      /update worker\.js to the latest plugin version/.test(history.stdout || ""),
      `${history.stdout || ""}${history.stderr || ""}`.trim(),
    );
    const again = run(dir);
    check("repair: the next run finds it up to date", again.json?.status === "up_to_date", again.raw);
  }
} finally {
  for (const d of temps) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
