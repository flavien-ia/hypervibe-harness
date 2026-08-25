#!/usr/bin/env node
// manifest.mjs - The project resource manifest: `.hypervibe/resources.json`.
//
// WHY THIS FILE EXISTS
// --------------------
// Backups (/save-project) and deletion (/delete-project) used to rediscover a
// project's cloud resources by matching resource names against the project
// name. That is an inference, and it fails silently in both directions: a
// bucket named differently from the project is not found (a backup ships
// without a single file while reporting success), and a resource of ANOTHER
// project could match (a deletion sweeps up someone else's data - the strict
// token matching in `_match.mjs` exists to prevent exactly that).
//
// Yet at the moment a resource is CREATED, its identity is known with
// certainty. This manifest keeps that certainty instead of throwing it away:
// every `/add-*` skill records what it provisions, and save/delete read the
// manifest FIRST, falling back to name-matching only for what predates it.
//
// The manifest is the PRIMARY source, never the ONLY source: consumers must
// still scan the real accounts and surface the difference (declared but
// missing, present but undeclared). A declaration is not the reality.
//
// CONTENT RULES
// -------------
// - Identifiers only (ids, names, hosts, jurisdictions). NEVER secrets: no
//   tokens, keys, passwords, connection strings. The CLI refuses them.
// - Versioned with the code (do NOT gitignore `.hypervibe/`): the manifest
//   documents the project's infrastructure for humans too.
// - `shared: true` marks infrastructure used by several projects (e.g. the
//   `hypervibe-jobs` worker): consumers must NEVER delete a shared resource
//   when deleting one project.
//
// USAGE
// -----
//   node manifest.mjs add    --project-dir <dir> --kind <kind> --name <name>
//                            [--id <id>] [--field k=v ...] [--added-by <skill>]
//                            [--shared] [--note "<text>"]
//   node manifest.mjs remove --project-dir <dir> --kind <kind> (--name <n> | --id <id>)
//   node manifest.mjs list   --project-dir <dir> [--kind <kind>]
//   node manifest.mjs adopt  --project-dir <dir> [--write]
//
// `add` is an upsert (re-running updates the entry in place), so skills can
// call it unconditionally. Every command prints one JSON object on stdout.
//
// KINDS (aligned with the /delete-project scans)
// ----------------------------------------------
//   vercel-project, neon-project, r2-bucket, cf-worker, dns-zone,
//   render-service, stripe-webhook, upstash-db, cron-job, db-backup,
//   email-route, github-repo
// Unknown kinds are accepted (forward compatibility) but flagged in output.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KNOWN_KINDS = [
  "vercel-project", "neon-project", "r2-bucket", "cf-worker", "dns-zone",
  "render-service", "stripe-webhook", "upstash-db", "cron-job", "db-backup",
  "email-route", "github-repo",
];

// --- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const command = args[0];
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
function flag(name) {
  return args.includes(name);
}
function fields() {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--field") {
      const raw = String(args[i + 1] || "");
      const eq = raw.indexOf("=");
      if (eq > 0) out[raw.slice(0, eq)] = raw.slice(eq + 1);
    }
  }
  return out;
}

const PROJECT_DIR = resolve(arg("--project-dir") || process.cwd());
const FILE = join(PROJECT_DIR, ".hypervibe", "resources.json");

function fail(reason, extra = {}) {
  console.log(JSON.stringify({ ok: false, reason, ...extra }));
  process.exit(1);
}

