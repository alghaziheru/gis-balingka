import { DEFAULT_REGION_ID, REGION } from '../config/region';
import type {
  AuditLogEntry,
  CalibrationMarkFeature,
  CalibrationMarkKind,
  CalibrationProfile,
  CitizenSuggestion,
  DrainageStatus,
  EditorStatus,
  ExportBundle,
  GeoFeatureCollection,
  HydroStatus,
  JorongBoundaryFeature,
  JorongBoundaryStatus,
  StructureKind,
  StructureSource,
  SuggestionStatus,
  SuppressedDemSegment,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature,
  WaterwayKind,
  WaterwaySource
} from '../types/gis';

const PASSPHRASE_SESSION_KEY = 'balingka_editor_passphrase_v1';
const EDITOR_NAME_KEY = 'balingka_editor_name_v1';

function withRegion(url: string, regionId?: string): string {
  const id = String(regionId || DEFAULT_REGION_ID).trim();
  if (!id || id === DEFAULT_REGION_ID) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}region=${encodeURIComponent(id)}`;
}

export function loadStoredPassphrase(): string {
  try {
    return sessionStorage.getItem(PASSPHRASE_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function saveStoredPassphrase(passphrase: string): void {
  try {
    if (passphrase) sessionStorage.setItem(PASSPHRASE_SESSION_KEY, passphrase);
    else sessionStorage.removeItem(PASSPHRASE_SESSION_KEY);
  } catch {}
}

export function loadEditorName(fallbackName = REGION.authorities.defaultEditorName): string {
  try {
    return localStorage.getItem(EDITOR_NAME_KEY) || fallbackName;
  } catch {
    return fallbackName;
  }
}

export function saveEditorName(name: string): void {
  try {
    localStorage.setItem(EDITOR_NAME_KEY, name);
  } catch {}
}

async function apiFetch<T>(url: string, init: RequestInit = {}, passphrase?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const pass = passphrase ?? loadStoredPassphrase();
  if (pass) headers.set('X-Admin-Passphrase', pass);

  const res = await fetch(url, { ...init, headers });
  const contentType = res.headers.get('content-type') || '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    const err = new Error(String(json.error || `HTTP ${res.status}`)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export function buildStaticSeedWaterways(osmContext: GeoFeatureCollection): VerifiedWaterwayFeature[] {
  return osmContext.features
    .filter(f => f.properties?.kind === 'waterway' && f.geometry.type === 'LineString')
    .map((f, idx) => ({
      type: 'Feature',
      properties: {
        id: `ww-osm-static-${idx + 1}`,
        name: String(f.properties?.name || `Alur OSM #${idx + 1}`),
        kind: (String(f.properties?.waterway || 'stream') as WaterwayKind),
        status: 'normal',
        source: 'osm',
        source_ref: String(f.properties?.id || ''),
        notes: 'Data awal OpenStreetMap (mode baca saja).',
        length_m: 0,
        updated_by: 'Data Awal OSM',
        updated_at: ''
      },
      geometry: {
        type: 'LineString',
        coordinates: (f.geometry as { type: 'LineString'; coordinates: [number, number][] }).coordinates
      }
    }));
}

export async function fetchStaticVerifiedSeed(
  osmContext: GeoFeatureCollection,
  dataBasePath = '/data'
): Promise<{
  waterways: VerifiedWaterwayFeature[];
  structures: VerifiedStructureFeature[];
  suppressedDem: SuppressedDemSegment[];
  calibrationMarks: CalibrationMarkFeature[];
  calibrationProfile: CalibrationProfile | null;
}> {
  const base = dataBasePath.replace(/\/+$/, '');
  const fetchJson = async <T>(url: string): Promise<T | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  const [wwFc, stFc, supArr, calFc, calProf] = await Promise.all([
    fetchJson<{ features?: VerifiedWaterwayFeature[] }>(`${base}/verified-waterways.geojson`),
    fetchJson<{ features?: VerifiedStructureFeature[] }>(`${base}/verified-structures.geojson`),
    fetchJson<SuppressedDemSegment[]>(`${base}/suppressed-dem.json`),
    fetchJson<{ features?: CalibrationMarkFeature[] }>(`${base}/calibration-marks.geojson`),
    fetchJson<CalibrationProfile>(`${base}/calibration-profile.json`)
  ]);

  const waterways =
    Array.isArray(wwFc?.features) && wwFc.features.length > 0
      ? wwFc.features.filter(f => f?.geometry?.type === 'LineString')
      : buildStaticSeedWaterways(osmContext);
  const structures = Array.isArray(stFc?.features)
    ? stFc.features.filter(f => f?.geometry?.type === 'Point')
    : [];
  const suppressedDem = Array.isArray(supArr) ? supArr.filter(s => s && s.seg_id) : [];
  const calibrationMarks = Array.isArray(calFc?.features)
    ? calFc.features.filter(f => f?.geometry?.type === 'Point')
    : [];
  const calibrationProfile =
    calProf && typeof calProf.manningMult === 'number' ? calProf : null;

  return { waterways, structures, suppressedDem, calibrationMarks, calibrationProfile };
}

