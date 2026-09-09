#!/usr/bin/env node
// scripts/check-recette.mjs - Le cahier de recette et les tests se répondent-ils ?
//
// Installé par la skill /add-test d'Hypervibe. Lancé par le hook pre-push
// (.hooks/pre-push) et par l'intégration continue : un push est refusé tant que
// ce contrôle n'est pas vert. Trois règles, et rien d'autre :
//
//   1. Chaque ligne de docs/recette.md marquée « test » est couverte par au
//      moins un test qui porte son identifiant (commentaire `recette: R-12`).
//   2. Chaque procédure tRPC (src/server/api/routers/*.ts) est exercée par au
//      moins un test : c'est la définition mécanique de « chaque fonctionnalité
//      a son test ».
//   3. Chaque page (src/app/**/page.tsx) figure dans le cahier de recette,
//      fût-ce en vérification manuelle : une page qui n'est nulle part n'est
//      recettée par personne.
//
//   node scripts/check-recette.mjs              contrôle, sort 0 si complet, 1 sinon
//   node scripts/check-recette.mjs --inventaire  l'état des lieux en JSON (pour
//                                                écrire ou compléter la recette)
//
// Sans docs/recette.md le contrôle sort en 2 : le projet n'est pas équipé, ce
// n'est pas une faute, mais le hook et la CI doivent le savoir.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const RECETTE = join(ROOT, "docs", "recette.md");
const ROOT_TS = join(ROOT, "src", "server", "api", "root.ts");
const APP_DIR = join(ROOT, "src", "app");
const INVENTAIRE = process.argv.includes("--inventaire");

// ─── Parcours de fichiers ────────────────────────────────────────────────────

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join("/");

// ─── Les routeurs et leurs procédures ────────────────────────────────────────

/** `clé -> fichier` d'après root.ts (`contact: contactRouter` + son import). */
function routerKeys() {
  const map = new Map();
  if (!existsSync(ROOT_TS)) return map;
  const src = readFileSync(ROOT_TS, "utf8");
  const imports = new Map();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const name of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop())) {
      if (name) imports.set(name, m[2]);
    }
  }
  const body = src.match(/createTRPCRouter\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!body) return map;
  for (const m of body[1].matchAll(/([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]+)/g)) {
    const path = imports.get(m[2]);
    if (!path) continue;
    const file = path.replace(/^~\//, "src/").replace(/^\.\//, "src/server/api/");
    map.set(m[1], file.endsWith(".ts") ? file : `${file}.ts`);
  }
  return map;
}

