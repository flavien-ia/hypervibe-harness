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
import { isPrivateTool, projectLayout, registryFile } from "./privacy/layout.mjs";

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
// A file that exists but cannot be read is not an absent file. Both used to give the same
// empty answer, and one stray comma in package.json made the audit call the project's database
// stale, exit 0, in a report that looked normal (outside review, 3.3.0). Every failed read is
// recorded: it withholds every proposal to remove, and the report names the file.
const unreadable = [];
function unread(path, e) {
  unreadable.push({ file: posix(relative(ROOT, path)) || posix(path), error: String(e?.message ?? e).split("\n")[0] });
}

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) { unread(path, e); return null; }
}

function readTextSafe(path) {
  if (!existsSync(path)) return "";
  try { return readFileSync(path, "utf8"); } catch (e) { unread(path, e); return ""; }
}

function fileExists(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function posix(p) {
  return p.replace(/\\/g, "/");
}

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
// The whole web root is read, not only src/: a Next.js project without a src folder (app/ and
// lib/ at the root) is a standard layout, and its code used to go unread while the report
// stayed green (outside review, 3.3.0). Left out: dependencies, build output and tests at any
// depth; at the root only, the files served as they are (public/) and the maintenance scripts.
// Stylesheets too: a font or an image loaded from a third party by the visitor's browser is the
// textbook subprocessor one forgets, and it lives in @import url(...) and url(...) (outside
// review, 3.3.1).
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
// Build output and test folders are skipped at the ROOT only: `build`, `out` or `test` deeper
// down can be the name of a route (`src/app/test/page.tsx`), and 3.3.1 stopped reading those
// (outside review). Anywhere: dependencies, hidden folders, and `__tests__` (a private folder
// for Next.js, never a route).
const SKIPPED_ANYWHERE = new Set(["node_modules", ".next", ".git", ".vercel", ".turbo", ".cache", ".output", ".hypervibe", ".claude", "__tests__"]);
const SKIPPED_AT_ROOT = new Set(["public", "scripts", "dist", "build", "out", "coverage", "storybook-static", "e2e", "tests", "test"]);

function codeFiles() {
  const files = [];
  const walk = (d, atRoot) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch (e) { unread(d, e); return; }
    for (const e of entries) {
      if (SKIPPED_ANYWHERE.has(e.name) || (atRoot && SKIPPED_AT_ROOT.has(e.name))) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full, false);
      else if (e.isFile() && CODE_FILE.test(e.name) && !TEST_FILE.test(e.name)) files.push(full);
    }
  };
  walk(WEB_ROOT, true);
  return files;
}

// Every code pattern any service looks for, plus the ones of the project's own entries (below).
const LAYOUT = projectLayout(WEB_ROOT);
const registryPath = registryFile(WEB_ROOT);
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
// Only in the folder Next.js serves (privacy/layout.mjs). A page found in the folder it
// ignores is reported as such: it builds, and is never served.
function findPage(slug, appDir = LAYOUT.appDir) {
  for (const group of ["", "[locale]/", "(public)/", "(site)/", "(site)/(public)/"]) {
    const c = join(appDir, `${group}${slug}/page.tsx`);
    if (fileExists(c)) return c;
  }
  return null;
}
const PRIVACY_POLICY_PAGE = findPage("politique-de-confidentialite");
const MENTIONS_LEGALES_PAGE = findPage("mentions-legales");
const PRIVACY_POLICY_IGNORED = PRIVACY_POLICY_PAGE ? null : findPage("politique-de-confidentialite", LAYOUT.ignoredAppDir);
const MENTIONS_LEGALES_IGNORED = MENTIONS_LEGALES_PAGE ? null : findPage("mentions-legales", LAYOUT.ignoredAppDir);

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
const reviewed = candidates.filter((c) => reviewedIndex.has(reviewedKey(c))).map((c) => ({ ...c, reason: reviewedIndex.get(reviewedKey(c)).reason, reviewedAt: reviewedIndex.get(reviewedKey(c)).reviewedAt }));

// ─── Compare with the registry ────────────────────────────────────────────
const registryKeys = new Set(registry.map((e) => e.key));
const detectedKeys = new Set(Object.keys(detected));
const missing = [...detectedKeys].filter((k) => !registryKeys.has(k));

// The signals that name a registry entry: its package, a variable carrying its key as prefix,
// a host with its key as one of the labels.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function signalsNaming(entry) {
  const keyN = norm(entry?.key);
  const nameN = norm(entry?.name);
  if (keyN.length < 3) return [];
  const envPrefix = `${String(entry.key).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`;
  return candidates.filter((c) => {
    if (c.kind === "package") {
      const serviceN = norm(c.service);
      return norm(c.value) === keyN || (serviceN.length >= 3 && (serviceN === keyN || nameN.startsWith(serviceN)));
    }
    if (c.kind === "variable") return c.value.startsWith(envPrefix);
    if (c.kind === "host") return c.value.split(".").some((label) => norm(label) === keyN);
    return false;
  });
}

