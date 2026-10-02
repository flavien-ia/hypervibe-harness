#!/usr/bin/env node
// test-push-env-remove.mjs - push-env-vars.mjs : l'aide, le retrait outillé d'une variable, et le
// rappel qu'une valeur déjà connue de l'hébergeur ne compte qu'au prochain déploiement.
//
// Le script est lancé pour de vrai, dans un dossier temporaire, face à un faux serveur d'API sur
// 127.0.0.1 (HYPERVIBE_VERCEL_API n'accepte que la boucle locale) et un jeton de recette. Aucun
// réseau au-delà, aucun compte, aucun coffre.
//
//   node scripts/tests/test-push-env-remove.mjs

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER = join(ROOT, "scripts", "push-env-vars.mjs");
const JETON = "jeton-de-recette";
const DEPART = "AUTRE=1\nA_RETIRER=ancienne\nB_RETIRER=aussi\nGARDEE=oui\n";

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 500)})`}`);
}

// ── le faux hébergeur : les variables d'un projet, et ce qui lui a été demandé ──
let envs = [];
let appels = [];
let prochainId = 1;
const serveur = createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://127.0.0.1");
    appels.push({ methode: req.method, chemin: u.pathname, corps: corps ? JSON.parse(corps) : null });
    const rendre = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${JETON}`) return rendre(401, { error: { message: "Not authorized" } });
    const un = /^\/v9\/projects\/prj_recette\/env\/([^/]+)$/.exec(u.pathname);
    if (req.method === "GET" && u.pathname === "/v10/projects/prj_recette/env") return rendre(200, { envs });
    if (req.method === "POST" && u.pathname === "/v10/projects/prj_recette/env") {
      const b = JSON.parse(corps);
      envs.push({ id: `env_${prochainId++}`, key: b.key, target: b.target, type: b.type });
      return rendre(200, { created: true });
    }
    if (un && req.method === "DELETE") {
      envs = envs.filter((e) => e.id !== un[1]);
      return rendre(200, {});
    }
    if (un && req.method === "PATCH") {
      const e = envs.find((x) => x.id === un[1]);
      if (e) e.target = JSON.parse(corps).target;
      return rendre(200, {});
    }
    return rendre(404, { error: { message: "no route" } });
  });
});
await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
const API = `http://127.0.0.1:${serveur.address().port}`;

