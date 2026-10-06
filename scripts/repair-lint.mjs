#!/usr/bin/env node
// repair-lint.mjs - A project made by /bootstrap before 3.4.5, where `pnpm lint` stops on "ESLint
// couldn't find the plugin eslint-plugin-react-hooks": pnpm 10 and later no longer put ESLint's
// plugins at the project's root, where create-t3-app's configuration looks for them
// (PNPM_PUBLIC_HOIST in _pnpm-workspace.mjs). This puts them back, with the person's agreement:
//
//   node repair-lint.mjs --project-dir <dir>           what it would do; nothing is written
//   node repair-lint.mjs --project-dir <dir> --write   the block in pnpm-workspace.yaml, then a
//                                                      reinstall that lays node_modules out again
//
// One JSON line. `needed: false` when the project does not use Next's ESLint configuration, is not
// a pnpm project, or already has the block with the plugins reachable. With --write, the only file
// to commit is pnpm-workspace.yaml: the lockfile does not change (checked on 2026-10-05 with a
// frozen install under pnpm 10, Vercel's, and pnpm 11). The reinstall is a frozen one (CI): when
// the lockfile is not in step with package.json, it stops, and that is said, never forced.
// Exit 0, or 1 when a step failed (`step` says which).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { PNPM_PUBLIC_HOIST, readWorkspaceList, setWorkspaceBlock } from "./_pnpm-workspace.mjs";

const PLUGIN = "eslint-plugin-react-hooks";

/** The folders of the project that use Next's ESLint configuration: its root, or the apps of a
 *  monorepo made before rule 11 (apps/web). */
function nextEslintDirs(dir) {
  const uses = (d) => {
    try {
      const pkg = JSON.parse(readFileSync(join(d, "package.json"), "utf8"));
      return Boolean({ ...pkg.dependencies, ...pkg.devDependencies }["eslint-config-next"]);
    } catch {
      return false;
    }
  };
  const apps = join(dir, "apps");
  const inApps = existsSync(apps) ? readdirSync(apps).map((n) => join(apps, n)).filter(uses) : [];
  return [...(uses(dir) ? [dir] : []), ...inApps];
}

/** Whether ESLint's plugin resolves from that folder: true, false, or null without node_modules. */
function reachable(dir) {
  if (!existsSync(join(dir, "node_modules"))) return null;
  try {
    createRequire(join(dir, "package.json")).resolve(`${PLUGIN}/package.json`);
    return true;
  } catch {
    return false;
  }
}

export function diagnose(dir) {
  const ws = join(dir, "pnpm-workspace.yaml");
  if (!existsSync(join(dir, "package.json"))) return { needed: false, reason: "not-a-project" };
  if (!existsSync(join(dir, "pnpm-lock.yaml")) && !existsSync(ws)) return { needed: false, reason: "not-pnpm" };
  const dirs = nextEslintDirs(dir);
  if (!dirs.length) return { needed: false, reason: "no-next-eslint" };
  const list = readWorkspaceList(ws, "publicHoistPattern");
  const block = list !== null && PNPM_PUBLIC_HOIST.every((p) => list.includes(p)) ? "present" : "absent";
  const states = dirs.map(reachable);
  const reach = states.includes(false) ? false : states.includes(null) ? null : true;
  if (block === "present" && reach !== false) return { needed: false, reason: "already", block, reachable: reach };
  return { needed: true, block, reachable: reach, reason: block === "absent" ? "block-missing" : "reinstall-needed" };
}

export function repair(dir, { run = (cmd, cwd) => spawnSync(cmd, { cwd, shell: true, encoding: "utf8", env: { ...process.env, CI: "true" } }) } = {}) {
  const before = diagnose(dir);
  if (!before.needed) return { ...before, written: false, reinstalled: false };
  let written = false;
  if (before.block === "absent") {
    const list = readWorkspaceList(join(dir, "pnpm-workspace.yaml"), "publicHoistPattern") ?? [];
    written = setWorkspaceBlock(join(dir, "pnpm-workspace.yaml"), "publicHoistPattern", [...new Set([...list, ...PNPM_PUBLIC_HOIST])]);
  }
  if (!existsSync(join(dir, "node_modules"))) {
    return { needed: true, written, reinstalled: false, reachable: null, commit: written ? ["pnpm-workspace.yaml"] : [], note: "no node_modules here: the next pnpm install lays them out with the plugins at the root" };
  }
  const r = run("pnpm install", dir);
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400);
    return { ok: false, step: "install", written, reinstalled: false, commit: written ? ["pnpm-workspace.yaml"] : [], detail: tail };
  }
  const after = diagnose(dir);
  return { needed: true, written, reinstalled: true, reachable: after.reachable ?? null, repaired: !after.needed, commit: written ? ["pnpm-workspace.yaml"] : [] };
}

// ─── Launched as a script, or imported ────────────────────────────────────────
// Node gives a module its real path and keeps in argv[1] the path as it was typed. Compared as
// they come, the two differ as soon as the plugin is reached through a symbolic link (macOS's
// temporary folder, a ~/.claude kept by a configuration repository): the script then did
// nothing and exited 0, "I could not" read as "nothing to report" (outside review, 3.3.9).
// Both are read to their real path. The same block in every script, held by
// scripts/tests/test-entry-point.mjs.
import { realpathSync as realPathOf } from "node:fs";
import { fileURLToPath as pathOfUrl } from "node:url";
function launchedDirectly() {
  try {
    if (!process.argv[1]) return false;
    const self = realPathOf(pathOfUrl(import.meta.url));
    const launched = realPathOf(process.argv[1]);
    return process.platform === "win32" ? self.toLowerCase() === launched.toLowerCase() : self === launched;
  } catch {
    return false;
  }
}

if (launchedDirectly()) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--project-dir");
  const dir = resolve(i >= 0 && args[i + 1] ? args[i + 1] : process.cwd());
  const out = args.includes("--write") ? repair(dir) : diagnose(dir);
  console.log(JSON.stringify(out));
  process.exitCode = out.ok === false ? 1 : 0;
}
