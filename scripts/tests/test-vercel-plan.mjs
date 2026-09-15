#!/usr/bin/env node
/**
 * Recette : lire le plan Vercel du projet lié, avant d'encaisser.
 *
 * /add-stripe prévient quand le projet tourne sur le plan gratuit Hobby, que
 * Vercel réserve aux projets non commerciaux. Ce qui peut casser sans bruit :
 * la lecture du lien (.vercel/project.json), le choix de l'adresse d'API
 * (équipe ou compte personnel), et la lecture de la réponse, que la CLI peut
 * faire précéder d'une ligne à elle. Aucun accès réseau : on rejoue des
 * réponses de la forme réelle (relevées le 15/09/2026), et on lance le script
 * sur un dossier non lié, dont le chemin porte un espace, et qui s'arrête avant
 * d'appeler la CLI.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { endpointFor, extractJson, planFrom, readLinkedProject } from "../vercel/plan.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "vercel", "plan.mjs");

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

console.log("\nAdresse d'API selon le lien");
egal("une équipe se lit sur /v2/teams/<id>", endpointFor("team_UCUtAbc"), "/v2/teams/team_UCUtAbc");
egal("un compte personnel se lit sur /v2/user", endpointFor("user_123"), "/v2/user");
egal("sans identifiant, le compte personnel", endpointFor(undefined), "/v2/user");

console.log("\nLecture du plan");
egal("équipe gratuite", planFrom({ slug: "fudu69s-projects", billing: { plan: "hobby" } }), "hobby");
egal("équipe payante", planFrom({ slug: "studio", billing: { plan: "pro" } }), "pro");
egal("compte personnel", planFrom({ user: { billing: { plan: "hobby" } } }), "hobby");
egal("casse et espaces normalisés", planFrom({ billing: { plan: " Pro " } }), "pro");
egal("réponse sans plan", planFrom({ billing: {} }), null);
egal("réponse absente", planFrom(null), null);

console.log("\nSortie de la CLI");
egal(
  "une ligne d'avis avant le JSON ne gêne pas",
  planFrom(extractJson('<claude-code-hint v="1" type="plugin" value="vercel@claude-plugins-official" />\n{"billing":{"plan":"hobby"}}')),
  "hobby",
);
egal("une sortie sans JSON ne donne rien", extractJson("Error: Invalid arguments."), null);
egal("un JSON tronqué ne donne rien", extractJson('{"billing":{"plan":'), null);

const racine = mkdtempSync(join(tmpdir(), "hv-plan-"));
try {
  console.log("\nLien du projet");
  const lie = join(racine, "lie");
  mkdirSync(join(lie, ".vercel"), { recursive: true });
  writeFileSync(join(lie, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_1", orgId: "team_1" }));
  egal("projet lié : orgId lu", readLinkedProject(lie)?.orgId, "team_1");
  const casse = join(racine, "casse");
  mkdirSync(join(casse, ".vercel"), { recursive: true });
  writeFileSync(join(casse, ".vercel", "project.json"), "{pas du json");
  egal("lien illisible : aucun lien", readLinkedProject(casse), null);
  const nu = join(racine, "dossier avec espace");
  mkdirSync(nu);
  egal("dossier non lié : aucun lien", readLinkedProject(nu), null);

  console.log("\nLe script lancé sur un dossier non lié");
  let code = 0;
  let sortie = "";
  try {
    sortie = execFileSync(process.execPath, [SCRIPT, "--project-dir", nu], { encoding: "utf8" });
  } catch (e) {
    code = e.status ?? 1;
    sortie = e.stdout ?? "";
  }
  egal("code de sortie 3 quand le plan est inconnu", code, 3);
  const json = extractJson(sortie);
  egal("une ligne JSON, plan null", json?.plan, null);
  verifier("la raison nomme le lien manquant", /\.vercel\/project\.json/.test(json?.reason ?? ""), json?.reason);
  egal("une seule ligne imprimée", sortie.trim().split("\n").length, 1);
} finally {
  rmSync(racine, { recursive: true, force: true });
}

console.log(`\n${total - echecs}/${total} vérifications passent`);
process.exit(echecs ? 1 : 0);
