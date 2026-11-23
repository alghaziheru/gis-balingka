import type { BBox, GeoFeatureCollection, VerifiedWaterwayFeature } from '../types/gis';

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

  const thinned: [number, number][] = [oriented[0]];
  const degPerM = 1 / 111320;
  for (let i = 1; i < oriented.length - 1; i++) {
    const prev = thinned[thinned.length - 1];
    const dxM = (oriented[i][0] - prev[0]) * 111320;
    const dyM = (oriented[i][1] - prev[1]) * 110540;
    if (Math.hypot(dxM, dyM) >= 14) thinned.push(oriented[i]);
  }
  thinned.push(oriented[oriented.length - 1]);

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
  const corridors: FlowCorridor[] = [];
  const suppressed = new Set(suppressedDemIds);

  if (includeVerified) {
    for (const ww of verifiedWaterways) {
      if (ww.geometry?.type !== 'LineString') continue;
      const isRiver = ww.properties.kind === 'river';
      const c = buildCorridorFromCoords(
        `ww-${ww.properties.id}`,
        ww.geometry.coordinates,
        1,
        isRiver ? 'verified_river' : 'verified_channel',
        getElevation
      );
      if (c) corridors.push(c);
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
      const c = buildCorridorFromCoords(
        `rbi-${String(f.properties?.id || item.idx)}`,
        f.geometry.coordinates,
        tier,
        'rbi_tributary',
        getElevation
      );
      if (c) corridors.push(c);
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
    const c = buildCorridorFromCoords(
      `dem-${String(f.properties?.id || corridors.length)}`,
      f.geometry.coordinates,
      tier,
      tier === 1 ? 'dem_major' : 'dem_minor',
      getElevation
    );
    if (c) corridors.push(c);
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
