#!/usr/bin/env node
// _i18n-upgrade.mjs - Scan all known features and retrofit them with i18n
// support when their plain (bootstrap-generated) version is detected in the
// project.
//
// For each `templates/<feature>/manifest.json` present in the plugin:
//   1. Try to find the bootstrap-generated file at `manifest.dest` (in the
//      project). If absent, skip.
//   2. Verify the bootstrap signature in the file content. If absent (custom
//      file, already upgraded, etc.), skip.
//   3. Extract any `preserveSubstitutions` from the existing file via regex so
//      we can re-inject them in the new i18n template.
//   4. Read templates/<feature>/i18n.tsx, substitute placeholders, write to
//      the same dest path.
//   5. Call _i18n-merge-messages.mjs to merge the feature's translations into
//      the project's per-locale messages files.
//   6. If manifest.postHook is set, run the named hook (a sibling script) for
//      any feature-specific actions (e.g. updating subprocessors.json for
//      privacy-policy).
//
// Manifest schema (templates/<feature>/manifest.json):
//   {
//     "id": "feature-id",
//     "namespace": "messagesNamespaceKey",
//     "dest": "src/path/to/output/file.tsx",
//     "detect": {
//       "signature": "string that MUST be in the bootstrap-generated file"
//     },
//     "templates": {
//       "plain": "plain.tsx",
//       "i18n": "i18n.tsx"
//     },
//     "messages": {
//       "fr": "messages-fr.json",
//       "en": "messages-en.json"
//     },
//     "preserveSubstitutions": [
//       { "placeholder": "PROJECT_NAME", "extractRegex": "..." }
//     ],
//     "postHook": "optional-script-name.mjs"
//   }
//
// Usage:
//   node _i18n-upgrade.mjs --web-dir <path>

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isI18nSetUp, getLocales } from "./_i18n-detect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");
const TEMPLATES_ROOT = join(PLUGIN_ROOT, "templates");

const args = process.argv.slice(2);
let webDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--web-dir" && args[i + 1]) webDir = args[++i];
  else {
    console.error(`Unknown arg: ${args[i]}`);
    process.exit(2);
  }
}

if (!webDir) {
  console.error("Usage: --web-dir <path>");
  process.exit(2);
}

if (!isI18nSetUp(webDir)) {
  console.error(`Project at ${webDir} is not i18n-enabled. Run setup-i18n.mjs first.`);
  process.exit(1);
}

// ─── Discover all manifests ──────────────────────────────────────────
const manifests = [];
for (const entry of readdirSync(TEMPLATES_ROOT)) {
  const manifestPath = join(TEMPLATES_ROOT, entry, "manifest.json");
  if (!existsSync(manifestPath)) continue;
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    m.__dir = dirname(manifestPath);
    manifests.push(m);
  } catch (e) {
    console.warn(`  ⚠️  Skipping malformed manifest: ${manifestPath} (${e.message})`);
  }
}

if (manifests.length === 0) {
  console.log("[_i18n-upgrade] No feature manifests found, nothing to do.");
  process.exit(0);
}

// ─── For each manifest, detect + upgrade ─────────────────────────────
const summary = { upgraded: [], skipped: [], failed: [] };

for (const manifest of manifests) {
  const destPath = join(webDir, manifest.dest);

  if (!existsSync(destPath)) {
    summary.skipped.push(`${manifest.id} (file not in project)`);
    continue;
  }

  const existingContent = readFileSync(destPath, "utf8");
  const signature = manifest.detect?.signature;
  if (signature && !existingContent.includes(signature)) {
    summary.skipped.push(`${manifest.id} (signature absent - custom file or already upgraded)`);
    continue;
  }

  // Extract substitutions from existing file. Each sub can be:
  //   - "presentValue" semantics: regex match → use `presentValue` literally,
  //     no match → use `fallback`. Useful for binary-conditional placeholders
  //     (e.g. signin's forgot-password link: either a Link or a <span>).
  //   - "captured" semantics (default): use the first capture group, fallback
  //     otherwise. Useful for extracting a value like a project name.
  const substitutions = {};
  for (const sub of manifest.preserveSubstitutions || []) {
    const re = new RegExp(sub.extractRegex);
    const m = existingContent.match(re);
    if (sub.presentValue !== undefined) {
      substitutions[sub.placeholder] = m ? sub.presentValue : sub.fallback || "";
    } else {
      substitutions[sub.placeholder] = m && m[1] ? m[1].trim() : sub.fallback || "";
    }
  }

  // Read i18n template + apply substitutions
  const i18nTemplatePath = join(manifest.__dir, manifest.templates.i18n);
  if (!existsSync(i18nTemplatePath)) {
    summary.failed.push(`${manifest.id} (i18n template missing: ${i18nTemplatePath})`);
    continue;
  }
  let i18nContent = readFileSync(i18nTemplatePath, "utf8");
  for (const [key, value] of Object.entries(substitutions)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    i18nContent = i18nContent.replace(re, value);
  }
  writeFileSync(destPath, i18nContent);

  // Merge messages
  const mergeScript = join(__dirname, "_i18n-merge-messages.mjs");
  const mergeRes = spawnSync(
    "node",
    [mergeScript, "--web-dir", webDir, "--feature", manifest.id],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (mergeRes.status !== 0) {
    summary.failed.push(
      `${manifest.id} (file written but messages merge failed: ${(mergeRes.stderr || mergeRes.stdout || "").trim()})`,
    );
    continue;
  }

  // Optional post-hook
  if (manifest.postHook) {
    const hookPath = join(__dirname, manifest.postHook);
    if (existsSync(hookPath)) {
      const hookRes = spawnSync(
        "node",
        [hookPath, "--web-dir", webDir, "--locales", (getLocales(webDir) || []).join(",")],
        { stdio: "pipe", encoding: "utf8" },
      );
      if (hookRes.status !== 0) {
        summary.failed.push(
          `${manifest.id} (post-hook failed: ${(hookRes.stderr || hookRes.stdout || "").trim()})`,
        );
        continue;
      }
    }
  }

  summary.upgraded.push(manifest.id);
}

console.log(`[_i18n-upgrade] Done.`);
if (summary.upgraded.length) console.log(`  ✓ Upgraded: ${summary.upgraded.join(", ")}`);
if (summary.skipped.length) console.log(`  ↷ Skipped: ${summary.skipped.length}`);
if (summary.failed.length) {
  console.error(`  ✗ Failed:`);
  for (const f of summary.failed) console.error(`     - ${f}`);
  process.exit(1);
}
