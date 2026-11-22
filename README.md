# Nagari Balingka Community GIS

[![License: MIT](https://img.shields.io/badge/License-MIT-0284c7.svg)](./LICENSE)

Open-source (**MIT**) interactive 2D/3D terrain explorer, hydrology & drainage inventory, physics-based *galodo* / flash-flood cascade simulator, and collaborative waterway & Jorong editor focused exclusively on **Nagari Balingka** (`29.89 km²`, `1,032–2,869 m dpl`, Kec. IV Koto, Kab. Agam, West Sumatra).

Clipped strictly to the official **Badan Informasi Geospasial (BIG) June 2026** Nagari Balingka perimeter (`KDEPUM 13.06.05.2003`) while computing hydrology on a padded catchment box behind the scenes, the app combines **BIG DEMNAS (`542×760`, ~13.8 m)** terrain rasters (*Elevasi*, *Relief*, *Lereng*), official **Pemkab Agam & BIG RBI 50K** hazard/soil/river layers, **ESA WorldCover 10m** forest cover, **Copernicus Sentinel-2 L2A** scour change, **Google Open Buildings v3 + OSM** settlement footprints (`2,175` buildings), and an immutable **SQLite Audit Trail** in a clean `Ringkas` / `Lengkap` interface.

---

## Key Capabilities

1. **Two-Tier Interface (`Ringkas` & `Lengkap`) + Standardized Cartographic Legend**
   - **Ringkas (default)**: Plain-language citizen mode with 3 tabs (**Peta**, **Simulasi**, **Siaga**), one-tap area focus chips (*Pusat Balingka*, *Jorong Pahambatan*, *Jorong Koto Hilalang*, *Jorong Subarang*, *Lereng Selatan Hulu*), unified **Legenda & Lapisan Peta** with matching cartographic badge icons (`LegendIcon`), and mobile **Legenda** popover.
   - **Lengkap**: Adds 2D/3D toggle, 6 surface modes (**Satelit**, **Elevasi**, **Relief**, **Lereng**, **Topo**, **Jalan**), 3D vertical exaggeration, **BIG RBI 50K** rivers, **KLHK SK 35** protected forest, **Andosol/Kambisol** soil & geology overlays, **Drop Raindrop (*Cek Arah Air*)**, **Elevation Profile (*Ukur Tanjakan*)**, live telemetry dock, tap-to-inspect **Official Pemkab Agam Site Profile**, and the **Editor** tab.
   - **Info & Data Drawer**: Bilingual (`ID` / `EN`) 3-tab modal covering a 30-second public guide, terrain/hydrology methodology, and public API + GeoJSON bundle downloads.

2. **Physics-Based *Galodo* & Rainfall Cascade Simulator (`Simulasi`)**
   - Driven by interactive **Rainfall Intensity** (`10–150 mm/jam`) × **Storm Duration** (`15 mnt – 6 jam`) controls, timeline playback, and intensity-scaled canvas rainfall (`RainOverlay`).
   - Evaluates a 4-stage cascade via `CascadeEngine`: **SCS-CN** runoff from ESA WorldCover 10m → **D8 headwater-to-valley travel wave** (`~88 min` across Gunung Singgalang catchments) → **HAND** corridor inundation (clogged vs. cleared culverts) → **slope instability calibrated with Pemkab Agam Andosol & landslide hazard zones**.
   - **Anti-misinformation design**: Displays clear indicative corridor disclaimers and aggregate counts (e.g., `~X buildings` inside the active corridor) without claiming house-by-house engineering predictions.
   - **Channel Width & Widening Rain Thresholds (`Lengkap`)**: Evaluates measured pre/post channel widths (`Manning` + *Specific Stream Power* `ω ≥ 300 / 1000 W/m²` with `±25%` uncertainty ranges) to estimate rainfall intensities that risk bank widening or severe *galodo* scour.

3. **Drainage Readiness & Evacuation Planning (`Siaga`)**
   - Inspects **`27` road–stream crossings (`4` bridges)** plus **BIG RBI 50K** culverts/bridges/weirs filtered by field status, paired with **`8` elevated evacuation candidate points** inside Nagari Balingka and a persistent household readiness checklist.

4. **2-Layer Waterway, Structure & Jorong Editor + SQLite Audit Trail (`Editor` in `Lengkap` mode)**
   - **Waterways (`Jalur Air`)**: Edit verified solid streams (drag vertices, `+` midpoint insertion, flow-direction markers, pre/post cross-section width & depth fields), draw new channels, or **1-click Promote / Suppress** misaligned **BIG RBI 50K** and **DEMNAS** dashed reaches.
   - **Structures & Jorong Boundaries**: Create/edit culverts & bridges with condition status, draw or import **Jorong Boundary GeoJSON polygons** transparently tagged **`Indicative`** vs. **`Verified`**, and re-run offline stream-burned DEM recomputation (`POST /api/hydrology/recompute`).
   - **Immutable SQLite Audit Trail (`Riwayat`)**: Built on Node 24's built-in `node:sqlite` (`data/balingka.db`), storing full `before`/`after` snapshots, timestamps, and reasons with **2-click Revert** and full **GeoJSON + Audit Bundle export**.

5. **Zero-Login Citizen Feedback (`Feedback`)**
   - Anyone can inspect all layers, run simulations, and submit usability feedback or local observations (`POST /api/suggestions`) without logging in.

---

## Architecture & Repository Map

```text
gis-balingka/
├── server/
│   ├── db.mjs                 # Zero-dependency node:sqlite store, seeding, audit log & revert engine
│   ├── index.mjs              # Node HTTP API (/api/*), .env ADMIN_PASSPHRASE auth & static dist/ server
│   └── seed-io.mjs            # Safe GeoJSON snapshot import/export for verified waterways & structures
├── src/
│   ├── components/
│   │   ├── MapView.tsx        # MapLibre 2D/3D map, Nagari mask, cartographic badges & vertex editor
│   │   ├── RainOverlay.tsx    # Intensity-scaled HTML5 canvas falling rain animation
│   │   ├── LegendIcon.tsx     # Synchronized canvas/SVG map symbol badges across sidebar & mobile legend
│   │   ├── TerrainTab.tsx / SimulationTab.tsx / DrainageTab.tsx / EditorTab.tsx
│   │   ├── WaterwayEditorPanel.tsx / JorongEditorPanel.tsx / AuditLogPanel.tsx / EditorUnlockModal.tsx
│   │   ├── TopHud.tsx / TelemetryDock.tsx / ElevationProfileModal.tsx
│   │   └── FeedbackModal.tsx / InfoDataModal.tsx
│   ├── lib/
│   │   ├── api.ts             # Typed REST client + sessionStorage passphrase + static read-only fallback
│   │   ├── cascadeEngine.ts   # Real-time 4-stage rainfall-flood-landslide cascade evaluator (masked to Nagari)
│   │   ├── channelHydraulics.ts # Manning + Specific Stream Power bank-widening rain threshold estimator
│   │   ├── agamLookup.ts      # Spatial point-in-Nagari & Pemkab Agam soil/geology/hazard profile lookup
│   │   ├── demClient.ts       # Client-side bilinear DEM interpolation, raindrop tracer & profile sampler
│   │   └── storage.ts         # Browser localStorage helpers for preparedness checklist
│   ├── i18n/translations.ts   # Full Indonesian (ID) & English (EN) copy
│   └── types/gis.ts           # Shared TypeScript domain interfaces
├── scripts/
│   ├── extract-big-ref.py     # Extracts official BIG Nagari polygon & RBI 50K Kab. Agam (.gdb/.zip)
│   ├── lib/hydrology.mjs      # Priority-Flood, D8, Horn slope, HAND, Chaikin, polygon mask & stream-burning
│   ├── lib/recompute-hydrology.mjs # Live server handler for offline stream-burned DEM recomputation
│   └── prepare-data.mjs       # Full offline DEMNAS/WorldCover/Sentinel-2/Open Buildings/Agam asset builder
├── public/data/               # Pre-built clipped 29.89 km² Nagari Balingka DEM, GeoJSONs & PNG rasters (~11 MB)
├── tests/
│   ├── hydrology.test.mjs     # Hydrology, cascade invariants, Agam integration & asset integrity tests
│   └── api.test.mjs           # SQLite CRUD, Jorong boundaries, recompute, revert & passphrase auth tests
├── DATA_SOURCES.md            # Detailed data provenance, attribution & BIG Tanah Air Indonesia rebuild guide
└── .env.example               # Production passphrase, port, DB path & custom imagery env template
```

---

## Tech Stack & Data Provenance

100% open-source codebase and permissive runtime dependencies. See [`DATA_SOURCES.md`](./DATA_SOURCES.md) for detailed citations and step-by-step instructions to rebuild derived assets from **BIG Tanah Air Indonesia** raw downloads.

| Layer | Technology / Source | License / Terms |
| --- | --- | --- |
| Frontend UI & Build | React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide | MIT / ISC / Apache-2.0 |
| 2D/3D WebGL Map | MapLibre GL JS | BSD-3-Clause |
| Backend & Audit DB | Node.js 24 (`node:http` + built-in `node:sqlite`) | MIT / SQLite Public Domain |
| DEM & Vector Pipeline | `geotiff` + Pure-Node Hydrology & PNG Encoder (`scripts/extract-big-ref.py` uses `pyogrio` + `shapely` for BIG `.gdb`) | MIT |
| Elevation, Boundary & Base Hydrology | **BIG DEMNAS (`0715-62_v1.0`)**, **BIG RBI 50K Kab. Agam (Dec 2022)**, **BIG Batas Wilayah Desa/Nagari (June 2026)** (Copernicus DEM GLO-30 fallback) | Public Government Data (BIG) |
| Provincial Reference Layers | **Pemkab Agam Open GIS** (BPBD Landslide, BBSDLP Soil, PSG Geology, KLHK SK 35 Forest, BMKG Rainfall) | Public Government Data (Pemkab Agam) |
| Land Cover & Scour Satellite | **ESA WorldCover 10m v200** & **Copernicus Sentinel-2 L2A (10m)** | **CC-BY-4.0** / **Copernicus Open License** |
| Buildings & Streets | **Google Open Buildings v3** & **OpenStreetMap / OpenTopoMap** | **CC-BY-4.0** / **ODbL** / **CC-BY-SA** |
| Satellite Imagery | Esri World Imagery (overridable via `VITE_CUSTOM_IMAGERY_URL`) | Free w/ Attribution (No API Key) |

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
- **Protected editing**: Setting `ADMIN_PASSPHRASE` locks all waterway/structure/Jorong writes, DEM suppressions, offline hydrology recomputes, feedback moderation, and audit reverts behind timing-safe `X-Admin-Passphrase` verification in **Lengkap → Editor**.
- **Database backup**: Back up the single SQLite file at `data/balingka.db` (or set `BALINGKA_DB_PATH`).

---

## Hydro-Conditioning (Stream Burning) & Custom Data

- **Re-route hydrology after waterway corrections**: Click **Hitung Ulang Aliran** in `Editor` (calls `POST /api/hydrology/recompute`), or run offline via CLI:
  ```bash
  pnpm run prepare-data
  ```
  `prepare-data` automatically burns verified waterways from `data/balingka.db` (or `public/data/verified-waterways.geojson`) into the DEM (`burnStreamsIntoDem`) before D8 flow routing, recomputes HAND flood rasters and `sim-fields.json`, and updates road–stream crossings inside Nagari Balingka.
- **Rebuilding from BIG Tanah Air Indonesia raw files**: See [`DATA_SOURCES.md`](./DATA_SOURCES.md).
- **Self-Hosted Drone Orthophoto**: Set `VITE_CUSTOM_IMAGERY_URL=https://tiles.yourdomain.org/{z}/{y}/{x}.png` and `VITE_CUSTOM_IMAGERY_MAXZOOM=20` before `pnpm run build`.

---

## API Endpoints

| Endpoint | Auth | Description |
| --- | --- | --- |
| `GET /api/health` | Public | Server health status & database readiness |
| `GET /api/editor/status` / `POST /api/editor/verify` | Public / Passphrase | Check passphrase requirement or validate `X-Admin-Passphrase` |
| `GET /api/waterways` | Public | Verified waterways `FeatureCollection` + suppressed DEM IDs + dirty flag |
| `POST /api/waterways` / `PUT` / `DELETE` | Editor Passphrase | Create, promote DEM/RBI reaches, edit geometry/width/depth, or soft-delete |
| `GET /api/structures` | Public | Verified culverts & bridges `FeatureCollection` |
| `POST /api/structures` / `PUT` / `DELETE` | Editor Passphrase | Create, update condition status, or delete drainage structures |
| `GET /api/jorong-boundaries` | Public | Community Jorong boundary polygons (`Indicative` / `Verified`) |
| `POST /api/jorong-boundaries` / `PUT` / `DELETE` | Editor Passphrase | Create, edit, verify, or delete Jorong boundary polygons |
| `POST /api/dem-segments/suppress` / `DELETE` | Editor Passphrase | Hide or restore misaligned DEM runoff segments |
| `POST /api/hydrology/recompute` | Editor Passphrase | Burn verified waterways into DEM copy and recompute HAND + cascade assets |
| `GET /api/audit` / `POST /api/audit/:id/revert` | Public / Passphrase | Chronological change log with full before/after snapshots & 2-click revert |
| `GET /api/suggestions` / `POST /api/suggestions` / `PATCH` | Public / Public / Passphrase | List, submit (zero-login), and moderate general user feedback |
| `GET /api/export/bundle` | Public | Download JSON bundle (verified GeoJSON + structures + audit logs) |

---

## Testing & Verification

```bash
pnpm run typecheck # TypeScript strict check
pnpm test          # Unit hydrology, cascade invariants, Agam integration & SQLite API/auth tests
pnpm run build     # Production client bundle
```

---

## Disclaimer & Attribution

Source code is licensed under **[MIT](./LICENSE)**. Geospatial reference data is used with public attribution to **Badan Informasi Geospasial (BIG)**, **Pemerintah Kabupaten Agam**, **ESA WorldCover / Copernicus Sentinel-2**, **Google Open Buildings v3**, and **OpenStreetMap contributors**.

Flood inundation zones (*HAND*), simulated cascade waves, and channel widening rain estimates are indicative community decision-support indicators — **not** certified hydraulic engineering models. Always follow official instructions from **Wali Nagari Balingka** and **BPBD Kab. Agam** during severe weather.
