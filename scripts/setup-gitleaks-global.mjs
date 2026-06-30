#!/usr/bin/env node
// setup-gitleaks-global.mjs
// Idempotent machine-wide install of gitleaks + global pre-commit hook.
// Protects all repos on this machine (past/present/future) from secret leaks.
//
// Outputs a single line on stdout:
//   OK         → already installed + configured (no-op)
//   INSTALLED  → fresh setup completed (binary + hook + config + git config)
//   ERROR: <reason> → something went wrong (non-fatal - /start continues)
//
// Cross-platform: Windows, macOS, Linux. Node stdlib only (no extra deps).
// Respects the "no setx PATH" rule on Windows (uses [Environment]::SetEnvironmentVariable).

import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  unlinkSync,
  createWriteStream,
} from "node:fs";
import { homedir, tmpdir, platform, arch as osArch } from "node:os";
import { join } from "node:path";
import https from "node:https";

// ─── Constants ──────────────────────────────────────────────────────────

const HOME = homedir();
const IS_WIN = platform() === "win32";
const IS_MAC = platform() === "darwin";
const IS_LINUX = platform() === "linux";
const ARCH = osArch() === "arm64" ? "arm64" : "x64";

const HOOK_DIR = join(HOME, ".git-hooks");
const HOOK_PATH = join(HOOK_DIR, "pre-commit");
const CONFIG_PATH = join(HOME, ".gitleaks.toml");
const HOOK_MARKER = "# hypervibe-managed gitleaks pre-commit";
const CONFIG_MARKER = "# hypervibe-managed gitleaks config";

const INSTALL_DIR = IS_WIN
  ? join(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"), "gitleaks")
  : join(HOME, ".local", "bin");
const BIN_NAME = IS_WIN ? "gitleaks.exe" : "gitleaks";
const BIN_PATH_DEFAULT = join(INSTALL_DIR, BIN_NAME);

// ─── Helpers ────────────────────────────────────────────────────────────

function bail(msg) {
  console.log(`ERROR: ${msg}`);
  process.exit(0);
}

function run(cmd) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function findGitleaks() {
  // 1. In PATH (which/where)
  const lookup = IS_WIN ? "where gitleaks" : "command -v gitleaks";
  const v = run(lookup);
  if (v) return v.split(/\r?\n/)[0].trim();
  // 2. Default install location
  if (existsSync(BIN_PATH_DEFAULT)) return BIN_PATH_DEFAULT;
  return null;
}

function getGitleaksVersion(bin) {
  const out = run(`"${bin}" version`);
  if (!out) return null;
  const m = out.match(/v?(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

// Detect which command-line syntax this gitleaks version expects for staged-diff scanning.
// v8.22+ removed `protect` → use `git --staged` (NOT `--pre-commit` which scans unstaged diff)
// v8.x <8.22 supports both
function gitleaksScanCmd(version) {
  if (!version) return "git --staged"; // safest default for modern versions
  const [maj, min] = version.split(".").map(Number);
  if (maj < 8) return "protect --staged"; // very old, fallback
  if (maj === 8 && min < 22) return "protect --staged";
  return "git --staged";
}

async function httpsRequest(url, depth = 0) {
  if (depth > 5) throw new Error("Too many redirects");
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "hypervibe-setup-gitleaks",
            Accept: "application/json,application/octet-stream,*/*",
          },
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            httpsRequest(res.headers.location, depth + 1).then(resolve, reject);
            return;
          }
          resolve(res);
        },
      )
      .on("error", reject);
  });
}

async function fetchJson(url) {
  const res = await httpsRequest(url);
  if (res.statusCode !== 200) {
    throw new Error(`HTTP ${res.statusCode} on ${url}`);
  }
  let data = "";
  res.setEncoding("utf8");
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

async function downloadFile(url, dest) {
  const res = await httpsRequest(url);
  if (res.statusCode !== 200) {
    throw new Error(`HTTP ${res.statusCode} downloading ${url}`);
  }
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    res.pipe(out);
    out.on("finish", () => out.close(resolve));
    out.on("error", reject);
  });
}

function platformAssetRegex() {
  const plat = IS_WIN ? "windows" : IS_MAC ? "darwin" : "linux";
  const archStr = ARCH;
  const ext = IS_WIN ? "zip" : "tar\\.gz";
  return new RegExp(`gitleaks_[\\d.]+_${plat}_${archStr}\\.${ext}$`);
}

