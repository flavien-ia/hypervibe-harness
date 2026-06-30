---
name: add-stripe
description: Add Stripe Checkout payments to an existing T3 project. Creates server client, webhook endpoint, tRPC example, and local dev setup.
argument-hint: "[price model, product type, etc.]"
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add Stripe - Stripe Checkout Configuration

Adds Stripe Checkout to the current project. Can be called by `/bootstrap` or standalone on an existing project.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

---


## Step 0 - Preflight: is Stripe already configured?

**First of all**, invoke `_check-deps stripe` to detect whether Stripe is already in place:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" stripe)
stripe_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).stripe.ok)")
stripe_mode=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).stripe.mode || 'unknown')")
```

### If `stripe_ok = true` -> re-configuration mode

Stripe is already in place (in `$stripe_mode` mode: test or live). Do NOT redo the entire setup (that would recreate the payment router, overwrite the webhook secret, ask for the API keys again, etc.). Show a menu:

> ## 💳 Stripe is already in place on your project (current mode: **$stripe_mode**)
>
> What do you want to do?
>
> 1. **Switch from test mode to live mode** (you are ready to accept real payments on your production site) - I replace your test keys with live keys
> 2. **Switch from live mode to test mode** (back to dev / debug)
> 3. **Regenerate the Stripe keys** (security rotation - useful if you fear a leak)
> 4. **Update the webhook secret** (if Stripe changed the webhook signature)
> 5. **Redo everything from scratch** (only useful if your Stripe config is broken - first remove `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from the local `.env`)
> 6. **Something else** - tell me what you want

Wait for the answer.

**Depending on the answer**:

| Choice | Action |
|---|---|
| 1 (test -> live) | **Jump directly to Step 13** (structured procedure: KYC check + keys + live webhook auto-created + tests + cleanup). Do not handle this choice inline here - Step 13 does the full audit. |
| 2 (live -> test) | Lighter symmetric path: test keys (`sk_test_...`), webhook via local `stripe listen`. Simpler (no need to touch the prod dashboard). If the user wants to re-enable the old test webhook, remind them to do it in dashboard.stripe.com/test/webhooks. |
| 3 (key rotation) | Guide the user to dashboard.stripe.com/apikeys -> Roll key. Then push the new one via `_push-env-vars`. |
| 4 (webhook secret only) | Re-run Step 8 only (re-capture via `stripe listen --print-secret` or the dashboard webhook). |
| 5 (redo everything) | Abort: ask the user to clean up their Stripe env vars manually, then re-run. Do NOT do the cleanup for them (destructive, possibly prod). |
| 6 (something else) | Ask for clarification. Do not launch the full flow by default. |

**At the end**, jump directly to the **final summary** (last step), adapting it to the change that was made.

### If `stripe_ok = false` (not configured yet)

Continue normally to Step 1. This is the initial installation flow.

---

## Step 1 - Check prerequisites

Invoke the `_detect-project-root` internal skill to get `PROJECT_NAME`, `WEB_DIR`, `IS_NEXTJS`. Abort if `IS_NEXTJS=no`.

Then check the Stripe CLI:
```bash
stripe --version
```

If the command fails (not installed) **or** if `stripe config --list` shows no API key (not authenticated), invoke the **`_setup-stripe-cli`** internal skill to install and authenticate it. Wait for it to complete, then re-verify with `stripe --version` before continuing.

## Step 2 - Product context

Before touching any code, understand what the user wants to sell. This determines the **Checkout mode** (`payment` for a one-time purchase, `subscription` for a recurring subscription) and serves as context to propose the product pages at the end.

Ask:

> Before configuring Stripe, tell me what you want people to pay for in your app:
>
> 1. **Payment type**:
>    - **One-time purchase** (training, digital book, event, one-off service...)
>    - **Recurring subscription** (monthly/yearly SaaS, member access...)
>    - **A mix of both** (e.g. a training to buy + a member subscription)
> 2. **Your products / plans**: give me the list with a name, a price, and the currency (default EUR). E.g.:
>    - "Online training - 297 EUR"
>    - "Pro plan - 19 EUR/month", "Team plan - 49 EUR/month"
> 3. **Do you already know**, or would you rather define this later?

Store the provided context (mode + product list) in a mental variable `<product_context>` for the following Steps.

If the user says "I don't know yet" -> note `<product_context>` = "to be defined" and continue (the Stripe infrastructure will still be set up, the user can come back later for the pages).

