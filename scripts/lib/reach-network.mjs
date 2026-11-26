import zlib from 'node:zlib';
import {
  DX,
  DY,
  cellToLngLat,
  haversineMeters,
  pointToSegmentMeters,
  simplifyLine
} from './hydrology.mjs';

/**
 * Fixed stage bins (meters above reach thalweg) for HAND-derived Synthetic Rating Curves (SRC),
 * following Zheng et al. (2018) / NOAA National Water Model methodology.
 */
export const SRC_STAGES_M = [0.25, 0.5, 1.0, 1.5, 2.2, 3.0, 4.2, 5.5];

/**
 * Pure-Node RGBA/RGB PNG decoder for recovering Sentinel-2 scour masks offline
 * from an existing raster-scour-change.png without external image libraries.
 */
export function decodeScourMaskFromPng(pngBuf, targetW, targetH) {
  if (!Buffer.isBuffer(pngBuf) || pngBuf.length < 33) return null;
  if (pngBuf[0] !== 137 || pngBuf.toString('ascii', 1, 4) !== 'PNG') return null;

  let pngW = 0;
  let pngH = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  let off = 8;
  while (off + 8 <= pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > pngBuf.length) break;

    if (type === 'IHDR' && len >= 13) {
      pngW = pngBuf.readUInt32BE(dataStart);
      pngH = pngBuf.readUInt32BE(dataStart + 4);
      bitDepth = pngBuf[dataStart + 8];
      colorType = pngBuf[dataStart + 9];
    } else if (type === 'IDAT') {
      idatChunks.push(pngBuf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    off = dataEnd + 4;
  }

  if (pngW <= 0 || pngH <= 0 || bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    return null;
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = pngW * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  if (raw.length < pngH * (stride + 1)) return null;

  const pixels = new Uint8Array(pngH * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  for (let y = 0; y < pngH; y++) {
    const rowOff = y * (stride + 1);
    const filter = raw[rowOff];
    const dstOff = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[rowOff + 1 + x];
      const left = x >= bpp ? pixels[dstOff + x - bpp] : 0;
      const up = y > 0 ? pixels[dstOff - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[dstOff - stride + x - bpp] : 0;
      let val = byte;
      if (filter === 1) val = (byte + left) & 255;
      else if (filter === 2) val = (byte + up) & 255;
      else if (filter === 3) val = (byte + ((left + up) >> 1)) & 255;
      else if (filter === 4) val = (byte + paeth(left, up, upLeft)) & 255;
      pixels[dstOff + x] = val;
    }
  }

  const out = new Uint8Array(targetW * targetH);
  for (let r = 0; r < targetH; r++) {
    const py = Math.min(pngH - 1, Math.floor(((r + 0.5) / targetH) * pngH));
    for (let c = 0; c < targetW; c++) {
      const px = Math.min(pngW - 1, Math.floor(((c + 0.5) / targetW) * pngW));
      const idx = (py * pngW + px) * bpp;
      const red = pixels[idx];
      const green = pixels[idx + 1];
      const alpha = bpp === 4 ? pixels[idx + 3] : 255;
      if (alpha < 60) continue;
      // Severe scour rendered in crimson (#991b1b, g ~ 27), moderate in amber (#d97706, g ~ 119)
      if (red >= 120 && green < 75) {
        out[r * targetW + c] = 2;
      } else if (red >= 160 && green >= 75) {
        out[r * targetW + c] = 1;
      }
    }
  }
  return out;
}

/**
 * Computes full-resolution Topographic Wetness Index (TWI = ln(a / tan(beta)))
 * and Laplacian terrain curvature (concave hollows vs. convex ridges) from DEMNAS.
 */
export function computeTwiAndCurvature(rawElev, acc, slope, gridMeta) {
  const { width, height, cellSizeX, cellSizeY } = gridMeta;
  const n = width * height;
  const twi = new Uint8Array(n);
  const curvature = new Uint8Array(n); // 128 = planar, <128 = concave hollow, >128 = convex ridge
  const cellArea = cellSizeX * cellSizeY;
  const contourWidth = (cellSizeX + cellSizeY) * 0.5;
  const dx2 = cellSizeX * cellSizeX;
  const dy2 = cellSizeY * cellSizeY;

  const at = (r, c) => {
    const cr = Math.max(0, Math.min(height - 1, r));
    const cc = Math.max(0, Math.min(width - 1, c));
    return rawElev[cr * width + cc];
  };

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const specificArea = Math.max(contourWidth, (Math.max(1, acc[i]) * cellArea) / contourWidth);
      const tanBeta = Math.max(0.015, (slope[i] || 0) / 100);
      const rawTwi = Math.log(specificArea / tanBeta);
      const twiNorm = Math.max(0, Math.min(1, (rawTwi - 2) / 16));
      twi[i] = Math.round(twiNorm * 255);

      // Standard Zevenbergen-Thorne second derivative Laplacian:
      // negative = concave (convergent hollow), positive = convex (divergent ridge)
      const zc = at(r, c);
      const d2x = (at(r, c - 1) - 2 * zc + at(r, c + 1)) / dx2;
      const d2y = (at(r - 1, c) - 2 * zc + at(r + 1, c)) / dy2;
      const lap = -(d2x + d2y) * 100; // positive = convex ridge, negative = concave hollow
      const clamped = Math.max(-1, Math.min(1, lap / 0.6));
      curvature[i] = Math.max(0, Math.min(255, Math.round(128 + clamped * 120)));
    }
  }

  return { twi, curvature };
}

function parseDepthCmRange(depthStr, soilName) {
  const s = String(depthStr || '');
  const nums = s.match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 2) {
    return (Number(nums[0]) + Number(nums[1])) * 0.5;
  }
  if (nums && nums.length === 1) {
    return Number(nums[0]);
  }
  const low = String(soilName || '').toLowerCase();
  if (low.includes('andosol')) return 135;
  if (low.includes('kambisol')) return 105;
  if (low.includes('latosol') || low.includes('podsolik')) return 120;
  if (low.includes('regosol') || low.includes('litosol')) return 65;
  return 110;
}

