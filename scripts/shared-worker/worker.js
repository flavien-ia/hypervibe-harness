// worker.js - Hypervibe unified shared Cloudflare Worker ("hypervibe-jobs").
//
// ONE worker, ONE cron slot, THREE roles, mutualized across every project of
// the account. Ticks every minute and runs whichever registered jobs are due:
//
//   kind "ping"     - POST a project's /api/cron/<task> endpoint at its cron
//                     time, authenticated with the project's bearer secret.
//                     A ping that answers in error is mailed (throttled to the
//                     first run of each 6-hour window, no storage involved).
//                     (Replaces the old standalone "cron-dispatcher" worker.)
//   kind "snapshot" - Neon database backup branches with rolling + aging
//                     retention, plus a Brevo alert email when a target fails.
//                     (Replaces the old "db-backup" worker.)
//   kind "quota"    - free-tier quota watch (Cloudflare R2 storage, plus Neon
//                     egress / compute / storage) with a Brevo alert email.
//                     (Replaces "quota-monitor".)
//
// Registry: ./jobs.js (versioned in the same git repo, managed by the
// Hypervibe skills through scripts/shared-worker/register.mjs).
//
// Job shapes (all crons are 5-field UTC):
//   { "kind": "ping",     "name": "weekly-report", "project": "myapp",
//     "cron": "0 8 * * 1", "url": "https://myapp.vercel.app/api/cron/weekly-report",
//     "secretName": "CRON_SECRET_MYAPP" }
//   { "kind": "snapshot", "name": "neon-backups", "cron": "0 3 1,15 * *",
//     "targets": [{ "name": "myapp", "projectId": "abc-123" }],
//     "config": { "recipient": "you@x.fr", "senderEmail": "you@x.fr",
//                 "senderName": "Hypervibe" } }   // config optional: no config = no alert mail
//   { "kind": "quota",    "name": "quota-monitor", "cron": "0 6 * * *",
//     "config": { "cloudflareAccountId": "...", "recipient": "you@x.fr",
//                 "senderEmail": "you@x.fr", "senderName": "Hypervibe",
//                 "r2ThresholdGb": 9, "neonThresholdPct": 60,
//                 "neonOrgId": "org-..." } }
//     (R2 needs CLOUDFLARE_API_TOKEN + cloudflareAccountId + r2ThresholdGb;
//      the Neon block runs as soon as NEON_API_KEY is present.)
//   Any job may carry "enabled": false to pause it without deleting it.
//
// Secrets (uploaded via `wrangler secret put`, never in git):
//   ADMIN_TOKEN            - bearer for the manual /trigger and /status endpoints
//   NEON_API_KEY           - for "snapshot" jobs
//   CLOUDFLARE_API_TOKEN   - for "quota" jobs (Account Analytics: Read)
//   BREVO_API_KEY          - alert email for "quota", "snapshot", and failed
//                            "ping" jobs (which borrow the recipient/sender of
//                            whichever job already declares one)
//   CRON_SECRET_<PROJECT>  - one per project, for its "ping" jobs
//
// Failure isolation: every due job runs in its own promise with its own catch;
// one failing job never prevents the others from running.

import registry from "./jobs.js";

const NEON = "https://console.neon.tech/api/v2";
const R2_FREE_TIER_GB = 10;

// Neon Free plan caps. Storage and compute are PER PROJECT; egress is the only
// one pooled across the whole account, and typically the first one to break
// (real-time sync features and unpaginated reads are the usual culprits).
const NEON_FREE = {
  egressGB: 5,
  computeHoursPerProject: 100,
  storageGBPerProject: 0.5,
};

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
        // `when` travels with the job: the failure alert throttles itself on the
        // schedule, so it must reason about the minute the tick was meant for.
        runJob(job, env, when).catch((err) =>
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

export async function runJob(job, env, when = new Date()) {
  switch (job.kind) {
    case "ping":
      return runPingJob(job, env, when);
    case "snapshot":
      return runSnapshotJob(job, env);
    case "quota":
      return runQuotaJob(job, env);
    default:
      console.error(`[${job.name}] unknown job kind "${job.kind}" - skipping.`);
  }
}

// ── kind: ping (ex cron-dispatcher) ──────────────────────────────────────

export async function runPingJob(job, env, when = new Date()) {
  const secret = job.secretName ? env[job.secretName] : null;
  if (!secret) {
    console.error(`[${job.name}] missing secret "${job.secretName}" - skipping.`);
    await reportPingFailure(job, env, when, "secret manquant", `Le secret "${job.secretName}" n'est pas configure sur le worker.`);
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
      await reportPingFailure(job, env, when, `HTTP ${res.status}`, body.slice(0, 300));
    } else {
      console.log(`[${job.name}] ping OK ${res.status} in ${ms}ms`);
    }
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`[${job.name}] ping FAILED in ${ms}ms: ${err?.message || err}`);
    await reportPingFailure(job, env, when, "injoignable", err?.message || String(err));
  }
}

