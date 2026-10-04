#!/usr/bin/env node
// test-bw-home.mjs - On Windows, every `bw` of the plugin uses ONE sign-in folder, and the sign-in
// already made is taken over once, by a copy (scripts/vault/bw-home.mjs).
//
// On 03/10/2026, on a machine with Claude Desktop from the Microsoft Store, a program started
// outside Claude (the Run button of a command block, the Terminal panel) saw no account at all:
// the app's package had kept the sign-in in its private AppData. This recette plays the take-over
// on throwaway folders, with the answer of `bw status` simulated: no real sign-in is read, copied
// or written, and `bw` itself never runs.
//
//   node scripts/tests/test-bw-home.mjs

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The module lives with the vault's scripts, or with the Bitwarden module once the vault is a choice.
const MODULE = [join(ROOT, "scripts", "vault", "bw-home.mjs"), join(ROOT, "scripts", "vault", "providers", "bitwarden", "bw-home.mjs")].find((f) => existsSync(f));
const { bwHome, bwHomeOf, earlierHomes, useBwHome } = await import(pathToFileURL(MODULE).href);

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

const temps = [];
/** A throwaway Windows profile: the folder the program sees (APPDATA) and Claude Desktop's
 *  package folders (LOCALAPPDATA\Packages\Claude_*). */
function machine() {
  const home = mkdtempSync(join(tmpdir(), "hv-bw-home-"));
  temps.push(home);
  const env = { APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local") };
  const seen = join(env.APPDATA, "Bitwarden CLI");
  const pkg = (name = "Claude_pzs8sxrjxfjjc") => join(env.LOCALAPPDATA, "Packages", name, "LocalCache", "Roaming", "Bitwarden CLI");
  return { home, env, seen, pkg, target: bwHomeOf(home) };
}
/** A sign-in file in `dir`, written `minutesAgo` minutes ago. */
function signIn(dir, content, minutesAgo) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "data.json");
  writeFileSync(file, content);
  const t = new Date(Date.now() - minutesAgo * 60000);
  utimesSync(file, t, t);
}
const read = (dir) => (existsSync(join(dir, "data.json")) ? readFileSync(join(dir, "data.json"), "utf8") : null);
/** `bw status` simulated: `answers` maps a folder to true (signed in), false, or null (no answer). */
function simulated(answers) {
  const asked = [];
  const signedIn = (dir) => {
    asked.push(dir);
    return answers.has(dir) ? answers.get(dir) : false;
  };
  return { signedIn, asked };
}

// 1. Mac and Linux: nothing changes, nothing is created.
{
  const m = machine();
  const { signedIn, asked } = simulated(new Map());
  const env = { ...m.env };
  check("Mac : aucun dossier imposé", bwHome({ os: "darwin", env, home: m.home, signedIn }) === null);
  check("Linux : la variable n'est pas posée", useBwHome({ os: "linux", env, home: m.home, signedIn }) === null && !env.BITWARDENCLI_APPDATA_DIR);
  check("Mac et Linux : rien n'est créé, bw n'est pas interrogé", !existsSync(join(m.home, ".hypervibe")) && asked.length === 0);
}

// 2. A machine never signed in: the new folder is used from the start.
{
  const m = machine();
  const { signedIn, asked } = simulated(new Map());
  const r = bwHome({ os: "win32", env: m.env, home: m.home, signedIn });
  check("machine vierge : le dossier du plugin", r?.dir === m.target && r.copiedFrom === null && r.pending === false);
  check("machine vierge : la marque est posée, rien n'est copié", existsSync(join(m.target, ".taken-over")) && read(m.target) === null);
  check("machine vierge : bw n'est pas interrogé faute de connexion", asked.length === 0);
}

// 3. The case of 03/10/2026: the folder the program sees is not signed in, Claude Desktop's is.
{
  const m = machine();
  signIn(m.seen, "jamais-connecte", 600);
  signIn(m.pkg(), "connexion-de-claude", 5);
  const { signedIn } = simulated(new Map([[m.seen, false], [m.pkg(), true]]));
  const r = bwHome({ os: "win32", env: m.env, home: m.home, signedIn });
  check("la connexion de Claude Desktop est reprise", r?.copiedFrom === m.pkg() && read(m.target) === "connexion-de-claude");
  check("copiée, jamais déplacée : les deux originaux sont intacts", read(m.pkg()) === "connexion-de-claude" && read(m.seen) === "jamais-connecte");
}

