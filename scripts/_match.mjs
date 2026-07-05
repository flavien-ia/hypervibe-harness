// _match.mjs - Project-name matching helpers, shared by /delete-project
// (discover-resources.mjs, execute-deletions.mjs) and by the /bootstrap name
// collision guard (check-name-collision.mjs). The naive
// `String.includes(project)` used to sweep up resources of OTHER projects:
// deleting "art" matched "smart-app", deleting "street" matched everything of
// "street-cool", and a project named "hypervibe" would have matched the
// shared "hypervibe-jobs" worker. The bootstrap guard reuses the same
// primitives so both skills agree on what "collides" means.
//
// Two primitives fix that:
//
//   tokenMatches(project, s)
//     True when `project` appears in `s` as a whole token, delimited by
//     non-alphanumeric characters (start/end count as boundaries). "_" is
//     normalized to "-" on both sides, so "street-cool" also matches
//     "project_street_cool.md". "art" no longer matches "cartel"/"smart-app",
//     but "street" still matches "street-backups" (derived resources keep
//     matching, that is the recall we want).
//
//   moreSpecificOwner(project, s, candidates)
//     The disambiguation step for sibling projects sharing a prefix: returns
//     the LONGEST candidate project name (from `candidates`) that also
//     token-matches `s` and is strictly longer than `project`, or null.
//     When deleting "street", "street-cool-db" is claimed by the known
//     project "street-cool" and must be left untouched.

export function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/_/g, "-");
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REGEX_CACHE = new Map();
function boundaryRegex(project) {
  const p = normalizeName(project);
  let re = REGEX_CACHE.get(p);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}([^a-z0-9]|$)`);
    REGEX_CACHE.set(p, re);
  }
  return re;
}

export function tokenMatches(project, s) {
  if (!project || !s) return false;
  return boundaryRegex(project).test(normalizeName(s));
}

// Count boundary occurrences of `project` in `s` (used for memory mentions).
export function tokenMatchCount(project, s) {
  if (!project || !s) return 0;
  const p = escapeRegExp(normalizeName(project));
  const re = new RegExp(`(^|[^a-z0-9])${p}(?=[^a-z0-9]|$)`, "g");
  return (normalizeName(s).match(re) || []).length;
}

export function moreSpecificOwner(project, s, candidates) {
  const p = normalizeName(project);
  let best = null;
  for (const raw of candidates || []) {
    const c = normalizeName(raw);
    if (!c || c === p || c.length <= p.length) continue;
    if (!tokenMatches(c, s)) continue;
    if (!best || c.length > best.length) best = c;
  }
  return best;
}
