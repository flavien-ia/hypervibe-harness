#!/usr/bin/env node
// test-check-deploy.mjs - L'attente d'un déploiement (scripts/vercel/check-deploy.mjs), lancée
// pour de vrai face à un faux serveur d'API sur 127.0.0.1 et une fausse CLI en tête du PATH.
//
// Deux comportements tenus ici :
//   - un jeton refusé (401) : la CLI est sollicitée UNE fois (`vercel whoami`), le jeton est relu,
//     l'appel rejoué ; ce n'est qu'au second refus que le script renonce (--sha) ou se replie sur
//     `vercel ls`. Un jeton donné par l'environnement n'est jamais renouvelé par la CLI ;
//   - depuis un worktree git, le lien du dépôt principal est lu (`.vercel/project.json` n'est pas
//     versionné), y compris pour l'application d'un monorepo.
//
// Aucun réseau hors de la boucle locale, aucun compte, aucun coffre.
//
//   node scripts/tests/test-check-deploy.mjs

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCliDataDirCandidates } from "../_vercel-auth.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(ICI, "..", "vercel", "check-deploy.mjs");
const BON = "jeton-vivant-de-recette";
const MORT = "jeton-mort-de-recette";
const SHA = "0123456789abcdef0123456789abcdef01234567";

let verifications = 0;
let echecs = 0;
function verifier(nom, ok, detail = "") {
  verifications += 1;
  if (!ok) echecs += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${nom}${ok || !detail ? "" : `   (${String(detail).slice(0, 500)})`}`);
}

const racine = mkdtempSync(join(tmpdir(), "hv-check-deploy-"));
const donnees = join(racine, "donnees");
const etat = join(racine, "etat-cli.json");

// ── la fausse CLI : `whoami` renouvelle (ou non) le jeton, `ls` rend la table ──
const fausseCli = join(racine, "fausse-cli.mjs");
writeFileSync(
  fausseCli,
  [
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'import { dirname } from "node:path";',
    "const etat = JSON.parse(readFileSync(process.env.FAUSSE_CLI_ETAT, 'utf8'));",
    "const [a0] = process.argv.slice(2);",
    "etat.appels.push(a0);",
    "writeFileSync(process.env.FAUSSE_CLI_ETAT, JSON.stringify(etat));",
    'if (a0 === "whoami") {',
    '  if (etat.whoami === "echec") { console.error("Error: not signed in"); process.exit(1); }',
    '  if (etat.whoami === "renouvelle" || etat.whoami === "meme") {',
    "    mkdirSync(dirname(etat.fichierJeton), { recursive: true });",
    '    writeFileSync(etat.fichierJeton, JSON.stringify({ token: etat.whoami === "renouvelle" ? etat.bon : etat.mort }));',
    "  }",
    '  console.log("recette");',
    "  process.exit(0);",
    "}",
    'if (a0 === "ls") {',
    '  console.error("  Age     Project     Deployment                          Status      Environment     Duration     Username");',
    '  console.error("  2m      monapp      https://monapp-abc123.vercel.app    ● Ready     Production      31s          recette");',
    '  console.log("https://monapp-abc123.vercel.app");',
    "  process.exit(0);",
    "}",
    "process.exit(1);",
    "",
  ].join("\n"),
  "utf8",
);
const bin = join(racine, "bin");
mkdirSync(bin, { recursive: true });
if (process.platform === "win32") {
  writeFileSync(join(bin, "vercel.cmd"), `@echo off\r\n"${process.execPath}" "${fausseCli}" %*\r\n`);
} else {
  writeFileSync(join(bin, "vercel"), `#!/bin/sh\nexec "${process.execPath}" "${fausseCli}" "$@"\n`);
  chmodSync(join(bin, "vercel"), 0o755);
}

// ── le faux serveur d'API : un déploiement prêt, pour qui présente le bon jeton ──
let appelsApi = [];
const serveur = createServer((req, res) => {
  appelsApi.push({ chemin: req.url, jeton: req.headers.authorization ?? null });
  if (req.headers.authorization !== `Bearer ${BON}`) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { code: "forbidden", message: "Not authorized" } }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ deployments: [{ uid: "dpl_recette", url: "monapp-abc123.vercel.app", state: "READY", target: "production", created: Date.now(), meta: { githubCommitSha: SHA } }] }));
});
await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
const API = `http://127.0.0.1:${serveur.address().port}`;

