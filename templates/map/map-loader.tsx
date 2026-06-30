"use client";

// SSR-safe wrapper. MapLibre GL JS touche `window` à l'import, donc le
// composant <Map> ne peut PAS être rendu côté serveur. `next/dynamic` avec
// `ssr: false` ne peut être utilisé que depuis un client component (Next.js 14+),
// d'où ce fichier dédié - il sert de point d'entrée pour les pages serveur
// qui veulent afficher la carte :
//
//   // dans une page (server component) :
//   import { MapLoader } from "~/components/site/map-loader";
//   // …
//   <MapLoader markers={markers} />
//
// Pour le SEO / accessibilité, n'oublie pas d'ajouter un <noscript> dans la
// page parent avec une liste textuelle des markers + lien Google Maps externe.

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { MapView } from "./map";

export const MapLoader = dynamic<ComponentProps<typeof MapView>>(
  () => import("./map").then((m) => m.MapView),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          width: "100%",
          height: 420,
          borderRadius: 12,
          background: "var(--color-surface-2, #f4f1ec)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-muted, #7A7168)",
          fontSize: 14,
        }}
      >
        Chargement de la carte…
      </div>
    ),
  },
);

export type { MapMarkerData } from "./map";
