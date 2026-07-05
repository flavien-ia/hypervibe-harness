// worker.js - Hypervibe unified shared Cloudflare Worker ("hypervibe-jobs").
//
// ONE worker, ONE cron slot, THREE roles, mutualized across every project of
// the account. Ticks every minute and runs whichever registered jobs are due:
//
//   kind "ping"     - POST a project's /api/cron/<task> endpoint at its cron
//                     time, authenticated with the project's bearer secret.
//                     (Replaces the old standalone "cron-dispatcher" worker.)
//   kind "snapshot" - Neon database backup branches with rolling + aging
//                     retention. (Replaces the old "db-backup" worker.)
//   kind "quota"    - free-tier quota watch (currently Cloudflare R2 storage)
//                     with a Brevo alert email. (Replaces "quota-monitor".)
//
// Registry: ./jobs.js (versioned in the same git repo, managed by the
// Hypervibe skills through scripts/shared-worker/register.mjs).
//
// Job shapes (all crons are 5-field UTC):
//   { "kind": "ping",     "name": "weekly-report", "project": "myapp",
//     "cron": "0 8 * * 1", "url": "https://myapp.vercel.app/api/cron/weekly-report",
//     "secretName": "CRON_SECRET_MYAPP" }
//   { "kind": "snapshot", "name": "neon-backups", "cron": "0 3 1,15 * *",
//     "targets": [{ "name": "myapp", "projectId": "abc-123" }] }
//   { "kind": "quota",    "name": "quota-monitor", "cron": "0 6 * * *",
//     "config": { "cloudflareAccountId": "...", "recipient": "you@x.fr",
//                 "senderEmail": "you@x.fr", "senderName": "Hypervibe",
//                 "r2ThresholdGb": 9 } }
//   Any job may carry "enabled": false to pause it without deleting it.
//
// Secrets (uploaded via `wrangler secret put`, never in git):
//   ADMIN_TOKEN            - bearer for the manual /trigger and /status endpoints
//   NEON_API_KEY           - for "snapshot" jobs
//   CLOUDFLARE_API_TOKEN   - for "quota" jobs (Account Analytics: Read)
//   BREVO_API_KEY          - for "quota" jobs (alert email)
//   CRON_SECRET_<PROJECT>  - one per project, for its "ping" jobs
//
// Failure isolation: every due job runs in its own promise with its own catch;
// one failing job never prevents the others from running.

import registry from "./jobs.js";

const NEON = "https://console.neon.tech/api/v2";
const R2_FREE_TIER_GB = 10;

export default {
  async scheduled(controller, env, ctx) {
    // Use the SCHEDULED time, not the actual execution time: if Cloudflare
    // fires the tick a few seconds (or a minute) late, cron matching must
    // still evaluate against the minute the tick was meant for.
    const when = new Date(controller?.scheduledTime ?? Date.now());
    const jobs = listJobs();
    if (!jobs.length) {
      console.log("No jobs registered - idle tick.");
      return;
    }

    const due = jobs.filter((j) => j.enabled !== false && safeCronMatch(j, when));
    if (!due.length) return;

    console.log(`Tick ${when.toISOString()}: ${due.length} job(s) due: ${due.map((j) => j.name).join(", ")}`);
    for (const job of due) {
      ctx.waitUntil(
        runJob(job, env).catch((err) =>
          console.error(`[${job.name}] FAILED: ${err?.message || err}`),
        ),
      );
    }
  },

  // Manual control plane (protected by the ADMIN_TOKEN secret):
  //   GET  /            - unauthenticated health ping
  //   GET  /status      - registry + next due time per job
  //   POST /trigger?name=<job> - run one job immediately
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === "/" && req.method === "GET") {
      return new Response("hypervibe-jobs worker - see `wrangler tail` for logs.", { status: 200 });
    }

    if (!env.ADMIN_TOKEN) {
      return json({ error: "ADMIN_TOKEN secret not configured" }, 503);
    }
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (url.pathname === "/status" && req.method === "GET") {
      const now = new Date();
      const jobs = listJobs().map((j) => ({
        name: j.name,
        kind: j.kind,
        cron: j.cron,
        enabled: j.enabled !== false,
        targets: j.kind === "snapshot" ? (j.targets || []).map((t) => t.name) : undefined,
        project: j.project,
        nextDue: j.enabled !== false ? computeNextDue(j.cron, now) : null,
      }));
      return json({ worker: "hypervibe-jobs", registryVersion: registry.version, jobs });
    }

    if (url.pathname === "/trigger" && req.method === "POST") {
      const name = url.searchParams.get("name");
      if (!name) return json({ error: "Missing ?name=<job>" }, 400);
      const job = listJobs().find((j) => j.name === name);
      if (!job) return json({ error: `Unknown job "${name}"` }, 404);
      ctx.waitUntil(
        runJob(job, env).catch((err) =>
          console.error(`[${job.name}] MANUAL RUN FAILED: ${err?.message || err}`),
        ),
      );
      return json({ triggered: name, note: "See `wrangler tail` for the run logs." }, 202);
    }

    return json({ error: "Not found" }, 404);
  },
};

