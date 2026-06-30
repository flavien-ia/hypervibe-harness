#!/usr/bin/env node
// setup-map.mjs - Scaffold MapLibre GL JS + react-map-gl into a Next.js project.
//
// Usage:
//   node setup-map.mjs --web-dir <path> [--layout embedded|mapfirst]
//
// Layouts:
//   embedded  (default) - installs map.tsx + map-loader.tsx. Suitable for
//                          embedding a map as a section inside a content page
//                          (contact page, footer, "where we are" block, etc.).
//   mapfirst             - additionally installs map-shell.tsx, a generic
//                          layout chassis for map-first pages (the map IS the
//                          page). Provides viewport-minus-header lock, a
//                          desktop sidebar slot, and a mobile bottom-Sheet.
//
// What it does (deterministic, no questions, no user input):
//   1. Install runtime deps:  maplibre-gl, react-map-gl
//      (react-map-gl re-exports its types - no @types package needed).
//   2. Copy template files:
//        <web-dir>/src/components/site/map.tsx          (always)
//        <web-dir>/src/components/site/map-loader.tsx   (always)
//        <web-dir>/src/components/site/map-shell.tsx    (only when --layout=mapfirst)
//   3. Print a JSON handoff so Claude knows what was created + where.
//
// What it does NOT do (Claude handles afterwards):
//   - Wiring the components into a specific page (varies per use case).
//   - Defining the markers data (inline array, `src/lib/locations.ts`, DB…).
//   - Adding the SEO/a11y <noscript> fallback (page-specific).
//   - _update-claude-md + _update-privacy-policy invocations (Claude calls
//     these directly with project-specific phrasing).
//
// Refuses to run if src/components/site/map.tsx already exists.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureToolsInPath } from "./_ensure-tools-path.mjs";
import { isI18nSetUp } from "./_i18n-detect.mjs";

ensureToolsInPath();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let webDir = ".";
let layout = "embedded"; // embedded | mapfirst
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--web-dir" && args[i + 1]) webDir = args[++i];
  else if (a === "--layout" && args[i + 1]) layout = args[++i];
  else {
    console.error(`Unknown arg: ${a}`);
    process.exit(1);
  }
}
webDir = resolve(webDir);

if (!["embedded", "mapfirst"].includes(layout)) {
  console.error(`❌ --layout must be "embedded" or "mapfirst" (got "${layout}").`);
  process.exit(1);
}

if (!existsSync(join(webDir, "package.json"))) {
  console.error(`❌ No package.json found at ${webDir}. Pass --web-dir <path>.`);
  process.exit(1);
}

const componentsDir = join(webDir, "src", "components", "site");
const mapFile = join(componentsDir, "map.tsx");
const loaderFile = join(componentsDir, "map-loader.tsx");
const shellFile = join(componentsDir, "map-shell.tsx");

if (existsSync(mapFile)) {
  console.error(
    `❌ ${mapFile} already exists - looks like /add-map a déjà été run. Supprime le fichier d'abord pour re-scaffold, ou édite-le manuellement.`,
  );
  process.exit(1);
}

const warnings = [];
const actions = [];

// ─── 1. Install deps ─────────────────────────────────────────────────
console.log("▸ Installing maplibre-gl + react-map-gl");
const pnpmAdd = spawnSync(
  "pnpm",
  ["add", "maplibre-gl", "react-map-gl"],
  { cwd: webDir, stdio: "inherit", shell: true },
);
if (pnpmAdd.status !== 0) {
  console.error(`❌ pnpm add failed (exit ${pnpmAdd.status})`);
  process.exit(1);
}
actions.push("✓ Installed maplibre-gl + react-map-gl");

// ─── 2. Copy template files ──────────────────────────────────────────
mkdirSync(componentsDir, { recursive: true });

const templatesDir = resolve(__dirname, "..", "templates", "map");
const srcMap = join(templatesDir, "map.tsx");
const i18nActive = isI18nSetUp(webDir);
const srcLoader = join(
  templatesDir,
  i18nActive ? "map-loader.i18n.tsx" : "map-loader.tsx",
);
const srcShell = join(templatesDir, "map-shell.tsx");

if (!existsSync(srcMap) || !existsSync(srcLoader)) {
  console.error(
    `❌ Template files missing in ${templatesDir} - the plugin install may be broken.`,
  );
  process.exit(1);
}

