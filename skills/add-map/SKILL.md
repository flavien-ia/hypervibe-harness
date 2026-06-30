---
name: add-map
description: Add an interactive vector map to a Next.js project using MapLibre GL JS + OpenFreeMap (free, no API key, no cookies, EU servers). Supports single pin, multi-pin, route, or full map-first layouts. Can be called by /bootstrap or standalone.
argument-hint: "[brief description of what the map will display]"
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add Map - MapLibre GL JS + OpenFreeMap

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Add an interactive vector map to the current Next.js project. Default stack:
- **MapLibre GL JS** (vector rendering library - gold sponsors AWS / Microsoft, AWS Location Service built on top of it, rock-solid)
- **OpenFreeMap** (free tile provider, no API key, no cookie, EU infrastructure)
- **react-map-gl** (idiomatic React wrapper for MapLibre)

Can be called by `/bootstrap` or standalone. The deterministic scaffolding is delegated to `scripts/setup-map.mjs` - the skill only handles discovery + page-specific wiring.

---

## Step 0 - Preflight: is the map already installed?

Check whether `src/components/site/map.tsx` already exists. If it does: you do NOT need to re-scaffold. Ask the user what they want to do:

> You already have a map installed (`src/components/site/map.tsx`). What do you want to do?
>
> 1. **Add a new page with a map** - I just wire up a new page component
> 2. **Change the points displayed** on the existing map - tell me what
> 3. **Change the map style** (Liberty / Positron / Bright / Dark / Fiord 3D - see the `TILE_STYLE_URL` line in map.tsx)
> 4. **Re-scaffold from scratch** (first delete `src/components/site/map.tsx` and `map-loader.tsx`)

Depending on the answer, jump to the relevant step. The rest of this skill describes the initial install flow.

---

## Step 1 - Discovery (a single question)

**Standalone mode** (the user runs `/add-map` themselves): ask ONE question, parse the answer in natural language:

> What do you want to do with your map? Describe it in a few words - a single point (like your address), several points (branches, shops, events), an area, a route, or a map-first app.

Wait for the answer. From the user's text, infer:

| Inferred field | Possible values | How to infer it |
|---|---|---|
| `usage` | `single`, `multi`, `route`, `mapfirst` | "address" / "headquarters" -> single ; "branches" / "shops" / "points" / "events" -> multi ; "route" / "itinerary" / "trip" -> route ; "map-first app" / "map at the center" -> mapfirst |
| `placement` | `contact`, `dedicated`, `home`, `footer`, `admin` | If a page already exists (like `/contact`), integrate into it. Otherwise create a dedicated page (`/locations`, `/agences`, `/map` depending on the context). For mapfirst: home page (`/`). |
| `layout` | `embedded`, `mapfirst` | See the inference rules below. This field determines the CSS chassis - not an extra question. |
| `interactivity` | `static`, `popup`, `search` | single -> popup on pin click ; multi -> popup + (optional) side list ; mapfirst -> popup + search + filters |
| `markers_source` | `inline`, `file`, `db` | 1-3 markers -> inline JSX ; 4-30 markers -> `src/lib/locations.ts` ; > 30 or requires an admin UI -> DB table |

### Infer `layout` automatically (no extra question)

The `layout` field decides which CSS chassis to generate (embedded inline vs map-first with viewport lock + responsive sidebar/Sheet). Inference rule, applied in this order:

1. `usage = single` -> `embedded` (an isolated point is almost always a "where to find us" complement to a content page).
2. `usage = multi` and `placement = contact|footer|admin` -> `embedded` (the map is a section within a page that already has its own subject).
3. explicit `usage = mapfirst` -> `mapfirst`.
4. `usage = multi` and `placement = home` OR (`placement = dedicated` AND the description does not mention a main feature other than the map) -> `mapfirst`. Additional signals in the project description: "map of X", "X on a map", "explore/discover X", "find X", "app for [X] with a map".
5. `usage = route` -> `mapfirst` (a route takes the whole screen).
6. If after the 5 rules the case remains ambiguous (rare - typically multi+dedicated with another main feature in the project) -> **a single fallback question**:

   > Will the map be the center of the page (visitors come **for** the map) or integrated as a section within a page that already has its own content?

