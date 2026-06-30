---
name: add-i18n
description: "Add internationalization (i18n) to an existing T3/Next.js project using next-intl with sub-path routing. Uses `localePrefix: \"as-needed\"` so the default locale keeps its URLs unprefixed (preserving existing SEO and backlinks), and only non-default locales get a prefix."
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add i18n - next-intl Configuration

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Adds internationalization with `next-intl` to the current project. Can be called by `/bootstrap` or standalone on an existing project.

---


## Step 0 - Preflight: is i18n already configured?

**Before anything else**, invoke `_check-deps i18n` to detect whether `next-intl` is already in place:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" i18n)
i18n_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).i18n.ok)")
messages_dir=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).i18n.messagesDir || '')")
```

### If `i18n_ok = true` -> re-configuration mode

`next-intl` is already installed (messages folder: `$messages_dir`). Do NOT re-run the app directory restructuring (risk of breaking existing imports). Show a menu:

> ## 🌍 Internationalization is already set up on your project (messages: `$messages_dir`)
>
> What do you want to do?
>
> 1. **Add a new language** (e.g. you had FR/EN and you want to add ES, DE or another) - I create the `messages/<locale>.json` file based on the existing structure and automatically translate all the content
> 2. **Change the default language** (the one shown when a visitor arrives with no preference) - I update the next-intl config and the middleware
> 3. **Remove an existing language** - I drop its messages file and update the list of supported locales
> 4. **Start over from scratch** (only useful if the config is broken) - ⚠️ **very destructive**: restructuring the app directory cancels all the existing i18n routes. I strongly advise against it, prefer debugging case by case
> 5. **Something else** - tell me what you want

Wait for the answer.

**Depending on the answer**:

| Choice | Action |
|---|---|
| 1 (add locale) | Ask for the locale code (e.g. `es`, `de`, `it`). Read the structure of an existing locale (e.g. `messages/fr.json`) to copy the structure. **Automatically translate the entire file** (every key) into the new language, without asking the user anything. Update the next-intl config (`src/i18n/routing.ts` or equivalent) to include the new locale in `locales`. The user can review/fix it afterward if they want. |
| 2 (default locale) | Ask for the new default locale. Update `defaultLocale` in the next-intl config. Remind the user that the unprefixed routes will now be served in this language. |
| 3 (remove locale) | Ask which locale to remove. Warn that if visitors had bookmarked the URL in that language, they will get a 404. Remove `messages/<locale>.json` and remove the locale from `locales` in the config. |
| 4 (start over) | Refuse firmly unless the user insists. If they insist: ask them to manually remove `next-intl` from `package.json`, the `messages/` folder, and the `[locale]/` structure of the app, then re-run. |
| 5 (something else) | Ask for clarification. Do not launch the full flow by default. |

**At the end**, jump straight to the **final summary**.

### If `i18n_ok = false` (not yet configured)

Continue normally to Step 1. This is the initial installation flow.

---

## Step 1 - Check prerequisites

Invoke the `_detect-project-root` internal skill to get `PROJECT_NAME`, `WEB_DIR`, `IS_NEXTJS`. Abort if `IS_NEXTJS=no`.

If called standalone, ask the user:
> Which languages do you want to support? (e.g., `fr en es`)
> Which is the default locale? (first in the list if not specified)

**NEVER ask the user "empty file or auto-translation?"** - the answer is always **full auto-translation**. Claude takes charge of migrating all existing content (FR or whatever the default language is) into each requested locale. The user can review/fix it afterward if they want, but the site must be fully functional in all languages by the end of the skill - never half-broken.

## Step 2 - Install + scaffold via script

`cd` into `$WEB_DIR` first - otherwise `pnpm add` creates an orphan `package.json` at the root of the parent folder.

```bash
cd "$WEB_DIR"
pnpm add next-intl
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-i18n.mjs" \
  --locales <comma-list> \
  --default <default-locale>
