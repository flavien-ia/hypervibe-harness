#!/usr/bin/env node
// build-snapshot.mjs - Build a complete snapshot ZIP of a Hypervibe project.
//
// Usage:
//   node build-snapshot.mjs --project <name> [--project-dir <path>] [--out <dir>]
//                           [--skip-storage] [--skip-memory] [--skip-db]
//
// Produces <out>/<project>-snapshot-<YYYYMMDD-HHMMSS>.zip containing:
//   code/      - git bundle (--all) + package.json + CLAUDE.md + working-changes.patch (if dirty)
//   db/        - schema.json + per-table data .json
//   env/       - .env files pulled from Vercel (production / preview / development)
//   storage/   - R2 bucket contents (global + EU jurisdictions)
//   memory/    - Claude memory files for this project
//   config/    - Vercel project link, wrangler.toml, Stripe webhook metadata (no secrets)
//   MANIFEST.md - human-readable description + restore notes
//
// Final stdout = JSON report. Exit 0 on success, 1 on fatal error.

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
  cpSync, statSync, readdirSync, unlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));

// --- Args ---
const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
function flag(name) {
  return args.includes(name);
}

const PROJECT = arg("--project");
const PROJECT_DIR = resolve(arg("--project-dir") || process.cwd());
const OUT_DIR = resolve(arg("--out") || join(homedir(), "Dropbox", "Download"));
const SKIP_STORAGE = flag("--skip-storage");
const SKIP_MEMORY = flag("--skip-memory");
const SKIP_DB = flag("--skip-db");
const SKIP_ENV = flag("--skip-env");

if (!PROJECT) {
  console.error("Usage: node build-snapshot.mjs --project <name> [--project-dir <path>] [--out <dir>] [--skip-storage] [--skip-memory] [--skip-db] [--skip-env]");
  process.exit(1);
}

if (!existsSync(PROJECT_DIR)) {
  console.error(`Project dir not found: ${PROJECT_DIR}`);
  process.exit(1);
}

const NOW = new Date();
const TS = `${NOW.getFullYear()}${String(NOW.getMonth() + 1).padStart(2, "0")}${String(NOW.getDate()).padStart(2, "0")}-${String(NOW.getHours()).padStart(2, "0")}${String(NOW.getMinutes()).padStart(2, "0")}${String(NOW.getSeconds()).padStart(2, "0")}`;
const SNAP_NAME = `${PROJECT}-snapshot-${TS}`;
const WORK_DIR = join(tmpdir(), `hypervibe-snapshot-${Date.now()}`);
const SNAP_DIR = join(WORK_DIR, SNAP_NAME);

mkdirSync(SNAP_DIR, { recursive: true });

const steps = {};
function logStep(name, status, extra = {}) {
  steps[name] = { status, ...extra };
  process.stderr.write(`[${name}] ${status}${extra.error ? " - " + extra.error : ""}\n`);
}

function run(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, { encoding: "utf8", shell: true, ...opts });
}

function dirSize(p) {
  if (!existsSync(p)) return 0;
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const sub = join(p, entry.name);
    if (entry.isDirectory()) total += dirSize(sub);
    else { try { total += statSync(sub).size; } catch {} }
  }
  return total;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ============================================================