// ── Ping failures: turning a log line nobody reads into an email ──────────
//
// A ping that comes back in error means the task simply never happened: wrong
// secret, renamed route, application error. The worker used to log it and move
// on, and those logs are only readable live - so the failure stayed invisible
// until someone noticed the missing result. Same blind spot as a stopped clock,
// different cause.
//
// Deliberately WITHOUT any storage. Remembering "already alerted" would mean a
// KV namespace or a bucket, hence provisioning and token permissions on every
// account that installs Hypervibe, for a few bytes of state. Instead the
// throttle is derived from the job's own schedule: only the FIRST run of the
// current 6-hour window may alert. A broken hourly job mails 4 times a day at
// most (00:00, 06:00, 12:00, 18:00 UTC), a daily job once, and the rule is
// deterministic - no state to lose, nothing to clean up.

/** Window used to throttle repeated failure alerts, in hours. */
const ALERT_WINDOW_HOURS = 6;

/**
 * Is `date` the first scheduled run of `cron` inside the current window?
 * Walks the window minute by minute (360 cheap checks at most) and answers no
 * as soon as an earlier run is found.
 */
export function isFirstRunOfWindow(cron, date, windowHours = ALERT_WINDOW_HOURS) {
  const start = new Date(date);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(Math.floor(date.getUTCHours() / windowHours) * windowHours);
  for (let t = start.getTime(); t < date.getTime(); t += 60_000) {
    try {
      if (cronMatches(cron, new Date(t))) return false;
    } catch {
      return true; // Unparseable cron: never swallow the alert.
    }
  }
  return true;
}

/**
 * Where to send an alert for this job.
 *
 * Ping jobs carry no mail config of their own (the registry only gives them a
 * url and a secret). Rather than migrate every registry, we borrow the address
 * already configured for the account's backup or quota job. No config anywhere
 * means alerting is simply off, exactly as it already is for those jobs.
 */
export function resolveAlertConfig(job, jobs) {
  const candidates = [job?.config, ...(jobs ?? listJobs()).map((j) => j?.config)];
  for (const c of candidates) {
    if (c?.recipient && c?.senderEmail) {
      return { recipient: c.recipient, senderEmail: c.senderEmail, senderName: c.senderName };
    }
  }
  return null;
}

async function reportPingFailure(job, env, when, cause, detail) {
  const cfg = resolveAlertConfig(job);
  if (!env.BREVO_API_KEY || !cfg) {
    console.error(`[${job.name}] ping failed but no alert channel (BREVO_API_KEY secret + a job config with recipient/senderEmail).`);
    return;
  }
  if (!isFirstRunOfWindow(job.cron, when)) {
    console.log(`[${job.name}] ping failure not mailed: already the alert window's turn passed.`);
    return;
  }
  try {
    await sendPingFailureEmail(env, cfg, job, cause, detail);
    console.log(`[${job.name}] failure email sent to ${cfg.recipient}.`);
  } catch (e) {
    console.error(`[${job.name}] failure email could not be sent: ${e.message}`);
  }
}

