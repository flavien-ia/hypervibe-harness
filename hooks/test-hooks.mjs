#!/usr/bin/env node
// test-hooks.mjs - Recette of the Bash guardrail.
//
// A guardrail is only acquired once you have seen it do BOTH things. The half
// everyone forgets is the second one: a hook that blocks everything looks
// exactly like a hook that works, right up to the moment it blocks the commit
// message that merely mentions `git add -A`. So the "lets through" list below
// is longer than the "refuses" list, and it is the one to extend first when a
// pattern is added.
//
// Runs the real hook as a subprocess, feeding it the JSON Claude Code feeds it.
//
//   node hooks/test-hooks.mjs

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "guard-bash.mjs");

let failures = 0;
let checks = 0;
const timings = [];

function call(payload) {
  const started = process.hrtime.bigint();
  const out = execFileSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
  timings.push(Number(process.hrtime.bigint() - started) / 1e6);
  if (!out.trim()) return null;
  return JSON.parse(out).hookSpecificOutput;
}

function bash(command) {
  return call({ tool_name: "Bash", tool_input: { command }, hook_event_name: "PreToolUse" });
}

function expect(command, attendu) {
  checks += 1;
  const r = bash(command);
  const obtenu = r?.permissionDecision ?? "pass";
  const ok = obtenu === attendu;
  if (!ok) failures += 1;
  const court = command.length > 58 ? command.slice(0, 55) + "..." : command;
  console.log(`${ok ? "OK  " : "FAIL"} ${attendu.padEnd(4)} ${court}${ok ? "" : `   (obtenu: ${obtenu})`}`);
  if (ok && attendu !== "pass" && !r.permissionDecisionReason?.includes("[Hypervibe]")) {
    failures += 1;
    console.log("     FAIL: la raison ne porte pas la marque du plugin");
  }
}

console.log("── Refus (aucun usage legitime, une alternative existe) ──");
expect("git add -A", "deny");
expect("git add .", "deny");
expect("git add --all", "deny");
expect("git add -u", "deny");
expect('git commit -am "wip"', "deny");
expect("cd src && git add -A && git commit -m ok", "deny");
expect('git -C "C:/DEV/hypervibe-harness" add -A', "deny");
expect("git -C src add .", "deny");
expect("git --no-pager -c user.name=x add -A", "deny");
expect('node scripts/neon/run-sql.mjs "DROP TABLE clients"', "deny");
expect('node run-sql.mjs "TRUNCATE hypervibe_order"', "deny");
expect('node run-sql.mjs "ALTER TABLE t DROP COLUMN email"', "deny");

console.log("\n── Confirmation humaine (legitime, mais irreversible ou public) ──");
expect("git push", "ask");
expect("git push origin main", "ask");
expect("git push -u origin feat/x", "ask");
expect('git -C "C:/DEV/hypervibe-harness" push origin main --follow-tags', "ask");
expect("git --no-pager -C x push", "ask");
expect("vercel --prod", "ask");
expect("vercel deploy --prod", "ask");
expect("vercel rollback", "ask");
expect("pnpm db:push", "ask");
expect("npm run db:push", "ask");
expect("npx drizzle-kit push", "ask");
expect("node scripts/delete-project/execute-deletions.mjs --confirm demo", "ask");
expect('node run-sql.mjs "DELETE FROM sessions"', "ask");
expect('node run-sql.mjs "UPDATE users SET active = false"', "ask");
expect('node run-sql.mjs --destructif "DROP TABLE tmp_import"', "ask");
expect("git reset --hard", "ask");
expect("git checkout -- .", "ask");
expect("git restore .", "ask");
expect("git clean -fd", "ask");

console.log("\n── Laisse passer (le sens que personne ne teste) ──");
expect("git add src/a.ts src/b.ts", "pass");
expect("git add -p", "pass");
expect("git add docs/plan.md", "pass");
expect("git push --dry-run", "pass");
expect("git status --short", "pass");
expect("git commit -m 'feat: ok'", "pass");
expect('git commit -m "docs: expliquer pourquoi git add -A est refuse"', "pass");
expect('echo "git add -A"', "pass");
expect("grep -rn 'git push' docs/", "pass");
expect("pnpm db:studio", "pass");
expect("pnpm db:generate", "pass");
expect("pnpm lint && pnpm tsc --noEmit", "pass");
expect('node run-sql.mjs "SELECT count(*) FROM users"', "pass");
expect('node run-sql.mjs "DELETE FROM sessions WHERE expires_at < now()"', "pass");
expect('node run-sql.mjs "UPDATE users SET active = false WHERE id = 3"', "pass");
expect('node run-sql.mjs "INSERT INTO t (a) VALUES (1)"', "pass");
expect("HYPERVIBE_GUARD_ALLOW_PUSH=1 git push origin main", "pass");
expect("HYPERVIBE_GUARD_ALLOW_SWEEP=1 git add -A", "pass");
expect('HYPERVIBE_GUARD_ALLOW_SWEEP=1 git -C "C:/DEV/x" add -A', "pass");
expect('HYPERVIBE_GUARD_ALLOW_PUSH=1 git -C "C:/DEV/x" push origin main --follow-tags', "pass");
expect('git -C "C:/DEV/x" status --porcelain', "pass");
expect("git -C x add CHANGELOG.md .claude-plugin/plugin.json", "pass");
expect("git -C x ls-remote --tags origin v1", "pass");
expect("HYPERVIBE_GUARD_ALLOW_SWEEP=0 git add -A", "deny");
expect("HYPERVIBE_GUARD_ALLOW_PUSH=1 git add -A", "deny");
expect("vercel ls", "pass");
expect("vercel env pull .env.check --environment=production", "pass");
expect("git restore src/app/page.tsx", "pass");
expect("git reset HEAD~1", "pass");

console.log("\n── Robustesse (fail-open) ──");
checks += 1;
{
  const r = call({ tool_name: "Edit", tool_input: { file_path: "a.ts" } });
  const ok = r === null;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} un outil autre que Bash n'est pas concerne`);
}
checks += 1;
{
  const r = call("ceci n'est pas du JSON");
  const ok = r === null;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} stdin invalide -> laisse passer (fail-open)`);
}
checks += 1;
{
  const r = call({ tool_name: "Bash", tool_input: {} });
  const ok = r === null;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} commande absente -> laisse passer`);
}

const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)];
checks += 1;
const rapide = median < 150;
if (!rapide) failures += 1;
console.log(
  `${rapide ? "OK  " : "FAIL"} cout par appel : ${median.toFixed(0)} ms median (budget 150 ms)`,
);

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
