import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { readVerifiedSeedFiles } from './seed-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'balingka.db');
export const DEFAULT_SEED_PATH = path.join(ROOT, 'public', 'data', 'osm-context.geojson');

const VALID_KINDS = new Set(['river', 'stream', 'canal', 'drain', 'culvert']);
const VALID_STRUCTURE_KINDS = new Set(['culvert', 'bridge']);
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
  `);

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
        coordinates_json, length_m, updated_by, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const insertSt = db.prepare(`
      INSERT INTO structures (
        id, name, kind, status, source, source_ref, size_note, notes,
        lng, lat, updated_by, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
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
        const updatedBy = String(p.updated_by || 'System (Git Seed)');
        const updatedAt = String(p.updated_at || now);
        insertWw.run(id, name, kind, status, source, sourceRef, notes, JSON.stringify(coords), lengthM, updatedBy, updatedAt);
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
        const notes = String(p.notes || '');
        const updatedBy = String(p.updated_by || 'System (Git Seed)');
        const updatedAt = String(p.updated_at || now);
        insertSt.run(id, name, kind, status, source, sourceRef, sizeNote, notes, pt[0], pt[1], updatedBy, updatedAt);
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
          actor: 'System (Git Seed)',
          action: 'seed',
          entityType: 'system',
          entityId: 'verified-seed',
          entityName: `Seed ${seededSummary.length} Jalur${seededStructures ? ` & ${seededStructures} Titik` : ''} Terverifikasi`,
          reason: 'Inisialisasi database SQLite dari snapshot GeoJSON terverifikasi di repo.',
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
      const notes = 'Seed awal dari jaringan sungai OpenStreetMap Nagari Balingka.';
      insertWw.run(id, name, kind, 'normal', 'osm', sourceRef, notes, JSON.stringify(coords), lengthM, 'System (OSM Seed)', now);
      seededSummary.push({ id, name, kind, length_m: lengthM });
    }

    if (seededSummary.length > 0) {
      appendAudit({
        createdAt: now,
        actor: 'System (OSM Seed)',
        action: 'seed',
        entityType: 'system',
        entityId: 'osm-seed',
        entityName: `Seed ${seededSummary.length} Sungai OSM`,
        reason: 'Inisialisasi database SQLite dari sungai terpetakan OpenStreetMap.',
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
      return {
        waterways: {
          type: 'FeatureCollection',
          features: wwRows.map(rowToFeature)
        },
        structures: {
          type: 'FeatureCollection',
          features: stRows.map(structureRowToFeature)
        },
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
          id, name, kind, status, source, source_ref, size_note, notes,
          lng, lat, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(id, name, kind, status, source, sourceRef, sizeNote, notes, lng, lat, actor, now);

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
        SET name = ?, kind = ?, status = ?, size_note = ?, notes = ?, lng = ?, lat = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(name, kind, status, sizeNote, notes, lng, lat, actor, now, id);

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
      const reason = String(payload?.reason || '').trim() || (source === 'dem_promoted' ? 'Promosi & koreksi segmen DEM' : 'Tambah jalur sungai/drainase');
      const id = `ww-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const lengthM = computeLineLengthMeters(coords);

      db.prepare(`
        INSERT INTO waterways (
          id, name, kind, status, source, source_ref, notes,
          coordinates_json, length_m, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(id, name, kind, status, source, sourceRef, notes, JSON.stringify(coords), lengthM, actor, now);

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
      const actor = String(payload?.actor || 'Editor').trim() || 'Editor';
      const reason = String(payload?.reason || '').trim() || 'Koreksi jalur & atribut';
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE waterways
        SET name = ?, kind = ?, status = ?, notes = ?, coordinates_json = ?, length_m = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(name, kind, status, notes, JSON.stringify(coords), lengthM, actor, now, id);

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
            coordinates_json, length_m, updated_by, updated_at, deleted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            status = excluded.status,
            source = excluded.source,
            source_ref = excluded.source_ref,
            notes = excluded.notes,
            coordinates_json = excluded.coordinates_json,
            length_m = excluded.length_m,
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
            id, name, kind, status, source, source_ref, size_note, notes,
            lng, lat, updated_by, updated_at, deleted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            status = excluded.status,
            source = excluded.source,
            source_ref = excluded.source_ref,
            size_note = excluded.size_note,
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
        entityName: 'Stream-Burning & Hidrologi DEM',
        reason: `Bakar ${verifiedWaterwayCount} sungai terverifikasi (${burnedCellCount} sel DEM) & hitung ulang peta aliran/banjir.`,
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
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < 100.28 || lng > 100.37 || lat < -0.38 || lat > -0.29) {
          throw new Error('Suggestion coordinates must lie inside the Nagari Balingka block.');
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
        (locationName || 'Nagari Balingka').slice(0, 140),
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
          coordinates_json, length_m, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          status = excluded.status,
          source = excluded.source,
          source_ref = excluded.source_ref,
          notes = excluded.notes,
          coordinates_json = excluded.coordinates_json,
          length_m = excluded.length_m,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at,
          deleted = 0
      `);
      const upsertSt = db.prepare(`
        INSERT INTO structures (
          id, name, kind, status, source, source_ref, size_note, notes,
          lng, lat, updated_by, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          status = excluded.status,
          source = excluded.source,
          source_ref = excluded.source_ref,
          size_note = excluded.size_note,
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
          upsertWw.run(id, name, kind, status, source, sourceRef, notes, JSON.stringify(coords), lengthM, updatedBy, updatedAt);
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
          const notes = String(p.notes || '');
          const updatedBy = String(p.updated_by || actor);
          const updatedAt = String(p.updated_at || now);
          upsertSt.run(id, name, kind, status, source, sourceRef, sizeNote, notes, pt[0], pt[1], updatedBy, updatedAt);
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
        entityName: `Impor ${importedWaterways} Jalur & ${importedStructures} Titik dari Git`,
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
