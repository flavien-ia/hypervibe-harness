#!/usr/bin/env node
// test-stripe-local-test.mjs - A local payment test is run by Claude, never typed by the person.
//
// Until 3.4.9, /add-stripe ended by asking the person to open a separate terminal and type
// `stripe listen ...` in parallel with `pnpm dev`, and wrote the same into the project's
// CLAUDE.md: a command to type, for people the harness promises never to hand one. Claude now
// checks that a test price answers, starts both in the background, gives the links and the test
// card once, and never fabricates a paid session. This recette holds the texts that say so (the
// skill, its documentation, /bootstrap's closing words), and plays the masking of the listener's
// signing secret when `awk` is on the machine.
//
//   node scripts/tests/test-stripe-local-test.mjs

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${String(detail).slice(0, 300)})` : ""}`);
}

const SKILL = join(ROOT, "skills", "add-stripe", "SKILL.md");
if (!existsSync(SKILL)) {
  console.log("skip this harness has no /add-stripe");
  console.log("\n0/0 verifications");
  process.exit(0);
}
const skill = readFileSync(SKILL, "utf8");
const LISTEN = "stripe listen <STRIPE_PROFILE> --forward-to localhost:3000/api/webhooks/stripe";
const MASKED = `${LISTEN} 2>&1 | awk '{ gsub(/whsec_[A-Za-z0-9]+/, "whsec_***"); print; fflush() }'`;

// The procedure: from its heading to the next one of the same level.
const start = skill.search(/^## (?:Local payment test|Test de paiement en local)\b/m);
const procedure = start < 0 ? "" : skill.slice(start, skill.indexOf("\n## ", start + 3) > 0 ? skill.indexOf("\n## ", start + 3) : undefined);
check("the skill has the local payment test Claude runs", procedure.length > 500, `start ${start}`);
check("... a test price is checked first, active and not live", procedure.includes("stripe prices retrieve <price_id> <STRIPE_PROFILE>") && procedure.includes('"livemode": false'));
check("... both are started in the background, the dev server and the listener", /run_in_background/.test(procedure) && procedure.includes("`pnpm dev`") && procedure.includes(MASKED));
check("... the listener's signing secret is masked in its output", procedure.includes('gsub(/whsec_[A-Za-z0-9]+/, "whsec_***")'));
check("... the links to the return pages are given", procedure.includes("http://localhost:3000/payment/success") && procedure.includes("http://localhost:3000/payment/cancel"));
check("... the test card once", (procedure.match(/4242 4242 4242 4242/g) ?? []).length === 1, (procedure.match(/4242 4242 4242 4242/g) ?? []).length);
check("... and never a paid session made up", /never fabricate|ne jamais fabriquer/i.test(procedure));
check("... nothing for the person to type", /types no command and opens no terminal|ne tape aucune commande et n'ouvre aucun terminal/.test(procedure));

const summaryStart = skill.indexOf("## Step 12 - Summary");
const summary = summaryStart < 0 ? "" : skill.slice(summaryStart, start > summaryStart ? start : undefined);
check("the summary offers the test instead of a command", summary.length > 0 && !summary.includes("stripe listen") && /let's test a payment|on teste un paiement/.test(summary));
check("... and gives the card at the test only", summary.length > 0 && !/4242/.test(summary));

const line = skill.split("\n").find((l) => /\*\*(?:Testing payments locally|Tester les paiements en local)\*\* \((?:for Claude|pour Claude)\)/.test(l)) ?? "";
check("the line written into the project's CLAUDE.md is addressed to Claude", line.includes(LISTEN) && /background|arrière-plan/.test(line) && line.includes("4242 4242 4242 4242"), line);

const TERMINAL = /separate terminal|another terminal|second terminal|terminal séparé|autre terminal|seconde fenêtre de terminal/i;
for (const rel of ["skills/add-stripe/SKILL.md", "skills/add-stripe/DOC.md", "skills/add-stripe/DOC.fr.md", "skills/bootstrap/SKILL.md"]) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const said = text.split("\n").filter((l) => TERMINAL.test(l));
  check(`${rel} never asks the person to open a terminal`, said.length === 0, said.join(" | "));
}

// The masking, played when awk is on the machine: the exact program the skill writes.
const program = MASKED.slice(MASKED.indexOf("awk '") + 5, -1);
const awk = spawnSync("awk", [program], { input: "> Ready! You are using Stripe API Version [2025-09-30]. Your webhook signing secret is whsec_0a1B2c3D4e5F6g7H8 (^C to quit)\n--> checkout.session.completed [evt_1]\n", encoding: "utf8", windowsHide: true });
if (awk.error || awk.status !== 0) {
  console.log("skip awk is not on this machine: the masking was not played");
} else {
  check("the listener's output, through the skill's awk: the secret is masked, the rest kept", !awk.stdout.includes("whsec_0a1B2c3D4e5F6g7H8") && awk.stdout.includes("whsec_***") && awk.stdout.includes("Ready!") && awk.stdout.includes("checkout.session.completed"), awk.stdout);
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) process.exit(1);
