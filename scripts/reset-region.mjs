#!/usr/bin/env node
/**
 * Cleans stale pre-built Nagari Balingka region artifacts from public/data/ and data/
 * before generating assets for a new Desa / Nagari configured in region.config.json.
 *
 * Usage:
 *   pnpm run reset-region             # Safe cleanup after editing region.config.json
 *   pnpm run reset-region -- --dry-run
 *   pnpm run reset-region -- --raw-cache
 *   pnpm run reset-region -- --force  # Required if region.config.json still has id="nagari-balingka"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const REGION_PUBLIC_ARTIFACTS = [
  'public/data/verified-waterways.geojson',
  'public/data/verified-structures.geojson',
  'public/data/suppressed-dem.json',
  'public/data/nagari-boundary.geojson',
  'public/data/agam-context.json',
  'public/data/agam-grids.json',
  'public/data/agam-rbi-rivers.geojson',
  'public/data/raster-scour-change.png',
  'public/data/landcover-grid.json',
  'public/data/raster-landcover.png',
  'public/data/metadata.json'
];

export const REGION_DB_ARTIFACTS = [
  'data/balingka.db',
  'data/balingka.db-wal',
  'data/balingka.db-shm'
];

export const REGION_RAW_CACHE_ARTIFACTS = [
  'raw-data/agam-gis-cache.json',
  'raw-data/open-buildings-balingka.geojson',
  'raw-data/big-nagari-2026.geojson',
  'raw-data/big-rbi-2022.json'
];

export function runResetRegion({ rootDir = ROOT, force = false, dryRun = false, includeRawCache = false } = {}) {
  const cfgPath = path.join(rootDir, 'region.config.json');
  let regionId = 'unknown';
  let regionName = 'Unknown Region';
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    regionId = String(cfg.id || 'unknown');
    regionName = String(cfg.name || regionId);
  }

  if (regionId === 'nagari-balingka' && !force) {
    return {
      ok: false,
      blocked: true,
      regionId,
      regionName,
      removed: [],
      skipped: [],
      message:
        'Refusing to wipe checked-in Nagari Balingka assets while region.config.json still has "id": "nagari-balingka". ' +
        'Update region.config.json for your Desa/Nagari first, or pass --force if you really want to reset.'
    };
  }

  const targets = [
    ...REGION_PUBLIC_ARTIFACTS,
    ...REGION_DB_ARTIFACTS,
    ...(includeRawCache ? REGION_RAW_CACHE_ARTIFACTS : [])
  ];

  const removed = [];
  const skipped = [];
  for (const rel of targets) {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs)) {
      if (!dryRun) fs.unlinkSync(abs);
      removed.push(rel);
    } else {
      skipped.push(rel);
    }
  }

  return {
    ok: true,
    blocked: false,
    dryRun,
    regionId,
    regionName,
    removed,
    skipped
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const dryRun = args.has('--dry-run');
  const includeRawCache = args.has('--raw-cache');

  const res = runResetRegion({ force, dryRun, includeRawCache });
  if (!res.ok) {
    console.error(`[reset-region] ${res.message}`);
    process.exit(1);
  }

  const verb = dryRun ? 'Would remove' : 'Removed';
  console.log(`[reset-region] Active region: ${res.regionName} (${res.regionId})`);
  if (res.removed.length === 0) {
    console.log('[reset-region] No stale region artifacts found.');
  } else {
    console.log(`[reset-region] ${verb} ${res.removed.length} file(s):`);
    for (const rel of res.removed) console.log(`  - ${rel}`);
  }
  if (!dryRun) {
    console.log('\nNext steps:');
    console.log('  1. (Optional) Place raw-data/region-boundary.geojson and/or BIG DEMNAS in raw-data/');
    console.log('  2. Run: pnpm run prepare-data');
    console.log('  3. Run: pnpm run build && pnpm start');
  }
}
