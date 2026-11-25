import type { DrainageStatus, GeoFeature, GeoFeatureCollection, VerifiedWaterwayFeature, WaterwayKind } from '../types/gis';

const METERS_PER_DEG_LAT = 110540;

export function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointToSegmentMeters(
  pt: [number, number],
  a: [number, number],
  b: [number, number]
): { distM: number; closest: [number, number]; t: number } {
  const cosLat = Math.max(0.1, Math.cos((pt[1] * Math.PI) / 180));
  const mPerDegLng = 111320 * cosLat;

  const px = pt[0] * mPerDegLng;
  const py = pt[1] * METERS_PER_DEG_LAT;
  const ax = a[0] * mPerDegLng;
  const ay = a[1] * METERS_PER_DEG_LAT;
  const bx = b[0] * mPerDegLng;
  const by = b[1] * METERS_PER_DEG_LAT;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 1e-12) {
    t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  }

  const cx = ax + dx * t;
  const cy = ay + dy * t;
  const distM = Math.hypot(px - cx, py - cy);
  const closest: [number, number] = [
    Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
    Number((a[1] + (b[1] - a[1]) * t).toFixed(6))
  ];
  return { distM, closest, t };
}

export function snapPointToWaterways(
  pt: [number, number],
  waterways: VerifiedWaterwayFeature[],
  excludeId: string | null = null,
  thresholdMeters = 22
): { snapped: boolean; point: [number, number]; targetId?: string; targetName?: string } {
  let bestVertexDist = thresholdMeters;
  let bestVertexPt: [number, number] | null = null;
  let bestVertexTarget: { id: string; name: string } | null = null;

  let bestSegDist = thresholdMeters;
  let bestSegPt: [number, number] | null = null;
  let bestSegTarget: { id: string; name: string } | null = null;

  const cosLat = Math.max(0.1, Math.cos((pt[1] * Math.PI) / 180));
  const mPerDegLng = 111320 * cosLat;

  for (const ww of waterways) {
    if (excludeId && ww.properties.id === excludeId) continue;
    const coords = ww.geometry.coordinates;
    if (!coords || coords.length < 2) continue;

    for (let i = 0; i < coords.length; i++) {
      const v = coords[i];
      const d = Math.hypot((pt[0] - v[0]) * mPerDegLng, (pt[1] - v[1]) * METERS_PER_DEG_LAT);
      if (d <= bestVertexDist) {
        bestVertexDist = d;
        bestVertexPt = [Number(v[0].toFixed(6)), Number(v[1].toFixed(6))];
        bestVertexTarget = { id: ww.properties.id, name: ww.properties.name };
      }
      if (i < coords.length - 1) {
        const hit = pointToSegmentMeters(pt, coords[i], coords[i + 1]);
        if (hit.distM <= bestSegDist) {
          bestSegDist = hit.distM;
          bestSegPt = hit.closest;
          bestSegTarget = { id: ww.properties.id, name: ww.properties.name };
        }
      }
    }
  }

  if (bestVertexPt && bestVertexTarget) {
    return {
      snapped: true,
      point: bestVertexPt,
      targetId: bestVertexTarget.id,
      targetName: bestVertexTarget.name
    };
  }
  if (bestSegPt && bestSegTarget) {
    return {
      snapped: true,
      point: bestSegPt,
      targetId: bestSegTarget.id,
      targetName: bestSegTarget.name
    };
  }
  return { snapped: false, point: pt };
}

export function orientCoordinatesDownhill(
  coords: [number, number][],
  getElevation: (lng: number, lat: number) => number
): { coordinates: [number, number][]; reversed: boolean; startElev: number; endElev: number } {
  if (coords.length < 2) {
    const e = coords[0] ? getElevation(coords[0][0], coords[0][1]) : 0;
    return { coordinates: coords.map(c => [c[0], c[1]]), reversed: false, startElev: e, endElev: e };
  }

  const sampleCount = Math.min(3, Math.ceil(coords.length / 3));
  let startSum = 0;
  let endSum = 0;
  for (let i = 0; i < sampleCount; i++) {
    startSum += getElevation(coords[i][0], coords[i][1]);
    const endIdx = coords.length - 1 - i;
    endSum += getElevation(coords[endIdx][0], coords[endIdx][1]);
  }
  const avgStart = startSum / sampleCount;
  const avgEnd = endSum / sampleCount;

  const copy = coords.map(c => [c[0], c[1]] as [number, number]);
  if (avgStart < avgEnd) {
    copy.reverse();
    return {
      coordinates: copy,
      reversed: true,
      startElev: avgEnd,
      endElev: avgStart
    };
  }

  return {
    coordinates: copy,
    reversed: false,
    startElev: avgStart,
    endElev: avgEnd
  };
}

