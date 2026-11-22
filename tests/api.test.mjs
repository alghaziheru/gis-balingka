import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA_DIR = path.resolve(__dirname, '..', 'public', 'data');

function makeTempDb(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dbPath: path.join(dir, 'test.db') };
}

test('SQLite API auto-seeds 3 OSM rivers, records full audit snapshots, supports promote & revert', async () => {
  const { dir, dbPath } = makeTempDb('balingka-api-open-');
  const { server } = createAppServer({ dbPath, distDir: null, adminPassphrase: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Seeded 3 OSM rivers + seed audit log
    const wwRes = await fetch(`${base}/api/waterways`);
    assert.equal(wwRes.status, 200);
    const wwData = await wwRes.json();
    const names = wwData.waterways.features.map(f => f.properties.name);
    assert.ok(names.includes('Batang Ngalai'));
    assert.ok(names.includes('Batang Tuhua'));
    assert.ok(names.includes('Anak Sungai'));

    const audit0 = await (await fetch(`${base}/api/audit`)).json();
    assert.equal(audit0.logs.length, 1);
    assert.equal(audit0.logs[0].action, 'seed');

    // 2. Promote DEM segment & verify it suppresses DEM segment
    const promoteRes = await fetch(`${base}/api/waterways`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bandar Sawah Simpang',
        kind: 'canal',
        status: 'clogged',
        source: 'dem_promoted',
        source_ref: 'flow-99',
        notes: 'Saluran sawah',
        coordinates: [
          [100.321, -0.336],
          [100.323, -0.335]
        ],
        actor: 'Wali Uji',
        reason: 'Promosi segmen DEM ke bandar nyata'
      })
    });
    assert.equal(promoteRes.status, 201);
    const promoted = await promoteRes.json();
    assert.equal(promoted.log.action, 'promote_dem');
    assert.equal(promoted.log.before, null);
    assert.equal(promoted.log.after.name, 'Bandar Sawah Simpang');

    const wwAfterPromote = await (await fetch(`${base}/api/waterways`)).json();
    assert.ok(wwAfterPromote.suppressedDem.some(s => s.seg_id === 'flow-99'));

    // 3. Update & soft-delete verified waterway
    const createdId = promoted.feature.properties.id;
    const updRes = await fetch(`${base}/api/waterways/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bandar Sawah Simpang (Diperbarui)',
        status: 'normal',
        coordinates: [
          [100.321, -0.336],
          [100.322, -0.3355],
          [100.323, -0.335]
        ],
        actor: 'Wali Uji',
        reason: 'Tambah titik belokan tengah'
      })
    });
    assert.equal(updRes.status, 200);
    const updated = await updRes.json();
    assert.equal(updated.log.before.coordinates.length, 2);
    assert.equal(updated.log.after.coordinates.length, 3);

    // 4. Revert the promote_dem log -> removes waterway AND restores DEM segment
    const revertRes = await fetch(`${base}/api/audit/${promoted.log.id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'Admin', reason: 'Batalkan promosi uji' })
    });
    assert.equal(revertRes.status, 200);
    const reverted = await revertRes.json();
    assert.equal(reverted.log.action, 'revert');
    assert.equal(reverted.log.reverted_log_id, promoted.log.id);
    assert.ok(!reverted.state.waterways.features.some(f => f.properties.id === createdId));
    assert.ok(!reverted.state.suppressedDem.some(s => s.seg_id === 'flow-99'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ADMIN_PASSPHRASE locks waterway edits & suggestion moderation while keeping public suggestions open', async () => {
  const { dir, dbPath } = makeTempDb('balingka-api-auth-');
  const { server } = createAppServer({ dbPath, distDir: null, adminPassphrase: 'rahasia-balingka-2026' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const status = await (await fetch(`${base}/api/editor/status`)).json();
    assert.equal(status.requiresPassphrase, true);
    assert.equal(status.unlockedByDefault, false);

    // Mutating waterways without passphrase -> 401
    const blocked = await fetch(`${base}/api/waterways`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Parit Gelap',
        kind: 'drain',
        status: 'clogged',
        coordinates: [
          [100.32, -0.335],
          [100.321, -0.335]
        ]
      })
    });
    assert.equal(blocked.status, 401);

    // Public citizen suggestion WITHOUT passphrase -> 201
    const sugRes = await fetch(`${base}/api/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reporter_name: 'Pak Dani',
        category: 'waterway_correction',
        location_name: 'Simpang Pahambatan',
        message: 'Alur sungai berbelok ke utara sawah',
        lng: 100.3195,
        lat: -0.3392
      })
    });
    assert.equal(sugRes.status, 201);
    const { suggestion } = await sugRes.json();

    // Moderating suggestion without passphrase -> 401
    const modBlocked = await fetch(`${base}/api/suggestions/${suggestion.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' })
    });
    assert.equal(modBlocked.status, 401);

    // Moderating suggestion WITH passphrase -> 200
    const modOk = await fetch(`${base}/api/suggestions/${suggestion.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Passphrase': 'rahasia-balingka-2026'
      },
      body: JSON.stringify({
        status: 'resolved',
        resolution_note: 'Sudah disesuaikan oleh wali jorong',
        actor: 'Admin Nagari'
      })
    });
    assert.equal(modOk.status, 200);
    const modData = await modOk.json();
    assert.equal(modData.suggestion.status, 'resolved');

    // Bundle export works cleanly
    const bundleRes = await fetch(`${base}/api/export/bundle`);
    assert.equal(bundleRes.status, 200);
    const bundle = await bundleRes.json();
    assert.ok(bundle.verifiedWaterways.features.length >= 3);
    assert.ok(bundle.auditLogs.length >= 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/hydrology/recompute burns verified waterways into temp DEM data, updates HAND rasters, and resets dirty flag', async () => {
  const { dir, dbPath } = makeTempDb('balingka-api-hydro-');
  const tempPublicData = path.join(dir, 'public-data');
  fs.mkdirSync(tempPublicData, { recursive: true });
  for (const name of ['dem-grid.json', 'osm-context.geojson', 'metadata.json']) {
    fs.copyFileSync(path.join(PUBLIC_DATA_DIR, name), path.join(tempPublicData, name));
  }

  const { server } = createAppServer({
    dbPath,
    distDir: null,
    publicDataDir: tempPublicData,
    adminPassphrase: 'hydro-pass-2026'
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Create/promote a waterway -> sets hydroStatus.dirty = true
    const createRes = await fetch(`${base}/api/waterways`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Passphrase': 'hydro-pass-2026'
      },
      body: JSON.stringify({
        name: 'Alur Sawah Koreksi',
        kind: 'stream',
        status: 'normal',
        source: 'dem_promoted',
        source_ref: 'flow-77',
        notes: 'Uji stream burning',
        coordinates: [
          [100.322, -0.340],
          [100.324, -0.335],
          [100.325, -0.330]
        ],
        actor: 'Wali Uji',
        reason: 'Uji sinkronisasi DEM'
      })
    });
    assert.equal(createRes.status, 201);

    const stateBefore = await (await fetch(`${base}/api/waterways`)).json();
    assert.equal(stateBefore.hydroStatus.dirty, true);
    assert.ok(stateBefore.suppressedDem.some(s => s.seg_id === 'flow-77'));

    // 2. Unauthorized recompute -> 401
    const unauth = await fetch(`${base}/api/hydrology/recompute`, { method: 'POST' });
    assert.equal(unauth.status, 401);

    // 3. Authorized recompute -> 200 & writes updated assets
    const recomputeRes = await fetch(`${base}/api/hydrology/recompute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Passphrase': 'hydro-pass-2026'
      },
      body: JSON.stringify({ actor: 'Wali Uji', carveDepthM: 3.5 })
    });
    assert.equal(recomputeRes.status, 200);
    const recomputed = await recomputeRes.json();
    assert.equal(recomputed.ok, true);
    assert.equal(recomputed.hydroStatus.dirty, false);
    assert.ok(recomputed.summary.burnedCellCount > 0);
    assert.equal(recomputed.state.suppressedDem.length, 0);

    const nextMeta = JSON.parse(fs.readFileSync(path.join(tempPublicData, 'metadata.json'), 'utf8'));
    assert.equal(nextMeta.hydroConditioned, true);
    assert.ok(nextMeta.burnedCellCount > 0);
    assert.ok(fs.existsSync(path.join(tempPublicData, 'flow-paths.geojson')));
    assert.ok(fs.existsSync(path.join(tempPublicData, 'drainage-draft.geojson')));
    for (const scenario of ['clogged', 'cleared']) {
      for (const lvl of ['low', 'med', 'high']) {
        const png = fs.readFileSync(path.join(tempPublicData, `raster-hand-${scenario}-${lvl}.png`));
        assert.equal(png.toString('ascii', 1, 4), 'PNG');
      }
    }

    const audit = await (await fetch(`${base}/api/audit`)).json();
    assert.equal(audit.logs[0].action, 'recompute_hydrology');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Structures CRUD (culverts & bridges), passphrase auth, audit revert, and export bundle work end-to-end', async () => {
  const { dir, dbPath } = makeTempDb('balingka-api-struct-');
  const { server } = createAppServer({ dbPath, distDir: null, adminPassphrase: 'struct-pass-2026' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Initial structures list is public
    const initRes = await fetch(`${base}/api/structures`);
    assert.equal(initRes.status, 200);
    const initData = await initRes.json();
    const initCount = initData.structures.features.length;

    // 2. Creating structure without passphrase -> 401
    const unauth = await fetch(`${base}/api/structures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gorong-gorong Gelap',
        kind: 'culvert',
        status: 'clogged',
        coordinates: [100.324, -0.335]
      })
    });
    assert.equal(unauth.status, 401);

    // 3. Verify a crossing point -> 201
    const createRes = await fetch(`${base}/api/structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Passphrase': 'struct-pass-2026'
      },
      body: JSON.stringify({
        name: 'Gorong-gorong Simpang Pahambatan',
        kind: 'culvert',
        status: 'clogged',
        source: 'crossing_promoted',
        source_ref: 'cross-1',
        size_note: 'Box 1.0m x 0.8m',
        notes: 'Tertutup sedimen pasir',
        coordinates: [100.3195, -0.3391],
        actor: 'Wali Jorong',
        reason: 'Cek lapangan'
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.log.action, 'verify_crossing');
    assert.equal(created.feature.properties.kind, 'culvert');
    assert.equal(created.feature.properties.status, 'clogged');

    const stId = created.feature.properties.id;

    // 4. Update structure status -> normal
    const updRes = await fetch(`${base}/api/structures/${stId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Passphrase': 'struct-pass-2026'
      },
      body: JSON.stringify({
        status: 'normal',
        notes: 'Sudah dibersihkan gotong royong',
        actor: 'Wali Jorong',
        reason: 'Pembersihan gorong-gorong'
      })
    });
    assert.equal(updRes.status, 200);
    const updated = await updRes.json();
    assert.equal(updated.feature.properties.status, 'normal');
    assert.equal(updated.log.action, 'update_structure');

    // 5. Export bundle includes verifiedStructures
    const bundle = await (await fetch(`${base}/api/export/bundle`)).json();
    assert.equal(bundle.verifiedStructures.features.length, initCount + 1);

    // 6. Delete & revert structure
    const delRes = await fetch(`${base}/api/structures/${stId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Passphrase': 'struct-pass-2026'
      },
      body: JSON.stringify({ actor: 'Admin', reason: 'Salah input' })
    });
    assert.equal(delRes.status, 200);
    const afterDel = await (await fetch(`${base}/api/structures`)).json();
    assert.equal(afterDel.structures.features.length, initCount);

    const delData = await delRes.json();
    const revRes = await fetch(`${base}/api/audit/${delData.log.id}/revert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Passphrase': 'struct-pass-2026'
      },
      body: JSON.stringify({ actor: 'Admin', reason: 'Pulihkan titik' })
    });
    assert.equal(revRes.status, 200);
    const revData = await revRes.json();
    assert.equal(revData.state.structures.features.length, initCount + 1);
    assert.ok(revData.state.structures.features.some(f => f.properties.id === stId));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Verified GeoJSON snapshots seed fresh DBs, recompute auto-exports them, and importSeedSnapshot preserves suggestions', async () => {
  const { dir, dbPath } = makeTempDb('balingka-api-seed-');
  const tempPublicData = path.join(dir, 'public-data');
  fs.mkdirSync(tempPublicData, { recursive: true });
  for (const name of ['dem-grid.json', 'osm-context.geojson', 'metadata.json']) {
    fs.copyFileSync(path.join(PUBLIC_DATA_DIR, name), path.join(tempPublicData, name));
  }

  // Write canonical verified GeoJSON snapshots into tempPublicData
  fs.writeFileSync(
    path.join(tempPublicData, 'verified-waterways.geojson'),
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'ww-git-1',
            name: 'Batang Ngalai (Git Verified)',
            kind: 'river',
            status: 'normal',
            source: 'osm',
            source_ref: 'osm-w-1',
            notes: 'Diselaraskan di localhost',
            length_m: 150,
            updated_by: 'Relawan Balingka',
            updated_at: '2026-11-22T01:00:00.000Z'
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [100.320, -0.340],
              [100.321, -0.339]
            ]
          }
        }
      ]
    })
  );
  fs.writeFileSync(
    path.join(tempPublicData, 'verified-structures.geojson'),
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'st-git-1',
            name: 'Gorong-gorong Pasar',
            kind: 'culvert',
            status: 'clogged',
            source: 'manual',
            source_ref: null,
            size_note: 'Box 1.0m',
            notes: 'Terverifikasi',
            updated_by: 'Relawan Balingka',
            updated_at: '2026-11-22T01:00:00.000Z'
          },
          geometry: { type: 'Point', coordinates: [100.324, -0.335] }
        }
      ]
    })
  );
  fs.writeFileSync(
    path.join(tempPublicData, 'suppressed-dem.json'),
    JSON.stringify([{ seg_id: 'flow-88', reason: 'Jalur tidak ada di lapangan', updated_by: 'Editor', updated_at: '2026-11-22T01:00:00.000Z' }])
  );

  const { server, store } = createAppServer({
    dbPath,
    seedGeoJsonPath: path.join(tempPublicData, 'osm-context.geojson'),
    distDir: null,
    publicDataDir: tempPublicData,
    adminPassphrase: ''
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Fresh DB seeded directly from verified GeoJSON snapshots
    const state = await (await fetch(`${base}/api/waterways`)).json();
    assert.equal(state.waterways.features.length, 1);
    assert.equal(state.waterways.features[0].properties.name, 'Batang Ngalai (Git Verified)');
    assert.equal(state.structures.features.length, 1);
    assert.equal(state.structures.features[0].properties.name, 'Gorong-gorong Pasar');
    assert.equal(state.suppressedDem.length, 1);
    assert.equal(state.suppressedDem[0].seg_id, 'flow-88');

    // 2. Citizen suggestion stays preserved across importSeedSnapshot
    const sug = store.createSuggestion({
      reporter_name: 'Warga Balingka',
      location_name: 'Simpang',
      message: 'Mohon cek parit'
    });
    assert.ok(sug.id);

    // 3. Recompute auto-exports verified-waterways/structures/suppressed-dem
    const createRes = await fetch(`${base}/api/waterways`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Parit Baru',
        kind: 'drain',
        status: 'normal',
        coordinates: [
          [100.322, -0.336],
          [100.323, -0.335]
        ],
        actor: 'Editor Uji',
        reason: 'Tambah parit'
      })
    });
    assert.equal(createRes.status, 201);

    const recRes = await fetch(`${base}/api/hydrology/recompute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'Editor Uji' })
    });
    assert.equal(recRes.status, 200);

    const exportedWw = JSON.parse(fs.readFileSync(path.join(tempPublicData, 'verified-waterways.geojson'), 'utf8'));
    assert.equal(exportedWw.features.length, 2);
    assert.ok(exportedWw.features.some(f => f.properties.name === 'Parit Baru'));

    // 4. importSeedSnapshot upserts new Git data without touching citizen suggestions
    const imp = store.importSeedSnapshot({
      waterways: [
        {
          type: 'Feature',
          properties: {
            id: 'ww-git-1',
            name: 'Batang Ngalai (Pulled)',
            kind: 'river',
            status: 'normal',
            source: 'osm'
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [100.320, -0.340],
              [100.3215, -0.339]
            ]
          }
        }
      ],
      structures: [],
      suppressedDem: []
    });
    assert.equal(imp.importedWaterways, 1);
    assert.equal(imp.log.action, 'import_seed');
    assert.equal(store.listSuggestions().length, 1);
    const updatedState = store.getState();
    assert.equal(
      updatedState.waterways.features.find(f => f.properties.id === 'ww-git-1')?.properties.name,
      'Batang Ngalai (Pulled)'
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('waterway cross-sections & Jorong boundary API enforce auth, persist to SQLite, and support audit revert', async () => {
  const { dir, dbPath } = makeTempDb('balingka-api-f3-');
  const secret = 'balingka-test-pass';
  const { server } = createAppServer({ dbPath, distDir: null, adminPassphrase: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Waterway cross-section fields persist and revert
    const wwRes = await fetch(`${base}/api/waterways`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Passphrase': secret },
      body: JSON.stringify({
        name: 'Bandar Ukur Hilir',
        kind: 'river',
        status: 'clear',
        source: 'manual',
        notes: 'Ukur lapangan pasca galodo',
        width_pre_m: 6.5,
        width_post_m: 11.2,
        depth_m: 2.1,
        coordinates: [
          [100.324, -0.334],
          [100.326, -0.332]
        ],
        actor: 'Surveyor',
        reason: 'Input lebar pra vs pasca bencana'
      })
    });
    assert.equal(wwRes.status, 201);
    const wwJson = await wwRes.json();
    assert.equal(wwJson.feature.properties.width_pre_m, 6.5);
    assert.equal(wwJson.feature.properties.width_post_m, 11.2);
    assert.equal(wwJson.feature.properties.depth_m, 2.1);

    const wwList = await (await fetch(`${base}/api/waterways`)).json();
    const createdWw = wwList.waterways.features.find(f => f.properties.id === wwJson.feature.properties.id);
    assert.equal(createdWw.properties.width_post_m, 11.2);

    // 2. Public GET /api/jorong-boundaries works without auth, POST rejects without passphrase
    const pubJorong = await fetch(`${base}/api/jorong-boundaries`);
    assert.equal(pubJorong.status, 200);
    const unauthPost = await fetch(`${base}/api/jorong-boundaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jorong Koto Hilalang',
        status: 'indicative',
        source_note: 'Diskusi peta warga',
        coordinates: [
          [100.321, -0.335],
          [100.325, -0.335],
          [100.325, -0.331],
          [100.321, -0.331],
          [100.321, -0.335]
        ],
        actor: 'Anon',
        reason: 'Test unauth'
      })
    });
    assert.equal(unauthPost.status, 401);

    // 3. Authenticated POST/PUT/DELETE + export bundle + audit revert
    const jbCreate = await fetch(`${base}/api/jorong-boundaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Passphrase': secret },
      body: JSON.stringify({
        name: 'Jorong Koto Hilalang',
        status: 'indicative',
        source_note: 'Delineasi bersama tokoh masyarakat',
        coordinates: [
          [100.321, -0.335],
          [100.325, -0.335],
          [100.325, -0.331],
          [100.321, -0.331],
          [100.321, -0.335]
        ],
        actor: 'Operator',
        reason: 'Tambah batas indikatif jorong'
      })
    });
    assert.equal(jbCreate.status, 201);
    const jbJson = await jbCreate.json();
    assert.equal(jbJson.feature.properties.name, 'Jorong Koto Hilalang');
    assert.equal(jbJson.feature.properties.status, 'indicative');
    assert.ok(jbJson.feature.properties.area_ha > 10);

    const jbPut = await fetch(`${base}/api/jorong-boundaries/${encodeURIComponent(jbJson.feature.properties.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Passphrase': secret },
      body: JSON.stringify({
        status: 'verified',
        actor: 'Wali Nagari',
        reason: 'Disahkan musyawarah jorong'
      })
    });
    assert.equal(jbPut.status, 200);
    const jbPutJson = await jbPut.json();
    assert.equal(jbPutJson.feature.properties.status, 'verified');

    const bundle = await (await fetch(`${base}/api/export/bundle`)).json();
    assert.equal(bundle.jorongBoundaries.features.length, 1);

    // Revert the PUT status update back to indicative
    const revertRes = await fetch(`${base}/api/audit/${jbPutJson.log.id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Passphrase': secret },
      body: JSON.stringify({ actor: 'Admin', reason: 'Cek revert jorong' })
    });
    assert.equal(revertRes.status, 200);
    const afterRevert = await (await fetch(`${base}/api/jorong-boundaries`)).json();
    assert.equal(afterRevert.jorongBoundaries.features[0].properties.status, 'indicative');

    const jbDel = await fetch(`${base}/api/jorong-boundaries/${encodeURIComponent(jbJson.feature.properties.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Passphrase': secret },
      body: JSON.stringify({ actor: 'Admin', reason: 'Bersihkan uji' })
    });
    assert.equal(jbDel.status, 200);
    const afterDel = await (await fetch(`${base}/api/jorong-boundaries`)).json();
    assert.equal(afterDel.jorongBoundaries.features.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
