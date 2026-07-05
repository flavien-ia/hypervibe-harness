#!/usr/bin/env node
// discover-resources.mjs - Phase 1 of /delete-project, all 16 scans in parallel.
//
// Usage:
//   node discover-resources.mjs --project <name> [--cloudflare-account-id <id>]
//
// Outputs a single JSON object to stdout with the full inventory of every
// piece of cloud infrastructure tied to the project, plus a list of detected
// third-party services (Sentry, PostHog, etc.) that the user needs to clean
// manually. The LLM consumes this JSON directly to build the Phase 2
// presentation + scope question.
//
// Design:
// - Every scan is fault-tolerant: a single failing API call (Render down,
//   Upstash CLI not installed, etc.) does NOT abort the discovery. The
//   corresponding section gets `{ error: "..." }` instead.
// - No mutations are ever performed here - this script is pure read-only.
// - All scans run via Promise.all so total wall time = max(individual scan).

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSecret } from "../vault/vault.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = join(__dirname, "..", "..");
const TEMPLATES_DIR = join(PLUGIN_ROOT, "templates", "delete-project");

// ─── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const PROJECT = arg("--project");
if (!PROJECT) {
  console.error("Usage: node discover-resources.mjs --project <name>");
  process.exit(1);
}
const PROJECT_LOWER = PROJECT.toLowerCase();
// Local project directory: passed by the skill (which detects it), else the
// current working directory. No hardcoded workspace root, so this works on any
// machine/OS (Mac, Windows, Linux).
const PROJECT_DIR = arg("--project-dir") || process.cwd();
let CF_ACCOUNT_ID = arg("--cloudflare-account-id") || process.env.CLOUDFLARE_ACCOUNT_ID || "";

// ─── env helpers ───────────────────────────────────────────────────────────
function readUserEnvSync(name) {
  const helper = join(PLUGIN_ROOT, "scripts", "_read-user-env.mjs");
  if (!existsSync(helper)) return process.env[name] || "";
  const r = spawnSync("node", [helper, name], { encoding: "utf8" });
  if (r.status !== 0) return process.env[name] || "";
  return (r.stdout || "").trim();
}
const CLOUDFLARE_API_TOKEN = (() => { try { return getSecret("CLOUDFLARE", "api_token"); } catch { return readUserEnvSync("CLOUDFLARE_API_TOKEN") || readUserEnvSync("CF_API_TOKEN") || process.env.CLOUDFLARE_API_TOKEN || ""; } })();
const NEON_API_KEY = (() => { try { return getSecret("NEON", "api_key"); } catch { return readUserEnvSync("NEON_API_KEY") || process.env.NEON_API_KEY || ""; } })();
const RENDER_API_KEY = readUserEnvSync("RENDER_API_KEY") || process.env.RENDER_API_KEY || "";
const STRIPE_SECRET_KEY = readUserEnvSync("STRIPE_SECRET_KEY") || process.env.STRIPE_SECRET_KEY || "";

// ─── shared HTTP helper ────────────────────────────────────────────────────
async function httpJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    return { __error: `HTTP ${res.status}`, body: await res.text().catch(() => "") };
  }
  return res.json();
}

function runCmd(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { shell: true, ...opts });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
    proc.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }));
  });
}

