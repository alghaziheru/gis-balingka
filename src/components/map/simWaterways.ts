import type { GeoFeature, GeoFeatureCollection, VerifiedWaterwayFeature } from '../../types/gis';

const DEG_TO_M_LNG = 111320;
const DEG_TO_M_LAT = 110540;

interface ProximityGrid {
  cells: Set<string>;
  invLng: number;
  invLat: number;
}

function makeProximityGrid(lines: [number, number][][], cellM: number): ProximityGrid {
  const cells = new Set<string>();
  const invLng = DEG_TO_M_LNG / cellM;
  const invLat = DEG_TO_M_LAT / cellM;

  for (let li = 0; li < lines.length; li++) {
    const coords = lines[li];
    for (let i = 0; i < coords.length; i++) {
      const a = coords[i];
      const gx = Math.floor(a[0] * invLng);
      const gy = Math.floor(a[1] * invLat);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          cells.add(`${gx + dx},${gy + dy}`);
        }
      }
      if (i + 1 < coords.length) {
        const b = coords[i + 1];
        const segM = Math.hypot((b[0] - a[0]) * DEG_TO_M_LNG, (b[1] - a[1]) * DEG_TO_M_LAT);
        const steps = Math.min(24, Math.floor(segM / (cellM * 0.55)));
        for (let k = 1; k < steps; k++) {
          const f = k / steps;
          const x = Math.floor((a[0] + (b[0] - a[0]) * f) * invLng);
          const y = Math.floor((a[1] + (b[1] - a[1]) * f) * invLat);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              cells.add(`${x + dx},${y + dy}`);
            }
          }
        }
      }
    }
  }

  return { cells, invLng, invLat };
}

function lineApproxLengthM(pts: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot((pts[i][0] - pts[i - 1][0]) * DEG_TO_M_LNG, (pts[i][1] - pts[i - 1][1]) * DEG_TO_M_LAT);
  }
  return len;
}

/**
 * Keep only portions of a polyline outside `grid`, bridging 1 adjacent vertex at
 * confluence crossings so tributary branches stay visually connected without gaps.
 */
function trimOutsideGrid(coords: [number, number][], grid: ProximityGrid, minLenM: number): [number, number][][] {
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];

  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    const near = grid.cells.has(`${Math.floor(c[0] * grid.invLng)},${Math.floor(c[1] * grid.invLat)}`);
    if (!near) {
      if (cur.length === 0 && i > 0) cur.push(coords[i - 1]);
      cur.push(c);
    } else if (cur.length > 0) {
      cur.push(c);
      if (lineApproxLengthM(cur) >= minLenM) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2 && lineApproxLengthM(cur) >= minLenM) {
    runs.push(cur);
  }
  return runs;
}

/**
 * Merge verified waterways, BIG RBI 50K rivers/tributaries, and non-suppressed DEM
 * tier-1 headwater gullies into a single deduplicated, stream-order-graded watershed layer
 * exclusively for Simulation view.
 */
export function buildUnifiedSimWaterways(
  verifiedWaterways: VerifiedWaterwayFeature[],
  agamRbiRivers: GeoFeatureCollection | null | undefined,
  flowPaths: GeoFeatureCollection | null | undefined,
  suppressedDemIds: string[]
): GeoFeatureCollection {
  const features: GeoFeature[] = [];
  const verifiedLines: [number, number][][] = [];

  for (const ww of verifiedWaterways) {
    if (ww.geometry?.type !== 'LineString' || ww.geometry.coordinates.length < 2) continue;
    verifiedLines.push(ww.geometry.coordinates);
    const order = ww.properties.kind === 'river' ? 1 : 2;
    features.push({
      type: 'Feature',
      properties: { order },
      geometry: { type: 'LineString', coordinates: ww.geometry.coordinates }
    });
  }

  const wwGrid = makeProximityGrid(verifiedLines, 32);
  const keptRbiLines: [number, number][][] = [];

  if (agamRbiRivers?.features?.length) {
    for (const f of agamRbiRivers.features) {
      if (f.geometry?.type !== 'LineString' || f.geometry.coordinates.length < 2) continue;
      const order = f.properties?.kind === 'river' ? 2 : 3;
      const runs = trimOutsideGrid(f.geometry.coordinates, wwGrid, 40);
      for (const run of runs) {
        keptRbiLines.push(run);
        features.push({
          type: 'Feature',
          properties: { order },
          geometry: { type: 'LineString', coordinates: run }
        });
      }
    }
  }

  const combinedGrid = makeProximityGrid([...verifiedLines, ...keptRbiLines], 42);
  const suppressedSet = new Set(suppressedDemIds);

  if (flowPaths?.features?.length) {
    for (const f of flowPaths.features) {
      if (f.geometry?.type !== 'LineString' || f.geometry.coordinates.length < 2) continue;
      if (Number(f.properties?.tier || 2) !== 1) continue;
      if (suppressedSet.has(String(f.properties?.id || ''))) continue;
      const runs = trimOutsideGrid(f.geometry.coordinates, combinedGrid, 65);
      for (const run of runs) {
        features.push({
          type: 'Feature',
          properties: { order: 4 },
          geometry: { type: 'LineString', coordinates: run }
        });
      }
    }
  }

  return { type: 'FeatureCollection', features };
}
