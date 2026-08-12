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
//   node interactive.mjs collect-env --keys "KEY:secret,..." --project-dir <dir> [--target ...] [--url <url>]
//
// Two destinations, one window: `add` stores a GLOBAL key in the vault, `collect-env`
// stores a PROJECT secret in that project's .env + Vercel. Both keep the value inside
// this process - it never crosses Claude's tool I/O.
//
// Session file (written by unlock, read by vault.mjs): ~/.hypervibe/bw-session  ("<ts>\n<token>")

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { resolveLang, makeT } from "./i18n.mjs";

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
  console.log(t("installing"));
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

// The window cannot see the conversation, so it cannot infer the user's language.
// The calling skill passes `--lang fr`; without it we fall back to the OS locale.
const LANG = resolveLang(flags.lang);
const t = makeT(LANG);

const pause = () => promptVisible(t("pressEnter"));

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
    console.log(t("alreadyLoggedIn", { email: status.userEmail, server: status.serverUrl }));
    return;
  }
  // Collect email (visible) and master password OURSELVES so the password field shows
  // masking stars - exactly like unlock/add. If we delegated the whole prompt to
  // `bw login` (inherit), bw's own password input is FULLY hidden (no stars at all),
  // which feels broken to users. We pass the password via env (--passwordenv) and let
  // bw handle only the 2FA step interactively (it prompts by itself when 2FA is on).
  const email = await promptVisible(t("email"));
  if (!email) throw new Error(t("emailRequired"));
  const pwd = await promptMasked(t("masterPassword"));
  console.log("");
  console.log(t("signingIn"));
  console.log("");
  console.log(t("twoFactorIntro"));
  console.log(t("twoFactorWhere"));
  console.log(t("twoFactorMail"));
  console.log(t("twoFactorType"));
  console.log("");
  const loginCmd = resolveBwCmd();
  const res = spawnSync(loginCmd, ["login", email, "--passwordenv", "BW_PASSWORD_LOGIN"], {
    encoding: "utf8",
    env: { ...process.env, BW_PASSWORD_LOGIN: pwd },
    stdio: "inherit",      // keep stdin live so bw can prompt for the 2FA code if needed
    shell: IS_WIN && loginCmd === "bw",
    windowsHide: true,
  });
  if (res.status !== 0) throw new Error(t("signInFailed"));
  console.log(t("signedIn"));
}

async function doUnlock() {
  // Distinguish "bw not found" from "genuinely not logged in". A null status means bw could not
  // run at all (resolution/PATH problem) - different message + non-zero exit so the caller does
  // NOT loop on unlock. `unauthenticated` means bw ran fine but no account is logged in here.
  const statusRes = bw(["status"]);
  const status = parseJson(statusRes.stdout, null);
  if (status === null) {
    throw new Error(t("bwCannotRun"));
  }
  if (!status.status || status.status === "unauthenticated") {
    throw new Error(t("notSignedIn"));
  }
  console.log(t("unlocking", { email: status.userEmail }));
  const pwd = await promptMasked(t("masterPassword"));
  const unlockCmd = resolveBwCmd();
  const res = spawnSync(unlockCmd, ["unlock", "--passwordenv", "BW_PASSWORD_UNLOCK", "--raw"], {
    encoding: "utf8",
    env: { ...process.env, BW_PASSWORD_UNLOCK: pwd },
    shell: IS_WIN && unlockCmd === "bw",
    windowsHide: true,
  });
  const token = (res.stdout || "").trim();
  if (!token) throw new Error(t("unlockFailed"));
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, `${Math.floor(Date.now() / 1000)}\n${token}`, "utf8");
  console.log(t("unlocked"));
}

