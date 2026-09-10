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
import { PNPM_OVERRIDES, setWorkspaceBlock } from "../_pnpm-workspace.mjs";

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

console.log(`\n${total - echecs}/${total} vérifications passent`);
if (echecs) process.exit(1);
