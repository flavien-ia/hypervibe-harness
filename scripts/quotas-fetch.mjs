#!/usr/bin/env node
// quotas-fetch.mjs - Deterministic core for /quotas.
//
// Fetches free-tier usage in parallel from 6 services, outputs a single
// JSON document on stdout. Claude (in skills/quotas/SKILL.md) renders the
// human-friendly table + verdicts.
//
// Services covered:
//   - Neon (Postgres)            via REST + NEON_API_KEY
//   - Cloudflare R2              via REST + GraphQL + CLOUDFLARE_API_TOKEN
//   - Cloudflare Workers         via GraphQL Analytics + same token
//   - Brevo                      via REST + BREVO_API_KEY
//   - Resend                     via REST with RESEND_FULL_ACCESS_KEY
//                                (self-healed: creates the key once via CLI
//                                if absent, persists at User scope)
//   - Vercel (Hobby)             via REST - partial (deployment count only,
//                                bandwidth & function-time are gated on Pro)
//
// Each fetcher runs under a 10s timeout. One service down doesn't kill the
// run - Promise.allSettled ensures every result is collected.
//
// Usage:
//   node quotas-fetch.mjs [--cf-account <id>]
//
// Output (stdout): JSON. Last line is `{"_quotas":...}` for easy parsing.
// Exit code: always 0 unless a fatal setup error occurs (then 1 with a JSON
// {"_error": "..."} on stderr).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readUserEnv } from "./_read-user-env.mjs";
import { writeUserEnv } from "./_write-user-env.mjs";
import { getSecret } from "./vault/vault.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Free-tier limits live in a sidecar JSON (scripts/quotas-limits.json).
// This is the single source of truth for "free plan caps". The script reads it
// at runtime - no fallback embedded in code, no auto-update from the web. To
// reflect provider changes, edit the JSON and ship a new plugin version.
const LIMITS = JSON.parse(readFileSync(join(__dirname, "quotas-limits.json"), "utf8"));

// ─── Args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let cfAccountOverride = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cf-account" && args[i + 1]) cfAccountOverride = args[++i];
}

// ─── Time helpers ─────────────────────────────────────────────────────
const NOW = new Date();
const MONTH_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
const MONTH_END = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1));
const DAY_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));

const billingCycle = {
  monthStart: MONTH_START.toISOString(),
  monthEnd: MONTH_END.toISOString(),
  dayStart: DAY_START.toISOString(),
  daysElapsedInMonth: Math.floor((NOW - MONTH_START) / 86400000),
  daysRemainingInMonth: Math.ceil((MONTH_END - NOW) / 86400000),
};