export interface RunoffConfluencePoint {
  coordinates: [number, number];
  waterwayId: string;
  waterwayName: string;
  flowIds: string[];
  maxTier: number;
}

export interface MergedWaterwayReach {
  waterwayId: string;
  waterwayName: string;
  kind: WaterwayKind;
  status: DrainageStatus;
  coordinates: [number, number][];
  lengthM: number;
  directRunoff: boolean;
}

export interface RunoffMergeNetwork {
  confluences: RunoffConfluencePoint[];
  mergedReaches: MergedWaterwayReach[];
  mergingFlowIds: Set<string>;
}

interface WaterwayEntryTrack {
  segIndex: number;
  t: number;
  entryPt: [number, number];
  entryPos: number;
  directRunoff: boolean;
}

function findClosestWaterwayProjection(
  pt: [number, number],
  waterways: VerifiedWaterwayFeature[],
  excludeId: string | null,
  thresholdMeters: number
): {
  ww: VerifiedWaterwayFeature;
  segIndex: number;
  t: number;
  closest: [number, number];
  distM: number;
} | null {
  let best: {
    ww: VerifiedWaterwayFeature;
    segIndex: number;
    t: number;
    closest: [number, number];
    distM: number;
  } | null = null;

  for (const ww of waterways) {
    if (excludeId && ww.properties.id === excludeId) continue;
    const coords = ww.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const hit = pointToSegmentMeters(pt, coords[i], coords[i + 1]);
      if (hit.distM <= thresholdMeters && (!best || hit.distM < best.distM)) {
        best = { ww, segIndex: i, t: hit.t, closest: hit.closest, distM: hit.distM };
      }
    }
  }
  return best;
}

