#!/usr/bin/env node
// ensure-quota-monitor-worker.mjs - Idempotent.
//
// Ensures the Cloudflare Worker `quota-monitor` is deployed on the user's CF
// account. The worker runs daily and emails (via Brevo) when any monitored
// quota crosses its threshold. Currently watches R2 storage (default: 9 GB
// out of the 10 GB free tier).
//
// Architecture: one shared Worker per CF account, mutualized across all the
// user's projects. Lives in `~/.quota-monitor-worker/`.
//
// Required for setup:
//   - `wrangler` CLI authenticated (configured by `/start`)
//   - CLOUDFLARE_API_TOKEN in env (with at least Workers:Edit + Account
//     Analytics:Read + Account Settings:Read scopes - the standard Hypervibe
//     token has more than enough)
//   - BREVO_API_KEY in env (configured by `/start`)
//   - A verified Brevo sender (created during `/start` Brevo setup, or via
//     https://app.brevo.com/senders)
//
// Output (stdout, single JSON line):
//   { status: "created"          , workerName, recipient, sender, threshold_gb }
//   { status: "already_present"  , workerName, recipient, sender, threshold_gb }
//   { status: "needs_brevo_sender", reason, howTo }
//   { status: "needs_prereq"     , reason, howTo }   // wrangler / tokens
//   { status: "error"            , reason, details? }
//
// Exit code: always 0 (status field carries the result).
//
// Flags (all optional - falls back to discovery / defaults):
//   --recipient=<email>     destination email (defaults to CF account email)
//   --sender=<email>        verified Brevo sender (defaults to first verified one)
//   --sender-name=<string>  display name (defaults to "Hypervibe")
//   --threshold-gb=<N>      R2 storage threshold in GB (defaults to 9)
//   --force-redeploy        even if already deployed, redeploy fresh

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readUserEnv } from "./_read-user-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKER_NAME = "quota-monitor";
const WORKER_DIR = join(homedir(), ".quota-monitor-worker");
const WORKER_SOURCE = join(__dirname, "quota-monitor-worker.js");
const DEFAULT_THRESHOLD_GB = 9;
const DEFAULT_SENDER_NAME = "Hypervibe";
const CRON = "0 6 * * *"; // every day at 06:00 UTC

// ── CLI args ───────────────────────────────────────────────────────────
const flags = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else flags[a.slice(2)] = true;
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

// ── HTTP helper ───────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, ok: r.ok, json };
}

// ── Wrangler check ────────────────────────────────────────────────────
function checkWrangler() {
  const v = spawnSync("wrangler", ["--version"], { encoding: "utf8", shell: true });
  if (v.status !== 0) return { ok: false, reason: "wrangler is not installed" };
  const whoami = spawnSync("wrangler", ["whoami"], { encoding: "utf8", shell: true });
  if (whoami.status !== 0 || /not authenticated/i.test(whoami.stdout + whoami.stderr)) {
    return { ok: false, reason: "wrangler is not authenticated" };
  }
  // Extract account ID from whoami output
  // Format varies; look for any 32-hex string
  const m = (whoami.stdout || "").match(/[0-9a-f]{32}/);
  return { ok: true, accountId: m ? m[0] : null };
}