function classifyGeologyFactor(formation, symbol) {
  const text = `${formation || ''} ${symbol || ''}`.toLowerCase();
  // Lower factor = weaker weathered pyroclastic / unconsolidated material; higher = firmer intrusive/andesite
  if (text.includes('aluvium') || text.includes('alluvium') || text.includes('endapan') || text.includes('koluvium')) {
    return 82;
  }
  if (text.includes('tufa') || text.includes('tuff') || text.includes('batuapung') || text.includes('pumice') || text.includes('piroklastik')) {
    return 86;
  }
  if (text.includes('lahar') || text.includes('breksi') || text.includes('breccia')) {
    return 92;
  }
  if (text.includes('andesit') || text.includes('basal') || text.includes('lava')) {
    return 104;
  }
  if (text.includes('granit') || text.includes('batugamping') || text.includes('kuarsit')) {
    return 118;
  }
  return 100;
}

function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function buildIndexedPolygons(fc) {
  const out = [];
  for (const feat of fc?.features || []) {
    const geom = feat?.geometry;
    if (!geom) continue;
    const polys =
      geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    for (const rings of polys) {
      if (!rings?.length || !rings[0]?.length) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of rings[0]) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      out.push({ rings, minX, maxX, minY, maxY, properties: feat.properties || {} });
    }
  }
  return out;
}

