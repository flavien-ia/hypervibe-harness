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

function call(payload, env = {}) {
  const started = process.hrtime.bigint();
  const out = execFileSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HYPERVIBE_GUARD_ALLOW_DB_PUSH: "", ...env },
  });
  timings.push(Number(process.hrtime.bigint() - started) / 1e6);
  if (!out.trim()) return null;
  return JSON.parse(out).hookSpecificOutput;
}

function bash(command, env = {}) {
  return call({ tool_name: "Bash", tool_input: { command }, hook_event_name: "PreToolUse" }, env);
}

function expect(command, attendu, env = {}) {
  checks += 1;
  const r = bash(command, env);
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
expect('git commit --all -m "wip"', "deny");
expect("git commit -a -m wip", "deny");
expect("cd src && git add -A && git commit -m ok", "deny");
expect('git -C "C:/DEV/hypervibe-harness" add -A', "deny");
expect("git -C src add .", "deny");
expect("git --no-pager -c user.name=x add -A", "deny");
expect('node scripts/neon/run-sql.mjs "DROP TABLE clients"', "deny");
expect('node run-sql.mjs "TRUNCATE hypervibe_order"', "deny");
expect('node run-sql.mjs "ALTER TABLE t DROP COLUMN email"', "deny");
expect("git push --no-verify", "deny");
expect("git push origin main --no-verify", "deny");
expect("git push --no-verify -u origin feat/x", "deny");
expect('git -C "C:/DEV/x" push --no-verify', "deny");

console.log("\n── Confirmation humaine (legitime, mais irreversible ou public) ──");
expect("git push", "ask");
expect("git push origin main", "ask");
expect("git push -u origin feat/x", "ask");
expect('git -C "C:/DEV/hypervibe-harness" push origin main --follow-tags', "ask");
expect("git --no-pager -C x push", "ask");
expect("vercel --prod", "ask");
expect("vercel deploy --prod", "ask");
expect("vercel rollback", "ask");
expect("npx vercel --prod", "ask");
expect("pnpm dlx vercel --prod", "ask");
expect("npx -y vercel deploy --prod", "ask");
expect("cd apps/web && npx vercel --prod", "ask");
expect("wrangler deploy", "ask");
expect("npx wrangler deploy", "ask");
expect('(cd "$WORKER_DIR" && npx wrangler deploy 2>&1 | tail -3)', "ask");
expect("wrangler secret put CRON_SECRET", "ask");
expect("pnpm dlx wrangler versions deploy", "ask");
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
// L'echappatoire du schema vient de l'environnement de la SESSION (pose par un
// humain avant de lancer Claude Code), jamais de la commande que tape le modele
// (revue externe, 3.1.4) : le prefixe ne suffit plus, la variable de session si.
expect("HYPERVIBE_GUARD_ALLOW_DB_PUSH=1 pnpm db:push", "ask");
expect("HYPERVIBE_GUARD_ALLOW_DB_PUSH=1 npx drizzle-kit push", "ask");
expect("pnpm db:push", "pass", { HYPERVIBE_GUARD_ALLOW_DB_PUSH: "1" });
expect("npx drizzle-kit push", "pass", { HYPERVIBE_GUARD_ALLOW_DB_PUSH: "1" });
expect("pnpm --filter web db:push", "pass", { HYPERVIBE_GUARD_ALLOW_DB_PUSH: "1" });
expect("git push origin main", "ask", { HYPERVIBE_GUARD_ALLOW_DB_PUSH: "1" });
expect("git add -A", "deny", { HYPERVIBE_GUARD_ALLOW_DB_PUSH: "1" });
expect("HYPERVIBE_GUARD_ALLOW_SWEEP=0 git add -A", "deny");
expect("HYPERVIBE_GUARD_ALLOW_PUSH=1 git add -A", "deny");
expect("HYPERVIBE_GUARD_ALLOW_DB_PUSH=0 pnpm db:push", "ask");
expect("HYPERVIBE_GUARD_ALLOW_PUSH=1 pnpm db:push", "ask");
expect("HYPERVIBE_GUARD_ALLOW_DB_PUSH=1 git push origin main", "ask");
expect("vercel ls", "pass");
expect("vercel env pull .env.check --environment=production", "pass");
expect("npx vercel env pull .env.check --environment=production", "pass");
expect("npx vercel ls", "pass");
expect("pnpm dlx create-t3-app@latest mon-app", "pass");
expect("npx drizzle-kit generate", "pass");
expect("wrangler whoami", "pass");
expect("npx wrangler tail", "pass");
expect("wrangler dev", "pass");
expect("wrangler secret list", "pass");
expect('grep -n "DROP|TRUNCATE" scripts/neon/run-sql.mjs', "pass");
expect("cat scripts/neon/run-sql.mjs | grep -c TRUNCATE", "pass");
expect('sed -n "1,30p" scripts/neon/run-sql.mjs', "pass");
expect("git restore src/app/page.tsx", "pass");
expect("git reset HEAD~1", "pass");

console.log("\n── Le refus ne nomme pas son propre contournement ──");
for (const cmd of ["git add -A", "git push origin main"]) {
  checks += 1;
  const r = bash(cmd);
  const ok = r !== null && !/HYPERVIBE_GUARD_ALLOW/.test(r.permissionDecisionReason ?? "");
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} la raison de « ${cmd} » ne cite pas le prefixe d'exception`);
}

