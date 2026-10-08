#!/usr/bin/env node
// test-watch-neon-org.mjs - The quota watch reads the right Neon organisation (3.4.8 / 2.4.7).
//
// Neon scopes its project listing to ONE organisation, and some accounts now get an outright
// refusal when none is named: 400 "org_id is required" (a participant's clock, 08/10/2026). The
// watch then read no database at all. The worker read config.neonOrgId, but nothing wrote it.
// What must hold:
//   1. the rule (watchNeonOrg): a certain organisation is written (the vault's, the only one), an
//      organisation key needs none, several are never guessed among, an unreachable Neon writes
//      nothing and never takes a recorded one away, and what cannot be decided says its remedy;
//   2. register.mjs writes it at registration, says the outcome in its JSON and prints the remedy,
//      and an organisation that could not be read never blocks the registration;
//   3. ensure.mjs completes a watch registered before the fix, the update path (worker-check.mjs)
//      included; its dry run says so first (the skills only run the real command when the dry run
//      asks for it), and a watch that names one is never looked at again.
// No network, no vault, no Cloudflare: the scripts run with a home folder of their own (no vault
// session there, so the vault reads as locked), a fake Neon key in their environment, and
// _fake-net.mjs, which answers for Neon and Cloudflare from a scenario and refuses every other
// address. The clock lives in a temporary folder, its git without this machine's configuration.
//
//   node scripts/tests/test-watch-neon-org.mjs

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKER_DIR = join(ROOT, "scripts", "shared-worker");
const { watchNeonOrg, resolveWatchNeonOrg, quotaJobsWithoutNeonOrg } = await import(pathToFileURL(join(WORKER_DIR, "_lib.mjs")).href);
const { resetNeonOrgCache } = await import(pathToFileURL(join(ROOT, "scripts", "neon-org.mjs")).href);

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 600)})`}`);
}

const ORGS = [
  { id: "org-alpha", name: "Alpha" },
  { id: "org-beta", name: "Beta" },
];
const VAULT_REMEDY = /élément NEON, champ org_id/;

console.log("── La règle : ce que la veille enregistre ──");
{
  const r = watchNeonOrg({ orgId: "org-coffre", source: "vault", orgs: [] });
  check("celle du coffre est écrite", r.status === "set" && r.neonOrgId === "org-coffre");
}
{
  const r = watchNeonOrg({ orgId: "org-seule", source: "unique", orgs: [{ id: "org-seule", name: "Seule" }] });
  check("la seule du compte est écrite", r.status === "set" && r.neonOrgId === "org-seule");
}
{
  const r = watchNeonOrg({ orgId: "org-nouvelle", source: "vault", orgs: [] }, "org-ancienne");
  check("une organisation certaine remplace celle que la veille portait", r.status === "set" && r.neonOrgId === "org-nouvelle");
}
{
  const r = watchNeonOrg({ orgId: null, source: "cle-org", orgs: [] });
  check("une clé d'organisation n'en a pas besoin : rien d'écrit, rien à faire", r.status === "not-needed" && r.neonOrgId === null && !r.remedy);
}
{
  const r = watchNeonOrg({ orgId: null, source: "ambigu", orgs: ORGS });
  check("plusieurs organisations : rien d'écrit, jamais la première", r.status === "undecided" && r.neonOrgId === null);
  check(
    "... et le remède les nomme toutes, dit où ranger l'identifiant (NEON, org_id) et quoi relancer (/quotas)",
    ORGS.every((o) => r.remedy?.includes(o.id) && r.remedy.includes(o.name)) && VAULT_REMEDY.test(r.remedy ?? "") && (r.remedy ?? "").includes("/quotas"),
    r.remedy,
  );
}
{
  const r = watchNeonOrg({ orgId: null, source: "aucune", orgs: [] });
  check(
    "aucune organisation : rien d'écrit, le même remède, et où trouver l'identifiant",
    r.status === "undecided" && r.neonOrgId === null && VAULT_REMEDY.test(r.remedy ?? "") && (r.remedy ?? "").includes("/quotas") && (r.remedy ?? "").includes("Organization settings"),
    r.remedy,
  );
}
{
  const r = watchNeonOrg({ orgId: null, source: "injoignable", orgs: [] });
  check("Neon injoignable : rien d'écrit, et il faudra relancer", r.status === "unreadable" && r.neonOrgId === null && /Relance \/quotas/.test(r.remedy ?? ""), r.remedy);
}
{
  const kept = ["injoignable", "ambigu", "aucune", "cle-org", "cle-absente"].filter((source) => {
    const r = watchNeonOrg({ orgId: null, source, orgs: source === "ambigu" ? ORGS : [] }, "org-connue");
    return !(r.status === "kept" && r.neonOrgId === "org-connue" && !r.remedy);
  });
  check("une réponse qui n'est pas certaine n'enlève jamais l'organisation que la veille porte déjà", kept.length === 0, kept.join(", "));
}
{
  const r = watchNeonOrg({ orgId: null, source: "cle-absente", orgs: [] });
  check("pas de clé Neon : rien d'écrit, rien à dire", r.status === "no-key" && r.neonOrgId === null && !r.remedy);
}
check(
  "les veilles sans organisation, et elles seules",
  quotaJobsWithoutNeonOrg({
    jobs: [
      { kind: "quota", name: "quota-monitor", config: {} },
      { kind: "quota", name: "nommee", config: { neonOrgId: "org-x" } },
      { kind: "snapshot", name: "neon-backups", targets: [] },
      { kind: "quota", name: "sans-config" },
    ],
  })
    .map((j) => j.name)
    .join(",") === "quota-monitor,sans-config",
);

