#!/usr/bin/env node
// rgpd-audit.mjs - Scan a Next.js project to detect data processors in use,
// compare with the subprocessors registry (src/lib/subprocessors.json), and
// report gaps. Pure read-only - outputs JSON.
//
// The detection rules are conservative: we flag a subprocessor as "detected"
// when there's strong evidence (a package, a file, or an env var pointing
// directly at it). False positives are preferable to silent omissions
// because the goal is RGPD-compliance documentation.
//
// Usage:
//   node rgpd-audit.mjs                # JSON to stdout
//   node rgpd-audit.mjs --pretty       # human-readable

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const PRETTY = args.includes("--pretty");

// ─── Web root detection ───────────────────────────────────────────────────
function detectWebRoot() {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "apps/web/package.json"))) return join(cwd, "apps/web");
  if (existsSync(join(cwd, "package.json"))) return cwd;
  return null;
}

const WEB_ROOT = detectWebRoot();
if (!WEB_ROOT) {
  console.error("[rgpd-audit] Cannot detect web root: no package.json at ./ or ./apps/web/");
  process.exit(1);
}
const ROOT = process.cwd();

// ─── Helpers ──────────────────────────────────────────────────────────────
function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function readTextSafe(path) {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function fileExists(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function dirExists(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

// Recursively grep for any of the patterns under a directory. Stops at the
// first match per pattern (we just need a yes/no).
function grepDir(dir, patterns) {
  const found = new Set();
  function walk(d) {
    if (found.size === patterns.length) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (found.size === patterns.length) return;
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        let text;
        try { text = readFileSync(full, "utf8"); } catch { continue; }
        for (const p of patterns) {
          if (!found.has(p) && text.includes(p)) found.add(p);
        }
      }
    }
  }
  walk(dir);
  return found;
}

// ─── Read package.json (deps + devDeps) ───────────────────────────────────
const webPkg = readJsonSafe(join(WEB_ROOT, "package.json")) || {};
const rootPkg = readJsonSafe(join(ROOT, "package.json")) || {};
const allDeps = {
  ...(webPkg.dependencies || {}),
  ...(webPkg.devDependencies || {}),
  ...(rootPkg.dependencies || {}),
  ...(rootPkg.devDependencies || {}),
};
function hasDep(name) { return Object.prototype.hasOwnProperty.call(allDeps, name); }

// ─── Read .env files (best-effort - for hint detection only) ─────────────
function readEnvHints() {
  const hints = new Set();
  for (const f of [".env", ".env.local", ".env.example"]) {
    const text = readTextSafe(join(WEB_ROOT, f));
    if (!text) continue;
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (m) hints.add(m[1]);
    }
  }
  return hints;
}
const envHints = readEnvHints();

// ─── Look for a few key source files / dirs ───────────────────────────────
const SRC_DIR = join(WEB_ROOT, "src");
const HAS_SRC = dirExists(SRC_DIR);

// Detection - we grep for pattern strings in source code.
// NextAuth v5 uses `import Google from "next-auth/providers/google"`,
// while v4 uses `GoogleProvider`. Match both.
const sourcePatterns = HAS_SRC
  ? grepDir(SRC_DIR, [
      "GoogleProvider",
      "next-auth/providers/google",
      "GitHubProvider",
      "next-auth/providers/github",
      "@anthropic-ai/sdk",
      "GoogleAnalytics",
      "@vercel/analytics",
    ])
  : new Set();

// Render detection - render.yaml at repo root (monorepo case)
const HAS_RENDER_YAML = fileExists(join(ROOT, "render.yaml"));

// Privacy policy page detection - search for any politique-de-confidentialite path
function findPrivacyPolicyPage() {
  if (!HAS_SRC) return null;
  const candidates = [
    join(SRC_DIR, "app/politique-de-confidentialite/page.tsx"),
    join(SRC_DIR, "app/[locale]/politique-de-confidentialite/page.tsx"),
    join(SRC_DIR, "app/(public)/politique-de-confidentialite/page.tsx"),
    join(SRC_DIR, "app/(site)/politique-de-confidentialite/page.tsx"),
    join(SRC_DIR, "app/(site)/(public)/politique-de-confidentialite/page.tsx"),
  ];
  for (const c of candidates) if (fileExists(c)) return c;
  return null;
}
const PRIVACY_POLICY_PAGE = findPrivacyPolicyPage();

// Mentions légales - same logic
function findMentionsLegalesPage() {
  if (!HAS_SRC) return null;
  const candidates = [
    join(SRC_DIR, "app/mentions-legales/page.tsx"),
    join(SRC_DIR, "app/[locale]/mentions-legales/page.tsx"),
    join(SRC_DIR, "app/(public)/mentions-legales/page.tsx"),
    join(SRC_DIR, "app/(site)/mentions-legales/page.tsx"),
    join(SRC_DIR, "app/(site)/(public)/mentions-legales/page.tsx"),
  ];
  for (const c of candidates) if (fileExists(c)) return c;
  return null;
}
const MENTIONS_LEGALES_PAGE = findMentionsLegalesPage();

// ─── Detection rules ──────────────────────────────────────────────────────
const detected = {};
const evidence = {};

// vercel - always present (we deploy to Vercel by default)
detected.vercel = true;
evidence.vercel = "Project deploys to Vercel (assumed default)";

// neon - drizzle-orm + (@neondatabase/serverless OR postgres.js)
if (hasDep("drizzle-orm") && (hasDep("@neondatabase/serverless") || hasDep("postgres"))) {
  detected.neon = true;
  evidence.neon = `Detected via deps: drizzle-orm + ${hasDep("@neondatabase/serverless") ? "@neondatabase/serverless" : "postgres"}`;
}

