#!/usr/bin/env node
// test-skill-variables.mjs - The plugin's folder, its scripts' paths and the organisation's name
// are set by the skill that uses them (lot 7 inventory, 06/10/2026): /manage-collabs merged into
// `$ORG/<projet>` without ever setting `$ORG`, /offboard-collab read `${GH_ORG}` it only
// described, /add-db ran every command through a `$PLUGIN_DIR` set nowhere. Values a step hands
// to the next (a project's name, an id read in an answer) are not in this list: Claude writes
// them out. These ones it would have to guess. Reads the harness's own files: nothing runs.
//
//   node scripts/tests/test-skill-variables.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

/** Names a skill must set itself: where the plugin is, and what the vault says the organisation is. */
const MUST_SET = ["PLUGIN_DIR", "VAULT", "BWORG", "ACTIONS", "PROV", "PEOPLE", "ORG", "GH_ORG"];
const BLOCK = /^([ \t]*>?[ \t]*)```(?:bash|sh|shell)[ \t]*\n([\s\S]*?)^\1```/gm;

function* skillFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* skillFiles(p);
    else if (/^SKILL.*\.md$/.test(name)) yield p;
  }
}

/** The names of MUST_SET a skill's commands use without the skill ever setting them. Set means:
 *  assigned in a command, or written out whole in inline code (`VAULT="${CLAUDE_SKILL_DIR}/…"`).
 *  A name only mentioned (`l'org \`GH_ORG\``) is not set: nothing says where its value comes from. */
function unset(text) {
  const all = text.replace(/\r\n/g, "\n");
  const blocks = [...all.matchAll(BLOCK)].map((m) => m[2]);
  const missing = [];
  for (const name of MUST_SET) {
    const used = blocks.some((b) => new RegExp(`\\$\\{?${name}\\b`).test(b));
    const set =
      blocks.some((b) => new RegExp(`(?:^|[\\s;&|(])(?:export\\s+)?${name}=`, "m").test(b)) ||
      new RegExp(`\`(?:export\\s+)?${name}=[^\`\\s]`).test(all);
    if (used && !set) missing.push(name);
  }
  return missing;
}

const holes = [];
let files = 0;
for (const file of skillFiles(join(ROOT, "skills"))) {
  files += 1;
  for (const name of unset(readFileSync(file, "utf8"))) holes.push(`${relative(ROOT, file)} : $${name}`);
}
console.log("── Ce qu'une skill ne doit jamais laisser deviner ──");
check(`${files} skills lues : chacune pose ce dont ses commandes se servent`, files > 0 && holes.length === 0, holes.join(", "));

console.log("\n── Témoins ──");
const fence = "```";
check("une commande qui se sert de $ORG sans le poser est vue", unset(`${fence}bash\ngh pr merge 3 --repo "$ORG/site"\n${fence}\n`).includes("ORG"));
check("posée dans la même skill, elle passe", unset(`${fence}bash\nORG=$(node "$VAULT" get GITHUB org_name)\nVAULT=x\ngh pr merge 3 --repo "$ORG/site"\n${fence}\n`).length === 0);
check("une valeur seulement nommée en prose ne compte pas comme posée", unset(`avec l'org \`GH_ORG\` :\n${fence}bash\nB="repos/\${GH_ORG}/site"\n${fence}\n`).includes("GH_ORG"));
check("écrite en entier en code en ligne, elle compte", unset(`> - \`VAULT="\${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"\`\n${fence}bash\nnode "$VAULT" status\n${fence}\n`).length === 0);

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) process.exit(1);
