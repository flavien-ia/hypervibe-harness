#!/usr/bin/env node
// Push environment variables to the local .env file AND to Vercel,
// targeting specific environments (production / preview / development).
//
// Usage:
//   node push-env-vars.mjs [--target=<env>[,<env>...]] KEY1=VALUE1 [KEY2=VALUE2 ...]
//
// --target options:
//   - omitted (default): writes to "production" + "preview" for sensitive vars,
//     or all three (incl. "development") for NEXT_PUBLIC_*. Existing entries in
//     other environments are NEVER touched.
//   - --target=preview              → writes only to preview (production untouched)
//   - --target=production           → writes only to production (preview untouched)
//   - --target=production,preview   → writes to those two envs
//   - --target=all                  → forces write to all three envs regardless of key prefix
//
// Non-destructive strategy: for each existing entry of the same key on Vercel,
//   * Full overlap with write targets → delete entirely (idempotent re-runs).
//   * No overlap                      → leave alone (preserves OTHER environments).
//   * Partial overlap                 → patch the entry to remove only the overlapping
//                                       targets, then create a new entry for write targets.
// This matters when pushing a different value to a single environment (e.g. a
// TEST tax rate to preview while keeping the LIVE tax rate in production).
//
// Exit codes:
//   0 = success (or partial success when Vercel isn't linked - local only)
//   1 = invalid args, or one or more Vercel pushes failed (details on stderr)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// ─── Parse args ────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  console.error(
    "Usage: node push-env-vars.mjs [--target=<env>[,<env>...]] KEY=VALUE [KEY=VALUE ...]",
  );
  process.exit(1);
}

const VALID_ENVS = ["production", "preview", "development"];
let explicitTargets = null; // null = smart per-key default
const pairs = [];

for (const arg of rawArgs) {
  if (arg.startsWith("--target=")) {
    const v = arg.slice("--target=".length);
    if (v === "all") {
      explicitTargets = [...VALID_ENVS];
      continue;
    }
    const envs = v.split(",").map((s) => s.trim()).filter(Boolean);
    const invalid = envs.filter((e) => !VALID_ENVS.includes(e));
    if (invalid.length || envs.length === 0) {
      console.error(
        `Invalid --target value: "${v}". Allowed: production, preview, development, all (comma-separated).`,
      );
      process.exit(1);
    }
    explicitTargets = envs;
    continue;
  }
  const idx = arg.indexOf("=");
  if (idx <= 0) {
    console.error(`Invalid arg: ${arg} (expected KEY=VALUE with a non-empty key)`);
    process.exit(1);
  }
  pairs.push({ key: arg.slice(0, idx), value: arg.slice(idx + 1) });
}

if (pairs.length === 0) {
  console.error("No KEY=VALUE pairs provided.");
  process.exit(1);
}

// ─── Step 1 - Update .env ──────────────────────────────────────────────
const envPath = ".env";
const existingContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = existingContent.split("\n");

const keysToReplace = new Set(pairs.map((p) => p.key));
const filtered = lines.filter((line) => {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
  if (!m) return true;
  return !keysToReplace.has(m[1]);
});

while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
  filtered.pop();
}

for (const { key, value } of pairs) {
  filtered.push(`${key}=${value}`);
}

writeFileSync(envPath, filtered.join("\n") + "\n");
console.log(`[env] Updated ${envPath} (${pairs.length} var${pairs.length > 1 ? "s" : ""})`);

const gitignorePath = ".gitignore";
const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
const alreadyIgnored = gitignore.split("\n").some((l) => l.trim() === ".env");
if (!alreadyIgnored) {
  const suffix = gitignore.length === 0 || gitignore.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, gitignore + suffix + ".env\n");
  console.log(`[env] Added .env to .gitignore`);
}

// ─── Step 2 - Check if Vercel is linked ────────────────────────────────
const vercelProjectPath = ".vercel/project.json";
if (!existsSync(vercelProjectPath)) {
  console.log("[vercel] Project not linked (no .vercel/project.json). Skipping Vercel push.");
  console.log(`✅ Pushed ${pairs.length} env var${pairs.length > 1 ? "s" : ""} to local .env only.`);
  process.exit(0);
}