// Step 1: git bundle (code + history + working changes)
// ============================================================
function stepGitBundle() {
  const codeDir = join(SNAP_DIR, "code");
  mkdirSync(codeDir, { recursive: true });

  const gitCheck = run("git", ["-C", PROJECT_DIR, "rev-parse", "--is-inside-work-tree"]);
  if (gitCheck.status !== 0) {
    logStep("git-bundle", "skipped", { reason: "not a git repo" });
    return;
  }

  const bundlePath = join(codeDir, "repo.bundle");
  const r = run("git", ["-C", PROJECT_DIR, "bundle", "create", bundlePath, "--all"]);
  if (r.status !== 0) {
    logStep("git-bundle", "error", { error: (r.stderr || r.stdout || "").slice(0, 300) });
    return;
  }

  // Capture working changes (uncommitted + untracked) as a patch
  const status = run("git", ["-C", PROJECT_DIR, "status", "--porcelain"]);
  const dirty = (status.stdout || "").trim().length > 0;
  if (dirty) {
    const diff = run("git", ["-C", PROJECT_DIR, "diff", "HEAD"]);
    writeFileSync(join(codeDir, "working-changes.patch"), diff.stdout || "");
    // Also list untracked files (since git diff doesn't include them)
    const untracked = run("git", ["-C", PROJECT_DIR, "ls-files", "--others", "--exclude-standard"]);
    writeFileSync(join(codeDir, "untracked-files.txt"), untracked.stdout || "");
  }

  // Copy a few top-level reference files
  for (const f of ["package.json", "CLAUDE.md", "README.md", ".gitignore"]) {
    const src = join(PROJECT_DIR, f);
    if (existsSync(src)) {
      try { cpSync(src, join(codeDir, f)); } catch {}
    }
  }

  const bundleSize = statSync(bundlePath).size;
  logStep("git-bundle", "ok", { bundleBytes: bundleSize, dirty });
}

// ============================================================
// Step 2: env vars (vercel env pull × 3 environments)
// ============================================================
function stepEnvVars() {
  if (SKIP_ENV) { logStep("env-vars", "skipped", { reason: "--skip-env" }); return; }

  const envDir = join(SNAP_DIR, "env");
  mkdirSync(envDir, { recursive: true });

  const vCheck = run("vercel", ["--version"]);
  if (vCheck.status !== 0) {
    logStep("env-vars", "skipped", { reason: "vercel CLI not installed" });
    return;
  }

  const linkPath = join(PROJECT_DIR, ".vercel", "project.json");
  if (!existsSync(linkPath)) {
    logStep("env-vars", "skipped", { reason: "project not linked (.vercel/project.json missing)" });
    return;
  }

  const envs = ["production", "preview", "development"];
  const results = [];
  for (const env of envs) {
    const outPath = join(envDir, `${env}.env`);
    if (existsSync(outPath)) { try { unlinkSync(outPath); } catch {} }
    const r = run("vercel", ["env", "pull", outPath, `--environment=${env}`, "--yes"], { cwd: PROJECT_DIR });
    if (r.status === 0 && existsSync(outPath)) {
      const lines = readFileSync(outPath, "utf8").split("\n").filter(l => l.trim() && !l.startsWith("#")).length;
      results.push({ env, ok: true, vars: lines });
    } else {
      results.push({ env, ok: false, error: (r.stderr || r.stdout || "").slice(0, 200) });
    }
  }
  const anyOk = results.some(r => r.ok);
  logStep("env-vars", anyOk ? "ok" : "error", { envs: results });
}

