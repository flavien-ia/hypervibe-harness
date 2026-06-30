#!/usr/bin/env node
// interactive.mjs - Cross-OS interactive vault operations (login / unlock / add).
//
// ALL secret-touching logic lives here, in ONE Node file, so behavior is IDENTICAL on
// Windows / macOS / Linux. The only OS-specific code is in launch.mjs (opening a terminal
// window). This script runs INSIDE that launched window, where stdin is a real TTY - so
// masked input (raw mode) works everywhere.
//
//   node interactive.mjs login  [--server <url>]
//   node interactive.mjs unlock
//   node interactive.mjs add --name <ITEM> [--service <S>] [--fields "f1:secret,f2:text"] [--folder <F>]
//
// Session file (written by unlock, read by vault.mjs): ~/.hypervibe/bw-session  ("<ts>\n<token>")

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const IS_WIN = platform() === "win32";
const __dirname = dirname(fileURLToPath(import.meta.url));

// Defensive JSON parse: bw output can be empty/whitespace on a cold start → fall back, never throw.
const parseJson = (s, fallback) => {
  try { const t = (s || "").trim(); return t ? JSON.parse(t) : fallback; }
  catch { return fallback; }
};

const SESSION_DIR = join(homedir(), ".hypervibe");
const SESSION_FILE = join(SESSION_DIR, "bw-session");
const TTL = 12 * 60 * 60;

// ── input helpers (work on a real TTY, cross-OS) ──────────────────────
function promptVisible(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a); });
  });
}

// Masked input via raw-mode TTY. Detection by char code (no control-char literals).
function promptMasked(q) {
  return new Promise((resolve, reject) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    if (typeof stdin.setRawMode !== "function") {
      return reject(new Error("No TTY for masked input (run inside a terminal window)."));
    }
    let buf = "";
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const finish = (val) => {
      stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData);
      process.stdout.write("\n"); resolve(val);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) return finish(buf);       // Enter
        if (code === 3) { stdin.setRawMode(false); process.exit(130); } // Ctrl+C
        if (code === 8 || code === 127) {                          // Backspace/DEL
          if (buf.length) { buf = buf.slice(0, -1); process.stdout.write("\b \b"); } // erase one star
          continue;
        }
        if (code < 32) continue;                                   // other control chars
        buf += ch;
        process.stdout.write("*");                                 // masked feedback: 1 star per character
      }
    };
    stdin.on("data", onData);
  });
}

// ── bw helper ─────────────────────────────────────────────────────────
// `bw` command - resolved by PROBING ABSOLUTE LOCATIONS FIRST, then PATH (PATH-independent).
// The launched window often lacks ~/.hypervibe/bin on PATH; on Windows a missing bw returns a
// non-zero STATUS (not ENOENT, since shell:true), so an ENOENT fallback never fires → `bw status`
// came back EMPTY → "Not logged in" loop even when logged in (bug fixed 2026-05-31). We pick the
// first absolute bw that exists (bw.exe on Windows) and only fall back to bare "bw" on PATH.
const BW_EXE = IS_WIN ? "bw.exe" : "bw";
let BW_CMD = null;
function resolveBwCmd() {
  if (BW_CMD) return BW_CMD;
  const candidates = [
    join(homedir(), ".hypervibe", "bin", BW_EXE),
    join(homedir(), "bin", BW_EXE),
    "/opt/homebrew/bin/bw",
    "/usr/local/bin/bw",
  ];
  for (const cand of candidates) {
    if (existsSync(cand)) { BW_CMD = cand; return BW_CMD; }
  }
  BW_CMD = "bw"; // last resort: rely on PATH
  return BW_CMD;
}

/** Returns true if the resolved bw actually runs. */
function bwRuns() {
  const cmd = resolveBwCmd();
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: IS_WIN && cmd === "bw", windowsHide: true });
  return r.status === 0;
}

/**
 * Make sure `bw` is installed and runnable. If not, run the plugin's install-bw.mjs ONCE
 * (it downloads the standalone binary into ~/.hypervibe/bin), then re-resolve. This is what
 * makes a missing tool self-heal instead of dead-ending the user. Idempotent: install-bw.mjs
 * prints OK and does nothing when bw is already present.
 */
