#!/usr/bin/env node
// test-render-service.mjs - A Render service is found by its EXACT name, on every page of the
// account, and recorded in the project's manifest; nothing is guessed, nothing is recorded twice.
//
// The service of an agent, created by hand in the console and never recorded, survived the
// deletion of its project and kept billing (lot 6 bis, 05/10/2026). This recette plays the REAL
// scripts/render/service.mjs against a Render API held in memory, and the REAL manifest script
// on a temporary project. No network, no vault.
//
//   node scripts/tests/test-render-service.mjs

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { run } = await import(pathToFileURL(join(ROOT, "scripts", "render", "service.mjs")).href);

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

/** A Render account in memory: 130 services on two pages, the one we want on the second. */
function fakeRender() {
  const services = [];
  for (let i = 0; i < 125; i += 1) services.push({ id: `srv-${i}`, name: `service-${i}`, type: "web_service" });
  services.push({ id: "srv-agent", name: "atelier-veille", type: "background_worker", repo: "https://github.com/equipe/atelier", rootDir: "apps/veille", suspended: "not_suspended" });
  services.push({ id: "srv-worker", name: "atelier-worker", type: "web_service", serviceDetails: { url: "https://atelier-worker.onrender.com" }, repo: "https://github.com/equipe/atelier" });
  services.push({ id: "srv-near", name: "atelier-worker-ancien", type: "web_service" });
  services.push({ id: "srv-d1", name: "double", type: "web_service" }, { id: "srv-d2", name: "double", type: "web_service" });
  const calls = [];
  const fetch = async (href, opts = {}) => {
    const url = new URL(href);
    calls.push(`${opts.method ?? "GET"} ${url.pathname}`);
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if ((opts.method ?? "GET") === "GET" && url.pathname === "/v1/services") {
      const cursor = url.searchParams.get("cursor");
      const start = cursor ? Number(cursor) + 1 : 0;
      return reply(200, services.slice(start, start + 100).map((s, k) => ({ service: s, cursor: String(start + k) })));
    }
    return reply(404, { message: "unknown" });
  };
  return { fetch, calls };
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), "hv-render-service-"));
  mkdirSync(join(dir, ".git"));
  return dir;
}
const key = () => "cle-render";
const manifestOf = (dir) => {
  const file = join(dir, ".hypervibe", "resources.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).resources ?? [] : [];
};

console.log("── Trouver : le nom exact, sur toutes les pages ──");
{
  const r = fakeRender();
  const dir = project();
  const out = await run(["find", "--project-dir", dir, "--name", "atelier-worker"], { fetchImpl: r.fetch, readKey: key });
  check("the service is found on the second page of the account", out.id === "srv-worker" && r.calls.length === 2, JSON.stringify(out));
  check("... with the address its site will call", out.url === "https://atelier-worker.onrender.com");
  check("... a name that only starts like it is another service (atelier-worker-ancien)", out.id !== "srv-near");
  check("... and finding writes nothing in the project", manifestOf(dir).length === 0);
  const agent = await run(["find", "--project-dir", dir, "--name", "atelier-veille"], { fetchImpl: fakeRender().fetch, readKey: key });
  check("a background worker has no address: said null, never invented", agent.id === "srv-agent" && agent.url === null && agent.repo === "https://github.com/equipe/atelier");
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n── Aucun, plusieurs : rien n'est deviné ──");
{
  const dir = project();
  const none = await thrown(() => run(["find", "--project-dir", dir, "--name", "atelier"], { fetchImpl: fakeRender().fetch, readKey: key }));
  check("no service of that exact name: not found (4), never the closest one", none?.code === 4 && /Nothing was recorded/.test(none.message), none?.message);
  const several = await thrown(() => run(["find", "--project-dir", dir, "--name", "double", "--record", "--added-by", "_create-agent"], { fetchImpl: fakeRender().fetch, readKey: key }));
  check("several services of that name: both named (6), nothing recorded", several?.code === 6 && /srv-d1/.test(several.message) && /srv-d2/.test(several.message) && manifestOf(dir).length === 0, several?.message);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n── Inscrire : l'entrée que /delete-project lit d'abord ──");
{
  const dir = project();
  const out = await run(["find", "--project-dir", dir, "--name", "atelier-veille", "--record", "--added-by", "_create-agent"], { fetchImpl: fakeRender().fetch, readKey: key });
  const entries = manifestOf(dir).filter((e) => e.kind === "render-service");
  check("--record writes the service in the project's manifest, by its identifier", out.recorded === true && entries.length === 1 && entries[0].id === "srv-agent" && entries[0].name === "atelier-veille", JSON.stringify(entries));
  await run(["find", "--project-dir", dir, "--name", "atelier-veille", "--record", "--added-by", "_create-agent"], { fetchImpl: fakeRender().fetch, readKey: key });
  check("... recorded again, it stays one entry", manifestOf(dir).filter((e) => e.kind === "render-service").length === 1);
  const failedRecord = await thrown(() => run(["find", "--project-dir", dir, "--name", "atelier-worker", "--record", "--added-by", "_create-render-worker"], { fetchImpl: fakeRender().fetch, readKey: key, record: () => ({ ok: false, reason: "disque plein" }) }));
  check("a manifest that could not record it is an error (1), never 'recorded'", failedRecord?.code === 1 && /could not record/.test(failedRecord.message), failedRecord?.message);
  check("--record without --added-by is refused", (await thrown(() => run(["find", "--project-dir", dir, "--name", "atelier-worker", "--record"], { fetchImpl: fakeRender().fetch, readKey: key })))?.code === 1);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n── Le coffre : ce qu'il dit, sans rien confondre ──");
{
  const dir = project();
  const vaultError = (code) => () => { throw Object.assign(new Error(`vault error ${code}`), { code }); };
  const ask = (readKey) => thrown(() => run(["find", "--project-dir", dir, "--name", "atelier-worker"], { fetchImpl: fakeRender().fetch, readKey }));
  check("a locked vault (2) and an expired session (3) keep their codes", (await ask(vaultError(2)))?.code === 2 && (await ask(vaultError(3)))?.code === 3);
  check("no Render key in the vault: 4", (await ask(vaultError(4)))?.code === 4 && (await ask(() => ""))?.code === 4);
  check("a vault that could not be read: an error (1), never 'no key'", (await ask(vaultError(1)))?.code === 1);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
