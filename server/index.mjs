import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, DEFAULT_DB_PATH, DEFAULT_SEED_PATH } from './db.mjs';
import { loadRegionsManifest, resolveRegionPaths } from './regions.mjs';
import { writeVerifiedSeedFiles } from './seed-io.mjs';
import { recomputeHydrologyFromLocalData } from '../scripts/lib/recompute-hydrology.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIST_DIR = path.join(ROOT, 'dist');
const DEFAULT_PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

export function loadDotEnv(envPath = path.join(ROOT, '.env')) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function hashDigest(str) {
  return crypto.createHash('sha256').update(String(str || ''), 'utf8').digest();
}

function timingSafeMatch(candidate, expected) {
  return crypto.timingSafeEqual(hashDigest(candidate), hashDigest(expected));
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const prev = hits.get(key) || [];
    const recent = prev.filter(ts => ts > cutoff);
    if (recent.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      hits.set(key, recent);
      return { allowed: false, retryAfterSec };
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 2000) {
      for (const [k, list] of hits.entries()) {
        if (list.every(ts => ts <= cutoff)) hits.delete(k);
      }
    }
    return { allowed: true, retryAfterSec: 0 };
  };
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('Request payload too large.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const err = new Error('Invalid JSON body.');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function tryServeStatic(req, res, distDir, pathname) {
  if (!distDir || !fs.existsSync(path.join(distDir, 'index.html'))) {
    return false;
  }
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(distDir, relPath);
  const rootPrefix = path.resolve(distDir) + path.sep;
  let targetFile = resolved;

  if (resolved !== path.resolve(distDir) && !resolved.startsWith(rootPrefix)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
    // SPA fallback for client routes (never for missing assets/data files)
    if (path.extname(relPath)) return false;
    targetFile = path.join(distDir, 'index.html');
  }

  const ext = path.extname(targetFile).toLowerCase();
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
  });
  fs.createReadStream(targetFile).pipe(res);
  return true;
}