function ensureBw() {
  if (bwRuns()) return true;
  const installer = join(__dirname, "install-bw.mjs");
  if (!existsSync(installer)) return false;
  console.log("Vault tool not found, running automatic installation...\n");
  const r = spawnSync("node", ["--no-deprecation", installer], { encoding: "utf8", windowsHide: true });
  if (r.stdout) console.log(r.stdout.trim());
  BW_CMD = null;            // force re-resolution against the freshly installed binary
  // install-bw added ~/.hypervibe/bin to the User PATH, but THIS process won't see it; the
  // absolute-path probe in resolveBwCmd() picks up ~/.hypervibe/bin/bw(.exe) directly.
  return bwRuns();
}

function bw(args, { input, session, inherit } = {}) {
  const env = { ...process.env };
  if (session) env.BW_SESSION = session;
  const cmd = resolveBwCmd();
  const useShell = IS_WIN && cmd === "bw"; // shell only needed for the bare name on Windows
  const opts = {
    encoding: "utf8",
    env,
    input,
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    shell: useShell,
    windowsHide: true,
  };
  return spawnSync(cmd, args, opts);
}

function readValidSession() {
  if (!existsSync(SESSION_FILE)) return null;
  const [tsLine, token] = readFileSync(SESSION_FILE, "utf8").split(/\r?\n/);
  const ts = parseInt(tsLine, 10);
  if (!ts || !token) return null;
  if (Math.floor(Date.now() / 1000) - ts > TTL) return null;
  return token;
}

// ── flags ─────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const k = rest[i].slice(2);
    flags[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
  }
}

const pause = () => promptVisible("\nPress Enter to close...");

// ── commands ──────────────────────────────────────────────────────────
async function doLogin() {
  const server = flags.server || "https://vault.bitwarden.eu";
  let status = parseJson(bw(["status"]).stdout, {});
  if (!status.serverUrl || status.serverUrl !== server) {
    if (status.status && status.status !== "unauthenticated") bw(["logout"]);
    bw(["config", "server", server]);
    status = parseJson(bw(["status"]).stdout, {});
  }
  if (status.status && status.status !== "unauthenticated") {
    console.log(`Already logged in as ${status.userEmail} on ${status.serverUrl}.`);
    return;
  }
  // Collect email (visible) and master password OURSELVES so the password field shows
  // masking stars - exactly like unlock/add. If we delegated the whole prompt to
  // `bw login` (inherit), bw's own password input is FULLY hidden (no stars at all),
  // which feels broken to users. We pass the password via env (--passwordenv) and let
  // bw handle only the 2FA step interactively (it prompts by itself when 2FA is on).
  const email = await promptVisible("Email: ");
  if (!email) throw new Error("Email required.");
  const pwd = await promptMasked("Master password: ");
  console.log("");
  console.log("Signing in...");
  console.log("");
  console.log("If two-factor authentication (2FA) is enabled on your account, a CODE will be requested right after.");
  console.log("  - Depending on your setup, this code arrives either in your authenticator app (Google Authenticator, etc.),");
  console.log("    or by EMAIL (check your inbox, the message arrives at sign-in time).");
  console.log("  - Type the code into this window, then Enter.");
  console.log("");
  const loginCmd = resolveBwCmd();
  const res = spawnSync(loginCmd, ["login", email, "--passwordenv", "BW_PASSWORD_LOGIN"], {
    encoding: "utf8",
    env: { ...process.env, BW_PASSWORD_LOGIN: pwd },
    stdio: "inherit",      // keep stdin live so bw can prompt for the 2FA code if needed
    shell: IS_WIN && loginCmd === "bw",
    windowsHide: true,
  });
  if (res.status !== 0) throw new Error("Sign-in failed (wrong password or 2FA code?). Run again to retry.");
  console.log("\nSigned in. Next step: unlock.");
}

