#!/usr/bin/env node
// update-global-claude-md.mjs - Keep the Hypervibe rule block in ~/.claude/CLAUDE.md
// in step with the plugin.
//
// The block lives between:
//   <!-- hypervibe:rules -->
//   ...
//   <!-- /hypervibe:rules -->
//
// What it does now (and did not before): a rule the user has NOT edited is
// updated, or removed, when the plugin says so. A rule the user HAS edited is
// theirs and is kept byte for byte. The mechanism is a fingerprint of the
// delivered text carried by each marker; see scripts/rules/managed-block.mjs.
//
// Before that, this script was additive only and ran at /start alone: a rule
// shipped with a mistake stayed wrong on every machine forever, and even new
// rules never reached anyone who had already run /start. It is now also called
// by /update-hypervibe.
//
// Usage:
//   node scripts/update-global-claude-md.mjs [--with-neon] [--with-gitleaks]
//                                            [--dry-run] [--home <dir>]
//
//   --with-neon      accepted for compatibility (the Neon rule moved to the
//                    project block, where a database actually exists)
//   --with-gitleaks  assert the global gitleaks hook is installed. When the
//                    flag is absent the script detects it, so /start and
//                    /update-hypervibe reach the same result.
//   --dry-run        report what would change, write nothing
//   --home <dir>     use <dir>/.claude/CLAUDE.md instead of the real home (tests)
//
// stdout: one JSON line
//   {"result":"created|upgraded|changed|no-change","added":[…],"updated":[…],
//    "retired":[…],"keptEdited":[…],"unknown":[…],"bytes":N,"file":"…"}

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildRuleSets } from "./rules/rules.mjs";
import { GLOBAL_BLOCK } from "./rules/blocks.mjs";
import { syncManagedBlock } from "./rules/managed-block.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
const homeIdx = argv.indexOf("--home");
const home = homeIdx >= 0 ? argv[homeIdx + 1] : homedir();

/** The gitleaks rule describes a hook that either exists on this machine or
 *  does not. Detecting it (instead of trusting a flag the caller may forget)
 *  keeps every caller consistent. */
function gitleaksInstalled() {
  try {
    const hook = join(home, ".git-hooks", "pre-commit");
    if (!existsSync(hook)) return false;
    const configured = execFileSync("git", ["config", "--global", "core.hooksPath"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!configured) return false;
    return configured.replace(/\\/g, "/").includes(".git-hooks");
  } catch {
    return false;
  }
}

const flags = new Set();
if (args.has("--with-neon")) flags.add("--with-neon");
if (args.has("--with-gitleaks") || gitleaksInstalled()) flags.add("--with-gitleaks");

const file = join(home, ".claude", "CLAUDE.md");
const report = syncManagedBlock({
  file,
  ...GLOBAL_BLOCK,
  ...buildRuleSets("global", flags),
  dryRun: args.has("--dry-run"),
});

console.log(JSON.stringify({ ...report, file }));
