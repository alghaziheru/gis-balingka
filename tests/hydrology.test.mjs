import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
import {
  listCopernicusTiles,
  listWorldCoverTiles,
  listSlippyTiles,
  isInsideOpenBuildings2fd
} from '../scripts/lib/tiles.mjs';
import { runResetRegion } from '../scripts/reset-region.mjs';
import { CascadeEngine, extractBuildingCentroids } from '../src/lib/cascadeEngine.ts';
import { estimateChannelThresholds, resolveWaterwayCatchmentFromNetwork } from '../src/lib/channelHydraulics.ts';
import { buildHyetograph, getMaxRealisticRainMmHr } from '../src/lib/reachRouter.ts';
import {
  buildFieldSurveyPriorityCsv,
  buildHydrographCsv,
  buildScenarioExportJson
} from '../src/lib/scenarioExport.ts';
import {
  computeCrossingCapacityM3s,
  decodeScourMaskFromPng,
  parseStructureOpening
} from '../scripts/lib/reach-network.mjs';
import { buildFlowField, sampleFlowVelocity } from '../src/lib/flowField.ts';
import { buildFlowCorridors, sampleCorridorAtDistance } from '../src/lib/flowRibbons.ts';
import {
  extractFloodPoolPolygons,
  marchingSquaresPolygons
} from '../src/lib/poolContours.ts';
import { computeRunoffMergeNetwork } from '../src/lib/geometry.ts';
import { getOverlayContrastPalette, isDarkBasemap } from '../src/lib/mapPalette.ts';
import { lookupAgamAtPoint } from '../src/lib/agamLookup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'public', 'data');
const REGION_CFG = fs.existsSync(path.join(ROOT_DIR, 'region.config.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'region.config.json'), 'utf8'))
  : { id: 'nagari-balingka' };
const IS_BALINGKA = REGION_CFG.id === 'nagari-balingka';

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

test('generated region block assets, smooth PNGs, and mask.geojson are valid', t => {
  if (!fs.existsSync(path.join(DATA_DIR, 'metadata.json'))) {
    t.skip('public/data/metadata.json not generated yet (run pnpm run prepare-data)');
    return;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'metadata.json'), 'utf8'));
  assert(meta.studyAreaKm2 > 0.1, `expected positive study area, got ${meta.studyAreaKm2}`);
  if (IS_BALINGKA) {
    assert(meta.studyAreaKm2 > 15 && meta.studyAreaKm2 < 30, `expected ~29.89 km2 Balingka block, got ${meta.studyAreaKm2}`);
    assert(meta.osmPlaceCount >= 3);
  }
  assert(meta.simAreasHa.clogged.high >= meta.simAreasHa.cleared.high, 'cleared crossings should not increase HAND footprint');

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
    assert(buf.length > 500, `${name} unexpectedly small`);
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${name} is not valid PNG`);
  }

  const mask = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mask.geojson'), 'utf8'));
  assert.equal(mask.features[0].geometry.type, 'Polygon');
  assert(mask.features[0].geometry.coordinates.length >= 2, 'mask polygon should have outer ring and region cutout hole');

  for (const file of ['watershed.geojson', 'contours.geojson', 'flow-paths.geojson', 'osm-context.geojson', 'drainage-draft.geojson']) {
    const fc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    assert.equal(fc.type, 'FeatureCollection');
    assert(Array.isArray(fc.features), `${file} missing features array`);
    if (IS_BALINGKA) assert(fc.features.length >= 1, `${file} empty`);
  }

  const draft = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'drainage-draft.geojson'), 'utf8'));
  const draftCrossings = draft.features.filter(f => f.properties?.kind === 'drainage');
  if (IS_BALINGKA) assert(draftCrossings.length >= 1, 'expected detected crossings in drainage-draft.geojson');
  for (const c of draftCrossings) {
    assert.equal(c.properties.status, 'unverified', `uninspected crossing ${c.properties.id} must be unverified`);
  }
  assert.equal(
    draft.features.some(f => f.properties?.kind === 'bronjong'),
    false,
    'drainage-draft.geojson must not include bronjong engineering recommendation points'
  );
  const draftRaw = JSON.stringify(draft);
  for (const banned of ['Kandidat Evakuasi', 'Kandidat Cekdam', 'rawan luncuran']) {
    assert.equal(draftRaw.includes(banned), false, `drainage-draft.geojson must not contain "${banned}"`);
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

test('computeCascadeFields and CascadeEngine obey physical invariants on active sim-fields', t => {
  const simFieldsPath = path.join(DATA_DIR, 'sim-fields.json');
  const settlementsPath = path.join(DATA_DIR, 'settlements.geojson');
  if (!fs.existsSync(simFieldsPath) || !fs.existsSync(settlementsPath)) {
    t.skip('sim-fields.json / settlements.geojson not present yet');
    return;
  }
  const fields = JSON.parse(fs.readFileSync(simFieldsPath, 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(settlementsPath, 'utf8'));
  assert(fields.width >= 20 && fields.height >= 20);
  if (IS_BALINGKA) {
    assert(fields.width >= 100 && fields.height >= 100);
    assert(fields.p90TravelMin >= 15 && fields.p90TravelMin <= 240);
  }

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
  if (IS_BALINGKA) {
    assert(centroids.length > 500, 'expected extracted OSM building centroids');
  }
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

test('Pemkab Agam GIS context, merged Google Open Buildings v3, and soil calibration integrate cleanly', t => {
  if (!IS_BALINGKA) {
    t.skip(`Balingka-specific Pemkab Agam fixture check skipped for custom region "${REGION_CFG.id}"`);
    return;
  }
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

test('computeRunoffMergeNetwork slices downstream tributary reach, propagates to receiving river, and handles cyclic touchpoints', () => {
  const flows = [
    {
      type: 'Feature',
      properties: { id: 'f-trib', tier: 1 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.312, -0.348],
          [100.312, -0.346] // hits mid-segment of tributary-1 (~halfway along segment 0->1)
        ]
      }
    }
  ];

  const waterways = [
    {
      type: 'Feature',
      properties: {
        id: 'trib-1',
        name: 'Anak Sungai Uji',
        kind: 'stream',
        status: 'normal',
        source: 'manual',
        source_ref: null,
        notes: '',
        length_m: 600,
        updated_by: 'test',
        updated_at: '2026-01-01T00:00:00Z'
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.310, -0.346], // upstream start (should be omitted from sliced downstream reach)
          [100.314, -0.346],
          [100.314, -0.344] // outlet touches river-main at its midpoint
        ]
      }
    },
    {
      type: 'Feature',
      properties: {
        id: 'river-main',
        name: 'Sungai Utama Uji',
        kind: 'river',
        status: 'normal',
        source: 'manual',
        source_ref: null,
        notes: '',
        length_m: 800,
        updated_by: 'test',
        updated_at: '2026-01-01T00:00:00Z'
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.312, -0.344],
          [100.316, -0.344],
          [100.318, -0.344]
        ]
      }
    },
    {
      // Cyclic touchpoint back toward trib-1 to confirm termination without infinite loops
      type: 'Feature',
      properties: {
        id: 'loop-drain',
        name: 'Saluran Uji',
        kind: 'drain',
        status: 'normal',
        source: 'manual',
        source_ref: null,
        notes: '',
        length_m: 400,
        updated_by: 'test',
        updated_at: '2026-01-01T00:00:00Z'
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.318, -0.344],
          [100.310, -0.346]
        ]
      }
    }
  ];

  const net = computeRunoffMergeNetwork(flows, waterways, 45);
  assert.equal(net.mergingFlowIds.has('f-trib'), true);
  assert.equal(net.confluences.length, 1);
  assert.equal(net.confluences[0].waterwayId, 'trib-1');
  assert.ok(Math.abs(net.confluences[0].coordinates[0] - 100.312) < 1e-4);

  const tribReach = net.mergedReaches.find(r => r.waterwayId === 'trib-1');
  assert.ok(tribReach, 'Tributary downstream reach should be included');
  assert.equal(tribReach.directRunoff, true);
  assert.ok(tribReach.coordinates[0][0] > 100.311, 'Upstream half of tributary before merge must be omitted');

  const mainReach = net.mergedReaches.find(r => r.waterwayId === 'river-main');
  assert.ok(mainReach, 'Receiving main river reach should inherit merged flow downstream');
  assert.equal(mainReach.directRunoff, false);
  assert.ok(mainReach.coordinates[0][0] >= 100.3139, 'Main river reach should begin at tributary junction');
});

test('computeRunoffMergeNetwork detects real Balingka confluences and downstream propagation', t => {
  if (!IS_BALINGKA) {
    t.skip(`Balingka-specific confluence fixture check skipped for custom region "${REGION_CFG.id}"`);
    return;
  }
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
  const flowPaths = JSON.parse(fs.readFileSync(path.join(dataDir, 'flow-paths.geojson'), 'utf8'));
  const verifiedWaterways = JSON.parse(fs.readFileSync(path.join(dataDir, 'verified-waterways.geojson'), 'utf8'));

  const net = computeRunoffMergeNetwork(flowPaths.features, verifiedWaterways.features, 45);
  assert.ok(net.confluences.length > 0, 'Expected at least one runoff-to-waterway confluence');
  assert.ok(net.mergingFlowIds.size > 0, 'Expected merging flow path IDs');

  const names = new Set(net.mergedReaches.map(r => r.waterwayName));
  assert.ok(names.has('Anak Sungai #001'), `Expected Anak Sungai #001 in mergedReaches, got ${Array.from(names).join(', ')}`);
  assert.ok(names.has('Batang Ngalai'), `Expected Batang Ngalai in mergedReaches, got ${Array.from(names).join(', ')}`);
});