// ─── Fetch helper with timeout ───────────────────────────────────────
async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 100)}`);
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function asMetric(name, used, limit, unit, scope = "account-month") {
  return {
    name,
    used: Math.round(used * 1000) / 1000,
    limit,
    unit,
    pctUsed: limit ? Math.round((used / limit) * 1000) / 10 : null,
    scope,
  };
}

// ─── Self-healing Resend full-access key ─────────────────────────────
function ensureResendFullAccessKey() {
  // The Resend key lives in the vault (item RESEND, field api_key) - full-access by design.
  // No more CLI minting. Falls back to a legacy env var during the migration period.
  try {
    const key = getSecret("RESEND", "api_key");
    return { key, justCreated: false };
  } catch (e) {
    if (e.code === 2 || e.code === 3) {
      return { key: null, justCreated: false, reason: "Coffre-fort verrouillé - déverrouille-le (bw unlock) puis réessaie." };
    }
    // code 4 (absente du coffre) → fallback env legacy ci-dessous.
  }
  const legacy = readUserEnv("RESEND_API_KEY") || readUserEnv("RESEND_FULL_ACCESS_KEY");
  if (legacy) return { key: legacy, justCreated: false };
  return {
    key: null,
    justCreated: false,
    reason: 'Clé Resend absente du coffre. Range-la : `node scripts/vault/launch.mjs add --name RESEND --service Resend --fields "api_key:secret"`.',
  };
}

// ─── Service: Neon ────────────────────────────────────────────────────
//
// Limits in scripts/quotas-limits.json under LIMITS.neon.free.
//
// IMPORTANT: BOTH storage and compute are per-project on Free Plan (not
// account-wide!). Summing across projects and comparing to a single budget
// is doubly wrong. We surface the heaviest project for each metric (the one
// closest to its own per-project cap), plus list any project that's already
// over its limit.
async function fetchNeon() {
  let apiKey;
  try { apiKey = getSecret("NEON", "api_key"); } catch { apiKey = readUserEnv("NEON_API_KEY"); }
  if (!apiKey) return svc("neon", "Neon (Postgres)", false, [], "Clé API Neon non configurée (coffre-fort `NEON` ou env). `/start` la met en place.");

  // Try to read the actual plan from the org endpoint so we can be honest
  // about whether the displayed limits even apply.
  const orgs = await fetchJson("https://console.neon.tech/api/v2/users/me/organizations", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const plan = orgs.ok ? orgs.json.organizations?.[0]?.plan || "free" : "unknown";

  const r = await fetchJson("https://console.neon.tech/api/v2/projects?limit=400", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!r.ok) return svc("neon", "Neon (Postgres)", false, [], `API Neon: HTTP ${r.status}`);

  const projects = r.json.projects || [];

  // Build per-project view. Both storage and compute have per-project caps on
  // Free, so we surface the heaviest project for each axis.
  const projectsView = projects.map((p) => ({
    name: p.name,
    storageGB: (p.synthetic_storage_size || 0) / 1073741824,
    computeH: (p.cpu_used_sec || 0) / 3600,
  }));

  const projectsByStorage = [...projectsView].sort((a, b) => b.storageGB - a.storageGB);
  const projectsByCompute = [...projectsView].sort((a, b) => b.computeH - a.computeH);

  const heaviestStorage = projectsByStorage[0] || { name: "-", storageGB: 0 };
  const heaviestCompute = projectsByCompute[0] || { name: "-", computeH: 0 };

  const L = LIMITS.neon.free;
  const overStorageLimit = projectsView.filter((p) => p.storageGB > L.storageGBPerProject);
  const overComputeLimit = projectsView.filter((p) => p.computeH > L.computeHoursPerProject);

  // Limits depend on the plan. Free = the per-project values from JSON.
  // Launch/Scale = pay-as-you-go (no hard cap). We only show Free limits for
  // free orgs; paid orgs see consumption without a limit bar.
  const isFree = plan === "free";

  const metrics = [
    asMetric(
      `Storage projet le + gros (${heaviestStorage.name})`,
      heaviestStorage.storageGB,
      isFree ? L.storageGBPerProject : null,
      "GB",
      "per-project-month",
    ),
    asMetric(
      `Compute projet le + actif (${heaviestCompute.name})`,
      heaviestCompute.computeH,
      isFree ? L.computeHoursPerProject : null,
      "h",
      "per-project-month",
    ),
    asMetric("Projets actifs", projects.length, isFree ? L.projectsMax : null, "projets", "account"),
  ];

  const overParts = [];
  if (overStorageLimit.length) overParts.push(`storage > ${L.storageGBPerProject} GB sur ${overStorageLimit.length} projet(s) : ${overStorageLimit.map(p => p.name).join(", ")}`);
  if (overComputeLimit.length) overParts.push(`compute > ${L.computeHoursPerProject} h sur ${overComputeLimit.length} projet(s) : ${overComputeLimit.map(p => p.name).join(", ")}`);

  const note = isFree
    ? `Plan Free détecté. Limites par projet : ${L.storageGBPerProject} GB storage · ${L.computeHoursPerProject} h compute. Account : ${L.projectsMax} projets max. Vérifié le ${LIMITS.neon.lastChecked}.${overParts.length ? ` ⚠️ ${overParts.join(" · ")}` : ""}`
    : `Plan ${plan} détecté. Pas de plafond dur (facturation à l'usage). Les chiffres ci-dessus reflètent ta consommation ce mois.`;

  const breakdown = projects.length > 1 ? projectsByStorage.map((p) => ({
    label: p.name,
    storageGB: Math.round(p.storageGB * 1000) / 1000,
    computeH: Math.round(p.computeH * 100) / 100,
    overStorage: p.storageGB > L.storageGBPerProject,
    overCompute: p.computeH > L.computeHoursPerProject,
  })) : null;

  return svc("neon", "Neon (Postgres)", true, metrics, note, breakdown);
}

