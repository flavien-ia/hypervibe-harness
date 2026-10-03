# /accessibility

Checks how well your app serves the people who see, hear, move or read differently, and fixes what you approve. Hypervibe reads your code, measures your pages online, explains each problem in plain words (what it is, who it shuts out), then applies the fixes you validate.

## When to use it

- Before a launch, to make sure **everyone can use** your app: people who are blind or partially sighted, who cannot use a mouse, who have trouble reading
- Your business sells to consumers in the EU: since 28 June 2025, the **European Accessibility Act** makes accessibility a legal requirement for many digital services (micro-businesses providing services are exempt)
- After `/seo`: search engines read the same structure a screen reader does, accessibility and visibility go together

## How it goes

1. **Reading the code**: Hypervibe goes through every page, including those behind a login that no outside measure reaches. It spots what shuts someone out: an image with no text alternative, a button that is only an icon with no name, a form field with no label, a clickable element the keyboard cannot reach, a focus outline removed, zoom blocked on mobile, headings that skip a level.

2. **Measuring the live pages**: if your site is online, 3 to 5 representative pages are measured by Google's servers. You get an accessibility score out of 100, and what only a displayed page shows, colour contrast first. The Google key is the same as for `/seo-perf` and `/eco-audit`.

3. **The checks only a person can make**: navigating with the keyboard alone, zooming to 200%, and if you wish, listening to a page with your computer's screen reader. Hypervibe tells you exactly what to look at.

4. **A clear report**: the score of each page, then the problems from the most serious to the least, each with who it affects, where it is, and the international criterion it relates to (WCAG, level A, AA or AAA).

5. **Proposed fixes**: grouped by kind, you validate each batch. Page language, names for icon buttons, labels for fields, text alternatives that you approve, keyboard navigation, visible focus, a "Skip to content" link... Design choices (colours, complex components) stay yours: you get a proposal, never a change you did not ask for.

6. **Measuring again after deployment**: the before/after of the score, page by page.

## What it creates for you

- An accessibility report for your app, code and live pages
- The fixes you validated, applied to the code
- If you ask for it, an accessibility statement page, honest about where the app stands

## Prerequisites

- A Next.js project created with Hypervibe (or of the same kind)
- For the live measure: the site online, and the free PageSpeed Insights key (Hypervibe guides you to create it if it is not in your vault yet). Without it, the audit reads the code only

## Tips

{{callout:info|An automated audit finds part of the problems}}
About a third, by the usual estimates. That is why Hypervibe asks for the keyboard and zoom checks: they take five minutes and catch what no tool sees. A clean report is a good start, not a certificate.
{{/callout}}

{{callout:tip|Accessibility helps everyone}}
A clear label, a visible focus, enough contrast: they help a person who cannot see, but also someone on a phone in the sun, or in a hurry. And search engines read the same structure.
{{/callout}}

{{callout:warning|No "fully compliant" without a full audit}}
If you publish an accessibility statement, it says honestly where the app stands. Only a complete audit, done by people, can claim full compliance.
{{/callout}}
