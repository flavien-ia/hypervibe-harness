#!/usr/bin/env node
// test-memory-index.mjs - Recette: /delete-project trims a MEMORY.md index
// by the files it deleted, never by the words on a line.
//
// The two scenarios an outside reader simulated on a real index (3.1.7): a
// line of another subject that cites the project in passing must stay, and a
// file kept for review must keep its line. Plus the empty heading rule.
//
//   node scripts/tests/test-memory-index.mjs

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { indexLinesFor, dropEmptySections, trimIndex } = await import(
  pathToFileURL(join(ROOT, "scripts", "delete-project", "_memory-index.mjs")).href
);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const index = [
  "# Mémoire projet",
  "",
  "- [Street Cool : déploiement](project_street_cool.md) - le projet lui-même",
  "- [Facturation](project_facturation.md) - mentionne street-cool au passage, dans une comparaison",
  "- [Street](project_street.md) - un autre projet, dont le nom est un préfixe",
  "",
  "## Revues",
  "",
  "- [Revue street-cool](review_street_cool.md) - fichier conservé pour relecture",
  "",
  "## Section entière du projet",
  "",
  "- [Notes street-cool](notes_street_cool.md) - la seule ligne de sa section",
  "",
  "## Autre",
  "",
  "- [Divers](divers.md) - sans rapport",
  "",
].join("\n");

// Only two files are deleted in this run: the project's own, and the notes
// whose section then becomes empty. The review file is KEPT (not named after
// the project by the inventory's rule), so its line must stay.
const deleted = ["project_street_cool.md", "notes_street_cool.md"];

const lines = index.split("\n");
const cibles = indexLinesFor(lines, deleted);
check("indexLinesFor : exactement les lignes dont le lien pointe vers un fichier supprime", cibles.length === 2 && cibles.every((l) => /project_street_cool\.md|notes_street_cool\.md/.test(l)), `${cibles.length}`);
check("indexLinesFor : accepte un chemin devant le nom de fichier", indexLinesFor(lines, ["C:/x/memory/project_street_cool.md"]).length === 1);

const { text, removed } = trimIndex(index, deleted);
check("trimIndex : deux lignes retirees, rendues a l'appelant", removed.length === 2);
check("la ligne d'un autre sujet qui cite le projet au passage reste", /Facturation.*street-cool au passage/.test(text));
check("la ligne du projet homonyme par prefixe reste", /\[Street\]\(project_street\.md\)/.test(text));
check("le fichier conserve pour relecture garde sa ligne", /review_street_cool\.md/.test(text));
check("la section devenue vide perd son titre", !/## Section entière du projet/.test(text));
check("les autres titres restent", /## Revues/.test(text) && /## Autre/.test(text) && /^# Mémoire projet/m.test(text));
// Two lines removed, then the empty section: its heading and the two blank
// lines that framed its only entry. Nothing else moves.
check("rien d'autre n'a bouge", text.split("\n").length === index.split("\n").length - 2 - 3, `${text.split("\n").length} lignes`);

const same = trimIndex(index, ["absent.md"]);
check("aucun fichier supprime : l'index est rendu intact", same.text === index && same.removed.length === 0);

check(
  "dropEmptySections : un titre de niveau 1 qui n'a que des sous-sections est garde",
  dropEmptySections(["# Titre", "", "## Sous", "- ligne"]).join("|") === "# Titre||## Sous|- ligne",
);
check(
  "dropEmptySections : un titre vide en fin de fichier est retire",
  dropEmptySections(["# Titre", "- a", "## Vide", ""]).join("|") === "# Titre|- a",
);

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