// ── Registry access ──────────────────────────────────────────────────────

function listJobs() {
  const jobs = registry?.jobs;
  return Array.isArray(jobs) ? jobs : [];
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Job dispatch ─────────────────────────────────────────────────────────

export async function runJob(job, env) {
  switch (job.kind) {
    case "ping":
      return runPingJob(job, env);
    case "snapshot":
      return runSnapshotJob(job, env);
    case "quota":
      return runQuotaJob(job, env);
    default:
      console.error(`[${job.name}] unknown job kind "${job.kind}" - skipping.`);
  }
}

// ── kind: ping (ex cron-dispatcher) ──────────────────────────────────────

export async function runPingJob(job, env) {
  const secret = job.secretName ? env[job.secretName] : null;
  if (!secret) {
    console.error(`[${job.name}] missing secret "${job.secretName}" - skipping.`);
    return;
  }

  const started = Date.now();
  try {
    const res = await fetch(job.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "User-Agent": "hypervibe-jobs/1.0",
      },
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const body = await res.text();
      console.error(`[${job.name}] ${res.status} in ${ms}ms: ${body.slice(0, 200)}`);
    } else {
      console.log(`[${job.name}] ping OK ${res.status} in ${ms}ms`);
    }
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`[${job.name}] ping FAILED in ${ms}ms: ${err?.message || err}`);
  }
}

// ── kind: snapshot (ex db-backup) ────────────────────────────────────────
//
// Retention policy, per target:
//   Rolling : 2 branches (latest + previous), rotated every run
//   Aging   : a new branch when the newest aging one is > 90 days old,
//             deleted after 270 days (9 months)
//   Steady-state max per target: 2 rolling + 3 aging = 5 branches

export async function runSnapshotJob(job, env) {
  const targets = Array.isArray(job.targets) ? job.targets : [];
  if (!env.NEON_API_KEY) {
    console.error(`[${job.name}] NEON_API_KEY secret missing - skipping.`);
    return;
  }
  if (!targets.length) {
    console.log(`[${job.name}] no snapshot targets registered - nothing to do.`);
    return;
  }

  const results = await Promise.allSettled(
    targets.map((t) => backupTarget(t, env.NEON_API_KEY)),
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const reason = results[i].reason;
      console.error(`[${targets[i].name}] snapshot FAILED: ${reason?.message || reason}`);
    }
  }
}

async function neon(method, path, key, body) {
  const res = await fetch(`${NEON}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}: ${txt}`);
  }
  return method === "DELETE" ? null : res.json();
}

function ageInDays(dateStr) {
  return Math.floor(
    (Date.now() - new Date(dateStr + "T00:00:00Z").getTime()) / 86_400_000,
  );
}

