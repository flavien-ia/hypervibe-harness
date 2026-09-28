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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

console.log("\n── Les substitutions de commande sont depliees (revue externe, 3.1.8) ──");
expect("result=$(node scripts/shared-worker/ensure.mjs)", "ask");
expect("x=$(git push origin main)", "ask");
expect("ok=$(git config --local hypervibe.hooks true)", "ask");
expect("v=`git add -A`", "deny");
expect('echo "$(git add -A)"', "deny");
expect("FOO=$(cat version.txt) git push origin main", "ask");
expect("OUT=$(echo $(git push origin main))", "ask");
expect("cd scripts/shared-worker && node ensure.mjs", "ask");
expect("node --no-warnings scripts/shared-worker/ensure.mjs", "ask");
expect("git config HYPERVIBE.HOOKS true", "ask");
expect("git config --local hypervibe.hooks true # a retirer plus tard avec --unset", "ask");
expect("echo '$(git push origin main)'", "pass");
expect('git commit -m "the fix: x=\\$(git push origin main) is unfolded now"', "pass");
expect('git commit -m "and v=\\`git add -A\\` too"', "pass");
expect('echo "\\$(git add -A)"', "pass");
expect("v=$(date +%Y)", "pass");
expect('echo "$(git rev-parse HEAD)"', "pass");
expect("node ensure.mjs --dry-run", "pass");
expect("node scripts/ensure-hooks-chain.mjs", "pass");
expect("git config --local --get hypervibe.hooks # set with true later", "pass");
expect("git config --unset HYPERVIBE.HOOKS", "pass");

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

// Revue externe de la 3.1.9 : ce que la lecture de la ligne de commande manquait.
// Le corps d'un heredoc est du texte (un message de commit qui cite `git add -A` n'est
// pas un balayage), une apostrophe entre guillemets doubles ne cache plus ce qui suit,
// les substitutions de processus sont jugees, et la regle 9 ne vise plus le ensure.mjs
// de n'importe quel projet.
expect("git commit -m \"$(cat <<'EOF'\nfix: garde-fou\n\ngit add -A reste refuse.\nEOF\n)\"", "pass");
expect("git commit -m \"$(cat <<'EOF'\nfix: garde-fou\n\ngit push origin main demande toujours.\nEOF\n)\"", "pass");
expect("git commit -m \"$(cat <<'EOF'\nfix(hooks): 1) le corps a des parentheses\nEOF\n)\"", "pass");
expect("git commit -m \"$(cat <<'EOF'\nfix(hooks): 1) le corps a des parentheses\nEOF\n)\" && git push origin main", "ask");
expect("cat <<'EOF' > notes.md\ngit add -A reste refuse.\nEOF", "pass");
expect("cat <<EOF > notes.md\n$(git push origin main)\nEOF", "ask");
expect("cat <<'EOF' > notes.md\n$(git push origin main)\nEOF", "pass");
expect("cat <<'EOF' > notes.md\nhello\nEOF\ngit push origin main", "ask");
expect("echo \"<<EOF\"\ngit push origin main\nEOF", "ask");
expect("cat <<< \"git add -A\"", "pass");
expect("cat <<-EOF\n\tgit add -A\n\tEOF", "pass");
expect("cat <<'EOF' > notes.md && git push origin main\nhello\nEOF", "ask");
expect("cat <<'EOF'\ngit add -A", "pass");
expect("echo \"l'accord $(git config hypervibe.hooks true)\"", "ask");
expect("msg=\"c'est parti $(git push origin main)\"", "ask");
expect("echo \"don't\" $(git push origin main)", "ask");
expect("echo 'it $(git push origin main)'", "pass");
expect("echo 'say \"hi' && git push origin main", "ask");
expect("x=$(echo \")\") && git push origin main", "ask");
expect("diff <(git push origin main) /dev/null", "ask");
expect("cat x | tee >(git add -A)", "deny");
expect("echo \"<(git push origin main)\"", "pass");
expect("cat < in.txt > out.txt", "pass");
expect("node ensure.mjs", "ask");
expect("node ./ensure.mjs", "ask");
expect("node scripts/setup/ensure.mjs", "pass");
expect("node autre-projet/worker-check.mjs", "pass");

