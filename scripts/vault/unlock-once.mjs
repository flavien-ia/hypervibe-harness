// unlock-once.mjs - ONE unlock window at a time, and none when the vault is already open.
//
// On 10/10/2026, two scheduled tasks found the vault expired at the same minute: each ran
// `launch.mjs unlock` and opened its window, 8 s apart. Two master passwords to type, and the
// second unlock replaced the session the first had just opened. Now:
//   (a) a session already valid (the very check vault.mjs makes) answers 0, and no window opens;
//   (b) the window is held by a lock, ~/.hypervibe/bw-unlock.lock, which says the process that
//       holds it and since when. A second call while a window is open waits for it to close, then
//       reads the session again: it never opens a window of its own. If the first one failed, the
//       caller says so and asks the person before trying again.
// A lock is nobody's once the process that holds it is gone (killed with the task that started
// it), or after 15 minutes (a window left open that long, or a machine put to sleep).
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The lock's file, in the plugin's folder of this machine. */
export const lockFile = (home = homedir()) => join(home, ".hypervibe", "bw-unlock.lock");
/** How long a lock holds at most: a window left open longer frees its place. */
export const STALE_MS = 15 * 60 * 1000;

/** Whether a process still runs (signal 0 tests it, on Windows as elsewhere). */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/** What a lock says: {pid, at}, or null when it is gone or cannot be read. */
function readLock(file) {
  try {
    const [pid, at] = readFileSync(file, "utf8").split(/\r?\n/);
    return { pid: Number(pid), at: Date.parse(at), text: `${pid}\n${at}` };
  } catch {
    return null;
  }
}

/** The lock taken at once, or false when another process holds it (its file created only if
 *  absent: two processes never both take it). */
function take(file, now) {
  mkdirSync(dirname(file), { recursive: true });
  let fd;
  try {
    fd = openSync(file, "wx");
  } catch (e) {
    if (e?.code === "EEXIST") return false;
    throw e;
  }
  try {
    writeSync(fd, `${process.pid}\n${new Date(now()).toISOString()}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * The vault opened once, whoever asks. `openWindow` opens the window and resolves to its exit
 * code; `sessionOk` says whether the vault is open now. The rest: recettes only.
 * @returns {Promise<number>} 0 when the vault is open; the window's code when this call opened
 *   it; 1 when a window someone else opened closed without opening the vault.
 */
export async function unlockOnce({ openWindow, sessionOk, lock = lockFile(), now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 1000, isAlive = alive }) {
  if (await sessionOk()) return 0;
  let waited = false;
  for (;;) {
    if (take(lock, now)) {
      try {
        // Read again once the lock is ours: a window may have closed in the meantime.
        if (await sessionOk()) return 0;
        // A window someone else opened closed, and the vault is still closed: not reopened here.
        if (waited) return 1;
        return await openWindow();
      } finally {
        rmSync(lock, { force: true });
      }
    }
    const held = readLock(lock);
    if (held && now() - held.at <= STALE_MS && isAlive(held.pid)) {
      waited = true;
      await sleep(pollMs);
      continue;
    }
    // Nobody's lock: removed, unless another process took it again in the meantime, then taken
    // at the next turn.
    if (!held || readLock(lock)?.text === held.text) rmSync(lock, { force: true });
  }
}
