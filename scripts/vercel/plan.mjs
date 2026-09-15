#!/usr/bin/env node
// plan.mjs - Which Vercel plan does the linked project run on?
//
// Why this exists. Vercel reserves its free Hobby plan for personal,
// non-commercial use: "Hobby teams are restricted to non-commercial personal
// use only. All commercial usage of the platform requires either a Pro or
// Enterprise plan." (Fair Use Guidelines, read 2026-09-15). The first example
// of commercial use is "any method of requesting or processing payment from
// visitors of the site", and Vercel can pause an account in breach. /add-stripe
// is the moment a project starts taking money, so it asks this script and
// warns only when the answer is Hobby, or unknown. Reported by a user of the
// plugin who found out on their own (2026-09-15).
//
//   node plan.mjs [--project-dir <dir>]
//
// Prints ONE JSON line:
//   {"plan":"hobby"|"pro"|"enterprise"|null,"scope":"team"|"user"|null,"reason":"..."}
// Exit 0 when the plan is known, 3 when it is not (project not linked, Vercel
// CLI too old for `vercel api`, not logged in). Read-only: a single API read
// through the Vercel CLI, which owns the login and refreshes it. The token left
// in auth.json alone is refused by the REST API once it has expired.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../_spawn.mjs";

/** The API path that carries the plan for this link: the team, or the user. */
export function endpointFor(orgId) {
  return typeof orgId === "string" && orgId.startsWith("team_") ? `/v2/teams/${orgId}` : "/v2/user";
}

/** The CLI may print notices before the JSON body: parse from the first brace. */
export function extractJson(output) {
  const text = String(output ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** `billing.plan` of a team, or `user.billing.plan` of a personal account. */
export function planFrom(body) {
  const plan = body?.billing?.plan ?? body?.user?.billing?.plan ?? null;
  return typeof plan === "string" && plan.trim() ? plan.trim().toLowerCase() : null;
}

/** The Vercel link of `dir` ({ orgId, projectId }), or null when there is none. */
export function readLinkedProject(dir) {
  const file = join(dir, ".vercel", "project.json");
  if (!existsSync(file)) return null;
  try {
    const { orgId, projectId } = JSON.parse(readFileSync(file, "utf8"));
    return orgId ? { orgId, projectId: projectId ?? null } : null;
  } catch {
    return null;
  }
}

function main(argv) {
  const i = argv.indexOf("--project-dir");
  const dir = resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd());
  const say = (result, code) => {
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = code;
  };

  const linked = readLinkedProject(dir);
  if (!linked) {
    say({ plan: null, scope: null, reason: `no .vercel/project.json in ${dir}` }, 3);
    return;
  }
  const endpoint = endpointFor(linked.orgId);
  const scope = endpoint === "/v2/user" ? "user" : "team";
  // `input: ""` closes stdin: a CLI that is not logged in must not wait for an
  // answer nobody will type.
  const r = runCli("vercel", ["api", endpoint], { cwd: dir, timeout: 30000, input: "" });
  if (r.error || r.status !== 0) {
    const detail = String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").pop() ?? "";
    say({ plan: null, scope, reason: `vercel api ${endpoint} failed: ${detail.slice(0, 160)}` }, 3);
    return;
  }
  const plan = planFrom(extractJson(r.stdout));
  if (!plan) {
    say({ plan: null, scope, reason: `no plan in the ${endpoint} response` }, 3);
    return;
  }
  say({ plan, scope, reason: `read from ${endpoint}` }, 0);
}

// Run only when launched, never when imported by the recette. Compared without
// case on Windows, where the drive letter may come either way.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const called = resolve(process.argv[1]);
  return process.platform === "win32" ? self.toLowerCase() === called.toLowerCase() : self === called;
})();
if (invokedDirectly) main(process.argv.slice(2));
