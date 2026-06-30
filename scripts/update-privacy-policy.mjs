#!/usr/bin/env node
// update-privacy-policy.mjs - Idempotently add or remove subprocessors in
// the project's RGPD subprocessors registry.
//
// Architecture:
//   - Data lives in `<web-root>/src/lib/subprocessors.json` (just an array of
//     entries). The script edits this file deterministically.
//   - A thin TS wrapper at `<web-root>/src/lib/subprocessors.ts` re-exports
//     the JSON with a typed signature. The page imports from the TS file.
//   - The page itself (`src/app/.../politique-de-confidentialite/page.tsx`)
//     is generated once by /bootstrap as a pure renderer over the registry.
//     It is never touched by this script - only the data file is.
//
// Usage:
//   node update-privacy-policy.mjs --add stripe
//   node update-privacy-policy.mjs --add neon --add resend
//   node update-privacy-policy.mjs --remove brevo
//   node update-privacy-policy.mjs --list
//   node update-privacy-policy.mjs --catalog
//
// Runs from the project root (where package.json or apps/web/package.json lives).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// ─── Catalogue des sous-traitants connus ──────────────────────────────────
// Les valeurs racine (purpose, dataTypes, retention, legalBasis,
// transferMechanism) sont en français par défaut (la PdC est en français
// quand le projet est mono-lingue).
//
// Chaque entrée a un bloc optionnel `i18n: { <locale>: { ... } }` avec les
// traductions des cinq champs textuels. La page i18n de PdC pioche dans
// `entry.i18n[locale]` avec fallback sur les valeurs racine. Anglais fourni
// d'usine ; pour ajouter une autre langue (es, de, etc.), étendre `i18n`.
//
// Les entrées correspondent une-pour-une aux skills /add-* du plugin.
const CATALOG = {
  vercel: {
    name: "Vercel Inc.",
    address: "440 N Barranca Ave #4133, Covina, CA 91723, USA",
    country: "US",
    purpose: "Hébergement du site et exécution des fonctions serveur (région Frankfurt - fra1)",
    dataTypes: ["Adresses IP", "Logs serveur", "Cookies de session"],
    retention: "30 jours pour les logs",
    legalBasis: "Intérêt légitime (art. 6.1.f RGPD)",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT). Fonctions exécutées en UE (Frankfurt) mais entité juridique américaine",
    privacyUrl: "https://vercel.com/legal/privacy-policy",
    dpaUrl: "https://vercel.com/legal/dpa",
    i18n: {
      en: {
        purpose: "Hosting and serverless function execution (Frankfurt region - fra1)",
        dataTypes: ["IP addresses", "Server logs", "Session cookies"],
        retention: "30 days for logs",
        legalBasis: "Legitimate interest (Art. 6.1.f GDPR)",
        transferMechanism: "Standard Contractual Clauses (SCC). Functions run in the EU (Frankfurt) but legal entity is US-based",
      },
    },
  },
  neon: {
    name: "Databricks, Inc. (Neon)",
    address: "160 Spear Street, 13th Floor, San Francisco, CA 94105, USA",
    country: "US",
    purpose: "Hébergement de la base de données PostgreSQL",
    dataTypes: ["Toutes les données applicatives stockées en base"],
    retention: "Durée de vie du compte (suppression sur demande)",
    legalBasis: "Exécution du contrat (art. 6.1.b RGPD)",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT). Région de la base configurable (eu-central-1 disponible)",
    privacyUrl: "https://neon.tech/privacy-policy",
    dpaUrl: "https://neon.tech/dpa",
    i18n: {
      en: {
        purpose: "PostgreSQL database hosting",
        dataTypes: ["All application data stored in the database"],
        retention: "Account lifetime (deletion on request)",
        legalBasis: "Contract performance (Art. 6.1.b GDPR)",
        transferMechanism: "Standard Contractual Clauses (SCC). Database region configurable (eu-central-1 available)",
      },
    },
  },
  stripe: {
    name: "Stripe Payments Europe, Limited",
    address: "1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irlande",
    country: "IE",
    purpose: "Traitement des paiements par carte bancaire",
    dataTypes: [
      "Nom",
      "Email",
      "Adresse de facturation",
      "Informations de paiement (les numéros de carte ne transitent pas par notre serveur, saisie directe chez Stripe)",
    ],
    retention: "Durée légale comptable (10 ans en France)",
    legalBasis: "Exécution du contrat (art. 6.1.b RGPD) + obligation légale (art. 6.1.c)",
    isEUResident: true,
    transferMechanism: "Données techniques peuvent être transférées à Stripe, Inc. (USA) via Clauses contractuelles types",
    privacyUrl: "https://stripe.com/privacy",
    dpaUrl: "https://stripe.com/legal/dpa",
    i18n: {
      en: {
        purpose: "Card payment processing",
        dataTypes: [
          "Name",
          "Email",
          "Billing address",
          "Payment information (card numbers never transit through our server, entered directly with Stripe)",
        ],
        retention: "Legal accounting period (10 years in France)",
        legalBasis: "Contract performance (Art. 6.1.b GDPR) + legal obligation (Art. 6.1.c)",
        transferMechanism: "Technical data may be transferred to Stripe, Inc. (USA) via Standard Contractual Clauses",
      },
    },
  },
  "google-oauth": {
    name: "Google Ireland Limited",
    address: "Gordon House, Barrow Street, Dublin 4, Irlande",
    country: "IE",
    purpose: "Authentification via compte Google (OAuth)",
    dataTypes: ["Email", "Nom", "Photo de profil"],
    retention: "Durée de vie du compte utilisateur",
    legalBasis: "Consentement (art. 6.1.a RGPD)",
    isEUResident: true,
    transferMechanism: "Transferts possibles vers Google LLC (USA) via Clauses contractuelles types",
    privacyUrl: "https://policies.google.com/privacy",
    i18n: {
      en: {
        purpose: "Authentication via Google account (OAuth)",
        dataTypes: ["Email", "Name", "Profile picture"],
        retention: "User account lifetime",
        legalBasis: "Consent (Art. 6.1.a GDPR)",
        transferMechanism: "Possible transfers to Google LLC (USA) via Standard Contractual Clauses",
      },
    },
  },
  "github-oauth": {
    name: "GitHub, Inc.",
    address: "88 Colin P. Kelly Jr. St., San Francisco, CA 94107, USA",
    country: "US",
    purpose: "Authentification via compte GitHub (OAuth)",
    dataTypes: ["Email", "Nom d'utilisateur GitHub", "Photo de profil"],
    retention: "Durée de vie du compte utilisateur",
    legalBasis: "Consentement (art. 6.1.a RGPD)",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT)",
    privacyUrl: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
    i18n: {
      en: {
        purpose: "Authentication via GitHub account (OAuth)",
        dataTypes: ["Email", "GitHub username", "Profile picture"],
        retention: "User account lifetime",
        legalBasis: "Consent (Art. 6.1.a GDPR)",
        transferMechanism: "Standard Contractual Clauses (SCC)",
      },
    },
  },
  resend: {
    name: "Resend Inc.",
    address: "2261 Market Street #4667, San Francisco, CA 94114, USA",
    country: "US",
    purpose: "Envoi d'emails transactionnels",
    dataTypes: ["Email destinataire", "Contenu des emails envoyés"],
    retention: "30 jours pour les logs d'envoi",
    legalBasis: "Exécution du contrat / intérêt légitime",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT)",
    privacyUrl: "https://resend.com/legal/privacy-policy",
    dpaUrl: "https://resend.com/legal/dpa",
    i18n: {
      en: {
        purpose: "Transactional email delivery",
        dataTypes: ["Recipient email", "Content of sent emails"],
        retention: "30 days for delivery logs",
        legalBasis: "Contract performance / legitimate interest",
        transferMechanism: "Standard Contractual Clauses (SCC)",
      },
    },
  },
  brevo: {
    name: "Sendinblue SAS (Brevo)",
    address: "17 rue Salneuve, 75017 Paris, France",
    country: "FR",
    purpose: "Envoi d'emails transactionnels et campagnes",
    dataTypes: ["Email destinataire", "Nom (si fourni)", "Contenu des emails envoyés"],
    retention: "6 mois pour les logs d'envoi",
    legalBasis: "Exécution du contrat / intérêt légitime",
    isEUResident: true,
    transferMechanism: null,
    privacyUrl: "https://www.brevo.com/legal/privacypolicy/",
    dpaUrl: "https://www.brevo.com/legal/data-processing-agreement/",
    i18n: {
      en: {
        purpose: "Transactional email and campaign delivery",
        dataTypes: ["Recipient email", "Name (if provided)", "Content of sent emails"],
        retention: "6 months for delivery logs",
        legalBasis: "Contract performance / legitimate interest",
      },
    },
  },
  "cloudflare-r2": {
    name: "Cloudflare, Inc.",
    address: "101 Townsend Street, San Francisco, CA 94107, USA",
    country: "US",
    purpose: "Stockage et distribution de fichiers (objets binaires uploadés)",
    dataTypes: ["Fichiers uploadés par les utilisateurs", "Métadonnées (nom, type MIME, taille)"],
    retention: "Durée de vie du compte (suppression sur demande)",
    legalBasis: "Exécution du contrat (art. 6.1.b RGPD)",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT)",
    privacyUrl: "https://www.cloudflare.com/privacypolicy/",
    i18n: {
      en: {
        purpose: "File storage and distribution (uploaded binary objects)",
        dataTypes: ["User-uploaded files", "Metadata (name, MIME type, size)"],
        retention: "Account lifetime (deletion on request)",
        legalBasis: "Contract performance (Art. 6.1.b GDPR)",
        transferMechanism: "Standard Contractual Clauses (SCC)",
      },
    },
  },
  "vercel-analytics": {
    name: "Vercel Inc. (Vercel Analytics)",
    address: "440 N Barranca Ave #4133, Covina, CA 91723, USA",
    country: "US",
    purpose: "Mesure d'audience anonyme, sans cookies",
    dataTypes: ["Pages visitées", "Pays (géolocalisation approximative)", "User-Agent"],
    retention: "Données agrégées, pas de données identifiantes stockées",
    legalBasis: "Intérêt légitime, mesure d'audience anonyme dispensée de consentement (recommandation CNIL)",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT)",
    privacyUrl: "https://vercel.com/legal/privacy-policy",
    i18n: {
      en: {
        purpose: "Anonymous, cookieless audience measurement",
        dataTypes: ["Pages visited", "Country (approximate geolocation)", "User-Agent"],
        retention: "Aggregated data, no identifying data stored",
        legalBasis: "Legitimate interest, anonymous audience measurement exempt from consent (CNIL guidance)",
        transferMechanism: "Standard Contractual Clauses (SCC)",
      },
    },
  },
  "google-analytics": {
    name: "Google Ireland Limited (Google Analytics)",
    address: "Gordon House, Barrow Street, Dublin 4, Irlande",
    country: "IE",
    purpose: "Mesure d'audience détaillée (avec consentement)",
    dataTypes: [
      "Pages visitées",
      "Durée de session",
      "Source de trafic",
      "Données démographiques anonymisées",
      "Adresse IP anonymisée",
    ],
    retention: "14 mois par défaut (configurable)",
    legalBasis: "Consentement (art. 6.1.a RGPD), soumis au cookie banner",
    isEUResident: true,
    transferMechanism: "Transferts possibles vers Google LLC (USA) via Clauses contractuelles types",
    privacyUrl: "https://policies.google.com/privacy",
    requiresConsent: true,
    i18n: {
      en: {
        purpose: "Detailed audience measurement (with consent)",
        dataTypes: [
          "Pages visited",
          "Session duration",
          "Traffic source",
          "Anonymized demographic data",
          "Anonymized IP address",
        ],
        retention: "14 months by default (configurable)",
        legalBasis: "Consent (Art. 6.1.a GDPR), gated by the cookie banner",
        transferMechanism: "Possible transfers to Google LLC (USA) via Standard Contractual Clauses",
      },
    },
  },
  anthropic: {
    name: "Anthropic PBC",
    address: "548 Market Street #84749, San Francisco, CA 94104, USA",
    country: "US",
    purpose: "Inférence IA (modèles Claude) pour les fonctionnalités d'agent autonome",
    dataTypes: ["Variable selon le contexte de l'agent. Voir documentation de chaque agent configuré"],
    retention: "30 jours côté Anthropic (sauf opt-out)",
    legalBasis: "Exécution du contrat / intérêt légitime / consentement (selon le contexte)",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT)",
    privacyUrl: "https://www.anthropic.com/privacy",
    dpaUrl: "https://www.anthropic.com/legal/dpa",
    i18n: {
      en: {
        purpose: "AI inference (Claude models) for autonomous agent features",
        dataTypes: ["Varies by agent context. See documentation of each configured agent"],
        retention: "30 days on the Anthropic side (unless opted out)",
        legalBasis: "Contract performance / legitimate interest / consent (depending on context)",
        transferMechanism: "Standard Contractual Clauses (SCC)",
      },
    },
  },
  render: {
    name: "Render Services, Inc.",
    address: "525 Brannan St #401, San Francisco, CA 94107, USA",
    country: "US",
    purpose: "Hébergement de processus en arrière-plan (workers, automatisations)",
    dataTypes: ["Variable selon les workers déployés"],
    retention: "Durée de vie du service",
    legalBasis: "Exécution du contrat (art. 6.1.b RGPD)",
    isEUResident: false,
    transferMechanism: "Clauses contractuelles types (CCT)",
    privacyUrl: "https://render.com/privacy",
    i18n: {
      en: {
        purpose: "Background process hosting (workers, automations)",
        dataTypes: ["Varies by deployed worker"],
        retention: "Service lifetime",
        legalBasis: "Contract performance (Art. 6.1.b GDPR)",
        transferMechanism: "Standard Contractual Clauses (SCC)",
      },
    },
  },
};