// Un sous-traitant sans trace dans le code (DNS, relais d'emails) est declare a
// la main : l'audit ne peut pas le detecter, donc ne doit pas proposer de le
// retirer. Sans ce filtre, chaque passage inviterait a supprimer une mention
// exacte, et la page finirait par mentir a force d'etre "corrigee".
const notDetected = [...registryKeys].filter(
  (k) =>
    !detectedKeys.has(k) &&
    !registry.find((e) => e.key === k)?.manuallyDeclared,
);
// An entry not recognised while a signal to identify names that very service is not stale:
// its entry lacks the detection rule. The same report used to say "remove it" and "identify
// this package" about one service (outside review, 3.3.0).
const unrecognised = [];
const namedSignals = new Set();
const staleCandidates = [];
for (const k of notDetected) {
  const named = signalsNaming(registry.find((e) => e.key === k));
  if (named.length) {
    unrecognised.push({ key: k, signals: named.map((c) => ({ kind: c.kind, value: c.value })) });
    for (const c of named) namedSignals.add(c);
  } else {
    staleCandidates.push(k);
  }
}
const unidentified = candidates.filter((c) => !reviewedIndex.has(reviewedKey(c)) && !namedSignals.has(c));
// "I could not see" is not "there is nothing": a file that could not be read withholds every
// proposal to remove, the same reflex as schema-drift.mjs withholding --force.
const stale = unreadable.length ? [] : staleCandidates;
const staleWithheld = unreadable.length ? staleCandidates : [];

// ─── Output ───────────────────────────────────────────────────────────────
const result = {
  webRoot: posix(WEB_ROOT),
  registryPath: posix(registryPath),
  registryExists: existsSync(registryPath),
  policyPagePath: PRIVACY_POLICY_PAGE ? posix(PRIVACY_POLICY_PAGE) : null,
  mentionsLegalesPath: MENTIONS_LEGALES_PAGE ? posix(MENTIONS_LEGALES_PAGE) : null,
  appDir: posix(LAYOUT.appDir),
  // Marked as a private tool by /bootstrap (no page for the public): no policy page is expected.
  privateTool: isPrivateTool(WEB_ROOT, ROOT),
  i18nRoutingPath: existsSync(LAYOUT.i18nRouting) ? posix(LAYOUT.i18nRouting) : null,
  policyPageIgnoredPath: PRIVACY_POLICY_IGNORED ? posix(PRIVACY_POLICY_IGNORED) : null,
  mentionsLegalesIgnoredPath: MENTIONS_LEGALES_IGNORED ? posix(MENTIONS_LEGALES_IGNORED) : null,
  registryKeys: [...registryKeys],
  detectedKeys: [...detectedKeys],
  detected,
  evidence,
  missing,
  stale,
  staleWithheld,
  unrecognised,
  unreadable,
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
  for (const p of [result.policyPageIgnoredPath, result.mentionsLegalesIgnoredPath].filter(Boolean)) {
    console.log(`  ✗ ${p} is never served: Next.js serves ${result.appDir} in this project`);
  }
  console.log("");
  console.log(`Detected subprocessors (${detectedKeys.size}):`);
  for (const k of detectedKeys) {
    const inRegistry = registryKeys.has(k) ? "✓" : "✗";
    console.log(`  ${inRegistry} ${k.padEnd(22)} (${evidence[k]})`);
  }
  if (unreadable.length) {
    console.log("");
    console.log(`Could not be read (${unreadable.length}): no removal is proposed until they can be`);
    for (const u of unreadable) console.log(`  ✗ ${u.file}: ${u.error}`);
  }
  if (stale.length) {
    console.log("");
    console.log(`Stale registry entries (in registry but not detected, ${stale.length}):`);
    for (const k of stale) console.log(`  ⚠ ${k}`);
  }
  if (staleWithheld.length) {
    console.log("");
    console.log(`Not detected, removal withheld because a file could not be read (${staleWithheld.length}): ${staleWithheld.join(", ")}`);
  }
  if (unrecognised.length) {
    console.log("");
    console.log(`In the registry, used, but not recognised (${unrecognised.length}): the entry needs its detection rule`);
    for (const u of unrecognised) console.log(`  ~ ${u.key.padEnd(22)} ${u.signals.map((s) => `${s.kind} ${s.value}`).join(", ")}`);
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
  if (missing.length === 0 && stale.length === 0 && unidentified.length === 0 && unrecognised.length === 0 && unreadable.length === 0 && !result.policyPageIgnoredPath && !result.mentionsLegalesIgnoredPath) {
    console.log("✅ Registry is up to date with everything the project is connected to.");
  } else {
    if (missing.length) console.log(`❌ Missing in registry: ${missing.join(", ")}`);
    if (stale.length) console.log(`⚠️  Stale in registry: ${stale.join(", ")}`);
    if (unidentified.length) console.log(`❓ To identify: ${unidentified.length} signal(s)`);
    if (unrecognised.length) console.log(`~  Needs a detection rule: ${unrecognised.map((u) => u.key).join(", ")}`);
    if (unreadable.length) console.log(`✗  Could not be read: ${unreadable.map((u) => u.file).join(", ")}`);
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}
