#!/usr/bin/env node
// test-gh-signin.mjs - Recette: no script checks the sign-in of gh with `gh auth status`. It fails
// as soon as ANY account gh knows is stale, even when the one in use works (seen on 28/09/2026: a
// collaborator's old account stopped every variable). The check asks the active account who it is
// (`gh api user`). bootstrap-init.mjs keeps its first attempt, and falls back on `gh api /user`.
//
//   node scripts/tests/test-gh-signin.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const found = [];
let read = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "tests") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".mjs")) {
      read += 1;
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (/\[\s*"auth"\s*,\s*"status"\s*\]|login:\s*"gh auth status/.test(line)) found.push(`${relative(ROOT, p)}:${i + 1}`);
      });
    }
  }
}
walk(join(ROOT, "scripts"));

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}
check("no sign-in check reads `gh auth status`: the active account is asked who it is", found.length === 0, found.join(" | "));
check("... and the scripts were read", read > 10, String(read));
console.log(`\n${2 - failures}/2 checks`);
process.exitCode = failures ? 1 : 0;
