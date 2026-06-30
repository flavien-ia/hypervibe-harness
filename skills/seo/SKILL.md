---
name: seo
description: Audit and optimize SEO for a Next.js project. Checks metadata, sitemap, robots.txt, Open Graph, structured data, performance, and accessibility. Use when the user wants to improve their site's search engine visibility.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# SEO - Audit and optimization

You audit the project's search engine optimization and propose concrete improvements. You explain why each optimization matters.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

---

## Teaching rule (important)

The report must be **readable by someone who is neither a developer nor an SEO expert**. The user is often someone who just put their site online and simply wants to be found on Google, not a search optimization consultant.

**Concrete rules:**

- When you use a technical term, explain it immediately in parentheses the first time it appears. Examples:
  - *"Meta description (the small piece of text that appears under your site's title in Google results)"*
  - *"Open Graph (the data used when your link is shared on Facebook, LinkedIn, WhatsApp, to display a nice card with an image and a description)"*
  - *"Structured data / Schema.org (a format Google understands to know that one block is a product, another a customer review, etc., which lets it show stars, prices, and dates directly in the results)"*
  - *"Core Web Vitals (numbers measured by Google to know whether your site is fast and pleasant to use, which it factors into ranking)"*
  - *"Sitemap (a list of all the pages on your site, provided to Google so it finds them faster)"*
  - *"robots.txt (a small file at the root of the site that tells search engines which pages they are allowed to visit)"*
  - *"Canonical URL (a tag that says 'the real address of this page is this one', useful when the same content is reachable through several URLs)"*
  - *"alt tags on images (the text that describes an image, read by Google to understand what it is about, and by screen readers for visually impaired people)"*
- When you can, prefer a common phrasing and put the technical term in parentheses. Example: *"The title Google will display in its results (the `<title>` tag) is too short"* rather than *"Title tag under-optimized"*.
- Use everyday analogies for abstract concepts: a sitemap = "the map you hand to Google", a robots.txt = "the instructions at the entrance telling visitors where they can go", a title = "your shop's sign seen from the street", a meta description = "the storefront that makes you want to come in (or not)".
- **Explain the concrete impact** of each SEO problem, not just its technical name. Examples:
  - Bad: *"Missing h1 on /contact"*
  - Good: *"On your Contact page, the main heading is missing (the `<h1>` tag). Consequence: Google doesn't clearly understand what this page is about, and it has less chance of showing up when someone searches for 'contact \[your company\]'."*
- For the proposed fixes, explain **why** you do it, not just the code diff.
- When you give a score or a rating, state its scale and what "good" vs "needs improvement" means, a raw score with no reference point helps no one.
- Never be condescending. The user is smart, they just don't know this field.

This rule applies to the report (step 2) and to the optimization proposals. In your internal scan (step 1), you can stay brief and technical.

---

## Step 1 - Audit

Analyze the project and check each point below. For each point, indicate ✅ (OK), ⚠️ (needs improvement), or ❌ (missing).

### Basic metadata

- **Title**: does each page have a unique and descriptive `<title>` (50-60 characters)?
- **Description**: does each page have a unique `meta description` (150-160 characters)?
- **Viewport**: is the `<meta name="viewport">` tag present?
- **Language**: is the `lang` attribute set on `<html>`?
- **Favicon**: is a favicon configured?

Check in the main layout and in each page that exports a `metadata` or `generateMetadata`.

### Open Graph and social networks

- **og:title**, **og:description**, **og:image**: defined for the main pages?
- **og:type**: defined (website, article, etc.)?
- **twitter:card**: defined (summary_large_image recommended)?
- **OG image**: does an image exist in `/public` (1200x630px recommended)?

### HTML structure

- **A single `<h1>` per page**?
- **Heading hierarchy**: h1 → h2 → h3 without skipping a level?
- **Semantic tags**: use of `<main>`, `<nav>`, `<section>`, `<article>`, `<footer>`?
- **`alt` attributes on images**?
- **Internal links**: are the pages linked to each other?

### Technical files

- **robots.txt**: does it exist at the root? Does it allow crawling?
- **sitemap.xml**: does it exist? Is it referenced in robots.txt?
- **Canonical URLs**: do the pages have canonical URLs?

