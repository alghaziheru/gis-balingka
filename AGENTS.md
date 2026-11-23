# AGENTS.md — Nagari Balingka GIS

> **Adapting a fork/clone for another Desa / Nagari / Kelurahan?** Follow **[`docs/ADAPT_REGION.md`](./docs/ADAPT_REGION.md)** (you may replace `region.config.json` and run `pnpm run reset-region` instead of keeping the Nagari Balingka area/boundary numbers below, while still preserving the MIT license, neutral open-data framing, and UI/UX standards). When maintaining the upstream **Nagari Balingka** repository itself, follow all invariants below strictly.

Public interactive spatial data viewer for terrain, hydrology, drainage inventory, and exploratory rainfall-flow modeling in **Nagari Balingka**, Kec. IV Koto, Kab. Agam, West Sumatra (`29.89 km²` official BIG June 2026 boundary `13.06.05.2003`, `1,032–2,869 m dpl`, default visual center `-0.345, 100.319`). Strictly displays open/official datasets and field inventory without making disaster-status declarations or evacuation recommendations.

## 1. Stack & License Constraints
- **100% MIT / open-source stack** — never introduce paid SDKs, proprietary telemetry, or external API keys:
  - Frontend: React 19, TypeScript, Tailwind CSS v4, Vite 8, `maplibre-gl`, `lucide-react`, `geotiff`.
  - Backend: Zero-dependency Node ESM HTTP server (`server/index.mjs`) using built-in `node:sqlite` (`server/db.mjs`, requires **Node >= 24**).
- Bilingual (`ID` / `EN`) UI with all spatial/hydrology calculations performed deterministically offline via `scripts/prepare-data.mjs` + `scripts/lib/hydrology.mjs` (plus optional `scripts/extract-big-ref.py` for BIG `.gdb` archives; see `DATA_SOURCES.md`).

## 2. Commands & Environment
```bash
pnpm install
pnpm run prepare-data   # Builds DEM/terrain/hydrology assets in public/data/
pnpm run typecheck      # tsc --noEmit
pnpm test               # node --test tests/hydrology.test.mjs tests/api.test.mjs
pnpm run build          # tsc --noEmit && vite build -> dist/
pnpm run dev            # Vite dev server + API proxy
pnpm start              # Production Node server on PORT (default 8787) serving dist/ + /api/*
```
- Config via `.env` (see `.env.example`): `ADMIN_PASSPHRASE`, `HOST`, `PORT`, `BALINGKA_DB_PATH` (`./data/balingka.db`), `VITE_CUSTOM_IMAGERY_URL`, `VITE_CUSTOM_IMAGERY_MAXZOOM`.

## 3. Architecture & Data Invariants
- **Exclusive official Nagari extent (`29.89 km²`)**: Hydrology computes across a padded catchment box (`100.278..100.345`, `-0.408..-0.314`) on BIG DEMNAS (`542×760`, ~13.8 m) + `sim-fields.json` (`185×260`), while `mask.geojson` and `nagariMaskBase64` clip display, KPIs, buildings (`2,175`), and popups strictly to the official BIG June 2026 Nagari Balingka polygon.
- **Satellite imagery fallback safety**: Esri World Imagery uses `maxzoom: 18` auto-overzoom (or optional `VITE_CUSTOM_IMAGERY_URL`) so zoomed-in tiles never show `"Map data not yet available"`.
- **Multi-layer waterway & boundary system**:
  - **Verified waterways** (`data/balingka.db`): Solid lines editable in `EditorTab.tsx` (drag vertices, `+` midpoint insertion, pre/post cross-section width/depth, immutable audit trail + 1-click revert).
  - **BIG RBI 50K & DEMNAS runoff estimates**: Reference/dashed lines that editors can promote to verified or suppress.
  - **Jorong boundaries** (`JorongEditorPanel.tsx`, `/api/jorong-boundaries`): Community-editable polygons strictly labeled `Indicative` vs `Verified`.
