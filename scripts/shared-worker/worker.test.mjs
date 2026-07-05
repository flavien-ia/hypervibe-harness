#!/usr/bin/env node
// worker.test.mjs - Test harness for the unified shared worker (worker.js).
// Plain Node (>= 18), no framework: run with `node worker.test.mjs`.
// Exit code 0 = all green. Any assertion failure exits 1 with a summary.

import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cronMatches, computeNextDue, runPingJob, runSnapshotJob, runQuotaJob } from "./worker.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`FAIL: ${label}`);
  }
}

function checkThrows(label, fn) {
  try {
    fn();
    failed++;
    failures.push(label + " (did not throw)");
  } catch {
    passed++;
  }
}

// A date helper: Date.UTC wrapper -> Date.
function utc(y, mo, d, h = 0, mi = 0) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

// ── 1. cronMatches ───────────────────────────────────────────────────────

check("* * * * * matches any minute", cronMatches("* * * * *", utc(2026, 7, 4, 13, 37)));
check("0 3 1,15 * * matches the 1st at 03:00", cronMatches("0 3 1,15 * *", utc(2026, 7, 1, 3, 0)));
check("0 3 1,15 * * matches the 15th at 03:00", cronMatches("0 3 1,15 * *", utc(2026, 7, 15, 3, 0)));
check("0 3 1,15 * * does not match 03:01", !cronMatches("0 3 1,15 * *", utc(2026, 7, 1, 3, 1)));
check("0 3 1,15 * * does not match the 2nd", !cronMatches("0 3 1,15 * *", utc(2026, 7, 2, 3, 0)));
check("0 6 * * * matches 06:00 daily", cronMatches("0 6 * * *", utc(2026, 7, 4, 6, 0)));
check("0 6 * * * does not match 07:00", !cronMatches("0 6 * * *", utc(2026, 7, 4, 7, 0)));
check("*/5 matches :00", cronMatches("*/5 * * * *", utc(2026, 7, 4, 10, 0)));
check("*/5 matches :35", cronMatches("*/5 * * * *", utc(2026, 7, 4, 10, 35)));
check("*/5 does not match :07", !cronMatches("*/5 * * * *", utc(2026, 7, 4, 10, 7)));
// 2026-07-06 is a Monday.
check("0 8 * * 1 matches Monday 08:00", cronMatches("0 8 * * 1", utc(2026, 7, 6, 8, 0)));
check("0 8 * * 1 does not match Tuesday", !cronMatches("0 8 * * 1", utc(2026, 7, 7, 8, 0)));
check("range 9-17 matches 12h", cronMatches("0 9-17 * * *", utc(2026, 7, 4, 12, 0)));
check("range 9-17 does not match 18h", !cronMatches("0 9-17 * * *", utc(2026, 7, 4, 18, 0)));
check("list 1,3,5 dow matches Friday", cronMatches("0 0 * * 1,3,5", utc(2026, 7, 3, 0, 0))); // 2026-07-03 = Friday
check("step range 10-30/10 matches :20", cronMatches("10-30/10 * * * *", utc(2026, 7, 4, 5, 20)));
check("step range 10-30/10 does not match :15", !cronMatches("10-30/10 * * * *", utc(2026, 7, 4, 5, 15)));
// POSIX dom/dow OR rule: both restricted -> either matches.
check("POSIX OR: 1st (dom match, dow mismatch)", cronMatches("0 0 1 * 1", utc(2026, 7, 1, 0, 0))); // Wed 1st
check("POSIX OR: Monday 6th (dow match, dom mismatch)", cronMatches("0 0 1 * 1", utc(2026, 7, 6, 0, 0)));
check("POSIX OR: neither -> no match", !cronMatches("0 0 1 * 1", utc(2026, 7, 4, 0, 0)));
checkThrows("4 fields throws", () => cronMatches("* * * *", new Date()));
checkThrows("non-string throws", () => cronMatches(null, new Date()));

// computeNextDue
const next = computeNextDue("0 6 * * *", utc(2026, 7, 4, 13, 0));
check("computeNextDue finds next 06:00", next === utc(2026, 7, 5, 6, 0).toISOString());
check("computeNextDue null on bad expr", computeNextDue("nope", new Date()) === null);

// ── fetch mocking helpers ────────────────────────────────────────────────

const realFetch = globalThis.fetch;
let calls = [];

function mockFetch(router) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body ?? null };
    calls.push(call);
    return router(call);
  };
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// ── 2. runPingJob ────────────────────────────────────────────────────────