async function doAdd() {
  const session = readValidSession();
  if (!session) throw new Error(t("vaultLocked"));

  let name = flags.name, service = flags.service, fieldsSpec = flags.fields || "value:secret";
  const folder = flags.folder || "Global";
  if (!name) {
    name = await promptVisible(t("itemName"));
    if (!name) throw new Error(t("nameRequired"));
    service = await promptVisible(t("serviceOptional"));
    const fi = await promptVisible(t("fieldsPrompt"));
    if (fi) fieldsSpec = fi;
  }

  const specs = fieldsSpec.split(",").map((s) => {
    const [n, t = "secret"] = s.trim().split(":");
    return { name: n.trim(), type: t.trim().toLowerCase() };
  });
  for (const s of specs) if (s.type !== "secret" && s.type !== "text") throw new Error(t("badFieldType", { type: s.type }));

  bw(["sync", "--quiet"], { session });
  const folders = parseJson(bw(["list","folders"],{session}).stdout, []);
  let folderObj = folders.find((f) => f.name === folder);
  if (!folderObj) {
    const enc = bw(["encode"], { input: JSON.stringify({ name: folder }) }).stdout;
    folderObj = parseJson(bw(["create","folder"],{input:enc,session}).stdout, null);
  }
  if (!folderObj || !folderObj.id) throw new Error(t("folderFailed", { folder }));
  const folderId = folderObj.id;
  const search = parseJson(bw(["list","items","--search",name],{session}).stdout, []);
  const existing = search.find((i) => i.name === name && i.folderId === folderId);

  console.log(t("storingItem", { name, folder, service: service ? t("serviceSuffix", { service }) : "" }));
  const fields = [];
  for (const s of specs) {
    const val = s.type === "secret" ? await promptMasked(t("hiddenPrompt", { name: s.name })) : await promptVisible(t("plainPrompt", { name: s.name }));
    if (!val) throw new Error(t("emptyValue", { name: s.name }));
    fields.push({ name: s.name, value: val, type: s.type === "secret" ? 1 : 0, linkedId: null });
  }

  // FUSION des champs, jamais remplacement (même règle que `putItem` dans vault.mjs).
  // `bw edit item` réécrit l'item entier : ajouter un seul champ à un élément existant,
  // disons NEON.org_id à côté de sa clé d'API, faisait DISPARAÎTRE la clé sans un mot.
  // Les champs saisis ici gagnent sur leurs homonymes, les autres sont préservés.
  const parNom = new Map((Array.isArray(existing?.fields) ? existing.fields : []).map((f) => [f.name, f]));
  for (const f of fields) parNom.set(f.name, f);

  // Un item d'organisation reste dans son organisation et ses collections : écraser
  // organizationId avec null le sortirait de la collection partagée. Un item personnel
  // garde son dossier.
  const payload = {
    organizationId: existing?.organizationId ?? null,
    ...(existing?.organizationId && Array.isArray(existing?.collectionIds) ? { collectionIds: existing.collectionIds } : {}),
    folderId: existing?.organizationId ? (existing?.folderId ?? null) : folderId,
    type: 2, name,
    notes: service ? `Service: ${service}` : (existing?.notes ?? null),
    favorite: false, fields: [...parNom.values()], secureNote: { type: 0 },
    login: null, card: null, identity: null, reprompt: 0,
  };
  const enc = bw(["encode"], { input: JSON.stringify(payload) }).stdout;
  const res = existing
    ? bw(["edit", "item", existing.id], { input: enc, session })
    : bw(["create", "item"], { input: enc, session });
  if (res.status !== 0) throw new Error(t("saveFailed", { name }));
  console.log(t(existing ? "savedUpdated" : "savedCreated", { name }));
}

