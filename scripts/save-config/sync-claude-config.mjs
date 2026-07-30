#!/usr/bin/env node
// Copies a CURATED subset of ~/.claude into a git repo, for versioned backup.
//
//   node sync-claude-config.mjs --repo <path> [--settings redact|keep|skip] [--json]
//
// Allowlist only: nothing is mirrored wholesale. Secrets, transcripts, caches and
// ephemeral state never leave the machine through this script.
// Exit 0 = done, 1 = usage/IO error.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const SRC = path.join(HOME, ".claude");

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const REPO = flag("--repo");
const SETTINGS_MODE = flag("--settings", "redact"); // redact | keep | skip
const AS_JSON = args.includes("--json");

if (!REPO) {
  console.error("usage: sync-claude-config.mjs --repo <path> [--settings redact|keep|skip] [--json]");
  process.exit(1);
}
if (!["redact", "keep", "skip"].includes(SETTINGS_MODE)) {
  console.error(`--settings must be redact, keep or skip (got: ${SETTINGS_MODE})`);
  process.exit(1);
}

const report = { files: 0, skills: 0, commands: 0, scripts: 0, routines: 0, memory: 0, plugins: [], skipped: [] };
const say = (s) => { if (!AS_JSON) console.log(s); };

// Never copied, wherever they come from.
const BLOCKED = [
  /\.credentials\.json$/i,
  /(^|[\\/])\.env(\..+)?$/i,
  /[\\/]node_modules[\\/]/,
  /[\\/]\.git[\\/]/,
  /\.(pem|key|p12|pfx)$/i,
  /[\\/]id_(rsa|ed25519|ecdsa)/i,
  /[\\/]\.upstash\.json$/i,
  /service[-_]?account.*\.json$/i,
  /oauth.*client.*\.json$/i,
];
const blocked = (p) => BLOCKED.some((re) => re.test(p));

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    if (blocked(s)) { report.skipped.push(path.relative(SRC, s)); continue; }
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) n += copyDir(s, d);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      try { fs.copyFileSync(s, d); n++; } catch { report.skipped.push(path.relative(SRC, s)); }
    }
  }
  return n;
}

function copyFile(src, dest) {
  if (!fs.existsSync(src) || blocked(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function dirSize(dir) {
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { bytes += fs.statSync(p).size; } catch { /* unreadable */ } }
    }
  };
  try { walk(dir); } catch { /* unreadable */ }
  return bytes;
}

// ---------------------------------------------------------------- 1. root files

say("\n[1/5] Root files");
if (copyFile(path.join(SRC, "CLAUDE.md"), path.join(REPO, "CLAUDE.md"))) { report.files++; say("  ok  CLAUDE.md"); }
else say("  --  missing: CLAUDE.md");

// settings.json carries an `env` block injected into every session. People do put API
// keys there, and this repo is meant to be pushed. Default: copy it with env VALUES
// replaced by a loud sentinel, so hooks/permissions/plugins stay restorable.
const settingsSrc = path.join(SRC, "settings.json");
const settingsDest = path.join(REPO, "settings.json");
if (SETTINGS_MODE === "skip") {
  rmrf(settingsDest);
  say("  --  settings.json: excluded (--settings skip)");
} else if (fs.existsSync(settingsSrc)) {
  let raw = fs.readFileSync(settingsSrc, "utf8");
  let redactedKeys = [];
  if (SETTINGS_MODE === "redact") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.env && typeof parsed.env === "object") {
        for (const k of Object.keys(parsed.env)) {
          const v = String(parsed.env[k] ?? "");
          // Short, obviously-non-secret switches stay readable (e.g. "1", "true", "fullscreen").
          if (v.length > 12) { parsed.env[k] = "REDACTED_BY_BACKUP__SET_ME"; redactedKeys.push(k); }
        }
        raw = JSON.stringify(parsed, null, 2) + "\n";
      }
    } catch {
      say("  !!  settings.json is not valid JSON, copied verbatim - check it before pushing");
    }
  }
  fs.mkdirSync(REPO, { recursive: true });
  fs.writeFileSync(settingsDest, raw);
  report.files++;
  say(redactedKeys.length
    ? `  ok  settings.json (env values redacted: ${redactedKeys.join(", ")})`
    : "  ok  settings.json");
} else {
  say("  --  missing: settings.json");
}

// ------------------------------------------------------------- 2. mirrored dirs

