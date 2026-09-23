#!/usr/bin/env node
// rgpd-audit.mjs - Scan a Next.js project for every third party it is connected to, compare
// with the subprocessors registry (src/lib/subprocessors.json), and report the gaps. Read-only,
// outputs JSON.
//
// Two kinds of findings:
// - the services the plugin knows (scripts/privacy/services.mjs, same keys as the catalogue of
//   scripts/update-privacy-policy.mjs), and the ones a project documented for itself (registry
//   entries carrying `detect`): detected, missing from the registry, or stale in it;
// - everything else that betrays a remote service, found WITHOUT knowing it in advance: a
//   variable named like a key or an address, a package of a known service outside the catalogue,
//   a host the code reaches. Reported "to identify": Claude names the service and the person
//   decides whether it goes into the policy (`--entry`) or is set aside with a reason
//   (scripts/privacy/review.mjs). Never guessed silently.
//
// The rules stay conservative: false positives are preferable to silent omissions, because the
// goal is a privacy policy that does not lie. Values are never read, except the project's own
// public addresses (NEXT_PUBLIC_SITE_URL and the like), to tell its own domain from a third party.
//
// Usage:
//   node rgpd-audit.mjs                # JSON to stdout
//   node rgpd-audit.mjs --pretty       # human-readable

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  SERVICES,
  SERVICE_VAR,
  detect,
  explainsDep,
  explainsHost,
  explainsVar,
  hostsInCode,
  isLocalVar,
  isNeverThirdParty,
  notProcessor,
  sdkOf,
} from "./privacy/services.mjs";

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

const posix = (p) => p.replace(/\\/g, "/");

// ─── Packages ─────────────────────────────────────────────────────────────
const webPkg = readJsonSafe(join(WEB_ROOT, "package.json")) || {};
const rootPkg = ROOT === WEB_ROOT ? {} : readJsonSafe(join(ROOT, "package.json")) || {};
const allDeps = new Set(Object.keys({
  ...(webPkg.dependencies || {}),
  ...(webPkg.devDependencies || {}),
  ...(rootPkg.dependencies || {}),
  ...(rootPkg.devDependencies || {}),
}));
// What runs in production: a build tool in devDependencies processes nobody's data.
const runtimeDeps = new Set(Object.keys({ ...(webPkg.dependencies || {}), ...(rootPkg.dependencies || {}) }));

