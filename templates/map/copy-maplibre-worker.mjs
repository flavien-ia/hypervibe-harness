// Recopie le web worker de MapLibre GL JS dans public/maplibre/.
//
// Lancé par les hooks `predev`, `prebuild` et `prepreview` du package.json,
// donc avant chaque démarrage de Next, en local comme sur Vercel. Le worker
// importe son voisin `maplibre-gl-shared.mjs` par chemin relatif : les deux
// fichiers doivent arriver dans le même dossier. La copie part de
// node_modules, elle suit donc toujours la version installée, et c'est aussi
// pourquoi public/maplibre/ est ignoré par git.
//
// Pourquoi pas le bundler : sous Next.js, ni Turbopack ni webpack n'émettent
// ce fichier voisin, et l'adresse que MapLibre devine seul est fausse.
// Méthode documentée par MapLibre (onglet Turbopack) :
// https://maplibre.org/maplibre-gl-js/docs/#installation

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(
  path.dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")),
  "dist",
);
const dest = path.join(here, "..", "public", "maplibre");
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const missing = files.filter((file) => !existsSync(path.join(dist, file)));
if (missing.length) {
  console.error(
    `Worker MapLibre introuvable dans node_modules/maplibre-gl/dist (${missing.join(", ")}) : ce script vise maplibre-gl 6 ou plus.`,
  );
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const file of files) {
  copyFileSync(path.join(dist, file), path.join(dest, file));
}
