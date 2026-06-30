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
// Looks up a variable name in this order:
//   1. process.env (current shell - fast path, works whenever the env is loaded)
//   2. OS-specific User scope:
//      - Windows: PowerShell `[Environment]::GetEnvironmentVariable('VAR', 'User')`
//      - macOS:   parse ~/.zshrc, ~/.bashrc, ~/.profile (in this order)
//      - Linux:   parse ~/.bashrc, ~/.profile, ~/.zshrc
//   3. None found → return null (CLI: exit 2)
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
// without touching each caller. Fast path (process.env) still wins; vault is only hit
// for these names when not already in the environment.
const VAULT_MAP = {
  CLOUDFLARE_API_TOKEN: ["CLOUDFLARE", "api_token"],
  CF_API_TOKEN: ["CLOUDFLARE", "api_token"],
  NEON_API_KEY: ["NEON", "api_key"],
  RESEND_API_KEY: ["RESEND", "api_key"],
  BREVO_API_KEY: ["BREVO", "api_key"],
  HOSTINGER_API_TOKEN: ["HOSTINGER", "api_token"],
};

function tryVault(item, field) {
  try {
    // Lazy import to avoid a hard dependency cycle / cost when not needed.
    // vault.mjs is sync (spawnSync bw) and throws if locked/absent → caught here.
    const url = new URL("./vault/vault.mjs", import.meta.url);
    // Synchronous require-style is unavailable for ESM; use a cached dynamic import
    // resolved synchronously via a tiny spawn is overkill - instead call bw via the
    // same mechanism vault.mjs uses. Simplest: shell out to the vault CLI entrypoint.
    const out = execSync(
      `node "${fileURLToPathSafe(url)}" get ${item} ${field}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out && out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function fileURLToPathSafe(url) {
  // Minimal file:// → path (cross-OS) without importing node:url at top for clarity.
  let p = decodeURIComponent(url.pathname);
  if (platform() === "win32" && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}

/**
 * Read a User-scope env var. Order: process.env → vault (for migrated keys) → OS scope.
 *
 * @param {string} varName  - The env var name to look up.
 * @returns {string | null} - The value, or null if not found anywhere.
 */
export function readUserEnv(varName) {
  if (!varName || !/^[A-Z_][A-Z0-9_]*$/.test(varName)) return null;

  // 1. Current process env - fast path.
  if (process.env[varName] && process.env[varName].length > 0) {
    return process.env[varName];
  }

  // 2. Vault (only for migrated global keys; skipped silently if locked/absent).
  if (VAULT_MAP[varName]) {
    const v = tryVault(VAULT_MAP[varName][0], VAULT_MAP[varName][1]);
    if (v) return v;
  }

  // 3. OS-specific persistent storage
  const os = platform();
  if (os === "win32") {
    return readFromWindowsRegistry(varName);
  }
  return readFromShellRc(varName, os);
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
