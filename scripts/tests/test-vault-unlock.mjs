#!/usr/bin/env node
// test-vault-unlock.mjs - ONE unlock window at a time (scripts/vault/unlock-once.mjs, launch.mjs).
//
// On 10/10/2026, two scheduled tasks found the vault expired at the same minute and each opened
// its window, 8 s apart: two master passwords to type, the second unlock replacing the first one's
// session. This recette plays the lock in memory (the window and the session simulated), then two
// real `launch.mjs unlock` side by side, with a stand-in for the window: no window opens, no vault
// is read, and `bw` never runs.
//
//   node scripts/tests/test-vault-unlock.mjs

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VAULT = [join(ROOT, "scripts", "vault"), join(ROOT, "scripts", "vault", "providers", "bitwarden")].find((d) => existsSync(join(d, "unlock-once.mjs")));
const { unlockOnce } = await import(pathToFileURL(join(VAULT, "unlock-once.mjs")).href);

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

const temps = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "hv-unlock-"));
  temps.push(d);
  return d;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A vault closed until a window opens it, and the windows counted. */
function world({ open = false, windowOpens = true, windowMs = 120 } = {}) {
  const state = { open, windows: 0 };
  return {
    state,
    sessionOk: () => state.open,
    openWindow: async () => {
      state.windows += 1;
      await pause(windowMs);
      if (windowOpens) state.open = true;
      return windowOpens ? 0 : 1;
    },
  };
}
/** Waits shortened, and bounded: a lock that would be waited for forever fails the check instead
 *  of hanging the recette. */
const bounded = (max = 200) => {
  let turns = 0;
  return {
    sleep: async (ms) => {
      turns += 1;
      if (turns > max) throw new Error(`still waiting after ${max} turns`);
      await pause(Math.min(ms, 20));
    },
    pollMs: 20,
    turns: () => turns,
  };
};
const attempt = async (run) => {
  try {
    return await run();
  } catch (e) {
    return `throw: ${e.message}`;
  }
};