test('getOverlayContrastPalette adapts overlay colors for dark Satellite vs light daylight basemaps', () => {
  assert.equal(isDarkBasemap('sat'), true);
  assert.equal(isDarkBasemap('osm'), false);
  assert.equal(isDarkBasemap('topo'), false);
  assert.equal(isDarkBasemap('relief'), false);

  const sat = getOverlayContrastPalette('sat');
  const osm = getOverlayContrastPalette('osm');
  const topo = getOverlayContrastPalette('topo');

  assert.equal(sat.roads.casingColor, '#161c1a');
  assert.equal(sat.roads.secondaryCoreColor, '#fde047');
  assert.equal(sat.roads.localCoreColor, '#f8fafc');
  assert.equal(sat.contours.majorColor, '#fef3c7');
  assert.ok(sat.contours.majorCasingOpacity > 0);
  assert.equal(sat.agamForest.lineColor, '#86efac');
  assert.equal(sat.agamRbi.lineColor, '#22d3ee');

  assert.equal(osm.contours.majorColor, '#78350f');
  assert.equal(osm.contours.majorCasingOpacity, 0);
  assert.equal(osm.agamRbi.lineColor, '#0e7490');
  assert.equal(osm.agamForest.lineColor, '#15803d');
  assert.deepEqual(osm, topo);
});

