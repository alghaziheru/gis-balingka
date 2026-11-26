import type { BBox, GeoFeatureCollection, VerifiedWaterwayFeature } from '../types/gis';
import { isPointInNagari } from './agamLookup.ts';

export interface FlowCorridor {
  id: string;
  seed: number;
  tier: 1 | 2 | 3;
  kind: 'verified_river' | 'verified_channel' | 'rbi_tributary' | 'dem_major' | 'dem_minor';
  coords: [number, number][];
  cumDistM: Float32Array;
  normalsLngLat: [number, number][];
  totalLengthM: number;
  bbox: BBox;
  strandCount: number;
  baseSpreadM: number;
  speedMps: number;
}

export interface BuildFlowCorridorsOptions {
  includeVerified?: boolean;
  includeRbi?: boolean;
  nagariBoundary?: GeoFeatureCollection | null;
}

function clipCoordsToNagari(
  coords: [number, number][],
  nagariBoundary: GeoFeatureCollection | null | undefined
): [number, number][][] {
  if (!nagariBoundary?.features?.length) return [coords];
  if (coords.length < 2) return [];

  const dense: [number, number][] = [coords[0]];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segM = Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 110540);
    const sub = Math.max(1, Math.ceil(segM / 35));
    for (let k = 1; k <= sub; k++) {
      const f = k / sub;
      dense.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }

  const runs: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const pt of dense) {
    if (isPointInNagari(nagariBoundary, pt[0], pt[1])) {
      current.push(pt);
    } else {
      if (current.length >= 2 && lineApproxLengthM(current) >= 35) {
        runs.push(current);
      }
      current = [];
    }
  }
  if (current.length >= 2 && lineApproxLengthM(current) >= 35) {
    runs.push(current);
  }
  return runs;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  if (values.length === 2) return (values[0] + values[1]) * 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

/**
 * Multi-point downhill orientation check: compares median elevation of the first ~25%
 * of vertices (min 3 when available) against the last ~25% to ignore single-vertex spikes/pits.
 */
function isForwardDownhill(
  coords: [number, number][],
  getElevation: (lng: number, lat: number) => number
): boolean {
  const n = coords.length;
  if (n < 2) return true;
  const sampleCount = Math.max(1, Math.min(5, Math.max(Math.min(3, Math.floor(n / 2)), Math.ceil(n * 0.25))));
  const startVals: number[] = [];
  const endVals: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    startVals.push(getElevation(coords[i][0], coords[i][1]));
    endVals.push(getElevation(coords[n - 1 - i][0], coords[n - 1 - i][1]));
  }
  return medianOf(startVals) >= medianOf(endVals);
}

/**
 * Split a merged V-shaped polyline (e.g. two converging tributaries stored as one LineString)
 * at its lowest interior valley vertex so each branch flows strictly downhill into the junction.
 */
