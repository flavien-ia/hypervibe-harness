# /add-analytics

Enables **Google Analytics** on your site, with an **RGPD-compliant cookie banner** (consent required before any tracking).

## When to use it

- You want to **measure your site's audience** (number of visitors, most viewed pages, traffic sources, visit duration)
- You want to **comply with the RGPD** without having to configure everything by hand
- You want to receive a **regular email report** (weekly or monthly) with your statistics

## How it goes

1. **Check**: if GA4 is already in place, Hypervibe offers you a menu (switch GA property, reinstall the cookie banner, set up an email report, etc.).

2. **Domain advice**: if you are still on a Vercel URL, Hypervibe recommends connecting your real domain first (`/add-domain`). You can still continue with the Vercel URL and update the web data stream on the GA4 side later.

3. **Getting the measurement ID (G-XXXXXXXXXX)**:
  - If you have never used GA, Hypervibe guides you through creating an account on analytics.google.com
  - If you already have one, it shows you how to **add a new property** to your existing account
  - You copy-paste the `G-XXXXXXXXXX` into the chat

4. **Pushing the variable**: `NEXT_PUBLIC_GA_MEASUREMENT_ID` is pushed to `.env` + Vercel.

5. **Creating the GoogleAnalytics component**: a React component that loads GA4 **only after the cookies are accepted** (never before). If the visitor accepts later, GA loads instantly without reloading the page. The component **automatically excludes the admin routes** (`/admin`) from tracking, and Hypervibe offers to also exclude your authenticated areas (dashboard, members area, account) - so that your own visits and those of your logged-in clients do not pollute your acquisition statistics.

6. **Creating the consent banner**: a small discreet popup in the bottom left (small max-width, semi-transparent dark background, your site's accent color on the "Accept" button). The wording is deliberately generic (*"This site uses cookies for audience measurement purposes."*). It stays valid even if you add other trackers later.

7. **Updating the legal pages**: Hypervibe automatically updates your privacy policy to mention GA4 and explain the right to withdraw consent.

8. **Email report (optional)**: Hypervibe offers and **guides you click-by-click** to enable a scheduled GA4 report (most viewed pages, Acquisition, Engagement…) sent to your inbox every week or every month. It is 100% GA4 UI, Hypervibe cannot configure it for you, but it gives you the step-by-step.

## What it creates for you

- A **Google Analytics property** in your name (or a new property in your existing account)
- The `NEXT_PUBLIC_GA_MEASUREMENT_ID` variable in `.env` + Vercel
- A `GoogleAnalytics` component that loads GA only after the cookies are accepted, and that does not enable tracking on the admin routes (nor on the authenticated areas you choose to exclude)
- A `CookieConsent` component (banner) with your site's design
- An update to the **privacy policy** to mention GA
- If you want it: a **regular GA4 email report** (UI configuration, guided)

## Prerequisites

- The project must be in Next.js (typically initialized by `/bootstrap`)
- A Google account (free)

## Tips

{{callout:warning|RGPD: tracking only starts after acceptance}}
The banner is required for RGPD compliance. GA cookies are **never** dropped before the visitor clicks "Accept". If they click "Refuse" or close the banner, no tracking. All of this is built in by default. You have nothing to code.
{{/callout}}

{{callout:tip|Email report = valuable so you do not forget}}
If you do not open Google Analytics every week, the email report is very useful. Hypervibe guides you to enable the **Pages and screens** report (the most viewed pages), a classic. You can add others afterwards: Acquisition (where the visitors come from), Demographics (countries, devices, etc.).
{{/callout}}

{{callout:info|Why a generic wording}}
The banner says "audience measurement" without naming GA4 specifically. This is on purpose: the day you add Meta Pixel or Hotjar, the text already covers it. No need to update the banner with each new tracker.
{{/callout}}

{{callout:tip|Your admin visits do not skew your stats}}
Tracking is disabled on the admin routes (`/admin`): when you manage your site, your own sessions are not counted as visitors. You can extend this exclusion to your authenticated areas (dashboard, members area, account) - Hypervibe offers it during the installation. Already installed before this improvement? Re-run `/add-analytics` and choose "Exclude admin routes / authenticated areas from tracking".
{{/callout}}
