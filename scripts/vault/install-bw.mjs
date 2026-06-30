#!/usr/bin/env node
// install-bw.mjs - Ensure the Bitwarden CLI (`bw`) is installed and on PATH. Cross-OS, idempotent.
//
// Mirrors the style of the plugin's other ensure-* scripts (setup-gitleaks-global, ensure-pnpm-globalbin):
// prints a single status token on stdout - OK | INSTALLED | ERROR: <reason>.
//
//   OK        → bw already present and runnable, nothing done
//   INSTALLED → bw was just installed (mention it to the user)
//   ERROR     → install failed (non-blocking for the caller; report + let user install manually)
//
// Install strategy (avoids `npm/pnpm i -g @bitwarden/cli` which breaks on Windows with
// "Cannot find module 'buffer/'", verified 2026-05-28):
//   Windows : standalone zip from vault.bitwarden.com → bw.exe in ~/.hypervibe/bin → User PATH (no `setx PATH`)
//   macOS   : `brew install bitwarden-cli` if brew present, else standalone zip
//   Linux   : standalone zip → ~/.hypervibe/bin → ~/.bashrc/.profile PATH line

import { spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

const BIN_DIR = join(homedir(), ".hypervibe", "bin");

function bwWorks() {
  const r = spawnSync("bw", ["--version"], { encoding: "utf8", shell: platform() === "win32", windowsHide: true });
  return r.status === 0;
}

function ok(msg) { process.stdout.write(msg); process.exit(0); }
function fail(reason) { process.stdout.write(`ERROR: ${reason}`); process.exit(0); }

if (bwWorks()) ok("OK");

const os = platform();
try {
  if (os === "win32") {
    installWindows();
  } else if (os === "darwin") {
    installMac();
  } else {
    installLinux();
  }
} catch (e) {
  fail(e.message || String(e));
}

if (bwWorks()) ok("INSTALLED");
// Installed to BIN_DIR + added to User PATH, but PATH may not be live in this process.
// Report INSTALLED with a hint so the caller knows to use the absolute path / new shell.
process.stdout.write(`INSTALLED (PATH refresh needed: ${BIN_DIR})`);
process.exit(0);

// ─────────────────────────────────────────────────────────────────────

function installWindows() {
  if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });
  // IMPORTANT: write the PowerShell to a real .ps1 and run it via `-File`, NOT via
  // `-Command "<multi-line string>"`. Passing a multi-line PS script through the
  // cmd→powershell quote/newline escaping silently degrades it: the script can "succeed"
  // (exit 0) in a fraction of a second while having downloaded NOTHING (empty BIN_DIR).
  // That false-success was the cause of "the binary was not downloaded correctly"
  // (verified 2026-05-31). `-File` avoids all quoting issues. `$ProgressPreference =
  // 'SilentlyContinue'` keeps Invoke-WebRequest fast. The binary is the SAME for US/EU
  // (data residency is set at login via --server), so the download host is irrelevant.
  const zip = join(tmpdir(), "bw-cli.zip");
  const ps1 = join(tmpdir(), `_bw_install_${process.pid}.ps1`);
  const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$bin = '${BIN_DIR}'
$zip = '${zip}'
Invoke-WebRequest -Uri 'https://vault.bitwarden.com/download/?app=cli&platform=windows' -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $bin -Force
Remove-Item $zip -Force
$u = [Environment]::GetEnvironmentVariable('Path','User')
if ($u -notlike "*$bin*") { [Environment]::SetEnvironmentVariable('Path', "$u;$bin", 'User') }
`;
  writeFileSync(ps1, script, "utf8");
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
  } finally {
    try { rmSync(ps1, { force: true }); } catch { /* best effort */ }
  }
  // Verify the binary REALLY landed - never report a false success on an empty dir.
  const exe = join(BIN_DIR, "bw.exe");
  if (!existsSync(exe) || statSync(exe).size < 1_000_000) {
    throw new Error("bw.exe download incomplete (check your connection and try again)");
  }
  // Make bw resolvable in THIS process too (caller still exports for the session shell).
  process.env.PATH = `${process.env.PATH};${BIN_DIR}`;
}

function installMac() {
  // Prefer Homebrew, else standalone zip. `brew` may NOT be on PATH yet (a fresh Homebrew
  // install doesn't update the current shell's PATH), so resolve it by PATH then by the
  // standard absolute locations: /opt/homebrew (Apple Silicon) or /usr/local (Intel).
  let brewBin = null;
  for (const cand of ["brew", "/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) {
    if (spawnSync(cand, ["--version"], { encoding: "utf8" }).status === 0) { brewBin = cand; break; }
  }
  if (brewBin) {
    execSync(`"${brewBin}" install bitwarden-cli`, { stdio: ["ignore", "pipe", "pipe"] });
    return;
  }
  installUnixStandalone("macos");
}

function installLinux() {
  installUnixStandalone("linux");
}

function installUnixStandalone(platformSlug) {
  // TODO (Unix port - untested): download + unzip + PATH line. Written to mirror Windows;
  // validate on a real macOS/Linux box before relying on it.
  if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });
  const url = `https://vault.bitwarden.com/download/?app=cli&platform=${platformSlug}`;
  const zip = join(homedir(), ".hypervibe", "bw-cli.zip");
  execSync(`curl -fsSL "${url}" -o "${zip}"`, { stdio: ["ignore", "pipe", "pipe"] });
  execSync(`unzip -o "${zip}" -d "${BIN_DIR}" && chmod +x "${join(BIN_DIR, "bw")}" && rm -f "${zip}"`, {
    stdio: ["ignore", "pipe", "pipe"], shell: "/bin/bash",
  });
  // Add to PATH via shell rc (idempotent) - the caller also exports for the session.
  const rc = join(homedir(), platformSlug === "macos" ? ".zshrc" : ".bashrc");
  const line = `export PATH="$PATH:${BIN_DIR}"`;
  execSync(`grep -qF '${BIN_DIR}' "${rc}" 2>/dev/null || echo '${line}' >> "${rc}"`, {
    stdio: ["ignore", "pipe", "pipe"], shell: "/bin/bash",
  });
  process.env.PATH = `${process.env.PATH}:${BIN_DIR}`;
}