// ── Resolve CF account ID / email ─────────────────────────────────────
async function getCfAccountInfo(token) {
  const acc = await api("https://api.cloudflare.com/client/v4/accounts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!acc.ok) return { ok: false, reason: `CF accounts API: HTTP ${acc.status}` };

  const accountId = acc.json.result?.[0]?.id;
  if (!accountId) return { ok: false, reason: "No accessible CF account" };

  const user = await api("https://api.cloudflare.com/client/v4/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const email = user.ok ? user.json.result?.email : null;

  return { ok: true, accountId, email };
}

// ── Brevo: discover a verified sender ─────────────────────────────────
async function getBrevoSender(brevoKey, requestedEmail) {
  const r = await api("https://api.brevo.com/v3/senders", {
    headers: { "api-key": brevoKey },
  });
  if (!r.ok) return { ok: false, reason: `Brevo senders API: HTTP ${r.status}` };

  const senders = r.json.senders || [];
  if (senders.length === 0) {
    return {
      ok: false,
      reason: "no_sender",
      howTo: "Create a verified sender in Brevo: https://app.brevo.com/senders (add your email, click the verification link you receive).",
    };
  }

  // If user requested a specific sender, find it
  if (requestedEmail) {
    const match = senders.find((s) => s.email.toLowerCase() === requestedEmail.toLowerCase() && s.active);
    if (match) return { ok: true, email: match.email, name: match.name || DEFAULT_SENDER_NAME };
    return {
      ok: false,
      reason: "requested_sender_not_verified",
      howTo: `The sender ${requestedEmail} is not verified in Brevo. Verify it at https://app.brevo.com/senders or pick another one among the verified ones.`,
    };
  }

  // Pick the first active one
  const active = senders.find((s) => s.active);
  if (!active) {
    return {
      ok: false,
      reason: "no_active_sender",
      howTo: "You have Brevo senders but none is verified. Click the verification link received at the sender's address, then try again.",
    };
  }
  return { ok: true, email: active.email, name: active.name || DEFAULT_SENDER_NAME };
}

// ── Deploy ────────────────────────────────────────────────────────────
function runInWorkerDir(cmd) {
  return spawnSync(cmd, { cwd: WORKER_DIR, encoding: "utf8", shell: true });
}

function writeWranglerToml(config) {
  // Escape any double-quotes in string values
  const esc = (s) => String(s).replace(/"/g, '\\"');
  const toml = `name = "${WORKER_NAME}"
main = "index.js"
compatibility_date = "2024-09-01"
account_id = "${esc(config.accountId)}"

[triggers]
crons = ["${esc(CRON)}"]

[vars]
CLOUDFLARE_ACCOUNT_ID = "${esc(config.accountId)}"
BREVO_SENDER_EMAIL = "${esc(config.senderEmail)}"
BREVO_SENDER_NAME = "${esc(config.senderName)}"
ALERT_RECIPIENT = "${esc(config.recipient)}"
R2_THRESHOLD_GB = "${esc(config.thresholdGB)}"
`;
  writeFileSync(join(WORKER_DIR, "wrangler.toml"), toml);
}

function deployWorker() {
  const r = runInWorkerDir("wrangler deploy");
  if (r.status !== 0) {
    return { ok: false, reason: `wrangler deploy: ${(r.stderr || r.stdout || "").slice(0, 400)}` };
  }
  return { ok: true };
}

function putSecret(name, value) {
  // `wrangler secret put NAME` reads value from stdin
  const r = spawnSync("wrangler", ["secret", "put", name], {
    cwd: WORKER_DIR,
    input: value,
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) {
    return { ok: false, reason: `wrangler secret put ${name}: ${(r.stderr || r.stdout || "").slice(0, 300)}` };
  }
  return { ok: true };
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  // Prereqs: wrangler + tokens
  const cfToken = readUserEnv("CLOUDFLARE_API_TOKEN");
  const brevoKey = readUserEnv("BREVO_API_KEY");
  if (!cfToken) return out({ status: "needs_prereq", reason: "CLOUDFLARE_API_TOKEN missing", howTo: "Run `/start` to configure Cloudflare." });
  if (!brevoKey) return out({ status: "needs_prereq", reason: "BREVO_API_KEY missing", howTo: "Run `/start` to configure Brevo." });

  const wr = checkWrangler();
  if (!wr.ok) return out({ status: "needs_prereq", reason: wr.reason, howTo: "Run `/start` to install and authenticate Wrangler." });

  // Idempotence: skip if already deployed (unless --force-redeploy)
  const alreadyDeployed = existsSync(join(WORKER_DIR, "wrangler.toml"));
  if (alreadyDeployed && !flags["force-redeploy"]) {
    // Read existing config to report back
    let recipient = null, sender = null, threshold = null;
    try {
      const toml = readFileSync(join(WORKER_DIR, "wrangler.toml"), "utf8");
      recipient = toml.match(/ALERT_RECIPIENT\s*=\s*"([^"]+)"/)?.[1] || null;
      sender = toml.match(/BREVO_SENDER_EMAIL\s*=\s*"([^"]+)"/)?.[1] || null;
      threshold = toml.match(/R2_THRESHOLD_GB\s*=\s*"([^"]+)"/)?.[1] || null;
    } catch { /* ignore */ }
    return out({
      status: "already_present",
      workerName: WORKER_NAME,
      recipient,
      sender,
      threshold_gb: threshold,
      workerDir: WORKER_DIR,
    });
  }

  // Discover CF account info
  const cf = await getCfAccountInfo(cfToken);
  if (!cf.ok) return out({ status: "error", reason: cf.reason });

  // Resolve recipient
  const recipient = flags.recipient || cf.email;
  if (!recipient) {
    return out({ status: "error", reason: "Unable to determine the recipient - pass --recipient=<email>" });
  }

  // Discover/validate Brevo sender
  const senderInfo = await getBrevoSender(brevoKey, flags.sender || null);
  if (!senderInfo.ok) {
    return out({
      status: "needs_brevo_sender",
      reason: senderInfo.reason === "no_sender"
        ? "No verified sender in Brevo"
        : senderInfo.reason === "requested_sender_not_verified"
          ? `The sender ${flags.sender} is not verified`
          : "No active Brevo sender",
      howTo: senderInfo.howTo,
    });
  }

  const senderName = flags["sender-name"] || senderInfo.name || DEFAULT_SENDER_NAME;
  const thresholdGB = flags["threshold-gb"] || String(DEFAULT_THRESHOLD_GB);

  // Scaffold worker dir
  if (!existsSync(WORKER_DIR)) mkdirSync(WORKER_DIR, { recursive: true });
  copyFileSync(WORKER_SOURCE, join(WORKER_DIR, "index.js"));
  writeWranglerToml({
    accountId: cf.accountId,
    senderEmail: senderInfo.email,
    senderName,
    recipient,
    thresholdGB,
  });

  // Deploy
  const dep = deployWorker();
  if (!dep.ok) return out({ status: "error", reason: dep.reason });

  // Upload secrets
  const s1 = putSecret("CLOUDFLARE_API_TOKEN", cfToken);
  if (!s1.ok) return out({ status: "error", reason: s1.reason });
  const s2 = putSecret("BREVO_API_KEY", brevoKey);
  if (!s2.ok) return out({ status: "error", reason: s2.reason });

  return out({
    status: "created",
    workerName: WORKER_NAME,
    recipient,
    sender: senderInfo.email,
    threshold_gb: thresholdGB,
    workerDir: WORKER_DIR,
    cron: CRON,
  });
}

main().catch((e) => {
  process.stderr.write(JSON.stringify({ status: "error", reason: e.message?.slice(0, 250) }) + "\n");
  process.exit(1);
});