// ─── 1. Vercel ─────────────────────────────────────────────────────────────
async function scanVercel() {
  try {
    const r = await runCmd("vercel", ["projects", "ls"]);
    if (r.code !== 0) return { found: false, error: r.stderr.slice(0, 300) };
    // The Vercel CLI prints the project table to STDERR (only structured data,
    // if any, lands on stdout). Matching stdout alone misses every project -
    // search both streams, else /delete-project silently skips the Vercel
    // project and leaves it orphaned.
    const haystack = `${r.stdout}\n${r.stderr}`.toLowerCase();
    const found = haystack.includes(PROJECT_LOWER);
    return { found, raw: found ? `${r.stdout}\n${r.stderr}`.trim() : null };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}

// ─── 2. Neon (REST API, not MCP - script context) ──────────────────────────
async function scanNeon() {
  if (!NEON_API_KEY) return { found: false, error: "NEON_API_KEY missing" };
  try {
    const data = await httpJson(`https://console.neon.tech/api/v2/projects?search=${encodeURIComponent(PROJECT)}`, {
      headers: { Authorization: `Bearer ${NEON_API_KEY}` },
    });
    if (data.__error) return { found: false, error: data.__error };
    const projects = (data.projects || []).filter((p) => p.name.toLowerCase().includes(PROJECT_LOWER));
    if (projects.length === 0) return { found: false };
    return {
      found: true,
      projects: projects.map((p) => ({ id: p.id, name: p.name, region: p.region_id, createdAt: p.created_at })),
    };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}

// ─── 3. Cloudflare Workers ─────────────────────────────────────────────────
async function scanWorkers() {
  if (!CLOUDFLARE_API_TOKEN) return { found: false, error: "CLOUDFLARE_API_TOKEN missing" };
  try {
    const data = await httpJson(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts`,
      { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } },
    );
    if (data.__error) return { found: false, error: data.__error };
    const workers = (data.result || []).filter((s) => s.id.toLowerCase().includes(PROJECT_LOWER));
    return { found: workers.length > 0, workers: workers.map((w) => ({ id: w.id, modifiedOn: w.modified_on })) };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}

// ─── 4. Cloudflare R2 (global + EU) ────────────────────────────────────────
async function scanR2() {
  const buckets = [];
  for (const jurisdiction of ["global", "eu"]) {
    try {
      const cmdArgs = ["r2", "bucket", "list"];
      if (jurisdiction === "eu") cmdArgs.push("-J", "eu");
      const r = await runCmd("wrangler", cmdArgs);
      if (r.code !== 0) continue;
      // wrangler r2 bucket list outputs lines with bucket names
      const matches = r.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.toLowerCase().includes(PROJECT_LOWER))
        .map((l) => ({ name: l.split(/\s+/)[0], jurisdiction }));
      buckets.push(...matches);
    } catch {
      // skip
    }
  }
  return { found: buckets.length > 0, buckets };
}

// ─── 5. Cloudflare DNS (all zones) ─────────────────────────────────────────
async function scanDns() {
  if (!CLOUDFLARE_API_TOKEN) return { found: false, error: "CLOUDFLARE_API_TOKEN missing" };
  try {
    const zonesData = await httpJson(
      "https://api.cloudflare.com/client/v4/zones?per_page=50",
      { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } },
    );
    if (zonesData.__error) return { found: false, error: zonesData.__error };
    const zones = zonesData.result || [];
    const allRecords = [];
    await Promise.all(
      zones.map(async (z) => {
        const recs = await httpJson(
          `https://api.cloudflare.com/client/v4/zones/${z.id}/dns_records?per_page=200`,
          { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } },
        );
        if (recs.__error) return;
        for (const r of recs.result || []) {
          const nameMatches = r.name.toLowerCase().includes(PROJECT_LOWER);
          const contentMatches = (r.content || "").toLowerCase().includes(PROJECT_LOWER);
          if (nameMatches || contentMatches) {
            allRecords.push({
              zoneId: z.id,
              zoneName: z.name,
              recordId: r.id,
              type: r.type,
              name: r.name,
              content: r.content,
            });
          }
        }
      }),
    );
    return { found: allRecords.length > 0, records: allRecords, zonesScanned: zones.length };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}

// ─── 6. Scheduled Neon backups (unified hypervibe-jobs registry, with legacy
//        db-backup worker fallback) ─────────────────────────────────────────
// Unified: ~/.hypervibe-jobs/jobs.js holds a "neon-backups" job with a
// targets[] array. Legacy: ~/.db-backup-worker/wrangler.toml holds a
// BACKUP_TARGETS JSON env var. Both are reported with the same resource shape
// ({ isTarget, entry?, totalTargets?, error? }) plus a `source` field so
// downstream steps know which infrastructure holds the registration.
function readUnifiedBackupTargets() {
  const jobsPath = join(homedir(), ".hypervibe-jobs", "jobs.js");
  if (!existsSync(jobsPath)) return { exists: false };
  try {
    const raw = readFileSync(jobsPath, "utf8");
    const m = raw.match(/export default\s*([\s\S]*?);?\s*$/);
    if (!m) return { exists: true, error: "jobs.js not parseable" };
    const registry = JSON.parse(m[1]);
    const job = (registry.jobs || []).find((j) => j.name === "neon-backups");
    return { exists: true, targets: job && Array.isArray(job.targets) ? job.targets : [] };
  } catch (e) {
    return { exists: true, error: String(e) };
  }
}

