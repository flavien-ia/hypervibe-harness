#!/usr/bin/env node
// Pull environment variables FROM Vercel for a given target.
// Optionally filters by keys, optionally merges into local .env.local.
//
// A "sensitive" variable is never given back by Vercel: its command line writes KEY="" for it.
// That empty string is NOT the value. It is never written over a local value, never added as an
// empty line, reported as not readable, and null in the JSON (as the organisation's pull
// workflow has always done). Until 3.3.3 it erased every local secret of a .env.local restored
// this way, and was announced "present".
//
// Usage:
//   node pull-env-vars.mjs --target=<production|preview|development> [--keys=K1,K2] [--write-to-local] [--json]
//
// Exit codes:
//   0 = success
//   1 = invalid args, Vercel not linked, or pull failed

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { spawnSpec } from "./_spawn.mjs";
import { dotenvLine } from "./_env-line.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Parse args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let target = null;
let keysFilter = null;
let writeToLocal = false;
let asJson = false;

for (const arg of args) {
  if (arg.startsWith("--target=")) {
    target = arg.slice("--target=".length).trim();
  } else if (arg.startsWith("--keys=")) {
    keysFilter = arg.slice("--keys=".length).split(",").map((s) => s.trim()).filter(Boolean);
  } else if (arg === "--write-to-local") {
    writeToLocal = true;
  } else if (arg === "--json") {
    asJson = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log("Usage: pull-env-vars.mjs --target=<env> [--keys=K1,K2] [--write-to-local] [--json]");
    process.exit(0);
  } else {
    console.error(`Unknown arg: ${arg}`);
    process.exit(1);
  }
}

const VALID_TARGETS = ["production", "preview", "development"];
if (!target || !VALID_TARGETS.includes(target)) {
  console.error(`--target is required. Valid values: ${VALID_TARGETS.join(", ")}`);
  process.exit(1);
}

// ─── Verify Vercel linked ──────────────────────────────────────────────
if (!existsSync(".vercel/project.json")) {
  console.error(
    "Project not linked to Vercel. Call from the project root, or link it first with " +
      "`vercel link --yes --project <name> --scope <team>` (the scope is the account or team that " +
      "holds the project: without it, an account with several of them makes the command stop).",
  );
  process.exit(1);
}

// ─── Pull env from Vercel ──────────────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), "vercel-env-pull-"));
const tmpFile = join(tmpDir, `.env.${target}`);

function runVercel(args) {
  return new Promise((resolve) => {
    // spawnSpec: every argument quoted for the Windows shell (the temporary file's path carries
    // the user's folder, which may hold a space).
    const spec = spawnSpec("vercel", args);
    const proc = spawn(spec.file, spec.args, { stdio: ["ignore", "pipe", "pipe"], shell: spec.shell });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
    proc.on("error", (err) => resolve({ code: 127, stdout, stderr: stderr + err.message }));
  });
}

const result = await runVercel(["env", "pull", tmpFile, `--environment=${target}`, "--yes"]);
if (result.code !== 0) {
  console.error(`vercel env pull failed (exit ${result.code}):\n${result.stderr.trim() || result.stdout.trim()}`);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

// ─── Parse the pulled file ─────────────────────────────────────────────
const raw = readFileSync(tmpFile, "utf8");
const envs = {};
for (const line of raw.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx <= 0) continue;
  const key = trimmed.slice(0, idx).trim();
  let value = trimmed.slice(idx + 1).trim();
  // Strip surrounding quotes if present (Vercel CLI sometimes wraps values)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  envs[key] = value;
}

// ─── Apply key filter, and set apart what the host would not give back ─
let wanted = envs;
if (keysFilter && keysFilter.length > 0) {
  wanted = {};
  for (const k of keysFilter) {
    if (k in envs) wanted[k] = envs[k];
  }
}
const filtered = {};
const unreadable = [];
// Values no .env line can carry unchanged (every kind of quote mixed with a line break): never
// written to .env.local, and named in the summary.
const unwritable = [];
for (const [k, v] of Object.entries(wanted)) {
  if (v === "") unreadable.push(k);
  else filtered[k] = v;
}

