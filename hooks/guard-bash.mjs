#!/usr/bin/env node
// guard-bash.mjs - PreToolUse hook: reads the Bash call Claude is about to make
// and either lets it through, asks the user, or refuses it with the correct
// alternative.
//
// Contract (Claude Code):
//   stdin  {"tool_name":"Bash","tool_input":{"command":"..."},...}
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
  if (payload?.tool_name !== "Bash") process.exit(0);

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
