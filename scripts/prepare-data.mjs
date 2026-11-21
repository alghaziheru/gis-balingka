import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { fromFile, fromUrl } from 'geotiff';
import {
  priorityFloodFill,
  computeD8,
  computeSlopePercent,
  computeHAND,
  burnStreamsIntoDem,
  extractFlowPathsGeoJSON,
  extractContoursGeoJSON,
  detectRoadStreamCrossings,
  renderSmoothTerrainRasters,
  renderSmoothHandFloodRasters,
  haversineMeters
} from './lib/hydrology.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');

// Focused Nagari Balingka + immediate southern uphill catchment (~4.5 x 4.5 km)
const BBOX = {
  west: 100.304,
  south: -0.356,
  east: 100.345,
  north: -0.315
};

const COPERNICUS_COG_URL =
  'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S01_00_E100_00_DEM/Copernicus_DSM_COG_10_S01_00_E100_00_DEM.tif';

function parseCliDemArg() {
  const idx = process.argv.indexOf('--dem');
  if (idx !== -1 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  const defaultLocal = path.join(ROOT, 'raw-data', 'demnas-balingka.tif');
  if (fs.existsSync(defaultLocal)) return defaultLocal;
  return null;
}

function downsampleGrid(elev, w, h, maxDim = 520) {
  if (w <= maxDim && h <= maxDim) return { elev, width: w, height: h };
  const scale = Math.max(w / maxDim, h / maxDim);
  const nw = Math.round(w / scale);
  const nh = Math.round(h / scale);
  const out = new Float32Array(nw * nh);
  for (let r = 0; r < nh; r++) {
    const sr = Math.min(h - 1, Math.floor((r / nh) * h));
    for (let c = 0; c < nw; c++) {
      const sc = Math.min(w - 1, Math.floor((c / nw) * w));
      out[r * nw + c] = elev[sr * w + sc];
    }
  }
  return { elev: out, width: nw, height: nh };
}

async function loadFromGeoTIFF(tiff, sourceLabel) {
  const image = await tiff.getImage();
  const imgW = image.getWidth();
  const imgH = image.getHeight();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();

  const c0 = Math.max(0, Math.floor(((BBOX.west - minX) / (maxX - minX)) * imgW));
  const c1 = Math.min(imgW, Math.ceil(((BBOX.east - minX) / (maxX - minX)) * imgW));
  const r0 = Math.max(0, Math.floor(((maxY - BBOX.north) / (maxY - minY)) * imgH));
  const r1 = Math.min(imgH, Math.ceil(((maxY - BBOX.south) / (maxY - minY)) * imgH));

  const winW = Math.max(10, c1 - c0);
  const winH = Math.max(10, r1 - r0);
  const rasters = await image.readRasters({ window: [c0, r0, c0 + winW, r0 + winH] });
  const raw = rasters[0];
  const floatGrid = new Float32Array(winW * winH);
  for (let i = 0; i < floatGrid.length; i++) {
    const v = Number(raw[i]);
    floatGrid[i] = Number.isFinite(v) && v > -500 ? v : 1089;
  }

  const exactWest = minX + (c0 / imgW) * (maxX - minX);
  const exactEast = minX + ((c0 + winW) / imgW) * (maxX - minX);
  const exactNorth = maxY - (r0 / imgH) * (maxY - minY);
  const exactSouth = maxY - ((r0 + winH) / imgH) * (maxY - minY);

  const ds = downsampleGrid(floatGrid, winW, winH, 520);
  return {
    elev: ds.elev,
    width: ds.width,
    height: ds.height,
    bbox: { west: exactWest, south: exactSouth, east: exactEast, north: exactNorth },
    sourceLabel
  };
}

function decodePngRgb(buf) {
  let pos = 8, w = 0, h = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const rowOff = y * (stride + 1) + 1;
    const outOff = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowOff + x];
      const a = x >= bpp ? out[outOff + x - bpp] : 0;
      const b = y > 0 ? out[outOff - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[outOff - stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = (v + a) & 255;
      else if (f === 2) r = (v + b) & 255;
      else if (f === 3) r = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) r = (v + paeth(a, b, c)) & 255;
      out[outOff + x] = r;
    }
  }
  return { w, h, data: out };
}

