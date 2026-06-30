---
name: geo
description: Audit and optimize a Next.js project for Generative Engine Optimization (GEO) - being cited and referenced by AI answer engines like ChatGPT, Claude, Perplexity, Google AI Overviews, and Bing Chat. Checks llms.txt, AI crawler policies, FAQPage schema, content structure (Q&A format, chunking), citability signals (dates, sources, stats), and E-E-A-T signals. Complementary to /seo - run after /seo for the full optimization stack.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# GEO - Optimization for AI engines

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You audit the project to optimize it for **AI answer engines** (ChatGPT, Claude, Perplexity, Google AI Overviews, Bing Chat, etc.) and propose concrete improvements. You explain why each optimization matters.

**How is this different from classic SEO?** SEO aims to appear in Google's search results (the blue list). GEO (Generative Engine Optimization) aims to be **cited by the AIs** when they generate answers for their users. The signals partly overlap (good titles, clear structure, rich JSON-LD), but GEO has its own specifics: Q&A format, content citability (numbers, dates, sources), AI crawler control, the new `llms.txt` standard.

---

## Teaching rule (important)

The report must be **readable by someone who is neither a developer nor a marketing expert**. The user is often someone who has finished their site and wants to be visible everywhere people search today - not an AI strategy consultant.

**Concrete rules:**

- When you use a technical term, explain it immediately the first time. Examples:
  - *"GEO (Generative Engine Optimization) = how your site is taken into account by AIs when they answer people (ChatGPT, Claude, Perplexity...)"*
  - *"llms.txt (a file at the root of your site, like robots.txt, but specific to AIs - it tells AI engines what they can use and how)"*
  - *"FAQPage schema (a way to mark up your questions/answers in the code so AIs spot them easily and use them in their answers)"*
  - *"E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness - 4 criteria AIs evaluate to decide whether your content is trustworthy)"*
  - *"Citability (how easily your content can be cited by an AI - clear numbers, dates, and sources strengthen it)"*
  - *"Chunking (splitting content into self-sufficient blocks so AIs can extract pieces without losing the meaning)"*
- Explain the **concrete impact** of each problem. Examples:
  - Bad: *"Missing FAQPage schema"*
  - Good: *"Your page has clear questions/answers but without a 'label' that AIs recognize. Consequence: when someone asks ChatGPT 'how do I do X', your content is less likely to be cited as a source, even if it answers the question perfectly."*
- Use everyday analogies: `llms.txt` = "the instructions for AI robots at the entrance to your site", FAQPage schema = "clearly labeling your questions/answers so AIs find them", citability = "giving the AIs what they need to cite you without hesitation (numbers, dates, sources)".
- For fixes, explain **why** you do it, not just the diff.
- Never be condescending. The user is smart, they are just discovering this topic.

---

## Progress communication

At startup, display a natural-language checklist. During execution, announce with `↳ …` then mark `✅`. **Never** use internal "Step N" labels in your user-facing messages. **Never** mention internal skill names prefixed with `_` - describe them in plain language.

---

## Step 0 - Preflight: is the basic SEO in place?

GEO does not replace SEO. The SEO foundations (metadata, sitemap, robots.txt, JSON-LD WebSite, semantic HTML structure) are **prerequisites** to benefit from GEO - a page that Google cannot index properly will not be viewed favorably by the AIs either.

Quickly detect:

- Does `public/robots.txt` exist?
- Does `src/app/sitemap.ts` (or `apps/web/src/app/sitemap.ts`) exist?
- Does `src/app/layout.tsx` export a complete `metadata` (at least `title`, `description`, `metadataBase`, `openGraph`)?
- Is a JSON-LD WebSite schema present in the layout?

**If at least 2 of the 4 points are missing** → propose to the user:

> ## 🔧 Before diving into GEO: shall we do the classic SEO first?
>
> GEO and SEO rely on the same foundations (sitemap, robots.txt, basic metadata, site-level JSON-LD markup). Before going further into AI optimization, I strongly recommend doing `/seo` first - it installs these foundations and audits your content. It takes 5-10 minutes.
>
> Tell me *"run /seo first"* to do that, or *"continue with GEO anyway"* if you prefer.

If the user chooses `/seo` → invoke the `seo` skill and stop here. Otherwise continue.

