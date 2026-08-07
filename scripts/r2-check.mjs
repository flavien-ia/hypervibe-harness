#!/usr/bin/env node
// r2-check.mjs - Smoke-test a project's Cloudflare R2 wiring.
//
// Answers one question: does this project's R2 configuration actually work?
// Reads the R2_* vars from the project's .env.local / .env, opens an S3
// client against the bucket, lists a few objects, and (for private buckets)
// signs a URL to prove the presigner is wired too.
//
// Why this script exists at all: the check has to import @aws-sdk/client-s3,
// which is installed in the PROJECT, not next to this file. Node resolves bare
// imports by walking up from the script's own directory, so an ad-hoc script
// written anywhere else (a temp dir, a scratchpad) crashes with
// ERR_MODULE_NOT_FOUND even though the package is installed. This script
// resolves the SDK from the project's package.json instead, the same way
// scripts/save-project/download-r2.mjs does, so it can live in the plugin and
// still see the project's dependencies.
//
// Usage:
//   node r2-check.mjs --project-dir "C:/DEV/my-project"
//
// Output: human-readable logs on stderr, one JSON object on stdout last line.
//
// Exit codes:
//   0 - bucket reachable, credentials valid
//   1 - bad arguments or project not found
//   2 - R2 env vars missing or incomplete (run /add-storage first)
//   3 - @aws-sdk/client-s3 not installed in the project
//   4 - bucket unreachable or credentials rejected

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ─── Args ──────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PROJECT_DIR = resolve(arg("project-dir", process.cwd()));
const MAX_KEYS = Number(arg("max-keys", "5")) || 5;

const log = (m) => process.stderr.write(`${m}\n`);
const done = (payload, code) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
};

if (!existsSync(PROJECT_DIR)) {
  log(`Project directory not found: ${PROJECT_DIR}`);
  done({ ok: false, stage: "args", error: "project_dir_not_found", projectDir: PROJECT_DIR }, 1);
}

// ─── Step 1 - read R2 config from the project's env files ──────────────
const WANTED = [
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];

function readR2Env() {
  const found = {};
  for (const file of [".env.local", ".env"]) {
    const p = join(PROJECT_DIR, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      if (!WANTED.includes(m[1])) continue;
      if (found[m[1]]) continue; // first file wins (.env.local > .env)
      found[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return found;
}

const env = readR2Env();
const missing = WANTED.filter((k) => !env[k]);
if (missing.length) {
  log(`Missing R2 configuration: ${missing.join(", ")}`);
  done({ ok: false, stage: "env", error: "r2_env_incomplete", missing }, 2);
}
log(`R2 config found - bucket "${env.R2_BUCKET_NAME}"`);

// ─── Step 2 - resolve the S3 SDK FROM THE PROJECT ──────────────────────
// This is the whole point of the script: never a bare import, always a
// resolution anchored on the project's package.json.
const pkgJson = resolve(PROJECT_DIR, "package.json");
if (!existsSync(pkgJson)) {
  log(`No package.json in ${PROJECT_DIR}`);
  done({ ok: false, stage: "sdk", error: "no_package_json", projectDir: PROJECT_DIR }, 1);
}

const projectRequire = createRequire(pkgJson);

async function importFromProject(spec) {
  return import(pathToFileURL(projectRequire.resolve(spec)).href);
}

let S3;
try {
  const mod = await importFromProject("@aws-sdk/client-s3");
  S3 = mod.default?.S3Client ? mod.default : mod;
  if (!S3.S3Client) throw new Error("S3Client not exported");
} catch {
  log("@aws-sdk/client-s3 is not installed in this project.");
  log("Install it there first:  pnpm add @aws-sdk/client-s3");
  done({ ok: false, stage: "sdk", error: "aws_sdk_not_installed" }, 3);
}

// ─── Step 3 - talk to the bucket ───────────────────────────────────────
const client = new S3.S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

let listing;
try {
  listing = await client.send(
    new S3.ListObjectsV2Command({
      Bucket: env.R2_BUCKET_NAME,
      MaxKeys: MAX_KEYS,
    }),
  );
} catch (err) {
  const name = err?.name || "UnknownError";
  const hint =
    name === "NoSuchBucket"
      ? "The bucket does not exist at this endpoint. Check R2_BUCKET_NAME and the jurisdiction (global vs eu) in R2_ENDPOINT."
      : /AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch/.test(name)
        ? "Credentials rejected. Check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY and the token's permissions on this bucket."
        : "Could not reach the bucket. Check R2_ENDPOINT and network access.";
  log(`Bucket unreachable (${name}). ${hint}`);
  done({ ok: false, stage: "bucket", error: name, hint, bucket: env.R2_BUCKET_NAME }, 4);
}

const sample = (listing.Contents || []).map((o) => o.Key);
log(
  `Bucket reachable - ${listing.KeyCount ?? sample.length} object(s) listed` +
    (sample.length ? ` (e.g. ${sample.slice(0, 3).join(", ")})` : " (bucket is empty)"),
);

// ─── Step 4 - presigner, only if the project installed it ──────────────
// Private buckets serve files through signed URLs, so a working presigner is
// part of "storage works". Absent package = public bucket setup, not a failure.
let presign = { tested: false };
try {
  const { getSignedUrl } = await importFromProject("@aws-sdk/s3-request-presigner");
  const key = sample[0] || "r2-check-probe-object";
  const url = await getSignedUrl(
    client,
    new S3.GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    { expiresIn: 60 },
  );
  presign = { tested: true, ok: /^https:\/\/.+X-Amz-Signature=/.test(url), key };
  log(presign.ok ? "Signed URL generated OK" : "Signed URL looks malformed");
} catch {
  log("Presigner not installed (public-bucket setup) - skipped");
}

done(
  {
    ok: true,
    bucket: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    objectCount: listing.KeyCount ?? sample.length,
    truncated: Boolean(listing.IsTruncated),
    sampleKeys: sample,
    presign,
  },
  0,
);
