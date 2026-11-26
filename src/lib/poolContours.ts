import type {
  BBox,
  GeoFeature,
  GeoFeatureCollection,
  VerifiedWaterwayFeature
} from '../types/gis';
import type { CascadeEngine } from './cascadeEngine';

export interface FloodPoolPolygons {
  yard: GeoFeatureCollection; // >= 0.12 m (shallow terrain flow tint + dashed edge)
  knee: GeoFeatureCollection; // >= 0.30 m (moderate basin depth)
  deep: GeoFeatureCollection; // >= 1.00 m (deep river channel / main overflow)
  shallow: GeoFeatureCollection; // backward-compatible alias for `yard`
  glintPoints: [number, number][];
  filteredDepth: Float32Array;
  gridWidth: number;
  gridHeight: number;
}

function chaikinClosedRing(ring: [number, number][], iterations = 1): [number, number][] {
  if (ring.length < 4) return ring;
  let pts = ring.slice(0, ring.length - 1);
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  pts.push(pts[0]);
  return pts;
}

function ringSignedArea(ring: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area * 0.5;
}

/**
 * Extract closed smooth GeoJSON polygons from a scalar grid via Marching Squares.
 * Grid cell `(c, r)` maps to `(bbox.west + (c + 0.5) * dLng, bbox.north - (r + 0.5) * dLat)`.
 */
export function marchingSquaresPolygons(
  grid: Float32Array,
  width: number,
  height: number,
  bbox: BBox,
  threshold: number,
  mask: Uint8Array | null = null,
  smoothIterations = 1
): GeoFeatureCollection {
  const pw = width + 2;
  const ph = height + 2;
  const val = new Float32Array(pw * ph);

  for (let r = 0; r < height; r++) {
    const rowOff = r * width;
    const pRowOff = (r + 1) * pw + 1;
    for (let c = 0; c < width; c++) {
      const idx = rowOff + c;
      if (mask && mask[idx] === 0) continue;
      const v = grid[idx];
      if (v > 0) val[pRowOff + c] = v;
    }
  }

  type Seg = [[number, number], [number, number]];
  const segments: Seg[] = [];

  const interp = (v0: number, v1: number): number => {
    const dv = v1 - v0;
    if (Math.abs(dv) < 1e-6) return 0.5;
    return Math.max(0.05, Math.min(0.95, (threshold - v0) / dv));
  };

  for (let r = 0; r < ph - 1; r++) {
    const row0 = r * pw;
    const row1 = (r + 1) * pw;
    for (let c = 0; c < pw - 1; c++) {
      const tl = val[row0 + c];
      const tr = val[row0 + c + 1];
      const br = val[row1 + c + 1];
      const bl = val[row1 + c];

      const code =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);

      if (code === 0 || code === 15) continue;

      const top: [number, number] = [c + interp(tl, tr), r];
      const right: [number, number] = [c + 1, r + interp(tr, br)];
      const bottom: [number, number] = [c + interp(bl, br), r + 1];
      const left: [number, number] = [c, r + interp(tl, bl)];

      switch (code) {
        case 1:
          segments.push([bottom, left]);
          break;
        case 2:
          segments.push([right, bottom]);
          break;
        case 3:
          segments.push([right, left]);
          break;
        case 4:
          segments.push([top, right]);
          break;
        case 5: {
          const avg = (tl + tr + br + bl) * 0.25;
          if (avg >= threshold) {
            segments.push([top, left], [bottom, right]);
          } else {
            segments.push([top, right], [bottom, left]);
          }
          break;
        }
        case 6:
          segments.push([top, bottom]);
          break;
        case 7:
          segments.push([top, left]);
          break;
        case 8:
          segments.push([left, top]);
          break;
        case 9:
          segments.push([bottom, top]);
          break;
        case 10: {
          const avg = (tl + tr + br + bl) * 0.25;
          if (avg >= threshold) {
            segments.push([left, bottom], [right, top]);
          } else {
            segments.push([left, top], [right, bottom]);
          }
          break;
        }
        case 11:
          segments.push([right, top]);
          break;
        case 12:
          segments.push([left, right]);
          break;
        case 13:
          segments.push([bottom, right]);
          break;
        case 14:
          segments.push([left, bottom]);
          break;
      }
    }
  }

  if (segments.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const quantKey = (pt: [number, number]) => `${Math.round(pt[0] * 100)},${Math.round(pt[1] * 100)}`;
  const startMap = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const k = quantKey(segments[i][0]);
    const list = startMap.get(k);
    if (list) list.push(i);
    else startMap.set(k, [i]);
  }

  const used = new Uint8Array(segments.length);
  const dLng = (bbox.east - bbox.west) / width;
  const dLat = (bbox.north - bbox.south) / height;

  const toLngLat = (pt: [number, number]): [number, number] => [
    bbox.west + (pt[0] - 0.5) * dLng,
    bbox.north - (pt[1] - 0.5) * dLat
  ];

  const outerRings: [number, number][][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const rawRing: [number, number][] = [segments[i][0], segments[i][1]];
    const startKey = quantKey(segments[i][0]);
    let curKey = quantKey(segments[i][1]);

    let guard = 0;
    while (curKey !== startKey && guard < 12000) {
      guard++;
      const candidates = startMap.get(curKey);
      if (!candidates) break;
      let nextIdx = -1;
      for (let j = 0; j < candidates.length; j++) {
        if (!used[candidates[j]]) {
          nextIdx = candidates[j];
          break;
        }
      }
      if (nextIdx === -1) break;
      used[nextIdx] = 1;
      rawRing.push(segments[nextIdx][1]);
      curKey = quantKey(segments[nextIdx][1]);
    }

    if (curKey === startKey && rawRing.length >= 4) {
      rawRing[rawRing.length - 1] = rawRing[0];
      const areaCells = Math.abs(ringSignedArea(rawRing));
      if (areaCells < 0.35) continue;

      const geoRing = rawRing.map(toLngLat);
      const smoothRing = smoothIterations > 0 ? chaikinClosedRing(geoRing, smoothIterations) : geoRing;
      outerRings.push(smoothRing);
    }
  }

  const features: GeoFeature[] = outerRings.map((ring, idx) => ({
    type: 'Feature',
    properties: { id: `pool-${idx}`, threshold },
    geometry: {
      type: 'Polygon',
      coordinates: [ring]
    }
  }));

  return { type: 'FeatureCollection', features };
}

