import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { fromUrl } from 'geotiff';
import {
  renderLandCoverRaster,
  renderScourChangeRaster,
  haversineMeters
} from './hydrology.mjs';
import { isInsideOpenBuildings2fd } from './tiles.mjs';

export const AGAM_ADMIN_WEBMAP_URL =
  'https://www.arcgis.com/sharing/rest/content/items/c6d9b777f1a84f4283d970881a371536/data?f=json';
export const OPEN_BUILDINGS_2FD_URL =
  'https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/2fd_buildings.csv.gz';
export const AGAM_WEBMAP_URLS = {
  rivers: 'https://www.arcgis.com/sharing/rest/content/items/1bae109aa7e047308acb6e156e023d85/data?f=json',
  hazard: 'https://www.arcgis.com/sharing/rest/content/items/7f8dabc1aae2420ba471aeee52f1e241/data?f=json',
  soil: 'https://www.arcgis.com/sharing/rest/content/items/aa3c0d93c94c4743b0735949e633c654/data?f=json',
  geology: 'https://www.arcgis.com/sharing/rest/content/items/d1c327c5cfb24b13ad0fdc7de509013f/data?f=json',
  forest: 'https://www.arcgis.com/sharing/rest/content/items/fcc8e0ec50ba4e428a6fd0bc0cd2eda3/data?f=json'
};
export const S2_PRE_SCENE_ID = 'S2A_47MPV_20221224_0_L2A';
export const S2_POST_SCENE_ID = 'S2B_47MPV_20240711_0_L2A';