If the user stays vague about the `usage` itself ("just a map"), ask ONE clarifying follow-up - no more.

**Mode orchestrated by `/bootstrap`**: if `/bootstrap` calls you with an `argument-hint` or notes from the spec (like "branches map on the contact page"), skip the question entirely and infer directly. The full project description is available in the spec or the short description - use it to apply the `layout` inference rules.

---

## Step 2 - Collect the marker data

Depending on what was inferred in Step 1:

### If `usage = single`

Ask the user for the **address OR coordinates** of the single point:

> I need the location of the point. Would you rather give me:
> - **The postal address** (I get the coordinates via OpenStreetMap)
> - **The GPS coordinates** directly (`48.8566, 2.3522` for example)

If an address is provided -> make a call to **Nominatim** (free, OSM, EU) to geocode it:

```bash
ADDRESS_ENCODED=$(node -e "console.log(encodeURIComponent('<full address>'))")
curl -sS -A "Hypervibe (https://hypervibe.fr)" \
  "https://nominatim.openstreetmap.org/search?q=$ADDRESS_ENCODED&format=json&limit=1" \
  | node -e "
    const r = JSON.parse(require('fs').readFileSync(0,'utf8'))[0];
    if (!r) { console.error('NO_RESULT'); process.exit(1); }
    console.log(JSON.stringify({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), display_name: r.display_name }));
  "
```

⚠️ **Respect Nominatim fair-use**: max 1 request/second, an identifiable User-Agent is mandatory (the `-A` above). It is OK for one-off use at scaffolding time, **not** for geocoding at runtime. If the user wants to geocode dynamically (a branch sign-up form for example), point them to a different approach (Mapbox / Google geocoding, or self-hosted Nominatim).

Confirm the resolution to the user:
> I found: **<full display_name returned by Nominatim>** (`<lat>, <lng>`). Is that correct?

### If `usage = multi` or `route`

Ask for the **full list** at once:

> Give me the list of your <branches/shops/points>, one per line, in the format:
> `Point name | address OR lat,lng | optional description`
>
> Example:
> ```
> Lyon Part-Dieu | 1 rue de la République, 69003 Lyon | Main office, open 9am-6pm
> Paris Châtelet | 48.8606, 2.3478
> ```

Parse the list. For each line that is an address, geocode it via Nominatim **with a `sleep 1` between each call** (fair-use).

### If `usage = mapfirst`

This is more open-ended - the app will be centered on the map. Ask the user:
- The target geographic area (country / region / city) -> defines the default `center` + `zoom`
- Whether the markers come from an existing DB (and if so, which table)
- The desired filters / categories

If the app is going to read the markers from Neon, check that `/add-db` is installed (check for a real `DATABASE_URL`, not a placeholder). Otherwise -> offer to run `/add-db` first.

---

## Step 3 - Run the scaffolding (`setup-map.mjs`)