// ... et la meme famille, trouvee en corrigeant : un commentaire qui contient une
// apostrophe, une commande envoyee en arriere-plan, un calcul qui contient `<<`, une
// ligne continuee par une barre oblique inverse.
expect("# don't\ngit push origin main", "ask");
expect("git status # git add -A", "pass");
expect("sleep 1 & git push origin main", "ask");
expect("node x.mjs > out.log 2>&1", "pass");
expect("node x.mjs &> out.log", "pass");
expect("echo ok >| out.txt", "pass");
expect("(( x = 1 << 2 ))\ngit push origin main", "ask");
expect("git push \\\n  origin main", "ask");

console.log("\n── Les deux gardes du SQL destructeur disent la meme chose (correctif du 20/09/2026) ──");
// Avant : le script connaissait DROP INDEX / VIEW / TYPE, pas cette regle. Refuse par le
// script, relance avec --destructif comme son message y invite, et plus personne n'etait
// interroge. Meme trou pour tout objet qu'aucune des deux listes ne nommait.
expect('node run-sql.mjs "DROP TYPE humeur"', "deny");
expect('node run-sql.mjs "DROP INDEX idx_clients_email"', "deny");
expect('node run-sql.mjs "DROP FUNCTION purge()"', "deny");
expect('node run-sql.mjs "DROP MATERIALIZED VIEW mv_ventes"', "deny");
expect('node run-sql.mjs "DROP POLICY lecture ON clients"', "deny");
expect('node run-sql.mjs --destructif "DROP TYPE humeur"', "ask");
// Avec le drapeau, une personne confirme TOUJOURS, meme quand la regle ne voit rien du SQL :
// une variable, un fichier, un bloc DO ne lui montrent rien, et "rien vu" n'est pas "rien a demander".
expect('node run-sql.mjs --destructif "$SQL"', "ask");
expect('node run-sql.mjs --destructif "SELECT 1"', "ask");
expect("node run-sql.mjs --destructif \"DO \\$\\$ BEGIN EXECUTE 'DROP TABLE clients'; END \\$\\$\"", "ask");
// Un WHERE qui ne borne rien vaut une absence de WHERE.
expect('node run-sql.mjs "DELETE FROM sessions WHERE true"', "ask");
expect('node run-sql.mjs "UPDATE users SET active = false WHERE 1=1"', "ask");
// ... et ce qui y ressemble sans en etre.
expect('node run-sql.mjs "SELECT dropped_at FROM imports"', "pass");
expect('node run-sql.mjs "DELETE FROM sessions WHERE truc = 1"', "pass");
expect('node run-sql.mjs "UPDATE users SET active = false WHERE true_flag = 1"', "pass");

// Un appel nu a l'API du fournisseur de base qui detruit ou modifie demande une confirmation
// (le nettoyage sur copie de /clean supprime sa copie ainsi) ; lire et creer passent.
expect('curl -sf -X DELETE -H "Authorization: Bearer $K" https://console.neon.tech/api/v2/projects/p/branches/b', "ask");
expect('curl -s --request PATCH https://console.neon.tech/api/v2/projects/p -d "{}"', "ask");
expect('curl -s -H "Authorization: Bearer $K" https://console.neon.tech/api/v2/projects', "pass");
expect('curl -s -X POST https://console.neon.tech/api/v2/projects/p/branches -d "{}"', "pass");
expect("curl -s -X DELETE https://api.exemple.fr/v1/choses/3", "pass");

