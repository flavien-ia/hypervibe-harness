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
  ["agent template fences", join(ROOT, "scripts", "tests", "test-agent-template-tools.mjs")],
  ["SECURITY.md claims", join(ROOT, "scripts", "tests", "test-security-claims.mjs")],
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