function findIndexedPolygonAt(pt, indexed) {
  const [x, y] = pt;
  for (let i = 0; i < indexed.length; i++) {
    const item = indexed[i];
    if (x < item.minX || x > item.maxX || y < item.minY || y > item.maxY) continue;
    if (!pointInRing(pt, item.rings[0])) continue;
    let inHole = false;
    for (let k = 1; k < item.rings.length; k++) {
      if (pointInRing(pt, item.rings[k])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return item;
  }
  return null;
}

/**
 * Rasterizes BBSDLP soil depth (modulated by terrain slope & curvature: deeper colluvium
 * in concave hollows, thinner on steep convex noses) and PSG lithology strength factor.
 */
export function rasterizeAgamGeotechGrids(agamContext, slope, curvature, gridMeta) {
  const { width, height } = gridMeta;
  const n = width * height;
  const soilDepthCm = new Uint8Array(n);
  const geologyFactor = new Uint8Array(n);

  const soilIndexed = buildIndexedPolygons(agamContext?.soil);
  const geoIndexed = buildIndexedPolygons(agamContext?.geology);
  const hasSoil = soilIndexed.length > 0;
  const hasGeo = geoIndexed.length > 0;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const pt = hasSoil || hasGeo ? cellToLngLat(c, r, gridMeta) : null;

      let baseDepthCm = 115;
      if (hasSoil && pt) {
        const sf = findIndexedPolygonAt(pt, soilIndexed);
        if (sf?.properties) {
          baseDepthCm = parseDepthCmRange(sf.properties.depthCm, sf.properties.soilType);
        }
      }
      // Modulate regolith thickness physically with slope & curvature (Dietrich/SHALSTAB soil-production law):
      // steep rocky cliffs (>50%) shed unconsolidated ash leaving thin colluvium; mid-slope concave hollows accumulate deep Andosol
      const sl = slope ? slope[i] : 15;
      const curvNorm = curvature ? (curvature[i] - 128) / 120 : 0; // <0 hollow, >0 ridge
      const slopeFactor =
        sl > 50
          ? Math.max(0.28, 0.72 - ((sl - 50) / 100) * 0.75)
          : Math.max(0.72, Math.min(1.15, 1.12 - (sl / 100) * 0.78));
      const curvFactor = Math.max(0.76, Math.min(1.32, 1.0 - curvNorm * 0.28));
      soilDepthCm[i] = Math.max(25, Math.min(250, Math.round(baseDepthCm * slopeFactor * curvFactor)));

      let geoVal = 100;
      if (hasGeo && pt) {
        const gf = findIndexedPolygonAt(pt, geoIndexed);
        if (gf?.properties) {
          geoVal = classifyGeologyFactor(gf.properties.formation, gf.properties.symbol);
        }
      }
      geologyFactor[i] = geoVal;
    }
  }

  return { soilDepthCm, geologyFactor };
}

/**
 * Parse opening dimensions from structured fields or free-text size_note (e.g. "2x1.5m", "D=1.2m", "80 cm").
 */
export function parseStructureOpening(structure) {
  const props = structure?.properties || structure || {};
  const explicitW = Number(props.opening_width_m);
  const explicitH = Number(props.opening_height_m);
  if (Number.isFinite(explicitW) && explicitW > 0 && Number.isFinite(explicitH) && explicitH > 0) {
    return {
      widthM: Number(explicitW.toFixed(2)),
      heightM: Number(explicitH.toFixed(2)),
      isCircular: false,
      measured: true
    };
  }
  const note = String(props.size_note || '').trim().toLowerCase();
  if (note) {
    // Match W x H pattern (e.g., "2.5 x 1.2 m", "Box 1.2m × 1.0m", or "200x150 cm")
    const rect = note.match(/(\d+(?:[.,]\d+)?)\s*(cm|m)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(cm|m)?/);
    if (rect) {
      let w = Number(rect[1].replace(',', '.'));
      let h = Number(rect[3].replace(',', '.'));
      const unit1 = rect[2];
      const unit2 = rect[4];
      const isCm = unit1 === 'cm' || unit2 === 'cm' || (w > 25 && h > 25);
      if (isCm) {
        w /= 100;
        h /= 100;
      }
      if (w > 0.1 && h > 0.1 && w <= 60 && h <= 25) {
        return { widthM: Number(w.toFixed(2)), heightM: Number(h.toFixed(2)), isCircular: false, measured: true };
      }
    }
    // Match circular diameter (e.g., "D=1.2m", "diameter 80cm", "ø 100 cm")
    const diam = note.match(/(?:d|diam|diameter|ø)\s*[=:]?\s*(\d+(?:[.,]\d+)?)\s*(cm|m)?/);
    if (diam) {
      let d = Number(diam[1].replace(',', '.'));
      if (diam[2] === 'cm' || d > 15) d /= 100;
      if (d > 0.1 && d <= 15) {
        return { widthM: Number(d.toFixed(2)), heightM: Number(d.toFixed(2)), isCircular: true, measured: true };
      }
    }
  }
  return { widthM: null, heightM: null, isCircular: false, measured: false };
}

/**
 * Estimate culvert / bridge nominal hydraulic capacity Q_cap (m³/s) using submerged
 * orifice / bridge-opening physics when dimensions are known, or regional design scaling otherwise.
 */