test('multi-tile Copernicus DEM, ESA WorldCover, Slippy Terrarium & Open Buildings helpers cover tile boundaries', () => {
  // Single-tile Balingka bbox
  const balingka = { west: 100.278, south: -0.408, east: 100.345, north: -0.314 };
  const balCop = listCopernicusTiles(balingka);
  assert.equal(balCop.length, 1);
  assert.ok(balCop[0].url.includes('Copernicus_DSM_COG_10_S01_00_E100_00_DEM'));
  const balWc = listWorldCoverTiles(balingka);
  assert.equal(balWc.length, 1);
  assert.ok(balWc[0].url.includes('S03E099'));
  assert.equal(isInsideOpenBuildings2fd(balingka), true);

  // Village straddling a 1-degree lat & lng line (4 Copernicus tiles) and 3-degree boundary (4 WorldCover tiles)
  const straddle = { west: 107.95, south: -6.05, east: 108.05, north: -5.95 };
  const multiCop = listCopernicusTiles(straddle);
  assert.equal(multiCop.length, 4);
  const multiWc = listWorldCoverTiles(straddle);
  assert.equal(multiWc.length, 4);
  assert.equal(isInsideOpenBuildings2fd(straddle), false);

  const slippy = listSlippyTiles(balingka, 13);
  assert.ok(slippy.txList.includes(6378) && slippy.txList.includes(6379));
  assert.ok(slippy.tyList.length >= 2);
});

test('reset-region blocks accidental wipe on nagari-balingka and cleans stale artifacts for custom regions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gis-reset-region-'));
  try {
    fs.mkdirSync(path.join(dir, 'public', 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'region.config.json'), JSON.stringify({ id: 'nagari-balingka', name: 'Nagari Balingka' }));
    fs.writeFileSync(path.join(dir, 'public', 'data', 'agam-context.json'), '{}');
    fs.writeFileSync(path.join(dir, 'public', 'data', 'nagari-boundary.geojson'), '{}');
    fs.writeFileSync(path.join(dir, 'data', 'balingka.db'), 'sqlite');

    // 1. Blocked when id is still nagari-balingka without force
    const blocked = runResetRegion({ rootDir: dir, force: false });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, true);
    assert.equal(fs.existsSync(path.join(dir, 'public', 'data', 'agam-context.json')), true);

    // 2. Allowed once region.config.json uses a custom id
    fs.writeFileSync(path.join(dir, 'region.config.json'), JSON.stringify({ id: 'desa-sukamaju', name: 'Desa Sukamaju' }));
    const dry = runResetRegion({ rootDir: dir, dryRun: true });
    assert.equal(dry.ok, true);
    assert.equal(dry.removed.length, 3);
    assert.equal(fs.existsSync(path.join(dir, 'public', 'data', 'agam-context.json')), true);

    const cleaned = runResetRegion({ rootDir: dir });
    assert.equal(cleaned.ok, true);
    assert.equal(cleaned.removed.length, 3);
    assert.equal(fs.existsSync(path.join(dir, 'public', 'data', 'agam-context.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'public', 'data', 'nagari-boundary.geojson')), false);
    assert.equal(fs.existsSync(path.join(dir, 'data', 'balingka.db')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildFlowField computes downhill vectors, verified-waterway channelMask, and bounded uplandBbox', () => {
  const simFields = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sim-fields.json'), 'utf8'));
  const w = 12;
  const h = 14;
  const n = w * h;
  const slopePct = new Uint8Array(n).fill(22);
  const accNorm = new Uint8Array(n).fill(20);
  const uplandWeight = new Uint8Array(n);
  const nagariMask = new Uint8Array(n).fill(1);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      uplandWeight[r * w + c] = r <= 4 ? 200 : 40;
    }
  }
  const toB64 = arr => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');

  const synthFields = {
    ...simFields,
    width: w,
    height: h,
    bbox: { west: 100.3, south: -0.36, east: 100.32, north: -0.34 },
    cellSizeX: 15,
    cellSizeY: 15,
    slopePctBase64: toB64(slopePct),
    accNormBase64: toB64(accNorm),
    uplandWeightBase64: toB64(uplandWeight),
    nagariMaskBase64: toB64(nagariMask)
  };

  // Synthetic terrain sloping smoothly from north-west (high) to south-east (low)
  const getElev = (lng, lat) => {
    const u = (lng - synthFields.bbox.west) / (synthFields.bbox.east - synthFields.bbox.west);
    const v = (synthFields.bbox.north - lat) / (synthFields.bbox.north - synthFields.bbox.south);
    return 1800 - u * 120 - v * 260;
  };

  const waterways = [
    {
      type: 'Feature',
      properties: {
        id: 'ww-synth-1',
        name: 'Saluran Uji',
        kind: 'stream',
        status: 'normal',
        source: 'manual',
        source_ref: null,
        notes: '',
        length_m: 300,
        updated_by: 'test',
        updated_at: '2026-01-01T00:00:00Z'
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [100.31, -0.342],
          [100.31, -0.358]
        ]
      }
    }
  ];

  const field = buildFlowField(synthFields, getElev, waterways);
  assert.equal(field.vx.length, n);
  assert.equal(field.vy.length, n);

  // Downhill vector in interior points eastward (+vx) and southward (+vy)
  const centerIdx = 7 * w + 3;
  assert.ok(field.vx[centerIdx] > 0.2, `Expected positive +x downhill component, got ${field.vx[centerIdx]}`);
  assert.ok(field.vy[centerIdx] > 0.6, `Expected positive +y downhill component, got ${field.vy[centerIdx]}`);
  const mag = Math.hypot(field.vx[centerIdx], field.vy[centerIdx]);
  assert.ok(Math.abs(mag - 1) < 0.02, `Expected normalized flow vector, got magnitude ${mag}`);

  // Verified waterway boosts channelMask near lng=100.31 (col ~ 6)
  const midChannelIdx = 7 * w + 6;
  assert.ok(field.channelMask[midChannelIdx] >= 140, `Expected boosted channelMask along waterway, got ${field.channelMask[midChannelIdx]}`);

  // uplandBbox stays inside synthFields.bbox and covers northern rows
  assert.ok(field.uplandBbox.west >= synthFields.bbox.west && field.uplandBbox.east <= synthFields.bbox.east);
  assert.ok(field.uplandBbox.north <= synthFields.bbox.north && field.uplandBbox.south >= synthFields.bbox.south);
  assert.ok(field.uplandBbox.south > -0.35, `Expected uplandBbox in northern rows, got south=${field.uplandBbox.south}`);

  // sampleFlowVelocity stays finite at interior and corners
  for (const [u, v] of [[0, 0], [0.5, 0.5], [1, 1], [-0.2, 1.4]]) {
    const s = sampleFlowVelocity(field, u, v);
    assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy) && Number.isFinite(s.speed) && Number.isFinite(s.channel));
    assert.ok(s.speed >= 0.15 && s.speed <= 1.0);
  }
});