function splitValleyPolylines(
  coords: [number, number][],
  getElevation: (lng: number, lat: number) => number,
  depth = 0
): [number, number][][] {
  if (depth >= 2 || coords.length < 5) return [coords];

  const n = coords.length;
  const cumDist = new Float64Array(n);
  const elevs = new Float64Array(n);
  elevs[0] = getElevation(coords[0][0], coords[0][1]);
  for (let i = 1; i < n; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * 111320;
    const dy = (coords[i][1] - coords[i - 1][1]) * 110540;
    cumDist[i] = cumDist[i - 1] + Math.hypot(dx, dy);
    elevs[i] = getElevation(coords[i][0], coords[i][1]);
  }
  const totalLen = cumDist[n - 1];
  if (totalLen < 100) return [coords];

  const smooth = new Float64Array(n);
  smooth[0] = (elevs[0] + elevs[1]) * 0.5;
  smooth[n - 1] = (elevs[n - 2] + elevs[n - 1]) * 0.5;
  for (let i = 1; i <= n - 2; i++) {
    smooth[i] = medianOf([elevs[i - 1], elevs[i], elevs[i + 1]]);
  }

  let minIdx = -1;
  let minSmooth = Infinity;
  for (let i = 2; i <= n - 3; i++) {
    if (cumDist[i] >= 50 && totalLen - cumDist[i] >= 50 && smooth[i] < minSmooth) {
      minSmooth = smooth[i];
      minIdx = i;
    }
  }
  if (minIdx < 0) return [coords];

  let leftPeak = -Infinity;
  for (let i = 0; i < minIdx; i++) {
    if (smooth[i] > leftPeak) leftPeak = smooth[i];
  }
  let rightPeak = -Infinity;
  for (let i = minIdx + 1; i < n; i++) {
    if (smooth[i] > rightPeak) rightPeak = smooth[i];
  }

  const leftDrop = leftPeak - smooth[minIdx];
  const rightDrop = rightPeak - smooth[minIdx];
  if (leftDrop >= 10 && rightDrop >= 10) {
    let splitIdx = minIdx;
    let minRaw = elevs[minIdx];
    const lo = Math.max(1, minIdx - 2);
    const hi = Math.min(n - 2, minIdx + 2);
    for (let k = lo; k <= hi; k++) {
      if (elevs[k] < minRaw) {
        minRaw = elevs[k];
        splitIdx = k;
      }
    }
    const left = coords.slice(0, splitIdx + 1);
    const right = coords.slice(splitIdx);
    return [
      ...splitValleyPolylines(left, getElevation, depth + 1),
      ...splitValleyPolylines(right, getElevation, depth + 1)
    ];
  }

  return [coords];
}

/**
 * Truncate tail-end vertices that overshoot a confluence onto the opposite canyon wall.
 */
function trimTailOvershoot(
  oriented: [number, number][],
  getElevation: (lng: number, lat: number) => number
): [number, number][] {
  if (oriented.length < 3) return oriented;

  const n = oriented.length;
  const cumDist = new Float64Array(n);
  const elevs = new Float64Array(n);
  elevs[0] = getElevation(oriented[0][0], oriented[0][1]);
  for (let i = 1; i < n; i++) {
    const dx = (oriented[i][0] - oriented[i - 1][0]) * 111320;
    const dy = (oriented[i][1] - oriented[i - 1][1]) * 110540;
    cumDist[i] = cumDist[i - 1] + Math.hypot(dx, dy);
    elevs[i] = getElevation(oriented[i][0], oriented[i][1]);
  }
  const totalLen = cumDist[n - 1];
  const tailWindowM = Math.min(180, totalLen * 0.35);

  let minIdx = -1;
  let minElev = Infinity;
  for (let i = 1; i < n; i++) {
    if (totalLen - cumDist[i] <= tailWindowM || i >= n - 4) {
      if (elevs[i] < minElev) {
        minElev = elevs[i];
        minIdx = i;
      }
    }
  }

  if (minIdx > 0 && minIdx < n - 1) {
    let tailMaxAfterMin = -Infinity;
    for (let i = minIdx + 1; i < n; i++) {
      if (elevs[i] > tailMaxAfterMin) tailMaxAfterMin = elevs[i];
    }
    if (tailMaxAfterMin - elevs[minIdx] >= 8 && cumDist[minIdx] >= 35) {
      return oriented.slice(0, minIdx + 1);
    }
  }

  return oriented;
}

