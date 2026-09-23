#!/usr/bin/env node
// review.mjs - The signals of /rgpd-audit that the person looked at and set aside, each with
// its reason: not a subprocessor (a build-time token, a public API that receives nobody's data,
// a link mistaken for a call). Kept in the project's .hypervibe/privacy-review.json, which
// travels with the repository, so the next audit does not ask again.
//
//   node review.mjs add --kind variable|package|host --value <v> --reason "<why>"
//   node review.mjs remove --kind <kind> --value <v>
//   node review.mjs list
//
// Runs from the project root. A reason is required: a signal set aside without one is a
// question hidden, not answered.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KINDS = ["variable", "package", "host"];
const FILE = join(process.cwd(), ".hypervibe", "privacy-review.json");

function fail(message, code = 2) {
  console.error(`[privacy-review] ${message}`);
  process.exit(code);
}

function load() {
  if (!existsSync(FILE)) return { version: 1, reviewed: [] };
  try {
    const data = JSON.parse(readFileSync(FILE, "utf8"));
    return { version: 1, reviewed: Array.isArray(data.reviewed) ? data.reviewed : [] };
  } catch (e) {
    return fail(`cannot read ${FILE}: ${e.message}`, 1);
  }
}

function save(data) {
  mkdirSync(join(process.cwd(), ".hypervibe"), { recursive: true });
  data.reviewed.sort((a, b) => `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`));
  writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

const [command, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1];
}

if (command === "list") {
  const { reviewed } = load();
  if (!reviewed.length) console.log("(nothing set aside)");
  for (const r of reviewed) console.log(`  ${r.kind.padEnd(8)} ${r.value}: ${r.reason} (${r.reviewedAt})`);
  process.exit(0);
}

if (command !== "add" && command !== "remove") {
  fail('usage: review.mjs add --kind variable|package|host --value <v> --reason "<why>" | remove --kind <k> --value <v> | list');
}
if (!KINDS.includes(flags.kind)) fail(`--kind must be one of: ${KINDS.join(", ")}`);
if (!flags.value || !flags.value.trim()) fail("--value is required");
const value = flags.value.trim();

const data = load();
const index = data.reviewed.findIndex((r) => r.kind === flags.kind && r.value === value);

if (command === "remove") {
  if (index < 0) {
    console.log(`skip      ${flags.kind} ${value} (not set aside)`);
    process.exit(0);
  }
  data.reviewed.splice(index, 1);
  save(data);
  console.log(`removed   ${flags.kind} ${value}: the next audit will ask again`);
  process.exit(0);
}

const reason = (flags.reason ?? "").trim();
if (reason.length < 10) fail("--reason is required, in a full sentence: why this is not a subprocessor");
const entry = { kind: flags.kind, value, reason, reviewedAt: new Date().toISOString().slice(0, 10) };
if (index >= 0) data.reviewed[index] = entry;
else data.reviewed.push(entry);
save(data);
console.log(`${index >= 0 ? "updated" : "set aside"} ${flags.kind} ${value}`);
