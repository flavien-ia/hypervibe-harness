# /eco-audit

Measures your site's ecological footprint and proposes concrete fixes to lighten it. You get an EcoIndex grade (A to G), an estimate of the CO2 emitted per visit, and the breakdown of what weighs needlessly.

## When to use it

- You want to know **what your site truly weighs** for the planet (and for your visitors' data plan)
- You want a **citable score**: the EcoIndex is the reference French methodology, cited by the RGESN (the official eco-design framework)
- After `/seo-perf`: a fast site is not necessarily light, this audit sees what speed hides

## How it goes

1. **Checks**: the site must be online (we measure the deployed site). The Google key needed is the same as for `/seo-perf`: if it is already in your vault, zero configuration.

2. **Measurement**: 3 to 5 representative pages are loaded by Google's servers. For each page: complexity (DOM size), number of requests, transferred KB. These three measurements give the **EcoIndex grade (A to G)** and the impact estimate (grams of CO2e and water per visit).

3. **Meaningful report**: a table per page, the breakdown of the quantified waste (overly heavy images, unused code, missing cache, third-party scripts), the precise files that weigh the most, and the scaling ("at 1,000 visits/month, this page emits the equivalent of X km by car").

4. **Proposed fixes**: sorted by KB saved. Compression and modern image formats, deferred loading of heavy code, caching, lightened fonts... You validate each patch; the design choices (third-party scripts, animations, dark mode) remain in your hands.

5. **Re-measurement after deployment**: the quantified before/after (grade, weight, CO2e).

## What it creates for you

- A quantified eco-design report per page (EcoIndex, CO2e, weight, breakdown of the waste)
- The validated fixes applied to the code
- A measurable before/after to show (or to include in a CSR initiative)

## Prerequisites

- A **deployed** site (the audit measures the site online)
- The Google PageSpeed key from the vault (the same as `/seo-perf`; guided creation if it is the first time)

## Good to know

- The CO2e/water figures are **methodological estimates** (EcoIndex formulas): perfect for comparing before/after and situating your site, not for an official carbon assessment.
- The #1 item is almost always **images**: it is also the easiest to fix, and it speeds up the site along the way. Ecology and performance go in the same direction.
