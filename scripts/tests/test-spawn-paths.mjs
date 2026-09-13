#!/usr/bin/env node
// test-spawn-paths.mjs - Recette: a path with a space survives every launcher.
//
// A user of 3.1.5 whose Windows profile is C:\Users\First Last saw
// /delete-project and /save-project fail with "Cannot find module
// 'C:\Users\First'": the plugin launched its own scripts through a shell that
// cut the path at the space. This recette runs the real launchers from a
// folder whose name carries a space, and audits every script for the form
// that caused it (an argument array handed to `shell: true`).
//
//   node scripts/tests/test-spawn-paths.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { runNode, runCli, spawnSpec, quoteForCmd } = await import(pathToFileURL(join(ROOT, "scripts", "_spawn.mjs")).href);
const IS_WIN = process.platform === "win32";

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// A folder with a space in its name, a script inside, like a user profile.
const base = mkdtempSync(join(tmpdir(), "hypervibe recette "));
const dir = join(base, "Prénom Nom");
mkdirSync(dir);
const script = join(dir, "echo-args.mjs");
writeFileSync(script, 'console.log(process.argv.slice(2).join("|"));\n');
check("le dossier de recette porte bien un espace", /\s/.test(dir));

// 1. The plugin's own scripts: through the running Node binary, no shell.
const r1 = runNode(script, ["a b", "c"]);
check("runNode : un script dans un dossier avec espace se lance, arguments intacts", r1.status === 0 && r1.stdout.trim() === "a b|c", `exit ${r1.status} ${r1.stderr.slice(0, 80)}`);

// 2. `node` asked through runCli is routed the same way.
const r2 = runCli("node", [script, "x y"]);
check("runCli(\"node\") : meme chemin, sans shell", r2.status === 0 && r2.stdout.trim() === "x y", `exit ${r2.status}`);

// 3. A CLI on Windows becomes ONE quoted line; elsewhere an array, no shell.
const spec = spawnSpec("vercel", ["env", "pull", join(dir, "out.env"), "--yes"]);
if (IS_WIN) {
  check("spawnSpec (Windows) : une seule ligne, le chemin avec espace entre guillemets", spec.shell === true && spec.args.length === 0 && spec.file.includes(`"${join(dir, "out.env")}"`), spec.file);
} else {
  check("spawnSpec (Unix) : tableau intact, pas de shell", spec.shell === false && spec.args[2] === join(dir, "out.env"));
}
check("spawnSpec(\"node\") : le binaire courant, jamais de shell", spawnSpec("node", ["x"]).file === process.execPath && spawnSpec("node", ["x"]).shell === false);

// 4. Quoting rules for cmd.exe.
check("quoteForCmd : un chemin avec espace est entoure de guillemets", quoteForCmd("C:\\Users\\Prénom Nom\\x") === '"C:\\Users\\Prénom Nom\\x"');
check("quoteForCmd : un drapeau simple reste nu", quoteForCmd("--yes") === "--yes");
check("quoteForCmd : un guillemet interne est echappe", quoteForCmd('a"b') === '"a\\"b"');
check("quoteForCmd : une chaine vide devient \"\"", quoteForCmd("") === '""');

// 5. No deprecation warning from the launchers (DEP0190 is the sign of the bad form).
{
  const probe = join(dir, "probe.mjs");
  const target = IS_WIN ? 'runCli("cmd", ["/c", "echo", "hi"])' : 'runCli("echo", ["hi"])';
  writeFileSync(probe, `import { runCli } from ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "_spawn.mjs")).href)};\nconst r = ${target};\nprocess.stdout.write(r.stdout);\n`);
  const r5 = spawnSync(process.execPath, [probe], { encoding: "utf8" });
  check("runCli n'emet pas DEP0190 (aucun tableau confie a un shell)", r5.status === 0 && /hi/.test(r5.stdout) && !/DEP0190/.test(r5.stderr), `${r5.status} ${r5.stderr.slice(0, 120)}`);
}

// 6. Audit: no script launches a child with an argument array AND shell: true.
{
  const offenders = [];
  const walk = (d, acc = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (e.isFile() && p.endsWith(".mjs")) acc.push(p);
    }
    return acc;
  };
  const files = walk(join(ROOT, "scripts")).concat(walk(join(ROOT, "hooks")));
  for (const p of files) {
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    if (rel.startsWith("scripts/tests/")) continue;
    const src = readFileSync(p, "utf8");
    const re = /\bspawn(?:Sync)?\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      // The call text, up to its closing parenthesis (balanced, quotes ignored:
      // enough for a static audit of argument shapes).
      let depth = 0;
      let end = m.index + m[0].length - 1;
      for (let i = end; i < src.length; i += 1) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      const call = src.slice(m.index + m[0].length, end);
      if (/^\s*[^,]+?,\s*\[/.test(call) && /shell:\s*true/.test(call)) offenders.push(`${rel}: ${call.slice(0, 70).replace(/\s+/g, " ")}`);
    }
  }
  check("aucun script ne confie un tableau d'arguments a un shell", offenders.length === 0, offenders.slice(0, 3).join(" | "));
}

// 7. The vault window launcher quotes every PowerShell argument (a profile
//    path with a space used to be cut by Start-Process, and the window died
//    before it appeared: no vault, no /start, for those users, since July).
{
  const launch = readFileSync(join(ROOT, "scripts", "vault", "launch.mjs"), "utf8");
  check("launch.mjs : chaque argument de Start-Process est entre guillemets doubles", /const q = \(s\) => `'"\$\{/.test(launch));
  if (IS_WIN) {
    const witness = join(dir, "WITNESS");
    const w = join(dir, "write witness.mjs");
    writeFileSync(w, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(witness)}, process.argv.slice(2).join("|"));\n`);
    const q = (s) => `'"${String(s).replace(/"/g, '\\"').replace(/'/g, "''")}"'`;
    const argList = ["--no-deprecation", w, "arg un", "deux"].map(q).join(",");
    const r7 = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `$p = Start-Process -FilePath node -ArgumentList @(${argList}) -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`], { encoding: "utf8" });
    check("Start-Process : un script dans un dossier avec espace demarre et recoit ses arguments", r7.status === 0 && existsSync(witness) && readFileSync(witness, "utf8") === "arg un|deux", `exit ${r7.status}`);
  } else {
    console.log("     (Start-Process : recette Windows seulement, sautee ici)");
  }
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