### URLs and slugs

Scan the route tree (`src/app/**/page.tsx` or `apps/web/src/app/**/page.tsx`) and audit each slug.

For each route, check:

- **ASCII kebab-case format**: is the slug in kebab-case (`mon-article`)? Flag if `camelCase` (`monArticle`), `snake_case` (`mon_article`), `CamelCase`, or if it contains uppercase letters / special characters / non-ASCII accents
- **Length**: is the slug 3-5 words max? Flag if > 7 words or > 60 chars
- **Numeric IDs in the URL**: detect dynamic routes `[id]` where a `[slug]` would be preferable. Also look at routes like `/blog/123-mon-titre` (id + slug)
- **Stop words**: detect slugs that contain useless FR stopwords ("de", "le", "la", "pour", "avec", "des", "un", "une") at the start or that add nothing
- **`[slug]` vs `[id]` prefix**: for dynamic routes, if an `[id]` is used, recommend `[slug]` (with explanation: Google prefers URLs that contain a keyword from the content, not an opaque identifier)
- **Routes consistent with the content**: does the slug reflect the page's main keyword? (e.g. a page about "AI in business" with slug `/services-pro` = bad; `/ia-entreprise` = good)

Present as a table:

> | Route | Current slug | Problem | Proposed slug |
> |---|---|---|---|
> | `/blog/[id]/page.tsx` | `[id]` | Numeric ID in the URL (`/blog/123`) | `[slug]` (`/blog/mon-titre`) |
> | `/aProposDeNous/page.tsx` | `aProposDeNous` | camelCase | `/a-propos` |
> | `/services_premium/page.tsx` | `services_premium` | snake_case | `/services-premium` |

### Accessibility (static quick wins)

Accessibility influences Google ranking (Core Web Vitals + quality signals). Audit the following points by static grep, no browser needed:

- **`<img>` without `alt`**: grep `<img[^>]*(?<!alt=["'][^"']+["'])`. Each `<img>` MUST have a descriptive `alt` (or an explicit `alt=""` for decorative images)
- **`<Image>` without `alt`**: same for the `next/image` component
- **Icon-only buttons**: detect `<Button>` whose content is only an icon component (e.g. `<Trash2 />`, `<X />`) with no text and no `aria-label`. These buttons are invisible to screen readers
- **Links with generic text**: detect `<a>`, `<Link>`, `<LinkButton>` whose text is "cliquez ici", "en savoir plus", "ici", "lire la suite", "voir plus", "click here", "read more". Bad for SEO (Google uses the anchor text as a signal) AND for accessibility. Propose descriptive rewordings
- **`:focus-visible` in globals.css**: grep `:focus-visible` in `src/app/globals.css`. If absent, keyboard navigation has no visual feedback → flag. Propose a default snippet
- **Skip-to-content link**: grep `#main` or `skip.*content` in the main layout. Standard pattern: `<a href="#main" className="sr-only focus:not-sr-only">Skip to content</a>` at the start of `<body>`. If absent, flag as an improvement
- **Form labels**: each `<Input>` in a form must have an associated `<Label htmlFor=>` (not just a `placeholder`, which disappears as soon as you type and is not read by screen readers). Grep `<Input>` / `<Textarea>` / `<Select>` without an associated `<Label>`
- **ARIA landmarks**: grep `<main>`, `<nav>`, `<header>`, `<footer>` in the layout. Flag if absent (especially `<main>`, which is the main landmark for screen readers)
- **Suspicious contrast**: detect Tailwind pairs that are almost certain to fail WCAG AA (ratio < 4.5:1). Examples to flag: `text-gray-400 bg-white`, `text-gray-300`, `text-yellow-300 bg-white`, `text-blue-300 bg-white`. Do not compute the real ratio (not possible without rendering), just detect the combinations known to fail

### Performance (SEO impact)

- **Next.js Image component**: do the images use `<Image>` from next/image (lazy loading, automatic optimization)?
- **Fonts**: loaded via `next/font` (no flash of text)?
- **Bundle size**: no unnecessary heavy dependencies?

### Structured data (JSON-LD)