console.log("\n── La tete de la commande ne cache rien (revue externe, 3.0.4) ──");
expect("sudo git add -A", "deny");
expect("sudo -u deploy -E git add -A", "deny");
expect("/usr/bin/git add -A", "deny");
expect("command git add -A", "deny");
expect("env FOO=1 git add -A", "deny");
expect("(git add -A && git commit -m x)", "deny");
expect("{ git add -A; }", "deny");
expect("if true; then git add -A; fi", "deny");
expect("git add -Av", "deny");
expect("git add -v -A", "deny");
expect('sh -c "git add -A"', "deny");
expect("bash -lc 'git add -A && git push origin main'", "deny");
expect('eval "git add -A"', "deny");
expect("\\git add -A", "deny");
expect('"git" add -A', "deny");
expect("time git push origin main", "ask");
expect("nice -n 10 git push origin main", "ask");
expect('bash -c "git push origin main"', "ask");
expect("while true; do git push origin main; done", "ask");
expect("./node_modules/.bin/vercel --prod", "ask");
expect("vercel deploy --target production", "ask");
expect("vercel deploy --target=production", "ask");
expect("npx wrangler@latest deploy", "ask");
expect("pnpm --filter web db:push", "ask");
expect("pnpm --filter=web run db:push", "ask");
expect("pnpm -r db:push", "ask");
expect("git checkout .", "ask");
expect("git clean --force", "ask");
expect("git clean -d -f", "ask");
expect('node run-sql.mjs --destructive "DROP TABLE tmp_import"', "ask");
expect('HYPERVIBE_GUARD_ALLOW_PUSH=1 bash -c "git push origin main"', "pass");
expect("HYPERVIBE_GUARD_ALLOW_SWEEP=1 sudo git add -A", "pass");
// ... et ce qui ressemble a ces formes sans en etre : le sens que personne ne teste.
expect("grep -n confirm scripts/delete-project/execute-deletions.mjs", "pass");
expect("cat scripts/delete-project/execute-deletions.mjs", "pass");
expect("vercel build --prod", "pass");
expect("npx wrangler deploy --dry-run", "pass");
expect("git clean -n", "pass");
expect("git checkout main", "pass");
expect("git checkout -- src/app.ts", "pass");
expect("git add -f .gitignore", "pass");
expect("sudo apt-get install -y git", "pass");
expect("command -v git", "pass");
expect("bash scripts/deploy.sh", "pass");
expect('sh -c "ls -la"', "pass");
expect('echo "(git add -A)"', "pass");
expect("time pnpm test", "pass");
expect("env | grep PATH", "pass");
expect("vercel env pull --environment=production", "pass");

console.log("\n── Monitor execute du shell comme Bash ──");
checks += 1;
{
  const r = call({ tool_name: "Monitor", tool_input: { command: "git push origin main" }, hook_event_name: "PreToolUse" });
  const ok = r?.permissionDecision === "ask";
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} Monitor: git push -> ask`);
}
checks += 1;
{
  const r = call({ tool_name: "Monitor", tool_input: { command: "tail -f app.log | grep --line-buffered ERROR" }, hook_event_name: "PreToolUse" });
  const ok = r === null;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} Monitor: une veille ordinaire passe`);
}

console.log("\n── L'accord de confiance et le worker partage demandent (revue externe, 3.1.6) ──");
expect("git config hypervibe.hooks true", "ask");
expect("git config --local hypervibe.hooks true", "ask");
expect("git -C C:/x config hypervibe.hooks true", "ask");
expect("git config --bool hypervibe.hooks true", "ask");
expect("git config set hypervibe.hooks true", "ask");
expect("node scripts/ensure-hooks-chain.mjs --trust", "ask");
expect('node "C:/Users/x y/scripts/shared-worker/ensure.mjs"', "ask");
expect("node scripts/shared-worker/worker-check.mjs", "ask");
expect("node scripts/shared-worker/ensure.mjs --force-redeploy", "ask");
expect("git config --local --bool --get hypervibe.hooks", "pass");
expect("git config --unset hypervibe.hooks", "pass");
expect("git config get hypervibe.hooks", "pass");
expect("git config user.email x@y.z", "pass");
expect("node scripts/ensure-hooks-chain.mjs", "pass");
expect("node scripts/shared-worker/ensure.mjs --dry-run", "pass");
expect("node scripts/shared-worker/worker-check.mjs --dry-run", "pass");
expect("node scripts/shared-worker/register.mjs --list", "pass");
expect("cat scripts/shared-worker/ensure.mjs", "pass");

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
