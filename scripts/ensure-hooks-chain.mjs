#!/usr/bin/env node
// ensure-hooks-chain.mjs - The machine-wide git hooks that hand over to each
// repository's own hooks, and the local opt-in without which they never do.
//
// Hypervibe sets `core.hooksPath` globally (~/.git-hooks, for the gitleaks
// scan). A global hooks path makes every repository's `.git/hooks/` inert, so
// a project can no longer install a hook of its own: the `.hooks/pre-push`
// that /add-test commits (tests + recette before every push) would never run.
//
// This script writes the two chain hooks that solve it, idempotently:
//
//   ~/.git-hooks/pre-push    runs <repo>/.hooks/pre-push when the repo has one
//   ~/.git-hooks/pre-commit  is written by setup-gitleaks-global.mjs, which
//                            carries the same chain block (see chainBlock)
//
// and, when no global hooks path is configured at all (the gitleaks setup was
// declined), falls back to the current repository's `.git/hooks/pre-push`.
//
// THE OPT-IN. `.hooks/*` files are versioned: they arrive with a clone. Git
// does not version its own hooks precisely so that cloning a repository can
// never execute code, and a chain that ran any repository's `.hooks/` reopened
// that door on every machine set up by /start (outside review, 3.1.4: a
// cloned `.hooks/pre-commit` ran at the first commit, before the secret scan,
// with no execute bit needed since `sh` launches it). So the hand-over happens
// only in a checkout whose LOCAL git config says `hypervibe.hooks = true`:
// local config is never cloned, and the value is set by an explicit act in
// that checkout (/add-test, `--trust` here, or the one-line
// `git config hypervibe.hooks true`). A clone that ships hooks is announced
// on stderr at the first commit or push, never run. The notice does not spell
// the opt-in command out: that text reaches the model in the output of its
// commit, and a person must be the one deciding (the guardrail asks before
// any write of hypervibe.hooks, outside review 3.1.6).
//
// The refresh: a global hook written by an earlier version carries the ungated
// block. Every run replaces it in place, in both hooks, so that /start,
// /add-test and /update-hypervibe all close the door on an existing machine.
//
//   node scripts/ensure-hooks-chain.mjs            prints OK / INSTALLED / REFRESHED / LOCAL / FOREIGN
//   node scripts/ensure-hooks-chain.mjs --trust    also opts the current repository in (TRUSTED)
//
// Exported for setup-gitleaks-global.mjs, which calls it at every /start.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const IS_WIN = process.platform === "win32";
export const HOOK_DIR = join(homedir(), ".git-hooks");
export const PRE_PUSH_MARKER = "# hypervibe-managed pre-push chain";
/** The local, never-cloned git config key that lets a checkout's hooks run. */
export const TRUST_KEY = "hypervibe.hooks";

/** The block shared by pre-commit and pre-push: hand over to the repo's own
 *  hook, in a checkout that opted in. */
export function chainBlock(hook) {
  return `# --- chain to the repository's own hook -------------------------------------
# A repository may commit a .hooks/${hook} of its own, and it runs here, but only
# in a checkout that opted in: \`git config ${TRUST_KEY} true\`, a LOCAL value a
# clone never carries. Git does not version its hooks precisely so that cloning
# can never execute code; running any repository's versioned hooks would reopen
# that door (outside review, 3.1.4). Placed BEFORE anything optional (like the
# gitleaks scan) on purpose: a repository's own checks must never depend on a
# third-party tool being installed.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$TOPLEVEL" ] && [ -f "$TOPLEVEL/.hooks/${hook}" ]; then
  if [ "$(git config --local --bool --get ${TRUST_KEY} 2>/dev/null)" = "true" ]; then
    sh "$TOPLEVEL/.hooks/${hook}" "$@" || exit 1
  else
    echo "[hypervibe] this repository ships a .hooks/${hook}; not run on this clone. Running it means trusting code that arrived with the clone: a person decides that, per checkout (README, Guardrails)." 1>&2
  fi
fi
# -----------------------------------------------------------------------------
`;
}

