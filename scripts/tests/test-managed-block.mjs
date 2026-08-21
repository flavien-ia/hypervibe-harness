#!/usr/bin/env node
// test-managed-block.mjs - Recette of the managed rule blocks.
//
// A guardrail is only acquired once you have seen it do BOTH things: act when
// it must, and stay out of the way when it must not. For a block that rewrites
// a file the user also owns, "stay out of the way" is the half that matters:
// a sync that quietly overwrote an edited rule, or touched a byte outside its
// own markers, would be worse than the additive script it replaces.
//
//   node scripts/tests/test-managed-block.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { CATALOG } from "../rules/rules.mjs";
import { shortSha } from "../rules/managed-block.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_CLI = join(SCRIPTS, "update-global-claude-md.mjs");
const PROJECT_CLI = join(SCRIPTS, "rules", "update-project-claude-md.mjs");

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const rule = (id) => CATALOG.find((r) => r.id === id);
const boxes = [];
function box() {
  const d = mkdtempSync(join(tmpdir(), "hv-rules-"));
  boxes.push(d);
  return d;
}

/** Writes a global CLAUDE.md made of: user text, a block built from `entries`,
 *  more user text. `entries` are [id, text, withSha] triples. */
function writeGlobal(home, entries, { crlf = false, withBlock = true } = {}) {
  const lines = [];
  lines.push("# Mon CLAUDE.md", "", "- Une note personnelle a moi.", "");
  if (withBlock) {
    lines.push("<!-- hypervibe:rules -->");
    lines.push("## Regles globales (Hypervibe)");
    lines.push("");
    for (const [id, text, withSha] of entries) {
      lines.push(withSha ? `<!-- rule:${id} sha:${shortSha(text)} -->` : `<!-- rule:${id} -->`);
      lines.push(`- ${text}`);
    }
    lines.push("<!-- /hypervibe:rules -->");
  }
  lines.push("", "## Ma section a moi", "", "- Encore du contenu.", "");
  const content = lines.join(crlf ? "\r\n" : "\n");
  const file = join(home, ".claude", "CLAUDE.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return file;
}

function runGlobal(home, extra = []) {
  const out = execFileSync(process.execPath, [GLOBAL_CLI, "--home", home, ...extra], {
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split("\n").pop());
}
function runProject(dir, extra = []) {
  const out = execFileSync(process.execPath, [PROJECT_CLI, "--dir", dir, ...extra], {
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split("\n").pop());
}
const read = (f) => readFileSync(f, "utf8");

// ── a. No file at all ────────────────────────────────────────────────
{
  const home = box();
  const r = runGlobal(home);
  const file = join(home, ".claude", "CLAUDE.md");
  check("a. fichier absent -> cree", r.result === "created" && existsSync(file), r.result);
  check("a. les regles globales y sont", r.added.includes("vault-global-keys") && r.added.length >= 5, `${r.added.length} regles`);
  check("a. chaque marqueur porte une empreinte", !/<!-- rule:[\w-]+ -->/.test(read(file)));
}

// ── b. Current shipped format (markers, no fingerprint), untouched ───
{
  const home = box();
  const ids = ["no-build-for-verify", "no-push-without-consent", "todo-list-complex-tasks"];
  const file = writeGlobal(home, ids.map((id) => [id, rule(id).text, false]));
  const r = runGlobal(home);
  const after = read(file);
  check("b. adopte sans rien reecrire", r.updated.length === 0 && r.keptEdited.length === 0, `updated=${r.updated}`);
  check("b. empreintes posees", ids.every((id) => new RegExp(`<!-- rule:${id} sha:[0-9a-f]{12} -->`).test(after)));
  check("b. textes intacts", ids.every((id) => after.includes(rule(id).text)));
}

// ── c. An older shipped wording is recognised and updated ────────────
{
  const home = box();
  const r0 = rule("no-build-for-verify");
  const ancien = r0.previousTexts[0];
  const file = writeGlobal(home, [["no-build-for-verify", ancien, false]]);
  const r = runGlobal(home);
  const after = read(file);
  check("c. ancienne formulation -> mise a jour", r.updated.includes("no-build-for-verify"), `updated=${r.updated}`);
  check("c. texte courant en place", after.includes(r0.text) && !after.includes(ancien));
}

// ── d. A rule the user edited is theirs ──────────────────────────────
{
  const home = box();
  const mien = "Ne jamais lancer `pnpm build`, sauf le vendredi (ma version a moi).";
  const file = writeGlobal(home, [["no-build-for-verify", mien, false]]);
  const r = runGlobal(home);
  const after = read(file);
  check("d. regle editee -> conservee", r.keptEdited.includes("no-build-for-verify"), `keptEdited=${r.keptEdited}`);
  check("d. conservee a l'octet pres", after.includes(`- ${mien}`));
  check("d. pas de doublon", after.split("no-build-for-verify").length - 1 === 1);
}

// ── d.bis Same, with a fingerprint that no longer matches ────────────
{
  const home = box();
  const r0 = rule("no-push-without-consent");
  const file = join(home, ".claude", "CLAUDE.md");
  mkdirSync(dirname(file), { recursive: true });
  // Fingerprint of the delivered text, but the text has since been edited.
  writeFileSync(
    file,
    [
      "<!-- hypervibe:rules -->",
      "## Regles globales (Hypervibe)",
      "",
      `<!-- rule:no-push-without-consent sha:${shortSha(r0.text)} -->`,
      "- Ma version personnelle de la regle de push.",
      "<!-- /hypervibe:rules -->",
      "",
    ].join("\n"),
    "utf8",
  );
  const r = runGlobal(home);
  check("d.bis empreinte qui ne correspond plus -> conservee", r.keptEdited.includes("no-push-without-consent"));
  check("d.bis texte personnel intact", read(file).includes("- Ma version personnelle de la regle de push."));
}

// ── e. A retired rule goes, unless it was edited ─────────────────────
{
  const home = box();
  const retiree = rule("deps-audit-before-prod");
  const file = writeGlobal(home, [["deps-audit-before-prod", retiree.previousTexts[0], false]]);
  const r = runGlobal(home);
  check("e. regle retiree (ancien texte casse) -> supprimee", r.retired.includes("deps-audit-before-prod"), `retired=${r.retired}`);
  check("e. absente du fichier", !read(file).includes("deps-audit-before-prod"));

  const home2 = box();
  const file2 = writeGlobal(home2, [["deps-audit-before-prod", "Mon audit a moi, que je garde.", false]]);
  const r2 = runGlobal(home2);
  check("e. regle retiree mais editee -> conservee", r2.keptEdited.includes("deps-audit-before-prod"));
  check("e. texte personnel intact", read(file2).includes("- Mon audit a moi, que je garde."));
}

// ── f. A project rule sitting in the global block goes home ──────────
{
  const home = box();
  const file = writeGlobal(home, [["cursor-pointer-hover", rule("cursor-pointer-hover").text, false]]);
  const r = runGlobal(home);
  check("f. regle de scope projet -> retiree du global", r.retired.includes("cursor-pointer-hover"));
  check("f. absente du bloc global", !read(file).includes("cursor-pointer-hover"));
}

// ── g. An id we know nothing about is left alone ─────────────────────
{
  const home = box();
  const file = writeGlobal(home, [["ma-regle-perso", "Toujours commencer par un cafe.", false]]);
  const r = runGlobal(home);
  const after = read(file);
  check("g. id inconnu -> signale", r.unknown.includes("ma-regle-perso"), `unknown=${r.unknown}`);
  check("g. id inconnu -> intact", after.includes("- Toujours commencer par un cafe."));
}

// ── h. Idempotence ───────────────────────────────────────────────────
{
  const home = box();
  runGlobal(home);
  const file = join(home, ".claude", "CLAUDE.md");
  const avant = read(file);
  const r2 = runGlobal(home);
  check("h. second passage -> no-change", r2.result === "no-change", r2.result);
  check("h. octet pour octet identique", read(file) === avant);
}

// ── i. Nothing outside the block moves, CRLF included ────────────────
{
  const home = box();
  const file = writeGlobal(home, [["no-build-for-verify", rule("no-build-for-verify").previousTexts[0], false]], { crlf: true });
  const avant = readFileSync(file);
  const coupe = (buf) => {
    const s = buf.toString("utf8");
    const i = s.indexOf("<!-- hypervibe:rules -->");
    const j = s.indexOf("<!-- /hypervibe:rules -->") + "<!-- /hypervibe:rules -->".length;
    return [s.slice(0, i), s.slice(j)];
  };
  const [avantDebut, avantFin] = coupe(avant);
  runGlobal(home);
  const apres = readFileSync(file);
  const [apresDebut, apresFin] = coupe(apres);
  check("i. contenu avant le bloc identique", avantDebut === apresDebut);
  check("i. contenu apres le bloc identique", avantFin === apresFin);
  check("i. CRLF preserve dans le bloc", !/[^\r]\n/.test(apres.toString("utf8")));
}

// ── j. Dry run writes nothing ────────────────────────────────────────
{
  const home = box();
  const file = writeGlobal(home, [["no-build-for-verify", "Texte a mettre a jour.", false]]);
  const avant = readFileSync(file);
  const r = runGlobal(home, ["--dry-run"]);
  check("j. dry-run rapporte", r.result !== "no-change", r.result);
  check("j. dry-run n'ecrit rien", Buffer.compare(avant, readFileSync(file)) === 0);
}

// ── k/l/m. The project block ─────────────────────────────────────────
{
  const dir = box();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo", dependencies: { next: "15.0.0", "drizzle-orm": "0.44.0" } }), "utf8");
  const claude = join(dir, "CLAUDE.md");
  writeFileSync(
    claude,
    ["# demo", "", "## Stack", "", "- **Database**: Neon PostgreSQL", "", "## Conventions", "", "- DB: import from `@demo/db`.", "", "## Environment Variables", "", "- `DATABASE_URL`", ""].join("\n"),
    "utf8",
  );
  const r = runProject(dir);
  const after = read(claude);
  check("k. bloc projet cree", r.result === "created" && after.includes("<!-- hypervibe:project-rules -->"), r.result);
  check("k. pose sous ## Conventions", after.indexOf("## Conventions") < after.indexOf("<!-- hypervibe:project-rules -->"));
  check("k. avant ## Environment Variables", after.indexOf("<!-- /hypervibe:project-rules -->") < after.indexOf("## Environment Variables"));
  check("k. regle Neon presente (drizzle detecte)", after.includes("neon-rest-vault"));
  check("k. regles globales absentes du projet", !after.includes("vault-global-keys"));
  check("m. lignes des skills add-* intactes", after.includes("- DB: import from `@demo/db`.") && after.includes("- **Database**: Neon PostgreSQL"));
  const r2 = runProject(dir);
  check("l. second passage -> no-change", r2.result === "no-change", r2.result);
}

// ── n. A project without Neon does not get the Neon rule ─────────────
{
  const dir = box();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "vitrine", dependencies: { next: "15.0.0" } }), "utf8");
  const r = runProject(dir);
  check("n. pas de base -> pas de regle Neon", !r.added.includes("neon-rest-vault"), `added=${r.added.length}`);
}

for (const d of boxes) rmSync(d, { recursive: true, force: true });

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
