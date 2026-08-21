// blocks.mjs - Where each managed block lives and what it looks like.
//
// Kept apart from rules.mjs (what is written) and managed-block.mjs (how it is
// written) so the two CLIs and the tests agree on the markers. Changing a
// marker string orphans every block already installed: don't.

export const GLOBAL_BLOCK = {
  open: "<!-- hypervibe:rules -->",
  close: "<!-- /hypervibe:rules -->",
  heading: "## Règles globales (Hypervibe)",
  intro:
    "Bloc tenu par le plugin : une règle non modifiée se met à jour seule ; une règle que vous éditez devient la vôtre.",
};

export const PROJECT_BLOCK = {
  open: "<!-- hypervibe:project-rules -->",
  close: "<!-- /hypervibe:project-rules -->",
  heading: "### Règles Hypervibe (projet)",
  intro:
    "Bloc tenu par le plugin Hypervibe : ces règles valent pour ce projet (Next.js, Neon, déploiement). Une règle que vous éditez devient la vôtre et n'est plus touchée.",
  // Where to drop the block when the file exists but has no block yet.
  anchor: "## Conventions",
};
