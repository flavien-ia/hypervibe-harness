#!/usr/bin/env node
// test-forge-gestures.mjs - What a skill does on the forge, it says only once the forge confirms it
// (lot 7 inventory, 06/10/2026). /rotate-secret left behind the copy of CRON_SECRET that /add-cron's
// GitHub fallback keeps in the repository, and every scheduled task answered 401 after a rotation;
// /add-collab said "removed" whenever the list could not be read, or ran past one page. Reads the
// skills' text: nothing reaches GitHub.
//
//   node scripts/tests/test-forge-gestures.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

const ROTATE = {
  "la copie du dépôt est mise à jour, valeur passée par un tube, jamais en argument": (t) =>
    t.includes(`printf '%s' "$NEW_VALUE" | gh secret set CRON_SECRET)`) && !/gh secret set CRON_SECRET\s+(?:-b|--body)/.test(t),
  "seulement quand une tâche du dépôt la lit": (t) => {
    const at = t.indexOf("gh secret set CRON_SECRET");
    return at > 0 && t.lastIndexOf("secrets.CRON_SECRET", at) > 0 && t.lastIndexOf("secrets.CRON_SECRET", at) > at - 600;
  },
  "un envoi raté est dit": (t) => t.includes("REPO_PUSH_FAILED"),
};

const COLLAB = {
  "les listes se lisent en entier": (t) =>
    t.includes("gh api --paginate repos/{owner}/{repo}/collaborators") && t.includes("gh api --paginate repos/{owner}/{repo}/invitations"),
  "« retiré » ne se dit jamais par défaut": (t) => !/\|\|\s*echo\s+"?removed/.test(t) && t.includes("NO_ANSWER") && t.includes("INVITATIONS_UNREAD"),
  "une invitation en attente est annulée": (t) => /invitations\/\{invitation_id\} -X DELETE/.test(t),
};

console.log("── /rotate-secret ──");
const rotate = lire("skills", "rotate-secret", "SKILL.md");
for (const [name, rule] of Object.entries(ROTATE)) check(name, rule(rotate));
console.log("\n── /add-collab ──");
const collab = lire("skills", "add-collab", "SKILL.md");
for (const [name, rule] of Object.entries(COLLAB)) check(name, rule(collab));

console.log("\n── Témoins : les anciens textes sont vus ──");
const OLD_COLLAB = [
  "gh api repos/{owner}/{repo}/collaborators -q '.[] | {login}'",
  "gh api repos/{owner}/{repo}/collaborators/{username} -X DELETE",
  'gh api repos/{owner}/{repo}/collaborators -q \'.[].login\' | grep -x "{username}" || echo "removed"',
].join("\n");
const passed = Object.entries(COLLAB).filter(([, rule]) => rule(OLD_COLLAB)).map(([n]) => n);
check("aucune règle de /add-collab ne laisse passer l'ancien texte", passed.length === 0, passed.join(" ; "));
const OLD_ROTATE = "### Push to the shared clock (`CRON_SECRET` only)\nnode register.mjs --rotate\n";
const passedRotate = Object.entries(ROTATE).filter(([, rule]) => rule(OLD_ROTATE)).map(([n]) => n);
check("aucune règle de /rotate-secret ne laisse passer l'ancien texte", passedRotate.length === 0, passedRotate.join(" ; "));

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) process.exit(1);