// google-oauth - auth code references Google provider OR env contains AUTH_GOOGLE_*
if (
  sourcePatterns.has("GoogleProvider") ||
  sourcePatterns.has("next-auth/providers/google") ||
  envHints.has("AUTH_GOOGLE_ID") ||
  envHints.has("AUTH_GOOGLE_SECRET")
) {
  detected["google-oauth"] = true;
  evidence["google-oauth"] =
    sourcePatterns.has("next-auth/providers/google") || sourcePatterns.has("GoogleProvider")
      ? "Google OAuth provider referenced in source"
      : "AUTH_GOOGLE_* in .env";
}

// github-oauth - same logic
if (
  sourcePatterns.has("GitHubProvider") ||
  sourcePatterns.has("next-auth/providers/github") ||
  envHints.has("AUTH_GITHUB_ID") ||
  envHints.has("AUTH_GITHUB_SECRET")
) {
  detected["github-oauth"] = true;
  evidence["github-oauth"] =
    sourcePatterns.has("next-auth/providers/github") || sourcePatterns.has("GitHubProvider")
      ? "GitHub OAuth provider referenced in source"
      : "AUTH_GITHUB_* in .env";
}

// stripe
if (hasDep("stripe") || envHints.has("STRIPE_SECRET_KEY")) {
  detected.stripe = true;
  evidence.stripe = hasDep("stripe") ? "stripe package installed" : "STRIPE_SECRET_KEY in .env";
}

// resend
if (hasDep("resend")) {
  detected.resend = true;
  evidence.resend = "resend package installed";
}

// brevo
if (hasDep("@getbrevo/brevo") || hasDep("@sendinblue/client")) {
  detected.brevo = true;
  evidence.brevo = "Brevo SDK installed";
}

// cloudflare-r2 - S3-compatible client + R2_* env hints
if (hasDep("@aws-sdk/client-s3") && [...envHints].some((k) => k.startsWith("R2_") || k.includes("R2_BUCKET"))) {
  detected["cloudflare-r2"] = true;
  evidence["cloudflare-r2"] = "@aws-sdk/client-s3 + R2_* env vars";
}

// vercel-analytics
if (hasDep("@vercel/analytics") || sourcePatterns.has("@vercel/analytics")) {
  detected["vercel-analytics"] = true;
  evidence["vercel-analytics"] = "@vercel/analytics referenced";
}

// google-analytics
if (envHints.has("NEXT_PUBLIC_GA_MEASUREMENT_ID") || sourcePatterns.has("GoogleAnalytics")) {
  detected["google-analytics"] = true;
  evidence["google-analytics"] = envHints.has("NEXT_PUBLIC_GA_MEASUREMENT_ID")
    ? "NEXT_PUBLIC_GA_MEASUREMENT_ID in .env"
    : "GoogleAnalytics component in source";
}

// anthropic
if (hasDep("@anthropic-ai/sdk") || sourcePatterns.has("@anthropic-ai/sdk")) {
  detected.anthropic = true;
  evidence.anthropic = "@anthropic-ai/sdk referenced";
}

// render - render.yaml at root indicates Render Background Workers
if (HAS_RENDER_YAML) {
  detected.render = true;
  evidence.render = "render.yaml present at repo root";
}

// ─── Compare with registry ────────────────────────────────────────────────
const registryPath = join(WEB_ROOT, "src/lib/subprocessors.json");
const registry = readJsonSafe(registryPath) || [];
const registryKeys = new Set(registry.map((e) => e.key));
const detectedKeys = new Set(Object.keys(detected));

const missing = [...detectedKeys].filter((k) => !registryKeys.has(k));
const stale = [...registryKeys].filter((k) => !detectedKeys.has(k));

// ─── Output ───────────────────────────────────────────────────────────────
const result = {
  webRoot: WEB_ROOT.replace(/\\/g, "/"),
  registryPath: registryPath.replace(/\\/g, "/"),
  registryExists: existsSync(registryPath),
  policyPagePath: PRIVACY_POLICY_PAGE ? PRIVACY_POLICY_PAGE.replace(/\\/g, "/") : null,
  mentionsLegalesPath: MENTIONS_LEGALES_PAGE ? MENTIONS_LEGALES_PAGE.replace(/\\/g, "/") : null,
  registryKeys: [...registryKeys],
  detectedKeys: [...detectedKeys],
  detected,
  evidence,
  missing,
  stale,
};

if (PRETTY) {
  console.log(`Web root            : ${result.webRoot}`);
  console.log(`Registry            : ${result.registryExists ? "✓ exists" : "✗ missing"} (${result.registryPath})`);
  console.log(`Privacy policy page : ${result.policyPagePath ? "✓ " + result.policyPagePath : "✗ missing"}`);
  console.log(`Mentions légales    : ${result.mentionsLegalesPath ? "✓ " + result.mentionsLegalesPath : "✗ missing"}`);
  console.log("");
  console.log(`Detected subprocessors (${detectedKeys.size}):`);
  for (const k of detectedKeys) {
    const inRegistry = registryKeys.has(k) ? "✓" : "✗";
    console.log(`  ${inRegistry} ${k.padEnd(20)} (${evidence[k]})`);
  }
  if (stale.length) {
    console.log("");
    console.log(`Stale registry entries (in registry but not detected, ${stale.length}):`);
    for (const k of stale) console.log(`  ⚠ ${k}`);
  }
  console.log("");
  if (missing.length === 0 && stale.length === 0) {
    console.log("✅ Registry is up to date with detected subprocessors.");
  } else {
    if (missing.length) console.log(`❌ Missing in registry: ${missing.join(", ")}`);
    if (stale.length) console.log(`⚠️  Stale in registry: ${stale.join(", ")}`);
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}
