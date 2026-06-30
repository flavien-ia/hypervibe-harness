#!/usr/bin/env node
// ensure-pnpm-globalbin.mjs - Idempotently configure pnpm's global bin dir + PATH on any OS.
//
// Wraps `pnpm setup`, which is the canonical cross-platform way to:
//   - Windows: write PNPM_HOME + PATH to the User registry (REG_SZ)
//   - macOS:   append `export PNPM_HOME=...` + PATH to ~/.zshrc (or shell rc)
//   - Linux:   append the same to ~/.bashrc
//
// `pnpm setup` is idempotent - re-running is a no-op if PNPM_HOME and PATH are
// already configured. If a CLI like `resend` was installed via `pnpm add -g`
// but is "command not found" in a fresh shell, this script fixes the underlying
// PATH config (one-time fix per machine).
//
// Output (single line on stdout):
//   - OK              → pnpm setup completed (or was already in place)
//   - ERROR: <reason> → pnpm setup failed; reason printed for Claude to surface
//
// Both `OK` outcomes are non-events for the caller - just continue silently.

import { spawnSync } from "node:child_process";

const res = spawnSync("pnpm setup", {
  stdio: "pipe",
  shell: true,
  encoding: "utf8",
});

if (res.status === 0) {
  // pnpm setup succeeded. It prints instructions ("please open a new terminal")
  // to stdout - we don't relay them; the SKILL handles user-facing comms.
  console.log("OK");
  process.exit(0);
}

const stderr = (res.stderr || "").trim();
const stdout = (res.stdout || "").trim();
const reason = stderr || stdout || `exit ${res.status}`;
console.log(`ERROR: ${reason.replace(/\s+/g, " ").slice(0, 300)}`);
process.exit(1);
