// neon-host.mjs - Is this host one of the provider's?
//
// SQL over HTTP posts the WHOLE connection string, password included, in a header of a
// request to https://<host>/sql. Every script that speaks it asks here first: a
// DATABASE_URL pointing anywhere else (another Postgres, a stale .env, a pasted value)
// must be refused, never posted to whatever web server answers at that name.
//
// One definition, imported by run-sql.mjs, schema-drift.mjs and, in the collaborator's
// harness, apply-bienvenue.mjs.

/** True for ep-xxx.<region>.aws.neon.tech, its -pooler twin, and the azure hosts. */
export function hoteDuFournisseur(host) {
  return /(?:^|\.)neon\.tech$/i.test(String(host || ""));
}

/** The host of a connection string, or null when it cannot be parsed. Never throws, and
 *  never returns anything else of the string: the host is not a secret, the rest is. */
export function hoteDe(conn) {
  try {
    return new URL(conn).hostname || null;
  } catch {
    return null;
  }
}
