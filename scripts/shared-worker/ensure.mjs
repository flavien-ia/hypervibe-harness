#!/usr/bin/env node
// ensure.mjs - Idempotent provisioning of the Hypervibe unified shared worker
// ("hypervibe-jobs"): ONE Cloudflare Worker per account that runs every
// registered job (Neon snapshots, quota watch, cron pings) on a single cron
// slot, from a git-versioned local repo.
//
// Called by /start (initial onboarding) and as a PREFLIGHT by every consumer
// skill (/add-backup-db, /quotas, /add-cron, /add-automation): if the worker
// is already provisioned it returns fast with status "already_present".
//
// What it guarantees after a successful run:
//   - <dir>/ exists and is a git repo (versioned registry, rollback-able)
//   - worker.js (copied from the plugin), jobs.js (registry), wrangler.toml,
//     .gitignore, README.md are present and committed
//   - the worker is deployed on the user's Cloudflare account (1 cron slot)
//   - the ADMIN_TOKEN secret is set (manual /trigger + /status endpoints) and
//     persisted at User scope as HYPERVIBE_JOBS_ADMIN_TOKEN
//
// Flags (all optional):
//   --dir <path>          default: ~/.hypervibe-jobs
//   --worker-name <name>  default: hypervibe-jobs
//   --account-id <id>     default: discovered from the Cloudflare API
//   --no-deploy           scaffold only (used by tests)
//   --force-redeploy      redeploy even when already present
//
// Output: single JSON line on stdout. Logs on stderr.
//   { ok, status: "created" | "already_present", dir, workerName, workerUrl,
//     jobs, deployed, adminTokenVar, healed: [...] }
//   { ok: false, error, howTo? }

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { readUserEnv } from "../_read-user-env.mjs";
import { writeUserEnv } from "../_write-user-env.mjs";
import {
  WORKER_NAME_DEFAULT,
  DIR_DEFAULT,
  parseFlags,
  out,
  fail,
  log,
  readRegistry,
  ensureGitRepo,
  gitCommitAll,
  checkWrangler,
  wranglerDeploy,
  listWranglerSecrets,
  putWranglerSecret,
  getCfAccountId,
} from "./_lib.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ADMIN_TOKEN_VAR = "HYPERVIBE_JOBS_ADMIN_TOKEN";

const { flags } = parseFlags(process.argv.slice(2));
const DIR = flags.dir || DIR_DEFAULT;
const WORKER_NAME = flags["worker-name"] || WORKER_NAME_DEFAULT;

main().catch((e) => fail(e?.message || String(e)));

async function main() {
  // ── Prereqs ────────────────────────────────────────────────────────────
  const wr = checkWrangler();
  if (!wr.ok) {
    fail("wrangler is not installed", {
      howTo: "Run /start (it installs and configures the Cloudflare tooling).",
    });
  }
  const token = readUserEnv("CLOUDFLARE_API_TOKEN");
  if (!token) {
    fail("CLOUDFLARE_API_TOKEN not found (vault locked or /start not done)", {
      howTo: "Unlock the vault or run /start to configure Cloudflare.",
    });
  }

  const scaffolded =
    existsSync(join(DIR, "wrangler.toml")) &&
    existsSync(join(DIR, "worker.js")) &&
    existsSync(join(DIR, "jobs.js"));

  const healed = [];

  if (!scaffolded) {
    await scaffold(token);
  } else {
    log(`Repo already scaffolded at ${DIR}.`);
    // Self-heal: git repo may be missing (e.g. manually created dir).
    if (ensureGitRepo(DIR).created) {
      gitCommitAll(DIR, "chore: version existing hypervibe-jobs config");
      healed.push("git repo initialized");
    }
  }

  // Keep the deployed worker source in sync with the plugin version.
  const sourceWorker = join(SCRIPT_DIR, "worker.js");
  if (scaffolded) {
    const { readFileSync } = await import("node:fs");
    const current = readFileSync(join(DIR, "worker.js"), "utf8");
    const latest = readFileSync(sourceWorker, "utf8");
    if (current !== latest) {
      copyFileSync(sourceWorker, join(DIR, "worker.js"));
      gitCommitAll(DIR, "chore: update worker.js to the latest plugin version");
      healed.push("worker.js updated to latest plugin version");
    }
  }

  // ── Deploy ────────────────────────────────────────────────────────────
  let workerUrl = null;
  let deployed = "unknown";
  if (!flags["no-deploy"]) {
    const needsDeploy = !scaffolded || flags["force-redeploy"] || healed.length > 0 || !(await isDeployed(token));
    if (needsDeploy) {
      log("Deploying the worker...");
      const dep = wranglerDeploy(DIR, token);
      if (!dep.ok) fail(dep.reason);
      workerUrl = dep.url;
      deployed = true;
    } else {
      deployed = true;
      workerUrl = await computeWorkerUrl(token);
    }

    // ── ADMIN_TOKEN (manual /trigger + /status) ─────────────────────────
    const secrets = listWranglerSecrets(DIR, token);
    if (secrets.ok && !secrets.names.includes("ADMIN_TOKEN")) {
      const adminToken = randomBytes(32).toString("hex");
      const put = putWranglerSecret(DIR, token, "ADMIN_TOKEN", adminToken);
      if (put.ok) {
        writeUserEnv(ADMIN_TOKEN_VAR, adminToken);
        healed.push("ADMIN_TOKEN generated and stored");
      } else {
        log(`WARN: could not set ADMIN_TOKEN: ${put.reason}`);
      }
    } else if (secrets.ok && !readUserEnv(ADMIN_TOKEN_VAR)) {
      log(`NOTE: the worker has an ADMIN_TOKEN secret but ${ADMIN_TOKEN_VAR} is not readable locally. Manual /trigger will not work from this machine until it is re-set (rerun with --force-redeploy to rotate it).`);
    }
  }

  const registry = readRegistry(DIR);
  out({
    ok: true,
    status: scaffolded ? "already_present" : "created",
    dir: DIR,
    workerName: WORKER_NAME,
    workerUrl,
    deployed,
    jobs: registry.jobs.length,
    adminTokenVar: ADMIN_TOKEN_VAR,
    healed,
  });
}

