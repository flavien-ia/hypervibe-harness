#!/usr/bin/env node
// test-skills-guard.mjs - No skill tells Claude to run a command its own guard refuses (lot 7
// inventory, 06/10/2026): three administrator skills ended on `git -C "$WORKDIR" add -A`, refused
// by the sweeping-stage rule, so their changes never reached the project as written. Every bash
// block of every skill goes through the guard's decide(); an ASK is fine (a human confirms), a
// DENY is a skill that cannot finish. Reads the harness's own files: nothing runs.
//
//   node scripts/tests/test-skills-guard.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { decide } = await import(pathToFileURL(join(ROOT, "hooks", "rules.mjs")).href);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

function* skillFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* skillFiles(p);
    else if (/^SKILL.*\.md$/.test(name)) yield p;
  }
}

// A fenced bash block, quoted in a callout ("> ") or not. The prefix never spans a line: a
// pattern that let it swallow the blank line before a fence missed four blocks out of ten.
const BLOCK = /^([ \t]*>?[ \t]*)```(?:bash|sh|shell)[ \t]*\n([\s\S]*?)^\1```/gm;
const FENCE = /^[ \t]*>?[ \t]*```(?:bash|sh|shell)[ \t]*$/gm;

let fences = 0;
let blocks = 0;
const refused = [];
for (const file of skillFiles(join(ROOT, "skills"))) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  fences += (text.match(FENCE) ?? []).length;
  for (const m of text.matchAll(BLOCK)) {
    blocks += 1;
    const prefix = m[1];
    const body = prefix.includes(">") ? m[2].replace(/^[ \t]*>[ \t]?/gm, "") : m[2];
    const verdict = decide(body);
    if (verdict?.decision === "deny") {
      refused.push(`${relative(ROOT, file)}:${text.slice(0, m.index).split("\n").length}`);
    }
  }
}

console.log("── Ce que les skills font lancer, face au garde-fou ──");
check(`chaque bloc est lu (${blocks} sur ${fences})`, blocks === fences && blocks > 0);
check("aucun n'est refusé", refused.length === 0, refused.join(", "));

console.log("\n── Témoins ──");
check("une indexation en vrac est bien vue comme refusée", decide('git -C "$WORKDIR" add -A')?.decision === "deny");
check("la même, préfixée, dans une copie clonée pour l'opération, passe", decide('HYPERVIBE_GUARD_ALLOW_SWEEP=1 git -C "$WORKDIR" add -A')?.decision !== "deny");

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) process.exit(1);
