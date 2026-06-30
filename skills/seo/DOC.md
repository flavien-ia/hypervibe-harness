# /seo

Audits and improves your site's Google ranking. Hypervibe scans everything that matters to Google (content, technical, performance, accessibility), explains each issue in plain language, and fixes what it can.

## When to use it

- **Before or shortly after** your site goes live
- You want to **be found on Google** when someone searches for your name, your brand, or the keywords of your business
- You want to check that your shares on LinkedIn / Facebook / WhatsApp display a **nice card** (Open Graph)
- You want to improve your **Core Web Vitals score** (speed as perceived by Google)

## How it works

1. **Full audit**: Hypervibe scans your project across several areas:
  - **Technical**: `<title>` + `<description>` metadata on each page, `metadataBase`, sitemap, robots.txt, canonical URLs, JSON-LD, hreflang if i18n, OG image
  - **Content**: relevant keywords, heading structure (H1 / H2 / H3), text length, content freshness
  - **Performance**: image size, lazy loading, fonts, blocking JavaScript, Core Web Vitals (LCP, FID, CLS)
  - **Accessibility**: alt text on images, color contrast, keyboard navigation, labels on forms
  - **URLs**: kebab-case, length, presence of the main keyword
  - **Readability**: clear tone, short sentences, structure (introduction / paragraphs / conclusion)

2. **Educational report**: each area is rated ✅ OK / ⚠️ To improve / 🔴 To fix. For each issue:
  - **Plain-language explanation** (for example, "the main heading is missing on your Contact page, the `<h1>` tag")
  - **Concrete consequence** (for example, "Google doesn't clearly understand what this page is about, and it's less likely to appear when someone searches for 'contact My Company'")
  - **Proposed fix** with the **why**

3. **Automatic fixes**: Hypervibe fixes what it can safely (adding metadata, optimizing images, fixing the heading hierarchy, etc.). For changes that touch content (rewriting a text, choosing a main keyword), it proposes and you decide.

## What it creates for you

- A **complete SEO report** with verdicts per area + plain-language explanations
- **Fixes applied** automatically on technical elements
- **Content suggestions** that you approve before they are applied
- No changes on Google's side directly (that's what `/gsc` handles)

## Prerequisites

- No particular prerequisite, `/seo` can run on any project in the plugin
- It's better to already be deployed on Vercel so that the Lighthouse / Core Web Vitals audits are relevant

## Tips

{{callout:tip|Run it right after a big redesign}}
Every time you change a lot of pages at once (redesigning the home page, adding a blog, multilingual translation), run `/seo` afterward to check that the fundamentals are still in place. It's easy to break a meta tag while refactoring.
{{/callout}}

{{callout:info|/seo + /geo + /gsc = the complete combo}}
- **`/seo`** = internal audit (what Google **could** see on your site)
- **`/geo`** = optimize to be cited by AI engines (ChatGPT, Claude, Perplexity)
- **`/gsc`** = read the real Google data (what it **actually sees**: impressions, clicks, queries)

Run all three in this order for full coverage.
{{/callout}}

{{callout:warning|SEO takes time}}
An SEO optimization doesn't turn into clicks overnight. Google recrawls your site (revisits and reevaluates it) over a few weeks after your changes. Be patient and measure progress in Google Search Console (`/gsc`) several months later, not the next day.
{{/callout}}
