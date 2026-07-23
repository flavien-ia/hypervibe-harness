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
// FALLBACK MODE (wrangler CLI).
//   Only when no R2 credentials are found in .env: tries the naming convention
//   `<project>` and `<project>-eu`, in the default and EU jurisdictions.
//
// Exits 0 on success, 1 on error. Final stdout line is a JSON status report.
//
// IMPORTANT - loud failure: if the project HAS R2 configured but zero objects
// were downloaded, this reports `status: "error"`. A snapshot that silently
// contains no files is worse than one that fails visibly.

import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

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

function run(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, { encoding: "utf8", shell: true, ...opts });
}

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

// ── Fallback mode: wrangler CLI + naming convention ────────────────────────
function listBucket(bucketName, jurisdiction) {
  const argv = ["r2", "object", "list", bucketName];
  if (jurisdiction === "eu") argv.push("--jurisdiction", "eu");
  argv.push("--json");
  const r = run("wrangler", argv);
  if (r.status !== 0) return null;
  try {
    const out = JSON.parse(r.stdout);
    return Array.isArray(out) ? out : out.objects || [];
  } catch {
    return null;
  }
}

function downloadObject(bucketName, key, destPath, jurisdiction) {
  mkdirSync(dirname(destPath), { recursive: true });
  const argv = ["r2", "object", "get", `${bucketName}/${key}`, "--file", destPath];
  if (jurisdiction === "eu") argv.push("--jurisdiction", "eu");
  return run("wrangler", argv).status === 0;
}

function downloadViaWrangler() {
  if (run("wrangler", ["--version"]).status !== 0) return null;
  const report = { mode: "wrangler", buckets: [], totalObjects: 0, totalBytes: 0, errors: [] };
  for (const { name, jurisdiction } of [
    { name: PROJECT, jurisdiction: "default" },
    { name: `${PROJECT}-eu`, jurisdiction: "eu" },
  ]) {
    const objects = listBucket(name, jurisdiction);
    if (objects === null) continue; // bucket absent or unreachable
    const bucketDir = join(OUT, name);
    mkdirSync(bucketDir, { recursive: true });
    let downloaded = 0;
    let failed = 0;
    let bytes = 0;
    for (const o of objects) {
      const dest = join(bucketDir, o.key);
      if (downloadObject(name, o.key, dest, jurisdiction) && existsSync(dest)) {
        downloaded++;
        bytes += statSync(dest).size;
      } else {
        failed++;
        report.errors.push({ bucket: name, key: o.key });
      }
    }
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
if (!report) report = downloadViaWrangler();

if (!report) {
  // Neither path was usable at all.
  if (r2env.complete) {
    fail(
      `R2 is configured in .env (bucket "${r2env.R2_BUCKET_NAME}") but neither the S3 SDK nor wrangler was available to download it`,
      { configured: true },
    );
  }
  console.log(
    JSON.stringify({
      status: "skipped",
      reason: "no R2 credentials in .env and wrangler CLI unavailable",
      configured: false,
      totalObjects: 0,
      totalBytes: 0,
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
