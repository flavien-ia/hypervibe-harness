---
name: gsc
description: Connect a Next.js project to Google Search Console and audit the real Google data - indexing coverage, search queries, clicks, positions, and sitemap status. Complements /seo (on-page audit) with what Google actually sees. Use after the site has been deployed on a custom domain and has had a few weeks of traffic.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# GSC - Google Search Console

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You connect the project to Google Search Console (GSC) and read the real Google data (impressions, clicks, queries, indexing), **via the REST API** (`webmasters/v3` + `searchconsole/v1` + `siteVerification/v1`), authenticated by a service account stored in the vault. This is the external complement to `/seo`.

## Authentication (preamble, before any call)

Forge a Google token from the vault:
```bash
GSCTOKEN="${CLAUDE_SKILL_DIR}/../../scripts/gsc/gsc-token.mjs"
TOK=$(node "$GSCTOKEN" --readonly); RC=$?     # read (audit, inspection)
# or without --readonly for read+write (add property, verify, sitemap)
```
Handling `RC`:
- **0** -> we have the token.
- **2 / 3** (vault locked / expired) -> warn the user, `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` (blocking), retry.
- **4** (GSC not configured: no `GSC_SERVICE_ACCOUNT` in the vault) -> delegate to the internal skill **`_setup-gsc`** (creates the service account + stores the key in the vault + authorizes it on GSC), then retry.

The token is valid for 1h; re-forge it if a session exceeds this duration. **Never display `$TOK`.**

Encoding the `siteUrl` in URLs: `sc-domain:example.com` -> `sc-domain%3Aexample.com`; `https://example.com/` -> `https%3A%2F%2Fexample.com%2F`. In the **bodies** (urlInspection, siteVerification) the siteUrl/identifier is **raw**.

---

## Teaching rule (important)

The user is **not necessarily an SEO pro**. It is often someone who just put their site online and wants to understand what Google does with it. The rules:

- When you use a technical term, explain it immediately in parentheses the first time. Examples:
  - *"Impressions (the number of times your site appears in Google's results, whether people click or not)"*
  - *"CTR (for Click-Through Rate: out of 100 times your site appears, how many people click on it - a good CTR is 3-5% and up)"*
  - *"Average position (what spot your site comes up in Google's results on average for a query - position 1 is the top, position 10 is the bottom of the first page)"*
  - *"Indexing coverage (how many pages of your site Google has properly recorded, vs how many it has ignored or blocked)"*
  - *"GSC property (a site you declare to Google Search Console so it shows you its data - you have to prove you really are the owner)"*
  - *"Sitemap (the list of your site's pages that you give to Google so it can find them all)"*
  - *"DNS / TXT record (a line of text you add to your domain's configuration to prove to Google that you really are the owner)"*
- Never raw jargon ("SERP", "crawl budget", "index bloat" without explanation). Either avoid it, or explain it in 1 sentence.
- Explain the **concrete impact** of each number / problem, not just its name.
- Never be condescending. The user is smart, they just don't know this field.

---

## Progress communication

At startup, display a checklist in natural language. During execution, announce with `↳ …` then mark `✅`. **Never** an internal "Step N" / "Étape N" in your user-facing messages. **Never** the internal skill names prefixed with `_` - describe in plain language.

---

## Step 0 - Preflight

### 0.1 - Verify the site is deployed on a usable domain

Read `.env`, `.env.production`, or the Vercel config to retrieve the production domain.

- **No custom domain** (just `*.vercel.app`): warn that GSC accepts `vercel.app` domains but their value is limited. Suggest `/add-domain` first.
- **Site not yet deployed**: stop and warn that GSC serves to analyze what Google sees, so you first need a site online.

### 0.2 - Verify GSC is configured (vault)

Forge a token (preamble). If `RC=4` -> GSC not yet configured on this machine -> Step 0.3. If `RC=0` -> note `GSC_OK` and continue. If `RC=2/3` -> unlock then retry.

### 0.3 - GSC setup (if absent) - delegated to `_setup-gsc`

