#!/usr/bin/env node
// launch.mjs - Cross-OS launcher for the INTERACTIVE vault operations.
//
// Opens a real terminal window running `node interactive.mjs <cmd> <flags>`, so the user
// types their master password / secret values in a genuine TTY - never in Claude's tool I/O.
// BLOCKS until the operation finishes (so the caller can then read with vault.mjs).
//
//   node launch.mjs login  [--server <url>]
//   node launch.mjs unlock
//   node launch.mjs add --name <ITEM> [--service <S>] [--fields "..."] [--folder <F>]
//
// Design note: ALL secret logic is in interactive.mjs (cross-OS Node). This launcher only
// knows how to OPEN a window per OS - the single piece of OS-specific code in the vault layer.

import { spawnSync, spawn } from "node:child_process";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTERACTIVE = join(__dirname, "interactive.mjs");

const [cmd, ...passthrough] = process.argv.slice(2);
if (!["login", "unlock", "add"].includes(cmd)) {
  console.error("Usage: launch.mjs <login|unlock|add> [flags]");
  process.exit(1);
}

const os = platform();

if (os === "win32") {
  // Open a NEW console window running `node interactive.mjs <cmd> <flags>` and wait for it.
  // Start-Process -FilePath node creates a fresh console (a real TTY → masked input works),
  // -Wait blocks until the user finishes. Clean arg array, no nested `& node` quoting.
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const argList = ["--no-deprecation", INTERACTIVE, cmd, ...passthrough].map(q).join(",");
  // CRITICAL: capture the INNER node process exit code, not PowerShell's. Plain
  // `Start-Process -Wait` makes PowerShell exit 0 as soon as it launched the window -
  // even if interactive.mjs failed (wrong password / wrong 2FA code). `-PassThru` returns
  // the process object so we can `exit $p.ExitCode` and propagate the REAL result.
  // Without this, a failed login looked like a success to the caller (bug confirmed 2026-05-31).
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `$p = Start-Process -FilePath node -ArgumentList @(${argList}) -Wait -PassThru; exit $p.ExitCode`],
    { stdio: "inherit" }
  );
  process.exit(res.status || 0);
} else {
  // macOS / Linux - UNTESTED (validate on a real machine before shipping to non-Windows users).
  // Open a terminal running the node command, then `touch` a sentinel so we can block here.
  const sentinel = join(tmpdir(), `hv-vault-${cmd}-${process.pid}.done`);
  try { if (existsSync(sentinel)) rmSync(sentinel); } catch {}
  const sh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const nodeCmd = ["node", "--no-deprecation", sh(INTERACTIVE), sh(cmd), ...passthrough.map(sh)].join(" ");
  // Write the inner command's EXIT CODE into the sentinel (not a bare `touch`), so a failed
  // login/unlock (wrong password or 2FA) propagates back instead of looking like a success.
  const runLine = `${nodeCmd}; echo $? > ${sh(sentinel)}`;

  // UX safety net: if the window does not open (permission denied, no emulator...), the user
  // immediately sees what to run by hand instead of waiting for the timeout.
  console.error(`[vault] A Terminal window will open for the "${cmd}" operation.`);
  console.error(`[vault] If nothing opens, run this manually in a terminal:\n           ${nodeCmd}`);

  if (os === "darwin") {
    // `do script` returns as soon as Terminal has started the command, so the osascript status
    // reflects whether we were ALLOWED to drive Terminal (macOS Automation permission).
    // We fail fast and clearly instead of waiting 15 min for a window that will never come.
    const osa = `tell application "Terminal"\n  activate\n  do script ${JSON.stringify(runLine)}\nend tell`;
    const r = spawnSync("osascript", ["-e", osa], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(`[vault] Failed to open Terminal via osascript${r.stderr ? ": " + r.stderr.trim() : ""}.`);
      console.error("[vault] Allow Terminal in System Settings -> Privacy & Security -> Automation, then try again - or run the command above manually.");
      process.exit(1);
    }
  } else {
    // Linux: try common emulators in order.
    const tried = [
      ["x-terminal-emulator", ["-e", "bash", "-lc", runLine]],
      ["gnome-terminal", ["--", "bash", "-lc", runLine]],
      ["konsole", ["-e", "bash", "-lc", runLine]],
      ["xterm", ["-e", "bash", "-lc", runLine]],
    ];
    let launched = false;
    for (const [bin, args] of tried) {
      const r = spawnSync("bash", ["-lc", `command -v ${bin}`], { stdio: "ignore" });
      if (r.status === 0) { spawn(bin, args, { stdio: "ignore", detached: true }).unref(); launched = true; break; }
    }
    if (!launched) {
      console.error(`[vault] No terminal emulator found. Run manually: ${nodeCmd}`);
      process.exit(1);
    }
  }

  // Block until the sentinel appears (user finished in the window). Timeout ~15 min.
  const deadline = Date.now() + 15 * 60 * 1000;
  while (!existsSync(sentinel)) {
    if (Date.now() > deadline) { console.error("[vault] Timed out waiting for the terminal window."); process.exit(1); }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Propagate the inner exit code written into the sentinel (0 = success).
  let code = 0;
  try { code = parseInt(readFileSync(sentinel, "utf8").trim(), 10); } catch {}
  if (!Number.isInteger(code)) code = 0;
  try { rmSync(sentinel); } catch {}
  process.exit(code);
}
