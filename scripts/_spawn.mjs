// _spawn.mjs - Launch a child process without handing its arguments to a
// shell that will cut them at the first space.
//
// Why this file exists. spawnSync with an argument ARRAY and the shell option lets a
// shell rebuild the command line from the array, and Node does that by
// joining the elements with spaces, unquoted. A path with a space in it
// (C:\Users\First Last\...) is cut in two, the child fails with "Cannot find
// module 'C:\Users\First'", and the step that called it reports nonsense.
// Node deprecates the form (DEP0190) and will refuse it one day. Reported by
// a user of 3.1.5 whose Windows profile carries a space: /delete-project and
// /save-project both broke for him, and every machine like his.
//
// Three launchers, and a shell only where Windows leaves no choice:
//
//   runNode(script, args)   one of the plugin's own scripts, through the
//                           running Node binary. Never a shell, anywhere.
//   runCli(cmd, args)       a CLI installed on the machine (vercel, pnpm,
//                           wrangler, gh). On Windows those are .cmd shims,
//                           which need a shell to start; the command line is
//                           assembled HERE, every argument quoted, and given
//                           to the shell as ONE string. Elsewhere: no shell.
//   runPipeline(line)       a line that genuinely needs a shell (a pipe, a
//                           redirection), written out in full by the caller.
//   runCliAsync(cmd, args)  runCli without blocking the event loop, for the
//                           scripts that run several scans in parallel.
//
// `spawnSpec()` is the same decision for callers that drive `spawn()`
// themselves (async, streamed output).

import { spawn, spawnSync } from "node:child_process";

const IS_WIN = process.platform === "win32";

/** Quotes one argument for cmd.exe: wrapped in double quotes when it carries
 *  a space or a character the shell would read, inner quotes escaped. A `%`
 *  cannot be escaped on a cmd.exe command line and is left as is. */
export function quoteForCmd(arg) {
  const s = String(arg);
  if (s === "") return '""';
  if (!/[\s"&|<>^()]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

/** How to launch `cmd args`: { file, args, shell } for spawn/spawnSync.
 *  "node" (or the running binary) never goes through a shell; on Windows any
 *  other command becomes one quoted line for the shell; elsewhere the array
 *  is passed as is, with no shell. */
export function spawnSpec(cmd, args = []) {
  const list = args.map(String);
  if (cmd === "node" || cmd === process.execPath) {
    return { file: process.execPath, args: list, shell: false };
  }
  if (IS_WIN) {
    return { file: [cmd, ...list].map(quoteForCmd).join(" "), args: [], shell: true };
  }
  return { file: cmd, args: list, shell: false };
}

export function runNode(script, args = [], opts = {}) {
  return spawnSync(process.execPath, [script, ...args.map(String)], { encoding: "utf8", ...opts, shell: false });
}

export function runCli(cmd, args = [], opts = {}) {
  const spec = spawnSpec(cmd, args);
  return spawnSync(spec.file, spec.args, { encoding: "utf8", ...opts, shell: spec.shell });
}

export function runPipeline(line, opts = {}) {
  return spawnSync(line, { encoding: "utf8", ...opts, shell: true });
}

/** Resolves to { status, stdout, stderr }, like runCli. `input` is written to
 *  stdin, which is then closed: a CLI waiting for an answer gets it, or ends. */
export function runCliAsync(cmd, args = [], { input = "", timeout = 60000, cwd } = {}) {
  return new Promise((resolve) => {
    const spec = spawnSpec(cmd, args);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (status, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr: stderr + extra });
    };
    let proc;
    try {
      proc = spawn(spec.file, spec.args, { cwd, shell: spec.shell, windowsHide: true });
    } catch (e) {
      resolve({ status: -1, stdout, stderr: String(e) });
      return;
    }
    const timer = setTimeout(() => {
      proc.kill();
      finish(-1, `\ntimed out after ${timeout} ms`);
    }, timeout);
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (e) => finish(-1, String(e)));
    proc.on("close", (code) => finish(code));
    proc.stdin.on("error", () => {});
    proc.stdin.end(input);
  });
}
