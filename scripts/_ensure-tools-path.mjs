// _ensure-tools-path.mjs - Prepend common CLI install dirs to process.env.PATH
// so subprocess invocations (`pnpm`, `gh`, `vercel`, `git`, `node`, …) find
// their binaries even if the parent Claude Code session inherited a stale PATH
// (typical when /start has just installed tools via winget/brew but Claude was
// launched before the install).
//
// Idempotent: only prepends dirs that exist AND aren't already in PATH.
// Cross-platform: handles Windows/Mac/Linux conventions.
//
// USAGE (in any script that calls CLIs via child_process):
//   import { ensureToolsInPath } from "./_ensure-tools-path.mjs";
//   ensureToolsInPath();
//   // ... now `execSync("pnpm --version")` works

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function ensureToolsInPath() {
  const os = platform();
  const candidates = [];

  if (os === "win32") {
    candidates.push(
      // Node.js installer
      "C:\\Program Files\\nodejs",
      // Git for Windows
      "C:\\Program Files\\Git\\cmd",
      // GitHub CLI (winget default)
      "C:\\Program Files\\GitHub CLI",
      // npm global bin (where pnpm.cmd, vercel.cmd, resend.cmd land)
      process.env.APPDATA ? join(process.env.APPDATA, "npm") : null,
      // pnpm setup target
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "pnpm") : null,
    );
  } else if (os === "darwin") {
    candidates.push(
      // Homebrew ARM
      "/opt/homebrew/bin",
      // Homebrew Intel
      "/usr/local/bin",
      // pnpm setup target
      join(homedir(), "Library", "pnpm"),
      // Cargo / asdf - common dev installs
      join(homedir(), ".cargo", "bin"),
    );
  } else {
    // Linux
    candidates.push(
      "/usr/local/bin",
      "/usr/bin",
      join(homedir(), ".local", "bin"),
      // pnpm setup target
      join(homedir(), ".local", "share", "pnpm"),
    );
  }

  const sep = os === "win32" ? ";" : ":";
  const current = process.env.PATH || "";
  const currentLower = current.toLowerCase();
  const toAdd = [];

  for (const dir of candidates) {
    if (!dir) continue;
    if (!existsSync(dir)) continue;
    // Skip if already in PATH (case-insensitive on Windows)
    const dirLower = dir.toLowerCase();
    const alreadyIn = currentLower
      .split(sep.toLowerCase())
      .some((p) => p.trim() === dirLower);
    if (alreadyIn) continue;
    toAdd.push(dir);
  }

  if (toAdd.length === 0) return;
  process.env.PATH = toAdd.join(sep) + sep + current;
}

// CLI mode: if invoked directly, print export statements (Git Bash compatible)
// so bash sessions can eval the output:
//   eval "$(node scripts/_ensure-tools-path.mjs)"
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const before = process.env.PATH;
  ensureToolsInPath();
  const after = process.env.PATH;
  if (before !== after) {
    // Compute the diff (what was prepended)
    const added = after.slice(0, after.length - before.length).replace(/[;:]$/, "");
    // Convert Windows paths to Git Bash form (C:\X → /c/X) for portability
    const sep = platform() === "win32" ? ";" : ":";
    const parts = added.split(sep).filter(Boolean);
    const unixParts = parts.map((p) => {
      if (platform() === "win32" && /^[A-Za-z]:/.test(p)) {
        return p
          .replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)
          .replace(/\\/g, "/");
      }
      return p;
    });
    process.stdout.write(`export PATH="${unixParts.join(":")}:$PATH"\n`);
  }
}
