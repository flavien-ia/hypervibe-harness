// services.mjs - What the privacy audit knows about the services a project can be connected
// to, and the signs that betray each of them. Read by scripts/rgpd-audit.mjs.
//
// Four lists, one purpose: no third party that receives personal data may be missing from the
// privacy policy, including the ones nobody thought of when the plugin was written.
//
// - SERVICES: the services of the catalogue (scripts/update-privacy-policy.mjs, same keys),
//   with their signs. A service is detected when ANY of its signs is present in the project;
//   `all` adds a combination where EVERY group must match. Their variables and hosts also
//   "explain" what the audit sees, so a known service never shows up as unknown.
// - SDKS: packages of services the catalogue does not document. Finding one does not decide
//   anything: the audit reports it by name, "to identify", and the person decides with Claude.
// - LOCAL_VARS / LOCAL_VAR_PATTERNS: the project's own settings, which point at no third party.
// - NOT_PROCESSORS: hosts a project reaches without handing them anyone's personal data.
//
// A registry entry added for one project (update-privacy-policy.mjs --entry) carries its own
// signs in `detect`, in the same shape as SERVICES: the next audit recognises it.

/** @typedef {{ deps?: string[], depPrefixes?: string[], env?: string[], envPrefixes?: string[], hosts?: string[], code?: string[], files?: string[] }} Signs */

// `alsoEnv`: variables a service uses without being enough to detect it on their own (an
// account id shared with the provider's other products). They are explained once it is detected.
/** @type {Array<{ key: string, label: string, always?: string, all?: Signs[], alsoEnv?: string[] } & Signs>} */
export const SERVICES = [
  { key: "vercel", label: "Vercel (hosting)", always: "The project is hosted on Vercel (the plugin's default host)", envPrefixes: ["VERCEL_"], hosts: ["vercel.app"] },
  {
    key: "neon",
    label: "Neon (database)",
    all: [{ deps: ["drizzle-orm"] }, { deps: ["@neondatabase/serverless", "postgres"] }],
    hosts: ["neon.tech"],
  },
  { key: "google-oauth", label: "Google sign-in", code: ["GoogleProvider", "next-auth/providers/google"], env: ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] },
  { key: "github-oauth", label: "GitHub sign-in", code: ["GitHubProvider", "next-auth/providers/github"], env: ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"] },
  {
    key: "stripe",
    label: "Stripe (payments)",
    deps: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
    env: ["STRIPE_SECRET_KEY"],
    envPrefixes: ["STRIPE_", "NEXT_PUBLIC_STRIPE_"],
    hosts: ["stripe.com"],
  },
  { key: "resend", label: "Resend (email)", deps: ["resend"], envPrefixes: ["RESEND_"], hosts: ["resend.com"] },
  { key: "brevo", label: "Brevo (email)", deps: ["@getbrevo/brevo", "@sendinblue/client"], envPrefixes: ["BREVO_"], hosts: ["brevo.com", "sendinblue.com"] },
  {
    key: "cloudflare-r2",
    label: "Cloudflare R2 (file storage)",
    all: [{ deps: ["@aws-sdk/client-s3"] }, { envPrefixes: ["R2_"] }],
    alsoEnv: ["CLOUDFLARE_ACCOUNT_ID"],
    hosts: ["r2.cloudflarestorage.com"],
  },
  { key: "vercel-analytics", label: "Vercel Web Analytics", deps: ["@vercel/analytics"], code: ["@vercel/analytics"] },
  { key: "vercel-speed-insights", label: "Vercel Speed Insights", deps: ["@vercel/speed-insights"], code: ["@vercel/speed-insights"] },
  {
    key: "google-analytics",
    label: "Google Analytics",
    env: ["NEXT_PUBLIC_GA_MEASUREMENT_ID", "NEXT_PUBLIC_GA_ID"],
    code: ["GoogleAnalytics"],
    hosts: ["googletagmanager.com", "google-analytics.com"],
  },
  { key: "openrouter", label: "OpenRouter (AI models)", env: ["OPENROUTER_API_KEY"], deps: ["@openrouter/ai-sdk-provider"], hosts: ["openrouter.ai"] },
  { key: "anthropic", label: "Anthropic (AI models)", deps: ["@anthropic-ai/sdk"], code: ["@anthropic-ai/sdk"], env: ["ANTHROPIC_API_KEY"], hosts: ["anthropic.com"] },
  { key: "openfreemap", label: "OpenFreeMap (map tiles)", deps: ["maplibre-gl"], code: ["maplibre-gl"], hosts: ["openfreemap.org"] },
  { key: "web-push", label: "Browser push services", deps: ["web-push"], code: ["web-push"], envPrefixes: ["VAPID_", "NEXT_PUBLIC_VAPID_"] },
  { key: "render", label: "Render (background services)", files: ["render.yaml"], envPrefixes: ["RENDER_"] },
  {
    key: "sentry",
    label: "Sentry (error monitoring)",
    depPrefixes: ["@sentry/"],
    envPrefixes: ["SENTRY_", "NEXT_PUBLIC_SENTRY_"],
    code: ["withSentryConfig"],
    files: ["sentry.client.config.ts", "sentry.server.config.ts", "sentry.edge.config.ts", "sentry.client.config.js", "sentry.server.config.js", "sentry.edge.config.js"],
    hosts: ["sentry.io"],
  },
  {
    key: "upstash",
    label: "Upstash (Redis)",
    depPrefixes: ["@upstash/"],
    deps: ["@vercel/kv"],
    envPrefixes: ["UPSTASH_", "KV_REST_API_"],
    env: ["KV_URL"],
    hosts: ["upstash.io"],
  },
];

