#!/usr/bin/env node
// _read-user-env.mjs - Read a User-scope env var, regardless of how the host
// process was launched.
//
// THE PROBLEM
// -----------
// On macOS, when Claude Code is launched from Spotlight/Dock (not from a
// terminal), it's a child of `launchd` and inherits an EMPTY shell environment.
// Bash subshells spawned by Claude Code (via `spawnSync`, `bash -c`, etc.)
// inherit that empty env - they NEVER source `~/.zshrc` because they are
// non-login non-interactive shells. Result: env vars set by `/start` (which
// writes `export X=...` to `~/.zshrc`) are invisible to our scripts even
// after the user "restarts Claude Code".
//
// On Windows, `setx` writes to the User registry which IS inherited by all
// subsequent processes - but a Claude Code instance LAUNCHED BEFORE the
// `setx` call still has the old (empty) env until restarted.
//
// On Linux, same as macOS but with `~/.bashrc`.
//
// THIS HELPER
// -----------
// Looks up a variable name. The order depends on whether it is a MIGRATED GLOBAL KEY
// (one of the VAULT_MAP names below):
//   - mapped names: vault → process.env → OS User scope
//   - other names:  process.env → OS User scope
// where "OS User scope" is:
//      - Windows: PowerShell `[Environment]::GetEnvironmentVariable('VAR', 'User')`
//      - macOS:   parse ~/.zshrc, ~/.bashrc, ~/.profile (in this order)
//      - Linux:   parse ~/.bashrc, ~/.profile, ~/.zshrc
// Nothing found → return null (CLI: exit 2)
//
// CLI USAGE
// ---------
//   $ node _read-user-env.mjs CLOUDFLARE_API_TOKEN
//   <value on stdout, exit 0>   OR   <empty stdout, exit 2 if not found>
//
// Idiomatic shell pattern:
//   TOKEN=$(node "_read-user-env.mjs" CLOUDFLARE_API_TOKEN)
//   [ -n "$TOKEN" ] && export CLOUDFLARE_API_TOKEN="$TOKEN"
//
// MODULE USAGE
// ------------
//   import { readUserEnv } from "./_read-user-env.mjs";
//   const value = readUserEnv("NEON_API_KEY"); // string | null

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// Migrated global keys now live in the Bitwarden vault. Map the legacy env-var name
// to its vault item/field so EVERY existing readUserEnv("X") call becomes vault-aware
// without touching each caller.
//
// For these names THE VAULT WINS over the environment. Before the env→vault migration,
// /start persisted them as User-scope env vars (`setx` on Windows, `export` in ~/.zshrc).
// A leftover one belongs to the user's OLD personal account, so letting it shadow the
// vault silently provisions the WRONG account: the shared worker lands on a personal
// Cloudflare, backups point at a personal Neon, and nothing errors out. Callers such as
// shared-worker/ensure.mjs and shared-worker/register.mjs read these through
// readUserEnv() without attempting the vault themselves, so this ordering is the only
// thing standing between them and the wrong account.
const VAULT_MAP = {
  CLOUDFLARE_API_TOKEN: ["CLOUDFLARE", "api_token"],
  CF_API_TOKEN: ["CLOUDFLARE", "api_token"],
  NEON_API_KEY: ["NEON", "api_key"],
  RESEND_API_KEY: ["RESEND", "api_key"],
  BREVO_API_KEY: ["BREVO", "api_key"],
  HOSTINGER_API_TOKEN: ["HOSTINGER", "api_token"],
};

// Per-process memo. Reading the vault costs a spawn (node → bw), and now that it comes
// FIRST for mapped names, a run that reads several of them would pay it every time
// (shared-worker/register.mjs alone reads CLOUDFLARE_API_TOKEN twice, plus NEON_API_KEY
// and BREVO_API_KEY). A key cannot change mid-process, so caching the answer - null
// included - is safe and keeps the reordering free.
const vaultMemo = new Map();
// Set when the vault answered "locked/expired" rather than "absent": it HAS the value,
// we just cannot read it right now. That distinction decides whether falling back to the
// environment is routine or dangerous.
let vaultLocked = false;
const warned = new Set();