{
  mockFetch(() => new Response("ok", { status: 200 }));
  const job = { kind: "ping", name: "t1", cron: "* * * * *", url: "https://app.test/api/cron/t1", secretName: "CRON_SECRET_MYAPP" };
  await runPingJob(job, { CRON_SECRET_MYAPP: "s3cret" });
  check("ping: one fetch call", calls.length === 1);
  check("ping: POST to the task url", calls[0]?.method === "POST" && calls[0]?.url === "https://app.test/api/cron/t1");
  check("ping: bearer header set", calls[0]?.headers?.Authorization === "Bearer s3cret");

  // Missing secret -> no call at all.
  mockFetch(() => new Response("ok", { status: 200 }));
  await runPingJob(job, {});
  check("ping: missing secret skips the call", calls.length === 0);
  restoreFetch();
}

// ── 3. runSnapshotJob ────────────────────────────────────────────────────

{
  const today = new Date().toISOString().slice(0, 10);

  // Fresh project: no backup branches yet -> create rolling + aging.
  mockFetch((call) => {
    if (call.method === "GET") {
      return jsonResponse({ branches: [{ id: "br-main", name: "main", default: true }] });
    }
    return jsonResponse({}, 201);
  });
  await runSnapshotJob(
    { kind: "snapshot", name: "neon-backups", cron: "0 3 1,15 * *", targets: [{ name: "myapp", projectId: "pid-1" }] },
    { NEON_API_KEY: "neon-key" },
  );
  const posts = calls.filter((c) => c.method === "POST");
  check("snapshot fresh: 2 branch creations (rolling + aging)", posts.length === 2);
  check("snapshot fresh: rolling branch named for today", posts.some((c) => c.body?.includes(`bk-myapp-r-${today}`)));
  check("snapshot fresh: aging branch named for today", posts.some((c) => c.body?.includes(`bk-myapp-a-${today}`)));
  check("snapshot fresh: bearer used", calls[0]?.headers?.Authorization === "Bearer neon-key");

  // Retention: 3 rolling -> delete the oldest; aging fresh -> nothing new.
  mockFetch((call) => {
    if (call.method === "GET") {
      return jsonResponse({
        branches: [
          { id: "br-main", name: "main", default: true },
          { id: "r1", name: `bk-myapp-r-${today}` },
          { id: "r2", name: "bk-myapp-r-2026-06-15" },
          { id: "r3", name: "bk-myapp-r-2026-06-01" },
          { id: "a1", name: `bk-myapp-a-${today}` },
        ],
      });
    }
    return jsonResponse({}, call.method === "DELETE" ? 200 : 201);
  });
  await runSnapshotJob(
    { kind: "snapshot", name: "neon-backups", cron: "0 3 1,15 * *", targets: [{ name: "myapp", projectId: "pid-1" }] },
    { NEON_API_KEY: "neon-key" },
  );
  const deletes = calls.filter((c) => c.method === "DELETE");
  const creates = calls.filter((c) => c.method === "POST");
  check("snapshot retention: same-day rerun creates nothing", creates.length === 0);
  check("snapshot retention: exactly 1 rolling delete", deletes.length === 1 && deletes[0].url.endsWith("/branches/r3"));

  // Aging purge: an aging branch older than 270 days is deleted (and a new one created).
  mockFetch((call) => {
    if (call.method === "GET") {
      return jsonResponse({
        branches: [
          { id: "br-main", name: "main", default: true },
          { id: "old-a", name: "bk-myapp-a-2020-01-01" },
        ],
      });
    }
    return jsonResponse({}, call.method === "DELETE" ? 200 : 201);
  });
  await runSnapshotJob(
    { kind: "snapshot", name: "neon-backups", cron: "0 3 1,15 * *", targets: [{ name: "myapp", projectId: "pid-1" }] },
    { NEON_API_KEY: "neon-key" },
  );
  check("snapshot aging: stale aging branch deleted", calls.some((c) => c.method === "DELETE" && c.url.endsWith("/branches/old-a")));
  check("snapshot aging: new aging branch created", calls.some((c) => c.method === "POST" && c.body?.includes(`bk-myapp-a-${today}`)));

  // No API key -> no calls.
  mockFetch(() => jsonResponse({}));
  await runSnapshotJob({ kind: "snapshot", name: "neon-backups", cron: "0 3 1,15 * *", targets: [{ name: "x", projectId: "p" }] }, {});
  check("snapshot: missing NEON_API_KEY makes zero calls", calls.length === 0);
  restoreFetch();
}

// ── 4. runQuotaJob ───────────────────────────────────────────────────────

