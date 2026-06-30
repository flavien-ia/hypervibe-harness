#!/usr/bin/env node
// execute-deletions.mjs - Phase 3 of /delete-project, all deletions in
// parallel where safe.
//
// Usage:
//   node execute-deletions.mjs --inventory <path.json> --scope <json-array>
//
// Where:
//   --inventory  : path to the JSON file produced by discover-resources.mjs
//   --scope      : JSON array of categories to delete. Subset of:
//                  ["vercel","neon","r2","workers","dns","db-backup",
//                   "render","stripe-webhooks","upstash","email-routing",
//                   "memory"]
//                  Pass ["all"] as a shortcut to delete everything.
//
// Outputs a JSON report to stdout:
//   {
//     deleted: { vercel: {...}, neon: {...}, ... },
//     failed:  { ... },
//     skipped: { ... }
//   }
//
// Design:
// - Parallel where safe (3.1-3.5 + 3.7-3.10 all independent).
// - Sequential where needed: db-backup AFTER neon (since the db-backup
//   removal references the Neon projectId), memory AT THE END.
// - Each operation is fault-tolerant: one failure doesn't abort the whole
//   batch. The user can re-run with a narrower scope to retry.
// - NEVER touches the local project dir (sandbox blocks it). The LLM
//   reports the path in the final summary instead.

import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSecret } from "../vault/vault.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = join(__dirname, "..", "..");

// ─── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const INVENTORY_PATH = arg("--inventory");
const SCOPE_JSON = arg("--scope");
if (!INVENTORY_PATH || !SCOPE_JSON) {
  console.error("Usage: node execute-deletions.mjs --inventory <path.json> --scope <json-array>");
  process.exit(1);
}
if (!existsSync(INVENTORY_PATH)) {
  console.error(`Inventory file not found: ${INVENTORY_PATH}`);
  process.exit(1);
}
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
let scope;
try {
  scope = JSON.parse(SCOPE_JSON);
} catch {
  console.error(`Invalid --scope JSON: ${SCOPE_JSON}`);
  process.exit(1);
}
const ALL_CATEGORIES = ["vercel", "neon", "r2", "workers", "dns", "db-backup", "render", "stripe-webhooks", "upstash", "email-routing", "memory"];
if (scope.length === 1 && scope[0] === "all") scope = ALL_CATEGORIES;
const scopeSet = new Set(scope);

const PROJECT = inventory.project;
const CF_ACCOUNT_ID = inventory.cloudflareAccountId;

// ─── env ───────────────────────────────────────────────────────────────────
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

// ─── helpers ───────────────────────────────────────────────────────────────
async function httpDelete(url, headers = {}) {
  try {
    const res = await fetch(url, { method: "DELETE", headers });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, status: -1, body: String(e) };
  }
}

function runCmdSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { shell: true, encoding: "utf8", ...opts });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// ─── deletion functions ────────────────────────────────────────────────────

async function deleteVercel() {
  if (!inventory.vercel?.found) return { status: "skipped", reason: "not found in inventory" };
  // `vercel project rm` has no --yes flag; pipe "y" via stdin
  const r = spawnSync("sh", ["-c", `echo y | vercel project rm "${PROJECT}"`], { encoding: "utf8" });
  if (r.status === 0) return { status: "deleted", name: PROJECT };
  // On Windows fall back to powershell
  const r2 = spawnSync(`echo y | vercel project rm "${PROJECT}"`, { shell: true, encoding: "utf8" });
  if (r2.status === 0) return { status: "deleted", name: PROJECT };
  return { status: "failed", error: (r2.stderr || r.stderr || "").slice(0, 500) };
}