test('marchingSquaresPolygons and extractFloodPoolPolygons filter isolated pockets and keep river-corridor pools', () => {
  // 1. Synthetic closed pond on a 10x10 grid
  const w = 10;
  const h = 10;
  const grid = new Float32Array(w * h);
  for (let r = 3; r <= 6; r++) {
    for (let c = 3; c <= 6; c++) {
      grid[r * w + c] = r >= 4 && r <= 5 && c >= 4 && c <= 5 ? 0.75 : 0.3;
    }
  }
  const bbox = { west: 100.3, south: -0.36, east: 100.32, north: -0.34 };
  const fc = marchingSquaresPolygons(grid, w, h, bbox, 0.2, null, 2);
  assert.ok(fc.features.length === 1, `Expected 1 closed pool polygon, got ${fc.features.length}`);
  const ring = fc.features[0].geometry.type === 'Polygon' ? fc.features[0].geometry.coordinates[0] : [];
  assert.ok(ring.length >= 8, `Expected smoothed polygon ring, got ${ring.length} vertices`);
  assert.deepEqual(ring[0], ring[ring.length - 1], 'Ring must be closed');

  // 2. Connectivity filter rejects isolated 2-cell upland pocket and keeps corridor-connected flooding
  const fw = 16;
  const fh = 16;
  const fn = fw * fh;
  const fakeDepth = new Float32Array(fn);
  const fakeAcc = new Uint8Array(fn).fill(15);
  // Isolated 2-cell upland pocket (no channel seed, < 4 cells)
  fakeDepth[2 * fw + 2] = 0.55;
  fakeDepth[2 * fw + 3] = 0.55;
  // Connected 6-cell valley corridor touching channel seed
  for (let c = 6; c <= 11; c++) {
    fakeDepth[10 * fw + c] = 0.45;
    fakeAcc[10 * fw + c] = 140;
  }
  const mockEngine = {
    fields: {
      width: fw,
      height: fh,
      bbox,
      cellSizeX: 40,
      cellSizeY: 40
    },
    getFloodDepthGrid: () => fakeDepth,
    getAccNorm: () => fakeAcc,
    getNagariMask: () => null
  };
  const filtered = extractFloodPoolPolygons(mockEngine, []);
  assert.equal(filtered.shallow.features.length, 1, 'Expected only the corridor-connected pool, not the isolated pocket');

  // 3. Real Balingka sim-fields river-corridor pool extraction
  const simFields = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sim-fields.json'), 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settlements.geojson'), 'utf8'));
  const verifiedWaterways = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'verified-waterways.geojson'), 'utf8'));
  const wwFeatures = verifiedWaterways.features || verifiedWaterways;
  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), 37);

  const params = {
    rainMmHr: 120,
    durationMin: 180,
    progress: 0.75,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  };
  engine.evaluate(params);

  const t0 = performance.now();
  const pools = extractFloodPoolPolygons(engine, wwFeatures);
  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 90, `Expected fast marching-squares extraction (<90 ms), took ${elapsedMs.toFixed(1)} ms`);
  assert.ok(pools.shallow.features.length > 0, 'Expected corridor-connected shallow polygons in extreme rain');
  assert.ok(pools.deep.features.length > 0, 'Expected corridor-connected deep polygons in extreme rain');
  assert.ok(pools.glintPoints.length > 0, 'Expected glint coordinates inside corridor-connected water');
});

test('buildFlowCorridors orients downhill with multi-point sampling, includes BIG RBI tributaries, and interpolates smoothly', () => {
  const flowPaths = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'flow-paths.geojson'), 'utf8'));
  const verifiedWaterways = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'verified-waterways.geojson'), 'utf8'));
  const agamRbi = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'agam-rbi-rivers.geojson'), 'utf8'));
  const wwList = verifiedWaterways.features || verifiedWaterways;
  const getElev = (lng, lat) => 1600 - (lng - 100.28) * 1500 - (lat + 0.35) * 4000;

  const corridors = buildFlowCorridors(wwList, flowPaths, [], getElev, agamRbi, {
    includeVerified: true,
    includeRbi: true
  });
  assert.ok(corridors.length > 5, `Expected multiple flow corridors, got ${corridors.length}`);
  assert.ok(corridors.some(c => c.kind === 'rbi_tributary'), 'Expected rbi_tributary corridors when includeRbi=true');
  assert.ok(corridors.some(c => c.kind === 'verified_river' || c.kind === 'verified_channel'));

  const noRbi = buildFlowCorridors(wwList, flowPaths, [], getElev, agamRbi, {
    includeVerified: true,
    includeRbi: false
  });
  assert.equal(noRbi.some(c => c.kind === 'rbi_tributary'), false, 'Expected no rbi_tributary when includeRbi=false');

  const noVerified = buildFlowCorridors(wwList, flowPaths, [], getElev, agamRbi, {
    includeVerified: false,
    includeRbi: true
  });
  assert.equal(
    noVerified.some(c => c.kind === 'verified_river' || c.kind === 'verified_channel'),
    false,
    'Expected no verified corridors when includeVerified=false'
  );

  // Multi-point orientation resists a single noisy endpoint elevation spike
  const noisyFlowFc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'noisy-1', tier: 1, length_m: 500 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [100.31, -0.34],
            [100.31, -0.342],
            [100.31, -0.344],
            [100.31, -0.346],
            [100.31, -0.348],
            [100.31, -0.35]
          ]
        }
      }
    ]
  };
  const noisyCorridors = buildFlowCorridors([], noisyFlowFc, [], (lng, lat) => {
    if (Math.abs(lat - -0.34) < 0.0005) return 900; // artificial pit at first vertex only
    return 1600 - (lng - 100.28) * 1000 + (lat + 0.35) * 4000; // north (-0.34) = 1610 m > south (-0.35) = 1570 m
  });
  assert.equal(noisyCorridors.length, 1);
  assert.ok(
    noisyCorridors[0].coords[0][1] > noisyCorridors[0].coords[noisyCorridors[0].coords.length - 1][1],
    'Multi-point check should keep high-north start oriented downhill despite single noisy vertex'
  );

  const first = corridors[0];
  assert.ok(first.totalLengthM > 35);
  assert.ok(first.strandCount >= 3 && first.strandCount <= 7);

  const s0 = sampleCorridorAtDistance(first, 0);
  const sMid = sampleCorridorAtDistance(first, first.totalLengthM * 0.5);
  assert.ok(Number.isFinite(s0.lng) && Number.isFinite(s0.lat) && Number.isFinite(s0.nx) && Number.isFinite(s0.ny));
  assert.ok(Number.isFinite(sMid.lng) && Number.isFinite(sMid.lat));
});

