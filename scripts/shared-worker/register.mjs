#!/usr/bin/env node
// register.mjs - Add, update, remove and list the jobs of the Hypervibe
// unified shared worker ("hypervibe-jobs"). Single entry point used by the
// consumer skills (/add-cron, /add-backup-db, /quotas, /delete-project).
//
// Every mutation: updates jobs.js (the versioned registry), commits it to the
// local git repo, redeploys the worker (unless --no-deploy), and verifies
// which required secrets are present (uploading them itself with
// --put-secrets when the values are available).
//
// Modes:
//
//   --list
//       Print the registry.
//
//   --remove --name <jobName>
//       Remove any job by name.
//
//   --kind ping --task-name <kebab> --cron "<5-field UTC>" --app-url <https://...>
//          --project-name <kebab> [--web-dir <path>]
//       Register a scheduled HTTP ping to <app-url>/api/cron/<task-name>.
//       With --web-dir, also scaffolds the protected Next.js route file.
//       Required secret: CRON_SECRET_<PROJECT> (value read from the
//       CRON_SECRET_VALUE env var when --put-secrets is passed).
//
//   --kind snapshot --target-name <kebab> --neon-project-id <id> [--cron "<expr>"]
//       Add a Neon project to the shared backup job (singleton "neon-backups",
//       default cadence: 1st and 15th at 03:00 UTC).
//   --kind snapshot --remove-target <kebab>
//       Remove a target (used by /delete-project).
//       Required secret: NEON_API_KEY (auto-uploaded with --put-secrets).
//
//   --kind quota --recipient <email> --sender-email <email>
//          [--sender-name <name>] [--r2-threshold-gb <N>] [--cron "<expr>"]
//       Configure the quota watch job (singleton "quota-monitor", default
//       cadence: daily at 06:00 UTC).
//       Required secrets: CLOUDFLARE_API_TOKEN, BREVO_API_KEY (auto-uploaded
//       with --put-secrets).
//
// Common flags: --dir <path> (default ~/.hypervibe-jobs), --no-deploy,
//               --no-commit, --put-secrets
//
// Output: single JSON line on stdout; logs on stderr.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readUserEnv } from "../_read-user-env.mjs";
import {
  DIR_DEFAULT,
  parseFlags,
  out,
  fail,
  log,
  isKebab,
  slugUpper,
  stripTrail,
  fiveFieldCron,
  readRegistry,
  writeRegistry,
  upsertJob,
  gitCommitAll,
  wranglerDeploy,
  listWranglerSecrets,
  putWranglerSecret,
  getCfAccountId,
} from "./_lib.mjs";

const SNAPSHOT_JOB_NAME = "neon-backups";
const SNAPSHOT_DEFAULT_CRON = "0 3 1,15 * *";
const QUOTA_JOB_NAME = "quota-monitor";
const QUOTA_DEFAULT_CRON = "0 6 * * *";

const { flags } = parseFlags(process.argv.slice(2));
const DIR = flags.dir || DIR_DEFAULT;

main().catch((e) => fail(e?.message || String(e)));

async function main() {
  if (!existsSync(join(DIR, "jobs.js"))) {
    fail(`Shared worker not provisioned at ${DIR}.`, {
      howTo: "Run ensure.mjs first (the consumer skills do it as a preflight).",
    });
  }

  if (flags.list) return doList();
  if (flags.remove && flags.name) return finalize(doRemove(flags.name), []);

  switch (flags.kind) {
    case "ping":
      return doPing();
    case "snapshot":
      return doSnapshot();
    case "quota":
      return doQuota();
    default:
      fail("Specify --list, --remove --name <job>, or --kind ping|snapshot|quota.");
  }
}

// ── modes ────────────────────────────────────────────────────────────────

function doList() {
  const registry = readRegistry(DIR);
  out({ ok: true, dir: DIR, version: registry.version, jobs: registry.jobs });
}

function doRemove(name) {
  const registry = readRegistry(DIR);
  const before = registry.jobs.length;
  registry.jobs = registry.jobs.filter((j) => j.name !== name);
  if (registry.jobs.length === before) {
    fail(`No job named "${name}" in the registry.`);
  }
  writeRegistry(DIR, registry);
  return { action: "removed", job: name, commitMsg: `jobs: remove ${name}` };
}