## Step 3 - Install dependencies

```bash
pnpm add stripe @stripe/stripe-js
```

## Step 4 - Get API keys from the user

**Before asking for the keys**, explain the test vs live difference:

> Stripe has 2 completely separate modes:
> - 🧪 **Test mode**: fake card numbers (`4242 4242 4242 4242`), no real money. **This is where we start.** You can test the whole payment flow with no risk.
> - 🔴 **Live mode**: real cards, real transactions, real money landing in your account. To be enabled **only** when you are sure everything works in test.
>
> In the Stripe dashboard, top right, there is a toggle **"Test mode" <-> "Live mode"**. **For now, stay in Test mode.**

Then ask for the keys:

> Give me your 2 keys from https://dashboard.stripe.com/test/apikeys (URL in test mode):
> 1. **Publishable key** (`pk_test_...`)
> 2. **Secret key** (`sk_test_...`)

If the user accidentally provides `pk_live_...` or `sk_live_...` keys, point it out and ask again for the test versions (a safety measure so you don't wire up prod by mistake during dev).

## Step 5 - Push env vars

Invoke `_push-env-vars` with:
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<publishable key from user>`
- `STRIPE_SECRET_KEY=<secret key from user>`

(The `STRIPE_WEBHOOK_SECRET` will be added later, in Step 8.)

## Step 6 - Scaffold server code via script

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-stripe.mjs"
```

(Add `--web-dir apps/web` if monorepo. Override the Stripe API version with `--api-version 2025-XX-XX` if newer than the script default.)

Creates:
- `src/server/stripe.ts` (server client)
- `src/app/api/webhooks/stripe/route.ts` (POST handler with `STRIPE_WEBHOOK_SECRET` signature verification)
- `src/server/api/routers/payment.ts` with a `createCheckoutSession` procedure **if** `src/server/api/trpc.ts` exists (auto-detection - uses `protectedProcedure` if available, otherwise `publicProcedure`).

Idempotent: each file is written only if it does not exist (the script warns about the ones it skips).

**Adjustment based on `<product_context>` from Step 2**:
- If `<product_context>` indicates **subscription** (only) -> after the script, edit `src/server/api/routers/payment.ts` to replace `mode: "payment"` with `mode: "subscription"`.
- If **mix of one-time purchase + subscription** -> keep `mode: "payment"` (the default), but note in the summary that a second `createSubscriptionCheckout` procedure will need to be added when the user configures their subscription products.
- If **one-time purchase only** -> keep `mode: "payment"` as is.
- If **to be defined** -> keep `mode: "payment"` as is, to be adjusted later.

## Step 7 - Register the payment router

If the script created `paymentRouter`, register it in `src/server/api/root.ts`:
```typescript
import { paymentRouter } from "~/server/api/routers/payment";

export const appRouter = createTRPCRouter({
  // ...existing routers...
  payment: paymentRouter,
});
```

## Step 8 - Capture the webhook signing secret (automatic, no user action)

The `STRIPE_WEBHOOK_SECRET` lets the app verify that the webhooks it receives really come from Stripe (and not from an attacker forging requests). It is generated by the Stripe CLI on first use and **stays the same** across future invocations (tied to the Stripe account). We capture it once and store it.

**Automated procedure** (Claude does everything, the user touches nothing):

1. Start `stripe listen` in the background:
   ```bash
   # with Bash run_in_background:true
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
2. Read the process output (the first line contains `Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxx`) - extract the `whsec_...`.
3. Kill the process (we no longer need the live connection, just the secret).
4. **Write ONLY to the local `.env`** (no Vercel push): `STRIPE_WEBHOOK_SECRET=whsec_...`. ⚠️ This key is specific to the local Stripe CLI - it does NOT work for the production webhook (the prod webhook will have its own key, created later via the "Switch Stripe to live mode" procedure). Pushing this key to the Vercel env vars would break signature verification in prod.

Since `_push-env-vars` pushes to Vercel by default too, here **do not use it** - write directly to `.env`:
```bash
# Add or replace the line in .env
grep -v "^STRIPE_WEBHOOK_SECRET=" .env > .env.tmp 2>/dev/null && mv .env.tmp .env
echo "STRIPE_WEBHOOK_SECRET=<whsec_...>" >> .env
```

If `stripe listen` fails (CLI not authenticated) -> invoke `_setup-stripe-cli` then start over.

**Note for future dev sessions**: when the user tests payments locally, they will need to run, **in parallel** with `pnpm dev`, in their terminal:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
(The `whsec_...` captured now stays valid, so no re-configuration needed.)

## Step 9 - Update CLAUDE.md

Invoke `_update-claude-md` with:
- `stack`: `- **Payments**: Stripe Checkout (server client in \`<WEB_DIR>/src/server/stripe.ts\`, webhook at \`/api/webhooks/stripe\`). Currently in **TEST mode** (keys \`pk_test_...\` / \`sk_test_...\`).`
- `env-vars`:
  - `- \`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY\` - Stripe publishable key (test or live depending on mode)`
  - `- \`STRIPE_SECRET_KEY\` - Stripe secret key (test or live depending on mode)`
  - `- \`STRIPE_WEBHOOK_SECRET\` - signing secret to verify webhooks (different for the local CLI vs the production endpoint)`
- `conventions`:
  - `- **Testing payments locally**: in a separate terminal, in parallel with \`pnpm dev\`, run the command \`stripe listen --forward-to localhost:3000/api/webhooks/stripe\`. Without it, Stripe's webhooks are not received by the local app and checkout will not work. The \`STRIPE_WEBHOOK_SECRET\` in \`.env\` is already configured for this listener (captured during /add-stripe).`
- `custom`:
  - heading: `## Stripe products`
  - body: content based on `<product_context>` from Step 2. Format:
    ```
    Payment type: <one-time purchase | subscription | mix | to be defined>

    Products / plans:
    - <Name 1> - <price> <currency> [<frequency if subscription>]
    - <Name 2> - <price> <currency>
    ...

    Associated pages: <to create | in place> (/pricing, /payment/success, /payment/cancel)
    ```
    If `<product_context>` = "to be defined", write `To be defined with the user when they are ready.` instead of the content.
- `custom`:
  - heading: `## Switch Stripe to live mode (production)`
  - body:
    ```
    To be done ONLY when you are ready to collect real payments (having tested the full flow in test mode beforehand). Strict order:

    1. **Get the live keys**
       - Stripe dashboard -> top-right toggle: "Test mode" -> "Live mode"
       - Page https://dashboard.stripe.com/apikeys (URL without /test/)
       - Copy `pk_live_...` and `sk_live_...`

    2. **Push the live keys to Vercel only** (keep the test keys locally to keep developing)
       - `_push-env-vars NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...` (Vercel production + preview)
       - `_push-env-vars STRIPE_SECRET_KEY=sk_live_...` (same)
       - **Do NOT overwrite the local `.env`** - local must stay in test mode to avoid collecting money during dev.

    3. **Create a live webhook on the Stripe side**
       - Verify the prod URL (no 301/307 redirect): `curl -I https://<domain>/api/webhooks/stripe`
       - Create: `stripe webhook_endpoints create --url "https://<verified-url>/api/webhooks/stripe" --enabled-events checkout.session.completed` (no --live flag, the active mode is the one of the dashboard toggle)
       - Get the returned `whsec_...`

    4. **Push the live whsec to Vercel**
       - `_push-env-vars STRIPE_WEBHOOK_SECRET=whsec_...` (production + preview)
       - **Do NOT overwrite** the `STRIPE_WEBHOOK_SECRET` in the local `.env` (which points to the CLI listen, not to the prod webhook).

    5. **Test with a real transaction**
       - Make a 1 EUR payment from the app in prod with your real card
       - Check that it shows up in the Stripe Dashboard (Live mode)
       - Do an immediate refund from the dashboard

    6. **`git push`** to redeploy (Vercel rebuilds with the new env vars).

    If you want to go back to test mode later: redo steps 1-2-4 with the `_test_` keys.
    ```

## Step 10 - Propose Terms of Sale (CGV - Conditions Generales de Vente)

Payments in France = mandatory terms of sale (CGV). Ask: *"I can generate the terms of sale now if you give me a few details (product type, price, withdrawal, refund, support). Shall we?"*

If yes, collect: product/service type, pricing terms, delivery/access terms, withdrawal policy (14 days in France, with exceptions for digital / services already performed / dated trainings), refund policy, contact email.

Then generate `src/app/cgv/page.tsx` (or `src/app/[locale]/cgv/page.tsx` if i18n), in Tailwind prose, with these sections: purpose, products+prices, ordering/payment (mention Stripe as the provider), delivery/access, withdrawal with exceptions, refund, liability, data protection (link to the privacy policy), governing law + jurisdiction (courts of the registered office), contact. Add a "CGV" link in the footer next to "Legal notice" and "Privacy policy".

**i18n convention for the CGV**: if the project is in i18n mode, **the CGV stay in French regardless of the visitor's locale** - a legal document specific to French law, a standard practice on French multilingual sites. Do not add `cgv.*` keys to the `messages/<locale>.json` files, and do not run the content through `useTranslations()`. Hardcoded text in FR in the component.

If the user would rather do it later, skip it and mention it as a manual action in the summary.

---

## Step 11 - Propose building the product pages + checkout

The Stripe infrastructure is in place but no UI page exists yet (no `/pricing`, no checkout page, no `/success`, no `/cancel`). Ask the user:

> Stripe is wired up on the server side ✅. For your users to actually be able to pay, you now need to build the pages:
>
> - **`/pricing`** - shows your plans with a "Buy" / "Subscribe" button per product
> - **`/checkout/[product]`** (or a direct button from /pricing) - triggers the Stripe Checkout session
> - **`/payment/success`** - confirmation page after a successful payment (with an order recap)
> - **`/payment/cancel`** - page if the user cancels during checkout
>
> I can build them now with **your real products** (see CLAUDE.md > "Stripe products") or would you rather do them yourself later?

**If yes**:
- Read the product context in CLAUDE.md (section "## Stripe products")
- If `<product_context>` = "to be defined" -> re-collect the products now via a mini-conversation
- Build the 4 pages with the project's style (read `globals.css` for the palette + `~/components/ui/` for the available shadcn components)
- Wire each "Buy" button to the `createCheckoutSession` tRPC procedure created in Step 6 (pass the matching Stripe `priceId`)
- If the Stripe products do not yet exist on the Stripe side (just a name + price in the conversation), propose to create them now via the Stripe CLI:
  ```bash
  stripe products create --name "<name>" --description "<desc>"
  stripe prices create --product <product_id> --unit-amount <price_in_cents> --currency eur [--recurring interval=month if subscription]
  ```
  Get the `price_id` values (`price_xxx`) and use them in the pages' code.
- Update the "## Stripe products" section of CLAUDE.md with "Associated pages: in place ✅"

**If no / later**:
- Mention it explicitly in the Step 12 Summary as a remaining manual action
- Do not mark the "Associated pages" section of CLAUDE.md as "in place"

## RGPD - Privacy policy

Add Stripe to the project's RGPD subprocessor registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add stripe
```

The helper is idempotent. If the `politique-de-confidentialite/page.tsx` page exists (created by `/bootstrap`), it updates automatically. Otherwise, only the registry is created - `/rgpd-audit` can generate the page later.

## Step 12 - Summary

Present to the user:

> ✅ **Stripe Checkout configured.**
>
> 🧪 **You are in TEST mode - no real payment is collected.** To test:
> - Fake card number: `4242 4242 4242 4242` (any future expiry date, any CVC)
> - Before each test session, open a separate terminal and run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` in parallel with `pnpm dev` (otherwise the webhooks are not received -> checkout broken)
>
> 🔴 **To go LIVE (collect real payments)**: when you are sure everything works in test, tell me *"switch Stripe to live"* and I'll guide you. The full procedure is also documented in `CLAUDE.md` -> section "Switch Stripe to live mode (production)".

If product/checkout pages were generated in Step 11:
> - 🛒 Pages `/pricing`, `/payment/success`, `/payment/cancel` created with your products.

If pages were skipped:
> - 🛒 **Product pages not created** - when you are ready to add them, tell me *"create the payment pages"* (the product context is in `CLAUDE.md` -> "Stripe products").

If the CGV were generated:
> - 📜 Your terms of sale are at `/cgv` - have them reviewed by a lawyer before going to prod.

If the CGV were skipped:
> - ⚠️ **Manual action required**: terms of sale are mandatory for any site that accepts payments in France. To be created before going to prod.

---

## Step 13 - Test -> live migration procedure (triggered by Choice 1 of Step 0)

This section is invoked only when the user chooses "1. Switch from test mode to live mode" in the Step 0 menu. It is a **structured procedure** because the test -> live transition has 4 silent pitfalls (seen in prod):

1. **Live webhook never created** -> first live payment collected but no event fires on the app side -> order lost
2. **Stripe account not activated for live (KYC)** -> `sk_live_` keys accepted but all charges return `account_not_ready`
3. **Hardcoded Price IDs in the code** -> if the code uses `price: "price_1Q..."` instead of `price_data: {...}`, going live breaks with `No such price`
4. **Test webhook left active** -> keeps receiving test events after migration, noise + risk of double processing

The Hypervibe bootstrap uses `price_data` (no pitfall #3), but the others remain. This procedure covers them in order.

### 10.1 - Get the live keys

Show the user:

> Let's switch Stripe to live. I need your two live keys (different from the test ones):
>
> 1. Go to **https://dashboard.stripe.com/apikeys** (URL **without** `/test/` - check that the "Test mode" toggle is **OFF** in the top right)
> 2. Copy the **Publishable key** (starts with `pk_live_`)
> 3. Copy the **Secret key** (starts with `sk_live_`) - click **Reveal** first to see it
>
> Paste both here.

Get the values. **Validate strictly**:
- If the Publishable key does not start with `pk_live_` -> refuse, ask again.
- If the Secret key does not start with `sk_live_` -> refuse, ask again.
- If the user gives you `pk_test_` / `sk_test_` keys "by mistake" -> explicitly point out *"these keys are TEST keys, not LIVE - re-check the toggle in the dashboard"*.

Do **not** push the keys right away - first the KYC check (10.2) to avoid switching Vercel to live if the account cannot be activated.

### 10.2 - Verify the account is activated for live (KYC)

Stripe blocks all live charges until the KYC (identity, IBAN, supporting documents) is validated. Without it, the user will switch to live and see all payments declined without understanding why.

```bash
SK_LIVE="<sk_live_...>"
ACCOUNT=$(stripe accounts retrieve --api-key "$SK_LIVE" 2>/dev/null) || { echo "KYC=auth_error"; exit 0; }
CHARGES=$(echo "$ACCOUNT" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(d.charges_enabled === true ? 'yes' : 'no');
  console.log(d.payouts_enabled === true ? 'yes' : 'no');
  console.log((d.requirements && d.requirements.currently_due || []).join(','));
")
CHARGES_OK=$(echo "$CHARGES" | sed -n 1p)
PAYOUTS_OK=$(echo "$CHARGES" | sed -n 2p)
DUE=$(echo "$CHARGES" | sed -n 3p)

if [ "$CHARGES_OK" = "yes" ] && [ "$PAYOUTS_OK" = "yes" ]; then
  echo "KYC=ok"
else
  echo "KYC=incomplete"
  echo "KYC_MISSING=$DUE"
fi
```

Depending on the output:
- `KYC=ok` -> continue to 10.3 silently.
- `KYC=auth_error` -> the live key is not valid, back to 10.1.
- `KYC=incomplete` -> **block the migration**. Show:

> ⚠️ **Your Stripe account is not yet activated to accept real payments** (identity verification incomplete).
>
> Here is what is still missing (according to Stripe):
> ```
> <KYC_MISSING>
> ```
>
> I'm opening the dashboard so you can finalize the activation:
>
> ```bash
> node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://dashboard.stripe.com/account/onboarding"
> ```
>
> Typical steps:
> - Director's identity (ID card / passport)
> - IBAN of the bank account that will receive the payments
> - Proof of address / company registration
>
> Stripe validates in a few minutes to 24 h depending on the country. Tell me **"it's validated"** when `charges_enabled` flips to `true` in dashboard.stripe.com/account -> Status tab, or simply when you get the Stripe confirmation email.

After the user confirms -> re-run the bash block. As long as `KYC=ok` is not reached, **do not push the keys to Vercel** (otherwise the prod site accepts payments that will all be declined).

### 10.3 - Detect hardcoded price IDs in the code

```bash
HARDCODED=$(grep -rE "price[:[:space:]]+['\"]price_[a-zA-Z0-9]+['\"]" \
  "<WEB_DIR>/src/" --include="*.ts" --include="*.tsx" 2>/dev/null)

if [ -z "$HARDCODED" ]; then
  echo "HARDCODED_PRICES=none"
else
  echo "HARDCODED_PRICES=found"
  echo "$HARDCODED"
fi
```

Depending on the output:
- `HARDCODED_PRICES=none` -> continue to 10.4 silently (the default bootstrap case which uses `price_data`).
- `HARDCODED_PRICES=found` -> **strong warning**:

> ⚠️ **I found hardcoded price IDs in your code**:
> ```
> <the grep lines>
> ```
>
> Stripe price IDs are **mode-scoped**: the ones created in test do not exist in live and vice versa. If you switch to live without doing anything, the first payment breaks with `No such price`.
>
> Two solutions:
>
> **A. Replace with `price_data` (recommended for dynamic prices)**
> No more price IDs to manage, the price is built on the fly at each checkout. This is what the default bootstrap does. If you want me to migrate your code, tell me *"migrate to price_data"*.
>
> **B. Keep the price IDs but use `lookup_key`**
> 1. Go to dashboard.stripe.com/products -> recreate each product in **live mode** with the **same `lookup_key`** as the one you had in test (e.g. `course-basic`).
> 2. Change your code: replace `price: "price_1Q..."` with a lookup via `lookup_key`.
>
> **Block the migration until this point is resolved.** Tell me which of the two you want to do.

If the user chooses A -> do the code migration automatically (case by case depending on the code). If B -> guide, wait for `"it's done"` confirmation, then continue.

### 10.4 - Push the live keys to Vercel

At this stage: KYC OK + no blocking hardcoded prices. We can push.

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/push-env-vars.mjs" \
  "STRIPE_SECRET_KEY=$SK_LIVE" \
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$PK_LIVE"
```

Note: do not push to local `dev` (the user probably wants to keep test locally). `_push-env-vars` targets `production + preview` by default, which is the right behavior.

### 10.5 - Duplicate the webhook test -> live (auto)

Stripe has 2 separate webhook catalogs. We will list the test webhooks, identify the prod one (URL with the domain, not localhost), and create the live mirror with **the same list of events**.

```bash
SK_TEST=$(grep "^STRIPE_SECRET_KEY=" "<WEB_DIR>/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
# .env.local takes priority if present (dev), otherwise .env
[ -z "$SK_TEST" ] && SK_TEST=$(grep "^STRIPE_SECRET_KEY=" "<WEB_DIR>/.env" | head -1 | cut -d= -f2- | tr -d '"')

# Detect target domain from NEXT_PUBLIC_APP_URL
DOMAIN=$(grep "^NEXT_PUBLIC_APP_URL=" "<WEB_DIR>/.env" | head -1 | cut -d= -f2- | tr -d '"' | sed 's|https\?://||;s|/$||')
WEBHOOK_URL="https://$DOMAIN/api/webhooks/stripe"

# 1. List test webhooks, find the one matching the domain (the "prod test" webhook)
TEST_WH=$(stripe webhook_endpoints list --api-key "$SK_TEST" --limit 50 2>/dev/null)
EVENTS=$(echo "$TEST_WH" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  const prod = (d.data || []).find(w => w.url && !w.url.includes('localhost') && !w.url.includes('127.0.0.1'));
  if (prod && Array.isArray(prod.enabled_events)) console.log(prod.enabled_events.join(','));
")

# Fallback events list if no test prod webhook found
if [ -z "$EVENTS" ]; then
  EVENTS="checkout.session.completed,payment_intent.succeeded,payment_intent.payment_failed"
  echo "WH_EVENTS=fallback_default"
else
  echo "WH_EVENTS=copied_from_test"
fi

# 2. Check if a live webhook for this URL already exists
LIVE_WH=$(stripe webhook_endpoints list --api-key "$SK_LIVE" --limit 50 2>/dev/null)
EXISTING_ID=$(echo "$LIVE_WH" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  const found = (d.data || []).find(w => w.url === process.env.WEBHOOK_URL);
  if (found) console.log(found.id);
")

if [ -n "$EXISTING_ID" ]; then
  echo "LIVE_WH=already_exists:$EXISTING_ID"
  echo "Use this webhook's signing secret - already in Vercel? If not, surface manual step."
else
  # 3. Create the live webhook
  CREATE=$(stripe webhook_endpoints create \
    --api-key "$SK_LIVE" \
    --url "$WEBHOOK_URL" \
    --enabled-events "$EVENTS" 2>/dev/null)
  WH_ID=$(echo "$CREATE" | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(d.id||'');")
  WH_SECRET=$(echo "$CREATE" | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(d.secret||'');")
  if [ -n "$WH_ID" ] && [ -n "$WH_SECRET" ]; then
    echo "LIVE_WH=created:$WH_ID"
    # Push the live signing secret to Vercel (production + preview ONLY, NOT local)
    node "${CLAUDE_SKILL_DIR}/../../scripts/push-env-vars.mjs" \
      --target=production,preview \
      "STRIPE_WEBHOOK_SECRET=$WH_SECRET"
    echo "LIVE_WH_SECRET_PUSHED=yes"
  else
    echo "LIVE_WH=create_failed"
  fi
fi
```

⚠️ **Critical note on `STRIPE_WEBHOOK_SECRET`**: the live value goes to **production + preview only**, **not** to local (`.env`). The local `.env` must keep the `whsec_...` from `stripe listen` (CLI) so that `pnpm dev` keeps working. This is what `--target=production,preview` does - verify in review that the local `.env` was not overwritten.

Depending on the output:
- `LIVE_WH=already_exists:<id>` -> tell the user `ℹ️ A live webhook already existed for ${WEBHOOK_URL}. I'm not creating a new one. Check that ${STRIPE_WEBHOOK_SECRET} on Vercel matches this one (otherwise the signatures will not validate).` + auto-open the dashboard to get the secret if needed.
- `LIVE_WH=created:<id>` + `LIVE_WH_SECRET_PUSHED=yes` -> ✅ `Live webhook created and its signing secret pushed to Vercel`.
- `LIVE_WH=create_failed` -> surface the Stripe response, propose a manual fix via the dashboard.

### 10.6 - Verify the webhook with a test event (best-effort)

```bash
# Optional - useful but can pollute the DB if the app treats the test event as a real one
echo "Test webhook delivery ?"
```

Ask the user:

> Do you want me to check that the live webhook does receive events? I can send a test `checkout.session.completed` to your live endpoint (synthetic - no real card, no real customer). Risk: if your webhook processes the event without verifying the source, it will create a fake order in your DB.

If **yes**:

```bash
stripe trigger checkout.session.completed --api-key "$SK_LIVE"
sleep 5
# Check delivery status
LATEST=$(stripe events list --api-key "$SK_LIVE" --limit 1 2>/dev/null | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
    const e = (d.data || [])[0];
    if (!e) console.log('no_events');
    else console.log(e.type + '|' + (e.pending_webhooks === 0 ? 'delivered' : 'pending'));
  ")
echo "TEST_TRIGGER=$LATEST"
```

If delivered OK -> ✅. If pending > 0 after 5s -> tell the user "Check dashboard.stripe.com/webhooks -> your endpoint -> Events tab to see the detail". If `no_events` -> something is wrong, surface the error.

If **no** -> skip, and remind the user to test with a real card (small amount) on their first real payment.

### 10.7 - Disable the old test webhook (optional)

```
Show:
> Do you want to disable the old test webhook on Stripe? Once you are live, it keeps firing every time you run a local test - this is generally useful noise to keep for dev. Recommendation: **keep it**, and disable it only if you no longer test locally at all.
```

If the user says **yes, disable it**:
```bash
stripe webhook_endpoints update <test-wh-id> --disabled --api-key "$SK_TEST"
```

If **no / by default** -> skip.

### 10.8 - Update CLAUDE.md

Update the CLAUDE.md stack line (which says "Currently in **TEST mode**") so it reflects the switch to live. Via `_update-claude-md`:
- Replace `"Currently in **TEST mode**"` with `"Currently in **LIVE mode** (production)"`
- Add a note `"Live webhook: wh_xxx pointing to https://<domain>/api/webhooks/stripe"` if it is not already there

### 10.9 - Final recap

> ✅ **Stripe switched to LIVE mode**
>
> **Configured automatically:**
> - ✅ Live keys pushed to Vercel (production + preview)
> - ✅ Live webhook `<wh_id>` created on https://<domain>/api/webhooks/stripe (events: <list>)
> - ✅ Live webhook signing secret pushed to Vercel
> - [✅ Test webhook disabled - if choice 10.7]
>
> **Verified manually by you:**
> - ✅ Stripe account KYC (charges_enabled = true)
> - [✅ Price IDs migrated to price_data / lookup_key - if applicable]
>
> **Important**:
> - Your local `.env` keeps the TEST webhook secret (for `stripe listen` in dev) - this is intentional.
> - The Vercel redeploy is needed for the new keys to be active - tell me *"deploy"* if you have not pushed yet.
> - First live payment = test with a small-amount card of your own (like 1 EUR) to validate the whole end-to-end flow.