copyFileSync(srcMap, mapFile);
copyFileSync(srcLoader, loaderFile);
actions.push(`✓ ${mapFile.replace(webDir, "").replace(/^[\\/]+/, "")}`);
actions.push(
  `✓ ${loaderFile.replace(webDir, "").replace(/^[\\/]+/, "")}${i18nActive ? " (i18n variant)" : ""}`,
);

// If i18n is active, merge the map feature's messages into each locale.
if (i18nActive) {
  const mergeScript = join(__dirname, "_i18n-merge-messages.mjs");
  if (existsSync(mergeScript)) {
    const res = spawnSync(
      "node",
      [mergeScript, "--web-dir", webDir, "--feature", "map"],
      { stdio: "pipe", encoding: "utf8" },
    );
    if (res.status === 0) {
      actions.push("✓ messages merged for feature 'map'");
    } else {
      warnings.push(
        `MESSAGES_MERGE_FAILED: ${(res.stderr || res.stdout || "").trim()}`,
      );
    }
  } else {
    warnings.push(
      "MERGE_SCRIPT_MISSING: _i18n-merge-messages.mjs not found - map keys not merged into messages/*.json",
    );
  }
}

if (layout === "mapfirst") {
  if (!existsSync(srcShell)) {
    console.error(
      `❌ map-shell.tsx template missing in ${templatesDir} - the plugin install may be broken.`,
    );
    process.exit(1);
  }
  copyFileSync(srcShell, shellFile);
  actions.push(`✓ ${shellFile.replace(webDir, "").replace(/^[\\/]+/, "")}`);

  // Sanity check: shadcn Sheet must be present for MapShell to compile.
  const sheetFile = join(webDir, "src", "components", "ui", "sheet.tsx");
  if (!existsSync(sheetFile)) {
    warnings.push(
      "SHEET_MISSING: src/components/ui/sheet.tsx not found. MapShell uses shadcn/ui Sheet - run `npx shadcn@latest add sheet` before importing MapShell.",
    );
  }
}

// ─── 3. Handoff JSON ─────────────────────────────────────────────────
console.log(`
✅ Map scaffolding done (layout: ${layout}).

   Component  : src/components/site/map.tsx        (client-only MapView)
   Loader     : src/components/site/map-loader.tsx (SSR-safe MapLoader)${
  layout === "mapfirst"
    ? `\n   Shell      : src/components/site/map-shell.tsx  (map-first layout chassis)`
    : ""
}

Built-in :
  • ResizeObserver on the map container + onLoad resize() so tiles never
    look stretched/blurry when the parent layout settles after first paint.
  • fitToMarkers (default true) auto-frames the camera to all markers on
    load and on markers change (e.g. when filters apply).
  • scrollZoom defaults to false (won't hijack page scroll on content pages).
    Pass scrollZoom={true} explicitly for map-first usage.

Tile provider : OpenFreeMap (free, no API key, no cookies, EU servers).
                Style URL centralised at the top of map.tsx - swap in 1 line
                if OpenFreeMap ever goes down. Fallbacks documented in the
                file's header comment.

Next (Claude handles):
  - Wire <MapLoader markers={...} /> into the target page (server component).
  - For map-first pages: wrap with <MapShell map={…} sidebar={…} />.
  - Define markers data (inline array, src/lib/locations.ts, or a DB table).
  - Add <noscript> fallback list with addresses + Google Maps deeplinks for
    SEO and accessibility.
  - Add an entry "OpenFreeMap" to src/lib/subprocessors.json (data processor
    for visitor IP at tile load - EU servers, no cookies, donation-funded).
  - Update CLAUDE.md with a note pointing to map-loader.tsx + the fallback
    style URLs in map.tsx's header.
`);

// Last line = parseable JSON for orchestration (mirrors setup-db.mjs style)
console.log(
  JSON.stringify({
    success: true,
    layout,
    mapFile: mapFile.replace(webDir, "").replace(/^[\\/]+/, ""),
    loaderFile: loaderFile.replace(webDir, "").replace(/^[\\/]+/, ""),
    shellFile: layout === "mapfirst" ? shellFile.replace(webDir, "").replace(/^[\\/]+/, "") : null,
    actions,
    warnings,
  }),
);
