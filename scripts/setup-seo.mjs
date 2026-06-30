#!/usr/bin/env node
// Apply base SEO to a fresh T3 scaffold.
//
// Usage:
//   node setup-seo.mjs --name "My Project" --description "Short description 150-160 chars" [--locale fr_FR]
//
// What it does (all idempotent - safe to re-run):
//   1. Patches src/app/layout.tsx:
//      - Enriches the `metadata` export (metadataBase, title template, openGraph, twitter, robots)
//      - Updates <html lang="..."> to match the locale (fr/en/etc. derived from the locale arg)
//      - Inserts a minimal JSON-LD WebSite schema inside <body>, before {children}
//   2. Creates public/robots.txt (if not present)
//   3. Creates src/app/sitemap.ts (if not present)
//
// It does NOT generate the OG image - prints a reminder instead (1200x630 at public/og-image.png).
// It does NOT touch the fonts (T3 wires Geist Sans automatically - leave it alone unless the
// user asks for a different font).
//
// The sitemap starts with just `/` - the caller (bootstrap Step 4) or later steps are
// responsible for adding more pages as they're created (legal pages, auth, etc.).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ─── Parse args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let projectName = "";
let description = "";
let locale = "fr_FR";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--name" && args[i + 1]) projectName = args[++i];
  else if (args[i] === "--description" && args[i + 1]) description = args[++i];
  else if (args[i] === "--locale" && args[i + 1]) locale = args[++i];
  else {
    console.error(`Unknown arg: ${args[i]}`);
    process.exit(1);
  }
}

if (!projectName || !description) {
  console.error(
    "Usage: node setup-seo.mjs --name NAME --description DESC [--locale LOCALE]",
  );
  process.exit(1);
}

const htmlLang = locale.split("_")[0]; // "fr_FR" → "fr"
const actions = [];

