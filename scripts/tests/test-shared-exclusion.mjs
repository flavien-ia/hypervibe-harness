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

// ── Every kind the manifest knows (outside review, 3.2.4) ──
// Until 3.2.6 only five kinds of the thirteen were protected. Each kind below is checked the
// way discover builds its section, and the two last checks read the rules THEMSELVES: a kind
// added to the manifest, or a section added to the deletions, without its rule fails here.
const full = () => ({
  ...inventory(),
  vercel: { found: true, projects: [{ id: "prj_1", name: "vitrine", teamId: "t1" }, { id: "prj_2", name: "vitrine-commun", teamId: "t1" }] },
  dns: {
    found: true,
    records: [
      { zoneId: "z1", zoneName: "vitrine.example", recordId: "r1", type: "CNAME", name: "www.vitrine.example" },
      { zoneId: "z2", zoneName: "commun.example", recordId: "r2", type: "CNAME", name: "vitrine.commun.example" },
    ],
  },
  dbBackup: { isTarget: true, entry: { name: "vitrine", projectId: "np-1" }, totalTargets: 3, source: "hypervibe-jobs" },
  cronJobs: { found: true, jobs: [{ name: "vitrine-digest", cron: "0 8 * * *" }, { name: "vitrine-purge", cron: "0 3 * * *" }], secretName: "CRON_SECRET_VITRINE" },
  upstash: { found: true, databases: [{ id: "up-1", name: "vitrine-cache" }] },
  emailRouting: {
    found: true,
    rules: [
      { zoneId: "z1", tag: "t1", name: "contact", matchers: [{ type: "literal", field: "to", value: "contact@vitrine.example" }] },
      { zoneId: "z1", tag: "t2", name: "ventes", matchers: [{ type: "literal", field: "to", value: "ventes@vitrine.example" }] },
    ],
  },
  github: { exists: true, name: "vitrine", url: "https://github.com/studio/vitrine", visibility: "PRIVATE" },
});
{
  const inv = full();
  check("a shared Upstash database leaves the list (it was deleted for good)", excludeShared(inv, { kind: "upstash-db", id: "up-1", shared: true }) === 1 && inv.upstash.databases.length === 0 && inv.upstash.found === false);
}
{
  const inv = full();
  check("a shared Vercel project leaves the list, the project's own stays", excludeShared(inv, { kind: "vercel-project", id: "prj_2", shared: true }) === 1 && inv.vercel.projects.length === 1 && inv.vercel.projects[0].id === "prj_1" && inv.vercel.found === true);
}
{
  const inv = full();
  check("a shared zone keeps every record the scan found in it", excludeShared(inv, { kind: "dns-zone", name: "commun.example", id: "z2", shared: true }) === 1 && inv.dns.records.length === 1 && inv.dns.records[0].zoneName === "vitrine.example");
}
{
  const inv = full();
  check("a shared email route leaves the list, found by its address", excludeShared(inv, { kind: "email-route", name: "Ventes@vitrine.example", shared: true }) === 1 && inv.emailRouting.rules.length === 1 && inv.emailRouting.rules[0].tag === "t1");
}
{
  const inv = full();
  check("a shared scheduled task leaves the list, found by its <project>-<task> name", excludeShared(inv, { kind: "cron-job", name: "digest", shared: true }, { project: "vitrine" }) === 1 && inv.cronJobs.jobs.length === 1 && inv.cronJobs.jobs[0].name === "vitrine-purge");
}
{
  const inv = full();
  check("a shared backup target is no longer removed from the clock", excludeShared(inv, { kind: "db-backup", name: "vitrine", shared: true }) === 1 && inv.dbBackup.isTarget === false && inv.dbBackup.excluded?.[0]?.entry?.name === "vitrine");
}
{
  const inv = full();
  check("a shared repository is no longer offered for deletion", excludeShared(inv, { kind: "github-repo", name: "studio/vitrine", shared: true }) === 1 && inv.github.exists === false && /github\.com\/studio\/vitrine$/.test(inv.github.excluded?.[0]?.url ?? ""));
  const other = full();
  check("another repository changes nothing", excludeShared(other, { kind: "github-repo", name: "studio/autre", shared: true }) === 0 && other.github.exists === true);
}
{
  const { readFileSync } = await import("node:fs");
  const { SHARED_RULES, SHARED_SECTIONS, NOT_DELETED_KINDS } = await import(pathToFileURL(join(HERE, "..", "delete-project", "_shared-exclusion.mjs")).href);
  const manifest = readFileSync(join(HERE, "..", "manifest", "manifest.mjs"), "utf8");
  const kinds = [...(/const KNOWN_KINDS = \[([\s\S]*?)\];/.exec(manifest)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const unprotected = kinds.filter((k) => !SHARED_RULES[k] && !NOT_DELETED_KINDS.includes(k));
  check("every kind the manifest knows has its sharing rule (or nothing deletes it)", kinds.length >= 13 && unprotected.length === 0, unprotected.join(", "));
  const deletions = readFileSync(join(HERE, "..", "delete-project", "execute-deletions.mjs"), "utf8");
  const notResources = new Set(["project", "cloudflareAccountId", "ownerCandidates", "memory"]);
  const deleted = [...new Set([...deletions.matchAll(/inventory\.(\w+)/g)].map((m) => m[1]))].filter((s) => !notResources.has(s));
  const uncovered = deleted.filter((s) => !SHARED_SECTIONS.includes(s));
  check("every inventory section the deletion empties is read by a sharing rule", deleted.length > 5 && uncovered.length === 0, uncovered.join(", "));
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) process.exit(1);
