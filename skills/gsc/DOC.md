# /gsc

Connects your site to **Google Search Console** and reads the real Google data: impressions, clicks, queries, indexing. This is what `/seo` cannot see, what Google **actually sees** on your site.

## When to use it

- Your site has been online for a few weeks and you want to **know how Google sees it**
- You want to see **which searches** bring traffic to your site
- You want to identify the **easy opportunities** (queries where you are on page 2 and where a small nudge would be enough)
- You want to verify that all your **pages are indexed** (or understand why some are not)

## How it works

1. **Domain check**: Hypervibe looks at your site's production domain. If it's still on `*.vercel.app`, it recommends `/add-domain` first (GSC accepts Vercel URLs but their value is limited, no DNS control, no real brand).

2. **Checking (or installing) the GSC connector**: the first time, Hypervibe walks you through connecting Google Search Console to Claude Code. It's a one-time setup per machine (about 10 min), fully guided click by click: you create a "service account" in Google Cloud (a type of technical account designed for this), you add it as an owner of your Search Console, and that's it. Once this setup is in place, Hypervibe can add properties, verify DNS, submit sitemaps, and more, without you having to go back into Search Console yourself.

3. **Declaring the GSC property**: if your site is not yet declared in GSC, Hypervibe guides you to add a **domain property** (the most complete version, which covers all sub-URLs):
  - You retrieve a TXT record to add to your Cloudflare DNS
  - Hypervibe can do it for you via the Cloudflare token (`/start`)
  - Google verifies the property within a few minutes

4. **Sitemap submission**: Hypervibe automatically submits your site's sitemap to GSC.

5. **Reading the GSC data**: Hypervibe displays a recap in plain language:
  - **Impressions**: how many times your site appears in Google's results
  - **Clicks**: how many people actually click
  - **CTR**: click rate (impressions -> clicks). A good CTR = 3-5% and up.
  - **Average position**: what spot your site comes up in on average. Position 1 = top, position 10 = bottom of the first page.
  - **Indexing coverage**: how many pages Google has properly recorded
  - **Top queries**: the searches that bring you the most traffic
  - **Opportunities**: the queries where you are in position 11-20 (close to the top 10, a small effort can be enough)

6. **Action recommendations**: depending on what the data shows, Hypervibe proposes **concrete actions** to improve your search ranking.

## What it creates for you

- Your site **declared in Google Search Console** (domain property, the most complete)
- Your **sitemap submitted** to Google (Google re-crawls it faster)
- A **regular report** of the GSC data in plain language
- **Action recommendations** based on what Google actually sees

## Prerequisites

- The site must be **deployed on a custom domain** (ideally), otherwise Hypervibe suggests `/add-domain` first
- The site must have been **online for a few weeks** for the GSC data to be relevant (Google takes time to crawl and accumulate stats)
- A Google account (the same one as for Analytics if you have one)
- Search Console access for the site (Hypervibe sets up the connection for you via a Google service account, no MCP needed)

## Tips

{{callout:tip|/seo tells what could be, /gsc tells what is}}
Think of the two skills as complementary mirrors: `/seo` audits your site and tells you *"here is what Google **could** see if everything is done right"*. `/gsc` tells you *"here is what Google **actually sees** and what it does with it"*. If `/seo` is ✅ everywhere but `/gsc` shows 0 indexing, that's odd, there is a blockage to dig into (robots.txt, hidden noindex, DNS problem).
{{/callout}}

{{callout:info|Patience required}}
GSC needs **time** to accumulate data. A new property shows 0 results the first week, sometimes for 2-3 weeks. If you run `/gsc` right after declaring it, you'll mostly see *"no data yet"*, which is normal. Re-run a few weeks later.
{{/callout}}

{{callout:warning|The "easy opportunities" are worth their weight in gold}}
The most actionable metric: the queries where you are in **position 11 to 20**. You are close to the top 10 (the first page), a small content / meta effort can push you there, and traffic jumps a lot once you break into the top 10. Hypervibe highlights them in its report.
{{/callout}}