// Le dossier où la CLI garde son jeton, tel que le script le cherche sur ce système.
const cleChemin = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
const envDeBase = { ...process.env, APPDATA: donnees, HOME: donnees, USERPROFILE: donnees, XDG_DATA_HOME: donnees };
const fichierJeton = (() => {
  const garde = { APPDATA: process.env.APPDATA, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
  Object.assign(process.env, { APPDATA: donnees, HOME: donnees, USERPROFILE: donnees, XDG_DATA_HOME: donnees });
  try {
    return join(getCliDataDirCandidates()[0], "auth.json");
  } finally {
    for (const [k, v] of Object.entries(garde)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
})();

function poserJeton(valeur) {
  rmSync(dirname(fichierJeton), { recursive: true, force: true });
  if (valeur === null) return;
  mkdirSync(dirname(fichierJeton), { recursive: true });
  writeFileSync(fichierJeton, JSON.stringify({ token: valeur }));
}

/** Un lancement du script, tel qu'une skill le lance. */
function lancer(dossier, { jeton = BON, whoami = "echec", extra = [], env = {} } = {}) {
  poserJeton(jeton);
  appelsApi = [];
  writeFileSync(etat, JSON.stringify({ appels: [], whoami, fichierJeton, bon: BON, mort: MORT }));
  const e = { ...envDeBase, [cleChemin]: `${bin}${delimiter}${process.env[cleChemin] || ""}`, HYPERVIBE_VERCEL_API: API, FAUSSE_CLI_ETAT: etat, ...env };
  if (!("VERCEL_TOKEN" in env)) delete e.VERCEL_TOKEN;
  return new Promise((fini) => {
    const p = spawn(process.execPath, [SCRIPT, "--project-dir", dossier, "--timeout", "20", "--interval", "1", ...extra], { env: e });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = null;
      }
      fini({ code, json, stdout, stderr, appelsCli: JSON.parse(readFileSync(etat, "utf8")).appels, appelsApi: [...appelsApi] });
    });
  });
}
const dit = (r) => `code ${r.code} | ${JSON.stringify(r.json)} | cli ${r.appelsCli.join(",")} | api ${r.appelsApi.length} | ${r.stderr.slice(-200)}`;

