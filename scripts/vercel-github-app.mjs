#!/usr/bin/env node
// vercel-github-app.mjs - Is Vercel's GitHub application installed on a GitHub account, with access
// to all its repositories? The link between a GitHub repository and a Vercel project goes through
// it: without it, or limited to "Only select repositories", a repository created later is not seen,
// and its pushes stop deploying (/bootstrap only found it out afterwards: GH_VERCEL_CONNECT_FAILED,
// GH_VERCEL_INTEGRATION_MISSING). Read only. Vercel's API is the one that can say it: GitHub lists an
// application's installations to that application alone.
//
// Two traps, said by /start with the result:
//   - signing in to Vercel "with GitHub" does not install the application: it is a sign-in, not the
//     right to read the repositories;
//   - an installation limited to some repositories does not see the projects created afterwards.
//
//   node vercel-github-app.mjs [--account <github login>] [--token-from cli|vault]
//     --account     the GitHub account the projects are created in (default: gh's signed-in login)
//     --token-from  cli (default): this machine's Vercel login; vault: the VERCEL item's api_token
//
// One JSON object on the standard output, exit 0 whatever the answer (the skill reads it):
//   {status: "installed", account, ownerType}
//   {status: "restricted", account, ownerType, configureUrl}  installed, but Vercel says its access
//      is restricted: limited to some repositories, or an installation Vercel can no longer use
//   {status: "missing", account, installUrl}                  not installed on that account
//   {status: "unknown", account, reason, installUrl}          not verifiable: never taken for installed
// Exit 1: arguments this script does not know.
//
// Vercel's answer (read on 30/09/2026, GET /v1/integrations/git-namespaces?provider=github): one
// entry per GitHub account where the application is installed, {provider, slug, ownerType
// ("user" | "team" for an organisation), installationId, isAccessRestricted, requireReauth}. It
// takes no team: the installations are those of the Vercel user's GitHub connection.
//
// Recettes only: HYPERVIBE_VERCEL_API (a fake API, on the loopback only, so that the key can never be
// sent anywhere else) and HYPERVIBE_GH_BIN (a stand-in for gh, a .mjs run by node).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const INSTALL_URL = "https://vercel.com/integrations/github";

/** The API's base: Vercel's, or a recette's fake on the loopback (never anything else). */
export function apiBase(env = process.env) {
  const override = env.HYPERVIBE_VERCEL_API;
  return override && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(override) ? override : "https://api.vercel.com";
}

/** Where the installation's settings are, on GitHub: a person's own, or an organisation's. */
export function configureUrl(ns) {
  const id = /^\d+$/.test(String(ns?.installationId ?? "")) ? `/${ns.installationId}` : "";
  return ns?.ownerType === "user"
    ? `https://github.com/settings/installations${id}`
    : `https://github.com/organizations/${encodeURIComponent(ns?.slug ?? "")}/settings/installations${id}`;
}

/** The verdict for one account, from Vercel's list of namespaces. */
export function evaluate(namespaces, account) {
  if (!Array.isArray(namespaces)) return { status: "unknown", account, reason: "Vercel's answer is not a list of accounts.", installUrl: INSTALL_URL };
  const ns = namespaces.find((n) => (n?.provider ?? "github") === "github" && String(n?.slug ?? "").toLowerCase() === String(account).toLowerCase());
  if (!ns) return { status: "missing", account, installUrl: INSTALL_URL };
  if (ns.isAccessRestricted === true || ns.requireReauth === true) {
    return { status: "restricted", account: ns.slug, ownerType: ns.ownerType ?? null, configureUrl: configureUrl(ns) };
  }
  return { status: "installed", account: ns.slug, ownerType: ns.ownerType ?? null };
}

/** gh's signed-in login, or null. */
function ghLogin() {
  const standin = process.env.HYPERVIBE_GH_BIN;
  const r = standin
    ? spawnSync(process.execPath, [standin, "api", "user", "--jq", ".login"], { encoding: "utf8", windowsHide: true })
    : spawnSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  const login = r.status === 0 ? String(r.stdout ?? "").trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login) ? login : null;
}

/** The key, from this machine's Vercel login or from the vault; never printed. */
async function token(from) {
  if (from === "vault") {
    const vault = join(HERE, "vault", "vault.mjs");
    if (!existsSync(vault)) return { token: null, reason: "This harness has no vault module." };
    try {
      const { getSecret } = await import(pathToFileURL(vault).href);
      const t = getSecret("VERCEL", "api_token");
      return t ? { token: t } : { token: null, reason: "The vault holds no VERCEL api_token." };
    } catch (e) {
      return { token: null, reason: `The vault did not give the Vercel key (${String(e?.message ?? e).split("\n")[0].slice(0, 120)}).` };
    }
  }
  const reader = join(HERE, "_vercel-auth.mjs");
  if (existsSync(reader)) {
    const { loadAuthToken } = await import(pathToFileURL(reader).href);
    const t = loadAuthToken();
    if (t) return { token: t };
  } else if (process.env.VERCEL_TOKEN) {
    return { token: process.env.VERCEL_TOKEN };
  }
  return { token: null, reason: "No Vercel login on this machine (vercel login)." };
}

async function main() {
  const args = process.argv.slice(2);
  let account = null;
  let from = "cli";
  for (let i = 0; i < args.length; i++) {
    // An empty --account is a name the caller could not read (the vault's, for an organisation):
    // said as not verifiable below, never a usage error.
    if (args[i] === "--account" && i + 1 < args.length) account = args[++i].trim();
    else if (args[i] === "--token-from" && ["cli", "vault"].includes(args[i + 1])) from = args[++i];
    else {
      console.error("Usage: node vercel-github-app.mjs [--account <github login>] [--token-from cli|vault]");
      process.exitCode = 1;
      return;
    }
  }
  const say = (o) => console.log(JSON.stringify(o));
  if (account === "") return say({ status: "unknown", account: null, reason: "The GitHub account's name is empty: it could not be read (for an organisation, the vault's GITHUB org_name).", installUrl: INSTALL_URL });
  account ??= ghLogin();
  if (!account) return say({ status: "unknown", account: null, reason: "The GitHub account is not known: gh is not signed in (gh auth login).", installUrl: INSTALL_URL });
  const key = await token(from);
  if (!key.token) return say({ status: "unknown", account, reason: key.reason, installUrl: INSTALL_URL });
  let r;
  try {
    r = await fetch(`${apiBase()}/v1/integrations/git-namespaces?provider=github`, {
      headers: { Authorization: `Bearer ${key.token}` },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return say({ status: "unknown", account, reason: `Vercel did not answer (${String(e?.name ?? e)}).`, installUrl: INSTALL_URL });
  }
  if (r.status === 401 || r.status === 403) return say({ status: "unknown", account, reason: `Vercel refused the key (HTTP ${r.status}).`, installUrl: INSTALL_URL });
  if (!r.ok) return say({ status: "unknown", account, reason: `Vercel answered HTTP ${r.status}.`, installUrl: INSTALL_URL });
  let list;
  try {
    list = await r.json();
  } catch {
    return say({ status: "unknown", account, reason: "Vercel's answer is not JSON.", installUrl: INSTALL_URL });
  }
  say(evaluate(list, account));
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

if (launchedDirectly()) await main();