const project = JSON.parse(readFileSync(vercelProjectPath, "utf8"));
const projectId = project.projectId;
const orgId = project.orgId; // team ID (null for personal accounts)

// ─── Step 3 - Try to load CLI auth token (for REST API) ────────────────
//
// Vercel CLI auth file location varies by OS AND by CLI version. Older versions
// nested it under `Data/auth.json` (Cocoa app convention); newer versions
// (~v40+) put it directly in the app-support folder. We try both per platform
// and use whichever exists.
function getAuthFilePathCandidates() {
  const os = platform();
  if (os === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return [
      join(appData, "com.vercel.cli", "Data", "auth.json"),
      join(appData, "com.vercel.cli", "auth.json"),
    ];
  }
  if (os === "darwin") {
    const base = join(homedir(), "Library", "Application Support", "com.vercel.cli");
    return [
      join(base, "Data", "auth.json"),
      join(base, "auth.json"),
    ];
  }
  // Linux / other POSIX
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return [
    join(xdg, "com.vercel.cli", "Data", "auth.json"),
    join(xdg, "com.vercel.cli", "auth.json"),
  ];
}

function loadAuthToken() {
  for (const p of getAuthFilePathCandidates()) {
    try {
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, "utf8"));
      if (data.token) {
        // Don't pre-check expiry - let the API return 401 if the token is truly dead.
        // Pre-checks are unreliable: clocks drift, Vercel uses grace periods, and
        // the refreshToken can silently extend the session.
        return data.token;
      }
    } catch (err) {
      console.log(`[vercel] Could not read ${p} (${err.message}) - trying next candidate.`);
    }
  }
  return null;
}

const token = loadAuthToken();

// Vercel rejects "development" as a target for sensitive vars (local dev reads
// .env instead). So sensitive vars go to production + preview only by default;
// NEXT_PUBLIC_* and explicit --target overrides may include "development".
function targetsFor(key) {
  if (explicitTargets) return [...explicitTargets];
  return key.startsWith("NEXT_PUBLIC_") ? [...VALID_ENVS] : ["production", "preview"];
}

// ─── Step 4a - REST API path ───────────────────────────────────────────
async function cleanupConflictsViaApi(key, writeTargets) {
  const teamQuery = orgId ? `?teamId=${orgId}` : "";
  const listRes = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/env${teamQuery}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) {
    throw new Error(`list env failed: HTTP ${listRes.status} ${await listRes.text()}`);
  }
  const data = await listRes.json();
  const matches = (data.envs || []).filter((e) => e.key === key);
  const writeSet = new Set(writeTargets);

  for (const entry of matches) {
    const entryTargets = entry.target || [];
    const overlap = entryTargets.filter((t) => writeSet.has(t));

    if (overlap.length === 0) {
      // No conflict → leave alone (this preserves entries in other envs).
      continue;
    }

    if (overlap.length === entryTargets.length) {
      // Full overlap → delete entirely (idempotent re-run).
      const delUrl = `https://api.vercel.com/v9/projects/${projectId}/env/${entry.id}${teamQuery}`;
      const res = await fetch(delUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(
          `delete env ${entry.id} failed: HTTP ${res.status} ${await res.text()}`,
        );
      }
      continue;
    }

    // Partial overlap → patch the entry to keep only the non-overlapping targets.
    const remainingTargets = entryTargets.filter((t) => !writeSet.has(t));
    const patchUrl = `https://api.vercel.com/v9/projects/${projectId}/env/${entry.id}${teamQuery}`;
    const res = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target: remainingTargets }),
    });
    if (!res.ok) {
      throw new Error(
        `patch env ${entry.id} failed: HTTP ${res.status} ${await res.text()}`,
      );
    }
  }
}

// NEXT_PUBLIC_* vars are embedded in the client bundle by design, so
// marking them "sensitive" adds no real protection and blocks dashboard
// debugging. Everything else defaults to "sensitive" (opaque, unreadable
// after write) - matches Vercel's post-April-2026 hardening guidance.
function envType(key) {
  return key.startsWith("NEXT_PUBLIC_") ? "encrypted" : "sensitive";
}

