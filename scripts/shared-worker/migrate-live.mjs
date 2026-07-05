#!/usr/bin/env node
// migrate-live.mjs - One-shot migration of the legacy standalone shared
// workers (db-backup, quota-monitor) into the unified hypervibe-jobs worker.
//
// READS the legacy configs (never modifies or deletes them):
//   ~/.db-backup-worker/wrangler.toml      -> BACKUP_TARGETS + cron
//   ~/.quota-monitor-worker/wrangler.toml  -> quota vars + cron
//   ~/.cron-dispatcher/wrangler.toml       -> TASKS (scheduled pings)
// then registers the equivalent "snapshot", "quota" and "ping" jobs in the
// unified registry, commits, uploads the required secrets (--put-secrets) and
// redeploys the unified worker.
//
// NOTE on ping secrets: the legacy dispatcher held one CRON_SECRET_<PROJECT>
// secret per project. Secret VALUES cannot be read back from Cloudflare, so
// they are reported in `pingSecretsToReupload`: each value lives in the
// matching project's .env (CRON_SECRET) and must be re-uploaded to the
// unified worker (`cd ~/.hypervibe-jobs && printf '%s' "<value>" | npx
// wrangler secret put CRON_SECRET_<PROJECT>`). Until then, those pings log
// "missing secret" and are skipped (no crash, no false ping).
//
// DECOMMISSION OF THE OLD WORKERS IS NOT DONE HERE. The output lists the
// exact commands; run them only after verifying the unified worker works
// (manual /trigger + wrangler tail).
//
// Flags:
//   --dir <path>            unified repo (default ~/.hypervibe-jobs)
//   --db-backup-dir <path>  default ~/.db-backup-worker
//   --quota-dir <path>      default ~/.quota-monitor-worker
//   --dispatcher-dir <path> default ~/.cron-dispatcher
//   --put-secrets           upload NEON_API_KEY / CLOUDFLARE_API_TOKEN /
//                           BREVO_API_KEY read from the vault
//   --no-deploy             registry-only (for dry runs)
//
// Output: single JSON line on stdout; logs on stderr.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readUserEnv } from "../_read-user-env.mjs";
import {
  DIR_DEFAULT,
  parseFlags,
  out,
  fail,
  log,
  readRegistry,
  writeRegistry,
  upsertJob,
  gitCommitAll,
  wranglerDeploy,
  listWranglerSecrets,
  putWranglerSecret,
} from "./_lib.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const DIR = flags.dir || DIR_DEFAULT;
const DB_BACKUP_DIR = flags["db-backup-dir"] || join(homedir(), ".db-backup-worker");
const QUOTA_DIR = flags["quota-dir"] || join(homedir(), ".quota-monitor-worker");
const DISPATCHER_DIR = flags["dispatcher-dir"] || join(homedir(), ".cron-dispatcher");

main().catch((e) => fail(e?.message || String(e)));