// ─── Optional merge into .env.local ────────────────────────────────────
if (writeToLocal) {
  const localPath = ".env.local";
  const existing = existsSync(localPath) ? readFileSync(localPath, "utf8") : "";
  const lines = existing.split("\n");
  const presentKeys = new Set();
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx > 0 && !line.trimStart().startsWith("#")) {
      presentKeys.add(line.slice(0, idx).trim());
    }
  }

  // Each line written so that the site's loader reads the host's value back unchanged
  // (_env-line.mjs): a `$` written bare or between double quotes was expanded by Next, and a `\"`
  // kept its backslash. The host's file writes line breaks as `\n` between double quotes. A value
  // no line can carry is not written, and said: the local line, if any, is kept.
  const lineOf = (k, v) => {
    try {
      return dotenvLine(k, String(v).replace(/\\n/g, "\n").replace(/\\r/g, "\r"));
    } catch {
      unwritable.push(k);
      return null;
    }
  };

  // Update lines that match a pulled key, leave others alone
  const updated = lines.map((line) => {
    const idx = line.indexOf("=");
    if (idx <= 0 || line.trimStart().startsWith("#")) return line;
    const key = line.slice(0, idx).trim();
    if (key in filtered) return lineOf(key, filtered[key]) ?? line;
    return line;
  });

  // Append keys that weren't in the existing file
  const toAppend = Object.entries(filtered).filter(([k]) => !presentKeys.has(k));
  if (toAppend.length > 0) {
    if (updated.length > 0 && updated[updated.length - 1].trim() !== "") {
      updated.push("");
    }
    updated.push(`# Pulled from Vercel ${target} on ${new Date().toISOString().slice(0, 10)}`);
    for (const [k, v] of toAppend) {
      const written = lineOf(k, v);
      if (written) updated.push(written);
    }
  }

  writeFileSync(localPath, updated.join("\n"), "utf8");

  // Make sure .env.local is gitignored
  const gitignorePath = ".gitignore";
  if (existsSync(gitignorePath)) {
    const gi = readFileSync(gitignorePath, "utf8");
    if (!gi.split("\n").some((l) => l.trim() === ".env.local" || l.trim() === ".env.*.local")) {
      writeFileSync(gitignorePath, gi.trimEnd() + "\n.env.local\n", "utf8");
    }
  }
}

// ─── Output ────────────────────────────────────────────────────────────
if (asJson) {
  process.stdout.write(JSON.stringify({ ...filtered, ...Object.fromEntries(unreadable.map((k) => [k, null])) }));
} else {
  const count = Object.keys(filtered).length;
  if (count === 0 && unreadable.length === 0) {
    console.log(`No variable ${keysFilter ? "matching the filter " : ""}found in the ${target} environment.`);
  } else {
    console.log(`${count} variable${count > 1 ? "s" : ""} pulled from ${target} :`);
    for (const key of Object.keys(filtered).sort()) {
      console.log(`  - ${key} (present)`);
    }
    if (unreadable.length) {
      console.log(`${unreadable.length} not readable (a secret the host never gives back${writeToLocal ? "; the local value, if any, is kept" : ""}) :`);
      for (const key of unreadable.sort()) console.log(`  - ${key}`);
    }
    if (unwritable.length) {
      console.log(`${unwritable.length} not written to .env.local (no .env line carries their value unchanged; the local line, if any, is kept) :`);
      for (const key of unwritable.sort()) console.log(`  - ${key}`);
    }
    if (writeToLocal) {
      console.log(`\nMerged into .env.local.`);
    }
  }
}

// ─── Cleanup ───────────────────────────────────────────────────────────
rmSync(tmpDir, { recursive: true, force: true });
process.exit(0);