console.log("\n── La lecture, sans coffre ni réseau ──");
{
  let asked = 0;
  const r = await resolveWatchNeonOrg(null, {
    readKey: () => "",
    resolve: async () => {
      asked += 1;
      return { orgId: "org-x", source: "unique", orgs: [] };
    },
  });
  check("sans clé Neon, Neon n'est pas interrogé", r.status === "no-key" && asked === 0);
}
{
  resetNeonOrgCache();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("pas de reseau en recette");
  };
  try {
    const r = await resolveWatchNeonOrg(null, {
      readKey: () => "cle-de-recette",
      vaultGet: (item, field) => (item === "NEON" && field === "org_id" ? "org-du-coffre" : ""),
    });
    check("l'organisation rangée au coffre gagne, sans interroger Neon", r.status === "set" && r.source === "vault" && r.neonOrgId === "org-du-coffre" && calls === 0, JSON.stringify(r));
  } finally {
    globalThis.fetch = realFetch;
    resetNeonOrgCache();
  }
}
{
  const r = await resolveWatchNeonOrg("org-connue", {
    readKey: () => "cle-de-recette",
    resolve: async () => {
      throw new Error("boom");
    },
  });
  check("une lecture qui casse ne casse rien : l'organisation connue reste", r.status === "kept" && r.neonOrgId === "org-connue");
}

// ── The scripts, launched for real against a fake Neon and a fake Cloudflare ──
const REGISTER = join(WORKER_DIR, "register.mjs");
const ENSURE = join(WORKER_DIR, "ensure.mjs");
const WORKER_CHECK = join(WORKER_DIR, "worker-check.mjs");
const FAKE_NET = pathToFileURL(join(ROOT, "scripts", "tests", "_fake-net.mjs")).href;
const NEON_ORGS = "https://console.neon.tech/api/v2/users/me/organizations";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const WORKER_SRC = readFileSync(join(WORKER_DIR, "worker.js"), "utf8");

const UNIQUE = { status: 200, body: { organizations: [{ id: "org-seule", name: "Seule" }] } };
const SEVERAL = { status: 200, body: { organizations: ORGS } };
const NONE = { status: 200, body: { organizations: [] } };
const ORG_KEY = { status: 403, body: { message: "not allowed for organization keys" } };
const DOWN = { status: 503, body: {} };

/** Neon answers its organisations endpoint with `neon`; on Cloudflare, the clock is deployed. */
function scenario(neon) {
  return [
    [NEON_ORGS, neon],
    [`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/services/`, { status: 200, body: { success: true, result: {} } }],
    [`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/subdomain`, { status: 200, body: { success: true, result: { subdomain: "recette" } } }],
    ["https://api.cloudflare.com/client/v4/accounts", { status: 200, body: { success: true, result: [{ id: ACCOUNT }] } }],
  ];
}

const racine = mkdtempSync(join(tmpdir(), "hv-watch-org-"));
const home = join(racine, "maison");
mkdirSync(home);
const gitconfig = join(racine, "gitconfig");
writeFileSync(gitconfig, "");
let serial = 0;

