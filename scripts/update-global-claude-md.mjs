#!/usr/bin/env node
// update-global-claude-md.mjs - Idempotently maintain Hypervibe global rules in ~/.claude/CLAUDE.md
//
// The block of rules is delimited by:
//   <!-- hypervibe:rules -->
//   ...
//   <!-- /hypervibe:rules -->
//
// Each rule has its own stable id marker so the block can be extended over time
// without duplicating existing rules. Run as many times as you like - only the
// missing rules are added on each run.
//
// Behavior on the existing block:
//   - No block found      → create new block at the end of the file
//   - Block present, has per-rule markers → add only the rules that aren't there yet
//   - Block present but no per-rule markers (legacy block from older /start) → upgrade
//     to versioned block (replaces the entire block content with the current source of truth)
//
// stdout reports one of: "created", "upgraded", "no-change", "updated +N"

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// Args (machine-detected capabilities that toggle conditional rules below):
//   --with-neon       → adds the Neon rule (REST API + SQL-over-HTTP, key from the vault)
//
// All conditional rules are ADDITIVE: they're appended to the base set when the
// flag is set, never removed when the flag is absent on a re-run. If a capability
// goes away (e.g. user uninstalls the MCP), Claude will gracefully fall back to
// the secondary path documented in the rule itself - no need to retract the rule.
const args = new Set(process.argv.slice(2));

// Source of truth - to add a rule, append an entry here. The id MUST be stable.
// If you reword an existing rule's text, keep the same id; the upgrade path will
// pick up the new wording on legacy blocks but will leave versioned blocks alone
// (we don't aggressively rewrite - users may have edited).
const BASE_RULES = [
  {
    id: "vault-global-keys",
    text: "Coffre-fort de clés (Bitwarden) : les clés d'accès GLOBALES réutilisées entre projets (Cloudflare, Neon, email Resend/Brevo, Anthropic, hébergeur de domaine, etc.) vivent dans le coffre-fort, JAMAIS en clair ni collées dans le chat. Scripts du plugin Hypervibe dans `~/.claude/plugins/marketplaces/local-desktop-app-uploads/hypervibe/scripts/vault/`. AJOUTER une clé : `node <…>/scripts/vault/launch.mjs add --name <SERVICE> --service <Nom> --fields \"api_key:secret\"` (la valeur se saisit dans une fenêtre masquée, jamais via Claude). LIRE une clé : `node <…>/scripts/vault/vault.mjs get <SERVICE> <champ>` (exit 2/3 = coffre verrouillé → `launch.mjs unlock`, exit 4 = absente). Déverrouillage 1×/jour. Les secrets PROPRES à un projet (`DATABASE_URL`, `AUTH_SECRET`…) restent dans le `.env` + Vercel, pas dans le coffre.",
  },
  {
    id: "no-build-for-verify",
    text: "Ne jamais lancer `pnpm build` pour vérifier que le code fonctionne. Utiliser uniquement `pnpm lint` (et `pnpm tsc --noEmit` si du typage TypeScript est concerné). Le build est lent, peut entrer en conflit avec un dev server en cours, et n'est nécessaire qu'au moment d'un déploiement.",
  },
  {
    id: "no-push-without-consent",
    text: "Ne jamais faire de `git push` ou de déploiement Vercel sans accord explicite de l'utilisateur dans le chat. Seule exception : le tout premier `/bootstrap` qui inclut un déploiement initial pour valider l'infrastructure du projet.",
  },
  {
    id: "cursor-pointer-hover",
    text: "UX : tous les liens et éléments cliquables doivent avoir `cursor-pointer` au hover.",
  },
  {
    id: "todo-list-complex-tasks",
    text: "Workflow : pour les tâches complexes (plus de 3-4 fichiers à modifier), créer une todo list numérotée, l'afficher dans le chat, et la mettre à jour au fur et à mesure de l'avancement (✅ pour fait, ⏳ pour en cours).",
  },
  {
    id: "image-placeholders-picsum",
    text: "Placeholders d'images : jamais de chemin local inventé (`/images/hero.jpg` sans le fichier = 404). Défaut = Lorem Picsum avec seed : `https://picsum.photos/seed/<keyword>/<w>/<h>` (URL déterministe, même image entre rebuilds). Toujours wrapper dans `<Image>` de `next/image` avec un `alt` descriptif.",
  },
  {
    id: "responsive-mobile-first",
    text: "Responsive : tous les composants et pages doivent être responsive, mobile-first. Toujours vérifier que le layout fonctionne sur mobile (< 640px) et desktop.",
  },
  {
    id: "typescript-no-any",
    text: "TypeScript : ne jamais utiliser `any`. Typer correctement toutes les fonctions, variables et props.",
  },
  {
    id: "no-em-dash-in-ui",
    text: "Typographie : ne jamais utiliser le tiret cadratin (le long tiret, dit « em dash ») dans les textes affichés à l'utilisateur. Utiliser un tiret normal (-) ou reformuler la phrase.",
  },
  {
    id: "jsx-apostrophe",
    text: "JSX / apostrophes : dans le texte libre JSX (`<p>l'IA</p>`), ne jamais utiliser l'apostrophe ASCII `'` - elle casse `next build` via la règle ESLint `react/no-unescaped-entities` (erreur bloquante), et `pnpm tsc --noEmit` ne la détecte pas. Toujours l'apostrophe typographique `’` (U+2019), un vrai caractère UTF-8 accepté par la règle ET conforme à l'interdiction des entités HTML (donc jamais `&rsquo;` / `&apos;` non plus). Vérifier tout edit `.tsx` avec `pnpm lint` en plus de `pnpm tsc --noEmit`.",
  },
  {
    id: "deps-audit-before-prod",
    text: "Sécurité : avant chaque déploiement prod, auditer les dépendances avec `npm install --package-lock-only --silent && npm audit --omit=dev && rm -f package-lock.json` (pnpm audit hit l'ancien endpoint déprécié en HTTP 410). Corriger les vulnérabilités critiques et hautes avec `pnpm update <pkg>@<safe-version>`.",
  },
  {
    id: "urls-slugs-kebab-case",
    text: "URLs/slugs (SEO) : toutes les routes en kebab-case ASCII (`/mon-article`, jamais `/monArticle` ni `/mon_article` ni `/MonArticle`). Courtes (3-5 mots max) et descriptives avec le mot-clé principal. Pas d'IDs numériques dans l'URL (`/blog/mon-titre` plutôt que `/blog/123`). Pour les routes dynamiques Next.js, préférer `[slug]` à `[id]`. Éviter les mots vides.",
  },
];

