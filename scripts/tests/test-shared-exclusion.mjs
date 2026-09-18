#!/usr/bin/env node
// test-shared-exclusion.mjs - A resource the project's manifest declares shared never
// leaves with the project, whatever its kind (delete-project, discover-resources.mjs).
//
// Until the storage lot (18/09/2026), only a shared worker was taken out of the deletion
// inventory: a shared bucket, database, service or webhook found by the name scans stayed
// on the list. This recette builds inventories the way discover does and checks each kind.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { excludeShared } = await import(pathToFileURL(join(HERE, "..", "delete-project", "_shared-exclusion.mjs")).href);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const inventory = () => ({
  workers: { found: true, workers: [{ id: "vitrine-api" }, { id: "hypervibe-jobs" }] },
  r2: {
    found: true,
    buckets: [
      { name: "vitrine-assets", jurisdiction: "eu", objectCount: 543 },
      { name: "vitrine-partage", jurisdiction: "eu", objectCount: 12 },
      { name: "vitrine-partage", jurisdiction: "global", objectCount: 3 },
    ],
  },
  neon: { found: true, projects: [{ id: "np-1", name: "vitrine" }, { id: "np-2", name: "vitrine-commun" }] },
  render: { found: true, services: [{ id: "srv-1", name: "vitrine-worker" }] },
  stripe: { found: true, webhooks: [{ id: "we_1", url: "https://vitrine.example/api/stripe" }] },
});

{
  const inv = inventory();
  const moved = excludeShared(inv, { kind: "r2-bucket", name: "vitrine-partage", jurisdiction: "eu", shared: true });
  check("a shared bucket leaves the deletion list", moved === 1 && !inv.r2.buckets.some((b) => b.name === "vitrine-partage" && b.jurisdiction === "eu"));
  check("and goes to the excluded list, with the reason", inv.r2.excluded?.[0]?.name === "vitrine-partage" && /shared/.test(inv.r2.excluded[0].excludedReason));
  check("the same name in the other jurisdiction is another bucket, and stays", inv.r2.buckets.some((b) => b.name === "vitrine-partage" && b.jurisdiction === "global"));
  check("the project's own bucket stays on the list", inv.r2.buckets.some((b) => b.name === "vitrine-assets"));
  check("a bucket declared without a jurisdiction is the global one", excludeShared(inventory(), { kind: "r2-bucket", name: "vitrine-partage" }) === 1);
}
{
  const inv = inventory();
  check("a shared database leaves the list, found by its id", excludeShared(inv, { kind: "neon-project", id: "np-2", shared: true }) === 1 && inv.neon.projects.length === 1 && inv.neon.projects[0].id === "np-1");
  const byName = inventory();
  check("or by its name", excludeShared(byName, { kind: "neon-project", name: "vitrine-commun", shared: true }) === 1);
}
{
  const inv = inventory();
  check("a shared service leaves the list", excludeShared(inv, { kind: "render-service", id: "srv-1", shared: true }) === 1 && inv.render.services.length === 0);
  check("and a section left empty says so", inv.render.found === false);
}
{
  const inv = inventory();
  check("a shared webhook leaves the list, found by its address", excludeShared(inv, { kind: "stripe-webhook", name: "https://vitrine.example/api/stripe", shared: true }) === 1 && inv.stripe.webhooks.length === 0);
}
{
  const inv = inventory();
  check("a shared worker still leaves it, whatever the case of its name", excludeShared(inv, { kind: "cf-worker", name: "HYPERVIBE-JOBS", shared: true }) === 1 && inv.workers.workers.length === 1);
}
{
  const inv = inventory();
  const before = JSON.stringify(inv);
  check("a kind the inventory does not hold changes nothing", excludeShared(inv, { kind: "dns-record", name: "vitrine.example", shared: true }) === 0 && JSON.stringify(inv) === before);
  check("a declared resource that no scan found changes nothing", excludeShared(inv, { kind: "r2-bucket", name: "ailleurs-assets", shared: true }) === 0 && JSON.stringify(inv) === before);
  check("a section that failed to scan (null) is left alone", excludeShared({ ...inv, r2: null }, { kind: "r2-bucket", name: "vitrine-assets", shared: true }) === 0);
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) process.exit(1);