export async function fetchEditorStatus(): Promise<EditorStatus | null> {
  try {
    const status = await apiFetch<EditorStatus>('/api/editor/status');
    return typeof status?.requiresPassphrase === 'boolean' ? status : null;
  } catch {
    return null;
  }
}

export async function verifyEditorPassphrase(passphrase: string): Promise<boolean> {
  try {
    const res = await apiFetch<{ ok: boolean }>('/api/editor/verify', {
      method: 'POST',
      body: JSON.stringify({ passphrase })
    });
    return Boolean(res.ok);
  } catch {
    return false;
  }
}

export async function fetchWaterwaysState(regionId?: string): Promise<{
  waterways: VerifiedWaterwayFeature[];
  structures: VerifiedStructureFeature[];
  jorongBoundaries: JorongBoundaryFeature[];
  calibrationMarks: CalibrationMarkFeature[];
  calibrationProfile: CalibrationProfile | null;
  suppressedDem: SuppressedDemSegment[];
  hydroStatus: HydroStatus;
}> {
  const data = await apiFetch<{
    waterways: { features: VerifiedWaterwayFeature[] };
    structures?: { features: VerifiedStructureFeature[] };
    jorongBoundaries?: { features: JorongBoundaryFeature[] };
    calibrationMarks?: { features: CalibrationMarkFeature[] };
    calibrationProfile?: CalibrationProfile | null;
    suppressedDem: SuppressedDemSegment[];
    hydroStatus?: HydroStatus;
  }>(withRegion('/api/waterways', regionId));
  const waterways = data.waterways?.features || [];
  const structures = data.structures?.features || [];
  const jorongBoundaries = data.jorongBoundaries?.features || [];
  const calibrationMarks = data.calibrationMarks?.features || [];
  const calibrationProfile = data.calibrationProfile || null;
  return {
    waterways,
    structures,
    jorongBoundaries,
    calibrationMarks,
    calibrationProfile,
    suppressedDem: data.suppressedDem || [],
    hydroStatus: data.hydroStatus || {
      dirty: false,
      lastRecomputedAt: null,
      burnedCellCount: 0,
      verifiedWaterwayCount: waterways.length
    }
  };
}