/** A script of the clock, launched with a home of its own, a fake Neon key and a fake network. */
function launch(script, args, neon) {
  serial += 1;
  const log = join(racine, `reseau-${serial}.log`);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "appdata"),
    LOCALAPPDATA: join(home, "localappdata"),
    XDG_DATA_HOME: join(home, "appdata"),
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    // Read only because the vault is locked here (no session in this home), never sent anywhere.
    NEON_API_KEY: "cle-neon-de-recette",
    CLOUDFLARE_API_TOKEN: "jeton-cloudflare-de-recette",
    HV_RECETTE_NET: JSON.stringify(scenario(neon)),
    HV_RECETTE_NET_LOG: log,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${FAKE_NET}`].filter(Boolean).join(" "),
  };
  for (const name of ["NEON_ORG_ID", "CF_API_TOKEN", "BREVO_API_KEY", "RESEND_API_KEY", "HYPERVIBE_JOBS_DIR", "HYPERVIBE_JOBS_NAME"]) delete env[name];
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env, cwd: racine });
  let json = null;
  try {
    json = JSON.parse((r.stdout || "").trim().split("\n").pop());
  } catch {
    // Left null: the checks below show the raw output.
  }
  const net = existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { code: r.status, json, stderr: r.stderr || "", raw: `${r.stdout || ""}${r.stderr || ""}`.trim(), net };
}

/** A clock folder holding `jobs` in its registry. */
function clock(jobs = []) {
  const dir = mkdtempSync(join(racine, "horloge-"));
  writeFileSync(join(dir, "jobs.js"), `export default ${JSON.stringify({ version: 1, jobs }, null, 2)};\n`);
  return dir;
}
/** The same, scaffolded as ensure.mjs leaves it: in step with the plugin unless `worker` says otherwise. */
function scaffoldedClock(jobs, worker = WORKER_SRC) {
  const dir = clock(jobs);
  writeFileSync(
    join(dir, "wrangler.toml"),
    ['name = "hypervibe-jobs"', 'main = "worker.js"', `account_id = "${ACCOUNT}"`, "workers_dev = true", "", "[triggers]", 'crons = ["* * * * *"]', ""].join("\n"),
  );
  writeFileSync(join(dir, "worker.js"), worker);
  return dir;
}
const registryOf = (dir) => JSON.parse(/export default\s*([\s\S]*?);?\s*$/.exec(readFileSync(join(dir, "jobs.js"), "utf8"))[1]);
const watchOf = (dir) => registryOf(dir).jobs.find((j) => j.name === "quota-monitor");
const register = (dir, neon) =>
  launch(
    REGISTER,
    ["--dir", dir, "--kind", "quota", "--recipient", "alerte@recette.test", "--sender-email", "veille@recette.test", "--email-provider", "brevo", "--account-id", ACCOUNT, "--no-deploy", "--no-commit"],
    neon,
  );
const askedNeon = (net) => net.filter((c) => c.url.startsWith("https://console.neon.tech"));

try {
  console.log("\n── register.mjs, à l'enregistrement de la veille ──");
  {
    const dir = clock();
    const r = register(dir, UNIQUE);
    check("une seule organisation : la veille est enregistrée avec elle", r.json?.ok === true && watchOf(dir)?.config?.neonOrgId === "org-seule", r.raw);
    check("... et la sortie le dit", r.json?.neonOrg?.status === "set" && r.json.neonOrg.neonOrgId === "org-seule" && r.json.neonOrg.source === "unique", r.raw);
    check("... Neon n'a été interrogé que sur ses organisations, rien d'autre n'a été appelé", r.net.length > 0 && r.net.every((c) => c.url === NEON_ORGS), JSON.stringify(r.net));
  }
  {
    const dir = clock();
    const r = register(dir, SEVERAL);
    const watch = watchOf(dir);
    check("plusieurs organisations : la veille est enregistrée quand même", r.json?.ok === true && watch?.config?.recipient === "alerte@recette.test", r.raw);
    check("... sans organisation, ni la première ni une autre", Boolean(watch) && !("neonOrgId" in watch.config), JSON.stringify(watch?.config));
    check(
      "... la sortie dit pourquoi et donne le remède (les deux nommées, le coffre, /quotas)",
      r.json?.neonOrg?.status === "undecided" && r.json.neonOrg.source === "ambigu" && VAULT_REMEDY.test(r.json.neonOrg.remedy ?? "") && r.json.neonOrg.remedy.includes("org-alpha") && r.json.neonOrg.remedy.includes("org-beta"),
      r.raw,
    );
    check("... et le remède est affiché", VAULT_REMEDY.test(r.stderr), r.stderr.slice(-400));
  }
  {
    const dir = clock();
    const r = register(dir, NONE);
    check(
      "aucune organisation : rien d'écrit, le remède dit",
      r.json?.ok === true && !("neonOrgId" in (watchOf(dir)?.config ?? {})) && r.json?.neonOrg?.status === "undecided" && r.json.neonOrg.source === "aucune" && VAULT_REMEDY.test(r.stderr),
      r.raw,
    );
  }
  {
    const dir = clock();
    const r = register(dir, ORG_KEY);
    check(
      "clé d'organisation : rien d'écrit, rien à faire",
      r.json?.ok === true && !("neonOrgId" in (watchOf(dir)?.config ?? {})) && r.json?.neonOrg?.status === "not-needed" && !r.json.neonOrg.remedy,
      r.raw,
    );
  }
  {
    const dir = clock();
    const r = register(dir, DOWN);
    check("Neon injoignable : l'enregistrement n'est pas bloqué", r.json?.ok === true && watchOf(dir)?.config?.recipient === "alerte@recette.test", r.raw);
    check(
      "... rien d'écrit, et la sortie dit qu'il faudra relancer",
      !("neonOrgId" in (watchOf(dir)?.config ?? {})) && r.json?.neonOrg?.status === "unreadable" && /Relance \/quotas/.test(r.json.neonOrg.remedy ?? ""),
      r.raw,
    );
  }
  {
    const dir = clock();
    const r = register(dir, "reseau");
    check("réseau coupé : la veille est enregistrée, sans organisation", r.json?.ok === true && !("neonOrgId" in (watchOf(dir)?.config ?? {})) && r.json?.neonOrg?.status === "unreadable", r.raw);
  }
  {
    const before = { kind: "quota", name: "quota-monitor", cron: "0 6 * * *", config: { recipient: "ancien@recette.test", senderEmail: "veille@recette.test", neonOrgId: "org-connue" } };
    const dir = clock([before]);
    const r = register(dir, DOWN);
    check(
      "réenregistrée un jour où Neon ne répond pas, la veille garde son organisation (et prend le reste des nouvelles valeurs)",
      r.json?.ok === true && watchOf(dir)?.config?.neonOrgId === "org-connue" && r.json?.neonOrg?.status === "kept" && watchOf(dir)?.config?.recipient === "alerte@recette.test",
      r.raw,
    );
    const again = clock([{ ...before, config: { ...before.config, neonOrgId: "org-ancienne" } }]);
    const r2 = register(again, UNIQUE);
    check("... et prend la nouvelle quand elle est certaine", r2.json?.ok === true && watchOf(again)?.config?.neonOrgId === "org-seule", r2.raw);
  }

  console.log("\n── ensure.mjs, sur une veille enregistrée avant le correctif ──");
  const WATCH = {
    kind: "quota",
    name: "quota-monitor",
    cron: "0 6 * * *",
    config: { cloudflareAccountId: ACCOUNT, recipient: "alerte@recette.test", senderEmail: "veille@recette.test", senderName: "Hypervibe", emailProvider: "brevo", r2ThresholdGb: 9 },
  };
  const BACKUPS = { kind: "snapshot", name: "neon-backups", cron: "0 3 1,15 * *", targets: [{ name: "app", projectId: "pid-1" }] };
  const REASON = /the quota watch names no Neon organisation/;
  {
    const dir = scaffoldedClock([WATCH, BACKUPS]);
    const before = readFileSync(join(dir, "jobs.js"), "utf8");
    const r = launch(ENSURE, ["--dir", dir, "--dry-run"], UNIQUE);
    check(
      "essai à blanc : une veille sans organisation est une raison de lancer la vraie commande",
      r.json?.ok === true && r.json.status === "would-deploy" && (r.json.reasons ?? []).some((x) => REASON.test(x) && x.includes("org-seule")),
      r.raw,
    );
    check("... qui dit ce qu'elle enregistrerait", r.json?.neonOrg?.status === "set" && r.json.neonOrg.neonOrgId === "org-seule", r.raw);
    check("... et l'essai ne change rien", readFileSync(join(dir, "jobs.js"), "utf8") === before);
  }
  {
    const dir = scaffoldedClock([WATCH]);
    const r = launch(ENSURE, ["--dir", dir, "--dry-run"], SEVERAL);
    check("essai à blanc, plusieurs organisations : aucune raison de redéployer pour elle", r.json?.ok === true && !(r.json.reasons ?? []).some((x) => REASON.test(x)), r.raw);
    check("... mais le remède est dans la réponse, pour que la skill le dise", r.json?.neonOrg?.status === "undecided" && VAULT_REMEDY.test(r.json.neonOrg.remedy ?? ""), r.raw);
  }
  {
    const dir = scaffoldedClock([{ ...WATCH, config: { ...WATCH.config, neonOrgId: "org-connue" } }]);
    const r = launch(ENSURE, ["--dir", dir, "--dry-run"], UNIQUE);
    check(
      "une veille qui nomme son organisation n'est plus regardée : Neon n'est pas interrogé, rien n'est dit",
      r.json?.ok === true && !("neonOrg" in r.json) && askedNeon(r.net).length === 0 && !(r.json.reasons ?? []).some((x) => REASON.test(x)),
      r.raw,
    );
  }
  {
    const dir = scaffoldedClock([BACKUPS]);
    const r = launch(ENSURE, ["--dir", dir, "--dry-run"], UNIQUE);
    check("une horloge sans veille des quotas : Neon n'est pas interrogé", r.json?.ok === true && !("neonOrg" in r.json) && askedNeon(r.net).length === 0, r.raw);
  }

  // The real run needs wrangler on the machine (ensure.mjs checks it first, even with --no-deploy).
  const wrangler = spawnSync("wrangler --version", { shell: true, encoding: "utf8" });
  if (wrangler.status !== 0) {
    console.log("SKIP la vraie commande et la mise à jour : wrangler n'est pas installé sur cette machine (ensure.mjs l'exige)");
  } else {
    {
      const dir = scaffoldedClock([WATCH, BACKUPS]);
      const r = launch(ENSURE, ["--dir", dir, "--no-deploy"], UNIQUE);
      const watch = watchOf(dir);
      check("vraie commande : la veille d'avant le correctif reçoit son organisation", r.json?.ok === true && watch?.config?.neonOrgId === "org-seule", r.raw);
      check(
        "... le reste de sa configuration intact, et les sauvegardes non touchées",
        watch?.config?.recipient === "alerte@recette.test" && watch.config.r2ThresholdGb === 9 && JSON.stringify(registryOf(dir).jobs.find((j) => j.kind === "snapshot")) === JSON.stringify(BACKUPS),
        JSON.stringify(registryOf(dir)),
      );
      check("... c'est dit dans healed, et la sortie porte le résultat", (r.json?.healed ?? []).some((h) => h.includes("org-seule")) && r.json?.neonOrg?.status === "set", r.raw);
      const history = spawnSync("git", ["log", "--format=%s"], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" } });
      check("... et versionné dans le dépôt de l'horloge", /the quota watch reads the Neon organisation org-seule/.test(history.stdout || ""), `${history.stdout || ""}${history.stderr || ""}`);
      const again = launch(ENSURE, ["--dir", dir, "--no-deploy"], UNIQUE);
      check(
        "une deuxième passe ne relit ni ne réécrit rien",
        again.json?.ok === true && !("neonOrg" in again.json) && (again.json.healed ?? []).length === 0 && askedNeon(again.net).length === 0,
        again.raw,
      );
    }
    {
      const dir = scaffoldedClock([WATCH]);
      const before = readFileSync(join(dir, "jobs.js"), "utf8");
      const r = launch(ENSURE, ["--dir", dir, "--no-deploy"], SEVERAL);
      check("vraie commande, plusieurs organisations : rien d'écrit", r.json?.ok === true && readFileSync(join(dir, "jobs.js"), "utf8") === before, r.raw);
      check("... et le remède dans la sortie", r.json?.neonOrg?.status === "undecided" && VAULT_REMEDY.test(r.json.neonOrg.remedy ?? ""), r.raw);
    }
    {
      // The update path: /update-hypervibe runs worker-check.mjs on a clock behind the plugin, and
      // worker-check.mjs repairs it through ensure.mjs.
      const stale = `${WORKER_SRC}\n// une version plus ancienne\n`;
      const dir = scaffoldedClock([WATCH], stale);
      const r = launch(WORKER_CHECK, ["--dir", dir, "--no-deploy"], UNIQUE);
      check(
        "la mise à jour répare l'horloge et la veille d'un coup",
        r.json?.status === "updated" && (r.json.healed ?? []).some((h) => h.includes("org-seule")) && watchOf(dir)?.config?.neonOrgId === "org-seule",
        r.raw,
      );
      check("... et transmet le résultat à la skill", r.json?.neonOrg?.status === "set", r.raw);
      const undecided = scaffoldedClock([WATCH], stale);
      const r2 = launch(WORKER_CHECK, ["--dir", undecided, "--no-deploy"], SEVERAL);
      check(
        "... ou son remède, quand l'organisation ne se décide pas",
        r2.json?.status === "updated" && r2.json?.neonOrg?.status === "undecided" && VAULT_REMEDY.test(r2.json.neonOrg.remedy ?? "") && !("neonOrgId" in (watchOf(undecided)?.config ?? {})),
        r2.raw,
      );
    }
  }
} finally {
  rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
}

check("la recette est branchée dans run-all.mjs", readFileSync(join(ROOT, "scripts", "tests", "run-all.mjs"), "utf8").includes("test-watch-neon-org.mjs"));

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