- **WebSite**: is a `WebSite` schema present in the layout?
- **Person or Organization**: does the site declare its owner/author with `sameAs` (social networks)?
- **Enrichment**: are additional schemas relevant (Event, Product, BreadcrumbList, Article)?

### If i18n is configured

- **hreflang**: are the `<link rel="alternate" hreflang="...">` tags present (via `metadata.alternates.languages`)?
- **Localized URLs**: does the sitemap include all language versions with `alternates`?

---

## Step 1b - Content and keyword audit

This step analyzes **content quality** for search optimization: positioning, keywords, tag text, and overall consistency.

### 1b.1 - Infer the positioning

Read the site content in depth to understand the project:
- Read the `CLAUDE.md`, the spec (`*.md` at the root), and the textual content of each page (h1, h2, paragraphs, CTA)
- Read the translation files (`messages/*.json`) if i18n is configured
- Deduce: **what the site offers**, **to whom**, and **what the business goal is** (selling, generating leads, informing, etc.)

Present the inference at the start of the report:

> **Detected positioning:**
> - **Offer**: [what the site offers]
> - **Target**: [to whom]
> - **Goal**: [conversion, awareness, leads, etc.]
> - **Semantic universe**: [the 3-5 main themes of the site]

### 1b.2 - Recommended keywords

From the inferred positioning:

1. **Propose 10-15 main keywords** the site should target, ranked by priority:
   - 3-5 main keywords (short tail, high competition, high volume)
   - 5-10 long-tail keywords (more specific, less competitive, strong intent)

2. **Use Google Suggest** to validate and enrich: for each main keyword, do a WebFetch on `https://suggestqueries.google.com/complete/search?client=firefox&hl=fr&q=MOT_CLE` to retrieve real search suggestions. Add the relevant suggestions to the list.

3. **Check the presence of the keywords** in the current site:
   - Is the main keyword in the `<title>` of the home page?
   - Is it in the `h1`?
   - Is it in the `meta description`?
   - Does it appear in the first paragraph of the content?
   - Are the secondary keywords covered by the other pages (1 main keyword per page)?

Present as a table:

> | Keyword | Estimated volume | Present in title | Present in h1 | Present in description | Targeted page |
> |---------|--------------|-------------------|----------------|------------------------|-------------|
> | keyword 1 | high | ✅ | ✅ | ❌ | / |
> | keyword 2 | medium | ❌ | ❌ | ❌ | none |

### 1b.3 - Title analysis

For each page, evaluate the `<title>`:

- **Length**: 50-60 characters (beyond that, Google truncates)
- **Main keyword**: is it present, ideally at the start?
- **Hook**: does the title make you want to click? (not just descriptive, but engaging)
- **Uniqueness**: does each page have a different title?
- **Brand**: is the site/author name included (often at the end: "| SiteName")?

For each title to improve, propose a **rewrite**:

> **Page /conferences**:
> - Current: "Conférences" (11 chars - too short, no keyword, no hook)
> - Proposed: "Conférences IA en entreprise | [Your name / brand]" (keyword + author + context)

### 1b.4 - Meta description analysis

For each page, evaluate the `meta description`:

- **Length**: 150-160 characters (beyond that, Google truncates)
- **Main keyword**: is it present naturally?
- **Call-to-action**: does the description encourage clicking? (action verbs: "Discover", "Learn", "Book")
- **Added value**: does it explain what the user will find on the page?
- **Uniqueness**: does each page have a different description?

For each description to improve, propose a **rewrite**.

### 1b.5 - Content / SEO consistency

Check the consistency between each page's content and its metadata:

- Does the `h1` reflect the `title` and the `description`?
- Does the page content cover the targeted keyword in depth?
- Are there pages targeting the same keyword (cannibalization)?
- Does each important page have at least 300 words of content?
- Do the internal links connect the pages to each other in a logical way?

### 1b.6 - Readability (Flesch-Kincaid adapted for FR)

Measure the **reading ease** of each page's textual content. Google prefers accessible content (better engagement, longer reading time).

For each important page, extract the visible text (h1, h2, h3, paragraphs, lists, ignore code, button labels, navs) and compute the Flesch score adapted to French:

