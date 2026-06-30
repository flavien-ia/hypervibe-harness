#!/usr/bin/env node
// store-file-secret.mjs - Store the CONTENT of a file as a secret field in the vault, NON-interactively.
//
// For credentials that come as a downloaded FILE (e.g. a Google service-account JSON), not a typed
// value. The file content goes file → bw directly (in Node), never printed, never through Claude's
// context, never through the clipboard. The user only provides the file PATH (a path is not secret).
//
//   node store-file-secret.mjs --file <path> --name GSC_SERVICE_ACCOUNT --field credentials [--service "..."] [--json]
//
// --json : validate the file parses as JSON and store it minified (one line). Use for SA JSON keys.
//
// Exit codes: 0 ok | 2 vault locked | 3 session expired | 4 file not found | 5 invalid content | 1 other

import { readFileSync, existsSync } from "node:fs";
import { putItem } from "./vault.mjs";

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const k = args[i].slice(2);
    flags[k] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
  }
}

const file = flags.file;
const name = flags.name;
const field = flags.field || "credentials";
const service = flags.service;
const asJson = flags.json === "true";

if (!file || !name) {
  console.error("Usage: store-file-secret.mjs --file <path> --name <ITEM> [--field <f>] [--service <s>] [--json]");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(4);
}

let value = readFileSync(file, "utf8");
if (asJson) {
  try {
    value = JSON.stringify(JSON.parse(value)); // validate + minify
  } catch {
    console.error("File is not valid JSON.");
    process.exit(5);
  }
}

try {
  const result = putItem(name, [{ name: field, value, type: "secret" }], { service });
  value = null;
  console.log(`${result === "updated" ? "Updated" : "Created"} '${name}' in vault.`);
  process.exit(0);
} catch (e) {
  if (e.code === 2 || e.code === 3) console.error("Vault locked / session expired. Run unlock first.");
  else console.error(e.message || String(e));
  process.exit(e.code || 1);
}
