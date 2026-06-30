# /add-stripe

Adds **online payments** to your app via Stripe Checkout. To sell products, accept donations, manage subscriptions.

## When to use it

- You want to sell something online: a training, a product, a service, a monthly/yearly subscription
- You want to accept donations or pre-orders
- You want to manage a one-time or recurring purchase system

## How it works

1. **Check**: if Stripe is already in place, Hypervibe offers you a menu to switch from test mode to live mode, regenerate the keys, update the webhook secret, etc.

2. **Product question**: Hypervibe asks you **what you want people to pay for**:
  - One-time purchase (training, book, one-off service...)
  - Recurring subscription (monthly/yearly SaaS, member access...)
  - A mix of both
  - You don't know yet (the infrastructure is set up anyway, you can define the products later)

3. **Installation**: Hypervibe installs the Stripe SDK (`stripe` + `@stripe/stripe-js`) and the Stripe CLI if needed.

4. **Getting the test keys**: Hypervibe explains the difference between **test mode** (fake cards, no real payment) and **live mode** (real payments). You stay in test to start. You get two keys from dashboard.stripe.com/test/apikeys and paste them: `Publishable key` (`pk_test_...`) and `Secret key` (`sk_test_...`).

5. **Automatic configuration**: Hypervibe scaffolds:
  - A server-side Stripe client (`src/server/stripe.ts`)
  - A webhook (`src/app/api/webhooks/stripe/route.ts`) that verifies the signature of messages coming from Stripe
  - A tRPC `payment` router with a `createCheckoutSession` procedure

6. **Automatic webhook secret capture**: Hypervibe temporarily runs `stripe listen` to capture the `STRIPE_WEBHOOK_SECRET` (without you having to copy-paste it), then closes the listener.

7. **Terms of sale (optional)**: Hypervibe offers to generate your Terms of Sale (mandatory in France for any site that sells). It asks you questions about your offer (type, price, withdrawal, refund, contact) and generates the complete `/cgv` page.

8. **Product pages + checkout (optional)**: Hypervibe offers to build the `/pricing`, `/payment/success`, `/payment/cancel` pages with your real products, wired up to Stripe.

## What it creates for you

- The `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` variables (in Vercel + `.env`)
- `STRIPE_WEBHOOK_SECRET` only in the local `.env` (the prod webhook will have its own key)
- A reusable Stripe client throughout your code
- A secure webhook endpoint that can listen to Stripe events (successful payment, refund, etc.)
- A ready-to-use tRPC procedure to create a checkout session
- Optional: your generated terms of sale
- Optional: your product pages + checkout

## Prerequisites

- The project must be in Next.js (typically initialized by `/bootstrap`)
- A Stripe account (free). The Stripe CLI will be installed by Hypervibe if missing

## Tips

{{callout:warning|Stay in TEST mode to start}}
**Do not switch to live until everything works in test.** Test mode uses fake cards (`4242 4242 4242 4242`, any future date, any CVC). No real money moves. This is where we start, always.
{{/callout}}

{{callout:tip|To test locally}}
When you test payments locally (`pnpm dev`), open another terminal in parallel and run:
```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Without it, Stripe's webhooks do not reach your local app and checkout stays stuck. The `STRIPE_WEBHOOK_SECRET` in `.env` is already configured for this listener.
{{/callout}}

{{callout:info|To go live}}
When you are ready to collect real payments, just tell Hypervibe: *"switch Stripe to live"*. It guides you step by step (getting the `pk_live_...` / `sk_live_...` keys, creating the production webhook, pushing the keys to Vercel, testing with a real 1 EUR payment that you refund afterwards). The full procedure is also in your project's `CLAUDE.md`.
{{/callout}}
