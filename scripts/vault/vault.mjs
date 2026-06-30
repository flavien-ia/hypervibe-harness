#!/usr/bin/env node
// vault.mjs - Cross-OS, NON-INTERACTIVE access to the Bitwarden vault for Hypervibe.
//
// This is the workhorse called by every skill that needs to READ a secret.
// It never prompts (no interactivity): it reads the session token written by the
// interactive `unlock` step, checks the 12h TTL, sets BW_SESSION, and shells out to `bw`.
//
// The interactive operations (login / unlock / add) live in launch.mjs +
// interactive.mjs - because they need a real terminal window for masked input
// (Claude's tool I/O can't take a typed master password).
//
// SESSION FILE
// ------------
// ~/.hypervibe/bw-session  (format: "<unix_timestamp>\n<bw_session_token>")
// Lives outside the plugin dir so it survives plugin updates. Written by unlock.
//
// SUBCOMMANDS
// -----------
//   node vault.mjs get <ITEM> [FIELD]   -> prints field value (default field: "value")
//   node vault.mjs delete <ITEM>        -> permanently deletes an item
//   node vault.mjs status               -> prints "unlocked" | "locked" | "expired"
//
// EXIT CODES (mirror the perso bw-get convention, relied on by the auto-unlock pattern)
//   0 ok | 2 vault locked (no session) | 3 session expired (>12h) | 4 item not found
//   5 field not found | 1 other error
//
// MODULE USAGE
//   import { getSecret } from "./vault.mjs";
//   const v = getSecret("CLOUDFLARE", "api_token"); // string  (throws {code} on failure)

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TTL_SECONDS = 12 * 60 * 60; // 12h
const SESSION_FILE = join(homedir(), ".hypervibe", "bw-session");

// `bw` command - resolved by PROBING ABSOLUTE LOCATIONS FIRST, then PATH. This must be
// PATH-independent: the launched terminal window (and Claude's tool shell) often do NOT have
// ~/.hypervibe/bin on PATH, and on Windows a missing `bw` returns a non-zero STATUS (not ENOENT,
// because shell:true), so an ENOENT-based fallback never fires. The old approach therefore got
// EMPTY `bw status` output → parsed as {} → "Not logged in" loop, even when the user WAS logged
// in (bug confirmed 2026-05-31). We instead pick the first absolute bw that exists, including the
// platform-correct extension (bw.exe on Windows), and only fall back to bare "bw" on PATH.
const IS_WIN_VAULT = platform() === "win32";
const BW_EXE = IS_WIN_VAULT ? "bw.exe" : "bw";
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

/** Run the `bw` CLI with args. Returns { status, stdout, stderr }. Optional stdin `input`. */
function runBw(args, sessionToken, input) {
  // BW_NOINTERACTION guarantees bw never blocks on an interactive prompt (e.g. a stale token
  // would otherwise make some commands ask for the master password and hang a non-TTY caller).
  const env = { ...process.env, BW_NOINTERACTION: "true" };
  if (sessionToken) env.BW_SESSION = sessionToken;
  const cmd = resolveBwCmd();
  // shell:true only needed when invoking the bare "bw" name on Windows; an absolute path
  // runs fine without a shell (and avoids the shell-args deprecation warning).
  const useShell = IS_WIN_VAULT && cmd === "bw";
  // timeout is a final safety net: no vault status/read call should ever hang the caller.
  const opts = { encoding: "utf8", env, input, shell: useShell, windowsHide: true, timeout: 20000 };
  const res = spawnSync(cmd, args, opts);
  return {
    status: res.status,
    stdout: (res.stdout || "").toString(),
    stderr: (res.stderr || "").toString(),
  };
}

/** True if a failed bw result indicates the session is not accepted (locked / re-auth needed). */
function isAuthFailure(res) {
  const s = ((res.stderr || "") + (res.stdout || "")).toLowerCase();
  return /master password|not logged in|vault is locked|mac failed|invalid|unauthorized|session key/.test(s);
}

