#!/usr/bin/env node
/**
 * Recette : ce que les skills font taper, et ce que leurs ports lisent.
 *
 * Trois defauts qu'aucune autre recette ne voyait :
 *  - une continuation de ligne ecrite `\n` (deux caracteres) au lieu d'une
 *    barre oblique suivie d'un vrai retour a la ligne. Quinze commandes
 *    `manifest.mjs add ... \n  --kind` l'ont porte jusqu'en 3.1.9 (retour
 *    utilisateur du 15/09/2026) : le modele recopie la commande, le shell
 *    recoit un argument `n` en trop ;
 *  - l'ancre du dossier de la skill ecrite sans accolades (le nom de la
 *    variable derriere un dollar nu), que le convertisseur Codex/OpenCode ne
 *    reecrivait pas jusqu'a sa 0.4.0. La forme du plugin est le dollar suivi
 *    du nom entre accolades ;
 *  - un texte par outil (`SKILL.codex.md`...) sans original ou mal nomme, et
 *    un `ports.json` qui exclurait une skill qui n'existe pas.
 * Aucun reseau, lecture seule des sources du plugin. Les ancres des exemples
 * sont assemblees a l'execution : ecrites en clair, le convertisseur les
 * reecrirait dans le port, ou les signalerait comme oubliees.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS = join(ROOT, "skills");

let echecs = 0;
let total = 0;
const verifier = (nom, condition, detail = "") => {
  total += 1;
  if (condition) console.log(`  ok   ${nom}`);
  else {
    echecs += 1;
    console.log(`  ECHEC ${nom}${detail ? ` : ${detail}` : ""}`);
  }
};

const DOLLAR = "$";
const VARIABLE = "CLAUDE_" + "SKILL_DIR";
const ancreNue = DOLLAR + VARIABLE;
const ancreAccolades = DOLLAR + "{" + VARIABLE + "}";

const CONTINUATION_LITTERALE = /[ \t]\\n[ \t]+-/;
const ANCRE_SANS_ACCOLADES = new RegExp("\\" + DOLLAR + "CLAUDE_(?:SKILL_DIR|PLUGIN_ROOT)(?![A-Za-z0-9_])");
// Le dossier du plugin tape en dur (celui du poste de l'auteur) : il ne vaut
// que la ou le plugin a ete televerse dans Claude Desktop, jamais dans un port.
// Sept commandes du Team l'ont porte jusqu'en 2.1.10 (le `start` solo jusqu'en 3.1.6).
const CHEMIN_CODE_EN_DUR = /\.claude\/plugins\/marketplaces\/[^/\s"'`]+\/hypervibe/;
const VARIANTE = /\.(codex|opencode)\.md$/;

console.log("\nLes motifs eux-memes");
verifier("une continuation ecrite \\n est reperee", CONTINUATION_LITTERALE.test('add --project-dir "<p>" \\n  --kind db-backup'));
verifier("une vraie continuation passe", !CONTINUATION_LITTERALE.test('add --project-dir "<p>" \\\n  --kind db-backup'));
verifier("un \\n de printf ou de chaine JS passe", !CONTINUATION_LITTERALE.test('printf "ok\\n"; console.log("a\\n- b")'));
verifier("un chemin Windows passe", !CONTINUATION_LITTERALE.test("C:\\Program Files\\nodejs"));
verifier("l'ancre sans accolades est reperee", ANCRE_SANS_ACCOLADES.test('node "' + ancreNue + '/../../scripts/x.mjs"'));
verifier("l'ancre avec accolades passe", !ANCRE_SANS_ACCOLADES.test('node "' + ancreAccolades + '/../../scripts/x.mjs"'));
verifier("un dossier de plugin tape en dur est repere", CHEMIN_CODE_EN_DUR.test('PLUGIN_DIR="' + DOLLAR + 'HOME/.claude/plugins/marketplaces/mon-poste/hypervibe-team-admin"'));
verifier("l'ancre du plugin passe", !CHEMIN_CODE_EN_DUR.test('PLUGIN_DIR="' + ancreAccolades + '/../.."'));

const markdowns = [];
const parcourir = (skill, dossier) => {
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name);
    if (e.isDirectory()) parcourir(skill, p);
    else if (e.name.endsWith(".md")) markdowns.push({ skill, p, rel: p.slice(SKILLS.length + 1).split("\\").join("/") });
  }
};
for (const skill of readdirSync(SKILLS).sort()) {
  if (statSync(join(SKILLS, skill)).isDirectory()) parcourir(skill, join(SKILLS, skill));
}

console.log(`\nLes ${markdowns.length} fichiers Markdown des skills`);
const continuations = [];
const ancres = [];
const chemins = [];
for (const f of markdowns) {
  readFileSync(f.p, "utf8").split(/\r?\n/).forEach((ligne, i) => {
    if (CONTINUATION_LITTERALE.test(ligne)) continuations.push(`${f.rel}:${i + 1}`);
    if (ANCRE_SANS_ACCOLADES.test(ligne)) ancres.push(`${f.rel}:${i + 1}`);
    if (CHEMIN_CODE_EN_DUR.test(ligne)) chemins.push(`${f.rel}:${i + 1}`);
  });
}
verifier("aucune continuation de ligne ecrite \\n", continuations.length === 0, continuations.slice(0, 5).join(", "));
verifier("aucune ancre sans accolades", ancres.length === 0, ancres.slice(0, 5).join(", "));
verifier("aucun dossier de plugin tape en dur", chemins.length === 0, chemins.slice(0, 7).join(", "));

console.log("\nTextes par outil et ports.json");
const variantes = markdowns.filter((f) => VARIANTE.test(f.rel));
for (const v of variantes) {
  verifier(`${v.rel} remplace un fichier qui existe`, existsSync(v.p.replace(VARIANTE, ".md")));
  if (/(^|\/)SKILL\.(codex|opencode)\.md$/.test(v.rel)) {
    const nom = readFileSync(v.p, "utf8").match(/^name:\s*(.+?)\s*$/m)?.[1];
    verifier(`${v.rel} porte le nom de sa skill`, nom === v.skill, nom);
  }
}
const ports = JSON.parse(readFileSync(join(ROOT, "ports.json"), "utf8"));
const exclues = Array.isArray(ports.exclude) ? ports.exclude : Object.values(ports.exclude ?? {}).flat();
for (const skill of new Set(exclues)) {
  verifier(`ports.json exclut une skill qui existe : ${skill}`, existsSync(join(SKILLS, skill, "SKILL.md")));
}
verifier(
  "ports.json : prefixe des skills internes conforme",
  /^[a-z0-9]+(?:-[a-z0-9]+)*-?$/.test(ports.internalPrefix ?? ""),
  String(ports.internalPrefix),
);

console.log(`\n${total - echecs}/${total} verifications passent`);
process.exit(echecs ? 1 : 0);
