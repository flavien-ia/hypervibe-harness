#!/usr/bin/env node
// setup-i18n.mjs - Scaffold next-intl with sub-path routing (`/<locale>/...`).
//
// Usage:
//   node setup-i18n.mjs --locales fr,en --default fr [--web-dir .]
//
// What it creates:
//   1. <web-dir>/src/i18n/routing.ts       - locales array + defaultLocale
//   2. <web-dir>/src/i18n/request.ts       - per-request locale + messages loader
//   3. <web-dir>/messages/<locale>.json    - one minimal message file per locale
//   4. <web-dir>/src/app/[locale]/layout.tsx
//      - minimal server layout wrapping children in NextIntlClientProvider, with
//        hreflang alternates in generateMetadata. Claude augments after (add
//        TRPCReactProvider, font className, etc.).
//   5. <web-dir>/src/components/language-switcher.tsx
//
// What it patches (regex, like setup-security.mjs):
//   6. <web-dir>/next.config.(ts|mjs|js) - wraps export in withNextIntl()
//   7. <web-dir>/src/app/sitemap.ts - explodes entries to one per locale × page,
//      with alternates.languages. Skipped if the file doesn't exist.
//
// What it does NOT do (Claude handles):
//   - pnpm add next-intl (run before invoking the script).
//   - Middleware: merging with an existing src/middleware.ts (hostname routing etc).
//     The script creates src/middleware.ts ONLY if absent.
//   - Moving existing pages (src/app/page.tsx, etc.) under src/app/[locale]/.
//   - Augmenting [locale]/layout.tsx with providers (TRPCReactProvider, fonts, etc.).
//
// Refuses to run if:
//   - src/i18n/ already exists (re-setup? delete it first)
//   - src/app/[locale]/ already exists (same)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let localesArg = "";
let defaultLocale = "";
let webDir = ".";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--locales" && args[i + 1]) localesArg = args[++i];
  else if (a === "--default" && args[i + 1]) defaultLocale = args[++i];
  else if (a === "--web-dir" && args[i + 1]) webDir = args[++i];
  else {
    console.error(`Unknown arg: ${a}`);
    process.exit(1);
  }
}

if (!localesArg) {
  console.error("Usage: node setup-i18n.mjs --locales fr,en [--default fr] [--web-dir .]");
  process.exit(1);
}

const locales = localesArg.split(",").map((s) => s.trim()).filter(Boolean);
if (locales.length < 1) {
  console.error("--locales must contain at least one locale");
  process.exit(1);
}
for (const loc of locales) {
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(loc)) {
    console.error(`Invalid locale: ${loc} (expected e.g. "fr", "en-US")`);
    process.exit(1);
  }
}
if (!defaultLocale) defaultLocale = locales[0];
if (!locales.includes(defaultLocale)) {
  console.error(`--default ${defaultLocale} not in --locales list`);
  process.exit(1);
}

// ─── refuse to re-setup ───────────────────────────────────────────────
const i18nDir = join(webDir, "src/i18n");
const localeAppDir = join(webDir, "src/app/[locale]");
if (existsSync(i18nDir)) {
  console.error(`❌ ${i18nDir} already exists. Delete it first to re-scaffold.`);
  process.exit(1);
}
if (existsSync(localeAppDir)) {
  console.error(`❌ ${localeAppDir} already exists. Delete it first to re-scaffold.`);
  process.exit(1);
}

const warnings = [];
const actions = [];

// ─── 1. src/i18n/routing.ts ──────────────────────────────────────────
mkdirSync(i18nDir, { recursive: true });
const localesLiteral = JSON.stringify(locales);
writeFileSync(
  join(i18nDir, "routing.ts"),
  `import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ${localesLiteral} as const,
  defaultLocale: "${defaultLocale}",
  // \`as-needed\` keeps the default locale's URLs UNPREFIXED (e.g. /about) and
  // only prefixes the other locales (e.g. /en/about). Critical for SEO when
  // adding i18n to an existing site: all current URLs on the default locale
  // stay valid, backlinks/ranking/GSC are preserved, and only the new locales
  // bootstrap from scratch (unavoidable). The next-intl default would be
  // \`always\` which rewrites every URL to /<locale>/... and silently kills
  // existing SEO on the default locale.
  localePrefix: "as-needed",
});
`,
);
actions.push(`✓ ${join(i18nDir, "routing.ts")}`);

