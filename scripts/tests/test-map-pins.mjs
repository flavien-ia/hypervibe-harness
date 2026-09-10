#!/usr/bin/env node
/**
 * Recette : les versions de MapLibre installées par /add-map, et le câblage
 * du worker de MapLibre v6.
 *
 * Trois défauts réels derrière ces vérifications (2026-09-10) :
 *  - maplibre-gl était épinglé en ^5.24.0, et toute la ligne 5 porte une
 *    faille XSS critique (GHSA-jrc7-96c5-q579), corrigée en 6.4.1 seulement ;
 *  - le `^` se perdait en route : cmd.exe le mange quand la spec lui arrive
 *    sans guillemets, et `pnpm add` garde exacte une version déjà exacte.
 *    Le paquet restait figé, sans correctif possible ;
 *  - MapLibre v6 sous Next.js ne trouve pas son worker sans setWorkerUrl : la
 *    carte s'affiche alors sans aucune donnée vectorielle, sans erreur.
 *
 * Aucun accès réseau : lecture des sources du plugin.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (chemin) => readFileSync(join(RACINE, chemin), "utf8");

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
const auMoins = (version, plancher) => {
  const a = version.split(".").map(Number);
  const b = plancher.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

const setup = lire("scripts/setup-map.mjs");
const worker = lire("templates/map/maplibre-worker.ts");
const copie = lire("templates/map/copy-maplibre-worker.mjs");
const carte = lire("templates/map/map.tsx");
const skill = lire("skills/add-map/SKILL.md");

console.log("\nVersions installées");
const spec = (nom) => new RegExp(`const \\w+ = "${nom}@\\^(\\d+\\.\\d+\\.\\d+)";`).exec(setup)?.[1] ?? "";
const maplibre = spec("maplibre-gl");
const reactMapGl = spec("react-map-gl");
verifier("maplibre-gl sur la majeure 6, au moins 6.4.1", maplibre.startsWith("6.") && auMoins(maplibre, "6.4.1"), maplibre);
verifier("react-map-gl sur la majeure 8, au moins 8.1.2", reactMapGl.startsWith("8.") && auMoins(reactMapGl, "8.1.2"), reactMapGl);
verifier(
  "les plages sont écrites dans package.json, aucune ne passe par `pnpm add`",
  setup.includes("manifest.dependencies[name] = spec.slice(at + 1);") &&
    setup.includes('spawnSync("pnpm install"') &&
    !/pnpm add "\$\{/.test(setup),
);
verifier(
  "la commande lisible par les scanners suit les constantes",
  setup.includes(`\`pnpm add maplibre-gl@^${maplibre} react-map-gl@^${reactMapGl}\``),
);
verifier(
  "le SKILL annonce les mêmes versions",
  skill.includes(`maplibre-gl@^${maplibre}`) && skill.includes(`react-map-gl@^${reactMapGl}`),
);

console.log("\nWorker MapLibre v6");
const adresse = /setWorkerUrl\("([^"]+)"\)/.exec(worker)?.[1];
verifier("le worker est désigné dans public/maplibre/", adresse === "/maplibre/maplibre-gl-worker.mjs", adresse);
verifier(
  "la copie dépose le worker ET son voisin partagé au même endroit",
  /"public", "maplibre"/.test(copie) && copie.includes('"maplibre-gl-worker.mjs"') && copie.includes('"maplibre-gl-shared.mjs"'),
);
verifier("MapView importe le module du worker", /^import "\.\/maplibre-worker";$/m.test(carte));
verifier(
  "setup-map pose les hooks avant dev, build et preview",
  setup.includes('const HOOKED_SCRIPTS = ["dev", "build", "preview"];') &&
    setup.includes('const HOOK = "node ./scripts/copy-maplibre-worker.mjs";'),
);
verifier("public/maplibre/ est ignoré par git", setup.includes("/public/maplibre/\\n"));

console.log(`\n${total - echecs}/${total} vérifications passent`);
if (echecs) process.exit(1);
