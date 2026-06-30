---
name: seo-perf
description: "Measures the real performance of a deployed Next.js site via the PageSpeed Insights API (Google-side Lighthouse), on representative pages, then proposes fixes prioritized by measured impact. Confronts the SEO work with objective numbers (Core Web Vitals, performance/accessibility/SEO/best-practices scores). Auto-invoked at the end of /seo (flag --from-seo); also callable standalone when the user wants to re-measure their performance."
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# seo-perf: Measured performance audit (PageSpeed Insights / Lighthouse)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You measure the real performance of the **deployed** site with the PageSpeed Insights (PSI) API, which runs a real Lighthouse on Google's servers. You confront the result with the optimizations that were made, you give numbers, and you propose fixes sorted by real impact.

**What this audit brings that reading the code alone does not**: numbers measured on the deployed build (LCP, CLS, INP in milliseconds), the reality of the bundle after build, prioritization by real impact, and (when traffic exists) the Core Web Vitals experienced by real visitors. It is a layer of **measurement and ground-truth**, not a new detection engine: the purely structural checks (presence of `next/image`, `alt`, etc.) are already covered by the static audit of `/seo`.

---

## Invocation modes

- **Standalone mode (default)**: the user called `/seo-perf` directly. You run the full flow, with the educational preamble and the opt-in question.
- **`--from-seo` mode**: called at the end of `/seo`. `/seo` has **already asked** the opt-in question and the user accepted. You **skip** the preamble (Step 2) and go straight to the audit. You do not display a separate checklist: you blend into the `/seo` progression.

Detecting the mode: if `$ARGUMENTS` contains `--from-seo`, switch to integrated mode.

---

## Educational rule (important)

The user is neither a developer nor a performance expert. The report must be readable by someone who has finished their site and wants to know whether it is fast and well regarded by Google.

- Explain each term the first time:
  - *"Lighthouse / PageSpeed Insights = Google's official tool that loads your page like a visitor and gives it scores (speed, accessibility, SEO)."*
  - *"LCP (Largest Contentful Paint) = the time it takes for the largest element on the page (often the main image) to appear. Under 2.5 s is good."*
  - *"CLS (Cumulative Layout Shift) = how much the elements jump around during loading (when an image or a font arrives and pushes the rest). Under 0.1 is good."*
  - *"INP = the page's responsiveness when you click. Core Web Vitals = the 3 measurements (LCP, CLS, INP) that Google uses to rank sites."*
- Always give the **concrete impact** of a number, not just the number.
- Never be condescending.

---

## Step 0: Preflight

### 0a: Is the site deployed?

