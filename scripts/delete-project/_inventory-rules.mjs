// _inventory-rules.mjs - Small rules of the inventory, kept apart so a recette can hold them
// without running a whole discovery (scripts/tests/test-delete-vault.mjs).

/** A variable the host or the build tooling injects by itself (`vercel env pull` writes them into
 *  the file it produces: VERCEL_GIT_*, VERCEL_OIDC_TOKEN, TURBO_*, NX_DAEMON...) is never a
 *  service the project is connected to. NX_CLOUD_* stays: that one is an account. */
export const isSystemVar = (name) =>
  name.startsWith("VERCEL_") || name.startsWith("TURBO_") || (name.startsWith("NX_") && !name.startsWith("NX_CLOUD_"));

/** A variable whose name says the project uses Stripe. */
export const isStripeVar = (name) => /^(NEXT_PUBLIC_)?STRIPE_/.test(name);

/**
 * The Stripe section of an inventory, when no Stripe key could be read.
 *
 * A project that has no Stripe is not a scan that failed. Without a key, the section used to
 * carry `error: "STRIPE_SECRET_KEY missing"` for EVERY project, and the skill reads an `error` as
 * "this scan could not run, tell the user": the two contradicted each other, and the reader
 * learned to pass over an `error`. The error stays only when the project references Stripe (one
 * of its variables, the package, or a webhook it declares): there, its webhooks could not be
 * listed, and the person must know.
 *
 * Changes `stripe` in place. Returns true when the section was turned into a "skipped" one.
 */
export function settleStripeWithoutKey(stripe, { hasStripeVar, dependencies, manifestKinds } = {}) {
  const usesStripe =
    hasStripeVar === true ||
    (Array.isArray(dependencies) && dependencies.includes("stripe")) ||
    (Array.isArray(manifestKinds) && manifestKinds.includes("stripe-webhook"));
  if (usesStripe) return false;
  delete stripe.error;
  stripe.found = false;
  stripe.webhooksFound = false;
  stripe.skipped = "project has no Stripe";
  return true;
}
