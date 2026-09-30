#!/usr/bin/env node
// test-vercel-github-app.mjs - Recette of scripts/vercel-github-app.mjs, the check /start makes of
// Vercel's GitHub application: installed, restricted, missing, or not verifiable, never ticked
// without proof. Against a fake Vercel API on the loopback: no network, no real key read (the
// machine's Vercel login and vault are kept out of reach), the key only ever in a header.
//
//   node scripts/tests/test-vercel-github-app.mjs

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "vercel-github-app.mjs");
const { evaluate, configureUrl, apiBase, INSTALL_URL } = await import(pathToFileURL(SCRIPT).href);
const WORK = mkdtempSync(join(tmpdir(), "hv-vercel-app-"));
const EMPTY_HOME = join(WORK, "home");
mkdirSync(EMPTY_HOME, { recursive: true });
const KEY = "cle-de-recette";

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 400)})`}`);
}

// ── The fake API ──────────────────────────────────────────────────────────────
let reply = { status: 200, body: [] };
const seen = [];
const server = createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization ?? null });
  res.writeHead(reply.status, { "content-type": "application/json" });
  res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const API = `http://127.0.0.1:${server.address().port}`;

/** The script, as /start runs it, with this recette's world: the fake API, no real Vercel login. */
function run(args, env = {}, script = SCRIPT) {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        HYPERVIBE_VERCEL_API: API,
        VERCEL_TOKEN: KEY,
        APPDATA: EMPTY_HOME,
        XDG_DATA_HOME: EMPTY_HOME,
        HOME: EMPTY_HOME,
        USERPROFILE: EMPTY_HOME,
        HYPERVIBE_GH_BIN: "",
        ...env,
      },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      let json = null;
      try {
        json = JSON.parse(out.trim().split("\n").pop());
      } catch {
        // not JSON
      }
      ok({ code, out, err, json });
    });
  });
}
const ns = (o) => ({ provider: "github", id: 11, installationId: 4242, isAccessRestricted: false, ownerType: "user", slug: "atelier", name: "atelier", ...o });

