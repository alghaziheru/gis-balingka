import type {
  AgamContextData,
  AgamPointProfile,
  GeoFeatureCollection
} from '../types/gis';

function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolyCoords(lng: number, lat: number, rings: [number, number][][]): boolean {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(lng, lat, rings[k])) return false;
  }
  return true;
}

function findAtPoint(collection: GeoFeatureCollection | undefined, lng: number, lat: number) {
  if (!collection?.features) return null;
  for (const feat of collection.features) {
    const geom = feat.geometry as unknown as { type: string; coordinates: unknown };
    if (geom.type === 'Polygon' && pointInPolyCoords(lng, lat, geom.coordinates as [number, number][][])) {
      return feat.properties;
    }
    if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates as [number, number][][][]) {
        if (pointInPolyCoords(lng, lat, poly)) return feat.properties;
      }
    }
  }
  return null;
}

export function isPointInNagari(
  nagariBoundary: GeoFeatureCollection | null | undefined,
  lng: number,
  lat: number
): boolean {
  if (!nagariBoundary?.features?.length) return true;
  return findAtPoint(nagariBoundary, lng, lat) !== null;
}

export function lookupAgamAtPoint(
  ctx: AgamContextData | null,
  lng: number,
  lat: number
): AgamPointProfile | null {
  if (!ctx) return null;
  const ls = findAtPoint(ctx.landslideHazard, lng, lat);
  const forest = findAtPoint(ctx.forestStatus, lng, lat);
  const soil = findAtPoint(ctx.soil, lng, lat);
  const geo = findAtPoint(ctx.geology, lng, lat);
  const morph = findAtPoint(ctx.morphology, lng, lat);
  const rain = findAtPoint(ctx.rainfallZone, lng, lat);

  if (!ls && !forest && !soil && !geo && !morph && !rain) return null;

  return {
    landslideLevel: ls?.level ? String(ls.level) : null,
    forestStatus: forest?.fungsi ? String(forest.fungsi) : null,
    forestLabel: forest?.label ? String(forest.label) : null,
    soilType: soil?.soilType ? String(soil.soilType) : null,
    soilSensitivity: soil?.sensitivity ? String(soil.sensitivity) : null,
    geology: geo?.formation ? String(geo.formation) : null,
    morphology: morph?.description ? String(morph.description) : null,
    rainfallAnnualMm: rain?.annualMm ? String(rain.annualMm) : null
  };
}