async function deleteNeon() {
  if (!inventory.neon?.found) return { status: "skipped", reason: "not found in inventory" };
  if (!NEON_API_KEY) return { status: "failed", error: "NEON_API_KEY missing" };
  const results = [];
  for (const p of inventory.neon.projects) {
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${p.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${NEON_API_KEY}` },
    });
    if (r.ok) {
      results.push({ id: p.id, name: p.name, status: "deleted" });
    } else {
      results.push({ id: p.id, name: p.name, status: "failed", error: await r.text().catch(() => `HTTP ${r.status}`) });
    }
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteR2() {
  if (!inventory.r2?.found) return { status: "skipped", reason: "not found in inventory" };
  const results = [];
  for (const bucket of inventory.r2.buckets) {
    const cmdArgs = ["r2", "bucket", "delete", bucket.name];
    if (bucket.jurisdiction === "eu") cmdArgs.push("-J", "eu");
    const r = runCmdSync("wrangler", cmdArgs);
    if (r.code === 0) {
      results.push({ ...bucket, status: "deleted" });
    } else {
      results.push({ ...bucket, status: "failed", error: r.stderr.slice(0, 300) });
    }
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteWorkers() {
  if (!inventory.workers?.found) return { status: "skipped", reason: "not found in inventory" };
  if (!CLOUDFLARE_API_TOKEN) return { status: "failed", error: "CLOUDFLARE_API_TOKEN missing" };
  const results = [];
  for (const w of inventory.workers.workers) {
    const r = await httpDelete(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${w.id}`,
      { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    );
    results.push({ id: w.id, status: r.ok ? "deleted" : "failed", ...(r.ok ? {} : { error: r.body.slice(0, 300) }) });
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteDns() {
  if (!inventory.dns?.found) return { status: "skipped", reason: "not found in inventory" };
  if (!CLOUDFLARE_API_TOKEN) return { status: "failed", error: "CLOUDFLARE_API_TOKEN missing" };
  const results = [];
  for (const rec of inventory.dns.records) {
    const r = await httpDelete(
      `https://api.cloudflare.com/client/v4/zones/${rec.zoneId}/dns_records/${rec.recordId}`,
      { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    );
    results.push({ recordId: rec.recordId, name: rec.name, status: r.ok ? "deleted" : "failed", ...(r.ok ? {} : { error: r.body.slice(0, 300) }) });
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteDbBackup() {
  if (!inventory.dbBackup?.isTarget) return { status: "skipped", reason: "not a backup target" };
  // Delegate to the dedicated script
  const r = runCmdSync("node", [
    join(__dirname, "db-backup-remove-target.mjs"),
    "--project",
    PROJECT,
  ]);
  if (r.code !== 0) {
    return { status: "failed", error: (r.stderr || r.stdout).slice(0, 500) };
  }
  try {
    return { status: "deleted", ...JSON.parse(r.stdout) };
  } catch {
    return { status: "deleted", raw: r.stdout.slice(0, 500) };
  }
}

async function deleteRender() {
  if (!inventory.render?.found) return { status: "skipped", reason: "not found in inventory" };
  if (!RENDER_API_KEY) return { status: "failed", error: "RENDER_API_KEY missing" };
  const results = [];
  for (const s of inventory.render.services) {
    const r = await httpDelete(`https://api.render.com/v1/services/${s.id}`, {
      Authorization: `Bearer ${RENDER_API_KEY}`,
    });
    results.push({ id: s.id, name: s.name, status: r.ok ? "deleted" : "failed", ...(r.ok ? {} : { error: r.body.slice(0, 300) }) });
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteStripeWebhooks() {
  if (!inventory.stripe?.webhooksFound) return { status: "skipped", reason: "no webhooks found" };
  if (!STRIPE_SECRET_KEY) return { status: "failed", error: "STRIPE_SECRET_KEY missing" };
  const auth = Buffer.from(`${STRIPE_SECRET_KEY}:`).toString("base64");
  const results = [];
  for (const w of inventory.stripe.webhooks) {
    const r = await httpDelete(`https://api.stripe.com/v1/webhook_endpoints/${w.id}`, {
      Authorization: `Basic ${auth}`,
    });
    results.push({ id: w.id, url: w.url, status: r.ok ? "deleted" : "failed", ...(r.ok ? {} : { error: r.body.slice(0, 300) }) });
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteUpstash() {
  if (!inventory.upstash?.found) return { status: "skipped", reason: "not found in inventory" };
  const credsPath = join(homedir(), ".upstash.json");
  if (!existsSync(credsPath)) return { status: "failed", error: "~/.upstash.json missing" };
  let creds;
  try {
    creds = JSON.parse(readFileSync(credsPath, "utf8"));
  } catch (e) {
    return { status: "failed", error: `~/.upstash.json invalid: ${e.message}` };
  }
  const auth = Buffer.from(`${creds.email}:${creds.apiKey}`).toString("base64");
  const results = [];
  for (const db of inventory.upstash.databases) {
    const r = await httpDelete(`https://api.upstash.com/v2/redis/database/${db.id}`, {
      Authorization: `Basic ${auth}`,
    });
    results.push({ id: db.id, name: db.name, status: r.ok ? "deleted" : "failed", ...(r.ok ? {} : { error: r.body.slice(0, 300) }) });
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteEmailRouting() {
  if (!inventory.emailRouting?.found) return { status: "skipped", reason: "not found in inventory" };
  if (!CLOUDFLARE_API_TOKEN) return { status: "failed", error: "CLOUDFLARE_API_TOKEN missing" };
  const results = [];
  for (const rule of inventory.emailRouting.rules) {
    const r = await httpDelete(
      `https://api.cloudflare.com/client/v4/zones/${rule.zoneId}/email/routing/rules/${rule.tag}`,
      { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    );
    results.push({ tag: rule.tag, name: rule.name, status: r.ok ? "deleted" : "failed", ...(r.ok ? {} : { error: r.body.slice(0, 300) }) });
  }
  const anyFail = results.some((r) => r.status === "failed");
  return { status: anyFail ? "partial" : "deleted", results };
}

async function deleteMemory() {
  if (!inventory.memory?.files || inventory.memory.files.length === 0) {
    return { status: "skipped", reason: "no memory files found" };
  }
  const results = [];
  const dirs = new Set();
  // Delete project-specific files only (those whose filename contains the project).
  // Paths come from the inventory (discover-resources scans every project memory
  // dir), so no hardcoded workspace slug and fully cross-platform.
  for (const f of inventory.memory.files) {
    const fpath = f.path || (f.dir ? join(f.dir, f.filename) : null);
    if (f.dir) dirs.add(f.dir);
    if (f.isProjectSpecific && fpath) {
      try {
        rmSync(fpath);
        results.push({ file: f.filename, status: "deleted" });
      } catch (e) {
        results.push({ file: f.filename, status: "failed", error: String(e) });
      }
    } else {
      // File mentions project but isn't named after it - flag for LLM review
      results.push({ file: f.filename, status: "kept", reason: "not project-specific, references may be incidental - LLM should review" });
    }
  }
  // Trim each MEMORY.md index that references this project (surgical)
  for (const dir of dirs) {
    const indexPath = join(dir, "MEMORY.md");
    if (!existsSync(indexPath)) continue;
    try {
      const original = readFileSync(indexPath, "utf8");
      const lines = original.split("\n");
      const filtered = lines.filter((l) => !l.toLowerCase().includes(PROJECT.toLowerCase()));
      const removed = lines.length - filtered.length;
      if (removed > 0) {
        writeFileSync(indexPath, filtered.join("\n"));
        results.push({ file: "MEMORY.md (index)", status: "trimmed", linesRemoved: removed });
      }
    } catch (e) {
      results.push({ file: "MEMORY.md (index)", status: "failed", error: String(e) });
    }
  }
  return { status: results.some((r) => r.status === "failed") ? "partial" : "deleted", results };
}

// ─── orchestration ─────────────────────────────────────────────────────────
// Parallel batch 1: independent operations (vercel, r2, workers, dns,
// render, stripe-webhooks, upstash, email-routing).
// Sequential after: neon (needed for db-backup), then db-backup, then memory.

const startedAt = Date.now();
const report = {
  project: PROJECT,
  startedAt: new Date().toISOString(),
  scope,
  deleted: {},
  failed: {},
  skipped: {},
};

function record(category, result) {
  if (result.status === "deleted" || result.status === "partial") {
    report.deleted[category] = result;
  } else if (result.status === "failed") {
    report.failed[category] = result;
  } else {
    report.skipped[category] = result;
  }
}

// Parallel batch
const parallelTasks = [];
if (scopeSet.has("vercel")) parallelTasks.push(deleteVercel().then((r) => ["vercel", r]));
if (scopeSet.has("r2")) parallelTasks.push(deleteR2().then((r) => ["r2", r]));
if (scopeSet.has("workers")) parallelTasks.push(deleteWorkers().then((r) => ["workers", r]));
if (scopeSet.has("dns")) parallelTasks.push(deleteDns().then((r) => ["dns", r]));
if (scopeSet.has("render")) parallelTasks.push(deleteRender().then((r) => ["render", r]));
if (scopeSet.has("stripe-webhooks")) parallelTasks.push(deleteStripeWebhooks().then((r) => ["stripe-webhooks", r]));
if (scopeSet.has("upstash")) parallelTasks.push(deleteUpstash().then((r) => ["upstash", r]));
if (scopeSet.has("email-routing")) parallelTasks.push(deleteEmailRouting().then((r) => ["email-routing", r]));

const parallelResults = await Promise.all(parallelTasks);
for (const [cat, res] of parallelResults) record(cat, res);

// Sequential: neon → db-backup → memory
if (scopeSet.has("neon")) {
  const r = await deleteNeon();
  record("neon", r);
}
if (scopeSet.has("db-backup")) {
  const r = await deleteDbBackup();
  record("db-backup", r);
}
if (scopeSet.has("memory")) {
  const r = await deleteMemory();
  record("memory", r);
}

// Categories explicitly skipped because not in scope
for (const cat of ALL_CATEGORIES) {
  if (!scopeSet.has(cat) && !report.deleted[cat] && !report.failed[cat] && !report.skipped[cat]) {
    report.skipped[cat] = { status: "skipped", reason: "not in scope" };
  }
}

report.completedAt = new Date().toISOString();
report.durationMs = Date.now() - startedAt;

console.log(JSON.stringify(report, null, 2));
