#!/usr/bin/env node
// test-env-line.mjs - A line of a project's .env, read and written as the site's own loader
// (dotenv, through Next.js) reads it, by every tool that reads or writes one (3.4.5):
//   - a quoted line piped from a .env reaches the hosting WITHOUT its quotes, a comment left out;
//   - a value written into the local .env comes back unchanged when the site reads it: quoted
//     when it has to be, refused when no quoting can carry it, the value never in a message;
//   - the masked window and the administrator's secret pipe write lines the helper reads back
//     exactly, so a password with a # is not cut short on the way;
//   - a `$` too (3.4.9, outside review): Next runs dotenv-expand over the .env, which expands
//     `$name` even between quotes, and only `\$` keeps a dollar. A value is written with `\$`, a
//     line read with `\$` gives `$`, and a line whose `$name` the site would expand is refused
//     on its way to the hosting. With HV_NEXT_ENV naming the folder of an @next/env, every
//     line written here is also read back by Next's own loader.
// No network: the temporary project has no hosting, the helper stops after its local step.
//
//   node scripts/tests/test-env-line.mjs

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINE = join(ROOT, "scripts", "_env-line.mjs");
const HELPER = join(ROOT, "scripts", "push-env-vars.mjs");
const { dotenvExpands, dotenvLine, dotenvValue } = await import(pathToFileURL(LINE).href);
const SECRET = "valeur-secrete-qui-ne-doit-jamais-sortir";

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${detail})`}`);
}

console.log("── Lire une ligne comme le site la lit ──");
const reads = [
  ["abc", "abc"],
  ["  abc  ", "abc"],
  ['"abc"', "abc"],
  ["'abc'", "abc"],
  ["`abc`", "abc"],
  ['"a\\nb"', "a\nb"],
  ["'a\\nb'", "a\\nb"],
  ["abc # une note", "abc"],
  ['"abc" # une note', "abc"],
  ["'ab#cd'", "ab#cd"],
  ["ab#cd", "ab"],
  ["", ""],
  ['""', ""],
  ["postgres://u:p@h/db?x=1&y=2", "postgres://u:p@h/db?x=1&y=2"],
  // A dollar kept by `\$`, whatever the quotes (dotenv-expand reads it back `$`).
  ["pa\\$\\$w0rd", "pa$$w0rd"],
  ["'pa\\$\\$w0rd'", "pa$$w0rd"],
  ['"pa\\$\\$w0rd"', "pa$$w0rd"],
  ["a\\\\$b", "a\\$b"],
  ["fin\\$", "fin$"],
];
for (const [raw, want] of reads) {
  const got = dotenvValue(raw);
  check(`${JSON.stringify(raw)} se lit ${JSON.stringify(want)}`, got === want, JSON.stringify(got));
}

console.log("\n── Écrire une ligne que le site relit à l'identique ──");
const dollars = ["pa$$w0rd", "x$y", "$", "a$", "${X}", "${X:-def}", "a\\$b", "cost $5", "it's $5", "ab#$cd", "ligne1\nligne $x", "$$$$"];
const values = ["abc", "deux mots", "ab#cd", " devant", "derriere ", '"guillemets"', "l'apostrophe", 'un " seul', "un ` seul", "a'b\"c", "ligne1\nligne2", "barre\\noblique", "", "postgres://u:p@h/db?x=1&y=2", `sk_live_${SECRET}`, ...dollars];
const written = [];
for (const v of values) {
  let line = null;
  try {
    line = dotenvLine("CLE", v);
  } catch {
    line = null;
  }
  if (line !== null) written.push([v, line]);
  check(`${JSON.stringify(v)} s'écrit sur une ligne et se relit à l'identique, sans un $ que le site développerait`, line !== null && !/[\r\n]/.test(line) && dotenvValue(line.slice(4)) === v && !dotenvExpands(line.slice(4)), String(line));
}
check("un $ s'écrit \\$ : pa$$w0rd devient la ligne W0=pa\\$\\$w0rd", dotenvLine("W0", "pa$$w0rd") === "W0=pa\\$\\$w0rd", dotenvLine("W0", "pa$$w0rd"));

console.log("\n── Un $nom que le site remplacerait ──");
for (const [raw, want] of [
  ["x$y", true],
  ["pa$$w0rd", true],
  ["'x$y'", true],
  ['"${X}"', true],
  ["`a$b`", true],
  ["x\\$y", false],
  ["a$", false],
  ["a$-b", false],
  ["$", false],
  ["prix: 5 $", false],
  ["note # $y", false],
]) {
  check(`${JSON.stringify(raw)} ${want ? "dépend d'une autre variable" : "ne dépend de rien d'autre"}`, dotenvExpands(raw) === want);
}