async function backupTarget({ name, projectId }, key) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const R = `bk-${name}-r-`; // rolling prefix
  const A = `bk-${name}-a-`; // aging prefix

  const { branches } = await neon("GET", `/projects/${projectId}/branches`, key);
  const main = branches.find((b) => b.default);
  if (!main) throw new Error("no default branch found");

  const rolling = branches
    .filter((b) => b.name.startsWith(R))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first
  const aging = branches
    .filter((b) => b.name.startsWith(A))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  // Rolling backup: create today's branch (skip on same-day rerun), keep 2.
  const newR = `${R}${today}`;
  if (!rolling.find((b) => b.name === newR)) {
    await neon("POST", `/projects/${projectId}/branches`, key, {
      branch: { name: newR, parent_id: main.id },
    });
    console.log(`[${name}] +rolling ${newR}`);
  }
  const allR = [newR, ...rolling.map((b) => b.name).filter((n) => n !== newR)];
  for (const old of allR.slice(2)) {
    const b = branches.find((x) => x.name === old);
    if (b) {
      await neon("DELETE", `/projects/${projectId}/branches/${b.id}`, key);
      console.log(`[${name}] -rolling ${old}`);
    }
  }

  // Aging backup: refresh if newest is > 90 days old, purge after 270 days.
  const newestAging = aging[0];
  const newestAgingDate = newestAging?.name.replace(A, "");
  const needNewAging = !newestAging || ageInDays(newestAgingDate) > 90;
  if (needNewAging) {
    const newA = `${A}${today}`;
    if (!aging.find((b) => b.name === newA)) {
      await neon("POST", `/projects/${projectId}/branches`, key, {
        branch: { name: newA, parent_id: main.id },
      });
      console.log(`[${name}] +aging ${newA}`);
    }
  }
  for (const old of aging) {
    const d = old.name.replace(A, "");
    if (ageInDays(d) > 270) {
      await neon("DELETE", `/projects/${projectId}/branches/${old.id}`, key);
      console.log(`[${name}] -aging ${old.name}`);
    }
  }

  console.log(`[${name}] snapshot cycle complete`);
}

// ── kind: quota (ex quota-monitor) ───────────────────────────────────────

export async function runQuotaJob(job, env) {
  const cfg = job.config || {};
  const checks = [];

  if (env.CLOUDFLARE_API_TOKEN && cfg.cloudflareAccountId && cfg.r2ThresholdGb) {
    checks.push(
      checkR2Storage(env, cfg).catch((e) => ({ _error: `R2: ${e.message}` })),
    );
  }

  if (!checks.length) {
    console.log(`[${job.name}] no quota checks configured (need CLOUDFLARE_API_TOKEN secret + cloudflareAccountId + r2ThresholdGb).`);
    return;
  }

  const results = await Promise.all(checks);
  const alerts = results.filter((r) => r && !r._error);
  const errors = results.filter((r) => r && r._error);
  for (const e of errors) console.error(`[${job.name}] ${e._error}`);

  if (!alerts.length) {
    console.log(`[${job.name}] all quotas under their thresholds.`);
    return;
  }

  if (!env.BREVO_API_KEY || !cfg.senderEmail || !cfg.recipient) {
    console.error(`[${job.name}] alert pending but Brevo not fully configured (BREVO_API_KEY secret + senderEmail + recipient) - cannot send.`);
    return;
  }

  try {
    await sendQuotaEmail(env, cfg, alerts);
    console.log(`[${job.name}] alert email sent to ${cfg.recipient} (${alerts.length} trigger(s)).`);
  } catch (e) {
    console.error(`[${job.name}] email send failed: ${e.message}`);
  }
}