// ─── Service: Cloudflare (R2 + Workers) ──────────────────────────────
async function fetchCloudflare() {
  const token = readUserEnv("CLOUDFLARE_API_TOKEN");
  if (!token) return [
    svc("cloudflareR2", "Cloudflare R2 (stockage)", false, [], "CLOUDFLARE_API_TOKEN non configuré. `/start` le met en place."),
    svc("cloudflareWorkers", "Cloudflare Workers", false, [], "CLOUDFLARE_API_TOKEN non configuré."),
  ];

  // Resolve account ID
  let accountId = cfAccountOverride;
  if (!accountId) {
    const acc = await fetchJson("https://api.cloudflare.com/client/v4/accounts", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!acc.ok || !acc.json.success) {
      return [
        svc("cloudflareR2", "Cloudflare R2 (stockage)", false, [], "Échec récupération compte CF"),
        svc("cloudflareWorkers", "Cloudflare Workers", false, [], "Échec récupération compte CF"),
      ];
    }
    accountId = acc.json.result?.[0]?.id;
    if (!accountId) {
      return [
        svc("cloudflareR2", "Cloudflare R2 (stockage)", false, [], "Aucun compte CF accessible"),
        svc("cloudflareWorkers", "Cloudflare Workers", false, [], "Aucun compte CF accessible"),
      ];
    }
  }

  const r2 = await fetchR2(token, accountId);
  const workers = await fetchWorkers(token, accountId);
  return [r2, workers];
}

