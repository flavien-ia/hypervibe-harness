#!/usr/bin/env node
// wrangler-env-init.mjs - Output shell `export` commands to prepare a Bash
// session for Wrangler invocation.
//
// THE PROBLEM (Mac mainly)
// ------------------------
//   1. CLOUDFLARE_API_TOKEN is set via /start in `~/.zshrc` (Mac) or User
//      registry (Windows) but Claude Code's bash subshells don't see it
//      (non-interactive non-login shells don't source ~/.zshrc; Windows-launched
//      Claude Code freezes its env at launch time).
//   2. pnpm-installed `wrangler` (via `pnpm add -g wrangler`) lives in
//      `~/Library/pnpm` (Mac), `~/.local/share/pnpm` (Linux), or
//      `%LOCALAPPDATA%\pnpm` (Windows). If the bash session was started before
//      `pnpm setup` propagated to PATH, `wrangler` is not found.
//
// USAGE (in any SKILL that calls wrangler)
// ----------------------------------------
//   eval "$(node \"${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs\")"
//   wrangler r2 bucket list   # now works regardless of how Claude was launched
//
// OUTPUT (stdout, eval-safe shell commands)
// -----------------------------------------
//   export CLOUDFLARE_API_TOKEN='...'
//   export CF_API_TOKEN='...'
//   export PATH="$HOME/Library/pnpm:$PATH"   # only if pnpm bin not already in PATH
//
// Each line single-quotes the value (works on Unix, Mac, and Windows Git-Bash)
// for safety. Tokens are alphanumeric so shell-injection risk is nil, but we
// quote anyway as defense in depth.
//
// Exit codes:
//   0 → output written successfully (even if no token found - empty output is valid)

import { readUserEnv } from "./_read-user-env.mjs";
import { getSecret } from "./vault/vault.mjs";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const lines = [];

// ─── Cloudflare token ──────────────────────────────────────────────────
// Source of truth = the vault (item CLOUDFLARE, field api_token). Falls back to the
// legacy CLOUDFLARE_API_TOKEN / CF_API_TOKEN env var during the migration period.
let token = null;
try { token = getSecret("CLOUDFLARE", "api_token"); } catch { /* locked/absent → env fallback */ }
if (!token) token = readUserEnv("CLOUDFLARE_API_TOKEN") || readUserEnv("CF_API_TOKEN");
if (token) {
  // Single-quote the value (no expansion); this works on Unix, Mac, and Windows
  // Git-Bash. Token chars are safe anyway.
  const quoted = `'${token.replace(/'/g, "'\\''")}'`;
  lines.push(`export CLOUDFLARE_API_TOKEN=${quoted}`);
  lines.push(`export CF_API_TOKEN=${quoted}`);
}

// ─── pnpm bin in PATH ──────────────────────────────────────────────────
// Compute the canonical pnpm bin dir per OS.
const os = platform();
let pnpmBin;
if (os === "darwin") pnpmBin = join(homedir(), "Library", "pnpm");
else if (os === "win32") pnpmBin = join(homedir(), "AppData", "Local", "pnpm");
else pnpmBin = join(homedir(), ".local", "share", "pnpm");

if (existsSync(pnpmBin)) {
  // Only add to PATH if not already there. We don't have process.env.PATH
  // reliably (Claude Code's spawned bash may have a minimal env), so we always
  // emit the export - the shell deduplicates on PATH lookup, no harm done.
  // Use Unix-style PATH (forward slashes) - Git Bash on Windows accepts it.
  let unixPath = pnpmBin;
  if (os === "win32") {
    // Convert C:\Users\... to /c/Users/... for Git Bash
    unixPath = unixPath.replace(/^([A-Z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, "/");
  }
  lines.push(`export PATH="${unixPath}:$PATH"`);
}

// Output (newline-terminated; eval is happy)
if (lines.length > 0) {
  process.stdout.write(lines.join("\n") + "\n");
}
