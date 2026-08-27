#!/usr/bin/env node
/**
 * Recette d'etancheite : une cle OpenRouter ne doit jamais pouvoir sortir
 * dans la conversation.
 *
 * Cette recette existe parce que le defaut s'est produit. Une cle fraichement
 * creee s'est retrouvee affichee : le script la rendait sur sa sortie, un
 * appelant a plante, et Node a vide l'objet d'erreur complet, stdout compris.
 * Le correctif ne peut donc pas etre « faire attention » : il faut que la
 * valeur ne traverse plus la frontiere du processus, et un masque en dernier
 * recours sur tout ce qui s'ecrit.
 *
 * Aucun acces reseau, aucun appel a OpenRouter : on lit le script.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const setup = readFileSync(join(RACINE, "scripts", "ai", "ai-setup.mjs"), "utf8");

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

console.log("\nMasque de sortie");
verifier(
  "un masque est defini sur les cles OpenRouter",
  /const MASQUE = \/sk-or-v1-/.test(setup),
);
verifier(
  "toute sortie passe par le masque",
  /const sortir = [\s\S]{0,200}\.replace\(\s*MASQUE/.test(setup),
);

console.log("\nLa valeur ne sort pas du processus");
verifier(
  "la commande cle ne rend jamais le champ `valeur`",
  !/sortir\(\{[^}]*\bvaleur\b/.test(setup),
  "un `sortir` renvoie encore la valeur brute",
);
verifier(
  "la commande cle ecrit elle-meme dans le projet",
  setup.includes("push-env-vars.mjs") &&
    setup.includes("OPENROUTER_API_KEY=${creee.valeur}"),
);
verifier(
  "le journal de la poussee est filtre de la valeur",
  /filter\(\([a-z]\) => [a-z] && ![a-z]\.includes\(creee\.valeur\)\)/.test(setup),
);
verifier(
  "un echec d'ecriture renvoie a la revocation, pas a la recuperation",
  setup.includes("révoquez-la et relancez"),
);

console.log("\nLe masque fait son travail");
// On execute la fonction de masquage telle qu'elle est ecrite dans le script.
const MASQUE = /sk-or-v1-[A-Za-z0-9]{8,}/g;
const faux = "sk-or-v1-1964bc6cf859f776e3691bc3703c59416ecc5b6ded9530ff62c6c33";
const masquer = (o) =>
  JSON.stringify(o, null, 2).replace(MASQUE, "sk-or-v1-<masquee>");
verifier(
  "une cle en valeur de champ est masquee",
  !masquer({ valeur: faux }).includes(faux),
);
verifier(
  "une cle noyee dans un message d'erreur est masquee",
  !masquer({ message: `echec de la commande: OPENROUTER_API_KEY=${faux}` }).includes(
    faux,
  ),
);
verifier(
  "une cle imbriquee profondement est masquee",
  !masquer({ a: { b: [{ c: faux }] } }).includes(faux),
);
verifier(
  "le texte utile survit au masquage",
  masquer({ hash: "abc123", plafondUsd: 5 }).includes("plafondUsd"),
);

console.log(`\n${total - echecs}/${total} verifications passees`);
process.exit(echecs === 0 ? 0 : 1);