// ── Scaffold ──────────────────────────────────────────────────────────────

async function scaffold(token) {
  log(`Scaffolding ${DIR}...`);
  mkdirSync(DIR, { recursive: true });

  const accountId = flags["account-id"] || (await getCfAccountId(token));
  if (!accountId) {
    fail("Cannot determine the Cloudflare account id", {
      howTo: "Pass --account-id <id> or check the Cloudflare token.",
    });
  }

  copyFileSync(join(SCRIPT_DIR, "worker.js"), join(DIR, "worker.js"));
  copyFileSync(join(SCRIPT_DIR, "jobs.js"), join(DIR, "jobs.js"));

  writeFileSync(
    join(DIR, "wrangler.toml"),
    `name = "${WORKER_NAME}"
main = "worker.js"
compatibility_date = "2024-12-01"
account_id = "${accountId}"

[triggers]
crons = ["* * * * *"]
`,
  );

  writeFileSync(
    join(DIR, ".gitignore"),
    `.wrangler/
node_modules/
.dev.vars
`,
  );

  writeFileSync(
    join(DIR, "README.md"),
    `# hypervibe-jobs

Unified shared Cloudflare Worker managed by the [Hypervibe plugin](https://hypervibe.fr/plugin).
ONE worker, ONE cron slot, all the account-wide background jobs:

| Kind | Role |
|---|---|
| \`snapshot\` | Neon database backups (rolling + aging retention) |
| \`quota\` | Free-tier quota watch + alert email |
| \`ping\` | Scheduled HTTP pings to each project's \`/api/cron/<task>\` route |

## How it works

- \`jobs.js\` is the registry (versioned here, in git). The Hypervibe skills
  (\`/add-backup-db\`, \`/quotas\`, \`/add-cron\`, \`/add-automation\`) add and
  remove entries through \`register.mjs\`; every change is committed and the
  worker is redeployed.
- The worker ticks every minute (UTC) and runs whichever jobs are due.
- Secrets (Neon key, Cloudflare token, Brevo key, per-project cron bearers)
  live in Cloudflare's secret store, never in this repo.

## Useful commands (from this folder)

\`\`\`bash
npx wrangler tail          # live logs
npx wrangler deploy        # redeploy after a manual edit of jobs.js
npx wrangler secret list   # which secrets are configured
\`\`\`

This folder was generated by the Hypervibe plugin. Manage it through the
skills rather than by hand whenever possible.
`,
  );

  ensureGitRepo(DIR);
  gitCommitAll(DIR, "feat: scaffold the hypervibe-jobs unified shared worker");
}

// ── Deployment probes ─────────────────────────────────────────────────────

async function isDeployed(token) {
  try {
    const accountId = flags["account-id"] || (await getCfAccountId(token));
    if (!accountId) return false;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${WORKER_NAME}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function computeWorkerUrl(token) {
  try {
    const accountId = flags["account-id"] || (await getCfAccountId(token));
    if (!accountId) return null;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const sub = data.result?.subdomain;
    return sub ? `https://${WORKER_NAME}.${sub}.workers.dev` : null;
  } catch {
    return null;
  }
}
