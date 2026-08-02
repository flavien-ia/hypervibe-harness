#!/usr/bin/env node
// download-r2.mjs - Download all objects from the project's Cloudflare R2 storage.
//
// Usage:
//   node download-r2.mjs --project <name> --out-dir <dir> [--project-dir <path>]
//
// PRIMARY MODE (S3 API) - authoritative.
//   Reads R2_BUCKET_NAME / R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
//   from the project's .env. The bucket name is arbitrary (it is NOT always
//   `<project>`) and the endpoint already encodes the jurisdiction (EU or not),
//   so nothing has to be guessed. Objects are downloaded concurrently, which is
//   dramatically faster than spawning one CLI process per object.
//
// FALLBACK MODE (Cloudflare REST API) - when .env holds no R2 credentials.
//   The account API token (vault) is enough to LIST (`GET /r2/buckets/{b}/objects`,
//   cursor-paginated) and READ (`GET .../objects/{key}`) every object, so a
//   snapshot is still complete without the S3 key pair. Buckets are matched by
//   name against the project, in both jurisdictions.
//   The previous "wrangler fallback" called `wrangler r2 object list`, a
//   subcommand that does NOT exist (the CLI has get/put/delete only): it parsed
//   wrangler's help text, threw, and reported 0 object as a SUCCESS. That
//   limitation is the CLI's, not the API's.
//
// Exits 0 on success, 1 on error. Final stdout line is a JSON status report.
//
// IMPORTANT - loud failure: if the project HAS R2 configured but zero objects
// were downloaded, this reports `status: "error"`. A snapshot that silently
// contains no files is worse than one that fails visibly.

import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readUserEnv } from "../_read-user-env.mjs";
import { tokenMatches } from "../_match.mjs";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const PROJECT = arg("--project");
const OUT = arg("--out-dir");
const PROJECT_DIR = arg("--project-dir") || process.cwd();

