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
  filterOverlappingFlowPaths,
  snapFlowPathsToWaterways,
  renderLandCoverRaster,
  renderScourChangeRaster,
  computeCascadeFields,
  chaikinSmooth,
  encodePngRgba,
  DX,
  DY
} from '../scripts/lib/hydrology.mjs';
import { CascadeEngine, extractBuildingCentroids } from '../src/lib/cascadeEngine.ts';
import { estimateChannelThresholds } from '../src/lib/channelHydraulics.ts';
import { lookupAgamAtPoint } from '../src/lib/agamLookup.ts';

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

  const draft = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'drainage-draft.geojson'), 'utf8'));
  const draftCrossings = draft.features.filter(f => f.properties?.kind === 'drainage');
  assert(draftCrossings.length >= 1, 'expected detected crossings in drainage-draft.geojson');
  for (const c of draftCrossings) {
    assert.equal(c.properties.status, 'unverified', `uninspected crossing ${c.properties.id} must be unverified`);
  }
});

test('filterOverlappingFlowPaths drops DEM reaches near verified waterways while preserving distant tributaries', () => {
  const verified = [
    {
      type: 'Feature',
      properties: { id: 'ww-1', name: 'Batang Uji' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.320, -0.340],
          [100.320, -0.330]
        ]
      }
    }
  ];
  const flowPathsFC = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'flow-dup', tier: 1 },
        geometry: {
          type: 'LineString',
          // ~35m east of verified waterway (typical 30m DEM drift)
          coordinates: [
            [100.32031, -0.340],
            [100.32031, -0.335],
            [100.32031, -0.330]
          ]
        }
      },
      {
        type: 'Feature',
        properties: { id: 'flow-trib', tier: 2 },
        geometry: {
          type: 'LineString',
          // ~300m east flowing into the river
          coordinates: [
            [100.323, -0.335],
            [100.3215, -0.335],
            [100.32009, -0.335]
          ]
        }
      }
    ]
  };
  const res = filterOverlappingFlowPaths(flowPathsFC, verified);
  assert.equal(res.filteredCount, 1);
  assert.deepEqual(
    res.features.map(f => f.properties.id),
    ['flow-trib']
  );
});

test('snapFlowPathsToWaterways connects nearby tributary endpoints cleanly without stretching distant reaches', () => {
  const verified = [
    {
      type: 'Feature',
      properties: { id: 'ww-1', name: 'Batang Uji' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.320, -0.340],
          [100.320, -0.330]
        ]
      }
    }
  ];
  const flowPathsFC = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'flow-near', tier: 2, catchment_ha: 12 },
        geometry: {
          type: 'LineString',
          // Ends ~65m east of verified river
          coordinates: [
            [100.323, -0.335],
            [100.32058, -0.335]
          ]
        }
      },
      {
        type: 'Feature',
        properties: { id: 'flow-far', tier: 2, catchment_ha: 15 },
        geometry: {
          type: 'LineString',
          // Ends ~330m east of verified river (outside 120m snap threshold)
          coordinates: [
            [100.326, -0.333],
            [100.323, -0.333]
          ]
        }
      }
    ]
  };
  const snapped = snapFlowPathsToWaterways(flowPathsFC, verified, 120, 55);
  const near = snapped.features.find(f => f.properties.id === 'flow-near');
  const far = snapped.features.find(f => f.properties.id === 'flow-far');
  assert.equal(near.properties.snapped_to_verified, true);
  const nearEnd = near.geometry.coordinates[near.geometry.coordinates.length - 1];
  assert(Math.abs(nearEnd[0] - 100.320) < 1e-4, 'near tributary should snap onto verified river line');
  assert.equal(far.properties.snapped_to_verified, undefined);
  assert.deepEqual(far.geometry.coordinates[far.geometry.coordinates.length - 1], [100.323, -0.333]);
});

test('renderLandCoverRaster produces valid PNG output for discrete WorldCover classes', () => {
  const grid = new Uint8Array([10, 30, 40, 50]);
  const png = renderLandCoverRaster(grid, 2, 2, 16);
  assert.equal(png[0], 137);
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert(png.length > 60);
});

