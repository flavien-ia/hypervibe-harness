#!/usr/bin/env node
// Pull environment variables FROM Vercel for a given target.
// Optionally filters by keys, optionally merges into local .env.local.
//
// Usage:
//   node pull-env-vars.mjs --target=<production|preview|development> [--keys=K1,K2] [--write-to-local] [--json]
//
// Exit codes:
//   0 = success
//   1 = invalid args, Vercel not linked, or pull failed

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
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
  console.error("Project not linked to Vercel. Run `vercel link` first or call from the project root.");
  process.exit(1);
}

// ─── Pull env from Vercel ──────────────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), "vercel-env-pull-"));
const tmpFile = join(tmpDir, `.env.${target}`);

function runVercel(args) {
  return new Promise((resolve) => {
    const proc = spawn("vercel", args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
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

// ─── Apply key filter ──────────────────────────────────────────────────
let filtered = envs;
if (keysFilter && keysFilter.length > 0) {
  filtered = {};
  for (const k of keysFilter) {
    if (k in envs) filtered[k] = envs[k];
  }
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

  // Update lines that match a pulled key, leave others alone
  const updated = lines.map((line) => {
    const idx = line.indexOf("=");
    if (idx <= 0 || line.trimStart().startsWith("#")) return line;
    const key = line.slice(0, idx).trim();
    if (key in filtered) {
      // Quote if value contains spaces or special chars
      const val = filtered[key];
      const needsQuote = /[\s"#'$`\\]/.test(val);
      const safe = needsQuote ? `"${val.replace(/"/g, '\\"')}"` : val;
      return `${key}=${safe}`;
    }
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
      const needsQuote = /[\s"#'$`\\]/.test(v);
      const safe = needsQuote ? `"${v.replace(/"/g, '\\"')}"` : v;
      updated.push(`${k}=${safe}`);
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
  process.stdout.write(JSON.stringify(filtered));
} else {
  const count = Object.keys(filtered).length;
  if (count === 0) {
    console.log(`No variable ${keysFilter ? "matching the filter " : ""}found in the ${target} environment.`);
  } else {
    console.log(`${count} variable${count > 1 ? "s" : ""} pulled from ${target} :`);
    for (const key of Object.keys(filtered).sort()) {
      console.log(`  - ${key} (present)`);
    }
    if (writeToLocal) {
      console.log(`\nMerged into .env.local.`);
    }
  }
}

// ─── Cleanup ───────────────────────────────────────────────────────────
rmSync(tmpDir, { recursive: true, force: true });
process.exit(0);
