#!/usr/bin/env node
// test-workflow-actions.mjs - Recette: the workflows the harness writes use each action on a Node
// that GitHub still runs. GitHub deprecated Node 20 for actions and forces them onto Node 24, with
// a warning on every run (seen on a real run, 28/09/2026). For the actions the harness writes, the
// first major on Node 24, read in their action.yml (`using: node24`): checkout and setup-node v5,
// upload-artifact v6, github-script v8. An action not listed here is not judged.
//
//   node scripts/tests/test-workflow-actions.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIRST_ON_NODE_24 = { "actions/checkout": 5, "actions/setup-node": 5, "actions/upload-artifact": 6, "actions/github-script": 8 };

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ya?ml|md|mjs|json)$/.test(name)) files.push(p);
  }
}
for (const top of ["templates", "skills", "scripts"]) {
  try {
    walk(join(ROOT, top));
  } catch {
    // a harness without this folder
  }
}

const older = [];
let read = 0;
for (const f of files) {
  const rel = relative(ROOT, f).split("\\").join("/");
  if (rel.startsWith("scripts/tests/")) continue; // the recettes' fixtures
  read += 1;
  for (const m of readFileSync(f, "utf8").matchAll(/uses:\s*(actions\/[A-Za-z0-9_-]+)@v(\d+)/g)) {
    const first = FIRST_ON_NODE_24[m[1]];
    if (first && Number(m[2]) < first) older.push(`${rel}: ${m[1]}@v${m[2]}`);
  }
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}
check("every action the harness writes into a workflow runs on Node 24", older.length === 0, older.join(" | "));
check("... and the files that carry workflows were read", read > 10, String(read));
console.log(`\n${2 - failures}/2 checks`);
process.exitCode = failures ? 1 : 0;
