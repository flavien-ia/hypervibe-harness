// _i18n-detect.mjs - Centralized i18n detection for setup-* scripts.
//
// Convention: a project is "i18n-enabled" when src/i18n/routing.ts exists.
// That file is created by setup-i18n.mjs (no other path leads to it) so its
// presence is a reliable signal.
//
// Exports:
//   isI18nSetUp(webDir): boolean
//   getLocales(webDir): string[] | null   - parsed from routing.ts
//   getDefaultLocale(webDir): string | null
//
// Used by:
//   - setup-i18n.mjs (to enumerate locales when retrofitting features)
//   - Future setup-*.mjs scripts (to decide between plain/i18n templates)

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function isI18nSetUp(webDir) {
  return existsSync(join(webDir, "src/i18n/routing.ts"));
}

/**
 * Parse the locales array from src/i18n/routing.ts.
 * Returns null if i18n is not set up.
 */
export function getLocales(webDir) {
  const routingPath = join(webDir, "src/i18n/routing.ts");
  if (!existsSync(routingPath)) return null;
  const content = readFileSync(routingPath, "utf8");
  // Match `locales: ["fr", "en", ...]` (with various whitespace / quote styles).
  const m = content.match(/locales\s*:\s*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/**
 * Parse the default locale from src/i18n/routing.ts.
 * Returns null if i18n is not set up.
 */
export function getDefaultLocale(webDir) {
  const routingPath = join(webDir, "src/i18n/routing.ts");
  if (!existsSync(routingPath)) return null;
  const content = readFileSync(routingPath, "utf8");
  const m = content.match(/defaultLocale\s*:\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}