export async function recomputeHydrology(
  payload: {
    actor: string;
    carveDepthM?: number;
  },
  regionId?: string
): Promise<{
  ok: boolean;
  summary: {
    hydroConditioned: boolean;
    burnedCellCount: number;
    verifiedWaterwayCount: number;
    flowSegmentCount: number;
    filteredOverlapCount: number;
    crossingsDetected: number;
    recomputedAt: string;
  };
  hydroStatus: HydroStatus;
  state: {
    waterways: { features: VerifiedWaterwayFeature[] };
    structures?: { features: VerifiedStructureFeature[] };
    suppressedDem: SuppressedDemSegment[];
  };
}> {
  return apiFetch(withRegion('/api/hydrology/recompute', regionId), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function createWaterway(
  payload: {
    name: string;
    kind: WaterwayKind;
    status: DrainageStatus;
    source: WaterwaySource;
    source_ref?: string | null;
    notes: string;
    width_pre_m?: number | null;
    width_post_m?: number | null;
    depth_m?: number | null;
    coordinates: [number, number][];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: VerifiedWaterwayFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion('/api/waterways', regionId), { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateWaterway(
  id: string,
  payload: {
    name?: string;
    kind?: WaterwayKind;
    status?: DrainageStatus;
    notes?: string;
    width_pre_m?: number | null;
    width_post_m?: number | null;
    depth_m?: number | null;
    coordinates?: [number, number][];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: VerifiedWaterwayFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion(`/api/waterways/${encodeURIComponent(id)}`, regionId), {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function deleteWaterway(
  id: string,
  payload: { actor: string; reason: string },
  regionId?: string
): Promise<void> {
  await apiFetch(withRegion(`/api/waterways/${encodeURIComponent(id)}`, regionId), {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function createStructure(
  payload: {
    name: string;
    kind: StructureKind;
    status: Exclude<DrainageStatus, 'unverified'>;
    source: StructureSource;
    source_ref?: string | null;
    size_note: string;
    opening_width_m?: number | null;
    opening_height_m?: number | null;
    default_blockage_pct?: number | null;
    notes: string;
    coordinates: [number, number];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: VerifiedStructureFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion('/api/structures', regionId), { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateStructure(
  id: string,
  payload: {
    name?: string;
    kind?: StructureKind;
    status?: Exclude<DrainageStatus, 'unverified'>;
    size_note?: string;
    opening_width_m?: number | null;
    opening_height_m?: number | null;
    default_blockage_pct?: number | null;
    notes?: string;
    coordinates?: [number, number];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: VerifiedStructureFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion(`/api/structures/${encodeURIComponent(id)}`, regionId), {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function deleteStructure(
  id: string,
  payload: { actor: string; reason: string },
  regionId?: string
): Promise<void> {
  await apiFetch(withRegion(`/api/structures/${encodeURIComponent(id)}`, regionId), {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function createCalibrationMark(
  payload: {
    name: string;
    kind: CalibrationMarkKind;
    observed_depth_m: number | null;
    rain_mm_hr: number;
    duration_min: number;
    antecedent_5d_mm: number;
    notes: string;
    coordinates: [number, number];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: CalibrationMarkFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion('/api/calibration-marks', regionId), { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateCalibrationMark(
  id: string,
  payload: {
    name?: string;
    kind?: CalibrationMarkKind;
    observed_depth_m?: number | null;
    rain_mm_hr?: number;
    duration_min?: number;
    antecedent_5d_mm?: number;
    notes?: string;
    coordinates?: [number, number];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: CalibrationMarkFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion(`/api/calibration-marks/${encodeURIComponent(id)}`, regionId), {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function deleteCalibrationMark(
  id: string,
  payload: { actor: string; reason: string },
  regionId?: string
): Promise<void> {
  await apiFetch(withRegion(`/api/calibration-marks/${encodeURIComponent(id)}`, regionId), {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function saveCalibrationProfile(
  payload: {
    manningMult: number;
    cnOffset: number;
    cohesionMult: number;
    rmseM?: number | null;
    scourCsi?: number | null;
    landslideAuc?: number | null;
    notes?: string;
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ profile: CalibrationProfile; log: AuditLogEntry }> {
  return apiFetch(withRegion('/api/calibration-profile', regionId), { method: 'PUT', body: JSON.stringify(payload) });
}

export async function createJorongBoundary(
  payload: {
    name: string;
    status: JorongBoundaryStatus;
    source_note: string;
    coordinates: [number, number][];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: JorongBoundaryFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion('/api/jorong-boundaries', regionId), { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateJorongBoundary(
  id: string,
  payload: {
    name?: string;
    status?: JorongBoundaryStatus;
    source_note?: string;
    coordinates?: [number, number][];
    actor: string;
    reason: string;
  },
  regionId?: string
): Promise<{ feature: JorongBoundaryFeature; log: AuditLogEntry }> {
  return apiFetch(withRegion(`/api/jorong-boundaries/${encodeURIComponent(id)}`, regionId), {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function deleteJorongBoundary(
  id: string,
  payload: { actor: string; reason: string },
  regionId?: string
): Promise<void> {
  await apiFetch(withRegion(`/api/jorong-boundaries/${encodeURIComponent(id)}`, regionId), {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function suppressDemSegment(
  payload: {
    seg_id: string;
    reason: string;
    actor: string;
  },
  regionId?: string
): Promise<{ suppressed: SuppressedDemSegment; log: AuditLogEntry }> {
  return apiFetch(withRegion('/api/dem-segments/suppress', regionId), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function restoreDemSegment(
  segId: string,
  payload: { actor: string; reason: string },
  regionId?: string
): Promise<void> {
  await apiFetch(withRegion(`/api/dem-segments/${encodeURIComponent(segId)}/suppress`, regionId), {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function fetchAuditLogs(limit = 150, regionId?: string): Promise<AuditLogEntry[]> {
  const data = await apiFetch<{ logs: AuditLogEntry[] }>(withRegion(`/api/audit?limit=${limit}`, regionId));
  return data.logs || [];
}

export async function revertAuditLog(
  logId: number,
  payload: { actor: string; reason: string },
  regionId?: string
): Promise<{
  log: AuditLogEntry;
  state: {
    waterways: { features: VerifiedWaterwayFeature[] };
    structures?: { features: VerifiedStructureFeature[] };
    suppressedDem: SuppressedDemSegment[];
  };
}> {
  return apiFetch(withRegion(`/api/audit/${logId}/revert`, regionId), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function fetchSuggestions(regionId?: string): Promise<CitizenSuggestion[]> {
  const data = await apiFetch<{ suggestions: CitizenSuggestion[] }>(withRegion('/api/suggestions', regionId));
  return data.suggestions || [];
}

export async function createSuggestion(
  payload: {
    reporter_name: string;
    contact: string;
    category: string;
    location_name: string;
    message: string;
    lng: number | null;
    lat: number | null;
  },
  regionId?: string
): Promise<{ suggestion: CitizenSuggestion }> {
  return apiFetch(withRegion('/api/suggestions', regionId), { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateSuggestionStatus(
  id: number,
  payload: { status: SuggestionStatus; resolution_note: string; actor: string },
  regionId?: string
): Promise<{ suggestion: CitizenSuggestion }> {
  return apiFetch(withRegion(`/api/suggestions/${id}`, regionId), {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export async function fetchExportBundle(regionId?: string): Promise<ExportBundle> {
  return apiFetch<ExportBundle>(withRegion('/api/export/bundle', regionId));
}