try {
  // ── un projet lié ───────────────────────────────────────────────────────────
  const projet = join(racine, "projet");
  mkdirSync(join(projet, ".vercel"), { recursive: true });
  writeFileSync(join(projet, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_recette", orgId: "team_recette" }));

  console.log("── Le jeton de la CLI ──");
  let r = await lancer(projet, { extra: ["--sha", SHA] });
  verifier("un jeton vivant : le déploiement de CE commit est lu par l'API, sans solliciter la CLI", r.code === 0 && r.json?.status === "ready" && r.json.method === "rest" && r.json.deployment?.commitSha === SHA && r.json.note === undefined && r.appelsCli.length === 0, dit(r));

  r = await lancer(projet, { jeton: MORT, whoami: "renouvelle", extra: ["--sha", SHA] });
  verifier("un jeton refusé, que la CLI renouvelle : `vercel whoami` une fois, le jeton relu, l'appel rejoué, prêt", r.code === 0 && r.json?.status === "ready" && r.json.method === "rest" && JSON.stringify(r.appelsCli) === '["whoami"]' && r.appelsApi.length === 2 && r.appelsApi[1].jeton === `Bearer ${BON}`, dit(r));
  verifier("... et la réponse le dit", /token refreshed via vercel whoami/.test(r.json?.note ?? ""), dit(r));

  r = await lancer(projet, { jeton: null, whoami: "renouvelle", extra: ["--sha", SHA] });
  verifier("aucun jeton gardé, une CLI connectée : elle est sollicitée une fois avant de conclure, et l'API répond", r.code === 0 && r.json?.status === "ready" && JSON.stringify(r.appelsCli) === '["whoami"]' && /token refreshed via vercel whoami/.test(r.json.note ?? ""), dit(r));

  r = await lancer(projet, { jeton: MORT, whoami: "echec", extra: ["--sha", SHA] });
  verifier("un jeton refusé, une CLI qui ne peut pas le renouveler, avec --sha : non configuré (3), après UN seul essai", r.code === 3 && r.json?.status === "not-configured" && JSON.stringify(r.appelsCli) === '["whoami"]' && r.appelsApi.length === 1, dit(r));

  r = await lancer(projet, { jeton: MORT, whoami: "meme", extra: ["--sha", SHA] });
  verifier("une CLI qui rend le MÊME jeton : pas de second appel inutile, non configuré (3)", r.code === 3 && r.json?.status === "not-configured" && JSON.stringify(r.appelsCli) === '["whoami"]' && r.appelsApi.length === 1, dit(r));

  r = await lancer(projet, { jeton: MORT, whoami: "echec" });
  verifier("sans --sha, le même refus se replie sur la table de la CLI, et le dit", r.code === 0 && r.json?.status === "ready" && r.json.method === "cli" && JSON.stringify(r.appelsCli) === '["whoami","ls"]' && /REST token expired/.test(r.json.note ?? ""), dit(r));

  r = await lancer(projet, { jeton: BON, whoami: "renouvelle", extra: ["--sha", SHA], env: { VERCEL_TOKEN: MORT } });
  verifier("un jeton donné par l'environnement et refusé : la CLI n'est jamais sollicitée pour lui (il n'est pas le sien)", r.code === 3 && r.appelsCli.length === 0 && r.appelsApi.length === 1 && r.appelsApi[0].jeton === `Bearer ${MORT}`, dit(r));

  // ── un worktree git ─────────────────────────────────────────────────────────
  console.log("\n── Depuis un worktree git ──");
  const git = (dossier, ...args) => spawnSync("git", ["-c", "user.name=Recette", "-c", "user.email=recette@exemple.fr", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dossier, encoding: "utf8" });
  const principal = join(racine, "depot");
  mkdirSync(join(principal, "apps", "web", ".vercel"), { recursive: true });
  mkdirSync(join(principal, ".vercel"), { recursive: true });
  writeFileSync(join(principal, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_racine", orgId: "team_recette" }));
  writeFileSync(join(principal, "apps", "web", ".vercel", "project.json"), JSON.stringify({ projectId: "prj_web", orgId: "team_recette" }));
  writeFileSync(join(principal, ".gitignore"), ".vercel\n");
  writeFileSync(join(principal, "apps", "web", "page.txt"), "une page\n");
  git(principal, "init", "-q");
  git(principal, "add", ".gitignore", "apps/web/page.txt");
  const c = git(principal, "commit", "-q", "-m", "depart");
  const arbre = join(racine, "arbre");
  const w = git(principal, "worktree", "add", "-q", arbre, "-b", "essai");
  if (c.status !== 0 || w.status !== 0 || !existsSync(join(arbre, "apps", "web", "page.txt"))) {
    verifier("le worktree d'essai est créé", false, `${c.stderr} ${w.stderr}`);
  } else {
    verifier("le worktree ne porte pas le lien (le fichier n'est pas versionné)", !existsSync(join(arbre, ".vercel", "project.json")) && !existsSync(join(arbre, "apps", "web", ".vercel", "project.json")));
    r = await lancer(arbre, { extra: ["--sha", SHA] });
    verifier("depuis le worktree : le lien du dépôt principal est lu, le déploiement trouvé, et la réponse dit d'où vient le lien", r.code === 0 && r.json?.status === "ready" && /prj_racine/.test(r.appelsApi[0]?.chemin ?? "") && /main checkout/.test(r.json.note ?? ""), dit(r));
    r = await lancer(join(arbre, "apps", "web"), { extra: ["--sha", SHA] });
    verifier("depuis l'application d'un monorepo, dans le worktree : c'est SON lien qui est lu, au même endroit du dépôt principal", r.code === 0 && r.json?.status === "ready" && /prj_web/.test(r.appelsApi[0]?.chemin ?? ""), dit(r));
    r = await lancer(principal, { extra: ["--sha", SHA] });
    verifier("depuis le dépôt principal, rien ne change : son propre lien, aucune mention du worktree", r.code === 0 && /prj_racine/.test(r.appelsApi[0]?.chemin ?? "") && r.json.note === undefined, dit(r));
  }
  const nu = join(racine, "sans-lien");
  mkdirSync(nu, { recursive: true });
  r = await lancer(nu, { extra: ["--sha", SHA] });
  verifier("un dossier sans lien, hors de tout dépôt : non configuré (3), et le message dit quoi faire depuis un worktree", r.code === 3 && r.json?.status === "not-configured" && /worktree/.test(r.json.reason ?? "") && r.appelsApi.length === 0, dit(r));
} finally {
  serveur.closeAllConnections?.();
  await new Promise((ok) => serveur.close(() => ok()));
  rmSync(racine, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

console.log(`\n${verifications - echecs}/${verifications} verifications`);
process.exitCode = echecs ? 1 : 0;
