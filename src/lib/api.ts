import type {
  AuditLogEntry,
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

export function loadEditorName(): string {
  try {
    return localStorage.getItem(EDITOR_NAME_KEY) || 'Relawan Balingka';
  } catch {
    return 'Relawan Balingka';
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

export async function fetchStaticVerifiedSeed(osmContext: GeoFeatureCollection): Promise<{
  waterways: VerifiedWaterwayFeature[];
  structures: VerifiedStructureFeature[];
  suppressedDem: SuppressedDemSegment[];
}> {
  const fetchJson = async <T>(url: string): Promise<T | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  const [wwFc, stFc, supArr] = await Promise.all([
    fetchJson<{ features?: VerifiedWaterwayFeature[] }>('/data/verified-waterways.geojson'),
    fetchJson<{ features?: VerifiedStructureFeature[] }>('/data/verified-structures.geojson'),
    fetchJson<SuppressedDemSegment[]>('/data/suppressed-dem.json')
  ]);

  const waterways =
    Array.isArray(wwFc?.features) && wwFc.features.length > 0
      ? wwFc.features.filter(f => f?.geometry?.type === 'LineString')
      : buildStaticSeedWaterways(osmContext);
  const structures = Array.isArray(stFc?.features)
    ? stFc.features.filter(f => f?.geometry?.type === 'Point')
    : [];
  const suppressedDem = Array.isArray(supArr) ? supArr.filter(s => s && s.seg_id) : [];

  return { waterways, structures, suppressedDem };
}

export async function fetchEditorStatus(): Promise<EditorStatus | null> {
  try {
    return await apiFetch<EditorStatus>('/api/editor/status');
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

export async function fetchWaterwaysState(): Promise<{
  waterways: VerifiedWaterwayFeature[];
  structures: VerifiedStructureFeature[];
  jorongBoundaries: JorongBoundaryFeature[];
  suppressedDem: SuppressedDemSegment[];
  hydroStatus: HydroStatus;
}> {
  const data = await apiFetch<{
    waterways: { features: VerifiedWaterwayFeature[] };
    structures?: { features: VerifiedStructureFeature[] };
    jorongBoundaries?: { features: JorongBoundaryFeature[] };
    suppressedDem: SuppressedDemSegment[];
    hydroStatus?: HydroStatus;
  }>('/api/waterways');
  const waterways = data.waterways?.features || [];
  const structures = data.structures?.features || [];
  const jorongBoundaries = data.jorongBoundaries?.features || [];
  return {
    waterways,
    structures,
    jorongBoundaries,
    suppressedDem: data.suppressedDem || [],
    hydroStatus: data.hydroStatus || {
      dirty: false,
      lastRecomputedAt: null,
      burnedCellCount: 0,
      verifiedWaterwayCount: waterways.length
    }
  };
}

export async function recomputeHydrology(payload: {
  actor: string;
  carveDepthM?: number;
}): Promise<{
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
  return apiFetch('/api/hydrology/recompute', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function createWaterway(payload: {
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
}): Promise<{ feature: VerifiedWaterwayFeature; log: AuditLogEntry }> {
  return apiFetch('/api/waterways', { method: 'POST', body: JSON.stringify(payload) });
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
  }
): Promise<{ feature: VerifiedWaterwayFeature; log: AuditLogEntry }> {
  return apiFetch(`/api/waterways/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteWaterway(id: string, payload: { actor: string; reason: string }): Promise<void> {
  await apiFetch(`/api/waterways/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function createStructure(payload: {
  name: string;
  kind: StructureKind;
  status: Exclude<DrainageStatus, 'unverified'>;
  source: StructureSource;
  source_ref?: string | null;
  size_note: string;
  notes: string;
  coordinates: [number, number];
  actor: string;
  reason: string;
}): Promise<{ feature: VerifiedStructureFeature; log: AuditLogEntry }> {
  return apiFetch('/api/structures', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateStructure(
  id: string,
  payload: {
    name?: string;
    kind?: StructureKind;
    status?: Exclude<DrainageStatus, 'unverified'>;
    size_note?: string;
    notes?: string;
    coordinates?: [number, number];
    actor: string;
    reason: string;
  }
): Promise<{ feature: VerifiedStructureFeature; log: AuditLogEntry }> {
  return apiFetch(`/api/structures/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteStructure(id: string, payload: { actor: string; reason: string }): Promise<void> {
  await apiFetch(`/api/structures/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function createJorongBoundary(payload: {
  name: string;
  status: JorongBoundaryStatus;
  source_note: string;
  coordinates: [number, number][];
  actor: string;
  reason: string;
}): Promise<{ feature: JorongBoundaryFeature; log: AuditLogEntry }> {
  return apiFetch('/api/jorong-boundaries', { method: 'POST', body: JSON.stringify(payload) });
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
  }
): Promise<{ feature: JorongBoundaryFeature; log: AuditLogEntry }> {
  return apiFetch(`/api/jorong-boundaries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteJorongBoundary(id: string, payload: { actor: string; reason: string }): Promise<void> {
  await apiFetch(`/api/jorong-boundaries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function suppressDemSegment(payload: {
  seg_id: string;
  reason: string;
  actor: string;
}): Promise<{ suppressed: SuppressedDemSegment; log: AuditLogEntry }> {
  return apiFetch('/api/dem-segments/suppress', { method: 'POST', body: JSON.stringify(payload) });
}

export async function restoreDemSegment(segId: string, payload: { actor: string; reason: string }): Promise<void> {
  await apiFetch(`/api/dem-segments/${encodeURIComponent(segId)}/suppress`, {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export async function fetchAuditLogs(limit = 150): Promise<AuditLogEntry[]> {
  const data = await apiFetch<{ logs: AuditLogEntry[] }>(`/api/audit?limit=${limit}`);
  return data.logs || [];
}

export async function revertAuditLog(
  logId: number,
  payload: { actor: string; reason: string }
): Promise<{
  log: AuditLogEntry;
  state: {
    waterways: { features: VerifiedWaterwayFeature[] };
    structures?: { features: VerifiedStructureFeature[] };
    suppressedDem: SuppressedDemSegment[];
  };
}> {
  return apiFetch(`/api/audit/${logId}/revert`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function fetchSuggestions(): Promise<CitizenSuggestion[]> {
  const data = await apiFetch<{ suggestions: CitizenSuggestion[] }>('/api/suggestions');
  return data.suggestions || [];
}

export async function createSuggestion(payload: {
  reporter_name: string;
  contact: string;
  category: string;
  location_name: string;
  message: string;
  lng: number | null;
  lat: number | null;
}): Promise<{ suggestion: CitizenSuggestion }> {
  return apiFetch('/api/suggestions', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateSuggestionStatus(
  id: number,
  payload: { status: SuggestionStatus; resolution_note: string; actor: string }
): Promise<{ suggestion: CitizenSuggestion }> {
  return apiFetch(`/api/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function fetchExportBundle(): Promise<ExportBundle> {
  return apiFetch<ExportBundle>('/api/export/bundle');
}