// ============================================================
// Step 3: DB dump
// ============================================================
function stepDbDump() {
  if (SKIP_DB) { logStep("db-dump", "skipped", { reason: "--skip-db" }); return; }

  const dbDir = join(SNAP_DIR, "db");
  mkdirSync(dbDir, { recursive: true });

  // Find DATABASE_URL: prefer .env, fall back to env file we just pulled
  let connString = null;
  for (const envFile of [".env.local", ".env", "env/production.env"]) {
    const p = envFile.startsWith("env/") ? join(SNAP_DIR, envFile) : join(PROJECT_DIR, envFile);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf8");
      const m = content.match(/^DATABASE_URL\s*=\s*"?(postgres[^"\r\n]+)"?/m);
      if (m) { connString = m[1].replace(/["']$/, ""); break; }
    }
  }
  if (!connString) {
    logStep("db-dump", "skipped", { reason: "DATABASE_URL not found in .env / .env.local / env/production.env" });
    return;
  }

  const r = run("node", [
    join(SCRIPT_DIR, "dump-db.mjs"),
    "--conn-string", connString,
    "--out-dir", dbDir,
    "--project-dir", PROJECT_DIR,
  ]);
  let payload = {};
  try {
    const lastLine = (r.stdout || "").trim().split("\n").pop();
    payload = JSON.parse(lastLine);
  } catch {
    payload = { status: "error", reason: "could not parse dump-db output" };
  }
  if (r.status !== 0 || payload.status === "error") {
    logStep("db-dump", "error", { error: payload.reason || (r.stderr || "").slice(0, 200) });
    return;
  }
  // Loud failure: a DATABASE_URL was found, so finding no table means the dump
  // silently produced nothing. Never report that as a success.
  if ((payload.tableCount ?? 0) === 0) {
    logStep("db-dump", "error", {
      error: "database reachable but 0 table found - the snapshot would contain no data",
    });
    return;
  }
  logStep("db-dump", "ok", { driver: payload.driver, tableCount: payload.tableCount, totalRows: payload.totalRows });
}

// ============================================================
// Step 4: R2 download
// ============================================================
function stepR2Download() {
  if (SKIP_STORAGE) { logStep("r2-download", "skipped", { reason: "--skip-storage" }); return; }

  // No wrangler pre-check: download-r2 works from the .env R2 credentials via
  // the S3 API and only falls back to wrangler, so requiring the CLI here would
  // wrongly skip projects that have R2 but no wrangler.
  const storageDir = join(SNAP_DIR, "storage");
  mkdirSync(storageDir, { recursive: true });
  const r = run("node", [
    join(SCRIPT_DIR, "download-r2.mjs"),
    "--project", PROJECT,
    "--out-dir", storageDir,
    "--project-dir", PROJECT_DIR,
  ]);
  let payload = {};
  try {
    const lastLine = (r.stdout || "").trim().split("\n").pop();
    payload = JSON.parse(lastLine);
  } catch {
    payload = { status: "error", reason: "could not parse download-r2 output" };
  }
  // "skipped" = this project genuinely has no R2 storage configured.
  if (payload.status === "skipped") {
    logStep("r2-download", "skipped", { reason: payload.reason });
    return;
  }
  if (r.status !== 0 || payload.status === "error") {
    logStep("r2-download", "error", { error: payload.reason || (r.stderr || "").slice(0, 200) });
    return;
  }
  logStep("r2-download", "ok", {
    mode: payload.mode,
    bucketsScanned: payload.bucketsScanned,
    totalObjects: payload.totalObjects,
    totalSize: humanSize(payload.totalBytes || 0),
  });
}

// ============================================================
// Step 5: Memory files
// ============================================================
function stepMemory() {
  if (SKIP_MEMORY) { logStep("memory", "skipped", { reason: "--skip-memory" }); return; }

  const memoryDir = join(SNAP_DIR, "memory");
  mkdirSync(memoryDir, { recursive: true });

  const claudeProjects = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjects)) {
    logStep("memory", "skipped", { reason: "~/.claude/projects not found" });
    return;
  }

  // Claude Code convention: ~/.claude/projects/<encoded-path>/ where the
  // absolute project path has its separators (/, \, :) AND dots replaced by
  // dashes. E.g. "C:\Code\my-project" -> "C--Code-my-project".
  // We normalize both sides the same way so a project like "my-project"
  // matches the encoded dir "C--Code-my-project".
  const normalize = (s) => s.toLowerCase().replace(/[.\\/:]/g, "-");
  const needle = normalize(PROJECT);

  // Note: modern Claude Code stores transcripts (.jsonl) and session metadata
  // directly in the project dir - not in a legacy "memory/" subdir. We copy
  // the whole project dir to capture everything that's there (transcripts,
  // memory files if they exist, session indexes, etc.).
  const dirs = readdirSync(claudeProjects);
  const matches = [];
  for (const d of dirs) {
    if (normalize(d).includes(needle)) {
      const projDir = join(claudeProjects, d);
      matches.push({ projectDir: d, srcDir: projDir });
    }
  }

  if (matches.length === 0) {
    logStep("memory", "skipped", { reason: `no Claude project dir matching "${needle}"` });
    return;
  }

  for (const m of matches) {
    const dest = join(memoryDir, m.projectDir);
    try { cpSync(m.srcDir, dest, { recursive: true }); } catch (e) {
      logStep("memory", "error", { error: e.message });
      return;
    }
  }
  logStep("memory", "ok", { matchedDirs: matches.length });
}

