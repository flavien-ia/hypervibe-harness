// same-resource.mjs - Is this manifest entry the resource we are about to record?
//
// What makes `add` and `adopt` idempotent: an entry that names the same resource is updated in
// place, never written twice. Same kind, then the surest identifier both sides carry: the id,
// the name (with its jurisdiction for a bucket: the same name can exist in two of them), and
// last the HOST. A database adopted where no provider key could say more (a closed vault, a key
// that does not reach its organisation) is known by its host alone: adopting again, or adopting
// later with a key that resolves its id and name, completes that entry instead of adding a
// second one. Until 3.3.9 the host was not compared, and a second `adopt --write` wrote the
// same database twice.

export function sameResource(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.id && b.id) return a.id === b.id;
  if (a.name && b.name) {
    if (a.name !== b.name) return false;
    if (a.kind === "r2-bucket") return (a.jurisdiction || "default") === (b.jurisdiction || "default");
    return true;
  }
  return Boolean(a.host && b.host && a.host === b.host);
}
