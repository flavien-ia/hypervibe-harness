#!/usr/bin/env node
// _env-line.mjs - A line of a project's .env, read and written as the site's own loader reads it.
//
// Next.js loads .env through dotenv: a value between quotes loses them (`\n` and `\r` between
// double quotes become line breaks), an unquoted one is trimmed and stops at the first `#` (a
// comment). Then through dotenv-expand, whatever the quotes: a `$` followed by a name or a brace
// is replaced by that variable's value (`pa$$w0rd` is read `pa$`, `x$y` is read `x`), and only
// `\$` keeps a dollar, read back `$` (measured with @next/env 15.5.26 and 16.3.4 on 10/10/2026,
// outside review, 3.4.8). The harness's tools honour that on both sides:
//   - reading: a line piped from a .env (`grep '^KEY=' .env | node push-env-vars.mjs --stdin`)
//     carries the value the site reads, never the raw text after `=`: KEY="abc" is abc, and
//     KEY=abc # note is abc. Until 3.4.5 the quotes reached the hosting with the value;
//   - writing: a value written into a .env must come back unchanged. abc#def written bare is read
//     back as abc, so it goes between quotes; every `$` is written `\$`, or the site would expand
//     it; a value no quoting can carry is refused, by its name only, never written wrong.
//   - a line whose value holds an unescaped `$name` depends on the rest of the file and on the
//     environment: its value cannot be read from the line alone (dotenvExpands), and the tools
//     that push a line to the hosting refuse it rather than guess.
//
//   printf '%s' "$VALUE" | node _env-line.mjs KEY      the .env line of a raw value, on stdout
//                                                      (exit 1 when it cannot be written)
//
// The value is never printed anywhere but in the line itself, and never in a message.

import { readFileSync } from "node:fs";

/** What dotenv leaves of what follows `=`, before dotenv-expand: quotes taken off, `\n` and `\r`
 *  turned into line breaks between double quotes, a bare value trimmed and cut at its `#`. */
function unquoted(raw) {
  const m = /^\s*(?:'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"|`((?:\\`|[^`])*)`|([^#\r\n]*))/.exec(String(raw ?? ""));
  if (m[2] !== undefined) return m[2].replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  if (m[1] !== undefined) return m[1];
  if (m[3] !== undefined) return m[3];
  return (m[4] ?? "").trim();
}

/** An unescaped `$` that dotenv-expand replaces: followed by a name or a brace, not after a `\`. */
const EXPANDED = /(?<!\\)\$(?:\{|\w)/;

/** Whether the site's loader replaces part of this value with another variable's: an unescaped
 *  `$name` or `${name}`. Its value then depends on the rest of the file and on the environment,
 *  and cannot be read from the line alone. */
export function dotenvExpands(raw) {
  return EXPANDED.test(unquoted(raw));
}

/** The value the site's loader reads from what follows `=` on a .env line: unquoted as dotenv
 *  does, then every `\$` read back `$` as dotenv-expand does. A line that dotenvExpands is read
 *  without the expansion, which no single line can tell. */
export function dotenvValue(raw) {
  return unquoted(raw).replace(/\\\$/g, "$");
}

/** A .env line the site's loader reads back as exactly `value`: bare when it can be, between
 *  quotes otherwise (line breaks written as `\n` between double quotes). Throws, naming the key
 *  and never the value, when no form carries it. */
export function dotenvLine(key, value) {
  const v = String(value ?? "");
  // Every `$` written `\$`: dotenv-expand reads it back `$`, between quotes or not.
  const e = v.replace(/\$/g, "\\$");
  const candidates = [e, `'${e}'`, `"${e}"`, `\`${e}\``, `"${e.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`];
  for (const written of candidates) {
    if (!/[\r\n]/.test(written) && dotenvValue(written) === v) return `${key}=${written}`;
  }
  throw new Error(`${key}: this value cannot be written on a .env line so that the site reads it back unchanged (it mixes every kind of quote, or a line break with a double quote).`);
}

// ─── Launched as a script, or imported ────────────────────────────────────────
// Node gives a module its real path and keeps in argv[1] the path as it was typed. Compared as
// they come, the two differ as soon as the plugin is reached through a symbolic link (macOS's
// temporary folder, a ~/.claude kept by a configuration repository): the script then did
// nothing and exited 0, "I could not" read as "nothing to report" (outside review, 3.3.9).
// Both are read to their real path. The same block in every script, held by
// scripts/tests/test-entry-point.mjs.
import { realpathSync as realPathOf } from "node:fs";
import { fileURLToPath as pathOfUrl } from "node:url";
function launchedDirectly() {
  try {
    if (!process.argv[1]) return false;
    const self = realPathOf(pathOfUrl(import.meta.url));
    const launched = realPathOf(process.argv[1]);
    return process.platform === "win32" ? self.toLowerCase() === launched.toLowerCase() : self === launched;
  } catch {
    return false;
  }
}

if (launchedDirectly()) {
  const key = process.argv[2];
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.argv.length > 3) {
    console.error("Usage: printf '%s' \"$VALUE\" | node _env-line.mjs KEY   (the value on the standard input, never as an argument)");
    process.exit(1);
  }
  // One value: a single trailing line break is what printf or a here-string adds, never part of it.
  const value = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  try {
    process.stdout.write(`${dotenvLine(key, value)}\n`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
