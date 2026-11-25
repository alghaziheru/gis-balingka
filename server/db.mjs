import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { readVerifiedSeedFiles } from './seed-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadRegionConfig() {
  const cfgPath = path.join(ROOT, 'region.config.json');
  try {
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch {}
  return {
    name: 'Nagari Balingka',
    bbox: { west: 100.278, south: -0.408, east: 100.345, north: -0.314 }
  };
}

const REGION_CFG = loadRegionConfig();
const SUGGESTION_BOUNDS = {
  west: Number(REGION_CFG?.bbox?.west ?? 100.278) - 0.03,
  east: Number(REGION_CFG?.bbox?.east ?? 100.345) + 0.03,
  south: Number(REGION_CFG?.bbox?.south ?? -0.408) - 0.03,
  north: Number(REGION_CFG?.bbox?.north ?? -0.314) + 0.03
};
const DEFAULT_REGION_NAME = String(REGION_CFG?.name || 'Nagari Balingka');

export const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'balingka.db');
export const DEFAULT_SEED_PATH = path.join(ROOT, 'public', 'data', 'osm-context.geojson');

const VALID_KINDS = new Set(['river', 'stream', 'canal', 'drain', 'culvert']);
const VALID_STRUCTURE_KINDS = new Set(['culvert', 'bridge']);
const VALID_JORONG_STATUSES = new Set(['indicative', 'verified']);
const VALID_CALIBRATION_KINDS = new Set(['hwm', 'scour', 'landslide_scar']);
const VALID_STATUSES = new Set(['normal', 'clogged', 'damaged', 'critical']);
const VALID_SUGGESTION_STATUSES = new Set(['open', 'reviewing', 'resolved', 'rejected']);

export function haversineMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeLineLengthMeters(coords) {
  let len = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    len += haversineMeters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return Math.round(len);
}

export function normalizeCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error('Coordinates must contain at least 2 [lng, lat] pairs.');
  }
  const clean = [];
  for (const pt of coords) {
    if (!Array.isArray(pt) || pt.length < 2) {
      throw new Error('Each coordinate must be a [lng, lat] pair.');
    }
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new Error('Coordinates must contain finite numbers.');
    }
    if (lng < 99.5 || lng > 101.5 || lat < -1.5 || lat > 0.5) {
      throw new Error('Coordinates must stay within the Agam / Balingka region bounds.');
    }
    clean.push([Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
  }
  return clean;
}

function normalizeKind(kind, fallback = 'stream') {
  const k = String(kind || fallback).trim().toLowerCase();
  return VALID_KINDS.has(k) ? k : fallback;
}

function normalizeStatus(status, fallback = 'normal') {
  const s = String(status || fallback).trim().toLowerCase();
  return VALID_STATUSES.has(s) ? s : fallback;
}

function normalizeStructureKind(kind, fallback = 'culvert') {
  const k = String(kind || fallback).trim().toLowerCase();
  return VALID_STRUCTURE_KINDS.has(k) ? k : fallback;
}

function normalizePoint(lngInput, latInput) {
  const lng = Number(lngInput);
  const lat = Number(latInput);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error('Point coordinates must contain finite numbers.');
  }
  if (lng < 99.5 || lng > 101.5 || lat < -1.5 || lat > 0.5) {
    throw new Error('Coordinates must stay within the Agam / Balingka region bounds.');
  }
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function normalizePositiveMeters(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || n > 200) {
    throw new Error('Dimension in meters must be between 0 and 200.');
  }
  return Number(n.toFixed(2));
}

function normalizeJorongStatus(status, fallback = 'indicative') {
  const s = String(status || fallback).trim().toLowerCase();
  return VALID_JORONG_STATUSES.has(s) ? s : fallback;
}

function normalizePolygonRing(ringInput) {
  const ring = Array.isArray(ringInput?.[0]?.[0]) ? ringInput[0] : ringInput;
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new Error('Polygon ring must contain at least 3 [lng, lat] pairs.');
  }
  const clean = ring.map(pt => {
    if (!Array.isArray(pt) || pt.length < 2) {
      throw new Error('Each polygon vertex must be a [lng, lat] pair.');
    }
    return normalizePoint(pt[0], pt[1]);
  });
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    clean.push([first[0], first[1]]);
  }
  if (clean.length < 4) {
    throw new Error('Polygon ring must have at least 3 distinct vertices.');
  }
  return clean;
}

function computePolygonAreaHa(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let avgLat = 0;
  for (let i = 0; i < ring.length - 1; i++) avgLat += ring[i][1];
  avgLat /= Math.max(1, ring.length - 1);
  const mPerDegLng = 111320 * Math.max(0.1, Math.cos((avgLat * Math.PI) / 180));
  const mPerDegLat = 110540;
  let area2 = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * mPerDegLng;
    const y1 = ring[i][1] * mPerDegLat;
    const x2 = ring[i + 1][0] * mPerDegLng;
    const y2 = ring[i + 1][1] * mPerDegLat;
    area2 += x1 * y2 - x2 * y1;
  }
  return Number((Math.abs(area2) * 0.5 / 10000).toFixed(1));
}

function jorongRowToFeature(row) {
  return {
    type: 'Feature',
    properties: {
      id: row.id,
      name: row.name,
      status: row.status,
      source_note: row.source_note || '',
      area_ha: Number(row.area_ha || 0),
      updated_by: row.updated_by,
      updated_at: row.updated_at
    },
    geometry: {
      type: 'Polygon',
      coordinates: [JSON.parse(row.coordinates_json)]
    }
  };
}

function jorongRowToSnapshot(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    source_note: row.source_note || '',
    coordinates: JSON.parse(row.coordinates_json),
    area_ha: Number(row.area_ha || 0),
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    deleted: Boolean(row.deleted)
  };
}

function normalizePercent(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error('Percentage must be between 0 and 100.');
  }
  return Number(n.toFixed(1));
}

function normalizeCalibrationKind(kind, fallback = 'hwm') {
  const k = String(kind || fallback).trim().toLowerCase();
  return VALID_CALIBRATION_KINDS.has(k) ? k : fallback;
}

function calibrationMarkRowToFeature(row) {
  return {
    type: 'Feature',
    properties: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      observed_depth_m: row.observed_depth_m ?? null,
      rain_mm_hr: Number(row.rain_mm_hr || 80),
      duration_min: Number(row.duration_min || 180),
      antecedent_5d_mm: Number(row.antecedent_5d_mm ?? 90),
      notes: row.notes || '',
      updated_by: row.updated_by,
      updated_at: row.updated_at
    },
    geometry: {
      type: 'Point',
      coordinates: [row.lng, row.lat]
    }
  };
}

function calibrationMarkRowToSnapshot(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    observed_depth_m: row.observed_depth_m ?? null,
    rain_mm_hr: Number(row.rain_mm_hr || 80),
    duration_min: Number(row.duration_min || 180),
    antecedent_5d_mm: Number(row.antecedent_5d_mm ?? 90),
    notes: row.notes || '',
    lng: row.lng,
    lat: row.lat,
    coordinates: [row.lng, row.lat],
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    deleted: Boolean(row.deleted)
  };
}

function structureRowToFeature(row) {
  return {
    type: 'Feature',
    properties: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      source: row.source,
      source_ref: row.source_ref || null,
      size_note: row.size_note || '',
      opening_width_m: row.opening_width_m ?? null,
      opening_height_m: row.opening_height_m ?? null,
      default_blockage_pct: row.default_blockage_pct ?? null,
      notes: row.notes || '',
      updated_by: row.updated_by,
      updated_at: row.updated_at
    },
    geometry: {
      type: 'Point',
      coordinates: [row.lng, row.lat]
    }
  };
}

function structureRowToSnapshot(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    source: row.source,
    source_ref: row.source_ref || null,
    size_note: row.size_note || '',
    opening_width_m: row.opening_width_m ?? null,
    opening_height_m: row.opening_height_m ?? null,
    default_blockage_pct: row.default_blockage_pct ?? null,
    notes: row.notes || '',
    lng: row.lng,
    lat: row.lat,
    coordinates: [row.lng, row.lat],
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    deleted: Boolean(row.deleted)
  };
}