function tryVault(item, field) {
  const memoKey = `${item}.${field}`;
  if (vaultMemo.has(memoKey)) return vaultMemo.get(memoKey);

  let value = null;
  try {
    // vault.mjs is sync (spawnSync bw) and exits non-zero if locked/absent → caught here.
    const url = new URL("./vault/vault.mjs", import.meta.url);
    const out = execSync(
      `node "${fileURLToPathSafe(url)}" get ${item} ${field}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    // vault.mjs writes the raw value with `process.stdout.write` and appends no newline,
    // so there is nothing to trim (and trimming could corrupt a secret ending in space).
    value = out && out.length > 0 ? out : null;
  } catch (e) {
    // 2 = locked, 3 = expired session (vault.mjs exit codes). Anything else (notably
    // 4 = item absent) is a genuine miss and must stay silent.
    if (e && (e.status === 2 || e.status === 3)) vaultLocked = true;
    value = null;
  }

  vaultMemo.set(memoKey, value);
  return value;
}

/**
 * The vault answered AND the environment holds a different value for the same name:
 * that env value is a pre-vault leftover pointing at an old personal account. It is
 * ignored, but say so once, because it should be cleaned up.
 * Identical values are NOT reported: that is the normal case after
 * `eval "$(node wrangler-env-init.mjs)"`, which exports the vault's own value.
 */
function warnStaleEnv(varName, vaultValue) {
  const env = process.env[varName];
  if (!env || env === vaultValue || warned.has(varName)) return;
  warned.add(varName);
  process.stderr.write(
    `[hypervibe] ${varName}: a DIFFERENT value is still set in this machine's environment ` +
    `(left over from before the vault). It was ignored - the vault wins. Remove it.\n`,
  );
}

/**
 * The vault is locked and we are about to trust the environment for a key the vault owns.
 * That is exactly how a stale token silently reaches the wrong account, so it must be
 * loud rather than silent.
 */
function warnLockedFallback(varName) {
  if (warned.has(varName)) return;
  warned.add(varName);
  process.stderr.write(
    `[hypervibe] ${varName}: the vault is LOCKED, falling back to this machine's ` +
    `environment. If that value predates the vault it may point at the WRONG account. ` +
    `Unlock the vault and retry to be certain.\n`,
  );
}

function fileURLToPathSafe(url) {
  // Minimal file:// → path (cross-OS) without importing node:url at top for clarity.
  let p = decodeURIComponent(url.pathname);
  if (platform() === "win32" && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}

/**
 * Read a global key.
 * Order: vault → process.env → OS scope for VAULT_MAP names (the vault is the source of
 * truth for those), and process.env → OS scope for every other name.
 *
 * @param {string} varName  - The env var name to look up.
 * @returns {string | null} - The value, or null if not found anywhere.
 */
export function readUserEnv(varName) {
  if (!varName || !/^[A-Z_][A-Z0-9_]*$/.test(varName)) return null;

  const mapped = VAULT_MAP[varName];

  // 1. Vault first for migrated global keys. It owns these values since the env→vault
  //    migration, so an env var of the same name can only be an older, personal one.
  if (mapped) {
    const v = tryVault(mapped[0], mapped[1]);
    if (v) {
      warnStaleEnv(varName, v);
      return v;
    }
  }

  // 2. Current process env - fast path, and the only path for unmapped names.
  if (process.env[varName] && process.env[varName].length > 0) {
    if (mapped && vaultLocked) warnLockedFallback(varName);
    return process.env[varName];
  }

  // 3. OS-specific persistent storage
  const os = platform();
  const v = os === "win32" ? readFromWindowsRegistry(varName) : readFromShellRc(varName, os);
  if (v && mapped && vaultLocked) warnLockedFallback(varName);
  return v;
}

function readFromWindowsRegistry(varName) {
  try {
    // -NoProfile to skip user PowerShell profile (faster + no side effects).
    // The PowerShell call returns the literal value or "" if the var is unset.
    // Trim trailing CRLF.
    const out = execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${varName}', 'User')"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const v = (out || "").replace(/\r?\n$/, "");
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function readFromShellRc(varName, os) {
  // Search order: rc files most likely to contain user-set env vars.
  // ~/.profile is fallback (used by bash on systems without ~/.bashrc).
  const candidates = os === "darwin"
    ? [".zshrc", ".bashrc", ".profile"]
    : [".bashrc", ".profile", ".zshrc"];

  for (const rc of candidates) {
    const path = join(homedir(), rc);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf8");
      // Match: `export VAR=value`, `export VAR="value"`, `export VAR='value'`
      // - `^\s*` allows leading whitespace
      // - We grab the LAST occurrence (in case the user set the var multiple
      //   times by re-running /start), since shells use last-wins semantics
      const re = new RegExp(
        `^\\s*export\\s+${escapeRe(varName)}\\s*=\\s*(.+?)\\s*$`,
        "gm",
      );
      let last = null;
      let m;
      while ((m = re.exec(content)) !== null) last = m[1];
      if (last !== null) return stripQuotes(last);
    } catch {
      // unreadable rc file - try next candidate
    }
  }
  return null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripQuotes(s) {
  if (s.length >= 2) {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ─── CLI entry point ──────────────────────────────────────────────────
// Detect "called as a script" by checking that this file is the entry point.
// We use process.argv[1] vs import.meta.url comparison (resolves symlinks etc).
import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const varName = process.argv[2];
  if (!varName) {
    console.error("Usage: _read-user-env.mjs <VAR_NAME>");
    process.exit(1);
  }
  const value = readUserEnv(varName);
  if (value === null) {
    process.exit(2);
  }
  process.stdout.write(value);
  process.exit(0);
}
