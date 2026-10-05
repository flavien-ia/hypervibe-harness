#!/usr/bin/env node
// test-render-region.mjs - Every Render service the harness has created runs in the EU.
//
// Published until 3.4.2: the two Blueprints the harness writes (the worker's, in
// _create-render-worker, and the agent's, templates/agent/render.yaml) named no region, and a
// Blueprint that names none gets Render's default, Oregon, in the USA (render.com/docs/blueprint-spec,
// read on 05/10/2026). A service never changes region afterwards. Each service of each Blueprint
// now says Frankfurt, and nothing else.
//
//   node scripts/tests/test-render-region.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Some skills are kept with Windows line endings: read as one form.
const text = (...parts) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${String(detail).slice(0, 200)})` : ""}`);
}

/** The services of a Blueprint: each `- type:` entry under `services:`, with its own lines. */
function services(yaml) {
  const body = yaml.slice(yaml.indexOf("services:"));
  return body
    .split(/\n(?=\s*- type:)/)
    .filter((part) => /^\s*- type:/.test(part))
    .map((part) => ({ type: /- type:\s*(\S+)/.exec(part)?.[1] ?? null, regions: [...part.matchAll(/^\s*region:\s*(\S+)/gm)].map((m) => m[1]) }));
}

const blueprints = [];
{
  const skill = text("skills", "_create-render-worker", "SKILL.md");
  const m = /```yaml\n(services:[\s\S]*?)```/.exec(skill);
  blueprints.push({ name: "the worker's Blueprint (_create-render-worker)", yaml: m ? m[1] : null });
}
blueprints.push({ name: "the agent's Blueprint (templates/agent/render.yaml)", yaml: text("templates", "agent", "render.yaml") });

for (const b of blueprints) {
  check(`${b.name}: found`, typeof b.yaml === "string" && b.yaml.includes("services:"));
  const list = b.yaml ? services(b.yaml) : [];
  check(`${b.name}: declares a service`, list.length > 0, JSON.stringify(list));
  for (const s of list) {
    check(`${b.name}: its ${s.type} runs in Frankfurt, in the EU, and nowhere else`, s.regions.length === 1 && s.regions[0] === "frankfurt", JSON.stringify(s));
  }
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