export function computeCrossingCapacityM3s({ kind, opening, upstreamAreaKm2 }) {
  const g = 9.81;
  const isBridge = String(kind || '').toLowerCase().includes('bridge') || String(kind || '').toLowerCase().includes('br-');
  if (opening?.measured && opening.widthM && opening.heightM) {
    const area = opening.isCircular
      ? Math.PI * (opening.widthM * 0.5) ** 2
      : opening.widthM * opening.heightM;
    const cd = isBridge ? 0.78 : opening.isCircular ? 0.62 : 0.66;
    const headEff = Math.max(0.35, opening.heightM * (isBridge ? 0.75 : 0.85));
    return Number(Math.max(0.4, cd * area * Math.sqrt(2 * g * headEff)).toFixed(2));
  }
  const areaKm2 = Math.max(0.05, Number(upstreamAreaKm2) || 0.5);
  // Regional drainage sizing: bridges on main mountain rivers pass ~25-yr clear-water flood,
  // while rural tributary culverts pass ~5-10-yr clear-water flood (choking rapidly when debris blocks openings)
  const q = isBridge || areaKm2 >= 4.0
    ? Math.max(8.0, 18.0 * Math.pow(areaKm2, 0.72))
    : Math.max(2.4, 7.2 * Math.pow(areaKm2, 0.68));
  return Number(q.toFixed(2));
}

/**
 * Builds the full-resolution DEMNAS topological reach network, cell-to-reach mapping,
 * HAND-derived Synthetic Rating Curves (SRC), and crossing/waterway linkages.
 */