/** Un lancement du script dans un dossier neuf. `lie` : le dossier est relié à l'hébergeur. */
function lancer(args, { lie = false, depart = DEPART, hebergeur = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hv-push-env-"));
  if (depart !== null) writeFileSync(join(dir, ".env"), depart);
  if (lie) {
    mkdirSync(join(dir, ".vercel"));
    writeFileSync(join(dir, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_recette", orgId: "team_recette" }));
  }
  envs = hebergeur.map((e, i) => ({ id: `env_depart_${i}`, ...e }));
  appels = [];
  // Le dossier de données de la CLI est vide : seul le jeton de l'environnement existe.
  const env = { ...process.env, HYPERVIBE_VERCEL_API: API, VERCEL_TOKEN: JETON, APPDATA: join(dir, "donnees"), HOME: join(dir, "donnees"), USERPROFILE: join(dir, "donnees"), XDG_DATA_HOME: join(dir, "donnees") };
  return new Promise((fini) => {
    const p = spawn(process.execPath, [HELPER, ...args], { cwd: dir, env });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      const local = existsSync(join(dir, ".env")) ? readFileSync(join(dir, ".env"), "utf8") : null;
      const ignore = existsSync(join(dir, ".gitignore"));
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      fini({ code, stdout, stderr, sortie: stdout + stderr, local, ignore, appels: [...appels], envs: envs.map((e) => ({ key: e.key, target: [...e.target] })) });
    });
  });
}
const dit = (r) => `code ${r.code} | ${r.sortie.slice(-300)} | ${JSON.stringify(r.envs)}`;

// ── la fausse CLI, pour le chemin de repli (aucun jeton lisible) : elle note ce qu'on lui
// demande, et répond selon FAUSSE_CLI_MODE comme la vraie le fait ──
const outils = mkdtempSync(join(tmpdir(), "hv-push-env-cli-"));
const fausseCli = join(outils, "fausse-cli.mjs");
writeFileSync(
  fausseCli,
  [
    "import { appendFileSync } from 'node:fs';",
    "appendFileSync(process.env.FAUSSE_CLI_JOURNAL, process.argv.slice(2).join(' ') + '\\n');",
    "const mode = process.env.FAUSSE_CLI_MODE;",
    "if (mode === 'absente') { console.error('Error: Environment Variable was not found.'); process.exit(1); }",
    "if (mode === 'projet') { console.error('Error: Project not found.'); process.exit(1); }",
    "console.log('Removed Environment Variable');",
    "",
  ].join("\n"),
);
const bin = join(outils, "bin");
mkdirSync(bin);
if (process.platform === "win32") {
  writeFileSync(join(bin, "vercel.cmd"), `@echo off\r\n"${process.execPath}" "${fausseCli}" %*\r\n`);
} else {
  writeFileSync(join(bin, "vercel"), `#!/bin/sh\nexec "${process.execPath}" "${fausseCli}" "$@"\n`);
  chmodSync(join(bin, "vercel"), 0o755);
}
const cleChemin = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";

/** Un retrait sans aucun jeton : le script passe par la CLI (la fausse, en tête du PATH). */
function lancerParCli(args, mode) {
  const dir = mkdtempSync(join(tmpdir(), "hv-push-env-"));
  writeFileSync(join(dir, ".env"), DEPART);
  mkdirSync(join(dir, ".vercel"));
  writeFileSync(join(dir, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_recette", orgId: "team_recette" }));
  const journal = join(dir, "cli.log");
  writeFileSync(journal, "");
  const env = { ...process.env, [cleChemin]: `${bin}${delimiter}${process.env[cleChemin] || ""}`, HYPERVIBE_VERCEL_API: API, FAUSSE_CLI_MODE: mode, FAUSSE_CLI_JOURNAL: journal, APPDATA: join(dir, "donnees"), HOME: join(dir, "donnees"), USERPROFILE: join(dir, "donnees"), XDG_DATA_HOME: join(dir, "donnees") };
  delete env.VERCEL_TOKEN;
  appels = [];
  return new Promise((fini) => {
    const p = spawn(process.execPath, [HELPER, ...args], { cwd: dir, env });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      const local = readFileSync(join(dir, ".env"), "utf8");
      const demandes = readFileSync(journal, "utf8").split("\n").filter(Boolean);
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      fini({ code, stdout, stderr, sortie: stdout + stderr, local, demandes, appels: [...appels], envs: [] });
    });
  });
}

try {
  console.log("── L'aide ──");
  let r = await lancer(["--help"]);
  check("--help : l'usage complet, code 0, rien d'écrit", r.code === 0 && /--remove KEY/.test(r.stdout) && /--target=<envs>/.test(r.stdout) && /--no-local/.test(r.stdout) && r.local === DEPART && r.appels.length === 0, dit(r));
  r = await lancer(["-h"]);
  check("-h de même (il était pris pour une paire KEY=VALUE mal formée)", r.code === 0 && /Usage:/.test(r.stdout) && !/Invalid arg/.test(r.sortie), dit(r));

  console.log("\n── Retirer, sans hébergeur relié ──");
  r = await lancer(["--remove", "A_RETIRER", "B_RETIRER"]);
  check("les deux lignes quittent le .env, les autres ne bougent pas, code 0", r.code === 0 && r.local === "AUTRE=1\nGARDEE=oui\n", `${r.code} ${JSON.stringify(r.local)}`);
  check("... et un retrait ne crée ni .gitignore ni .env", r.ignore === false);
  r = await lancer(["--remove", "ABSENTE"]);
  check("une variable qui n'y est pas : rien n'est réécrit, code 0, et aucun « retiré » n'est annoncé", r.code === 0 && r.local === DEPART && /Nothing to remove/.test(r.sortie) && /Nothing removed: ABSENTE is not in the local \.env/.test(r.sortie) && !/✅ Removed/.test(r.sortie), dit(r));
  r = await lancer(["--remove", "A_RETIRER"], { depart: null });
  check("sans .env : rien n'est créé", r.code === 0 && r.local === null, dit(r));
  r = await lancer(["--remove", "A_RETIRER", "--no-local"]);
  check("--no-local sans hébergeur relié : rien n'est retiré nulle part, jamais un succès", r.code === 1 && r.local === DEPART && /Nothing removed/.test(r.sortie), dit(r));

  console.log("\n── Ce qu'un retrait refuse ──");
  r = await lancer(["--remove", "A_RETIRER=valeur"]);
  check("une paire KEY=VALUE avec --remove : refusée, rien ne bouge (un retrait et un envoi sont deux commandes)", r.code === 1 && r.local === DEPART && /never KEY=VALUE/.test(r.sortie), dit(r));
  r = await lancer(["--remove"]);
  check("--remove sans nom : refusé", r.code === 1 && r.local === DEPART, dit(r));
  r = await lancer(["--remove", "A_RETIRER", "--stdin"]);
  check("--remove avec --stdin : refusé, rien ne bouge", r.code === 1 && r.local === DEPART, dit(r));
  r = await lancer(["--remove", "pas-un-nom"]);
  check("un nom qui n'en est pas un : refusé", r.code === 1 && r.local === DEPART, dit(r));

  console.log("\n── Retirer chez l'hébergeur ──");
  const chez = [
    { key: "A_RETIRER", target: ["production", "preview"] },
    { key: "A_RETIRER", target: ["development"] },
    { key: "GARDEE", target: ["production", "preview"] },
  ];
  r = await lancer(["--remove", "A_RETIRER"], { lie: true, hebergeur: chez });
  check("la variable quitte tous les environnements de l'hébergeur et le .env ; la voisine reste", r.code === 0 && JSON.stringify(r.envs) === JSON.stringify([{ key: "GARDEE", target: ["production", "preview"] }]) && r.local === "AUTRE=1\nB_RETIRER=aussi\nGARDEE=oui\n", dit(r));
  check("... rien n'est créé chez l'hébergeur (aucune valeur n'est envoyée)", !r.appels.some((a) => a.methode === "POST"), JSON.stringify(r.appels.map((a) => a.methode)));
  check("... et la dernière ligne dit que le déploiement en ligne la garde jusqu'au prochain", /until the NEXT deployment/.test(r.stdout), r.stdout.slice(-300));

  r = await lancer(["--remove", "A_RETIRER", "--target=preview"], { lie: true, hebergeur: chez });
  check("--target=preview : seule la préversion la perd, la production la garde", r.code === 0 && JSON.stringify(r.envs) === JSON.stringify([{ key: "A_RETIRER", target: ["production"] }, { key: "A_RETIRER", target: ["development"] }, { key: "GARDEE", target: ["production", "preview"] }]), dit(r));
  check("... et le .env de la machine garde sa ligne : « retire-la de la préversion » ne casse pas le poste", r.local === DEPART && /the local \.env is left as it is/.test(r.stdout) && /from Vercel \(preview\)/.test(r.stdout), dit(r));
  r = await lancer(["--remove", "A_RETIRER", "--target=preview"]);
  check("--remove avec --target sans hébergeur relié : rien n'est retiré nulle part, jamais un succès", r.code === 1 && r.local === DEPART && /Nothing removed/.test(r.sortie), dit(r));

  r = await lancer(["--remove", "INCONNUE"], { lie: true, hebergeur: chez });
  check("une variable inconnue de l'hébergeur : un succès, dit tel, sans promettre de prochain déploiement", r.code === 0 && /was not there/.test(r.stdout) && !/NEXT deployment/.test(r.stdout) && r.envs.length === 3, dit(r));

  r = await lancer(["--remove", "A_RETIRER", "--no-local"], { lie: true, hebergeur: chez });
  check("--no-local : l'hébergeur la perd, le .env la garde", r.code === 0 && !r.envs.some((e) => e.key === "A_RETIRER") && r.local === DEPART, dit(r));

  console.log("\n── Retirer sans jeton : le repli par la ligne de commande ──");
  r = await lancerParCli(["--remove", "A_RETIRER"], "ok");
  check("sans jeton, le retrait passe par la CLI, un environnement à la fois, et réussit", r.code === 0 && r.demandes.length === 3 && r.demandes.every((d) => /^env rm A_RETIRER (production|preview|development) --yes$/.test(d)) && r.appels.length === 0 && /until the NEXT deployment/.test(r.stdout), `${dit(r)} | ${r.demandes.join(" ; ")}`);
  r = await lancerParCli(["--remove", "A_RETIRER"], "absente");
  check("... une variable que la CLI dit introuvable : un succès, dit « was not there »", r.code === 0 && /was not there/.test(r.stdout) && !/NEXT deployment/.test(r.stdout), dit(r));
  r = await lancerParCli(["--remove", "A_RETIRER"], "projet");
  check("... un projet introuvable n'est JAMAIS pris pour une variable déjà partie : échec, code 1", r.code === 1 && /Project not found/.test(r.sortie) && !/was not there/.test(r.stdout), dit(r));

  console.log("\n── Envoyer : ce qui ne compte qu'au prochain déploiement ──");
  r = await lancer(["GARDEE=nouvelle"], { lie: true, hebergeur: chez });
  check("une valeur qui en remplace une chez l'hébergeur : la dernière ligne dit qu'elle compte au prochain déploiement", r.code === 0 && /already had a value/.test(r.stdout) && /NEXT deployment/.test(r.stdout) && r.envs.filter((e) => e.key === "GARDEE").length === 1, dit(r));
  r = await lancer(["NEUVE=1"], { lie: true, hebergeur: chez });
  check("une variable neuve : rien à rappeler", r.code === 0 && !/NEXT deployment/.test(r.stdout) && r.envs.some((e) => e.key === "NEUVE"), dit(r));
  r = await lancer(["GARDEE=locale", "--no-local", "--target=production,preview"], { lie: true, hebergeur: chez });
  check("--no-local --target=production,preview : l'hébergeur prend la valeur, le .env garde la sienne, et le compte rendu ne dit pas « .env »", r.code === 0 && r.local === DEPART && /to Vercel \(production, preview\)/.test(r.stdout), dit(r));
} finally {
  rmSync(outils, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  serveur.closeAllConnections?.();
  await new Promise((ok) => serveur.close(() => ok()));
}

console.log(`\n${checks - failures}/${checks} verifications`);
process.exitCode = failures ? 1 : 0;
