#!/usr/bin/env node
// env-vars.mjs - The environment variables of a project's Render services, and only its own.
//
// Two skills used to write them with curl loops over EVERY service of the Render account
// (hosting inventory, 27/09/2026). /rotate-secret never wrote anything: the name it looked for
// was not exported, so no service ever "declared" it. /add-domain never ran: it looked for the key
// in the environment, where it has not lived since the vault. And had it run, a domain that was
// not exported either would have been written as "https://undefined" into every service of the
// account. This script is now the one place those writes happen:
//   - it writes only to the services the person names, and to a service the project's manifest
//     does not record only once the person has said it is this project's (--outside-manifest);
//   - a value comes from the project's .env, read here: never an argument, never the conversation;
//   - "declares nothing" is only said after a listing that succeeded, every page of it.
//
//   node env-vars.mjs list     --project-dir <dir> --key <KEY> [--key <KEY2> ...]
//        the services of the account that declare one of the keys, each marked `inManifest`
//        when the project's manifest records it (kind render-service)
//   node env-vars.mjs set      --project-dir <dir> --key <KEY> --service <srv-id> [--service ...]
//                              [--from <ENV_NAME>] [--no-deploy] [--outside-manifest]
//        writes the value of <ENV_NAME> (default: <KEY>) from the project's .env into each named
//        service that declares <KEY>, then starts a deploy so the service picks it up
//   node env-vars.mjs retarget --project-dir <dir> --service <srv-id> [--service ...]
//                              --to-origin <https://domain> [--vercel-project <name>]
//                              [--no-deploy] [--outside-manifest]
//        in the named services, every value that points at one of THIS project's addresses at
//        Vercel is pointed at <to-origin> instead (the project's address became its domain); an
//        address of another project is listed in `kept`, never touched (../vercel/own-address.mjs)
//
// A named service that the project's manifest does not record (kind render-service) may belong
// to another project of the same account: `set` and `retarget` refuse it (6) unless
// --outside-manifest says the person confirmed it is this project's. Each result says
// `inManifest`. The skills asked before writing; the script wrote anyway, with the same answer
// as for the project's own service (outside review, 3.3.2).
//
// Prints ONE JSON object. Exit codes: 0 ok, 1 usage or provider error, or a vault that could not
// be read (never taken for "no Render key"), 2/3 vault to open, 4 no Render key / value absent
// from .env, 6 refused (a service that does not declare the key).

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { envValue } from "../env-value.mjs";
import { manifestExistant } from "../manifest/locate.mjs";
import { checkOrigin, projectNameOf, repointOwn } from "../vercel/own-address.mjs";

const API = "https://api.render.com/v1";

export class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** What a failed read of the Render key means. Locked (2) and expired (3) say so; an item or a
 *  field the vault does not hold is "no Render key" (4); anything else is a read that failed, and
 *  never "no Render key": the skills say "no Render" in silence on 4, and a rotation would then
 *  skip the project's services without a word. */
export function keyFailure(e) {
  if (e?.code === 2 || e?.code === 3) return new Failure(e.code, "The vault is locked: open it, then run the same command again.");
  if (e?.code === 4 || e?.code === 5) return new Failure(4, "No Render key in the vault (item RENDER, field api_key).");
  return new Failure(1, `The vault could not be read (${e?.message ?? e}): nothing is known about Render yet. Run the same command again.`);
}

/** The Render services the project's manifest records. */
export function manifestServices(projectDir) {
  const file = manifestExistant(projectDir);
  if (!file) return new Set();
  try {
    const m = JSON.parse(readFileSync(file, "utf8"));
    return new Set((m.resources ?? []).filter((r) => r.kind === "render-service" && r.id).map((r) => r.id));
  } catch {
    return new Set();
  }
}

export function client(key, fetchImpl) {
  return async (method, path, body) => {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Failure(1, `Render did not answer (${method} ${path}): ${e.message}`);
    }
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new Failure(1, `Render refused ${method} ${path} (HTTP ${res.status})${json?.message ? `: ${json.message}` : ""}`);
    return json;
  };
}