{
  // Parite : la meme instruction, vue par le script et par la regle. Les deux listes ont
  // deja diverge une fois ; ce controle casse le jour ou l'une bouge sans l'autre.
  const { statementsDestructrices } = await import(
    pathToFileURL(join(dirname(HOOK), "..", "scripts", "neon", "run-sql.mjs")).href
  );
  const instructions = [
    "DROP TABLE clients", "DROP TYPE humeur", "DROP INDEX i", "DROP VIEW v", "DROP MATERIALIZED VIEW mv",
    "DROP FUNCTION f()", "DROP TRIGGER t ON c", "DROP POLICY p ON c", "DROP SEQUENCE s", "DROP EXTENSION vector",
    "DROP SCHEMA public CASCADE", "TRUNCATE t", "ALTER TABLE t DROP COLUMN c", "ALTER TABLE t DROP CONSTRAINT k",
    "DELETE FROM t", "DELETE FROM t WHERE true", "UPDATE t SET a = 1", "UPDATE t SET a = 1 WHERE 1=1",
    "SELECT 1", "DELETE FROM t WHERE id = 3", "UPDATE t SET a = 1 WHERE id = 3", "INSERT INTO t (a) VALUES (1)",
    "CREATE INDEX i ON t (a)", "CREATE TABLE t (id int)", "SELECT dropped_at FROM imports",
    // La ou les deux gardes pouvaient se separer : un mot-cle dans une chaine (revue externe, 3.2.5).
    "INSERT INTO log (msg) VALUES ('DROP TABLE users')", "INSERT INTO log (msg) VALUES ('TRUNCATE users')",
    "SELECT 'DROP TABLE users' AS exemple", "SELECT * FROM users WHERE note LIKE '%DROP TABLE%'",
    "UPDATE doc SET corps = 'DELETE FROM users' WHERE id = 1", "DELETE FROM t WHERE note = 'x'",
    "INSERT INTO t (a, b) VALUES (1, 2) ON CONFLICT (a) DO UPDATE SET b = 2",
  ];
  const ecarts = instructions.filter((sql) => {
    const script = statementsDestructrices(sql).length > 0;
    const regle = (bash(`node run-sql.mjs "${sql}"`)?.permissionDecision ?? "pass") !== "pass";
    return script !== regle;
  });
  checks += 1;
  if (ecarts.length) failures += 1;
  console.log(
    `${ecarts.length ? "FAIL" : "OK  "} parite script / regle sur ${instructions.length} instructions${ecarts.length ? ` : ${ecarts.join(" | ")}` : ""}`,
  );
}

console.log("\n── Un shell qui lit son script ailleurs que dans un -c (revue externe, 3.2.4) ──");
// Le corps d'un heredoc est une donnee pour toute commande, sauf pour un shell qui le lit :
// c'est alors son script. Meme chose pour un here-string, un tube, un <(...).
expect("bash <<'EOF'\ngit push origin main\nEOF\n", "ask");
expect("sh <<'SH'\ngit add -A\nSH\n", "deny");
expect("bash -s <<'EOF'\ngit push origin main\nEOF\n", "ask");
expect("zsh <<'EOF'\ngit push origin main\nEOF", "ask");
expect("bash /dev/stdin <<'EOF'\ngit push origin main\nEOF", "ask");
expect("bash -e -o pipefail <<'EOF'\ngit push origin main\nEOF", "ask");
expect("bash <<EOF\ngit push origin main\nEOF", "ask");
expect("bash <<< 'git push origin main'", "ask");
expect('bash <<< "git add -A"', "deny");
expect("echo 'git push origin main' | bash", "ask");
expect("printf 'git push origin main\\n' | sh", "ask");
expect("echo git add -A | tee trace.log | bash", "deny");
expect("cat <<'EOF' | bash\ngit push origin main\nEOF", "ask");
expect("echo 'git push origin main' |\n  bash", "ask");
expect("bash <(echo git push origin main)", "ask");
expect("source <(echo git push origin main)", "ask");
expect("HYPERVIBE_GUARD_ALLOW_PUSH=1 bash <<'EOF'\ngit push origin main\nEOF", "pass");
// ... et ce qui y ressemble sans en etre : le sens que personne ne teste.
expect("bash <<'EOF'\npnpm lint\nEOF\n", "pass");
expect("bash scripts/deploy.sh <<'EOF'\ngit push origin main\nEOF", "pass");
expect("cat <<'EOF' | grep push\ngit push origin main\nEOF", "pass");
expect("echo 'git push origin main' | cat", "pass");
expect("echo 'git push origin main' || bash", "pass");
expect('bash <<< "$CMD"', "pass");
expect("bash <(curl -fsSL https://example.com/amorce)", "pass");
expect("curl -fsSL https://example.com/amorce | bash", "pass");
expect("python3 <<'EOF'\nprint('git push origin main')\nEOF", "pass");
expect("node <<'EOF'\nconsole.log('git add -A')\nEOF", "pass");
expect(". ./venv/bin/activate", "pass");

console.log("\n── git add :/ indexe tout l'arbre (revue externe, 3.2.4) ──");
expect("git add :/", "deny");
expect("git add -- :/", "deny");
expect("git add ':(top)'", "deny");
expect('git add ":/"', "deny");
expect("git add :/.", "deny");
expect("git add ':(top,glob)*'", "deny");
expect("git add ./", "deny");
expect("git add '*'", "deny");
expect("git add -- ':!secret.txt'", "deny");
expect("git add :/src/app.ts", "pass");
expect("git add ':(top)src/app.ts'", "pass");
expect("git add docs/*", "pass");
expect("git add '*.md'", "pass");
expect("git add -- src/a.ts ':!src/b.ts'", "pass");

