#!/usr/bin/env node
// setup-stripe.mjs - Scaffold Stripe Checkout server code for a Next.js project.
//
// Usage:
//   node setup-stripe.mjs [--web-dir .] [--api-version 2025-04-30.basil]
//
// What it creates:
//   1. <web-dir>/src/server/stripe.ts
//      Server Stripe client reading STRIPE_SECRET_KEY from env.
//   2. <web-dir>/src/app/api/webhooks/stripe/route.ts
//      POST handler that verifies the signature via STRIPE_WEBHOOK_SECRET and
//      dispatches by event.type (checkout.session.completed handled, others logged).
//   3. <web-dir>/src/server/api/routers/payment.ts (IF tRPC is detected)
//      Example tRPC procedure creating a Checkout session from a priceId.
//      Only created when <web-dir>/src/server/api/trpc.ts exists.
//
// The Stripe API version defaults to "2025-04-30.basil". Override with
// --api-version if a newer stable version is out (see Stripe changelog).
//
// What it does NOT do (Claude handles):
//   - Ask the user for publishable / secret keys (they can't be created via API).
//   - Push env vars (invoke _push-env-vars after this script).
//   - Run `stripe listen` for local webhook secret capture.
//   - Register paymentRouter in src/server/api/root.ts (Claude does this).
//   - Create /cgv page (stays in SKILL.md prose - legal content needs user input).
//
// Idempotent: skips any file that already exists (warns, does not overwrite).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let webDir = ".";
let apiVersion = "2025-04-30.basil";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--web-dir" && args[i + 1]) webDir = args[++i];
  else if (a === "--api-version" && args[i + 1]) apiVersion = args[++i];
  else {
    console.error(`Unknown arg: ${a}`);
    process.exit(1);
  }
}

const actions = [];

function createIfAbsent(path, content) {
  if (existsSync(path)) {
    actions.push(`↷ ${path} already exists (left as-is)`);
    return false;
  }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  actions.push(`✓ ${path}`);
  return true;
}

// ─── 1. src/server/stripe.ts ─────────────────────────────────────────
const stripeClientPath = join(webDir, "src/server/stripe.ts");
createIfAbsent(
  stripeClientPath,
  `import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "${apiVersion}",
  typescript: true,
});
`,
);

// ─── 2. src/app/api/webhooks/stripe/route.ts ────────────────────────
const webhookPath = join(webDir, "src/app/api/webhooks/stripe/route.ts");
createIfAbsent(
  webhookPath,
  `import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "~/server/stripe";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // TODO: handle successful payment (fulfil order, send email, etc.)
      console.log("Payment successful:", session.id);
      break;
    }
    default:
      console.log(\`Unhandled event type: \${event.type}\`);
  }

  return NextResponse.json({ received: true });
}
`,
);

// ─── 3. tRPC payment router (only if tRPC is present) ───────────────
const trpcPath = join(webDir, "src/server/api/trpc.ts");
if (existsSync(trpcPath)) {
  // Detect whether rateLimitedProcedure is available (setup-security.mjs adds it)
  const trpcSource = readFileSync(trpcPath, "utf8");
  const hasProtected = trpcSource.includes("protectedProcedure");
  const procedure = hasProtected ? "protectedProcedure" : "publicProcedure";
  const paymentRouterPath = join(webDir, "src/server/api/routers/payment.ts");
  createIfAbsent(
    paymentRouterPath,
    `import { z } from "zod";
import { createTRPCRouter, ${procedure} } from "~/server/api/trpc";
import { stripe } from "~/server/stripe";

export const paymentRouter = createTRPCRouter({
  createCheckoutSession: ${procedure}
    .input(
      z.object({
        priceId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: \`\${appUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}\`,
        cancel_url: \`\${appUrl}/payment/cancel\`,
      });
      return { url: session.url };
    }),
});
`,
  );
  actions.push(`  (tRPC detected → paymentRouter uses ${procedure})`);
} else {
  actions.push(`↷ No src/server/api/trpc.ts - skipping paymentRouter creation`);
}

// ─── summary ─────────────────────────────────────────────────────────
console.log("");
for (const a of actions) console.log(`  ${a}`);
console.log(`
✅ Stripe scaffold done (API version ${apiVersion}).

Next (Claude handles):
  - Push env vars via _push-env-vars: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY + STRIPE_SECRET_KEY
  - Register paymentRouter in src/server/api/root.ts (if tRPC was detected)
  - Run \`stripe listen --forward-to localhost:3000/api/webhooks/stripe\` for local dev,
    capture the whsec_... output, push it as STRIPE_WEBHOOK_SECRET (local .env only)
  - Create the production webhook after first Vercel deploy (see add-stripe SKILL.md)
`);