/** Packages of services the catalogue does not document yet: exact names, then prefixes. */
export const SDKS = {
  exact: {
    openai: "OpenAI",
    "@mistralai/mistralai": "Mistral AI",
    "groq-sdk": "Groq",
    "cohere-ai": "Cohere",
    replicate: "Replicate",
    "@elevenlabs/elevenlabs-js": "ElevenLabs",
    elevenlabs: "ElevenLabs",
    "posthog-js": "PostHog",
    "posthog-node": "PostHog",
    "mixpanel-browser": "Mixpanel",
    mixpanel: "Mixpanel",
    "mapbox-gl": "Mapbox",
    algoliasearch: "Algolia",
    twilio: "Twilio",
    postmark: "Postmark",
    "mailgun.js": "Mailgun",
    nodemailer: "an SMTP mail server (which provider?)",
    pusher: "Pusher",
    "pusher-js": "Pusher",
    ably: "Ably",
    uploadthing: "UploadThing",
    cloudinary: "Cloudinary",
    firebase: "Google Firebase",
    "firebase-admin": "Google Firebase",
    googleapis: "Google APIs",
    airtable: "Airtable",
    contentful: "Contentful",
    auth0: "Auth0",
    "react-google-recaptcha": "Google reCAPTCHA",
    "@marsidev/react-turnstile": "Cloudflare Turnstile",
    "@vercel/blob": "Vercel Blob (file storage)",
    "@vercel/postgres": "Vercel Postgres",
    "@vercel/edge-config": "Vercel Edge Config",
    "@react-google-maps/api": "Google Maps",
    "@notionhq/client": "Notion",
    "@calcom/embed-react": "Cal.com",
  },
  prefixes: {
    "@ai-sdk/": "an AI model provider (the package name says which)",
    "@langchain/": "LangChain (and the providers it calls)",
    "@supabase/": "Supabase",
    "@firebase/": "Google Firebase",
    "@google-cloud/": "Google Cloud",
    "@googlemaps/": "Google Maps",
    "@aws-sdk/": "Amazon Web Services",
    "@azure/": "Microsoft Azure",
    "@clerk/": "Clerk",
    "@auth0/": "Auth0",
    "@datadog/": "Datadog",
    "@axiomhq/": "Axiom",
    "@logtail/": "Better Stack",
    "@highlight-run/": "Highlight",
    "@amplitude/": "Amplitude",
    "@segment/": "Segment",
    "@growthbook/": "GrowthBook",
    "@intercom/": "Intercom",
    "@liveblocks/": "Liveblocks",
    "@mux/": "Mux",
    "@uploadthing/": "UploadThing",
    "@cloudinary/": "Cloudinary",
    "@sendgrid/": "SendGrid",
    "@mailchimp/": "Mailchimp",
    "@slack/": "Slack",
    "@pinecone-database/": "Pinecone",
    "@algolia/": "Algolia",
    "@hubspot/": "HubSpot",
    "@sanity/": "Sanity",
    "@prismicio/": "Prismic",
    "@storyblok/": "Storyblok",
    "@shopify/": "Shopify",
    "@paypal/": "PayPal",
    "@lemonsqueezy/": "Lemon Squeezy",
    "@polar-sh/": "Polar",
    "@hcaptcha/": "hCaptcha",
  },
};

