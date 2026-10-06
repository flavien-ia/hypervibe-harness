#!/usr/bin/env node
/**
 * Recette : les planchers de sécurité de pnpm-workspace.yaml survivent au
 * /bootstrap, et ne vont jamais dans package.json.
 *
 * Vérifié le 2026-09-10 : un override posé dans le champ `pnpm` du
 * package.json est ignoré par pnpm 11 (celui de la machine) mais lu par
 * pnpm 10 (celui de Vercel), et le déploiement s'arrête sur
 * ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Dans pnpm-workspace.yaml, les deux
 * s'accordent. Encore faut-il que l'étape shadcn, qui réécrit ce fichier, ne
 * l'efface pas au passage.
 *
 * Aucun accès réseau : fichiers temporaires et lecture des sources.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NPMRC_PUBLIC_HOIST, PNPM_OVERRIDES, PNPM_PUBLIC_HOIST, addLines, missingLines, pnpmReadsHoist, readWorkspaceList, setWorkspaceBlock } from "../_pnpm-workspace.mjs";

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

const dossier = mkdtempSync(join(tmpdir(), "hv-ws-"));
const ws = join(dossier, "pnpm-workspace.yaml");
try {
  console.log("\nÉcriture d'un bloc");
  const cree = setWorkspaceBlock(ws, "overrides", { postcss: "^8.5.23" });
  verifier("fichier absent : le bloc overrides est créé", cree && readFileSync(ws, "utf8") === 'overrides:\n  postcss: "^8.5.23"\n');
  verifier("même contenu : rien n'est réécrit", setWorkspaceBlock(ws, "overrides", { postcss: "^8.5.23" }) === false);

  console.log("\nCohabitation avec allowBuilds (étape shadcn)");
  setWorkspaceBlock(ws, "allowBuilds", { msw: true, "@tailwindcss/oxide": true });
  const lesDeux = readFileSync(ws, "utf8");
  verifier("overrides conservé après l'écriture d'allowBuilds", /^overrides:\n {2}postcss: "\^8\.5\.23"$/m.test(lesDeux), lesDeux);
  verifier("les noms à barre oblique sont entre guillemets", lesDeux.includes('  "@tailwindcss/oxide": true'));
  setWorkspaceBlock(ws, "allowBuilds", { sharp: true });
  const remplace = readFileSync(ws, "utf8");
  verifier(
    "allowBuilds remplacé en entier, sans doublon",
    (remplace.match(/^allowBuilds:/gm) || []).length === 1 && !remplace.includes("msw") && remplace.includes("  sharp: true"),
    remplace,
  );
  verifier("overrides toujours là", remplace.includes('  postcss: "^8.5.23"'));

  console.log("\nFichier déjà écrit par pnpm (fins de ligne Windows, commentaire, autre bloc)");
  writeFileSync(ws, "# écrit par pnpm\r\nallowBuilds:\r\n  esbuild: set this to true or false\r\n\r\npackages:\r\n  - apps/*\r\n");
  setWorkspaceBlock(ws, "overrides", PNPM_OVERRIDES);
  const existant = readFileSync(ws, "utf8");
  verifier(
    "commentaire et autres blocs conservés",
    existant.includes("# écrit par pnpm") && existant.includes("  esbuild: set this to true or false") && existant.includes("  - apps/*"),
    existant,
  );
  verifier("overrides ajouté", existant.includes(`overrides:\n  postcss: "${PNPM_OVERRIDES.postcss}"`));

  console.log("\nUn bloc en liste (publicHoistPattern, 3.4.5)");
  verifier("absent : la lecture dit null, jamais une liste vide", readWorkspaceList(ws, "publicHoistPattern") === null);
  setWorkspaceBlock(ws, "publicHoistPattern", PNPM_PUBLIC_HOIST);
  const liste = readFileSync(ws, "utf8");
  verifier("écrit en liste, chaque motif entre guillemets", liste.includes('publicHoistPattern:\n  - "*eslint*"\n  - "*prettier*"'), liste);
  verifier("relu tel qu'écrit", JSON.stringify(readWorkspaceList(ws, "publicHoistPattern")) === JSON.stringify(PNPM_PUBLIC_HOIST));
  verifier("les autres blocs sont gardés", liste.includes(`overrides:\n  postcss: "${PNPM_OVERRIDES.postcss}"`) && liste.includes("  - apps/*"), liste);
  verifier("même liste : rien n'est réécrit", setWorkspaceBlock(ws, "publicHoistPattern", PNPM_PUBLIC_HOIST) === false);
  verifier("la liste d'un autre bloc se lit aussi (packages)", JSON.stringify(readWorkspaceList(ws, "packages")) === JSON.stringify(["apps/*"]));

  console.log("\nLes mêmes motifs dans .npmrc, pour un ancien pnpm 10 (3.4.6)");
  verifier("deux lignes, au format de .npmrc", JSON.stringify(NPMRC_PUBLIC_HOIST) === JSON.stringify(["public-hoist-pattern[]=*eslint*", "public-hoist-pattern[]=*prettier*"]));
  const rc = join(dossier, ".npmrc");
  verifier("absent : toutes les lignes manquent", missingLines(rc, NPMRC_PUBLIC_HOIST).length === 2);
  writeFileSync(rc, "# commentaire\r\nstrict-dep-builds=false");
  verifier("ajoutées à la fin, sans fin de ligne finale au départ", addLines(rc, NPMRC_PUBLIC_HOIST) === true);
  verifier("... les autres lignes et les fins de ligne du fichier gardées", readFileSync(rc, "utf8") === "# commentaire\r\nstrict-dep-builds=false\r\npublic-hoist-pattern[]=*eslint*\r\npublic-hoist-pattern[]=*prettier*\r\n", JSON.stringify(readFileSync(rc, "utf8")));
  verifier("déjà là : rien n'est réécrit", addLines(rc, NPMRC_PUBLIC_HOIST) === false && missingLines(rc, NPMRC_PUBLIC_HOIST).length === 0);

  console.log("\npnpm, interrogé dans le projet (réponses relevées le 06/10/2026)");
  const repond = (stdout, status = 0) => ({ ask: () => ({ status, stdout }) });
  verifier("pnpm 10.4.1 ou 10.5.2, bloc seul : « undefined », il ne le lit pas", pnpmReadsHoist(dossier, repond("undefined\n")) === false);
  verifier("pnpm 10.4.1 avec .npmrc : la liste séparée par des virgules", pnpmReadsHoist(dossier, repond("*eslint*,*prettier*\n")) === true);
  verifier("pnpm 10.28.0 : un avertissement, puis la liste", pnpmReadsHoist(dossier, repond("WARN  `pnpm config get` would display an array as comma-separated list due to legacy implementation, use `--json` to print them as json\n*eslint*,*prettier*\n")) === true);
  verifier("pnpm 11.1.1 : la liste en JSON", pnpmReadsHoist(dossier, repond('[\n  "*eslint*",\n  "*prettier*"\n]\n')) === true);
  verifier("un seul des deux motifs : pas lu", pnpmReadsHoist(dossier, repond("*eslint*\n")) === false);
  verifier("pnpm introuvable ou en échec : on ne sait pas (null), jamais « lu »", pnpmReadsHoist(dossier, repond("", 1)) === null);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

console.log("\nLe plancher postcss");
const plancher = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/.exec(PNPM_OVERRIDES.postcss ?? "");
const auMoins = (v, [a, b, c]) => v[0] > a || (v[0] === a && (v[1] > b || (v[1] === b && v[2] >= c)));
verifier(
  "PNPM_OVERRIDES.postcss vaut au moins 8.5.23 (dernier avis corrigé)",
  plancher && auMoins(plancher.slice(1).map(Number), [8, 5, 23]),
  PNPM_OVERRIDES.postcss,
);

console.log("\nbootstrap-init.mjs");
const boot = readFileSync(join(RACINE, "scripts", "bootstrap-init.mjs"), "utf8");
const iOverrides = boot.indexOf('setWorkspaceBlock(join(PROJECT_DIR, "pnpm-workspace.yaml"), "overrides", PNPM_OVERRIDES)');
const iInstall = boot.indexOf("run(`pnpm install");
verifier("les overrides sont posés avant le premier pnpm install", iOverrides > 0 && iInstall > 0 && iOverrides < iInstall);
verifier(
  "l'étape shadcn ne réécrit plus que son bloc allowBuilds",
  !/writeFileSync\(wsPath, newWs\)/.test(boot) && /setWorkspaceBlock\(wsPath, "allowBuilds"/.test(boot),
);
verifier("aucun override dans package.json", !/pkg\.pnpm\.overrides/.test(boot));
const iHoist = boot.indexOf('setWorkspaceBlock(join(PROJECT_DIR, "pnpm-workspace.yaml"), "publicHoistPattern", PNPM_PUBLIC_HOIST)');
verifier("les greffons d'ESLint remontent à la racine : le bloc est posé avant le premier pnpm install", iHoist > 0 && iHoist < iInstall);
verifier("... et il porte *eslint* et *prettier* (ce que pnpm 9 faisait seul)", PNPM_PUBLIC_HOIST.includes("*eslint*") && PNPM_PUBLIC_HOIST.includes("*prettier*"));
const iAsk = boot.indexOf("const npmrcHoist = pnpmReadsHoist(PROJECT_DIR) !== true;");
const iRcBefore = boot.indexOf('if (npmrcHoist) addLines(join(PROJECT_DIR, ".npmrc"), NPMRC_PUBLIC_HOIST);');
verifier("pnpm interrogé dans le projet après le bloc, et .npmrc complété avant le premier pnpm install là où il ne le lit pas (3.4.6)", iHoist < iAsk && iAsk < iRcBefore && iRcBefore > 0 && iRcBefore < iInstall);
const iWriter = boot.indexOf("writeFileSync(\n    npmrcPath,");
const iRcAfter = boot.indexOf("if (npmrcHoist) addLines(npmrcPath, NPMRC_PUBLIC_HOIST);");
verifier("... et remis après l'écriture de .npmrc qui suit l'installation, qui remplace le fichier", iWriter > iInstall && iRcAfter > iWriter);

console.log(`\n${total - echecs}/${total} vérifications passent`);
if (echecs) process.exit(1);
