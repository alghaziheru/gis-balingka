import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
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
  filterOverlappingFlowPaths,
  extractContoursGeoJSON,
  detectRoadStreamCrossings,
  renderSmoothTerrainRasters,
  renderSmoothHandFloodRasters,
  renderLandCoverRaster,
  renderScourChangeRaster,
  rasterizeAgamGrids,
  buildPolygonMaskGrid,
  isPointInFeatureCollection,
  computeFeatureCollectionAreaKm2,
  computeCascadeFields,
  haversineMeters
} from './lib/hydrology.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');

function loadRegionConfig() {
  const cfgPath = path.join(ROOT, 'region.config.json');
  if (fs.existsSync(cfgPath)) {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
  return {
    name: 'Nagari Balingka',
    bbox: { west: 100.278, south: -0.408, east: 100.345, north: -0.314 },
    dataCenter: [100.319, -0.345],
    regionalOverlays: {
      enabled: true,
      sentinelChangeAvailable: true,
      localDemFilename: 'demnas-balingka.tif'
    }
  };
}

const REGION_CFG = loadRegionConfig();
const BBOX = {
  west: Number(REGION_CFG.bbox.west),
  south: Number(REGION_CFG.bbox.south),
  east: Number(REGION_CFG.bbox.east),
  north: Number(REGION_CFG.bbox.north)
};

function computeCopernicusCogUrl(bbox) {
  const midLat = (bbox.south + bbox.north) / 2;
  const midLng = (bbox.west + bbox.east) / 2;
  const latDeg = Math.floor(midLat);
  const lngDeg = Math.floor(midLng);
  const latTag = `${latDeg < 0 ? 'S' : 'N'}${String(Math.abs(latDeg)).padStart(2, '0')}_00`;
  const lngTag = `${lngDeg < 0 ? 'W' : 'E'}${String(Math.abs(lngDeg)).padStart(3, '0')}_00`;
  const tile = `Copernicus_DSM_COG_10_${latTag}_${lngTag}_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${tile}/${tile}.tif`;
}

function computeWorldCoverCogUrl(bbox) {
  const midLat = (bbox.south + bbox.north) / 2;
  const midLng = (bbox.west + bbox.east) / 2;
  const latTile = Math.floor(midLat / 3) * 3;
  const lngTile = Math.floor(midLng / 3) * 3;
  const latTag = `${latTile < 0 ? 'S' : 'N'}${String(Math.abs(latTile)).padStart(2, '0')}`;
  const lngTag = `${lngTile < 0 ? 'W' : 'E'}${String(Math.abs(lngTile)).padStart(3, '0')}`;
  return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${latTag}${lngTag}_Map.tif`;
}

const COPERNICUS_COG_URL = computeCopernicusCogUrl(BBOX);
const ESA_WORLDCOVER_COG_URL = computeWorldCoverCogUrl(BBOX);
const AGAM_ADMIN_WEBMAP_URL =
  'https://www.arcgis.com/sharing/rest/content/items/c6d9b777f1a84f4283d970881a371536/data?f=json';
const OPEN_BUILDINGS_2FD_URL =
  'https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/2fd_buildings.csv.gz';
const AGAM_WEBMAP_URLS = {
  rivers: 'https://www.arcgis.com/sharing/rest/content/items/1bae109aa7e047308acb6e156e023d85/data?f=json',
  hazard: 'https://www.arcgis.com/sharing/rest/content/items/7f8dabc1aae2420ba471aeee52f1e241/data?f=json',
  soil: 'https://www.arcgis.com/sharing/rest/content/items/aa3c0d93c94c4743b0735949e633c654/data?f=json',
  geology: 'https://www.arcgis.com/sharing/rest/content/items/d1c327c5cfb24b13ad0fdc7de509013f/data?f=json',
  forest: 'https://www.arcgis.com/sharing/rest/content/items/fcc8e0ec50ba4e428a6fd0bc0cd2eda3/data?f=json'
};
const S2_PRE_SCENE_ID = 'S2A_47MPV_20221224_0_L2A';
const S2_POST_SCENE_ID = 'S2B_47MPV_20240711_0_L2A';

function parseCliDemArg() {
  const idx = process.argv.indexOf('--dem');
  if (idx !== -1 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  const demFile = REGION_CFG.regionalOverlays?.localDemFilename || 'demnas-balingka.tif';
  const defaultLocal = path.join(ROOT, 'raw-data', demFile);
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

  const ds = downsampleGrid(floatGrid, winW, winH, 760);
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
    const label =
      path.basename(localPath) === 'demnas-balingka.tif'
        ? 'BIG DEMNAS 8m (0715-62_v1.0)'
        : `Local GeoTIFF (${path.basename(localPath)})`;
    return loadFromGeoTIFF(tiff, label);
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
  const buildingFeatures = [];
  const residentialFeatures = [];

  const wayCoords = w => {
    const out = [];
    for (const nid of w.nodes || []) {
      const nd = nodes.get(nid);
      if (nd) out.push([Number(nd.lon.toFixed(6)), Number(nd.lat.toFixed(6))]);
    }
    return out;
  };
  const wayCenter = coords => coords[Math.floor(coords.length / 2)];
  const ringCentroid = ring => {
    const len = ring.length > 1 ? ring.length - 1 : ring.length;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < len; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    return [sx / Math.max(1, len), sy / Math.max(1, len)];
  };

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

    if (coords.length >= 3 && (tags.building || tags.landuse === 'residential')) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      const closedRing =
        first[0] === last[0] && first[1] === last[1] ? coords : [...coords, [first[0], first[1]]];
      const [cx, cy] = ringCentroid(closedRing);
      if (inBox(cx, cy)) {
        if (tags.building) {
          buildingFeatures.push({
            type: 'Feature',
            properties: {
              id: `osm-bld-${w.id}`,
              kind: 'building',
              building: String(tags.building),
              name: tags.name || ''
            },
            geometry: { type: 'Polygon', coordinates: [closedRing] }
          });
        } else if (tags.landuse === 'residential') {
          residentialFeatures.push({
            type: 'Feature',
            properties: {
              id: `osm-res-${w.id}`,
              kind: 'residential',
              name: tags.name || 'Area Permukiman'
            },
            geometry: { type: 'Polygon', coordinates: [closedRing] }
          });
        }
      }
    }
  }

  return {
    placeFeatures,
    facilityFeatures,
    waterwayFeatures,
    roadFeatures,
    bridgeFeatures,
    buildingFeatures,
    residentialFeatures
  };
}

async function fetchLandCover(bbox, demWidth, demHeight, insideMask = null) {
  try {
    console.log('Fetching ESA WorldCover 10m v200 COG window for Nagari Balingka block...');
    const tiff = await fromUrl(ESA_WORLDCOVER_COG_URL);
    const image = await tiff.getImage();
    const imgW = image.getWidth();
    const imgH = image.getHeight();
    const [minX, minY, maxX, maxY] = image.getBoundingBox();

    const c0 = Math.max(0, Math.floor(((bbox.west - minX) / (maxX - minX)) * imgW));
    const c1 = Math.min(imgW, Math.ceil(((bbox.east - minX) / (maxX - minX)) * imgW));
    const r0 = Math.max(0, Math.floor(((maxY - bbox.north) / (maxY - minY)) * imgH));
    const r1 = Math.min(imgH, Math.ceil(((maxY - bbox.south) / (maxY - minY)) * imgH));

    const winW = Math.max(10, c1 - c0);
    const winH = Math.max(10, r1 - r0);
    const [raw] = await image.readRasters({ window: [c0, r0, c0 + winW, r0 + winH] });

    const counts = { forest: 0, shrubGrass: 0, cropland: 0, builtup: 0, bare: 0, water: 0 };
    let maskedTotal = 0;
    for (let r = 0; r < winH; r++) {
      const dr = Math.min(demHeight - 1, Math.floor((r / winH) * demHeight));
      for (let c = 0; c < winW; c++) {
        if (insideMask) {
          const dc = Math.min(demWidth - 1, Math.floor((c / winW) * demWidth));
          if (insideMask[dr * demWidth + dc] === 0) continue;
        }
        maskedTotal++;
        const code = Number(raw[r * winW + c]);
        if (code === 10) counts.forest++;
        else if (code === 20 || code === 30) counts.shrubGrass++;
        else if (code === 40) counts.cropland++;
        else if (code === 50) counts.builtup++;
        else if (code === 60) counts.bare++;
        else if (code === 80 || code === 90) counts.water++;
      }
    }
    const total = Math.max(1, maskedTotal);
    const stats = {
      source: 'ESA WorldCover 10m v200 (2021)',
      forestPct: Number(((counts.forest / total) * 100).toFixed(1)),
      shrubGrassPct: Number(((counts.shrubGrass / total) * 100).toFixed(1)),
      croplandPct: Number(((counts.cropland / total) * 100).toFixed(1)),
      builtupPct: Number(((counts.builtup / total) * 100).toFixed(1)),
      barePct: Number(((counts.bare / total) * 100).toFixed(1)),
      waterPct: Number(((counts.water / total) * 100).toFixed(1))
    };

    const lcPng = renderLandCoverRaster(raw, winW, winH, 1024);
    const dsClasses = new Uint8Array(demWidth * demHeight);
    for (let r = 0; r < demHeight; r++) {
      const sr = Math.min(winH - 1, Math.floor(((r + 0.5) / demHeight) * winH));
      for (let c = 0; c < demWidth; c++) {
        const sc = Math.min(winW - 1, Math.floor(((c + 0.5) / demWidth) * winW));
        dsClasses[r * demWidth + c] = Number(raw[sr * winW + sc]) || 0;
      }
    }
    const lcGridJson = {
      width: demWidth,
      height: demHeight,
      bbox,
      source: 'ESA WorldCover 10m v200 (2021, CC-BY-4.0)',
      classesBase64: Buffer.from(dsClasses.buffer).toString('base64')
    };

    return { stats, lcPng, lcGridJson, dsClasses };
  } catch (err) {
    console.warn(`Warning: ESA WorldCover fetch failed (${err.message}); keeping existing landcover files if present.`);
    return null;
  }
}

async function fetchNagariBoundary() {
  const localCustom = path.join(ROOT, 'raw-data', 'region-boundary.geojson');
  if (fs.existsSync(localCustom)) {
    try {
      const gj = JSON.parse(fs.readFileSync(localCustom, 'utf8'));
      if (gj?.features?.length > 0) {
        console.log(`Loaded custom region boundary (raw-data/region-boundary.geojson) for ${REGION_CFG.name}.`);
        return gj;
      }
    } catch {}
  }
  const localBig2026 = path.join(ROOT, 'raw-data', 'big-nagari-2026.geojson');
  if (fs.existsSync(localBig2026)) {
    try {
      const gj = JSON.parse(fs.readFileSync(localBig2026, 'utf8'));
      if (gj?.features?.length > 0) {
        console.log(`Loaded official BIG boundary (raw-data/big-nagari-2026.geojson) for ${REGION_CFG.name}.`);
        return gj;
      }
    } catch {}
  }
  if (!REGION_CFG.regionalOverlays?.enabled) {
    console.log('No local boundary GeoJSON found in raw-data/; using configured bounding box extent.');
    return null;
  }
  try {
    console.log('Fetching official Nagari Balingka boundary (Pemkab Agam)...');
    const res = await fetch(AGAM_ADMIN_WEBMAP_URL, {
      headers: { 'User-Agent': 'nagari-balingka-gis/1.0' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const op = (j.operationalLayers || []).find(l => l.title === 'Batas Administrasi Nagari');
    const feats = op?.featureCollection?.layers?.[0]?.featureSet?.features || [];
    const balingka = feats.find(f => String(f.attributes?.NAGARI || '').toUpperCase() === 'BALINGKA');
    if (!balingka?.geometry?.rings?.length) {
      throw new Error('BALINGKA polygon not found in Pemkab Agam layer');
    }

    const R = 6378137;
    const toLonLat = ([x, y]) => [
      Number(((x / R) * (180 / Math.PI)).toFixed(6)),
      Number(((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)).toFixed(6))
    ];
    const coordinates = balingka.geometry.rings.map(ring => {
      const wgs = ring.map(toLonLat);
      if (wgs.length >= 3) {
        const f = wgs[0];
        const l = wgs[wgs.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) wgs.push([f[0], f[1]]);
      }
      return wgs;
    });

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            name_id: 'Batas Administrasi Nagari Balingka',
            name_en: 'Nagari Balingka Administrative Boundary',
            code: '13.06.05.2003',
            kecamatan: String(balingka.attributes?.KECAMATAN || 'IV KOTO'),
            kabupaten: 'Agam',
            source: 'Pemkab Agam (ArcGIS Batas Administrasi Nagari)',
            official: true,
            area_ha: Math.round(Number(balingka.attributes?.AREA || 0))
          },
          geometry: { type: 'Polygon', coordinates }
        }
      ]
    };
  } catch (err) {
    console.warn(`Warning: Nagari boundary fetch failed (${err.message}); keeping existing file if present.`);
    return null;
  }
}

function wgs84ToUtm47S(lon, lat) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const lon0 = (99 * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const tanP = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinP * sinP);
  const T = tanP * tanP;
  const C = ep2 * cosP * cosP;
  const A = cosP * (lam - lon0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x =
    500000 +
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y =
    10000000 +
    k0 *
      (M +
        N *
          tanP *
          (A ** 2 / 2 +
            ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
            ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [x, y];
}

async function fetchSentinel2ScourChange(bbox, hand, gridMeta, insideMask = null) {
  try {
    console.log('Fetching Sentinel-2 L2A (10m) pre vs post disaster scenes...');
    const [preMeta, postMeta] = await Promise.all([
      fetch(`https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${S2_PRE_SCENE_ID}`, {
        signal: AbortSignal.timeout(12000)
      }).then(r => {
        if (!r.ok) throw new Error(`STAC pre HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${S2_POST_SCENE_ID}`, {
        signal: AbortSignal.timeout(12000)
      }).then(r => {
        if (!r.ok) throw new Error(`STAC post HTTP ${r.status}`);
        return r.json();
      })
    ]);

    const [minE, minN] = wgs84ToUtm47S(bbox.west, bbox.south);
    const [maxE, maxN] = wgs84ToUtm47S(bbox.east, bbox.north);

    const readUtmWindow = async href => {
      const tiff = await fromUrl(href);
      const img = await tiff.getImage();
      const [bx0, by0, bx1, by1] = img.getBoundingBox();
      const iw = img.getWidth();
      const ih = img.getHeight();
      const c0 = Math.max(0, Math.floor(((minE - bx0) / (bx1 - bx0)) * iw));
      const c1 = Math.min(iw, Math.ceil(((maxE - bx0) / (bx1 - bx0)) * iw));
      const r0 = Math.max(0, Math.floor(((by1 - maxN) / (by1 - by0)) * ih));
      const r1 = Math.min(ih, Math.ceil(((by1 - minN) / (by1 - by0)) * ih));
      const [data] = await img.readRasters({ window: [c0, r0, c1, r1] });
      return { data, w: c1 - c0, h: r1 - r0 };
    };

    const [preRed, preNir, preScl, postRed, postNir, postScl] = await Promise.all([
      readUtmWindow(preMeta.assets.red.href),
      readUtmWindow(preMeta.assets.nir.href),
      readUtmWindow(preMeta.assets.scl.href),
      readUtmWindow(postMeta.assets.red.href),
      readUtmWindow(postMeta.assets.nir.href),
      readUtmWindow(postMeta.assets.scl.href)
    ]);

    const w = Math.min(preRed.w, preNir.w, postRed.w, postNir.w);
    const h = Math.min(preRed.h, preNir.h, postRed.h, postNir.h);
    const preOff = Number(preMeta.properties?.['s2:processing_baseline'] || 0) >= 4 ? 1000 : 0;
    const postOff = Number(postMeta.properties?.['s2:processing_baseline'] || 0) >= 4 ? 1000 : 0;

    const scourGrid = new Float32Array(w * h);
    let clearCells = 0;
    let totalScourCells = 0;
    let severeScourCells = 0;
    let corridorScourCells = 0;
    const isClearScl = v => v === 4 || v === 5 || v === 6 || v === 7;

    let insideTotal = 0;
    for (let r = 0; r < h; r++) {
      const demR = Math.min(gridMeta.height - 1, Math.floor((r / h) * gridMeta.height));
      const preSr = Math.min(preScl.h - 1, Math.floor((r / h) * preScl.h));
      const postSr = Math.min(postScl.h - 1, Math.floor((r / h) * postScl.h));
      for (let c = 0; c < w; c++) {
        const demC = Math.min(gridMeta.width - 1, Math.floor((c / w) * gridMeta.width));
        const demIdx = demR * gridMeta.width + demC;
        if (insideMask && insideMask[demIdx] === 0) continue;
        insideTotal++;
        const preSc = Math.min(preScl.w - 1, Math.floor((c / w) * preScl.w));
        const postSc = Math.min(postScl.w - 1, Math.floor((c / w) * postScl.w));
        if (!isClearScl(preScl.data[preSr * preScl.w + preSc]) || !isClearScl(postScl.data[postSr * postScl.w + postSc])) {
          continue;
        }
        clearCells++;
        const rPre = Math.max(1, preRed.data[r * preRed.w + c] - preOff);
        const nPre = Math.max(1, preNir.data[r * preNir.w + c] - preOff);
        const rPost = Math.max(1, postRed.data[r * postRed.w + c] - postOff);
        const nPost = Math.max(1, postNir.data[r * postNir.w + c] - postOff);
        const ndviPre = (nPre - rPre) / (nPre + rPre);
        const ndviPost = (nPost - rPost) / (nPost + rPost);
        const dNdvi = ndviPost - ndviPre;

        if (ndviPre >= 0.35 && dNdvi <= -0.2) {
          scourGrid[r * w + c] = dNdvi;
          totalScourCells++;
          if (dNdvi <= -0.32) severeScourCells++;
          if (hand[demIdx] <= 4.0) corridorScourCells++;
        }
      }
    }

    const pxHa = 0.01; // 10m x 10m = 100 m2 = 0.01 ha
    const png = renderScourChangeRaster(scourGrid, w, h, 1024);
    return {
      png,
      stats: {
        source: 'Copernicus Sentinel-2 L2A (10m)',
        preDate: String(preMeta.properties?.datetime || '2022-12-24').slice(0, 10),
        postDate: String(postMeta.properties?.datetime || '2024-07-11').slice(0, 10),
        preSceneId: S2_PRE_SCENE_ID,
        postSceneId: S2_POST_SCENE_ID,
        clearCoveragePct: Number(((clearCells / Math.max(1, insideTotal)) * 100).toFixed(1)),
        totalScourHa: Number((totalScourCells * pxHa).toFixed(1)),
        severeScourHa: Number((severeScourCells * pxHa).toFixed(1)),
        corridorScourHa: Number((corridorScourCells * pxHa).toFixed(1))
      }
    };
  } catch (err) {
    console.warn(`Warning: Sentinel-2 scour fetch failed (${err.message}); keeping existing file if present.`);
    return null;
  }
}

function mercOrLonLat([x, y]) {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
    return [Number(x.toFixed(5)), Number(y.toFixed(5))];
  }
  const R = 6378137;
  return [
    Number(((x / R) * (180 / Math.PI)).toFixed(5)),
    Number(((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)).toFixed(5))
  ];
}

function clipRingToBbox(ring, b) {
  let pts = ring.slice();
  if (pts.length >= 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts = pts.slice(0, -1);
  }
  const edges = [
    { inside: p => p[0] >= b.west, intersect: (p1, p2) => [b.west, p1[1] + ((p2[1] - p1[1]) * (b.west - p1[0])) / (p2[0] - p1[0] || 1e-12)] },
    { inside: p => p[0] <= b.east, intersect: (p1, p2) => [b.east, p1[1] + ((p2[1] - p1[1]) * (b.east - p1[0])) / (p2[0] - p1[0] || 1e-12)] },
    { inside: p => p[1] >= b.south, intersect: (p1, p2) => [p1[0] + ((p2[0] - p1[0]) * (b.south - p1[1])) / (p2[1] - p1[1] || 1e-12), b.south] },
    { inside: p => p[1] <= b.north, intersect: (p1, p2) => [p1[0] + ((p2[0] - p1[0]) * (b.north - p1[1])) / (p2[1] - p1[1] || 1e-12), b.north] }
  ];
  for (const edge of edges) {
    const out = [];
    if (pts.length === 0) break;
    let prev = pts[pts.length - 1];
    for (const cur of pts) {
      const curIn = edge.inside(cur);
      const prevIn = edge.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(edge.intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(edge.intersect(prev, cur));
      }
      prev = cur;
    }
    pts = out;
  }
  if (pts.length < 3) return null;
  const rounded = pts.map(p => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]);
  rounded.push([rounded[0][0], rounded[0][1]]);
  return rounded;
}

function buildClippedPolygonCollection(feats, b, propsFn) {
  const out = [];
  for (const f of feats) {
    const rings = (f.geometry?.rings || []).map(r => clipRingToBbox(r.map(mercOrLonLat), b)).filter(Boolean);
    if (rings.length === 0) continue;
    out.push({
      type: 'Feature',
      properties: propsFn(f.attributes || {}),
      geometry: {
        type: rings.length === 1 ? 'Polygon' : 'MultiPolygon',
        coordinates: rings.length === 1 ? [rings[0]] : rings.map(r => [r])
      }
    });
  }
  return { type: 'FeatureCollection', features: out };
}

function getArcgisLayerFeatures(webmapJson, titles) {
  const wanted = new Set(Array.isArray(titles) ? titles : [titles]);
  const out = [];
  for (const l of webmapJson?.operationalLayers || []) {
    if (!wanted.has(l.title)) continue;
    for (const sub of l.featureCollection?.layers || []) {
      for (const feat of sub.featureSet?.features || []) {
        out.push({ ...feat, _layerTitle: l.title });
      }
    }
  }
  return out;
}

async function fetchGoogleOpenBuildings(bbox) {
  const rawDir = path.join(ROOT, 'raw-data');
  const cachePath = path.join(rawDir, 'open-buildings-balingka.geojson');
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Array.isArray(cached?.features)) {
        console.log(`Loaded ${cached.features.length} cached Google Open Buildings features from raw-data/`);
        return cached.features;
      }
    } catch {}
  }

  try {
    console.log('Streaming Google Open Buildings v3 tile (2fd, CC-BY-4.0) for Balingka...');
    const res = await fetch(OPEN_BUILDINGS_2FD_URL, {
      headers: { 'User-Agent': 'nagari-balingka-gis/1.0' },
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const gunzip = zlib.createGunzip();
    const rl = readline.createInterface({
      input: Readable.fromWeb(res.body).pipe(gunzip),
      crlfDelay: Infinity
    });

    const features = [];
    let isHeader = true;
    for await (const line of rl) {
      if (isHeader) {
        isHeader = false;
        continue;
      }
      // Format: latitude,longitude,area_in_meters,confidence,"POLYGON((...))",full_plus_code
      const firstQ = line.indexOf('"POLYGON((');
      if (firstQ === -1) continue;
      const prefix = line.slice(0, firstQ - 1).split(',');
      if (prefix.length < 4) continue;
      const lat = Number(prefix[0]);
      const lng = Number(prefix[1]);
      if (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east) continue;

      const areaM2 = Number(prefix[2]);
      const confidence = Number(prefix[3]);
      if (!Number.isFinite(confidence) || confidence < 0.75) continue;
      if (!Number.isFinite(areaM2) || areaM2 < 8 || areaM2 > 15000) continue;

      const endWkt = line.indexOf('))"', firstQ);
      if (endWkt === -1) continue;
      const coordText = line.slice(firstQ + '"POLYGON(('.length, endWkt);
      const ring = [];
      for (const pair of coordText.split(',')) {
        const parts = pair.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const px = Number(parts[0]);
        const py = Number(parts[1]);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          ring.push([Number(px.toFixed(6)), Number(py.toFixed(6))]);
        }
      }
      if (ring.length < 3) continue;
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        ring.push([ring[0][0], ring[0][1]]);
      }

      features.push({
        type: 'Feature',
        properties: {
          kind: 'building',
          source: 'google_open_buildings',
          confidence: Number(confidence.toFixed(2)),
          area_m2: Math.round(areaM2)
        },
        geometry: { type: 'Polygon', coordinates: [ring] }
      });
    }

    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ type: 'FeatureCollection', features }));
    console.log(`Extracted ${features.length} Google Open Buildings v3 footprints (conf >= 0.75) into raw-data/`);
    return features;
  } catch (err) {
    console.warn(`Warning: Google Open Buildings v3 stream failed (${err.message}); keeping OSM buildings only.`);
    return [];
  }
}

function mergeBuildingsWithDedupe(osmBuildings, googleBuildings) {
  const cellDeg = 0.0002; // ~22 m spatial hash cell
  const grid = new Map();
  const osmBoxes = [];

  for (const f of osmBuildings) {
    const ring = f.geometry?.coordinates?.[0];
    if (!ring || ring.length < 3) continue;
    let sx = 0;
    let sy = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const len = ring.length > 1 ? ring.length - 1 : ring.length;
    for (let i = 0; i < len; i++) {
      const [x, y] = ring[i];
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const cx = sx / len;
    const cy = sy / len;
    const pad = 0.00007; // ~8 m margin
    const idx = osmBoxes.length;
    osmBoxes.push({ cx, cy, minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad });
    const gx = Math.floor(cx / cellDeg);
    const gy = Math.floor(cy / cellDeg);
    const key = `${gx},${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(idx);
  }

  const added = [];
  for (const gf of googleBuildings) {
    const ring = gf.geometry?.coordinates?.[0];
    if (!ring || ring.length < 3) continue;
    let sx = 0;
    let sy = 0;
    const len = ring.length > 1 ? ring.length - 1 : ring.length;
    for (let i = 0; i < len; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    const cx = sx / len;
    const cy = sy / len;
    const gx = Math.floor(cx / cellDeg);
    const gy = Math.floor(cy / cellDeg);
    let duplicate = false;
    for (let dx = -1; dx <= 1 && !duplicate; dx++) {
      for (let dy = -1; dy <= 1 && !duplicate; dy++) {
        const list = grid.get(`${gx + dx},${gy + dy}`);
        if (!list) continue;
        for (const idx of list) {
          const b = osmBoxes[idx];
          if (cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY) {
            duplicate = true;
            break;
          }
          if (haversineMeters(cx, cy, b.cx, b.cy) < 9) {
            duplicate = true;
            break;
          }
        }
      }
    }
    if (!duplicate) added.push(gf);
  }

  return {
    mergedBuildings: [
      ...osmBuildings.map(f => ({
        ...f,
        properties: { source: 'osm', ...f.properties }
      })),
      ...added
    ],
    googleAddedCount: added.length
  };
}

async function fetchAgamOfficialGis(bbox) {
  const rawDir = path.join(ROOT, 'raw-data');
  const cachePath = path.join(rawDir, 'agam-gis-cache.json');
  const rbiOut = path.join(OUT_DIR, 'agam-rbi-rivers.geojson');
  const ctxOut = path.join(OUT_DIR, 'agam-context.json');

  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached?.rbiRivers?.features && cached?.agamContext?.landslideHazard) {
        console.log('Loaded cached Pemkab Agam official GIS layers from raw-data/agam-gis-cache.json');
        return cached;
      }
    } catch {}
  }

  try {
    console.log('Fetching official Pemkab Agam GIS Web Maps (rivers, landslide, soil, geology, forest)...');
    const fetchJson = url =>
      fetch(url, { headers: { 'User-Agent': 'nagari-balingka-gis/1.0' }, signal: AbortSignal.timeout(15000) }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        return r.json();
      });

    const [riversWm, hazardWm, soilWm, geologyWm, forestWm] = await Promise.all([
      fetchJson(AGAM_WEBMAP_URLS.rivers),
      fetchJson(AGAM_WEBMAP_URLS.hazard),
      fetchJson(AGAM_WEBMAP_URLS.soil),
      fetchJson(AGAM_WEBMAP_URLS.geology),
      fetchJson(AGAM_WEBMAP_URLS.forest)
    ]);

    const padBbox = {
      west: bbox.west - 0.002,
      south: bbox.south - 0.002,
      east: bbox.east + 0.002,
      north: bbox.north + 0.002
    };
    const inPad = ([lng, lat]) =>
      lng >= padBbox.west && lng <= padBbox.east && lat >= padBbox.south && lat <= padBbox.north;

    const rbiFeatures = [];
    for (const feat of getArcgisLayerFeatures(riversWm, ['Sungai Kecil', 'Sungai Utama'])) {
      const paths = feat.geometry?.paths || [];
      for (let pi = 0; pi < paths.length; pi++) {
        const wgs = paths[pi].map(mercOrLonLat);
        if (wgs.length < 2 || !wgs.some(inPad)) continue;
        const fid = feat.attributes?.FID ?? rbiFeatures.length + 1;
        const rawName = String(feat.attributes?.NAMOBJ || feat.attributes?.NAME || '').trim();
        rbiFeatures.push({
          type: 'Feature',
          properties: {
            id: `rbi-${fid}${paths.length > 1 ? `-${pi + 1}` : ''}`,
            name: rawName || `Anak Sungai RBI #${fid}`,
            kind: feat._layerTitle === 'Sungai Utama' ? 'river' : 'stream',
            das: 'MASANG KIRI',
            source: 'Pemkab Agam — Peta RBI 1:50.000'
          },
          geometry: { type: 'LineString', coordinates: wgs }
        });
      }
    }

    const rbiRivers = { type: 'FeatureCollection', features: rbiFeatures };
    const agamContext = {
      source: 'Pemkab Agam Open GIS (ArcGIS Web Maps — BPBD/BBSDLP/KLHK/BMKG/PSG)',
      bbox,
      landslideHazard: buildClippedPolygonCollection(
        getArcgisLayerFeatures(hazardWm, 'Rawan Gerakan Tanah'),
        bbox,
        a => ({ level: String(a.Ket || 'Rendah'), source: 'Pemkab Agam (Rawan Gerakan Tanah)' })
      ),
      forestStatus: buildClippedPolygonCollection(
        getArcgisLayerFeatures(forestWm, 'sk_35_menhut_2013'),
        bbox,
        a => ({
          fungsi: String(a.Fungsi || 'APL'),
          sk: String(a.SK_Kawasan || '35/Menhut-II/2013'),
          label: String(a.Deskrip || a.Fungsi || 'Area Penggunaan Lain')
        })
      ),
      soil: buildClippedPolygonCollection(
        getArcgisLayerFeatures(soilWm, 'Jenis Tanah'),
        bbox,
        a => ({
          soilType: String(a.JENIS_TANA || 'Andosol'),
          sensitivity: String(a.Peka || ''),
          depthClass: String(a.Kls_Kdlm || ''),
          depthCm: String(a.Kdlmn || '')
        })
      ),
      geology: buildClippedPolygonCollection(
        getArcgisLayerFeatures(geologyWm, 'Geologi'),
        bbox,
        a => ({
          formation: String(a.Formasi || ''),
          symbol: String(a.Simbol || ''),
          source: String(a.Sumber || 'PSG')
        })
      ),
      morphology: buildClippedPolygonCollection(
        getArcgisLayerFeatures(geologyWm, 'Morfologi'),
        bbox,
        a => ({
          landform: String(a.BENTUKLAHA || ''),
          description: String(a.TYPE_LAHAN || '')
        })
      ),
      rainfallZone: buildClippedPolygonCollection(
        getArcgisLayerFeatures(hazardWm, 'Curah Hujan'),
        bbox,
        a => ({
          annualMm: String(a.Crh_Hjn || ''),
          rainyDays: Number(a.Hr_HJN || 0),
          source: 'BMKG via Pemkab Agam'
        })
      )
    };

    const result = { rbiRivers, agamContext };
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result));
    return result;
  } catch (err) {
    console.warn(`Warning: Pemkab Agam GIS fetch failed (${err.message}); checking existing files.`);
    if (fs.existsSync(rbiOut) && fs.existsSync(ctxOut)) {
      return {
        rbiRivers: JSON.parse(fs.readFileSync(rbiOut, 'utf8')),
        agamContext: JSON.parse(fs.readFileSync(ctxOut, 'utf8'))
      };
    }
    return null;
  }
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
  for (const geoPath of [
    path.join(OUT_DIR, 'verified-waterways.geojson'),
    path.join(ROOT, 'raw-data', 'verified-waterways.geojson')
  ]) {
    if (fs.existsSync(geoPath)) {
      const fc = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
      let suppressedIds = new Set();
      const supPath = path.join(path.dirname(geoPath), 'suppressed-dem.json');
      if (fs.existsSync(supPath)) {
        const arr = JSON.parse(fs.readFileSync(supPath, 'utf8'));
        if (Array.isArray(arr)) suppressedIds = new Set(arr.map(s => s.seg_id).filter(Boolean));
      }
      return {
        source: 'geojson',
        features: (fc.features || []).filter(f => f?.geometry?.type === 'LineString'),
        suppressedIds
      };
    }
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

  const nagariBoundary = await fetchNagariBoundary();
  const nagariMask = nagariBoundary ? buildPolygonMaskGrid(nagariBoundary, gridMeta) : null;
  const inNagariPt = pt => !nagariBoundary || isPointInFeatureCollection(pt, nagariBoundary);
  const lineTouchesNagari = coords => !nagariBoundary || coords.some(c => isPointInFeatureCollection(c, nagariBoundary));
  const polygonCentroid = feat => {
    const g = feat?.geometry;
    const ring = g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : g?.coordinates?.[0];
    if (!ring?.length) return null;
    const n = ring.length > 1 ? ring.length - 1 : ring.length;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    return [sx / n, sy / n];
  };

  let minElev = Infinity, maxElev = -Infinity;
  for (let i = 0; i < elev.length; i++) {
    if (nagariMask && nagariMask[i] === 0) continue;
    if (elev[i] < minElev) minElev = elev[i];
    if (elev[i] > maxElev) maxElev = elev[i];
  }

  const verified = loadVerifiedWaterwaysForBurning();
  let hydroElev = elev;
  let hydroConditioned = false;
  if (verified.features.length > 0) {
    const burned = burnStreamsIntoDem(elev, verified.features, gridMeta, 3.5);
    hydroElev = burned.elev;
    hydroConditioned = burned.burnedCellCount > 0;
    console.log(`Stream-burning (${verified.source}): carved ${verified.features.length} verified waterways (${burned.burnedCellCount} cells).`);
  }

  const areaScale = (30.9 * 30.9) / Math.max(1, cellSizeX * cellSizeY);
  const handStreamThreshold = Math.max(10, Math.round(75 * areaScale));
  const filled = priorityFloodFill(hydroElev, width, height);
  const { dir, acc } = computeD8(filled, width, height, cellSizeX, cellSizeY);
  const slope = computeSlopePercent(elev, width, height, cellSizeX, cellSizeY);
  const hand = computeHAND(elev, dir, acc, width, height, handStreamThreshold);

  const rawFlowPaths = extractFlowPathsGeoJSON(elev, dir, acc, gridMeta, {
    main: Math.max(40, Math.round(240 * areaScale)),
    normal: Math.max(15, Math.round(75 * areaScale)),
    detail: Math.max(8, Math.round(25 * areaScale))
  });
  const deduped = filterOverlappingFlowPaths(rawFlowPaths, verified.features, 48, 0.55);
  const flowPaths = {
    type: 'FeatureCollection',
    features: deduped.features.filter(f => f.geometry.type === 'LineString' && lineTouchesNagari(f.geometry.coordinates))
  };
  const contours = extractContoursGeoJSON(elev, gridMeta, 25);

  const bigRbiPath = path.join(ROOT, 'raw-data', 'big-rbi-2022.json');
  let bigRbi = null;
  if (fs.existsSync(bigRbiPath)) {
    try {
      bigRbi = JSON.parse(fs.readFileSync(bigRbiPath, 'utf8'));
      console.log(`Loaded official BIG RBI 50K (Dec 2022): ${bigRbi.rivers?.length || 0} rivers, ${bigRbi.culverts?.length || 0} culverts, ${bigRbi.bridges?.length || 0} bridges.`);
    } catch {}
  }

  const useRegional = Boolean(REGION_CFG.regionalOverlays?.enabled);
  const useSentinel = Boolean(REGION_CFG.regionalOverlays?.sentinelChangeAvailable);
  const [osm, landCover, scourChange, googleBuildings, agamGis] = await Promise.all([
    fetchRealOSM(bbox),
    fetchLandCover(bbox, width, height, nagariMask),
    useSentinel ? fetchSentinel2ScourChange(bbox, hand, gridMeta, nagariMask) : Promise.resolve(null),
    useRegional ? fetchGoogleOpenBuildings(bbox) : Promise.resolve(null),
    useRegional ? fetchAgamOfficialGis(bbox) : Promise.resolve(null)
  ]);
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

  const bigCrossings = [];
  if (bigRbi) {
    const pushBigPoint = (prefix, idx, pt, labelId, labelEn, descId, descEn) => {
      const c = pt?.coords;
      if (!Array.isArray(c) || c.length < 2 || !inNagariPt(c)) return;
      if (bigCrossings.some(x => haversineMeters(c[0], c[1], x.coords[0], x.coords[1]) <= 22)) return;
      bigCrossings.push({
        id: `${prefix}${idx + 1}`,
        coords: c,
        kind: 'drainage',
        status: 'unverified',
        name_id: labelId,
        name_en: labelEn,
        desc_id: descId,
        desc_en: descEn
      });
    };
    (bigRbi.weirs || []).forEach((w, i) =>
      pushBigPoint(
        'big-weir-',
        i,
        w,
        w.name || `Bendung / Pintu Air RBI #${i + 1}`,
        w.name || `RBI Weir / Sluice Gate #${i + 1}`,
        'Bendung / pintu air resmi BIG RBI 50K (Des 2022) — cek kondisi operasional di lapangan.',
        'Official BIG RBI 50K (Dec 2022) weir / sluice gate — inspect condition in the field.'
      )
    );
    (bigRbi.bridges || []).forEach((b, i) =>
      pushBigPoint(
        'big-br-',
        i,
        b,
        b.name || `Jembatan RBI #${i + 1}`,
        b.name || `RBI Bridge #${i + 1}`,
        'Lokasi jembatan resmi BIG RBI 50K (Des 2022) — cek bentang & bebas sumbatan.',
        'Official BIG RBI 50K (Dec 2022) bridge location — inspect span and debris clearance.'
      )
    );
    (bigRbi.culverts || []).forEach((c, i) =>
      pushBigPoint(
        'big-culv-',
        i,
        c,
        c.name || `Gorong-gorong RBI #${i + 1}`,
        c.name || `RBI Culvert #${i + 1}`,
        'Titik gorong-gorong resmi BIG RBI 50K (Des 2022) — periksa apakah tersumbat/mencukupi.',
        'Official BIG RBI 50K (Dec 2022) culvert point — verify capacity and clogging status.'
      )
    );
  }

  const HIGHWAY_ID = {
    trunk: 'jalan nasional',
    primary: 'jalan utama',
    secondary: 'jalan kolektor',
    tertiary: 'jalan penghubung',
    residential: 'jalan permukiman',
    unclassified: 'jalan nagari',
    service: 'jalan akses',
    track: 'jalan tanah/kebun',
    path: 'jalan setapak',
    footway: 'jalan setapak'
  };
  const formatHighwayId = hw => HIGHWAY_ID[String(hw || '').toLowerCase()] || 'jalan';

  const bottlenecks = [
    ...bigCrossings,
    ...crossings
      .filter(
        c =>
          inNagariPt(c.coords) &&
          !bigCrossings.some(bc => haversineMeters(c.coords[0], c.coords[1], bc.coords[0], bc.coords[1]) <= 55)
      )
      .map((c, idx) => ({
        id: `cross-${idx + 1}`,
        coords: c.coords,
        kind: 'drainage',
        status: 'unverified',
        name_id: c.roadName ? `Perlintasan ${c.roadName}` : `Persilangan Jalan–Alur #${idx + 1}`,
        name_en: c.roadName ? `Crossing at ${c.roadName}` : `Road–Stream Crossing #${idx + 1}`,
        desc_id: `Titik silang ${formatHighwayId(c.highway)} & alur perkiraan DEM (belum dicek lapangan).`,
        desc_en: `DEM road (${c.highway}) & computed channel crossing (unverified in the field).`
      })),
    ...osm.bridgeFeatures
      .filter(
        b =>
          inNagariPt(b.geometry.coordinates) &&
          !bigCrossings.some(bc => haversineMeters(b.geometry.coordinates[0], b.geometry.coordinates[1], bc.coords[0], bc.coords[1]) <= 35)
      )
      .map((b, idx) => ({
        id: `br-${idx + 1}`,
        coords: b.geometry.coordinates,
        kind: 'drainage',
        status: 'unverified',
        name_id: b.properties.name,
        name_en: b.properties.name.replace(/^Jembatan/, 'Bridge'),
        desc_id: `Jembatan ${formatHighwayId(b.properties.highway)} dari OpenStreetMap — belum dicek lapangan.`,
        desc_en: `OpenStreetMap bridge (${b.properties.highway}) — unverified in the field.`
      }))
  ];

  // Render smooth anti-aliased CutSheetRX-style Terrain & HAND PNG overlays
  console.log('Rendering smooth 1024x1024 CutSheetRX terrain rasters & HAND flood overlays...');
  const terrainRasters = renderSmoothTerrainRasters(elev, slope, gridMeta, 1024);
  const handRasters = renderSmoothHandFloodRasters(hand, slope, bottlenecks, gridMeta, 768, nagariMask);

  fs.writeFileSync(path.join(OUT_DIR, 'raster-relief.png'), terrainRasters.reliefPng);
  fs.writeFileSync(path.join(OUT_DIR, 'raster-elev.png'), terrainRasters.elevPng);
  fs.writeFileSync(path.join(OUT_DIR, 'raster-slope.png'), terrainRasters.slopePng);
  for (const [k, buf] of Object.entries(handRasters.pngs)) {
    fs.writeFileSync(path.join(OUT_DIR, `raster-hand-${k}.png`), buf);
  }

  // Pick top 3 steepest grid clusters (>38%) inside Nagari Balingka as pure DEM slope geometry points
  const landslideSeeds = [];
  const stepScan = Math.max(16, Math.round(16 * Math.sqrt(areaScale)));
  for (let r = 12; r < height - 12 && landslideSeeds.length < 3; r += stepScan) {
    for (let c = 12; c < width - 12 && landslideSeeds.length < 3; c += stepScan) {
      if (nagariMask && nagariMask[r * width + c] === 0) continue;
      const sl = slope[r * width + c];
      if (sl >= 38) {
        const lng = bbox.west + ((c + 0.5) / width) * (bbox.east - bbox.west);
        const lat = bbox.north - ((r + 0.5) / height) * (bbox.north - bbox.south);
        landslideSeeds.push({
          type: 'Feature',
          properties: {
            id: `ls-${landslideSeeds.length + 1}`,
            kind: 'landslide',
            status: 'normal',
            verified: false,
            name_id: `Titik Kemiringan Terjal #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            name_en: `Steep Slope Point #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            desc_id: `Kemiringan lereng ~${Math.round(sl)}% dihitung dari elevasi BIG DEMNAS 8m (data geometri topografi).`,
            desc_en: `~${Math.round(sl)}% terrain slope computed from BIG DEMNAS 8m elevation (pure geometry measurement).`
          },
          geometry: { type: 'Point', coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] }
        });
      }
    }
  }

  let agamGrids = null;
  if (agamGis?.agamContext) {
    agamGrids = rasterizeAgamGrids(agamGis.agamContext, gridMeta, nagariMask);
  }

  const evacFeatures = [];
  const bigFacilities = (bigRbi?.facilities || []).slice();
  const catOrder = { health: 0, gov: 1, school: 2, worship: 3 };
  bigFacilities.sort((a, b) => (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9));
  for (const bf of bigFacilities) {
    if (evacFeatures.length >= 8) break;
    const [lng, lat] = bf.coords || [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inNagariPt([lng, lat])) continue;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const hVal = hand[row * width + col];
    const lsOfficial = agamGrids?.officialLandslide?.[row * width + col] ?? 0;
    if (hVal < 5 || lsOfficial >= 3) continue;
    if (evacFeatures.some(e => haversineMeters(lng, lat, e.geometry.coordinates[0], e.geometry.coordinates[1]) < 180)) {
      continue;
    }
    const label = bf.name || bf.remark || 'Fasilitas Publik RBI';
    evacFeatures.push({
      type: 'Feature',
      properties: {
        id: `ev-big-${evacFeatures.length + 1}`,
        kind: 'evacuation',
        status: 'normal',
        verified: false,
        name_id: `Fasilitas Umum (BIG RBI): ${label}`,
        name_en: `Public Facility (BIG RBI): ${label}`,
        desc_id: `Fasilitas publik resmi BIG RBI 50K (~${Math.round(hVal)}m di atas alur terdekat menurut HAND). Informasi data elevasi — bukan penetapan titik evakuasi resmi.`,
        desc_en: `Official BIG RBI 50K public facility (~${Math.round(hVal)}m above nearest channel via HAND). Elevation reference only — not an official evacuation designation.`
      },
      geometry: { type: 'Point', coordinates: [lng, lat] }
    });
  }
  for (const fac of osm.facilityFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = fac.geometry.coordinates;
    if (!inNagariPt([lng, lat])) continue;
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
          name_id: `Fasilitas Umum (OSM): ${fac.properties.name}`,
          name_en: `Public Facility (OSM): ${fac.properties.name}`,
          desc_id: `Fasilitas publik OSM berada ~${Math.round(hVal)}m di atas dasar alur terdekat menurut HAND. Informasi data elevasi — bukan penetapan titik evakuasi resmi.`,
          desc_en: `OSM public facility situated ~${Math.round(hVal)}m above nearest channel via HAND. Elevation reference only — not an official evacuation designation.`
        },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }
  }
  for (const pl of osm.placeFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = pl.geometry.coordinates;
    if (!inNagariPt([lng, lat])) continue;
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
          name_id: `Titik Elevasi Tinggi (OSM): ${pl.properties.name}`,
          name_en: `Elevated Point (OSM): ${pl.properties.name}`,
          desc_id: `Lokasi lahan tinggi (~${Math.round(hVal)}m di atas alur terdekat menurut HAND) di sekitar ${pl.properties.name}. Informasi data elevasi — bukan penetapan titik evakuasi resmi.`,
          desc_en: `Elevated ground (~${Math.round(hVal)}m above nearest channel via HAND) near ${pl.properties.name}. Elevation reference only — not an official evacuation designation.`
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

  // Inverted studio mask polygon covering the globe with inner cutout matching official Nagari Balingka boundary
  const ensureRingWinding = (ring, wantCcw) => {
    let area2 = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    const isCcw = area2 > 0;
    return isCcw === wantCcw ? ring : [...ring].reverse();
  };
  const maskHoles = [];
  for (const feat of nagariBoundary?.features || []) {
    const geom = feat?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && geom.coordinates?.[0]?.length >= 4) {
      maskHoles.push(ensureRingWinding(geom.coordinates[0], true));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates || []) {
        if (poly?.[0]?.length >= 4) maskHoles.push(ensureRingWinding(poly[0], true));
      }
    }
  }
  const maskGeoJSON = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'Studio Mask Outside Official Nagari Balingka' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[-180, 85], [180, 85], [180, -85], [-180, -85], [-180, 85]],
          ...(maskHoles.length > 0
            ? maskHoles
            : [[[bbox.west, bbox.north], [bbox.west, bbox.south], [bbox.east, bbox.south], [bbox.east, bbox.north], [bbox.west, bbox.north]]])
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

  const osmBuildingsInside = osm.buildingFeatures.filter(f => {
    const c = polygonCentroid(f);
    return c && inNagariPt(c);
  });
  const googleBuildingsInside = googleBuildings.filter(f => {
    const c = polygonCentroid(f);
    return c && inNagariPt(c);
  });
  const residentialInside = osm.residentialFeatures.filter(f => {
    const c = polygonCentroid(f);
    return c && inNagariPt(c);
  });
  const { mergedBuildings, googleAddedCount } = mergeBuildingsWithDedupe(osmBuildingsInside, googleBuildingsInside);
  const settlements = {
    type: 'FeatureCollection',
    features: [...residentialInside, ...mergedBuildings]
  };
  const settlementStats = {
    osmBuildings: osmBuildingsInside.length,
    googleOpenBuildingsAdded: googleAddedCount,
    totalBuildings: mergedBuildings.length,
    residentialZones: residentialInside.length,
    openBuildingsConfidenceMin: 0.75
  };

  const officialAreaKm2 = nagariBoundary ? computeFeatureCollectionAreaKm2(nagariBoundary) : Number(((totalWidthM * totalHeightM) / 1e6).toFixed(2));
  const totalStreamKm = flowPaths.features.reduce((s, f) => s + f.properties.length_m, 0) / 1000;
  const center = Array.isArray(REGION_CFG.dataCenter)
    ? REGION_CFG.dataCenter
    : [Number(((bbox.west + bbox.east) / 2).toFixed(5)), Number(((bbox.south + bbox.north) / 2).toFixed(5))];

  const writeJson = (name, obj) => fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj));

  if (landCover) {
    fs.writeFileSync(path.join(OUT_DIR, 'raster-landcover.png'), landCover.lcPng);
    writeJson('landcover-grid.json', landCover.lcGridJson);
  }
  let lcClasses = landCover?.dsClasses || null;
  if (!lcClasses) {
    const lcGridPath = path.join(OUT_DIR, 'landcover-grid.json');
    if (fs.existsSync(lcGridPath)) {
      try {
        const lcJson = JSON.parse(fs.readFileSync(lcGridPath, 'utf8'));
        if (lcJson?.classesBase64) {
          const buf = Buffer.from(lcJson.classesBase64, 'base64');
          if (buf.length === width * height) lcClasses = new Uint8Array(buf);
        }
      } catch {}
    }
  }

  const rawRbiList = bigRbi?.rivers?.length > 0 ? bigRbi.rivers : agamGis?.rbiRivers?.features || [];
  const filteredRbi = rawRbiList.filter(f => f?.geometry?.type === 'LineString' && lineTouchesNagari(f.geometry.coordinates));
  const rbiCollection = filteredRbi.length > 0 ? { type: 'FeatureCollection', features: filteredRbi } : null;
  if (rbiCollection) {
    writeJson('agam-rbi-rivers.geojson', rbiCollection);
  }
  if (agamGis?.agamContext && agamGrids) {
    writeJson('agam-context.json', agamGis.agamContext);
    writeJson('agam-grids.json', {
      width,
      height,
      summary: agamGrids.summary,
      soilErodibilityBase64: Buffer.from(agamGrids.soilErodibility.buffer).toString('base64'),
      officialLandslideBase64: Buffer.from(agamGrids.officialLandslide.buffer).toString('base64')
    });
  }

  const simFields = computeCascadeFields({
    rawElev: elev,
    filled,
    dir,
    acc,
    slope,
    hand,
    landCoverClasses: lcClasses,
    soilErodibility: agamGrids?.soilErodibility || null,
    officialLandslide: agamGrids?.officialLandslide || null,
    nagariMask,
    agamSummary: agamGrids?.summary || null,
    bottlenecks,
    gridMeta
  });
  writeJson('sim-fields.json', simFields);
  if (scourChange) {
    fs.writeFileSync(path.join(OUT_DIR, 'raster-scour-change.png'), scourChange.png);
  }
  const nagariPath = path.join(OUT_DIR, 'nagari-boundary.geojson');
  if (nagariBoundary) {
    writeJson('nagari-boundary.geojson', nagariBoundary);
  } else if (!fs.existsSync(nagariPath)) {
    writeJson('nagari-boundary.geojson', { type: 'FeatureCollection', features: [] });
  }

  let existingMeta = {};
  const metaPath = path.join(OUT_DIR, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    try { existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
  }
  const landCoverStats = landCover?.stats || existingMeta.landCoverStats;
  const scourStats = scourChange?.stats || existingMeta.scourStats;
  const hasNagariBoundary = Boolean(nagariBoundary) || fs.existsSync(nagariPath);
  const agamStats = agamGis
    ? {
        source: agamGis.agamContext.source,
        rbiRiversCount: rbiCollection?.features?.length || agamGis.rbiRivers.features.length,
        ...(agamGrids?.summary || {})
      }
    : existingMeta.agamStats;

  const nagariSrcLabel =
    nagariBoundary?.features?.[0]?.properties?.source ||
    'Pemkab Agam — Batas Administrasi Nagari (Kemendagri 13.06.05.2003)';

  const metadata = {
    generatedAt: new Date().toISOString(),
    center,
    bbox,
    demSource: sourceLabel,
    gridDimensions: `${width}x${height}`,
    resolutionMeters: Number(((cellSizeX + cellSizeY) / 2).toFixed(1)),
    minElevM: Math.round(minElev),
    maxElevM: Math.round(maxElev),
    studyAreaKm2: officialAreaKm2,
    streamNetworkKm: Number(totalStreamKm.toFixed(1)),
    osmPlaceCount: osm.placeFeatures.length,
    osmWaterwayCount: osm.waterwayFeatures.length,
    osmRoadCount: osm.roadFeatures.length,
    buildingCount: mergedBuildings.length,
    residentialZoneCount: residentialInside.length,
    crossingsDetected: crossings.filter(c => inNagariPt(c.coords)).length,
    bridgesDetected: osm.bridgeFeatures.filter(b => inNagariPt(b.geometry.coordinates)).length,
    simAreasHa: handRasters.simAreasHa,
    verifiedWaterwayCount: verified.features.length,
    hydroConditioned,
    settlementStats,
    ...(agamStats ? { agamStats } : {}),
    ...(landCoverStats ? { landCoverStats } : {}),
    ...(scourStats ? { scourStats } : {}),
    ...(hasNagariBoundary ? { nagariBoundarySource: nagariSrcLabel } : {}),
    licenses: [
      { name: 'MapLibre GL JS', license: 'BSD-3-Clause' },
      { name: 'BIG DEMNAS (8.3m) & RBI 50K Kab. Agam (Des 2022)', license: 'Public Government Data (Badan Informasi Geospasial)' },
      { name: 'BIG Batas Wilayah Desa/Nagari (Juni 2026)', license: 'Public Government Data (13.06.05.2003)' },
      { name: 'Copernicus Sentinel-2 L2A (10m)', license: 'Copernicus Open License (ESA)' },
      { name: 'ESA WorldCover 10m v200', license: 'CC-BY-4.0 (ESA / Copernicus)' },
      { name: 'Google Open Buildings v3', license: 'CC-BY-4.0 (Google Research / Cloud Open Data)' },
      { name: 'Pemkab Agam Open GIS (Tanah, Geologi, SK 35, Gerakan Tanah)', license: 'Public Government Data (ptsp.agam ArcGIS)' },
      { name: 'Esri World Imagery', license: 'Free w/ Attribution (No API Key)' },
      { name: 'OpenStreetMap & OpenTopoMap', license: 'ODbL / CC-BY-SA' }
    ]
  };

  writeJson('metadata.json', metadata);
  writeJson('dem-grid.json', demGridJson);
  writeJson('watershed.geojson', watershedGeoJSON);
  writeJson('mask.geojson', maskGeoJSON);
  writeJson('contours.geojson', contours);
  writeJson('flow-paths.geojson', flowPaths);
  writeJson('osm-context.geojson', osmContext);
  writeJson('settlements.geojson', settlements);
  writeJson('drainage-draft.geojson', drainageDraft);

  console.log('Generated Balingka-only crisp studio assets in public/data/:');
  console.log(`  Block: ${metadata.studyAreaKm2} km2 (${metadata.gridDimensions}, ${metadata.minElevM}..${metadata.maxElevM}m)`);
  console.log(`  Smooth streams: ${flowPaths.features.length} reaches (${metadata.streamNetworkKm} km, snapped=${deduped.snappedCount})`);
  console.log(`  Smooth contours: ${contours.features.length} polylines`);
  console.log(`  OSM places: ${osm.placeFeatures.length}, roads: ${osm.roadFeatures.length}, buildings: ${osm.buildingFeatures.length}, residential zones: ${osm.residentialFeatures.length}, crossings: ${crossings.length}`);
  if (landCoverStats) console.log('  ESA WorldCover 10m (%):', JSON.stringify(landCoverStats));
  console.log(`  HAND areas (ha):`, JSON.stringify(metadata.simAreasHa));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