function rowToFeature(row) {
  return {
    type: 'Feature',
    properties: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      source: row.source,
      source_ref: row.source_ref || null,
      notes: row.notes || '',
      length_m: row.length_m,
      width_pre_m: row.width_pre_m ?? null,
      width_post_m: row.width_post_m ?? null,
      depth_m: row.depth_m ?? null,
      updated_by: row.updated_by,
      updated_at: row.updated_at
    },
    geometry: {
      type: 'LineString',
      coordinates: JSON.parse(row.coordinates_json)
    }
  };
}

function rowToSnapshot(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    source: row.source,
    source_ref: row.source_ref || null,
    notes: row.notes || '',
    coordinates: JSON.parse(row.coordinates_json),
    length_m: row.length_m,
    width_pre_m: row.width_pre_m ?? null,
    width_post_m: row.width_post_m ?? null,
    depth_m: row.depth_m ?? null,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    deleted: Boolean(row.deleted)
  };
}

function parseLogRow(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    actor: row.actor,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    entity_name: row.entity_name,
    reason: row.reason || '',
    before: row.before_json ? JSON.parse(row.before_json) : null,
    after: row.after_json ? JSON.parse(row.after_json) : null,
    reverted_log_id: row.reverted_log_id ?? null
  };
}

export function createStore(dbPath = DEFAULT_DB_PATH, seedGeoJsonPath = DEFAULT_SEED_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS waterways (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      notes TEXT NOT NULL DEFAULT '',
      coordinates_json TEXT NOT NULL,
      length_m INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS suppressed_dem_segments (
      seg_id TEXT PRIMARY KEY,
      reason TEXT NOT NULL DEFAULT '',
      replaced_by_waterway_id TEXT,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      before_json TEXT,
      after_json TEXT,
      reverted_log_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      reporter_name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      location_name TEXT NOT NULL,
      message TEXT NOT NULL,
      lng REAL,
      lat REAL,
      status TEXT NOT NULL DEFAULT 'open',
      resolution_note TEXT NOT NULL DEFAULT '',
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS structures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      size_note TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jorong_boundaries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'indicative',
      source_note TEXT NOT NULL DEFAULT '',
      coordinates_json TEXT NOT NULL,
      area_ha REAL NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS calibration_marks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'hwm',
      observed_depth_m REAL,
      rain_mm_hr REAL NOT NULL DEFAULT 80,
      duration_min INTEGER NOT NULL DEFAULT 180,
      antecedent_5d_mm REAL NOT NULL DEFAULT 90,
      notes TEXT NOT NULL DEFAULT '',
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
  `);

  const wwCols = new Set(db.prepare('PRAGMA table_info(waterways)').all().map(c => c.name));
  if (!wwCols.has('width_pre_m')) db.exec('ALTER TABLE waterways ADD COLUMN width_pre_m REAL;');
  if (!wwCols.has('width_post_m')) db.exec('ALTER TABLE waterways ADD COLUMN width_post_m REAL;');
  if (!wwCols.has('depth_m')) db.exec('ALTER TABLE waterways ADD COLUMN depth_m REAL;');

  const stCols = new Set(db.prepare('PRAGMA table_info(structures)').all().map(c => c.name));
  if (!stCols.has('opening_width_m')) db.exec('ALTER TABLE structures ADD COLUMN opening_width_m REAL;');
  if (!stCols.has('opening_height_m')) db.exec('ALTER TABLE structures ADD COLUMN opening_height_m REAL;');
  if (!stCols.has('default_blockage_pct')) db.exec('ALTER TABLE structures ADD COLUMN default_blockage_pct REAL;');

  function getMeta(key, fallback = null) {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  function setMeta(key, value) {
    db.prepare(`
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  function markHydroDirty() {
    setMeta('hydro_dirty', '1');
  }

  const insertAuditStmt = db.prepare(`
    INSERT INTO audit_logs (
      created_at, actor, action, entity_type, entity_id, entity_name,
      reason, before_json, after_json, reverted_log_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function appendAudit({
    createdAt = new Date().toISOString(),
    actor = 'Editor',
    action,
    entityType,
    entityId,
    entityName,
    reason = '',
    before = null,
    after = null,
    revertedLogId = null
  }) {
    const info = insertAuditStmt.run(
      createdAt,
      String(actor || 'Editor').trim().slice(0, 80) || 'Editor',
      action,
      entityType,
      String(entityId),
      String(entityName || entityId).slice(0, 120),
      String(reason || '').trim().slice(0, 400),
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      revertedLogId
    );
    const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(Number(info.lastInsertRowid));
    return parseLogRow(row);
  }

  function seedInitialDataIfNeeded() {
    const wwCount = db.prepare('SELECT COUNT(*) AS cnt FROM waterways').get().cnt;
    const stCount = db.prepare('SELECT COUNT(*) AS cnt FROM structures').get().cnt;
    const logCount = db.prepare('SELECT COUNT(*) AS cnt FROM audit_logs').get().cnt;
    if (wwCount > 0 || stCount > 0 || logCount > 0) return;
    if (!seedGeoJsonPath) return;

    const now = new Date().toISOString();
    const insertWw = db.prepare(`
      INSERT INTO waterways (
        id, name, kind, status, source, source_ref, notes,
        coordinates_json, length_m, width_pre_m, width_post_m, depth_m, updated_by, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const insertSt = db.prepare(`
      INSERT INTO structures (
        id, name, kind, status, source, source_ref, size_note, opening_width_m, opening_height_m, default_blockage_pct, notes,
        lng, lat, updated_by, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const insertSup = db.prepare(`
      INSERT INTO suppressed_dem_segments (seg_id, reason, replaced_by_waterway_id, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(seg_id) DO NOTHING
    `);

    const seedDir = path.dirname(seedGeoJsonPath);
    const verifiedSeed = readVerifiedSeedFiles(seedDir);

    if (verifiedSeed.hasVerifiedWaterways) {
      const seededSummary = [];
      for (let idx = 0; idx < verifiedSeed.waterways.length; idx++) {
        const f = verifiedSeed.waterways[idx];
        const p = f.properties || {};
        let coords;
        try {
          coords = normalizeCoordinates(f.geometry?.coordinates);
        } catch {
          continue;
        }
        const id = String(p.id || `ww-seed-${idx + 1}`).trim();
        const name = String(p.name || `Alur #${idx + 1}`).trim();
        const kind = normalizeKind(p.kind, 'stream');
        const status = normalizeStatus(p.status, 'normal');
        const source = ['osm', 'dem_promoted', 'manual'].includes(p.source) ? p.source : 'manual';
        const sourceRef = p.source_ref ? String(p.source_ref) : null;
        const notes = String(p.notes || '');
        const lengthM = computeLineLengthMeters(coords);
        const widthPreM = normalizePositiveMeters(p.width_pre_m);
        const widthPostM = normalizePositiveMeters(p.width_post_m);
        const depthM = normalizePositiveMeters(p.depth_m);
        const updatedBy = String(p.updated_by || 'System (Git Seed)');
        const updatedAt = String(p.updated_at || now);
        insertWw.run(
          id, name, kind, status, source, sourceRef, notes,
          JSON.stringify(coords), lengthM, widthPreM, widthPostM, depthM, updatedBy, updatedAt
        );
        seededSummary.push({ id, name, kind, length_m: lengthM });
      }

      let seededStructures = 0;
      for (let idx = 0; idx < verifiedSeed.structures.length; idx++) {
        const f = verifiedSeed.structures[idx];
        const p = f.properties || {};
        let pt;
        try {
          pt = normalizePoint(f.geometry?.coordinates?.[0], f.geometry?.coordinates?.[1]);
        } catch {
          continue;
        }
        const id = String(p.id || `st-seed-${idx + 1}`).trim();
        const name = String(p.name || `Titik #${idx + 1}`).trim();
        const kind = normalizeStructureKind(p.kind, 'culvert');
        const status = normalizeStatus(p.status, 'normal');
        const source = ['manual', 'crossing_promoted', 'osm'].includes(p.source) ? p.source : 'manual';
        const sourceRef = p.source_ref ? String(p.source_ref) : null;
        const sizeNote = String(p.size_note || '');
        const openingWidthM = normalizePositiveMeters(p.opening_width_m);
        const openingHeightM = normalizePositiveMeters(p.opening_height_m);
        const defaultBlockagePct = normalizePercent(p.default_blockage_pct);
        const notes = String(p.notes || '');
        const updatedBy = String(p.updated_by || 'System (Git Seed)');
        const updatedAt = String(p.updated_at || now);
        insertSt.run(
          id, name, kind, status, source, sourceRef, sizeNote, openingWidthM, openingHeightM, defaultBlockagePct, notes,
          pt[0], pt[1], updatedBy, updatedAt
        );
        seededStructures += 1;
      }

      let seededSuppressed = 0;
      for (const s of verifiedSeed.suppressedDem) {
        if (!s?.seg_id) continue;
        insertSup.run(
          String(s.seg_id),
          String(s.reason || ''),
          s.replaced_by_waterway_id ? String(s.replaced_by_waterway_id) : null,
          String(s.updated_by || 'System (Git Seed)'),
          String(s.updated_at || now)
        );
        seededSuppressed += 1;
      }

      if (seededSummary.length > 0) {
        appendAudit({
          createdAt: now,
          actor: 'Sistem (Data Awal)',
          action: 'seed',
          entityType: 'system',
          entityId: 'verified-seed',
          entityName: `Data Awal ${seededSummary.length} Jalur${seededStructures ? ` & ${seededStructures} Titik` : ''} Terverifikasi`,
          reason: 'Muat data awal basis data dari rekaman GeoJSON terverifikasi.',
          before: null,
          after: { seeded: seededSummary, structureCount: seededStructures, suppressedCount: seededSuppressed }
        });
        return;
      }
    }

    if (!fs.existsSync(seedGeoJsonPath)) return;

    const raw = JSON.parse(fs.readFileSync(seedGeoJsonPath, 'utf8'));
    const osmRivers = (raw.features || []).filter(
      f => f?.properties?.kind === 'waterway' && f?.geometry?.type === 'LineString'
    );
    if (osmRivers.length === 0) return;

    const seededSummary = [];
    for (let idx = 0; idx < osmRivers.length; idx++) {
      const f = osmRivers[idx];
      let coords;
      try {
        coords = normalizeCoordinates(f.geometry.coordinates);
      } catch {
        continue;
      }
      const id = `ww-osm-${idx + 1}`;
      const name = String(f.properties?.name || `Alur OSM #${idx + 1}`).trim();
      const kind = normalizeKind(f.properties?.waterway, 'stream');
      const lengthM = computeLineLengthMeters(coords);
      const sourceRef = String(f.properties?.id || id);
      const notes = 'Data awal dari jaringan sungai OpenStreetMap Nagari Balingka.';
      insertWw.run(id, name, kind, 'normal', 'osm', sourceRef, notes, JSON.stringify(coords), lengthM, null, null, null, 'Sistem (Data Awal OSM)', now);
      seededSummary.push({ id, name, kind, length_m: lengthM });
    }

    if (seededSummary.length > 0) {
      appendAudit({
        createdAt: now,
        actor: 'Sistem (Data Awal OSM)',
        action: 'seed',
        entityType: 'system',
        entityId: 'osm-seed',
        entityName: `Data Awal ${seededSummary.length} Sungai OSM`,
        reason: 'Muat data awal basis data dari jaringan sungai OpenStreetMap.',
        before: null,
        after: { seeded: seededSummary }
      });
    }
  }

  seedInitialDataIfNeeded();

  return {
    getHydroStatus() {
      const verifiedWaterwayCount = db
        .prepare('SELECT COUNT(*) AS cnt FROM waterways WHERE deleted = 0')
        .get().cnt;
      return {
        dirty: getMeta('hydro_dirty', '0') === '1',
        lastRecomputedAt: getMeta('last_hydro_recompute_at', null),
        burnedCellCount: Number(getMeta('last_burned_cells', '0')) || 0,
        verifiedWaterwayCount
      };
    },

    getState() {
      const wwRows = db
        .prepare('SELECT * FROM waterways WHERE deleted = 0 ORDER BY updated_at DESC, name ASC')
        .all();
      const stRows = db
        .prepare('SELECT * FROM structures WHERE deleted = 0 ORDER BY updated_at DESC, name ASC')
        .all();
      const supRows = db
        .prepare('SELECT * FROM suppressed_dem_segments ORDER BY updated_at DESC')
        .all();
      const jbRows = db
        .prepare('SELECT * FROM jorong_boundaries WHERE deleted = 0 ORDER BY name ASC')
        .all();
      const calRows = db
        .prepare('SELECT * FROM calibration_marks WHERE deleted = 0 ORDER BY updated_at DESC, name ASC')
        .all();
      let calibrationProfile = null;
      const rawProf = getMeta('calibration_profile_json', null);
      if (rawProf) {
        try {
          calibrationProfile = JSON.parse(rawProf);
        } catch {}
      }
      return {
        waterways: {
          type: 'FeatureCollection',
          features: wwRows.map(rowToFeature)
        },
        structures: {
          type: 'FeatureCollection',
          features: stRows.map(structureRowToFeature)
        },
        jorongBoundaries: {
          type: 'FeatureCollection',
          features: jbRows.map(jorongRowToFeature)
        },
        calibrationMarks: {
          type: 'FeatureCollection',
          features: calRows.map(calibrationMarkRowToFeature)
        },
        calibrationProfile,
        suppressedDem: supRows.map(r => ({
          seg_id: r.seg_id,
          reason: r.reason || '',
          replaced_by_waterway_id: r.replaced_by_waterway_id || null,
          updated_by: r.updated_by,
          updated_at: r.updated_at
        })),
        hydroStatus: this.getHydroStatus()
      };
    },

    createCalibrationMark(payload) {
      const name = String(payload?.name || '').trim();
      if (!name) throw new Error('Calibration mark name is required.');
      const coordInput = Array.isArray(payload?.coordinates)
        ? payload.coordinates
        : [payload?.lng, payload?.lat];
      const [lng, lat] = normalizePoint(coordInput[0], coordInput[1]);
      const kind = normalizeCalibrationKind(payload?.kind, 'hwm');
      const observedDepthM =
        payload?.observed_depth_m !== undefined && payload?.observed_depth_m !== null && payload?.observed_depth_m !== ''
          ? normalizePositiveMeters(payload.observed_depth_m)
          : null;
      const rainMmHr = Math.max(10, Math.min(250, Number(payload?.rain_mm_hr) || 80));
      const durationMin = Math.max(15, Math.min(720, Math.round(Number(payload?.duration_min) || 180)));
      const antecedent5dMm = Math.max(0, Math.min(300, Number(payload?.antecedent_5d_mm ?? 90) || 0));
      const notes = String(payload?.notes || '').trim().slice(0, 600);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Tambah titik benchmark kalibrasi lapangan';
      const id = `cal-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO calibration_marks (
          id, name, kind, observed_depth_m, rain_mm_hr, duration_min, antecedent_5d_mm, notes,
          lng, lat, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(id, name.slice(0, 120), kind, observedDepthM, rainMmHr, durationMin, antecedent5dMm, notes, lng, lat, actor, now);

      const row = db.prepare('SELECT * FROM calibration_marks WHERE id = ?').get(id);
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'create_calibration_mark',
        entityType: 'calibration_mark',
        entityId: id,
        entityName: name,
        reason,
        before: null,
        after: calibrationMarkRowToSnapshot(row)
      });
      return { feature: calibrationMarkRowToFeature(row), log };
    },

    updateCalibrationMark(id, payload) {
      const existing = db.prepare('SELECT * FROM calibration_marks WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Calibration mark not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = calibrationMarkRowToSnapshot(existing);
      const name = payload?.name !== undefined ? String(payload.name).trim() : existing.name;
      if (!name) throw new Error('Calibration mark name cannot be empty.');
      const kind = payload?.kind !== undefined ? normalizeCalibrationKind(payload.kind, existing.kind) : existing.kind;
      const observedDepthM =
        payload?.observed_depth_m !== undefined
          ? payload.observed_depth_m === null || payload.observed_depth_m === ''
            ? null
            : normalizePositiveMeters(payload.observed_depth_m)
          : existing.observed_depth_m;
      const rainMmHr =
        payload?.rain_mm_hr !== undefined ? Math.max(10, Math.min(250, Number(payload.rain_mm_hr) || existing.rain_mm_hr)) : existing.rain_mm_hr;
      const durationMin =
        payload?.duration_min !== undefined ? Math.max(15, Math.min(720, Math.round(Number(payload.duration_min) || existing.duration_min))) : existing.duration_min;
      const antecedent5dMm =
        payload?.antecedent_5d_mm !== undefined ? Math.max(0, Math.min(300, Number(payload.antecedent_5d_mm) || 0)) : existing.antecedent_5d_mm;
      const notes = payload?.notes !== undefined ? String(payload.notes).trim().slice(0, 600) : existing.notes;
      let lng = existing.lng;
      let lat = existing.lat;
      if (Array.isArray(payload?.coordinates) && payload.coordinates.length >= 2) {
        [lng, lat] = normalizePoint(payload.coordinates[0], payload.coordinates[1]);
      }
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Perbarui titik benchmark kalibrasi';
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE calibration_marks
        SET name = ?, kind = ?, observed_depth_m = ?, rain_mm_hr = ?, duration_min = ?, antecedent_5d_mm = ?,
            notes = ?, lng = ?, lat = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(name.slice(0, 120), kind, observedDepthM, rainMmHr, durationMin, antecedent5dMm, notes, lng, lat, actor, now, id);

      const updated = db.prepare('SELECT * FROM calibration_marks WHERE id = ?').get(id);
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'update_calibration_mark',
        entityType: 'calibration_mark',
        entityId: id,
        entityName: name,
        reason,
        before,
        after: calibrationMarkRowToSnapshot(updated)
      });
      return { feature: calibrationMarkRowToFeature(updated), log };
    },

    deleteCalibrationMark(id, payload = {}) {
      const existing = db.prepare('SELECT * FROM calibration_marks WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Calibration mark not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = calibrationMarkRowToSnapshot(existing);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Hapus titik benchmark kalibrasi';
      const now = new Date().toISOString();
      db.prepare('UPDATE calibration_marks SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(actor, now, id);
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'delete_calibration_mark',
        entityType: 'calibration_mark',
        entityId: id,
        entityName: existing.name,
        reason,
        before,
        after: null
      });
      return { deletedId: id, log };
    },

    saveCalibrationProfile(payload) {
      const manningMult = Math.max(0.65, Math.min(1.5, Number(payload?.manningMult) || 1.0));
      const cnOffset = Math.max(-8, Math.min(8, Number(payload?.cnOffset) || 0));
      const cohesionMult = Math.max(0.7, Math.min(1.4, Number(payload?.cohesionMult) || 1.0));
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Simpan profil kalibrasi parameter hidrologi';
      const now = new Date().toISOString();

      let before = null;
      const prevRaw = getMeta('calibration_profile_json', null);
      if (prevRaw) {
        try {
          before = JSON.parse(prevRaw);
        } catch {}
      }

      const nextProfile = {
        manningMult: Number(manningMult.toFixed(3)),
        cnOffset: Number(cnOffset.toFixed(1)),
        cohesionMult: Number(cohesionMult.toFixed(3)),
        rmseM: payload?.rmseM != null && Number.isFinite(Number(payload.rmseM)) ? Number(Number(payload.rmseM).toFixed(2)) : null,
        scourCsi: payload?.scourCsi != null && Number.isFinite(Number(payload.scourCsi)) ? Number(Number(payload.scourCsi).toFixed(1)) : null,
        landslideAuc: payload?.landslideAuc != null && Number.isFinite(Number(payload.landslideAuc)) ? Number(Number(payload.landslideAuc).toFixed(3)) : null,
        notes: String(payload?.notes || '').trim().slice(0, 300),
        updatedBy: actor,
        updatedAt: now
      };
      setMeta('calibration_profile_json', JSON.stringify(nextProfile));

      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'update_calibration_profile',
        entityType: 'calibration_profile',
        entityId: 'regional-profile',
        entityName: 'Profil Kalibrasi Hidrologi',
        reason,
        before,
        after: nextProfile
      });
      return { profile: nextProfile, log };
    },

    createStructure(payload) {
      const name = String(payload?.name || '').trim();
      if (!name) throw new Error('Structure name is required.');
      const coordInput = Array.isArray(payload?.coordinates)
        ? payload.coordinates
        : [payload?.lng, payload?.lat];
      const [lng, lat] = normalizePoint(coordInput[0], coordInput[1]);
      const kind = normalizeStructureKind(payload?.kind, 'culvert');
      const status = normalizeStatus(payload?.status, 'normal');
      const source = ['manual', 'crossing_promoted', 'osm'].includes(payload?.source)
        ? payload.source
        : 'manual';
      const sourceRef = payload?.source_ref ? String(payload.source_ref).trim() : null;
      const sizeNote = String(payload?.size_note || '').trim().slice(0, 120);
      const openingWidthM = normalizePositiveMeters(payload?.opening_width_m);
      const openingHeightM = normalizePositiveMeters(payload?.opening_height_m);
      const defaultBlockagePct = normalizePercent(payload?.default_blockage_pct);
      const notes = String(payload?.notes || '').trim();
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason =
        String(payload?.reason || '').trim() ||
        (source === 'crossing_promoted'
          ? 'Verifikasi titik perlintasan gorong-gorong / jembatan'
          : 'Tambah titik gorong-gorong / jembatan terverifikasi');
      const id = `st-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO structures (
          id, name, kind, status, source, source_ref, size_note, opening_width_m, opening_height_m, default_blockage_pct, notes,
          lng, lat, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        id, name, kind, status, source, sourceRef, sizeNote, openingWidthM, openingHeightM, defaultBlockagePct, notes,
        lng, lat, actor, now
      );

      const row = db.prepare('SELECT * FROM structures WHERE id = ?').get(id);
      const snapshot = structureRowToSnapshot(row);
      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: source === 'crossing_promoted' ? 'verify_crossing' : 'create_structure',
        entityType: 'structure',
        entityId: id,
        entityName: name,
        reason,
        before: null,
        after: snapshot
      });
      return { feature: structureRowToFeature(row), log };
    },

    updateStructure(id, payload) {
      const existing = db.prepare('SELECT * FROM structures WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Structure not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = structureRowToSnapshot(existing);
      const name = payload?.name !== undefined ? String(payload.name).trim() : existing.name;
      if (!name) throw new Error('Structure name cannot be empty.');
      const kind = payload?.kind !== undefined ? normalizeStructureKind(payload.kind, existing.kind) : existing.kind;
      const status = payload?.status !== undefined ? normalizeStatus(payload.status, existing.status) : existing.status;
      const sizeNote = payload?.size_note !== undefined ? String(payload.size_note).trim().slice(0, 120) : existing.size_note;
      const openingWidthM =
        payload?.opening_width_m !== undefined ? normalizePositiveMeters(payload.opening_width_m) : existing.opening_width_m ?? null;
      const openingHeightM =
        payload?.opening_height_m !== undefined ? normalizePositiveMeters(payload.opening_height_m) : existing.opening_height_m ?? null;
      const defaultBlockagePct =
        payload?.default_blockage_pct !== undefined ? normalizePercent(payload.default_blockage_pct) : existing.default_blockage_pct ?? null;
      const notes = payload?.notes !== undefined ? String(payload.notes).trim() : existing.notes;
      let lng = existing.lng;
      let lat = existing.lat;
      if (Array.isArray(payload?.coordinates) && payload.coordinates.length >= 2) {
        [lng, lat] = normalizePoint(payload.coordinates[0], payload.coordinates[1]);
      } else if (payload?.lng !== undefined && payload?.lat !== undefined) {
        [lng, lat] = normalizePoint(payload.lng, payload.lat);
      }
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Perbarui kondisi gorong-gorong / jembatan';
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE structures
        SET name = ?, kind = ?, status = ?, size_note = ?, opening_width_m = ?, opening_height_m = ?, default_blockage_pct = ?,
            notes = ?, lng = ?, lat = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name, kind, status, sizeNote, openingWidthM, openingHeightM, defaultBlockagePct,
        notes, lng, lat, actor, now, id
      );

      const updated = db.prepare('SELECT * FROM structures WHERE id = ?').get(id);
      const after = structureRowToSnapshot(updated);
      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'update_structure',
        entityType: 'structure',
        entityId: id,
        entityName: name,
        reason,
        before,
        after
      });
      return { feature: structureRowToFeature(updated), log };
    },

    deleteStructure(id, payload = {}) {
      const existing = db.prepare('SELECT * FROM structures WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Structure not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = structureRowToSnapshot(existing);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Hapus titik gorong-gorong / jembatan';
      const now = new Date().toISOString();

      db.prepare('UPDATE structures SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(actor, now, id);
      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'delete_structure',
        entityType: 'structure',
        entityId: id,
        entityName: existing.name,
        reason,
        before,
        after: null
      });
      return { deletedId: id, log };
    },

    createJorongBoundary(payload) {
      const name = String(payload?.name || '').trim();
      if (!name) throw new Error('Jorong boundary name is required.');
      const ring = normalizePolygonRing(payload?.coordinates);
      const status = normalizeJorongStatus(payload?.status, 'indicative');
      const sourceNote = String(payload?.source_note || '').trim().slice(0, 240);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Tambah batas jorong';
      const areaHa = computePolygonAreaHa(ring);
      const id = `jb-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO jorong_boundaries (
          id, name, status, source_note, coordinates_json, area_ha, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(id, name.slice(0, 100), status, sourceNote, JSON.stringify(ring), areaHa, actor, now);

      const row = db.prepare('SELECT * FROM jorong_boundaries WHERE id = ?').get(id);
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'create_jorong',
        entityType: 'jorong_boundary',
        entityId: id,
        entityName: name,
        reason,
        before: null,
        after: jorongRowToSnapshot(row)
      });
      return { feature: jorongRowToFeature(row), log };
    },

    updateJorongBoundary(id, payload) {
      const existing = db.prepare('SELECT * FROM jorong_boundaries WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Jorong boundary not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = jorongRowToSnapshot(existing);
      const name = payload?.name !== undefined ? String(payload.name).trim() : existing.name;
      if (!name) throw new Error('Jorong boundary name cannot be empty.');
      const status = payload?.status !== undefined ? normalizeJorongStatus(payload.status, existing.status) : existing.status;
      const sourceNote =
        payload?.source_note !== undefined ? String(payload.source_note).trim().slice(0, 240) : existing.source_note;
      const ring =
        payload?.coordinates !== undefined
          ? normalizePolygonRing(payload.coordinates)
          : JSON.parse(existing.coordinates_json);
      const areaHa = computePolygonAreaHa(ring);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Perbarui batas jorong';
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE jorong_boundaries
        SET name = ?, status = ?, source_note = ?, coordinates_json = ?, area_ha = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(name.slice(0, 100), status, sourceNote, JSON.stringify(ring), areaHa, actor, now, id);

      const updated = db.prepare('SELECT * FROM jorong_boundaries WHERE id = ?').get(id);
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'update_jorong',
        entityType: 'jorong_boundary',
        entityId: id,
        entityName: name,
        reason,
        before,
        after: jorongRowToSnapshot(updated)
      });
      return { feature: jorongRowToFeature(updated), log };
    },

    deleteJorongBoundary(id, payload = {}) {
      const existing = db.prepare('SELECT * FROM jorong_boundaries WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Jorong boundary not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = jorongRowToSnapshot(existing);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Hapus batas jorong';
      const now = new Date().toISOString();
      db.prepare('UPDATE jorong_boundaries SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(actor, now, id);
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'delete_jorong',
        entityType: 'jorong_boundary',
        entityId: id,
        entityName: existing.name,
        reason,
        before,
        after: null
      });
      return { deletedId: id, log };
    },

    createWaterway(payload) {
      const name = String(payload?.name || '').trim();
      if (!name) throw new Error('Waterway name is required.');
      const coords = normalizeCoordinates(payload?.coordinates);
      const kind = normalizeKind(payload?.kind, 'stream');
      const status = normalizeStatus(payload?.status, 'normal');
      const source = ['osm', 'dem_promoted', 'manual'].includes(payload?.source) ? payload.source : 'manual';
      const sourceRef = payload?.source_ref ? String(payload.source_ref).trim() : null;
      const notes = String(payload?.notes || '').trim();
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || (source === 'dem_promoted' ? 'Verifikasi & koreksi segmen DEM' : 'Tambah jalur sungai/drainase');
      const id = `ww-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const lengthM = computeLineLengthMeters(coords);
      const widthPreM = normalizePositiveMeters(payload?.width_pre_m);
      const widthPostM = normalizePositiveMeters(payload?.width_post_m);
      const depthM = normalizePositiveMeters(payload?.depth_m);

      db.prepare(`
        INSERT INTO waterways (
          id, name, kind, status, source, source_ref, notes,
          coordinates_json, length_m, width_pre_m, width_post_m, depth_m, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        id, name, kind, status, source, sourceRef, notes,
        JSON.stringify(coords), lengthM, widthPreM, widthPostM, depthM, actor, now
      );

      if (source === 'dem_promoted' && sourceRef) {
        db.prepare(`
          INSERT INTO suppressed_dem_segments (seg_id, reason, replaced_by_waterway_id, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(seg_id) DO UPDATE SET
            reason = excluded.reason,
            replaced_by_waterway_id = excluded.replaced_by_waterway_id,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `).run(sourceRef, reason, id, actor, now);
      }

      const row = db.prepare('SELECT * FROM waterways WHERE id = ?').get(id);
      const snapshot = rowToSnapshot(row);
      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: source === 'dem_promoted' ? 'promote_dem' : 'create',
        entityType: 'waterway',
        entityId: id,
        entityName: name,
        reason,
        before: null,
        after: snapshot
      });
      return { feature: rowToFeature(row), log };
    },

    updateWaterway(id, payload) {
      const existing = db.prepare('SELECT * FROM waterways WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Waterway not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = rowToSnapshot(existing);
      const name = payload?.name !== undefined ? String(payload.name).trim() : existing.name;
      if (!name) throw new Error('Waterway name cannot be empty.');
      const kind = payload?.kind !== undefined ? normalizeKind(payload.kind, existing.kind) : existing.kind;
      const status = payload?.status !== undefined ? normalizeStatus(payload.status, existing.status) : existing.status;
      const notes = payload?.notes !== undefined ? String(payload.notes).trim() : existing.notes;
      const coords = payload?.coordinates !== undefined
        ? normalizeCoordinates(payload.coordinates)
        : JSON.parse(existing.coordinates_json);
      const lengthM = computeLineLengthMeters(coords);
      const widthPreM =
        payload?.width_pre_m !== undefined ? normalizePositiveMeters(payload.width_pre_m) : existing.width_pre_m ?? null;
      const widthPostM =
        payload?.width_post_m !== undefined ? normalizePositiveMeters(payload.width_post_m) : existing.width_post_m ?? null;
      const depthM =
        payload?.depth_m !== undefined ? normalizePositiveMeters(payload.depth_m) : existing.depth_m ?? null;
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Koreksi jalur & atribut';
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE waterways
        SET name = ?, kind = ?, status = ?, notes = ?, coordinates_json = ?, length_m = ?,
            width_pre_m = ?, width_post_m = ?, depth_m = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name, kind, status, notes, JSON.stringify(coords), lengthM,
        widthPreM, widthPostM, depthM, actor, now, id
      );

      const updated = db.prepare('SELECT * FROM waterways WHERE id = ?').get(id);
      const after = rowToSnapshot(updated);
      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'update',
        entityType: 'waterway',
        entityId: id,
        entityName: name,
        reason,
        before,
        after
      });
      return { feature: rowToFeature(updated), log };
    },

    deleteWaterway(id, payload = {}) {
      const existing = db.prepare('SELECT * FROM waterways WHERE id = ? AND deleted = 0').get(id);
      if (!existing) {
        const err = new Error('Waterway not found.');
        err.statusCode = 404;
        throw err;
      }
      const before = rowToSnapshot(existing);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Hapus jalur terverifikasi';
      const now = new Date().toISOString();

      db.prepare('UPDATE waterways SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(actor, now, id);
      markHydroDirty();

      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'delete',
        entityType: 'waterway',
        entityId: id,
        entityName: existing.name,
        reason,
        before,
        after: null
      });
      return { deletedId: id, log };
    },

    suppressDemSegment(payload) {
      const segId = String(payload?.seg_id || '').trim();
      if (!segId) throw new Error('seg_id is required.');
      const existing = db.prepare('SELECT * FROM suppressed_dem_segments WHERE seg_id = ?').get(segId);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Segmen DEM tidak sesuai kondisi lapangan';
      const replacedBy = payload?.replaced_by_waterway_id ? String(payload.replaced_by_waterway_id) : null;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO suppressed_dem_segments (seg_id, reason, replaced_by_waterway_id, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(seg_id) DO UPDATE SET
          reason = excluded.reason,
          replaced_by_waterway_id = COALESCE(excluded.replaced_by_waterway_id, suppressed_dem_segments.replaced_by_waterway_id),
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(segId, reason, replacedBy, actor, now);

      const row = db.prepare('SELECT * FROM suppressed_dem_segments WHERE seg_id = ?').get(segId);
      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'suppress_dem',
        entityType: 'dem_segment',
        entityId: segId,
        entityName: `Segmen DEM ${segId}`,
        reason,
        before: existing || null,
        after: row
      });
      return { suppressed: row, log };
    },

    restoreDemSegment(segId, payload = {}) {
      const cleanId = String(segId || '').trim();
      const existing = db.prepare('SELECT * FROM suppressed_dem_segments WHERE seg_id = ?').get(cleanId);
      if (!existing) {
        const err = new Error('Suppressed DEM segment not found.');
        err.statusCode = 404;
        throw err;
      }
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Tampilkan kembali segmen DEM';
      const now = new Date().toISOString();

      db.prepare('DELETE FROM suppressed_dem_segments WHERE seg_id = ?').run(cleanId);
      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'restore_dem',
        entityType: 'dem_segment',
        entityId: cleanId,
        entityName: `Segmen DEM ${cleanId}`,
        reason,
        before: existing,
        after: null
      });
      return { restoredId: cleanId, log };
    },

    listAuditLogs(limit = 100) {
      const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(safeLimit);
      return rows.map(parseLogRow);
    },

    revertAuditLog(logId, payload = {}) {
      const idNum = Number(logId);
      const targetRow = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(idNum);
      if (!targetRow) {
        const err = new Error('Audit log entry not found.');
        err.statusCode = 404;
        throw err;
      }
      const target = parseLogRow(targetRow);
      if (target.action === 'seed' || target.action === 'recompute_hydrology') {
        throw new Error('This system entry cannot be reverted.');
      }

      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || `Revert perubahan #${target.id}`;
      const now = new Date().toISOString();

      if (target.entity_type === 'waterway') {
        const curRow = db.prepare('SELECT * FROM waterways WHERE id = ?').get(target.entity_id);
        const currentSnapshot = curRow && !curRow.deleted ? rowToSnapshot(curRow) : null;

        if (!target.before) {
          // Reverting a create or promote_dem -> soft delete waterway & restore DEM if promoted
          db.prepare('UPDATE waterways SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(
            actor,
            now,
            target.entity_id
          );
          if (target.action === 'promote_dem' && target.after?.source_ref) {
            db.prepare('DELETE FROM suppressed_dem_segments WHERE seg_id = ?').run(target.after.source_ref);
          }
          markHydroDirty();
          const log = appendAudit({
            createdAt: now,
            actor,
            action: 'revert',
            entityType: 'waterway',
            entityId: target.entity_id,
            entityName: target.entity_name,
            reason,
            before: currentSnapshot,
            after: null,
            revertedLogId: target.id
          });
          return { log, state: this.getState() };
        }

        // Restore target.before snapshot
        const snap = target.before;
        const coords = normalizeCoordinates(snap.coordinates);
        const lenM = computeLineLengthMeters(coords);
        db.prepare(`
          INSERT INTO waterways (
            id, name, kind, status, source, source_ref, notes,
            coordinates_json, length_m, width_pre_m, width_post_m, depth_m, updated_by, updated_at, deleted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            status = excluded.status,
            source = excluded.source,
            source_ref = excluded.source_ref,
            notes = excluded.notes,
            coordinates_json = excluded.coordinates_json,
            length_m = excluded.length_m,
            width_pre_m = excluded.width_pre_m,
            width_post_m = excluded.width_post_m,
            depth_m = excluded.depth_m,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at,
            deleted = 0
        `).run(
          snap.id,
          snap.name,
          normalizeKind(snap.kind, 'stream'),
          normalizeStatus(snap.status, 'normal'),
          snap.source || 'manual',
          snap.source_ref || null,
          snap.notes || '',
          JSON.stringify(coords),
          lenM,
          normalizePositiveMeters(snap.width_pre_m),
          normalizePositiveMeters(snap.width_post_m),
          normalizePositiveMeters(snap.depth_m),
          actor,
          now
        );
        const restoredRow = db.prepare('SELECT * FROM waterways WHERE id = ?').get(snap.id);
        markHydroDirty();
        const log = appendAudit({
          createdAt: now,
          actor,
          action: 'revert',
          entityType: 'waterway',
          entityId: snap.id,
          entityName: snap.name,
          reason,
          before: currentSnapshot,
          after: rowToSnapshot(restoredRow),
          revertedLogId: target.id
        });
        return { log, state: this.getState() };
      }

      if (target.entity_type === 'dem_segment') {
        const curSup = db.prepare('SELECT * FROM suppressed_dem_segments WHERE seg_id = ?').get(target.entity_id) || null;
        if (!target.before) {
          db.prepare('DELETE FROM suppressed_dem_segments WHERE seg_id = ?').run(target.entity_id);
          markHydroDirty();
          const log = appendAudit({
            createdAt: now,
            actor,
            action: 'revert',
            entityType: 'dem_segment',
            entityId: target.entity_id,
            entityName: target.entity_name,
            reason,
            before: curSup,
            after: null,
            revertedLogId: target.id
          });
          return { log, state: this.getState() };
        }
        const b = target.before;
        db.prepare(`
          INSERT INTO suppressed_dem_segments (seg_id, reason, replaced_by_waterway_id, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(seg_id) DO UPDATE SET
            reason = excluded.reason,
            replaced_by_waterway_id = excluded.replaced_by_waterway_id,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `).run(b.seg_id, b.reason || '', b.replaced_by_waterway_id || null, actor, now);
        const restoredSup = db.prepare('SELECT * FROM suppressed_dem_segments WHERE seg_id = ?').get(b.seg_id);
        markHydroDirty();
        const log = appendAudit({
          createdAt: now,
          actor,
          action: 'revert',
          entityType: 'dem_segment',
          entityId: b.seg_id,
          entityName: target.entity_name,
          reason,
          before: curSup,
          after: restoredSup,
          revertedLogId: target.id
        });
        return { log, state: this.getState() };
      }

      if (target.entity_type === 'structure') {
        const curRow = db.prepare('SELECT * FROM structures WHERE id = ?').get(target.entity_id);
        const currentSnapshot = curRow && !curRow.deleted ? structureRowToSnapshot(curRow) : null;

        if (!target.before) {
          db.prepare('UPDATE structures SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(
            actor,
            now,
            target.entity_id
          );
          markHydroDirty();
          const log = appendAudit({
            createdAt: now,
            actor,
            action: 'revert',
            entityType: 'structure',
            entityId: target.entity_id,
            entityName: target.entity_name,
            reason,
            before: currentSnapshot,
            after: null,
            revertedLogId: target.id
          });
          return { log, state: this.getState() };
        }

        const snap = target.before;
        const [lng, lat] = normalizePoint(snap.lng ?? snap.coordinates?.[0], snap.lat ?? snap.coordinates?.[1]);
        db.prepare(`
          INSERT INTO structures (
            id, name, kind, status, source, source_ref, size_note, opening_width_m, opening_height_m, default_blockage_pct, notes,
            lng, lat, updated_by, updated_at, deleted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            status = excluded.status,
            source = excluded.source,
            source_ref = excluded.source_ref,
            size_note = excluded.size_note,
            opening_width_m = excluded.opening_width_m,
            opening_height_m = excluded.opening_height_m,
            default_blockage_pct = excluded.default_blockage_pct,
            notes = excluded.notes,
            lng = excluded.lng,
            lat = excluded.lat,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at,
            deleted = 0
        `).run(
          snap.id,
          snap.name,
          normalizeStructureKind(snap.kind, 'culvert'),
          normalizeStatus(snap.status, 'normal'),
          snap.source || 'manual',
          snap.source_ref || null,
          snap.size_note || '',
          normalizePositiveMeters(snap.opening_width_m),
          normalizePositiveMeters(snap.opening_height_m),
          normalizePercent(snap.default_blockage_pct),
          snap.notes || '',
          lng,
          lat,
          actor,
          now
        );
        const restoredRow = db.prepare('SELECT * FROM structures WHERE id = ?').get(snap.id);
        markHydroDirty();
        const log = appendAudit({
          createdAt: now,
          actor,
          action: 'revert',
          entityType: 'structure',
          entityId: snap.id,
          entityName: snap.name,
          reason,
          before: currentSnapshot,
          after: structureRowToSnapshot(restoredRow),
          revertedLogId: target.id
        });
        return { log, state: this.getState() };
      }

      if (target.entity_type === 'jorong_boundary') {
        const curRow = db.prepare('SELECT * FROM jorong_boundaries WHERE id = ?').get(target.entity_id);
        const currentSnapshot = curRow && !curRow.deleted ? jorongRowToSnapshot(curRow) : null;

        if (!target.before) {
          db.prepare('UPDATE jorong_boundaries SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(
            actor,
            now,
            target.entity_id
          );
          const log = appendAudit({
            createdAt: now,
            actor,
            action: 'revert',
            entityType: 'jorong_boundary',
            entityId: target.entity_id,
            entityName: target.entity_name,
            reason,
            before: currentSnapshot,
            after: null,
            revertedLogId: target.id
          });
          return { log, state: this.getState() };
        }

        const snap = target.before;
        const ring = normalizePolygonRing(snap.coordinates);
        const areaHa = computePolygonAreaHa(ring);
        db.prepare(`
          INSERT INTO jorong_boundaries (
            id, name, status, source_note, coordinates_json, area_ha, updated_by, updated_at, deleted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            status = excluded.status,
            source_note = excluded.source_note,
            coordinates_json = excluded.coordinates_json,
            area_ha = excluded.area_ha,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at,
            deleted = 0
        `).run(
          snap.id,
          snap.name,
          normalizeJorongStatus(snap.status, 'indicative'),
          snap.source_note || '',
          JSON.stringify(ring),
          areaHa,
          actor,
          now
        );
        const restoredRow = db.prepare('SELECT * FROM jorong_boundaries WHERE id = ?').get(snap.id);
        const log = appendAudit({
          createdAt: now,
          actor,
          action: 'revert',
          entityType: 'jorong_boundary',
          entityId: snap.id,
          entityName: snap.name,
          reason,
          before: currentSnapshot,
          after: jorongRowToSnapshot(restoredRow),
          revertedLogId: target.id
        });
        return { log, state: this.getState() };
      }

      if (target.entity_type === 'calibration_mark') {
        const curRow = db.prepare('SELECT * FROM calibration_marks WHERE id = ?').get(target.entity_id);
        const currentSnapshot = curRow && !curRow.deleted ? calibrationMarkRowToSnapshot(curRow) : null;

        if (!target.before) {
          db.prepare('UPDATE calibration_marks SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?').run(
            actor,
            now,
            target.entity_id
          );
          const log = appendAudit({
            createdAt: now,
            actor,
            action: 'revert',
            entityType: 'calibration_mark',
            entityId: target.entity_id,
            entityName: target.entity_name,
            reason,
            before: currentSnapshot,
            after: null,
            revertedLogId: target.id
          });
          return { log, state: this.getState() };
        }

        const snap = target.before;
        const [lng, lat] = normalizePoint(snap.lng ?? snap.coordinates?.[0], snap.lat ?? snap.coordinates?.[1]);
        db.prepare(`
          INSERT INTO calibration_marks (
            id, name, kind, observed_depth_m, rain_mm_hr, duration_min, antecedent_5d_mm, notes,
            lng, lat, updated_by, updated_at, deleted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            observed_depth_m = excluded.observed_depth_m,
            rain_mm_hr = excluded.rain_mm_hr,
            duration_min = excluded.duration_min,
            antecedent_5d_mm = excluded.antecedent_5d_mm,
            notes = excluded.notes,
            lng = excluded.lng,
            lat = excluded.lat,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at,
            deleted = 0
        `).run(
          snap.id,
          snap.name,
          normalizeCalibrationKind(snap.kind, 'hwm'),
          snap.observed_depth_m ?? null,
          Number(snap.rain_mm_hr || 80),
          Number(snap.duration_min || 180),
          Number(snap.antecedent_5d_mm ?? 90),
          snap.notes || '',
          lng,
          lat,
          actor,
          now
        );
        const restoredRow = db.prepare('SELECT * FROM calibration_marks WHERE id = ?').get(snap.id);
        const log = appendAudit({
          createdAt: now,
          actor,
          action: 'revert',
          entityType: 'calibration_mark',
          entityId: snap.id,
          entityName: snap.name,
          reason,
          before: currentSnapshot,
          after: calibrationMarkRowToSnapshot(restoredRow),
          revertedLogId: target.id
        });
        return { log, state: this.getState() };
      }

      if (target.entity_type === 'calibration_profile') {
        const prevRaw = getMeta('calibration_profile_json', null);
        const currentProfile = prevRaw ? JSON.parse(prevRaw) : null;
        if (!target.before) {
          db.prepare('DELETE FROM app_meta WHERE key = ?').run('calibration_profile_json');
        } else {
          setMeta('calibration_profile_json', JSON.stringify(target.before));
        }
        const log = appendAudit({
          createdAt: now,
          actor,
          action: 'revert',
          entityType: 'calibration_profile',
          entityId: 'regional-profile',
          entityName: 'Profil Kalibrasi Hidrologi',
          reason,
          before: currentProfile,
          after: target.before || null,
          revertedLogId: target.id
        });
        return { log, state: this.getState() };
      }

      throw new Error(`Audit log of type "${target.entity_type}" cannot be reverted.`);
    },

    markHydroRecomputed({
      actor = 'Editor',
      burnedCellCount = 0,
      verifiedWaterwayCount = 0,
      recomputedAt = new Date().toISOString(),
      summary = {}
    }) {
      setMeta('hydro_dirty', '0');
      setMeta('last_hydro_recompute_at', recomputedAt);
      setMeta('last_burned_cells', String(burnedCellCount));
      db.prepare('DELETE FROM suppressed_dem_segments WHERE replaced_by_waterway_id IS NOT NULL').run();

      const log = appendAudit({
        createdAt: recomputedAt,
        actor,
        action: 'recompute_hydrology',
        entityType: 'system',
        entityId: 'hydrology',
        entityName: 'Penyisipan Jalur & Hidrologi DEM',
        reason: `Sisipkan ${verifiedWaterwayCount} sungai terverifikasi (${burnedCellCount} sel DEM disesuaikan) & hitung ulang peta aliran/HAND.`,
        before: null,
        after: summary
      });
      return { log, hydroStatus: this.getHydroStatus(), state: this.getState() };
    },

    listSuggestions() {
      return db.prepare('SELECT * FROM suggestions ORDER BY id DESC LIMIT 200').all();
    },

    createSuggestion(payload) {
      const reporterName = String(payload?.reporter_name || '').trim();
      const locationName = String(payload?.location_name || '').trim();
      const message = String(payload?.message || '').trim();
      if (!reporterName || !message) {
        throw new Error('Reporter name and message are required.');
      }
      const contact = String(payload?.contact || '').trim().slice(0, 120);
      const category = String(payload?.category || 'waterway_correction').trim().slice(0, 60);
      let lng = payload?.lng !== undefined && payload?.lng !== null && payload?.lng !== '' ? Number(payload.lng) : null;
      let lat = payload?.lat !== undefined && payload?.lat !== null && payload?.lat !== '' ? Number(payload.lat) : null;
      if (lng !== null && lat !== null) {
        if (
          !Number.isFinite(lng) ||
          !Number.isFinite(lat) ||
          lng < SUGGESTION_BOUNDS.west ||
          lng > SUGGESTION_BOUNDS.east ||
          lat < SUGGESTION_BOUNDS.south ||
          lat > SUGGESTION_BOUNDS.north
        ) {
          throw new Error(`Suggestion coordinates must lie inside the ${DEFAULT_REGION_NAME} region bounds.`);
        }
        lng = Number(lng.toFixed(6));
        lat = Number(lat.toFixed(6));
      } else {
        lng = null;
        lat = null;
      }

      const now = new Date().toISOString();
      const info = db.prepare(`
        INSERT INTO suggestions (
          created_at, reporter_name, contact, category, location_name, message, lng, lat, status, resolution_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', '')
      `).run(
        now,
        reporterName.slice(0, 80),
        contact,
        category,
        (locationName || DEFAULT_REGION_NAME).slice(0, 140),
        message.slice(0, 1500),
        lng,
        lat
      );
      return db.prepare('SELECT * FROM suggestions WHERE id = ?').get(Number(info.lastInsertRowid));
    },

    updateSuggestionStatus(id, payload) {
      const existing = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(Number(id));
      if (!existing) {
        const err = new Error('Suggestion not found.');
        err.statusCode = 404;
        throw err;
      }
      const nextStatus = String(payload?.status || '').trim().toLowerCase();
      if (!VALID_SUGGESTION_STATUSES.has(nextStatus)) {
        throw new Error('Invalid suggestion status.');
      }
      const note = String(payload?.resolution_note || '').trim().slice(0, 400);
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const now = new Date().toISOString();
      const resolvedAt = nextStatus === 'resolved' || nextStatus === 'rejected' ? now : null;

      db.prepare(`
        UPDATE suggestions
        SET status = ?, resolution_note = ?, resolved_at = ?
        WHERE id = ?
      `).run(nextStatus, note, resolvedAt, Number(id));

      const updated = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(Number(id));
      appendAudit({
        createdAt: now,
        actor,
        action: 'resolve_suggestion',
        entityType: 'suggestion',
        entityId: String(id),
        entityName: `Saran: ${existing.location_name}`,
        reason: note || `Status saran diubah ke ${nextStatus}`,
        before: { status: existing.status, resolution_note: existing.resolution_note },
        after: { status: updated.status, resolution_note: updated.resolution_note }
      });
      return updated;
    },

    importSeedSnapshot({
      waterways = [],
      structures = [],
      suppressedDem = [],
      actor = 'CLI (import-seed)',
      reason = 'Impor snapshot GeoJSON terverifikasi dari Git'
    }) {
      const now = new Date().toISOString();
      const upsertWw = db.prepare(`
        INSERT INTO waterways (
          id, name, kind, status, source, source_ref, notes,
          coordinates_json, length_m, width_pre_m, width_post_m, depth_m, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          status = excluded.status,
          source = excluded.source,
          source_ref = excluded.source_ref,
          notes = excluded.notes,
          coordinates_json = excluded.coordinates_json,
          length_m = excluded.length_m,
          width_pre_m = COALESCE(excluded.width_pre_m, waterways.width_pre_m),
          width_post_m = COALESCE(excluded.width_post_m, waterways.width_post_m),
          depth_m = COALESCE(excluded.depth_m, waterways.depth_m),
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at,
          deleted = 0
      `);
      const upsertSt = db.prepare(`
        INSERT INTO structures (
          id, name, kind, status, source, source_ref, size_note, opening_width_m, opening_height_m, default_blockage_pct, notes,
          lng, lat, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          status = excluded.status,
          source = excluded.source,
          source_ref = excluded.source_ref,
          size_note = excluded.size_note,
          opening_width_m = COALESCE(excluded.opening_width_m, structures.opening_width_m),
          opening_height_m = COALESCE(excluded.opening_height_m, structures.opening_height_m),
          default_blockage_pct = COALESCE(excluded.default_blockage_pct, structures.default_blockage_pct),
          notes = excluded.notes,
          lng = excluded.lng,
          lat = excluded.lat,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at,
          deleted = 0
      `);
      const upsertSup = db.prepare(`
        INSERT INTO suppressed_dem_segments (seg_id, reason, replaced_by_waterway_id, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(seg_id) DO UPDATE SET
          reason = excluded.reason,
          replaced_by_waterway_id = excluded.replaced_by_waterway_id,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `);

      let importedWaterways = 0;
      let importedStructures = 0;
      let importedSuppressed = 0;

      db.exec('BEGIN;');
      try {
        for (let idx = 0; idx < waterways.length; idx++) {
          const f = waterways[idx];
          const p = f?.properties || {};
          const id = String(p.id || '').trim();
          if (!id) continue;
          const coords = normalizeCoordinates(f.geometry?.coordinates);
          const name = String(p.name || `Alur #${idx + 1}`).trim();
          const kind = normalizeKind(p.kind, 'stream');
          const status = normalizeStatus(p.status, 'normal');
          const source = ['osm', 'dem_promoted', 'manual'].includes(p.source) ? p.source : 'manual';
          const sourceRef = p.source_ref ? String(p.source_ref) : null;
          const notes = String(p.notes || '');
          const lengthM = computeLineLengthMeters(coords);
          const updatedBy = String(p.updated_by || actor);
          const updatedAt = String(p.updated_at || now);
          upsertWw.run(
            id, name, kind, status, source, sourceRef, notes,
            JSON.stringify(coords), lengthM,
            normalizePositiveMeters(p.width_pre_m),
            normalizePositiveMeters(p.width_post_m),
            normalizePositiveMeters(p.depth_m),
            updatedBy, updatedAt
          );
          importedWaterways += 1;
        }

        for (let idx = 0; idx < structures.length; idx++) {
          const f = structures[idx];
          const p = f?.properties || {};
          const id = String(p.id || '').trim();
          if (!id) continue;
          const pt = normalizePoint(f.geometry?.coordinates?.[0], f.geometry?.coordinates?.[1]);
          const name = String(p.name || `Titik #${idx + 1}`).trim();
          const kind = normalizeStructureKind(p.kind, 'culvert');
          const status = normalizeStatus(p.status, 'normal');
          const source = ['manual', 'crossing_promoted', 'osm'].includes(p.source) ? p.source : 'manual';
          const sourceRef = p.source_ref ? String(p.source_ref) : null;
          const sizeNote = String(p.size_note || '');
          const openingWidthM = normalizePositiveMeters(p.opening_width_m);
          const openingHeightM = normalizePositiveMeters(p.opening_height_m);
          const defaultBlockagePct = normalizePercent(p.default_blockage_pct);
          const notes = String(p.notes || '');
          const updatedBy = String(p.updated_by || actor);
          const updatedAt = String(p.updated_at || now);
          upsertSt.run(
            id, name, kind, status, source, sourceRef, sizeNote, openingWidthM, openingHeightM, defaultBlockagePct, notes,
            pt[0], pt[1], updatedBy, updatedAt
          );
          importedStructures += 1;
        }

        for (const s of suppressedDem) {
          if (!s?.seg_id) continue;
          upsertSup.run(
            String(s.seg_id),
            String(s.reason || ''),
            s.replaced_by_waterway_id ? String(s.replaced_by_waterway_id) : null,
            String(s.updated_by || actor),
            String(s.updated_at || now)
          );
          importedSuppressed += 1;
        }
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }

      markHydroDirty();
      const log = appendAudit({
        createdAt: now,
        actor,
        action: 'import_seed',
        entityType: 'system',
        entityId: 'git-seed',
        entityName: `Impor ${importedWaterways} Jalur & ${importedStructures} Titik Terverifikasi`,
        reason,
        before: null,
        after: { importedWaterways, importedStructures, importedSuppressed }
      });
      return { importedWaterways, importedStructures, importedSuppressed, log };
    },

    exportBundle() {
      const state = this.getState();
      const auditLogs = this.listAuditLogs(500);
      const suggestionsCount = db.prepare('SELECT COUNT(*) AS cnt FROM suggestions').get().cnt;
      return {
        exportedAt: new Date().toISOString(),
        verifiedWaterways: state.waterways,
        verifiedStructures: state.structures,
        jorongBoundaries: state.jorongBoundaries,
        calibrationMarks: state.calibrationMarks,
        calibrationProfile: state.calibrationProfile,
        suppressedDem: state.suppressedDem,
        auditLogs,
        suggestionsCount
      };
    },

    close() {
      db.close();
    }
  };
}