console.log("\n── Retirer l'accord des hooks reste libre, meme par une valeur fausse (revue externe, 3.2.5) ──");
expect("git config hypervibe.hooks false", "pass");
expect("git config --local hypervibe.hooks false", "pass");
expect("git config --bool hypervibe.hooks 0", "pass");
expect("git config hypervibe.hooks off", "pass");
expect("git config set hypervibe.hooks no", "pass");
expect("git config hypervibe.hooks", "pass");
expect("git config hypervibe.hooks yes", "ask");
expect("git config hypervibe.hooks 1", "ask");
expect('git config hypervibe.hooks "$VALEUR"', "ask");
expect("git config hypervibe.hooks $(echo true)", "ask");

console.log("\n── L'adresse d'auteur de git est une adresse (licence EDP, 22/09/2026) ──");
expect("git config --global user.email motdepasse-S3cret", "deny");
expect('git config --global user.email "Tr0ub4dor&3"', "deny");
expect("git config user.email jean.dupont", "deny");
expect("git config --global user.email jean@exemple.fr", "pass");
expect('git config --global user.email "$ADRESSE"', "pass");
expect("git config --global --get user.email", "pass");
expect("git config --global user.email", "pass");
expect("git config --global --unset user.email", "pass");
expect('git config --global user.name "Jean Dupont"', "pass");
{
  checks += 1;
  const r = bash("git config --global user.email motdepasse-S3cret");
  const ok = r?.permissionDecision === "deny" && !/motdepasse-S3cret/.test(r.permissionDecisionReason ?? "");
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} le refus ne repete jamais la valeur ecartee`);
}

console.log("\n── Les appels destructeurs aux API que le plugin pilote demandent (revue externe, 3.2.5) ──");
expect('curl -s -X DELETE -H "Authorization: Bearer $VT" https://api.vercel.com/v9/projects/prj_1', "ask");
expect('curl -s -X DELETE -H "Authorization: Bearer $CFTOK" "https://api.cloudflare.com/client/v4/zones/z/dns_records/r"', "ask");
expect("curl -sS --request PATCH https://api.vercel.com/v9/projects/prj_1 -d '{}'", "ask");
expect("curl -s -XDELETE https://api.upstash.com/v2/redis/database/db1", "ask");
expect("curl -s -X PUT https://api.cloudflare.com/client/v4/zones/z/dns_records/r -d '{}'", "ask");
expect('curl -sf -X DELETE -H "Authorization: Bearer $K" https://console.neon.tech/api/v2/projects/p/branches/b', "ask");
expect('echo "$RECORDS" | node -e "x" | while read RID; do\n  curl -s -X DELETE -H "Authorization: Bearer $T" \\\n    "https://api.cloudflare.com/client/v4/zones/$Z/dns_records/$RID"\ndone', "ask");
expect("curl -s https://api.vercel.com/v9/projects", "pass");
expect("curl -s -X POST https://api.cloudflare.com/client/v4/zones/z/dns_records -d '{}'", "pass");
expect('curl -s -X PUT "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexemple.fr" -H "Authorization: Bearer $TOK"', "pass");
expect("curl -s -X PUT https://api.brevo.com/v3/senders/domains/exemple.fr/authenticate", "pass");
expect("curl -s -X DELETE https://api.exemple.fr/v1/choses/3", "pass");
expect("curl -s -X DELETE https://api.vercel.com.exemple.fr/v9/projects/x", "pass");
{
  // La regle couvre toutes les API de gestion que les scripts de ce harnais appellent : un
  // fournisseur ajoute a un script sans l'etre a la regle casse cette verification, au lieu de
  // rester hors de sa vue (la regle ne se rouvre plus fournisseur par fournisseur).
  const { MANAGED_API_HOSTS } = await import(pathToFileURL(join(dirname(HOOK), "rules.mjs")).href);
  const hosts = new Set();
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "tests") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (/\.(?:mjs|js)$/.test(name)) {
        for (const m of readFileSync(full, "utf8").matchAll(/https:\/\/((?:api|console)\.[a-z0-9.-]+\.[a-z]{2,}|www\.googleapis\.com)/g)) hosts.add(m[1]);
      }
    }
  };
  visit(join(dirname(HOOK), "..", "scripts"));
  const missing = [...hosts].filter((h) => !MANAGED_API_HOSTS.includes(h));
  checks += 1;
  const ok = hosts.size > 0 && missing.length === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} la regle couvre les ${hosts.size} API de gestion appelees par les scripts${missing.length ? ` : manquent ${missing.join(", ")}` : ""}`);
}