export async function fetchRealOSM(bbox, regionName) {
  console.log(`Fetching real OpenStreetMap features for ${regionName} block...`);
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

export async function fetchLandCover(bbox, demWidth, demHeight, worldcoverTiles, regionName, insideMask = null) {
  try {
    console.log(`Fetching ESA WorldCover 10m v200 COG (${worldcoverTiles.length} tile(s)) for ${regionName} block...`);
    let raw;
    let winW;
    let winH;

    if (worldcoverTiles.length === 1) {
      const tiff = await fromUrl(worldcoverTiles[0].url);
      const image = await tiff.getImage();
      const imgW = image.getWidth();
      const imgH = image.getHeight();
      const [minX, minY, maxX, maxY] = image.getBoundingBox();

      const c0 = Math.max(0, Math.floor(((bbox.west - minX) / (maxX - minX)) * imgW));
      const c1 = Math.min(imgW, Math.ceil(((bbox.east - minX) / (maxX - minX)) * imgW));
      const r0 = Math.max(0, Math.floor(((maxY - bbox.north) / (maxY - minY)) * imgH));
      const r1 = Math.min(imgH, Math.ceil(((maxY - bbox.south) / (maxY - minY)) * imgH));

      winW = Math.max(10, c1 - c0);
      winH = Math.max(10, r1 - r0);
      [raw] = await image.readRasters({ window: [c0, r0, c0 + winW, r0 + winH] });
    } else {
      const targetMax = 1024;
      const degW = Math.max(1e-6, bbox.east - bbox.west);
      const degH = Math.max(1e-6, bbox.north - bbox.south);
      const estW = Math.round(degW * 12000);
      const estH = Math.round(degH * 12000);
      const scale = Math.max(1, estW / targetMax, estH / targetMax);
      winW = Math.max(20, Math.round(estW / scale));
      winH = Math.max(20, Math.round(estH / scale));
      raw = new Uint8Array(winW * winH);

      for (const tile of worldcoverTiles) {
        const tiff = await fromUrl(tile.url);
        const image = await tiff.getImage();
        const imgW = image.getWidth();
        const imgH = image.getHeight();
        const [minX, minY, maxX, maxY] = image.getBoundingBox();

        const ix0 = Math.max(bbox.west, minX);
        const ix1 = Math.min(bbox.east, maxX);
        const iy0 = Math.max(bbox.south, minY);
        const iy1 = Math.min(bbox.north, maxY);
        if (ix1 <= ix0 || iy1 <= iy0) continue;

        const c0 = Math.max(0, Math.floor(((ix0 - minX) / (maxX - minX)) * imgW));
        const c1 = Math.min(imgW, Math.ceil(((ix1 - minX) / (maxX - minX)) * imgW));
        const r0 = Math.max(0, Math.floor(((maxY - iy1) / (maxY - minY)) * imgH));
        const r1 = Math.min(imgH, Math.ceil(((maxY - iy0) / (maxY - minY)) * imgH));
        const subW = Math.max(1, c1 - c0);
        const subH = Math.max(1, r1 - r0);
        const [subRaw] = await image.readRasters({ window: [c0, r0, c0 + subW, r0 + subH] });

        const outC0 = Math.max(0, Math.floor(((ix0 - bbox.west) / degW) * winW));
        const outC1 = Math.min(winW, Math.ceil(((ix1 - bbox.west) / degW) * winW));
        const outR0 = Math.max(0, Math.floor(((bbox.north - iy1) / degH) * winH));
        const outR1 = Math.min(winH, Math.ceil(((bbox.north - iy0) / degH) * winH));

        const subWest = minX + (c0 / imgW) * (maxX - minX);
        const subEast = minX + ((c0 + subW) / imgW) * (maxX - minX);
        const subNorth = maxY - (r0 / imgH) * (maxY - minY);
        const subSouth = maxY - ((r0 + subH) / imgH) * (maxY - minY);

        for (let r = outR0; r < outR1; r++) {
          const lat = bbox.north - ((r + 0.5) / winH) * degH;
          const sr = Math.max(0, Math.min(subH - 1, Math.floor(((subNorth - lat) / Math.max(1e-9, subNorth - subSouth)) * subH)));
          for (let c = outC0; c < outC1; c++) {
            const lng = bbox.west + ((c + 0.5) / winW) * degW;
            const sc = Math.max(0, Math.min(subW - 1, Math.floor(((lng - subWest) / Math.max(1e-9, subEast - subWest)) * subW)));
            raw[r * winW + c] = Number(subRaw[sr * subW + sc]) || 0;
          }
        }
      }
    }

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

export async function fetchNagariBoundary(rootDir, regionCfg) {
  const localCustom = path.join(rootDir, 'raw-data', 'region-boundary.geojson');
  if (fs.existsSync(localCustom)) {
    try {
      const gj = JSON.parse(fs.readFileSync(localCustom, 'utf8'));
      if (gj?.features?.length > 0) {
        console.log(`Loaded custom region boundary (raw-data/region-boundary.geojson) for ${regionCfg.name}.`);
        return gj;
      }
    } catch {}
  }
  const localBig2026 = path.join(rootDir, 'raw-data', 'big-nagari-2026.geojson');
  if (fs.existsSync(localBig2026)) {
    try {
      const gj = JSON.parse(fs.readFileSync(localBig2026, 'utf8'));
      if (gj?.features?.length > 0) {
        console.log(`Loaded official BIG boundary (raw-data/big-nagari-2026.geojson) for ${regionCfg.name}.`);
        return gj;
      }
    } catch {}
  }
  if (!regionCfg.regionalOverlays?.enabled) {
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

export function wgs84ToUtm47S(lon, lat) {
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

export async function fetchSentinel2ScourChange(bbox, hand, gridMeta, insideMask = null) {
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

export function mercOrLonLat([x, y]) {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
    return [Number(x.toFixed(5)), Number(y.toFixed(5))];
  }
  const R = 6378137;
  return [
    Number(((x / R) * (180 / Math.PI)).toFixed(5)),
    Number(((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)).toFixed(5))
  ];
}

export function clipRingToBbox(ring, b) {
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

export function buildClippedPolygonCollection(feats, b, propsFn) {
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

export function getArcgisLayerFeatures(webmapJson, titles) {
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

export async function fetchGoogleOpenBuildings(rootDir, bbox) {
  if (!isInsideOpenBuildings2fd(bbox)) {
    console.log('Skipping Sumatra-specific Google Open Buildings tile (2fd) for region outside its extent; using OSM buildings.');
    return [];
  }
  const rawDir = path.join(rootDir, 'raw-data');
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

export function mergeBuildingsWithDedupe(osmBuildings, googleBuildings) {
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

export async function fetchAgamOfficialGis(rootDir, outDir, bbox) {
  const rawDir = path.join(rootDir, 'raw-data');
  const cachePath = path.join(rawDir, 'agam-gis-cache.json');
  const rbiOut = path.join(outDir, 'agam-rbi-rivers.geojson');
  const ctxOut = path.join(outDir, 'agam-context.json');

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
