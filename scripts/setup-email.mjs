#!/usr/bin/env node
// setup-email.mjs - Deterministic core for /add-email (Resend OR Brevo).
//
// Both providers share the same overall flow (install SDK, write mail.ts, write
// contact tRPC router, register in root.ts, push env vars). Only the SDK names,
// escape function name, sendMail signature, and env vars differ. We unify them
// here behind a --provider flag so a single script handles both plugins.
//
// MONOREPO is NOT supported in this v1 - Claude is expected to handle that case
// manually following the SKILL.md.
//
// Usage:
//   Resend:
//     node setup-email.mjs --provider resend --name <project-name> [--web-dir .]
//
//   Brevo:
//     node setup-email.mjs --provider brevo --name <project-name> \
//       --brevo-sender <verified-email> [--brevo-sender-name <name>] [--web-dir .]
//
// Args:
//   --provider <resend|brevo>     required
//   --name <project-name>         required (used for Resend API key naming + Brevo sender name default)
//   --web-dir <path>              default: cwd
//   --brevo-sender <email>        required if --provider brevo (must be verified in Brevo dashboard)
//   --brevo-sender-name <name>    optional, default = project-name
//
// Prerequisites assumed by the script:
//   - Resend: the `resend` CLI is installed AND logged in (Claude validates this in SKILL Step 1).
//   - Brevo: the BREVO_API_KEY env var is set (Claude validates this in SKILL Step 1).
//   - The project has a working T3 scaffold (Next.js + tRPC + setup-security from /bootstrap,
//     because the contact router uses rateLimitedProcedure).
//
// stdout layout:
//   - Live logs: ▸ <step>, ✅ <result>, ⚠️ <warning>
//   - Handoff banner at the end (success OR failure)
//   - Last line on success: a single JSON object Claude can parse:
//       {"success": true, "provider": "resend|brevo", "envVars": [...keys pushed...]}
//
// Exit codes:
//   0 = success
//   1 = preflight failed (bad args, missing env, in monorepo)
//   2 = a step failed mid-pipeline; partial state on disk; handoff banner explains

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./_render.mjs";
import { readUserEnv } from "./_read-user-env.mjs";
import { getSecret } from "./vault/vault.mjs";

import { ensureToolsInPath } from "./_ensure-tools-path.mjs";

// Prepend common CLI install dirs to process.env.PATH so subprocess invocations
// (pnpm, gh, vercel, git, node) find their binaries even if Claude Code
// inherited a stale PATH (typical when tools were just installed via /start).
ensureToolsInPath();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let provider = "";
let name = "";
let webDir = ".";
let brevoSender = "";
let brevoSenderName = "";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--provider" && args[i + 1]) provider = args[++i];
  else if (a === "--name" && args[i + 1]) name = args[++i];
  else if (a === "--web-dir" && args[i + 1]) webDir = args[++i];
  else if (a === "--brevo-sender" && args[i + 1]) brevoSender = args[++i];
  else if (a === "--brevo-sender-name" && args[i + 1]) brevoSenderName = args[++i];
  else fail(`Unknown arg: ${a}`);
}

if (!provider || !["resend", "brevo"].includes(provider)) {
  fail("Usage: --provider <resend|brevo> is required");
}
if (!name) fail("--name <project-name> is required");
if (!/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(name)) {
  fail(`--name must be kebab-case (lowercase a-z, 0-9, -), 2-50 chars. Got: ${name}`);
}
if (provider === "brevo") {
  if (!brevoSender) fail("--brevo-sender <email> is required when --provider brevo");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brevoSender)) {
    fail(`--brevo-sender must be a valid email. Got: ${brevoSender}`);
  }
  if (!brevoSenderName) brevoSenderName = name;
}

const WEB_DIR = resolve(process.cwd(), webDir);

// ─── helpers ──────────────────────────────────────────────────────────
const STEPS = [
  "preflight",
  "getApiKey",
  "installSdk",
  "writeMailTs",
  "writeContactRouter",
  "registerRouter",
  "pushEnvVars",
];
const completed = [];
const warnings = [];
let current = null;
const state = {
  provider,
  apiKey: null, // captured in getApiKey, never logged in plain text
  envVarsPushed: [],
};

