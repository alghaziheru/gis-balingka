import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  priorityFloodFill,
  computeD8,
  computeSlopePercent,
  computeHAND,
  burnStreamsIntoDem,
  chaikinSmooth,
  encodePngRgba,
  DX,
  DY
} from '../scripts/lib/hydrology.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'public', 'data');

test('priorityFloodFill removes interior sink and guarantees acyclic drainage', () => {
  const w = 5, h = 5;
  const elev = new Float32Array([
    12, 12, 12, 12, 12,
    12, 10, 10, 10, 12,
    5,  10,  2, 10, 12,
    12, 10, 10, 10, 12,
    12, 12, 12, 12, 12
  ]);
  const filled = priorityFloodFill(elev, w, h);
  assert(filled[2 * w + 2] >= 10, 'interior sink should be filled up to spill threshold');
  const { dir, acc } = computeD8(filled, w, h, 30, 30);

  let cur = 2 * w + 2;
  const seen = new Set();
  while (dir[cur] >= 0) {
    assert(!seen.has(cur), 'D8 flow should never loop');
    seen.add(cur);
    const r = Math.floor(cur / w);
    const c = cur - r * w;
    cur = (r + DY[dir[cur]]) * w + (c + DX[dir[cur]]);
  }
  assert(acc[cur] >= 9);
});

test('computeD8 conserves total cell count across border outlets', () => {
  const w = 6, h = 6;
  const elev = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) elev[r * w + c] = 100 + r * 5 + c * 2;
  }
  const filled = priorityFloodFill(elev, w, h);
  const { dir, acc } = computeD8(filled, w, h, 30, 30);
  let outletSum = 0;
  for (let i = 0; i < w * h; i++) if (dir[i] < 0) outletSum += acc[i];
  assert.equal(outletSum, w * h);
});

test('computeHAND returns 0 on streams and exact height difference on slopes', () => {
  const w = 7, h = 7;
  const elev = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) elev[r * w + c] = 100 + r * 2 + Math.abs(c - 3) * 10;
  }
  const filled = priorityFloodFill(elev, w, h);
  const { dir, acc } = computeD8(filled, w, h, 30, 30);
  const slope = computeSlopePercent(elev, w, h, 30, 30);
  assert(slope[3 * w + 1] > 20);

  const hand = computeHAND(elev, dir, acc, w, h, 6);
  assert.equal(hand[2 * w + 3], 0);
  assert(hand[3 * w + 1] >= 18 && hand[3 * w + 1] <= 24);
});

test('burnStreamsIntoDem carves verified stream centerline and shoulder gently into DEM copy', () => {
  const w = 10, h = 10;
  const raw = new Float32Array(w * h).fill(1000);
  const gridMeta = {
    width: w,
    height: h,
    bbox: { west: 100.3, south: -0.35, east: 100.35, north: -0.3 },
    cellSizeX: 500,
    cellSizeY: 500
  };
  const streams = [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.31, -0.325],
          [100.34, -0.325]
        ]
      }
    }
  ];
  const { elev: burned, burnedCellCount } = burnStreamsIntoDem(raw, streams, gridMeta, 3.0);
  assert(burnedCellCount > 0);
  assert.equal(raw[5 * w + 5], 1000, 'input raw DEM must not be mutated');
  assert.equal(burned[5 * w + 5], 997, 'centerline cell should be carved by full depth');
  assert(Math.abs(burned[4 * w + 5] - 998.95) < 1e-4, 'adjacent shoulder cell should receive gentler carve');
});

test('chaikinSmooth preserves endpoints and encodePngRgba produces valid PNG header', () => {
  const line = [[100.31, -0.34], [100.32, -0.34], [100.32, -0.33]];
  const smoothed = chaikinSmooth(line, 2);
  assert.deepEqual(smoothed[0], line[0]);
  assert.deepEqual(smoothed[smoothed.length - 1], line[line.length - 1]);
  assert(smoothed.length > line.length);

  const rgba = new Uint8Array(4 * 4 * 4);
  rgba.fill(255);
  const png = encodePngRgba(4, 4, rgba);
  assert.equal(png[0], 137);
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
});

test('generated Balingka-only block assets, smooth PNGs, and mask.geojson are valid', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'metadata.json'), 'utf8'));
  assert(meta.studyAreaKm2 > 15 && meta.studyAreaKm2 < 30, `expected ~20.9 km2 Balingka block, got ${meta.studyAreaKm2}`);
  assert(meta.simAreasHa.clogged.high > meta.simAreasHa.cleared.high, 'cleared crossings should reduce HAND footprint');
  assert(meta.osmPlaceCount >= 3);

  const requiredPngs = [
    'raster-relief.png',
    'raster-elev.png',
    'raster-slope.png',
    'raster-hand-clogged-low.png',
    'raster-hand-clogged-med.png',
    'raster-hand-clogged-high.png',
    'raster-hand-cleared-low.png',
    'raster-hand-cleared-med.png',
    'raster-hand-cleared-high.png'
  ];
  for (const name of requiredPngs) {
    const buf = fs.readFileSync(path.join(DATA_DIR, name));
    assert(buf.length > 1000, `${name} unexpectedly small`);
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${name} is not valid PNG`);
  }

  const mask = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mask.geojson'), 'utf8'));
  assert.equal(mask.features[0].geometry.type, 'Polygon');
  assert.equal(mask.features[0].geometry.coordinates.length, 2, 'mask polygon should have outer ring and Balingka cutout hole');

  for (const file of ['watershed.geojson', 'contours.geojson', 'flow-paths.geojson', 'osm-context.geojson', 'drainage-draft.geojson']) {
    const fc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    assert.equal(fc.type, 'FeatureCollection');
    assert(fc.features.length >= 1, `${file} empty`);
  }
});
