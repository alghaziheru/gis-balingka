import type { VerifiedWaterwayFeature } from '../types/gis';

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