{
  const cfg = {
    cloudflareAccountId: "acc-1",
    recipient: "user@test.fr",
    senderEmail: "sender@test.fr",
    senderName: "Test",
    r2ThresholdGb: 9,
  };
  const gb = 1073741824;

  // Above threshold -> GraphQL + Brevo email.
  mockFetch((call) => {
    if (call.url.includes("graphql")) {
      return jsonResponse({ data: { viewer: { accounts: [{ r2StorageAdaptiveGroups: [{ max: { payloadSize: 9.5 * gb, metadataSize: 0, objectCount: 42 } }] }] } } });
    }
    return jsonResponse({ messageId: "x" }, 201);
  });
  await runQuotaJob(
    { kind: "quota", name: "quota-monitor", cron: "0 6 * * *", config: cfg },
    { CLOUDFLARE_API_TOKEN: "cf-tok", BREVO_API_KEY: "brevo-key" },
  );
  const brevo = calls.find((c) => c.url.includes("brevo"));
  check("quota over: Brevo email sent", !!brevo);
  check("quota over: email goes to the recipient", brevo?.body?.includes("user@test.fr"));
  check("quota over: GraphQL used the CF token", calls[0]?.headers?.Authorization === "Bearer cf-tok");

  // Under threshold -> no email.
  mockFetch((call) => {
    if (call.url.includes("graphql")) {
      return jsonResponse({ data: { viewer: { accounts: [{ r2StorageAdaptiveGroups: [{ max: { payloadSize: 1 * gb, metadataSize: 0, objectCount: 3 } }] }] } } });
    }
    return jsonResponse({}, 201);
  });
  await runQuotaJob(
    { kind: "quota", name: "quota-monitor", cron: "0 6 * * *", config: cfg },
    { CLOUDFLARE_API_TOKEN: "cf-tok", BREVO_API_KEY: "brevo-key" },
  );
  check("quota under: no Brevo call", !calls.some((c) => c.url.includes("brevo")));

  // Missing token -> no checks at all.
  mockFetch(() => jsonResponse({}));
  await runQuotaJob({ kind: "quota", name: "quota-monitor", cron: "0 6 * * *", config: cfg }, {});
  check("quota: missing CF token makes zero calls", calls.length === 0);
  restoreFetch();
}

// ── 5. scheduled dispatch + admin endpoints (tmp copy with a real registry) ─

{
  const tmp = mkdtempSync(join(tmpdir(), "hvjobs-test-"));
  copyFileSync(join(SCRIPT_DIR, "worker.js"), join(tmp, "worker.js"));
  writeFileSync(
    join(tmp, "jobs.js"),
    "export default " +
      JSON.stringify(
        {
          version: 1,
          jobs: [
            { kind: "ping", name: "every-minute", project: "myapp", cron: "* * * * *", url: "https://app.test/api/cron/every-minute", secretName: "CRON_SECRET_MYAPP" },
            { kind: "ping", name: "never-now", project: "myapp", cron: "0 0 29 2 *", url: "https://app.test/api/cron/never-now", secretName: "CRON_SECRET_MYAPP" },
            { kind: "ping", name: "paused", project: "myapp", cron: "* * * * *", url: "https://app.test/api/cron/paused", secretName: "CRON_SECRET_MYAPP", enabled: false },
          ],
        },
        null,
        2,
      ) +
      ";\n",
  );
  const mod = await import(pathToFileURL(join(tmp, "worker.js")).href);
  const worker = mod.default;

  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const env = { CRON_SECRET_MYAPP: "s3cret", ADMIN_TOKEN: "admin-t" };

  // Dispatch: a mid-month 13:37 tick -> only "every-minute" fires ("paused" is disabled).
  mockFetch(() => new Response("ok", { status: 200 }));
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 6, 4, 13, 37) }, env, ctx);
  await Promise.all(pending);
  check("dispatch: exactly one job fired", calls.length === 1);
  check("dispatch: the right one", calls[0]?.url.endsWith("/every-minute"));

  // Admin endpoints.
  restoreFetch();
  const noAuth = await worker.fetch(new Request("https://w.test/status"), env, ctx);
  check("admin: /status without token -> 401", noAuth.status === 401);

  const health = await worker.fetch(new Request("https://w.test/"), env, ctx);
  check("admin: / is a public health ping", health.status === 200);

  const status = await worker.fetch(
    new Request("https://w.test/status", { headers: { authorization: "Bearer admin-t" } }),
    env,
    ctx,
  );
  const statusBody = await status.json();
  check("admin: /status lists the 3 jobs", status.status === 200 && statusBody.jobs?.length === 3);
  check("admin: /status computes nextDue for enabled jobs", typeof statusBody.jobs?.[0]?.nextDue === "string");
  check("admin: /status nextDue null for paused job", statusBody.jobs?.find((j) => j.name === "paused")?.nextDue === null);

  const unknown = await worker.fetch(
    new Request("https://w.test/trigger?name=nope", { method: "POST", headers: { authorization: "Bearer admin-t" } }),
    env,
    ctx,
  );
  check("admin: /trigger unknown job -> 404", unknown.status === 404);

  pending.length = 0;
  mockFetch(() => new Response("ok", { status: 200 }));
  const trig = await worker.fetch(
    new Request("https://w.test/trigger?name=every-minute", { method: "POST", headers: { authorization: "Bearer admin-t" } }),
    env,
    ctx,
  );
  await Promise.all(pending);
  check("admin: /trigger known job -> 202 + job ran", trig.status === 202 && calls.length === 1);
  restoreFetch();

  rmSync(tmp, { recursive: true, force: true });
}

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