// ─── Args parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const adds = [];
const removes = [];
const i18nLocales = [];
let action = "update";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--add") {
    adds.push(args[++i]);
  } else if (a === "--remove") {
    removes.push(args[++i]);
  } else if (a === "--list") {
    action = "list";
  } else if (a === "--catalog") {
    action = "catalog";
  } else if (a === "--add-i18n") {
    // Locales come comma-separated, e.g. `--add-i18n en` or `--add-i18n en,es`
    const raw = args[++i];
    if (!raw) {
      console.error("--add-i18n requires a locale argument (e.g. `en` or `en,es`)");
      process.exit(2);
    }
    for (const l of raw.split(",")) {
      const trimmed = l.trim();
      if (trimmed) i18nLocales.push(trimmed);
    }
    action = "add-i18n";
  } else if (a === "--help" || a === "-h") {
    action = "help";
  } else {
    console.error(`Unknown argument: ${a}`);
    process.exit(2);
  }
}

if (action === "help") {
  console.log(`Usage:
  node update-privacy-policy.mjs --add <key> [--add <key>...]
  node update-privacy-policy.mjs --remove <key>
  node update-privacy-policy.mjs --list
  node update-privacy-policy.mjs --catalog
  node update-privacy-policy.mjs --add-i18n <locale>[,<locale>...]

The --add-i18n action enriches existing entries in subprocessors.json with the
translations available in the in-script CATALOG for the given locales.
Only entries whose key matches a CATALOG entry are touched.

Known keys:    ${Object.keys(CATALOG).join(", ")}
Known locales: en`);
  process.exit(0);
}

