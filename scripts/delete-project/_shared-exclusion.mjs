// _shared-exclusion.mjs - A resource the project's manifest declares SHARED never leaves
// with the project, whatever its kind.
//
// The name scans of discover-resources.mjs may pick it up (a shared bucket, database or
// service whose name contains the project's); this takes it back out of the deletion
// inventory, into the section's `excluded` list, with the reason. Until the storage lot
// (18/09/2026) only a shared worker was taken out: a shared bucket, database, service or
// webhook stayed on the list, although the manifest promises the opposite.

const EXCLUDED_REASON = "declared shared in the project manifest (never deleted here)";

// kind -> [section of the inventory, list inside it, "is this entry that resource?"]
const SAME = {
  "cf-worker": ["workers", "workers", (item, r) => String(item.id || "").toLowerCase() === String(r.name || "").toLowerCase()],
  "r2-bucket": ["r2", "buckets", (item, r) => item.name === r.name && (item.jurisdiction || "global") === (r.jurisdiction === "eu" ? "eu" : "global")],
  "neon-project": ["neon", "projects", (item, r) => Boolean((r.id && item.id === r.id) || (r.name && item.name === r.name))],
  "render-service": ["render", "services", (item, r) => Boolean((r.id && item.id === r.id) || (r.name && item.name === r.name))],
  "stripe-webhook": ["stripe", "webhooks", (item, r) => Boolean((r.id && item.id === r.id) || (r.name && item.url === r.name))],
};

/** Takes a declared shared resource out of its inventory section, in place.
 *  @param {Record<string, any>} sections  { workers, r2, neon, render, stripe }, as discover builds them
 *  @param {{kind: string, name?: string, id?: string, jurisdiction?: string}} resource
 *  @returns {number} how many inventory entries left the deletion list */
export function excludeShared(sections, resource) {
  const rule = SAME[resource?.kind];
  if (!rule) return 0;
  const [sectionName, listKey, same] = rule;
  const section = sections?.[sectionName];
  if (!section || !Array.isArray(section[listKey])) return 0;
  const kept = [];
  let moved = 0;
  for (const item of section[listKey]) {
    if (same(item, resource)) {
      section.excluded = [...(section.excluded || []), { ...item, excludedReason: EXCLUDED_REASON }];
      moved += 1;
    } else {
      kept.push(item);
    }
  }
  if (moved) {
    section[listKey] = kept;
    section.found = kept.length > 0;
  }
  return moved;
}