// ============================================================
// Step 6: Configs (Vercel project, wrangler.toml, Stripe webhooks metadata)
// ============================================================
function stepConfigs() {
  const configDir = join(SNAP_DIR, "config");
  mkdirSync(configDir, { recursive: true });
  const captured = {};

  // Vercel project link
  const vercelLink = join(PROJECT_DIR, ".vercel", "project.json");
  if (existsSync(vercelLink)) {
    cpSync(vercelLink, join(configDir, "vercel-project.json"));
    captured.vercelLink = true;
  }

  // wrangler.toml at root or apps/worker
  for (const candidate of ["wrangler.toml", "apps/worker/wrangler.toml", "wrangler.jsonc"]) {
    const src = join(PROJECT_DIR, candidate);
    if (existsSync(src)) {
      const destName = candidate.replace(/\//g, "_");
      cpSync(src, join(configDir, destName));
      captured.wrangler = (captured.wrangler || []).concat(candidate);
    }
  }

  // render.yaml if present
  const renderYaml = join(PROJECT_DIR, "render.yaml");
  if (existsSync(renderYaml)) {
    cpSync(renderYaml, join(configDir, "render.yaml"));
    captured.render = true;
  }

  // Stripe webhooks (URLs + events only - NO secrets)
  const stripeCheck = run("stripe", ["--version"]);
  if (stripeCheck.status === 0) {
    const r = run("stripe", ["webhook_endpoints", "list", "--limit", "100"]);
    if (r.status === 0) {
      // The CLI outputs JSON when stdout is piped
      try {
        const out = r.stdout || "";
        // Some versions wrap output. Try parse line by line if not direct JSON.
        let endpoints = [];
        try {
          const parsed = JSON.parse(out);
          endpoints = parsed.data || parsed;
        } catch {
          // ignore
        }
        const sanitized = (Array.isArray(endpoints) ? endpoints : []).map(e => ({
          id: e.id,
          url: e.url,
          enabled_events: e.enabled_events,
          status: e.status,
          description: e.description,
          metadata: e.metadata,
        }));
        writeFileSync(join(configDir, "stripe-webhooks.json"), JSON.stringify(sanitized, null, 2));
        captured.stripeWebhooks = sanitized.length;
      } catch {}
    }
  }

  logStep("configs", "ok", captured);
}

// ============================================================
// Step 7: Write MANIFEST.md
// ============================================================
function writeManifest() {
  const sizes = {};
  for (const sub of ["code", "db", "env", "storage", "memory", "config"]) {
    sizes[sub] = humanSize(dirSize(join(SNAP_DIR, sub)));
  }

  const md = `# Snapshot - ${PROJECT}

**Date** : ${new Date().toISOString()}
**Source** : ${PROJECT_DIR}
**Outil** : Hypervibe / save-project

## Contenu

| Sous-dossier | Taille | Description |
|---|---|---|
| \`code/\` | ${sizes.code} | Git bundle complet (toute l'history) + package.json + working-changes.patch si modifs non commitées |
| \`db/\` | ${sizes.db} | Schema (\`schema.json\`) + données JSON par table |
| \`env/\` | ${sizes.env} | Variables d'environnement pullées depuis Vercel (production / preview / development) |
| \`storage/\` | ${sizes.storage} | Contenu des buckets Cloudflare R2 (global + EU si présents) |
| \`memory/\` | ${sizes.memory} | Fichiers mémoire Claude du projet |
| \`config/\` | ${sizes.config} | Snapshots Vercel/Wrangler/Render/Stripe (les webhook secrets NE sont PAS inclus) |

## Rapport d'exécution

\`\`\`json
${JSON.stringify(steps, null, 2)}
\`\`\`

## ⚠️ Sécurité

Ce snapshot contient des **secrets en clair** (clés API dans les fichiers \`env/*.env\`).
À traiter comme un fichier sensible :
- Pas de partage sur un canal non chiffré
- Pas de stockage sur un service public
- À déchiffrer / supprimer dès qu'il n'est plus utile

## Restauration

La restauration n'est pas automatisée. Pour reconstruire le projet manuellement :

1. **Code** : \`git clone code/repo.bundle <new-dir>\` puis \`pnpm install\`. Si \`working-changes.patch\` est présent, \`cd <new-dir> && git apply ../code/working-changes.patch\`.
2. **Variables d'env** : \`cp env/production.env <new-dir>/.env\`. Pour Vercel : \`vercel env add\` pour chaque variable, ou utiliser la skill \`/_push-env-vars\` d'Hypervibe.
3. **DB** : créer une nouvelle base Neon, puis demander à Claude Code de générer un script de restauration qui lit \`db/schema.json\` et insère depuis les fichiers \`*.json\`.
4. **R2** : recréer les buckets via \`wrangler r2 bucket create\`, puis \`wrangler r2 object put\` pour chaque fichier de \`storage/\`.
5. **Webhooks Stripe** : recréer chaque webhook depuis \`config/stripe-webhooks.json\` via le dashboard Stripe (les secrets \`whsec_...\` sont nécessairement régénérés à la création).

En cas de doute, ouvrir Claude Code dans le dossier du snapshot et demander :
> *"Voici un snapshot Hypervibe d'un projet à restaurer. Lis le MANIFEST.md et guide-moi pas à pas."*
`;

  writeFileSync(join(SNAP_DIR, "MANIFEST.md"), md);
}

// ============================================================
// Step 8: Zip
// ============================================================
function buildZip() {
  mkdirSync(OUT_DIR, { recursive: true });
  const zipPath = join(OUT_DIR, `${SNAP_NAME}.zip`);

  // Use Python zipfile (consistent with export-plugin convention, cross-platform).
  // We write the script to a temp file rather than pass it via `python -c` -
  // on Windows, multi-line scripts piped through `cmd.exe -c` get mangled
  // ("Argument expected for the -c option"). Calling python with a file path
  // avoids any shell quoting issues entirely.
  const pyScript = `
import zipfile, os, sys
src = sys.argv[1]
dst = sys.argv[2]
base = os.path.basename(src)
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, os.path.dirname(src))
            arcname = rel.replace(os.sep, '/')
            zf.write(full, arcname)
`;
  const scriptPath = join(WORK_DIR, "_zip.py");
  writeFileSync(scriptPath, pyScript);
  const r = run("python", [scriptPath, SNAP_DIR, zipPath]);
  if (r.status !== 0) {
    throw new Error(`zip failed: ${(r.stderr || r.stdout || "").slice(0, 300)}`);
  }
  return { zipPath, size: statSync(zipPath).size };
}

// ============================================================
// Main
// ============================================================
try {
  stepGitBundle();
  stepEnvVars();
  stepDbDump();
  stepR2Download();
  stepMemory();
  stepConfigs();
  writeManifest();

  const zipInfo = buildZip();

  // Cleanup work dir
  try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch {}

  console.log(JSON.stringify({
    status: "ok",
    project: PROJECT,
    zipPath: zipInfo.zipPath,
    zipSize: humanSize(zipInfo.size),
    timestamp: TS,
    steps,
  }, null, 2));
} catch (e) {
  console.error(JSON.stringify({
    status: "error",
    reason: e.message,
    workDir: WORK_DIR,
    steps,
  }, null, 2));
  process.exit(1);
}
