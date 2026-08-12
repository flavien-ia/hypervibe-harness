// neon-org.mjs - resolve WHICH Neon organisation the plugin is talking to.
//
// Neon's /projects endpoints are organisation-scoped, and that is easy to miss because
// omitting the scope does NOT fail. A personal API key with no `org_id` silently answers
// for the account's DEFAULT organisation. So an account whose projects live in an
// organisation it created gets:
//   - an empty project list, so the name-collision guard confidently reports "no clash",
//   - a creation that lands somewhere else, or trips the default organisation's free
//     project cap with a message that names neither the organisation nor the remedy.
// Both failures are silent, which is what makes them expensive. An ORGANISATION api key
// scopes itself and needs no parameter at all.
//
// Resolution order, deliberately explicit rather than clever:
//   1. NEON.org_id in the vault  -> it has been decided. Always wins.
//   2. exactly one organisation  -> unambiguous, use it.
//   3. anything else             -> null, plus the reason. Callers then keep today's
//      behaviour (Neon's implicit default) and can PRINT the remedy instead of lying.
//
// Never guess among several: `users/me/organizations` lists every organisation the key
// is a MEMBER of, other people's included. Picking the first one would create a project
// inside someone else's account.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://console.neon.tech/api/v2";

/** Memoised per process: several call sites resolve the organisation during one command. */
let cache = null;

/**
 * @param {string} apiKey                      Neon API key (personal or organisation).
 * @param {(item: string, field: string) => string} vaultGet  Reader, "" when unavailable.
 * @returns {Promise<{orgId: string|null, source: string, orgs: Array<{id: string, name: string}>}>}
 *   source: "vault" | "unique" | "cle-org" | "ambigu" | "aucune" | "injoignable"
 */
export async function resolveNeonOrg(apiKey, vaultGet) {
  if (cache) return cache;

  const configured = (vaultGet("NEON", "org_id") || "").trim();
  if (configured) {
    cache = { orgId: configured, source: "vault", orgs: [] };
    return cache;
  }

  let orgs = [];
  try {
    const res = await fetch(`${API}/users/me/organizations`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    // An organisation-scoped key cannot enumerate a user's organisations. It also does
    // not need to: it is already bound to one, so no parameter is the correct answer.
    if (!res.ok) {
      cache = { orgId: null, source: res.status === 401 ? "injoignable" : "cle-org", orgs: [] };
      return cache;
    }
    const data = await res.json();
    orgs = (data.organizations || []).map((o) => ({ id: o.id, name: o.name }));
  } catch {
    cache = { orgId: null, source: "injoignable", orgs: [] };
    return cache;
  }

  if (orgs.length === 1) cache = { orgId: orgs[0].id, source: "unique", orgs };
  else if (orgs.length === 0) cache = { orgId: null, source: "aucune", orgs };
  else cache = { orgId: null, source: "ambigu", orgs };
  return cache;
}

/** Append `org_id` to a Neon URL, whatever query string it already carries. */
export function withOrg(url, orgId) {
  if (!orgId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}org_id=${encodeURIComponent(orgId)}`;
}

/** Same idea for a creation body: Neon takes the organisation inside `project`. */
export function withOrgBody(project, orgId) {
  return orgId ? { ...project, org_id: orgId } : project;
}

/**
 * One sentence naming what was targeted and, when it could not be decided, how to decide
 * it. This is the whole point of the module: the previous failure mode was not that the
 * call was wrong, it was that nothing said which organisation was being read.
 */
export function orgHint(resolved) {
  const { orgId, source, orgs } = resolved;
  if (source === "vault") return `Organisation Neon : ${orgId} (réglée dans le coffre).`;
  if (source === "unique") return `Organisation Neon : ${orgId} (la seule du compte).`;
  if (source === "cle-org") return "Organisation Neon : celle de la clé (clé d'organisation).";
  if (source === "injoignable") {
    return "Organisation Neon indéterminée (Neon injoignable) : lecture sur l'organisation par défaut du compte.";
  }
  if (source === "aucune") {
    return "Aucune organisation Neon sur ce compte : lecture sur l'espace personnel.";
  }
  const liste = orgs.map((o) => `${o.name} (${o.id})`).join(", ");
  return [
    `Ce compte Neon appartient à plusieurs organisations : ${liste}.`,
    "Faute de savoir laquelle porte tes projets, je lis l'organisation par défaut du compte,",
    "ce qui peut passer à côté de projets existants. Pour trancher une fois pour toutes, range",
    "son identifiant dans le coffre (champ org_id de l'élément NEON) ou relance /start.",
  ].join(" ");
}

/** Test seam: the memo would otherwise leak between cases in one process. */
export function resetNeonOrgCache() {
  cache = null;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
// `/start` needs to SEE the organisations and then RECORD the right one, without anyone
// typing a command. An organisation id is not a secret, so it is written programmatically
// (putItem merges fields, it does not replace them).
//
//   node neon-org.mjs detect          -> JSON: organisations + current resolution
//   node neon-org.mjs set <org_id>    -> stores NEON.org_id, prints created|updated
//
// Compare resolved paths, not suffixes: every importer's URL also ends in "neon-org.mjs",
// so a name test would fire this block on import and print JSON into someone else's output.
const estCLI = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (estCLI) {
  const [, , sous, valeur] = process.argv;
  const { getSecret, putItem } = await import("./vault/vault.mjs");
  const lire = (item, field) => { try { return getSecret(item, field) || ""; } catch { return ""; } };

  if (sous === "detect") {
    const cle = lire("NEON", "api_key");
    if (!cle) {
      console.log(JSON.stringify({ status: "cle_absente" }));
    } else {
      const r = await resolveNeonOrg(cle, lire);
      console.log(JSON.stringify({ status: "ok", ...r, hint: orgHint(r) }, null, 2));
    }
  } else if (sous === "set") {
    if (!valeur || !/^org-[a-z0-9-]+$/.test(valeur)) {
      console.error("Usage: node neon-org.mjs set <org-...>");
      process.exitCode = 1;
    } else {
      const etat = putItem("NEON", [{ name: "org_id", value: valeur, type: "text" }], { service: "Neon" });
      console.log(JSON.stringify({ status: etat, org_id: valeur }));
    }
  } else {
    console.error("Usage: node neon-org.mjs <detect|set <org-id>>");
    process.exitCode = 1;
  }
}
