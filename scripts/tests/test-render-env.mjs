#!/usr/bin/env node
// test-render-env.mjs - Render variables are written to the project's own services, from its
// .env, and nowhere else.
//
// Before September 2026, /rotate-secret and /add-domain looped over every service of the Render
// account with curl: one never wrote (a name not exported), the other never ran (a key looked for
// in the environment), and would have written "https://undefined" everywhere. This recette plays
// the REAL scripts/render/env-vars.mjs against a Render API held in memory. No network, no vault.
//
//   node scripts/tests/test-render-env.mjs

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { run } = await import(pathToFileURL(join(ROOT, "scripts", "render", "env-vars.mjs")).href);

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${String(detail).slice(0, 200)})` : ""}`);
}
async function thrown(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const SECRET = "valeur-secrete-qui-ne-doit-jamais-sortir";

/** A Render account in memory: 120 services (two pages), a few declaring keys. */
function fakeRender({ failList = false } = {}) {
  const state = { services: [], env: new Map(), puts: [], deploys: [] };
  for (let i = 0; i < 120; i += 1) state.services.push({ id: `srv-${i}`, name: `service-${i}` });
  state.env.set("srv-3", [{ key: "RESEND_API_KEY", value: "ancienne" }, { key: "APP_URL", value: "https://atelier.vercel.app/api" }]);
  state.env.set("srv-110", [{ key: "RESEND_API_KEY", value: "autre-projet" }]);
  for (const s of state.services) if (!state.env.has(s.id)) state.env.set(s.id, []);
  const page = (list, url) => {
    const cursor = url.searchParams.get("cursor");
    const start = cursor ? Number(cursor) + 1 : 0;
    return list.slice(start, start + 100).map((x, k) => ({ ...x, cursor: String(start + k) }));
  };
  const fetch = async (href, opts = {}) => {
    const url = new URL(href);
    const method = opts.method ?? "GET";
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (method === "GET" && url.pathname === "/v1/services") {
      if (failList) return reply(500, { message: "boom" });
      return reply(200, page(state.services.map((s) => ({ service: s })), url));
    }
    let m = /^\/v1\/services\/([^/]+)\/env-vars$/.exec(url.pathname);
    if (method === "GET" && m) return reply(200, page((state.env.get(m[1]) ?? []).map((e) => ({ envVar: e })), url));
    m = /^\/v1\/services\/([^/]+)\/env-vars\/([^/]+)$/.exec(url.pathname);
    if (method === "PUT" && m) {
      const value = JSON.parse(opts.body).value;
      state.puts.push({ id: m[1], key: m[2], value });
      const list = state.env.get(m[1]);
      const e = list.find((x) => x.key === m[2]);
      if (e) e.value = value;
      else list.push({ key: m[2], value });
      return reply(200, { key: m[2], value });
    }
    m = /^\/v1\/services\/([^/]+)\/deploys$/.exec(url.pathname);
    if (method === "POST" && m) {
      state.deploys.push(m[1]);
      return reply(201, { id: "dep-1" });
    }
    return reply(404, { message: `unknown ${method} ${url.pathname}` });
  };
  return { state, fetch };
}

function project({ env = "", manifest = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hv-render-"));
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, ".env"), env);
  if (manifest) {
    mkdirSync(join(dir, ".hypervibe"));
    writeFileSync(join(dir, ".hypervibe", "resources.json"), JSON.stringify({ version: 1, resources: manifest }));
  }
  return dir;
}
const key = () => "cle-render";

