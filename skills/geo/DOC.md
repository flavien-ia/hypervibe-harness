# /geo

Optimizes your site to be **cited by AI** (ChatGPT, Claude, Perplexity, Google AI Overviews, Bing Chat). Complementary to `/seo`: a site that ranks well on Google is not necessarily well cited by AI, and vice versa.

## When to use it

- Your site has **informational content** (articles, FAQ, tutorials, documentation, blog) that AI could cite when answering its users' questions
- You want to **become a reference source** for AI queries in your field
- You have already run `/seo` and you want to round it out for the "AI" channel

## How it works

1. **SEO preflight**: Hypervibe first checks that the classic SEO foundations are in place (metadata, sitemap, robots.txt, JSON-LD WebSite, semantic HTML structure). A page that Google cannot index properly will not be viewed favorably by AI either. If something is missing, Hypervibe suggests running `/seo` first.

2. **Full GEO audit**:
  - **`llms.txt`**: a file at the root of your site (like robots.txt, but specific to AI) that tells AI engines what they can use and how
  - **AI crawler policy**: checks `robots.txt` for AI User-Agents (GPTBot, ClaudeBot, Perplexity, etc.). You can allow, restrict, or block them depending on your strategy.
  - **FAQPage schema**: for your question/answer pages, adds the `FAQPage` structured data that AI spots easily
  - **Q&A format and chunking**: Hypervibe checks that your content is broken into self-contained blocks (clear questions, short paragraphs, explicit subheadings)
  - **Citability signals**: precise dates (publication, update), figures/stats with a source, named authors, links to external sources
  - **E-E-A-T signals**: Experience, Expertise, Authoritativeness, Trustworthiness, the 4 criteria AI evaluates to decide whether your content is reliable

3. **IndexNow submission (optional)**: Hypervibe offers to set up IndexNow, a protocol that notifies Bing and Yandex (and indirectly ChatGPT, which relies on Bing) on every new publication.

4. **Plain-language report**: each finding is explained in simple language, with the **concrete consequence** (for example, "your FAQ page does not have the FAQPage markup. Consequence: when someone asks ChatGPT 'how do I do X', your content is less likely to be cited as a source").

5. **Proposed and applied fixes**: Hypervibe adds the `llms.txt`, configures the FAQPage schemas, updates robots.txt for AI crawlers, and proposes content improvements (which you approve).

## What it creates for you

- An **`llms.txt`** file at the root of your site
- Entries in **robots.txt** for AI crawlers according to your strategy
- **FAQPage schemas** on your Q&A pages
- If you want it: **IndexNow** configuration (Bing/Yandex)
- Rewrite suggestions to improve citability (figures, dates, sources)
- A full report with verdicts per area

## Prerequisites

- Basic SEO must be in place (run `/seo` beforehand if needed)
- Your site must have **informational content**: a plain showcase site with no content has little to be cited by AI

## Tips

{{callout:tip|GEO = a new visibility channel}}
Classic SEO gets you to appear in Google results (the blue list). GEO aims to **get you cited by AI in their answers**. The two are not the same: a site that lands on Google's first page may still not be cited by ChatGPT (and vice versa). The more searches go through AI, the more GEO matters.
{{/callout}}

{{callout:info|llms.txt = an emerging standard}}
The `llms.txt` file is not (yet) an official standard, but it is **adopted by Anthropic, OpenAI, and several other players**. It lets you tell AI "here is my content in plain text, here is how to use it". For you, it is zero cost (Hypervibe generates it), and it is aligned with the direction the standards are heading.
{{/callout}}

{{callout:warning|Citability = figures + dates + sources}}
For an AI to cite you, it must **trust** your content. The key signals: precise figures (not "lots of users" but "12% of users"), explicit dates (not "recently" but "in March 2026"), and links to the external sources you cite. Hypervibe can suggest these enrichments page by page.
{{/callout}}