// ─── 1.bis src/i18n/navigation.ts (locale-aware Link / router / hooks) ─
// next-intl does NOT export usePathname/useRouter directly from
// "next-intl/navigation"; the locale-aware versions must be created from the
// routing config via createNavigation(routing) and imported from here.
writeFileSync(
  join(i18nDir, "navigation.ts"),
  `import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
`,
);
actions.push(`✓ ${join(i18nDir, "navigation.ts")}`);

// ─── 2. src/i18n/request.ts ──────────────────────────────────────────
writeFileSync(
  join(i18nDir, "request.ts"),
  `import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(\`../../messages/\${locale}.json\`)).default,
  };
});
`,
);
actions.push(`✓ ${join(i18nDir, "request.ts")}`);

// ─── 3. messages/<locale>.json per locale ────────────────────────────
const messagesDir = join(webDir, "messages");
mkdirSync(messagesDir, { recursive: true });
const baseMessages = {
  fr: { common: { home: "Accueil", notFound: "Page introuvable", backHome: "Retour à l'accueil" } },
  en: { common: { home: "Home", notFound: "Page not found", backHome: "Back to home" } },
  es: { common: { home: "Inicio", notFound: "Página no encontrada", backHome: "Volver al inicio" } },
  de: { common: { home: "Startseite", notFound: "Seite nicht gefunden", backHome: "Zurück zur Startseite" } },
  it: { common: { home: "Home", notFound: "Pagina non trovata", backHome: "Torna alla home" } },
  pt: { common: { home: "Início", notFound: "Página não encontrada", backHome: "Voltar ao início" } },
};
for (const loc of locales) {
  const key = loc.split("-")[0];
  const payload = baseMessages[key] ?? { common: { home: "Home", notFound: "Not found", backHome: "Back home" } };
  writeFileSync(join(messagesDir, `${loc}.json`), JSON.stringify(payload, null, 2) + "\n");
  actions.push(`✓ ${join(messagesDir, `${loc}.json`)}`);
}

// ─── 3b. Retrofit known features for i18n ─────────────────────────────
//
// Scan all features that ship a `templates/<feature>/manifest.json` and, for
// each feature whose plain (bootstrap-generated) version is detected in the
// project, swap it for the i18n version + merge its messages into every
// locale + run the optional post-hook.
//
// This covers all UI-generating skills with i18n support: privacy policy,
// cookie banner, etc. Each feature opts in by shipping a manifest - no need
// to maintain a hardcoded list here.
{
  const upgradeScript = join(__dirname, "_i18n-upgrade.mjs");
  if (existsSync(upgradeScript)) {
    const res = spawnSync(
      "node",
      [upgradeScript, "--web-dir", webDir],
      { stdio: "pipe", encoding: "utf8" },
    );
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.status === 0) {
      actions.push(`✓ feature i18n retrofit complete`);
    } else {
      warnings.push(`i18n retrofit had failures: ${(res.stderr || "").trim()}`);
    }
  } else {
    warnings.push("_i18n-upgrade.mjs missing - feature retrofit skipped");
  }
}

// ─── 4. src/app/[locale]/layout.tsx ──────────────────────────────────
mkdirSync(localeAppDir, { recursive: true });
writeFileSync(
  join(localeAppDir, "layout.tsx"),
  `import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "~/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = l === routing.defaultLocale ? baseUrl : \`\${baseUrl}/\${l}\`;
  }

  return {
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: locale === routing.defaultLocale ? baseUrl : \`\${baseUrl}/\${locale}\`,
      languages,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  // NOTE: augment with TRPCReactProvider / font className / any other
  // providers that used to live in src/app/layout.tsx.
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
`,
);
actions.push(`✓ ${join(localeAppDir, "layout.tsx")}`);

// ─── 5. src/components/language-switcher.tsx ─────────────────────────
const componentsDir = join(webDir, "src/components");
mkdirSync(componentsDir, { recursive: true });
writeFileSync(
  join(componentsDir, "language-switcher.tsx"),
  `"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "~/i18n/navigation";
import { routing } from "~/i18n/routing";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function onChange(newLocale: string) {
    router.replace(pathname, { locale: newLocale });
  }

  return (
    <select
      value={locale}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Language"
    >
      {routing.locales.map((loc) => (
        <option key={loc} value={loc}>
          {loc.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
`,
);
actions.push(`✓ ${join(componentsDir, "language-switcher.tsx")}`);

