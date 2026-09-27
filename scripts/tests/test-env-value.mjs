#!/usr/bin/env node
// test-env-value.mjs - One value of the project's .env for a shell variable, and its prefix
// only for a check: never the value on screen where a skill only needs to know its kind.
//
//   node scripts/tests/test-env-value.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EV = join(ROOT, "scripts", "env-value.mjs");
const SECRET = "valeur-secrete-qui-ne-doit-jamais-sortir";

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${detail})`}`);
}

const dir = mkdtempSync(join(tmpdir(), "hv-env-value-"));
writeFileSync(join(dir, ".env"), `STRIPE_SECRET_KEY=sk_test_${SECRET}\nQUOTED="avec des espaces"\n`);
writeFileSync(join(dir, ".env.stripe-live"), `STRIPE_SECRET_KEY_LIVE=sk_live_${SECRET}\n`);
const run = (...args) => spawnSync(process.execPath, [EV, "--project-dir", dir, ...args], { encoding: "utf8" });

const plain = run("STRIPE_SECRET_KEY");
check("the value, whole, with no newline, for a shell variable", plain.status === 0 && plain.stdout === `sk_test_${SECRET}`);
check("quotes around a value are removed", run("QUOTED").stdout === "avec des espaces");
const file = run("--file", ".env.stripe-live", "STRIPE_SECRET_KEY_LIVE");
check("--file reads the file of its own, and only it", file.status === 0 && file.stdout === `sk_live_${SECRET}` && run("--file", ".env.stripe-live", "STRIPE_SECRET_KEY").status === 4);
const prefix = run("--prefix", "8", "STRIPE_SECRET_KEY");
check("--prefix shows the kind of key, never the key", prefix.stdout.trim() === "STRIPE_SECRET_KEY=sk_test_" && !prefix.stdout.includes(SECRET));
check("--prefix never shows more than 12 characters, whatever is asked", !run("--prefix", "999", "STRIPE_SECRET_KEY").stdout.includes(SECRET.slice(0, 6)));
check("an absent key: exit 4, nothing printed", run("ABSENTE").status === 4 && run("ABSENTE").stdout === "");
check("a file that is not .env.<name> is refused (no path elsewhere)", run("--file", "../secret.txt", "X").status === 1);
rmSync(dir, { recursive: true, force: true });

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