try {
  console.log("── Le verrou, en mémoire ──");
  {
    const lock = join(scratch(), "bw-unlock.lock");
    const w = world({ open: true });
    const code = await attempt(() => unlockOnce({ ...w, lock, ...bounded() }));
    check("un coffre déjà ouvert : 0, aucune fenêtre, aucun verrou posé", code === 0 && w.state.windows === 0 && !existsSync(lock), JSON.stringify({ code, windows: w.state.windows }));
  }
  {
    // The vault already open while a window still holds the lock (the password typed, the window
    // closing): the answer comes at once, nobody waits for that window to close.
    const lock = join(scratch(), "bw-unlock.lock");
    writeFileSync(lock, `${process.pid}\n${new Date().toISOString()}\n`);
    const w = world({ open: true });
    const wait = bounded(5);
    const code = await attempt(() => unlockOnce({ ...w, lock, ...wait }));
    check("un coffre déjà ouvert répond 0 tout de suite, sans attendre la fenêtre qui se ferme", code === 0 && wait.turns() === 0 && w.state.windows === 0, JSON.stringify({ code, turns: wait.turns() }));
  }
  {
    const lock = join(scratch(), "bw-unlock.lock");
    const w = world();
    const [a, b] = await Promise.all([attempt(() => unlockOnce({ ...w, lock, ...bounded() })), attempt(() => unlockOnce({ ...w, lock, ...bounded() }))]);
    check("deux demandes à la même minute : UNE fenêtre, et les deux répondent 0 après un seul mot de passe", a === 0 && b === 0 && w.state.windows === 1, JSON.stringify({ a, b, windows: w.state.windows }));
    check("... le verrou est rendu une fois la fenêtre fermée", !existsSync(lock));
  }
  {
    const lock = join(scratch(), "bw-unlock.lock");
    const w = world({ windowOpens: false });
    const [a, b] = await Promise.all([attempt(() => unlockOnce({ ...w, lock, ...bounded() })), attempt(() => unlockOnce({ ...w, lock, ...bounded() }))]);
    check("une fenêtre qui n'ouvre pas le coffre : la seconde demande ne rouvre rien, elle le dit (1)", w.state.windows === 1 && a === 1 && b === 1, JSON.stringify({ a, b, windows: w.state.windows }));
  }
  {
    const lock = join(scratch(), "bw-unlock.lock");
    writeFileSync(lock, `${process.pid}\n${new Date(Date.now() - 16 * 60000).toISOString()}\n`);
    const w = world();
    const code = await attempt(() => unlockOnce({ ...w, lock, ...bounded() }));
    check("un verrou de plus de 15 minutes n'est plus à personne : repris, la fenêtre s'ouvre", code === 0 && w.state.windows === 1 && !existsSync(lock), JSON.stringify({ code, windows: w.state.windows }));
  }
  {
    const lock = join(scratch(), "bw-unlock.lock");
    writeFileSync(lock, `${process.pid}\n${new Date(Date.now() - 14 * 60000).toISOString()}\n`);
    const w = world();
    const wait = bounded(3);
    const code = await attempt(() => unlockOnce({ ...w, lock, ...wait }));
    check("... un verrou de 14 minutes, lui, est encore tenu : on l'attend", String(code).startsWith("throw") && w.state.windows === 0, JSON.stringify({ code, windows: w.state.windows }));
  }
  {
    const lock = join(scratch(), "bw-unlock.lock");
    writeFileSync(lock, `999999\n${new Date().toISOString()}\n`);
    const w = world();
    const code = await attempt(() => unlockOnce({ ...w, lock, ...bounded(), isAlive: (pid) => pid !== 999999 }));
    check("un verrou dont le processus a disparu n'est plus à personne : repris aussitôt", code === 0 && w.state.windows === 1, JSON.stringify({ code, windows: w.state.windows }));
  }
  {
    const lock = join(scratch(), "bw-unlock.lock");
    writeFileSync(lock, `${process.pid}\n${new Date().toISOString()}\n`);
    const w = world();
    let turns = 0;
    const code = await attempt(() => unlockOnce({ ...w, lock, sleep: async () => {
      turns += 1;
      if (turns > 50) throw new Error("still waiting");
      if (turns === 3) {
        rmSync(lock, { force: true });
        w.state.open = true;
      }
    }, pollMs: 1 }));
    check("une fenêtre ouverte par un autre : on l'attend, puis on relit la session, sans ouvrir la sienne", code === 0 && w.state.windows === 0 && turns === 3, JSON.stringify({ code, turns, windows: w.state.windows }));
  }
  {
    const lock = join(scratch(), "bw-unlock.lock");
    let thrown = null;
    try {
      await unlockOnce({ sessionOk: () => false, openWindow: async () => { throw new Error("fenêtre impossible"); }, lock, ...bounded() });
    } catch (e) {
      thrown = e;
    }
    check("une fenêtre qui échoue rend le verrou quand même", thrown?.message === "fenêtre impossible" && !existsSync(lock));
  }
  {
    // Read as the machine leaves it: the process that holds it, then since when.
    const lock = join(scratch(), "bw-unlock.lock");
    let seen = null;
    await attempt(() => unlockOnce({ sessionOk: () => false, openWindow: async () => {
      seen = readFileSync(lock, "utf8").split("\n");
      return 0;
    }, lock, ...bounded() }));
    check("le verrou dit qui le tient et depuis quand", seen?.[0] === String(process.pid) && Math.abs(Date.parse(seen?.[1]) - Date.now()) < 60000, JSON.stringify(seen));
  }

  console.log("── Deux launch.mjs unlock côte à côte ──");
  {
    const home = scratch();
    const state = scratch();
    // The stand-in: `check` answers 0 once the vault is open; the window counts itself, waits a
    // little (the person typing), then opens the vault.
    const standIn = join(scratch(), "fenetre.mjs");
    writeFileSync(standIn, [
      'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const dir = process.env.FAKE_VAULT_DIR;",
      'const [what] = process.argv.slice(2);',
      'if (what === "check") process.exit(existsSync(join(dir, "session")) ? 0 : 1);',
      'appendFileSync(join(dir, "fenetres.log"), `${what}\\n`);',
      "await new Promise((r) => setTimeout(r, 800));",
      'writeFileSync(join(dir, "session"), "ouverte");',
      "process.exit(0);",
      "",
    ].join("\n"));
    // And a guard of its own: should the stand-in be ignored, no real window opens on the screen
    // of whoever runs the recette (the vault's guard stops `bw`, not PowerShell or a terminal).
    // The attempt is written down instead, and fails the check below.
    const noWindow = join(scratch(), "sans-fenetre.mjs");
    const attempts = join(state, "vraies-fenetres.log");
    writeFileSync(noWindow, `import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
const OPENERS = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe", "osascript", "x-terminal-emulator", "gnome-terminal", "konsole", "xterm", "bash", "bash.exe"]);
const isOpener = (c) => OPENERS.has(basename(String(c ?? "")).toLowerCase());
const note = (c) => appendFileSync(process.env.HV_NO_WINDOW_LOG, String(c) + "\\n");
const { spawnSync, spawn } = childProcess;
childProcess.spawnSync = function (c) {
  if (!isOpener(c)) return spawnSync.apply(this, arguments);
  note(c);
  return { status: 1, signal: null, pid: 0, output: [null, "", ""], stdout: "", stderr: "refused: a real window in a recette" };
};
childProcess.spawn = function (c) {
  if (!isOpener(c)) return spawn.apply(this, arguments);
  note(c);
  throw new Error("refused: a real window in a recette");
};
syncBuiltinESMExports();
`);
    const env = {
      ...process.env,
      HYPERVIBE_VAULT_STANDIN: standIn,
      FAKE_VAULT_DIR: state,
      USERPROFILE: home,
      HOME: home,
      HV_NO_WINDOW_LOG: attempts,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(noWindow).href}`].filter(Boolean).join(" "),
    };
    const run = () => new Promise((resolve) => {
      const child = spawn(process.execPath, [join(VAULT, "launch.mjs"), "unlock"], { env, stdio: "ignore", windowsHide: true });
      child.on("close", (code) => resolve(code));
    });
    const first = run();
    await pause(150);
    const second = run();
    const codes = await Promise.all([first, second]);
    const windows = existsSync(join(state, "fenetres.log")) ? readFileSync(join(state, "fenetres.log"), "utf8").trim().split("\n").filter(Boolean) : [];
    check("deux launch.mjs unlock lancés ensemble n'ouvrent qu'une fenêtre, et sortent tous deux en 0", codes.every((c) => c === 0) && windows.length === 1, JSON.stringify({ codes, windows }));
    check("... le verrou du poste est rendu", !existsSync(join(home, ".hypervibe", "bw-unlock.lock")));
    const again = await run();
    check("un coffre déjà ouvert : launch.mjs unlock sort en 0 sans fenêtre", again === 0 && readFileSync(join(state, "fenetres.log"), "utf8").trim().split("\n").length === 1);
    check("... et aucune vraie fenêtre n'a été tentée", !existsSync(attempts), existsSync(attempts) ? readFileSync(attempts, "utf8").trim() : "");
  }
} finally {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
