#!/usr/bin/env node
// download-r2.mjs - Download all objects from a project's Cloudflare R2 buckets.
//
// Usage:
//   node download-r2.mjs --project <name> --out-dir <dir>
//
// Looks for R2 buckets named `<project>` and `<project>-eu` (the Hypervibe convention),
// in the default (global) jurisdiction AND the EU jurisdiction. Downloads each object to
// <out-dir>/<bucket-name>/<key>.
//
// Uses wrangler r2 CLI for listing and downloading.
//
// Exits 0 on success, 1 on error. Final stdout line is a JSON status report.

import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const PROJECT = arg("--project");
const OUT = arg("--out-dir");

if (!PROJECT || !OUT) {
  console.error("Usage: node download-r2.mjs --project <name> --out-dir <dir>");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

function run(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, { encoding: "utf8", shell: true, ...opts });
}

// List objects in a bucket. Returns array of { key, size, etag } or null on error.
function listBucket(bucketName, jurisdiction) {
  const argv = ["r2", "object", "list", bucketName];
  if (jurisdiction === "eu") argv.push("--jurisdiction", "eu");
  argv.push("--json");
  const r = run("wrangler", argv);
  if (r.status !== 0) return null;
  try {
    const out = JSON.parse(r.stdout);
    return Array.isArray(out) ? out : (out.objects || []);
  } catch {
    return null;
  }
}

function downloadObject(bucketName, key, destPath, jurisdiction) {
  mkdirSync(dirname(destPath), { recursive: true });
  const argv = ["r2", "object", "get", `${bucketName}/${key}`, "--file", destPath];
  if (jurisdiction === "eu") argv.push("--jurisdiction", "eu");
  const r = run("wrangler", argv);
  return r.status === 0;
}

const report = { buckets: [], totalObjects: 0, totalBytes: 0, errors: [] };

const candidates = [
  { name: PROJECT, jurisdiction: "default" },
  { name: `${PROJECT}-eu`, jurisdiction: "eu" },
];

for (const { name, jurisdiction } of candidates) {
  const objects = listBucket(name, jurisdiction);
  if (objects === null) {
    // Bucket doesn't exist or unreachable; skip silently
    continue;
  }
  const bucketDir = join(OUT, name);
  mkdirSync(bucketDir, { recursive: true });
  let downloaded = 0;
  let failed = 0;
  let bytes = 0;
  for (const o of objects) {
    const dest = join(bucketDir, o.key);
    const ok = downloadObject(name, o.key, dest, jurisdiction);
    if (ok && existsSync(dest)) {
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

// Write summary inside the storage dir too
writeFileSync(resolve(OUT, "_summary.json"), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  status: "ok",
  bucketsScanned: report.buckets.length,
  totalObjects: report.totalObjects,
  totalBytes: report.totalBytes,
  errors: report.errors.length,
}));