**If the foundations are there** (all 4 points OK) → continue to Step 1. Note in the context that the SEO is already clean (this avoids re-auditing the same things).

---

## Step 1 - Audit

Analyze the project and check each point below. For each point, indicate ✅ (OK), ⚠️ (to improve), or ❌ (missing).

### 1a - `llms.txt` at the root

The `llms.txt` file (an emerging 2025 standard, initiated by Anthropic and supported by OpenAI / Perplexity) sits at the root of the site, like `robots.txt` but dedicated to AI engines. It tells them:
- What they can use (public pages, key summaries)
- What they should not use (private areas, dynamic content)
- Links to the site's main resources (canonical structure)
- A concise overview of the site (which AIs read first)

Check for its presence: `ls public/llms.txt 2>/dev/null` → present or absent.

If present, verify:
- Compliant start: `# <Site name>` then a description line
- Structured sections (`## Main pages`, `## Docs`, etc.) with canonical links
- Blank line between sections
- No more than ~500 lines (AIs favor concise files)

If absent → ❌ (will be created in Step 3).

### 1b - robots.txt policy for AI crawlers

Grep `public/robots.txt` for the user-agents of known AI crawlers:

- `GPTBot` (OpenAI - ChatGPT crawl)
- `ChatGPT-User` (OpenAI - real-time requests)
- `ClaudeBot` / `anthropic-ai` (Anthropic)
- `PerplexityBot` (Perplexity)
- `Google-Extended` (Google - separate from `Googlebot`, specific to AI training and AI Overviews)
- `CCBot` (Common Crawl - a training source for many models)
- `Bytespider` (ByteDance / Doubao)
- `Applebot-Extended` (Apple AI)

Does the current robots.txt cover these crawlers (via explicit `User-agent:` sections)? Or does it only have `User-agent: *` applying default rules?

**Important**: **do not judge** the allow vs block decision - that is a strategic decision for the user. Just report the current state and propose, in Step 3, the options (allow all, block all, allow some and block others) with the explicit consequences:
- **Allow all** = maximum AI visibility, but your content may be used to train models
- **Block all** = maximum protection of your content, but you disappear from AI answers
- **Mixed strategy** = allow the "answer bots" (ChatGPT-User, PerplexityBot, Google-Extended) to be cited, block the "training crawlers" (CCBot, Bytespider) to limit usage without citation

### 1c - FAQPage / QAPage schema

AIs favor extracting content marked up as `FAQPage` or `QAPage` in the JSON-LD (schema.org). These schemas literally tell the AIs: "here are clear question/answer pairs, use them."

Detect in the layout and the pages:

- Are there sections that look like FAQs (an h2 phrased as a question + an answer paragraph)?
- Are these sections marked up as `FAQPage` JSON-LD? (grep `"@type":\s*"FAQPage"` in the code)
- Are there pages with a generic Q&A structure (documentation, support, tutorials) that would benefit from `QAPage` schema?

For each page detected as a candidate, mark it ⚠️ (to be marked up).

### 1d - Content citability

AIs prefer to cite **factual and attributable** content. Scan each page and check for citability signals:

- **Numbers/stats**: grep for significant numeric patterns (`\d+[,.]\d+%`, `\d+ (ans|milliards|millions|users|clients|%)`, etc.). Ratio of "pages with at least one number" / "total pages"
- **Explicit dates**: grep for dates in the content (recent `\d{4}` format, "in 2024", "since 2023", etc.)
- **Referenced external sources**: `<a href="https://...">` links outside your own domain, ideally toward authoritative sources (studies, press articles, official documentation)
- **Quotes / citations**: grep `<blockquote>`, `<cite>`, or visual citation patterns

A page with none of these signals = ⚠️ (AIs unlikely to cite it for lack of attributable factual elements).

### 1e - E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)

Google made E-E-A-T official as a central quality-evaluation framework (especially for YMYL topics: Your Money Your Life). AIs have adopted it as a proxy for deciding which sources to cite.

Check:

- **Experience**: does the author have direct experience of the topic they cover? Signals: a mention of "I worked with X", "in my experience", personal case studies, screenshots of real projects
- **Expertise**: an "About" page presenting the author and their skills? Certifications, training, years of experience mentioned? A `Person` JSON-LD schema with `jobTitle`, `alumniOf`, `knowsAbout`?
- **Authoritativeness**: is the site cited / recognized? Links to interviews, conferences, press mentions? JSON-LD `sameAs` pointing to authoritative profiles (LinkedIn, Google Scholar, etc.)?
- **Trustworthiness**: clear contact, legal notice, privacy policy, HTTPS, visible dates, transparent corrections

