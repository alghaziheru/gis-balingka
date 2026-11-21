import type { CommunityFeature, DrainageStatus, FeatureCategory } from '../types/gis';

const STORAGE_FIELD_KEY = 'balingka_gis_field_v1';
const STORAGE_CHECK_KEY = 'balingka_gis_checklist_v1';

const VALID_STATUSES: DrainageStatus[] = ['normal', 'clogged', 'damaged', 'critical'];
const VALID_CATS: FeatureCategory[] = ['drainage', 'floodmark', 'landslide', 'mitigation', 'evacuation'];

export function loadCommunityFeatures(): CommunityFeature[] {
  try {
    const raw = localStorage.getItem(STORAGE_FIELD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCommunityFeatures(features: CommunityFeature[]): void {
  try {
    localStorage.setItem(STORAGE_FIELD_KEY, JSON.stringify(features));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function loadChecklistState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_CHECK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) || {} : {};
  } catch {
    return {};
  }
}

export function saveChecklistState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_CHECK_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function parseImportedGeoJSON(text: string): CommunityFeature[] {
  const parsed = JSON.parse(text);
  const rawFeatures = Array.isArray(parsed?.features) ? parsed.features : [];
  const valid: CommunityFeature[] = [];

  for (let i = 0; i < rawFeatures.length; i++) {
    const f = rawFeatures[i];
    if (!f || f.type !== 'Feature' || !f.geometry) continue;
    if (f.geometry.type !== 'Point' && f.geometry.type !== 'LineString') continue;
    if (!Array.isArray(f.geometry.coordinates)) continue;
    if (f.geometry.type === 'LineString' && f.geometry.coordinates.length < 2) continue;

    const props = f.properties || {};
    const cat: FeatureCategory = VALID_CATS.includes(props.category) ? props.category : 'drainage';
    const status: DrainageStatus = VALID_STATUSES.includes(props.status) ? props.status : 'normal';

    valid.push({
      type: 'Feature',
      properties: {
        id: typeof props.id === 'string' && props.id ? props.id : `imp-${Date.now()}-${i}`,
        name: String(props.name || props.name_id || `Titik Impor ${i + 1}`),
        category: cat,
        status,
        notes: String(props.notes || props.desc_id || ''),
        createdAt: typeof props.createdAt === 'string' ? props.createdAt : new Date().toISOString()
      },
      geometry: f.geometry
    });
  }

  return valid;
}