/** Read + validate the session file. Returns { token } or throws { code }. */
function readSession() {
  if (!existsSync(SESSION_FILE)) {
    const e = new Error("Vault locked (no session). Run unlock.");
    e.code = 2;
    throw e;
  }
  const lines = readFileSync(SESSION_FILE, "utf8").split(/\r?\n/);
  const ts = parseInt(lines[0], 10);
  const token = lines[1];
  if (!ts || !token) {
    const e = new Error("Session file malformed. Run unlock.");
    e.code = 2;
    throw e;
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - ts;
  if (ageSeconds > TTL_SECONDS) {
    const e = new Error("Session expired (>12h). Run unlock.");
    e.code = 3;
    throw e;
  }
  return { token };
}

/**
 * Read a field from a vault item. Returns the value as a string.
 * Throws an Error with `.code` (2/3/4/5/1) on failure.
 */
export function getSecret(itemName, field = "value") {
  if (!/^[A-Za-z0-9_]+$/.test(itemName)) {
    const e = new Error(`Invalid item name: ${itemName}`);
    e.code = 1;
    throw e;
  }
  const { token } = readSession();
  // Resolve by EXACT name via list+filter. bw's fuzzy `get item <name>` returns a WRONG item
  // when the requested name is a substring/prefix of another item's name (e.g. asking for
  // OPENAI when only OPENAI_ADMIN exists) -> it silently hands back the wrong secret. We list
  // and match on name equality instead. (Same root cause as the old `deleteSecret` bug.)
  const res = runBw(["list", "items", "--search", itemName], token);
  if (res.status !== 0) {
    // Distinguish "session no longer accepted by bw" (re-unlock, code 3) from other failures.
    // A confirmatory `unlock --check` tells us whether the session is actually usable; the error
    // wording isn't stable across bw versions, so we don't rely on regex alone.
    const sessionUsable = runBw(["unlock", "--check", "--nointeraction"], token).status === 0;
    if (isAuthFailure(res) || !sessionUsable) {
      const e = new Error("Session no longer valid (run unlock).");
      e.code = 3;
      throw e;
    }
    const e = new Error(`Could not query vault for '${itemName}'`);
    e.code = 1;
    throw e;
  }
  let candidates;
  try {
    candidates = JSON.parse(res.stdout || "[]");
  } catch {
    const e = new Error("Could not parse bw items JSON");
    e.code = 1;
    throw e;
  }
  // list succeeded -> the session is usable, so a missing exact match means the item is
  // genuinely absent (code 4), not an auth problem. A false "absent" would make a skill offer
  // to ADD a key that already exists, hence we only conclude this when the query itself worked.
  const item = candidates.find((i) => i.name === itemName);
  if (!item) {
    const e = new Error(`Item '${itemName}' not found in vault`);
    e.code = 4;
    throw e;
  }
  const fields = Array.isArray(item.fields) ? item.fields : [];
  const match = fields.find((f) => f.name === field);
  if (!match) {
    const available = fields.map((f) => f.name).join(", ") || "(none)";
    const e = new Error(`Field '${field}' not found on '${itemName}'. Available: ${available}`);
    e.code = 5;
    throw e;
  }
  return match.value;
}

/** Permanently delete a vault item by name. Throws { code } on failure. */
export function deleteSecret(itemName) {
  if (!/^[A-Za-z0-9_]+$/.test(itemName)) {
    const e = new Error(`Invalid item name: ${itemName}`);
    e.code = 1;
    throw e;
  }
  const { token } = readSession();
  // Resolve by EXACT name. `bw get item <name>` does a fuzzy search and fails with
  // "More than one result found" when the name is a PREFIX of another item's name
  // (e.g. OPENAI vs OPENAI_ADMIN) -> it would wrongly report "not found" and never delete.
  // We list + filter on exact name instead. A `sync` first avoids acting on a stale cache.
  runBw(["sync", "--quiet"], token);
  const listed = runBw(["list", "items", "--search", itemName], token);
  if (listed.status !== 0) {
    if (isAuthFailure(listed)) { const e = new Error("Session no longer valid. Run unlock."); e.code = 3; throw e; }
    const e = new Error(`Failed to query vault for '${itemName}'`); e.code = 1; throw e;
  }
  const matches = JSON.parse(listed.stdout || "[]").filter((i) => i.name === itemName);
  if (matches.length === 0) {
    const e = new Error(`Item '${itemName}' not found`);
    e.code = 4;
    throw e;
  }
  if (matches.length > 1) {
    const e = new Error(`Ambiguous: ${matches.length} items named '${itemName}'`);
    e.code = 1;
    throw e;
  }
  const id = matches[0].id;
  const del = runBw(["delete", "item", id, "--permanent"], token);
  if (del.status !== 0) {
    const e = new Error(`Failed to delete '${itemName}'`);
    e.code = 1;
    throw e;
  }
}

/** Create or update an item NON-interactively (value supplied programmatically, not prompted).
 *  Used when the value comes from a file (e.g. a downloaded service-account JSON), not a keystroke.
 *  fields: [{ name, value, type: "secret"|"text" }]. Returns "created" | "updated". Throws { code }. */
export function putItem(name, fields, { service, folder = "Global" } = {}) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) { const e = new Error(`Invalid item name: ${name}`); e.code = 1; throw e; }
  const { token } = readSession();
  runBw(["sync", "--quiet"], token);
  const folders = JSON.parse(runBw(["list", "folders"], token).stdout || "[]");
  let folderObj = folders.find((f) => f.name === folder);
  if (!folderObj) {
    const enc = runBw(["encode"], token, JSON.stringify({ name: folder })).stdout;
    folderObj = JSON.parse(runBw(["create", "folder"], token, enc).stdout || "null");
    if (!folderObj || !folderObj.id) { const e = new Error(`Failed to create vault folder: ${folder}`); e.code = 1; throw e; }
  }
  const folderId = folderObj.id;
  const search = JSON.parse(runBw(["list", "items", "--search", name], token).stdout || "[]");
  const existing = search.find((i) => i.name === name && i.folderId === folderId);
  const payload = {
    organizationId: null, folderId, type: 2, name,
    notes: service ? `Service: ${service}` : null,
    favorite: false,
    fields: fields.map((f) => ({ name: f.name, value: f.value, type: f.type === "text" ? 0 : 1, linkedId: null })),
    secureNote: { type: 0 }, login: null, card: null, identity: null, reprompt: 0,
  };
  const enc = runBw(["encode"], token, JSON.stringify(payload)).stdout;
  const res = existing
    ? runBw(["edit", "item", existing.id], token, enc)
    : runBw(["create", "item"], token, enc);
  if (res.status !== 0) { const e = new Error(`Failed to store '${name}'`); e.code = 1; throw e; }
  return existing ? "updated" : "created";
}

