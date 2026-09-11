#!/usr/bin/env node
// guard-bash.mjs - PreToolUse hook: reads the shell command Claude is about to
// run and either lets it through, asks the user, or refuses it with the
// correct alternative.
//
// Two tools run a shell: Bash, and Monitor (a background watcher whose
// `command` is a shell script too). A guard that only watched Bash left the
// other door open (outside review, 3.0.4): hooks.json matches both, and this
// file accepts both. Same input field, same decision.
//
// Contract (Claude Code):
//   stdin  {"tool_name":"Bash"|"Monitor","tool_input":{"command":"..."},...}
//   stdout {"hookSpecificOutput":{"hookEventName":"PreToolUse",
//           "permissionDecision":"deny"|"ask","permissionDecisionReason":"..."}}
//   exit 0 with no output = no decision, the normal permission flow applies.
//
// FAIL-OPEN, on purpose. This runs before EVERY Bash call: a crash here would
// wedge the whole session. It is a seatbelt, not an airlock. Anything
// unexpected leaves through exit 0 with a line on stderr, and the guard that
// really cannot be bypassed lives in the scripts themselves (run-sql.mjs,
// execute-deletions.mjs), which is also what protects hosts that have no hooks
// at all, Codex included.

import { decide } from "./rules.mjs";

/** The tools whose `command` is executed by a shell. */
const SHELL_TOOLS = new Set(["Bash", "Monitor"]);

function read() {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), 5000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

try {
  const raw = await read();
  const payload = JSON.parse(raw);
  if (!SHELL_TOOLS.has(payload?.tool_name)) process.exit(0);

  const verdict = decide(payload?.tool_input?.command ?? "");
  if (!verdict) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: verdict.decision,
        permissionDecisionReason: `[Hypervibe] ${verdict.reason}`,
      },
    }),
  );
  process.exit(0);
} catch (e) {
  process.stderr.write(
    `[Hypervibe] guard-bash could not run, letting the command through: ${
      e instanceof Error ? e.message : String(e)
    }\n`,
  );
  process.exit(0);
}