test('CascadeEngine runoffMmGrid and sampleAtLngLat reflect all soil/forest/corridor parameters', () => {
  const simFields = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sim-fields.json'), 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settlements.geojson'), 'utf8'));
  const verifiedWaterways = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'verified-waterways.geojson'), 'utf8'));
  const wwList = verifiedWaterways.features || verifiedWaterways;
  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), 37);

  const avgGrid = arr => {
    let s = 0;
    let c = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > 0) {
        s += arr[i];
        c++;
      }
    }
    return c > 0 ? s / c : 0;
  };

  engine.evaluate({
    rainMmHr: 80,
    durationMin: 180,
    progress: 0.7,
    soilMoisture: 'dry',
    rainPattern: 'uniform',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  const dryAvg = avgGrid(engine.getRunoffMmGrid());

  engine.evaluate({
    rainMmHr: 80,
    durationMin: 180,
    progress: 0.7,
    soilMoisture: 'saturated',
    rainPattern: 'uniform',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  const satAvg = avgGrid(engine.getRunoffMmGrid());
  assert.ok(satAvg > dryAvg, `Expected saturated runoff (${satAvg.toFixed(1)}) > dry (${dryAvg.toFixed(1)})`);

  engine.evaluate({
    rainMmHr: 80,
    durationMin: 180,
    progress: 0.7,
    soilMoisture: 'saturated',
    rainPattern: 'uniform',
    drainCondition: 'clogged',
    forestScenario: 'degraded50'
  });
  const degradedAvg = avgGrid(engine.getRunoffMmGrid());
  assert.ok(degradedAvg > satAvg, `Expected saturated degraded50 runoff (${degradedAvg.toFixed(1)}) > actual (${satAvg.toFixed(1)})`);

  engine.evaluate({
    rainMmHr: 120,
    durationMin: 180,
    progress: 0.75,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });

  const sample = engine.sampleAtLngLat(100.312, -0.346);
  assert.ok(
    Number.isFinite(sample.depthM) &&
      Number.isFinite(sample.handM) &&
      Number.isFinite(sample.runoffMm) &&
      sample.insideNagari
  );

  const pools = extractFloodPoolPolygons(engine, wwList);
  assert.ok(pools.yard.features.length > 0, 'Expected corridor-connected yard depth contours in extreme rain');
  assert.ok(pools.deep.features.length > 0, 'Expected corridor-connected deep contours in extreme rain');
});

test('v2 hyetograph mass conservation, recession tail, scour PNG decode, and culvert orifice capacity', () => {
  for (const shape of ['uniform', 'convective_front', 'alternating_block', 'double_burst']) {
    const hy = buildHyetograph(80, 180, shape, 28);
    assert.ok(hy.totalWindowMin > 180, 'recession window must extend past storm duration');
    assert.ok(hy.steps.some(s => s.isRecession && s.rainMmHr === 0), 'recession steps must have zero rain');
    const finalCum = hy.steps[hy.steps.length - 1].cumRainMm;
    const expectedVol = 80 * (180 / 60); // 240 mm exact
    assert.ok(
      Math.abs(finalCum - expectedVol) < 0.25,
      `${shape} must conserve total storm rainfall (${finalCum} vs ${expectedVol})`
    );
  }

  // Round-trip PNG scour mask decode
  const dNdvi = new Float32Array([
    -0.42, -0.24, 0.05, 0.0,
    -0.25, -0.45, 0.01, -0.1,
    0.0, 0.0, -0.4, -0.25,
    0.1, 0.0, 0.0, -0.41
  ]);
  const png = renderScourChangeRaster(dNdvi, 4, 4, 4);
  const decoded = decodeScourMaskFromPng(png, 4, 4);
  assert.equal(decoded[0], 2, 'severe crimson pixel must decode to 2');
  assert.equal(decoded[1], 1, 'moderate amber pixel must decode to 1');
  assert.equal(decoded[2], 0, 'unchanged pixel must decode to 0');

  // Culvert opening parsing & orifice capacity scaling
  const parsedBox = parseStructureOpening({ size_note: 'Box 1.5m x 1.2m' });
  assert.equal(parsedBox.widthM, 1.5);
  assert.equal(parsedBox.heightM, 1.2);
  assert.equal(parsedBox.measured, true);
  const parsedPipe = parseStructureOpening({ size_note: 'Pipa Ø 80cm' });
  assert.ok(Math.abs(parsedPipe.widthM - 0.8) < 0.01);
  assert.equal(parsedPipe.isCircular, true);

  const capBox = computeCrossingCapacityM3s({
    kind: 'culvert',
    opening: parsedBox,
    upstreamAreaKm2: 2.0
  });
  const capPipe = computeCrossingCapacityM3s({
    kind: 'culvert',
    opening: parsedPipe,
    upstreamAreaKm2: 2.0
  });
  assert.ok(capBox > 4 && capBox < 15, `expected realistic box culvert capacity, got ${capBox}`);
  assert.ok(capPipe < capBox * 0.45, `80cm pipe capacity (${capPipe}) must be far below 1.5x1.2m box (${capBox})`);
});

test('v2 CascadeEngine enforces leakage-free FoS, coupled bulking, directional backwater, P10-P90 ensemble, and calibration', t => {
  const simFieldsPath = path.join(DATA_DIR, 'sim-fields.json');
  const settlementsPath = path.join(DATA_DIR, 'settlements.geojson');
  if (!fs.existsSync(simFieldsPath) || !fs.existsSync(settlementsPath)) {
    t.skip('sim-fields.json / settlements.geojson not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simFieldsPath, 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(settlementsPath, 'utf8'));
  assert.ok(simFields.network && simFields.network.reachCount > 50, 'expected topological DEMNAS reach network');

  // Verify network-derived catchment lookup for Batang Ngalai replaces hardcoded 3.8 km²
  const verifiedWw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'verified-waterways.geojson'), 'utf8'));
  const ngalai = (verifiedWw.features || []).find(f => /ngalai/i.test(f.properties?.name || ''));
  if (ngalai) {
    const resolved = resolveWaterwayCatchmentFromNetwork(ngalai.properties.id, simFields.network, 'river');
    assert.equal(resolved.fromDemNetwork, true);
    assert.ok(resolved.catchmentKm2 > 10, `expected Batang Ngalai DEMNAS catchment >10 km², got ${resolved.catchmentKm2}`);
  }

  // 1. ZERO LEAKAGE PROOF: mutating officialLandslideBase64 must produce IDENTICAL FoS & flood outputs!
  const n = simFields.width * simFields.height;
  const zeroOfficial = {
    ...simFields,
    officialLandslideBase64: Buffer.from(new Uint8Array(n)).toString('base64')
  };
  const allHighOfficial = {
    ...simFields,
    officialLandslideBase64: Buffer.from(new Uint8Array(n).fill(3)).toString('base64')
  };
  const baseParams = {
    rainMmHr: 100,
    durationMin: 180,
    progress: 0.78,
    soilMoisture: 'saturated',
    antecedent5dMm: 150,
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual',
    hyetograph: 'alternating_block',
    debrisCoupling: 'coupled'
  };
  const engZero = new CascadeEngine(zeroOfficial, [], 37);
  const engHigh = new CascadeEngine(allHighOfficial, [], 37);
  const resZero = engZero.evaluate(baseParams, { skipValidation: true });
  const resHigh = engHigh.evaluate(baseParams, { skipValidation: true });
  assert.equal(resZero.landslideAreaHa, resHigh.landslideAreaHa, 'officialLandslide must never leak into FoS');
  assert.equal(resZero.floodAreaHa, resHigh.floodAreaHa, 'officialLandslide must never leak into flood routing');

  // 2. Coupled debris bulking & surge sensitivity + hyetograph peak sensitivity + continuous P5 monotonicity
  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), 37);
  const resClear = engine.evaluate({ ...baseParams, debrisCoupling: 'clear' }, { skipValidation: true });
  const resCoupled = engine.evaluate({ ...baseParams, debrisCoupling: 'coupled' }, { skipValidation: true });
  const resSurge = engine.evaluate({ ...baseParams, drainCondition: 'surge', debrisCoupling: 'surge' }, { skipValidation: true });
  assert.ok(resCoupled.meanSedimentCv > resClear.meanSedimentCv, 'coupled mode must carry nonzero mobilized sediment Cv');
  assert.ok(resCoupled.peakDischargeM3s >= resClear.peakDischargeM3s, 'sediment bulking must not lower discharge');
  assert.ok(resSurge.peakDischargeM3s > resCoupled.peakDischargeM3s, 'debris-jam surge must raise peak Q');

  const resUniform = engine.evaluate({ ...baseParams, hyetograph: 'uniform', progress: 0.65 }, { skipValidation: true });
  const resConvective = engine.evaluate(
    { ...baseParams, hyetograph: 'convective_front', progress: 0.35 },
    { skipValidation: true }
  );
  assert.ok(
    resConvective.peakDischargeM3s > resUniform.peakDischargeM3s,
    `convective storm peak Q (${resConvective.peakDischargeM3s}) must exceed uniform (${resUniform.peakDischargeM3s})`
  );

  const resDryP5 = engine.evaluate({ ...baseParams, antecedent5dMm: 10 }, { skipValidation: true });
  const resWetP5 = engine.evaluate({ ...baseParams, antecedent5dMm: 200 }, { skipValidation: true });
  assert.ok(resWetP5.effectiveRunoffMm > resDryP5.effectiveRunoffMm, 'higher P5 must yield more SCS-CN runoff');

  // 3. Directional upstream-only backwater verification on nominal routed reach state
  const routed = engine.getLastRoutedNominal();
  assert.ok(routed, 'expected routed nominal reach state');
  const bwReach = routed.backwaterHead.findIndex(h => h > 0.1);
  if (bwReach >= 0) {
    const startL = routed.backwaterStartLong[bwReach];
    if (startL > 0.15 && startL < 0.85) {
      // Check evaluateReachStageForCell indirectly via reach state values
      assert.ok(routed.backwaterHead[bwReach] > 0.1);
      assert.ok(routed.backwaterLenFrac[bwReach] > 0.05);
    }
  }

  // 4. 7-member ensemble invariants, agreementRgba, reach diagnostics, validation, and bounded calibration
  const fullEval = engine.evaluate(baseParams);
  assert.ok(fullEval.ensemble.floodAreaHa.p10 <= fullEval.ensemble.floodAreaHa.p50);
  assert.ok(fullEval.ensemble.floodAreaHa.p50 <= fullEval.ensemble.floodAreaHa.p90);
  assert.ok(fullEval.ensemble.landslideAreaHa.p10 <= fullEval.ensemble.landslideAreaHa.p50);
  assert.ok(fullEval.ensemble.landslideAreaHa.p50 <= fullEval.ensemble.landslideAreaHa.p90);
  assert.ok(fullEval.ensemble.peakDischargeM3s.p10 <= fullEval.ensemble.peakDischargeM3s.p50);
  assert.ok(fullEval.ensemble.peakDischargeM3s.p50 <= fullEval.ensemble.peakDischargeM3s.p90);
  assert.ok(fullEval.hydrograph.length >= 20, 'hydrograph should span storm + recession');
  assert.ok(fullEval.hydrograph.some(pt => pt.isRecession), 'hydrograph must include recession tail');
  assert.ok(fullEval.dataConfidenceScore >= 30 && fullEval.dataConfidenceScore <= 98);
  assert.ok(fullEval.validation.landslideAuc !== null && fullEval.validation.landslideAuc > 0.5);

  const { agreementRgba } = engine.renderRgba(64);
  assert.equal(agreementRgba.length, 64 * 64 * 4);
  assert.ok(agreementRgba.some(v => v > 0), 'agreementRgba should render non-empty ensemble overlay');

  const diag = engine.buildReachDiagnosticsGeoJSON();
  assert.ok(diag.surveyPriorityReaches.features.length > 0, 'survey priority reaches should populate');

  const baseConf = engine.computeDataConfidence().score;
  engine.setCalibrationMarks([
    {
      type: 'Feature',
      properties: {
        id: 'cm-test-1',
        name: 'Tanda Muka Air Uji',
        kind: 'hwm',
        observed_depth_m: 1.1,
        rain_mm_hr: 100,
        duration_min: 180,
        antecedent_5d_mm: 140,
        notes: 'Uji validasi',
        updated_by: 'tester',
        updated_at: '2026-01-01T00:00:00Z'
      },
      geometry: { type: 'Point', coordinates: [100.319, -0.345] }
    }
  ]);
  assert.ok(engine.computeDataConfidence().score >= baseConf, 'field calibration marks should raise or preserve confidence');

  const cal = engine.runLocalCalibration();
  assert.ok(cal.evaluatedCount >= 9);
  assert.ok(cal.profile.manningMult >= 0.7 && cal.profile.manningMult <= 1.4);
  assert.ok(cal.profile.cnOffset >= -6 && cal.profile.cnOffset <= 6);
  assert.ok(cal.profile.cohesionMult >= 0.75 && cal.profile.cohesionMult <= 1.3);
});

