// _pnpm-workspace.mjs - Write one top-level block of pnpm-workspace.yaml.
//
// The file carries settings that several bootstrap steps write (allowBuilds
// for native install scripts, overrides for security floors): each step must
// replace ITS block without erasing the others.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Security floors on indirect dependencies, written by every /bootstrap.
//
// Always in pnpm-workspace.yaml, NEVER in package.json's `pnpm` field: pnpm
// 11+ ignores `pnpm.overrides` in package.json, while Vercel installs with
// pnpm 10 (picked from the project creation date, 10.28.0 on 2026-09-10),
// which reads it. The lockfile written locally then has no overrides, Vercel
// finds one in its config, and the install stops on
// ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. In pnpm-workspace.yaml both majors agree
// (checked on 2026-09-10: lockfile written by pnpm 11.1.1 or 12.3.4, frozen
// install OK on pnpm 10.28.0, 11.1.1 and 12.3.4).
//
// Written BEFORE the first install on purpose. On a project that already has
// node_modules, pnpm 11 answers "Already up to date" to `pnpm install`, even
// with --lockfile-only, when only this block changed: the lockfile never
// records the override and Vercel then fails as above (seen on 2026-09-10).
// There, `pnpm install --config.optimistic-repeat-install=false` forces the
// resolution (checked the same day on a clone of a real project).
//
// postcss: Next 15 pins postcss 8.4.31 exactly (every 15.5.x, 15.5.25
//   included), which carries GHSA-6g55-p6wh-862q and GHSA-r28c-9q8g-f849
//   (high), GHSA-qx2v-qp2m-jg93 and GHSA-fxqj-rqcc-2cmp (moderate), all fixed
//   by 8.5.23. Real exposure is nil for a Hypervibe app (PostCSS only reads
//   the project's own CSS, at build time), but `pnpm audit --prod` reports
//   them on every new project. Remove once create-t3-app scaffolds a Next
//   whose own postcss is >= 8.5.23 (Next 16.3 ships 8.5.23).
export const PNPM_OVERRIDES = { postcss: "^8.5.23" };

// ESLint's plugins, reachable from the project's root. create-t3-app's flat configuration loads
// eslint-config-next through FlatCompat, which resolves its plugins (eslint-plugin-react-hooks,
// @next/eslint-plugin-next, ...) from the project's root: they must sit in its node_modules. pnpm
// up to 9 put every *eslint* and *prettier* package there by default; pnpm 10 stopped, and pnpm
// 11 no longer reads that setting from .npmrc. On a site made by /bootstrap with pnpm 10 or later,
// `pnpm lint` then stopped on "ESLint couldn't find the plugin eslint-plugin-react-hooks" (8 of
// Flavien's 9 projects, found on 2026-10-05). In pnpm-workspace.yaml both majors read it.
// Checked the same day on a copy of a real site's configuration: lint passes after the block and
// a reinstall, and the lockfile written by pnpm 11 is accepted by a frozen install with pnpm 10
// (Vercel's) and pnpm 11. A project made before this release is repaired by
// scripts/repair-lint.mjs, offered by /update-hypervibe.
export const PNPM_PUBLIC_HOIST = ["*eslint*", "*prettier*"];

/**
 * Replace (or add) the top-level `key:` block of a pnpm-workspace.yaml and
 * keep every other line as it is. `entries` is a flat map, written as
 * `  name: value` (names outside [A-Za-z0-9_-] and string values are quoted),
 * or a list, written as `  - "value"`.
 * Returns true when the file changed.
 */
export function setWorkspaceBlock(file, key, entries) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const header = new RegExp(`^${key}\\s*:`);
  const kept = [];
  let inBlock = false;
  for (const line of current.split(/\r?\n/)) {
    if (/^\S/.test(line)) inBlock = header.test(line);
    if (!inBlock) kept.push(line);
  }
  const yamlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
  const yamlValue = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));
  const block = Array.isArray(entries)
    ? [`${key}:`, ...entries.map((v) => `  - ${JSON.stringify(String(v))}`)]
    : [`${key}:`, ...Object.entries(entries).map(([k, v]) => `  ${yamlKey(k)}: ${yamlValue(v)}`)];
  const rest = kept.join("\n").trim();
  const next = `${rest ? `${rest}\n` : ""}${block.join("\n")}\n`;
  if (next === current) return false;
  writeFileSync(file, next);
  return true;
}

/**
 * The values of a top-level list block of a pnpm-workspace.yaml (`key:` then
 * `  - value` lines), quotes taken off; null when the file or the block is
 * absent. Enough for the blocks this harness writes, not a YAML parser.
 */
export function readWorkspaceList(file, key) {
  if (!existsSync(file)) return null;
  const header = new RegExp(`^${key}\\s*:\\s*$`);
  let inBlock = false;
  let found = false;
  const values = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inBlock = header.test(line);
      if (inBlock) found = true;
      continue;
    }
    const m = inBlock ? /^\s+-\s*(.+?)\s*$/.exec(line) : null;
    if (m) values.push(m[1].replace(/^(["'])(.*)\1$/, "$2"));
  }
  return found ? values : null;
}
