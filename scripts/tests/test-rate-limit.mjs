#!/usr/bin/env node
// test-rate-limit.mjs - The rate limiter the plugin writes into projects, and its only upgrade.
//
// The in-memory limiter is a deliberate choice. Until 23/09/2026 nothing said so: each security
// audit took it for a flaw, and a participant's Claude twice added an external service for it
// (Upstash, through the Vercel marketplace). This recette holds what fixed that:
// - the three copies of the in-memory limiter (the template and the two scripts that write it
//   inline) carry the same code, and the header that says it is on purpose;
// - the shared counter keeps the same contract (same export, same limits), is asynchronous, and
//   talks to nothing but the project's own database;
// - /security says the limiter is not a finding, and points at templates that exist.
// Its behaviour was tried for real on PostgreSQL when it was written (five attempts pass, the
// sixth is refused, ten simultaneous calls let exactly five through); this recette, like every
// recette of the harness, needs no database and no network.
//
//   node scripts/tests/test-rate-limit.mjs

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const constant = (text, name) => text.match(new RegExp(`const ${name} = ([^;]+);`))?.[1]?.trim();

console.log("── The in-memory limiter: one code, three copies, said to be on purpose ──");
const inMemory = read("templates/2fa/rate-limit.ts").trimEnd();
check("the template says it is on purpose", inMemory.startsWith("// In-memory rate limiter, on purpose."));
check("the template names the shared counter as the way up", inMemory.includes('"Shared counter"'));
for (const script of ["scripts/setup-security.mjs", "scripts/setup-auth-users.mjs"]) {
  check(`${script} writes exactly the template`, read(script).includes(inMemory));
}

console.log("\n── The shared counter keeps the contract ──");
const shared = read("templates/security/rate-limit-shared.ts");
const snippet = read("templates/security/rate-limit-schema-snippet.ts");
check(
  "same export, now asynchronous",
  /export async function checkRateLimit\(ip: string\): Promise<\{ allowed: boolean; retryAfterMs\?: number \}>/.test(shared),
);
for (const name of ["WINDOW_MS", "MAX_ATTEMPTS"]) {
  const before = constant(inMemory, name);
  check(`same ${name} (${before})`, before !== undefined && constant(shared, name) === before, `${before} / ${constant(shared, name)}`);
}
const imports = [...shared.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
check(
  "it talks to nothing but the project's database",
  imports.length > 0 && imports.every((m) => ["drizzle-orm", "~/server/db", "~/server/db/schema"].includes(m)),
  imports.join(", "),
);
check("one atomic statement counts (insert, or update on conflict)", /\.onConflictDoUpdate\(/.test(shared) && /target: rateLimits\.key/.test(shared));
check("the table it uses is the one the snippet declares", /export const rateLimits = createTable\(\s*"rate_limit",/.test(snippet));
check("the sweep reads window_started_at through an index (outside review, 3.3.0)", /index\("rate_limit_window_idx"\)\.on\(table\.windowStartedAt\)/.test(snippet));

console.log("\n── /security says it, and points at what exists ──");
const skill = read("skills/security/SKILL.md");
const refs = [...skill.matchAll(/templates\/security\/[a-z-]+\.ts/g)].map((m) => m[0]);
check("the skill points at both templates", refs.includes("templates/security/rate-limit-shared.ts") && refs.includes("templates/security/rate-limit-schema-snippet.ts"), refs.join(", "));
check("every template it names exists", refs.length > 0 && refs.every((r) => existsSync(join(ROOT, r))), refs.join(", "));
check(
  "the audit marks the limiter as a deliberate choice, not a finding",
  /deliberate choice, not a finding|choix délibéré, pas une trouvaille/.test(skill),
);
check("the audit forbids adding a service for it on its own initiative", /Never add an external service|Ne jamais ajouter de service externe/.test(skill));

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