test('computeCascadeFields and CascadeEngine obey physical invariants on real Balingka sim-fields', () => {
  const simFieldsPath = path.join(DATA_DIR, 'sim-fields.json');
  const settlementsPath = path.join(DATA_DIR, 'settlements.geojson');
  const fields = JSON.parse(fs.readFileSync(simFieldsPath, 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(settlementsPath, 'utf8'));
  assert(fields.width >= 100 && fields.height >= 100);
  assert(fields.p90TravelMin >= 15 && fields.p90TravelMin <= 240);

  // Also test computeCascadeFields directly on a synthetic slope->valley grid
  const w = 6, h = 6;
  const elev = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) elev[r * w + c] = 1000 + (h - 1 - r) * 8 + Math.abs(c - 3) * 5;
  }
  const filled = priorityFloodFill(elev, w, h);
  const { dir, acc } = computeD8(filled, w, h, 30, 30);
  const slope = computeSlopePercent(elev, w, h, 30, 30);
  const hand = computeHAND(elev, dir, acc, w, h, 4);
  const lc = new Uint8Array(w * h).fill(10);
  const cf = computeCascadeFields({
    rawElev: elev,
    filled,
    dir,
    acc,
    slope,
    hand,
    landCoverClasses: lc,
    bottlenecks: [],
    gridMeta: { width: w, height: h, bbox: { west: 100.3, south: -0.35, east: 100.32, north: -0.33 }, cellSizeX: 30, cellSizeY: 30 }
  });
  assert.equal(cf.width, 6);
  assert(cf.travelTimeTenthMinBase64.length > 0);

  const centroids = extractBuildingCentroids(settlements);
  assert(centroids.length > 500, 'expected extracted OSM building centroids');
  const engine = new CascadeEngine(fields, centroids, 34);

  const dryStart = engine.evaluate({
    rainMmHr: 60,
    durationMin: 120,
    progress: 0,
    soilMoisture: 'moist',
    rainPattern: 'uniform',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  assert.equal(dryStart.stage, 0);
  assert.equal(dryStart.floodAreaHa, 0);
  assert.equal(dryStart.landslideAreaHa, 0);

  const stage1 = engine.evaluate({
    rainMmHr: 100,
    durationMin: 180,
    progress: 0.18,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  const stage4 = engine.evaluate({
    rainMmHr: 100,
    durationMin: 180,
    progress: 0.9,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  assert.equal(stage1.stage, 1);
  assert.equal(stage4.stage, 4);
  assert(stage4.floodAreaHa > stage1.floodAreaHa, 'wave should expand flood corridor from stage 1 to stage 4');
  assert(stage4.landslideAreaHa > stage1.landslideAreaHa, 'landslide area should grow as pore pressure builds');

  const drySoil = engine.evaluate({
    rainMmHr: 60,
    durationMin: 120,
    progress: 0.85,
    soilMoisture: 'dry',
    rainPattern: 'uniform',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  const satSoil = engine.evaluate({
    rainMmHr: 60,
    durationMin: 120,
    progress: 0.85,
    soilMoisture: 'saturated',
    rainPattern: 'uniform',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  assert(satSoil.effectiveRunoffMm > drySoil.effectiveRunoffMm, 'saturated soil must yield higher SCS-CN runoff than dry soil');
  assert(satSoil.floodAreaHa > drySoil.floodAreaHa, 'saturated soil must yield larger flood corridor than dry soil');

  const actualForest = engine.evaluate({
    rainMmHr: 120,
    durationMin: 180,
    progress: 0.9,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'surge',
    forestScenario: 'actual'
  });
  const degForest = engine.evaluate({
    rainMmHr: 120,
    durationMin: 180,
    progress: 0.9,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'surge',
    forestScenario: 'degraded50'
  });
  assert(degForest.landslideAreaHa > actualForest.landslideAreaHa, 'degraded upland forest must increase steep-slope landslide risk');

  const cleared = engine.evaluate({
    rainMmHr: 80,
    durationMin: 180,
    progress: 0.9,
    soilMoisture: 'moist',
    rainPattern: 'uniform',
    drainCondition: 'cleared',
    forestScenario: 'actual'
  });
  const surge = engine.evaluate({
    rainMmHr: 80,
    durationMin: 180,
    progress: 0.9,
    soilMoisture: 'moist',
    rainPattern: 'uniform',
    drainCondition: 'surge',
    forestScenario: 'actual'
  });
  assert(surge.floodAreaHa > cleared.floodAreaHa, 'upland debris surge must exceed cleared channel flood corridor');

  const { floodRgba, landslideRgba } = engine.renderRgba(64);
  assert.equal(floodRgba.length, 64 * 64 * 4);
  assert.equal(landslideRgba.length, 64 * 64 * 4);
});

test('renderScourChangeRaster encodes NDVI loss into amber and crimson PNG pixels', () => {
  const w = 4;
  const h = 4;
  const dNdvi = new Float32Array(w * h);
  dNdvi[0] = -0.25; // amber moderate scour
  dNdvi[5] = -0.4; // crimson severe scour
  dNdvi[15] = 0.05; // unchanged -> transparent
  const png = renderScourChangeRaster(dNdvi, w, h, 8);
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 60);
});

test('estimateChannelThresholds computes width delta, moisture sensitivity, and slope sensitivity', () => {
  const moist = estimateChannelThresholds({
    widthM: 12,
    widthPreM: 8,
    depthM: 2.0,
    slopePct: 6,
    catchmentKm2: 3.5,
    soilMoisture: 'moist'
  });
  const saturated = estimateChannelThresholds({
    widthM: 12,
    widthPreM: 8,
    depthM: 2.0,
    slopePct: 6,
    catchmentKm2: 3.5,
    soilMoisture: 'saturated'
  });
  const shallowGentle = estimateChannelThresholds({
    widthM: 8,
    widthPreM: 6,
    depthM: 0.5,
    slopePct: 2,
    catchmentKm2: 3.5,
    soilMoisture: 'moist'
  });
  const shallowSteep = estimateChannelThresholds({
    widthM: 8,
    widthPreM: 6,
    depthM: 0.5,
    slopePct: 5,
    catchmentKm2: 3.5,
    soilMoisture: 'moist'
  });

  assert.equal(moist.widthDeltaM, 4);
  assert.equal(moist.widthDeltaPct, 50);
  assert.ok(saturated.overflowRainMmHr < moist.overflowRainMmHr);
  assert.ok(saturated.wideningRainMmHr < moist.wideningRainMmHr);
  assert.ok(shallowSteep.wideningRainMmHr < shallowGentle.wideningRainMmHr);
  assert.ok(moist.wideningRange[0] < moist.wideningRange[1]);
  assert.ok(moist.severeScourRainMmHr >= moist.wideningRainMmHr);
});

test('Pemkab Agam GIS context, merged Google Open Buildings v3, and soil calibration integrate cleanly', () => {
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
  const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'metadata.json'), 'utf8'));
  const agamCtx = JSON.parse(fs.readFileSync(path.join(dataDir, 'agam-context.json'), 'utf8'));
  const rbi = JSON.parse(fs.readFileSync(path.join(dataDir, 'agam-rbi-rivers.geojson'), 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(path.join(dataDir, 'settlements.geojson'), 'utf8'));
  const simFields = JSON.parse(fs.readFileSync(path.join(dataDir, 'sim-fields.json'), 'utf8'));

  assert.ok(meta.studyAreaKm2 >= 29, `Expected full Nagari >=29 km², got ${meta.studyAreaKm2}`);
  assert.ok(meta.maxElevM >= 2800, `Expected Gunung Singgalang slope >=2800m, got ${meta.maxElevM}`);
  assert.ok(meta.settlementStats.osmBuildings > 1500);
  assert.ok(meta.settlementStats.googleOpenBuildingsAdded > 100);
  assert.ok(meta.settlementStats.totalBuildings > 2000);
  assert.ok(simFields.nagariMaskBase64);
  assert.ok(settlements.features.some(f => f.properties?.source === 'google_open_buildings'));
  assert.ok(settlements.features.some(f => f.properties?.source === 'osm'));
  assert.ok(rbi.features.length >= 20);
  assert.ok(agamCtx.soil.features.length >= 1);
  assert.ok(agamCtx.landslideHazard.features.length >= 1);
  assert.ok(simFields.soilErodibilityBase64 && simFields.officialLandslideBase64);

  const pahambatan = lookupAgamAtPoint(agamCtx, 100.317, -0.338);
  assert.ok(pahambatan !== null);
  assert.equal(pahambatan.landslideLevel, 'Tinggi');
  assert.equal(pahambatan.soilType, 'Andosol');

  const subarang = lookupAgamAtPoint(agamCtx, 100.326, -0.324);
  assert.ok(subarang !== null);
  assert.equal(subarang.soilType, 'Kambisol');

  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), 37);
  const peak = engine.evaluate({
    rainMmHr: 120,
    durationMin: 180,
    progress: 0.92,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'surge',
    forestScenario: 'actual'
  });
  assert.ok(peak.officialLandslideOverlapPct >= 20, `Expected official overlap >=20%, got ${peak.officialLandslideOverlapPct}`);
});