/** Every page of a Render listing (cursor pagination). */
async function all(api, path, pick) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const items = await api("GET", `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!Array.isArray(items) || items.length === 0) break;
    for (const it of items) out.push(pick(it));
    cursor = items[items.length - 1]?.cursor;
    if (!cursor || items.length < 100) break;
  }
  return out;
}

export const services = (api) => all(api, "/services", (it) => it.service ?? it);
const envVars = (api, id) => all(api, `/services/${encodeURIComponent(id)}/env-vars`, (it) => it.envVar ?? it);

export async function run(argv, { fetchImpl = globalThis.fetch, readKey } = {}) {
  const [cmd, ...rest] = argv;
  const flags = { key: [], service: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--no-deploy") flags.noDeploy = true;
    else if (a === "--outside-manifest") flags.outsideManifest = true;
    else if (a === "--vercel-project") flags.vercelProject = rest[++i];
    else if (a === "--key") flags.key.push(rest[++i]);
    else if (a === "--service") flags.service.push(rest[++i]);
    else if (a === "--project-dir") flags.projectDir = rest[++i];
    else if (a === "--from") flags.from = rest[++i];
    else if (a === "--to-origin") flags.toOrigin = rest[++i];
    else throw new Failure(1, `Unknown argument: ${a}`);
  }
  if (!["list", "set", "retarget"].includes(cmd)) throw new Failure(1, "Usage: env-vars.mjs list|set|retarget --project-dir <dir> ... (see the header of this file)");
  if (!flags.projectDir) throw new Failure(1, "--project-dir is required");
  const projectDir = resolve(flags.projectDir);

  let key;
  try {
    key = readKey();
  } catch (e) {
    throw keyFailure(e);
  }
  if (!key) throw new Failure(4, "No Render key in the vault (item RENDER, field api_key).");
  const api = client(key, fetchImpl);
  const owned = manifestServices(projectDir);

  if (cmd === "list") {
    if (!flags.key.length) throw new Failure(1, "list needs at least one --key");
    const found = [];
    for (const s of await services(api)) {
      const keys = new Set((await envVars(api, s.id)).map((e) => e.key));
      const declared = flags.key.filter((k) => keys.has(k));
      if (declared.length) found.push({ id: s.id, name: s.name ?? null, declares: declared, inManifest: owned.has(s.id) });
    }
    return { services: found, manifestServices: [...owned] };
  }

  if (!flags.service.length) throw new Failure(1, `${cmd} needs at least one --service <srv-id>: the services are named, never "every service of the account"`);
  const deploy = async (id) => (flags.noDeploy ? null : api("POST", `/services/${encodeURIComponent(id)}/deploys`, {}).then(() => true, () => false));
  const outside = flags.service.filter((id) => !owned.has(id));
  if (outside.length && !flags.outsideManifest) {
    throw new Failure(
      6,
      `Refused: ${outside.join(", ")} ${outside.length > 1 ? "are" : "is"} not in this project's manifest, and may belong to another project of the account. Ask the person; once they have said it is this project's, run the same command with --outside-manifest. Nothing was written.`,
    );
  }

  if (cmd === "set") {
    const [k] = flags.key;
    if (!k || flags.key.length > 1) throw new Failure(1, "set takes exactly one --key");
    const value = envValue(projectDir, flags.from ?? k);
    if (value === null || value === "") throw new Failure(4, `${flags.from ?? k} is not in the project's .env: nothing was written.`);
    const results = [];
    for (const id of flags.service) {
      const keys = new Set((await envVars(api, id)).map((e) => e.key));
      if (!keys.has(k)) throw new Failure(6, `Refused: the service ${id} does not declare ${k}. Nothing is added to a service that does not use it.`);
    }
    for (const id of flags.service) {
      await api("PUT", `/services/${encodeURIComponent(id)}/env-vars/${encodeURIComponent(k)}`, { value });
      results.push({ id, inManifest: owned.has(id), key: k, written: true, redeployed: await deploy(id) });
    }
    return { results };
  }

  // retarget: only THIS project's addresses at Vercel. Another project's (a shared API, a
  // billing service) is kept and listed, never rewritten into this project's domain.
  if (!checkOrigin(flags.toOrigin)) throw new Failure(1, "--to-origin must be https://<domain>, nothing after the domain");
  const project = flags.vercelProject ?? projectNameOf(projectDir);
  if (!project || !/^[a-z0-9-]+$/.test(project)) {
    throw new Failure(1, "The project's name at Vercel is unknown (no projectName in .vercel/project.json): pass --vercel-project <name>. Nothing was changed.");
  }
  const results = [];
  for (const id of flags.service) {
    const changed = [];
    const kept = [];
    for (const e of await envVars(api, id)) {
      if (typeof e.value !== "string") continue;
      const r = repointOwn(e.value, project, flags.toOrigin);
      for (const k of r.kept) if (!kept.includes(k)) kept.push(k);
      if (!r.changes.length) continue;
      await api("PUT", `/services/${encodeURIComponent(id)}/env-vars/${encodeURIComponent(e.key)}`, { value: r.text });
      changed.push(e.key);
    }
    results.push({ id, inManifest: owned.has(id), changed, kept, redeployed: changed.length ? await deploy(id) : null });
  }
  return { project, results };
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
    const { getSecret } = await import(pathToFileURL(join(fileURLToPath(new URL(".", import.meta.url)), "..", "vault", "vault.mjs")).href);
    const out = await run(process.argv.slice(2), { readKey: () => getSecret("RENDER", "api_key") });
    console.log(JSON.stringify(out));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exitCode = Number.isInteger(e.code) && e.code > 0 ? e.code : 1;
  }
}