test('13.8m hiResHand sharpens 3-tier terrain water contours and matches sampleAtLngLat parity', t => {
  const simFieldsPath = path.join(DATA_DIR, 'sim-fields.json');
  const settlementsPath = path.join(DATA_DIR, 'settlements.geojson');
  if (!fs.existsSync(simFieldsPath) || !fs.existsSync(settlementsPath)) {
    t.skip('sim-fields.json / settlements.geojson not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simFieldsPath, 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(settlementsPath, 'utf8'));
  assert.ok(simFields.hiResHandDmBase64, 'expected full-resolution ~13.8m hiResHandDmBase64 in sim-fields.json');
  assert.ok(simFields.hiResWidth > simFields.width && simFields.hiResHeight > simFields.height);

  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), 37);
  const kpis = engine.evaluate({
    rainMmHr: 80,
    durationMin: 180,
    progress: 0.78,
    soilMoisture: 'saturated',
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  });
  assert.ok(kpis.peakDischargeM3s > 5, 'expected positive peak reach discharge');
  assert.ok(kpis.representativeStageM > 0.3, 'expected positive representative valley river stage');

  const hiRes = engine.computeHiResDepthGrid();
  assert.ok(hiRes && hiRes.width === simFields.hiResWidth && hiRes.height === simFields.hiResHeight);

  const pools = extractFloodPoolPolygons(engine, []);
  assert.equal(pools.gridWidth, simFields.hiResWidth);
  assert.ok(pools.yard.features.length > 0, 'expected shallow terrain flow contour tier');
  assert.ok(pools.knee.features.length > 0, 'expected moderate basin depth contour tier');
  assert.ok(pools.deep.features.length > 0, 'expected deep channel contour tier');

  // Verify sampleAtLngLat aligns strictly with computed hi-res depth grid at grid cell centers
  const bbox = simFields.bbox;
  const hw = simFields.hiResWidth;
  const hh = simFields.hiResHeight;
  let checkedIdx = -1;
  for (let i = 0; i < pools.filteredDepth.length; i++) {
    if (pools.filteredDepth[i] >= 0.4) {
      checkedIdx = i;
      break;
    }
  }
  assert.ok(checkedIdx >= 0, 'expected at least one hi-res cell >= 0.4 m');
  const hRow = Math.floor(checkedIdx / hw);
  const hCol = checkedIdx - hRow * hw;
  const cellLng = bbox.west + ((hCol + 0.5) / hw) * (bbox.east - bbox.west);
  const cellLat = bbox.north - ((hRow + 0.5) / hh) * (bbox.north - bbox.south);
  const samp = engine.sampleAtLngLat(cellLng, cellLat);
  assert.ok(samp.insideNagari);
  assert.ok(
    Math.abs(samp.depthM - pools.filteredDepth[checkedIdx]) < 0.02,
    `sampleAtLngLat depth (${samp.depthM}) should match hi-res grid depth (${pools.filteredDepth[checkedIdx]})`
  );
});

