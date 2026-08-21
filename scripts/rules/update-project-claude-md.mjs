#!/usr/bin/env node
// update-project-claude-md.mjs - Keep the Hypervibe rule block in a project's
// own CLAUDE.md in step with the plugin.
//
// These are the rules that only mean something inside a T3/Next/Neon project:
// typing, JSX, responsive, slugs, database reads, the pre-production audit.
// They used to live in the global block, which is read at the start of every
// session in every folder, including the ones that have nothing to do with a
// web app. Here they are loaded where the code they govern is.
//
// Second benefit: a project CLAUDE.md is versioned, so the rules travel with
// the repository to whoever clones it.
//
// The block is inserted under "## Conventions" when that section exists (the
// structure /bootstrap writes), at the end of the file otherwise. Free-form
// lines added by the add-* skills through _update-claude-md live OUTSIDE the
// block and are never touched.
//
// Usage:
//   node scripts/rules/update-project-claude-md.mjs [--dir <project>]
//                                                   [--with-neon] [--dry-run]
//
// stdout: one JSON line, same shape as the global script.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildRuleSets } from "./rules.mjs";
import { PROJECT_BLOCK } from "./blocks.mjs";
import { syncManagedBlock } from "./managed-block.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
const dirIdx = argv.indexOf("--dir");
const dir = resolve(dirIdx >= 0 ? argv[dirIdx + 1] : process.cwd());

/** The Neon rule is only true where a database is actually wired. Detected
 *  from the project itself so /bootstrap, /add-db and /update-hypervibe agree
 *  without passing the flag around. */
function neonWired() {
  if (args.has("--with-neon")) return true;
  try {
    const env = join(dir, ".env");
    if (existsSync(env) && /^DATABASE_URL=.*neon\.tech/m.test(readFileSync(env, "utf8"))) {
      return true;
    }
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8"));
      const deps = { ...json.dependencies, ...json.devDependencies };
      if (deps["@neondatabase/serverless"] || deps["drizzle-orm"]) return true;
    }
  } catch {
    // A malformed package.json is not this script's problem: no Neon rule.
  }
  return false;
}

const flags = new Set();
if (neonWired()) flags.add("--with-neon");

const file = join(dir, "CLAUDE.md");
const report = syncManagedBlock({
  file,
  ...PROJECT_BLOCK,
  ...buildRuleSets("project", flags),
  dryRun: args.has("--dry-run"),
});

console.log(JSON.stringify({ ...report, file }));
