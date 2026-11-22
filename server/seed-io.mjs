import fs from 'node:fs';
import path from 'node:path';

/**
 * Deterministic Git-tracked GeoJSON snapshot helpers for Nagari Balingka GIS.
 * Keeps data/balingka.db gitignored while storing verified waterways, structures,
 * and suppressed DEM segments as clean, diffable JSON/GeoJSON in public/data/.
 */

export function buildCanonicalSeedSnapshots(state) {
  const wwFeatures = [...(state?.waterways?.features || [])]
    .sort((a, b) => String(a?.properties?.id || '').localeCompare(String(b?.properties?.id || '')))
    .map(f => ({
      type: 'Feature',
      properties: {
        id: String(f.properties.id),
        name: String(f.properties.name),
        kind: String(f.properties.kind),
        status: String(f.properties.status),
        source: String(f.properties.source || 'manual'),
        source_ref: f.properties.source_ref ?? null,
        notes: String(f.properties.notes || ''),
        length_m: Number(f.properties.length_m || 0),
        ...(f.properties.width_pre_m != null ? { width_pre_m: Number(f.properties.width_pre_m) } : {}),
        ...(f.properties.width_post_m != null ? { width_post_m: Number(f.properties.width_post_m) } : {}),
        ...(f.properties.depth_m != null ? { depth_m: Number(f.properties.depth_m) } : {}),
        updated_by: String(f.properties.updated_by || 'Editor'),
        updated_at: String(f.properties.updated_at || '')
      },
      geometry: {
        type: 'LineString',
        coordinates: (f.geometry?.coordinates || []).map(c => [Number(c[0]), Number(c[1])])
      }
    }));

  const stFeatures = [...(state?.structures?.features || [])]
    .sort((a, b) => String(a?.properties?.id || '').localeCompare(String(b?.properties?.id || '')))
    .map(f => ({
      type: 'Feature',
      properties: {
        id: String(f.properties.id),
        name: String(f.properties.name),
        kind: String(f.properties.kind),
        status: String(f.properties.status),
        source: String(f.properties.source || 'manual'),
        source_ref: f.properties.source_ref ?? null,
        size_note: String(f.properties.size_note || ''),
        notes: String(f.properties.notes || ''),
        updated_by: String(f.properties.updated_by || 'Editor'),
        updated_at: String(f.properties.updated_at || '')
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(f.geometry?.coordinates?.[0]), Number(f.geometry?.coordinates?.[1])]
      }
    }));

  const suppressedDem = [...(state?.suppressedDem || [])]
    .sort((a, b) => String(a?.seg_id || '').localeCompare(String(b?.seg_id || '')))
    .map(s => ({
      seg_id: String(s.seg_id),
      reason: String(s.reason || ''),
      replaced_by_waterway_id: s.replaced_by_waterway_id ?? null,
      updated_by: String(s.updated_by || 'Editor'),
      updated_at: String(s.updated_at || '')
    }));

  return {
    waterwaysFC: { type: 'FeatureCollection', features: wwFeatures },
    structuresFC: { type: 'FeatureCollection', features: stFeatures },
    suppressedDem
  };
}

export function writeVerifiedSeedFiles(state, targetDirs) {
  const { waterwaysFC, structuresFC, suppressedDem } = buildCanonicalSeedSnapshots(state);
  const uniqueDirs = [];
  const seen = new Set();

  for (const dir of targetDirs || []) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    uniqueDirs.push(resolved);
  }

  for (const dir of uniqueDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'verified-waterways.geojson'),
      JSON.stringify(waterwaysFC, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'verified-structures.geojson'),
      JSON.stringify(structuresFC, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'suppressed-dem.json'),
      JSON.stringify(suppressedDem, null, 2) + '\n'
    );
  }

  return {
    dirs: uniqueDirs,
    waterwayCount: waterwaysFC.features.length,
    structureCount: structuresFC.features.length,
    suppressedCount: suppressedDem.length
  };
}

export function readVerifiedSeedFiles(dataDir) {
  if (!dataDir) {
    return { hasVerifiedWaterways: false, waterways: [], structures: [], suppressedDem: [] };
  }
  const wwPath = path.join(dataDir, 'verified-waterways.geojson');
  const stPath = path.join(dataDir, 'verified-structures.geojson');
  const supPath = path.join(dataDir, 'suppressed-dem.json');

  let waterways = [];
  let hasVerifiedWaterways = false;
  if (fs.existsSync(wwPath)) {
    const fc = JSON.parse(fs.readFileSync(wwPath, 'utf8'));
    if (Array.isArray(fc?.features) && fc.features.length > 0) {
      waterways = fc.features.filter(f => f?.geometry?.type === 'LineString');
      hasVerifiedWaterways = waterways.length > 0;
    }
  }

  let structures = [];
  if (fs.existsSync(stPath)) {
    const fc = JSON.parse(fs.readFileSync(stPath, 'utf8'));
    if (Array.isArray(fc?.features)) {
      structures = fc.features.filter(f => f?.geometry?.type === 'Point');
    }
  }

  let suppressedDem = [];
  if (fs.existsSync(supPath)) {
    const arr = JSON.parse(fs.readFileSync(supPath, 'utf8'));
    if (Array.isArray(arr)) {
      suppressedDem = arr.filter(s => s && s.seg_id);
    }
  }

  return { hasVerifiedWaterways, waterways, structures, suppressedDem };
}