if (action === "catalog") {
  console.log(JSON.stringify(CATALOG, null, 2));
  process.exit(0);
}

// ─── Project root detection ───────────────────────────────────────────────
function detectWebRoot() {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "apps/web/package.json"))) return join(cwd, "apps/web");
  if (existsSync(join(cwd, "package.json"))) return cwd;
  console.error("[update-privacy-policy] Cannot detect web root: no package.json at ./ or ./apps/web/");
  process.exit(1);
}

const WEB_ROOT = detectWebRoot();
const DATA_FILE = join(WEB_ROOT, "src/lib/subprocessors.json");
const TS_WRAPPER = join(WEB_ROOT, "src/lib/subprocessors.ts");

// ─── Load registry ────────────────────────────────────────────────────────
function loadRegistry() {
  if (!existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    console.error(`[update-privacy-policy] Cannot parse ${DATA_FILE}: ${e.message}`);
    process.exit(1);
  }
}

// ─── Save registry ────────────────────────────────────────────────────────
function saveRegistry(registry) {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(registry, null, 2) + "\n", "utf8");

  // Ensure the TS wrapper is up to date. We rewrite it every time so the
  // exported type stays in sync with the JSON shape (e.g. when we extend the
  // schema with new optional fields like `i18n`).
  const tsContent = `import data from "./subprocessors.json";

/**
 * Translations for the textual fields of a subprocessor entry. Used when the
 * project is multilingual (i18n added via /add-i18n). The privacy policy page
 * picks \`entry.i18n[locale]\` for each field, falling back to the root value
 * (French by default) when no translation exists for the active locale.
 */
export type SubprocessorTranslation = {
  purpose?: string;
  dataTypes?: string[];
  retention?: string;
  legalBasis?: string;
  transferMechanism?: string;
};

export type Subprocessor = {
  key: string;
  name: string;
  address: string;
  country: string;
  purpose: string;
  dataTypes: string[];
  retention: string;
  legalBasis: string;
  isEUResident: boolean;
  transferMechanism: string | null;
  privacyUrl: string;
  dpaUrl?: string;
  requiresConsent?: boolean;
  i18n?: Record<string, SubprocessorTranslation>;
};

export const SUBPROCESSORS: Subprocessor[] = data;
`;
  writeFileSync(TS_WRAPPER, tsContent, "utf8");
}