console.log("\n── Les deux gardes SQL lisent la meme chose, chaines comprises (revue externe, 3.2.5) ──");
// La regle lit desormais la garde de run-sql.mjs dans le meme fichier : un mot-cle cite dans une
// chaine ne refuse plus rien, et un refus n'enseigne plus le drapeau --destructif pour rien.
expect("node run-sql.mjs \"INSERT INTO log (msg) VALUES ('DROP TABLE users')\"", "pass");
expect("node run-sql.mjs \"INSERT INTO log (msg) VALUES ('TRUNCATE users')\"", "pass");
expect("node run-sql.mjs \"SELECT 'DROP TABLE users' AS exemple\"", "pass");
expect("node run-sql.mjs \"SELECT * FROM users WHERE note LIKE '%DROP TABLE%'\"", "pass");
expect("node run-sql.mjs \"UPDATE doc SET corps = 'DELETE FROM users' WHERE id = 1\"", "pass");
expect("node run-sql.mjs \"DO \\$\\$ BEGIN EXECUTE 'DROP TABLE clients'; END \\$\\$\"", "deny");
expect('node run-sql.mjs --conn "$URL" "DROP TABLE clients"', "deny");

console.log("\n── xargs, et la frontiere de la commande fabriquee (revue externe, 3.2.6) ──");
expect("echo 'git push origin main' | xargs -I{} bash -c '{}'", "ask");
expect("echo 'git add -A' | xargs -I % sh -c '%'", "deny");
expect("echo main | xargs git push origin", "ask");
expect("xargs git push < branches.txt", "ask");
expect("xargs -0 -n1 git push origin", "ask");
// ... et ce qui y ressemble sans en etre.
expect("printf 'a.ts\\nb.ts\\n' | xargs git add", "pass");
expect("git diff --name-only | xargs git add", "pass");
expect("echo 'git push' | xargs -I{} echo {}", "pass");
expect("find src -name '*.ts' | xargs grep -l TODO", "pass");
// La frontiere choisie : ce que la substitution IMPRIME n'existe qu'a l'execution.
expect('bash <<< "$(echo git push origin main)"', "pass");

console.log("\n── xargs de macOS et autres lanceurs (revue externe, 3.3.1) ──");
expect("echo push origin main | xargs -J % git %", "ask");
expect("printf 'git push origin main' | xargs -0 -J % bash -c %", "ask");
expect("echo 'push origin main' | xargs -R 1 -I % git %", "ask");
expect("echo 'git push origin main' | xargs -S 1024 -I{} bash -c '{}'", "ask");
expect("find . -maxdepth 0 -exec git push origin main \\;", "ask");
expect("find . -maxdepth 0 -execdir git add -A \\;", "deny");
expect("find . -name x -ok git push origin main ';'", "ask");
expect("caffeinate -i git push origin main", "ask");
expect("stdbuf -oL git push origin main", "ask");
expect("timeout 60 git push origin main", "ask");
expect("timeout -k 5 60 git add -A", "deny");
// ... et ce qui y ressemble sans en etre.
expect("find src -name '*.ts' -exec grep -l TODO {} \\;", "pass");
expect("find . -name '*.log' -delete", "pass");
expect("timeout 60 pnpm test", "pass");
expect("stdbuf -oL pnpm dev", "pass");
expect("caffeinate -i pnpm build", "pass");
expect("echo a.ts | xargs -J % git add %", "pass");