export function createAppServer({
  dbPath,
  seedGeoJsonPath,
  distDir = DEFAULT_DIST_DIR,
  publicDataDir,
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  regionsManifest = null,
  adminPassphrase = '',
  rateLimits = {}
} = {}) {
  const isSingleTestOverride = Boolean((dbPath || seedGeoJsonPath || publicDataDir) && !regionsManifest);
  const manifest = regionsManifest || (isSingleTestOverride ? null : loadRegionsManifest(ROOT));
  const defaultRegionId = manifest?.defaultRegionId || 'nagari-balingka';
  const regionConfigs = manifest?.regions || [];
  const regionById = new Map(regionConfigs.map(r => [r.id, r]));

  const stores = new Map();
  let singleStore = null;
  if (isSingleTestOverride) {
    singleStore = createStore(dbPath || DEFAULT_DB_PATH, seedGeoJsonPath || DEFAULT_SEED_PATH);
  }

  function getRegionContext(regionIdParam) {
    if (isSingleTestOverride) {
      return {
        regionId: defaultRegionId,
        store: singleStore,
        publicDataDir: publicDataDir || DEFAULT_PUBLIC_DATA_DIR,
        distDataDir: distDir ? path.join(distDir, 'data') : null
      };
    }
    const targetId = String(regionIdParam || defaultRegionId).trim() || defaultRegionId;
    const regionCfg = regionById.get(targetId);
    if (!regionCfg) {
      const err = new Error(`Unknown region '${targetId}'.`);
      err.statusCode = 400;
      throw err;
    }
    let ctx = stores.get(targetId);
    if (!ctx) {
      const paths = resolveRegionPaths(regionCfg, {
        rootDir: ROOT,
        defaultRegionId,
        publicDir,
        distDir,
        dataDir
      });
      const store = createStore(paths.dbPath, paths.seedGeoJsonPath, regionCfg);
      ctx = {
        regionId: targetId,
        regionCfg,
        store,
        publicDataDir: paths.publicDataDir,
        distDataDir: paths.distDataDir
      };
      stores.set(targetId, ctx);
    }
    return ctx;
  }

  // Eagerly initialize default region store so health check and first load are warm
  const defaultCtx = getRegionContext(defaultRegionId);
  const store = defaultCtx.store;
  const configuredPassphrase = String(adminPassphrase || '').trim();
  const requiresPassphrase = configuredPassphrase.length > 0;
  const checkVerifyLimit = createRateLimiter({
    windowMs: Number(rateLimits?.verifyWindowMs) || 15 * 60 * 1000,
    max: Number(rateLimits?.verifyMax) || 10
  });
  const checkSuggestionLimit = createRateLimiter({
    windowMs: Number(rateLimits?.suggestionWindowMs) || 15 * 60 * 1000,
    max: Number(rateLimits?.suggestionMax) || 15
  });

  const isEditorAuthorized = req => {
    if (!requiresPassphrase) return true;
    const header = req.headers['x-admin-passphrase'];
    if (typeof header !== 'string' || !header) return false;
    return timingSafeMatch(header, configuredPassphrase);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const method = (req.method || 'GET').toUpperCase();

      if (!pathname.startsWith('/api')) {
        if (method === 'GET' || method === 'HEAD') {
          if (tryServeStatic(req, res, distDir, pathname)) return;
        }
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      if (method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, sqlite: true, requiresPassphrase });
      }

      if (method === 'GET' && pathname === '/api/regions') {
        const list = isSingleTestOverride
          ? [{ id: defaultRegionId, name: 'Default Region', dataBasePath: '/data' }]
          : regionConfigs.map(r => ({
              id: r.id,
              name: r.name,
              shortName: r.shortName,
              district: r.district,
              regency: r.regency,
              areaKm2: r.areaKm2,
              dataBasePath: r.dataBasePath || (r.id === defaultRegionId ? '/data' : `/data/regions/${r.id}`)
            }));
        return sendJson(res, 200, { defaultRegionId, regions: list });
      }

      if (method === 'GET' && pathname === '/api/editor/status') {
        return sendJson(res, 200, {
          requiresPassphrase,
          unlockedByDefault: !requiresPassphrase
        });
      }

      if (method === 'POST' && pathname === '/api/editor/verify') {
        const limit = checkVerifyLimit(getClientIp(req));
        if (!limit.allowed) {
          return sendJson(
            res,
            429,
            { ok: false, error: 'Terlalu banyak percobaan verifikasi. Coba lagi beberapa menit lagi.' },
            { 'Retry-After': String(limit.retryAfterSec) }
          );
        }
        const body = await readJsonBody(req, 8 * 1024);
        if (!requiresPassphrase) {
          return sendJson(res, 200, { ok: true, unlocked: true });
        }
        const ok = typeof body?.passphrase === 'string' && timingSafeMatch(body.passphrase, configuredPassphrase);
        if (!ok) return sendJson(res, 401, { ok: false, error: 'Passphrase editor tidak valid.' });
        return sendJson(res, 200, { ok: true, unlocked: true });
      }

      const regionParam = url.searchParams.get('region');
      const ctx = getRegionContext(regionParam);
      const activeStore = ctx.store;

      if (method === 'GET' && pathname === '/api/waterways') {
        return sendJson(res, 200, activeStore.getState());
      }

      if (method === 'GET' && pathname === '/api/structures') {
        return sendJson(res, 200, { structures: activeStore.getState().structures });
      }

      if (method === 'GET' && pathname === '/api/jorong-boundaries') {
        return sendJson(res, 200, { jorongBoundaries: activeStore.getState().jorongBoundaries });
      }

      if (method === 'GET' && pathname === '/api/audit') {
        const limit = Number(url.searchParams.get('limit') || 150);
        return sendJson(res, 200, { logs: activeStore.listAuditLogs(limit) });
      }

      if (method === 'GET' && pathname === '/api/suggestions') {
        if (!isEditorAuthorized(req)) {
          return sendJson(res, 401, { error: 'Mode Editor terkunci. Masukkan Admin Passphrase terlebih dahulu.' });
        }
        return sendJson(res, 200, { suggestions: activeStore.listSuggestions() });
      }

      if (method === 'POST' && pathname === '/api/suggestions') {
        const limit = checkSuggestionLimit(getClientIp(req));
        if (!limit.allowed) {
          return sendJson(
            res,
            429,
            { error: 'Terlalu banyak kiriman masukan dari alamat ini. Coba lagi nanti.' },
            { 'Retry-After': String(limit.retryAfterSec) }
          );
        }
        const body = await readJsonBody(req, 32 * 1024);
        const created = activeStore.createSuggestion(body);
        return sendJson(res, 201, { suggestion: created });
      }

      if (method === 'GET' && pathname === '/api/export/bundle') {
        const bundle = activeStore.exportBundle();
        const safeSlug = ctx.regionId.replace(/[^a-z0-9_-]/gi, '') || 'region';
        return sendJson(res, 200, bundle, {
          'Content-Disposition': `attachment; filename="${safeSlug}-waterways-audit-bundle.json"`
        });
      }

      // Mutating / Editor routes below
      const needsEditor =
        (method === 'POST' && pathname === '/api/waterways') ||
        (method === 'PUT' && pathname.startsWith('/api/waterways/')) ||
        (method === 'DELETE' && pathname.startsWith('/api/waterways/')) ||
        (method === 'POST' && pathname === '/api/structures') ||
        (method === 'PUT' && pathname.startsWith('/api/structures/')) ||
        (method === 'DELETE' && pathname.startsWith('/api/structures/')) ||
        (method === 'POST' && pathname === '/api/jorong-boundaries') ||
        (method === 'PUT' && pathname.startsWith('/api/jorong-boundaries/')) ||
        (method === 'DELETE' && pathname.startsWith('/api/jorong-boundaries/')) ||
        (method === 'POST' && pathname === '/api/dem-segments/suppress') ||
        (method === 'DELETE' && pathname.startsWith('/api/dem-segments/')) ||
        (method === 'POST' && /^\/api\/audit\/\d+\/revert$/.test(pathname)) ||
        (method === 'POST' && pathname === '/api/hydrology/recompute') ||
        (method === 'PATCH' && /^\/api\/suggestions\/\d+$/.test(pathname));

      if (needsEditor && !isEditorAuthorized(req)) {
        return sendJson(res, 401, { error: 'Mode Editor terkunci. Masukkan Admin Passphrase terlebih dahulu.' });
      }

      if (method === 'POST' && pathname === '/api/waterways') {
        const body = await readJsonBody(req, 512 * 1024);
        const result = activeStore.createWaterway(body);
        return sendJson(res, 201, result);
      }

      const wwMatch = pathname.match(/^\/api\/waterways\/([^/]+)$/);
      if (wwMatch && method === 'PUT') {
        const body = await readJsonBody(req, 512 * 1024);
        const result = activeStore.updateWaterway(wwMatch[1], body);
        return sendJson(res, 200, result);
      }
      if (wwMatch && method === 'DELETE') {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        const result = activeStore.deleteWaterway(wwMatch[1], body);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/structures') {
        const body = await readJsonBody(req, 64 * 1024);
        const result = activeStore.createStructure(body);
        return sendJson(res, 201, result);
      }

      const stMatch = pathname.match(/^\/api\/structures\/([^/]+)$/);
      if (stMatch && method === 'PUT') {
        const body = await readJsonBody(req, 64 * 1024);
        const result = activeStore.updateStructure(stMatch[1], body);
        return sendJson(res, 200, result);
      }
      if (stMatch && method === 'DELETE') {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        const result = activeStore.deleteStructure(stMatch[1], body);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/jorong-boundaries') {
        const body = await readJsonBody(req, 256 * 1024);
        const result = activeStore.createJorongBoundary(body);
        return sendJson(res, 201, result);
      }

      const jbMatch = pathname.match(/^\/api\/jorong-boundaries\/([^/]+)$/);
      if (jbMatch && method === 'PUT') {
        const body = await readJsonBody(req, 256 * 1024);
        const result = activeStore.updateJorongBoundary(jbMatch[1], body);
        return sendJson(res, 200, result);
      }
      if (jbMatch && method === 'DELETE') {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        const result = activeStore.deleteJorongBoundary(jbMatch[1], body);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/dem-segments/suppress') {
        const body = await readJsonBody(req, 32 * 1024);
        const result = activeStore.suppressDemSegment(body);
        return sendJson(res, 200, result);
      }

      const demMatch = pathname.match(/^\/api\/dem-segments\/([^/]+)\/suppress$/);
      if (demMatch && method === 'DELETE') {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        const result = activeStore.restoreDemSegment(demMatch[1], body);
        return sendJson(res, 200, result);
      }

      const revertMatch = pathname.match(/^\/api\/audit\/(\d+)\/revert$/);
      if (revertMatch && method === 'POST') {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        const result = activeStore.revertAuditLog(revertMatch[1], body);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/hydrology/recompute') {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({}));
        const actor = String(body?.actor || 'Editor').trim() || 'Editor';
        const carveDepthM = Number(body?.carveDepthM) || 3.5;
        const currentState = activeStore.getState();
        const summary = recomputeHydrologyFromLocalData({
          publicDataDir: ctx.publicDataDir,
          distDataDir: ctx.distDataDir,
          verifiedFeatures: currentState.waterways.features,
          verifiedStructures: currentState.structures.features,
          suppressedDemIds: new Set(currentState.suppressedDem.map(s => s.seg_id)),
          carveDepthM
        });
        const marked = activeStore.markHydroRecomputed({
          actor,
          burnedCellCount: summary.burnedCellCount,
          verifiedWaterwayCount: summary.verifiedWaterwayCount,
          recomputedAt: summary.recomputedAt,
          summary
        });
        writeVerifiedSeedFiles(marked.state, [ctx.publicDataDir, ctx.distDataDir]);
        return sendJson(res, 200, {
          ok: true,
          summary,
          hydroStatus: marked.hydroStatus,
          state: marked.state
        });
      }

      const sugMatch = pathname.match(/^\/api\/suggestions\/(\d+)$/);
      if (sugMatch && method === 'PATCH') {
        const body = await readJsonBody(req, 16 * 1024);
        const suggestion = activeStore.updateSuggestionStatus(sugMatch[1], body);
        return sendJson(res, 200, { suggestion });
      }

      return sendJson(res, 404, { error: 'API endpoint not found.' });
    } catch (err) {
      const code = Number(err?.statusCode) || 400;
      sendJson(res, code, { error: err?.message || 'Internal server error' });
    }
  });

  server.on('close', () => {
    for (const ctx of stores.values()) {
      try {
        ctx.store.close();
      } catch {}
    }
    if (singleStore) {
      try {
        singleStore.close();
      } catch {}
    }
  });

  return { server, store, getStore: id => getRegionContext(id).store };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadDotEnv();
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  const dbPath = process.env.BALINGKA_DB_PATH ? path.resolve(process.env.BALINGKA_DB_PATH) : undefined;
  const adminPassphrase = process.env.ADMIN_PASSPHRASE || '';
  const { server } = createAppServer({ dbPath, adminPassphrase });
  server.listen(port, host, () => {
    console.log(
      `Nagari Balingka & Multi-Region SQLite API listening on http://${host}:${port} (passphrase=${adminPassphrase ? 'enabled' : 'open-local'})`
    );
  });
}
