#!/usr/bin/env node
// test-hooks-chain.mjs - Recette of the git hooks chain: a clone never runs
// the hooks it arrived with.
//
// `.hooks/*` files are versioned, so they arrive with a clone, and git does not
// version its own hooks precisely so that cloning can never execute code. The
// chain block that hands over to a repository's `.hooks/pre-commit` therefore
// runs only in a checkout that opted in through its LOCAL git config, which a
// clone never carries. This recette does what an outside reader did on 3.1.4
// to find the hole, and asserts the opposite outcome: a throwaway repository
// whose `.hooks/pre-commit` writes a witness file, committed with the real
// chain block installed as `core.hooksPath` (passed per command, no global
// config touched). Without the opt-in the witness must NOT appear; with it, it
// must. Then the refresh: an old, ungated block is replaced in place.
//
//   node scripts/tests/test-hooks-chain.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chainBlock, refreshChainBlocks, TRUST_KEY } = await import(
  pathToFileURL(join(ROOT, "scripts", "ensure-hooks-chain.mjs")).href
);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const git = (dir, args, extra = {}) =>
  spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", ...extra });

// A throwaway "hooks directory" holding the real pre-commit chain block, as
// setup-gitleaks-global.mjs would write it (minus the scan, which needs the
// binary and is not what is under test).
const base = mkdtempSync(join(tmpdir(), "hypervibe-chain-"));
const hooksDir = join(base, "global-hooks");
mkdirSync(hooksDir);
writeFileSync(join(hooksDir, "pre-commit"), `#!/usr/bin/env sh\n${chainBlock("pre-commit")}exit 0\n`);
const hooksPathPosix = hooksDir.replace(/\\/g, "/");

// The "cloned" repository: its versioned .hooks/pre-commit writes a witness.
const repo = join(base, "clone");
mkdirSync(join(repo, ".hooks"), { recursive: true });
git(repo, ["init", "-q", "-b", "main"]);
git(repo, ["config", "user.email", "recette@example.test"]);
git(repo, ["config", "user.name", "recette"]);
writeFileSync(join(repo, ".hooks", "pre-commit"), '#!/bin/sh\necho executed > "$(git rev-parse --show-toplevel)/WITNESS"\n');
writeFileSync(join(repo, "a.txt"), "a\n");
git(repo, ["add", "a.txt", ".hooks/pre-commit"]);
const witness = join(repo, "WITNESS");

// 1. Without the opt-in: the hook is announced, not run.
const first = git(repo, ["-c", `core.hooksPath=${hooksPathPosix}`, "commit", "-q", "-m", "first"]);
check("un clone ne voit pas ses hooks versionnes executes (sans opt-in local)", first.status === 0 && !existsSync(witness), `exit ${first.status}`);
check("le hook annonce ce que le depot transporte, sur stderr", /ships a \.hooks\/pre-commit/.test(first.stderr) && /git config hypervibe\.hooks true/.test(first.stderr));

// 2. The opt-in is local config, and it is never cloned.
git(repo, ["config", "--local", TRUST_KEY, "true"]);
writeFileSync(join(repo, "b.txt"), "b\n");
git(repo, ["add", "b.txt"]);
const second = git(repo, ["-c", `core.hooksPath=${hooksPathPosix}`, "commit", "-q", "-m", "second"]);
check("avec l'opt-in local, le .hooks/pre-commit du depot s'execute", second.status === 0 && existsSync(witness) && /executed/.test(readFileSync(witness, "utf8")), `exit ${second.status}`);
const clone = join(base, "clone-of-clone");
git(base, ["clone", "-q", repo, clone]);
const cloned = git(clone, ["config", "--local", "--bool", "--get", TRUST_KEY]);
check("un clone du depot n'herite pas de l'opt-in (config locale, jamais clonee)", cloned.status !== 0 || cloned.stdout.trim() !== "true");
check("le clone transporte pourtant le hook versionne", existsSync(join(clone, ".hooks", "pre-commit")));

