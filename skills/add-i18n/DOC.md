# /add-i18n

Makes your site multilingual by offering several languages to your visitors. French, English, Spanish, etc.: each page is translated and the visitor picks their own.

## When to use it

- Your target includes **several countries / several languages**
- You want to add English (or another language) to an existing French site
- You want to handle multilingual SEO cleanly (URLs `/fr/...`, `/en/...`, hreflang, per-language sitemap)

## How it works

1. **Check**: if i18n is already in place, Hypervibe offers you a menu: add a new language, change the default language, remove a language, etc.

2. **Choice of languages**: Hypervibe asks you which languages you want to support (e.g. `fr en es`) and which one will be the **default** language.

3. **Installing next-intl**: the reference library for i18n in Next.js is installed.

4. **Scaffolding** (in one shot, via a deterministic script):
  - Creation of the `messages/<language>.json` files for each language (FR/EN/ES/DE/IT/PT have pre-translated templates; the others start empty in English)
  - Routing configuration (`src/i18n/routing.ts`) with the list of languages + default language
  - Messages loader (`src/i18n/request.ts`)
  - Minimal `[locale]` layout with `generateMetadata` + `alternates.languages` for **hreflang SEO**
  - A `LanguageSwitcher` component ready to drop into your nav

5. **Middleware**: a Next.js middleware is created (or merged if you already have one) to handle the URLs `/fr/...`, `/en/...`, etc.

6. **Restructuring**: your existing pages are moved from `src/app/` to `src/app/[locale]/` (all except `api/`, which stays at the root). The providers (TRPCReactProvider, fonts, etc.) are moved up into the right layout.

7. **Sitemap update**: if you have one, it is extended with one entry per language × page (again for SEO).

## What it creates for you

- The `next-intl` package installed
- The `messages/` folder with one `.json` file per language (to enrich over time)
- The `src/app/[locale]/` structure with your pages
- A `LanguageSwitcher` component (to place in your header / footer wherever you want)
- A middleware for automatic redirection based on the visitor's preferred language
- Multilingual SEO (hreflang, per-language sitemap)

## Prerequisites

- The project must be Next.js with App Router (typically initialized by `/bootstrap`)
- No other dependency, i18n can be added before or after the other building blocks

## Tips

{{callout:tip|To translate your texts}}
In your server components: `const t = await getTranslations("namespace")`. In your client components: `const t = useTranslations("namespace")`. Then: `t("key")` returns the translation adapted to the current language. The texts live in `messages/<language>.json`.
{{/callout}}

{{callout:info|Ask Hypervibe to translate for you}}
To add a language to a site already filled in in French, you can simply tell Hypervibe: *"translate the whole site into English"*. It reads each `messages/fr.json` file and generates the corresponding `messages/en.json`. You review afterward to fine-tune the tone.
{{/callout}}

{{callout:info|Your default-language SEO is preserved}}
Thanks to `localePrefix: "as-needed"`, your default-language URLs stay exactly as they are (`/mon-article`, no prefix), so your existing SEO, backlinks, and Search Console data are kept intact. Only the additional languages get a prefix (`/en/my-article`). Nothing to redirect.
{{/callout}}