async function doUnlock() {
  // Distinguish "bw not found" from "genuinely not logged in". A null status means bw could not
  // run at all (resolution/PATH problem) - different message + non-zero exit so the caller does
  // NOT loop on unlock. `unauthenticated` means bw ran fine but no account is logged in here.
  const statusRes = bw(["status"]);
  const status = parseJson(statusRes.stdout, null);
  if (status === null) {
    throw new Error("Cannot run the vault tool (bw not found). Run _add-keyring again to reinstall the tool.");
  }
  if (!status.status || status.status === "unauthenticated") {
    throw new Error("No account signed in on this machine. Sign in first (login step) before unlocking.");
  }
  console.log(`Unlocking vault for ${status.userEmail}...`);
  const pwd = await promptMasked("Master password: ");
  const unlockCmd = resolveBwCmd();
  const res = spawnSync(unlockCmd, ["unlock", "--passwordenv", "BW_PASSWORD_UNLOCK", "--raw"], {
    encoding: "utf8",
    env: { ...process.env, BW_PASSWORD_UNLOCK: pwd },
    shell: IS_WIN && unlockCmd === "bw",
    windowsHide: true,
  });
  const token = (res.stdout || "").trim();
  if (!token) throw new Error("Unlock failed (wrong password?).");
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, `${Math.floor(Date.now() / 1000)}\n${token}`, "utf8");
  console.log("Vault unlocked. Session valid for 12h.");
}

async function doAdd() {
  const session = readValidSession();
  if (!session) throw new Error("Vault locked or session expired. Unlock first.");

  let name = flags.name, service = flags.service, fieldsSpec = flags.fields || "value:secret";
  const folder = flags.folder || "Global";
  if (!name) {
    name = await promptVisible("Item name (e.g., CLOUDFLARE): ");
    if (!name) throw new Error("Name required.");
    service = await promptVisible("Service (optional): ");
    const fi = await promptVisible("Fields (name:type,... ; default value:secret): ");
    if (fi) fieldsSpec = fi;
  }

  const specs = fieldsSpec.split(",").map((s) => {
    const [n, t = "secret"] = s.trim().split(":");
    return { name: n.trim(), type: t.trim().toLowerCase() };
  });
  for (const s of specs) if (s.type !== "secret" && s.type !== "text") throw new Error(`Bad field type: ${s.type}`);

  bw(["sync", "--quiet"], { session });
  const folders = parseJson(bw(["list","folders"],{session}).stdout, []);
  let folderObj = folders.find((f) => f.name === folder);
  if (!folderObj) {
    const enc = bw(["encode"], { input: JSON.stringify({ name: folder }) }).stdout;
    folderObj = parseJson(bw(["create","folder"],{input:enc,session}).stdout, null);
  }
  if (!folderObj || !folderObj.id) throw new Error(`Cannot resolve/create the folder '${folder}' in the vault.`);
  const folderId = folderObj.id;
  const search = parseJson(bw(["list","items","--search",name],{session}).stdout, []);
  const existing = search.find((i) => i.name === name && i.folderId === folderId);

  console.log(`\nStoring '${name}' in folder '${folder}'${service ? ` (service: ${service})` : ""}\n`);
  const fields = [];
  for (const s of specs) {
    const val = s.type === "secret" ? await promptMasked(`${s.name} (hidden): `) : await promptVisible(`${s.name}: `);
    if (!val) throw new Error(`Empty value for '${s.name}'.`);
    fields.push({ name: s.name, value: val, type: s.type === "secret" ? 1 : 0, linkedId: null });
  }

  const payload = {
    organizationId: null, folderId, type: 2, name,
    notes: service ? `Service: ${service}` : null,
    favorite: false, fields, secureNote: { type: 0 },
    login: null, card: null, identity: null, reprompt: 0,
  };
  const enc = bw(["encode"], { input: JSON.stringify(payload) }).stdout;
  const res = existing
    ? bw(["edit", "item", existing.id], { input: enc, session })
    : bw(["create", "item"], { input: enc, session });
  if (res.status !== 0) throw new Error(`Failed to ${existing ? "update" : "create"} '${name}'.`);
  console.log(`${existing ? "Updated" : "Created"} '${name}'.`);
}

(async () => {
  try {
    // Self-heal: ensure the bw tool exists (auto-install once) before any command runs.
    if (!ensureBw()) {
      throw new Error("The vault tool (bw) was not found and automatic installation failed. Check your connection, or install it manually: https://bitwarden.com/help/cli/");
    }
    if (cmd === "login") await doLogin();
    else if (cmd === "unlock") await doUnlock();
    else if (cmd === "add") await doAdd();
    else { console.error("Usage: interactive.mjs <login|unlock|add> [flags]"); process.exit(1); }
    await pause();
    process.exit(0);
  } catch (e) {
    console.error("\n" + (e.message || String(e)));
    await pause();
    process.exit(1);
  }
})();