// 4. Both signed in: the most recent one holds the last unlock.
for (const [label, seenAgo, pkgAgo, expected] of [
  ["le dossier vu par le programme, plus récent", 2, 30, "vu"],
  ["le dossier de Claude Desktop, plus récent", 30, 2, "paquet"],
]) {
  const m = machine();
  signIn(m.seen, "vu", seenAgo);
  signIn(m.pkg(), "paquet", pkgAgo);
  const { signedIn } = simulated(new Map([[m.seen, true], [m.pkg(), true]]));
  bwHome({ os: "win32", env: m.env, home: m.home, signedIn });
  check(`deux connexions : ${label} gagne`, read(m.target) === expected, `copié : ${read(m.target)}`);
}

// 5. A copy made by hand before (the trial of 03/10/2026) gives way only to a more recent sign-in.
{
  const m = machine();
  signIn(m.target, "copie-d-essai", 60);
  signIn(m.pkg(), "connexion-recente", 1);
  const { signedIn } = simulated(new Map([[m.pkg(), true]]));
  const r = bwHome({ os: "win32", env: m.env, home: m.home, signedIn });
  check("une copie d'essai plus ancienne est remplacée", r?.copiedFrom === m.pkg() && read(m.target) === "connexion-recente");
}
{
  const m = machine();
  signIn(m.target, "copie-plus-recente", 1);
  signIn(m.pkg(), "connexion-ancienne", 60);
  const { signedIn } = simulated(new Map([[m.pkg(), true]]));
  const r = bwHome({ os: "win32", env: m.env, home: m.home, signedIn });
  check("une copie plus récente que la source est gardée", r?.copiedFrom === null && read(m.target) === "copie-plus-recente");
  check("et la reprise est tout de même marquée faite", existsSync(join(m.target, ".taken-over")));
}

// 6. Once taken over, the old folders are never read again.
{
  const m = machine();
  signIn(m.pkg(), "premiere", 30);
  bwHome({ os: "win32", env: m.env, home: m.home, signedIn: simulated(new Map([[m.pkg(), true]])).signedIn });
  signIn(m.pkg(), "plus-tard-dans-l-ancien-dossier", 0);
  const { signedIn, asked } = simulated(new Map([[m.pkg(), true]]));
  const r = bwHome({ os: "win32", env: m.env, home: m.home, signedIn });
  check("après la reprise, l'ancien dossier n'est plus lu", asked.length === 0 && r?.copiedFrom === null && read(m.target) === "premiere");
}

// 7. bw does not answer: nothing is decided, the old folder stays in use, tried again next process.
{
  const m = machine();
  signIn(m.pkg(), "connexion", 5);
  const { signedIn, asked } = simulated(new Map([[m.pkg(), null]]));
  const r = bwHome({ os: "win32", env: m.env, home: m.home, signedIn });
  check("sans réponse de bw : reprise en attente", r?.pending === true && !existsSync(join(m.target, ".taken-over")) && read(m.target) === null);
  const env = { ...m.env };
  const first = useBwHome({ os: "win32", env, home: m.home, signedIn });
  const before = asked.length;
  const second = useBwHome({ os: "win32", env, home: m.home, signedIn });
  check("sans réponse : la variable n'est pas posée (l'ancien dossier reste en service)", first === null && second === null && !env.BITWARDENCLI_APPDATA_DIR);
  check("sans réponse : bw n'est pas réinterrogé à chaque appel du même programme", asked.length === before);
}

