#!/usr/bin/env node
// run-all.mjs - Every recette of the plugin, in one command.
//
//   node scripts/tests/run-all.mjs
//
// Run this before a release. None of these touch the network, a real project or
// a real database: they work on temporary fixtures and on the plugin's own
// sources, so they are safe to run anywhere, any number of times.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SUITES = [
  ["managed rule blocks", join(ROOT, "scripts", "tests", "test-managed-block.mjs")],
  ["global block size", join(ROOT, "scripts", "rules", "measure.mjs")],
  ["bash guardrails", join(ROOT, "hooks", "test-hooks.mjs")],
  ["git hooks chain (a clone never runs its hooks)", join(ROOT, "scripts", "tests", "test-hooks-chain.mjs")],
  ["child processes and paths with spaces", join(ROOT, "scripts", "tests", "test-spawn-paths.mjs")],
  ["workflow actions on a Node GitHub still runs", join(ROOT, "scripts", "tests", "test-workflow-actions.mjs")],
  ["commands run through a shell work in Windows' shell too", join(ROOT, "scripts", "tests", "test-shell-portable.mjs")],
  ["the folder /bootstrap creates a project in", join(ROOT, "scripts", "tests", "test-detect-projects-dir.mjs")],
  ["Vercel's GitHub application, checked by /start", join(ROOT, "scripts", "tests", "test-vercel-github-app.mjs")],
  ["gh's sign-in asked of the active account", join(ROOT, "scripts", "tests", "test-gh-signin.mjs")],
  ["zip writer", join(ROOT, "scripts", "tests", "test-zip.mjs")],
  ["memory index trimming", join(ROOT, "scripts", "tests", "test-memory-index.mjs")],
  ["shared resources never deleted with a project", join(ROOT, "scripts", "tests", "test-shared-exclusion.mjs")],
  ["a project's own registration on the shared clock is never recorded shared", join(ROOT, "scripts", "tests", "test-manifest-shared.mjs")],
  ["agent template fences", join(ROOT, "scripts", "tests", "test-agent-template-tools.mjs")],
  ["a value of the .env for a shell variable, its prefix for a check", join(ROOT, "scripts", "tests", "test-env-value.mjs")],
  ["SECURITY.md claims", join(ROOT, "scripts", "tests", "test-security-claims.mjs")],
  ["rate limiter: the in-memory copies agree, and the shared counter keeps the contract", join(ROOT, "scripts", "tests", "test-rate-limit.mjs")],
  ["privacy audit: every service the project is connected to, known or not", join(ROOT, "scripts", "tests", "test-rgpd-audit.mjs")],
  ["Render variables: the project's own services, from its .env", join(ROOT, "scripts", "tests", "test-render-env.mjs")],
  ["/delete-project keeps a person's shared accounts without shipping them", join(ROOT, "scripts", "tests", "test-delete-keep.mjs")],
  ["skill descriptions", join(ROOT, "scripts", "tests", "test-skill-descriptions.mjs")],
  ["skill commands and texts per host", join(ROOT, "scripts", "tests", "test-skill-commands.mjs")],
  ["AI model selection", join(ROOT, "scripts", "tests", "test-ai-models.mjs")],
  ["AI secret containment", join(ROOT, "scripts", "tests", "test-ai-secret.mjs")],
  ["vercel deploy URL parsing", join(ROOT, "scripts", "tests", "test-vercel-deploy-output.mjs")],
  ["vercel plan before taking payments", join(ROOT, "scripts", "tests", "test-vercel-plan.mjs")],
  ["vercel projects in the right team", join(ROOT, "scripts", "tests", "test-vercel-projects.mjs")],
  ["pnpm workspace overrides", join(ROOT, "scripts", "tests", "test-pnpm-workspace.mjs")],
  ["map versions and worker", join(ROOT, "scripts", "tests", "test-map-pins.mjs")],
  ["shared worker check at update", join(ROOT, "scripts", "tests", "test-worker-check.mjs")],
  ["the shared clock: its jobs, spread backups, a watch that says what it could not read", join(ROOT, "scripts", "shared-worker", "worker.test.mjs")],
  ["what the plugin knows of the shared clock before touching it", join(ROOT, "scripts", "tests", "test-clock-state.mjs")],
  ["schema drift before db:push", join(ROOT, "scripts", "tests", "test-schema-drift.mjs")],
  ["SQL helper: what it refuses, where it sends", join(ROOT, "scripts", "tests", "test-run-sql.mjs")],
  ["database export never calls a holed backup ok", join(ROOT, "scripts", "tests", "test-dump-db.mjs")],
  ["a connection string never sits in an argument", join(ROOT, "scripts", "tests", "test-push-env-stdin.mjs")],
  ["a secret the host never gives back never erases the project's", join(ROOT, "scripts", "tests", "test-pull-sensitive-empty.mjs")],
  ["database organisation: which answers are certain", join(ROOT, "scripts", "tests", "test-neon-org.mjs")],
  ["git identity: checked and repaired, never shown", join(ROOT, "scripts", "tests", "test-git-identity.mjs")],
];

let failed = 0;
for (const [nom, script] of SUITES) {
  process.stdout.write(`\n=== ${nom} ===\n`);
  try {
    const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
    // Only the tail matters when everything passes.
    const lignes = out.trimEnd().split("\n");
    process.stdout.write(lignes.slice(-2).join("\n") + "\n");
  } catch (e) {
    failed += 1;
    process.stdout.write((e.stdout ?? "") + (e.stderr ?? "") + "\n");
  }
}

if (failed) {
  console.error(`\n${failed} suite(s) en echec`);
  process.exit(1);
}
console.log("\nToutes les recettes passent.");