export function buildReachNetworkAndSrc({
  rawElev,
  dir,
  acc,
  slope,
  hand,
  cnBase,
  isForest,
  twi,
  uplandWeight,
  nagariMask = null,
  verifiedWaterways = [],
  verifiedStructures = [],
  bottlenecks = [],
  gridMeta,
  streamThresholdCells = 75
}) {
  const { width, height, cellSizeX, cellSizeY } = gridMeta;
  const n = width * height;
  const cellAreaM2 = cellSizeX * cellSizeY;
  const cellKm2 = cellAreaM2 / 1e6;
  const diag = Math.hypot(cellSizeX, cellSizeY);
  const stepDist = [cellSizeX, diag, cellSizeY, diag, cellSizeX, diag, cellSizeY, diag];

  const thresh = Math.max(4, Math.min(Math.floor(n * 0.15), Math.round(streamThresholdCells)));

  // 1. Identify stream mask & in-degree
  const isStream = new Uint8Array(n);
  const inDeg = new Uint8Array(n);
  const nextCell = new Int32Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const k = dir[i];
    if (k >= 0) {
      const r = Math.floor(i / width);
      const c = i - r * width;
      const ni = (r + DY[k]) * width + (c + DX[k]);
      if (ni >= 0 && ni < n) nextCell[i] = ni;
    }
    if (acc[i] >= thresh) isStream[i] = 1;
  }

  for (let i = 0; i < n; i++) {
    if (!isStream[i]) continue;
    const ni = nextCell[i];
    if (ni >= 0 && isStream[ni]) inDeg[ni]++;
  }

  // 2. Segment disjoint reaches starting from headwaters (inDeg === 0) and junctions (inDeg >= 2)
  const streamReachRaw = new Int32Array(n).fill(-1);
  const rawReaches = [];

  for (let i = 0; i < n; i++) {
    if (!isStream[i]) continue;
    if (inDeg[i] === 1) continue;

    const rIdx = rawReaches.length;
    const cells = [];
    let cur = i;
    let lengthM = 0;
    let downstreamCell = -1;
    let guard = 0;

    while (cur >= 0 && isStream[cur] && guard++ < n) {
      if (streamReachRaw[cur] >= 0) {
        downstreamCell = cur;
        break;
      }
      streamReachRaw[cur] = rIdx;
      cells.push(cur);
      const ni = nextCell[cur];
      const k = dir[cur];
      if (ni < 0 || !isStream[ni]) {
        downstreamCell = -1;
        break;
      }
      lengthM += k >= 0 ? stepDist[k] : cellSizeX;
      if (inDeg[ni] >= 2) {
        downstreamCell = ni;
        break;
      }
      cur = ni;
    }

    if (cells.length > 0) {
      rawReaches.push({
        cells,
        lengthM: Math.max(cellSizeX, lengthM),
        downstreamCell
      });
    }
  }

  // Fallback for edge cases (e.g., flat synthetic grids where all stream cells formed a chain)
  if (rawReaches.length === 0) {
    let bestCell = 0;
    for (let i = 1; i < n; i++) {
      if (acc[i] > acc[bestCell]) bestCell = i;
    }
    streamReachRaw[bestCell] = 0;
    rawReaches.push({ cells: [bestCell], lengthM: cellSizeX, downstreamCell: -1 });
  }

  // 3. Build topological order (upstream -> downstream) via Kahn's algorithm
  const rawCount = rawReaches.length;
  const rawDown = new Int32Array(rawCount).fill(-1);
  const reachInDeg = new Int32Array(rawCount);

  for (let r = 0; r < rawCount; r++) {
    const dc = rawReaches[r].downstreamCell;
    if (dc >= 0 && streamReachRaw[dc] >= 0 && streamReachRaw[dc] !== r) {
      rawDown[r] = streamReachRaw[dc];
      reachInDeg[rawDown[r]]++;
    }
  }

  const topoRaw = [];
  const q = [];
  for (let r = 0; r < rawCount; r++) {
    if (reachInDeg[r] === 0) q.push(r);
  }
  let qh = 0;
  while (qh < q.length) {
    const u = q[qh++];
    topoRaw.push(u);
    const v = rawDown[u];
    if (v >= 0) {
      reachInDeg[v]--;
      if (reachInDeg[v] === 0) q.push(v);
    }
  }
  // Safety append if any cycle existed (should never happen on priority-filled D8)
  if (topoRaw.length < rawCount) {
    const seen = new Uint8Array(rawCount);
    for (const u of topoRaw) seen[u] = 1;
    for (let r = 0; r < rawCount; r++) if (!seen[r]) topoRaw.push(r);
  }

  const rawToTopo = new Int32Array(rawCount).fill(-1);
  for (let idx = 0; idx < topoRaw.length; idx++) {
    rawToTopo[topoRaw[idx]] = idx;
  }

  const R = topoRaw.length;
  const reaches = new Array(R);
  const streamReach = new Int32Array(n).fill(-1);
  const streamLongFrac = new Uint8Array(n); // 0 = outlet, 255 = head

  for (let r = 0; r < R; r++) {
    const raw = rawReaches[topoRaw[r]];
    const downRaw = rawDown[topoRaw[r]];
    const downstreamId = downRaw >= 0 && rawToTopo[downRaw] > r ? rawToTopo[downRaw] : -1;
    const cells = raw.cells;
    const cLen = cells.length;
    for (let k = 0; k < cLen; k++) {
      const ci = cells[k];
      streamReach[ci] = r;
      // k = 0 is headwater (255), k = cLen - 1 is outlet (0)
      streamLongFrac[ci] = cLen <= 1 ? 128 : Math.round(((cLen - 1 - k) / (cLen - 1)) * 255);
    }

    const headCell = cells[0];
    const outCell = cells[cLen - 1];
    const midCell = cells[cLen >> 1];
    const headElev = rawElev[headCell];
    const outElev = rawElev[outCell];
    const drop = Math.max(0.25, headElev - outElev);
    const bedSlope = Math.max(0.005, Math.min(0.42, drop / Math.max(cellSizeX, raw.lengthM)));

    const cellCoord = idx => {
      const rr = Math.floor(idx / width);
      const cc = idx - rr * width;
      return cellToLngLat(cc, rr, gridMeta);
    };

    const rawLine = [];
    const stride = Math.max(1, Math.floor(cLen / 18));
    for (let k = 0; k < cLen; k += stride) rawLine.push(cellCoord(cells[k]));
    if (cLen > 1) {
      const lastPt = cellCoord(outCell);
      const prev = rawLine[rawLine.length - 1];
      if (!prev || prev[0] !== lastPt[0] || prev[1] !== lastPt[1]) rawLine.push(lastPt);
    }
    const simplified = rawLine.length > 2 ? simplifyLine(rawLine, 0.00018) : rawLine;
    const coords = simplified.map(pt => [Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5))]);

    const upAreaKm2 = Math.max(cellKm2, acc[outCell] * cellKm2);

    reaches[r] = {
      id: r,
      downstreamId,
      lengthM: Number(raw.lengthM.toFixed(1)),
      slope: Number(bedSlope.toFixed(4)),
      upstreamAreaKm2: Number(upAreaKm2.toFixed(3)),
      localAreaKm2: 0,
      meanElevM: Math.round((headElev + outElev) * 0.5),
      meanSlopePct: 0,
      meanCn: 74,
      forestFrac: 0,
      meanTwi: 8,
      uplandFrac: 0,
      insideNagariFrac: 0,
      headCoord: cellCoord(headCell),
      midCoord: cellCoord(midCell),
      outletCoord: cellCoord(outCell),
      coords,
      kRef: [],
      topW: [],
      verifiedWaterwayId: null,
      waterwayName: null,
      waterwayKind: null,
      measuredWidthM: null,
      measuredWidthPreM: null,
      measuredDepthM: null,
      dataConfidence: 'low'
    };
  }

  // 4. Attribute EVERY DEM cell to its draining reach (O(N) memoized D8 trace)
  const cellReach = new Uint16Array(n).fill(65535);
  const cellLongFrac = new Uint8Array(n);
  const traceStack = [];

  for (let i = 0; i < n; i++) {
    if (streamReach[i] >= 0) {
      cellReach[i] = Math.min(65534, streamReach[i]);
      cellLongFrac[i] = streamLongFrac[i];
    }
  }

  for (let i = 0; i < n; i++) {
    if (cellReach[i] !== 65535) continue;
    traceStack.length = 0;
    let cur = i;
    let foundR = 65535;
    let foundLong = 128;
    let guard = 0;

    while (cur >= 0 && guard++ < n) {
      if (cellReach[cur] !== 65535) {
        foundR = cellReach[cur];
        foundLong = cellLongFrac[cur];
        break;
      }
      traceStack.push(cur);
      const ni = nextCell[cur];
      if (ni < 0 || ni === cur) break;
      cur = ni;
    }

    for (let s = 0; s < traceStack.length; s++) {
      cellReach[traceStack[s]] = foundR;
      cellLongFrac[traceStack[s]] = foundLong;
    }
  }

  // 5. Match verified waterways onto reaches so measured cross-sections upgrade the SRC
  const validVerified = (verifiedWaterways || []).filter(
    f => f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2
  );
  if (validVerified.length > 0) {
    for (let r = 0; r < R; r++) {
      const reach = reaches[r];
      const testPts = [reach.headCoord, reach.midCoord, reach.outletCoord];
      let bestWw = null;
      let bestScore = Infinity;

      for (const ww of validVerified) {
        const line = ww.geometry.coordinates;
        let hitSum = 0;
        let closeCount = 0;
        for (const pt of testPts) {
          let minD = Infinity;
          for (let j = 0; j < line.length - 1; j++) {
            const d = pointToSegmentMeters(pt, line[j], line[j + 1]).distM;
            if (d < minD) minD = d;
            if (minD <= 15) break;
          }
          hitSum += minD;
          if (minD <= 55) closeCount++;
        }
        const avgD = hitSum / testPts.length;
        if (closeCount >= 2 && avgD < bestScore) {
          bestScore = avgD;
          bestWw = ww;
        }
      }

      if (bestWw) {
        const p = bestWw.properties || {};
        reach.verifiedWaterwayId = String(p.id || '');
        reach.waterwayName = String(p.name || '');
        reach.waterwayKind = String(p.kind || 'stream');
        const wPost = Number(p.width_post_m);
        const wPre = Number(p.width_pre_m);
        const dM = Number(p.depth_m);
        if (Number.isFinite(wPost) && wPost > 0) reach.measuredWidthM = Number(wPost.toFixed(2));
        if (Number.isFinite(wPre) && wPre > 0) reach.measuredWidthPreM = Number(wPre.toFixed(2));
        if (Number.isFinite(dM) && dM > 0) reach.measuredDepthM = Number(dM.toFixed(2));
        reach.dataConfidence =
          reach.measuredWidthM != null && reach.measuredDepthM != null ? 'high' : 'medium';
      }
    }
  }

  // 6. Single-pass full-res accumulation for sub-catchment stats + HAND Synthetic Rating Curves (SRC)
  const S = SRC_STAGES_M.length;
  const localCells = new Int32Array(R);
  const insideCells = new Int32Array(R);
  const elevSum = new Float64Array(R);
  const slopeSum = new Float64Array(R);
  const cnSum = new Float64Array(R);
  const forestSum = new Float64Array(R);
  const twiSum = new Float64Array(R);
  const uplandSum = new Float64Array(R);

  const subVol = new Float64Array(R * S);
  const wetSurf = new Float64Array(R * S);
  const planArea = new Float64Array(R * S);

  for (let i = 0; i < n; i++) {
    const r = cellReach[i];
    if (r >= R) continue;
    localCells[r]++;
    if (!nagariMask || nagariMask[i] !== 0) insideCells[r]++;
    elevSum[r] += rawElev[i];
    const sl = slope[i] || 0;
    slopeSum[r] += sl;
    cnSum[r] += cnBase ? cnBase[i] : 74;
    forestSum[r] += isForest ? isForest[i] : 0;
    twiSum[r] += twi ? 2 + (twi[i] / 255) * 16 : 8;
    uplandSum[r] += uplandWeight ? uplandWeight[i] / 255 : 0;

    const h = hand[i];
    if (h <= SRC_STAGES_M[S - 1]) {
      const slopeSec = Math.sqrt(1 + (sl / 100) ** 2);
      const base = r * S;
      for (let k = 0; k < S; k++) {
        const Hk = SRC_STAGES_M[k];
        if (h <= Hk) {
          subVol[base + k] += (Hk - h) * cellAreaM2;
          wetSurf[base + k] += cellAreaM2 * slopeSec;
          planArea[base + k] += cellAreaM2;
        }
      }
    }
  }

  for (let r = 0; r < R; r++) {
    const reach = reaches[r];
    const cnt = Math.max(1, localCells[r]);
    reach.localAreaKm2 = Number((localCells[r] * cellKm2).toFixed(4));
    reach.meanElevM = Math.round(elevSum[r] / cnt);
    reach.meanSlopePct = Number((slopeSum[r] / cnt).toFixed(1));
    reach.meanCn = Number((cnSum[r] / cnt).toFixed(1));
    reach.forestFrac = Number((forestSum[r] / cnt).toFixed(3));
    reach.meanTwi = Number((twiSum[r] / cnt).toFixed(2));
    reach.uplandFrac = Number((uplandSum[r] / cnt).toFixed(3));
    reach.insideNagariFrac = Number((insideCells[r] / cnt).toFixed(3));

    // Leopold-Maddock regional hydraulic geometry floor (or field-measured cross-section!)
    const upA = Math.max(0.05, reach.upstreamAreaKm2);
    const bfW = reach.measuredWidthM ?? Math.max(1.2, 1.9 * Math.pow(upA, 0.42));
    const bfD = reach.measuredDepthM ?? Math.max(0.45, 0.48 * Math.pow(upA, 0.3));
    const sqrtS = Math.sqrt(reach.slope);
    const L = Math.max(cellSizeX, reach.lengthM);

    const kRef = new Array(S);
    const topW = new Array(S);
    const base = r * S;
    let prevK = 0;

    for (let k = 0; k < S; k++) {
      const Hk = SRC_STAGES_M[k];
      // Sub-grid trapezoidal/rectangular in-channel conveyance for stage up to bankfull depth
      const inDepth = Math.min(Hk, bfD);
      const inArea = bfW * inDepth;
      const inPerim = bfW + 2 * inDepth;

      // DEMNAS HAND overbank valley geometry
      const demArea = subVol[base + k] / L;
      const demPerim = wetSurf[base + k] / L;
      const demWidth = planArea[base + k] / L;

      let area;
      let perim;
      let widthM;

      if (reach.measuredWidthM != null && reach.measuredDepthM != null) {
        if (Hk <= bfD) {
          area = inArea;
          perim = inPerim;
          widthM = bfW;
        } else {
          const overH = Hk - bfD;
          const overDemArea = Math.max(0, demArea - inArea * 0.5);
          area = inArea + Math.max(overDemArea, bfW * overH);
          perim = Math.max(inPerim, demPerim);
          widthM = Math.max(bfW, demWidth);
        }
      } else {
        // Blend sub-grid incised bed floor with full-res DEMNAS valley cross-section
        area = Math.max(inArea, demArea + inArea * 0.35);
        perim = Math.max(inPerim, demPerim);
        widthM = Math.max(bfW, demWidth);
      }

      const rh = area / Math.max(0.5, perim);
      let conv = area * Math.pow(rh, 2 / 3) * sqrtS;
      if (conv <= prevK * 1.02) conv = prevK * 1.05 + 0.05;
      prevK = conv;

      kRef[k] = Number(conv.toFixed(3));
      topW[k] = Number(Math.max(1.0, widthM).toFixed(1));
    }

    reach.kRef = kRef;
    reach.topW = topW;
  }

  // 7. Attach verified structures & unverified road crossings to their exact reach
  const crossings = [];
  const usedCoords = [];
  const snapToReach = (lng, lat) => {
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - gridMeta.bbox.west) / (gridMeta.bbox.east - gridMeta.bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((gridMeta.bbox.north - lat) / (gridMeta.bbox.north - gridMeta.bbox.south)) * height)));
    const directIdx = row * width + col;
    if (streamReach[directIdx] >= 0) {
      return { reachId: streamReach[directIdx], longFrac: streamLongFrac[directIdx] / 255 };
    }
    // Search within ~75m for nearest stream cell first, then fallback to draining reach
    const rad = Math.max(2, Math.ceil(75 / Math.min(cellSizeX, cellSizeY)));
    let bestR = -1;
    let bestLong = 0.5;
    let bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++) {
      const rr = row + dr;
      if (rr < 0 || rr >= height) continue;
      for (let dc = -rad; dc <= rad; dc++) {
        const cc = col + dc;
        if (cc < 0 || cc >= width) continue;
        const idx = rr * width + cc;
        if (streamReach[idx] < 0) continue;
        const d = Math.hypot(dc * cellSizeX, dr * cellSizeY);
        if (d < bestD) {
          bestD = d;
          bestR = streamReach[idx];
          bestLong = streamLongFrac[idx] / 255;
        }
      }
    }
    if (bestR >= 0) return { reachId: bestR, longFrac: bestLong };
    if (cellReach[directIdx] < R) {
      return { reachId: cellReach[directIdx], longFrac: cellLongFrac[directIdx] / 255 };
    }
    return null;
  };

  for (const st of verifiedStructures || []) {
    const coords = st?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const snapped = snapToReach(coords[0], coords[1]);
    if (!snapped) continue;
    const p = st.properties || {};
    const opening = parseStructureOpening(st);
    const reach = reaches[snapped.reachId];
    const qCapM3s = computeCrossingCapacityM3s({
      kind: p.kind,
      opening,
      upstreamAreaKm2: reach.upstreamAreaKm2
    });
    const rawBlk = Number(p.default_blockage_pct);
    const statusBlk =
      p.status === 'critical' ? 75 : p.status === 'damaged' ? 50 : p.status === 'clogged' ? 60 : 5;
    const defaultBlockagePct = Number.isFinite(rawBlk) && rawBlk >= 0 && rawBlk <= 100 ? rawBlk : statusBlk;

    crossings.push({
      id: String(p.id || `vs-${crossings.length + 1}`),
      name: String(p.name || 'Verified Structure'),
      kind: String(p.kind || 'culvert'),
      status: String(p.status || 'normal'),
      verified: true,
      measuredOpening: opening.measured,
      openingWidthM: opening.widthM,
      openingHeightM: opening.heightM,
      defaultBlockagePct,
      qCapM3s,
      reachId: snapped.reachId,
      longFrac: Number(snapped.longFrac.toFixed(3)),
      coords: [Number(coords[0].toFixed(6)), Number(coords[1].toFixed(6))]
    });
    usedCoords.push(coords);
    if (opening.measured && reach.dataConfidence === 'low') {
      reach.dataConfidence = 'medium';
    }
  }

  for (const b of bottlenecks || []) {
    const coords = b?.coords || b?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    if (usedCoords.some(uc => haversineMeters(coords[0], coords[1], uc[0], uc[1]) <= 40)) continue;
    const snapped = snapToReach(coords[0], coords[1]);
    if (!snapped) continue;
    const reach = reaches[snapped.reachId];
    const bId = String(b.id || b.properties?.id || `cross-${crossings.length + 1}`);
    const bKind = bId.includes('br-') ? 'bridge' : 'culvert';
    const bStatus = String(b.status || b.properties?.status || 'unverified');
    const qCapM3s = computeCrossingCapacityM3s({
      kind: bKind,
      opening: { measured: false },
      upstreamAreaKm2: reach.upstreamAreaKm2
    });

    crossings.push({
      id: bId,
      name: String(b.name_id || b.properties?.name_id || b.name_en || bId),
      kind: bKind,
      status: bStatus,
      verified: false,
      measuredOpening: false,
      openingWidthM: null,
      openingHeightM: null,
      defaultBlockagePct: bStatus === 'clogged' ? 55 : bStatus === 'critical' ? 75 : 35,
      qCapM3s,
      reachId: snapped.reachId,
      longFrac: Number(snapped.longFrac.toFixed(3)),
      coords: [Number(coords[0].toFixed(6)), Number(coords[1].toFixed(6))]
    });
    usedCoords.push(coords);
  }

  return {
    network: {
      version: 2,
      srcStagesM: SRC_STAGES_M,
      reachCount: R,
      crossingCount: crossings.length,
      reaches,
      crossings
    },
    cellReach,
    cellLongFrac
  };
}
