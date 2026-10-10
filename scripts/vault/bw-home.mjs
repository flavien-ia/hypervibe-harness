// bw-home.mjs - The ONE folder where the Bitwarden command line keeps this machine's sign-in, the
// same for every program that runs `bw` (Windows only).
//
// Claude Desktop installed from the Microsoft Store is a packaged app: Windows virtualises
// %APPDATA% for it and for every program it starts. `bw` signed in from Claude therefore writes its
// sign-in (data.json) into the app's private folder, which a program started OUTSIDE Claude does
// not see (the Run button of a command block, Claude Desktop's Terminal panel, an ordinary
// terminal): there `bw` says "unauthenticated", the unlock window says no account is signed in,
// and a session opened on one side is refused on the other, so each side unlocks in turn. Seen
// and proven on a real machine on 03/10/2026.
//
// The cure: every `bw` this plugin runs is told to use ~/.hypervibe/bitwarden-cli
// (BITWARDENCLI_APPDATA_DIR), outside AppData, which nothing virtualises: every program sees the
// same sign-in, and a session opened anywhere is valid everywhere. The first time, the sign-in
// already made is COPIED there, never moved, nothing deleted: the most recent of the folders where
// `bw` is signed in (the one this program sees, Claude Desktop's private one), so the copy carries
// the state of the last unlock and the session in progress stays valid. A machine never signed in
// signs in straight into the new folder. This happens once, and a mark in the folder says so: the
// old folders are never read again.
//
// It happens right before the first `bw` a process runs (`useBwHome()` at the top of every helper
// that spawns it), never when a script is merely imported: a recette that imports a script and
// never runs `bw` does not move anybody's sign-in. Mac and Linux keep their own folder: nothing
// virtualises it there.
//
// EVERY `bw` goes through it, its version asked included: `bw --version` alone writes a data.json
// in the folder it is pointed at, bw's own one otherwise. On 10/10/2026 the folder taken over and
// emptied on 05/10 was back, account-less, pointing at bw's default server (the US one): the probe
// that runs before every window had asked the version without the folder. `bwAnswers` below is
// that probe, for every script.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** The folder every `bw` of this plugin uses on Windows. */
export const bwHomeOf = (home = homedir()) => join(home, ".hypervibe", "bitwarden-cli");
/** The mark that says the earlier sign-in was taken over: once there, the old folders are never read. */
const MARK = ".taken-over";

/** The folders where an earlier sign-in may be: the one this program sees, then Claude Desktop's
 *  private one (one per installation of the app). Only those holding a sign-in file. */
export function earlierHomes(env = process.env) {
  const out = [];
  if (env.APPDATA) out.push(join(env.APPDATA, "Bitwarden CLI"));
  const packages = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Packages") : null;
  let names = [];
  try {
    names = packages && existsSync(packages) ? readdirSync(packages) : [];
  } catch {
    names = [];
  }
  for (const name of names.sort()) {
    if (/^Claude_/i.test(name)) out.push(join(packages, name, "LocalCache", "Roaming", "Bitwarden CLI"));
  }
  return out.filter((dir, i) => out.indexOf(dir) === i && existsSync(join(dir, "data.json")));
}

/** The `bw` this plugin installed, else the one on the PATH (the same order as vault.mjs). */
function bwCommand(home) {
  const exe = platform() === "win32" ? "bw.exe" : "bw";
  for (const c of [join(home, ".hypervibe", "bin", exe), join(home, "bin", exe)]) if (existsSync(c)) return c;
  return "bw";
}

/** Whether `bw` is signed in with that folder: true, false ("unauthenticated"), or null when bw
 *  could not answer (not installed, broken, too slow): nothing is decided on a null. Read-only:
 *  `bw status` unlocks nothing and writes no secret. */
