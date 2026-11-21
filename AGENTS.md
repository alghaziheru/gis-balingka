# AGENTS.md — Nagari Balingka GIS

Public interactive terrain, hydrology, rainfall-flood simulation, and drainage readiness web-GIS for **Nagari Balingka**, Kec. IV Koto, Kab. Agam, West Sumatra (`20.9 km²` exclusive extent centered at `-0.333149, 100.326812`).

## 1. Stack & License Constraints
- **100% MIT / open-source stack** — never introduce paid SDKs, proprietary telemetry, or external API keys:
  - Frontend: React 19, TypeScript, Tailwind CSS v4, Vite 8, `maplibre-gl`, `lucide-react`, `geotiff`.
  - Backend: Zero-dependency Node ESM HTTP server (`server/index.mjs`) using built-in `node:sqlite` (`server/db.mjs`, requires **Node >= 24**).
- Bilingual (`ID` / `EN`) UI with all spatial/hydrology calculations performed deterministically offline via `scripts/prepare-data.mjs` + `scripts/lib/hydrology.mjs`.

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
- **Exclusive clipped extent (`~4.5 × 4.5 km`)**: `mask.geojson` masks surrounding terrain and MapLibre bounds lock navigation to Nagari Balingka.
- **Satellite imagery fallback safety**: Esri World Imagery uses `maxzoom: 18` auto-overzoom (or optional `VITE_CUSTOM_IMAGERY_URL`) so zoomed-in tiles never show `"Map data not yet available"`.
- **Two-layer waterway system**:
  - **Verified waterways** (`data/balingka.db`): Solid lines editable in `EditorTab.tsx` (drag vertices, `+` midpoint insertion, immutable audit trail + 1-click revert).
  - **DEM runoff estimates** (30m FABDEM/HydroSHEDS, ~15–45m spatial drift): Dashed lines that editors can promote to verified or suppress.
- **Passphrase auth separation**:
  - Public read (`/api/bootstrap`, `/api/waterways`, `/api/suggestions`) and general citizen feedback (`POST /api/suggestions` via `FeedbackModal.tsx`) require **no login**.
  - Official edits and reverts require `X-Admin-Passphrase` matching `ADMIN_PASSPHRASE` (`EditorUnlockModal.tsx`).
- **Generic configurable flood simulator (`SimulationTab.tsx` + `RainOverlay.tsx`)**:
  - Driven by Rainfall Intensity (`10–150 mm/jam`) × Duration (`15 mnt – 6 jam`) HAND inundation sliders plus animated canvas rainfall — never hardcode historical disaster dates.

## 4. UI/UX Non-Negotiables (Clean Civic Atlas)
- **Top bar (`TopHud.tsx`)**: Brand + `Ringkas` | `Lengkap` mode toggle directly on the top-right (`Tampilan mudah untuk warga` subtitle removed), basemap toggle (`Satelit`/`Jalan`), `Feedback` trigger, `ID`/`EN`, and `Info & Data` (`InfoDataModal.tsx`). No `Lokasi Saya` GPS button or jorong jump dropdown.
- **Modes & tabs**: `Ringkas` exposes 3 citizen tabs (`Peta` / `Simulasi` / `Siaga`); `Lengkap` adds `Editor` (`EditorTab.tsx`, `WaterwayEditorPanel.tsx`, `AuditLogPanel.tsx`).
- **Unified Legend + Layer Checklist**: Combine map symbol legend and visibility toggles in one control inside sidebar tabs and mobile `Legenda` popover so users have a single focus.
- **Visual tokens**: `#fafaf8` / `#ffffff` / `#f2f3ef` daylight surfaces, `#161c1a` ink, `#0369a1` accent, `1px` hairlines, Plus Jakarta Sans + JetBrains Mono. Zero gradients, zero heavy backdrop blur, zero violet/lavender hues.

## 5. Verification & Repo Hygiene
- Always run `pnpm run typecheck && pnpm test && pnpm run build` before committing code changes.
- After UI/UX edits, verify rendered screenshots in headless Chromium across desktop (`1440×900`) and mobile (`390×844`) viewports with zero console/page errors.
- **Knowledge graph (`graphify-out/`)**: If `graphify-out/` exists locally, query it first for architectural/file-relationship lookups; keep it updated locally when codebase structure changes, and **never commit it** (`.gitignore` excludes `graphify-out/`, `data/*.db*`, `.env*`, `dist/`, `raw-data/`, `balingka-gis-draft.html`).
