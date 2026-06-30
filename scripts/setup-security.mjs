#!/usr/bin/env node
// Apply security hardening to a fresh T3 scaffold.
//
// Usage:
//   node setup-security.mjs          (from project root)
//
// What it does (all idempotent - safe to re-run):
//   1. Patches next.config.(js|mjs|ts) to add securityHeaders + poweredByHeader:false
//      + reactStrictMode:true + async headers() wiring.
//   2. Wraps the `[TRPC]` timing console.log in src/server/api/trpc.ts with
//      `if (t._config.isDev)` so timing info doesn't leak in production logs.
//   3. Creates src/lib/rate-limit.ts (in-memory rate limiter with auto-cleanup).
//   4. Appends `rateLimitedProcedure` to src/server/api/trpc.ts (with `checkRateLimit`
//      import) so other skills can use it for public routes that accept user input.
//
// The script does NOT add a Content-Security-Policy - CSP requires per-project tuning
// and misconfiguring it breaks Next.js hydration.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const actions = [];

// ─── 1. next.config ────────────────────────────────────────────────────
function patchNextConfig() {
  const candidates = ["next.config.ts", "next.config.mjs", "next.config.js"];
  const file = candidates.find((f) => existsSync(f));
  if (!file) {
    actions.push("⚠️  next.config.(ts|mjs|js) not found - skipping security headers patch");
    return;
  }

  const content = readFileSync(file, "utf8");

  if (content.includes("X-Content-Type-Options")) {
    actions.push(`✓ ${file}: already patched (securityHeaders present)`);
    return;
  }

  // Regenerate next.config with the expected T3 baseline + security headers.
  // Preserve T3's `import "./src/env.js"` (build-time env validation) so a later
  // standalone /security run does not silently drop it.
  const isTs = file.endsWith(".ts");
  const envImport = `import "./src/env.js";\n`;
  const header = isTs ? `${envImport}import type { NextConfig } from "next";\n\n` : `${envImport}\n`;
  const configAnnotation = isTs ? ": NextConfig" : "";

  const newContent = `${header}const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config${configAnnotation} = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
`;

  writeFileSync(file, newContent);
  actions.push(`✓ ${file}: wrote security headers + poweredByHeader:false + reactStrictMode:true`);
}

// ─── 2. trpc.ts : wrap console.log + add rateLimitedProcedure ──────────
function patchTrpcFile() {
  const file = "src/server/api/trpc.ts";
  if (!existsSync(file)) {
    actions.push(`⚠️  ${file} not found - skipping trpc patches`);
    return;
  }

  let content = readFileSync(file, "utf8");
  let changed = false;

  // 2a. Wrap the "[TRPC] ... took ...ms" console.log with isDev guard (idempotent)
  const alreadyWrapped = /if\s*\(\s*t\._config\.isDev\s*\)\s*\{\s*console\.log\(`\[TRPC\]/.test(
    content,
  );
  if (!alreadyWrapped) {
    // Pattern: a bare `console.log(\`[TRPC] ... took ...ms\`);` line with its leading whitespace
    const bare = /^([ \t]*)console\.log\((`\[TRPC\][^`]*`)\);/m;
    if (bare.test(content)) {
      content = content.replace(
        bare,
        (_, indent, tpl) =>
          `${indent}if (t._config.isDev) {\n${indent}  console.log(${tpl});\n${indent}}`,
      );
      changed = true;
      actions.push(`✓ ${file}: wrapped [TRPC] timing console.log with isDev guard`);
    } else {
      actions.push(`⚠️  ${file}: [TRPC] console.log pattern not found - leaving unchanged`);
    }
  } else {
    actions.push(`✓ ${file}: [TRPC] timing already guarded`);
  }

  // 2b. Add rateLimitedProcedure (idempotent)
  if (content.includes("rateLimitedProcedure")) {
    actions.push(`✓ ${file}: rateLimitedProcedure already present`);
  } else {
    // Ensure TRPCError is imported
    if (!/import\s*\{[^}]*TRPCError[^}]*\}\s*from\s*["']@trpc\/server["']/.test(content)) {
      if (/import\s*\{([^}]*)\}\s*from\s*["']@trpc\/server["']/.test(content)) {
        content = content.replace(
          /import\s*\{([^}]*)\}\s*from\s*["']@trpc\/server["']/,
          (_, inner) => {
            const trimmed = inner.trim();
            const sep = trimmed.endsWith(",") ? "" : ",";
            return `import { ${trimmed}${sep} TRPCError } from "@trpc/server"`;
          },
        );
      } else {
        // Prepend an import if @trpc/server isn't imported in any form (unlikely in T3 but safe)
        content = `import { TRPCError } from "@trpc/server";\n${content}`;
      }
    }

    // Add the checkRateLimit import
    if (!content.includes(`from "~/lib/rate-limit"`)) {
      const lastImportMatch = content.match(/^(?:import[^;]+;[\r\n]*)+/);
      const insertion = `import { checkRateLimit } from "~/lib/rate-limit";\n`;
      if (lastImportMatch) {
        content = content.replace(lastImportMatch[0], lastImportMatch[0] + insertion);
      } else {
        content = insertion + content;
      }
    }

    // Append the rateLimitedProcedure export at end of file
    const procedureBlock = `
export const rateLimitedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const ip = ctx.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, retryAfterMs } = checkRateLimit(ip);
  if (!allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: \`Trop de tentatives. Réessaie dans \${Math.ceil((retryAfterMs ?? 0) / 1000 / 60)} minutes.\`,
    });
  }
  return next();
});
`;
    content = content.trimEnd() + "\n" + procedureBlock;
    changed = true;
    actions.push(`✓ ${file}: added rateLimitedProcedure + imports`);
  }

  if (changed) writeFileSync(file, content);
}

// ─── 3. src/lib/rate-limit.ts ──────────────────────────────────────────
function writeRateLimitFile() {
  const file = "src/lib/rate-limit.ts";
  if (existsSync(file)) {
    actions.push(`✓ ${file}: already exists (not overwritten)`);
    return;
  }

  mkdirSync(dirname(file), { recursive: true });

  const content = `const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, { count: number; firstAttempt: number }>();

// Auto-cleanup expired entries every 5 minutes
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (now - value.firstAttempt > WINDOW_MS) attempts.delete(key);
  }
}, 5 * 60 * 1000);
cleanup.unref(); // Don't prevent serverless process from exiting

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterMs = WINDOW_MS - (now - entry.firstAttempt);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true };
}
`;

  writeFileSync(file, content);
  actions.push(`✓ ${file}: created`);
}

// ─── Run ───────────────────────────────────────────────────────────────
patchNextConfig();
writeRateLimitFile();
patchTrpcFile();

console.log("");
console.log("Security hardening:");
for (const a of actions) console.log(`  ${a}`);
console.log("");
console.log("✅ Security hardening applied.");