Delegate to the internal skill **`_setup-gsc`**: it guides the creation of a Google service account (one-time), stores its key in the vault (`GSC_SERVICE_ACCOUNT`), and authorizes it as owner on the GSC property. No MCP, no Python, no restart.

When `_setup-gsc` hands back successfully, re-forge the token and continue to Step 1.

If the user declines the setup -> propose an on-page audit via `/seo` (without GSC) and stop cleanly.

---

## Step 1 - List / add the property

The service account has the full scope (read + write + verification) -> the whole add / verify / sitemap flow is autonomous.

List the visible properties:
```bash
curl -s -H "Authorization: Bearer $TOK" "https://www.googleapis.com/webmasters/v3/sites"
```
Returns `siteEntry[]` (`siteUrl` + `permissionLevel`).

### 1.1 - The site is already in GSC

If the domain (or an `sc-domain:` variant / with-without `www`) appears with an owner permission -> skip to Step 3 (sitemap) or 4 (audit).

> Good news: your site `example.fr` is already connected to Google Search Console. I'm going straight to the analysis.

### 1.2 - The site is not in GSC: add a Domain property

Briefly explain (Domain = covers the whole site, verified by DNS) then launch the **add + verify** flow (read+write token required). For `<domain>` (without `https://`, without `www`):

**(a) Get the DNS verification token**:
```bash
curl -s -X POST "https://www.googleapis.com/siteVerification/v1/token" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"site":{"type":"INET_DOMAIN","identifier":"<domain>"},"verificationMethod":"DNS_TXT"}'
```
-> returns `{"token":"google-site-verification=XXXX"}`. This is the value to place in a root TXT.

**(b) Place the TXT** -> see Step 2 (Cloudflare API).

**(c) Verify ownership** (once the TXT has propagated), while also delegating access to the human via `owners`:
```bash
curl -s -X POST "https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"site":{"type":"INET_DOMAIN","identifier":"<domain>"},"owners":["<user_google_email>"]}'
```
Ask the user for their Google address (the one for their Search Console) for the `owners` - this guarantees them access in the GSC UI in addition to the service account.

**(d) Add the property in GSC** (after successful verification):
```bash
curl -s -X PUT "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3A<domain>" -H "Authorization: Bearer $TOK"
```
Mandatory order: (a) token -> (b) TXT -> (c) verify -> (d) add (otherwise 403).

---

## Step 2 - Place the verification TXT (DNS)

The value `google-site-verification=...` (from Step 1a) goes into a **root TXT (`@`)** of the domain.

### 2.1 - DNS on Cloudflare (standard Hypervibe case)

The domain is managed by Cloudflare (after `/add-domain`). Cloudflare token from the vault:
```bash
CFTOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get CLOUDFLARE api_token); RC=$?
# RC=2/3 -> unlock ; RC=4 -> the Cloudflare key is not in the vault (suggest launch.mjs add --name CLOUDFLARE --service Cloudflare --fields "api_token:secret")
ZONE=$(curl -s -H "Authorization: Bearer $CFTOK" "https://api.cloudflare.com/client/v4/zones?name=<domain>" | python -c "import json,sys;z=json.load(sys.stdin)['result'];print(z[0]['id'] if z else '')")
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
  -H "Authorization: Bearer $CFTOK" -H "Content-Type: application/json" \
  -d '{"type":"TXT","name":"@","content":"google-site-verification=XXXX","ttl":300}'
```
Show the user what is being added (TXT type, name @, value), noting that it changes nothing about the site.

### 2.2 - DNS elsewhere (manual)

If the DNS is not on Cloudflare, display the copy-paste instructions (root TXT = the value) for the registrar's dashboard, and wait for confirmation.

### 2.3 - Wait for propagation then verify

After adding, wait a few seconds/minutes, then run Step 1c (verify). If it fails with `dns_record_not_found` / not verified:

> Google hasn't seen the DNS record yet - propagation can take from 5 minutes to 24 hours. Re-run `/gsc` later, I'll pick up where we left off.