test('bankfull channel containment keeps ordinary 2h rain in-channel while 48h continuous rain saturates slopes and overflows valleys', t => {
  const simPath = path.join(DATA_DIR, 'sim-fields.json');
  if (!fs.existsSync(simPath)) {
    t.skip('sim-fields.json not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simPath, 'utf8'));
  const engine = new CascadeEngine(simFields);

  const normalKpis = engine.evaluate({
    rainMmHr: 25,
    durationMin: 120,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 45,
    rainPattern: 'uniform',
    drainCondition: 'cleared',
    forestScenario: 'actual'
  });
  assert.ok(normalKpis.floodAreaHa <= 0.1, `ordinary 25mm/h 2h rain should stay inside riverbanks (got ${normalKpis.floodAreaHa} ha)`);
  assert.ok(normalKpis.landslideAreaHa <= 0.5, `ordinary 25mm/h 2h rain should not destabilize slopes (got ${normalKpis.landslideAreaHa} ha)`);
  assert.ok(normalKpis.representativeStageM > 0.2, `in-channel flow should remain visible (got ${normalKpis.representativeStageM} m)`);

  const multiDayKpis = engine.evaluate({
    rainMmHr: 30,
    durationMin: 2880,
    progress: 0.80,
    soilMoisture: 'moist',
    antecedent5dMm: 75,
    rainPattern: 'upland',
    drainCondition: 'surge',
    forestScenario: 'actual'
  });
  assert.equal(multiDayKpis.totalWindowMin, 3240, '48h event should use bounded 6h drainage recession window');
  assert.ok(multiDayKpis.floodAreaHa >= 3.0, `48h continuous rain should saturate soil & overflow valley corridors (got ${multiDayKpis.floodAreaHa} ha)`);
  assert.ok(multiDayKpis.landslideAreaHa >= 15.0, `48h continuous rain should saturate steep slopes (got ${multiDayKpis.landslideAreaHa} ha)`);
  assert.ok(multiDayKpis.peakDischargeM3s > normalKpis.peakDischargeM3s * 2);
});

test('IDF envelope, uncalibrated readiness cap, sub-hourly multi-day steps, dual-reservoir lag, runout shadow, and exports', t => {
  assert.equal(getMaxRealisticRainMmHr(120), 150);
  assert.equal(getMaxRealisticRainMmHr(360), 100);
  assert.equal(getMaxRealisticRainMmHr(1440), 45);
  assert.equal(getMaxRealisticRainMmHr(2880), 35);
  assert.equal(getMaxRealisticRainMmHr(4320), 30);

  const simPath = path.join(DATA_DIR, 'sim-fields.json');
  if (!fs.existsSync(simPath)) {
    t.skip('sim-fields.json not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simPath, 'utf8'));
  const engine = new CascadeEngine(simFields);

  const conf = engine.computeDataConfidence();
  assert.ok(conf.score <= 44, `uncalibrated network readiness must stay <= 44, got ${conf.score}`);
  assert.equal(conf.level, 'low');
  assert.equal(conf.coverage.isCalibrated, false);

  const normalParams = {
    rainMmHr: 25,
    durationMin: 120,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 45,
    rainPattern: 'uniform',
    drainCondition: 'cleared',
    forestScenario: 'actual'
  };
  const normalKpis = engine.evaluate(normalParams);
  assert.ok(
    normalKpis.peakDischargeM3s < 45,
    `dual-reservoir volcanic interflow should attenuate ordinary 25mm/h 2h peakQ < 45 m3/s (got ${normalKpis.peakDischargeM3s})`
  );

  const multiParams = {
    rainMmHr: 30,
    durationMin: 2880,
    progress: 0.8,
    soilMoisture: 'moist',
    antecedent5dMm: 75,
    rainPattern: 'upland',
    drainCondition: 'surge',
    forestScenario: 'actual'
  };
  const multiKpis = engine.evaluate(multiParams);
  assert.ok(
    multiKpis.hydrograph.length >= 90,
    `48h simulation should resolve sub-hourly steps (>=90), got ${multiKpis.hydrograph.length}`
  );
  const dt0 = multiKpis.hydrograph[1].timeMin - multiKpis.hydrograph[0].timeMin;
  assert.ok(dt0 <= 30, `48h timestep should be <= 30 min, got ${dt0} min`);
  assert.ok(
    (multiKpis.runoutAreaHa ?? 0) > 1.0,
    `saturated steep slopes should generate indicative ~20 deg runout shadow area (got ${multiKpis.runoutAreaHa})`
  );
  assert.ok(
    multiKpis.ensemble.peakDischargeM3s.p90 - multiKpis.ensemble.peakDischargeM3s.p10 >= 80,
    'sensitivity envelope with +/-25% rain perturbation should reflect meaningful discharge spread'
  );

  const csv = buildHydrographCsv(multiKpis);
  assert.ok(csv.startsWith('time_min,time_hr,phase,rain_mm_hr,'));
  const jsonStr = buildScenarioExportJson(multiParams, multiKpis, simFields.network, engine.getLastRoutedNominal());
  const parsed = JSON.parse(jsonStr);
  assert.ok(Array.isArray(parsed.reaches) && parsed.reaches.length > 50);
  const surveyCsv = buildFieldSurveyPriorityCsv(simFields.network);
  assert.ok(surveyCsv.includes('observed_width_m,observed_height_or_depth_m'));
  assert.ok(surveyCsv.split('\n').length >= 10);
});