async function step(stepName, fn) {
  current = stepName;
  await fn();
  completed.push(stepName);
  current = null;
}

function log(msg) {
  console.log(`\n▸ ${msg}`);
}
function ok(msg) {
  console.log(`  ✅ ${msg}`);
}
function warn(msg) {
  console.warn(`  ⚠️  ${msg}`);
  warnings.push(msg);
}

function dumpHandoff(success) {
  const remaining = STEPS.filter((s) => !completed.includes(s) && s !== current);
  console.log("\n────────────────────────────────────────────────────────");
  console.log(`setup-email handoff state (provider: ${provider})`);
  console.log("────────────────────────────────────────────────────────");
  console.log(`✅ Completed (${completed.length}/${STEPS.length}): ${completed.join(", ") || "none"}`);
  if (current) console.log(`❌ Failed at: ${current}`);
  if (remaining.length) console.log(`⏸  Not attempted: ${remaining.join(", ")}`);
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s) during the run:`);
    for (const w of warnings) console.log(`   - ${w}`);
  }
  if (!success) {
    console.log(
      "\nFor the agent picking this up:\n" +
        `  - Web dir: ${WEB_DIR}\n` +
        "  - Each step in this script maps 1:1 to a section of add-email SKILL.md.\n",
    );
  }
  console.log("────────────────────────────────────────────────────────");
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  if (completed.length || current) dumpHandoff(false);
  process.exit(completed.length || current ? 2 : 1);
}

process.on("uncaughtException", (e) => {
  console.error(`\n❌ Unhandled exception: ${e.message}`);
  if (e.stack) console.error(e.stack);
  dumpHandoff(false);
  process.exit(2);
});

function run(cmd, cwd, opts = {}) {
  const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : cmd;
  const res = spawnSync(cmdStr, {
    cwd,
    stdio: opts.capture ? "pipe" : "inherit",
    shell: true,
    encoding: "utf8",
  });
  if (res.status !== 0 && !opts.allowFail) {
    if (opts.capture) {
      if (res.stdout) process.stderr.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
    }
    fail(`Command failed (exit ${res.status}): ${cmdStr}`);
  }
  return res;
}

function capture(cmd, cwd) {
  return run(cmd, cwd, { capture: true, allowFail: true });
}

// ─── Step 1: preflight ────────────────────────────────────────────────
async function preflight() {
  log("Preflight");

  const pkgPath = join(WEB_DIR, "package.json");
  if (!existsSync(pkgPath)) {
    fail(`No package.json at ${WEB_DIR}. Pass --web-dir <path-to-nextjs-app> if needed.`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.next) fail(`${WEB_DIR} doesn't depend on Next.js - add-email requires a Next.js project.`);
  if (!deps["@trpc/server"]) {
    fail(`${WEB_DIR} doesn't depend on @trpc/server - the contact router requires tRPC.`);
  }

  // Check rateLimitedProcedure exists (created by setup-security.mjs in bootstrap).
  // Without it, the contact router won't compile.
  const trpcPath = join(WEB_DIR, "src/server/api/trpc.ts");
  if (existsSync(trpcPath)) {
    const trpcContent = readFileSync(trpcPath, "utf8");
    if (!trpcContent.includes("rateLimitedProcedure")) {
      warn(
        "rateLimitedProcedure not found in src/server/api/trpc.ts. The contact router uses it " +
          "for rate limiting. Either run /bootstrap (which calls setup-security.mjs to add it), " +
          "or expect a TS build error after this script and fall back to publicProcedure manually.",
      );
    }
  } else {
    warn(`${trpcPath} not found - T3 may have moved tRPC config. Verify the contact router compiles.`);
  }

  // Block accidental overwrites: refuse if mail.ts or contact router already exists.
  // Re-config flow is handled by Claude in SKILL Step 0 - by the time we're here, this
  // should be a fresh install.
  const mailPath = join(WEB_DIR, "src/server/mail.ts");
  if (existsSync(mailPath)) {
    fail(
      `${mailPath} already exists. If you meant to re-configure email, use the /add-email ` +
        "re-configuration menu (Step 0 of the SKILL). To force a fresh install, delete the " +
        "file manually first.",
    );
  }
  const contactRouterPath = join(WEB_DIR, "src/server/api/routers/contact.ts");
  if (existsSync(contactRouterPath)) {
    fail(
      `${contactRouterPath} already exists. If you meant to re-configure email, use the ` +
        "/add-email re-configuration menu. To force a fresh install, delete the file manually first.",
    );
  }

  // pnpm available?
  const pnpm = capture("pnpm --version", WEB_DIR);
  if (pnpm.status !== 0) fail("pnpm CLI is missing or broken.");

  ok(`Web dir OK: ${WEB_DIR}`);
}