The audit is about the **live production URL**, not the local code. Get the project's prod URL (the `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_APP_URL` variable in `.env`, or the known custom domain). Verify that it responds:

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 20 "<URL_PROD>"
```

- If the URL does not exist or returns an error, explain that `seo-perf` measures a site that is **online**, so it must first be deployed (ask me to deploy). Stop cleanly.
- If the URL still points to a `.vercel.app` (no custom domain), continue anyway, but mention it (the numbers are still valid).

### 0b: Is the PageSpeed Insights key in the vault?

The PSI API **requires a key**: without a key, it systematically returns `429`s (verified in real conditions). It is a **free** Google key (25,000 requests/day, no billing), **global and reusable** across all projects: so it is created only **once**.

Try to read it (follow the `_get-secret` pattern):

```bash
KEY=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get PAGESPEED api_key 2>/dev/null); echo "exit=$?"
```

- **exit 0**: key present, continue.
- **exit 2 or 3** (vault locked / expired): warn the user ("the vault is locked, a window will open for your master password"), launch `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` (blocking), then retry the read.
- **exit 4** (key absent): this is the first use of `seo-perf` on this machine. Guide the key creation by following the **"Create the PageSpeed Insights key" appendix** below (hardcoded how-to, follow it as-is). Once the user has the key, store it via the vault's masked window:

  ```bash
  node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name PAGESPEED --service PageSpeed --fields "api_key:secret"
  ```

  (The value is entered in the window, it never passes through you.) Then re-read the key to confirm.

  **Once the key is stored and confirmed**, automatically document it in the user's global CLAUDE.md (idempotent: does nothing if it is already there), so they find it in their Claude Code memory:

  ```bash
  node "${CLAUDE_SKILL_DIR}/../../scripts/remember-global-key.mjs" \
    --name PAGESPEED \
    --line "PAGESPEED (champ api_key) : clé Google PageSpeed Insights, gratuite et globale (réutilisable sur tous les projets). Lue par la skill seo-perf via scripts/psi-audit.mjs. Récupération : KEY=\$(bw-get PAGESPEED api_key)."
  ```

**Never display the value of the key.** It is read into a shell variable and passed to the script via the `PSI_KEY` env variable.

---

## Step 1: Choose the representative pages

**Golden rule: do NOT audit every page.** On a Next.js site, the pages of the same "type" (template) share the same shell and the same bundle, so their performance is nearly identical. Auditing 30 pages means getting the same result 30 times, and 10 minutes of tunnel for nothing. Moreover, the quota and patience have limits (each page takes 15 to 30 s).

**Choose 3 to 5 URLs, one per distinct template.** Identify the page types by inspecting `src/app` (or `apps/web/src/app`):

| Page type | How to spot it | Why audit it |
|---|---|---|
| **Home** | `page.tsx` at the root of the segment (or `[locale]/page.tsx`) | The most important, often the heaviest (hero, animations) |
| **Listing / gallery** | a page that maps a list (often rich in images): `projets`, `livres`, `podcasts`, `blog`... | Typical case of image / LCP problems |
| **Detail** | dynamic route `[slug]`, `[id]` | Template distinct from the listing |
| **Form** | a page with a `<form>` / a form component: `contact`, `newsletter`... | Lightweight template, interactivity |
| **Long content** | `faq`, text page, legal notices | Mostly for accessibility and structure |

Take **the home + 2 to 4 others** covering the types present. If the site is small (3-4 pages), audit them all.

**i18n**: audit only the URLs of the **default locale** (e.g. `/projets`, not `/en/projets`). The other locales share the same rendering; no need to triple the calls.

**Strategy**: **mobile by default** (Google indexes mobile-first, and it is the most demanding score so the most telling). Propose desktop only if the user asks for it (it doubles the number of calls).

Announce the selected URLs to the user and why, in one sentence.

---

## Step 2: Opt-in (standalone mode only)

**Skip this step entirely in `--from-seo` mode** (`/seo` has already asked).

Explain simply what is going to happen, then ask for confirmation via `AskUserQuestion`:

> I can confront your site with **PageSpeed Insights**, Google's official tool that loads your pages like a real visitor and gives them scores (speed, accessibility, SEO), along with the famous **Core Web Vitals** that Google uses for ranking.
>
> It takes **a few minutes** (I audit {N} representative pages), then I give you the numbers and propose concrete fixes, sorted by real impact. You validate each fix before I apply it.

Options:
- **Yes, run the audit** -> continue to Step 3.
- **Not now** -> stop cleanly, saying it can be relaunched at any time with `/seo-perf`.

---

## Step 3: Run the audit

Run the bundled engine on the selected URLs. Pass it the key via the `PSI_KEY` env (never in plain text on the command line), and `--warmup` (a preliminary hit on each page to wake up the Vercel serverless function and **avoid measuring a cold start**, which would artificially inflate the LCP / TTFB).

```bash
PSI_KEY=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get PAGESPEED api_key 2>/dev/null) \
  node "${CLAUDE_SKILL_DIR}/../../scripts/psi-audit.mjs" \
  --urls "<URL1>,<URL2>,<URL3>" --strategy mobile --warmup
