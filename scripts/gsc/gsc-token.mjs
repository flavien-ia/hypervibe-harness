#!/usr/bin/env node
// gsc-token.mjs - Mint a Google OAuth2 access token for Search Console from the service
// account stored in the Bitwarden vault (item GSC_SERVICE_ACCOUNT, field "credentials").
//
// Cross-OS (pure Node). The SA JSON is read from the vault via vault.mjs (in-memory), the JWT
// is signed with the private key, exchanged for an access token, printed to stdout. Nothing
// touches disk; the private key never leaves this process.
//
//   node gsc-token.mjs            -> access token, scope webmasters (read+write)
//   node gsc-token.mjs --readonly -> access token, scope webmasters.readonly
//
// Exit codes mirror vault.mjs so the calling skill can auto-unlock / auto-add:
//   0 ok | 2 vault locked | 3 session expired | 4 GSC_SERVICE_ACCOUNT not in vault | 1 other

import crypto from "node:crypto";
import { getSecret } from "../vault/vault.mjs";

// Default (read+write) token carries BOTH webmasters (read/write GSC data + sites.add) AND
// siteverification (add+verify a new Domain property). --readonly = analytics/inspection only.
const readonly = process.argv.includes("--readonly");
const SCOPE = readonly
  ? "https://www.googleapis.com/auth/webmasters.readonly"
  : "https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/siteverification";

// 1. Pull the SA JSON from the vault (propagate vault exit codes for auto-unlock/auto-add).
let sa;
try {
  sa = JSON.parse(getSecret("GSC_SERVICE_ACCOUNT", "credentials"));
} catch (e) {
  if (e.code) process.exit(e.code);     // 2/3/4 → skill handles
  console.error("GSC_SERVICE_ACCOUNT credentials are not valid JSON.");
  process.exit(1);
}

// 2. Build + sign the JWT (RS256).
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const claims = b64url(
  JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, exp: now + 3600, iat: now })
);
const signingInput = `${header}.${claims}`;
const signer = crypto.createSign("RSA-SHA256");
signer.update(signingInput);
const jwt = `${signingInput}.${b64url(signer.sign(sa.private_key))}`;

// 3. Exchange the JWT for an access token.
const res = await fetch(sa.token_uri, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }),
});
const data = await res.json();
if (!data.access_token) {
  console.error("Token exchange failed:", JSON.stringify(data));
  process.exit(1);
}
process.stdout.write(data.access_token);
