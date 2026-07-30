#!/usr/bin/env node
// Versioned ZIP snapshots of the Claude state that git does NOT cover:
//   interface/ : the desktop app stores that rebuild the left sidebar (recents + pinned)
//                plus ~/.claude.json  -> small, every run
//   history/   : the conversation transcripts (~/.claude/projects/**/*.jsonl)
//                -> one full baseline + incrementals
//   config/    : the config git repo itself, .git included -> off-machine copy of the history
//
//   node snapshot-claude-state.mjs [--dest <dir>] [--repo <path>] [--full] [--keep-images-days N] [--json]
//
// Destination defaults to the first cloud-synced folder found, so the backup lives off-machine.
// No dependencies: the ZIP writer below is self-contained (deflate + central directory).
// Exit 0 = at least the interface snapshot was written, 1 = nothing could be written.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { deflateRawSync } from "node:zlib";

const HOME = os.homedir();
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const FORCE_FULL = args.includes("--full");
const AS_JSON = args.includes("--json");
const REPO = flag("--repo");
const KEEP_IMAGES_DAYS = Number(flag("--keep-images-days", "0"));

const say = (s) => { if (!AS_JSON) console.log(s); };
const result = { dest: null, interface: null, history: null, config: null, warnings: [] };

// ------------------------------------------------------------- minimal ZIP writer

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const dosStamp = (d) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

const MAX_ENTRY_BYTES = 200 * 1024 * 1024; // a single member bigger than this is skipped

class ZipWriter {
  constructor(out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    this.out = out;
    this.fd = fs.openSync(out, "w");
    this.offset = 0;
    this.entries = [];
    this.skipped = 0;
  }
  #write(buf) { fs.writeSync(this.fd, buf); this.offset += buf.length; }
  add(name, data, mtime = new Date()) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (raw.length > MAX_ENTRY_BYTES) { this.skipped++; return false; }
    const nameBuf = Buffer.from(name.replace(/\\/g, "/"), "utf8");
    const comp = deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const { time, date } = dosStamp(mtime);
    const local = this.offset;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    h.writeUInt16LE(8, 8);      // deflate
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    this.#write(h);
    this.#write(nameBuf);
    this.#write(comp);
    this.entries.push({ nameBuf, crc, csize: comp.length, usize: raw.length, time, date, local });
    return true;
  }
  addFile(fullPath, name) {
    try {
      const st = fs.statSync(fullPath);
      if (!st.isFile()) return false;
      return this.add(name, fs.readFileSync(fullPath), st.mtime);
    } catch { this.skipped++; return false; } // locked (LOCK, .ldb in use) or unreadable
  }
  addTree(dir, prefix) {
    let n = 0;
    const walk = (d, rel) => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p, r);
        else if (e.isFile() && this.addFile(p, `${prefix}/${r}`)) n++;
      }
    };
    try {
      const st = fs.statSync(dir);
      if (st.isFile()) return this.addFile(dir, prefix) ? 1 : 0;
    } catch { return 0; }
    walk(dir, "");
    return n;
  }
  close() {
    const cdOffset = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(8, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.usize, 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt32LE(0, 30); // extra len + comment len
      c.writeUInt32LE(0, 34); // disk + internal attrs
      c.writeUInt32LE(0, 38); // external attrs
      c.writeUInt32LE(e.local, 42);
      this.#write(c);
      this.#write(e.nameBuf);
    }
    const cdSize = this.offset - cdOffset;
    const n = this.entries.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Math.min(n, 0xffff), 8);
    eocd.writeUInt16LE(Math.min(n, 0xffff), 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    this.#write(eocd);
    fs.closeSync(this.fd);
    if (n > 0xffff || cdOffset > 0xffffffff) {
      result.warnings.push(`${path.basename(this.out)} exceeds the classic ZIP limits (ZIP64 not implemented)`);
    }
    return { entries: n, bytes: fs.statSync(this.out).size, skipped: this.skipped };
  }
}

// ------------------------------------------------------------------- destinations

function resolveDest() {
  const explicit = flag("--dest");
  if (explicit) return explicit;
  const candidates = [
    process.env.HYPERVIBE_BACKUP_DIR,
    process.env.OneDrive,
    path.join(HOME, "Dropbox"),
    path.join(HOME, "OneDrive"),
    path.join(HOME, "Library", "Mobile Documents", "com~apple~CloudDocs"),
    path.join(HOME, "Google Drive"),
    path.join(HOME, "GoogleDrive"),
    path.join(HOME, "Nextcloud"),
    path.join(HOME, "pCloudDrive"),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return path.join(c, "Backups", "claude-state"); } catch { /* next */ }
  }
  result.warnings.push("no cloud-synced folder found: the snapshots stay on this machine only");
  return path.join(HOME, "claude-state-backups");
}

