# Adapting This GIS for Another Desa, Nagari, or Kelurahan

*Panduan Replikasi Wilayah Lain — untuk Manusia & AI Coding Agent (Cursor, Claude Code, Codex, Antigravity).*

This repository ships pre-configured for **Nagari Balingka** (`29.89 km²`, Kab. Agam, West Sumatra) so it runs immediately after cloning. To deploy it for **your own village / nagari / kelurahan**, follow this guide end-to-end.

---

## 1. Choose Your Data Track

You do **not** need paid APIs or proprietary GIS licenses. Choose one of two data tracks:

| Track | Required Manual Downloads | Elevation Resolution | Best For |
| --- | --- | --- | --- |
| **Option A — Automatic Global Open Data** *(Fastest)* | **None** *(optional `raw-data/region-boundary.geojson` for exact village clip)* | **~30 m** (Copernicus DEM GLO-30) + **10 m** ESA WorldCover + **OpenStreetMap** | Fast 10-minute prototype, testing, or villages without BIG downloads yet |
| **Option B — Official BIG Tanah Air Indonesia** *(Highest Accuracy)* | Free account download from [tanahair.indonesia.go.id](https://tanahair.indonesia.go.id/portal-web/): **DEMNAS** + **Batas Wilayah Desa** *(RBI 50K optional)* | **~8.3 m** (BIG DEMNAS) + official village perimeter + optional RBI 50K rivers/structures | Production village atlas in Indonesia with sharp contours, slope, and drainage crossings |

> **Why can't the script auto-download BIG files?** The Indonesian Geospatial Portal (`tanahair.indonesia.go.id`) requires a free registered account login, so BIG archives must be downloaded manually in your browser and placed under `raw-data/`. All global fallback sources (**Copernicus DEM**, **ESA WorldCover**, **OpenStreetMap**, **AWS Terrarium**) are fetched automatically by `pnpm run prepare-data` — including automatic multi-tile mosaicking if your village straddles a `1°` or `3°` tile boundary.

---

## 2. Protocol for AI Coding Agents

If you are an **AI coding agent** asked to adapt this repository for a new village/nagari/kelurahan:

### A. Ask the User These 4 Questions First (if not already provided)
1. **Village identity:** Official name, administrative level (`Desa` / `Nagari` / `Kelurahan`), sub-region term (`Dusun` / `Jorong` / `RW`), Kecamatan, Kabupaten/Kota, and Province.
2. **Geographic extent:** Either a `bbox` (`west, south, east, north` in WGS84 degrees with ~1–2 km upstream slope padding), a GeoJSON boundary polygon file, or permission to look up approximate coordinates first.
3. **Data track:** **Option A** (automatic Copernicus DEM 30m + ESA WorldCover 10m + OSM) or **Option B** (the user already downloaded BIG Tanah Air files: DEMNAS `.tif`, `BATASWILAYAH_DESA_*.gdb.zip`, and optionally `RBI50K_*.zip`).
4. **Sub-regions & local offices:** 2–5 sub-region names (`Dusun` / `Jorong`) for quick-jump camera presets, plus local `BPBD` and village office names.

### B. Exact Adaptation Steps
1. **Edit `region.config.json`** (starting from `region.config.example.json`):
   - Set a unique `"id"` (e.g., `"desa-sukamaju"` — **must not** stay `"nagari-balingka"`).
   - Fill `name`, `shortName`, `adminLevelLabel`, `subRegionLabel`, `district`, `regency`, `province`, `appTitle`, `bbox`, `defaultView`, `dataCenter`, `cameraPresets`, `subRegionSuggestions`, `drainageFocus`, `authorities`, and `repositoryUrl`.
   - Set `regionalOverlays.enabled: false`, `regionalOverlays.rbiAvailable: false`, and `regionalOverlays.sentinelChangeAvailable: false` (unless you provide custom regional overlays or extracted BIG RBI 50K layers — if you have BIG RBI 50K, set `rbiAvailable: true`).
   - Configure `"hydrology"` in `region.config.json`:
     - `"soilProfile"`: choose from `"volcanic_andosol"` (humic volcanic highlands), `"cambisol_loam"` (general Indonesian hillslopes, recommended default), `"alluvial_clay"` (lowland river plains), or `"karst_limestone"` (porous limestone).
     - `"climateBiasFactor"`: `1.0` (default) or a local ratio if you cross-check ERA5-Land against nearby BMKG station summaries.
     - Note: `pnpm run prepare-data` automatically fetches and caches 41 years (`1985–2025`) of Open-Meteo ERA5-Land daily precipitation at your `dataCenter`, computing local SNI 2415:2016 return periods and Mononobe IDF slider bounds into `public/data/climate-baseline.json`.
2. **Clean stale Nagari Balingka artifacts:**
   ```bash
   pnpm run reset-region
   ```
   *(Pass `-- --raw-cache` if `raw-data/` also holds cached Balingka files. The script safely refuses to run while `"id"` is still `"nagari-balingka"`.)*
3. **Prepare raw inputs (if using Option B or a custom boundary):**
   - **Custom boundary GeoJSON (no BIG `.gdb`):** Save a WGS84 `FeatureCollection` polygon at `raw-data/region-boundary.geojson`.
   - **BIG DEMNAS GeoTIFF:** Save at `raw-data/<regionalOverlays.localDemFilename>` (e.g., `raw-data/demnas-region.tif`).
   - **BIG `.gdb` / `.zip` archives:** Put downloaded BIG files in `raw-data/big-ref/` and run:
     ```bash
     python3 scripts/extract-big-ref.py --ref-dir raw-data/big-ref
     # Or boundary-only without RBI 50K:
     python3 scripts/extract-big-ref.py --ref-dir raw-data/big-ref --desa-only
     ```
     *Tip:* If `officialBoundaryCode` (`KDEPUM`) doesn't match on the first run, the script prints all villages inside your `bbox` with their exact `KDEPUM` and `NAMOBJ` codes so you can copy them into `region.config.json`.
4. **Generate clipped rasters, hydrology & simulation fields:**
   ```bash
   pnpm run prepare-data
   ```
5. **Optional polish:**
   - Update `README.md` and `src/data/glossary.ts` if you want local glossary terms tailored to your province.
   - Note: `vite.config.ts` automatically injects `<title>` and `<meta name="description">` from `region.config.json` into `index.html`, and `InfoDataModal.tsx` reads region names and authorities dynamically.
6. **Verify before committing or deploying:**
   ```bash
   pnpm run verify
   ```
   *(Runs `tsc --noEmit`, unit tests — Balingka-only asset assertions automatically skip when `region.config.json` uses a custom `id` — and `vite build`.)*
7. **Non-negotiable constraints to preserve:**
   - **100% MIT / open-source dependencies** (no paid SDKs, proprietary telemetry, or required API keys).
   - **Neutral open-data framing:** Never add text that declares official disaster statuses, predicts house-level damage, or designates official evacuation sites — always attribute official warnings to **BNPB**, local **BPBD**, **BMKG**, **PVMBG**, and village authorities.
   - **Never commit secrets or raw caches:** Keep `.env`, `data/*.db`, `raw-data/`, `dist/`, and `graphify-out/` untracked.

---

## 3. Step-by-Step Guide for Humans (Finding Coordinates & BIG Files)

### Finding Your `bbox` & Center Coordinates (2 minutes)
1. Open [geojson.io](https://geojson.io/) or [bboxfinder.com](http://bboxfinder.com/).
2. Zoom to your village and include **~1–2 km of uphill slope** around the village so D8 flow routing captures upstream catchments cleanly.
3. Read the bounding box in `[west, south, east, north]` order (WGS84 longitude/latitude, e.g., `west: 107.55, south: -7.08, east: 107.61, north: -7.02`).
4. Optional: If you don't have official BIG boundaries yet, draw a polygon around your village in [geojson.io](https://geojson.io/), save it as `raw-data/region-boundary.geojson`, and `prepare-data` will clip all rasters and KPIs to that polygon.

### Downloading High-Resolution Data from BIG Tanah Air Indonesia (Option B)
1. Register/log in for free at **[BIG Tanah Air Indonesia](https://tanahair.indonesia.go.id/portal-web/)**.
2. Download up to three datasets for your location:
   - **DEMNAS (~8.3 m GeoTIFF):** Open *Download → DEMNAS*, click the grid tile covering your village, download the `DEMNAS_XXXX-XX_v1.0.tif` file, and copy it to `raw-data/demnas-region.tif` (matching `regionalOverlays.localDemFilename` in `region.config.json`).
   - **Batas Wilayah Desa/Kelurahan:** Download the national or provincial village boundary `.gdb.zip` (e.g., `BATASWILAYAH_DESA_20260601.gdb.zip`) into `raw-data/big-ref/`.
   - **Peta RBI 1:50.000 (Optional):** Download your Kabupaten/Kota `.zip` archive (containing `RBI50K_*.gdb`) into `raw-data/big-ref/` if you also want official BIG rivers, culverts, bridges, and public facilities.
3. Install Python extractor dependencies (only needed for `.gdb` extraction):
   ```bash
   python3 -m pip install pyogrio shapely
   ```
4. Run extraction & build:
   ```bash
   python3 scripts/extract-big-ref.py --ref-dir raw-data/big-ref
   pnpm run prepare-data
   pnpm run verify
   pnpm start
   ```

---

## 4. Troubleshooting Common Replication Issues

| Symptom | Cause & Fix |
| --- | --- |
| `reset-region` refuses to run | `region.config.json` still has `"id": "nagari-balingka"`. Change `"id"` to your own slug first (or pass `-- --force`). |
| `extract-big-ref.py` outputs `nagariFeatures: 0` | Check the printed list of `KDEPUM` / `NAMOBJ` candidates inside your `bbox`, copy the exact code into `officialBoundaryCode` & `officialBoundaryNameMatch`, and re-run. |
| Map still shows Balingka rivers or empty water layers | Run `pnpm run reset-region` before `pnpm run prepare-data`, and delete `data/balingka.db` so SQLite re-seeds from your new `osm-context.geojson`. |
| Overpass / OSM API times out during `prepare-data` | Your `bbox` may be too large (keep it focused around one village + ~1–2 km catchment buffer) or the OSM API is busy; wait a minute and retry `pnpm run prepare-data`. |
| Village sits near a 1° or 3° lat/lng grid line | Handled automatically — `scripts/prepare-data.mjs` mosaics all intersecting Copernicus DEM (`1°`) and ESA WorldCover (`3°`) tiles. |
