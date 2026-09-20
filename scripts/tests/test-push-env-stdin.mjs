#!/usr/bin/env node
// test-push-env-stdin.mjs - push-env-vars.mjs --stdin: a secret reaches the helper without
// ever sitting in a process argument, and setup-db.mjs uses it for the connection string.
//
// No network: the temporary project is not linked to any hosting, so the helper stops after
// writing the local .env (its documented behaviour).
//
//   node scripts/tests/test-push-env-stdin.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER = join(ROOT, "scripts", "push-env-vars.mjs");
const SECRET = "motdepasse-qui-ne-doit-jamais-sortir";
const CONN = `postgres://app:${SECRET}@ep-essai.eu-central-1.aws.neon.tech/app?sslmode=require&channel_binding=require`;

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${detail})`}`);
}

function push(args, input) {
  const dir = mkdtempSync(join(tmpdir(), "hv-push-env-"));
  writeFileSync(join(dir, ".env"), "AUTRE=1\nDATABASE_URL=ancienne\n");
  const r = spawnSync(process.execPath, [HELPER, ...args], { cwd: dir, input, encoding: "utf8" });
  const env = readFileSync(join(dir, ".env"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { r, env };
}

console.log("── Une valeur par l'entree standard ──");
{
  const { r, env } = push(["--stdin"], `DATABASE_URL=${CONN}\n`);
  check("exit 0 (projet non relie : ecriture locale seule)", r.status === 0, `exit ${r.status} ${r.stderr}`);
  check("la valeur est dans .env, entiere (?, & et = compris)", env.includes(`DATABASE_URL=${CONN}\n`));
  check("l'ancienne valeur est remplacee, pas doublee", (env.match(/^DATABASE_URL=/gm) || []).length === 1);
  check("les autres variables ne bougent pas", env.includes("AUTRE=1"));
  check("la valeur n'est jamais affichee", !(r.stdout + r.stderr).includes(SECRET));
}

console.log("\n── Arguments et entree standard ensemble, fins de ligne Windows ──");
{
  const { r, env } = push(["--stdin", "PUBLIQUE=oui"], `A=1\r\nB=deux mots\r\n\r\n`);
  check("exit 0", r.status === 0, `exit ${r.status}`);
  check("les trois variables sont ecrites, sans retour chariot", /^A=1$/m.test(env) && /^B=deux mots$/m.test(env) && /^PUBLIQUE=oui$/m.test(env));
}

console.log("\n── Une ligne qui n'est pas KEY=VALUE est refusee sans etre repetee ──");
{
  const { r, env } = push(["--stdin"], `${SECRET}\n`);
  check("exit 1", r.status === 1, `exit ${r.status}`);
  check("le refus ne repete pas la ligne (elle peut etre un morceau de secret)", !(r.stdout + r.stderr).includes(SECRET));
  check(".env n'a pas bouge", env === "AUTRE=1\nDATABASE_URL=ancienne\n");
}
{
  const { r } = push(["--stdin"], "");
  check("entree vide : exit 1, rien a pousser", r.status === 1);
}

console.log("\n── setup-db.mjs ──");
{
  const src = readFileSync(join(ROOT, "scripts", "setup-db.mjs"), "utf8");
  check("la chaine ne passe plus en argument de l'aide", !/\[helper,\s*`DATABASE_URL=/.test(src));
  check("elle passe par l'entree standard", /\[helper,\s*"--stdin"\]/.test(src) && /input:\s*`DATABASE_URL=\$\{state\.connectionUri\}/.test(src));
  const echecs = src.split("fail(").slice(1).map((bloc) => bloc.slice(0, bloc.indexOf(");")));
  check("aucun message d'echec ne contient la chaine", echecs.every((bloc) => !bloc.includes("connectionUri")), "un fail() cite connectionUri");
  check("un coffre verrouille est dit comme tel", /VAULT_LOCKED/.test(src));
  check("la region repondue par le fournisseur va au manifeste", /region=\$\{state\.region\}/.test(src));
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
