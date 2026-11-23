import type {
  BBox,
  GeoFeature,
  GeoFeatureCollection,
  SimFieldsData,
  VerifiedWaterwayFeature
} from '../types/gis';
import type { CascadeEngine } from './cascadeEngine';

export interface FloodPoolPolygons {
  shallow: GeoFeatureCollection;
  deep: GeoFeatureCollection;
  glintPoints: [number, number][];
  filteredDepth: Float32Array;
}

function chaikinClosedRing(ring: [number, number][], iterations = 2): [number, number][] {
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
  smoothIterations = 2
): GeoFeatureCollection {
  const pw = width + 2;
  const ph = height + 2;
  const val = new Float32Array(pw * ph);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const idx = r * width + c;
      if (mask && mask[idx] === 0) continue;
      val[(r + 1) * pw + (c + 1)] = grid[idx];
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
    for (let c = 0; c < pw - 1; c++) {
      const tl = val[r * pw + c];
      const tr = val[r * pw + (c + 1)];
      const br = val[(r + 1) * pw + (c + 1)];
      const bl = val[(r + 1) * pw + c];

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
    while (curKey !== startKey && guard < 6000) {
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

/**
 * Filter `floodDepthGrid` to only keep contiguous inundated components (>= 4 cells)
 * connected to an established drainage valley (`accNorm >= 95`) or verified waterway (~65 m),
 * eliminating isolated upland/yard "floating pond" artifacts.
 */
function buildCorridorConnectedDepthGrid(
  engine: CascadeEngine,
  verifiedWaterways: VerifiedWaterwayFeature[],
  shallowThreshold: number
): Float32Array {
  const { width, height, bbox, cellSizeX, cellSizeY } = engine.fields;
  const n = width * height;
  const depthGrid = engine.getFloodDepthGrid();
  const accNorm = engine.getAccNorm();
  const mask = engine.getNagariMask();

  const channelSeedMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (mask && mask[i] === 0) continue;
    if (accNorm[i] >= 95) channelSeedMask[i] = 1;
  }

  const corridorRadiusM = 65;
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
            const idx = r * width + c;
            if (!mask || mask[idx] !== 0) {
              channelSeedMask[idx] = 1;
            }
          }
        }
      }
    }
  }

  const visited = new Uint8Array(n);
  const filteredDepth = new Float32Array(n);
  const queue = new Int32Array(n);

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    if (mask && mask[start] === 0) continue;
    if (depthGrid[start] < shallowThreshold) continue;

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
          if (mask && mask[nIdx] === 0) continue;
          if (depthGrid[nIdx] < shallowThreshold) continue;
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
          if (channelSeedMask[nIdx] === 1) touchesChannel = true;
        }
      }
    }

    if (touchesChannel && tail >= 4) {
      for (let k = 0; k < tail; k++) {
        const idx = queue[k];
        filteredDepth[idx] = depthGrid[idx];
        const cr = Math.floor(idx / width);
        const cc = idx - cr * width;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = cr + dr;
          if (nr < 0 || nr >= height) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const nc = cc + dc;
            if (nc < 0 || nc >= width) continue;
            const nIdx = nr * width + nc;
            if ((!mask || mask[nIdx] !== 0) && depthGrid[nIdx] > 0.05 && filteredDepth[nIdx] === 0) {
              filteredDepth[nIdx] = depthGrid[nIdx];
            }
          }
        }
      }
    }
  }

  return filteredDepth;
}

/**
 * Extract river-corridor-connected shallow & deep water polygons and interior glint coordinates
 * directly from `CascadeEngine`'s `floodDepthGrid`, excluding isolated upland pond artifacts.
 */
export function extractFloodPoolPolygons(
  engine: CascadeEngine,
  verifiedWaterways: VerifiedWaterwayFeature[] = [],
  thresholds = { shallow: 0.14, deep: 0.48 }
): FloodPoolPolygons {
  const { width, height, bbox } = engine.fields;
  const mask = engine.getNagariMask();
  const filteredDepth = buildCorridorConnectedDepthGrid(engine, verifiedWaterways, thresholds.shallow);

  const shallow = marchingSquaresPolygons(filteredDepth, width, height, bbox, thresholds.shallow, mask, 2);
  const deep = marchingSquaresPolygons(filteredDepth, width, height, bbox, thresholds.deep, mask, 2);

  const glintPoints: [number, number][] = [];
  const dLng = (bbox.east - bbox.west) / width;
  const dLat = (bbox.north - bbox.south) / height;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const idx = r * width + c;
      if (mask && mask[idx] === 0) continue;
      const d = filteredDepth[idx];
      if (d < thresholds.shallow + 0.04) continue;
      const count = d >= thresholds.deep ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const h1 = Math.sin(idx * 12.9898 + k * 78.233) * 43758.5453;
        const h2 = Math.sin(idx * 93.9898 + k * 41.131) * 28461.7131;
        const fx = h1 - Math.floor(h1);
        const fy = h2 - Math.floor(h2);
        glintPoints.push([bbox.west + (c + 0.12 + fx * 0.76) * dLng, bbox.north - (r + 0.12 + fy * 0.76) * dLat]);
      }
    }
  }

  return { shallow, deep, glintPoints, filteredDepth };
}

/**
 * Filter building footprints whose centroids lie inside the corridor-connected modeled water zone.
 */
export function extractAffectedBuildings(
  settlements: GeoFeatureCollection | null | undefined,
  filteredDepth: Float32Array,
  fields: Pick<SimFieldsData, 'width' | 'height' | 'bbox'>,
  minDepthM = 0.14
): GeoFeatureCollection {
  if (!settlements?.features?.length) {
    return { type: 'FeatureCollection', features: [] };
  }
  const { width, height, bbox } = fields;
  const affected: GeoFeature[] = [];

  for (const f of settlements.features) {
    if (f.properties?.kind !== 'building' || f.geometry?.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0];
    if (!ring || ring.length < 3) continue;
    const len = ring.length > 1 ? ring.length - 1 : ring.length;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < len; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    const lng = sx / len;
    const lat = sy / len;
    if (lng < bbox.west || lng > bbox.east || lat < bbox.south || lat > bbox.north) continue;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    if ((filteredDepth[row * width + col] || 0) >= minDepthM) {
      affected.push(f);
    }
  }

  return { type: 'FeatureCollection', features: affected };
}