async function fetchR2(token, accountId) {
  // Bucket list across BOTH jurisdictions (default + EU). R2 EU-jurisdiction
  // buckets are invisible to the default endpoint and require the
  // `cf-r2-jurisdiction: eu` header. We fetch both and merge, tagging each
  // bucket with its jurisdiction so the breakdown shows it.
  const bucketsDefault = await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!bucketsDefault.ok || !bucketsDefault.json.success) {
    const msg = bucketsDefault.json?.errors?.[0]?.message || `HTTP ${bucketsDefault.status}`;
    if (/not enabled|subscription|10000/i.test(msg)) {
      return svc("cloudflareR2", "Cloudflare R2 (stockage)", false, [], "R2 non activé sur le compte (lance `/add-storage` pour l'activer)");
    }
    return svc("cloudflareR2", "Cloudflare R2 (stockage)", false, [], `API R2: ${msg}`);
  }
  const bucketsEu = await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "cf-r2-jurisdiction": "eu" },
  });
  // EU jurisdiction list failure is non-fatal - fall back to default-only list.
  const bucketListDefault = (bucketsDefault.json.result?.buckets || []).map((b) => ({ ...b, jurisdiction: "default" }));
  const bucketListEu = (bucketsEu.ok && bucketsEu.json?.success ? bucketsEu.json.result?.buckets || [] : []).map((b) => ({ ...b, jurisdiction: "eu" }));
  const bucketList = [...bucketListDefault, ...bucketListEu];

  // Aggregate storage size + ops via GraphQL Analytics for the current month
  const gqlBody = {
    query: `query R2Usage($accountTag: String!, $start: String!, $end: String!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2StorageAdaptiveGroups(
            limit: 1
            filter: { datetime_geq: $start, datetime_leq: $end }
          ) {
            max { payloadSize metadataSize objectCount }
          }
          r2OperationsAdaptiveGroups(
            limit: 100
            filter: { datetime_geq: $start, datetime_leq: $end }
          ) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }`,
    variables: {
      accountTag: accountId,
      start: MONTH_START.toISOString(),
      end: NOW.toISOString(),
    },
  };
  const gql = await fetchJson("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(gqlBody),
  });

  let storageBytes = null;
  let classAOps = null;
  let classBOps = null;
  if (gql.ok && gql.json?.data?.viewer?.accounts?.[0]) {
    const acc = gql.json.data.viewer.accounts[0];
    const storageMax = acc.r2StorageAdaptiveGroups?.[0]?.max;
    if (storageMax) storageBytes = (storageMax.payloadSize || 0) + (storageMax.metadataSize || 0);
    const opsBuckets = acc.r2OperationsAdaptiveGroups || [];
    classAOps = 0;
    classBOps = 0;
    // Class A: ListBuckets, PutBucket, ListObjects, PutObject, CopyObject, CompleteMultipartUpload, CreateMultipartUpload, UploadPart, UploadPartCopy
    // Class B: HeadBucket, HeadObject, GetObject, UsageSummary, GetBucketEncryption, GetBucketLocation
    const CLASS_A = new Set(["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "PutBucketEncryption"]);
    for (const b of opsBuckets) {
      const action = b.dimensions?.actionType;
      const reqs = b.sum?.requests || 0;
      if (CLASS_A.has(action)) classAOps += reqs;
      else classBOps += reqs;
    }
  }

  // Free tier limits from quotas-limits.json
  const R2 = LIMITS.cloudflareR2.free;
  const metrics = [];
  if (storageBytes !== null) metrics.push(asMetric("Storage", storageBytes / 1073741824, R2.storageGBPerMonth, "GB", "account-month"));
  if (classAOps !== null) metrics.push(asMetric("Opérations classe A (writes)", classAOps, R2.classAOpsPerMonth, "ops", "account-month"));
  if (classBOps !== null) metrics.push(asMetric("Opérations classe B (reads)", classBOps, R2.classBOpsPerMonth, "ops", "account-month"));
  metrics.push(asMetric("Buckets", bucketList.length, null, "buckets", "account"));

  const breakdown = bucketList.length > 0
    ? bucketList.map((b) => ({ label: `${b.name}${b.jurisdiction === "eu" ? " (EU)" : ""}`, creationDate: b.creation_date }))
    : null;

  return svc(
    "cloudflareR2",
    "Cloudflare R2 (stockage)",
    metrics.length > 1 || storageBytes !== null,
    metrics,
    storageBytes === null ? "Analytics R2 non disponibles (compte trop récent ou trop peu d'usage)" : null,
    breakdown,
  );
}

async function fetchWorkers(token, accountId) {
  // Workers requests per day (free tier: 100k/day)
  const gqlBody = {
    query: `query WorkersUsage($accountTag: String!, $start: String!, $end: String!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 1
            filter: { datetime_geq: $start, datetime_leq: $end }
          ) {
            sum { requests errors }
          }
        }
      }
    }`,
    variables: {
      accountTag: accountId,
      start: DAY_START.toISOString(),
      end: NOW.toISOString(),
    },
  };
  const gql = await fetchJson("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(gqlBody),
  });

  if (!gql.ok || !gql.json?.data?.viewer?.accounts?.[0]) {
    return svc("cloudflareWorkers", "Cloudflare Workers", false, [], "Analytics Workers non disponibles (probablement aucun Worker déployé)");
  }
  const data = gql.json.data.viewer.accounts[0].workersInvocationsAdaptive?.[0]?.sum;
  const W = LIMITS.cloudflareWorkers.free;
  if (!data) {
    return svc(
      "cloudflareWorkers",
      "Cloudflare Workers",
      true,
      [asMetric("Requêtes aujourd'hui", 0, W.requestsPerDay, "requêtes", "account-day")],
      "Aucune requête Worker aujourd'hui",
    );
  }

  return svc(
    "cloudflareWorkers",
    "Cloudflare Workers",
    true,
    [
      asMetric("Requêtes aujourd'hui", data.requests || 0, W.requestsPerDay, "requêtes", "account-day"),
      asMetric("Erreurs aujourd'hui", data.errors || 0, null, "erreurs", "account-day"),
    ],
  );
}

