// measure.mjs - How many bytes the global rule block costs.
//
// That block is read at the start of every session in every folder, whatever
// the user is doing there. It is the one part of the plugin whose cost is paid
// even when the plugin is not used, so it has a hard budget and a test that
// fails when the budget is exceeded. Anything that does not have to be true
// everywhere belongs to the project block or to a skill.
//
//   node scripts/rules/measure.mjs

import { tmpdir } from "node:os";
import { join } from "node:path";
import { GLOBAL_MAX_BYTES, buildRuleSets, CATALOG } from "./rules.mjs";
import { syncManagedBlock } from "./managed-block.mjs";
import { GLOBAL_BLOCK } from "./blocks.mjs";

// Worst case: every capability rule enabled.
const flags = new Set(CATALOG.map((r) => r.enabledBy).filter(Boolean));
const sets = buildRuleSets("global", flags);

const report = syncManagedBlock({
  file: join(tmpdir(), "hypervibe-measure-does-not-exist.md"),
  ...GLOBAL_BLOCK,
  ...sets,
  dryRun: true,
});

const pct = Math.round((report.bytes / GLOBAL_MAX_BYTES) * 100);
console.log(
  `global block: ${report.bytes} bytes / ${GLOBAL_MAX_BYTES} budget (${pct}%), ${sets.active.length} rules`,
);
for (const r of sets.active) {
  console.log(`  ${String(Buffer.byteLength(r.text, "utf8")).padStart(4)} B  ${r.id}`);
}
const project = buildRuleSets("project", flags);
const projectBytes = project.active.reduce(
  (n, r) => n + Buffer.byteLength(r.text, "utf8"),
  0,
);
console.log(`project block: ${projectBytes} bytes of rule text, ${project.active.length} rules (no budget: loaded only inside a project)`);

if (report.bytes > GLOBAL_MAX_BYTES) {
  console.error(
    `\nOver budget by ${report.bytes - GLOBAL_MAX_BYTES} bytes. Shorten a global rule, or move it to scope "project" / "skill".`,
  );
  process.exit(1);
}