function resolveProfile() {
  const candidates = [];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const pkgs = path.join(localAppData, "Packages");
    try {
      for (const d of fs.readdirSync(pkgs)) {
        if (d.startsWith("Claude_")) candidates.push(path.join(pkgs, d, "LocalCache", "Roaming", "Claude"));
      }
    } catch { /* not windows or no packages */ }
  }
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "Claude"));
  candidates.push(path.join(HOME, "Library", "Application Support", "Claude"));
  candidates.push(path.join(HOME, ".config", "Claude"));
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return c; } catch { /* next */ }
  }
  return null;
}

const DEST = resolveDest();
result.dest = DEST;
const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const mb = (b) => (b / 1048576).toFixed(1);

// ----------------------------------------------------------------------- rotation

function rotate(subdir, keepRecent) {
  const dir = path.join(DEST, subdir);
  let zips;
  try {
    zips = fs.readdirSync(dir).filter((f) => f.endsWith(".zip"))
      .map((f) => ({ f, p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtime }))
      .sort((a, b) => b.m - a.m);
  } catch { return; }
  const year = 365 * 86400 * 1000, now = Date.now();
  const keep = new Set(zips.slice(0, keepRecent).map((z) => z.p));
  for (const z of zips) if (z.m.getDate() === 1 && now - z.m.getTime() < year) keep.add(z.p);
  for (const z of zips) if (!keep.has(z.p)) { try { fs.unlinkSync(z.p); say(`   rotation: removed ${z.f}`); } catch { /* locked */ } }
}

function rotateHistory() {
  const dir = path.join(DEST, "history");
  let zips;
  try {
    zips = fs.readdirSync(dir).filter((f) => f.endsWith(".zip"))
      .map((f) => ({ f, p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtime, full: f.startsWith("history-full-") }))
      .sort((a, b) => b.m - a.m);
  } catch { return; }
  const fulls = zips.filter((z) => z.full);
  if (!fulls.length) return;
  const newest = fulls[0];
  const year = 365 * 86400 * 1000, now = Date.now();
  const keep = new Set([newest.p]);
  for (const z of fulls) if (z.m.getDate() === 1 && now - z.m.getTime() < year) keep.add(z.p);
  for (const z of zips) if (!z.full && z.m > newest.m) keep.add(z.p); // incrementals after the baseline
  for (const z of zips) if (!keep.has(z.p)) { try { fs.unlinkSync(z.p); say(`   rotation: removed ${z.f}`); } catch { /* locked */ } }
}

// ---------------------------------------------------------------------- interface

// Stores that carry recents + pinned + the session list. Big regenerable caches are excluded.
const INTERFACE_ITEMS = [
  "IndexedDB", "Local Storage", "Session Storage", "WebStorage", "fcache",
  "Preferences", "Local State", "claude-code-sessions", "local-agent-mode-sessions",
  "config.json", "ant-device-registry.json", "window-state.json", "git-worktrees.json",
];

function snapshotInterface() {
  const out = path.join(DEST, "interface", `interface-${stamp()}.zip`);
  const zip = new ZipWriter(out);
  let items = 0;
  const claudeJson = path.join(HOME, ".claude.json");
  if (zip.addFile(claudeJson, ".claude.json")) items++;
  const profile = resolveProfile();
  if (profile) {
    for (const item of INTERFACE_ITEMS) {
      const src = path.join(profile, item);
      if (fs.existsSync(src) && zip.addTree(src, item) > 0) items++;
    }
  } else {
    result.warnings.push("desktop app profile not found: only ~/.claude.json was snapshotted");
  }
  const info = zip.close();
  say(`[interface] ${out}  (${mb(info.bytes)} MB, ${items} items, ${info.entries} files${info.skipped ? `, ${info.skipped} locked/skipped` : ""})`);
  return { out, ...info, items, profile };
}

// ------------------------------------------------------------------------ history

const FULL_EVERY_DAYS = 30;
const B64 = /[A-Za-z0-9+/]{200,}={0,2}/g; // a large base64 blob is an encoded image