Invoke `_detect-project-root` to get `WEB_DIR`. Then run, passing the `layout` inferred in Step 1:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-map.mjs" --web-dir "<WEB_DIR>" --layout <layout>
```

With `<layout>` ∈ `embedded` (default) | `mapfirst`.

The script:
1. Installs `maplibre-gl` + `react-map-gl` in `<WEB_DIR>`
2. Always copies `src/components/site/map.tsx` (the client MapView, with ResizeObserver + fitBounds + onLoad resize **baked in**) and `src/components/site/map-loader.tsx` (the SSR-safe wrapper)
3. If `--layout=mapfirst`, also copies `src/components/site/map-shell.tsx` (generic chassis with viewport lock + sidebar slot + mobile Sheet)
4. **Automatically detects i18n**: if `next-intl` is in place in the project, the script writes the i18n variant of `map-loader.tsx` (which uses `useTranslations("map")` for the "Loading map…" text) and merges the `map.*` keys into each `messages/<locale>.json`. Otherwise, it writes the plain variant with hardcoded FR strings.
5. Prints a JSON `{ success, layout, mapFile, loaderFile, shellFile, actions, warnings }` parseable on the last line. If `warnings` contains `SHEET_MISSING` (the project does not have the shadcn/ui Sheet component while we are in mapfirst), invoke `npx shadcn@latest add sheet` before continuing to Step 5.

If the script fails (non-zero exit): read the error message, fix it, retry. Typical case: `pnpm add` fails (pnpm not in the PATH) -> run `node "${CLAUDE_SKILL_DIR}/../../scripts/_ensure-tools-path.mjs"` first (it adds pnpm's global bin to the PATH).

### What the `map.tsx` template does for you (do not reimplement)

The template delivered by the script already contains:

- **ResizeObserver** on the Map container + `onLoad` that calls `map.resize()` immediately -> the canvas never stays stuck at first-paint dimensions (without it, blurry / stretched tiles as soon as a flex/grid layout settles after mount).
- **`fitToMarkers`** (default prop `true`): auto-`fitBounds` on all markers at load and on each change of `markers` (filters applied). With an "expand 0.005°" fallback when there is only a single point.
- **`computeBounds(items)`** exported as a utility if you want to reuse it elsewhere.
- **`scrollZoom`** prop, default `false` (does not steal the page scroll in embedded usage). Always pass `scrollZoom={true}` in map-first where the map IS the page.

So you no **longer** have to code a ResizeObserver, nor a manual fitBounds, nor an initial center/zoom computation for multi-marker cases - it is in the template.

---

## Step 4 - Define the marker source

Depending on `markers_source` from Step 1:

### If `inline` (1-3 markers, page-specific)

No intermediate file - the markers are defined directly in the page that renders the map (see Step 5).

### If `file` (4-30 markers, simple app)

Create `<WEB_DIR>/src/lib/locations.ts`:

```ts
import type { MapMarkerData } from "~/components/site/map-loader";