// ─── Variables: their NAMES, and the project's own public addresses ──────
const ENV_FILES = [".env", ".env.local", ".env.example"];
const OWN_URL_VARS = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BASE_URL", "AUTH_URL", "NEXTAUTH_URL"];
const envNames = new Set();
const ownHosts = new Set();
for (const dir of new Set([WEB_ROOT, ROOT])) {
  for (const f of ENV_FILES) {
    for (const line of readTextSafe(join(dir, f)).split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      envNames.add(m[1]);
      if (OWN_URL_VARS.includes(m[1])) {
        try { ownHosts.add(new URL(m[2].trim().replace(/^["']|["']$/g, "")).hostname.toLowerCase()); } catch { /* not a URL */ }
      }
    }
  }
}

// ─── The code: patterns, and the hosts it reaches ─────────────────────────
const SRC_DIR = join(WEB_ROOT, "src");
const HAS_SRC = dirExists(SRC_DIR);
const CONFIG_FILE = /^(next\.config|middleware|instrumentation|instrumentation-client|sentry\.[a-z]+\.config)\.(ts|js|mjs|cjs)$/;
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;

function codeFiles() {
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", ".next", ".git", "__tests__", "e2e", "tests"].includes(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && CODE_FILE.test(e.name) && !TEST_FILE.test(e.name)) files.push(full);
    }
  };
  if (HAS_SRC) walk(SRC_DIR);
  try {
    for (const e of readdirSync(WEB_ROOT, { withFileTypes: true })) {
      if (e.isFile() && CONFIG_FILE.test(e.name)) files.push(join(WEB_ROOT, e.name));
    }
  } catch { /* unreadable root */ }
  return files;
}

// Every code pattern any service looks for, plus the ones of the project's own entries (below).
const registryPath = join(WEB_ROOT, "src/lib/subprocessors.json");
const registry = readJsonSafe(registryPath) || [];
const customServices = registry
  .filter((e) => e && e.detect && typeof e.detect === "object")
  .map((e) => ({ key: e.key, label: e.name, ...e.detect }));
const allServices = [...SERVICES, ...customServices];
const codePatterns = new Set(allServices.flatMap((s) => [...(s.code ?? []), ...(s.all ?? []).flatMap((g) => g.code ?? [])]));

const codeFound = new Set();
const hostWhere = new Map();
for (const file of codeFiles()) {
  const text = readTextSafe(file);
  for (const p of codePatterns) if (!codeFound.has(p) && text.includes(p)) codeFound.add(p);
  for (const h of hostsInCode(text)) if (!hostWhere.has(h)) hostWhere.set(h, posix(relative(ROOT, file)));
}

const wantedFiles = new Set(allServices.flatMap((s) => s.files ?? []));
const filesFound = new Set([...wantedFiles].filter((f) => fileExists(join(WEB_ROOT, f)) || fileExists(join(ROOT, f))));

const facts = { deps: allDeps, env: envNames, code: codeFound, hosts: new Set(hostWhere.keys()), files: filesFound };

// ─── Privacy policy and legal notice pages ────────────────────────────────
function findPage(slug) {
  if (!HAS_SRC) return null;
  const candidates = [
    join(SRC_DIR, `app/${slug}/page.tsx`),
    join(SRC_DIR, `app/[locale]/${slug}/page.tsx`),
    join(SRC_DIR, `app/(public)/${slug}/page.tsx`),
    join(SRC_DIR, `app/(site)/${slug}/page.tsx`),
    join(SRC_DIR, `app/(site)/(public)/${slug}/page.tsx`),
  ];
  for (const c of candidates) if (fileExists(c)) return c;
  return null;
}
const PRIVACY_POLICY_PAGE = findPage("politique-de-confidentialite");
const MENTIONS_LEGALES_PAGE = findPage("mentions-legales");

// ─── Known services, and the project's own entries ────────────────────────
const detected = {};
const evidence = {};
for (const s of allServices) {
  const found = detect(s, facts);
  if (found) {
    detected[s.key] = true;
    evidence[s.key] = found;
  }
}

// ─── What betrays a service nobody named ──────────────────────────────────
const detectedSet = new Set(Object.keys(detected));
const candidates = [];
for (const name of [...envNames].sort()) {
  if (isLocalVar(name) || explainsVar(allServices, name, detectedSet) || !SERVICE_VAR.test(name)) continue;
  candidates.push({ kind: "variable", value: name, hint: "a key or an address in the project's settings" });
}
for (const name of [...runtimeDeps].sort()) {
  if (explainsDep(allServices, name, detectedSet)) continue;
  const service = sdkOf(name);
  if (service) candidates.push({ kind: "package", value: name, service, hint: `package of ${service}` });
}
const notProcessors = [];
for (const [host, where] of [...hostWhere.entries()].sort()) {
  if (isNeverThirdParty(host) || ownHosts.has(host) || explainsHost(allServices, host)) continue;
  const np = notProcessor(host);
  if (np) {
    notProcessors.push({ host, where, reason: np.reason });
    continue;
  }
  candidates.push({ kind: "host", value: host, where, hint: "the code reaches this address" });
}

// Signals the person already looked at, with Claude, and set aside with a reason.
const reviewPath = join(ROOT, ".hypervibe/privacy-review.json");
const reviewedList = (readJsonSafe(reviewPath)?.reviewed ?? []).filter((r) => r && r.kind && r.value);
const reviewedKey = (r) => `${r.kind}:${r.value}`;
const reviewedIndex = new Map(reviewedList.map((r) => [reviewedKey(r), r]));
const unidentified = candidates.filter((c) => !reviewedIndex.has(reviewedKey(c)));
const reviewed = candidates.filter((c) => reviewedIndex.has(reviewedKey(c))).map((c) => ({ ...c, reason: reviewedIndex.get(reviewedKey(c)).reason, reviewedAt: reviewedIndex.get(reviewedKey(c)).reviewedAt }));

// ─── Compare with the registry ────────────────────────────────────────────
const registryKeys = new Set(registry.map((e) => e.key));
const detectedKeys = new Set(Object.keys(detected));
const missing = [...detectedKeys].filter((k) => !registryKeys.has(k));
// Un sous-traitant sans trace dans le code (DNS, relais d'emails) est declare a
// la main : l'audit ne peut pas le detecter, donc ne doit pas proposer de le
// retirer. Sans ce filtre, chaque passage inviterait a supprimer une mention
// exacte, et la page finirait par mentir a force d'etre "corrigee".
const stale = [...registryKeys].filter(
  (k) =>
    !detectedKeys.has(k) &&
    !registry.find((e) => e.key === k)?.manuallyDeclared,
);

// ─── Output ───────────────────────────────────────────────────────────────
const result = {
  webRoot: posix(WEB_ROOT),
  registryPath: posix(registryPath),
  registryExists: existsSync(registryPath),
  policyPagePath: PRIVACY_POLICY_PAGE ? posix(PRIVACY_POLICY_PAGE) : null,
  mentionsLegalesPath: MENTIONS_LEGALES_PAGE ? posix(MENTIONS_LEGALES_PAGE) : null,
  registryKeys: [...registryKeys],
  detectedKeys: [...detectedKeys],
  detected,
  evidence,
  missing,
  stale,
  unidentified,
  reviewed,
  notProcessors,
  reviewPath: posix(reviewPath),
  customKeys: customServices.map((s) => s.key),
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
    console.log(`  ${inRegistry} ${k.padEnd(22)} (${evidence[k]})`);
  }
  if (stale.length) {
    console.log("");
    console.log(`Stale registry entries (in registry but not detected, ${stale.length}):`);
    for (const k of stale) console.log(`  ⚠ ${k}`);
  }
  if (unidentified.length) {
    console.log("");
    console.log(`To identify (${unidentified.length}): a remote service may be behind each of these`);
    for (const u of unidentified) console.log(`  ? ${u.kind.padEnd(8)} ${u.value}${u.service ? ` (${u.service})` : ""}${u.where ? ` in ${u.where}` : ""}`);
  }
  if (reviewed.length) {
    console.log("");
    console.log(`Already reviewed, not subprocessors (${reviewed.length}):`);
    for (const r of reviewed) console.log(`  · ${r.kind.padEnd(8)} ${r.value}: ${r.reason}`);
  }
  if (notProcessors.length) {
    console.log("");
    console.log(`Reached without personal data (${notProcessors.length}):`);
    for (const n of notProcessors) console.log(`  · ${n.host}: ${n.reason}`);
  }
  console.log("");
  if (missing.length === 0 && stale.length === 0 && unidentified.length === 0) {
    console.log("✅ Registry is up to date with everything the project is connected to.");
  } else {
    if (missing.length) console.log(`❌ Missing in registry: ${missing.join(", ")}`);
    if (stale.length) console.log(`⚠️  Stale in registry: ${stale.join(", ")}`);
    if (unidentified.length) console.log(`❓ To identify: ${unidentified.length} signal(s)`);
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}
