#!/usr/bin/env node
// worker-check.mjs - Is the shared worker deployed from this machine behind
// the plugin? If so, bring it in step, and name the known bug that fixes.
//
// Called by the update skill after an install, and when the plugin is found
// already up to date. Installing a plugin never touches the worker running on
// the user's Cloudflare account: it keeps the code of the day it was last
// deployed. Before this check existed, it only caught up as a side effect of
// the skills that run ensure.mjs (/start, /quotas, /add-cron, /add-backup-db),
// so a machine that never ran them again kept an old worker, bugs included.
// That is how the R2 storage alert stayed silent past the free 10 GB.
//
// Never scaffolds: without ~/.hypervibe-jobs no worker was deployed from this
// machine, so there is nothing to repair, and creating one is /start's call.
// The comparison is local: a machine already in step answers without network
// and without the vault.
//
// Flags (all optional):
//   --dir <path>   default: ~/.hypervibe-jobs
//   --dry-run      report only, change nothing
//   --no-deploy    repair the local copy without redeploying (tests)
//
// Output: single JSON line on stdout. Logs on stderr.
//   { ok: true, status: "absent" | "up_to_date", dir }
//   { ok: true, status: "stale", dir, knownBugs }                  (--dry-run)
//   { ok: true, status: "updated", dir, knownBugs, deployed, healed }
//   { ok: false, status: "stale", dir, knownBugs, error, howTo? }  (repair failed)

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIR_DEFAULT, parseFlags, out, log } from "./_lib.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// Defects of past worker versions, recognised by their source. They only serve
// to TELL the user what the repair fixes: any difference with the plugin's
// worker.js is repaired, known or not.
const KNOWN_BUGS = [
  {
    id: "r2-storage-single-bucket",
    // The storage query took one max over the whole account, over the month,
    // without grouping by bucket: the largest bucket, never the total.
    test: (src) => /r2StorageAdaptiveGroups\(\s*limit:\s*1\s*,/.test(src),
    message:
      "The storage quota alert only looked at the largest storage bucket, never at the account total: it could stay silent past the free 10 GB.",
  },
  {
    id: "neon-egress-summed-across-projects",
    // Egress was compared to 5 GB for the whole account; Neon caps it at 5 GB
    // PER PROJECT. The old constant was `egressGB`, the new `egressGBPerProject`.
    test: (src) => /NEON_FREE\.egressGB\b/.test(src),
    message:
      "The Neon egress alert added up every project and compared the total with 5 GB, while the free plan allows 5 GB per project: it could fire with no project anywhere near its cap.",
  },
  {
    id: "snapshot-failure-never-mailed",
    // The backup job only looked for an alert address on itself, and no path
    // of the plugin ever writes one there.
    test: (src) =>
      /const cfg = job\.config \|\| \{\};\s*if \(!resolveEmailProvider\(env, cfg\) \|\| !cfg\.senderEmail/.test(src),
    message:
      "A failed database backup was never emailed on a standard install: the backup job looked for an alert address on itself only, and nothing ever wrote one there.",
  },
];

const { flags } = parseFlags(process.argv.slice(2));
const DIR = flags.dir || DIR_DEFAULT;

const present =
  existsSync(join(DIR, "wrangler.toml")) &&
  existsSync(join(DIR, "worker.js")) &&
  existsSync(join(DIR, "jobs.js"));
if (!present) out({ ok: true, status: "absent", dir: DIR });

const current = readFileSync(join(DIR, "worker.js"), "utf8");
const latest = readFileSync(join(SCRIPT_DIR, "worker.js"), "utf8");
if (current === latest) out({ ok: true, status: "up_to_date", dir: DIR });

const knownBugs = KNOWN_BUGS.filter((b) => b.test(current)).map(({ id, message }) => ({ id, message }));
if (flags["dry-run"]) out({ ok: true, status: "stale", dir: DIR, knownBugs });

// The repair itself belongs to ensure.mjs (copy, commit in the local repo,
// redeploy, ADMIN_TOKEN check): one code path, the one every consumer skill
// already runs.
log("The shared worker is behind the plugin: bringing it in step...");
const args = [join(SCRIPT_DIR, "ensure.mjs"), "--dir", DIR];
if (flags["no-deploy"]) args.push("--no-deploy");
const r = spawnSync(process.execPath, args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
let res = null;
try {
  res = JSON.parse((r.stdout || "").trim().split("\n").pop());
} catch {
  // No JSON line: ensure.mjs crashed. Reported just below.
}
if (!res?.ok) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      status: "stale",
      dir: DIR,
      knownBugs,
      error: res?.error || `ensure.mjs exited with code ${r.status}`,
      ...(res?.howTo ? { howTo: res.howTo } : {}),
    }) + "\n",
  );
  process.exit(1);
}
out({ ok: true, status: "updated", dir: DIR, knownBugs, deployed: res.deployed, healed: res.healed });