export const locations: MapMarkerData[] = [
  {
    id: "lyon-part-dieu",
    lat: 45.7607,
    lng: 4.8593,
    label: "Lyon Part-Dieu",
    description: "Bureau principal, ouvert 9h-18h",
  },
  // ... one object per marker
];
```

The `id` must be a stable slug (kebab-case, unique). The `description` is optional.

### If `db` (markers managed from the admin or changing often)

1. Check that `/add-db` is installed (otherwise, invoke it first).
2. Add a `locations` table to the Drizzle schema:

```ts
// src/server/db/schema.ts
export const locations = createTable("location", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

3. Push schema: `cd <WEB_DIR> && npx drizzle-kit push --force`
4. Create a tRPC procedure `locations.listActive` (public if the map is on a public page).
5. (Optional) admin UI: page `/admin/locations` with basic CRUD. **Out of scope for v1** - offer the user to build it later in a follow-up "add me an admin to manage the locations".

---

## Step 5 - Wire the map into a page

The wiring depends on the `layout` inferred in Step 1 - **not** on `placement` alone.

### `layout = embedded` (map integrated as a section)

The map is a section within a page that has its own subject (contact page, about page, footer, "locations" page that lists the points with a map at the top, etc.). No viewport lock - the page scrolls normally around it. Always inline `<MapLoader />` directly with a `height` set in CSS (px or `vh`).

Example for `placement = contact` (single marker):

```tsx
import { MapLoader } from "~/components/site/map-loader";

// ... in the page component:
<section className="my-12">
  <h2 className="mb-4 text-2xl font-bold">Nous trouver</h2>
  <MapLoader
    markers={[
      { id: "siege", lat: 48.8566, lng: 2.3522, label: "Notre adresse", description: "10 rue Exemple, 75001 Paris" },
    ]}
    height={420}
  />
  <noscript>
    <ul className="mt-4">
      <li>
        <strong>Notre adresse</strong> - 10 rue Exemple, 75001 Paris (
        <a href="https://www.google.com/maps/search/?api=1&query=48.8566,2.3522">voir sur Google Maps</a>
        )
      </li>
    </ul>
  </noscript>
</section>
```

Example for `placement = dedicated` (multiple markers on a page that also lists them as cards):

```tsx
import { MapLoader } from "~/components/site/map-loader";
import { locations } from "~/lib/locations";

export default function LocationsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">Nos points de vente</h1>
      <MapLoader markers={locations} height={520} />
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {locations.map((l) => (
          <li key={l.id} className="rounded border p-4">…</li>
        ))}
      </ul>
      <noscript>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {locations.map((l) => (
            <li key={l.id}>
              <strong>{l.label}</strong>
              {l.description && <span> - {l.description}</span>}
              <br />
              <a href={`https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`}>Voir sur Google Maps</a>
            </li>
          ))}
        </ul>
      </noscript>
    </main>
  );
}
```

### `layout = mapfirst` (the map IS the page)

Use the `MapShell` chassis delivered by the script in `mapfirst` mode. It encodes 3 invariants that are hard to reinvent correctly by hand:

- Lock to `100svh - <headerOffset>` with `overflow-hidden` (the page does not scroll - the map IS the viewport).
- `100svh` instead of `100vh` to withstand the mobile URL bar.
- Map in `flex-1 min-h-0` (the `min-h-0` is non-negotiable - without it the flex child refuses to shrink and the layout overflows).
- On mobile (<md), the map is full screen; on desktop (md+), sidebar on the left (420px by default) + map on the right.
- If `sidebar` is provided, a floating "List" CTA appears at the bottom on mobile and opens a bottom Sheet containing the same sidebar content.

Base pattern:

```tsx
// app/page.tsx (server component)
import { MapShell } from "~/components/site/map-shell";
import { MapLoader } from "~/components/site/map-loader";
import { locations } from "~/lib/locations";
import { LocationsSidebar } from "~/components/locations-sidebar"; // your custom client component

export default function HomePage() {
  return (
    <>
      <MapShell
        map={<MapLoader markers={locations} height="100%" scrollZoom />}
        sidebar={<LocationsSidebar items={locations} />}
        sidebarTriggerLabel={`Liste · ${locations.length}`}
      />
      <noscript>{/* … text fallback … */}</noscript>
    </>
  );
}
```

**Variants - the `sidebar` slot accepts anything**:

- **Map + navigable list** (Street Le Mans case): `sidebar={<FilterListPanel items={…} />}` - a client component with filters + item cards + selection synced with the map pins (via props/state lifted up).
- **Map + filters only (no list)**: `sidebar={<FilterBar />}` - just chips/dropdowns that filter the markers, no list. Narrow sidebar, maybe `sidebarWidth={280}`.
- **Map + search panel**: `sidebar={<SearchPanel onPick={…} />}` - an address search input + results as a list.
- **Map + timeline**: `sidebar={<TimelineSlider years={…} />}` - a slider that filters by year/era. Often you will prefer to put the slider in `position: absolute` over the map rather than in the sidebar - in that case, do NOT include a sidebar and place the overlay directly in the map column (see below).
- **Map only**: `sidebar` omitted. The shell renders the map full-bleed, no sidebar, no mobile Sheet.

**Absolute-positioned overlays inside the map** (Google Maps pattern: search box at the top, controls at the bottom-left, etc.): no need for another template. Add the children in `position: absolute` directly in the map column:

```tsx
<MapShell
  map={
    <div className="relative h-full">
      <MapLoader markers={…} height="100%" scrollZoom />
      <div className="absolute left-4 top-4 z-10 w-80">
        <SearchInput />
      </div>
    </div>
  }
/>
```

### Note on **scrollZoom**

The `map.tsx` template has `scrollZoom={false}` by default (does not steal the page scroll). In `layout = mapfirst`, **always pass `scrollZoom={true}`** on the `MapLoader`: the map IS the page, so spinning the wheel must zoom. In `layout = embedded`, leave it at `false`.

### i18n note - `MapShell` props

`MapShell` accepts the interface strings as props (`sidebarTriggerLabel`, `sidebarTitle`, `sidebarDescription`) with FR defaults (`"Liste"`, `"Choisis un élément dans la liste."`). **If the project is in i18n mode**, in the page that uses `MapShell` pass the translated values via `useTranslations("map")`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { MapShell } from "~/components/site/map-shell";
// …

export function LocationsView({ locations }) {
  const t = useTranslations("map");
  return (
    <MapShell
      map={<MapLoader markers={locations} height="100%" scrollZoom />}
      sidebar={<LocationsSidebar items={locations} />}
      sidebarTriggerLabel={`${t("listLabel")} · ${locations.length}`}
      sidebarTitle={t("sidebarTitle")}
      sidebarDescription={t("sidebarDescription")}
    />
  );
}
```

The keys `map.listLabel`, `map.sidebarTitle`, `map.sidebarDescription` were merged automatically into `messages/<locale>.json` by `setup-map.mjs` when i18n is active. The i18n variant of `map-loader.tsx` (which handles "Loading map…") is also written automatically by the script.

---

## Step 6 - Subprocessor + CLAUDE.md

Invoke `_update-privacy-policy` to add OpenFreeMap to the registry:

- **name**: `OpenFreeMap`
- **purpose**: `Affichage de cartes vectorielles (tiles)`
- **dataShared**: `Adresse IP du visiteur au chargement des tiles (requis pour servir les tiles)`
- **country**: `Hongrie` (dedicated Btrfs servers, EU)
- **cookies**: `Non` (OpenFreeMap does not set a cookie)
- **dpaUrl**: `https://openfreemap.org/` (no formal DPA - small OSS project)
- **optionalUsage**: `false` (the map is rendered as soon as the page that contains it loads)

Invoke `_update-claude-md`:

- `stack`: `- **Cartes** : MapLibre GL JS + OpenFreeMap (tile provider). Composant : \`src/components/site/map.tsx\` (client) wrapped by \`map-loader.tsx\` (SSR-safe).`
- `custom` (heading "## Cartes - MapLibre + OpenFreeMap"):
  ```
  La carte est rendue par <MapLoader /> (dynamic import, ssr: false). Le composant
  underlying touche `window` donc ne peut pas être SSR.

  **Tile provider** : OpenFreeMap (gratuit, sans clé API, sans cookie, infra EU,
  funding par dons - pas de SLA). Si jamais le service tombe, le swap se fait
  en 1 ligne dans `src/components/site/map.tsx` (constante `TILE_STYLE_URL` en
  haut du fichier - fallbacks documentés dans le commentaire) :
    • MapTiler         - 100K loads/mois gratuit, signup requis
    • Stadia Maps      - 200K loads/mois gratuit en dev, signup requis
    • PMTiles self-host - ~$3/mois sur Cloudflare R2
  Aucun refacto code requis pour le swap, juste l'URL.

  **SEO + a11y** : chaque page qui rend une carte DOIT avoir un `<noscript>`
  avec la liste textuelle des markers + lien `google.com/maps/search/?api=1&query=lat,lng`
  pour que Google et les screen readers aient le contenu.
  ```

---

## Step 7 - Verify the local build + responsive smoke test

### 7a. Compile-check

```bash
cd <WEB_DIR> && pnpm tsc --noEmit && pnpm lint
```

If there is a TypeScript error -> typically a wrong import path. Fix it. If there are lint warnings about unused imports -> fix them (the imports must match what is used).

⚠️ **DO NOT** run `pnpm build` (slow, can conflict with a dev server, outside the flow's usage). `tsc --noEmit` + `lint` is enough to validate.

### 7b. Responsive smoke test (mandatory for `layout = mapfirst`)

`tsc --noEmit` catches none of the classic visual bugs of a map (stretched canvas, failed fitBounds, stuck sidebar). To avoid them, run a minimal smoke test via `preview_start` + `preview_eval`:

```bash
# 1. Start the preview (see the project's .claude/launch.json)
#    Then wait for the page to be compiled (>= 1 GET / 200 in the logs).
# 2. Check the DESKTOP render (1280×800)
```

Eval to run on the home (`preview_resize` desktop then hard reload):

```js
(() => {
  const canvas = document.querySelector('.maplibregl-canvas');
  const mapWrap = document.querySelector('.maplibregl-map');
  const aside = document.querySelector('aside');
  return {
    vp: { w: innerWidth, h: innerHeight },
    canvasW: canvas?.width, canvasH: canvas?.height,
    mapWrapW: mapWrap?.offsetWidth, mapWrapH: mapWrap?.offsetHeight,
    canvasMatchesContainer: canvas?.width === mapWrap?.offsetWidth && canvas?.height === mapWrap?.offsetHeight,
    asideVisible: aside ? getComputedStyle(aside).display !== 'none' : false,
    pinCount: document.querySelectorAll('.maplibregl-marker').length,
  };
})()
```

Desktop success criteria:
- `canvasMatchesContainer === true` (otherwise: ResizeObserver not applied)
- `asideVisible === true` (if `sidebar` was passed)
- `pinCount >= 1`

Then repeat in `preview_resize` mobile (375×812) + hard reload:
- `canvasW === 375` and `canvasH ≈ innerHeight - headerOffset` (full-bleed)
- `asideVisible === false` (sidebar hidden on mobile)
- Presence of the floating CTA: `Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith(sidebarTriggerLabel))` -> truthy

If a check fails, it is almost always:
- You wrapped `MapShell` inside a container that has its own height lock -> remove the intermediate wrappers, `MapShell` must be a direct child of the page after the header.
- You forgot to pass `height="100%"` to the inner `MapLoader` -> it defaults to `420px`.
- The `MapShell` `headerOffset` does not match the actual height of the project's header -> adjust the prop.

---

## Step 8 - Announce to the user

Show the recap:

> ✅ **Map added** (layout: `<embedded|mapfirst>`)
>
> **Components created**:
> - `src/components/site/map.tsx` (MapLibre client render, with ResizeObserver + auto-fitBounds baked in)
> - `src/components/site/map-loader.tsx` (SSR-safe wrapper)
> - (if mapfirst layout) `src/components/site/map-shell.tsx` (layout chassis: viewport lock + sidebar slot + mobile Sheet)
> - (if applicable) `src/lib/locations.ts` with your points
> - (if applicable) `locations` table in Drizzle + tRPC procedure
>
> **Wired on**: <page path> (with a `<noscript>` fallback for SEO/a11y)
>
> **Stack**: MapLibre GL JS + OpenFreeMap (vector, free, no key, EU).
>
> ℹ️ To change the style (Liberty -> Positron / Bright / Dark / Fiord 3D): edit the `TILE_STYLE_URL` constant at the top of `src/components/site/map.tsx`.
>
> ⚠️ If OpenFreeMap ever goes down (maintained by 1 person, no SLA), the fallbacks are documented in a comment in the same file - swap in 1 line.

If the user ran an `/add-domain` that pushes the NEXT_PUBLIC_APP_URL, remind them that no env var is required for the map - this is intentional.

---

## Cases not handled in v1 (to offer if the user explicitly asks for it)

- **Clustering** of markers (> 100 points) -> MapLibre supports it via `cluster: true` on the GeoJSON source. Component refactor required.
- **Geocoding at runtime** (sign-up form with a free-text address) -> Nominatim has too strict a fair-use for runtime. Point to the Mapbox Geocoding API or MapTiler Geocoding.
- **Directions / routed itineraries** -> OpenFreeMap only provides tiles, no routing. Use OSRM or GraphHopper public APIs (quota limits).
- **Custom style** (beyond the 5 OpenFreeMap styles) -> MapTiler allows a WYSIWYG style editor + custom URL. Simple migration via the documented fallback pattern.