async function loadFromTerrariumFallback() {
  const z = 13;
  const n = 2 ** z;
  const txList = [6378, 6379];
  const tyList = [4102, 4103, 4104];
  const tiles = new Map();
  for (const tx of txList) {
    for (const ty of tyList) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Terrarium fetch failed: ${res.status}`);
      tiles.set(`${tx}:${ty}`, decodePngRgb(Buffer.from(await res.arrayBuffer())));
    }
  }
  const width = 160, height = 160;
  const elev = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const lat = BBOX.north - ((r + 0.5) / height) * (BBOX.north - BBOX.south);
    const latRad = (lat * Math.PI) / 180;
    const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const ty = Math.floor(yf);
    const py = Math.min(255, Math.max(0, Math.floor((yf - ty) * 256)));
    for (let c = 0; c < width; c++) {
      const lng = BBOX.west + ((c + 0.5) / width) * (BBOX.east - BBOX.west);
      const xf = ((lng + 180) / 360) * n;
      const tx = Math.floor(xf);
      const px = Math.min(255, Math.max(0, Math.floor((xf - tx) * 256)));
      const tile = tiles.get(`${tx}:${ty}`);
      const pIdx = (py * tile.w + px) * 3;
      elev[r * width + c] = tile.data[pIdx] * 256 + tile.data[pIdx + 1] + tile.data[pIdx + 2] / 256 - 32768;
    }
  }
  return { elev, width, height, bbox: BBOX, sourceLabel: 'AWS Mapzen Terrarium DEM (Fallback z13)' };
}

async function fetchDEM() {
  const localPath = parseCliDemArg();
  if (localPath) {
    console.log(`Loading local DEM GeoTIFF: ${localPath}`);
    const tiff = await fromFile(localPath);
    return loadFromGeoTIFF(tiff, `Local GeoTIFF (${path.basename(localPath)})`);
  }
  try {
    console.log('Fetching Copernicus DEM GLO-30 COG window for Nagari Balingka block...');
    const tiff = await fromUrl(COPERNICUS_COG_URL);
    return await loadFromGeoTIFF(tiff, 'Copernicus DEM GLO-30 (30m, ESA/Airbus Open Data)');
  } catch (err) {
    console.warn(`Copernicus COG failed (${err.message}); falling back to AWS Terrarium tiles...`);
    return loadFromTerrariumFallback();
  }
}

async function fetchRealOSM(bbox) {
  console.log('Fetching real OpenStreetMap features for Nagari Balingka block...');
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox.west.toFixed(5)},${bbox.south.toFixed(5)},${bbox.east.toFixed(5)},${bbox.north.toFixed(5)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'nagari-balingka-gis/1.0 (open-source community flood tool)' } });
  if (!res.ok) throw new Error(`OSM API returned HTTP ${res.status}`);
  const json = await res.json();

  const nodes = new Map();
  const ways = new Map();
  for (const el of json.elements || []) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'way') ways.set(el.id, el);
  }

  const inBox = (lon, lat) =>
    lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;

  const placeFeatures = [];
  const facilityFeatures = [];
  const waterwayFeatures = [];
  const roadFeatures = [];
  const bridgeFeatures = [];

  const wayCoords = w => {
    const out = [];
    for (const nid of w.nodes || []) {
      const nd = nodes.get(nid);
      if (nd) out.push([Number(nd.lon.toFixed(6)), Number(nd.lat.toFixed(6))]);
    }
    return out;
  };
  const wayCenter = coords => coords[Math.floor(coords.length / 2)];

  for (const nd of nodes.values()) {
    const tags = nd.tags || {};
    if (!inBox(nd.lon, nd.lat)) continue;
    if (tags.place && tags.name) {
      placeFeatures.push({
        type: 'Feature',
        properties: { id: `osm-n-${nd.id}`, kind: 'place', place: tags.place, name: tags.name },
        geometry: { type: 'Point', coordinates: [Number(nd.lon.toFixed(6)), Number(nd.lat.toFixed(6))] }
      });
    } else if ((tags.amenity === 'school' || tags.amenity === 'clinic' || tags.amenity === 'townhall' || tags.amenity === 'place_of_worship') && tags.name) {
      facilityFeatures.push({
        type: 'Feature',
        properties: { id: `osm-f-${nd.id}`, kind: 'facility', amenity: tags.amenity, name: tags.name },
        geometry: { type: 'Point', coordinates: [Number(nd.lon.toFixed(6)), Number(nd.lat.toFixed(6))] }
      });
    }
  }

  for (const w of ways.values()) {
    const tags = w.tags || {};
    const coords = wayCoords(w);
    if (coords.length < 2) continue;

    if (tags.waterway) {
      waterwayFeatures.push({
        type: 'Feature',
        properties: {
          id: `osm-w-${w.id}`,
          kind: 'waterway',
          waterway: tags.waterway,
          name: tags.name || (tags.waterway === 'river' ? 'Sungai' : 'Anak Sungai')
        },
        geometry: { type: 'LineString', coordinates: coords }
      });
    }

    if (tags.highway) {
      const keep = ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'trunk'].includes(tags.highway);
      if (keep) {
        roadFeatures.push({
          type: 'Feature',
          properties: {
            id: `osm-r-${w.id}`,
            kind: 'road',
            highway: tags.highway,
            name: tags.name || '',
            bridge: tags.bridge === 'yes'
          },
          geometry: { type: 'LineString', coordinates: coords }
        });
      }
      if (tags.bridge === 'yes') {
        const ctr = wayCenter(coords);
        if (inBox(ctr[0], ctr[1])) {
          bridgeFeatures.push({
            type: 'Feature',
            properties: {
              id: `osm-b-${w.id}`,
              kind: 'bridge',
              name: tags.name ? `Jembatan ${tags.name}` : `Jembatan OSM #${w.id}`,
              highway: tags.highway
            },
            geometry: { type: 'Point', coordinates: ctr }
          });
        }
      }
    }

    if ((tags.amenity === 'school' || tags.amenity === 'clinic' || tags.amenity === 'townhall' || tags.amenity === 'place_of_worship') && tags.name) {
      const ctr = wayCenter(coords);
      if (inBox(ctr[0], ctr[1])) {
        facilityFeatures.push({
          type: 'Feature',
          properties: { id: `osm-wf-${w.id}`, kind: 'facility', amenity: tags.amenity, name: tags.name },
          geometry: { type: 'Point', coordinates: ctr }
        });
      }
    }
  }

  return { placeFeatures, facilityFeatures, waterwayFeatures, roadFeatures, bridgeFeatures };
}