function scanDbBackupLegacy() {
  const wranglerToml = join(homedir(), ".db-backup-worker", "wrangler.toml");
  if (!existsSync(wranglerToml)) return { isTarget: false, error: "wrangler.toml not found", source: "db-backup-worker" };
  try {
    const content = readFileSync(wranglerToml, "utf8");
    // Extract BACKUP_TARGETS JSON and find this project
    const targetsMatch = content.match(/BACKUP_TARGETS\s*=\s*'(\[[^']+\])'/);
    if (!targetsMatch) return { isTarget: false, error: "BACKUP_TARGETS not parseable", source: "db-backup-worker" };
    const targets = JSON.parse(targetsMatch[1]);
    const entry = targets.find((t) => t.name.toLowerCase() === PROJECT_LOWER);
    return entry
      ? { isTarget: true, entry, totalTargets: targets.length, source: "db-backup-worker" }
      : { isTarget: false, totalTargets: targets.length, source: "db-backup-worker" };
  } catch (e) {
    return { isTarget: false, error: String(e), source: "db-backup-worker" };
  }
}

async function scanDbBackup() {
  const unified = readUnifiedBackupTargets();
  if (unified.exists && !unified.error) {
    const entry = unified.targets.find((t) => (t.name || "").toLowerCase() === PROJECT_LOWER);
    if (entry) return { isTarget: true, entry, totalTargets: unified.targets.length, source: "hypervibe-jobs" };
    // Not in the unified registry: still check the legacy worker (setups not
    // yet migrated may hold the registration there).
    const legacy = scanDbBackupLegacy();
    if (legacy.isTarget) return legacy;
    return { isTarget: false, totalTargets: unified.targets.length, source: "hypervibe-jobs" };
  }
  return scanDbBackupLegacy();
}

