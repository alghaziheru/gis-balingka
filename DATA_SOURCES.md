# Data Sources, Attribution & Rebuild Guide

This repository ships with **clipped, web-optimized spatial assets** for **Nagari Balingka** (`29.89 km²`, Kec. IV Koto, Kab. Agam, West Sumatra) under [`public/data/`](./public/data/) (~11 MB total, largest file 1.5 MB) so the application runs immediately after cloning or deploying without requiring multi-gigabyte upstream GIS downloads.

Heavy raw inputs (`raw-data/*.tif`, raw `.gdb` archives, local SQLite databases, and scratch notes) are intentionally excluded via [`.gitignore`](./.gitignore).

---

## 1. Authoritative & Open Data Provenance

| Dataset | Agency / Provider | Role in Nagari Balingka GIS | License / Terms |
| --- | --- | --- | --- |
| **DEMNAS `0715-62_v1.0.tif`** (8.3 m native → `542×760` ~13.8 m padded grid) | **BIG** (Badan Informasi Geospasial — Tanah Air Indonesia) | Elevation (`1,032–2,869 m dpl` inside Nagari), hillshade, slope, 25 m contours, Priority-Flood + D8 runoff routing, HAND inundation rasters | Public Indonesian Government Data (with attribution) |
| **RBI 1:50.000 Kab. Agam (`KUGI50`, Dec 2022)** | **BIG** (Badan Informasi Geospasial — Tanah Air Indonesia) | `322` inside-Nagari river & tributary reaches (`agam-rbi-rivers.geojson`), culverts, bridges, weir, and public facility points | Public Indonesian Government Data (with attribution) |
| **Batas Wilayah Desa/Nagari (June 2026)** | **BIG** (Badan Informasi Geospasial — Tanah Air Indonesia) | Official Nagari Balingka polygon (`KDEPUM: 13.06.05.2003`, `29.89 km²`) and exact perimeter cutout (`mask.geojson`, `nagari-boundary.geojson`) | Public Indonesian Government Data (with attribution) |
| **Agam Open GIS Reference Web Maps** (BPBD, BBSDLP, KLHK SK 35, PSG, BMKG via `ptsp.agam`) | **Pemkab Agam** (Kabupaten Agam) | Ground movement map polygons (`41.6%` High, `21.9%` Medium, `24.1%` Low), soil (`92.2%` Andosol), geology, SK 35 protected forest (`27.4%`), and rainfall zones (`agam-context.json`, `agam-grids.json`) | Public Government Data (Pemkab Agam) |
| **ESA WorldCover 10m v200 (2021)** | **European Space Agency (ESA)** | Land cover & forest mask (`84.3%` forest, `9.7%` shrub/grass, `4.6%` cropland, `1.3%` built-up, `0.1%` water) powering SCS-CN runoff & root cohesion (`landcover-grid.json`, `raster-landcover.png`) | **CC-BY-4.0** (ESA / Copernicus) |
| **Google Open Buildings v3** + **OpenStreetMap** | **Google Research** + **OSM Contributors** | Merged `2,175` building footprints (`1,762` OSM + `413` Open Buildings v3 with confidence `>= 0.75`) across `6` residential zones (`settlements.geojson`) | **CC-BY-4.0** (Google) / **ODbL** (OSM) |
| **Copernicus Sentinel-2 L2A (10m)** | **ESA / Copernicus** | Pre (`2022-12-24`) vs. post (`2024-07-11`) NDVI vegetation-cover change difference (`97.5%` clear coverage, `16.6 ha` total decrease, `11.9 ha` strong decrease, `2.3 ha` near-channel) | **Copernicus Open License** |
| **Esri World Imagery** & **OpenTopoMap** | **Esri / Maxar / Earthstar** & **OpenTopoMap** | Runtime satellite and topographic basemap tiles (no API key required; overridable with custom orthophoto via `VITE_CUSTOM_IMAGERY_URL`) | Free with Attribution / **CC-BY-SA** |