try {
  // ── The verdict, from Vercel's list ───────────────────────────────────────────
  check("installed on the account, access to every repository: installed", evaluate([ns()], "atelier").status === "installed");
  check("... the account is matched whatever its case (GitHub logins are not case-sensitive)", evaluate([ns({ slug: "Atelier" })], "ATELIER").status === "installed");
  check("access restricted (some repositories only, or an installation Vercel can no longer use): restricted", evaluate([ns({ isAccessRestricted: true })], "atelier").status === "restricted");
  check("... a connection Vercel asks to renew too", evaluate([ns({ requireReauth: true })], "atelier").status === "restricted");
  check("installed on other accounts only: missing for this one", evaluate([ns({ slug: "autre-compte" })], "atelier").status === "missing");
  check("an answer that is not a list: not verifiable, never installed", evaluate({ error: "x" }, "atelier").status === "unknown");
  check("a person's installation is set in their own GitHub settings", configureUrl(ns()) === "https://github.com/settings/installations/4242");
  check("an organisation's, in the organisation's", configureUrl(ns({ ownerType: "team", slug: "mon-orga" })) === "https://github.com/organizations/mon-orga/settings/installations/4242");
  check("... without an installation number, the list of installations", configureUrl(ns({ installationId: undefined })) === "https://github.com/settings/installations");
  check("the key goes to Vercel, or to a fake on the loopback only", apiBase({ HYPERVIBE_VERCEL_API: "http://127.0.0.1:9" }) === "http://127.0.0.1:9" && apiBase({ HYPERVIBE_VERCEL_API: "https://ailleurs.example" }) === "https://api.vercel.com" && apiBase({ HYPERVIBE_VERCEL_API: "http://127.0.0.1.ailleurs.example" }) === "https://api.vercel.com" && apiBase({}) === "https://api.vercel.com");

  // ── The script, end to end ──────────────────────────────────────────────────
  reply = { status: 200, body: [ns({ slug: "Atelier" }), ns({ slug: "une-orga", ownerType: "team", installationId: 77 })] };
  seen.length = 0;
  let r = await run(["--account", "atelier"]);
  check("installed: said so, with the account as GitHub writes it", r.code === 0 && r.json?.status === "installed" && r.json.account === "Atelier" && r.json.ownerType === "user", r.out + r.err);
  check("... the key only in the header of the one call, never in what the script says", seen.length === 1 && seen[0].auth === `Bearer ${KEY}` && /\/v1\/integrations\/git-namespaces\?provider=github$/.test(seen[0].url) && !(r.out + r.err).includes(KEY), JSON.stringify(seen));

  reply = { status: 200, body: [ns({ slug: "une-orga", ownerType: "team", installationId: 77, isAccessRestricted: true })] };
  r = await run(["--account", "une-orga"]);
  check("restricted, on an organisation: the organisation's installation settings to open", r.json?.status === "restricted" && r.json.configureUrl === "https://github.com/organizations/une-orga/settings/installations/77", r.out);

  reply = { status: 200, body: [ns({ slug: "quelqu-un-d-autre" })] };
  r = await run(["--account", "atelier"]);
  check("missing: Vercel's page that installs it", r.json?.status === "missing" && r.json.installUrl === INSTALL_URL, r.out);

  for (const [status, body, label] of [
    [401, { error: { code: "forbidden" } }, "a key Vercel refuses"],
    [500, { error: "boom" }, "a failure at Vercel"],
    [200, "<html>pas du JSON</html>", "an answer that is not JSON"],
  ]) {
    reply = { status, body };
    r = await run(["--account", "atelier"]);
    check(`${label}: not verifiable, said why, never installed`, r.code === 0 && r.json?.status === "unknown" && Boolean(r.json.reason) && r.json.installUrl === INSTALL_URL, r.out);
  }

  // ── Without what the check needs: said, and Vercel never called ─────────────
  reply = { status: 200, body: [ns()] };
  seen.length = 0;
  r = await run(["--account", "atelier"], { VERCEL_TOKEN: "" });
  check("no Vercel login on the machine: not verifiable, and nothing sent", r.json?.status === "unknown" && /vercel login/.test(r.json.reason ?? "") && seen.length === 0, r.out);

  const ghOk = join(WORK, "gh-ok.mjs");
  writeFileSync(ghOk, 'console.log("Atelier");\n');
  const ghOut = join(WORK, "gh-out.mjs");
  writeFileSync(ghOut, 'console.error("You are not logged into any GitHub hosts."); process.exit(1);\n');
  r = await run([], { HYPERVIBE_GH_BIN: ghOk });
  check("without --account, the account gh is signed in to", r.json?.status === "installed" && r.json.account === "atelier", r.out);
  seen.length = 0;
  r = await run([], { HYPERVIBE_GH_BIN: ghOut });
  check("... gh signed out: not verifiable, and Vercel never called", r.json?.status === "unknown" && /gh/.test(r.json.reason ?? "") && seen.length === 0, r.out);

  const alone = join(WORK, "seul");
  mkdirSync(alone, { recursive: true });
  copyFileSync(SCRIPT, join(alone, "vercel-github-app.mjs"));
  r = await run(["--account", "atelier", "--token-from", "vault"], {}, join(alone, "vercel-github-app.mjs"));
  check("the key from a vault this harness does not have: not verifiable, said (the recette never opens a real vault)", r.json?.status === "unknown" && /vault/.test(r.json.reason ?? ""), r.out);

  seen.length = 0;
  r = await run(["--account", "", "--token-from", "vault"], {}, join(alone, "vercel-github-app.mjs"));
  check("an organisation's name the vault did not give (--account \"\"): not verifiable, said, nothing sent", r.code === 0 && r.json?.status === "unknown" && /empty/.test(r.json.reason ?? "") && seen.length === 0, r.out + r.err);

  r = await run(["--compte", "atelier"]);
  check("an argument it does not know: exit 1, nothing checked", r.code === 1 && !r.json);
} finally {
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