export function signedInWith(dir, { home = homedir(), env = process.env } = {}) {
  const cmd = bwCommand(home);
  const r = spawnSync(cmd, ["status"], {
    encoding: "utf8",
    env: { ...env, BITWARDENCLI_APPDATA_DIR: dir, BW_NOINTERACTION: "true" },
    shell: platform() === "win32" && cmd === "bw",
    windowsHide: true,
    timeout: 20000,
  });
  try {
    const status = JSON.parse(String(r.stdout ?? "").trim())?.status;
    return typeof status === "string" ? status !== "unauthenticated" : null;
  } catch {
    return null;
  }
}

/**
 * The folder `bw` is to use on this machine, after taking over an earlier sign-in once; null
 * outside Windows. Returns {dir, copiedFrom, pending}: `copiedFrom`, the folder copied this time;
 * `pending`, the take-over could not be decided (bw could not answer, the folder could not be
 * written) and is tried again next time, the old folder staying in use until then.
 * `os`, `env`, `home`, `signedIn`: recettes only.
 */
export function bwHome({ os = platform(), env = process.env, home = homedir(), signedIn = (dir) => signedInWith(dir, { home, env }) } = {}) {
  if (os !== "win32") return null;
  const dir = bwHomeOf(home);
  const mark = join(dir, MARK);
  if (existsSync(mark)) return { dir, copiedFrom: null, pending: false };
  // Of the folders where bw is signed in, the one written last: it holds the last unlock. Inside
  // Claude Desktop the first two name the same file, outside it they are two different ones.
  let source = null;
  let newest = -Infinity;
  for (const candidate of earlierHomes(env)) {
    const answer = signedIn(candidate);
    if (answer === null) return { dir, copiedFrom: null, pending: true };
    if (!answer) continue;
    const written = statSync(join(candidate, "data.json")).mtimeMs;
    if (written > newest) {
      source = candidate;
      newest = written;
    }
  }
  let copiedFrom = null;
  try {
    mkdirSync(dir, { recursive: true });
    if (source) {
      const from = join(source, "data.json");
      const to = join(dir, "data.json");
      // A copy already there (made by hand to try the cure, on 03/10/2026) gives way only to a
      // more recent sign-in: an older one would bring back a state the last unlock replaced.
      if (!existsSync(to) || statSync(from).mtimeMs > statSync(to).mtimeMs) {
        copyFileSync(from, to);
        copiedFrom = source;
      }
    }
    writeFileSync(mark, `${new Date().toISOString()}\n${source ?? "no earlier sign-in"}\n`);
  } catch {
    return { dir, copiedFrom: null, pending: true };
  }
  return { dir, copiedFrom, pending: false };
}

const undecided = new WeakSet();

/**
 * Points every `bw` this process runs at the folder (Windows only), by setting
 * BITWARDENCLI_APPDATA_DIR in the environment the helpers pass on to `bw`, unless the person set it
 * themselves. To call at the top of every helper that spawns `bw`: cheap once decided (the variable
 * is set, or the take-over is undecided for this process and the old folder stays in use).
 * Returns the folder in use, or null when it is bw's own (Mac, Linux, undecided).
 */
export function useBwHome(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.BITWARDENCLI_APPDATA_DIR) return env.BITWARDENCLI_APPDATA_DIR;
  if (undecided.has(env)) return null;
  const found = bwHome({ ...opts, env });
  if (!found || found.pending) {
    undecided.add(env);
    return null;
  }
  env.BITWARDENCLI_APPDATA_DIR = found.dir;
  return found.dir;
}

/**
 * Whether `cmd` (a `bw`) runs, its version asked, pointed at the plugin's folder like every other
 * `bw` (the version alone writes a sign-in file in the folder it is given). The probe every script
 * uses before installing or opening a window. `spawn`, `os` and the options of useBwHome:
 * recettes only.
 */
export function bwAnswers(cmd = "bw", { spawn = spawnSync, os = platform(), ...opts } = {}) {
  const env = opts.env ?? process.env;
  useBwHome({ ...opts, os, env });
  const r = spawn(cmd, ["--version"], { encoding: "utf8", env, shell: os === "win32" && cmd === "bw", windowsHide: true });
  return r?.status === 0;
}
