#!/usr/bin/env node
// setup-oauth-button.mjs - Patch signin/signup pages to add an OAuth provider
// button (Google or GitHub). Closes the functional gap where /add-google-auth
// and /add-github-auth configured the NextAuth provider but never wired a
// button into the actual auth pages, so users could only access OAuth via the
// NextAuth built-in fallback page at /api/auth/signin.
//
// Usage:
//   node setup-oauth-button.mjs --web-dir <path> --provider <google|github>
//
// What it does:
//   1. For each of src/app/signin/page.tsx and src/app/signup/page.tsx (if
//      present in the project), insert an OAuth button + an "or" divider
//      after the submit button.
//   2. Detects automatically whether the page is the plain or i18n variant
//      (by looking for `useTranslations` in the file) and writes the
//      appropriate snippet.
//   3. Idempotent at two levels:
//      - If the file already contains `signIn("<provider>"`, no change.
//      - If the OAuth block markers exist (a previous run added another
//        provider), the new button is stacked inside the existing block
//        rather than producing a second divider.
//   4. If i18n is active in the project, merges the new keys
//      (signin.orSeparator, signin.continueWithGoogle, signup.orSeparator,
//      etc.) into every messages/<locale>.json. FR + EN translations are
//      built in; other locales receive the EN values as a placeholder for
//      the user to refine.
//
// Output:
//   Writes a parseable JSON to the last line:
//   { success, provider, signinPatched, signupPatched, messagesUpdated, warnings }

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isI18nSetUp, getLocales } from "./_i18n-detect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let webDir = null;
let provider = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--web-dir" && args[i + 1]) webDir = args[++i];
  else if (a === "--provider" && args[i + 1]) provider = args[++i];
  else {
    console.error(`Unknown arg: ${a}`);
    process.exit(2);
  }
}
if (!webDir || !provider) {
  console.error("Usage: --web-dir <path> --provider <google|github>");
  process.exit(2);
}
if (!["google", "github"].includes(provider)) {
  console.error(`--provider must be "google" or "github" (got "${provider}")`);
  process.exit(2);
}
webDir = resolve(webDir);

// ─── Provider-specific strings ───────────────────────────────────────
const PROVIDER_LABEL = provider === "google" ? "Google" : "GitHub";
const PROVIDER_KEY = provider === "google" ? "continueWithGoogle" : "continueWithGithub";
const PROVIDER_LABEL_FR = `Continuer avec ${PROVIDER_LABEL}`;
const PROVIDER_LABEL_EN = `Continue with ${PROVIDER_LABEL}`;

const MARKER_START = "{/* HYPERVIBE_OAUTH_START */}";
const MARKER_END = "{/* HYPERVIBE_OAUTH_END */}";

// ─── Snippet builders ────────────────────────────────────────────────
// The submit button lives at column 12 inside the form (form > CardContent >
// Card > main). Match that indent for the inserted block so diffs read cleanly.
const IND = "            "; // 12 spaces - siblings of the submit Button
const IND2 = IND + "  "; // children inside divs/Buttons

function dividerBlockPlain() {
  return `${IND}<div className="relative my-2">
${IND2}<div className="absolute inset-0 flex items-center">
${IND2}  <span className="w-full border-t border-border" />
${IND2}</div>
${IND2}<div className="relative flex justify-center text-xs uppercase">
${IND2}  <span className="bg-card px-2 text-muted-foreground">ou</span>
${IND2}</div>
${IND}</div>`;
}

function dividerBlockI18n() {
  return `${IND}<div className="relative my-2">
${IND2}<div className="absolute inset-0 flex items-center">
${IND2}  <span className="w-full border-t border-border" />
${IND2}</div>
${IND2}<div className="relative flex justify-center text-xs uppercase">
${IND2}  <span className="bg-card px-2 text-muted-foreground">{t("orSeparator")}</span>
${IND2}</div>
${IND}</div>`;
}

function buttonPlain(pageKind) {
  // signin has access to `params` for callbackUrl; signup does not.
  const callbackExpr =
    pageKind === "signin"
      ? `params.get("callbackUrl") ?? "/dashboard"`
      : `"/dashboard"`;
  return `${IND}<Button
${IND2}type="button"
${IND2}variant="outline"
${IND2}onClick={() => signIn("${provider}", { callbackUrl: ${callbackExpr} })}
${IND2}className="w-full cursor-pointer"
${IND}>
${IND2}${PROVIDER_LABEL_FR}
${IND}</Button>`;
}

function buttonI18n(pageKind) {
  const callbackExpr =
    pageKind === "signin"
      ? `params.get("callbackUrl") ?? "/dashboard"`
      : `"/dashboard"`;
  return `${IND}<Button
${IND2}type="button"
${IND2}variant="outline"
${IND2}onClick={() => signIn("${provider}", { callbackUrl: ${callbackExpr} })}
${IND2}className="w-full cursor-pointer"
${IND}>
${IND2}{t("${PROVIDER_KEY}")}
${IND}</Button>`;
}

