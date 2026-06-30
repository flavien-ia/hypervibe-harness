// quota-monitor-worker.js - Cloudflare Worker that watches free-tier quotas
// and emails the user (via Brevo) when usage crosses a configured threshold.
// Shared across all of a Cloudflare account's projects - one Worker, one cron
// slot. Currently watches: Cloudflare R2 storage. Designed to be extended to
// other metrics (Neon storage/compute, Workers daily requests, etc.).
//
// Env (Cloudflare Worker bindings):
//   CLOUDFLARE_API_TOKEN   - secret. Token with "Account Analytics: Read" scope.
//   CLOUDFLARE_ACCOUNT_ID  - var. The account whose quotas we monitor.
//   BREVO_API_KEY          - secret. For sending the alert email.
//   BREVO_SENDER_EMAIL     - var. Verified Brevo sender (must be confirmed in
//                            the Brevo dashboard at https://app.brevo.com/senders).
//   BREVO_SENDER_NAME      - var. Display name for the sender. Default: "Hypervibe".
//   ALERT_RECIPIENT        - var. Email to ping when a threshold is crossed.
//   R2_THRESHOLD_GB        - var. R2 storage threshold in GB (required; e.g. 9 = 90% of the 10 GB free tier). The R2 check is skipped if this is unset.
//
// Cron : daily at 6h UTC (configured in wrangler.toml).
//
// Behavior: if any metric exceeds its threshold, send ONE email summarizing all
// triggers. No deduplication across days - if you're over the threshold, you
// get a daily reminder until you fix it or upgrade. Honest and useful.

const R2_FREE_TIER_GB = 10;

export default {
  async scheduled(_controller, env, _ctx) {
    const checks = [];

    // R2 storage check (only if all required env vars are present)
    if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID && env.R2_THRESHOLD_GB) {
      checks.push(checkR2Storage(env).catch((e) => ({ _error: `R2: ${e.message}` })));
    }

    const results = await Promise.all(checks);
    const alerts = results.filter((r) => r && !r._error);
    const errors = results.filter((r) => r && r._error);

    for (const e of errors) console.error(e._error);

    if (alerts.length === 0) {
      console.log("No quota alerts to send.");
      return;
    }

    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL || !env.ALERT_RECIPIENT) {
      console.error("Brevo not fully configured (missing BREVO_API_KEY / BREVO_SENDER_EMAIL / ALERT_RECIPIENT). Cannot send alert.");
      return;
    }

    try {
      await sendBrevoEmail(env, alerts);
      console.log(`Alert email sent to ${env.ALERT_RECIPIENT} (${alerts.length} trigger(s)).`);
    } catch (e) {
      console.error(`Email send failed: ${e.message}`);
    }
  },

  // Manual trigger via HTTP for ad-hoc testing (`curl https://<worker-url>/test`)
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/test") {
      // Force an immediate quota check (same logic as the scheduled run; emails only fire if a threshold is actually exceeded)
      ctx.waitUntil(this.scheduled(null, env, ctx));
      return new Response("Triggered quota check. See `wrangler tail` for logs.", { status: 202 });
    }
    return new Response("quota-monitor worker - see `wrangler tail` for logs.", { status: 200 });
  },
};

// ── R2 storage check ────────────────────────────────────────────────────

async function checkR2Storage(env) {
  const threshold = parseFloat(env.R2_THRESHOLD_GB);
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
        accountTag: env.CLOUDFLARE_ACCOUNT_ID,
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
    // No R2 data - either no buckets or analytics not yet populated. Not an alert.
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
    threshold: `${threshold} GB (seuil configuré)`,
    limit: `${R2_FREE_TIER_GB} GB (free tier)`,
    pctOfLimit: `${((usedGB / R2_FREE_TIER_GB) * 100).toFixed(1)} %`,
    objects: max.objectCount,
  };
}

// ── Email via Brevo ─────────────────────────────────────────────────────

async function sendBrevoEmail(env, alerts) {
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
        Email envoye par le Worker Cloudflare <code>quota-monitor</code>, deploye via Hypervibe.<br>
        Configuration : <code>~/.quota-monitor-worker/wrangler.toml</code><br>
        Pour ajuster le seuil, modifier le destinataire, ou desactiver : <code>cd ~/.quota-monitor-worker</code> puis <code>wrangler deploy</code> apres edition (ou <code>wrangler delete</code> pour desactiver).
      </p>
    </div>
  `;

  const body = {
    sender: {
      email: env.BREVO_SENDER_EMAIL,
      name: env.BREVO_SENDER_NAME || "Hypervibe",
    },
    to: [{ email: env.ALERT_RECIPIENT }],
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