if (!PROJECT || !OUT) {
  console.error("Usage: node download-r2.mjs --project <name> --out-dir <dir> [--project-dir <path>]");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

function fail(reason, extra = {}) {
  console.log(JSON.stringify({ status: "error", reason, ...extra }));
  process.exit(1);
}

// ── Read R2 settings from the project's .env files ─────────────────────────
function readR2Env() {
  const wanted = [
    "R2_BUCKET_NAME",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ];
  const found = {};
  for (const file of [".env.local", ".env"]) {
    const p = join(PROJECT_DIR, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      if (!wanted.includes(m[1])) continue;
      if (found[m[1]]) continue; // first file wins (.env.local > .env)
      found[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const complete = wanted.every((k) => found[k]);
  return { ...found, complete };
}

// ── Primary mode: S3 API ───────────────────────────────────────────────────
async function downloadViaS3(env) {
  const pkgJson = resolve(PROJECT_DIR, "package.json");
  if (!existsSync(pkgJson)) return null;
  let S3;
  try {
    const projectRequire = createRequire(pkgJson);
    const mod = await import(
      pathToFileURL(projectRequire.resolve("@aws-sdk/client-s3")).href
    );
    S3 = mod.default?.S3Client ? mod.default : mod;
    if (!S3.S3Client) return null;
  } catch {
    return null; // SDK not installed in the project: caller falls back
  }

  const client = new S3.S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  const bucket = env.R2_BUCKET_NAME;

  // List every object (paginated).
  const objects = [];
  let token;
  do {
    const r = await client.send(
      new S3.ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const o of r.Contents ?? []) objects.push({ key: o.Key, size: o.Size ?? 0 });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  const bucketDir = join(OUT, bucket);
  mkdirSync(bucketDir, { recursive: true });

  let downloaded = 0;
  let failed = 0;
  let bytes = 0;
  const errors = [];
  const CONCURRENCY = 8;
  let idx = 0;

  async function worker() {
    while (idx < objects.length) {
      const o = objects[idx++];
      const dest = join(bucketDir, o.key);
      try {
        mkdirSync(dirname(dest), { recursive: true });
        if (existsSync(dest) && statSync(dest).size === o.size) {
          // already fetched (resume)
        } else {
          const res = await client.send(
            new S3.GetObjectCommand({ Bucket: bucket, Key: o.key }),
          );
          const body = await res.Body.transformToByteArray();
          writeFileSync(dest, Buffer.from(body));
        }
        // Read the counter AFTER the await: `x += await ...` loses updates
        // under concurrency (classic read-modify-write race).
        const size = statSync(dest).size;
        downloaded++;
        bytes += size;
      } catch (e) {
        failed++;
        errors.push({ bucket, key: o.key, error: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return {
    mode: "s3",
    buckets: [
      { name: bucket, jurisdiction: "from-endpoint", objectCount: objects.length, downloaded, failed, bytes },
    ],
    totalObjects: downloaded,
    totalBytes: bytes,
    errors,
  };
}

// ── Fallback mode: Cloudflare REST API (no S3 credentials needed) ──────────
// The account API token lists AND reads objects through the v4 API. Only the
// wrangler CLI is limited (get/put/delete, no `list`), which is what made the
// previous fallback impossible. Bucket names are matched by convention since
// the .env cannot tell us which bucket belongs to the project.
const CF_TOKEN = readUserEnv("CLOUDFLARE_API_TOKEN") || readUserEnv("CF_API_TOKEN") || "";

const encodeKey = (key) => key.split("/").map(encodeURIComponent).join("/");

async function cfAccountId(headers) {
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
  if (!res.ok) return null;
  return (await res.json())?.result?.[0]?.id ?? null;
}

// Buckets of this project, both jurisdictions. { buckets: [...], error? }
async function findProjectBuckets(accountId, auth) {
  const found = [];
  for (const jurisdiction of ["global", "eu"]) {
    const headers = { ...auth };
    if (jurisdiction === "eu") headers["cf-r2-jurisdiction"] = "eu";
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets?per_page=1000`,
      { headers },
    );
    if (!res.ok) continue; // R2 not enabled, or no permission on this jurisdiction
    const body = await res.json();
    for (const b of body?.result?.buckets || []) {
      if (tokenMatches(PROJECT.toLowerCase(), b.name)) found.push({ name: b.name, jurisdiction });
    }
  }
  return found;
}

async function downloadViaRest() {
  if (!CF_TOKEN) return null;
  const auth = { Authorization: `Bearer ${CF_TOKEN}` };
  const accountId = await cfAccountId(auth);
  if (!accountId) return null;

  let buckets;
  try {
    buckets = await findProjectBuckets(accountId, auth);
  } catch (e) {
    return { mode: "rest-api", buckets: [], totalObjects: 0, totalBytes: 0, errors: [{ error: String(e) }] };
  }
  if (buckets.length === 0) return { mode: "rest-api", buckets: [], totalObjects: 0, totalBytes: 0, errors: [] };

  const report = { mode: "rest-api", buckets: [], totalObjects: 0, totalBytes: 0, errors: [] };
  for (const { name, jurisdiction } of buckets) {
    const headers = { ...auth };
    if (jurisdiction === "eu") headers["cf-r2-jurisdiction"] = "eu";
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(name)}`;

    // List every object. per_page defaults to 20 - ask for the max and follow
    // the cursor while `is_truncated`.
    const objects = [];
    let cursor = null;
    for (let page = 0; page < 500; page++) {
      const res = await fetch(`${base}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers });
      if (!res.ok) {
        report.errors.push({ bucket: name, error: `list: HTTP ${res.status}` });
        break;
      }
      const body = await res.json();
      for (const o of body?.result || []) objects.push({ key: o.key, size: Number(o.size ?? 0) });
      if (!body?.result_info?.is_truncated) break;
      cursor = body.result_info.cursor;
      if (!cursor) break;
    }

    // Same name can exist in both jurisdictions: separate folders, or the
    // second download would overwrite the first.
    const bucketDir = join(OUT, jurisdiction === "eu" ? `${name}__eu` : name);
    mkdirSync(bucketDir, { recursive: true });

    let downloaded = 0;
    let failed = 0;
    let bytes = 0;
    const CONCURRENCY = 8;
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, objects.length) }, async () => {
        while (idx < objects.length) {
          const o = objects[idx++];
          const dest = join(bucketDir, o.key);
          try {
            mkdirSync(dirname(dest), { recursive: true });
            if (!(existsSync(dest) && statSync(dest).size === o.size)) {
              const res = await fetch(`${base}/objects/${encodeKey(o.key)}`, { headers });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
            }
            // Read the counter AFTER the await (read-modify-write race).
            const size = statSync(dest).size;
            downloaded++;
            bytes += size;
          } catch (e) {
            failed++;
            if (report.errors.length < 50) report.errors.push({ bucket: name, key: o.key, error: e.message });
          }
        }
      }),
    );

    report.buckets.push({ name, jurisdiction, objectCount: objects.length, downloaded, failed, bytes });
    report.totalObjects += downloaded;
    report.totalBytes += bytes;
  }
  return report;
}

// ── Run ────────────────────────────────────────────────────────────────────
const r2env = readR2Env();
let report = null;

if (r2env.complete) {
  try {
    report = await downloadViaS3(r2env);
  } catch (e) {
    fail(`R2 configured (bucket "${r2env.R2_BUCKET_NAME}") but the download failed: ${e.message}`, {
      configured: true,
    });
  }
}
// No S3 credentials (or no SDK): fall back to the Cloudflare REST API, which
// needs only the account token from the vault.
if (!report) report = await downloadViaRest();

if (!report) {
  if (r2env.complete) {
    fail(
      `R2 is configured in .env (bucket "${r2env.R2_BUCKET_NAME}") but neither the S3 SDK nor the Cloudflare token was usable to download it`,
      { configured: true },
    );
  }
  console.log(
    JSON.stringify({
      status: "skipped",
      reason: "no R2 credentials in .env and no usable Cloudflare token (vault locked?)",
      configured: false,
      totalObjects: 0,
      totalBytes: 0,
    }),
  );
  process.exit(0);
}

// REST fallback that found no bucket at all: this project genuinely has no R2.
if (!r2env.complete && report.buckets.length === 0) {
  console.log(
    JSON.stringify({
      status: "skipped",
      reason: "no R2 credentials in .env and no R2 bucket found for this project",
      configured: false,
      totalObjects: 0,
      totalBytes: 0,
      ...(report.errors.length ? { probeErrors: report.errors.slice(0, 3) } : {}),
    }),
  );
  process.exit(0);
}

writeFileSync(resolve(OUT, "_summary.json"), JSON.stringify({ ...report, bucketFromEnv: r2env.R2_BUCKET_NAME ?? null }, null, 2));

// Loud failure: R2 exists for this project but we got nothing.
if (r2env.complete && report.totalObjects === 0) {
  fail(
    `R2 is configured (bucket "${r2env.R2_BUCKET_NAME}") but 0 object was downloaded - the snapshot would contain no file`,
    { configured: true, mode: report.mode, errors: report.errors.length },
  );
}

console.log(
  JSON.stringify({
    status: "ok",
    mode: report.mode,
    configured: Boolean(r2env.complete),
    bucketsScanned: report.buckets.length,
    totalObjects: report.totalObjects,
    totalBytes: report.totalBytes,
    errors: report.errors.length,
  }),
);