say("\n[2/5] Directories");
const DIRS = ["skills", "commands", "scripts", "scheduled-tasks", "agents", "hooks", "rules"];
for (const d of DIRS) {
  const src = path.join(SRC, d);
  if (!fs.existsSync(src)) { say(`  --  missing: ${d}/`); continue; }
  rmrf(path.join(REPO, d)); // rebuild so deletions show up in the diff
  const n = copyDir(src, path.join(REPO, d));
  report.files += n;
  if (d === "skills") report.skills = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  if (d === "commands") report.commands = n;
  if (d === "scripts") report.scripts = n;
  if (d === "scheduled-tasks") report.routines = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  say(`  ok  ${d}/ : ${n} files`);
}

// ------------------------------------------------------------------- 3. plugins

say("\n[3/5] Plugins");
const pluginsDest = path.join(REPO, "plugins");
rmrf(pluginsDest);
fs.mkdirSync(pluginsDest, { recursive: true });

for (const f of ["installed_plugins.json", "known_marketplaces.json"]) {
  if (copyFile(path.join(SRC, "plugins", f), path.join(pluginsDest, f))) { report.files++; say(`  ok  plugins/${f}`); }
  else say(`  --  missing: plugins/${f}`);
}

// Plugin source lives either under plugins/marketplaces/<market>/<plugin>/ (local or cloned
// marketplace) or plugins/cache/<...>/<plugin>/ (copy made when installing from a remote
// marketplace). Both layouts exist depending on how the plugin was installed.
const MAX_PLUGIN_BYTES = 25 * 1024 * 1024;
const pluginRoots = [];
const marketplaces = path.join(SRC, "plugins", "marketplaces");
if (fs.existsSync(marketplaces)) {
  for (const market of fs.readdirSync(marketplaces, { withFileTypes: true })) {
    if (!market.isDirectory()) continue;
    const marketDir = path.join(marketplaces, market.name);
    for (const plug of fs.readdirSync(marketDir, { withFileTypes: true })) {
      if (!plug.isDirectory() || plug.name.startsWith(".")) continue;
      const dir = path.join(marketDir, plug.name);
      if (fs.existsSync(path.join(dir, ".claude-plugin")) || fs.existsSync(path.join(dir, "skills"))) {
        pluginRoots.push({ name: plug.name, dir });
      }
    }
  }
}
const cache = path.join(SRC, "plugins", "cache");
if (fs.existsSync(cache)) {
  const walkCache = (d, depth = 0) => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (fs.existsSync(path.join(p, ".claude-plugin"))) {
        if (!pluginRoots.some((r) => r.name === e.name)) pluginRoots.push({ name: e.name, dir: p });
      } else walkCache(p, depth + 1);
    }
  };
  try { walkCache(cache); } catch { /* unreadable */ }
}

for (const { name, dir } of pluginRoots) {
  const size = dirSize(dir);
  if (size > MAX_PLUGIN_BYTES) {
    say(`  --  ${name}/ : ${(size / 1048576).toFixed(0)} MB, too big, skipped (reinstall from its marketplace)`);
    report.skipped.push(`plugin ${name} (too big)`);
    continue;
  }
  const n = copyDir(dir, path.join(pluginsDest, name));
  report.files += n;
  report.plugins.push({ name, files: n, kb: Math.round(size / 1024) });
  say(`  ok  plugins/${name}/ : ${n} files (${Math.round(size / 1024)} KB)`);
}
if (!pluginRoots.length) say("  --  no plugin source found");

// -------------------------------------------------------------------- 4. memory

say("\n[4/5] Memory files");
const memDest = path.join(REPO, "memory");
rmrf(memDest);
const projects = path.join(SRC, "projects");
if (fs.existsSync(projects)) {
  const seen = new Set();
  for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const memSrc = path.join(projects, entry.name, "memory");
    if (!fs.existsSync(memSrc)) continue;
    const slug = entry.name.toLowerCase(); // Windows/macOS are case-insensitive
    if (seen.has(slug)) continue;
    seen.add(slug);
    const n = copyDir(memSrc, path.join(memDest, entry.name));
    if (n > 0) { report.memory += n; say(`  ok  memory/${entry.name}/ : ${n} files`); }
  }
  report.files += report.memory;
  say(`  total: ${report.memory} memory files`);
} else {
  say("  --  no projects/ directory");
}

// ------------------------------------------------------------------- 5. summary

say("\n[5/5] Summary");
say(`  ${report.skills} skills, ${report.commands} command files, ${report.scripts} script files, ` +
    `${report.routines} routine prompts, ${report.memory} memory files, ${report.plugins.length} plugins`);
if (report.skipped.length) say(`  ${report.skipped.length} entries skipped by the safety filter`);
say(`\nDone. Review with: cd "${REPO}" && git status\n`);

if (AS_JSON) console.log(JSON.stringify(report, null, 2));
