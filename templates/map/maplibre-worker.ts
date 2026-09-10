// Désigne à MapLibre GL JS son web worker, servi depuis public/maplibre/.
//
// À importer (`import "~/components/site/maplibre-worker";`) en tête de tout
// composant qui crée une carte, avant son premier rendu : MapView le fait
// déjà. MapLibre lance ses workers une seule fois par page, avec l'adresse
// connue à ce moment-là. Une carte qui oublie l'import s'affiche sans aucune
// donnée vectorielle (ni routes, ni noms, ni couches GeoJSON), son `onLoad` ne
// se déclenche jamais, et la console ne dit rien de clair.
//
// Pourquoi : MapLibre GL JS v6 décode les tuiles dans un web worker, et
// derrière un bundler il faut lui dire où le trouver. Sous Next.js (Turbopack
// comme webpack), l'adresse qu'il devine seul pointe sur la page elle-même.
// Le worker et son voisin `maplibre-gl-shared.mjs` sont donc recopiés depuis
// node_modules par `scripts/copy-maplibre-worker.mjs`, lancé avant chaque
// `dev`, `build` et `preview` (hooks `pre*` du package.json).
//
// Versions minimales, à ne pas redescendre :
//   • maplibre-gl 6.4.1 : faille XSS dans le nettoyage des attributions
//     (GHSA-jrc7-96c5-q579), corrigée en 6.4.1 et jamais sur la ligne 5 ;
//   • react-map-gl 8.1.2 : les versions d'avant lisent `map.transform`,
//     supprimé en v6, et chaque mouvement de caméra fait planter la page.

import { setWorkerUrl } from "maplibre-gl";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