```

The script returns a JSON `{ strategy, results: [...] }`. Each `result` contains: `scores` (perf, accessibility, best-practices, seo out of 100), `lab` (readable FCP, LCP, TBT, CLS, SI), `field` (CrUX field Core Web Vitals if there is enough traffic), `opportunities` (gains quantified in ms), `diagnostics` (failed audits with their `id` and their score).

**Handle measurement noise (important).** Some pages are never "at rest": infinite animations, carousels, titles that rotate via `setInterval`, autoplay videos. This destabilizes Lighthouse's LCP and CLS measurement (the measurement can vary fivefold between two runs). Rule:

- If a page shows an **aberrant LCP** (e.g. > 10 s) while the **Speed Index is normal** (e.g. < 4 s), it is almost surely **noise**, not a real experienced problem. Confirm it by relaunching the audit of that single page **once**. If the number jumps (e.g. 3.5 s then 17 s), conclude it is noise: report it honestly to the user, **do not try to "fix" an unstable number**, and rely on the Speed Index + code inspection to judge.
- Never alarm the user with a number you are not sure is real and reproducible.

---

## Step 4: Report

Present the results as a **clear table** (one row per page), with a simple color code:

- 🟢 good (perf >= 90, LCP < 2.5 s, CLS < 0.1)
- 🟠 to improve (perf 50-89, LCP 2.5-4 s, CLS 0.1-0.25)
- 🔴 problem (perf < 50, LCP > 4 s, CLS > 0.25)

Example format:

> | Page | Perf | Access. | SEO | LCP | CLS |
> |---|---|---|---|---|---|
> | Home | 🟠 73 | 96 | 100 | 🟠 3.2 s | 🟢 0 |
> | Contact | 🟠 77 | 98 | 92 | 🟠 3.2 s | 🟠 0.34 |

Then, for each significant problem:
- the **measured number**,
- what it means **concretely** for a visitor,
- whether it is **real** or **measurement noise** (cf. Step 3).

If **field data (CrUX)** exists (`field.hasData = true`), highlight it: these are the performances experienced by the real visitors, more reliable than the lab. If it is missing (new site, little traffic), explain it: *"not enough traffic yet for field data; we rely on the lab measurement. By relaunching in a few weeks, we will have the numbers from your real visitors."* (That is the value of relaunching `seo-perf` later.)

---

## Step 5: Improvement pass (proposed, bounded)

From the `diagnostics` and `opportunities`, propose fixes. **Strictly distinguish** what is auto-fixable without risk from what is not.

### Whitelist: auto-fixable (propose then apply after validation)

| PSI audit (`id`) | Next.js fix |
|---|---|
| `uses-responsive-images`, `unsized-images`, `modern-image-formats`, `uses-optimized-images`, `efficient-animated-content` | Switch to `<Image>` (next/image), add `width`/`height` + `sizes`, serve in WebP/AVIF. Fixes LCP and CLS. |
| `offscreen-images`, `lcp-lazy-loaded` | `priority` on the LCP image, `loading="lazy"` on off-screen images. |
| `render-blocking-resources`, `font-display`, `unminified-css`, `unminified-javascript` | Fonts via `next/font` (`display: "swap"` + adjusted fallback), preconnect, verify that the build minifies. |
| `canonical`, `hreflang`, `document-title`, `meta-description`, `http-status-code`, `is-crawlable`, `robots-txt`, `structured-data` | Fix the `metadata` / `generateMetadata` (per-page canonical, hreflang tags, titles/descriptions), `robots.txt`, JSON-LD. |
| `image-alt`, `link-name`, `button-name`, `label`, `heading-order`, `list`, `html-has-lang`, `meta-viewport`, `aria-prohibited-attr` | Semantic / accessibility fixes in the JSX (alt, labels, heading hierarchy, ARIA attributes). |
| `tap-targets` | Increase the spacing / size of clickable areas on mobile. |
| `unused-javascript`, `unused-css-rules` | **With caution**: dynamic import (`next/dynamic`) for heavy non-critical JS, removal of dead CSS **only if you are sure** it is used nowhere. Never delete blindly. |

### Redlist: do NOT auto-fix (flag + explain, let the user decide)

| Case | Why |
|---|---|
| `color-contrast` | Touches the **brand colors** (e.g. a signature yellow on a light background). It is a design decision, not a patch. Propose a lead, let them decide. |
| High LCP/INP/TBT due to heavy client JS (`bootup-time`, `mainthread-work-breakdown`, `max-potential-fid`) | Requires **architecture** choices (reduce JS, server components), not a mechanical tweak. |
| Server response time / TTFB (`server-response-time`) | Depends on the hosting (Vercel cold starts), not on the page code. |
| Number identified as **measurement noise** in Step 3 | You do not fix an unstable number. |

### Rules of the improvement pass

1. **First present** the list of proposed fixes, sorted by impact (the quantified `opportunities` first), in clear language. The user validates what they want.
2. Apply the validated fixes (always respect the project's conventions: read `globals.css`, `next/image`, real UTF-8, etc.).
3. **Verify** that the code compiles: `pnpm tsc --noEmit && pnpm lint` (never `pnpm build`).
4. **Strict bound**: **a single improvement pass**, then **a single** re-verification (Step 6). Do not get into a loop chasing the score of 100: diminishing returns, and some of the items are outside the code's control.

---

## Step 6: Re-verification (critical sequencing)

⚠️ **PSI measures the site ONLINE.** The fixes from Step 5 are on the local disk as long as they are not **deployed**. Auditing before deployment would measure the **old** version and give false conclusions.

So the order is imperative:

1. Fixes applied and validated (Step 5).
2. **Deployment**: propose to deploy (commit + push). **Never deploy without the user's explicit agreement in the chat.**
3. Wait for the deployment to be live.
4. **Warm-up** then re-audit the same URLs (relaunch Step 3 on the fixed subset).
5. Show the **before / after** quantified: *"Contact: LCP 3.2 s -> 1.9 s, SEO 92 -> 100."*

If the user does not want to deploy now: that is OK. Tell them the fixes are ready on the branch, and that the re-verification will happen at the next deployment (relaunchable with `/seo-perf`).

---

## Step 7: Summary

Recap:
- The measured scores (before / after if a pass took place).
- What was fixed.
- What remains **manual / architectural** (redlist), with the explanation.
- Remind them of the value of **relaunching `seo-perf` in a few weeks**: once the traffic is established, PSI will provide the **field** Core Web Vitals (real visitors), info impossible to get on a new site.
- **Propose `/eco-audit`** (one sentence, without insisting): same key, same engine, but the ecology angle: EcoIndex A-G score, CO2e per visit, byte waste that a fast site can hide.

---

## Appendix: Create the PageSpeed Insights key (hardcoded how-to)

Follow **as-is** when the key is absent from the vault (exit 4 in Step 0b). The key is free (no billing) and reusable across all projects: created once.

Guide the user, step by step:

> **1. Enable the API.** Open [https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com). At the top, select a Google Cloud project (any one; if you don't have one, create one). Click **"Enable"**. If it is already enabled, skip.
>
> **2. Create the key.** Go to [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials). Click **"+ Create credentials"** at the top, then **"API key"**.
>
> **3. Fill in the "Create an API key" window that opens:**
>    - **Name**: give it a meaningful name, e.g. `seo-perf-psi` (purely cosmetic).
>    - **Do NOT check** "Authenticate API calls via a service account": that is reserved for Vertex/Gemini, not for PageSpeed. Also ignore the box about the "administration policy" just above, it only concerns that case.
>    - **Select API restrictions** (the "No API selected" menu): expand it and check **PageSpeed Insights API**. If it does not appear, it means the activation from step 1 has not propagated yet: click the window's "API library" link, enable **PageSpeed Insights API**, come back, it will appear. Restricting to this single API = good hygiene (even if the key leaks, it only serves to measure the performance of public pages).
>    - **Application restrictions** (bottom section): leave it on **"None"**. The key will be called from scripts with a changing IP, so a per-IP or per-site restriction would break it. The risk is low (the key only reads public performance).
>    - Click **"Create"**. A key `AIza…` is displayed: **copy it**.

Then store the key in the vault (masked window):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name PAGESPEED --service PageSpeed --fields "api_key:secret"
```

---

## Technical notes

- **Engine**: `scripts/psi-audit.mjs` (bundled in the plugin). No dependency (native fetch). Handles the retry (429 / 5xx), the timeout (120 s/page), the warm-up, and caps at 8 URLs as a safeguard.
- **PSI endpoint**: `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`. One call = **one URL + one strategy** (mobile OR desktop). The full matrix = pages × strategies; hence the "representative pages + mobile by default" rule.
- **Quota**: 25,000 requests/day, 400 per 100 s with the key. Largely sufficient.
- **Lighthouse v13.3+** exposes an "Agentic Browsing" category (audit of `llms.txt`, etc.): deliberately **not used here** (no stable score, and not yet exposed by the PSI API). GEO remains the domain of `/geo`.
