#!/usr/bin/env node
// audit-clis.mjs - Report which CLIs are installed and logged in, WITHOUT ever hanging.
//
// The /start audit used to run `gh auth status`, `vercel whoami` and `wrangler whoami`
// in one Bash block. Those are network calls: a single one hanging burned the whole
// 2-minute Bash timeout and the user got no report at all. Here every check runs with
// its own timeout, so one slow service degrades to `timeout` on that row only.
//
//   node audit-clis.mjs              # human table on stdout
//   node audit-clis.mjs --json       # machine-readable
//   node audit-clis.mjs --timeout 8  # per-check timeout in seconds (default 10)
//
// Exit code is always 0: "tool missing" is a finding to report, not a script failure.

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const ti = args.indexOf("--timeout");
const TIMEOUT_MS = (ti >= 0 && Number(args[ti + 1]) ? Number(args[ti + 1]) : 10) * 1000;

// `login: null` = nothing to log into (version check is enough).
const TOOLS = [
  { name: "node", version: "node --version", login: null },
  { name: "pnpm", version: "pnpm --version", login: null },
  { name: "git", version: "git --version", login: null },
  { name: "gh", version: "gh --version", login: "gh api user --jq .login" },
  { name: "vercel", version: "vercel --version", login: "vercel whoami" },
  { name: "wrangler", version: "wrangler --version", login: "wrangler whoami" },
];

function run(cmd) {
  // Single command string + shell:true (an args array alongside shell:true trips
  // Node's DEP0190 warning and pollutes the output).
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: TIMEOUT_MS });
  if (r.error && (r.error.code === "ETIMEDOUT" || r.signal)) return { timedOut: true };
  if (r.error) return { ok: false, out: r.error.message };
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  return { ok: r.status === 0, out };
}

// First non-empty line, ANSI stripped, capped - enough to show a version or an account.
function firstLine(s) {
  const clean = (s || "").replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  const line = clean.split(/\r?\n/).find((l) => l.trim()) || "";
  return line.trim().slice(0, 90);
}

const results = [];
for (const t of TOOLS) {
  const v = run(t.version);
  if (v.timedOut) {
    results.push({ tool: t.name, status: "timeout", detail: `\`${t.version}\` did not answer in ${TIMEOUT_MS / 1000}s` });
    continue;
  }
  if (!v.ok) {
    results.push({ tool: t.name, status: "missing", detail: firstLine(v.out) });
    continue;
  }
  const version = firstLine(v.out);
  if (!t.login) {
    results.push({ tool: t.name, status: "ready", version });
    continue;
  }
  const l = run(t.login);
  if (l.timedOut) {
    results.push({ tool: t.name, status: "timeout", version, detail: `\`${t.login}\` did not answer in ${TIMEOUT_MS / 1000}s` });
  } else if (!l.ok) {
    results.push({ tool: t.name, status: "logged-out", version, detail: firstLine(l.out) });
  } else {
    results.push({ tool: t.name, status: "ready", version, account: firstLine(l.out) });
  }
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ results, timeoutSeconds: TIMEOUT_MS / 1000 }, null, 2) + "\n");
} else {
  const ICON = { ready: "OK      ", "logged-out": "LOGGEDOUT", missing: "MISSING ", timeout: "TIMEOUT " };
  for (const r of results) {
    const extra = r.account || r.detail || r.version || "";
    process.stdout.write(`${ICON[r.status] || r.status}  ${r.tool.padEnd(9)} ${extra}\n`);
  }
  const bad = results.filter((r) => r.status !== "ready");
  process.stdout.write(
    bad.length
      ? `\n${bad.length} tool(s) need attention: ${bad.map((b) => `${b.tool} (${b.status})`).join(", ")}\n`
      : "\nAll tools installed and connected.\n",
  );
}