// 8. useBwHome: the folder is set for every bw of the process, unless the person set one.
{
  const m = machine();
  signIn(m.pkg(), "connexion", 5);
  const env = { ...m.env };
  const dir = useBwHome({ os: "win32", env, home: m.home, signedIn: simulated(new Map([[m.pkg(), true]])).signedIn });
  check("la variable désigne le dossier du plugin", dir === m.target && env.BITWARDENCLI_APPDATA_DIR === m.target);
}
{
  const m = machine();
  const { signedIn, asked } = simulated(new Map());
  const env = { ...m.env, BITWARDENCLI_APPDATA_DIR: "D:\\mon-dossier" };
  const dir = useBwHome({ os: "win32", env, home: m.home, signedIn });
  check("un dossier choisi par la personne est respecté", dir === "D:\\mon-dossier" && asked.length === 0 && !existsSync(join(m.home, ".hypervibe")));
}

// 9. Several installations of the app, and the folders of other apps.
{
  const m = machine();
  signIn(m.pkg("Claude_aaaa"), "ancienne-installation", 90);
  signIn(m.pkg("Claude_bbbb"), "installation-actuelle", 3);
  signIn(join(m.env.LOCALAPPDATA, "Packages", "AutreApp_cccc", "LocalCache", "Roaming", "Bitwarden CLI"), "autre-app", 1);
  const homes = earlierHomes(m.env);
  check("seuls les paquets de Claude Desktop sont candidats", homes.length === 2 && homes.every((d) => d.includes("Claude_")));
  bwHome({ os: "win32", env: m.env, home: m.home, signedIn: simulated(new Map(homes.map((d) => [d, true]))).signedIn });
  check("entre deux installations, la plus récente gagne", read(m.target) === "installation-actuelle");
}

// 10. Every script of the plugin that runs bw goes through the one folder.
{
  const scripts = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!["tests", "node_modules"].includes(e.name)) walk(join(dir, e.name));
      } else if (/\.(mjs|js|cjs)$/.test(e.name)) scripts.push(join(dir, e.name));
    }
  };
  walk(join(ROOT, "scripts"));
  // A script that finds bw by itself: its own resolveBwCmd, or the Bitwarden module's resolveCli.
  const runners = scripts.filter((f) => {
    const s = readFileSync(f, "utf8");
    return /function resolveBwCmd\(/.test(s) || (/function resolveCli\(/.test(s) && /const BW_EXE/.test(s));
  });
  // Every place that runs bw (its version asked aside: that reads no sign-in) calls useBwHome:
  // counted, so that one helper left out among several is seen.
  const missing = runners.flatMap((f) => {
    const s = readFileSync(f, "utf8");
    const runs = [...s.matchAll(/spawnSync\((cmd|cli\.command|loginCmd|unlockCmd)\b[^\n]{0,80}/g)].filter((m) => !m[0].includes('"--version"')).length;
    const uses = (s.match(/useBwHome\(\)/g) ?? []).length;
    return uses >= runs && runs > 0 ? [] : [`${relative(ROOT, f)} (${runs} appel(s) de bw, ${uses} passage(s) par le dossier)`];
  });
  check(`chaque script qui lance bw passe par le dossier unique, à chaque appel (${runners.length} script(s))`, runners.length >= 1 && missing.length === 0, missing.join(", "));
  const vault = readFileSync(join(ROOT, "scripts", "vault", "vault.mjs"), "utf8");
  check("vault.mjs account dit si un compte est connecté", /cmd === "account"/.test(vault));
}

// 11. No page tells anyone to ask bw directly: on Windows it would read another folder.
{
  const pages = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!["node_modules", ".git"].includes(e.name)) walk(join(dir, e.name));
      } else if (/\.md$/.test(e.name)) pages.push(join(dir, e.name));
    }
  };
  walk(ROOT);
  const offenders = [];
  for (const page of pages) {
    let inCode = false;
    for (const line of readFileSync(page, "utf8").split(/\r?\n/)) {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        continue;
      }
      if (inCode && /(?:^|[;&|]\s*)(?:"\$BW"|\$BW|bw(?:\.exe)?)\s+status\b/.test(line.trim())) offenders.push(`${relative(ROOT, page)} : ${line.trim()}`);
    }
  }
  check("aucune page ne fait lancer bw status directement", offenders.length === 0, offenders.join(" | "));
}

for (const d of temps) rmSync(d, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