// ─── File patcher ────────────────────────────────────────────────────
function patchAuthPage(filePath, pageKind /* "signin" | "signup" */) {
  if (!existsSync(filePath)) return { patched: false, reason: "page-not-present" };

  let content = readFileSync(filePath, "utf8");

  // Idempotency: bail if this provider is already wired.
  if (content.includes(`signIn("${provider}"`)) {
    return { patched: false, reason: "provider-already-present" };
  }

  const isI18n = /from\s+["']next-intl["']/.test(content) || content.includes("useTranslations");

  const newButton = isI18n ? buttonI18n(pageKind) : buttonPlain(pageKind);

  if (content.includes(MARKER_START) && content.includes(MARKER_END)) {
    // Block already exists from a previous provider - stack the new button
    // inside, just before the END marker. We match the marker WITH its
    // leading indent so the replacement preserves alignment.
    const endRe = new RegExp(`( *)${MARKER_END.replace(/[{}/*]/g, "\\$&")}`);
    content = content.replace(endRe, `${newButton}\n$1${MARKER_END}`);
  } else {
    // First-time install: locate the submit button's closing </Button> tag
    // (the only Button at this point whose markup includes `type="submit"`)
    // and insert the full block right after it.
    const submitButtonRegex =
      /<Button[^>]*type="submit"[^>]*>[\s\S]*?<\/Button>/;
    const match = content.match(submitButtonRegex);
    if (!match) {
      return { patched: false, reason: "submit-button-not-found" };
    }
    const submitEnd = match.index + match[0].length;
    const divider = isI18n ? dividerBlockI18n() : dividerBlockPlain();
    const block = `\n${IND}${MARKER_START}\n${divider}\n${newButton}\n${IND}${MARKER_END}`;
    content = content.slice(0, submitEnd) + block + content.slice(submitEnd);
  }

  writeFileSync(filePath, content);
  return { patched: true, isI18n };
}

// ─── Run on signin + signup ──────────────────────────────────────────
const signinPath = join(webDir, "src/app/signin/page.tsx");
const signupPath = join(webDir, "src/app/signup/page.tsx");

// Also support i18n-style locale-segmented paths (in case /add-i18n already
// moved auth pages under src/app/[locale]/). The presence of those is the
// authoritative location.
const localeSignin = join(webDir, "src/app/[locale]/signin/page.tsx");
const localeSignup = join(webDir, "src/app/[locale]/signup/page.tsx");
const actualSignin = existsSync(localeSignin) ? localeSignin : signinPath;
const actualSignup = existsSync(localeSignup) ? localeSignup : signupPath;

const signinResult = patchAuthPage(actualSignin, "signin");
const signupResult = patchAuthPage(actualSignup, "signup");

// ─── Merge messages if i18n active ───────────────────────────────────
const warnings = [];
let messagesUpdated = false;

if (isI18nSetUp(webDir)) {
  const locales = getLocales(webDir) || [];
  // Build the keys this run is adding.
  const frPayload = {
    signin: { orSeparator: "ou", [PROVIDER_KEY]: PROVIDER_LABEL_FR },
    signup: { orSeparator: "ou", [PROVIDER_KEY]: PROVIDER_LABEL_FR },
  };
  const enPayload = {
    signin: { orSeparator: "or", [PROVIDER_KEY]: PROVIDER_LABEL_EN },
    signup: { orSeparator: "or", [PROVIDER_KEY]: PROVIDER_LABEL_EN },
  };

  function deepMerge(target, source) {
    for (const [k, v] of Object.entries(source)) {
      if (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        target[k] &&
        typeof target[k] === "object" &&
        !Array.isArray(target[k])
      ) {
        deepMerge(target[k], v);
      } else if (target[k] === undefined) {
        // Only write keys that aren't already there - never clobber an
        // existing translation the user may have refined.
        target[k] = v;
      }
    }
    return target;
  }

  for (const loc of locales) {
    const langKey = loc.split("-")[0];
    const payload =
      langKey === "fr" ? frPayload : langKey === "en" ? enPayload : enPayload;
    const msgPath = join(webDir, "messages", `${loc}.json`);
    if (!existsSync(msgPath)) {
      warnings.push(`messages/${loc}.json not found, skipped.`);
      continue;
    }
    const existing = JSON.parse(readFileSync(msgPath, "utf8"));
    deepMerge(existing, payload);
    writeFileSync(msgPath, JSON.stringify(existing, null, 2) + "\n");
    messagesUpdated = true;
    if (langKey !== "fr" && langKey !== "en") {
      warnings.push(
        `Locale "${loc}" received English values for OAuth keys - translate manually in messages/${loc}.json (signin.orSeparator, signin.${PROVIDER_KEY}, signup.orSeparator, signup.${PROVIDER_KEY}).`,
      );
    }
  }
}

// ─── Handoff JSON ────────────────────────────────────────────────────
const result = {
  success: true,
  provider,
  signinPatched: signinResult.patched,
  signinReason: signinResult.reason,
  signinPath: actualSignin.replace(webDir + "/", "").replace(webDir + "\\", ""),
  signupPatched: signupResult.patched,
  signupReason: signupResult.reason,
  signupPath: actualSignup.replace(webDir + "/", "").replace(webDir + "\\", ""),
  messagesUpdated,
  i18nActive: isI18nSetUp(webDir),
  warnings,
};

console.log(
  `[setup-oauth-button] provider=${provider} signin=${
    signinResult.patched ? "patched" : signinResult.reason
  } signup=${signupResult.patched ? "patched" : signupResult.reason}${
    messagesUpdated ? " + messages merged" : ""
  }`,
);
console.log(JSON.stringify(result));