function loadVerifiedWaterwaysForBurning() {
  const dbPath = path.join(ROOT, 'data', 'balingka.db');
  if (fs.existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { open: true });
      const rows = db.prepare('SELECT id, name, kind, coordinates_json FROM waterways WHERE deleted = 0').all();
      const supRows = db.prepare('SELECT seg_id FROM suppressed_dem_segments').all();
      db.close();
      return {
        source: 'sqlite',
        features: rows.map(r => ({
          type: 'Feature',
          properties: { id: r.id, name: r.name, kind: r.kind, tier: r.kind === 'river' ? 1 : 2, catchment_ha: r.kind === 'river' ? 280 : 110 },
          geometry: { type: 'LineString', coordinates: JSON.parse(r.coordinates_json) }
        })),
        suppressedIds: new Set(supRows.map(s => s.seg_id))
      };
    } catch (err) {
      console.warn('Warning: could not read data/balingka.db for stream burning:', err.message);
    }
  }
  const geoPath = path.join(ROOT, 'raw-data', 'verified-waterways.geojson');
  if (fs.existsSync(geoPath)) {
    const fc = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    return {
      source: 'geojson',
      features: (fc.features || []).filter(f => f?.geometry?.type === 'LineString'),
      suppressedIds: new Set()
    };
  }
  return { source: 'none', features: [], suppressedIds: new Set() };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Clean up old blocky polygon GeoJSONs if present
  for (const oldFile of ['slope-zones.geojson', 'hand-flood-zones.geojson']) {
    const p = path.join(OUT_DIR, oldFile);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const dem = await fetchDEM();
  const { elev, width, height, bbox, sourceLabel } = dem;
  const midLat = (bbox.south + bbox.north) / 2;
  const totalWidthM = haversineMeters(bbox.west, midLat, bbox.east, midLat);
  const totalHeightM = haversineMeters(bbox.west, bbox.south, bbox.west, bbox.north);
  const cellSizeX = totalWidthM / width;
  const cellSizeY = totalHeightM / height;
  const gridMeta = { width, height, bbox, cellSizeX, cellSizeY };

  console.log(`DEM ready: ${width}x${height} cells (~${cellSizeX.toFixed(1)}m x ${cellSizeY.toFixed(1)}m), bbox=${JSON.stringify(bbox)}`);

  let minElev = Infinity, maxElev = -Infinity;
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < minElev) minElev = elev[i];
    if (elev[i] > maxElev) maxElev = elev[i];
  }

  const verified = loadVerifiedWaterwaysForBurning();
  let hydroElev = elev;
  let hydroConditioned = false;
  if (verified.features.length > 0) {
    const burned = burnStreamsIntoDem(elev, verified.features, gridMeta, 2.5);
    hydroElev = burned.elev;
    hydroConditioned = burned.burnedCellCount > 0;
    console.log(`Stream-burning (${verified.source}): carved ${verified.features.length} verified waterways (${burned.burnedCellCount} cells).`);
  }

  const filled = priorityFloodFill(hydroElev, width, height);
  const { dir, acc } = computeD8(filled, width, height, cellSizeX, cellSizeY);
  const slope = computeSlopePercent(elev, width, height, cellSizeX, cellSizeY);
  const hand = computeHAND(elev, dir, acc, width, height, 75);

  const flowPaths = extractFlowPathsGeoJSON(elev, dir, acc, gridMeta, {
    main: 240,
    normal: 75,
    detail: 25
  });
  const contours = extractContoursGeoJSON(elev, gridMeta, 25);

  const osm = await fetchRealOSM(bbox);
  const activeFlowFeatures = flowPaths.features.filter(f => !verified.suppressedIds.has(f.properties.id));
  const combinedStreams = [
    ...verified.features.map(f => ({
      ...f,
      properties: {
        tier: f.properties?.tier || 1,
        catchment_ha: f.properties?.catchment_ha || 180,
        ...f.properties
      }
    })),
    ...activeFlowFeatures
  ];
  const crossings = detectRoadStreamCrossings(osm.roadFeatures, combinedStreams, 85);

  const bottlenecks = [
    ...crossings.map((c, idx) => ({
      id: `cross-${idx + 1}`,
      coords: c.coords,
      kind: 'drainage',
      status: c.tier === 1 ? 'critical' : 'clogged',
      name_id: c.roadName ? `Perlintasan Alur ${c.roadName}` : `Gorong / Perlintasan Jalan–Alur #${idx + 1}`,
      name_en: c.roadName ? `Stream Crossing at ${c.roadName}` : `Road–Stream Crossing #${idx + 1}`,
      desc_id: `Persilangan nyata jalan OSM (${c.highway}) dengan alur limpasan DEM (DAS hulu ~${c.catchment_ha} ha). Perlu cek kapasitas gorong-gorong.`,
      desc_en: `Real intersection of OSM road (${c.highway}) and DEM runoff channel (~${c.catchment_ha} ha upstream catchment). Verify culvert capacity.`
    })),
    ...osm.bridgeFeatures.map((b, idx) => ({
      id: `br-${idx + 1}`,
      coords: b.geometry.coordinates,
      kind: 'drainage',
      status: 'damaged',
      name_id: b.properties.name,
      name_en: b.properties.name.replace(/^Jembatan/, 'Bridge'),
      desc_id: `Jembatan jalan (${b.properties.highway}) dari OpenStreetMap — cek kondisi tebing & sumbatan material.`,
      desc_en: `OpenStreetMap bridge (${b.properties.highway}) — inspect abutment stability and debris clearance.`
    }))
  ];

  // Render smooth anti-aliased CutSheetRX-style Terrain & HAND PNG overlays
  console.log('Rendering smooth 1024x1024 CutSheetRX terrain rasters & HAND flood overlays...');
  const terrainRasters = renderSmoothTerrainRasters(elev, slope, gridMeta, 1024);
  const handRasters = renderSmoothHandFloodRasters(hand, slope, bottlenecks, gridMeta, 768);

  fs.writeFileSync(path.join(OUT_DIR, 'raster-relief.png'), terrainRasters.reliefPng);
  fs.writeFileSync(path.join(OUT_DIR, 'raster-elev.png'), terrainRasters.elevPng);
  fs.writeFileSync(path.join(OUT_DIR, 'raster-slope.png'), terrainRasters.slopePng);
  for (const [k, buf] of Object.entries(handRasters.pngs)) {
    fs.writeFileSync(path.join(OUT_DIR, `raster-hand-${k}.png`), buf);
  }

  // Auto-seed mitigation & landslide candidates inside Balingka block
  const checkDamFeatures = [];
  for (const fp of flowPaths.features) {
    if (fp.properties.tier === 2 && fp.properties.slope_pct >= 11 && checkDamFeatures.length < 4) {
      const mid = fp.geometry.coordinates[Math.floor(fp.geometry.coordinates.length / 2)];
      checkDamFeatures.push({
        type: 'Feature',
        properties: {
          id: `cd-${checkDamFeatures.length + 1}`,
          kind: 'bronjong',
          status: 'normal',
          verified: false,
          name_id: `Kandidat Cekdam / Bronjong Hulu #${checkDamFeatures.length + 1}`,
          name_en: `Candidate Check Dam / Gabion #${checkDamFeatures.length + 1}`,
          desc_id: `Alur hulu curam (${fp.properties.slope_pct}% lereng, DAS ${fp.properties.catchment_ha} ha). Potensial penahan sedimen/kayu.`,
          desc_en: `Steep upland channel (${fp.properties.slope_pct}% slope, ${fp.properties.catchment_ha} ha catchment). Potential debris-trap site.`
        },
        geometry: { type: 'Point', coordinates: mid }
      });
    }
  }

  // Pick top 3 steepest grid clusters (>38%) for landslide pin markers
  const landslideSeeds = [];
  const stepScan = 16;
  for (let r = 12; r < height - 12 && landslideSeeds.length < 3; r += stepScan) {
    for (let c = 12; c < width - 12 && landslideSeeds.length < 3; c += stepScan) {
      const sl = slope[r * width + c];
      if (sl >= 38) {
        const lng = bbox.west + ((c + 0.5) / width) * (bbox.east - bbox.west);
        const lat = bbox.north - ((r + 0.5) / height) * (bbox.north - bbox.south);
        landslideSeeds.push({
          type: 'Feature',
          properties: {
            id: `ls-${landslideSeeds.length + 1}`,
            kind: 'landslide',
            status: 'critical',
            verified: false,
            name_id: `Titik Lereng Terjal #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            name_en: `Steep Slope Point #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            desc_id: `Kemiringan ~${Math.round(sl)}% terdeteksi dari DEM; rawan luncuran tanah saat hujan berkepanjangan.`,
            desc_en: `~${Math.round(sl)}% slope detected from DEM; susceptible to earthslides during heavy rain.`
          },
          geometry: { type: 'Point', coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] }
        });
      }
    }
  }

  const evacFeatures = [];
  for (const fac of osm.facilityFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = fac.geometry.coordinates;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const hVal = hand[row * width + col];
    if (hVal >= 5) {
      evacFeatures.push({
        type: 'Feature',
        properties: {
          id: `ev-${evacFeatures.length + 1}`,
          kind: 'evacuation',
          status: 'normal',
          verified: false,
          name_id: `Kandidat Evakuasi: ${fac.properties.name}`,
          name_en: `Evacuation Candidate: ${fac.properties.name}`,
          desc_id: `Fasilitas publik OSM berada ~${Math.round(hVal)}m di atas dasar sungai terdekat.`,
          desc_en: `OSM public facility situated ~${Math.round(hVal)}m above nearest drainage channel.`
        },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }
  }
  for (const pl of osm.placeFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = pl.geometry.coordinates;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const hVal = hand[row * width + col];
    if (hVal >= 6) {
      evacFeatures.push({
        type: 'Feature',
        properties: {
          id: `ev-${evacFeatures.length + 1}`,
          kind: 'evacuation',
          status: 'normal',
          verified: false,
          name_id: `Kandidat Titik Kumpul: ${pl.properties.name}`,
          name_en: `Assembly Point Candidate: ${pl.properties.name}`,
          desc_id: `Lahan tinggi (~${Math.round(hVal)}m di atas alur sungai terdekat) di sekitar ${pl.properties.name}.`,
          desc_en: `Elevated ground (~${Math.round(hVal)}m above nearest channel) near ${pl.properties.name}.`
        },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }
  }

  const drainageDraft = {
    type: 'FeatureCollection',
    features: [
      ...bottlenecks.map(b => ({
        type: 'Feature',
        properties: {
          id: b.id,
          kind: b.kind,
          status: b.status,
          verified: false,
          name_id: b.name_id,
          name_en: b.name_en,
          desc_id: b.desc_id,
          desc_en: b.desc_en
        },
        geometry: { type: 'Point', coordinates: b.coords }
      })),
      ...checkDamFeatures,
      ...landslideSeeds,
      ...evacFeatures
    ]
  };

  const int16Elev = new Int16Array(elev.length);
  for (let i = 0; i < elev.length; i++) int16Elev[i] = Math.round(elev[i]);
  const elevBase64 = Buffer.from(int16Elev.buffer).toString('base64');

  const demGridJson = {
    width,
    height,
    bbox,
    cellSizeX: Number(cellSizeX.toFixed(2)),
    cellSizeY: Number(cellSizeY.toFixed(2)),
    minElev: Math.round(minElev),
    maxElev: Math.round(maxElev),
    elevBase64
  };

  const watershedGeoJSON = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name_id: 'Blok Peta Nagari Balingka',
        name_en: 'Nagari Balingka Map Block',
        area_km2: Number(((totalWidthM * totalHeightM) / 1e6).toFixed(2))
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[bbox.west, bbox.north], [bbox.east, bbox.north], [bbox.east, bbox.south], [bbox.west, bbox.south], [bbox.west, bbox.north]]]
      }
    }]
  };

  // Inverted studio mask polygon covering the globe with an inner cutout matching exact BBOX
  const maskGeoJSON = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'Studio Mask Outside Balingka' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[-180, 85], [180, 85], [180, -85], [-180, -85], [-180, 85]],
          [[bbox.west, bbox.north], [bbox.west, bbox.south], [bbox.east, bbox.south], [bbox.east, bbox.north], [bbox.west, bbox.north]]
        ]
      }
    }]
  };

  const osmContext = {
    type: 'FeatureCollection',
    features: [
      ...osm.placeFeatures,
      ...osm.waterwayFeatures,
      ...osm.roadFeatures,
      ...osm.bridgeFeatures,
      ...osm.facilityFeatures
    ]
  };

  const totalStreamKm = flowPaths.features.reduce((s, f) => s + f.properties.length_m, 0) / 1000;
  const center = [
    Number(((bbox.west + bbox.east) / 2).toFixed(6)),
    Number(((bbox.south + bbox.north) / 2).toFixed(6))
  ];

  const metadata = {
    generatedAt: new Date().toISOString(),
    center,
    bbox,
    demSource: sourceLabel,
    gridDimensions: `${width}x${height}`,
    resolutionMeters: Number(((cellSizeX + cellSizeY) / 2).toFixed(1)),
    minElevM: Math.round(minElev),
    maxElevM: Math.round(maxElev),
    studyAreaKm2: Number(((totalWidthM * totalHeightM) / 1e6).toFixed(2)),
    streamNetworkKm: Number(totalStreamKm.toFixed(1)),
    osmPlaceCount: osm.placeFeatures.length,
    osmWaterwayCount: osm.waterwayFeatures.length,
    osmRoadCount: osm.roadFeatures.length,
    crossingsDetected: crossings.length,
    bridgesDetected: osm.bridgeFeatures.length,
    simAreasHa: handRasters.simAreasHa,
    verifiedWaterwayCount: verified.features.length,
    hydroConditioned,
    licenses: [
      { name: 'MapLibre GL JS', license: 'BSD-3-Clause' },
      { name: 'Copernicus DEM GLO-30', license: 'Copernicus Open License' },
      { name: 'AWS Mapzen Terrarium', license: 'Public Open Data' },
      { name: 'Esri World Imagery', license: 'Free w/ Attribution (No API Key)' },
      { name: 'OpenStreetMap & OpenTopoMap', license: 'ODbL / CC-BY-SA' }
    ]
  };

  const writeJson = (name, obj) => fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj));
  writeJson('metadata.json', metadata);
  writeJson('dem-grid.json', demGridJson);
  writeJson('watershed.geojson', watershedGeoJSON);
  writeJson('mask.geojson', maskGeoJSON);
  writeJson('contours.geojson', contours);
  writeJson('flow-paths.geojson', flowPaths);
  writeJson('osm-context.geojson', osmContext);
  writeJson('drainage-draft.geojson', drainageDraft);

  console.log('Generated Balingka-only crisp studio assets in public/data/:');
  console.log(`  Block: ${metadata.studyAreaKm2} km2 (${metadata.gridDimensions}, ${metadata.minElevM}..${metadata.maxElevM}m)`);
  console.log(`  Smooth streams: ${flowPaths.features.length} reaches (${metadata.streamNetworkKm} km)`);
  console.log(`  Smooth contours: ${contours.features.length} polylines`);
  console.log(`  OSM places: ${osm.placeFeatures.length}, roads: ${osm.roadFeatures.length}, crossings: ${crossings.length}, bridges: ${osm.bridgeFeatures.length}`);
  console.log(`  HAND areas (ha):`, JSON.stringify(metadata.simAreasHa));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
