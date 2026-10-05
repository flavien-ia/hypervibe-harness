#!/usr/bin/env node
// test-render-worker.mjs - The Render worker answers as soon as it accepts the work, and it is
// woken through the project's site, never by a clock that cannot reach it.
//
// Two defects published until 3.4.1 (lot 6 bis, 05/10/2026): the worker's template answered
// AFTER the work, against its own comment, so a caller that waited little gave up on anything
// long; and the skills said the shared clock calls the worker's POST /run, which it never could
// (a task of the clock is always the site's /api/cron/<task>). The template is RUN here, for real,
// on this machine's loopback, when Node can strip its types; the relay is read in the skills.
//
//   node scripts/tests/test-render-worker.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Some skills are kept with Windows line endings: read as one form.
const text = (...parts) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const SKILL = text("skills", "_create-render-worker", "SKILL.md");
const ROUTER = text("skills", "add-automation", "SKILL.md");

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${String(detail).slice(0, 200)})` : ""}`);
}

/** The worker's code, as the skill gives it. */
function template() {
  const at = SKILL.indexOf("Create `apps/worker/src/index.ts`");
  const m = /```typescript\n([\s\S]*?)```/.exec(SKILL.slice(at));
  return at < 0 || !m ? null : m[1];
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

console.log("── Le gabarit du travailleur, lancé pour de vrai ──");
const code = template();
check("the skill gives the worker's code", Boolean(code));
const WORK = "await new Promise((done) => setTimeout(done, 1500));";
const slow = code?.replace('console.log("[worker] run at", new Date().toISOString());', WORK);
check("its work can be slowed down for the test (one pass takes 1.5 s)", Boolean(slow) && slow !== code);
if (!process.features?.typescript) {
  console.log("SKIP this Node cannot strip TypeScript types: the template is not run here (Node 22.18 or later)");
} else if (slow && slow !== code) {
  const dir = mkdtempSync(join(tmpdir(), "hv-render-worker-"));
  const file = join(dir, "index.mts");
  writeFileSync(file, slow, "utf8");
  const port = await freePort();
  const TOKEN = "jeton-de-recette";
  const child = spawn(process.execPath, ["--no-warnings", file], { env: { ...process.env, PORT: String(port), RUN_TOKEN: TOKEN, LOOP_INTERVAL_MS: "0" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100 && !/listening on/.test(out); i += 1) await new Promise((r) => setTimeout(r, 100));
    check("the worker starts and listens", /listening on/.test(out), out);
    const post = (headers = {}) => fetch(`${base}/run`, { method: "POST", headers });
    check("POST /run without its token: refused (401)", (await post()).status === 401);
    const started = Date.now();
    const first = await post({ Authorization: `Bearer ${TOKEN}` });
    const waited = Date.now() - started;
    check("POST /run answers 202 as soon as it accepts the work, before the work ends", first.status === 202 && waited < 1000, `${first.status} after ${waited} ms`);
    const busy = await post({ Authorization: `Bearer ${TOKEN}` });
    check("... a call during the pass says it at once (409), nothing waits", busy.status === 409);
    const during = await (await fetch(`${base}/healthz`)).json();
    check("... and the pass is running after the answer", during.running === true, JSON.stringify(during));
    await new Promise((r) => setTimeout(r, 1800));
    const after = await (await fetch(`${base}/healthz`)).json();
    check("the pass goes to its end after the answer", after.running === false && typeof after.lastRunAt === "string", JSON.stringify(after));
    check("... and the next call runs again (202)", (await post({ Authorization: `Bearer ${TOKEN}` })).status === 202);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 200));
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n── Le réveil passe par le site ──");
const relayStep = SKILL.slice(SKILL.indexOf("## Step 6 - Wire the relay"), SKILL.indexOf("## Step 7"));
check("the skill wires the relay: the service's address and a shared secret on the site", /WORKER_URL/.test(relayStep) && /WORKER_RUN_TOKEN/.test(relayStep) && /--from WORKER_RUN_TOKEN/.test(relayStep));
check("... the secret goes on the standard input, never in an argument", /printf 'WORKER_RUN_TOKEN=%s\\n' "\$V" \| node/.test(relayStep));
check("... the relay waits for the wake-up, bounded, and fails on anything but 202 or 409", /AbortSignal\.timeout\(/.test(relayStep) && /!== 202 && answer\.status !== 409/.test(relayStep));
check("no text says the shared clock calls the worker's POST /run any more", !/shared clock[^\n]{0,60}calls `POST \/run`/i.test(SKILL) && !/calls the service's `POST \/run` directly/.test(ROUTER));
check("... nor hands the worker's token to /add-cron", !/hand it to `\/add-cron`/.test(SKILL) && !/Pass the generated `RUN_TOKEN` to `add-cron`/.test(ROUTER));
check("the router puts the relay in the route /add-cron creates", /YOUR CRON LOGIC HERE/.test(ROUTER) && /relay/.test(ROUTER));
check("the service is recorded in the project's manifest once it exists", /scripts\/render\/service\.mjs" find[\s\S]{0,200}--record --added-by _create-render-worker/.test(SKILL));

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