export function computeRunoffMergeNetwork(
  flowFeatures: GeoFeature[],
  verifiedWaterways: VerifiedWaterwayFeature[],
  snapThresholdMeters = 45
): RunoffMergeNetwork {
  const mergingFlowIds = new Set<string>();
  const confluences: RunoffConfluencePoint[] = [];
  const mergedReaches: MergedWaterwayReach[] = [];

  if (!flowFeatures.length || !verifiedWaterways.length) {
    return { confluences, mergedReaches, mergingFlowIds };
  }

  const wwById = new Map<string, VerifiedWaterwayFeature>();
  for (const ww of verifiedWaterways) {
    if (ww.geometry.coordinates && ww.geometry.coordinates.length >= 2) {
      wwById.set(ww.properties.id, ww);
    }
  }
  if (wwById.size === 0) {
    return { confluences, mergedReaches, mergingFlowIds };
  }

  const rawConfluences: {
    coordinates: [number, number];
    waterwayId: string;
    waterwayName: string;
    flowId: string;
    tier: number;
  }[] = [];
  const entryByWwId = new Map<string, WaterwayEntryTrack>();

  for (const flow of flowFeatures) {
    if (flow.geometry.type !== 'LineString') continue;
    const coords = flow.geometry.coordinates;
    if (!coords || coords.length < 2) continue;

    const endPt = coords[coords.length - 1];
    const hit = findClosestWaterwayProjection(endPt, verifiedWaterways, null, snapThresholdMeters);
    if (!hit) continue;

    const flowId = String(flow.properties?.id || '');
    const tierRaw = Number(flow.properties?.tier ?? 2);
    const tier = Number.isFinite(tierRaw) ? tierRaw : 2;
    if (flowId) mergingFlowIds.add(flowId);

    const wwId = hit.ww.properties.id;
    rawConfluences.push({
      coordinates: hit.closest,
      waterwayId: wwId,
      waterwayName: hit.ww.properties.name,
      flowId,
      tier
    });

    const entryPos = hit.segIndex + hit.t;
    const existing = entryByWwId.get(wwId);
    if (!existing || entryPos < existing.entryPos) {
      entryByWwId.set(wwId, {
        segIndex: hit.segIndex,
        t: hit.t,
        entryPt: hit.closest,
        entryPos,
        directRunoff: true
      });
    } else if (!existing.directRunoff) {
      existing.directRunoff = true;
    }
  }

  for (const raw of rawConfluences) {
    const match = confluences.find(
      c =>
        c.waterwayId === raw.waterwayId &&
        haversineMeters(c.coordinates[0], c.coordinates[1], raw.coordinates[0], raw.coordinates[1]) <= 25
    );
    if (match) {
      if (raw.flowId && !match.flowIds.includes(raw.flowId)) {
        match.flowIds.push(raw.flowId);
      }
      match.maxTier = Math.min(match.maxTier, raw.tier);
    } else {
      confluences.push({
        coordinates: raw.coordinates,
        waterwayId: raw.waterwayId,
        waterwayName: raw.waterwayName,
        flowIds: raw.flowId ? [raw.flowId] : [],
        maxTier: raw.tier
      });
    }
  }

  const ancestorsByWwId = new Map<string, Set<string>>();
  for (const wwId of entryByWwId.keys()) {
    ancestorsByWwId.set(wwId, new Set());
  }

  const queue = Array.from(entryByWwId.keys());
  let iter = 0;
  const maxIterations = verifiedWaterways.length * 4;
  while (queue.length > 0 && iter++ < maxIterations) {
    const srcId = queue.shift()!;
    const srcWw = wwById.get(srcId);
    if (!srcWw) continue;
    const srcCoords = srcWw.geometry.coordinates;
    const outlet = srcCoords[srcCoords.length - 1];

    const dstHit = findClosestWaterwayProjection(outlet, verifiedWaterways, srcId, snapThresholdMeters);
    if (!dstHit) continue;

    const dstId = dstHit.ww.properties.id;
    const srcAncestors = ancestorsByWwId.get(srcId);
    if (srcAncestors?.has(dstId)) continue;

    let dstAncestors = ancestorsByWwId.get(dstId);
    if (!dstAncestors) {
      dstAncestors = new Set<string>();
      ancestorsByWwId.set(dstId, dstAncestors);
    }
    dstAncestors.add(srcId);
    if (srcAncestors) {
      for (const a of srcAncestors) dstAncestors.add(a);
    }

    const dstHitPos = dstHit.segIndex + dstHit.t;
    const existing = entryByWwId.get(dstId);
    if (!existing || dstHitPos < existing.entryPos - 1e-4) {
      entryByWwId.set(dstId, {
        segIndex: dstHit.segIndex,
        t: dstHit.t,
        entryPt: dstHit.closest,
        entryPos: dstHitPos,
        directRunoff: existing?.directRunoff ?? false
      });
      queue.push(dstId);
    }
  }

  for (const [wwId, entry] of entryByWwId.entries()) {
    const ww = wwById.get(wwId);
    if (!ww) continue;
    const srcCoords = ww.geometry.coordinates;
    const sliced: [number, number][] = [[entry.entryPt[0], entry.entryPt[1]]];

    for (let i = entry.segIndex + 1; i < srcCoords.length; i++) {
      const pt = srcCoords[i];
      const prev = sliced[sliced.length - 1];
      if (haversineMeters(prev[0], prev[1], pt[0], pt[1]) >= 0.5) {
        sliced.push([pt[0], pt[1]]);
      }
    }

    if (sliced.length < 2) continue;
    let lengthM = 0;
    for (let i = 0; i < sliced.length - 1; i++) {
      lengthM += haversineMeters(sliced[i][0], sliced[i][1], sliced[i + 1][0], sliced[i + 1][1]);
    }
    lengthM = Math.round(lengthM);
    if (lengthM < 5) continue;

    mergedReaches.push({
      waterwayId: ww.properties.id,
      waterwayName: ww.properties.name,
      kind: ww.properties.kind,
      status: ww.properties.status,
      coordinates: sliced,
      lengthM,
      directRunoff: entry.directRunoff
    });
  }

  return { confluences, mergedReaches, mergingFlowIds };
}

function pointInRing2D(pt: [number, number], ring: [number, number][]): boolean {
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

function pointInPolygon2D(pt: [number, number], rings: [number, number][][]): boolean {
  if (!Array.isArray(rings) || rings.length === 0) return false;
  if (!pointInRing2D(pt, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing2D(pt, rings[k])) return false;
  }
  return true;
}

export function isPointInBoundary(pt: [number, number], fc: GeoFeatureCollection | null | undefined): boolean {
  const feats = fc?.features;
  if (!feats || feats.length === 0) return true;
  for (const f of feats) {
    const g = f?.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (!g) continue;
    if (g.type === 'Polygon' && pointInPolygon2D(pt, g.coordinates as [number, number][][])) return true;
    if (g.type === 'MultiPolygon') {
      for (const poly of (g.coordinates as [number, number][][][]) || []) {
        if (pointInPolygon2D(pt, poly)) return true;
      }
    }
  }
  return false;
}
