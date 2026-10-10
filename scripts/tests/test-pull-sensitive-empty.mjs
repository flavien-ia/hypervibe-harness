#!/usr/bin/env node
// test-pull-sensitive-empty.mjs - A secret the host never gives back must never erase the one
// the project still holds.
//
// Vercel never returns the value of a "sensitive" variable: its command line writes KEY=""
// for it in the file `vercel env pull` produces (measured on 2026-05-09, and written in the
// organisation's pull workflow; the documentation says such a value cannot be read back).
// Three places read that file as if the empty string were the value (found by the inventory of
// lot 5, 27/09/2026):
//   - pull-env-vars.mjs --write-to-local wrote KEY= over the local value of every secret, the
//     very gesture its skill offers to restore a lost .env.local, and announced it "present";
//   - check-deps.mjs --include-vercel let the empty value hide the local one: a project whose
//     database is set up was reported without one;
//   - the snapshot of /save-project counted the empty lines as variables, and its restore notes
//     said to copy the production file as the project's .env, secrets empty.
// Everything here runs against a fake Vercel command line placed first in the PATH: no account,
// no network.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const WORK = mkdtempSync(join(tmpdir(), "hv-pull-sensitive-"));

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// ── the fake command line ────────────────────────────────────────────────────
const bin = join(WORK, "bin");
mkdirSync(bin, { recursive: true });
const fakeCli = join(WORK, "fake-vercel.mjs");
writeFileSync(
  fakeCli,
  `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Vercel CLI 99.0.0"); process.exit(0); }
if (args[0] === "env" && args[1] === "pull") {
  const env = (args.find((a) => a.startsWith("--environment=")) || "--environment=development").split("=")[1];
  // What the real command line writes: a sensitive variable comes back as KEY="".
  const files = {
    production: 'SECRET_KEY=""\\nDATABASE_URL=""\\nNEXT_PUBLIC_URL="https://prod.example"\\nPLAIN_FLAG="on"\\nDOLLAR="pa$$w0rd"\\nMULTI="l1\\\\nl2"\\nCITE="dit "oui""\\n',
    preview: 'SECRET_KEY=""\\nNEXT_PUBLIC_URL="https://preview.example"\\n',
    development: 'NEXT_PUBLIC_URL="http://localhost:3000"\\n',
  };
  writeFileSync(args[2], "# Created by Vercel CLI\\n" + files[env]);
  process.exit(0);
}
console.error("fake vercel: unknown command " + args.join(" "));
process.exit(1);
`,
);
if (process.platform === "win32") {
  writeFileSync(join(bin, "vercel.cmd"), `@echo off\r\n"${process.execPath}" "${fakeCli}" %*\r\n`);
} else {
  writeFileSync(join(bin, "vercel"), `#!/bin/sh\nexec "${process.execPath}" "${fakeCli}" "$@"\n`);
  chmodSync(join(bin, "vercel"), 0o755);
}
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
// A home folder of its own: the vault of the machine the recette runs on is never reached (a
// project's backup reads a key there for the clock, with the session of the day).
const MAISON = join(WORK, "maison");
mkdirSync(MAISON, { recursive: true });
const OWN_HOME = { HOME: MAISON, USERPROFILE: MAISON, APPDATA: join(MAISON, "appdata"), LOCALAPPDATA: join(MAISON, "localappdata") };
const ENV = { ...process.env, ...OWN_HOME, [pathKey]: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env[pathKey] ?? ""}`, VERCEL_TOKEN: "" };

const DB_URL = "postgresql://owner:mot-de-passe@ep-exemple.eu-central-1.aws.neon.tech/app?sslmode=require";
let n = 0;
function project() {
  n += 1;
  const dir = join(WORK, `projet-${n}`);
  mkdirSync(join(dir, ".vercel"), { recursive: true });
  writeFileSync(join(dir, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_recette", orgId: "team_recette" }));
  writeFileSync(join(dir, ".env.local"), "SECRET_KEY=valeur-locale-a-garder\nNEXT_PUBLIC_URL=ancienne\n");
  writeFileSync(join(dir, ".env"), `DATABASE_URL=${DB_URL}\n`);
  writeFileSync(join(dir, "drizzle.config.ts"), "export default {};\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `projet-${n}`, private: true }));
  return dir;
}
const node = (script, args, cwd) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd, env: ENV, encoding: "utf8", windowsHide: true, timeout: 120000 });
// What this harness has: the restore through the host's command line is the person's harness
// only (an organisation's collaborator pulls through the forge's workflow, which has always set
// secrets apart); the backup is not in the administrator's.
const PULLS_WITH_CLI = /env", "pull"/.test(readFileSync(join(SCRIPTS, "pull-env-vars.mjs"), "utf8"));
const HAS_SNAPSHOT = existsSync(join(SCRIPTS, "save-project", "build-snapshot.mjs"));

try {
  // ── 1. Restoring a .env.local from the host ─────────────────────────────
  if (PULLS_WITH_CLI) {
    const dir = project();
    const r = node("pull-env-vars.mjs", ["--target=production", "--write-to-local"], dir);
    const local = readFileSync(join(dir, ".env.local"), "utf8");
    check("the pull itself succeeds", r.status === 0, r.stderr.trim().slice(0, 200));
    check("a secret the host never gives back does not erase the local one", /^SECRET_KEY=valeur-locale-a-garder$/m.test(local), local.replace(/\n/g, " | "));
    check("... nor is it added as an empty line where the project had none", !/^DATABASE_URL=/m.test(local));
    check("a readable value is still brought back", /^NEXT_PUBLIC_URL=https:\/\/prod\.example$/m.test(local) && /^PLAIN_FLAG=on$/m.test(local));
    check("a $ is written \\$, which Next reads back $ (bare or between double quotes, Next expanded it)", /^DOLLAR=pa\\\$\\\$w0rd$/m.test(local), local.replace(/\n/g, " | "));
    check("a line break the host wrote as \\n stays one, a double quote inside the value keeps no backslash", /^MULTI="l1\\nl2"$/m.test(local) && /^CITE=dit "oui"$/m.test(local), local.replace(/\n/g, " | "));
    check("the report says the secret could not be read, never that it is present", /SECRET_KEY/.test(r.stdout) && !/SECRET_KEY \(present\)/.test(r.stdout) && /not readable|unreadable|illisible|never given back/i.test(r.stdout), r.stdout.trim().replace(/\n/g, " | "));
  }
  // ── 1b. A temporary folder with a space in its path ──────────────────────
  // The pulled file goes to the temporary folder, which carries the user's folder on Windows
  // ("C:\\Users\\First Last\\..."). Handed to a shell unquoted, that path was cut in two.
  if (PULLS_WITH_CLI) {
    const dir = project();
    const spaced = join(WORK, "dossier avec espace");
    mkdirSync(spaced, { recursive: true });
    const r = spawnSync(process.execPath, [join(SCRIPTS, "pull-env-vars.mjs"), "--target=preview", "--write-to-local"], {
      cwd: dir,
      env: { ...ENV, TEMP: spaced, TMP: spaced, TMPDIR: spaced },
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
    });
    const local = readFileSync(join(dir, ".env.local"), "utf8");
    check("a temporary folder whose path holds a space does not break the pull", r.status === 0 && /^NEXT_PUBLIC_URL=https:\/\/preview\.example$/m.test(local), (r.stderr || "").trim().slice(0, 200));
  }
  // ── 2. The machine-readable answer ───────────────────────────────────────
  if (PULLS_WITH_CLI) {
    const dir = project();
    const r = node("pull-env-vars.mjs", ["--target=production", "--json"], dir);
    let out = null;
    try {
      out = JSON.parse(r.stdout);
    } catch {
      out = null;
    }
    check("in JSON, a secret the host never gives back is null, never an empty value", out && out.SECRET_KEY === null && out.DATABASE_URL === null && out.PLAIN_FLAG === "on", r.stdout.slice(0, 200));
  }
  // ── 3. The dependency check that also reads production ───────────────────
  {
    const dir = project();
    const r = node("check-deps.mjs", ["db", "--include-vercel"], dir);
    let out = null;
    try {
      out = JSON.parse(r.stdout);
    } catch {
      out = null;
    }
    check("a database set up locally is not reported missing because production hides its value", out?.db?.ok === true, JSON.stringify(out?.db ?? r.stdout.slice(0, 200)));
    check("... and the check says which values the host would not give back", (out?._meta?.vercelPull?.unreadable ?? []).includes("DATABASE_URL") && !(out?._meta?.vercelPull?.keys ?? []).includes("DATABASE_URL"), JSON.stringify(out?._meta?.vercelPull ?? null));
  }
  // ── 4. The snapshot of /save-project ─────────────────────────────────────
  if (HAS_SNAPSHOT) {
    const dir = project();
    const git = (...a) => spawnSync("git", ["-c", "user.name=Recette", "-c", "user.email=recette@example.com", "-c", "core.hooksPath=/dev/null", ...a], { cwd: dir, encoding: "utf8", windowsHide: true });
    git("init", "-q");
    writeFileSync(join(dir, ".gitignore"), ".env*\n.vercel\n");
    git("add", "package.json", ".gitignore", "drizzle.config.ts");
    git("commit", "-q", "-m", "recette");
    const out = join(WORK, "sorties");
    mkdirSync(out, { recursive: true });
    const r = node("save-project/build-snapshot.mjs", ["--project", `projet-${n}`, "--project-dir", dir, "--out", out, "--skip-db", "--skip-storage", "--skip-memory"], dir);
    let report = null;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      report = null;
    }
    const sources = report?.steps?.["env-vars"]?.sources ?? [];
    const prod = sources.find((s) => s.source === "vercel" && s.env === "production");
    check("the snapshot is made", Boolean(report?.zipPath) && existsSync(report.zipPath), (r.stderr || "").trim().slice(-300));
    check("the production pull counts only the values it could read", prod?.vars === 5, JSON.stringify(prod));
    check("... and names the secrets the host never gives back", Array.isArray(prod?.unreadable) && prod.unreadable.includes("SECRET_KEY") && prod.unreadable.includes("DATABASE_URL"), JSON.stringify(prod));
    const local = sources.find((s) => s.source === "local" && s.file === ".env.local");
    check("the project's own files are saved beside it, with their values", local?.ok === true && local.vars === 2, JSON.stringify(local));
  }
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
