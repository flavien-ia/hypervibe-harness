#!/usr/bin/env node
// test-entry-point.mjs - A script launched through a link still runs.
//
// A script that is both a library and a command guards its command with an entry test. Node gives
// a module its real path and keeps in argv[1] the path as it was typed: compared as they come,
// the two differ as soon as the plugin is reached through a symbolic link, and the script then
// does nothing and exits 0 (outside review, 3.3.9: on macOS the temporary folder is a link, and
// so is a ~/.claude kept by a configuration repository). Every script therefore carries the SAME
// entry test, which reads both paths to their real one. This recette holds two things:
//   1. the block does what it says, tried for real: launched by its path, through a link,
//      imported, and imported when argv[1] is not a file at all;
//   2. every script of the plugin that reads argv[1] reads it in that block, and nowhere else.
//
//   node scripts/tests/test-entry-point.mjs
//
// Nothing here reaches the network, a vault or a project: a probe written in a temporary folder
// carries the block, and the plugin's own scripts are read, never launched.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` : ${detail}` : ""}`);
}

// ── The block, as every script carries it ───────────────────────────────────
const HEAD = "// ─── Launched as a script, or imported ";
const OPENING = "function launchedDirectly() {";
/** The entry test of a file: from its heading to the end of its function. Null without one. */
function blockOf(text) {
  const a = text.indexOf(HEAD);
  if (a < 0) return null;
  const f = text.indexOf(OPENING, a);
  if (f < 0) return null;
  const b = text.indexOf("\n}\n", f);
  return b < 0 ? null : text.slice(a, b + 3);
}
const lire = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/** Every script of the plugin: what Node can run, wherever it is kept. */
function scripts(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) scripts(full, out);
    else if (/\.(?:mjs|cjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

// The reference is the block of one script every harness ships; the others are compared to it,
// and it is the one the probe below runs.
const REFERENCE = "scripts/git-identity.mjs";
const BLOCK = blockOf(lire(join(ROOT, REFERENCE)));
check(`${REFERENCE} porte le test d'entree`, BLOCK !== null && BLOCK.includes("realPathOf(process.argv[1])") && BLOCK.includes("realPathOf(pathOfUrl(import.meta.url))"));

console.log("\n── Le test d'entree, essaye pour de vrai ──");
if (BLOCK !== null) {
  const WORK = mkdtempSync(join(tmpdir(), "hv-entry-"));
  const link = join(WORK, "lien");
  const run = (args, cwd = WORK) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };
  try {
    const real = join(WORK, "reel");
    mkdirSync(real);
    const probe = join(real, "probe.mjs");
    writeFileSync(probe, `${BLOCK}\nif (launchedDirectly()) console.log("main");\nexport const loaded = true;\n`);
    const importer = join(real, "importer.mjs");
    writeFileSync(importer, 'import { loaded } from "./probe.mjs";\nconsole.log(loaded ? "imported" : "?");\n');

    let r = run([probe]);
    check("lance par son chemin : le script se sait lance", r.code === 0 && r.out.trim() === "main", r.out);
    r = run(["probe.mjs"], real);
    check("lance par un chemin relatif : il se sait lance", r.code === 0 && r.out.trim() === "main", r.out);
    r = run([importer]);
    check("importe par un autre script : il ne se croit pas lance", r.code === 0 && r.out.trim() === "imported", r.out);
    r = run(["--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(probe).href)}); console.log(m.loaded ? "imported" : "?");`, "pas-un-fichier"]);
    check("importe quand argv[1] n'est pas un fichier (node -e, puis un argument) : ni erreur ni lancement", r.code === 0 && r.out.trim() === "imported", r.out);
    if (process.platform === "win32" && /^[A-Za-z]:/.test(probe)) {
      const flipped = (probe[0] === probe[0].toUpperCase() ? probe[0].toLowerCase() : probe[0].toUpperCase()) + probe.slice(1);
      r = run([flipped]);
      check("sous Windows, la lettre du lecteur dans l'autre casse : il se sait lance", r.code === 0 && r.out.trim() === "main", r.out);
    }

    // Through a link: the very case that left fourteen scripts silent. A directory junction on
    // Windows, which needs no special right; a symbolic link elsewhere.
    let linked = false;
    try {
      symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
      linked = true;
    } catch (e) {
      console.log(`SKIP le lien n'a pas pu etre cree sur cette machine (${e.code ?? e.message}) : l'essai a travers un lien n'est pas fait ici`);
    }
    if (linked) {
      const through = join(link, "probe.mjs");
      const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
      check("le lien mene bien au meme fichier par un autre chemin", !same(through, realpathSync(through)) && same(realpathSync(through), realpathSync(probe)));
      r = run([through]);
      check("lance a travers un lien : le script se sait lance (il se taisait, et sortait en 0)", r.code === 0 && r.out.trim() === "main", r.out);
      r = run([join(link, "importer.mjs")]);
      check("... et importe a travers le lien, il ne se croit pas lance", r.code === 0 && r.out.trim() === "imported", r.out);
      // The test this block replaces, on the same link: it is what stays silent.
      const old = join(real, "ancien.mjs");
      writeFileSync(old, 'import { resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\nif (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log("main");\n');
      r = run([join(link, "ancien.mjs")]);
      check("temoin : l'ancien test d'entree, lance a travers le meme lien, se tait et sort en 0", r.code === 0 && r.out.trim() === "", r.out);
    }
  } finally {
    // The link first, and never through it: it only leads back into this temporary folder.
    try {
      rmdirSync(link);
    } catch {
      try {
        unlinkSync(link);
      } catch {
        /* no link was made */
      }
    }
    rmSync(WORK, { recursive: true, force: true });
  }
}

console.log("\n── Chaque script qui lit argv[1] le lit dans ce bloc, et nulle part ailleurs ──");
{
  // The two files that name argv[1] for another reason, each held to its own.
  const SELF = "scripts/tests/test-entry-point.mjs";
  const OWN_FORM = { "scripts/license/ask-key.mjs": /fs\.realpathSync\(process\.argv\[1\]\)/ };
  const reading = scripts(ROOT)
    .map((file) => ({ rel: relative(ROOT, file).replace(/\\/g, "/"), text: lire(file) }))
    .filter(({ rel, text }) => rel !== SELF && /process\.argv\[1\]|process\.argv\.at\(1\)/.test(text));
  check("la recette lit bien les scripts du plugin", reading.length >= 8, `${reading.length} scripts lisent argv[1]`);

  const ownForm = reading.filter(({ rel }) => rel in OWN_FORM);
  const wrongOwn = ownForm.filter(({ rel, text }) => !OWN_FORM[rel].test(text)).map(({ rel }) => rel);
  check("un script qui garde sa propre forme lit lui aussi le chemin reel", wrongOwn.length === 0, wrongOwn.join(", "));

  const others = reading.filter(({ rel }) => !(rel in OWN_FORM));
  const withoutBlock = others.filter(({ text }) => blockOf(text) !== BLOCK).map(({ rel }) => rel);
  check("chaque script porte le meme test d'entree, au caractere pres", BLOCK !== null && withoutBlock.length === 0, withoutBlock.join(", "));
  const elsewhere = others.filter(({ text }) => text.split("process.argv[1]").length - 1 !== 2 || /process\.argv\.at\(1\)/.test(text)).map(({ rel }) => rel);
  check("aucun ne lit argv[1] ailleurs que dans ce bloc (ni comparaison de son cru, ni suffixe)", elsewhere.length === 0, elsewhere.join(", "));
  const unused = others.filter(({ text }) => {
    const block = blockOf(text);
    return block === null || !text.replace(block, "").includes("launchedDirectly()");
  }).map(({ rel }) => rel);
  check("chacun s'en sert pour decider s'il est lance", unused.length === 0, unused.join(", "));
  // The older spellings of the test, wherever they could come back.
  const older = scripts(ROOT)
    .map((file) => ({ rel: relative(ROOT, file).replace(/\\/g, "/"), text: lire(file) }))
    .filter(({ rel, text }) => rel !== SELF && /import\.meta\.url\s*===\s*(?:pathToFileURL\(|`file:)/.test(text))
    .map(({ rel }) => rel);
  check("aucun script ne compare import.meta.url a une adresse fabriquee depuis les arguments", older.length === 0, older.join(", "));
  check("la recette est branchee dans run-all.mjs", existsSync(join(ROOT, "scripts/tests/run-all.mjs")) && lire(join(ROOT, "scripts/tests/run-all.mjs")).includes("test-entry-point.mjs"));
}

console.log(`\n${checks - failures}/${checks} verifications`);
process.exitCode = failures ? 1 : 0;