// ─── Step 2: get API key ──────────────────────────────────────────────
async function getApiKey() {
  // Source of truth = the Bitwarden vault. Item RESEND / BREVO, field "api_key".
  // The SKILL (add-email) ensures the vault is unlocked AND the key present (via the
  // _get-secret pattern: auto-unlock + auto-add) BEFORE calling this script - so a
  // non-interactive read here normally succeeds. Legacy env var kept as a fallback
  // during the migration period.
  const item = provider === "resend" ? "RESEND" : "BREVO";
  const service = provider === "resend" ? "Resend" : "Brevo";
  const envVar = provider === "resend" ? "RESEND_API_KEY" : "BREVO_API_KEY";
  const dashboard = provider === "resend"
    ? "https://resend.com/api-keys"
    : "https://app.brevo.com/settings/keys/api";

  // 1. Vault (canonical).
  log(`Reading ${item}.api_key from the vault`);
  try {
    state.apiKey = getSecret(item, "api_key");
    ok(`${item} API key read from vault`);
    return;
  } catch (e) {
    if (e.code === 2 || e.code === 3) {
      fail(
        `Vault locked / session expired. The skill must unlock it first:\n` +
          `  node scripts/vault/launch.mjs unlock\n` +
          `then re-run this script.`,
      );
    }
    // code 4 (item not in vault) or other → try the legacy env fallback below.
  }

  // 2. Legacy env-var fallback (migration period).
  const envKey = readUserEnv(envVar);
  if (envKey) {
    state.apiKey = envKey;
    warn(`${envVar} found in env (legacy) - consider migrating it to the vault (item ${item}).`);
    ok(`${envVar} found in env`);
    return;
  }

  // 3. Nothing → instruct to add the key to the vault.
  fail(
    `No ${service} API key available.\n` +
      `  1. Create a Full-Access key at ${dashboard}\n` +
      `  2. Store it in the vault (the value is typed in a separate window, never via Claude):\n` +
      `     node scripts/vault/launch.mjs add --name ${item} --service ${service} --fields "api_key:secret"\n` +
      `  3. Re-run this script.`,
  );
}

// ─── Step 3: install SDK ──────────────────────────────────────────────
async function installSdk() {
  if (provider === "resend") {
    log("Installing resend");
    run("pnpm add resend", WEB_DIR);
    ok("resend installed");
  } else {
    log("Installing @getbrevo/brevo");
    run("pnpm add @getbrevo/brevo", WEB_DIR);
    ok("@getbrevo/brevo installed");
  }
}

// ─── Step 4: write src/server/mail.ts ─────────────────────────────────
async function writeMailTs() {
  log("Writing src/server/mail.ts");
  const dest = join(WEB_DIR, "src/server/mail.ts");
  // Templates: templates/email/<provider>/mail.ts (no vars to substitute).
  writeFileSync(dest, render(`email/${provider}/mail.ts`, {}));
  ok(`${dest} written`);
}

// ─── Step 5: write contact tRPC router ────────────────────────────────
async function writeContactRouter() {
  log("Writing src/server/api/routers/contact.ts");
  const dest = join(WEB_DIR, "src/server/api/routers/contact.ts");
  // Templates: templates/email/<provider>/contact-router.ts (no vars).
  writeFileSync(dest, render(`email/${provider}/contact-router.ts`, {}));
  ok(`${dest} written`);
}