function procedures(file) {
  if (!existsSync(join(ROOT, file))) return [];
  const src = readFileSync(join(ROOT, file), "utf8");
  const out = [];
  for (const m of src.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:\s*[a-zA-Z]*Procedure\b/gm)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const routers = [...routerKeys()].map(([key, file]) => ({
  key,
  file,
  procedures: procedures(file),
}));

// ─── Les pages ───────────────────────────────────────────────────────────────

const pages = walk(APP_DIR, (f) => /[\\/]page\.tsx?$/.test(f))
  .map((f) => rel(f))
  .filter((f) => !f.startsWith("src/app/api/"))
  .map((f) => {
    const route =
      "/" +
      f
        .replace(/^src\/app\//, "")
        .replace(/\/?page\.tsx?$/, "")
        .split("/")
        .filter((seg) => seg && !/^\(.*\)$/.test(seg) && seg !== "[locale]")
        .join("/");
    return { file: f, route: route === "/" ? "/" : route.replace(/\/$/, "") };
  });

// ─── Les tests ───────────────────────────────────────────────────────────────

const testFiles = [
  ...walk(join(ROOT, "tests"), (f) => /\.test\.tsx?$/.test(f)),
  ...walk(join(ROOT, "src"), (f) => /\.test\.tsx?$/.test(f)),
].map((f) => ({ file: rel(f), text: readFileSync(f, "utf8") }));

const tagsCouverts = new Set();
for (const t of testFiles) {
  for (const m of t.text.matchAll(/recette\s*:\s*([^\n*/]+)/gi)) {
    for (const id of m[1].split(/[,\s]+/)) {
      if (/^R-\d+$/i.test(id)) tagsCouverts.add(id.toUpperCase());
    }
  }
}

function procedureCouverte(key, proc) {
  const direct = new RegExp(`\\b${key}\\.${proc}\\b`);
  return testFiles.some((t) => direct.test(t.text));
}

// ─── Le cahier ───────────────────────────────────────────────────────────────

function lireRecette() {
  if (!existsSync(RECETTE)) return null;
  const text = readFileSync(RECETTE, "utf8");
  const lignes = [];
  let colVerif = -1;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (colVerif === -1 && cells.some((c) => /v[ée]rifi/i.test(c))) {
      colVerif = cells.findIndex((c) => /v[ée]rifi[ée]e?\s*par|v[ée]rification/i.test(c));
      if (colVerif === -1) colVerif = cells.findIndex((c) => /v[ée]rifi/i.test(c));
      continue;
    }
    if (!/^R-\d+$/i.test(cells[0] ?? "")) continue;
    const verif = colVerif >= 0 ? (cells[colVerif] ?? "") : (cells.at(-1) ?? "");
    lignes.push({
      id: cells[0].toUpperCase(),
      titre: cells[1] ?? "",
      auto: /\btest\b|auto/i.test(verif) && !/manuel/i.test(verif),
      texte: cells.join(" "),
    });
  }
  return { text, lignes };
}

const recette = lireRecette();

function pageDansRecette(route, text) {
  // La racine n'a pas de chemin qui se cherche : on accepte `/` ou le mot accueil.
  if (route === "/") return /`\/`|accueil|home\s*page|page d.accueil/i.test(text);
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w/])${escaped}(?=$|[^\\w/-])`, "m").test(text);
}

// ─── Inventaire (pour écrire la recette) ─────────────────────────────────────

if (INVENTAIRE) {
  process.stdout.write(
    JSON.stringify(
      {
        routers,
        pages,
        tests: testFiles.map((t) => t.file),
        recette: recette
          ? {
              ids: recette.lignes.map((l) => l.id),
              auto: recette.lignes.filter((l) => l.auto).map((l) => l.id),
              manuel: recette.lignes.filter((l) => !l.auto).map((l) => l.id),
            }
          : null,
        proceduresSansTest: routers.flatMap((r) =>
          r.procedures.filter((p) => !procedureCouverte(r.key, p)).map((p) => `${r.key}.${p}`),
        ),
        pagesHorsRecette: recette
          ? pages.filter((p) => !pageDansRecette(p.route, recette.text)).map((p) => p.route)
          : pages.map((p) => p.route),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ─── Contrôle ────────────────────────────────────────────────────────────────

if (!recette) {
  console.log("[recette] Pas de docs/recette.md : le projet n'est pas équipé (lancez /add-test).");
  process.exit(2);
}

const manques = [];

for (const l of recette.lignes) {
  if (l.auto && !tagsCouverts.has(l.id)) {
    manques.push(`${l.id} « ${l.titre} » est marquée « test » mais aucun test ne porte \`recette: ${l.id}\``);
  }
}

for (const r of routers) {
  for (const p of r.procedures) {
    if (!procedureCouverte(r.key, p)) {
      manques.push(`procédure ${r.key}.${p} (${r.file}) : aucun test ne l'exerce`);
    }
  }
}

for (const p of pages) {
  if (!pageDansRecette(p.route, recette.text)) {
    manques.push(`page ${p.route} (${p.file}) : absente du cahier de recette`);
  }
}

const orphelins = [...tagsCouverts].filter((id) => !recette.lignes.some((l) => l.id === id));

const nbAuto = recette.lignes.filter((l) => l.auto).length;
const nbProc = routers.reduce((n, r) => n + r.procedures.length, 0);
console.log(
  `[recette] ${recette.lignes.length} lignes (${nbAuto} par test, ${recette.lignes.length - nbAuto} manuelles), ` +
    `${nbProc} procédures, ${pages.length} pages, ${testFiles.length} fichiers de test.`,
);
if (orphelins.length) {
  console.log(`[recette] Avertissement : tests tagués sans ligne de recette : ${orphelins.join(", ")}`);
}
if (manques.length === 0) {
  console.log("[recette] Complet : chaque fonctionnalité a sa vérification.");
  process.exit(0);
}
console.log(`[recette] ${manques.length} manque${manques.length > 1 ? "s" : ""} :`);
for (const m of manques) console.log(`  - ${m}`);
console.log(
  "[recette] Pour compléter : ouvrez Claude Code et demandez « complète la recette et les tests manquants » (la règle est dans CLAUDE.md).",
);
process.exit(1);
