#!/usr/bin/env node
// ensure-hooks-chain.mjs - The machine-wide git hooks that hand over to each
// repository's own hooks.
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
//                            carries the same chain block (see CHAIN_BLOCK)
//
// and, when no global hooks path is configured at all (the gitleaks setup was
// declined), falls back to the current repository's `.git/hooks/pre-push`.
//
//   node scripts/ensure-hooks-chain.mjs          prints OK / INSTALLED / LOCAL
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

/** The block shared by pre-commit and pre-push: hand over to the repo's own hook. */
export function chainBlock(hook) {
  return `# --- chain to the repository's own hook -------------------------------------
# Any repository may commit a .hooks/${hook} of its own: it runs here. Needed
# because core.hooksPath is global on this machine, which makes .git/hooks/
# inert everywhere. Placed BEFORE anything optional (like the gitleaks scan) on
# purpose: a repository's own checks must never depend on a third-party tool
# being installed.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$TOPLEVEL" ] && [ -f "$TOPLEVEL/.hooks/${hook}" ]; then
  sh "$TOPLEVEL/.hooks/${hook}" "$@" || exit 1
fi
# -----------------------------------------------------------------------------
`;
}

export function prePushHook() {
  return `#!/usr/bin/env sh
${PRE_PUSH_MARKER}
# Auto-installed by Hypervibe. Runs the repository's own .hooks/pre-push (tests
# and recette before publishing, when /add-test equipped the project).
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

/**
 * @returns {"OK"|"INSTALLED"|"LOCAL"|"FOREIGN"}
 *   OK        the global chain hook is already in place
 *   INSTALLED it was written (or refreshed) this run
 *   LOCAL     no global hooks path: written into the current repo's .git/hooks
 *   FOREIGN   a pre-push that is not ours exists; left untouched
 */
export function ensureHooksChain({ repoDir = process.cwd() } = {}) {
  const hooksPath = run("git config --global --get core.hooksPath");
  if (hooksPath) {
    if (!existsSync(HOOK_DIR)) mkdirSync(HOOK_DIR, { recursive: true });
    return writeIfNeeded(join(HOOK_DIR, "pre-push"), prePushHook());
  }
  const gitDir = run(`git -C "${repoDir}" rev-parse --git-dir`);
  if (!gitDir) return "OK";
  const localHooks = join(repoDir, gitDir, "hooks");
  if (!existsSync(localHooks)) mkdirSync(localHooks, { recursive: true });
  const state = writeIfNeeded(join(localHooks, "pre-push"), prePushHook());
  return state === "FOREIGN" ? "FOREIGN" : "LOCAL";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(ensureHooksChain());
}