// ─── 7. Render services ────────────────────────────────────────────────────
async function scanRender() {
  if (!RENDER_API_KEY) return { found: false, error: "RENDER_API_KEY missing" };
  try {
    const data = await httpJson("https://api.render.com/v1/services?limit=100", {
      headers: { Authorization: `Bearer ${RENDER_API_KEY}` },
    });
    if (data.__error) return { found: false, error: data.__error };
    const services = (Array.isArray(data) ? data : data.services || [])
      .map((d) => d.service || d)
      .filter((s) => (s.name || "").toLowerCase().includes(PROJECT_LOWER));
    return { found: services.length > 0, services: services.map((s) => ({ id: s.id, name: s.name, type: s.type, suspended: s.suspended })) };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}

// ─── 8. Stripe webhooks + products ─────────────────────────────────────────
async function scanStripe() {
  if (!STRIPE_SECRET_KEY) return { found: false, error: "STRIPE_SECRET_KEY missing" };
  const auth = Buffer.from(`${STRIPE_SECRET_KEY}:`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };
  try {
    const [webhooksData, productsData] = await Promise.all([
      httpJson("https://api.stripe.com/v1/webhook_endpoints?limit=100", { headers }),
      httpJson("https://api.stripe.com/v1/products?limit=100", { headers }),
    ]);
    const webhooks = ((webhooksData.data) || []).filter((w) => (w.url || "").toLowerCase().includes(PROJECT_LOWER));
    const products = ((productsData.data) || []).filter((p) => (p.name || "").toLowerCase().includes(PROJECT_LOWER));
    return {
      webhooksFound: webhooks.length > 0,
      webhooks: webhooks.map((w) => ({ id: w.id, url: w.url, status: w.status })),
      productsFound: products.length > 0,
      products: products.map((p) => ({ id: p.id, name: p.name, active: p.active })),
    };
  } catch (e) {
    return { webhooksFound: false, productsFound: false, error: String(e) };
  }
}

// ─── 9. Upstash (read ~/.upstash.json for creds) ───────────────────────────
async function scanUpstash() {
  const credsPath = join(homedir(), ".upstash.json");
  if (!existsSync(credsPath)) return { found: false, error: "~/.upstash.json missing" };
  try {
    const creds = JSON.parse(readFileSync(credsPath, "utf8"));
    if (!creds.email || !creds.apiKey) return { found: false, error: "invalid creds file" };
    const auth = Buffer.from(`${creds.email}:${creds.apiKey}`).toString("base64");
    const data = await httpJson("https://api.upstash.com/v2/redis/databases", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (data.__error) return { found: false, error: data.__error };
    const dbs = (Array.isArray(data) ? data : []).filter((d) => (d.database_name || "").toLowerCase().includes(PROJECT_LOWER));
    return { found: dbs.length > 0, databases: dbs.map((d) => ({ id: d.database_id, name: d.database_name })) };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}

// ─── 10. Cloudflare Email Routing ──────────────────────────────────────────
async function scanEmailRouting() {
  if (!CLOUDFLARE_API_TOKEN) return { found: false, error: "CLOUDFLARE_API_TOKEN missing" };
  try {
    const zonesData = await httpJson(
      "https://api.cloudflare.com/client/v4/zones?per_page=50",
      { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } },
    );
    if (zonesData.__error) return { found: false, error: zonesData.__error };
    const zones = zonesData.result || [];
    const rules = [];
    await Promise.all(
      zones.map(async (z) => {
        const data = await httpJson(
          `https://api.cloudflare.com/client/v4/zones/${z.id}/email/routing/rules?per_page=200`,
          { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } },
        );
        if (data.__error) return;
        for (const r of data.result || []) {
          const matchersStr = JSON.stringify(r.matchers || []);
          const actionsStr = JSON.stringify(r.actions || []);
          if (
            (r.name || "").toLowerCase().includes(PROJECT_LOWER) ||
            matchersStr.toLowerCase().includes(PROJECT_LOWER) ||
            actionsStr.toLowerCase().includes(PROJECT_LOWER)
          ) {
            rules.push({
              zoneId: z.id,
              zoneName: z.name,
              tag: r.tag,
              name: r.name,
              matchers: r.matchers,
              actions: r.actions,
              enabled: r.enabled,
            });
          }
        }
      }),
    );
    return { found: rules.length > 0, rules };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}

// ─── 11. Env vars scan (Vercel + local .env) + third-party detection ───────
async function scanEnvVars(localDirPath) {
  const knownVarsPath = join(TEMPLATES_DIR, "known-env-vars.json");
  const servicesPath = join(TEMPLATES_DIR, "third-party-services.json");
  const knownVars = JSON.parse(readFileSync(knownVarsPath, "utf8")).vars;
  const knownSet = new Set(knownVars);
  const servicesList = JSON.parse(readFileSync(servicesPath, "utf8")).services;

  // Try to pull env vars from Vercel (production scope)
  let envVarNames = new Set();
  const sources = [];
  if (localDirPath && existsSync(localDirPath)) {
    const tempPath = join(localDirPath, ".env.delete-check");
    try {
      const r = await runCmd("vercel", ["env", "pull", ".env.delete-check", "--environment=production", "--yes"], { cwd: localDirPath });
      if (r.code === 0 && existsSync(tempPath)) {
        const content = readFileSync(tempPath, "utf8");
        for (const line of content.split("\n")) {
          const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
          if (m) envVarNames.add(m[1]);
        }
        sources.push("vercel-production");
        unlinkSync(tempPath); // ALWAYS delete the temp file (contains secrets)
      }
    } catch (e) {
      // Ignore - fall back to local .env only
      if (existsSync(tempPath)) {
        try { unlinkSync(tempPath); } catch {}
      }
    }
    // Also parse local .env if present (might have stuff Vercel doesn't)
    const localEnv = join(localDirPath, ".env");
    if (existsSync(localEnv)) {
      const content = readFileSync(localEnv, "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
        if (m) envVarNames.add(m[1]);
      }
      sources.push("local-.env");
    }
  }

  // Diff with whitelist
  const allVars = [...envVarNames].sort();
  const unknown = allVars.filter((v) => !knownSet.has(v));

  // Match unknown vars against third-party services lookup
  const thirdParty = [];
  const matched = new Set();
  for (const svc of servicesList) {
    const re = new RegExp(svc.pattern);
    for (const v of unknown) {
      if (re.test(v) && !matched.has(v)) {
        matched.add(v);
        thirdParty.push({ envVar: v, ...svc });
      }
    }
  }
  // Anything left in unknown that didn't match a known service pattern
  const trulyUnknown = unknown.filter((v) => !matched.has(v));

  return {
    sources,
    allVarsCount: allVars.length,
    hypervibeStackCount: allVars.filter((v) => knownSet.has(v)).length,
    thirdPartyDetected: thirdParty,
    unknownUnclassified: trulyUnknown,
    // Special signal: AUTH_GOOGLE_ID present = OAuth Google client to clean manually
    hasGoogleOAuth: envVarNames.has("AUTH_GOOGLE_ID"),
    hasGitHubOAuth: envVarNames.has("AUTH_GITHUB_ID"),
  };
}

// ─── 12. Local dir + package.json deps ─────────────────────────────────────
function scanLocalDir() {
  const path = PROJECT_DIR;
  if (!existsSync(path)) return { exists: false, path };
  const pkgJsonPath = join(path, "package.json");
  let deps = [];
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      deps = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
      ];
    } catch {}
  }
  return { exists: true, path, dependencies: deps };
}

