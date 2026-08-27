#!/usr/bin/env node
/**
 * Controle des descriptions et des documentations de skills.
 *
 * Deux defauts qu'une release ne voit qu'une fois publiee, sur la page que
 * lisent les utilisateurs, et qui obligent alors a republier :
 *
 *   1. Une description de frontmatter interminable. Les bonnes tiennent entre
 *      95 (`add-analytics`) et 180 (`add-db`) caracteres ; les plus bavardes
 *      depassent 1500 et servent de mauvais modele a qui s'en inspire.
 *      `add-ai` est sortie a 877 en v2.10.0 precisement comme ca.
 *   2. Une skill publique sans `DOC.md` / `DOC.fr.md`. Ce sont eux que la
 *      plateforme affiche ; sans eux, le site retombe sur la description
 *      anglaise du frontmatter. `add-ai` a ete publiee sans les deux.
 *
 * Deux modes, et la distinction est le coeur de l'outil :
 *
 *   node check-skill-docs.mjs --nouvelles add-ai,autre-skill
 *     Controle STRICT des seules skills nommees, celles que la release ajoute.
 *     Sort 1 s'il reste quelque chose a corriger. C'est ce que la skill
 *     d'export appelle.
 *
 *   node check-skill-docs.mjs
 *     Etat des lieux, informatif, sort toujours 0 (sauf documentation
 *     manquante, qui est binaire et se corrige toujours). Exiger la concision
 *     de toutes les skills deja publiees produirait 64 lignes de bruit, et un
 *     controle qui crie sur tout est un controle qu'on cesse de lire.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS = join(RACINE, "skills");

/**
 * Au-dela, une description raconte la skill au lieu de la designer.
 *
 * Volontairement severe : une skill NOUVELLE doit suivre les meilleurs
 * exemples du plugin, pas sa moyenne. La moyenne s'est degradee au fil des
 * versions, c'est justement le probleme.
 */
const MAX_NOUVELLE = 250;

const args = process.argv.slice(2);
const iNouvelles = args.indexOf("--nouvelles");
const nouvelles =
  iNouvelles >= 0 && args[iNouvelles + 1]
    ? args[iNouvelles + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : null;

function lire(nom) {
  const skillMd = join(SKILLS, nom, "SKILL.md");
  if (!existsSync(skillMd)) return null;
  const contenu = readFileSync(skillMd, "utf8");
  const entete = contenu.split(/^---\s*$/m)[1] ?? "";
  const m = /^description:\s*(.*)$/ms.exec(entete);
  const texte = m
    ? m[1].split(/\n(?=[a-zA-Z-]+:)/)[0].trim().replace(/^"|"$/g, "").trim()
    : null;
  const manquants = nom.startsWith("_")
    ? []
    : ["DOC.md", "DOC.fr.md"].filter((f) => !existsSync(join(SKILLS, nom, f)));
  return { nom, description: texte, longueur: texte?.length ?? 0, manquants };
}

const toutes = readdirSync(SKILLS)
  .filter((n) => statSync(join(SKILLS, n)).isDirectory())
  .map(lire)
  .filter(Boolean);

let probleme = false;

// ── Mode strict : les skills que cette release ajoute ────────────────────────
if (nouvelles) {
  console.log(`Controle des skills nouvelles : ${nouvelles.join(", ")}\n`);
  for (const nom of nouvelles) {
    const s = toutes.find((x) => x.nom === nom);
    if (!s) {
      probleme = true;
      console.log(`  ${nom} : INTROUVABLE dans skills/`);
      continue;
    }
    const soucis = [];
    if (!s.description) soucis.push("pas de description dans le frontmatter");
    else if (s.longueur > MAX_NOUVELLE) {
      soucis.push(
        `description de ${s.longueur} caracteres (maximum ${MAX_NOUVELLE}) : elle raconte la skill au lieu de la designer`,
      );
    }
    if (s.manquants.length) {
      soucis.push(
        `documentation manquante (${s.manquants.join(", ")}) : la plateforme affichera la description anglaise a la place`,
      );
    }
    if (soucis.length) {
      probleme = true;
      console.log(`  ${nom} : a corriger`);
      for (const x of soucis) console.log(`     - ${x}`);
    } else {
      console.log(`  ${nom} : description ${s.longueur} caracteres, DOC.md et DOC.fr.md presents`);
    }
  }
  console.log(probleme ? "\nA corriger avant de publier." : "\nRien a signaler.");
  process.exit(probleme ? 1 : 0);
}

// ── Mode etat des lieux ──────────────────────────────────────────────────────
const sansDoc = toutes.filter((s) => s.manquants.length);
if (sansDoc.length) {
  probleme = true;
  console.log("Documentation utilisateur manquante (a corriger) :");
  for (const s of sansDoc) console.log(`   ${s.nom.padEnd(26)} ${s.manquants.join(", ")}`);
  console.log();
}

const publiques = toutes.filter((s) => !s.nom.startsWith("_") && s.description);
const longueurs = publiques.map((s) => s.longueur).sort((a, b) => a - b);
const mediane = longueurs[Math.floor(longueurs.length / 2)];
const bavardes = [...publiques].sort((a, b) => b.longueur - a.longueur).slice(0, 5);

console.log(`${toutes.length} skills, ${publiques.length} publiques.`);
console.log(
  `Descriptions : la plus courte ${longueurs[0]}, mediane ${mediane}, la plus longue ${longueurs.at(-1)} caracteres.`,
);
console.log("Les cinq plus bavardes (a garder en tete comme contre-exemples) :");
for (const s of bavardes) console.log(`   ${s.nom.padEnd(26)} ${s.longueur}`);
console.log(
  `\nUne skill NOUVELLE doit tenir sous ${MAX_NOUVELLE} caracteres : lancer avec --nouvelles <noms> pour l'exiger.`,
);
process.exit(probleme ? 1 : 0);
