import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, DEFAULT_DB_PATH } from '../server/db.mjs';
import { loadDotEnv } from '../server/index.mjs';
import { readVerifiedSeedFiles } from '../server/seed-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

loadDotEnv(path.join(ROOT, '.env'));

const dbPath = process.env.BALINGKA_DB_PATH
  ? path.resolve(process.env.BALINGKA_DB_PATH)
  : DEFAULT_DB_PATH;
const publicDataDir = path.join(ROOT, 'public', 'data');

const seed = readVerifiedSeedFiles(publicDataDir);
if (!seed.hasVerifiedWaterways && seed.structures.length === 0) {
  console.error(`No verified seed snapshots found in ${publicDataDir}.`);
  process.exit(1);
}

const store = createStore(dbPath);
try {
  const res = store.importSeedSnapshot({
    waterways: seed.waterways,
    structures: seed.structures,
    suppressedDem: seed.suppressedDem
  });
  console.log(
    `Imported Git seed snapshots into ${dbPath}: ${res.importedWaterways} waterways, ${res.importedStructures} structures, ${res.importedSuppressed} suppressed DEM (audit #${res.log.id})`
  );
} finally {
  store.close();
}