// --- secret guard ----------------------------------------------------------
// The manifest holds identifiers, never credentials. Refuse loudly rather
// than letting a secret slip into a file that is committed to git.
const SECRET_FIELD_RE = /secret|password|passwd|token|credential|api.?key|private/i;
const SECRET_VALUE_RES = [
  /^(sk|rk|pk)[-_](live|test|proj|svcacct|admin)[-_]?[A-Za-z0-9]{8,}/, // Stripe/OpenAI-style keys
  /^sk-[A-Za-z0-9_-]{16,}/,
  /^whsec_/,
  /^re_[A-Za-z0-9_]{16,}/,
  /^xkeysib-/,
  /^tsk_[A-Za-z0-9]{8,}/,
  /^AIza[A-Za-z0-9_-]{20,}/,
  /^ey[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{5,}/,
  /^(postgres(ql)?|mysql|redis|rediss|amqp):\/\/[^\s]*:[^\s]*@/,
  /-----BEGIN [A-Z ]*KEY-----/,
  /^AKIA[A-Z0-9]{12,}/,
];
function assertNoSecret(key, value) {
  if (SECRET_FIELD_RE.test(key)) {
    fail(`field name "${key}" looks like a credential - the manifest stores identifiers only`);
  }
  const v = String(value);
  for (const re of SECRET_VALUE_RES) {
    if (re.test(v)) {
      fail(`value of "${key}" looks like a secret - the manifest stores identifiers only`);
    }
  }
}

// --- load / save -----------------------------------------------------------
function load() {
  if (!existsSync(FILE)) return null;
  try {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    if (!Array.isArray(m.resources)) m.resources = [];
    return m;
  } catch (e) {
    fail(`could not parse ${FILE}: ${e.message} - fix or delete the file first`, { file: FILE });
  }
}
function projectNameFromPackageJson() {
  try {
    return JSON.parse(readFileSync(join(PROJECT_DIR, "package.json"), "utf8")).name || null;
  } catch {
    return null;
  }
}
function save(manifest) {
  manifest.updatedAt = new Date().toISOString();
  // Stable order: one resource added should produce a one-line git diff, not
  // a reshuffle of the whole file.
  manifest.resources.sort(
    (a, b) =>
      String(a.kind).localeCompare(String(b.kind)) ||
      String(a.id ?? a.name ?? "").localeCompare(String(b.id ?? b.name ?? "")),
  );
  mkdirSync(join(PROJECT_DIR, ".hypervibe"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
function emptyManifest() {
  return {
    version: 1,
    project: projectNameFromPackageJson(),
    about:
      "Cloud resources this project owns, recorded when they are created. " +
      "Read by /save-project and /delete-project. Identifiers only - never secrets.",
    updatedAt: null,
    resources: [],
  };
}

// Identity of a resource inside the manifest: kind + id when both sides have
// one, kind + name (+ jurisdiction for R2, where the same name can exist in
// two separate namespaces) otherwise.
function sameResource(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.id && b.id) return a.id === b.id;
  if (a.name && b.name && a.name === b.name) {
    if (a.kind === "r2-bucket") {
      return (a.jurisdiction || "default") === (b.jurisdiction || "default");
    }
    return true;
  }
  return false;
}

// --- add -------------------------------------------------------------------
function cmdAdd() {
  const kind = arg("--kind");
  const name = arg("--name");
  const id = arg("--id");
  if (!kind || (!name && !id)) fail("add needs --kind and --name (or --id)");
  const extra = fields();
  for (const [k, v] of Object.entries(extra)) assertNoSecret(k, v);
  if (name) assertNoSecret("name", name);
  if (id) assertNoSecret("id", id);

  const entry = {
    kind,
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...extra,
    ...(flag("--shared") ? { shared: true } : {}),
    ...(arg("--note") ? { note: arg("--note") } : {}),
    addedBy: arg("--added-by") || "manual",
    addedAt: new Date().toISOString().slice(0, 10),
  };

  const manifest = load() || emptyManifest();
  const existing = manifest.resources.findIndex((r) => sameResource(r, entry));
  let action;
  let stored;
  if (existing >= 0) {
    const before = manifest.resources[existing];
    // Update in place but keep the original provenance: who first created the
    // resource is history, not something a re-run should rewrite.
    stored = { ...before, ...entry, addedBy: before.addedBy, addedAt: before.addedAt };
    action = JSON.stringify(stored) === JSON.stringify(before) ? "unchanged" : "updated";
    manifest.resources[existing] = stored;
  } else {
    manifest.resources.push(entry);
    stored = entry;
    action = "added";
  }
  if (action !== "unchanged") save(manifest);
  console.log(
    JSON.stringify({
      ok: true,
      action,
      resource: stored,
      file: FILE,
      ...(KNOWN_KINDS.includes(kind) ? {} : { warning: `unknown kind "${kind}" (accepted, but check for a typo)` }),
    }),
  );
}

// --- remove ----------------------------------------------------------------
function cmdRemove() {
  const kind = arg("--kind");
  const name = arg("--name");
  const id = arg("--id");
  if (!kind || (!name && !id)) fail("remove needs --kind and --name (or --id)");
  const manifest = load();
  if (!manifest) fail("no manifest file", { file: FILE });
  const probe = {
    kind,
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(arg("--jurisdiction") ? { jurisdiction: arg("--jurisdiction") } : {}),
  };
  const before = manifest.resources.length;
  manifest.resources = manifest.resources.filter((r) => !sameResource(r, probe));
  if (manifest.resources.length === before) {
    fail("resource not found in manifest", { file: FILE });
  }
  save(manifest);
  console.log(
    JSON.stringify({ ok: true, action: "removed", removed: before - manifest.resources.length, file: FILE }),
  );
}

// --- list ------------------------------------------------------------------
function cmdList() {
  const manifest = load();
  if (!manifest) {
    console.log(JSON.stringify({ ok: true, exists: false, file: FILE, resources: [] }));
    return;
  }
  const kind = arg("--kind");
  const resources = kind ? manifest.resources.filter((r) => r.kind === kind) : manifest.resources;
  console.log(
    JSON.stringify({ ok: true, exists: true, file: FILE, project: manifest.project, resources }),
  );
}

// --- adopt -----------------------------------------------------------------
// Deterministic adoption for projects that predate the manifest: derive
// resources from the project's OWN identifiers (env vars, .vercel link,
// wrangler.toml, git remote) - never from name similarity. Name-based
// discovery stays where it belongs: in /delete-project's scans, presented to
// a human for validation.
function readEnvFile(file) {
  const out = {};
  try {
    for (const line of readFileSync(join(PROJECT_DIR, file), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* absent */
  }
  return out;
}

async function neonProjectByHost(host) {
  // The connection host pins the project with certainty - resolve id + name
  // through the API when a key is available, by checking each project's
  // endpoints. One-time cost, adoption only.
  let apiKey = "";
  try {
    const { getSecret } = await import("../vault/vault.mjs");
    apiKey = getSecret("NEON", "api_key");
  } catch {
    /* vault unavailable */
  }
  if (!apiKey) {
    const r = spawnSync("node", [join(__dirname, "..", "_read-user-env.mjs"), "NEON_API_KEY"], {
      encoding: "utf8",
    });
    apiKey = (r.stdout || "").trim();
  }
  if (!apiKey) return null;
  // Pooled connection strings carry a `-pooler` infix that the endpoints API
  // does not: `ep-x-pooler.c-2...` and `ep-x.c-2...` are the same endpoint.
  const cible = host.replace("-pooler.", ".");
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const list = await (
      await fetch("https://console.neon.tech/api/v2/projects?limit=200", { headers })
    ).json();
    const projects = list.projects || [];
    const checks = await Promise.all(
      projects.map(async (p) => {
        try {
          const eps = await (
            await fetch(`https://console.neon.tech/api/v2/projects/${p.id}/endpoints`, { headers })
          ).json();
          const hosts = (eps.endpoints || []).map((e) => e.host);
          return hosts.includes(cible) ? { id: p.id, name: p.name } : null;
        } catch {
          return null;
        }
      }),
    );
    return checks.find(Boolean) || null;
  } catch {
    return null;
  }
}

async function cmdAdopt() {
  const found = [];
  const env = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };

  // Vercel: the link file carries the exact ids.
  try {
    const link = JSON.parse(readFileSync(join(PROJECT_DIR, ".vercel", "project.json"), "utf8"));
    if (link.projectId) {
      found.push({
        resource: {
          kind: "vercel-project",
          id: link.projectId,
          ...(link.orgId ? { orgId: link.orgId } : {}),
        },
        source: ".vercel/project.json",
      });
    }
  } catch {
    /* not linked */
  }

  // Neon: the DATABASE_URL host pins the project. Resolve id+name via API
  // when possible; otherwise record the host alone (still an identifier).
  const dbUrl = env.DATABASE_URL || env.POSTGRES_URL || "";
  const hostMatch = /@([a-z0-9.-]+\.neon\.tech)\b/.exec(dbUrl);
  if (hostMatch) {
    const resolved = await neonProjectByHost(hostMatch[1]);
    found.push({
      resource: {
        kind: "neon-project",
        ...(resolved ? { id: resolved.id, name: resolved.name } : {}),
        host: hostMatch[1],
      },
      source: resolved
        ? "DATABASE_URL host, resolved via Neon API"
        : "DATABASE_URL host (id unresolved: no Neon API key)",
    });
  }

  // R2: bucket name + jurisdiction are spelled out by the env.
  if (env.R2_BUCKET_NAME) {
    const jurisdiction = /\.eu\.r2\.cloudflarestorage\.com/.test(env.R2_ENDPOINT || "")
      ? "eu"
      : "default";
    found.push({
      resource: { kind: "r2-bucket", name: env.R2_BUCKET_NAME, jurisdiction },
      source: "R2_BUCKET_NAME / R2_ENDPOINT",
    });
  }

  // Upstash: the REST host identifies the database.
  const upstash = /https?:\/\/([a-z0-9-]+\.upstash\.io)/.exec(env.UPSTASH_REDIS_REST_URL || "");
  if (upstash) {
    found.push({ resource: { kind: "upstash-db", name: upstash[1] }, source: "UPSTASH_REDIS_REST_URL" });
  }

  // Dedicated worker: wrangler.toml names it.
  try {
    const toml = readFileSync(join(PROJECT_DIR, "wrangler.toml"), "utf8");
    const m = /^\s*name\s*=\s*"([^"]+)"/m.exec(toml);
    if (m) found.push({ resource: { kind: "cf-worker", name: m[1] }, source: "wrangler.toml" });
  } catch {
    /* none */
  }

  // GitHub: the origin remote.
  const remote = spawnSync("git", ["-C", PROJECT_DIR, "config", "--get", "remote.origin.url"], {
    encoding: "utf8",
  });
  const gh = /github\.com[:/]([^/]+\/[^/.\s]+)/.exec((remote.stdout || "").trim());
  if (gh) found.push({ resource: { kind: "github-repo", name: gh[1] }, source: "git remote origin" });

  // Custom domain: the public app URL names the zone. Naive apex (last two
  // labels) - fine for .fr/.com/.io; a co.uk-style TLD needs a manual fix.
  const appUrl = env.NEXT_PUBLIC_APP_URL || env.APP_URL || "";
  try {
    const host = new URL(appUrl).hostname;
    if (host && !/\.vercel\.app$|localhost/.test(host)) {
      const apex = host.split(".").slice(-2).join(".");
      found.push({ resource: { kind: "dns-zone", name: apex }, source: "NEXT_PUBLIC_APP_URL" });
    }
  } catch {
    /* no usable URL */
  }

  const write = flag("--write");
  if (write && found.length) {
    const manifest = load() || emptyManifest();
    let added = 0;
    for (const f of found) {
      const entry = { ...f.resource, addedBy: "adopt", addedAt: new Date().toISOString().slice(0, 10) };
      const i = manifest.resources.findIndex((r) => sameResource(r, entry));
      if (i >= 0) {
        manifest.resources[i] = {
          ...manifest.resources[i],
          ...entry,
          addedBy: manifest.resources[i].addedBy,
          addedAt: manifest.resources[i].addedAt,
        };
      } else {
        manifest.resources.push(entry);
        added++;
      }
    }
    save(manifest);
    console.log(JSON.stringify({ ok: true, action: "adopted", found, added, file: FILE }));
    return;
  }
  console.log(
    JSON.stringify({ ok: true, action: "dry-run", found, file: FILE, hint: "re-run with --write to record" }),
  );
}

// --- dispatch --------------------------------------------------------------
if (command === "add") cmdAdd();
else if (command === "remove") cmdRemove();
else if (command === "list") cmdList();
else if (command === "adopt") await cmdAdopt();
else fail("usage: manifest.mjs <add|remove|list|adopt> --project-dir <dir> ...");
