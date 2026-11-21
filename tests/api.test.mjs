import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server/index.mjs';

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