async function sendPingFailureEmail(env, cfg, job, cause, detail) {
  const quoi = job.project ? `${job.name} (${job.project})` : job.name;
  const pistes = {
    "secret manquant": "Le secret n'existe pas sur le worker : le reposer avec <code>npx wrangler secret put</code>.",
    "HTTP 401": "Le secret du worker et celui de l'application ne correspondent plus. Comparer la variable d'environnement de l'app et le secret du worker.",
    "HTTP 403": "L'application refuse l'appel : verifier la garde d'authentification de la route.",
    "HTTP 404": "L'adresse appelee n'existe plus : la route a sans doute ete renommee ou supprimee.",
    "HTTP 500": "L'application a plante en executant la tache : regarder ses journaux d'execution.",
    injoignable: "L'application n'a pas repondu du tout : hors ligne, domaine expire, ou deploiement en echec.",
  };
  const piste = pistes[cause] ?? "Regarder les journaux de l'application pour cette adresse.";

  const htmlContent = `
    <div style="font-family:Helvetica,Arial,sans-serif;color:#1A1410;font-size:15px;line-height:1.6;">
      <p><strong>La tache planifiee "${escapeHtml(quoi)}" ne s'execute plus.</strong></p>
      <p>Le worker l'a bien declenchee a l'heure prevue, mais l'application a repondu en erreur. La tache n'a donc pas eu lieu, et ne se rattrapera pas toute seule.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:16px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#7A7168;">Adresse appelee</td><td><code>${escapeHtml(job.url || "")}</code></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#7A7168;">Horaire</td><td><code>${escapeHtml(job.cron || "")}</code> (UTC)</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#7A7168;">Reponse</td><td><strong>${escapeHtml(cause)}</strong></td></tr>
      </table>
      ${detail ? `<p style="color:#7A7168;font-size:13px;">Detail renvoye : <code>${escapeHtml(String(detail))}</code></p>` : ""}
      <p><strong>Piste la plus probable :</strong> ${piste}</p>
      <p style="font-size:13px;color:#7A7168;">Ce message ne se repetera pas plus d'une fois par ${ALERT_WINDOW_HOURS} heures tant que la panne dure.</p>
    </div>`;

  await sendBrevoEmail(env, cfg, `[Hypervibe] Tache planifiee en echec : ${quoi}`, htmlContent);
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
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const reason = results[i].reason;
      const message = String(reason?.message || reason);
      console.error(`[${targets[i].name}] snapshot FAILED: ${message}`);
      failures.push({ ...targets[i], message, ...diagnoseSnapshotFailure(targets[i], message) });
    }
  }

  if (!failures.length) return;

  // A failed target is doubly bad: backupTarget creates the new branch BEFORE
  // pruning the old ones, so a project stuck at the plan's branch cap loses its
  // backups AND its rotation, silently. Always try to surface it by email.
  const cfg = job.config || {};
  if (!env.BREVO_API_KEY || !cfg.senderEmail || !cfg.recipient) {
    console.error(`[${job.name}] ${failures.length} snapshot failure(s) but Brevo not configured (BREVO_API_KEY secret + senderEmail + recipient in the job config) - cannot send alert.`);
    return;
  }

  try {
    await sendSnapshotFailureEmail(env, cfg, failures);
    console.log(`[${job.name}] failure email sent to ${cfg.recipient} (${failures.length} target(s)).`);
  } catch (e) {
    console.error(`[${job.name}] email send failed: ${e.message}`);
  }
}