async function addViaApi(key, value, writeTargets) {
  const teamQuery = orgId ? `?teamId=${orgId}` : "";
  const baseType = envType(key); // "sensitive" or "encrypted"

  // Vercel rejects type=sensitive for target=development with HTTP 400
  // ("You cannot set a Sensitive Environment Variable's target to development.").
  // When the caller asks for development on a would-be-sensitive var, split:
  //   - production/preview keep type=sensitive (opaque in dashboard)
  //   - development falls back to type=encrypted (visible in dashboard, but local
  //     dev reads .env anyway - Vercel's "development" target is only used by
  //     `vercel dev`, which is rare).
  const groups =
    baseType === "sensitive" && writeTargets.includes("development")
      ? [
          { targets: writeTargets.filter((t) => t !== "development"), type: "sensitive" },
          { targets: ["development"], type: "encrypted" },
        ].filter((g) => g.targets.length > 0)
      : [{ targets: writeTargets, type: baseType }];

  for (const { targets, type } of groups) {
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/env${teamQuery}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key,
          value,
          type,
          target: targets,
          gitBranch: null, // null = all preview branches
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
  }
}

async function pushViaApi(key, value, writeTargets) {
  await cleanupConflictsViaApi(key, writeTargets);
  await addViaApi(key, value, writeTargets);
}

// ─── Retry helper for transient REST API errors ───────────────────────
//
// The Vercel API can return transient errors when:
//   - The project was just linked (404 - index not propagated yet)
//   - We hit rate limit (429)
//   - Their infra is having a momentary issue (502, 503, 504, 408)
//   - Network blip (ETIMEDOUT, ECONNRESET, …)
//
// Earlier the script gave up on the first REST error and fell back to the CLI,
// which often had the same transient issue (the CLI hits the same API). The
// retry loop with exponential backoff covers ~14s of total wait, which is
// enough for most fresh-project cases. If after 4 attempts it still fails, we
// fall back to CLI as the last resort.
const RETRY_BACKOFFS_MS = [0, 2000, 4000, 8000]; // attempt 1 immediate, then 2s/4s/8s

function isTransientError(err) {
  const msg = err?.message || "";
  if (/HTTP (404|408|429|502|503|504)/.test(msg)) return true;
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|fetch failed|network/i.test(msg))
    return true;
  return false;
}