// ─── 13. Memory files (Claude project memory) ──────────────────────────────
function scanMemory() {
  // Scan every Claude project memory dir (~/.claude/projects/*/memory) instead
  // of assuming a fixed workspace slug, so this works on any machine/OS. Each
  // match stores its full path so execute-deletions acts without re-deriving it.
  const projectsRoot = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsRoot)) return { files: [], scanned: 0 };
  const matches = [];
  let scanned = 0;
  try {
    for (const slug of readdirSync(projectsRoot)) {
      const memDir = join(projectsRoot, slug, "memory");
      if (!existsSync(memDir)) continue;
      let mdFiles;
      try { mdFiles = readdirSync(memDir).filter((f) => f.endsWith(".md")); } catch { continue; }
      for (const f of mdFiles) {
        scanned++;
        let content = "";
        try { content = readFileSync(join(memDir, f), "utf8"); } catch { continue; }
        if (content.toLowerCase().includes(PROJECT_LOWER) || f.toLowerCase().includes(PROJECT_LOWER)) {
          matches.push({
            filename: f,
            dir: memDir,
            path: join(memDir, f),
            isProjectSpecific: f.toLowerCase().includes(PROJECT_LOWER),
            mentionsCount: (content.toLowerCase().match(new RegExp(PROJECT_LOWER, "g")) || []).length,
          });
        }
      }
    }
  } catch (e) {
    return { files: [], error: String(e) };
  }
  return { files: matches, scanned };
}

// ─── 14. GitHub repo ───────────────────────────────────────────────────────
async function scanGitHub() {
  try {
    const who = await runCmd("gh", ["api", "user", "--jq", ".login"]);
    const owner = (who.stdout || "").trim();
    if (!owner) return { exists: false };
    const r = await runCmd("gh", ["repo", "view", `${owner}/${PROJECT}`, "--json", "name,url,visibility,isPrivate"]);
    if (r.code !== 0) return { exists: false };
    const data = JSON.parse(r.stdout);
    return { exists: true, ...data };
  } catch (e) {
    return { exists: false, error: String(e) };
  }
}

// ─── orchestrator ──────────────────────────────────────────────────────────
const startedAt = Date.now();
const local = scanLocalDir();
const memory = scanMemory();

// Cloudflare account id: provided via --cloudflare-account-id / CLOUDFLARE_ACCOUNT_ID,
// otherwise auto-detected from the API token (first account on the token).
async function resolveCfAccountId() {
  if (CF_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) return;
  const data = await httpJson("https://api.cloudflare.com/client/v4/accounts", {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  });
  const id = data?.result?.[0]?.id;
  if (id) CF_ACCOUNT_ID = id;
}
await resolveCfAccountId();

const [
  vercel,
  neon,
  workers,
  r2,
  dns,
  dbBackup,
  render,
  stripe,
  upstash,
  emailRouting,
  envVars,
  github,
] = await Promise.all([
  scanVercel(),
  scanNeon(),
  scanWorkers(),
  scanR2(),
  scanDns(),
  scanDbBackup(),
  scanRender(),
  scanStripe(),
  scanUpstash(),
  scanEmailRouting(),
  scanEnvVars(local.exists ? local.path : null),
  scanGitHub(),
]);

const elapsedMs = Date.now() - startedAt;

const report = {
  project: PROJECT,
  scannedAt: new Date().toISOString(),
  scanDurationMs: elapsedMs,
  cloudflareAccountId: CF_ACCOUNT_ID,
  vercel,
  neon,
  workers,
  r2,
  dns,
  dbBackup,
  render,
  stripe,
  upstash,
  emailRouting,
  envVars,
  localDir: local,
  memory,
  github,
};

console.log(JSON.stringify(report, null, 2));