// ─── Service: Brevo ──────────────────────────────────────────────────
async function fetchBrevo() {
  const apiKey = readUserEnv("BREVO_API_KEY");
  if (!apiKey) return svc("brevo", "Brevo (email)", false, [], "BREVO_API_KEY non configurée");

  const r = await fetchJson("https://api.brevo.com/v3/account", {
    headers: { "api-key": apiKey, Accept: "application/json" },
  });
  if (!r.ok) return svc("brevo", "Brevo (email)", false, [], `API Brevo: HTTP ${r.status}`);

  // plan[] contains entries like:
  //   { type: "free", creditsType: "sendLimit", credits: 300 }      → daily send limit
  //   { type: "subscription", creditsType: "userLimit", credits: 1 }
  // For free tier: "sendLimit" = daily quota of 300/day.
  // We prefer the API-supplied limit (handles paid plans correctly), and fall
  // back to LIMITS.brevo.free.emailsPerDay only if the API doesn't expose one.
  const plans = r.json.plan || [];
  const sendLimitEntry = plans.find((p) => p.creditsType === "sendLimit");
  const dailyLimit = sendLimitEntry?.credits || LIMITS.brevo.free.emailsPerDay;
  const planType = plans.map((p) => p.type).join("/") || "free";

  // Brevo's /account doesn't expose "emails sent today". Best-effort: count
  // recent transactional emails via /smtp/statistics/aggregatedReport for today.
  const today = NOW.toISOString().slice(0, 10);
  const stats = await fetchJson(`https://api.brevo.com/v3/smtp/statistics/aggregatedReport?startDate=${today}&endDate=${today}`, {
    headers: { "api-key": apiKey, Accept: "application/json" },
  });
  let sentToday = null;
  if (stats.ok) sentToday = stats.json.requests || 0;

  const metrics = [];
  if (sentToday !== null) {
    metrics.push(asMetric("Emails envoyés aujourd'hui", sentToday, dailyLimit, "emails", "account-day"));
  } else {
    metrics.push(asMetric("Limite journalière du plan", dailyLimit, null, "emails/jour", "account"));
  }

  const planNote = `Plan détecté : ${planType}${sendLimitEntry ? ` (${dailyLimit} emails/jour)` : ""}`;
  return svc(
    "brevo",
    "Brevo (email)",
    true,
    metrics,
    sentToday === null ? `${planNote}. Statistiques d'envoi du jour non disponibles.` : planNote,
  );
}

