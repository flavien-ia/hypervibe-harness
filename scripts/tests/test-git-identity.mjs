#!/usr/bin/env node
// test-git-identity.mjs - The identity that signs this machine's commits is checked, and
// repaired, without ever being shown (scripts/git-identity.mjs).
//
// On 22/09/2026 a machine had an address in user.name and what looked like a password in
// user.email: every commit would have carried it to GitHub. This recette plays the real
// script against a throwaway global git config (GIT_CONFIG_GLOBAL) in throwaway folders:
// the machine's own git config is never read nor written.
//
//   node scripts/tests/test-git-identity.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "git-identity.mjs");

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

const temps = [];
/** A throwaway machine: its global git config holds exactly `identity`. */
function machine(identity) {
  const home = mkdtempSync(join(tmpdir(), "hv-git-identity-"));
  temps.push(home);
  const config = join(home, "gitconfig");
  const lines = Object.entries(identity).map(([k, v]) => `\t${k} = ${v}\n`).join("");
  writeFileSync(config, lines ? `[user]\n${lines}` : "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", HOME: home, USERPROFILE: home };
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: home, env, encoding: "utf8" });
    let json = null;
    try {
      json = JSON.parse(r.stdout.trim().split("\n").pop());
    } catch {
      json = null;
    }
    return { code: r.status, json, out: `${r.stdout}${r.stderr}` };
  };
  return { home, config, env, run, stored: () => readFileSync(config, "utf8") };
}

const SECRET = "motdepasse-S3cret!";

console.log("── Le controle dit la forme, jamais la valeur ──");
{
  const m = machine({ name: "Jean Dupont", email: "jean@exemple.fr" });
  const r = m.run("check");
  check("une identite correcte : rien a reparer", r.code === 0 && r.json?.name === "set" && r.json?.email === "valid" && r.json?.fix === "none" && r.json?.scope === "global", r.out);
  check("la reponse ne contient aucune valeur", !r.out.includes("jean@exemple.fr") && !r.out.includes("Jean Dupont"));
}
{
  const m = machine({ name: "Jean Dupont", email: SECRET });
  const r = m.run("check");
  check("une adresse d'auteur qui n'en est pas une : dite invalide, a reparer", r.json?.email === "invalid" && r.json?.fix === "email" && r.json?.swapped === false, r.out);
  check("la valeur n'apparait pas, meme a son proprietaire", !r.out.includes(SECRET));
}
{
  const m = machine({ name: "jean@exemple.fr", email: SECRET });
  const r = m.run("check");
  check("l'inversion est reconnue (une adresse dans le nom, autre chose dans l'adresse)", r.json?.swapped === true && r.json?.fix === "swap" && r.json?.name === "email-like", r.out);
  check("ni l'une ni l'autre valeur n'apparait", !r.out.includes(SECRET) && !r.out.includes("jean@exemple.fr"));
}
{
  const m = machine({});
  check("rien de configure : les deux a donner", m.run("check").json?.fix === "both");
  const n = machine({ email: "jean@exemple.fr" });
  check("une adresse sans nom : le nom a donner", n.run("check").json?.fix === "name");
}

console.log("\n── La reparation n'ecrit qu'une adresse, et ne repete jamais un refus ──");
{
  const m = machine({ name: "Jean Dupont", email: SECRET });
  const refused = m.run("set", "--email", "Tr0ub4dor&3");
  check("une valeur sans la forme d'une adresse est refusee (code 4)", refused.code === 4 && refused.json?.ok === false, refused.out);
  check("le refus ne la repete pas, et rien n'est ecrit", !refused.out.includes("Tr0ub4dor&3") && m.stored().includes(SECRET) && !m.stored().includes("Tr0ub4dor&3"));
  const fixed = m.run("set", "--email", "jean@exemple.fr");
  check("une adresse est ecrite, et l'identite est alors correcte", fixed.code === 0 && fixed.json?.email === "valid" && fixed.json?.fix === "none" && m.stored().includes("jean@exemple.fr") && !m.stored().includes(SECRET), fixed.out);
  check("la reponse ne contient toujours aucune valeur", !fixed.out.includes("jean@exemple.fr"));
}
{
  const m = machine({ name: "jean@exemple.fr", email: SECRET });
  const fixed = m.run("set", "--email-from-name", "--name", "Jean Dupont");
  check("l'inversion se repare : l'adresse du nom passe dans l'adresse, le vrai nom prend sa place", fixed.code === 0 && fixed.json?.fix === "none" && /name = Jean Dupont/.test(m.stored()) && /email = jean@exemple\.fr/.test(m.stored()) && !m.stored().includes(SECRET), fixed.out);
  const noName = machine({ name: "jean@exemple.fr", email: SECRET }).run("set", "--email-from-name");
  check("sans le vrai nom, la reparation de l'inversion est refusee", noName.code === 4);
  const emailAsName = machine({ name: "Jean Dupont", email: "jean@exemple.fr" }).run("set", "--name", "jean@exemple.fr");
  check("un nom qui est une adresse est refuse (c'est ce qui fabrique l'inversion)", emailAsName.code === 4);
}

console.log("\n── L'identite d'un depot, celle qu'un commit y porte ──");
{
  const m = machine({ name: "Jean Dupont", email: "jean@exemple.fr" });
  const repo = join(m.home, "depot");
  spawnSync("git", ["init", "-q", repo], { env: m.env });
  spawnSync("git", ["-C", repo, "config", "user.email", SECRET], { env: m.env });
  const global = m.run("check");
  const effective = m.run("check", "--effective", "--cwd", repo);
  check("le controle global ne voit que la configuration de la machine", global.json?.email === "valid");
  check("--effective voit ce que porterait un commit dans ce depot", effective.json?.email === "invalid" && effective.json?.scope === "effective" && !effective.out.includes(SECRET), effective.out);
}

console.log("\n── La meme forme que le serveur de licence ──");
{
  const { EMAIL_SHAPE, shapeOf } = await import(pathToFileURL(SCRIPT).href);
  check("l'expression est celle du serveur et du tableau de bord", EMAIL_SHAPE.source === "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
  check("shapeOf ne rend aucune valeur", !JSON.stringify(shapeOf({ name: "Jean Dupont", email: SECRET })).includes(SECRET));
}

for (const d of temps) rmSync(d, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