```

(The script automatically detects the structure from `$WEB_DIR` - no need for `--web-dir`.)

The script creates in one shot:
- `src/i18n/routing.ts` (array of locales + defaultLocale)
- `src/i18n/request.ts` (messages loader)
- `messages/<locale>.json` for each locale (FR/EN/ES/DE/IT/PT have ready-made templates, otherwise a neutral English template)
- `src/app/[locale]/layout.tsx` (minimal, with `generateMetadata` + `alternates.languages` already wired for hreflang)
- `src/components/language-switcher.tsx`

It also patches:
- `next.config.(ts|mjs|js)`: wraps the default export with `withNextIntl(...)`
- `src/app/sitemap.ts` (if it exists): expands it to one entry per locale × page with `alternates.languages`

It refuses to run if `src/i18n/` or `src/app/[locale]/` already exist (delete manually to regenerate). If a regex patch fails (T3/next-intl have drifted), the script warns in its output.

## Step 3 - Create middleware (if absent) or merge with the existing one

If `src/middleware.ts` already exists (e.g. hostname routing), **merge** the next-intl logic with the existing one rather than overwriting. Otherwise, create the file:

```typescript
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
```

## Step 4 - Restructure app directory

Move the existing pages (`page.tsx`, `not-found.tsx`, the `politique-de-confidentialite/` and `mentions-legales/` folders if present, and any other application page) from `src/app/` to `src/app/[locale]/`. Do not move `api/` (API routes stay at the root, no localization of endpoints).

**Privacy policy note**: if the `politique-de-confidentialite/page.tsx` page is the one generated by `/bootstrap` (signature: import of `SUBPROCESSORS`, h1 "Politique de confidentialité", no use of next-intl), the `setup-i18n.mjs` script has already **automatically upgraded** it to the i18n version (template + `messages/<locale>.json` keys + `i18n.<locale>` blocks in `subprocessors.json`). So you just have to move it as is, no need to translate it by hand in Step 5.

**Legal pages note (intentionally not translated)**: `mentions-legales/page.tsx` AND `cgv/page.tsx` (if present) are French legal documents specific to French law. You **move** them under `[locale]/` like the other pages, but you do **NOT** translate their content in Step 5. They stay in French even for visitors of other locales. This is the standard practice on French multilingual sites (Doctolib, Decathlon, BlaBlaCar, etc. keep their legal notices and terms in FR across all their versions). Mention this choice explicitly to the user in the final recap.

**Non-templated Stripe pages note**: the pages generated by `/add-stripe` (`/pricing`, `/payment/success`, `/payment/cancel`) are **custom per project** - Claude writes them while integrating the user's real products/prices. No static template, so no automatic upgrade via the manifests. You handle these pages in Step 5 like any other custom page: extract the hardcoded strings to `messages/<locale>.json` (namespace `pricing`, `paymentSuccess`, `paymentCancel`), translate into each locale, then replace the literals with `t("key")`.

**Admin pages note (intentionally not translated)**: the pages under `src/app/admin/` (generated by `/add-role`, `/add-agent-dashboard`, the bootstrap's `/admin/*`, etc.) are a **surface reserved for the project's admin/owner** - not seen by public visitors. Hypervibe convention: **admin pages stay in French regardless of the site's locale**, like the legal pages. You move them under `[locale]/admin/` during Step 4 but you do not translate their content in Step 5, and you do not extract their strings to `messages/`. Rationale: (a) audience = 1 person who speaks FR, (b) huge string volume (tables, forms, states), (c) translation ROI close to nil. Mention this choice in the final recap.

Replace the root `src/app/layout.tsx` with a minimal version:

```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

**Augment `src/app/[locale]/layout.tsx`** (created by the script) with the providers that lived in the old root layout:
- `TRPCReactProvider` (if tRPC is configured)
- `className={geist.variable}` on the `<html>` (if Geist)
- Any global `metadata` that was in the root layout (title, openGraph, etc.) -> merged into the `generateMetadata` of `[locale]/layout.tsx`

The script has already put the essentials: `NextIntlClientProvider`, `setRequestLocale`, `notFound()` check, `generateStaticParams`, and `alternates.languages` for hreflang.

## Step 5 - Extract and translate the existing content (never ask, always do)

**Absolute rule**: by the end of this skill, the site must be fully translated into all requested locales. No empty messages file, no broken page. **Never** ask the user whether they want to "scaffold only" or "auto-translate" - always translate.

For each page/component moved into `src/app/[locale]/` (and any shared component under `src/components/`, `src/app/_components/`, etc. that contains hardcoded text in the default language):

1. **Extract** each hardcoded string (free JSX text, `title`/`alt`/`aria-label`/`placeholder` attributes, `metadata.title`/`description` values, contents of `<button>`, `<a>`, `<p>`, `<h1-6>`, etc.) to `messages/<defaultLocale>.json`, grouped by logical namespace (`common`, `home`, `header`, `footer`, `<page>`, ...).
2. **Replace** the hardcoded string in the source with `t("key")` after importing `useTranslations` (client component) or `getTranslations` (server component) with the right namespace.
3. **Translate** then `messages/<defaultLocale>.json` into each other requested `messages/<locale>.json`, keeping the same namespace and key structure.

Expected translation quality: excellent for FR <-> EN/ES/IT/DE/PT (mastered languages). For other languages, translate as best as possible and mention in the final summary that the user should have it proofread by a native speaker.

Tip: if the string volume is large (>50), proceed file by file (page by page) rather than in one big patch - readable diff, less risk of breaking imports.

## Step 6 - Update CLAUDE.md

Add i18n to the Stack section. Add a convention:
- "i18n: use `useTranslations('namespace')` in client components, `getTranslations('namespace')` in server components. Message files in `messages/<locale>.json`."

## Step 7 - Summary

Tell the user:
- next-intl is configured with sub-path routing AND `localePrefix: "as-needed"` : URLs for the default locale stay unprefixed (`/about`, `/contact`) - your existing SEO, backlinks, and Search Console data are preserved. Only the other locales get a prefix (`/en/about`, `/en/contact`).
- Message files are in `messages/` - add translations there
- LanguageSwitcher component is ready to use
- For server components: `const t = await getTranslations("common")`
- For client components: `const t = useTranslations("common")`
