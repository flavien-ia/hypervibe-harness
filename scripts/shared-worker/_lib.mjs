// _lib.mjs - Shared helpers for the hypervibe-jobs management scripts
// (ensure.mjs, register.mjs, migrate-live.mjs). Not user-facing.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readUserEnv } from "../_read-user-env.mjs";
import { getSecret } from "../vault/vault.mjs";
import { resolveNeonOrg } from "../neon-org.mjs";

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

/**
 * The Cloudflare account id behind a token.
 *
 * Two sources, because /accounts needs the "User → Memberships → Read"
 * permission that many scoped tokens lack. When it is missing the endpoint
 * answers 200 with an empty list rather than an error, so the fallback reads
 * the id off any zone the token can see.
 */
export async function getCfAccountId(token) {
  const call = async (path) => {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const accounts = await call("accounts");
  const fromAccounts = accounts?.result?.[0]?.id;
  if (fromAccounts) return fromAccounts;

  const zones = await call("zones");
  return zones?.result?.[0]?.account?.id || null;
}

// ── The clock on its account: where, whether it is there, whether it answers ──

/** The account a scaffolded clock deploys to, as its wrangler.toml records it: the one to probe.
 *  Never guessed again from the token, which may see several accounts. */
export function clockAccountId(dir) {
  try {
    return /^\s*account_id\s*=\s*"([0-9a-fA-F]{32})"\s*$/m.exec(readFileSync(join(dir, "wrangler.toml"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Is the clock's worker on the account? "deployed", "absent" (the API said so), or "unknown"
 *  (network, throttling, a refusal, no account): an unknown is never read as absent. Reading a
 *  failed probe as "not deployed" is what could deploy an empty registry over an organisation's
 *  clock (2.3.8). `fetchImpl` is the recettes' seam. */
export async function deploymentState(token, accountId, workerName, fetchImpl = fetch) {
  if (!token || !accountId) return "unknown";
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${workerName}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return "deployed";
    if (res.status === 404) return "absent";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** The account's workers.dev subdomain, where the clock's control plane (/status, /trigger)
 *  answers: { state: "present", subdomain } | { state: "absent" } | { state: "unknown" }. */
export async function accountSubdomain(token, accountId, fetchImpl = fetch) {
  if (!token || !accountId) return { state: "unknown" };
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    // An account that never registered its workers.dev address: an empty answer, or a "not found"
    // (HTTP 404, or Cloudflare's error 10007, which wrangler reads the same way). Any other refusal
    // stays unknown: the clock then deploys without its control plane, as for an absent address.
    if (!res.ok) {
      const notFound = res.status === 404 || (data?.errors ?? []).some((e) => e?.code === 10007);
      return notFound ? { state: "absent" } : { state: "unknown", status: res.status };
    }
    return data?.result?.subdomain ? { state: "present", subdomain: data.result.subdomain } : { state: "absent" };
  } catch {
    return { state: "unknown" };
  }
}

/** The page of the Cloudflare dashboard whose first opening registers the account's workers.dev
 *  address, with nothing to do on it (seen on a new account, 06/10/2026). */
export const workersDevPage = (accountId) => `https://dash.cloudflare.com/${accountId}/workers-and-pages`;

/** Whether the clock serves its workers.dev address, per its wrangler.toml (wrangler's default,
 *  when the line is absent, is yes). A clock that does not has no /status nor /trigger at all. */
export function servesWorkersDev(dir) {
  try {
    const m = /^\s*workers_dev\s*=\s*(true|false)\s*$/m.exec(readFileSync(join(dir, "wrangler.toml"), "utf8"));
    return m ? m[1] === "true" : true;
  } catch {
    return false;
  }
}

const WORKERS_DEV_ON = [
  "# The control plane (/status, /trigger) answers on the account's workers.dev address, behind",
  "# the ADMIN_TOKEN secret. It is switched off only on an account that has no workers.dev",
  "# subdomain, where wrangler would refuse to deploy.",
  "workers_dev = true",
];
const WORKERS_DEV_OFF = [
  "# This account has no workers.dev subdomain: wrangler refuses to deploy a worker that serves one,",
  "# so the clock answers to its cron trigger only, and has no /status nor /trigger until the",
  "# account registers a subdomain (the next ensure.mjs run then switches it on).",
  "workers_dev = false",
];

/** The workers_dev block of a new clock's wrangler.toml, comment included. */
export function workersDevBlock(on) {
  return (on ? WORKERS_DEV_ON : WORKERS_DEV_OFF).join("\n");
}

/** Switches the clock's workers.dev address on in its wrangler.toml, replacing the line and the
 *  comment right above it. True when the file changed. Clocks created from 3.x until 3.3.8 were
 *  all written with `workers_dev = false`, so their /status and /trigger never answered. */
export function enableWorkersDev(dir) {
  const file = join(dir, "wrangler.toml");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*workers_dev\s*=\s*false\s*$/.test(l));
  if (at < 0) return false;
  let from = at;
  while (from > 0 && /^\s*#/.test(lines[from - 1])) from -= 1;
  lines.splice(from, at - from + 1, ...WORKERS_DEV_ON);
  writeFileSync(file, lines.join("\n"));
  return true;
}

// ── The Neon organisation the quota watch reads ──────────────────────────
//
// Neon scopes its project listing to ONE organisation. Named nowhere, it answered for the
// account's default one, and some accounts now get an outright refusal instead: 400 "org_id is
// required" (a participant's clock, 08/10/2026). The watch then read no database at all, so it
// could see no overage either. The worker reads `config.neonOrgId` (then the NEON_ORG_ID
// secret), but nothing wrote it until 3.4.8. One rule for the two scripts that write it:
// register.mjs at registration, ensure.mjs on a watch registered before.

/** Where the organisation's id goes, and what then records it on the watch. */
const KEEP_IT_IN_THE_VAULT =
  "dans le coffre (élément NEON, champ org_id), puis relance /quotas : la veille l'enregistrera.";

/**
 * What the watch records about the Neon organisation, from resolveNeonOrg's answer
 * (scripts/neon-org.mjs). Only a CERTAIN organisation is written: the vault's, or the only one
 * of the account. An organisation key scopes itself and needs none. Among several, never the
 * first: the list holds every organisation the key is a member of, other people's included.
 * `previous` is the organisation the job already names: an answer that is not certain never
 * takes it away (Neon unreachable on the day of a re-registration, say).
 *
 * @param {{orgId: string|null, source: string, orgs?: Array<{id: string, name: string}>}} resolved
 * @param {string|null} previous
 * @returns {{status: "set"|"kept"|"not-needed"|"undecided"|"unreadable"|"no-key",
 *   neonOrgId: string|null, source: string, orgs?: Array<{id: string, name: string}>, remedy?: string}}
 */
export function watchNeonOrg(resolved, previous = null) {
  const source = resolved?.source || "injoignable";
  if ((source === "vault" || source === "unique") && resolved.orgId) {
    return { status: "set", neonOrgId: resolved.orgId, source };
  }
  if (previous) return { status: "kept", neonOrgId: previous, source };
  if (source === "cle-org") return { status: "not-needed", neonOrgId: null, source };
  if (source === "cle-absente") return { status: "no-key", neonOrgId: null, source };
  if (source === "ambigu") {
    const orgs = resolved.orgs || [];
    const liste = orgs.map((o) => `${o.name} (${o.id})`).join(", ");
    return {
      status: "undecided",
      neonOrgId: null,
      source,
      orgs,
      remedy:
        `Ce compte Neon appartient à plusieurs organisations : ${liste}. La veille des quotas ne sait pas ` +
        "laquelle lire, et ne choisit jamais à ta place (la première de la liste peut être celle de quelqu'un d'autre). " +
        `Range l'identifiant de celle qui porte tes projets ${KEEP_IT_IN_THE_VAULT}`,
    };
  }
  if (source === "aucune") {
    return {
      status: "undecided",
      neonOrgId: null,
      source,
      orgs: [],
      remedy:
        "Neon ne liste aucune organisation pour cette clé : la veille des quotas lit l'espace par défaut du compte, " +
        "et Neon peut refuser de répondre sans organisation (« org_id is required »). Si la veille le signale, relève " +
        "l'identifiant de ton organisation dans la console Neon (Organization settings, il commence par org-) et range-le " +
        KEEP_IT_IN_THE_VAULT,
    };
  }
  return {
    status: "unreadable",
    neonOrgId: null,
    source,
    remedy:
      "L'organisation Neon n'a pas pu être lue (Neon n'a pas répondu) : la veille des quotas ne la connaît pas encore. " +
      "Relance /quotas un peu plus tard : elle l'enregistrera.",
  };
}

/** A vault field read the way every caller of resolveNeonOrg reads one: "" when unavailable. */
function vaultField(item, field) {
  try {
    return getSecret(item, field) || "";
  } catch {
    return "";
  }
}

/**
 * The organisation for the watch, with the Neon key and NEON.org_id read from the vault like every
 * other caller of resolveNeonOrg. Never throws: an organisation that could not be read never blocks
 * a registration. `deps` is the recettes' seam.
 */
export async function resolveWatchNeonOrg(previous = null, deps = {}) {
  const { readKey = () => readUserEnv("NEON_API_KEY"), vaultGet = vaultField, resolve = resolveNeonOrg } = deps;
  let resolved;
  try {
    const key = readKey();
    resolved = key ? await resolve(key, vaultGet) : { orgId: null, source: "cle-absente", orgs: [] };
  } catch {
    resolved = { orgId: null, source: "injoignable", orgs: [] };
  }
  return watchNeonOrg(resolved, previous);
}

/** The quota jobs of a registry that name no Neon organisation: the ones ensure.mjs completes. */
export function quotaJobsWithoutNeonOrg(registry) {
  return (registry?.jobs || []).filter((j) => j?.kind === "quota" && !j.config?.neonOrgId);
}

// ── misc ─────────────────────────────────────────────────────────────────

export function stripTrail(url) {
  return url.replace(/\/+$/, "");
}

export function fiveFieldCron(expr) {
  return typeof expr === "string" && expr.trim().split(/\s+/).length === 5;
}