async function installGitleaks() {
  const release = await fetchJson(
    "https://api.github.com/repos/gitleaks/gitleaks/releases/latest",
  );
  const rx = platformAssetRegex();
  const asset = release.assets.find((a) => rx.test(a.name));
  if (!asset) {
    throw new Error(
      `No gitleaks asset matching ${rx} in release ${release.tag_name}`,
    );
  }

  mkdirSync(INSTALL_DIR, { recursive: true });
  const tmpFile = join(tmpdir(), asset.name);
  await downloadFile(asset.browser_download_url, tmpFile);

  if (IS_WIN) {
    // PowerShell zip extract - overwrites silently
    const cmd =
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ` +
      `"Expand-Archive -LiteralPath '${tmpFile}' -DestinationPath '${INSTALL_DIR}' -Force"`;
    const r = spawnSync(cmd, { shell: true, encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`PowerShell extract failed: ${r.stderr || r.stdout}`);
    }
  } else {
    const r = spawnSync(
      "tar",
      ["xzf", tmpFile, "-C", INSTALL_DIR, "gitleaks"],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(`tar extract failed: ${r.stderr || r.stdout}`);
    }
    chmodSync(BIN_PATH_DEFAULT, 0o755);
  }

  try {
    unlinkSync(tmpFile);
  } catch {}

  if (!existsSync(BIN_PATH_DEFAULT)) {
    throw new Error(
      `gitleaks binary not found at ${BIN_PATH_DEFAULT} after extraction`,
    );
  }
  return BIN_PATH_DEFAULT;
}

function ensurePathOnWindows() {
  // CRITICAL: never use `setx PATH ...` - see global CLAUDE.md rule.
  // Use PowerShell [Environment]::SetEnvironmentVariable which writes REG_SZ
  // and reads the resolved (expanded) current value.
  //
  // Pass INSTALL_DIR via env var (not string interpolation) so we never have
  // to worry about backslash escaping between JS, PowerShell, and the registry.
  const ps = `
$user = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $user) { $user = "" }
$target = $env:HYPERVIBE_GITLEAKS_TARGET
if ($user -notlike "*$target*") {
  $sep = ""
  if ($user -and -not $user.EndsWith(";")) { $sep = ";" }
  $new = "$user$sep$target"
  [Environment]::SetEnvironmentVariable("Path", $new, "User")
  Write-Output "ADDED"
} else {
  Write-Output "ALREADY"
}
  `.trim();
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    {
      encoding: "utf8",
      env: { ...process.env, HYPERVIBE_GITLEAKS_TARGET: INSTALL_DIR },
    },
  );
  if (r.status !== 0) {
    throw new Error(`PATH update failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function ensurePathOnUnix() {
  const rcPath = IS_MAC ? join(HOME, ".zshrc") : join(HOME, ".bashrc");
  const marker = "# gitleaks (hypervibe)";
  let existing = "";
  try {
    existing = readFileSync(rcPath, "utf8");
  } catch {}
  if (existing.includes(marker)) return "ALREADY";
  // ~/.local/bin in PATH? If yes, no need to add - just leave the marker.
  const line = `export PATH="$HOME/.local/bin:$PATH"  ${marker}`;
  writeFileSync(
    rcPath,
    existing + (existing.endsWith("\n") || !existing ? "" : "\n") + line + "\n",
  );
  return "ADDED";
}

function toPosixPath(p) {
  if (!IS_WIN) return p;
  // C:\Users\foo → /c/Users/foo (Git Bash style)
  return (
    "/" + p.replace(/^([A-Z]):/, (_, d) => d.toLowerCase()).replace(/\\/g, "/")
  );
}

function writeHook(gitleaksPath, version) {
  if (!existsSync(HOOK_DIR)) mkdirSync(HOOK_DIR, { recursive: true });

  const binPosix = toPosixPath(gitleaksPath);
  const scanCmd = gitleaksScanCmd(version);

  const hook = `#!/usr/bin/env sh
${HOOK_MARKER}
# Auto-installed by Hypervibe /start. Scans staged changes for secrets.
# Bypass exceptionally with: git commit --no-verify
# Allowlist false positives in ~/.gitleaks.toml
# Uninstall: git config --global --unset core.hooksPath && rm "$0"

GITLEAKS="${binPosix}"
if [ ! -x "$GITLEAKS" ]; then
  ALT=$(command -v gitleaks 2>/dev/null)
  [ -n "$ALT" ] && GITLEAKS="$ALT"
fi
if [ -z "$GITLEAKS" ] || [ ! -x "$GITLEAKS" ]; then
  echo "[gitleaks] binary not found at $GITLEAKS - skipping scan." 1>&2
  exit 0
fi

CONFIG_ARG=""
[ -f "$HOME/.gitleaks.toml" ] && CONFIG_ARG="--config=$HOME/.gitleaks.toml"

"$GITLEAKS" ${scanCmd} --redact --no-banner $CONFIG_ARG
RC=$?
if [ $RC -ne 0 ]; then
  echo "" 1>&2
  echo "[gitleaks] Commit BLOCKED - a secret was detected in your staged changes." 1>&2
  echo "[gitleaks] Exceptional bypass: git commit --no-verify" 1>&2
  echo "[gitleaks] Or add an exception in ~/.gitleaks.toml" 1>&2
  exit 1
fi
exit 0
`;
  writeFileSync(HOOK_PATH, hook);
  if (!IS_WIN) chmodSync(HOOK_PATH, 0o755);
}

function writeConfigIfMissing() {
  if (existsSync(CONFIG_PATH)) {
    try {
      const content = readFileSync(CONFIG_PATH, "utf8");
      return content.includes(CONFIG_MARKER) ? "ALREADY" : "USER_OWNED";
    } catch {
      return "USER_OWNED";
    }
  }
  const cfg = `${CONFIG_MARKER}
# Global gitleaks allowlist - minimizes false positives on placeholders,
# lockfiles, fixtures, and typical Hypervibe patterns.
# You can safely edit this file: it will not be overwritten by re-runs.

[extend]
useDefault = true

[allowlist]
description = "Hypervibe global allowlist"
paths = [
  '''(^|/)\\.env\\.(example|sample|template)$''',
  '''(^|/)pnpm-lock\\.yaml$''',
  '''(^|/)package-lock\\.json$''',
  '''(^|/)yarn\\.lock$''',
  '''(^|/)__fixtures__/''',
  '''(^|/)__snapshots__/''',
  '''(^|/)test/fixtures/''',
  '''(^|/)tests/fixtures/''',
  '''(^|/)CHANGELOG\\.md$''',
  '''(^|/)\\.git-hooks/''',
]
regexes = [
  '''postgres(ql)?://postgres:password@localhost''',
  '''postgres(ql)?://user:password@''',
  '''sk-XXX''',
  '''sk-proj-XXX''',
  '''your[-_]?api[-_]?key''',
  '''<your[-_].*[-_]here>''',
]
`;
  writeFileSync(CONFIG_PATH, cfg);
  return "CREATED";
}

function ensureHooksPath() {
  const current = run("git config --global --get core.hooksPath");
  // Git for Windows has a quirk: if core.hooksPath uses MSYS/Cygwin-style
  // paths like `/c/Users/...`, Git invokes the hook but ignores its exit
  // code (silent skip - confirmed empirically). Use native forward-slash
  // Windows paths instead: `C:/Users/...`.
  const target = IS_WIN ? HOOK_DIR.replace(/\\/g, "/") : HOOK_DIR;
  // Tolerate prior installs that may have stored variants.
  const accepted = [
    target,
    HOOK_DIR,
    HOOK_DIR.replace(/\\/g, "/"),
    toPosixPath(HOOK_DIR),
    "~/.git-hooks",
  ];
  if (current && !accepted.includes(current)) {
    return { state: "CONFLICT", current };
  }
  if (current === target) return { state: "ALREADY" };
  run(`git config --global core.hooksPath "${target}"`);
  return { state: "SET" };
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  let installedBin = false;

  // 1) Discover / install gitleaks
  let bin = findGitleaks();
  if (!bin) {
    try {
      bin = await installGitleaks();
      installedBin = true;
    } catch (e) {
      return bail(`gitleaks install failed: ${e.message}`);
    }
  }

  // 2) Detect version to choose the right scan command
  const version = getGitleaksVersion(bin);

  // 3) PATH (best-effort, idempotent - hook uses absolute path anyway,
  //    but having gitleaks in PATH is nice for manual invocation).
  //    Only when binary is in our managed location; if user has a system-wide
  //    install (e.g. brew), don't touch their PATH.
  let pathState = "SKIP";
  if (bin === BIN_PATH_DEFAULT) {
    try {
      pathState = IS_WIN ? ensurePathOnWindows() : ensurePathOnUnix();
    } catch {
      pathState = "ERROR";
    }
  }

  // 4) Hook
  let hookExisted = existsSync(HOOK_PATH);
  let hookIsOurs = false;
  if (hookExisted) {
    try {
      hookIsOurs = readFileSync(HOOK_PATH, "utf8").includes(HOOK_MARKER);
    } catch {}
  }
  if (hookExisted && !hookIsOurs) {
    return bail(
      `~/.git-hooks/pre-commit already exists and is not Hypervibe-managed. Manual merge required.`,
    );
  }
  // Always rewrite the hook (idempotent - same content if re-run)
  try {
    writeHook(bin, version);
  } catch (e) {
    return bail(`hook write failed: ${e.message}`);
  }

  // 5) Config
  let cfgState;
  try {
    cfgState = writeConfigIfMissing();
  } catch (e) {
    return bail(`config write failed: ${e.message}`);
  }

  // 6) core.hooksPath
  let hp;
  try {
    hp = ensureHooksPath();
  } catch (e) {
    return bail(`git config update failed: ${e.message}`);
  }
  if (hp.state === "CONFLICT") {
    return bail(
      `core.hooksPath already set to "${hp.current}". Manual merge required.`,
    );
  }

  // 7) Decide OK vs INSTALLED
  //    OK = nothing changed (full idempotent re-run)
  //    INSTALLED = at least one thing was set up this run
  const changed =
    installedBin ||
    !hookExisted ||
    !hookIsOurs ||
    cfgState === "CREATED" ||
    hp.state === "SET" ||
    pathState === "ADDED";
  console.log(changed ? "INSTALLED" : "OK");
}

main().catch((e) => bail(e.message || String(e)));