Mark each signal ✅ / ⚠️ / ❌ per main page (home, about, services/products).

### 1f - Content chunking (splitting for extraction)

AIs extract **chunks** of content (paragraphs, lists, FAQ answers) to build their answers. These chunks must be **self-sufficient** - readable and understandable out of context.

Detect the problematic patterns:

- **Relative references**: grep the content for expressions like "as seen above", "in the previous section", "as mentioned", "see above", "we saw that" - if extracted in isolation, these paragraphs become incomprehensible to the AI
- **Pronouns without a clear antecedent**: paragraphs starting with "it", "she", "this", "this approach" without restating the subject
- **Overly long paragraphs**: > 150 words without sub-headings or lists - hard to extract as coherent chunks
- **Truncated lists**: empty `<ul>` or containing only `<li>` without context

These points are NOT bugs - it is normal writing for a human reading linearly. But to be cited by an AI that extracts a fragment, each block must be able to stand on its own.

### 1g - Conversational Q&A format

AIs are trained on Q&A formats (a user asks a question, an answer is given). Content structured as **question → direct answer** is therefore over-represented in AI answers.

Detect:

- **Question-shaped headings**: grep for `h2`, `h3` that end with `?`. E.g.: *"How do I configure X?"*, *"What is Y?"*, *"Why Z?"*
- **Direct answers**: does the first paragraph following a question-heading answer the question directly? Or does it launch into a long lead-in?
- **Inverted pyramid structure**: do the important pages start with a 1-2 sentence summary (TL;DR) before the detail?

Coverage score: X% of the h2/h3 are phrased as a direct question. Recommended target for key pages: ≥ 30%.

### 1h - Freshness signal for the AI

Identical to Step 1b.8 of `/seo` but with a specific AI emphasis:
- AIs favor **recent** sources for technical / news topics
- For timeless topics, no notable difference
- Check `dateModified` in the Article schemas

(If `/seo` has already been run and validated this point, do not re-audit - just note "verified by /seo" in the report.)

### 1i - IndexNow (proactive notification to Bing → AI engines)

IndexNow is a protocol created by Microsoft (Bing) and adopted by Yandex, Seznam, and Cloudflare. When a new page is published, the site **POSTs the URL** to `api.indexnow.org`, and the participating engines index it within minutes instead of several days.

**Why this is in `/geo` and not in `/seo`**: Bing feeds directly into Copilot, ChatGPT search, and several AI engines. Fast Bing indexing = faster AI citability. On the pure Google search side, the impact is small (Bing carries ~3-5%). So IndexNow is a **GEO** lever more than a pure **SEO** one.

**Note**: Google **does not support** IndexNow (official position). For Google we keep relying on the sitemap + natural crawl.

**Audit**:
- Detect the presence of a `<key>.txt` file (32-128 hex chars) at the root of `public/` or equivalent
- Detect a helper / function that pings `api.indexnow.org` (grep `indexnow`)
- Detect a wiring to a publication event (pipeline step, build hook, API route)

**Relevance**: only flag ❌ if the project **publishes content regularly** (newsletter, blog, news, content platform). For a showcase site or static portfolio, IndexNow brings nothing - just flag it as "not applicable" and move on.

---

## Step 2 - Report

Present the structured report:

> **GEO audit - Results**
>
> ### AI foundations
> - `llms.txt`: ❌ missing (will be created)
> - robots.txt rules for AI: ⚠️ no explicit policy for `GPTBot`, `PerplexityBot`, etc. (decision to make in Step 3)
>
> ### Content structure for AI extraction
> - FAQPage schema: ❌ 3 candidate pages detected, none marked up
> - Q&A format: ⚠️ 15% of h2/h3 phrased as a question (recommended ≥ 30%)
> - Content chunking: ⚠️ 8 paragraphs with relative references ("as seen above")
>
> ### Citability
> - Numbers/stats in the content: ⚠️ 2/7 pages have numeric data
> - Explicit dates: ❌ no page mentions a date/year
> - Referenced external sources: ⚠️ 3 external links across 7 pages (low)
>
> ### E-E-A-T
> - Experience signals: ⚠️ no personal case studies detected
> - Expertise: ❌ no Person schema with jobTitle / knowsAbout
> - Authoritativeness: ⚠️ sameAs present (LinkedIn, Twitter) but no press mentions
> - Trustworthiness: ✅ HTTPS, contact, legal notice, privacy policy
>
> ### Fast indexing (IndexNow)
> - Proof file at the root: ❌ absent
> - Ping helper: ❌ absent
> - Publication wiring: ❌ none (relevant only if the site publishes regularly)
>
> **Overall GEO score: X/Y**

