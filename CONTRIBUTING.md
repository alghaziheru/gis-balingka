# Contributing to Nagari Balingka Community GIS

Thank you for your interest in contributing! We welcome issues, pull requests, field data improvements, and regional adaptations in **English or Bahasa Indonesia** (*kontribusi dalam bahasa Indonesia maupun Inggris sangat disambut*).

---

## 1. Core Principles (Please Read First)

1. **100% Open-Source & Zero Proprietary Lock-In:** Keep all runtime dependencies MIT / BSD / ISC / Apache-2.0 compatible. Never introduce paid map SDKs, telemetry, or required third-party API keys.
2. **Neutral Open-Data Framing (*Bukan Pernyataan Kebencanaan Resmi*):** This viewer presents official/open spatial datasets, field drainage records, and exploratory computational terrain models (`HAND` / `D8` / `SCS-CN`). Never add wording that declares disaster statuses, predicts house-level damage, or designates official evacuation sites — those belong strictly to **BNPB**, **BPBD**, **BMKG**, **PVMBG**, and local government authorities.
3. **Bilingual Clarity (`ID` / `EN`):** User-facing UI copy must be natural in both Bahasa Indonesia and English. Avoid literal GIS translations (e.g., use *"Sisipkan ke DEM"* rather than *"Bakar ke DEM"*) and keep `Ringkas` mode plain-language for residents.

---

## 2. Local Development & Pull Request Checklist

Requires **Node.js >= 24** (for built-in `node:sqlite`) and **pnpm**:

```bash
git clone https://github.com/alghaziheru/gis-balingka.git
cd gis-balingka
pnpm install
cp .env.example .env      # Leave ADMIN_PASSPHRASE empty on localhost
pnpm run server           # Terminal 1: SQLite API (http://127.0.0.1:8787)
pnpm run dev              # Terminal 2: Vite dev server (http://localhost:5173)
```

Before opening a pull request, please verify locally:

```bash
pnpm run verify           # Runs typecheck, tests & production build together
```

- Keep PRs focused and small.
- If you modify UI/UX, verify both desktop (`1440×900`) and mobile (`390×844`) layouts with zero console errors.
- Never commit `.env`, `data/*.db`, `raw-data/`, `dist/`, or `graphify-out/`.

---

## 3. Run This GIS for Your Own Desa / Nagari (*Panduan Adaptasi Wilayah Lain*)

This repository ships with **Nagari Balingka** pre-configured so it runs immediately after cloning. To adapt it for another **Desa, Nagari, or Kelurahan in Indonesia**:

### Step 1 — Configure `region.config.json`
Start from [`region.config.example.json`](./region.config.example.json) or edit [`region.config.json`](./region.config.json):

```bash
cp region.config.example.json region.config.json
```

Update the key fields:
- `name`, `shortName`, `district`, `regency`, `province`, `appTitle`
- `adminLevelLabel` (e.g., `Desa` / `Nagari` / `Kelurahan`) & `subRegionLabel` (e.g., `Dusun` / `Jorong` / `RW`)
- `bbox`: padded geographic bounding box (`west`, `south`, `east`, `north` in WGS84 degrees) covering your village plus ~1–2 km upstream slope buffer for clean D8 drainage routing
- `defaultView`, `dataCenter`, `cameraPresets` (quick-jump sub-region centers), `subRegionSuggestions`, and `drainageFocus`
- `authorities`: local `BPBD` and village/nagari office labels
- `regionalOverlays.enabled`: set to `false` unless you have custom municipal ArcGIS overlays (this automatically hides Agam-specific UI panels)

### Step 2 — Provide Your Official Boundary & Elevation Data (Optional but Recommended)
You have two options:

- **Option A — Quick Global Open-Data Build (No Manual Downloads Needed):**
  - Drop your village boundary polygon GeoJSON (WGS84 `FeatureCollection`) at `raw-data/region-boundary.geojson` (optional — if omitted, the `bbox` extent is used).
  - Run `pnpm run prepare-data`. The script automatically fetches **Copernicus DEM GLO-30**, **ESA WorldCover 10m**, and **OpenStreetMap** roads/rivers/buildings for your `bbox`.

- **Option B — High-Resolution BIG Indonesia Build (Recommended for Indonesia):**
  1. Download your **DEMNAS (~8.3 m)** GeoTIFF tile and **Batas Wilayah Desa/Nagari** / **RBI 1:50.000** archives from [BIG Tanah Air Indonesia](https://tanahair.indonesia.go.id/portal-web/) (see [`DATA_SOURCES.md`](./DATA_SOURCES.md)).
  2. Place the DEMNAS GeoTIFF at `raw-data/<regionalOverlays.localDemFilename>` (e.g., `raw-data/demnas-region.tif`).
  3. Extract your boundary & RBI layers using your `region.config.json` codes:
     ```bash
     python3 scripts/extract-big-ref.py --ref-dir /path/to/your-big-downloads
     ```
  4. Generate all clipped rasters, contours, D8 flow paths, HAND overlays, and cascade simulation fields:
     ```bash
     pnpm run prepare-data
     ```

### Step 3 — Start Clean & Verify
1. Remove any previous Balingka seed files (`public/data/verified-waterways.geojson`, `public/data/verified-structures.geojson`, `public/data/suppressed-dem.json`) or replace them with your region's initial verified waterways.
2. Delete any local `data/balingka.db` so SQLite initializes cleanly for your region.
3. Run:
   ```bash
   pnpm run typecheck && pnpm run build && pnpm start
   ```

---

## 4. Reporting Bugs or Suggesting Improvements

- Use the GitHub [Issue templates](./.github/ISSUE_TEMPLATE/) (both English and Bahasa Indonesia are welcome).
- For security vulnerabilities, please follow [`SECURITY.md`](./SECURITY.md) instead of opening a public issue.
