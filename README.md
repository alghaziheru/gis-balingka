# Nagari Balingka Community GIS

[![License: MIT](https://img.shields.io/badge/License-MIT-0284c7.svg)](./LICENSE)

Open-source (**MIT**) interactive 2D/3D terrain explorer, drainage inventory, rainfall & inundation simulator, and waterway editor focused exclusively on **Nagari Balingka** (`-0.333149, 100.326812`, Kec. IV Koto, Kab. Agam, West Sumatra).

Inspired by [CutSheetRX](https://senterfarms.com/programs/csrx/), the app isolates a **~4.5 × 4.5 km (`20.9 km²`) Nagari Balingka block** combining sub-meter satellite clarity, anti-aliased **CutSheetRX-style terrain rasters** (*Elevasi*, *Relief*, *Lereng*), a **Ringkas / Lengkap** mode switcher for citizens vs. researchers/government/developers, interactive **2-layer waterway correction** with an immutable **SQLite Audit Trail**, and a lightweight **Feedback** modal.

---

## Key Capabilities

1. **Two-Tier Interface (`Ringkas` & `Lengkap`) + Unified Legend & Layer Checklist**
   - **Ringkas (default)**: Plain-language interface with 3 tabs (**Peta**, **Simulasi**, **Siaga**), one-tap Jorong quick-jump chips (*Pusat Balingka*, *Pahambatan*, *Koto Hilalang*, *Subarang*, *Lereng Hulu*), and a unified **Legenda & Lapisan Peta** checklist.
   - **Lengkap**: Adds 2D/3D toggle, all 6 surface modes (**Satelit**, **Elevasi**, **Relief**, **Lereng**, **Topo**, **Jalan**), 3D vertical exaggeration, DEM runoff density controls, **Drop Raindrop (*Cek Arah Air*)**, **Elevation Profile (*Ukur Tanjakan*)**, live coordinates/slope telemetry, and the **Editor** tab.
   - **Info & Data Drawer**: 3-tab modal covering a 30-second public guide, dataset/HAND methodology & caveats, and public API + GeoJSON bundle downloads.

2. **Interactive Rainfall Intensity × Duration Simulator (`Simulasi`)**
   - Smooth sliders (plus quick-tap presets) for **Rainfall Intensity** (`10–150 mm/jam`) and **Storm Duration** (`15 mnt – 6 jam`) with Play/Pause, Reset, and timeline scrubber.
   - Live **falling rain canvas animation** (`RainOverlay`) scaled to rainfall intensity, paired with dynamic **HAND** (Height Above Nearest Drainage) inundation spread and **Clogged vs. Cleared Drains** comparison.

3. **Drainage Conditions & Map-Linked Preparedness (`Siaga`)**
   - Unified **Legenda & Titik Pantau** combining road–stream crossing status filters (`35 crossings`, `3 OSM bridges`) with hazard & evacuation point toggles and a persistent household preparedness checklist.

4. **2-Layer Waterway Correction & SQLite Audit Trail (`Editor` in `Lengkap` mode)**
   - **Verified Waterways Layer** (solid river lines seeded from OpenStreetMap's `Batang Ngalai`, `Batang Tuhua`, `Anak Sungai`) vs. **30m DEM Runoff Estimate** (dashed cyan reference lines).
   - **Vertex Editing**: drag vertex handles on the map, click `+` midpoints to insert bends, right-click/double-click vertices to remove, draw new canals/drains, or click any DEM segment to **Promote & Adjust** or **Mark False & Hide**.
   - **Immutable SQLite Audit Trail (`Riwayat`)**: built on Node 24's built-in `node:sqlite` (`data/balingka.db`), storing `before`/`after` snapshots, actor, timestamp, and reason with **1-click Revert** and full **GeoJSON + Audit Bundle export**.

5. **Zero-Login General Feedback (`Feedback`)**
   - Lightweight feedback modal accessible from the top bar so visitors can submit general suggestions or usability notes directly to SQLite.

---

## Architecture & Repository Map

```text
gis-balingka/
├── server/
│   ├── db.mjs                 # Zero-dependency node:sqlite store, OSM seed, audit log & revert engine
│   └── index.mjs              # Node HTTP API (/api/*), .env ADMIN_PASSPHRASE guard & static dist/ server
├── src/
│   ├── components/
│   │   ├── MapView.tsx        # MapLibre 2D/3D map, 2-layer waterways, vertex drag & midpoint handles
│   │   ├── RainOverlay.tsx    # Intensity-scaled HTML5 canvas falling rain animation
│   │   ├── TerrainTab.tsx / SimulationTab.tsx / DrainageTab.tsx / EditorTab.tsx
│   │   ├── WaterwayEditorPanel.tsx / AuditLogPanel.tsx / EditorUnlockModal.tsx
│   │   ├── TopHud.tsx / TelemetryDock.tsx / ElevationProfileModal.tsx
│   │   └── FeedbackModal.tsx / InfoDataModal.tsx
│   ├── lib/
│   │   ├── api.ts             # Typed REST client + sessionStorage passphrase + static read-only fallback
│   │   ├── demClient.ts       # Client-side bilinear DEM interpolation, raindrop tracer & profile sampler
│   │   └── storage.ts         # Browser localStorage helpers for preparedness checklist
│   ├── i18n/translations.ts   # Full Indonesian (ID) & English (EN) copy
│   └── types/gis.ts           # Shared TypeScript domain interfaces
├── scripts/
│   ├── lib/hydrology.mjs      # Priority-Flood, D8, Horn slope, HAND, Chaikin smoothing, PNG & burnStreamsIntoDem
│   └── prepare-data.mjs       # Copernicus DEM + OSM Overpass pipeline + SQLite stream-burning
├── public/data/               # Pre-built clipped Balingka block DEM, GeoJSONs & smooth terrain/HAND PNGs
├── tests/
│   ├── hydrology.test.mjs     # Hydrology, stream-burning, Chaikin & generated asset integrity tests
│   └── api.test.mjs           # SQLite seeding, promote/revert audit trail & passphrase auth tests
└── .env.example               # Production passphrase, port, DB path & custom imagery env template
```

---

## Tech Stack & Data Provenance

100% open-source codebase and permissive dependencies:

| Layer | Technology / Source | License / Terms |
| --- | --- | --- |
| Frontend UI & Build | React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide | MIT / ISC / Apache-2.0 |
| 2D/3D WebGL Map | MapLibre GL JS | BSD-3-Clause |
| Backend & Audit DB | Node.js 24 (`node:http` + built-in `node:sqlite`) | MIT / SQLite Public Domain |
| DEM & Raster Pipeline | `geotiff` + Pure-Node Hydrology & PNG Encoder | MIT |
| Elevation & Terrain | Copernicus DEM GLO-30 & AWS Mapzen Terrarium | Copernicus Open / Public Open Data |
| Vector & Topo Maps | OpenStreetMap & OpenTopoMap | ODbL / CC-BY-SA |
| Satellite Imagery | Esri World Imagery (replaceable via `VITE_CUSTOM_IMAGERY_URL`) | Free w/ Attribution (No API Key) |

---

## Quick Start (Local Development)

Requires **Node.js >= 24** (for built-in `node:sqlite`) and **pnpm**:

```bash
pnpm install
cp .env.example .env      # Leave ADMIN_PASSPHRASE empty on localhost for instant edit mode
pnpm run server           # Terminal 1: starts SQLite API on http://127.0.0.1:8787
pnpm run dev              # Terminal 2: starts Vite dev server with /api proxy on http://localhost:5173
```

---

## VPS Production Deployment & Security

Deploy the full app + SQLite backend as a single Node process (no external database service required):

```bash
cp .env.example .env
# Edit .env and set a strong secret:
# ADMIN_PASSPHRASE=your-secret-editor-passphrase

pnpm run build            # Typechecks & builds production bundle into dist/
pnpm start                # Serves dist/ and /api/* together on PORT (default 8787)
```

- **Public access without login**: Anyone can inspect the map, run rainfall simulations, check preparedness guides, and submit general feedback.
- **Protected editing**: Setting `ADMIN_PASSPHRASE` locks all waterway writes, DEM suppressions, and audit reverts behind timing-safe `X-Admin-Passphrase` verification in **Lengkap → Editor**.
- **Database backup**: Back up the single SQLite file at `data/balingka.db` (or set `BALINGKA_DB_PATH`).

---

## Hydro-Conditioning (Stream Burning) & Custom Data

- **Re-route hydrology after waterway corrections**: Once you refine streams/drains in `data/balingka.db`, run:
  ```bash
  pnpm run prepare-data
  ```
  `prepare-data` automatically reads verified waterways from `data/balingka.db` (or `raw-data/verified-waterways.geojson`), gently carves them into the DEM (`burnStreamsIntoDem`) before D8 flow routing, recomputes HAND flood rasters, and updates road–stream crossings.
- **Higher-Resolution BIG DEMNAS (8m)**: Place your GeoTIFF at `raw-data/demnas-balingka.tif` and run `pnpm run prepare-data`.
- **Self-Hosted Drone Orthophoto**: Set `VITE_CUSTOM_IMAGERY_URL=https://tiles.yourdomain.org/{z}/{y}/{x}.png` and `VITE_CUSTOM_IMAGERY_MAXZOOM=20` before `pnpm run build`.

---

## API Endpoints

| Endpoint | Auth | Description |
| --- | --- | --- |
| `GET /api/waterways` | Public | Verified waterways `FeatureCollection` + suppressed DEM IDs |
| `POST /api/waterways` | Editor Passphrase | Create new or promote DEM segment (writes audit log) |
| `PUT /api/waterways/:id` | Editor Passphrase | Update geometry/attributes with before/after snapshot |
| `DELETE /api/waterways/:id` | Editor Passphrase | Soft-delete waterway (logged & revertible) |
| `POST /api/dem-segments/suppress` | Editor Passphrase | Hide misaligned DEM segment |
| `DELETE /api/dem-segments/:segId/suppress` | Editor Passphrase | Restore hidden DEM segment |
| `GET /api/audit` | Public | Chronological change log with full before/after snapshots |
| `POST /api/audit/:id/revert` | Editor Passphrase | Revert a change and record a new `revert` log entry |
| `GET /api/suggestions` | Public | List general user feedback entries |
| `POST /api/suggestions` | Public | Submit general feedback (no login) |
| `PATCH /api/suggestions/:id` | Editor Passphrase | Update feedback status & note |
| `GET /api/export/bundle` | Public | Download JSON bundle (verified GeoJSON + audit logs) |

---

## Testing & Verification

```bash
pnpm test          # Unit hydrology, stream-burning, asset integrity & SQLite API/auth tests
pnpm run typecheck # TypeScript strict check
pnpm run build     # Production client bundle
```

---

## Disclaimer & License

Flood inundation zones (*HAND*) and 30m DEM runoff estimates are educational community decision-support indicators derived from open elevation data — **not** certified hydraulic engineering models. Always follow official guidance from Wali Nagari Balingka and BPBD Kab. Agam during severe weather.

Released under the [MIT License](./LICENSE).