- **Passphrase auth separation**:
  - Public read (`/api/health`, `/api/waterways`, `/api/structures`, `/api/jorong-boundaries`, `/api/suggestions`) and general citizen feedback (`POST /api/suggestions` via `FeedbackModal.tsx`) require **no login**.
  - Official edits, hydrology recomputes, and reverts require `X-Admin-Passphrase` matching `ADMIN_PASSPHRASE` (`EditorUnlockModal.tsx`).
- **Computational flow model visualizer (`SimulationTab.tsx` + `cascadeEngine.ts` + `RainOverlay.tsx`)**:
  - Driven by Rainfall Intensity (`10–150 mm/jam`) × Duration (`15 mnt – 6 jam`), SCS-CN (ESA WorldCover 10m), D8 travel wave, clogged vs cleared crossing parameters, tree-cover input variations, and Pemkab Agam open-map inputs plus animated canvas rainfall — framed strictly as a computational visualization tool (never official BNPB/BPBD/BMKG warnings, never hardcode historical disaster dates).

## 4. UI/UX Non-Negotiables (Clean Civic Atlas)
- **Top bar (`TopHud.tsx`)**: Brand in sidebar header (`Tampilan mudah untuk warga` subtitle removed); top-right HUD shows only map view controls (`2D/3D` in Detailed mode, basemap toggle) plus a single icon-only **Gear (`Settings`) popover** housing `Ringkas` | `Lengkap` mode toggle, `ID`/`EN` language toggle, `Feedback`, and `Info & Data` (`InfoDataModal.tsx`). No `Lokasi Saya` GPS button.
- **Unified Bottom-Right map controls (`TelemetryDock.tsx` + `MapView.tsx`)**: Custom `surface-panel` `+ / − / Compass` stack above a unified status bar (`inline metric scale | telemetry | inline (i) attribution popover`), keeping bottom-left clean. `Wilayah jorong` quick jump uses a single-row dropdown (`Balingka`, `Subarang`, `Koto Hilalang`, `Pahambatan`) in `TerrainTab.tsx`.
- **Modes & tabs**: `Ringkas` exposes 3 public tabs (`Peta` / `Simulasi` / `Drainase`); `Lengkap` adds `Editor` (`EditorTab.tsx`, `WaterwayEditorPanel.tsx`, `JorongEditorPanel.tsx`, `AuditLogPanel.tsx`). `Drainase` (`DrainageTab.tsx`) uses `Rusak Berat` (`Severe`) as display label for `'critical'`, omits engineering recommendations (`bronjong`) and preparedness checklists, and includes an official agency reference directory (`BMKG`, `BPBD/BNPB`, `PVMBG`, `Wali Nagari`). Sidebar footer links cleanly to `Info & Data` scope boundaries.
- **Unified Legend + Layer Checklist**: Combine map symbol legend (`LegendIcon.tsx`) and visibility toggles in one control inside sidebar tabs and mobile `Legenda` popover so users have a single focus.
- **Visual tokens**: `#fafaf8` / `#ffffff` / `#f2f3ef` daylight surfaces, `#161c1a` ink, `#0369a1` accent, `1px` hairlines, Plus Jakarta Sans + JetBrains Mono. Zero gradients, zero heavy backdrop blur, zero violet/lavender hues.

## 5. Verification & Repo Hygiene
- Always run `pnpm run typecheck && pnpm test && pnpm run build` before committing code changes.
- After UI/UX edits, verify rendered screenshots in headless Chromium across desktop (`1440×900`) and mobile (`390×844`) viewports with zero console/page errors.
- **Knowledge graph (`graphify-out/`)**: If `graphify-out/` exists locally, query it first for architectural/file-relationship lookups; keep it updated locally when codebase structure changes, and **never commit it** (`.gitignore` excludes `graphify-out/`, `data/*.db*`, `.env*`, `dist/`, `raw-data/`, `feedback-local/`, `balingka-gis-draft.html`).