/** The project's own settings: they point at no third party. */
export const LOCAL_VARS = new Set([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DIRECT_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "AUTH_TRUST_HOST",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_BASE_URL",
  "CRON_SECRET",
  "SKIP_ENV_VALIDATION",
  "NODE_ENV",
  "PORT",
]);
export const LOCAL_VAR_PATTERNS = [/^ADMIN_/, /_HASH(_[A-Z]+)?$/, /^NEXT_PUBLIC_(SITE|APP|BASE)_/];

/** A variable name that looks like the key, secret or address of a remote service. */
export const SERVICE_VAR = /(_API_KEY|_KEY|_TOKEN|_SECRET|_DSN|_URL|_URI|_ENDPOINT|_HOST|_CLIENT_ID|_APP_ID|_PROJECT_ID|_ACCOUNT_ID|_WEBHOOK[A-Z_]*)$/;

/** Hosts reached without anyone's personal data, with the reason the audit gives. */
export const NOT_PROCESSORS = [
  { host: "picsum.photos", reason: "placeholder images, fetched by the server's image optimiser: no visitor data (replace them before going live)" },
  { host: "images.unsplash.com", reason: "placeholder images, fetched by the server's image optimiser: no visitor data (replace them before going live)" },
];

/** Hosts that are never a third party: the machine itself, examples, and the web's own standards. */
export const NEVER_THIRD_PARTY = [/^localhost$/, /^127\./, /^0\.0\.0\.0$/, /(^|\.)example\.(com|org|net)$/, /(^|\.)schema\.org$/, /(^|\.)w3\.org$/, /(^|\.)json-schema\.org$/];

// ─── Matching ────────────────────────────────────────────────────────────────

const hostMatches = (host, wanted) => host === wanted || host.endsWith(`.${wanted}`);

/**
 * The first sign of `signs` found in the project facts, as a readable piece of evidence, or null.
 * facts = { deps: Set, env: Set, code: Set (patterns found), hosts: Set, files: Set }.
 */
export function firstSign(signs, facts) {
  for (const d of signs.deps ?? []) if (facts.deps.has(d)) return `package ${d}`;
  for (const p of signs.depPrefixes ?? []) {
    const d = [...facts.deps].find((x) => x.startsWith(p));
    if (d) return `package ${d}`;
  }
  for (const v of signs.env ?? []) if (facts.env.has(v)) return `variable ${v}`;
  for (const p of signs.envPrefixes ?? []) {
    const v = [...facts.env].find((x) => x.startsWith(p));
    if (v) return `variable ${v}`;
  }
  for (const c of signs.code ?? []) if (facts.code.has(c)) return `code mentions ${c}`;
  for (const f of signs.files ?? []) if (facts.files.has(f)) return `file ${f}`;
  for (const h of signs.hosts ?? []) {
    const found = [...facts.hosts].find((x) => hostMatches(x, h));
    if (found) return `code calls ${found}`;
  }
  return null;
}