/** Returns "unlocked" | "locked" | "expired". Probes bw with the stored token so it reflects
 *  whether the vault is ACTUALLY usable, not just the file timestamp (a token can be revoked /
 *  rejected before the 12h TTL). We use `unlock --check`, which validates the token against the
 *  unlocked session and returns non-zero ("Vault is locked.") when it is NOT genuinely usable.
 *  Hardened with --nointeraction (+ BW_NOINTERACTION) so a stale token can NEVER make bw hang on
 *  an interactive master-password prompt - it fails fast as "expired" instead.
 *  NB: `bw sync` is deliberately NOT used here - it returns 0 even on an invalid token (it only
 *  pulls public data), so it would falsely report "unlocked".
 *  IMPORTANT: this is the ONLY authoritative "is the vault open?" signal. Do NOT use the bare
 *  `bw status` (no token) to decide - it ALWAYS reports "locked" because the bw daemon holds no
 *  persistent unlocked session of its own; only this Hypervibe token unlocks it. */
export function sessionStatus() {
  let token;
  try {
    token = readSession().token;
  } catch (e) {
    return e.code === 3 ? "expired" : "locked";
  }
  const r = runBw(["unlock", "--check", "--nointeraction"], token);
  if (r.status === 0) return "unlocked";
  // Token present but rejected by bw → expired/revoked rather than "never logged in".
  return "expired";
}

// ─── CLI entry point ──────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "get") {
      const [item, field] = rest;
      if (!item) {
        console.error("Usage: vault.mjs get <ITEM> [FIELD]");
        process.exit(1);
      }
      process.stdout.write(getSecret(item, field || "value"));
      process.exit(0);
    } else if (cmd === "delete") {
      const [item] = rest;
      if (!item) {
        console.error("Usage: vault.mjs delete <ITEM>");
        process.exit(1);
      }
      deleteSecret(item);
      process.stdout.write(`Deleted '${item}'.`);
      process.exit(0);
    } else if (cmd === "status") {
      process.stdout.write(sessionStatus());
      process.exit(0);
    } else {
      console.error("Usage: vault.mjs <get|delete|status> ...");
      process.exit(1);
    }
  } catch (e) {
    process.stderr.write((e.message || String(e)) + "\n");
    process.exit(e.code || 1);
  }
}
