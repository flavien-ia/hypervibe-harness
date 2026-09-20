#!/usr/bin/env node
// test-neon-org.mjs - Recette of scripts/neon-org.mjs: which answers are certain, which
// are not.
//
// "Organisation key" is a DETERMINATE answer: every caller then reads the projects with no
// organisation named, in full confidence. A throttled or failing API says nothing of the
// kind, and used to be read that way. No network here: fetch is replaced.
//
//   node scripts/tests/test-neon-org.mjs

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { resolveNeonOrg, resetNeonOrgCache, orgHint } = await import(
  pathToFileURL(join(ROOT, "scripts", "neon-org.mjs")).href
);

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${detail})`}`);
}

const realFetch = globalThis.fetch;
let calls = 0;
function answer(status, body = {}) {
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}
const noVault = () => "";

async function resolved(status, body) {
  resetNeonOrgCache();
  answer(status, body);
  return resolveNeonOrg("cle-de-test", noVault);
}

console.log("── Ce que l'API dit vraiment ──");
{
  const r = await resolved(200, { organizations: [{ id: "org-a", name: "A" }] });
  check("une seule organisation : c'est elle", r.source === "unique" && r.orgId === "org-a");
}
{
  const r = await resolved(200, { organizations: [] });
  check("aucune organisation", r.source === "aucune" && r.orgId === null);
}
{
  const r = await resolved(200, { organizations: [{ id: "org-a", name: "A" }, { id: "org-b", name: "B" }] });
  check("plusieurs : on ne devine jamais", r.source === "ambigu" && r.orgId === null);
}
for (const status of [403, 404]) {
  const r = await resolved(status);
  check(`${status} : le point d'entree est refuse, c'est une cle d'organisation`, r.source === "cle-org");
}

console.log("\n── Ce qui n'est PAS une reponse ──");
for (const status of [401, 408, 429, 500, 502, 503]) {
  const r = await resolved(status);
  check(`${status} : indetermine, jamais "cle d'organisation"`, r.source === "injoignable", r.source);
}
{
  resetNeonOrgCache();
  globalThis.fetch = async () => {
    throw new Error("reseau coupe");
  };
  const r = await resolveNeonOrg("cle-de-test", noVault);
  check("reseau coupe : indetermine", r.source === "injoignable");
}
{
  // Une panne passagere ne se memorise pas : l'appel suivant redemande, et obtient la vraie reponse.
  resetNeonOrgCache();
  answer(503);
  await resolveNeonOrg("cle-de-test", noVault);
  answer(200, { organizations: [{ id: "org-a", name: "A" }] });
  const r = await resolveNeonOrg("cle-de-test", noVault);
  check("apres une panne, l'appel suivant obtient la vraie reponse", r.source === "unique" && r.orgId === "org-a", r.source);
}
{
  // Une reponse certaine, elle, reste memorisee pour la commande en cours.
  resetNeonOrgCache();
  answer(200, { organizations: [{ id: "org-a", name: "A" }] });
  await resolveNeonOrg("cle-de-test", noVault);
  const before = calls;
  await resolveNeonOrg("cle-de-test", noVault);
  check("une reponse certaine n'est demandee qu'une fois", calls === before);
}
{
  resetNeonOrgCache();
  answer(500);
  const r = await resolveNeonOrg("cle-de-test", (item, field) => (item === "NEON" && field === "org_id" ? "org-regle" : ""));
  check("le reglage du coffre gagne sans meme interroger l'API", r.source === "vault" && r.orgId === "org-regle");
}
check("l'indetermine se dit en clair", /indéterminée/.test(orgHint({ orgId: null, source: "injoignable", orgs: [] })));

globalThis.fetch = realFetch;
console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
