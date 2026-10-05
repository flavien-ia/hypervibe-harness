#!/usr/bin/env node
// service.mjs - A project's Render service, found by its EXACT name and recorded in the project's
// manifest, with the address the project's site calls to wake it.
//
// A Render service is created by hand in the console (a Blueprint), and nothing recorded it: the
// service of an agent, about 7 USD a month, survived the deletion of its project, which looked for
// it by a name that did not carry the project's (lot 6 bis inventory, 05/10/2026). This script is
// the one place a service is found and recorded:
//   - every page of the account's services is read, and a name matches EXACTLY, never "contains";
//   - no service of that name is "not found" (4); several are all named, and nothing is recorded
//     (6): the person says which;
//   - with --record, the service enters the project's manifest (kind render-service), the entry
//     /delete-project reads first.
//
//   node service.mjs find --project-dir <dir> --name <exact service name> [--record --added-by <skill>]
//
// Prints ONE JSON object: { id, name, type, url, repo, rootDir, suspended, recorded? }. `url` is the
// address of a web service (null for a background worker, which has none).
// Exit codes: 0 ok, 1 usage, provider error or a vault that could not be read, 2/3 vault to open,
// 4 no Render key or no service of that name, 6 several services of that name.

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Failure, client, keyFailure, services } from "./env-vars.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** What the project and its skills need to know of a service, nothing more. */
function described(s) {
  return {
    id: s.id,
    name: s.name ?? null,
    type: s.type ?? null,
    url: s.serviceDetails?.url ?? null,
    repo: s.repo ?? null,
    rootDir: s.rootDir ?? null,
    suspended: s.suspended ?? null,
  };
}

export async function run(argv, { fetchImpl = globalThis.fetch, readKey, record = recordInManifest } = {}) {
  const [cmd, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--record") flags.record = true;
    else if (a === "--project-dir") flags.projectDir = rest[++i];
    else if (a === "--name") flags.name = rest[++i];
    else if (a === "--added-by") flags.addedBy = rest[++i];
    else throw new Failure(1, `Unknown argument: ${a}`);
  }
  if (cmd !== "find") throw new Failure(1, "Usage: service.mjs find --project-dir <dir> --name <exact service name> [--record --added-by <skill>]");
  if (!flags.projectDir) throw new Failure(1, "--project-dir is required");
  if (typeof flags.name !== "string" || !NAME.test(flags.name)) throw new Failure(1, "--name <the service's exact name> is required");
  if (flags.record && !flags.addedBy) throw new Failure(1, "--record needs --added-by <the calling skill>");

  let key;
  try {
    key = readKey();
  } catch (e) {
    throw keyFailure(e);
  }
  if (!key) throw new Failure(4, "No Render key in the vault (item RENDER, field api_key).");
  const api = client(key, fetchImpl);

  const same = (await services(api)).filter((s) => s.name === flags.name);
  if (same.length === 0) {
    throw new Failure(4, `No Render service is named ${flags.name} on this account: has the Blueprint been applied? Nothing was recorded.`);
  }
  if (same.length > 1) {
    throw new Failure(6, `${same.length} Render services are named ${flags.name} (${same.map((s) => s.id).join(", ")}): ask the person which one is this project's. Nothing was recorded.`);
  }
  const service = described(same[0]);
  if (!flags.record) return service;
  const r = record({ projectDir: resolve(flags.projectDir), id: service.id, name: service.name, addedBy: flags.addedBy });
  if (!r.ok) throw new Failure(1, `The service ${service.id} was found, but the project's manifest could not record it (${r.reason}): run the same command again.`);
  return { ...service, recorded: true };
}

/** The manifest's own script writes the entry: the one writer of the manifest. */
function recordInManifest({ projectDir, id, name, addedBy }) {
  const r = spawnSync(
    process.execPath,
    [join(HERE, "..", "manifest", "manifest.mjs"), "add", "--project-dir", projectDir, "--kind", "render-service", "--id", id, "--name", name, "--added-by", addedBy],
    { encoding: "utf8", windowsHide: true },
  );
  return r.status === 0 ? { ok: true } : { ok: false, reason: (r.stderr || r.stdout || `exit ${r.status}`).trim().slice(0, 200) };
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
  try {
    const { getSecret } = await import(pathToFileURL(join(HERE, "..", "vault", "vault.mjs")).href);
    const out = await run(process.argv.slice(2), { readKey: () => getSecret("RENDER", "api_key") });
    console.log(JSON.stringify(out));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exitCode = Number.isInteger(e.code) && e.code > 0 ? e.code : 1;
  }
}