// Capability-conditioned rules - added only when /start (or another caller)
// confirms the corresponding tooling is available on this machine.
const CONDITIONAL_RULES = [
  {
    id: "neon-rest-vault",
    enabledBy: "--with-neon",
    text: "Neon : provisioning + gestion via l'API REST `https://console.neon.tech/api/v2/...` avec la clé `NEON.api_key` rangée dans le coffre-fort (Bitwarden). Exécution de SQL via le helper `scripts/neon/run-sql.mjs` du plugin (SQL-over-HTTP, pas besoin de psql) : `node run-sql.mjs \"SELECT ...\"` (lit `DATABASE_URL` du `.env` du projet) ou `--conn <url>`.",
  },
  {
    id: "gitleaks-global-hook",
    enabledBy: "--with-gitleaks",
    text: "Gitleaks : un hook git global (`~/.git-hooks/pre-commit`) scanne chaque `git commit` et bloque les secrets détectés (configuré au dernier `/start`). Si un commit légitime est bloqué (faux positif sur une fixture, un placeholder), bypass exceptionnel avec `git commit --no-verify`, ou ajouter une exception durable dans `~/.gitleaks.toml`. Ne jamais désactiver le hook globalement (`git config --global --unset core.hooksPath`) - c'est la protection anti-fuite de tous les repos de la machine.",
  },
];

// Build the effective rule list: base + any conditional rules whose flag is set.
const RULES = [
  ...BASE_RULES,
  ...CONDITIONAL_RULES.filter((r) => args.has(r.enabledBy)),
];

const OPEN = "<!-- hypervibe:rules -->";
const CLOSE = "<!-- /hypervibe:rules -->";
const HEADING = "## Règles globales (Hypervibe)";

function buildRuleLines(rules) {
  const lines = [];
  for (const r of rules) {
    lines.push(`<!-- rule:${r.id} -->`);
    lines.push(`- ${r.text}`);
  }
  return lines.join("\n");
}

function buildBlock(rules) {
  return [OPEN, HEADING, "", buildRuleLines(rules), CLOSE].join("\n");
}

const file = join(homedir(), ".claude", "CLAUDE.md");
mkdirSync(dirname(file), { recursive: true });

const before = existsSync(file) ? readFileSync(file, "utf8") : "";

// Find the existing block, if any.
const blockRe = new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}`);
const match = before.match(blockRe);

let after = before;
let result;

if (!match) {
  const desired = buildBlock(RULES);
  const sep = !before ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  after = before + sep + desired + "\n";
  result = "created";
} else {
  const existingBlock = match[0];
  const existingIds = new Set(
    [...existingBlock.matchAll(/<!-- rule:([\w-]+) -->/g)].map((m) => m[1]),
  );

  if (existingIds.size === 0) {
    // Legacy block: no per-rule markers. Replace entirely with the current source of truth.
    after = before.replace(blockRe, buildBlock(RULES));
    result = "upgraded";
  } else {
    const missing = RULES.filter((r) => !existingIds.has(r.id));
    if (missing.length === 0) {
      result = "no-change";
    } else {
      // Append missing rules right before the CLOSE marker, keep the rest intact.
      const closeIdx = existingBlock.lastIndexOf(CLOSE);
      const additions = "\n" + buildRuleLines(missing) + "\n";
      const newBlock =
        existingBlock.slice(0, closeIdx) + additions + existingBlock.slice(closeIdx);
      after = before.replace(blockRe, newBlock);
      result = `updated +${missing.length}`;
    }
  }
}

if (after !== before) {
  writeFileSync(file, after, "utf8");
}

console.log(result);