const channelSeedCache = new WeakMap<Uint8Array, { key: string; mask: Uint8Array }>();

/**
 * Filter a depth grid (either full-res ~13.8m DEMNAS or ~33m sim grid) to only keep
 * contiguous inundated components connected to an established drainage valley or verified
 * waterway, eliminating isolated upland/yard "floating pond" artifacts.
 */
function buildCorridorConnectedDepthGrid(
  depthGrid: Float32Array,
  width: number,
  height: number,
  cellSizeX: number,
  cellSizeY: number,
  bbox: BBox,
  simWidth: number,
  simHeight: number,
  accNormSim: Uint8Array,
  maskSim: Uint8Array | null,
  verifiedWaterways: VerifiedWaterwayFeature[],
  yardThreshold: number,
  isHiRes: boolean
): Float32Array {
  const n = width * height;
  const firstId = verifiedWaterways[0]?.properties?.id ?? '';
  const lastId = verifiedWaterways[verifiedWaterways.length - 1]?.properties?.id ?? '';
  const seedKey = `${width}x${height}|${verifiedWaterways.length}|${firstId}|${lastId}|${isHiRes ? 1 : 0}`;
  const cachedSeed = channelSeedCache.get(accNormSim);
  let channelSeedMask: Uint8Array;

  if (cachedSeed && cachedSeed.key === seedKey) {
    channelSeedMask = cachedSeed.mask;
  } else {
    channelSeedMask = new Uint8Array(n);

    for (let r = 0; r < height; r++) {
      const sr = isHiRes ? Math.min(simHeight - 1, Math.floor((r / height) * simHeight)) : r;
      const rowOff = r * width;
      const sRowOff = sr * simWidth;
      for (let c = 0; c < width; c++) {
        const sc = isHiRes ? Math.min(simWidth - 1, Math.floor((c / width) * simWidth)) : c;
        const sIdx = sRowOff + sc;
        if (maskSim && maskSim[sIdx] === 0) continue;
        if (accNormSim[sIdx] >= 95) channelSeedMask[rowOff + c] = 1;
      }
    }

    // Tighter corridor seed radius on ~13.8m DEMNAS prevents jumping onto adjacent higher yards
    const corridorRadiusM = isHiRes ? 36 : 65;
    const radCols = Math.max(1, Math.ceil(corridorRadiusM / Math.max(1, cellSizeX)));
    const radRows = Math.max(1, Math.ceil(corridorRadiusM / Math.max(1, cellSizeY)));

    for (const ww of verifiedWaterways) {
      const coords = ww.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      for (let s = 0; s < coords.length - 1; s++) {
        const a = coords[s];
        const b = coords[s + 1];
        const colA = ((a[0] - bbox.west) / (bbox.east - bbox.west)) * width - 0.5;
        const rowA = ((bbox.north - a[1]) / (bbox.north - bbox.south)) * height - 0.5;
        const colB = ((b[0] - bbox.west) / (bbox.east - bbox.west)) * width - 0.5;
        const rowB = ((bbox.north - b[1]) / (bbox.north - bbox.south)) * height - 0.5;

        const dCol = colB - colA;
        const dRow = rowB - rowA;
        const steps = Math.max(1, Math.ceil(Math.hypot(dCol, dRow) * 2));

        for (let k = 0; k <= steps; k++) {
          const f = k / steps;
          const cc = Math.round(colA + dCol * f);
          const rr = Math.round(rowA + dRow * f);
          for (let dr = -radRows; dr <= radRows; dr++) {
            const r = rr + dr;
            if (r < 0 || r >= height) continue;
            for (let dc = -radCols; dc <= radCols; dc++) {
              const c = cc + dc;
              if (c < 0 || c >= width) continue;
              if (Math.hypot(dc * cellSizeX, dr * cellSizeY) > corridorRadiusM) continue;
              channelSeedMask[r * width + c] = 1;
            }
          }
        }
      }
    }

    channelSeedCache.set(accNormSim, { key: seedKey, mask: channelSeedMask });
  }

  const visited = new Uint8Array(n);
  const filteredDepth = new Float32Array(n);
  const queue = new Int32Array(n);
  const minClusterCells = isHiRes ? 8 : 4;

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    if (depthGrid[start] < yardThreshold) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let touchesChannel = channelSeedMask[start] === 1;

    while (head < tail) {
      const cur = queue[head++];
      const cr = Math.floor(cur / width);
      const cc = cur - cr * width;

      for (let dr = -1; dr <= 1; dr++) {
        const nr = cr + dr;
        if (nr < 0 || nr >= height) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = cc + dc;
          if (nc < 0 || nc >= width) continue;
          const nIdx = nr * width + nc;
          if (visited[nIdx]) continue;
          if (depthGrid[nIdx] < yardThreshold) continue;
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
          if (channelSeedMask[nIdx] === 1) touchesChannel = true;
        }
      }
    }

    if (touchesChannel && tail >= minClusterCells) {
      for (let k = 0; k < tail; k++) {
        const idx = queue[k];
        filteredDepth[idx] = depthGrid[idx];
      }
    }
  }

  return filteredDepth;
}