```
Score FR = 207 - 1.015 × (words / sentences) - 73.6 × (syllables / words)
```

Simple inline node implementation:

```bash
node -e "
const fs = require('fs');
const text = fs.readFileSync(process.argv[1], 'utf8')
  .replace(/<[^>]+>/g, ' ')           // strip HTML/JSX tags
  .replace(/\{[^}]+\}/g, ' ')         // strip JSX expressions
  .replace(/\s+/g, ' ').trim();
const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
const words = text.split(/\s+/).filter(w => w.length > 0);
const wordCount = words.length;
const syllables = words.reduce((acc, w) => acc + Math.max(1, (w.match(/[aeiouyéèêëàâôöûüîï]+/gi) || []).length), 0);
const score = 207 - 1.015 * (wordCount / Math.max(1, sentences)) - 73.6 * (syllables / Math.max(1, wordCount));
console.log('Flesch FR:', score.toFixed(1), '| Words:', wordCount, '| Sentences:', sentences);
" <path-to-file>
```

**Scale (FR)**:
- **> 70** = easy to read (general public, blog, ecommerce) - recommended for most sites
- **50-70** = standard (journalistic articles, service pages) - OK
- **30-50** = technical/pro (technical doc, case study)
- **< 30** = academic - scares off 95% of readers, bad for SEO unless a very specific target

**In the report**, flag the pages whose score does not match the target detected in Step 1b.1:
> *"Your `/services` page targets 'small and medium businesses' but its readability score is 28 (very technical). Sentences too long (22 words on average). I recommend cutting into shorter sentences and removing the jargon."*

### 1b.7 - Semantic co-occurrences (topical depth)

For each important page, check that the content covers the **semantic field** around the target keyword, not just the keyword itself. Google expects to see related terms to consider that a topic is covered in depth (the "LSI keywords" / latent semantic indexing concept).

Method:

1. **Generate the list of expected terms** for each target keyword. Two approaches:
   - **Via Google Suggest**: WebFetch `https://suggestqueries.google.com/complete/search?client=firefox&hl=fr&q=<keyword>` → extract the 10 suggestions (these are the most frequent associated queries)
   - **Via "People Also Ask" / related searches**: WebFetch the Google search page for the keyword (with user-agent), extract the "People also ask" and "Related searches"
2. **Grep each term** in the textual content of the target page
3. **Coverage score**: number of terms found / total number expected

Present:

> **Page /services targets "AI in business"**:
> - Expected semantic terms (Google Suggest): digital transformation, automation, ROI, use cases, productivity, training, adoption, benefits, implementation, governance
> - Found in your content: 3/10 (automation, productivity, training)
> - Missing: digital transformation, ROI, use cases, adoption, benefits, implementation, governance
> - **Suggested action**: enrich your page with 2-3 paragraphs covering the most relevant missing terms (digital transformation, ROI, use cases) to show Google that you cover the topic in depth.

### 1b.8 - Content freshness

Google prefers recent content (especially for YMYL topics: Your Money Your Life - health, finance, news - and for "time-sensitive" queries). Check the freshness signals:

- **`<time datetime="...">`** on article/blog type pages: present?
- **Date shown in the HTML**: grep "publié le", "mis à jour le", "modifié le", `<time>` in the article templates. Flag if an article has no visible date
- **JSON-LD Article schema**: if `Article` schemas exist, do they check `datePublished` AND `dateModified`?
- **Sitemap `lastmod`**: does `sitemap.ts` generate a `lastModified` for each URL (or is it a fixed / absent date)? A real dynamic `lastmod` signals recently updated pages to Google

**In the report**:
> *"Your article `/blog/mon-post` has no visible date in the HTML. Google can't know when it was written, and neither can the readers. Add a line `<time dateTime=\"2026-04-19\">Publié le 19 avril 2026</time>` at the top of the article."*

### 1b.9 - Content report

Present the content report separately:

