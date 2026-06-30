# /add-map

Adds an **interactive map** to your site (contact page, list of branches, events, or an app fully built around a map). Free, no API key to manage, GDPR-friendly.

## When to use it

- You want to display **your business address** on the contact page
- You have **several locations** to show (branches, shops, schools, events)
- You are building a **map-first app** (geolocated directory, service locator)
- You want to trace a **route** or an **area**

## How it works

1. **One question**: Hypervibe asks you what you want to do with the map. From your answer, it infers everything else (how many points, on which page, static or interactive).
2. **You provide the locations**: either the postal address (Hypervibe geocodes it automatically via OpenStreetMap), or directly the GPS coordinates if you have them.
3. **Hypervibe installs the technical building blocks**: the map library (MapLibre GL JS), the React components, and the connection to the tile service (OpenFreeMap: free, no key).
4. **Hypervibe wires the map onto the right page**: depending on your use case, it is integrated into your contact page, into a new dedicated page (`/agences`, `/locations`...), or full screen on the home.
5. **Text fallback for SEO**: under each map, Hypervibe automatically adds the textual list of points with a Google Maps link. This way, Google indexes the addresses and screen readers can access them.
6. **Privacy policy update**: OpenFreeMap is added as a subprocessor (it sees the visitor's IP when it loads the tiles: no cookie, infrastructure in Europe).

## What it creates for you

- A **map component** (`src/components/site/map.tsx`) already styled, ready to receive points
- A **safe wrapper** (`map-loader.tsx`) that prevents server-side rendering bugs
- **Your points** either hardcoded in the code (1-3 locations), or in a data file (`src/lib/locations.ts`, 4-30 locations), or in a database table (more than 30 locations or a need for an admin to edit them)
- The **map displayed on the chosen page** with a popup on point click
- The **HTML fallback** under the map for SEO and accessibility
- An **OpenFreeMap entry** in your privacy policy

## Prerequisites

- The project must be in Next.js (typically initialized by `/bootstrap`)
- Your addresses or GPS coordinates
- That is all: **no credit card to provide, no API key to create, no sign-up**

## Tips

{{callout:tip|Why OpenFreeMap and not Google Maps?}}
Google Maps requires a credit card (even if the free tier covers most cases), an API key to manage, and sends data to the United States. OpenFreeMap is a European open source project, free with no conditions, no key, no cookie. The **same** OpenStreetMap data (maps, streets, businesses) without the complexity.
{{/callout}}

{{callout:info|Five styles available}}
Liberty (default, balanced), Positron (light and minimalist), Bright (vivid colors), Dark (dark mode), Fiord 3D (3D relief). To change: edit the `TILE_STYLE_URL` constant at the top of `src/components/site/map.tsx`. No other modification needed.
{{/callout}}

{{callout:tip|Several hundred points?}}
If you have many points in a small area (like the shops of a city), ask Claude *"add clustering on the map"* after the install. MapLibre natively supports automatically grouping nearby points into clickable clusters.
{{/callout}}

{{callout:warning|Geocoding at runtime}}
If your users enter free-text addresses in a form and you want to display them on the map automatically, that requires a paid geocoding service (Mapbox / MapTiler): OpenStreetMap Nominatim limits too strictly for that. Hypervibe uses Nominatim **only at install time** for your fixed points, not in production.
{{/callout}}