function snapshotHistory() {
  const projects = path.join(HOME, ".claude", "projects");
  if (!fs.existsSync(projects)) { say("[history]   no transcripts, skipped."); return null; }
  const dir = path.join(DEST, "history");
  fs.mkdirSync(dir, { recursive: true });
  const zips = fs.readdirSync(dir).filter((f) => f.endsWith(".zip"))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtime.getTime(), full: f.startsWith("history-full-") }));
  const fulls = zips.filter((z) => z.full);
  const now = Date.now();
  const needFull = FORCE_FULL || !fulls.length || now - Math.max(...fulls.map((z) => z.m)) > FULL_EVERY_DAYS * 86400000;
  const cutoff = needFull ? 0 : Math.max(...zips.map((z) => z.m)) - 3600000; // 1h margin
  const kind = needFull ? "full" : "inc";

  const files = [];
  const walk = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try { if (fs.statSync(p).mtime.getTime() > cutoff) files.push({ p, r }); } catch { /* unreadable */ }
      }
    }
  };
  walk(projects, "");
  if (!files.length) { say("[history]   nothing changed since the last snapshot, skipped."); return null; }

  const out = path.join(dir, `history-${kind}-${stamp()}.zip`);
  const zip = new ZipWriter(out);
  const keepImagesBefore = now - KEEP_IMAGES_DAYS * 86400000;
  let count = 0;
  for (const { p, r } of files) {
    try {
      const st = fs.statSync(p);
      if (KEEP_IMAGES_DAYS > 0 && st.mtime.getTime() > keepImagesBefore) {
        if (zip.addFile(p, r)) count++;
      } else {
        const txt = fs.readFileSync(p, "utf8").replace(B64, "<pruned-image>");
        if (zip.add(r, txt, st.mtime)) count++;
      }
    } catch { /* unreadable, skip */ }
  }
  const info = zip.close();
  say(`[history]   ${kind.toUpperCase()} ${out}  (${mb(info.bytes)} MB, ${count} transcripts)`);
  return { out, kind, transcripts: count, ...info };
}

// ------------------------------------------------------------------------- config

function snapshotConfig() {
  if (!REPO) return null;
  if (!fs.existsSync(REPO)) { say(`[config]    repo not found (${REPO}), skipped.`); return null; }
  const out = path.join(DEST, "config", `config-${stamp()}.zip`);
  const zip = new ZipWriter(out);
  let n = 0;
  const walk = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile() && zip.addFile(p, r)) n++;
    }
  };
  walk(REPO, "");
  const info = zip.close();
  say(`[config]    ${out}  (${mb(info.bytes)} MB, ${n} files, .git included)`);
  return { out, files: n, ...info };
}

// ---------------------------------------------------------------------- restore doc

function writeRestoreDoc(profile) {
  const p = path.join(DEST, "RESTORE.md");
  if (fs.existsSync(p)) return;
  fs.mkdirSync(DEST, { recursive: true });
  fs.writeFileSync(p, `# Restore your Claude state after a reinstall

This folder versions what git does not cover.

- \`config/\`    : a zip of the config repo (CLAUDE.md, skills, commands, scripts, routine prompts,
                 memory files, plugin sources), \`.git\` included. Also pushed to your private
                 GitHub repo, which stays the primary copy.
- \`interface/\` : the desktop app stores that carry the LEFT SIDEBAR (recents + pinned) plus
                 \`~/.claude.json\` (project list and MCP server configuration).
- \`history/\`   : your conversations. One \`history-full-*.zip\` baseline plus \`history-inc-*.zip\`
                 incrementals holding only the conversations that changed. Images are stored as
                 \`<pruned-image>\`; the text is complete.

## Restore the left sidebar (recents + pinned)
1. Quit the Claude desktop app completely (not just the window).
2. Take the most recent \`interface/interface-*.zip\`.
3. Extract it over the app profile, overwriting:
   ${profile || "<app profile: %LOCALAPPDATA%/Packages/Claude_*/LocalCache/Roaming/Claude, or %APPDATA%/Claude, or ~/Library/Application Support/Claude, or ~/.config/Claude>"}
   and put \`.claude.json\` back at \`~/.claude.json\`.
4. Start the app again.

## Restore conversations
Extract the latest \`history-full-*.zip\`, then every later \`history-inc-*.zip\` in chronological
order, into \`~/.claude/projects/\`.

## Restore the configuration
Clone your private config repo over \`~/.claude\`, or extract \`config/config-*.zip\`.
Secrets are in none of these backups: they come back from your key vault.

## Routines
Scheduled routines are registered on your Claude account, not in these files. After signing back
in, check them with "list my routines" and re-arm anything missing; their prompts are restored
with the config, under \`~/.claude/scheduled-tasks/\`.
`);
  say(`[doc]       ${p}`);
}

// ---------------------------------------------------------------------------- main

fs.mkdirSync(DEST, { recursive: true });
say(`\nDestination: ${DEST}\n`);

let ok = false;
try { result.config = snapshotConfig(); rotate("config", 14); }
catch (e) { result.warnings.push(`config: ${e.message}`); say(`[config]    FAILED: ${e.message}`); }
try { result.interface = snapshotInterface(); rotate("interface", 14); ok = true; }
catch (e) { result.warnings.push(`interface: ${e.message}`); say(`[interface] FAILED: ${e.message}`); }
try { result.history = snapshotHistory(); rotateHistory(); }
catch (e) { result.warnings.push(`history: ${e.message}`); say(`[history]   FAILED: ${e.message}`); }
writeRestoreDoc(result.interface?.profile);

for (const w of result.warnings) say(`[warning]   ${w}`);
say(ok ? "\nOK.\n" : "\nNothing was written.\n");
if (AS_JSON) console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
