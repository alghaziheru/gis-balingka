import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, DEFAULT_DB_PATH } from '../server/db.mjs';
import { loadDotEnv } from '../server/index.mjs';
import { writeVerifiedSeedFiles } from '../server/seed-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

loadDotEnv(path.join(ROOT, '.env'));

const dbPath = process.env.BALINGKA_DB_PATH
  ? path.resolve(process.env.BALINGKA_DB_PATH)
  : DEFAULT_DB_PATH;
const publicDataDir = path.join(ROOT, 'public', 'data');
const distDataDir = path.join(ROOT, 'dist', 'data');

const store = createStore(dbPath);
try {
  const targets = [publicDataDir];
  if (fs.existsSync(path.join(ROOT, 'dist'))) {
    targets.push(distDataDir);
  }
  const summary = writeVerifiedSeedFiles(store.getState(), targets);
  console.log(
    `Synced Git seed snapshots from ${dbPath}: ${summary.waterwayCount} waterways, ${summary.structureCount} structures, ${summary.suppressedCount} suppressed DEM -> ${summary.dirs.join(', ')}`
  );
} finally {
  store.close();
}