export function prePushHook() {
  return `#!/usr/bin/env sh
${PRE_PUSH_MARKER}
# Auto-installed by Hypervibe. Runs the repository's own .hooks/pre-push (tests
# and recette before publishing, when /add-test equipped the project), in a
# checkout that opted in.
# Uninstall: rm "$0"

${chainBlock("pre-push")}
exit 0
`;
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function writeIfNeeded(path, content) {
  if (existsSync(path)) {
    const current = readFileSync(path, "utf8");
    if (current === content) return "OK";
    if (!current.includes(PRE_PUSH_MARKER)) return "FOREIGN";
  }
  writeFileSync(path, content);
  if (!IS_WIN) chmodSync(path, 0o755);
  return "INSTALLED";
}

/** Replaces, in place, a chain block written by an earlier version (ungated,
 *  or the French variant some machines carry) with the gated one. Returns the
 *  hooks that were refreshed. Anything else in the file is left untouched. */
export function refreshChainBlocks(hookDir = HOOK_DIR) {
  const refreshed = [];
  for (const hook of ["pre-commit", "pre-push"]) {
    const path = join(hookDir, hook);
    if (!existsSync(path)) continue;
    const current = readFileSync(path, "utf8");
    if (current.includes(`--get ${TRUST_KEY}`)) continue;
    const start = current.search(/^# --- chain(?:age)? .*$/m);
    if (start < 0) continue;
    const endRe = /^# -{20,}\r?\n/m;
    endRe.lastIndex = 0;
    const rest = current.slice(start);
    const m = endRe.exec(rest);
    if (!m) continue;
    const next = current.slice(0, start) + chainBlock(hook) + rest.slice(m.index + m[0].length);
    writeFileSync(path, next);
    refreshed.push(hook);
  }
  return refreshed;
}

/** Opts a checkout in: its versioned hooks may run on this machine. Local
 *  config only, never cloned. */
export function trustRepo(repoDir = process.cwd()) {
  const gitDir = run(`git -C "${repoDir}" rev-parse --git-dir`);
  if (!gitDir) return "NOT_A_REPO";
  try {
    execSync(`git -C "${repoDir}" config --local ${TRUST_KEY} true`, { stdio: "ignore" });
    return "TRUSTED";
  } catch {
    return "ERROR";
  }
}

export function isTrusted(repoDir = process.cwd()) {
  return run(`git -C "${repoDir}" config --local --bool --get ${TRUST_KEY}`) === "true";
}

/**
 * @returns {"OK"|"INSTALLED"|"REFRESHED"|"LOCAL"|"FOREIGN"}
 *   OK        the global chain hook is already in place
 *   INSTALLED it was written (or refreshed) this run
 *   REFRESHED an older, ungated chain block was replaced in place
 *   LOCAL     no global hooks path: written into the current repo's .git/hooks
 *   FOREIGN   a pre-push that is not ours exists; left untouched
 */
export function ensureHooksChain({ repoDir = process.cwd(), trust = false } = {}) {
  const hooksPath = run("git config --global --get core.hooksPath");
  if (hooksPath) {
    if (!existsSync(HOOK_DIR)) mkdirSync(HOOK_DIR, { recursive: true });
    const refreshed = refreshChainBlocks(HOOK_DIR);
    const state = writeIfNeeded(join(HOOK_DIR, "pre-push"), prePushHook());
    if (trust) trustRepo(repoDir);
    return state === "OK" && refreshed.length > 0 ? "REFRESHED" : state;
  }
  const gitDir = run(`git -C "${repoDir}" rev-parse --git-dir`);
  if (!gitDir) return "OK";
  const localHooks = join(repoDir, gitDir, "hooks");
  if (!existsSync(localHooks)) mkdirSync(localHooks, { recursive: true });
  const state = writeIfNeeded(join(localHooks, "pre-push"), prePushHook());
  // Writing into this repository's own .git/hooks is an explicit act in this
  // checkout: it opts in as well.
  if (state !== "FOREIGN") trustRepo(repoDir);
  return state === "FOREIGN" ? "FOREIGN" : "LOCAL";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const trust = process.argv.includes("--trust");
  const state = ensureHooksChain({ trust });
  console.log(trust && state !== "FOREIGN" ? `${state} TRUSTED` : state);
}
