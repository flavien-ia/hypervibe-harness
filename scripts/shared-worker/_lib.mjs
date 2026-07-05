// _lib.mjs - Shared helpers for the hypervibe-jobs management scripts
// (ensure.mjs, register.mjs, migrate-live.mjs). Not user-facing.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const WORKER_NAME_DEFAULT = "hypervibe-jobs";
export const DIR_DEFAULT = join(homedir(), ".hypervibe-jobs");

// ── stdout/stderr protocol (single JSON line on stdout) ─────────────────

export function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

export function fail(msg, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg, ...extra }) + "\n");
  process.exit(1);
}

export function log(msg) {
  process.stderr.write(msg + "\n");
}

// ── flag parsing (--a=b and --a b and boolean --a) ───────────────────────

export function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
      flags[a.slice(2)] = argv[++i];
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { flags, rest };
}

export function isKebab(s) {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s) || /^[a-z0-9]$/.test(s);
}

export function slugUpper(s) {
  return s.replace(/-/g, "_").toUpperCase();
}

// ── registry (jobs.js) read/write ────────────────────────────────────────

const REGISTRY_HEADER = `// jobs.js - Registry of the Hypervibe shared worker ("hypervibe-jobs").
// Managed by the Hypervibe skills via scripts/shared-worker/register.mjs.
// Hand-editing is possible as a last resort (keep strict JSON syntax inside
// the object, then run \`npx wrangler deploy\` from this folder).
export default `;

export function registryPath(dir) {
  return join(dir, "jobs.js");
}

export function readRegistry(dir) {
  const p = registryPath(dir);
  if (!existsSync(p)) {
    fail(`Registry not found at ${p}. Run ensure.mjs first.`);
  }
  const raw = readFileSync(p, "utf8");
  const m = raw.match(/export default\s*([\s\S]*?);?\s*$/);
  if (!m) fail(`Cannot parse ${p}: no "export default" found.`);
  try {
    const reg = JSON.parse(m[1]);
    if (!Array.isArray(reg.jobs)) throw new Error("jobs is not an array");
    return reg;
  } catch (err) {
    fail(`Cannot parse the registry object in ${p}: ${err.message}. It must stay strict JSON.`);
  }
}

export function writeRegistry(dir, registry) {
  const p = registryPath(dir);
  writeFileSync(p, REGISTRY_HEADER + JSON.stringify(registry, null, 2) + ";\n", "utf8");
  return p;
}

// Upsert by job name. Returns "added" | "replaced".
export function upsertJob(registry, job) {
  const idx = registry.jobs.findIndex((j) => j.name === job.name);
  if (idx !== -1) {
    registry.jobs[idx] = job;
    return "replaced";
  }
  registry.jobs.push(job);
  return "added";
}

// ── git helpers ──────────────────────────────────────────────────────────

function git(dir, args, opts = {}) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8", ...opts });
}

export function ensureGitRepo(dir) {
  if (existsSync(join(dir, ".git"))) return { created: false };
  const r = git(dir, ["init", "-b", "main"]);
  if (r.status !== 0) {
    // Older git without -b support: init then rename.
    const r2 = git(dir, ["init"]);
    if (r2.status !== 0) fail(`git init failed: ${(r2.stderr || "").slice(0, 200)}`);
  }
  return { created: true };
}

export function gitCommitAll(dir, message) {
  git(dir, ["add", "-A"]);
  // Nothing staged -> no commit needed.
  const status = git(dir, ["status", "--porcelain"]);
  if ((status.stdout || "").trim() === "") return { committed: false };
  let r = git(dir, ["commit", "-m", message]);
  if (r.status !== 0 && /user\.(name|email)|Author identity unknown/i.test(r.stderr || r.stdout || "")) {
    // Machine without a global git identity: commit with a local one.
    r = git(dir, [
      "-c", "user.name=Hypervibe",
      "-c", "user.email=jobs@hypervibe.local",
      "commit", "-m", message,
    ]);
  }
  if (r.status !== 0) {
    log(`WARN: git commit failed: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
    return { committed: false, warning: "git commit failed" };
  }
  // Best-effort push if a remote is configured.
  const remotes = git(dir, ["remote"]);
  if ((remotes.stdout || "").trim() !== "") {
    const push = git(dir, ["push"]);
    if (push.status !== 0) log("WARN: git push failed (remote configured but unreachable?). The commit is local.");
  }
  return { committed: true };
}

// ── wrangler helpers ─────────────────────────────────────────────────────

// Quote an argument for a shell:true command string (needed for the npm .cmd
// shim on Windows; passing an args array with shell:true is deprecated).
function shellQuote(arg) {
  const s = String(arg);
  if (/^[A-Za-z0-9_\-./:=,*]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

export function wrangler(dir, args, { input, token } = {}) {
  const env = { ...process.env };
  if (token) {
    env.CLOUDFLARE_API_TOKEN = token;
    env.CF_API_TOKEN = token;
  }
  const cmd = ["wrangler", ...args].map(shellQuote).join(" ");
  return spawnSync(cmd, {
    cwd: dir,
    encoding: "utf8",
    shell: true, // Windows .cmd shim
    input,
    env,
  });
}

export function checkWrangler() {
  const v = spawnSync("wrangler --version", { encoding: "utf8", shell: true });
  if (v.status !== 0) return { ok: false, reason: "wrangler is not installed" };
  return { ok: true, version: (v.stdout || "").trim().split("\n").pop() };
}

export function wranglerDeploy(dir, token) {
  const r = wrangler(dir, ["deploy"], { token });
  if (r.status !== 0) {
    return { ok: false, reason: `wrangler deploy failed: ${(r.stderr || r.stdout || "").slice(0, 500)}` };
  }
  // Parse the deployed URL from the output (line like https://name.sub.workers.dev).
  const all = `${r.stdout || ""}\n${r.stderr || ""}`;
  const m = all.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  return { ok: true, url: m ? m[0] : null };
}

export function listWranglerSecrets(dir, token) {
  const r = wrangler(dir, ["secret", "list"], { token });
  if (r.status !== 0) return { ok: false, names: [], reason: (r.stderr || r.stdout || "").slice(0, 300) };
  try {
    // Output may carry log lines before the JSON array: parse from first "[".
    const raw = r.stdout || "";
    const start = raw.indexOf("[");
    const arr = JSON.parse(start >= 0 ? raw.slice(start) : raw);
    return { ok: true, names: arr.map((s) => s.name) };
  } catch {
    return { ok: false, names: [], reason: "cannot parse `wrangler secret list` output" };
  }
}

export function putWranglerSecret(dir, token, name, value) {
  const r = wrangler(dir, ["secret", "put", name], { token, input: value });
  if (r.status !== 0) {
    return { ok: false, reason: `wrangler secret put ${name}: ${(r.stderr || r.stdout || "").slice(0, 300)}` };
  }
  return { ok: true };
}

// ── Cloudflare account discovery ─────────────────────────────────────────

export async function getCfAccountId(token) {
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/accounts", {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result?.[0]?.id || null;
  } catch {
    return null;
  }
}

// ── misc ─────────────────────────────────────────────────────────────────

export function stripTrail(url) {
  return url.replace(/\/+$/, "");
}

export function fiveFieldCron(expr) {
  return typeof expr === "string" && expr.trim().split(/\s+/).length === 5;
}
