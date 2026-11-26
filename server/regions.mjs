import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function loadRegionsManifest(rootDir = ROOT) {
  const manifestPath = path.join(rootDir, 'regions.config.json');
  if (fs.existsSync(manifestPath)) {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const regions = Array.isArray(parsed?.regions) ? parsed.regions : [];
    if (regions.length > 0) {
      const defaultRegionId = String(parsed.defaultRegionId || regions[0].id);
      return { defaultRegionId, regions };
    }
  }
  const singlePath = path.join(rootDir, 'region.config.json');
  if (fs.existsSync(singlePath)) {
    const cfg = JSON.parse(fs.readFileSync(singlePath, 'utf8'));
    return {
      defaultRegionId: String(cfg.id || 'nagari-balingka'),
      regions: [cfg]
    };
  }
  return {
    defaultRegionId: 'nagari-balingka',
    regions: [
      {
        id: 'nagari-balingka',
        name: 'Nagari Balingka',
        shortName: 'Balingka',
        district: 'Kec. IV Koto',
        regency: 'Kab. Agam',
        bbox: { west: 100.278, south: -0.408, east: 100.345, north: -0.314 },
        dataBasePath: '/data',
        dbFilename: 'balingka.db'
      }
    ]
  };
}

export function resolveRegionPaths(
  regionCfg,
  {
    rootDir = ROOT,
    defaultRegionId = 'nagari-balingka',
    publicDir = path.join(rootDir, 'public'),
    distDir = path.join(rootDir, 'dist'),
    dataDir = path.join(rootDir, 'data')
  } = {}
) {
  const isDefault = regionCfg.id === defaultRegionId;
  const relDataPath = String(
    regionCfg.dataBasePath || (isDefault ? '/data' : `/data/regions/${regionCfg.id}`)
  )
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  const publicDataDir = path.join(publicDir, ...relDataPath.split('/'));
  const distDataDir = distDir ? path.join(distDir, ...relDataPath.split('/')) : null;
  const rawDataDir = isDefault
    ? path.join(rootDir, 'raw-data')
    : path.join(rootDir, 'raw-data', regionCfg.id);
  const dbFilename = String(
    regionCfg.dbFilename || (isDefault ? 'balingka.db' : `${regionCfg.id}.db`)
  );
  const dbPath = path.join(dataDir, dbFilename);
  const seedGeoJsonPath = path.join(publicDataDir, 'osm-context.geojson');

  return {
    regionCfg,
    isDefault,
    dataBasePath: `/${relDataPath}`,
    publicDataDir,
    distDataDir,
    rawDataDir,
    dbPath,
    seedGeoJsonPath
  };
}
