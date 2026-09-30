#!/usr/bin/env node
// test-manifest-shared.mjs - A project's own registration on the shared clock is never recorded
// shared (manifest.mjs add, 3.3.9).
//
// Migrating eight projects, a user marked their scheduled tasks and backup targets `shared`,
// the clock that runs them being shared: the deletion of a project then left them in place, and
// the clock would have kept backing up a deleted database. The flag stays for what really is
// shared: the clock itself, and the backup of a database the manifest declares shared.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "..", "manifest", "manifest.mjs");

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const dirs = [];
function project() {
  const dir = mkdtempSync(join(tmpdir(), "hv-manifest-"));
  // The repository root: the manifest is looked for no higher, and written here.
  mkdirSync(join(dir, ".git"));
  dirs.push(dir);
  return dir;
}
function add(dir, ...args) {
  const r = spawnSync(process.execPath, [MANIFEST, "add", "--project-dir", dir, "--added-by", "recette", ...args], {
    encoding: "utf8",
  });
  const last = String(r.stdout || "").trim().split("\n").pop();
  try {
    return { code: r.status, ...JSON.parse(last) };
  } catch {
    return { code: r.status, ok: false, reason: `unreadable output: ${r.stdout}${r.stderr}` };
  }
}

try {
  {
    const dir = project();
    const r = add(dir, "--kind", "cron-job", "--name", "digest", "--shared");
    check("a scheduled task is refused the shared flag", r.ok === false && r.code !== 0 && /cron-job/.test(r.reason || ""), r.reason);
    check("and nothing is written", !existsSync(join(dir, ".hypervibe", "resources.json")));
  }
  {
    const dir = project();
    const r = add(dir, "--kind", "db-backup", "--name", "vitrine", "--shared");
    check("a backup target is refused it while its database is not declared shared", r.ok === false && /db-backup/.test(r.reason || ""), r.reason);
    const db = add(dir, "--kind", "neon-project", "--id", "np-1", "--name", "vitrine-commun", "--shared");
    const again = add(dir, "--kind", "db-backup", "--name", "vitrine", "--shared");
    check("and accepted once the database itself is declared shared", db.ok === true && again.ok === true && again.resource?.shared === true);
  }
  {
    const dir = project();
    const r = add(dir, "--kind", "cf-worker", "--name", "hypervibe-jobs", "--shared");
    check("the shared clock itself is still declared shared", r.ok === true && r.resource?.shared === true);
  }
  {
    // A manifest written before 3.3.9, the flag set on a task and on a backup target.
    const dir = project();
    const first = add(dir, "--kind", "cron-job", "--name", "digest");
    add(dir, "--kind", "db-backup", "--name", "vitrine");
    const file = first.file;
    const before = JSON.parse(readFileSync(file, "utf8"));
    for (const r of before.resources) r.shared = true;
    writeFileSync(file, JSON.stringify(before, null, 2) + "\n", "utf8");
    const task = add(dir, "--kind", "cron-job", "--name", "digest");
    const backup = add(dir, "--kind", "db-backup", "--name", "vitrine");
    check("a task marked shared before loses the flag at its next write", task.ok === true && task.action === "updated" && !("shared" in (task.resource || {})));
    check("and so does the backup target of a database that is not shared", backup.ok === true && !("shared" in (backup.resource || {})));
    check("in the file too", JSON.parse(readFileSync(file, "utf8")).resources.every((r) => !r.shared));
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) process.exit(1);