> **Content audit - Results**
>
> **Positioning**: [1-line summary]
>
> **Recommended main keywords**: [list of the 5 priorities]
>
> ✅ **Well optimized**: [pages whose title + description + h1 are consistent and contain the keyword]
>
> ⚠️ **To optimize**:
> - Page /xxx: title too generic, keyword missing from the description
> - Page /yyy: description too short (80 chars), no CTA
> - Page /services: readability 28 (very technical) for a small-business target
> - Page /accueil: 3/10 expected semantic terms found (weak topical depth)
>
> ❌ **Problems**:
> - 2 pages target the same keyword (cannibalization)
> - Page /zzz has only 50 words of content
> - No blog article shows its date (no freshness signal for Google)

---

## Step 2 - Report

Present the two reports together:

**First** the content report (step 1b.9 - positioning, keywords, titles, descriptions, readability, topical depth, freshness).

**Then** the technical report:

> **Technical audit - Results**
>
> ✅ **OK (X points)**: viewport, language, favicon, ...
>
> ⚠️ **To improve (X points)**:
> - Description too short on the home page (currently 80 characters, recommended 150-160)
> - OG image missing (shares on social networks will have no visual preview)
>
> ❌ **Missing (X points)**:
> - No sitemap.xml
> - No robots.txt
> - No alt attribute on 3 images
>
> **Overall score: X/Y**

---

## Step 3 - Fixes

Ask the user:

> Do you want me to fix all this now? I can handle the ⚠️ and ❌ points automatically.

If the user accepts, fix in this order:

### 3a - Missing basics (metadata, robots.txt, sitemap, JSON-LD WebSite)

If **none** of the three files `src/app/sitemap.ts`, `public/robots.txt`, or an enriched metadata with `metadataBase` exists → run the plugin's init script:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-seo.mjs" \
  --name "<Site Name>" \
  --description "<150-160 char description>" \
  --locale fr_FR
