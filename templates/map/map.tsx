"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Map,
  Marker,
  NavigationControl,
  Popup,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

// ───────────────────────────────────────────────────────────────────────────
// Source des tuiles vectorielles : OpenFreeMap.
//
// OpenFreeMap est gratuit, sans clé API, sans cookie, infra dédiée en Europe.
// Maintenu par 1 personne (Zsolt Ero, ex-MapHub) avec funding par dons et
// pas de SLA. La lib MapLibre GL JS (sur laquelle on s'appuie) est elle
// soutenue par AWS / Microsoft, donc rock-solid à long terme - c'est juste
// le tile provider qu'on peut vouloir swapper si OpenFreeMap tombe.
//
// Fallbacks possibles (1 ligne à changer ici, pas de refacto autre) :
//   • MapTiler (100K loads/mois free, signup) :
//       "https://api.maptiler.com/maps/streets/style.json?key=<KEY>"
//   • Stadia Maps (200K loads/mois free en dev, signup) :
//       "https://tiles.stadiamaps.com/styles/osm_bright.json"
//   • Self-host PMTiles sur Cloudflare R2 (~$3/mois) :
//       voir docs/self-host-tiles.md
// ───────────────────────────────────────────────────────────────────────────
const TILE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export interface MapMarkerData {
  id: string;
  lat: number;
  lng: number;
  label: string;
  description?: string;
}

interface MapViewProps {
  markers: MapMarkerData[];
  /** Center the map here (lat/lng). If omitted: first marker, or Paris if no markers.
   *  Ignored when fitToMarkers is true and there are 2+ markers. */
  center?: { lat: number; lng: number };
  /** Initial zoom (0 = world, 22 = building). If omitted: 14 for single marker, 5 for multi.
   *  Ignored when fitToMarkers is true and there are 2+ markers. */
  zoom?: number;
  /** Auto-frame the camera to fit all markers on load and on markers change.
   *  Default true - disable only if you have a specific center/zoom intent. */
  fitToMarkers?: boolean;
  /** Padding around the fitBounds box in px. Default 60. */
  fitPadding?: number;
  /** Max zoom level applied during fitBounds (prevents max-zoom when markers are clustered).
   *  Default 16. */
  maxFitZoom?: number;
  /** Allow scroll-wheel zoom. Default false (avoids hijacking page scroll on content pages).
   *  Set true for map-first layouts where the map IS the page. */
  scrollZoom?: boolean;
  /** Map height in px or any CSS value. Default 420. */
  height?: number | string;
  /** Extra className for the outer wrapper. */
  className?: string;
}

/**
 * Compute the [[west, south], [east, north]] bounding box that contains all
 * markers. Returns null for an empty array, and expands a single point by a
 * small margin to avoid fitBounds zooming all the way in.
 */
export function computeBounds(
  items: { lat: number; lng: number }[],
): [[number, number], [number, number]] | null {
  if (items.length === 0) return null;
  let minLat = items[0]!.lat;
  let maxLat = items[0]!.lat;
  let minLng = items[0]!.lng;
  let maxLng = items[0]!.lng;
  for (const m of items) {
    if (m.lat < minLat) minLat = m.lat;
    if (m.lat > maxLat) maxLat = m.lat;
    if (m.lng < minLng) minLng = m.lng;
    if (m.lng > maxLng) maxLng = m.lng;
  }
  if (minLat === maxLat && minLng === maxLng) {
    minLat -= 0.005;
    maxLat += 0.005;
    minLng -= 0.005;
    maxLng += 0.005;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function MapView({
  markers,
  center,
  zoom,
  fitToMarkers = true,
  fitPadding = 60,
  maxFitZoom = 16,
  scrollZoom = false,
  height = 420,
  className,
}: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<MapMarkerData | null>(null);

  const initialCenter =
    center ??
    (markers[0]
      ? { lat: markers[0].lat, lng: markers[0].lng }
      : { lat: 48.8566, lng: 2.3522 }); // Paris fallback

  const initialZoom = zoom ?? (markers.length > 1 ? 5 : 14);

  // ─── Resize the canvas when the container size changes ───────────────
  // MapLibre captures container dimensions at init and only auto-resizes on
  // window.resize. When the parent layout settles after first paint (flex/grid
  // resolving, dynamic import swap-in, sidebar opening, etc.) the canvas locks
  // to its initial size → blurry/stretched tiles. ResizeObserver fixes it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => mapRef.current?.resize());
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  // ─── Re-fit bounds when the marker set changes (e.g. filters) ────────
  useEffect(() => {
    if (!fitToMarkers || markers.length < 2 || !mapRef.current) return;
    const bounds = computeBounds(markers);
    if (!bounds) return;
    mapRef.current.fitBounds(bounds, {
      padding: fitPadding,
      duration: 600,
      maxZoom: maxFitZoom,
    });
  }, [markers, fitToMarkers, fitPadding, maxFitZoom]);

  // ─── On first map load: resize + fit ─────────────────────────────────
  const handleLoad = useCallback(() => {
    mapRef.current?.resize();
    if (fitToMarkers && markers.length >= 2) {
      const bounds = computeBounds(markers);
      if (bounds) {
        mapRef.current?.fitBounds(bounds, {
          padding: fitPadding,
          duration: 0,
          maxZoom: maxFitZoom,
        });
      }
    }
  }, [fitToMarkers, fitPadding, maxFitZoom, markers]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <Map
        ref={mapRef}
        initialViewState={{
          latitude: initialCenter.lat,
          longitude: initialCenter.lng,
          zoom: initialZoom,
        }}
        mapStyle={TILE_STYLE_URL}
        style={{ width: "100%", height: "100%" }}
        scrollZoom={scrollZoom}
        onLoad={handleLoad}
      >
        <NavigationControl position="top-right" />

        {markers.map((m) => (
          <Marker
            key={m.id}
            latitude={m.lat}
            longitude={m.lng}
            anchor="bottom"
            onClick={(e) => {
              // Empêche le clic Marker de remonter au Map et de fermer le Popup
              // qu'on est en train d'ouvrir.
              e.originalEvent.stopPropagation();
              setSelected(m);
            }}
          >
            <span
              role="img"
              aria-label={m.label}
              style={{ fontSize: 28, cursor: "pointer", lineHeight: 1 }}
            >
              📍
            </span>
          </Marker>
        ))}

        {selected && (
          <Popup
            latitude={selected.lat}
            longitude={selected.lng}
            anchor="top"
            offset={12}
            onClose={() => setSelected(null)}
            closeOnClick={false}
          >
            <div style={{ padding: "4px 8px", maxWidth: 240 }}>
              <p style={{ fontWeight: 600, margin: "0 0 4px", fontSize: 14 }}>
                {selected.label}
              </p>
              {selected.description && (
                <p style={{ fontSize: 13, color: "#555", margin: 0, lineHeight: 1.4 }}>
                  {selected.description}
                </p>
              )}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}

// Export the ref type for users who want imperative access (flyTo, etc.)
export type { MapRef };
