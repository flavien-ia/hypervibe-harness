#!/usr/bin/env node
// _i18n-merge-messages.mjs - Merge a feature's messages templates into the
// project's per-locale messages files.
//
// Reads templates/<feature>/manifest.json + the associated messages-<lang>.json
// templates. For each locale of the project, picks the right template
// (matching the locale's language code, e.g. "fr" for "fr-FR"), with English
// fallback when no template exists. Then deep-merges the template into the
// project's messages/<locale>.json without overwriting unrelated keys.
//
// Usage:
//   node _i18n-merge-messages.mjs --web-dir <path> --feature <feature-id>
//
// Used by:
//   - setup-i18n.mjs (when retrofitting features into an i18n setup)
//   - setup-*.mjs scripts (when installing a feature into an existing i18n
//     project - merges the feature's keys into ALL locales' messages files)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getLocales } from "./_i18n-detect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
let webDir = null;
let featureId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--web-dir" && args[i + 1]) webDir = args[++i];
  else if (args[i] === "--feature" && args[i + 1]) featureId = args[++i];
  else {
    console.error(`Unknown arg: ${args[i]}`);
    process.exit(2);
  }
}

if (!webDir || !featureId) {
  console.error("Usage: --web-dir <path> --feature <feature-id>");
  process.exit(2);
}

const manifestPath = join(PLUGIN_ROOT, "templates", featureId, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Feature manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const featureDir = dirname(manifestPath);
const locales = getLocales(webDir);
if (!locales || locales.length === 0) {
  console.error(`Project at ${webDir} is not i18n-enabled (no src/i18n/routing.ts).`);
  process.exit(1);
}

const messagesMap = manifest.messages || {};

// Pick a fallback (English) template if available, used for locales we don't
// ship a translation for.
let fallbackPayload = null;
if (messagesMap.en) {
  const enPath = join(featureDir, messagesMap.en);
  if (existsSync(enPath)) fallbackPayload = JSON.parse(readFileSync(enPath, "utf8"));
}

/**
 * Deep merge `source` into `target`, mutating `target`. Arrays are replaced
 * (not concatenated). Plain objects are merged recursively.
 */
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      target[k] !== null &&
      typeof target[k] === "object" &&
      !Array.isArray(target[k])
    ) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

const messagesDir = join(webDir, "messages");
mkdirSync(messagesDir, { recursive: true });

let merged = 0;
const warnings = [];

for (const loc of locales) {
  const langKey = loc.split("-")[0];
  let templatePath = messagesMap[langKey];
  let templatePayload;

  if (templatePath) {
    const fullPath = join(featureDir, templatePath);
    if (existsSync(fullPath)) {
      templatePayload = JSON.parse(readFileSync(fullPath, "utf8"));
    }
  }
  if (!templatePayload) {
    if (fallbackPayload) {
      templatePayload = fallbackPayload;
      warnings.push(
        `No "${featureId}" messages template for locale "${loc}", falling back to English. Translate manually in messages/${loc}.json under the relevant namespace.`,
      );
    } else {
      warnings.push(`No "${featureId}" messages template for locale "${loc}" and no English fallback. Skipped.`);
      continue;
    }
  }

  const projectMsgPath = join(messagesDir, `${loc}.json`);
  const existing = existsSync(projectMsgPath)
    ? JSON.parse(readFileSync(projectMsgPath, "utf8"))
    : {};
  deepMerge(existing, templatePayload);
  writeFileSync(projectMsgPath, JSON.stringify(existing, null, 2) + "\n");
  merged++;
}

console.log(`[_i18n-merge-messages] feature=${featureId}: merged into ${merged}/${locales.length} locale file(s)`);
for (const w of warnings) console.warn(`  ⚠️  ${w}`);