// Turns a raw Neon API error into a plain-language cause plus a ready-to-paste
// prompt for Claude Code. Each prompt must stand alone: whoever pastes it has
// only the email in front of them, not this code.
function diagnoseSnapshotFailure(target, message) {
  // Classify on Neon's response body only: the request path always contains
  // "/branches", which would otherwise make every error look branch-related.
  const detail = message.replace(/^[A-Z]+ \/\S* -> \d+:\s*/, "");
  const authFailed = /-> 40[13]:/.test(message);
  const storageCapped = /storage/i.test(detail) && /(limit|exceed|quota)/i.test(detail);
  const branchCapped =
    !storageCapped &&
    /branch/i.test(detail) && /(limit|exceed|maximum|quota|allow)/i.test(detail);

  if (branchCapped) {
    return {
      cause: "Le projet a atteint le plafond de branches de son plan Neon (10 sur le plan Free).",
      impact: "Aucune sauvegarde n'a ete creee, et la rotation des anciennes n'a pas eu lieu non plus (le worker cree avant de purger). Le projet reste bloque tant que des branches ne sont pas supprimees.",
      prompt: `Le backup automatique Neon du projet "${target.name}" (projectId ${target.projectId}) echoue parce que le projet a atteint la limite de 10 branches du plan Free. Lis la cle Neon dans le coffre Bitwarden (item NEON, champ api_key), liste les branches du projet via l'API, et classe-les : "main", les backups automatiques (bk-${target.name}-r-<date> = rolling, bk-${target.name}-a-<date> = aging) et les snapshots manuels (tout le reste). Propose-moi lesquelles supprimer pour redescendre a 6 branches maximum, en gardant main et les backups automatiques les plus recents. Ne supprime rien sans mon accord explicite.`,
    };
  }
  if (authFailed) {
    return {
      cause: "L'API Neon a refuse la cle du worker (401/403).",
      impact: "Aucun projet n'a pu etre sauvegarde tant que la cle n'est pas retablie.",
      prompt: `Le worker Cloudflare "hypervibe-jobs" n'arrive plus a appeler l'API Neon, elle repond 401 ou 403. Erreur exacte : ${message}. Compare la cle du coffre Bitwarden (item NEON, champ api_key) avec le secret NEON_API_KEY du worker, verifie qu'elle est toujours valide cote Neon, et remets-la a jour avec "wrangler secret put NEON_API_KEY" depuis le dossier ~/.hypervibe-jobs si besoin.`,
    };
  }
  if (storageCapped) {
    return {
      cause: "Le projet a atteint le plafond de stockage de son plan Neon (0,5 Go sur le plan Free).",
      impact: "La creation de branche echoue, et les ecritures en base sont probablement bloquees elles aussi.",
      prompt: `Le projet Neon "${target.name}" (projectId ${target.projectId}) a atteint le plafond de stockage de 0,5 Go du plan Free, ce qui bloque le backup automatique et probablement les ecritures en base. Lis la cle Neon dans le coffre Bitwarden (item NEON, champ api_key), regarde la taille reelle du projet et la repartition par table, et propose-moi quoi purger ou archiver. Ne supprime aucune donnee sans mon accord explicite.`,
    };
  }
  return {
    cause: "Erreur inattendue de l'API Neon.",
    impact: "Ce projet n'a pas ete sauvegarde lors de ce passage.",
    prompt: `Le backup automatique Neon du projet "${target.name}" (projectId ${target.projectId}) a echoue avec cette erreur : ${message}. Le code du worker est dans ~/.hypervibe-jobs/worker.js (fonction backupTarget) et le registre des jobs dans ~/.hypervibe-jobs/jobs.js. Diagnostique la cause, verifie l'etat du projet via l'API Neon avec la cle du coffre Bitwarden (item NEON, champ api_key), et propose-moi un correctif.`,
  };
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

  if (env.NEON_API_KEY) {
    checks.push(
      checkNeonUsage(env, cfg).catch((e) => ({ _error: `Neon: ${e.message}` })),
    );
  }

  if (!checks.length) {
    console.log(`[${job.name}] no quota checks configured (need CLOUDFLARE_API_TOKEN + cloudflareAccountId + r2ThresholdGb for R2, NEON_API_KEY for Neon).`);
    return;
  }

  // A check may return one alert, null, or several alerts (Neon reports per
  // project), so flatten before filtering.
  const results = (await Promise.all(checks)).flatMap((r) => (Array.isArray(r) ? r : [r]));
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

// Watches the three Neon Free caps. Egress is the headline: it is pooled across
// the account, it is invisible from the console's project view, and it scales
// with how OFTEN you read the data, not with how big the database is.
async function checkNeonUsage(env, cfg) {
  const pct = parseFloat(cfg.neonThresholdPct ?? 60);
  if (!Number.isFinite(pct) || pct <= 0) return [];

  // Neon scopes this listing to ONE organisation, and silently picks the account's
  // default when none is named. A watch pointed at the wrong organisation reports
  // nothing forever, which reads exactly like "everything is fine".
  const orgId = cfg.neonOrgId || env.NEON_ORG_ID || "";
  const scope = orgId ? `&org_id=${encodeURIComponent(orgId)}` : "";
  const { projects } = await neon("GET", `/projects?limit=400${scope}`, env.NEON_API_KEY);
  if (!projects?.length) return [];

  // The list endpoint carries storage but NOT the consumption counters, so each
  // project needs its own GET. Fine for a once-a-day job.
  const details = (
    await Promise.all(
      projects.map((p) =>
        neon("GET", `/projects/${p.id}`, env.NEON_API_KEY)
          .then((d) => d.project)
          .catch((e) => {
            console.error(`[neon] ${p.name}: ${e.message}`);
            return null;
          }),
      ),
    )
  ).filter(Boolean);

  const alerts = [];
  let egressBytes = 0;

  for (const p of details) {
    egressBytes += p.data_transfer_bytes || 0;

    const computeH = (p.compute_time_seconds || 0) / 3600;
    if (computeH >= (NEON_FREE.computeHoursPerProject * pct) / 100) {
      alerts.push({
        service: `Neon / ${p.name}`,
        metric: "Compute du mois",
        used: `${computeH.toFixed(1)} CU-h`,
        threshold: `${pct} % du plafond`,
        limit: `${NEON_FREE.computeHoursPerProject} CU-h (par projet)`,
        pctOfLimit: `${((computeH / NEON_FREE.computeHoursPerProject) * 100).toFixed(1)} %`,
        hint: "Une requete lourde ou un endpoint qui ne se suspend plus. Regarde si un client garde une connexion ouverte en permanence.",
      });
    }

    const storageGB = (p.synthetic_storage_size || 0) / 1073741824;
    if (storageGB >= (NEON_FREE.storageGBPerProject * pct) / 100) {
      alerts.push({
        service: `Neon / ${p.name}`,
        metric: "Stockage",
        used: `${storageGB.toFixed(3)} GB`,
        threshold: `${pct} % du plafond`,
        limit: `${NEON_FREE.storageGBPerProject} GB (par projet)`,
        pctOfLimit: `${((storageGB / NEON_FREE.storageGBPerProject) * 100).toFixed(1)} %`,
        hint: "Au plafond, les ecritures echouent. Purge les vieilles lignes, ou supprime des branches de backup qui divergent beaucoup de main.",
      });
    }
  }

  const egressGB = egressBytes / 1073741824;
  if (egressGB >= (NEON_FREE.egressGB * pct) / 100) {
    alerts.push({
      service: "Neon (tout le compte)",
      metric: "Egress du mois",
      used: `${egressGB.toFixed(3)} GB`,
      threshold: `${pct} % du plafond`,
      limit: `${NEON_FREE.egressGB} GB (compte entier)`,
      pctOfLimit: `${((egressGB / NEON_FREE.egressGB) * 100).toFixed(1)} %`,
      hint: "Cherche ce qui LIT en boucle, pas ce qui est gros : polling a intervalle court, requete sans pagination, ou fonction serverless qui refait la meme requete sans cache. C'est le profil type d'une synchro temps reel ou d'un polling agressif.",
    });
  } else {
    console.log(`Neon egress OK: ${egressGB.toFixed(3)} GB / ${NEON_FREE.egressGB} GB (${pct} % threshold).`);
  }

  return alerts;
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

  const hints = alerts
    .filter((a) => a.hint)
    .map(
      (a) => `<li style="margin-bottom:8px;"><strong>${escapeHtml(a.service)}</strong> : ${escapeHtml(a.hint)}</li>`,
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
      ${hints ? `<h3 style="margin-top: 24px;">Ou regarder</h3><ul style="font-size:14px;">${hints}</ul>` : ""}
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

  await sendBrevoEmail(env, cfg, subject, htmlContent);
}

async function sendSnapshotFailureEmail(env, cfg, failures) {
  const subject = failures.length === 1
    ? `[Hypervibe] Backup Neon en echec : ${failures[0].name}`
    : `[Hypervibe] ${failures.length} backups Neon en echec`;

  const blocks = failures
    .map(
      (f) => `
      <div style="border:1px solid #ddd;border-radius:6px;padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 8px;">${escapeHtml(f.name)}</h3>
        <p style="margin:0 0 4px;"><strong>Ce qui se passe :</strong> ${escapeHtml(f.cause)}</p>
        <p style="margin:0 0 12px;"><strong>Consequence :</strong> ${escapeHtml(f.impact)}</p>
        <p style="margin:0 0 6px;"><strong>A copier-coller dans Claude Code pour corriger :</strong></p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e2e2e2;border-radius:4px;padding:12px;font-size:13px;margin:0 0 12px;">${escapeHtml(f.prompt)}</pre>
        <details>
          <summary style="cursor:pointer;color:#666;font-size:13px;">Erreur brute renvoyee par Neon</summary>
          <pre style="white-space:pre-wrap;word-break:break-word;color:#666;font-size:12px;margin:8px 0 0;">${escapeHtml(f.message)}</pre>
        </details>
      </div>`,
    )
    .join("");

  const htmlContent = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 0 auto; color: #222;">
      <h2 style="color: #c0392b;">Backup Neon en echec</h2>
      <p>
        Le job <code>snapshot</code> du worker partage n'a pas pu sauvegarder
        ${failures.length === 1 ? "un projet" : `${failures.length} projets`}.
        Tant que ce n'est pas corrige, ${failures.length === 1 ? "ce projet n'a" : "ces projets n'ont"}
        plus de sauvegarde automatique.
      </p>
      ${blocks}
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #888; font-size: 12px;">
        Email envoye par le Worker Cloudflare <code>hypervibe-jobs</code> (worker partage Hypervibe).<br>
        Configuration : <code>~/.hypervibe-jobs/jobs.js</code> (repo git local)<br>
        Prochain essai automatique au prochain passage du job (le 1er et le 15 du mois).
      </p>
    </div>
  `;

  await sendBrevoEmail(env, cfg, subject, htmlContent);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendBrevoEmail(env, cfg, subject, htmlContent) {
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