// ─── Service: Resend (with self-heal) ────────────────────────────────
async function fetchResend() {
  const heal = ensureResendFullAccessKey();
  if (!heal.key) return svc("resend", "Resend (email)", false, [], heal.reason || "Pas de clé Resend full-access");

  const justCreated = heal.justCreated;

  // Paginate /emails until we exit the current month
  // Free tier: 100/day, 3000/month (as of 2026)
  let sentToday = 0;
  let sentThisMonth = 0;
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 50; // safety cap

  while (pages < MAX_PAGES) {
    const url = new URL("https://api.resend.com/emails");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("after", cursor);

    const r = await fetchJson(url.toString(), {
      headers: { Authorization: `Bearer ${heal.key}`, Accept: "application/json" },
    });
    if (!r.ok) {
      return svc(
        "resend",
        "Resend (email)",
        false,
        [],
        `API Resend: HTTP ${r.status} - ${r.json?.message || ""}`,
        null,
        { resendKeyJustCreated: justCreated },
      );
    }

    const emails = r.json.data || [];
    if (emails.length === 0) break;

    let exitedMonth = false;
    for (const e of emails) {
      // Resend's created_at is "YYYY-MM-DD HH:MM:SS.uuuuuu+00" (Postgres-ish);
      // normalize to ISO.
      const ts = new Date((e.created_at || "").replace(" ", "T").replace(/\.\d+\+00$/, ".000Z").replace("+00", "Z"));
      if (Number.isNaN(ts.getTime())) continue;
      if (ts < MONTH_START) {
        exitedMonth = true;
        break;
      }
      sentThisMonth++;
      if (ts >= DAY_START) sentToday++;
    }

    if (exitedMonth || !r.json.has_more) break;
    cursor = emails[emails.length - 1]?.id;
    if (!cursor) break;
    pages++;
  }

  const RS = LIMITS.resend.free;
  return svc(
    "resend",
    "Resend (email)",
    true,
    [
      asMetric("Emails aujourd'hui", sentToday, RS.emailsPerDay, "emails", "account-day"),
      asMetric("Emails ce mois", sentThisMonth, RS.emailsPerMonth, "emails", "account-month"),
    ],
    pages >= MAX_PAGES ? "Pagination atteinte (résultats peut-être incomplets - usage très élevé ?)" : null,
    null,
    { resendKeyJustCreated: justCreated },
  );
}