function chaikinOpenLine(pts: [number, number][], iterations = 2): [number, number][] {
  if (pts.length < 3) return pts;
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

function buildCorridorFromCoords(
  id: string,
  rawCoords: [number, number][],
  tier: 1 | 2 | 3,
  kind: FlowCorridor['kind'],
  getElevation: (lng: number, lat: number) => number
): FlowCorridor | null {
  if (!rawCoords || rawCoords.length < 2) return null;

  const oriented = isForwardDownhill(rawCoords, getElevation) ? rawCoords : [...rawCoords].reverse();
  const conditioned = trimTailOvershoot(oriented, getElevation);

  const thinned: [number, number][] = [conditioned[0]];
  const degPerM = 1 / 111320;
  for (let i = 1; i < conditioned.length - 1; i++) {
    const prev = thinned[thinned.length - 1];
    const dxM = (conditioned[i][0] - prev[0]) * 111320;
    const dyM = (conditioned[i][1] - prev[1]) * 110540;
    if (Math.hypot(dxM, dyM) >= 14) thinned.push(conditioned[i]);
  }
  thinned.push(conditioned[conditioned.length - 1]);

  const coords = chaikinOpenLine(thinned, thinned.length <= 25 ? 2 : 1);
  const n = coords.length;
  const cumDistM = new Float32Array(n);
  const normalsLngLat: [number, number][] = new Array(n);

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (let i = 0; i < n; i++) {
    const [lng, lat] = coords[i];
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;

    if (i > 0) {
      const dx = (lng - coords[i - 1][0]) * 111320;
      const dy = (lat - coords[i - 1][1]) * 110540;
      cumDistM[i] = cumDistM[i - 1] + Math.hypot(dx, dy);
    }

    const pPrev = coords[Math.max(0, i - 1)];
    const pNext = coords[Math.min(n - 1, i + 1)];
    const tx = (pNext[0] - pPrev[0]) * 111320;
    const ty = (pNext[1] - pPrev[1]) * 110540;
    const len = Math.hypot(tx, ty) || 1;
    normalsLngLat[i] = [(-ty / len) * degPerM, (tx / len) * degPerM];
  }

  const totalLengthM = cumDistM[n - 1];
  if (totalLengthM < 35) return null;

  const elevDrop = Math.max(
    0,
    getElevation(coords[0][0], coords[0][1]) - getElevation(coords[n - 1][0], coords[n - 1][1])
  );
  const avgSlope = elevDrop / Math.max(1, totalLengthM);

  const strandCount =
    kind === 'verified_river'
      ? 7
      : kind === 'verified_channel'
        ? 5
        : kind === 'dem_major'
          ? 4
          : 3;
  const baseSpreadM =
    kind === 'verified_river'
      ? 7.5
      : kind === 'verified_channel' || kind === 'dem_major'
        ? 4.5
        : kind === 'rbi_tributary'
          ? 3.2
          : 3.4;
  const speedMps = 34 + Math.min(68, Math.sqrt(Math.max(0.01, avgSlope)) * 125);

  return {
    id,
    seed: hashString(id),
    tier,
    kind,
    coords,
    cumDistM,
    normalsLngLat,
    totalLengthM,
    bbox: { west: west - 0.0004, east: east + 0.0004, south: south - 0.0004, north: north + 0.0004 },
    strandCount,
    baseSpreadM,
    speedMps
  };
}

function lineApproxLengthM(coords: [number, number][]): number {
  let len = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    len += Math.hypot((coords[i + 1][0] - coords[i][0]) * 111320, (coords[i + 1][1] - coords[i][1]) * 110540);
  }
  return len;
}

/**
 * Build smooth downhill silky-filament flow corridors from verified waterways,
 * BIG RBI 50K child rivers, and DEM runoff paths.
 */