// 3. A failing hook still blocks the commit in a trusted checkout (the chain
//    keeps its purpose: the recette refuses a bad push).
writeFileSync(join(repo, ".hooks", "pre-commit"), "#!/bin/sh\nexit 1\n");
writeFileSync(join(repo, "c.txt"), "c\n");
git(repo, ["add", "c.txt", ".hooks/pre-commit"]);
const third = git(repo, ["-c", `core.hooksPath=${hooksPathPosix}`, "commit", "-q", "-m", "third"]);
check("dans un depot de confiance, un hook qui echoue bloque toujours le commit", third.status !== 0);

// 4. The refresh: an old ungated block (English or the French variant) is
//    replaced in place, the rest of the file untouched.
const oldDir = join(base, "old-hooks");
mkdirSync(oldDir);
const oldEnglish = `#!/usr/bin/env sh
# hypervibe-managed gitleaks pre-commit
# --- chain to the repository's own hook -------------------------------------
# Any repository may commit a .hooks/pre-commit of its own: it runs here.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$TOPLEVEL" ] && [ -f "$TOPLEVEL/.hooks/pre-commit" ]; then
  sh "$TOPLEVEL/.hooks/pre-commit" "$@" || exit 1
fi
# -----------------------------------------------------------------------------
GITLEAKS="/somewhere/gitleaks"
exit 0
`;
const oldFrench = `#!/usr/bin/env sh
# hypervibe-managed pre-push chain
# --- chainage des hooks propres a chaque depot (pose par spinoza P4) ---------
# Convention generique : tout depot peut committer son propre .hooks/pre-push,
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$TOPLEVEL" ] && [ -f "$TOPLEVEL/.hooks/pre-push" ]; then
  sh "$TOPLEVEL/.hooks/pre-push" || exit 1
fi
# -----------------------------------------------------------------------------
exit 0
`;
writeFileSync(join(oldDir, "pre-commit"), oldEnglish);
writeFileSync(join(oldDir, "pre-push"), oldFrench);
const refreshed = refreshChainBlocks(oldDir);
const newCommit = readFileSync(join(oldDir, "pre-commit"), "utf8");
const newPush = readFileSync(join(oldDir, "pre-push"), "utf8");
check("le rafraichissement remplace les deux anciens blocs", refreshed.length === 2, refreshed.join(", "));
check(
  "le bloc rafraichi porte l'opt-in, et le reste du hook est intact",
  newCommit.includes(`--get ${TRUST_KEY}`) && newCommit.includes('GITLEAKS="/somewhere/gitleaks"') && newCommit.includes("# hypervibe-managed gitleaks pre-commit") &&
    newPush.includes(`--get ${TRUST_KEY}`) && !/pose par spinoza/.test(newPush),
);
check("un second passage ne change plus rien", refreshChainBlocks(oldDir).length === 0);

// 5. The refreshed old hook behaves like the new one: announced, not run.
const repo2 = join(base, "clone2");
mkdirSync(join(repo2, ".hooks"), { recursive: true });
git(repo2, ["init", "-q", "-b", "main"]);
git(repo2, ["config", "user.email", "recette@example.test"]);
git(repo2, ["config", "user.name", "recette"]);
writeFileSync(join(repo2, ".hooks", "pre-commit"), '#!/bin/sh\necho executed > "$(git rev-parse --show-toplevel)/WITNESS"\n');
writeFileSync(join(repo2, "a.txt"), "a\n");
git(repo2, ["add", "a.txt", ".hooks/pre-commit"]);
const fourth = git(repo2, ["-c", `core.hooksPath=${oldDir.replace(/\\/g, "/")}`, "commit", "-q", "-m", "first"]);
check("le hook rafraichi n'execute pas non plus un clone non approuve", fourth.status === 0 && !existsSync(join(repo2, "WITNESS")), `exit ${fourth.status}`);

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