// ─── Service: Vercel (plan-aware - partial) ──────────────────────────
//
// Plan detection: `/v2/user` returns `user.billing.plan` for the personal
// account, but most projects live on a team. We resolve the user's default
// team and read its `billing.plan` - that's the plan that actually applies
// to deployments. Falls back to user plan if no default team.
//
// What we surface: plan label, deployment count this month, project count.
// Bandwidth / function-time aren't exposed via API on any plan (the
// `/v1/usage` endpoint rejects every reasonable date range with
// `invalid_time_range`), so we always link to the dashboard for those.
async function fetchVercel() {
  // Vercel CLI stores the token at ~/.local/share/com.vercel.cli/auth.json (Linux)
  // or %APPDATA%\com.vercel.cli\auth.json (Windows). Reading via the standard
  // Vercel pattern below. Alternative: set VERCEL_TOKEN env var (Personal
  // Access Token from https://vercel.com/account/tokens) - useful if the CLI
  // isn't installed.
  const token = readUserEnv("VERCEL_TOKEN") || readVercelCliToken();
  if (!token) return svc("vercel", "Vercel (hébergement)", false, [], "Vercel CLI non connectée (lance `vercel login` ou définis VERCEL_TOKEN)");

  // Resolve user + default team + plan in one shot
  const userRes = await fetchJson("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    return svc("vercel", "Vercel (hébergement)", false, [], `API Vercel: HTTP ${userRes.status} - token Vercel invalide ou expiré (lance \`vercel login\`)`);
  }
  const user = userRes.json.user || {};
  const teamId = user.defaultTeamId || null;
  let plan = user.billing?.plan || null;
  let teamSlug = null;
  if (teamId) {
    const teamRes = await fetchJson(`https://api.vercel.com/v2/teams/${teamId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (teamRes.ok) {
      plan = teamRes.json.billing?.plan || plan;
      teamSlug = teamRes.json.slug || null;
    }
  }
  plan = plan || "hobby";

  const teamSuffix = teamId ? `&teamId=${teamId}` : "";

  // Count deployments this month
  const since = MONTH_START.getTime();
  let depCount = 0;
  let depCursor = null;
  let pages = 0;
  while (pages < 50) {
    const url = `https://api.vercel.com/v6/deployments?since=${since}&limit=100${teamSuffix}${depCursor ? `&until=${depCursor}` : ""}`;
    const r = await fetchJson(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!r.ok) break;
    const deps = r.json.deployments || [];
    depCount += deps.length;
    if (!r.json.pagination?.next || deps.length < 100) break;
    depCursor = r.json.pagination.next;
    pages++;
  }

  // Count projects
  const projRes = await fetchJson(`https://api.vercel.com/v9/projects?limit=100${teamSuffix}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const projectCount = projRes.ok ? (projRes.json.projects || []).length : null;

  const dashboardUrl = teamSlug
    ? `https://vercel.com/${teamSlug}/~/usage`
    : "https://vercel.com/dashboard/usage";

  // Plan-aware French label
  const planFr = plan === "hobby" ? "Hobby (gratuit)"
    : plan === "pro" ? "Pro"
    : plan === "enterprise" ? "Enterprise"
    : plan;

  const planNote = plan === "hobby"
    ? `Plan ${planFr} détecté. Limites : 100 GB bandwidth / 100 h function-time / 6000 min build par mois. Ces métriques ne sont pas exposées en API - voir ${dashboardUrl}.`
    : plan === "pro"
      ? `Plan ${planFr} détecté. Inclus : 1 TB bandwidth + 1000 GB-h function-time + 24k min build par mois (dépassement facturé à l'usage). Les chiffres détaillés ne sont pas exposés en API - voir ${dashboardUrl}.`
      : `Plan ${planFr} détecté. Quotas définis par contrat. Voir ${dashboardUrl}.`;

  return svc(
    "vercel",
    "Vercel (hébergement)",
    "partial",
    [
      asMetric("Déploiements ce mois", depCount, null, "deploys", "account-month"),
      ...(projectCount !== null ? [asMetric("Projets", projectCount, null, "projets", "account")] : []),
    ],
    planNote,
  );
}

function readVercelCliToken() {
  // Try a few candidate paths - Vercel CLI's auth path has shifted between
  // versions (with/without "Data" subfolder).
  const candidates = process.platform === "win32"
    ? [
        `${process.env.APPDATA}\\com.vercel.cli\\Data\\auth.json`,
        `${process.env.APPDATA}\\com.vercel.cli\\auth.json`,
      ]
    : process.platform === "darwin"
      ? [
          `${process.env.HOME}/Library/Application Support/com.vercel.cli/auth.json`,
          `${process.env.HOME}/.local/share/com.vercel.cli/auth.json`,
        ]
      : [
          `${process.env.HOME}/.local/share/com.vercel.cli/auth.json`,
          `${process.env.HOME}/.config/com.vercel.cli/auth.json`,
        ];

  for (const path of candidates) {
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (data.token) return data.token;
    } catch {
      /* try next */
    }
  }
  return null;
}

// ─── Service struct helper ───────────────────────────────────────────
function svc(service, label, available, metrics, note = null, breakdown = null, extras = null) {
  return { service, label, available, metrics, note, breakdown, ...(extras || {}) };
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  // Run all fetchers in parallel, isolate errors
  const fetcherPromises = [
    safeRun("neon", fetchNeon),
    safeRun("cloudflare", fetchCloudflare), // returns array of 2
    safeRun("brevo", fetchBrevo),
    safeRun("resend", fetchResend),
    safeRun("vercel", fetchVercel),
  ];

  const settled = await Promise.allSettled(fetcherPromises);

  const services = [];
  let resendKeyJustCreated = false;
  for (const res of settled) {
    if (res.status !== "fulfilled") continue;
    const v = res.value;
    if (Array.isArray(v)) {
      for (const s of v) {
        if (s.resendKeyJustCreated) resendKeyJustCreated = true;
        services.push(s);
      }
    } else {
      if (v.resendKeyJustCreated) resendKeyJustCreated = true;
      services.push(v);
    }
  }

  const out = {
    fetchedAt: NOW.toISOString(),
    billingCycle,
    services,
    selfHealing: { resendKeyJustCreated },
  };

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

async function safeRun(name, fn) {
  try {
    return await fn();
  } catch (e) {
    return svc(name, name, false, [], `Erreur: ${e.message?.slice(0, 200)}`);
  }
}

main().catch((e) => {
  process.stderr.write(JSON.stringify({ _error: e.message }) + "\n");
  process.exit(1);
});
