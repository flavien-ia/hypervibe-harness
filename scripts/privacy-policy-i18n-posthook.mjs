#!/usr/bin/env node
// privacy-policy-i18n-posthook.mjs - Post-hook for the privacy-policy feature
// after _i18n-upgrade.mjs has swapped the page template.
//
// The privacy page needs more than just a template swap: each entry in
// src/lib/subprocessors.json (the data the page renders) must also receive
// `i18n.<locale>` blocks for the project's non-default locales. This hook
// delegates that work to `update-privacy-policy.mjs --add-i18n`.
//
// Usage (called by _i18n-upgrade.mjs):
//   node privacy-policy-i18n-posthook.mjs --web-dir <path> --locales fr,en,es

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let webDir = null;
let localesArg = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--web-dir" && args[i + 1]) webDir = args[++i];
  else if (args[i] === "--locales" && args[i + 1]) localesArg = args[++i];
}

if (!webDir) {
  console.error("Usage: --web-dir <path> --locales fr,en,...");
  process.exit(2);
}

// We only translate locales that are NOT French (the catalog root values are
// French, so no fr block is needed - the page falls back to root for fr).
const locales = localesArg
  .split(",")
  .map((s) => s.trim())
  .filter((l) => l && l.split("-")[0] !== "fr");

if (locales.length === 0) {
  console.log("[privacy-policy-i18n-posthook] No non-fr locales, nothing to do.");
  process.exit(0);
}

const updateScript = join(__dirname, "update-privacy-policy.mjs");
if (!existsSync(updateScript)) {
  console.error("[privacy-policy-i18n-posthook] update-privacy-policy.mjs missing");
  process.exit(1);
}

const res = spawnSync(
  "node",
  [updateScript, "--add-i18n", locales.join(",")],
  { cwd: webDir, stdio: "inherit" },
);
process.exit(res.status ?? 0);