> **Important Note on Internal Jorong Boundaries:** Official national/municipal open datasets provide the authoritative **Nagari Balingka** outer boundary (`13.06.05.2003`), but official polygon boundaries separating internal *Jorong* (e.g., Pahambatan, Koto Hilalang, Subarang) are not yet published in Tanah Air Indonesia or Pemkab Agam open layers. Rather than fabricating lines, the app includes an explicit **Jorong Boundary Editor** where Nagari/Jorong leaders can draft or import GeoJSON polygons clearly labeled **`Indicative`** vs. **`Verified`**.

---

## 2. Rebuilding Derived Assets from Official BIG Raw Data

If you want to regenerate all derived spatial assets in [`public/data/`](./public/data/) from scratch (requires **Node.js >= 24**, **pnpm**, and **Python 3** with `pyogrio` and `shapely` for BIG `.gdb` extraction):

### Step A — Download Raw BIG Datasets (`tanahair.indonesia.go.id`)
Create a free account on the [BIG Geospatial Portal (`tanahair.indonesia.go.id`)](https://tanahair.indonesia.go.id/portal-web/) and download:
1. **DEMNAS** tile **`DEMNAS_0715-62_v1.0.tif`** (covers Nagari Balingka / Gunung Singgalang northern slopes).
2. **RBI 1:50.000 Kabupaten Agam** archive (`Agam.zip`, containing `RBI50K_AGAM_KUGI50_20221231.gdb`).
3. **Batas Wilayah Desa/Nagari** archive (`BATASWILAYAH_DESA_20260601.gdb.zip`, containing `BATASWILAYAH_DESA_20260601.gdb`).

### Step B — Place DEMNAS & Extract Clipped BIG Layers
1. Copy the DEMNAS GeoTIFF to:
   ```bash
   cp /path/to/DEMNAS_0715-62_v1.0.tif raw-data/demnas-balingka.tif
   ```
2. Extract the Nagari Balingka polygon and Agam RBI 50K features from the downloaded `.zip` archives (or extracted `.gdb` folders):
   ```bash
   python3 scripts/extract-big-ref.py --ref-dir /path/to/your-big-downloads
   ```
   *(Or set `BIG_REF_DIR=/path/to/your-big-downloads` or place the archives in `raw-data/big-ref/`.)*

### Step C — Run the Full Offline Hydrology & Asset Pipeline
```bash
pnpm run prepare-data
```
`prepare-data.mjs` will:
1. Read `raw-data/demnas-balingka.tif` across the hydrologically padded Nagari Balingka box (`100.278..100.345`, `-0.408..-0.314`) — or automatically fall back to **Copernicus DEM GLO-30** tiles if `raw-data/demnas-balingka.tif` is not present.
2. Carve any verified waterways from `data/balingka.db` (or `public/data/verified-waterways.geojson`) gently into the DEM (`burnStreamsIntoDem`).
3. Compute Priority-Flood sink filling, D8 flow routing, smooth flow reaches, road–stream crossings, 25 m contours, HAND flood rasters (clogged vs. cleared), and the compact physics cascade fields (`public/data/sim-fields.json` with `nagariMaskBase64`).
4. Clip all rasters, GeoJSON features, building totals, and KPIs strictly to the official Nagari Balingka boundary (`mask.geojson`) and update `public/data/metadata.json`.

---

## 3. Licensing & Responsible Use Disclaimer

- Source code in this repository is licensed under the **[MIT License](./LICENSE)**.
- Derived and cached open datasets retain their respective upstream terms and must keep proper attribution to **Badan Informasi Geospasial (BIG)**, **Pemerintah Kabupaten Agam**, **ESA / Copernicus**, **Google Open Buildings**, and **OpenStreetMap contributors**.
- Computational terrain visualizations (`HAND`), simulated runoff waves, theoretical Manning channel thresholds, and modeled steep-slope overlaps are **exploratory open-data calculations** — **not** certified hydraulic engineering designs, hazard declarations, or official early warnings. Official disaster declarations, forecasts, and evacuation instructions belong exclusively to **BNPB**, **BPBD Kabupaten Agam**, **BMKG**, **PVMBG**, and **Wali Nagari Balingka**.