/** Detected, with its evidence, or null. `always` wins; `all` needs every group. */
export function detect(service, facts) {
  if (service.always) return service.always;
  if (service.all) {
    const parts = service.all.map((g) => firstSign(g, facts));
    if (parts.every(Boolean)) return parts.join(" + ");
  }
  return firstSign(service, facts);
}

/**
 * Does this variable belong to one of these services? Its plain signs always count. The
 * variables of a combination (`all`), and the ones it merely uses without being enough to
 * detect it (`alsoEnv`), count when that service was detected.
 */
export function explainsVar(services, name, detectedKeys = new Set()) {
  const inSigns = (g) => (g.env ?? []).includes(name) || (g.envPrefixes ?? []).some((p) => name.startsWith(p));
  return services.some(
    (s) => inSigns(s) || (detectedKeys.has(s.key) && ((s.all ?? []).some(inSigns) || (s.alsoEnv ?? []).includes(name))),
  );
}

/** Does this host belong to one of these services? */
export function explainsHost(services, host) {
  return services.some((s) => (s.hosts ?? []).some((h) => hostMatches(host, h)));
}

/**
 * Does this package belong to one of these services? A plain sign always counts; a sign that is
 * only part of a combination counts when that service was detected (an S3 client without a
 * storage provider's settings talks to AWS, not to that provider).
 */
export function explainsDep(services, name, detectedKeys = new Set()) {
  return services.some(
    (s) =>
      (s.deps ?? []).includes(name) ||
      (s.depPrefixes ?? []).some((p) => name.startsWith(p)) ||
      (detectedKeys.has(s.key) && (s.all ?? []).some((g) => (g.deps ?? []).includes(name))),
  );
}

/** The service a package belongs to, when SDKS knows it, or null. */
export function sdkOf(name) {
  if (SDKS.exact[name]) return SDKS.exact[name];
  const prefix = Object.keys(SDKS.prefixes).find((p) => name.startsWith(p));
  return prefix ? SDKS.prefixes[prefix] : null;
}

export const isLocalVar = (name) => LOCAL_VARS.has(name) || LOCAL_VAR_PATTERNS.some((re) => re.test(name));
export const isNeverThirdParty = (host) => NEVER_THIRD_PARTY.some((re) => re.test(host));
export const notProcessor = (host) => NOT_PROCESSORS.find((n) => hostMatches(host, n.host)) ?? null;

// ─── Hosts in the code ───────────────────────────────────────────────────────

const URL_IN_CODE = /https?:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/gi;

/** The text of a source file without its comments (a `//` after a colon is a URL, not a comment). */
export function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * The hosts a piece of code reaches. A plain link is not a contact: an `href` (outside a
 * `<link>` tag, which the browser does load) and a JSON-LD `sameAs` only point somewhere.
 */
export function hostsInCode(text) {
  const clean = withoutComments(text);
  const found = new Set();
  for (const m of clean.matchAll(URL_IN_CODE)) {
    const before = clean.slice(Math.max(0, m.index - 80), m.index);
    const lastTag = before.lastIndexOf("<");
    const tag = lastTag >= 0 ? before.slice(lastTag) : "";
    const link = /\bhref\s*[=:]\s*\{?\s*["'`]?$/.test(before) && !/^<link\b/i.test(tag);
    const sameAs = /sameAs\s*:\s*\[?[^\]]*$/.test(before) && !/[;{}]/.test(before.slice(before.lastIndexOf("sameAs")));
    if (link || sameAs) continue;
    found.add(m[1].toLowerCase());
  }
  return found;
}
