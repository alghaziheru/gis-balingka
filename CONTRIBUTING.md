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

This repository ships with **Nagari Balingka** pre-configured so it runs immediately after cloning. For the complete human + AI-agent adaptation SOP (including finding your `bbox`, `KDEPUM` code, BIG Tanah Air downloads, and troubleshooting), see **[`docs/ADAPT_REGION.md`](./docs/ADAPT_REGION.md)**.

### Quick Summary
1. **Configure `region.config.json`:**
   ```bash
   cp region.config.example.json region.config.json
   ```
   Update `"id"` (must differ from `"nagari-balingka"`), `name`, `adminLevelLabel`/`subRegionLabel`, `bbox`, `defaultView`, `cameraPresets`, `drainageFocus`, `authorities`, and `regionalOverlays.enabled: false`.
2. **Clean stale Nagari Balingka artifacts:**
   ```bash
   pnpm run reset-region
   ```
3. **Provide Data (Option A or Option B):**
   - **Option A — Automatic Open Global Fallback (No Login):** Optionally place a WGS84 polygon at `raw-data/region-boundary.geojson` and run `pnpm run prepare-data`. Copernicus DEM GLO-30 (~30 m, multi-tile), ESA WorldCover 10m (multi-tile), and OpenStreetMap are fetched automatically.
   - **Option B — Official BIG Tanah Air Indonesia (~8.3 m DEMNAS):** Download **DEMNAS**, **Batas Wilayah Desa**, and optionally **RBI 1:50.000** from [BIG Tanah Air Indonesia](https://tanahair.indonesia.go.id/portal-web/) (see [`DATA_SOURCES.md`](./DATA_SOURCES.md) & [`docs/ADAPT_REGION.md`](./docs/ADAPT_REGION.md)), place DEMNAS at `raw-data/<localDemFilename>`, and run:
     ```bash
     python3 scripts/extract-big-ref.py --ref-dir raw-data/big-ref   # RBI 50K is optional (--desa-only supported)
     pnpm run prepare-data
     ```
4. **Verify & Start:**
   ```bash
   pnpm run verify && pnpm start
   ```

---

## 4. Reporting Bugs or Suggesting Improvements

- Use the GitHub [Issue templates](./.github/ISSUE_TEMPLATE/) (both English and Bahasa Indonesia are welcome).
- For security vulnerabilities, please follow [`SECURITY.md`](./SECURITY.md) instead of opening a public issue.