// Escape double quotes for embedding in a JSON object literal inside TS source
function tsQuote(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ─── 1. Patch src/app/layout.tsx ───────────────────────────────────────
function patchLayout() {
  const file = "src/app/layout.tsx";
  if (!existsSync(file)) {
    actions.push(`⚠️  ${file} not found - skipping layout patch`);
    return;
  }

  let content = readFileSync(file, "utf8");
  let changed = false;

  // Build the new metadata block
  const newMetadata = `export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "${tsQuote(projectName)}",
    template: "%s | ${tsQuote(projectName)}",
  },
  description: "${tsQuote(description)}",
  openGraph: {
    type: "website",
    locale: "${tsQuote(locale)}",
    siteName: "${tsQuote(projectName)}",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "${tsQuote(projectName)}" }],
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};`;

  // Replace the existing `export const metadata: Metadata = { ... };` block
  if (content.includes("metadataBase")) {
    actions.push(`✓ ${file}: metadata already enriched (metadataBase present)`);
  } else {
    const metadataRe = /export\s+const\s+metadata\s*:\s*Metadata\s*=\s*\{[\s\S]*?\};/;
    if (metadataRe.test(content)) {
      content = content.replace(metadataRe, newMetadata);
      actions.push(`✓ ${file}: metadata enriched (title template, openGraph, twitter, robots)`);
      changed = true;
    } else {
      // No existing metadata export - inject it after the imports
      const lastImport = content.match(/^(?:import[^;]+;[\r\n]*)+/);
      const metadataImport = content.includes("type Metadata")
        ? ""
        : 'import { type Metadata } from "next";\n';
      const insertion = `\n${metadataImport}${newMetadata}\n\n`;
      if (lastImport) {
        content = content.replace(lastImport[0], lastImport[0] + insertion);
      } else {
        content = insertion + content;
      }
      actions.push(`✓ ${file}: metadata export added`);
      changed = true;
    }
  }

  // Update <html lang="..."> if it's the default "en"
  const htmlLangRe = /<html([^>]*?)lang="[^"]*"([^>]*?)>/;
  if (htmlLangRe.test(content)) {
    const current = content.match(htmlLangRe);
    if (current && !current[0].includes(`lang="${htmlLang}"`)) {
      content = content.replace(htmlLangRe, `<html$1lang="${htmlLang}"$2>`);
      actions.push(`✓ ${file}: <html lang> set to "${htmlLang}"`);
      changed = true;
    } else {
      actions.push(`✓ ${file}: <html lang> already "${htmlLang}"`);
    }
  }

  // Insert JSON-LD WebSite schema inside <body>, before {children} (idempotent).
  // T3 renders the body content on a single line like `<X>{children}</X>`, so a
  // naive insertion before `{children}` produces jammed-up markup. Detect that
  // pattern and explode it into properly-indented JSX; fall back to a simple
  // before-{children} insertion if the one-liner pattern isn't found.
  if (content.includes('"@context": "https://schema.org"')) {
    actions.push(`✓ ${file}: JSON-LD already present`);
  } else {
    const oneLineRe = /^([ \t]+)(<(\w[\w.-]*)[^>]*>)\{children\}(<\/\3>)\s*$/m;
    const buildScript = (indent) =>
      `${indent}<script\n` +
      `${indent}  type="application/ld+json"\n` +
      `${indent}  dangerouslySetInnerHTML={{\n` +
      `${indent}    __html: JSON.stringify({\n` +
      `${indent}      "@context": "https://schema.org",\n` +
      `${indent}      "@type": "WebSite",\n` +
      `${indent}      name: "${tsQuote(projectName)}",\n` +
      `${indent}      url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",\n` +
      `${indent}    }),\n` +
      `${indent}  }}\n` +
      `${indent}/>\n`;

    const oneLineMatch = content.match(oneLineRe);
    if (oneLineMatch) {
      const [, outerIndent, openTag, , closeTag] = oneLineMatch;
      const innerIndent = outerIndent + "  ";
      const replacement =
        `${outerIndent}${openTag}\n` +
        buildScript(innerIndent) +
        `${innerIndent}{children}\n` +
        `${outerIndent}${closeTag}`;
      content = content.replace(oneLineRe, replacement);
      actions.push(`✓ ${file}: JSON-LD WebSite schema inserted (exploded one-liner wrapper)`);
      changed = true;
    } else {
      // Fallback: {children} on its own line or in an unknown structure.
      const childrenLineRe = /^([ \t]*)\{children\}/m;
      const m = content.match(childrenLineRe);
      if (m) {
        const indent = m[1];
        content = content.replace(childrenLineRe, buildScript(indent) + `${indent}{children}`);
        actions.push(`✓ ${file}: JSON-LD WebSite schema inserted (before standalone {children})`);
        changed = true;
      } else {
        actions.push(`⚠️  ${file}: could not find {children} - JSON-LD not inserted`);
      }
    }
  }

  if (changed) writeFileSync(file, content);
}

// ─── 2. public/robots.txt ──────────────────────────────────────────────
function writeRobots() {
  const file = "public/robots.txt";
  if (existsSync(file)) {
    actions.push(`✓ ${file}: already exists (not overwritten)`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  // robots.txt doesn't support env var expansion, so we can't emit a Sitemap
  // line here - the caller adds one once a real domain is linked.
  writeFileSync(
    file,
    `User-agent: *
Allow: /
Disallow: /api/
`,
  );
  actions.push(`✓ ${file}: created (add a "Sitemap: https://<domain>/sitemap.xml" line once a custom domain is linked)`);
}

// ─── 3. src/app/sitemap.ts ─────────────────────────────────────────────
function writeSitemap() {
  const file = "src/app/sitemap.ts";
  if (existsSync(file)) {
    actions.push(`✓ ${file}: already exists (not overwritten)`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const content = `import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Add every public page here as it's created. Exclude noindex pages (e.g. admin, preferences).
  const pages = [
    { path: "", changeFrequency: "weekly" as const, priority: 1.0 },
  ];

  return pages.map((page) => ({
    url: \`\${baseUrl}\${page.path}\`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
`;
  writeFileSync(file, content);
  actions.push(`✓ ${file}: created`);
}

// ─── Run ───────────────────────────────────────────────────────────────
patchLayout();
writeRobots();
writeSitemap();

console.log("");
console.log("Base SEO:");
for (const a of actions) console.log(`  ${a}`);
console.log("");
console.log("✅ Base SEO applied.");
console.log("");
console.log("⚠️  TODO: create a real OG image at public/og-image.png (1200×630 PNG).");
console.log("    The metadata already references it; until then, scrapers will see a 404.");