---

## Step 3 - Fixes

Ask the user:

> Do you want me to fix all this now? I can handle the automatable points (files to create, schemas to add). For the content (rewrites, E-E-A-T signals), I will propose patches for you to validate.

If the user accepts, fix in this order:

### 3a - Create `public/llms.txt`

Generate an `llms.txt` file at the public root. Recommended structure:

```
# <Site name>

> <Concise description of the site in 1-2 lines - what it offers, to whom>

## Main pages

- [Home](https://<domain>/): short description
- [About](https://<domain>/about): short description
- [Services](https://<domain>/services): short description
- [Blog](https://<domain>/blog): short description

## Value proposition

- <Site strong point 1, 1 line>
- <Strong point 2>
- <Strong point 3>

## Resources

- [XML Sitemap](https://<domain>/sitemap.xml)
- [Contact](https://<domain>/contact)
- [Legal notice](https://<domain>/mentions-legales)
```

Derive the content by reading the project's CLAUDE.md, the sitemap, and the main pages. Keep it concise (< 50 lines typically).

### 3b - robots.txt policy for AI crawlers

Ask the user (plain language):

> ## 🤖 How do you want to handle the AI robots?
>
> Three options, each with its consequences:
>
> 1. **Allow all (maximum visibility)**: ChatGPT, Claude, Perplexity, and the others can cite you, BUT also use your content to train their models. Recommended if your site is public and visibility matters more than content ownership.
>
> 2. **Block all (maximum protection)**: no AI can read your site. You protect your content BUT you disappear from AI answers. Recommended if you monetize exclusive content (paid courses, ebooks, proprietary studies).
>
> 3. **Mixed strategy (recommended for most cases)**: allow the "answer bots" that cite you in real time (ChatGPT-User, PerplexityBot, Google-Extended for AI Overviews), block the "training crawlers" that scrape for training (CCBot, Bytespider). You are cited by the AIs without your content feeding their training.
>
> Which one do you choose?

Depending on the answer, generate the appropriate section in `public/robots.txt` (append, not overwrite):

**Option 1 (allow all)**:
```
# AI crawlers - all allowed
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: Bytespider
Allow: /

User-agent: Applebot-Extended
Allow: /
```

**Option 2 (block all)**:
```
# AI crawlers - all blocked
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: Applebot-Extended
Disallow: /
```

**Option 3 (mixed)**:
```
# Answer bots - allowed (they cite the source in real time)
User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

# Training crawlers - blocked (prevent bulk scraping for model training)
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: Applebot-Extended
Disallow: /
```

### 3c - Add FAQPage schema to eligible pages

For each page with a Q&A structure detected in Step 1c:

1. Extract the question/answer pairs (h2/h3 question + the following answer paragraph)
2. Generate the `FAQPage` JSON-LD:

```tsx
const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Question 1?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Answer to question 1."
      }
    },
    // ...
  ]
};

// Then in the JSX:
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
/>
```

3. Inject it into the page's `<head>` (or into the JSX if it is a Client Component).

Make one patch per page, and ask for validation before committing.

### 3d - Add a `Person` schema with E-E-A-T signals (if portfolio/personal)

If the project is a personal site / portfolio (detected via CLAUDE.md or content), enrich the JSON-LD already present (or create it) with:

```tsx
const personSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "<Name>",
  "url": "https://<domain>",
  "jobTitle": "<Job title>",
  "description": "<Short bio>",
  "knowsAbout": ["Topic 1", "Topic 2", "Topic 3"],  // areas of expertise
  "alumniOf": [  // education
    { "@type": "EducationalOrganization", "name": "School ..." }
  ],
  "sameAs": [  // external authority profiles
    "https://linkedin.com/in/...",
    "https://twitter.com/...",
    "https://github.com/..."
  ]
};
```

