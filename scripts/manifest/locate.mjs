// locate.mjs - Where a project's resource manifest lives.
//
// THE RULE (self-enforced here, not left to callers):
//   ONE manifest per git repository, at the repository root.
//
//   - A MONOREPO (one repository, several apps under `apps/`) has a SINGLE
//     manifest at the repo root, listing every app's resources: the repo is
//     the unit of ownership - one git history, one backup bundle, one
//     decommissioning. Two Vercel projects deployed from the same repo are
//     simply two `vercel-project` entries in the same file.
//   - An UMBRELLA folder (a parent directory holding several repositories)
//     has NO manifest of its own: each sub-repository anchors its own.
//
// Without this module, the manifest landed wherever `--project-dir` pointed:
// aimed at `apps/web`, it was born one level too deep, and consumers aimed at
// the root (or vice versa) silently found nothing - degrading to the
// name-guessing the manifest exists to replace.
//
// Two functions, two questions:
//   depotRacine(dir)      -> the repository root above `dir` (nearest `.git`,
//                            file or folder - worktrees count), else null.
//   manifestExistant(dir) -> the nearest EXISTING manifest from `dir` upward,
//                            bounded by the repo root, else null. Reading must
//                            find a manifest even when aimed below the root -
//                            and must keep finding a legacy one written at the
//                            wrong depth rather than splitting the brain.
//   emplacementCanonique(dir) -> where a NEW manifest belongs: the repo root
//                            when there is one, the given folder otherwise
//                            (a project not yet under git).

import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

export function depotRacine(depart) {
  let dir = resolve(depart);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function manifestExistant(depart) {
  let dir = resolve(depart);
  const racine = depotRacine(dir);
  for (;;) {
    const f = join(dir, ".hypervibe", "resources.json");
    if (existsSync(f)) return f;
    if (racine !== null && dir === racine) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function emplacementCanonique(depart) {
  const racine = depotRacine(depart);
  return join(racine ?? resolve(depart), ".hypervibe", "resources.json");
}