async function doPing() {
  for (const k of ["task-name", "cron", "app-url", "project-name"]) {
    if (!flags[k]) fail(`--${k} is required for --kind ping.`);
  }
  if (!isKebab(flags["task-name"])) fail(`--task-name must be kebab-case. Got: ${flags["task-name"]}`);
  if (!isKebab(flags["project-name"])) fail(`--project-name must be kebab-case. Got: ${flags["project-name"]}`);
  if (!fiveFieldCron(flags.cron)) fail(`--cron must be a 5-field UTC cron expression. Got: "${flags.cron}"`);

  const secretName = `CRON_SECRET_${slugUpper(flags["project-name"])}`;
  const job = {
    kind: "ping",
    name: flags["task-name"],
    project: flags["project-name"],
    cron: flags.cron,
    url: `${stripTrail(flags["app-url"])}/api/cron/${flags["task-name"]}`,
    secretName,
  };

  // Optional: scaffold the protected Next.js route in the project.
  let routePath = null;
  let routeCreated = false;
  if (flags["web-dir"]) {
    const routeDir = join(flags["web-dir"], "src/app/api/cron", flags["task-name"]);
    routePath = join(routeDir, "route.ts");
    if (!existsSync(routePath)) {
      mkdirSync(routeDir, { recursive: true });
      writeFileSync(routePath, renderRoute(flags["task-name"]));
      routeCreated = true;
    }
  }

  const registry = readRegistry(DIR);
  const action = upsertJob(registry, job);
  writeRegistry(DIR, registry);

  const secretPlan = [{
    name: secretName,
    valueEnvVar: "CRON_SECRET_VALUE",
    value: process.env.CRON_SECRET_VALUE || null,
  }];

  return finalize(
    {
      action,
      job: job.name,
      commitMsg: `jobs: ${action === "added" ? "add" : "update"} ping ${job.project}/${job.name} (${job.cron})`,
      routePath,
      routeCreated,
    },
    secretPlan,
  );
}

async function doSnapshot() {
  const registry = readRegistry(DIR);
  const existing = registry.jobs.find((j) => j.name === SNAPSHOT_JOB_NAME);
  const job = existing || {
    kind: "snapshot",
    name: SNAPSHOT_JOB_NAME,
    cron: SNAPSHOT_DEFAULT_CRON,
    targets: [],
  };
  if (flags.cron) {
    if (!fiveFieldCron(flags.cron)) fail(`--cron must be a 5-field UTC cron expression. Got: "${flags.cron}"`);
    job.cron = flags.cron;
  }

  let action;
  let detail;
  if (flags["remove-target"]) {
    const before = job.targets.length;
    job.targets = job.targets.filter((t) => t.name !== flags["remove-target"]);
    if (job.targets.length === before) {
      fail(`No snapshot target named "${flags["remove-target"]}".`);
    }
    action = "target-removed";
    detail = flags["remove-target"];
  } else {
    for (const k of ["target-name", "neon-project-id"]) {
      if (!flags[k]) fail(`--${k} is required for --kind snapshot (or use --remove-target).`);
    }
    if (!isKebab(flags["target-name"])) fail(`--target-name must be kebab-case. Got: ${flags["target-name"]}`);
    const target = { name: flags["target-name"], projectId: flags["neon-project-id"] };
    const idx = job.targets.findIndex((t) => t.name === target.name);
    if (idx !== -1) {
      job.targets[idx] = target;
      action = "target-updated";
    } else {
      job.targets.push(target);
      action = "target-added";
    }
    detail = target.name;
  }

  upsertJob(registry, job);
  writeRegistry(DIR, registry);

  return finalize(
    {
      action,
      job: SNAPSHOT_JOB_NAME,
      target: detail,
      targetCount: job.targets.length,
      commitMsg: `jobs: snapshot ${action} ${detail}`,
    },
    [{ name: "NEON_API_KEY", value: flags["put-secrets"] ? readUserEnv("NEON_API_KEY") : null }],
  );
}