---

## Step 3 - Submit the sitemap

### 3.1 - Verify that `sitemap.ts` exists
Look for `src/app/sitemap.ts` (or `apps/web/src/app/sitemap.ts`). Absent -> tell the user to run `/seo` first (which creates the sitemap).

### 3.2 - Submit (PUT)
```bash
SITE="sc-domain%3A<domain>"; FEED="https%3A%2F%2F<domain>%2Fsitemap.xml"
curl -s -X PUT -H "Authorization: Bearer $TOK" "https://www.googleapis.com/webmasters/v3/sites/$SITE/sitemaps/$FEED"
```

### 3.3 - Check the status
```bash
curl -s -H "Authorization: Bearer $TOK" "https://www.googleapis.com/webmasters/v3/sites/$SITE/sitemaps"
```
> ✅ Sitemap submitted. Google will gradually visit each page. Status "pending" at first, that's normal.

---

## Step 4 - Audit the GSC data

The core of the skill. A `--readonly` token is enough here.

### 4.1 - Site too recent?
If the property is new / "insufficient data": warn that it takes **2-3 days** for the first data, **2-4 weeks** for a reliable overview.

### 4.2 - Indexing coverage
Inspect the key pages (from the sitemap) via the URL Inspection API:
```bash
curl -s -X POST "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"inspectionUrl":"https://<domain>/","siteUrl":"sc-domain:<domain>"}'
```
(`siteUrl` raw in the body.) Iterate over the main URLs (quota ~2000/day, 600/min - sample if a large site, and flag it). Present:

> **Indexing coverage**
> - ✅ Pages properly indexed: X
> - ⚠️ Pages not indexed: Y (with reasons: "Discovered, not indexed" = normal for a recent site; "noindex" = check that it's intentional; "404" = add a 301 redirect)
> - ❌ Critical errors: U (with URL + explanation)

### 4.3 - Performance (last 28 days)
```bash
curl -s -X POST "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3A<domain>/searchAnalytics/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"startDate":"<D-28>","endDate":"<D>","dimensions":["query"],"rowLimit":100}'
```
(Redo with `"dimensions":["page"]` for the top pages; without `dimensions` for the aggregate.)

Present **Top 10 queries** and **Top 10 pages** as markdown tables (Query/Page | Impressions | Clicks | CTR | Average position), plus the **28-day Total**.

### 4.4 - Opportunities (the most useful)
Analyze for concrete recommendations in order of impact:
- **Queries in position 11-20** (close to the top 10 -> small effort = big gain). List with impressions/position.
- **High-volume queries but low CTR** (unengaging title/meta -> propose a rewrite).
- **Zombie pages** (0 impressions over 28 days -> thin content / cannibalization / query too competitive).

For each, explain the concrete impact and propose an action (see teaching tone).

### 4.5 - Summary
> **GSC report - last 28 days**
> - **Indexing**: X/Y pages indexed
> - **Google traffic**: Z clicks, average position P
> - **Main opportunities**: 1. [easy win] 2. [meta to rewrite] 3. [page to strengthen/remove]

---

## Step 5 - Fixes

Propose applying the fixes (titles / metas / content), same rules as `/seo`. Explicit validation before writing any code. **Never rename an existing route without a 301 redirect** (otherwise 404 on the indexed URLs -> loss of ranking; add the redirect in `next.config.js`).

---

## Step 6 - Final report

Summary: what was added (property, sitemap), fixed (titles/metas/content), and what remains (wait 2-4 weeks to review the data). Do not suggest `/seo` or `/geo` here (the bridges go the other way).

---

## Notes

- **No on-page audit** (-> `/seo`). **No GA4** (-> `/add-analytics`). **No automatic weekly report**.
- **Idempotence**: re-run on an already-connected project, jumps to the audit (Step 4). Does not re-add the property or the sitemap if they exist.
- If in doubt about a GSC endpoint, query Context7 (`/websites/developers_google_webmaster-tools_v1`) rather than inventing.