// Next's own loader, when this machine says where one is (HV_NEXT_ENV, the folder of an
// @next/env): every line written above is read back by it, unchanged.
if (process.env.HV_NEXT_ENV) {
  const nextEnv = createRequire(import.meta.url)(process.env.HV_NEXT_ENV);
  const dir = mkdtempSync(join(tmpdir(), "hv-env-line-next-"));
  try {
    writeFileSync(join(dir, ".env"), written.map(([, line], i) => line.replace(/^CLE=/, `HV_LIGNE_${i}=`)).join("\n") + "\n");
    const read = nextEnv.loadEnvConfig(dir, false, { info() {}, error() {} }, true).combinedEnv;
    const off = written.filter(([v], i) => read[`HV_LIGNE_${i}`] !== v).map(([v]) => JSON.stringify(v));
    check(`le chargeur de Next lui-même relit chaque ligne écrite à l'identique (${written.length} lignes)`, off.length === 0, off.join(" | "));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log("skip HV_NEXT_ENV n'est pas posé : les lignes ne sont pas relues par le chargeur de Next");
}
check("une valeur sans piège s'écrit telle quelle, sans guillemets", dotenvLine("CLE", "abc") === "CLE=abc" && dotenvLine("CLE", "deux mots") === "CLE=deux mots");
const impossible = "a'b\"c`d#e";
let refus = null;
try {
  dotenvLine("CLE", impossible);
} catch (e) {
  refus = e.message;
}
check("une valeur qu'aucune forme ne porte est refusée", refus !== null, String(refus));
check("... le refus nomme la clé, jamais la valeur", refus !== null && /CLE/.test(refus) && !refus.includes(impossible) && !refus.includes("b\"c"));

console.log("\n── La ligne de commande, la valeur sur l'entrée standard ──");
{
  const r = spawnSync(process.execPath, [LINE, "CLE"], { input: "ab#cd\n", encoding: "utf8" });
  check("printf '%s' valeur | _env-line.mjs CLE rend la ligne, entre guillemets quand il le faut", r.status === 0 && r.stdout === "CLE='ab#cd'\n", JSON.stringify(r.stdout));
  const nul = spawnSync(process.execPath, [LINE], { input: "x", encoding: "utf8" });
  check("sans nom de clé : un refus, rien sur la sortie", nul.status === 1 && nul.stdout === "");
  const enArg = spawnSync(process.execPath, [LINE, "CLE", SECRET], { input: "", encoding: "utf8" });
  check("une valeur en argument est refusée (elle se lirait dans la liste des processus)", enArg.status === 1 && !(enArg.stdout + enArg.stderr).includes(SECRET));
  const non = spawnSync(process.execPath, [LINE, "CLE"], { input: impossible, encoding: "utf8" });
  check("une valeur impossible : exit 1, la valeur jamais répétée", non.status === 1 && non.stdout === "" && !non.stderr.includes(impossible));
}

console.log("\n── L'outil des variables : ce qu'il lit, ce qu'il écrit ──");
function push(args, input) {
  const dir = mkdtempSync(join(tmpdir(), "hv-env-line-"));
  writeFileSync(join(dir, ".env"), "AUTRE=1\n");
  const r = spawnSync(process.execPath, [HELPER, ...args], { cwd: dir, input, encoding: "utf8" });
  const env = readFileSync(join(dir, ".env"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { r, env };
}
{
  const a = push(["--stdin"], 'GUILLEMETS="abc"\nNOTE=valeur # une note\nAPOSTROPHES=\'ab#cd\'\n');
  check("une ligne de .env entre guillemets arrive SANS ses guillemets", /^GUILLEMETS=abc$/m.test(a.env), a.env);
  check("... une note en fin de ligne est laissée de côté", /^NOTE=valeur$/m.test(a.env), a.env);
  check("... et une valeur avec un # garde son #, entre guillemets dans le .env local", /^APOSTROPHES='ab#cd'$/m.test(a.env), a.env);
  const b = push(["CLE=ab#cd"]);
  check("une valeur en argument qui porte un # est écrite entre guillemets dans le .env local", /^CLE='ab#cd'$/m.test(b.env), b.env);
  const c = push(["--stdin"], 'VIDE=""\n');
  check('une valeur vide entre guillemets ("") est refusée comme une valeur vide', c.r.status === 1 && /VIDE/.test(c.r.stderr) && c.env === "AUTRE=1\n", c.env);
  // En argument, la valeur est brute (sur l'entrée standard, le # de la même valeur ouvrirait une note).
  const d = push([`CLE=${impossible}`]);
  check("une valeur que le .env local ne saurait porter est refusée, et rien n'est écrit", d.r.status === 1 && d.env === "AUTRE=1\n" && !(d.r.stdout + d.r.stderr).includes(impossible), d.env);
  check("... par un refus en mots, avant toute écriture, jamais par un plantage", /^Refused: CLE: /m.test(d.r.stderr) && !/at dotenvLine|node:internal/.test(d.r.stderr), d.r.stderr.slice(0, 200));
  const e = push(["--stdin"], `CLE=${SECRET}\n`);
  check("une valeur ordinaire arrive entière, et n'est jamais affichée", e.env.includes(`CLE=${SECRET}\n`) && !(e.r.stdout + e.r.stderr).includes(SECRET), e.env);
  const f = push(["--stdin"], "R=pa\\$\\$w0rd\n");
  check("une ligne déjà protégée pour le site (\\$) part sans ses barres : le .env local la garde protégée", /^R=pa\\\$\\\$w0rd$/m.test(f.env), f.env);
  const g = push(["--stdin"], "W=x$y\n");
  check("une ligne dont le site développerait le $ est refusée, rien n'est écrit", g.r.status === 1 && g.env === "AUTRE=1\n" && /^Refused: W: /m.test(g.r.stderr), g.env);
  check("... le refus nomme la clé, jamais la valeur", !(g.r.stdout + g.r.stderr).includes("x$y"));
  const h = push(["W0=pa$$w0rd"]);
  check("une valeur en argument avec des $ s'écrit \\$ dans le .env local", /^W0=pa\\\$\\\$w0rd$/m.test(h.env), h.env);
}

console.log("\n── Ceux qui écrivent des lignes pour l'outil ──");
{
  const inter = readFileSync(join(ROOT, "scripts", "vault", "interactive.mjs"), "utf8");
  check("la fenêtre masquée écrit ses lignes par dotenvLine : un mot de passe avec un # arrive entier", /pairs\.push\(dotenvLine\(s\.name, val\)\)/.test(inter) && !/pairs\.push\(`\$\{s\.name\}=\$\{val\}`\)/.test(inter));
  const pipe = join(ROOT, "scripts", "secret-pipe.mjs");
  if (existsSync(pipe)) {
    const { render } = await import(pathToFileURL(pipe).href);
    const out = render([{ name: "CLE", value: "ab#cd", type: "secret" }, { name: "AUTRE", value: " espace", type: "secret" }], "env");
    const back = out.trim().split("\n").map((l) => dotenvValue(l.slice(l.indexOf("=") + 1)));
    check("le tube du coffre de l'administrateur écrit des lignes que l'outil relit à l'identique", back[0] === "ab#cd" && back[1] === " espace", JSON.stringify(out));
  }
  const pull = readFileSync(join(ROOT, "scripts", "pull-env-vars.mjs"), "utf8");
  check("la récupération depuis l'hébergeur écrit ses lignes par dotenvLine (un $ n'y est plus développé, un \\\" plus gardé)", /dotenvLine\(k, String\(v\)\.replace\(\/\\\\n\/g, "\\n"\)\.replace\(\/\\\\r\/g, "\\r"\)\)/.test(pull) && !/const needsQuote = /.test(pull), "pull-env-vars.mjs");
  const ev = join(ROOT, "scripts", "env-value.mjs");
  if (existsSync(ev)) {
    const dir = mkdtempSync(join(tmpdir(), "hv-env-line-ev-"));
    writeFileSync(join(dir, ".env"), "NOTE=abc # une note\nDIESE='ab#cd'\nDOLLAR=pa\\$\\$w0rd\n");
    const lu = (k) => spawnSync(process.execPath, [ev, "--project-dir", dir, k], { encoding: "utf8" }).stdout;
    check("env-value.mjs lit comme le site : la note laissée de côté, le # entre guillemets gardé", lu("NOTE") === "abc" && lu("DIESE") === "ab#cd", `${lu("NOTE")} | ${lu("DIESE")}`);
    check("... et un \\$ relu $", lu("DOLLAR") === "pa$$w0rd", lu("DOLLAR"));
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