// ─── Step 6: register contactRouter in root.ts ────────────────────────
async function registerRouter() {
  log("Registering contactRouter in src/server/api/root.ts");
  const rootPath = join(WEB_DIR, "src/server/api/root.ts");
  if (!existsSync(rootPath)) {
    fail(`${rootPath} not found - T3 may have moved the appRouter. Register contactRouter manually.`);
  }
  let root = readFileSync(rootPath, "utf8");

  if (root.includes("contactRouter")) {
    ok("contactRouter already registered (no-op)");
    return;
  }

  const importLine = `import { contactRouter } from "~/server/api/routers/contact";\n`;
  const lastImport = root.match(/^((?:import[^;]+;[\r\n]+)+)/);
  if (lastImport) {
    root = root.replace(lastImport[0], lastImport[0] + importLine);
  } else {
    root = importLine + root;
  }

  // Inject `contact: contactRouter,` inside createTRPCRouter({ ... }).
  // We insert right after the opening brace, on a new line, with consistent indentation.
  const replaced = root.replace(
    /createTRPCRouter\(\s*\{/,
    `createTRPCRouter({\n  contact: contactRouter,`,
  );
  if (replaced === root) {
    fail(
      "Could not find createTRPCRouter({ ... }) in root.ts. " +
        "Register contactRouter manually: add `contact: contactRouter,` inside the router object.",
    );
  }
  writeFileSync(rootPath, replaced);
  ok("contactRouter registered");
}

// ─── Step 7: push env vars ────────────────────────────────────────────
async function pushEnvVars() {
  log("Pushing env vars to .env and Vercel");
  const helper = join(__dirname, "push-env-vars.mjs");
  if (!existsSync(helper)) fail(`Sibling script missing: ${helper}`);

  const kvs = [];
  if (provider === "resend") {
    kvs.push(`RESEND_API_KEY=${state.apiKey}`);
    // onboarding@resend.dev is Resend's official test sender - works immediately
    // but only sends to the account owner. SKILL Step 8 lets the user upgrade later.
    kvs.push(`RESEND_FROM_EMAIL=onboarding@resend.dev`);
    state.envVarsPushed = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"];
  } else {
    kvs.push(`BREVO_API_KEY=${state.apiKey}`);
    kvs.push(`BREVO_SENDER_EMAIL=${brevoSender}`);
    kvs.push(`BREVO_SENDER_NAME=${brevoSenderName}`);
    state.envVarsPushed = ["BREVO_API_KEY", "BREVO_SENDER_EMAIL", "BREVO_SENDER_NAME"];
  }

  const res = spawnSync("node", [helper, ...kvs], {
    cwd: WEB_DIR,
    stdio: "inherit",
    shell: false,
  });
  if (res.status !== 0) {
    fail(
      "push-env-vars.mjs failed. SDK is installed and code is in place, only the env vars didn't land. " +
        "Retry manually: `node " +
        helper +
        " '<KEY=VALUE>' [...]`",
    );
  }
  ok(`Env vars pushed: ${state.envVarsPushed.join(", ")}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────
await step("preflight", preflight);
await step("getApiKey", getApiKey);
await step("installSdk", installSdk);
await step("writeMailTs", writeMailTs);
await step("writeContactRouter", writeContactRouter);
await step("registerRouter", registerRouter);
await step("pushEnvVars", pushEnvVars);

dumpHandoff(true);

console.log(`
🎉 setup-email complete (${provider}).

   Provider:      ${provider}
   mail.ts:       src/server/mail.ts
   Contact route: src/server/api/routers/contact.ts (registered as \`contact\` in root.ts)
   Env vars:      ${state.envVarsPushed.join(", ")}

Next: Claude takes over for the CLAUDE.md update (via _update-claude-md), the optional
domain-config flow (Resend) or sender-verification reminder (Brevo), the optional
contact-page creation (via _create-contact-page), and the user-facing summary.
`);

// Last line: structured JSON for Claude to parse.
console.log(
  JSON.stringify({
    success: true,
    provider,
    envVars: state.envVarsPushed,
  }),
);