console.log("\n── Accolades et options des lanceurs lues comme getopt (revue externe, 3.3.2) ──");
// Un {} colle a son mot n'est pas la fin d'un bloc { ...; } : lu ainsi, xargs recevait `git add {`.
expect("echo . | xargs -I{} git add {}", "deny");
expect("echo 'git push origin main' | xargs -I{} sh -c {}", "ask");
// Les options longues prennent leur valeur apres = OU dans le mot suivant, et un prefixe sans
// ambiguite vaut l'option entiere (getopt_long).
expect("timeout --signal KILL 60 git push origin main", "ask");
expect("timeout --kill-after 5 60 git add -A", "deny");
expect("timeout --sig KILL 60 git push origin main", "ask");
expect("timeout -vk 5 60 git push origin main", "ask");
expect("stdbuf --output L git push origin main", "ask");
expect("stdbuf --out L git push origin main", "ask");
expect("nice --adjustment 5 git push origin main", "ask");
expect("nice -n5 git push origin main", "ask");
expect("sudo --user root git push origin main", "ask");
expect("sudo -p '' git push origin main", "ask");
expect("sudo -iu root git add -A", "deny");
expect("env -C /tmp git push origin main", "ask");
expect("env --unset HOME git push origin main", "ask");
expect("exec -a nom git push origin main", "ask");
expect("setsid git push origin main", "ask");
// env -S : la valeur de l'option EST la commande.
expect("env -S 'git push origin main'", "ask");
expect("env --split-string='git push' origin main", "ask");
// Les blocs restent lus comme des blocs.
expect("{ git add -A;}", "deny");
expect("{ (git add -A); }", "deny");
// ... et ce qui y ressemble sans en etre.
expect("echo a.ts | xargs -I{} git add {}", "pass");
expect("timeout --signal KILL 60 pnpm test", "pass");
expect("stdbuf --output L pnpm dev", "pass");
expect("nice --adjustment 5 pnpm build", "pass");
expect("sudo --user root ls", "pass");
expect("env -S 'pnpm test'", "pass");
expect("echo ${HOME}", "pass");

console.log("\n── Accolades depliees comme le shell, lanceurs de macOS (revue externe, 3.3.4) ──");
// Le mot refuse n'apparait pas tel quel : le shell deplie les accolades avant de lancer.
expect("git add {.,.}", "deny");
expect("git add -{A,A}", "deny");
expect("git add {src,.}", "deny");
expect("git add {.,}", "deny");
expect("git add -{A..A}", "deny");
expect("{git,} add .", "deny");
expect("git add {a,{b,.}}", "deny");
expect("xcrun git add {.,.}", "deny");
expect("arch -arm64 git push origin main", "ask");
expect("arch -x86_64 git push origin main", "ask");
expect("arch -arch arm64 git push origin main", "ask");
expect("arch -e FOO=1 -arm64 git push origin main", "ask");
expect("arch -arm64 git add -A", "deny");
expect("xcrun git push origin main", "ask");
expect("xcrun --sdk macosx git push origin main", "ask");
expect("xcrun -sdk macosx git push origin main", "ask");
expect("xcrun -r git push origin main", "ask");
// ... et ce qui y ressemble sans en etre.
expect("git add src/{a,b}.ts", "pass");
expect("git add '{.,.}'", "pass");
expect('git add "{.,.}"', "pass");
expect("cp file.{js,ts} dir/", "pass");
expect("echo ${HOME} {a,b}", "pass");
expect("find . -name '*.ts' -exec grep -l foo {} \\;", "pass");
expect("xcrun --find clang", "pass");
expect("xcrun --show-sdk-path", "pass");
expect("arch -arm64 git --version", "pass");

console.log("\n── Un dossier hooks/ recopie seul garde ses regles (revue externe, 3.2.6) ──");
{
  const { spawnSync } = await import("node:child_process");
  const { copyFileSync, mkdirSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const seul = mkdtempSync(join(tmpdir(), "hv-hooks-seuls-"));
  mkdirSync(join(seul, "hooks"));
  for (const f of ["guard-bash.mjs", "rules.mjs"]) copyFileSync(join(dirname(HOOK), f), join(seul, "hooks", f));
  const r = spawnSync(process.execPath, [join(seul, "hooks", "guard-bash.mjs")], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git add -A" }, hook_event_name: "PreToolUse" }),
    encoding: "utf8",
  });
  rmSync(seul, { recursive: true, force: true });
  let decision = "pass";
  try {
    decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
  } catch {
    /* rien sur stdout */
  }
  checks += 1;
  const ok = r.status === 0 && decision === "deny" && !/node:internal/.test(r.stderr);
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} hooks/ seul : exit ${r.status}, decision ${decision}${ok ? "" : `, stderr ${r.stderr.trim().split("\n")[0]}`}`);
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