async function main() {
  if (!existsSync(join(DIR, "jobs.js"))) {
    fail(`Unified worker not provisioned at ${DIR}. Run ensure.mjs first.`);
  }

  const registry = readRegistry(DIR);
  const migrated = [];
  const skipped = [];
  const secretPlan = [];

  // ── Legacy db-backup -> snapshot job ────────────────────────────────────
  const dbToml = join(DB_BACKUP_DIR, "wrangler.toml");
  if (existsSync(dbToml)) {
    const toml = readFileSync(dbToml, "utf8");
    const targets = parseSingleQuotedJsonVar(toml, "BACKUP_TARGETS");
    const cron = parseFirstCron(toml) || "0 3 1,15 * *";
    if (!Array.isArray(targets) || !targets.length) {
      skipped.push({ legacy: "db-backup", reason: "no BACKUP_TARGETS found in wrangler.toml" });
    } else {
      upsertJob(registry, {
        kind: "snapshot",
        name: "neon-backups",
        cron,
        targets: targets.map((t) => ({ name: t.name, projectId: t.projectId })),
      });
      migrated.push({ legacy: "db-backup", job: "neon-backups", cron, targets: targets.length });
      secretPlan.push({ name: "NEON_API_KEY", value: readUserEnv("NEON_API_KEY") });
    }
  } else {
    skipped.push({ legacy: "db-backup", reason: `${dbToml} not found` });
  }

  // ── Legacy quota-monitor -> quota job ───────────────────────────────────
  const qToml = join(QUOTA_DIR, "wrangler.toml");
  if (existsSync(qToml)) {
    const toml = readFileSync(qToml, "utf8");
    const v = (name) => toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"))?.[1] || null;
    const cron = parseFirstCron(toml) || "0 6 * * *";
    const accountId = v("CLOUDFLARE_ACCOUNT_ID");
    const recipient = v("ALERT_RECIPIENT");
    const senderEmail = v("BREVO_SENDER_EMAIL");
    if (!accountId || !recipient || !senderEmail) {
      skipped.push({ legacy: "quota-monitor", reason: "incomplete vars in wrangler.toml" });
    } else {
      upsertJob(registry, {
        kind: "quota",
        name: "quota-monitor",
        cron,
        config: {
          cloudflareAccountId: accountId,
          recipient,
          senderEmail,
          senderName: v("BREVO_SENDER_NAME") || "Hypervibe",
          r2ThresholdGb: Number(v("R2_THRESHOLD_GB") || 9),
        },
      });
      migrated.push({ legacy: "quota-monitor", job: "quota-monitor", cron });
      secretPlan.push({ name: "CLOUDFLARE_API_TOKEN", value: readUserEnv("CLOUDFLARE_API_TOKEN") });
      secretPlan.push({ name: "BREVO_API_KEY", value: readUserEnv("BREVO_API_KEY") });
    }
  } else {
    skipped.push({ legacy: "quota-monitor", reason: `${qToml} not found` });
  }

  // ── Legacy cron-dispatcher -> ping jobs ─────────────────────────────────
  const pingSecretsToReupload = [];
  const dispToml = join(DISPATCHER_DIR, "wrangler.toml");
  if (existsSync(dispToml)) {
    const toml = readFileSync(dispToml, "utf8");
    const tasks = parseSingleQuotedJsonVar(toml, "TASKS");
    if (!Array.isArray(tasks) || !tasks.length) {
      skipped.push({ legacy: "cron-dispatcher", reason: "no TASKS found in wrangler.toml" });
    } else {
      let count = 0;
      for (const t of tasks) {
        if (!t?.name || !t?.cron || !t?.url || !t?.secretName) {
          skipped.push({ legacy: "cron-dispatcher", reason: `task entry incomplete: ${JSON.stringify(t).slice(0, 120)}` });
          continue;
        }
        upsertJob(registry, {
          kind: "ping",
          name: t.name,
          project: t.project || "unknown",
          cron: t.cron,
          url: t.url,
          secretName: t.secretName,
        });
        if (!pingSecretsToReupload.includes(t.secretName)) pingSecretsToReupload.push(t.secretName);
        count++;
      }
      if (count > 0) {
        migrated.push({ legacy: "cron-dispatcher", job: "ping x" + count, tasks: count });
      }
    }
  } else {
    skipped.push({ legacy: "cron-dispatcher", reason: `${dispToml} not found` });
  }

  if (!migrated.length) {
    fail("Nothing to migrate.", { skipped });
  }

  writeRegistry(DIR, registry);
  gitCommitAll(DIR, `jobs: migrate legacy workers (${migrated.map((m) => m.legacy).join(", ")})`);

  // ── Secrets + deploy ────────────────────────────────────────────────────
  const token = readUserEnv("CLOUDFLARE_API_TOKEN");
  const uploadedSecrets = [];
  const missingSecrets = [];
  if (token && !flags["no-deploy"]) {
    const current = listWranglerSecrets(DIR, token);
    for (const s of secretPlan) {
      const present = current.ok && current.names.includes(s.name);
      if (present) continue;
      if (flags["put-secrets"] && s.value) {
        const put = putWranglerSecret(DIR, token, s.name, s.value);
        if (put.ok) uploadedSecrets.push(s.name);
        else missingSecrets.push(s.name);
      } else {
        missingSecrets.push(s.name);
      }
    }
  }

  let workerUrl = null;
  if (!flags["no-deploy"]) {
    if (!token) fail("CLOUDFLARE_API_TOKEN not found: cannot deploy.");
    const dep = wranglerDeploy(DIR, token);
    if (!dep.ok) fail(dep.reason);
    workerUrl = dep.url;
  }

  const decommission = [];
  if (existsSync(dbToml)) decommission.push(`cd "${DB_BACKUP_DIR}" && npx wrangler delete   # frees 1 cron slot`);
  if (existsSync(join(QUOTA_DIR, "wrangler.toml"))) decommission.push(`cd "${QUOTA_DIR}" && npx wrangler delete       # frees 1 cron slot`);
  if (existsSync(dispToml)) decommission.push(`cd "${DISPATCHER_DIR}" && npx wrangler delete  # frees 1 cron slot`);
  decommission.push(`# then archive or remove the legacy folders`);

  out({
    ok: true,
    migrated,
    skipped,
    uploadedSecrets,
    missingSecrets,
    pingSecretsToReupload,
    pingSecretsNote: pingSecretsToReupload.length
      ? "Secret values cannot be read back from Cloudflare. For each name listed, find the matching project's CRON_SECRET in its .env and upload it to the unified worker: cd ~/.hypervibe-jobs && printf '%s' \"<value>\" | npx wrangler secret put <NAME>. Until then those pings are skipped with a 'missing secret' log (harmless)."
      : undefined,
    workerUrl,
    verification: [
      `ADMIN=$(node ../_read-user-env.mjs HYPERVIBE_JOBS_ADMIN_TOKEN)  # from the plugin scripts dir`,
      `curl -s -X POST -H "Authorization: Bearer $ADMIN" "<workerUrl>/trigger?name=neon-backups"   # forces a snapshot run`,
      `curl -s -X POST -H "Authorization: Bearer $ADMIN" "<workerUrl>/trigger?name=quota-monitor"  # forces a quota check`,
      `cd "${DIR}" && npx wrangler tail   # watch the runs live`,
    ],
    decommission_after_verification: decommission,
  });
}

// ── toml parsing helpers ──────────────────────────────────────────────────

function parseSingleQuotedJsonVar(toml, name) {
  const m = toml.match(new RegExp(`^${name}\\s*=\\s*'([\\s\\S]*?)'\\s*$`, "m"));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    log(`WARN: ${name} is not valid JSON: ${err.message}`);
    return null;
  }
}

function parseFirstCron(toml) {
  const m = toml.match(/crons\s*=\s*\[\s*"([^"]+)"/);
  return m ? m[1] : null;
}