async function doQuota() {
  for (const k of ["recipient", "sender-email"]) {
    if (!flags[k]) fail(`--${k} is required for --kind quota.`);
  }
  const cron = flags.cron || QUOTA_DEFAULT_CRON;
  if (!fiveFieldCron(cron)) fail(`--cron must be a 5-field UTC cron expression. Got: "${cron}"`);

  const token = readUserEnv("CLOUDFLARE_API_TOKEN");
  const accountId = flags["account-id"] || (token ? await getCfAccountId(token) : null);
  if (!accountId) {
    fail("Cannot determine the Cloudflare account id for the quota job.", {
      howTo: "Pass --account-id <id> or make sure the Cloudflare token is readable.",
    });
  }

  const job = {
    kind: "quota",
    name: QUOTA_JOB_NAME,
    cron,
    config: {
      cloudflareAccountId: accountId,
      recipient: flags.recipient,
      senderEmail: flags["sender-email"],
      senderName: flags["sender-name"] || "Hypervibe",
      r2ThresholdGb: Number(flags["r2-threshold-gb"] || 9),
    },
  };

  const registry = readRegistry(DIR);
  const action = upsertJob(registry, job);
  writeRegistry(DIR, registry);

  return finalize(
    {
      action,
      job: QUOTA_JOB_NAME,
      commitMsg: `jobs: ${action === "added" ? "configure" : "update"} quota monitor`,
    },
    [
      { name: "CLOUDFLARE_API_TOKEN", value: flags["put-secrets"] ? token : null },
      { name: "BREVO_API_KEY", value: flags["put-secrets"] ? readUserEnv("BREVO_API_KEY") : null },
    ],
  );
}

// ── shared tail: commit, deploy, secrets, output ─────────────────────────

async function finalize(result, secretPlan) {
  if (!flags["no-commit"]) {
    gitCommitAll(DIR, result.commitMsg || "jobs: update registry");
  }

  const token = readUserEnv("CLOUDFLARE_API_TOKEN");
  let workerUrl = null;
  let deployedNow = false;

  // Upload secrets BEFORE deploying so the new deploy sees them immediately.
  const missingSecrets = [];
  const uploadedSecrets = [];
  const nextSteps = [];
  if (secretPlan.length && token && !flags["no-deploy"]) {
    const current = listWranglerSecrets(DIR, token);
    for (const s of secretPlan) {
      const present = current.ok && current.names.includes(s.name);
      if (present) continue;
      if (flags["put-secrets"] && s.value) {
        const put = putWranglerSecret(DIR, token, s.name, s.value);
        if (put.ok) {
          uploadedSecrets.push(s.name);
        } else {
          missingSecrets.push(s.name);
          nextSteps.push(`Secret upload failed for ${s.name}: ${put.reason}`);
        }
      } else {
        missingSecrets.push(s.name);
        const src = s.valueEnvVar
          ? `${s.valueEnvVar}=<value> node register.mjs ... --put-secrets`
          : `re-run with --put-secrets (value read from the vault)`;
        nextSteps.push(`Upload the ${s.name} secret: cd "${DIR}" && printf '%s' "<value>" | npx wrangler secret put ${s.name}  (or: ${src})`);
      }
    }
  } else if (secretPlan.length && !token) {
    nextSteps.push("Cloudflare token unavailable: secret presence not verified.");
  }

  if (!flags["no-deploy"]) {
    if (!token) {
      fail("CLOUDFLARE_API_TOKEN not found: cannot deploy the updated registry.", {
        howTo: "Unlock the vault, or pass --no-deploy to only update the registry.",
      });
    }
    const dep = wranglerDeploy(DIR, token);
    if (!dep.ok) fail(dep.reason);
    workerUrl = dep.url;
    deployedNow = true;
  }

  out({
    ok: true,
    ...result,
    dir: DIR,
    deployed: deployedNow,
    workerUrl,
    uploadedSecrets,
    missingSecrets,
    nextSteps,
  });
}

// ── Next.js route template (protected by CRON_SECRET) ───────────────────

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
