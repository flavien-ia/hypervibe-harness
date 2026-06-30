#!/usr/bin/env node
// remember-global-key.mjs
// Documente une clé du coffre dans le CLAUDE.md global de l'utilisateur
// (~/.claude/CLAUDE.md), de façon idempotente. Sert aux skills qui stockent une
// clé globale réutilisable (ex: seo-perf -> PAGESPEED), pour que l'utilisateur
// la retrouve documentée dans sa mémoire Claude Code.
//
// Comportement :
//   - Si la clé (--name) est déjà mentionnée n'importe où dans le fichier -> no-op
//     (idempotent ; évite aussi de dupliquer une entrée déjà rédigée à la main).
//   - Sinon, ajoute une ligne sous une section gérée "## Clés API enregistrées
//     par les skills". Crée la section (et le fichier) si besoin.
//
// Usage :
//   node remember-global-key.mjs --name PAGESPEED --line "PAGESPEED (api_key) : ..."

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : "";
}

const name = arg("--name");
const line = arg("--line");
if (!name || !line) {
  console.log("SKIP: --name et --line requis");
  process.exit(0);
}

const file = path.join(os.homedir(), ".claude", "CLAUDE.md");
let content = "";
try {
  content = fs.readFileSync(file, "utf8");
} catch {
  content = ""; // le fichier n'existe pas encore
}

// Idempotent : si la clé est déjà documentée (table à la main, ou run précédent), ne rien faire.
if (content.includes(name)) {
  console.log(`ALREADY: ${name} déjà documentée`);
  process.exit(0);
}

const HEADING = "## Clés API enregistrées par les skills";
const entry = `- ${line}`;

let out;
if (content.includes(HEADING + "\n")) {
  // Insérer la nouvelle entrée juste sous la section gérée existante.
  out = content.replace(HEADING + "\n", `${HEADING}\n${entry}\n`);
} else {
  const sep = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  out = `${content}${sep}${HEADING}\n\n${entry}\n`;
}

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out, "utf8");
console.log(`ADDED: ${name}`);