// ─── 6. patch next.config.* ──────────────────────────────────────────
const configCandidates = ["next.config.ts", "next.config.mjs", "next.config.js"];
const configFile = configCandidates.map((f) => join(webDir, f)).find((p) => existsSync(p));
if (!configFile) {
  warnings.push(`next.config.(ts|mjs|js) not found under ${webDir} - cannot wire next-intl plugin`);
} else {
  let cfg = readFileSync(configFile, "utf8");
  if (cfg.includes("createNextIntlPlugin") || cfg.includes("withNextIntl")) {
    actions.push(`✓ ${configFile}: next-intl plugin already wired`);
  } else {
    const importLine = `import createNextIntlPlugin from "next-intl/plugin";\nconst withNextIntl = createNextIntlPlugin();\n`;
    // Inject import at top (after any type imports) and wrap the default export.
    const firstImportRe = /^(?:import[^;]+;[\r\n]+)+/;
    if (firstImportRe.test(cfg)) {
      cfg = cfg.replace(firstImportRe, (m) => m + importLine);
    } else {
      cfg = importLine + cfg;
    }
    // Wrap the default export. Common T3 pattern: `export default config;`
    const defaultExportRe = /export\s+default\s+(\w+)\s*;/;
    if (defaultExportRe.test(cfg)) {
      cfg = cfg.replace(defaultExportRe, "export default withNextIntl($1);");
      actions.push(`✓ ${configFile}: wrapped default export in withNextIntl()`);
    } else {
      warnings.push(`Could not find 'export default <name>;' in ${configFile} - wrap manually with withNextIntl(...)`);
    }
    writeFileSync(configFile, cfg);
  }
}

// ─── 7. patch sitemap.ts (optional) ──────────────────────────────────
const sitemapPath = join(webDir, "src/app/sitemap.ts");
if (!existsSync(sitemapPath)) {
  actions.push(`(no sitemap.ts - skipping i18n sitemap patch)`);
} else {
  let sm = readFileSync(sitemapPath, "utf8");
  if (sm.includes("alternates: { languages")) {
    actions.push(`✓ ${sitemapPath}: already i18n-aware`);
  } else {
    const importLine = `import { routing } from "~/i18n/routing";\n`;
    if (!sm.includes("~/i18n/routing")) {
      const firstImportRe = /^(?:import[^;]+;[\r\n]+)+/;
      if (firstImportRe.test(sm)) {
        sm = sm.replace(firstImportRe, (m) => m + importLine);
      } else {
        sm = importLine + sm;
      }
    }
    const simpleMapRe = /return\s+pages\.map\(\s*\(page\)\s*=>\s*\(\{[\s\S]*?\}\)\s*\)\s*;/;
    const newBlock = `return pages.flatMap((page) =>
    routing.locales.map((locale) => {
      const localePath =
        locale === routing.defaultLocale
          ? page.path
          : \`/\${locale}\${page.path}\`;
      const alternates: Record<string, string> = {};
      for (const alt of routing.locales) {
        alternates[alt] =
          alt === routing.defaultLocale
            ? \`\${baseUrl}\${page.path}\`
            : \`\${baseUrl}/\${alt}\${page.path}\`;
      }
      return {
        url: \`\${baseUrl}\${localePath}\`,
        lastModified: new Date(),
        changeFrequency: page.changeFrequency,
        priority: page.priority,
        alternates: { languages: alternates },
      };
    }),
  );`;
    if (simpleMapRe.test(sm)) {
      sm = sm.replace(simpleMapRe, newBlock);
      writeFileSync(sitemapPath, sm);
      actions.push(`✓ ${sitemapPath}: exploded to per-locale entries with hreflang alternates`);
    } else {
      warnings.push(
        `${sitemapPath}: could not find the expected 'return pages.map((page) => ({...}));' pattern - patch manually per the add-i18n SKILL.md.`,
      );
    }
  }
}

// ─── summary ─────────────────────────────────────────────────────────
console.log("");
for (const a of actions) console.log(`  ${a}`);
if (warnings.length) {
  console.log("");
  for (const w of warnings) console.log(`  ⚠️  ${w}`);
}
console.log(`
✅ next-intl scaffold ready (${locales.join(", ")}, default: ${defaultLocale}).

Next (Claude handles):
  - Move existing src/app/{page,layout,not-found}.tsx under src/app/[locale]/
  - Augment src/app/[locale]/layout.tsx with providers that used to live in the
    root layout (TRPCReactProvider, font className={geist.variable}, etc.)
  - Replace root src/app/layout.tsx with a minimal "return children" version
  - Create src/middleware.ts (or merge with existing) pointing to the routing
  - Add translations to messages/<locale>.json as pages are built
`);