Extract the info from the "About" page, the footer, and the CLAUDE.md. Ask the user to fill in if some fields are missing.

### 3e - Content fixes (proposed, not automatic)

For the following points detected in Step 1, **propose patches** to the user rather than fixing automatically (this is editorial content):

- **Content chunking**: for each paragraph with a relative reference ("as seen above"), propose a self-sufficient rewrite
- **Q&A format**: propose rewriting some h2/h3 as direct questions
- **Citability**: suggest adding numbers/dates/sources to the pages that lack them (point out where to place them, the user decides the factual content)

Present these suggestions in a separate report, do not commit anything without validation.

### 3f - Configure IndexNow (if the site publishes content regularly)

⚠️ **Skip if not relevant**: for a showcase site, static portfolio, or SaaS without continuous publishing, IndexNow brings nothing - go straight to 3g.

Ask the user:

> ## ⚡ IndexNow - fast indexing for Bing / Copilot / ChatGPT search
>
> Do you publish content regularly (newsletter, blog, articles)? With IndexNow, as soon as a new page is published, your server **POSTs the URL** to `api.indexnow.org` which notifies Bing, Yandex, and Seznam. Indexing goes from **several days to a few minutes**. Bing relays this signal to Copilot and ChatGPT search, so you gain AI visibility.
>
> Google does not support IndexNow (official position), so on the Google side we stay with the sitemap + natural crawl.
>
> Effort: ~10 min of setup, then 100% automatic. Do you want me to configure it?

If yes, **invoke the internal skill `_setup-indexnow`** which handles the whole setup (key, proof file, helper, wiring, test). Then resume at 3g.

### 3g - Tips for future content

Add at the end of the report a section **"Tips for your future content"**:

> ## ✍️ To maximize your chances of being cited by AIs in the future
>
> When you add new content (blog articles, service pages, case studies), keep these reflexes in mind:
>
> 1. **Phrase your h2/h3 as questions**: instead of *"Main features"*, write *"What are the main features?"*. AIs love this format.
> 2. **Answer directly after the question**: no long lead-in. The answer should be readable in isolation.
> 3. **Give numbers**: dates, percentages, verifiable stats. AIs cite facts more readily than vague claims.
> 4. **Cite your sources**: links to studies, articles, documentation. It strengthens your citability.
> 5. **Self-sufficient paragraphs**: no "as seen above", "this approach" without a clear antecedent. Each paragraph must be able to stand on its own.
> 6. **Visible dates**: each article with a publication date + update date at the top.
> 7. **IndexNow triggered on each publication**: if you enabled IndexNow (step 3f), check that the ping is actually sent on your new pages - it is what ensures Bing / Copilot / ChatGPT search discover you within minutes instead of several days.

---

## Step 4 - Verification

After the fixes, re-run the audit quickly and display the new score.

> ✅ **GEO audit complete.** Score: X/Y → X/Y
>
> Points still in your hands (editorial content): X patches to validate, see the content report above.

---

## Step 5 - Going further

Add to the final summary:

### 5a - Recheck the classic SEO (if not done yet)

If `/seo` has not been run recently (no trace in CLAUDE.md nor any recent `sitemap.ts`/`robots.txt` files):

> ## 🔄 You optimized for the AIs - but have you also optimized for classic Google?
>
> GEO and SEO reinforce each other. A page well ranked by Google is also better spotted by the AIs.
>
> If you have not done a classic SEO audit yet, run `/seo` - it complements what we just did (metadata, sitemap, keyword analysis, readability, etc.).

### 5b - Tracking over time

> ## 📊 How do you know if it works?
>
> Unlike SEO where you can measure your Google ranking, **GEO is harder to measure** - there is not yet a "Search Console for AIs". A few signals to watch:
>
> - **Perplexity / ChatGPT referrers**: in your analytics, check whether traffic arrives from `perplexity.ai` or `chatgpt.com` (this has existed since mid-2024)
> - **Direct mentions**: from time to time, ask ChatGPT / Claude / Perplexity a question related to your field and see if your site is cited
> - **Evolution over 3-6 months**: GEO has medium-term effects, not immediate ones
