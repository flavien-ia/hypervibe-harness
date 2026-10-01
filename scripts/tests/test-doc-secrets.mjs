#!/usr/bin/env node
// test-doc-secrets.mjs - No skill's documentation tells the person to paste a value into the chat.
//
// A key never goes through the conversation: when a skill needs one, a small window opens on the
// person's machine (`_collect-secret`), and the value goes from there to the vault or to the
// project's `.env` and hosting. The skills do it; their documentation pages (DOC.md, DOC.fr.md,
// which the site republishes with every version) still said, here and there, "you paste it into
// the chat". A page that describes the old gesture teaches it. This recette reads every DOC*.md
// and fails on a clause that carries a verb of pasting or copying next to "into the chat",
// "dans le chat" or "dans la conversation", unless the clause says never.
//
//   node scripts/tests/test-doc-secrets.mjs
//
// One named exception: /add-analytics, whose measurement identifier (G-XXXXXXXXXX) is public and
// is pasted into the conversation on purpose. A new exception is a decision, written here with
// its reason, not a line added in passing.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` : ${detail}` : ""}`);
}

/** The skills whose documentation pastes into the conversation on purpose, each with its reason. */
const PUBLIC_ON_PURPOSE = {
  "add-analytics": "the measurement identifier (G-XXXXXXXXXX) is public: it ends up in the page's source",
};

const PLACE = /dans le chat|dans la conversation|in(?:to)? the chat|in(?:to)? the conversation/i;
const VERB = new RegExp(
  [
    "copiez-collez",
    "(?<![a-zà-ÿ])(?:re)?(?:coll|copi)(?:e|es|ez|er|é|ée|és|ées|ent|ons|ant|iez)(?![a-zà-ÿ])",
    "(?<![a-z])(?:copy-)?past(?:e|es|ed|ing)(?![a-z])",
    "(?<![a-z])cop(?:y|ies|ied|ying)(?![a-z])",
  ].join("|"),
  "i",
);
const NEVER = /(?<![a-zà-ÿ])(?:jamais|pas|ni|never|not|nor)(?![a-zà-ÿ])/i;

/** The clauses of a text that tell the person to paste or copy something into the conversation:
 *  a verb and the place in the same clause, with nothing before the place that says never. */
export function pastesIntoChat(text) {
  const found = [];
  for (const sentence of text.replace(/\r\n/g, "\n").split(/[.;:!?\n]+/)) {
    for (const clause of sentence.split(",")) {
      const place = PLACE.exec(clause);
      if (!place || !VERB.test(clause)) continue;
      if (NEVER.test(clause.slice(0, place.index))) continue;
      found.push(clause.trim());
    }
  }
  return found;
}

console.log("── Le detecteur, dans les deux sens ──");
{
  // What the pages said until 3.3.9 / 2.3.9, and what must keep being found.
  const told = [
    "Vous copiez la nouvelle valeur dans le chat.",
    "You paste the new value into the chat.",
    "Hypervibe vous guide pour générer un token (pas-à-pas, 1 minute) que vous collez dans le chat. Il sera sauvegardé pour de bon.",
    "Google vous affiche un **Client ID** et un **Client Secret**. Vous les copiez-collez dans le chat.",
    "You copy-paste them into the chat.",
    "Vous les collez dans la conversation, Hypervibe les range aussitôt et ne les réaffiche jamais.",
    "You paste them into the conversation, Hypervibe stores them immediately and never displays them again.",
    "Si vous n'avez pas encore de clé, vous la collez dans le chat.",
    "Copy the key and paste it in the chat",
  ];
  const missed = told.filter((line) => pastesIntoChat(line).length === 0);
  check("une phrase qui fait coller une valeur dans la conversation est trouvee", missed.length === 0, missed.join(" | "));
  // What the pages say now, and what a page may say without teaching anything wrong.
  const fine = [
    "Une petite fenêtre s'ouvre sur votre ordinateur : vous y collez la nouvelle valeur, jamais dans la conversation.",
    "A small window opens on your machine: you paste them there, never into the conversation.",
    "que vous collez dans une petite fenêtre masquée, jamais dans la conversation",
    "C'est aussi pour ça qu'une clé ne doit jamais être collée dans le chat",
    "That is also why a key should never be pasted into the chat",
    "Hypervibe ne la recopie jamais dans la conversation",
    "Ces deux clés sont secrètes, ne les collez jamais dans la conversation",
    "These two keys are secret, never paste them into the conversation",
    "Les décisions importantes restent dans la conversation : arrivées, départs. La page vous donne la commande à coller.",
    "Important decisions stay in the conversation: arrivals, departures. The page gives you the command to paste.",
    "Votre collaborateur vous écrit dans la conversation",
    "Une copie de sauvegarde est faite ; rien n'apparaît dans le chat",
    "jamais affichés dans le chat",
  ];
  const cried = fine.filter((line) => pastesIntoChat(line).length > 0);
  check("une phrase qui dit jamais, ou qui ne fait rien coller, passe", cried.length === 0, cried.join(" | "));
}

console.log("\n── Les fiches des skills ──");
{
  const skills = join(ROOT, "skills");
  const pages = [];
  for (const skill of existsSync(skills) ? readdirSync(skills) : []) {
    const dir = join(skills, skill);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) if (/^DOC.*\.md$/.test(name)) pages.push({ skill, file: join(dir, name) });
  }
  check("la recette lit bien les fiches des skills", pages.length >= 20, `${pages.length} fiches lues`);

  const telling = [];
  for (const { skill, file } of pages) {
    if (skill in PUBLIC_ON_PURPOSE) continue;
    for (const clause of pastesIntoChat(readFileSync(file, "utf8"))) telling.push(`${relative(ROOT, file).replace(/\\/g, "/")} : « ${clause.slice(0, 140)} »`);
  }
  check(
    "aucune fiche ne fait coller une valeur dans la conversation (une cle passe par la petite fenetre, et la fiche dit ou elle part)",
    telling.length === 0,
    `\n     ${telling.join("\n     ")}\n     Si la valeur est publique et que la fiche la fait coller expres, c'est une exception a nommer dans PUBLIC_ON_PURPOSE, avec sa raison`,
  );

  // The exception stays what it was named for: a page of that skill that pastes into the
  // conversation pastes the public identifier, which it shows.
  for (const [skill, reason] of Object.entries(PUBLIC_ON_PURPOSE)) {
    const own = pages.filter((p) => p.skill === skill);
    if (!own.length) continue;
    const texts = own.map((p) => readFileSync(p.file, "utf8"));
    check(`l'exception nommee /${skill} ne couvre que son identifiant public (${reason})`, texts.every((t) => pastesIntoChat(t).length === 0 || /G-XXXXXXXXXX/.test(t)));
  }
  check("la recette est branchee dans run-all.mjs", readFileSync(join(ROOT, "scripts/tests/run-all.mjs"), "utf8").includes("test-doc-secrets.mjs"));
}

console.log(`\n${checks - failures}/${checks} verifications`);
process.exitCode = failures ? 1 : 0;
