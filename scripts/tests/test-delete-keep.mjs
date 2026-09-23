#!/usr/bin/env node
// test-delete-keep.mjs - /delete-project never ships one person's accounts, and still keeps them.
//
// Until September 2026 templates/delete-project/third-party-services.json carried one person's
// own accounts (the ones they share between their projects, not to be deleted): shipped to every
// user of an open-source plugin. They now live on the person's machine, in
// ~/.hypervibe/delete-project-keep.json, read by scripts/delete-project/_keep-rules.mjs.
// This recette holds both halves, and that the variables the plugin sets itself are known.
//
//   node scripts/tests/test-delete-keep.mjs

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { keepRules } = await import(pathToFileURL(join(ROOT, "scripts", "delete-project", "_keep-rules.mjs")).href);

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

const services = JSON.parse(readFileSync(join(ROOT, "templates/delete-project/third-party-services.json"), "utf8")).services;
const personal = services.filter((s) => /OPUSCLIP|PENNYLANE|WIKIDATA|BLUESKY|HOSTINGER|ZOOM_|SHOPIFY_/.test(s.pattern) || /personnel/i.test(s.service));
check("the plugin ships nobody's personal accounts", personal.length === 0, personal.map((s) => s.pattern).join(" | "));
check("every generic entry still has a pattern that compiles", services.every((s) => { try { new RegExp(s.pattern); return true; } catch { return false; } }));

const dir = mkdtempSync(join(tmpdir(), "hv-keep-"));
const file = join(dir, "delete-project-keep.json");
check("no file on the machine: nothing is kept", keepRules(file).length === 0);
writeFileSync(file, "{ not json");
check("an unreadable file keeps nothing, and does not crash", keepRules(file).length === 0);
writeFileSync(file, JSON.stringify({ keep: [{ pattern: "^MYCRM_", label: "My CRM, shared" }, { pattern: "([" }, { label: "no pattern" }] }));
const rules = keepRules(file);
check("a rule on the machine becomes a keep entry", rules.length === 1 && rules[0].pattern === "^MYCRM_" && rules[0].actionUrl === null, JSON.stringify(rules));
check("its label is the person's", rules[0]?.label === "My CRM, shared");
check("a pattern that does not compile keeps nothing rather than everything", !rules.some((r) => r.pattern === "(["));
rmSync(dir, { recursive: true, force: true });

const discover = readFileSync(join(ROOT, "scripts/delete-project/discover-resources.mjs"), "utf8");
check("the discovery reads the machine's rules, before the generic ones", /import \{ keepRules \} from "\.\/_keep-rules\.mjs"/.test(discover) && /\[\.\.\.keepRules\(\), \.\.\.JSON\.parse/.test(discover));

const known = JSON.parse(readFileSync(join(ROOT, "templates/delete-project/known-env-vars.json"), "utf8")).vars;
for (const v of ["OPENROUTER_API_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
  check(`${v}, set by the plugin itself, is known`, known.includes(v));
}

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
