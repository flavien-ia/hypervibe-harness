#!/usr/bin/env node
// _write-user-env.mjs - Generic User-scope env var writer, cross-platform.
//
// Sibling of _read-user-env.mjs. Persists a value where future Claude Code
// sessions, Bash subshells, etc. will see it via process.env (after a normal
// reload of the shell / a new tab).
//
// USAGE (CLI):
//   node _write-user-env.mjs VAR_NAME "value to store"
//
// USAGE (module):
//   import { writeUserEnv } from "./_write-user-env.mjs";
//   writeUserEnv("RESEND_FULL_ACCESS_KEY", "re_abc123...");
//
// Storage strategy:
//   - Windows : registry under HKCU\Environment via PowerShell
//               [Environment]::SetEnvironmentVariable (NOT setx - see global
//               CLAUDE.md note about setx PATH pitfalls; for non-PATH vars
//               setx is OK, but [Environment]:: is more uniform & cleaner.)
//   - macOS   : append `export VAR="value"` to ~/.zshrc (idempotent - replaces
//               existing export VAR=... line if present, else appends)
//   - Linux   : same as macOS but ~/.bashrc
//
// Idempotent: re-running with the same VAR overwrites the previous value
// without duplicating lines.
//
// Token chars assumed alphanumeric (typical API keys). For values containing
// quotes or shell metas, the helper escapes minimally; values are written via
// a temp file on Windows to dodge cmd-line quoting hell.
//
// Side effect: also sets process.env[VAR] in the current process so subsequent
// reads in the same script see it immediately.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

const VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function writeUserEnv(varName, value) {
  if (!varName || !VAR_NAME_RE.test(varName)) {
    throw new Error(`Invalid var name "${varName}": must match ${VAR_NAME_RE}`);
  }
  if (typeof value !== "string") {
    throw new Error(`Value must be a string (got ${typeof value})`);
  }

  const os = platform();
  if (os === "win32") writeToWindowsRegistry(varName, value);
  else writeToShellRc(varName, value, os);

  // Make it visible immediately to the current process
  process.env[varName] = value;
}

// ─── Windows ──────────────────────────────────────────────────────────
function writeToWindowsRegistry(varName, value) {
  // To dodge all PowerShell quoting headaches with arbitrary token chars,
  // write the value to a temp file and have PowerShell read it back.
  const tmpDir = mkdtempSync(join(tmpdir(), "wenv-"));
  const tmpFile = join(tmpDir, "v.txt");
  writeFileSync(tmpFile, value, "utf8");
  try {
    // Get-Content -Raw preserves the value exactly (no trailing newline added,
    // assuming we wrote it without one). UTF-8 BOM is not added by writeFileSync.
    const psCmd = `$v = Get-Content -Raw -Encoding UTF8 '${tmpFile.replace(/'/g, "''")}'; [Environment]::SetEnvironmentVariable('${varName}', $v, 'User')`;
    execSync(`powershell.exe -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

// ─── macOS / Linux ────────────────────────────────────────────────────
function writeToShellRc(varName, value, os) {
  const home = homedir();
  const rcFile = os === "darwin" ? join(home, ".zshrc") : join(home, ".bashrc");

  // Read existing file (or start fresh if missing)
  let content = existsSync(rcFile) ? readFileSync(rcFile, "utf8") : "";

  // Escape value for double-quoted shell string: \ → \\, " → \", ` → \`, $ → \$
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`").replace(/\$/g, "\\$");
  const newLine = `export ${varName}="${escaped}"`;

  // Match an existing `export VAR=...` line (full-line, ignoring trailing whitespace)
  const lineRe = new RegExp(`^export[ \\t]+${varName}=.*$`, "m");
  if (lineRe.test(content)) {
    content = content.replace(lineRe, newLine);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
    content += `${newLine}\n`;
  }

  writeFileSync(rcFile, content, "utf8");
}

// ─── CLI mode ─────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("_write-user-env.mjs");
if (isMain) {
  const [, , varName, value] = process.argv;
  if (!varName || value === undefined) {
    console.error("Usage: node _write-user-env.mjs VAR_NAME \"value\"");
    process.exit(2);
  }
  try {
    writeUserEnv(varName, value);
    console.log(`✅ Wrote ${varName} (${value.length} chars) to User scope.`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
