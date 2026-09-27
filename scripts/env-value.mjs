#!/usr/bin/env node
// env-value.mjs - One value of the project's .env, for a shell variable, never for display.
//
//   NEW_VALUE=$(node env-value.mjs --project-dir <dir> [--file .env.<name>] <KEY>)
//   node env-value.mjs --project-dir <dir> [--file .env.<name>] --prefix 8 <KEY> [<KEY2> ...]
//        prints KEY=<its first 8 characters> for each key, nothing more: enough to tell a test
//        key (sk_test_) from a live one (sk_live_) without the value ever being shown
//
// A skill that has just written a secret (through the masked window, or from the generator
// straight into push-env-vars.mjs) needs it again for the next steps: the vault, a Worker, a
// check against the provider. It used to be pasted into each command as <NEW_VALUE>, which put
// the secret in the conversation and in process arguments (hosting inventory, 27/09/2026). The
// value now goes from the .env into a shell variable; a command reads the variable, and a
// command that sends it (curl) reads it from its standard input.
//
// Prints the value with no newline, on stdout only. Exit 4 when the key is absent or empty.
// Looks at .env, then .env.local.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The value of one variable in the project's .env, then .env.local (or in the one file named);
 *  null when absent. */
export function envValue(projectDir, name, { file = null } = {}) {
  for (const f of file ? [file] : [".env", ".env.local"]) {
    const p = join(projectDir, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!m || m[1] !== name) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const opts = {};
  const names = [];
  for (let k = 0; k < args.length; k += 1) {
    if (args[k] === "--project-dir") opts.dir = args[++k];
    else if (args[k] === "--file") opts.file = args[++k];
    else if (args[k] === "--prefix") opts.prefix = Number(args[++k]);
    else names.push(args[k]);
  }
  const dir = resolve(opts.dir ?? process.cwd());
  if (!names.length || (opts.file && !/^\.env(\.[A-Za-z0-9._-]+)?$/.test(opts.file))) {
    console.error("Usage: env-value.mjs [--project-dir <dir>] [--file .env.<name>] [--prefix <n>] <KEY> [<KEY2> ...]");
    process.exit(1);
  }
  if (opts.prefix > 0) {
    let missing = false;
    for (const n of names) {
      const v = envValue(dir, n, { file: opts.file });
      if (!v) missing = true;
      console.log(`${n}=${v ? v.slice(0, Math.min(opts.prefix, 12)) : ""}`);
    }
    process.exit(missing ? 4 : 0);
  }
  if (names.length !== 1) {
    console.error("One key at a time, except with --prefix.");
    process.exit(1);
  }
  const v = envValue(dir, names[0], { file: opts.file });
  if (!v) {
    console.error(`${names[0]} is not in ${opts.file ?? "the project's .env"}`);
    process.exit(4);
  }
  process.stdout.write(v);
}
