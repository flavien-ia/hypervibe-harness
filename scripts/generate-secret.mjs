#!/usr/bin/env node
// Generate a cryptographically secure random secret.
//
// Usage:
//   node generate-secret.mjs [--format hex|base64url|alphanumeric] [--length N]
//
// Defaults:
//   --format   hex           (shell-safe, URL-safe, [0-9a-f])
//   --length   32            (byte count for hex/base64url; CHAR count for alphanumeric)
//
// Output:
//   The secret on stdout, no trailing newline. Caller captures via shell substitution
//   (`SECRET=$(node ...)`) or pipes directly into another command.
//
// Formats:
//   hex          → 2*N chars,  [0-9a-f]            (e.g. `a1b2...`)
//   base64url    → ~1.33*N chars, [A-Za-z0-9_-]    (URL-safe, no / + =)
//   alphanumeric → exactly N chars, [A-Za-z0-9]    (for human-typeable passwords)

import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
let format = "hex";
let length = 32;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--format" && args[i + 1]) {
    format = args[++i];
  } else if (args[i] === "--length" && args[i + 1]) {
    length = parseInt(args[++i], 10);
  } else {
    console.error(`Unknown arg: ${args[i]}`);
    process.exit(1);
  }
}

if (!["hex", "base64url", "alphanumeric"].includes(format)) {
  console.error(`Invalid --format: ${format} (expected hex | base64url | alphanumeric)`);
  process.exit(1);
}
if (!Number.isFinite(length) || length < 1) {
  console.error(`Invalid --length: must be a positive integer`);
  process.exit(1);
}

if (format === "hex") {
  process.stdout.write(randomBytes(length).toString("hex"));
} else if (format === "base64url") {
  process.stdout.write(randomBytes(length).toString("base64url"));
} else {
  // alphanumeric - length is CHAR count, not byte count
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const maxByte = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2); // oversample to absorb modulo-bias rejection
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < maxByte) out += alphabet[bytes[i] % alphabet.length];
    }
  }
  process.stdout.write(out);
}