// ─── Actions ──────────────────────────────────────────────────────────────
const registry = loadRegistry();

if (action === "list") {
  if (registry.length === 0) {
    console.log("(empty)");
  } else {
    for (const e of registry) console.log(`  ${e.key.padEnd(20)} ${e.name}`);
  }
  process.exit(0);
}

if (action === "add-i18n") {
  // Enrich existing entries in the registry with translations from the CATALOG
  // for the requested locales. Only entries whose key matches a CATALOG entry
  // are touched. Useful right after /add-i18n to retrofit translations onto a
  // project that had its subprocessors registered before i18n was set up.
  const i18nReports = [];
  let touched = 0;
  for (const entry of registry) {
    const catalogEntry = CATALOG[entry.key];
    if (!catalogEntry || !catalogEntry.i18n) {
      i18nReports.push(`skip      ${entry.key} (no translations available in catalog)`);
      continue;
    }
    entry.i18n = entry.i18n ?? {};
    const addedLocales = [];
    for (const locale of i18nLocales) {
      const translation = catalogEntry.i18n[locale];
      if (!translation) continue;
      entry.i18n[locale] = translation;
      addedLocales.push(locale);
    }
    if (addedLocales.length > 0) {
      touched++;
      i18nReports.push(`updated   ${entry.key} (+${addedLocales.join(", ")})`);
    } else {
      i18nReports.push(`skip      ${entry.key} (no translations for ${i18nLocales.join(", ")})`);
    }
  }
  if (touched > 0) {
    saveRegistry(registry);
  }
  console.log(`[update-privacy-policy] ${DATA_FILE}`);
  for (const r of i18nReports) console.log(`  ${r}`);
  console.log(`Total: ${touched} entry(ies) updated with translations for: ${i18nLocales.join(", ")}`);
  process.exit(0);
}

const reports = [];

for (const key of adds) {
  if (!CATALOG[key]) {
    console.error(`[update-privacy-policy] Unknown key: ${key}`);
    console.error(`Known: ${Object.keys(CATALOG).join(", ")}`);
    process.exit(2);
  }
  const entry = { key, ...CATALOG[key] };
  const idx = registry.findIndex((e) => e.key === key);
  if (idx >= 0) {
    registry[idx] = entry;
    reports.push(`replaced  ${key}`);
  } else {
    registry.push(entry);
    reports.push(`added     ${key}`);
  }
}

for (const key of removes) {
  const idx = registry.findIndex((e) => e.key === key);
  if (idx >= 0) {
    registry.splice(idx, 1);
    reports.push(`removed   ${key}`);
  } else {
    reports.push(`skip      ${key} (not present)`);
  }
}

if (adds.length === 0 && removes.length === 0) {
  console.error("Nothing to do. Use --add, --remove, --list or --catalog.");
  process.exit(2);
}

saveRegistry(registry);

console.log(`[update-privacy-policy] ${DATA_FILE}`);
for (const r of reports) console.log(`  ${r}`);
console.log(`Total: ${registry.length} subprocessor(s)`);
