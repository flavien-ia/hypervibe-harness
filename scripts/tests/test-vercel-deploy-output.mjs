#!/usr/bin/env node
/**
 * Recette : lire l'URL de production dans la sortie de `vercel --prod`.
 *
 * Cette recette existe parce que le défaut s'est produit (bizbosch,
 * 2026-09-10). La CLI Vercel 59 aligne ses libellés en colonnes, sans
 * deux-points, et fait précéder la ligne de production des séquences ANSI de
 * son indicateur d'attente. L'ancienne expression cherchait « Aliased: » et
 * « Production: », ne trouvait rien, et /bootstrap retombait sur
 * https://<nom>.vercel.app, faux dès que ce nom est déjà pris sur Vercel.
 *
 * Aucun accès réseau : on rejoue des sorties réelles de la CLI.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeployOutput, stripAnsi } from "../vercel/parse-deploy-output.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
const egal = (nom, obtenu, attendu) =>
  verifier(nom, obtenu === attendu, `obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);

console.log("\nCLI Vercel 59 (sortie réelle du /bootstrap de bizbosch)");
const cli59 = [
  "Build Completed in /vercel/output [40s]",
  "Deploying outputs...",
  "\x1b[2K\x1b[1A\x1b[2K\x1b[G  Production      https://bizbosch-48qzncdlj-studio-flavien-chervet.vercel.app",
  "Completing…",
  "▲ Aliased         https://bizbosch.vercel.app",
  "",
].join("\n");
const r59 = parseDeployOutput(cli59);
egal("alias lu malgré l'absence de deux-points", r59.aliasUrl, "https://bizbosch.vercel.app");
egal(
  "URL de production lue malgré les séquences ANSI",
  r59.productionUrl,
  "https://bizbosch-48qzncdlj-studio-flavien-chervet.vercel.app",
);

console.log("\nAnciennes CLI (libellés avec deux-points)");
const ancienne = parseDeployOutput(
  [
    "🔍  Inspect: https://vercel.com/studio/proj/8Hk2 [2s]",
    "✅  Production: https://proj-a1b2c3-studio.vercel.app [41s]",
    "🔗  Aliased: https://proj.vercel.app [41s]",
  ].join("\n"),
);
egal("alias", ancienne.aliasUrl, "https://proj.vercel.app");
egal("production", ancienne.productionUrl, "https://proj-a1b2c3-studio.vercel.app");

console.log("\nCouleurs et liens de terminal autour de l'URL");
egal(
  "URL colorée (sortie dans un terminal)",
  parseDeployOutput("▲ Aliased         \x1b[36mhttps://proj.vercel.app\x1b[39m\n").aliasUrl,
  "https://proj.vercel.app",
);
egal(
  "lien de terminal OSC 8",
  parseDeployOutput("▲ Aliased  \x1b]8;;https://proj.vercel.app\x07https://proj.vercel.app\x1b]8;;\x07\n").aliasUrl,
  "https://proj.vercel.app",
);
egal("stripAnsi retire les séquences du spinner", stripAnsi("\x1b[2K\x1b[1A\x1b[2K\x1b[GProduction"), "Production");

console.log("\nCe qui ne doit pas passer pour une URL de production");
const inspectSeul = parseDeployOutput("🔍  Inspect: https://vercel.com/studio/proj/8Hk2 [2s]\n");
verifier("la page Inspect n'est ni un alias ni une production", inspectSeul.aliasUrl === null && inspectSeul.productionUrl === null);
egal("un domaine qui imite vercel.app est refusé", parseDeployOutput("▲ Aliased  https://proj.vercel.app.example.com\n").aliasUrl, null);
const sansAlias = parseDeployOutput("  Production      https://proj-x1-studio.vercel.app\n");
verifier(
  "sans ligne Aliased, seul le déploiement est lu",
  sansAlias.aliasUrl === null && sansAlias.productionUrl === "https://proj-x1-studio.vercel.app",
);

console.log("\nbootstrap-init.mjs passe par ce parseur");
const bootstrap = readFileSync(join(RACINE, "scripts", "bootstrap-init.mjs"), "utf8");
verifier(
  "importe parseDeployOutput",
  /import \{[^}]*parseDeployOutput[^}]*\} from "\.\/vercel\/parse-deploy-output\.mjs"/.test(bootstrap),
);
verifier("n'exige plus « Aliased: » ni « Production: »", !/Aliased:\\s\+|Production:\\s\+/.test(bootstrap));

console.log(`\n${total - echecs}/${total} vérifications passent`);
if (echecs) process.exit(1);