console.log("── Lister : les services qui déclarent la clé, marqués quand le manifeste les nomme ──");
{
  const r = fakeRender();
  const dir = project({ manifest: [{ kind: "render-service", id: "srv-3", name: "atelier-agent" }] });
  const out = await run(["list", "--project-dir", dir, "--key", "RESEND_API_KEY"], { fetchImpl: r.fetch, readKey: key });
  const ids = out.services.map((s) => s.id);
  check("every page of the account is read (a service on the second page is found)", ids.includes("srv-110"), ids.join(","));
  check("the project's own service is marked, another project's is not", out.services.find((s) => s.id === "srv-3")?.inManifest === true && out.services.find((s) => s.id === "srv-110")?.inManifest === false);
  check("a listing writes nothing", r.state.puts.length === 0 && r.state.deploys.length === 0);
  const failed = await thrown(() => run(["list", "--project-dir", dir, "--key", "RESEND_API_KEY"], { fetchImpl: fakeRender({ failList: true }).fetch, readKey: key }));
  check("a listing that failed is an error, never an empty list", failed?.code === 1 && /HTTP 500/.test(failed.message), failed?.message);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n── Écrire : dans les services nommés, la valeur lue dans le .env ──");
{
  const r = fakeRender();
  const dir = project({ env: `RESEND_API_KEY=${SECRET}\n` });
  const out = await run(["set", "--project-dir", dir, "--key", "RESEND_API_KEY", "--service", "srv-3"], { fetchImpl: r.fetch, readKey: key });
  check("the named service receives the value of the project's .env", r.state.puts.length === 1 && r.state.puts[0].id === "srv-3" && r.state.puts[0].value === SECRET);
  check("... and is redeployed so that it picks it up", r.state.deploys.includes("srv-3") && out.results[0].redeployed === true);
  check("another project's service that declares the same key is untouched", r.state.env.get("srv-110")[0].value === "autre-projet");
  check("the value never appears in the output", !JSON.stringify(out).includes(SECRET));
  check("no --service: refused, nothing is written to 'every service of the account'", (await thrown(() => run(["set", "--project-dir", dir, "--key", "RESEND_API_KEY"], { fetchImpl: r.fetch, readKey: key })))?.code === 1 && r.state.puts.length === 1);
  const notDeclared = await thrown(() => run(["set", "--project-dir", dir, "--key", "RESEND_API_KEY", "--service", "srv-5"], { fetchImpl: r.fetch, readKey: key }));
  check("a service that does not declare the key is refused (6), nothing added", notDeclared?.code === 6 && r.state.puts.length === 1, notDeclared?.message);
  const absent = await thrown(() => run(["set", "--project-dir", dir, "--key", "BREVO_API_KEY", "--service", "srv-3"], { fetchImpl: r.fetch, readKey: key }));
  check("a value absent from the .env: refused (4), nothing written", absent?.code === 4 && r.state.puts.length === 1, absent?.message);
  const noKey = await thrown(() => run(["list", "--project-dir", dir, "--key", "X"], { fetchImpl: r.fetch, readKey: () => "" }));
  check("no Render key: said (4), never taken for 'no service'", noKey?.code === 4);
  const locked = await thrown(() => run(["list", "--project-dir", dir, "--key", "X"], { fetchImpl: r.fetch, readKey: () => { throw Object.assign(new Error("locked"), { code: 2 }); } }));
  check("a locked vault is its own exit code (2)", locked?.code === 2);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n── Réorienter : l'ancienne adresse du projet devient son domaine ──");
{
  const r = fakeRender();
  const dir = project();
  const out = await run(["retarget", "--project-dir", dir, "--service", "srv-3", "--to-origin", "https://atelier.fr"], { fetchImpl: r.fetch, readKey: key });
  const appUrl = r.state.env.get("srv-3").find((e) => e.key === "APP_URL").value;
  check("the old address is replaced by the domain, the path kept", appUrl === "https://atelier.fr/api", appUrl);
  check("... only the variable that pointed at it", out.results[0].changed.join(",") === "APP_URL" && r.state.env.get("srv-3").find((e) => e.key === "RESEND_API_KEY").value === "ancienne");
  check("never 'https://undefined': a domain that is not https://<domain> is refused", (await thrown(() => run(["retarget", "--project-dir", dir, "--service", "srv-3", "--to-origin", "undefined"], { fetchImpl: r.fetch, readKey: key })))?.code === 1);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n── Les skills passent par ce script ──");
for (const skill of ["rotate-secret", "add-domain"]) {
  const text = readFileSync(join(ROOT, "skills", skill, "SKILL.md"), "utf8");
  check(`${skill}: no curl loop over every service of the account`, !/api\.render\.com\/v1\/services\?limit/.test(text));
  check(`${skill}: writes through scripts/render/env-vars.mjs`, /scripts\/render\/env-vars\.mjs/.test(text));
}

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