async function withRetry(fn, label) {
  let lastErr = null;
  for (let i = 0; i < RETRY_BACKOFFS_MS.length; i++) {
    if (RETRY_BACKOFFS_MS[i] > 0) {
      console.log(
        `[vercel] ${label}: retry ${i + 1}/${RETRY_BACKOFFS_MS.length} after ${RETRY_BACKOFFS_MS[i] / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, RETRY_BACKOFFS_MS[i]));
    }
    try {
      await fn();
      if (i > 0) console.log(`[vercel] ${label}: succeeded on attempt ${i + 1}.`);
      return;
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) {
        // Non-retryable error (auth, bad request, …) - bail immediately.
        throw err;
      }
      const isLast = i === RETRY_BACKOFFS_MS.length - 1;
      console.log(
        `[vercel] ${label}: attempt ${i + 1}/${RETRY_BACKOFFS_MS.length} failed - ${err.message.slice(0, 120)}.${
          isLast ? " Giving up on REST API." : ""
        }`,
      );
    }
  }
  throw lastErr;
}

// Strip the Vercel CLI's `<claude-code-hint v="..." />` marker from captured
// output. Vercel prepends this marker on stderr in non-TTY contexts (subprocess
// captures); it's not a real error - but it pollutes our error messages when
// something else fails. Cosmetic cleanup.
function stripCliNoise(s) {
  return s
    .replace(/<claude-code-hint[^>]*\/>/g, "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\n\s*\n/g, "\n");
}

// ─── Step 4b - CLI fallback path ───────────────────────────────────────
// Note: we don't shell-escape values anymore - they're piped via stdin to
// `vercel env add` (which expects stdin since v48 dropped the `--value` flag).
// Only the env name needs shell-arg escaping.

function escapeArg(s) {
  if (platform() === "win32") return `"${s.replace(/"/g, '""')}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function runVercel(cmdStr, stdinValue = null) {
  return new Promise((resolve) => {
    const child = spawn(cmdStr, {
      stdio: [stdinValue !== null ? "pipe" : "ignore", "pipe", "pipe"],
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
    if (stdinValue !== null) {
      child.stdin.write(stdinValue);
      child.stdin.end();
    }
  });
}

async function pushViaCli(key, value, writeTargets) {
  const k = escapeArg(key);
  // `--value` was removed/deprecated in Vercel CLI ~48 (seen with CLI 48.12.1
  // returning "Error: unknown or unexpected option: --value"). The canonical
  // way is to pipe the value via stdin (no shell escaping needed).
  const isPublic = key.startsWith("NEXT_PUBLIC_");
  // Only touch the write-target environments. `vercel env rm` is a no-op if
  // the var doesn't exist, so we don't gate on existence.
  for (const env of writeTargets) {
    await runVercel(`vercel env rm ${k} ${env} --yes`);
    // For preview, the CLI has a quirk: it prompts for a git branch even with
    // a value piped in. Passing `""` as the 3rd positional arg means
    // "all preview branches".
    const branchArg = env === "preview" ? ' ""' : "";
    // Vercel rejects --sensitive on the development target (same restriction as
    // the REST API). For development, push as plain (encrypted) regardless of
    // the key's NEXT_PUBLIC prefix.
    const sensitiveFlag = !isPublic && env !== "development" ? " --sensitive" : "";
    const result = await runVercel(
      `vercel env add ${k} ${env}${branchArg}${sensitiveFlag}`,
      value,
    );
    if (result.code !== 0) {
      // Strip the Vercel CLI's `<claude-code-hint .../>` marker from output -
      // it's emitted on stderr in non-TTY contexts and is not part of the actual error.
      const detail = stripCliNoise(result.stderr || result.stdout || "") || `exit ${result.code}`;
      throw new Error(`vercel env add ${key} ${env}: ${detail}`);
    }
  }
}

// ─── Step 5 - Execute push ─────────────────────────────────────────────
const method = token ? "REST API" : "CLI fallback";
console.log(`[vercel] Pushing to Vercel via ${method}.`);

const results = [];
for (const { key, value } of pairs) {
  const writeTargets = targetsFor(key);
  try {
    if (token) {
      // REST API with retry-on-transient (covers fresh-project 404, 429 rate limits,
      // 502/503/504, network blips). ~14s total wait spread over 4 attempts.
      await withRetry(() => pushViaApi(key, value, writeTargets), key);
      for (const env of writeTargets) results.push({ key, env, ok: true });
    } else {
      await pushViaCli(key, value, writeTargets);
      for (const env of writeTargets) results.push({ key, env, ok: true });
    }
  } catch (err) {
    // REST API exhausted retries (or non-transient error). Last-resort CLI fallback.
    if (token) {
      console.log(`[vercel] REST API gave up for ${key} (${err.message.slice(0, 120)}). Falling back to CLI…`);
      try {
        await pushViaCli(key, value, writeTargets);
        for (const env of writeTargets) results.push({ key, env, ok: true });
      } catch (cliErr) {
        for (const env of writeTargets)
          results.push({ key, env, ok: false, error: cliErr.message });
      }
    } else {
      for (const env of writeTargets)
        results.push({ key, env, ok: false, error: err.message });
    }
  }
}

// ─── Step 6 - Report ───────────────────────────────────────────────────
console.log("");
for (const { key } of pairs) {
  const writeTargets = targetsFor(key);
  const statuses = writeTargets
    .map((env) => {
      const r = results.find((x) => x.key === key && x.env === env);
      return r?.ok ? `${env}:✅` : `${env}:❌`;
    })
    .join("  ");
  console.log(`  ${key}  ${statuses}`);
}

const failures = results.filter((r) => !r.ok);
if (failures.length > 0) {
  console.error("");
  console.error("Failures:");
  const seen = new Set();
  for (const f of failures) {
    const sig = `${f.key}|${f.error}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    console.error(`  ${f.key}: ${f.error}`);
  }
  process.exit(1);
}

console.log("");
const targetSummary = explicitTargets
  ? explicitTargets.join(", ")
  : "smart per-key (production + preview, dev for NEXT_PUBLIC_*)";
console.log(
  `✅ Pushed ${pairs.length} env var${pairs.length > 1 ? "s" : ""} to .env + Vercel (${targetSummary}).`,
);