```

The script creates/updates layout.tsx (metadata + minimal JSON-LD WebSite + html lang), `public/robots.txt`, `src/app/sitemap.ts`. It is idempotent.

If a part already exists but is incomplete → manually patch only the missing piece (the script preserves existing files).

### 3b - Sitemap: enrich with the real pages

The script creates the sitemap with just `/`. Update it to reflect the real state:

1. Scan all the `page.tsx` to list the routes
2. Exclude the noindex pages (admin, preferences)
3. Priorities: 1.0 (home), 0.8-0.9 (key pages), 0.7 (secondary), 0.3 (legal)
4. If i18n: one entry per locale per page + `alternates.languages` for the hreflang

### 3c - Open Graph image

If `public/og-image.png` does not exist, create a placeholder and note in the summary that the user will need to replace it with a real image (1200×630).

### 3d - HTML: alt, headings, semantics

Go through the components and fix the problems identified in step 1 (missing alt, broken h1/h2/h3 hierarchy, non-semantic tags).

### 3e - Fonts via next/font

If the fonts are not loaded via `next/font` (the T3 scaffold does it by default with Geist, so this is rare), migrate to `next/font/google` or `next/font/local`.

### 3f - Enriched JSON-LD

The script in 3a adds a minimal `WebSite` schema. Depending on the project context, **add**:
- **Portfolio/personal**: `Person` schema (`name`, `url`, `jobTitle`, `sameAs` with the social networks found in the footer)
- **Company**: `Organization` schema (`name`, `url`, `logo`, `sameAs`)
- **Events** (conferences, training): `Event` schema
- **Products** (books, paid training): `Product` schema

Look for the social links in the footer/components to fill `sameAs`.

### 3g - URLs/slugs (suggested manual fixes)

For the routes flagged in Step 1 (camelCase, snake_case, numeric IDs, `[id]` instead of `[slug]`, stop words), **do NOT rename automatically**, it is too risky:
- Renaming a route breaks external links (backlinks, bookmarks, shared posts)
- URLs already indexed by Google will return 404 (temporary loss of ranking)

Instead, **list the recommendations** in the final report with an explicit note:

> ⚠️ **URL renaming: to be done manually and gradually**
>
> If you decide to rename routes, remember to set up 301 redirects from the old URLs to the new ones (in `next.config.js`, the `redirects()` section) to preserve the SEO already earned and avoid 404s.

Propose adding the redirects automatically in `next.config.js` if the user approves the renaming.

### 3h - Accessibility (static fixes)

For each a11y problem flagged in Step 1:

- **`<img>` / `<Image>` without `alt`**: fix by adding a descriptive `alt` (infer from the file name, the context, or ask the user if not obvious). For purely decorative images, use `alt=""` (explicit empty).
- **Icon-only buttons**: add a descriptive `aria-label`. E.g. `<Button><Trash2 /></Button>` → `<Button aria-label="Supprimer"><Trash2 /></Button>`.
- **Links with generic text**: propose descriptive rewordings ("Read the article about XYZ" instead of "Read more").
- **Missing `:focus-visible`**: add a default block to `globals.css`:
  ```css
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  ```
- **Missing skip-to-content**: add at the very start of `<body>` in `layout.tsx`:
  ```tsx
  <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-background px-4 py-2 rounded">
    Skip to content
  </a>
  ```
  And add `id="main"` to the `<main>` of each page.
- **Missing labels**: propose a patch per form.
- **Suspicious contrast**: list the affected components and suggest alternatives (e.g. `text-gray-400` → `text-gray-600` on a light background).

---

## Step 4 - Verification

After the fixes, re-run the audit quickly and display the new score.

> ✅ **SEO audit complete.** Score: X/Y → X/Y
>
> One manual point remains: replace the placeholder Open Graph image (`/public/og-image.png`) with a real image from your site (1200x630px).

---

## Step 4b: Confront the result with PageSpeed Insights (measured performance)

The audit above is **static** (reading the code). We can go further and **measure** the real performance of the deployed site with PageSpeed Insights (Google's official tool, which runs a real Lighthouse): real speed, Core Web Vitals, and fixes prioritized by measured impact. This is the measurement layer the static audit cannot provide (numbers on the live build, not a deduction from the code).

This is optional and takes a few minutes. Ask via `AskUserQuestion`:

> Do you want me to **measure** your site's real speed with PageSpeed Insights (Google's tool)? I load a few representative pages like a real visitor, give you the numbers (speed, Core Web Vitals), and propose fixes sorted by real impact. It takes a few minutes. If it's the first time, you'll need to create a free Google key (2 min, just once for all your projects).

- **Yes** → invoke the `seo-perf` skill in integrated mode (pass `--from-seo`). Since `/seo` just asked the opt-in question, `seo-perf` skips its own and goes straight to the audit. Follow its flow (key preflight, representative pages, audit, report, bounded improvement pass, deployment then re-verification).
- **Not now** → continue to Step 5, mentioning that it can be re-run at any time with `/seo-perf`.

**Sequencing note**: `seo-perf` measures the **live** site. The SEO fixes made in Step 3 that are not yet deployed will only appear in the measurement after deployment. `seo-perf` handles the order itself (deployment then re-verification), so let it drive that part.

---

## Step 5 - Going further

The audit we just did prepares you for **classic Google**. Two complementary directions for what comes next:

### 5a - Optimize for AI (doable immediately)

Today, people also search via **ChatGPT, Claude, Perplexity, Google AI Overviews, Bing Chat**. The signals for being **cited by AIs** are not quite the same as for showing up in Google results. The `/geo` skill does a dedicated audit (`llms.txt`, rules for AI crawlers, FAQPage schema, Q&A format, citability signals), no need to wait for the site to have traffic.

### 5b - Connect to Google Search Console (recommended now, useful in 2-4 weeks)

Google Search Console (GSC) gives you the **real Google data**: which queries bring traffic, which pages are indexed, your real CTR. The best is to **connect the site now** (so Google starts collecting right away) and come back to see the data in 2 to 4 weeks. The `/gsc` skill handles it from A to Z: adding the property, automatic DNS verification, sitemap submission, and first audit.

### Inviting the user

Add this block to the final summary of the audit:

> ## 🚀 Next steps
>
> **Optimize for AIs** - run `/geo` for an audit dedicated to AI engines (ChatGPT, Claude, Perplexity, Google AI Overviews...). It is complementary to what we just did.
>
> **Connect to Google Search Console** - run `/gsc` to connect your site and see what Google really sees. You might as well do it now: Google starts collecting data as soon as you connect, and in 2-4 weeks you'll have a real overview.
>
> Tell me *"run /geo"* or *"connect to Google Search Console"* and I'll take care of it.