async function checkR2Storage(env, cfg) {
  const threshold = parseFloat(cfg.r2ThresholdGb);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const query = `query R2($accountTag: String!, $start: String!, $end: String!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) {
          max { payloadSize metadataSize objectCount }
        }
      }
    }
  }`;

  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: cfg.cloudflareAccountId,
        start: monthStart.toISOString(),
        end: now.toISOString(),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`CF GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(`CF GraphQL errors: ${JSON.stringify(data.errors).slice(0, 200)}`);
  }

  const max = data?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.[0]?.max;
  if (!max) {
    console.log("R2 analytics not available (no data yet).");
    return null;
  }

  const usedBytes = (max.payloadSize || 0) + (max.metadataSize || 0);
  const usedGB = usedBytes / 1073741824;
  if (usedGB < threshold) {
    console.log(`R2 storage OK: ${usedGB.toFixed(3)} GB / ${threshold} GB threshold (free tier limit: ${R2_FREE_TIER_GB} GB).`);
    return null;
  }

  return {
    service: "Cloudflare R2",
    metric: "Storage mensuel",
    used: `${usedGB.toFixed(2)} GB`,
    threshold: `${threshold} GB (seuil configure)`,
    limit: `${R2_FREE_TIER_GB} GB (free tier)`,
    pctOfLimit: `${((usedGB / R2_FREE_TIER_GB) * 100).toFixed(1)} %`,
    objects: max.objectCount,
  };
}

async function sendQuotaEmail(env, cfg, alerts) {
  const subject = alerts.length === 1
    ? `[Hypervibe] Quota ${alerts[0].service} a depasse le seuil`
    : `[Hypervibe] ${alerts.length} quotas ont depasse le seuil`;

  const rows = alerts
    .map(
      (a) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;"><strong>${a.service}</strong></td>
        <td style="padding:8px;border:1px solid #ddd;">${a.metric}</td>
        <td style="padding:8px;border:1px solid #ddd;">${a.used}</td>
        <td style="padding:8px;border:1px solid #ddd;">${a.threshold}</td>
        <td style="padding:8px;border:1px solid #ddd;">${a.limit}</td>
        <td style="padding:8px;border:1px solid #ddd;"><strong>${a.pctOfLimit}</strong></td>
      </tr>`,
    )
    .join("");

  const htmlContent = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 0 auto; color: #222;">
      <h2 style="color: #d4830f;">Alerte quota Hypervibe</h2>
      <p>Au moins un de tes services a depasse le seuil que tu as configure. Voici le detail :</p>
      <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
        <thead style="background: #f4f4f4;">
          <tr>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Service</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Metrique</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Utilise</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Seuil</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Plafond</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">% du plafond</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <h3 style="margin-top: 24px;">Que faire ?</h3>
      <ul>
        <li>Lance <code>/quotas</code> dans Claude Code pour voir le detail complet.</li>
        <li>Lance <code>/clean</code> pour identifier des fichiers ou donnees obsoletes a supprimer.</li>
        <li>Sinon, c'est probablement le moment de passer a un plan superieur sur le service concerne.</li>
      </ul>
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #888; font-size: 12px;">
        Email envoye par le Worker Cloudflare <code>hypervibe-jobs</code> (worker partage Hypervibe).<br>
        Configuration : <code>~/.hypervibe-jobs/jobs.js</code> (repo git local)<br>
        Pour ajuster le seuil ou le destinataire : relance <code>/quotas</code> dans Claude Code.
      </p>
    </div>
  `;

  const body = {
    sender: {
      email: cfg.senderEmail,
      name: cfg.senderName || "Hypervibe",
    },
    to: [{ email: cfg.recipient }],
    subject,
    htmlContent,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ── Cron matcher (5-field UTC: minute hour dom month dow) ────────────────

function safeCronMatch(job, date) {
  try {
    return cronMatches(job.cron, date);
  } catch (err) {
    console.error(`[${job.name}] invalid cron "${job.cron}": ${err.message}`);
    return false;
  }
}

export function cronMatches(expr, date) {
  if (typeof expr !== "string") throw new Error("not a string");
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`expected 5 fields, got ${parts.length}`);
  const [m, h, dom, mon, dow] = parts;

  const timeOk =
    matchField(date.getUTCMinutes(), m, 0, 59) &&
    matchField(date.getUTCHours(), h, 0, 23) &&
    matchField(date.getUTCMonth() + 1, mon, 1, 12);
  if (!timeOk) return false;

  const domOk = matchField(date.getUTCDate(), dom, 1, 31);
  const dowOk = matchField(date.getUTCDay(), dow, 0, 6);
  // POSIX cron: when BOTH day-of-month and day-of-week are restricted (neither
  // is "*"), the day matches if EITHER field matches (OR). Otherwise AND.
  const domRestricted = dom.trim() !== "*";
  const dowRestricted = dow.trim() !== "*";
  return domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
}

function matchField(value, field, min, max) {
  for (const part of field.split(",")) {
    if (matchPart(value, part.trim(), min, max)) return true;
  }
  return false;
}

function matchPart(value, part, min, max) {
  if (part === "*") return true;

  let range = part;
  let step = 1;
  if (part.includes("/")) {
    const [r, s] = part.split("/");
    range = r;
    step = Number(s);
    if (!Number.isFinite(step) || step <= 0) return false;
  }

  let from;
  let to;
  if (range === "*") {
    from = min;
    to = max;
  } else if (range.includes("-")) {
    const [a, b] = range.split("-").map(Number);
    from = a;
    to = b;
  } else {
    from = Number(range);
    to = step === 1 ? from : max;
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (value < from || value > to) return false;
  return (value - from) % step === 0;
}

// Next matching minute for a cron expression, scanning up to 60 days ahead
// (covers every realistic schedule; returns null past that horizon).
export function computeNextDue(expr, from) {
  try {
    const start = new Date(from.getTime());
    start.setUTCSeconds(0, 0);
    for (let i = 1; i <= 60 * 24 * 60; i++) {
      const candidate = new Date(start.getTime() + i * 60_000);
      if (cronMatches(expr, candidate)) return candidate.toISOString();
    }
    return null;
  } catch {
    return null;
  }
}