export function buildFlowCorridors(
  verifiedWaterways: VerifiedWaterwayFeature[],
  flowPaths: GeoFeatureCollection,
  suppressedDemIds: string[],
  getElevation: (lng: number, lat: number) => number,
  rbiRivers: GeoFeatureCollection | null = null,
  options: BuildFlowCorridorsOptions = {}
): FlowCorridor[] {
  const includeVerified = options.includeVerified !== false;
  const includeRbi = options.includeRbi !== false;
  const boundary = options.nagariBoundary ?? null;
  const corridors: FlowCorridor[] = [];
  const suppressed = new Set(suppressedDemIds);

  const pushClippedCorridors = (
    baseId: string,
    rawCoords: [number, number][],
    tier: 1 | 2 | 3,
    kind: FlowCorridor['kind']
  ) => {
    const segments = clipCoordsToNagari(rawCoords, boundary);
    let subIdx = 0;
    for (const seg of segments) {
      const branches = splitValleyPolylines(seg, getElevation);
      for (const branch of branches) {
        const segId = segments.length === 1 && branches.length === 1 ? baseId : `${baseId}-${subIdx++}`;
        const c = buildCorridorFromCoords(segId, branch, tier, kind, getElevation);
        if (c) corridors.push(c);
      }
    }
  };

  if (includeVerified) {
    for (const ww of verifiedWaterways) {
      if (ww.geometry?.type !== 'LineString') continue;
      const isRiver = ww.properties.kind === 'river';
      pushClippedCorridors(
        `ww-${ww.properties.id}`,
        ww.geometry.coordinates,
        1,
        isRiver ? 'verified_river' : 'verified_channel'
      );
    }
  }

  if (includeRbi && rbiRivers?.features?.length) {
    const rbiSorted = rbiRivers.features
      .filter(f => f.geometry?.type === 'LineString' && f.geometry.coordinates.length >= 2)
      .map((f, idx) => ({
        feature: f,
        idx,
        lenM:
          f.geometry.type === 'LineString'
            ? Number(f.properties?.length_m || 0) || lineApproxLengthM(f.geometry.coordinates)
            : 0
      }))
      .sort((a, b) => b.lenM - a.lenM)
      .slice(0, 90);

    for (const item of rbiSorted) {
      const f = item.feature;
      if (f.geometry.type !== 'LineString') continue;
      const tier: 1 | 2 = item.lenM >= 400 ? 1 : 2;
      pushClippedCorridors(
        `rbi-${String(f.properties?.id || item.idx)}`,
        f.geometry.coordinates,
        tier,
        'rbi_tributary'
      );
    }
  }

  const demSorted = flowPaths.features
    .filter(
      f =>
        f.geometry.type === 'LineString' &&
        Number(f.properties?.tier || 2) <= 2 &&
        !suppressed.has(String(f.properties?.id || ''))
    )
    .sort((a, b) => Number(b.properties?.length_m || 0) - Number(a.properties?.length_m || 0))
    .slice(0, 48);

  for (const f of demSorted) {
    if (f.geometry.type !== 'LineString') continue;
    const tier = Number(f.properties?.tier || 2) <= 1 ? 1 : 2;
    pushClippedCorridors(
      `dem-${String(f.properties?.id || corridors.length)}`,
      f.geometry.coordinates,
      tier,
      tier === 1 ? 'dem_major' : 'dem_minor'
    );
  }

  return corridors;
}

/**
 * Sample a point and its lateral meter-offset normal at distance `distM` along a corridor.
 */
export function sampleCorridorAtDistance(
  corridor: FlowCorridor,
  distM: number
): { lng: number; lat: number; nx: number; ny: number } {
  const { coords, cumDistM, normalsLngLat, totalLengthM } = corridor;
  const d = Math.max(0, Math.min(totalLengthM, distM));
  let lo = 0;
  let hi = cumDistM.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDistM[mid] <= d) lo = mid;
    else hi = mid;
  }
  const segLen = Math.max(1e-4, cumDistM[hi] - cumDistM[lo]);
  const t = Math.max(0, Math.min(1, (d - cumDistM[lo]) / segLen));
  const a = coords[lo];
  const b = coords[hi];
  const na = normalsLngLat[lo];
  const nb = normalsLngLat[hi];
  return {
    lng: a[0] + (b[0] - a[0]) * t,
    lat: a[1] + (b[1] - a[1]) * t,
    nx: na[0] + (nb[0] - na[0]) * t,
    ny: na[1] + (nb[1] - na[1]) * t
  };
}