// ── collect-env - same masked window, but the value lands in the PROJECT ──
//
// Second destination of the "no secret ever transits through the conversation"
// convention. `add` is for GLOBAL keys reused across projects (they go to the
// vault); `collect-env` is for secrets that belong to ONE project (DATABASE_URL,
// a project-scoped API key...), which by convention live in the project's .env
// plus Vercel, not in the vault.
//
// The value is typed in this window, handed straight to push-env-vars.mjs from
// this same process, and never crosses Claude's tool I/O. Deliberately does NOT
// need the vault: a project may have no vault at all.
//
//   interactive.mjs collect-env --keys "STRIPE_SECRET_KEY:secret,APP_ID:text" \
//     --project-dir C:/DEV/app [--target production,preview] [--url https://...]
async function doCollectEnv() {
  const keysSpec = flags.keys;
  const projectDir = flags["project-dir"];
  if (!keysSpec) throw new Error(t("keysRequired"));
  if (!projectDir) throw new Error(t("projectDirRequired"));
  if (!existsSync(projectDir)) throw new Error(t("projectNotFound", { dir: projectDir }));

  const specs = keysSpec.split(",").map((s) => {
    const [n, t = "secret"] = s.trim().split(":");
    return { name: n.trim(), type: t.trim().toLowerCase() };
  });
  for (const s of specs) {
    if (!s.name) throw new Error(t("emptyKeyName"));
    if (s.type !== "secret" && s.type !== "text") throw new Error(t("badFieldType", { type: s.type }));
  }

  // Optional: send the user to the page where the value is generated.
  if (flags.url && flags.url !== "true") {
    console.log(t("openingUrl", { url: flags.url }));
    console.log(t("grabValue"));
    spawnSync("node", [join(__dirname, "..", "open-url.mjs"), flags.url], { stdio: "ignore" });
  }

  console.log(t("collectIntro", { count: specs.length, dir: projectDir }));
  console.log(t("collectWhere"));
  console.log(t("collectNeverChat"));

  const pairs = [];
  for (const s of specs) {
    const val = s.type === "secret"
      ? await promptMasked(t("hiddenPrompt", { name: s.name }))
      : await promptVisible(t("plainPrompt", { name: s.name }));
    if (!val) throw new Error(t("emptyValue", { name: s.name }));
    pairs.push(`${s.name}=${val}`);
  }

  const args = [join(__dirname, "..", "push-env-vars.mjs")];
  if (flags.target && flags.target !== "true") args.push(`--target=${flags.target}`);
  args.push(...pairs);

  // cwd = the project, so push-env-vars finds the right .env and Vercel link.
  //
  // Capture its output instead of inheriting: push-env-vars speaks to Claude, not to
  // a human ("[vercel] Project not linked (no .vercel/project.json)"). In this window
  // the reader is the user, so we swallow the technical log and print a translated
  // summary instead. On failure we DO surface the raw output: that is the one moment
  // where the technical detail is worth more than the tidy sentence.
  const res = spawnSync("node", args, { cwd: projectDir, encoding: "utf8" });
  const raw = `${res.stdout || ""}${res.stderr || ""}`.trim();
  if (res.status !== 0) throw new Error(t("collectFailed", { detail: raw || String(res.status) }));

  const names = specs.map((s) => s.name).join(", ");
  const pushedToVercel = /Pushed .* to Vercel|\[vercel\] Pushing to Vercel/i.test(raw)
    && !/Skipping Vercel push/i.test(raw);
  console.log(t(pushedToVercel ? "collectSavedVercel" : "collectSavedLocal", { names }));
}

(async () => {
  try {
    // collect-env writes to the project, not to the vault - so it must NOT
    // require bw to be installed. Handle it before the bw self-heal.
    if (cmd === "collect-env") {
      await doCollectEnv();
      await pause();
      process.exit(0);
    }
    // Self-heal: ensure the bw tool exists (auto-install once) before any command runs.
    if (!ensureBw()) {
      throw new Error(t("bwMissing"));
    }
    if (cmd === "login") await doLogin();
    else if (cmd === "unlock") await doUnlock();
    else if (cmd === "add") await doAdd();
    else { console.error("Usage: interactive.mjs <login|unlock|add|collect-env> [flags]"); process.exit(1); }
    await pause();
    process.exit(0);
  } catch (e) {
    console.error("\n" + (e.message || String(e)));
    await pause();
    process.exit(1);
  }
})();