/**
 * Extract 3 calm, human-scale water depth tiers directly on the full-resolution ~13.8 m DEMNAS
 * riverbank grid (falling back to the ~33 m grid if hi-res HAND is absent):
 *   - yard: >= 0.12 m (shallow yard / ankle runoff)
 *   - knee: >= 0.30 m (knee-to-plinth depth)
 *   - deep: >= 1.00 m (deep river channel / main overflow)
 */
export function extractFloodPoolPolygons(
  engine: CascadeEngine,
  verifiedWaterways: VerifiedWaterwayFeature[] = [],
  thresholds = { yard: 0.12, knee: 0.3, deep: 1.0 }
): FloodPoolPolygons {
  const { width: simW, height: simH, bbox, cellSizeX: simCellX, cellSizeY: simCellY } = engine.fields;
  const hiRes = typeof engine.computeHiResDepthGrid === 'function' ? engine.computeHiResDepthGrid() : null;
  const isHiRes = Boolean(hiRes);

  const width = hiRes ? hiRes.width : simW;
  const height = hiRes ? hiRes.height : simH;
  const cellSizeX = hiRes ? (simCellX * simW) / width : simCellX;
  const cellSizeY = hiRes ? (simCellY * simH) / height : simCellY;
  const rawDepth = hiRes ? hiRes.depthGrid : engine.getFloodDepthGrid();
  const maskSim = engine.getNagariMask();

  let hasAnyWetCell = false;
  for (let i = 0; i < rawDepth.length; i++) {
    if (rawDepth[i] >= thresholds.yard) {
      hasAnyWetCell = true;
      break;
    }
  }
  if (!hasAnyWetCell) {
    const emptyFc: GeoFeatureCollection = { type: 'FeatureCollection', features: [] };
    return {
      yard: emptyFc,
      knee: emptyFc,
      deep: emptyFc,
      shallow: emptyFc,
      glintPoints: [],
      filteredDepth: new Float32Array(width * height),
      gridWidth: width,
      gridHeight: height
    };
  }

  const filteredDepth = buildCorridorConnectedDepthGrid(
    rawDepth,
    width,
    height,
    cellSizeX,
    cellSizeY,
    bbox,
    simW,
    simH,
    engine.getAccNorm(),
    maskSim,
    verifiedWaterways,
    thresholds.yard,
    isHiRes
  );

  // Single Chaikin smoothing pass on 13.8m cells keeps contours crisp & true to riverbanks without puffing over houses
  const smoothIter = isHiRes ? 1 : 2;
  const maskForMs = isHiRes ? null : maskSim;

  const yard = marchingSquaresPolygons(filteredDepth, width, height, bbox, thresholds.yard, maskForMs, smoothIter);
  const knee = marchingSquaresPolygons(filteredDepth, width, height, bbox, thresholds.knee, maskForMs, smoothIter);
  const deep = marchingSquaresPolygons(filteredDepth, width, height, bbox, thresholds.deep, maskForMs, smoothIter);

  const glintPoints: [number, number][] = [];
  const dLng = (bbox.east - bbox.west) / width;
  const dLat = (bbox.north - bbox.south) / height;
  const step = isHiRes ? 2 : 1;

  for (let r = 0; r < height; r += step) {
    for (let c = 0; c < width; c += step) {
      const idx = r * width + c;
      const d = filteredDepth[idx];
      if (d < thresholds.knee) continue;
      const count = d >= thresholds.deep ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const h1 = Math.sin(idx * 12.9898 + k * 78.233) * 43758.5453;
        const h2 = Math.sin(idx * 93.9898 + k * 41.131) * 28461.7131;
        const fx = h1 - Math.floor(h1);
        const fy = h2 - Math.floor(h2);
        glintPoints.push([bbox.west + (c + 0.15 + fx * 0.7) * dLng, bbox.north - (r + 0.15 + fy * 0.7) * dLat]);
      }
    }
  }

  return { yard, knee, deep, shallow: yard, glintPoints, filteredDepth, gridWidth: width, gridHeight: height };
}
