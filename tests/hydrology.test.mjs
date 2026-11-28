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
import {
  buildHyetograph,
  estimateReachBankfullDepthM,
  getMaxRealisticRainMmHr,
  invertSrcStage
} from '../src/lib/reachRouter.ts';
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
import { CLIMATE_BASELINE, MODEL_PARAMETER_AUDIT, buildModelParameterAudit } from '../src/data/climateBaseline.ts';
import { isCellInReachSplit, isCellInSpatialSplit } from '../src/lib/validationMetrics.ts';
import {
  computeAnnualMaxima,
  computeGumbelQuantiles,
  computeLp3Quantiles,
  deriveMononobeIdfEnvelope,
  buildClimateBaselineFromDailySeries,
  getGumbelReducedParams
} from '../scripts/lib/climate-fetcher.mjs';
import {
  generateLatinHypercube,
  computeSpearmanRankCorrelation,
  runSensitivityAnalysis
} from '../scripts/lib/sensitivity.mjs';
import { runAnalyticalVerifications } from '../scripts/lib/verification-benchmarks.mjs';

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

  // When nagariBoundary is provided, outside segments are clipped/dropped cleanly
  const clippedBox = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Uji Batas Nagari' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [100.305, -0.352],
              [100.320, -0.352],
              [100.320, -0.340],
              [100.305, -0.340],
              [100.305, -0.352]
            ]
          ]
        }
      }
    ]
  };
  const crossBorderFlows = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'inside-only', tier: 1, length_m: 600 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [100.310, -0.342],
            [100.315, -0.348]
          ]
        }
      },
      {
        type: 'Feature',
        properties: { id: 'cross-boundary', tier: 1, length_m: 1500 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [100.316, -0.345],
            [100.328, -0.345] // exits eastern boundary x=100.320
          ]
        }
      },
      {
        type: 'Feature',
        properties: { id: 'outside-only', tier: 1, length_m: 800 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [100.325, -0.342],
            [100.332, -0.348]
          ]
        }
      }
    ]
  };
  const boundedCorridors = buildFlowCorridors([], crossBorderFlows, [], getElev, null, {
    nagariBoundary: clippedBox
  });
  assert.equal(boundedCorridors.some(c => c.id.includes('outside-only')), false, 'outside corridor must be dropped');
  assert.equal(boundedCorridors.some(c => c.id.includes('inside-only')), true, 'inside corridor must be retained');
  const clipped = boundedCorridors.find(c => c.id.includes('cross-boundary'));
  assert.ok(clipped, 'crossing corridor should retain its inside-boundary portion');
  for (const pt of clipped.coords) {
    assert.ok(pt[0] <= 100.3201, `clipped vertex lng ${pt[0]} must stay inside Nagari boundary`);
  }

  const s0 = sampleCorridorAtDistance(first, 0);
  const sMid = sampleCorridorAtDistance(first, first.totalLengthM * 0.5);
  assert.ok(Number.isFinite(s0.lng) && Number.isFinite(s0.lat) && Number.isFinite(s0.nx) && Number.isFinite(s0.ny));
  assert.ok(Number.isFinite(sMid.lng) && Number.isFinite(sMid.lat));
});

test('buildFlowCorridors splits merged V-shaped valleys, trims tail bank overshoots, and enforces downhill DEMNAS corridors', t => {
  // 1. Synthetic V-shaped valley (two converging tributaries stored as one LineString)
  const vShapeCoords = [
    [100.3100, -0.3400],
    [100.3105, -0.3400],
    [100.3110, -0.3400],
    [100.3115, -0.3400],
    [100.3120, -0.3400],
    [100.3125, -0.3400],
    [100.3130, -0.3400],
    [100.3135, -0.3400],
    [100.3140, -0.3400]
  ];
  const vElevs = [1200, 1150, 1100, 1060, 1040, 1080, 1130, 1180, 1210];
  const synthVElev = (lng, _lat) => {
    const idx = Math.max(0, Math.min(vElevs.length - 1, Math.round((lng - 100.3100) / 0.0005)));
    return vElevs[idx];
  };
  const vFc = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { id: 'v-valley', tier: 1, length_m: 445 }, geometry: { type: 'LineString', coordinates: vShapeCoords } }]
  };
  const vCorridors = buildFlowCorridors([], vFc, [], synthVElev);
  assert.equal(vCorridors.length, 2, `Expected V-shaped polyline to split into 2 branches, got ${vCorridors.length}`);
  for (const branch of vCorridors) {
    const startE = synthVElev(branch.coords[0][0], branch.coords[0][1]);
    const endE = synthVElev(branch.coords[branch.coords.length - 1][0], branch.coords[branch.coords.length - 1][1]);
    assert.ok(startE >= 1190, `Branch start should be uphill (>=1190 m), got ${startE}`);
    assert.ok(endE <= 1050, `Branch end should meet valley floor (<=1050 m), got ${endE}`);
    let runningMin = Infinity;
    for (const pt of branch.coords) {
      const e = synthVElev(pt[0], pt[1]);
      if (e < runningMin) runningMin = e;
      assert.ok(e - runningMin <= 5, `Branch should not climb >5 m after minimum (climbed ${e - runningMin} m)`);
    }
  }

  // 2. Synthetic tail-end bank overshoot (+22 m on final vertex)
  const tailCoords = [
    [100.3100, -0.3420],
    [100.3105, -0.3420],
    [100.3110, -0.3420],
    [100.3115, -0.3420],
    [100.3120, -0.3420],
    [100.3125, -0.3420]
  ];
  const tailElevs = [1260, 1220, 1180, 1140, 1110, 1132];
  const synthTailElev = (lng, _lat) => {
    const idx = Math.max(0, Math.min(tailElevs.length - 1, Math.round((lng - 100.3100) / 0.0005)));
    return tailElevs[idx];
  };
  const tailFc = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { id: 'tail-overshoot', tier: 1, length_m: 280 }, geometry: { type: 'LineString', coordinates: tailCoords } }]
  };
  const tailCorridors = buildFlowCorridors([], tailFc, [], synthTailElev);
  assert.equal(tailCorridors.length, 1);
  const trimmedEnd = tailCorridors[0].coords[tailCorridors[0].coords.length - 1];
  assert.ok(synthTailElev(trimmedEnd[0], trimmedEnd[1]) <= 1115, `Expected overshooting tail vertex to be trimmed to <=1115 m, got ${synthTailElev(trimmedEnd[0], trimmedEnd[1])}`);

  // 3. Real Nagari Balingka DEMNAS + BIG RBI 50K audit (rbi22-744, rbi22-508, rbi22-116, and all corridors)
  const demPath = path.join(DATA_DIR, 'dem-grid.json');
  const rbiPath = path.join(DATA_DIR, 'agam-rbi-rivers.geojson');
  const boundaryPath = path.join(DATA_DIR, 'nagari-boundary.geojson');
  if (!IS_BALINGKA || !fs.existsSync(demPath) || !fs.existsSync(rbiPath) || !fs.existsSync(boundaryPath)) {
    return;
  }

  const dem = JSON.parse(fs.readFileSync(demPath, 'utf8'));
  const agamRbi = JSON.parse(fs.readFileSync(rbiPath, 'utf8'));
  const nagariBoundary = JSON.parse(fs.readFileSync(boundaryPath, 'utf8'));
  const flowPaths = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'flow-paths.geojson'), 'utf8'));
  const verifiedWaterways = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'verified-waterways.geojson'), 'utf8'));
  const wwList = verifiedWaterways.features || verifiedWaterways;

  const rawBuf = Buffer.from(dem.elevBase64, 'base64');
  const elevArr = new Int16Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength / 2);
  const { west, east, south, north } = dem.bbox;
  const { width, height } = dem;
  const getDemElev = (lng, lat) => {
    const fx = ((lng - west) / (east - west)) * (width - 1);
    const fy = ((north - lat) / (north - south)) * (height - 1);
    const x0 = Math.max(0, Math.min(width - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(height - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const v00 = elevArr[y0 * width + x0];
    const v10 = elevArr[y0 * width + x0 + 1];
    const v01 = elevArr[(y0 + 1) * width + x0];
    const v11 = elevArr[(y0 + 1) * width + x0 + 1];
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  };

  const realCorridors = buildFlowCorridors(wwList, flowPaths, [], getDemElev, agamRbi, {
    includeVerified: true,
    includeRbi: true,
    nagariBoundary
  });

  const rbi744Branches = realCorridors.filter(c => c.id.startsWith('rbi-rbi22-744'));
  assert.equal(rbi744Branches.length, 2, `Expected rbi22-744 to split into 2 downhill branches, got ${rbi744Branches.length}`);
  for (const b of rbi744Branches) {
    const startE = getDemElev(b.coords[0][0], b.coords[0][1]);
    const endE = getDemElev(b.coords[b.coords.length - 1][0], b.coords[b.coords.length - 1][1]);
    assert.ok(startE > 1105, `Expected rbi22-744 branch start >1105 m, got ${startE.toFixed(1)}`);
    assert.ok(endE <= 1070, `Expected rbi22-744 branch end near valley junction <=1070 m, got ${endE.toFixed(1)}`);
  }

  for (const c of realCorridors) {
    let runningMin = Infinity;
    let maxClimb = 0;
    for (const pt of c.coords) {
      const e = getDemElev(pt[0], pt[1]);
      if (e < runningMin) runningMin = e;
      const climb = e - runningMin;
      if (climb > maxClimb) maxClimb = climb;
    }
    assert.ok(maxClimb <= 10, `Corridor ${c.id} has uphill climb ${maxClimb.toFixed(1)} m (>10 m)`);
  }
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
    rainMmHr: 15,
    durationMin: 120,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 45,
    rainPattern: 'uniform',
    drainCondition: 'cleared',
    forestScenario: 'actual'
  });
  assert.ok(normalKpis.floodAreaHa <= 0.1, `ordinary 15mm/h 2h rain should stay inside riverbanks (got ${normalKpis.floodAreaHa} ha)`);
  assert.ok(normalKpis.landslideAreaHa <= 0.5, `ordinary 15mm/h 2h rain should not destabilize slopes (got ${normalKpis.landslideAreaHa} ha)`);
  assert.ok(normalKpis.representativeStageM > 0.05, `in-channel flow should remain positive (got ${normalKpis.representativeStageM} m)`);

  const multiDayKpis = engine.evaluate({
    rainMmHr: 7,
    durationMin: 2880,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 75,
    rainPattern: 'upland',
    drainCondition: 'surge',
    forestScenario: 'actual'
  });
  assert.equal(multiDayKpis.totalWindowMin, 3240, '48h event should use bounded 6h drainage recession window');
  assert.ok(multiDayKpis.floodAreaHa >= 1.5, `48h 100-yr monsoon (336 mm) should overflow valley corridors (got ${multiDayKpis.floodAreaHa} ha)`);
  assert.ok(multiDayKpis.landslideAreaHa >= 8.0, `48h 100-yr monsoon (336 mm) should saturate steep slopes (got ${multiDayKpis.landslideAreaHa} ha)`);
  assert.ok(multiDayKpis.peakDischargeM3s > normalKpis.peakDischargeM3s * 2);
});

test('IDF envelope, uncalibrated readiness cap, sub-hourly multi-day steps, dual-reservoir lag, runout shadow, and exports', t => {
  assert.equal(getMaxRealisticRainMmHr(120), 60);
  assert.equal(getMaxRealisticRainMmHr(360), 30);
  assert.equal(getMaxRealisticRainMmHr(1440), 12);
  assert.equal(getMaxRealisticRainMmHr(2880), 8);
  assert.equal(getMaxRealisticRainMmHr(4320), 6);

  assert.equal(CLIMATE_BASELINE.era5Series.yearsCount, 41);
  assert.ok(Math.abs(CLIMATE_BASELINE.era5Series.biasFactor - 1.073) < 0.01);
  const badges = new Set(MODEL_PARAMETER_AUDIT.map(r => r.badge));
  assert.ok(badges.has('observed') && badges.has('literature') && badges.has('conceptual'));
  assert.ok(MODEL_PARAMETER_AUDIT.every(r => r.paramId && r.paramEn && r.sourceId && r.sourceEn && r.valueText));

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
    rainMmHr: 15,
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
    normalKpis.peakDischargeM3s < 35,
    `dual-reservoir volcanic interflow should attenuate ordinary 15mm/h 2h peakQ < 35 m3/s (got ${normalKpis.peakDischargeM3s})`
  );

  const multiParams = {
    rainMmHr: 7,
    durationMin: 2880,
    progress: 0.78,
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
    (multiKpis.runoutAreaHa ?? 0) >= 1.5,
    `saturated steep slopes should generate indicative ~20 deg runout shadow area (got ${multiKpis.runoutAreaHa})`
  );
  assert.ok(
    multiKpis.ensemble.peakDischargeM3s.p90 - multiKpis.ensemble.peakDischargeM3s.p10 >= 30,
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

test('Phase 1 methodological hygiene: strict causality, water-balance closure, unified SMA-FoS, and holdout calibration', t => {
  // 1. Spatial block split partitions cells disjointly and exhaustively
  const w = 40;
  const h = 40;
  let calCount = 0;
  let holdCount = 0;
  for (let i = 0; i < w * h; i++) {
    const inCal = isCellInSpatialSplit(i, w, 'calibration');
    const inHold = isCellInSpatialSplit(i, w, 'holdout');
    assert.notEqual(inCal, inHold, 'calibration and holdout blocks must be strictly disjoint');
    assert.equal(isCellInSpatialSplit(i, w, 'all'), true);
    if (inCal) calCount++;
    if (inHold) holdCount++;
  }
  assert.equal(calCount + holdCount, w * h);
  assert.ok(calCount > 400 && holdCount > 400);

  const simPath = path.join(DATA_DIR, 'sim-fields.json');
  if (!fs.existsSync(simPath)) {
    t.skip('sim-fields.json not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simPath, 'utf8'));
  const settlements = fs.existsSync(path.join(DATA_DIR, 'settlements.geojson'))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settlements.geojson'), 'utf8'))
    : { type: 'FeatureCollection', features: [] };
  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), 37);

  // 2. Strict temporal causality: full hydrograph[t] and peakDischargeM3s must not change when scrubbing progress
  for (const scenario of [
    {
      rainMmHr: 40,
      durationMin: 180,
      soilMoisture: 'saturated',
      antecedent5dMm: 140,
      rainPattern: 'upland',
      drainCondition: 'clogged',
      forestScenario: 'actual',
      hyetograph: 'alternating_block',
      debrisCoupling: 'coupled'
    },
    {
      rainMmHr: 7,
      durationMin: 2880,
      soilMoisture: 'moist',
      antecedent5dMm: 75,
      rainPattern: 'upland',
      drainCondition: 'surge',
      forestScenario: 'actual',
      hyetograph: 'alternating_block',
      debrisCoupling: 'surge'
    }
  ]) {
    const early = engine.evaluate({ ...scenario, progress: 0.45 }, { skipValidation: true });
    const late = engine.evaluate({ ...scenario, progress: 0.9 }, { skipValidation: true });
    assert.equal(
      early.peakDischargeM3s,
      late.peakDischargeM3s,
      `peakDischargeM3s must be causal and invariant to playback progress (${early.peakDischargeM3s} vs ${late.peakDischargeM3s})`
    );
    assert.equal(early.hydrograph.length, late.hydrograph.length);
    for (let k = 0; k < early.hydrograph.length; k++) {
      assert.equal(
        early.hydrograph[k].qP50,
        late.hydrograph[k].qP50,
        `hydrograph[${k}].qP50 leaked future progress`
      );
      assert.equal(
        early.hydrograph[k].qBulkP50,
        late.hydrograph[k].qBulkP50,
        `hydrograph[${k}].qBulkP50 leaked future progress`
      );
      assert.equal(
        early.hydrograph[k].qP10,
        late.hydrograph[k].qP10,
        `hydrograph[${k}].qP10 leaked future progress`
      );
      assert.equal(
        early.hydrograph[k].qP90,
        late.hydrograph[k].qP90,
        `hydrograph[${k}].qP90 leaked future progress`
      );
    }
  }

  // 3. Exact SMA water-balance closure (< 0.05% error) across dry, saturated, and 48h storms
  for (const wbParams of [
    {
      rainMmHr: 15,
      durationMin: 120,
      progress: 0.9,
      soilMoisture: 'dry',
      antecedent5dMm: 10,
      rainPattern: 'uniform',
      drainCondition: 'cleared',
      forestScenario: 'actual'
    },
    {
      rainMmHr: 40,
      durationMin: 180,
      progress: 0.85,
      soilMoisture: 'saturated',
      antecedent5dMm: 180,
      rainPattern: 'upland',
      drainCondition: 'clogged',
      forestScenario: 'actual'
    },
    {
      rainMmHr: 7,
      durationMin: 2880,
      progress: 0.85,
      soilMoisture: 'moist',
      antecedent5dMm: 75,
      rainPattern: 'upland',
      drainCondition: 'surge',
      forestScenario: 'actual'
    }
  ]) {
    const res = engine.evaluate(wbParams, { skipValidation: true });
    assert.ok(res.waterBalance, 'expected waterBalance summary on CascadeKpis');
    assert.ok(res.waterBalance.rainInputMm > 0);
    assert.ok(res.waterBalance.totalRunoffMm > 0);
    assert.ok(
      Math.abs(res.waterBalance.closureErrorPct) < 0.05,
      `water-balance closure error too large: ${res.waterBalance.closureErrorPct}%`
    );
  }

  // 4. Unified SMA -> slope stability coupling responds to early convective wetness
  const earlyConvective = engine.evaluate(
    {
      rainMmHr: 45,
      durationMin: 180,
      progress: 0.3,
      soilMoisture: 'moist',
      antecedent5dMm: 95,
      rainPattern: 'upland',
      drainCondition: 'clogged',
      forestScenario: 'actual',
      hyetograph: 'convective_front'
    },
    { skipValidation: true }
  );
  const earlyCenterPeak = engine.evaluate(
    {
      rainMmHr: 45,
      durationMin: 180,
      progress: 0.3,
      soilMoisture: 'moist',
      antecedent5dMm: 95,
      rainPattern: 'upland',
      drainCondition: 'clogged',
      forestScenario: 'actual',
      hyetograph: 'alternating_block'
    },
    { skipValidation: true }
  );
  assert.ok(
    earlyConvective.landslideAreaHa >= earlyCenterPeak.landslideAreaHa,
    `early convective burst (${earlyConvective.landslideAreaHa} ha) should wet slopes >= center-peak (${earlyCenterPeak.landslideAreaHa} ha) at progress=0.30`
  );

  // 5. IDF-admissible local calibration reports strictly on unseen 50% spatial holdout + JSON metadata
  const cal = engine.runLocalCalibration();
  assert.equal(cal.metrics.validationSplit, 'holdout');
  assert.equal(cal.baselineMetrics.validationSplit, 'holdout');
  if (IS_BALINGKA) {
    assert.ok(cal.metrics.landslideAuc !== null && cal.metrics.landslideAuc > 0.5);
  }
  const exported = JSON.parse(buildScenarioExportJson(
    {
      rainMmHr: 40,
      durationMin: 180,
      progress: 0.78,
      soilMoisture: 'saturated',
      rainPattern: 'upland',
      drainCondition: 'clogged',
      forestScenario: 'actual'
    },
    earlyConvective,
    simFields.network,
    engine.getLastRoutedNominal()
  ));
  assert.ok(typeof exported.uncertaintyMethod === 'string' && exported.uncertaintyMethod.includes('sensitivity envelope'));
  assert.ok(exported.waterBalance && Math.abs(exported.waterBalance.closureErrorPct) < 0.05);
});

test('Phase 2 multi-village portability: synthetic climate statistics, IDF bounds, soil presets, and dynamic audit', t => {
  // 1. SNI 2415:2016 Gumbel / LP3 / Mononobe pipeline on synthetic 40-yr dry vs wet daily series
  const dates = [];
  const dryDaily = [];
  const wetDaily = [];
  for (let y = 1985; y < 2025; y++) {
    for (let d = 0; d < 365; d++) {
      const m = Math.min(12, Math.floor(d / 30) + 1);
      const day = (d % 30) + 1;
      dates.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      const stormSeed = ((y * 37 + d * 13) % 100) / 100;
      dryDaily.push(d === 40 ? 60 + stormSeed * 45 : stormSeed > 0.85 ? 6 : 1.5);
      wetDaily.push(d === 40 || d === 41 ? 115 + stormSeed * 75 : stormSeed > 0.65 ? 18 : 6);
    }
  }
  const dryStats = computeAnnualMaxima(dates, dryDaily);
  assert.equal(dryStats.yearsCount, 40);
  const dryGumbel = computeGumbelQuantiles(dryStats.annualMax1d);
  const dryLp3 = computeLp3Quantiles(dryStats.annualMax1d);
  assert.ok(dryGumbel.t100 > dryGumbel.t10 && dryGumbel.t10 > dryGumbel.t2);
  assert.ok(dryLp3.t100 > dryLp3.t10);

  const dryBaseline = buildClimateBaselineFromDailySeries({
    regionId: 'desa-kupang-uji',
    regionName: 'Desa Kupang Uji',
    targetCoord: [-10.17, 123.58],
    gridCoord: [-10.15, 123.6],
    gridElevM: 45,
    dailyDates: dates,
    dailyMm: dryDaily,
    biasFactor: 1.0
  });
  const wetBaseline = buildClimateBaselineFromDailySeries({
    regionId: 'desa-basah-uji',
    regionName: 'Desa Basah Uji',
    targetCoord: [-0.34, 100.32],
    gridCoord: [-0.32, 100.34],
    gridElevM: 1200,
    dailyDates: dates,
    dailyMm: wetDaily,
    biasFactor: 1.07
  });
  assert.ok(
    wetBaseline.returnPeriodsMm.r24.t100Gumbel > dryBaseline.returnPeriodsMm.r24.t100Gumbel,
    'wet climate 100-yr 24h rainfall must exceed dry climate'
  );
  assert.ok(
    wetBaseline.idfCapsMmHr['180'] > dryBaseline.idfCapsMmHr['180'],
    `wet 3h IDF cap (${wetBaseline.idfCapsMmHr['180']}) must exceed dry 3h IDF cap (${dryBaseline.idfCapsMmHr['180']})`
  );
  const mononobe = deriveMononobeIdfEnvelope(dryBaseline.returnPeriodsMm);
  assert.ok(mononobe['30'] >= mononobe['60'] && mononobe['60'] >= mononobe['180'] && mononobe['180'] >= mononobe['1440']);

  // 2. getMaxRealisticRainMmHr honors custom regional IDF baseline and falls back cleanly
  assert.equal(getMaxRealisticRainMmHr(180), 45);
  assert.equal(getMaxRealisticRainMmHr(180, dryBaseline), dryBaseline.idfCapsMmHr['180']);

  // 3. Audit rows dynamically reflect custom village & soil preset without leaking Balingka strings
  const audit = buildModelParameterAudit(dryBaseline, 'alluvial_clay', {
    name: 'Desa Kupang Uji',
    areaKm2: 14.2,
    officialBoundaryCode: '53.01.01.2001',
    regionalOverlays: { enabled: false }
  });
  const auditText = JSON.stringify(audit);
  assert.equal(auditText.includes('Balingka'), false, 'custom audit must not contain Balingka');
  assert.equal(auditText.includes('Padang Panjang'), false, 'custom audit must not contain Padang Panjang');
  assert.equal(auditText.includes('Sicincin'), false, 'custom audit must not contain Sicincin');
  assert.ok(auditText.includes('Alluvial Clay') && auditText.includes('Lempung Aluvial'));

  // 4. Checked-in public/data/climate-baseline.json & reset-region cleanup
  const climPath = path.join(DATA_DIR, 'climate-baseline.json');
  assert.ok(fs.existsSync(climPath), 'expected public/data/climate-baseline.json');
  const climJson = JSON.parse(fs.readFileSync(climPath, 'utf8'));
  assert.equal(climJson.regionId, 'nagari-balingka');
  assert.equal(climJson.idfCapsMmHr['2880'], 8);

  const tmpResetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gis-reset-clim-'));
  try {
    fs.mkdirSync(path.join(tmpResetDir, 'public', 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmpResetDir, 'region.config.json'), JSON.stringify({ id: 'desa-custom', name: 'Desa Custom' }));
    fs.writeFileSync(path.join(tmpResetDir, 'public', 'data', 'climate-baseline.json'), '{}');
    const cleanRes = runResetRegion({ rootDir: tmpResetDir });
    assert.ok(cleanRes.removed.includes('public/data/climate-baseline.json'));
  } finally {
    fs.rmSync(tmpResetDir, { recursive: true, force: true });
  }

  // 5. Soil presets produce physically distinct hydrological/slope response when regional raster is absent
  const simPath = path.join(DATA_DIR, 'sim-fields.json');
  if (!fs.existsSync(simPath)) {
    t.skip('sim-fields.json not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simPath, 'utf8'));
  const fieldsNoSoilRaster = { ...simFields, soilErodibilityBase64: undefined };
  const engNoRaster = new CascadeEngine(fieldsNoSoilRaster);
  const testStorm = {
    rainMmHr: 40,
    durationMin: 180,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 45,
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual'
  };
  const clayKpis = engNoRaster.evaluate({ ...testStorm, soilProfile: 'alluvial_clay' }, { skipValidation: true });
  const karstKpis = engNoRaster.evaluate({ ...testStorm, soilProfile: 'karst_limestone' }, { skipValidation: true });
  assert.ok(
    clayKpis.effectiveRunoffMm > karstKpis.effectiveRunoffMm,
    `alluvial_clay runoff (${clayKpis.effectiveRunoffMm} mm) must exceed permeable karst_limestone (${karstKpis.effectiveRunoffMm} mm)`
  );
});

test('Phase 3 paper benchmarks: LHS stratification, nominalOnly parity, sensitivity sweep, and analytical verification', t => {
  // 1. Stratified Latin Hypercube determinism & uniform coverage across strata
  const nLhs = 20;
  const lhsA = generateLatinHypercube(nLhs, 4, 2026);
  const lhsB = generateLatinHypercube(nLhs, 4, 2026);
  assert.equal(lhsA.length, nLhs);
  assert.deepEqual(Array.from(lhsA[0]), Array.from(lhsB[0]));
  for (let d = 0; d < 4; d++) {
    const strataHit = new Set(lhsA.map(row => Math.floor(row[d] * nLhs)));
    assert.equal(strataHit.size, nLhs, `dimension ${d} must place exactly 1 sample in each stratum`);
  }
  assert.equal(computeSpearmanRankCorrelation([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1);
  assert.equal(computeSpearmanRankCorrelation([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]), -1);

  const simPath = path.join(DATA_DIR, 'sim-fields.json');
  if (!fs.existsSync(simPath)) {
    t.skip('sim-fields.json not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simPath, 'utf8'));
  const settlements = fs.existsSync(path.join(DATA_DIR, 'settlements.geojson'))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settlements.geojson'), 'utf8'))
    : { type: 'FeatureCollection', features: [] };
  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), 37);

  // 2. nominalOnly fast path matches full evaluation bit-for-bit on nominal metrics
  const probeScenario = {
    rainMmHr: 40,
    durationMin: 180,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 65,
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual',
    hyetograph: 'alternating_block',
    debrisCoupling: 'coupled'
  };
  const full = engine.evaluate(probeScenario, { skipValidation: true });
  const fast = engine.evaluate(probeScenario, { skipValidation: true, nominalOnly: true });
  assert.equal(fast.peakDischargeM3s, full.peakDischargeM3s);
  assert.equal(fast.floodAreaHa, full.floodAreaHa);
  assert.equal(fast.landslideAreaHa, full.landslideAreaHa);
  assert.equal(fast.effectiveRunoffMm, full.effectiveRunoffMm);
  assert.deepEqual(fast.waterBalance, full.waterBalance);

  // 3. Fast offline LHS + Morris sensitivity check
  const sens = runSensitivityAnalysis({
    engine,
    baseScenario: probeScenario,
    nLhs: 12,
    morrisTrajectories: 2,
    seed: 99
  });
  assert.ok(sens.distributions.peakDischargeM3s.p10 <= sens.distributions.peakDischargeM3s.p50);
  assert.ok(sens.distributions.peakDischargeM3s.p50 <= sens.distributions.peakDischargeM3s.p90);
  assert.ok(sens.morris.landslideAreaHa.every(r => r.muStar >= 0));
  assert.ok(sens.spearman.peakDischargeM3s.every(r => Number.isFinite(r.rho)));

  // 4. Analytical solver verification checks (SCS-CN, Muskingum-Cunge, FHWA HDS-5, Water Balance)
  const ver = runAnalyticalVerifications({ simFields, settlements: null });
  assert.ok(ver.scsCnAnalytical.r2 > 0.999, `expected SCS-CN analytical R2 > 0.999, got ${ver.scsCnAnalytical.r2}`);
  assert.ok(ver.fhwaHds5Orifice.maxRelErrPct < 0.5, `expected HDS-5 error < 0.5%, got ${ver.fhwaHds5Orifice.maxRelErrPct}`);
  assert.ok(ver.muskingumChannel.minQ >= 0 && ver.muskingumChannel.lagMin > 0);
  assert.ok(ver.waterBalanceClosure.maxAbsClosureErrorPct < 0.05);

  // 5. Saved Phase 3 & multi-village replicability benchmark artifact integrity
  const benchmarkDir = path.join(ROOT_DIR, 'docs', 'benchmarks');
  const verArtifact = JSON.parse(fs.readFileSync(path.join(benchmarkDir, 'verification-summary.json'), 'utf8'));
  const sensArtifact = JSON.parse(fs.readFileSync(path.join(benchmarkDir, 'sensitivity-summary.json'), 'utf8'));
  const repArtifact = JSON.parse(fs.readFileSync(path.join(benchmarkDir, 'replicability-summary.json'), 'utf8'));

  assert.ok(verArtifact.analytical.scsCnAnalytical.r2 > 0.999);
  assert.ok(verArtifact.analytical.waterBalanceClosure.maxAbsClosureErrorPct < 0.05);
  assert.ok(sensArtifact.nLhs >= 500 && sensArtifact.scenarios?.upland_3h && sensArtifact.scenarios?.monsoon_48h);
  assert.equal(repArtifact.checks.causalHydrograph, true);
  assert.equal(repArtifact.checks.zeroBalingkaLeakage, true);
  assert.ok(repArtifact.checks.maxClosureErrorPct < 0.05);
  assert.ok(repArtifact.terrainAndNetwork.reachCount > 0 && repArtifact.terrainAndNetwork.buildingCount > 0);
});

test('regions.config.json defines Nagari Balingka and Malalak Timur & Utara with isolated paths and generated spatial assets', () => {
  const manifestPath = path.join(ROOT_DIR, 'regions.config.json');
  assert.ok(fs.existsSync(manifestPath), 'regions.config.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.defaultRegionId, 'nagari-balingka');
  assert.equal(manifest.regions.length, 2);

  const ids = new Set();
  for (const reg of manifest.regions) {
    assert.ok(reg.id && !ids.has(reg.id), `Duplicate or missing region id: ${reg.id}`);
    ids.add(reg.id);
    assert.ok(reg.bbox.west < reg.bbox.east && reg.bbox.south < reg.bbox.north, `Invalid bbox for ${reg.id}`);
    assert.ok(Array.isArray(reg.cameraPresets) && reg.cameraPresets.length >= 4, `Missing cameraPresets for ${reg.id}`);
    const rel = String(reg.dataBasePath || '/data').replace(/^\/+/, '');
    const regDataDir = path.join(ROOT_DIR, 'public', ...rel.split('/'));
    assert.ok(fs.existsSync(path.join(regDataDir, 'metadata.json')), `Missing metadata.json for ${reg.id}`);
    assert.ok(fs.existsSync(path.join(regDataDir, 'nagari-boundary.geojson')), `Missing nagari-boundary.geojson for ${reg.id}`);
    assert.ok(fs.existsSync(path.join(regDataDir, 'sub-boundaries.geojson')), `Missing sub-boundaries.geojson for ${reg.id}`);
    assert.ok(fs.existsSync(path.join(regDataDir, 'mask.geojson')), `Missing mask.geojson for ${reg.id}`);
    assert.ok(fs.existsSync(path.join(regDataDir, 'sim-fields.json')), `Missing sim-fields.json for ${reg.id}`);
    const meta = JSON.parse(fs.readFileSync(path.join(regDataDir, 'metadata.json'), 'utf8'));
    if (reg.id === 'nagari-balingka') {
      assert.ok(meta.studyAreaKm2 > 28 && meta.studyAreaKm2 < 32, `Unexpected area for Balingka: ${meta.studyAreaKm2}`);
    } else if (reg.id === 'malalak-timur-utara') {
      assert.ok(meta.studyAreaKm2 > 50 && meta.studyAreaKm2 < 60, `Unexpected area for Malalak Timur & Utara: ${meta.studyAreaKm2}`);
      const subFc = JSON.parse(fs.readFileSync(path.join(regDataDir, 'sub-boundaries.geojson'), 'utf8'));
      assert.equal(subFc.features.length, 2, 'Malalak Timur & Utara should include both official Nagari sub-boundaries');
    }
  }
});

test('Scientific hygiene: peak-envelope HWM, reconciled SRC datum, finite-sample SNI Gumbel, reach holdout, dynamic lag, and soil preset respect', t => {
  // 1. Finite-sample SNI 2415:2016 Gumbel reduced parameters (Yn, Sn)
  const g10 = getGumbelReducedParams(10);
  const g41 = getGumbelReducedParams(41);
  const gInf = getGumbelReducedParams(500);
  assert.equal(g10.yn, 0.4952);
  assert.equal(g10.sn, 0.9496);
  assert.ok(g41.sn > 1.13 && g41.sn < 1.16, `expected finite-sample Sn(41) ~1.143, got ${g41.sn}`);
  assert.equal(gInf.yn, 0.5772);
  assert.equal(gInf.sn, 1.28255);

  // Finite-sample n=41 yields higher T100 than asymptotic Sn=1.28255 for identical sample mean/sd
  const sampleSeries = Array.from({ length: 41 }, (_, i) => 90 + ((i * 19) % 41) * 3);
  const qFinite = computeGumbelQuantiles(sampleSeries);
  const mean = sampleSeries.reduce((a, b) => a + b, 0) / sampleSeries.length;
  const sd = Math.sqrt(sampleSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / (sampleSeries.length - 1));
  const yt100 = -Math.log(-Math.log(1 - 1 / 100));
  const qAsymp100 = Math.round(mean + ((yt100 - 0.5772) / 1.28255) * sd);
  assert.ok(
    qFinite.t100 > qAsymp100,
    `finite-sample SNI Gumbel T100 (${qFinite.t100}) must exceed asymptotic (${qAsymp100})`
  );

  // 2. Reach-level holdout split keeps every reach intact in a single fold
  const synthReachId = new Uint16Array([0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 65535, 65535]);
  for (let rid = 0; rid <= 3; rid++) {
    const idxs = [];
    for (let i = 0; i < synthReachId.length; i++) if (synthReachId[i] === rid) idxs.push(i);
    const firstInCal = isCellInReachSplit(idxs[0], 4, synthReachId, 'calibration');
    for (const idx of idxs) {
      assert.equal(
        isCellInReachSplit(idx, 4, synthReachId, 'calibration'),
        firstInCal,
        `reach ${rid} must not split across calibration and holdout`
      );
      assert.notEqual(
        isCellInReachSplit(idx, 4, synthReachId, 'calibration'),
        isCellInReachSplit(idx, 4, synthReachId, 'holdout')
      );
    }
  }

  // 3. Open limitations documentation exists
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'docs', 'MODEL_LIMITATIONS.md')));

  const simPath = path.join(DATA_DIR, 'sim-fields.json');
  if (!fs.existsSync(simPath)) {
    t.skip('sim-fields.json not present yet');
    return;
  }
  const simFields = JSON.parse(fs.readFileSync(simPath, 'utf8'));
  const reaches = simFields.network.reaches;

  // 4. Reconciled SRC bankfull datum & exact hydraulic areaM2 parity
  for (const reach of reaches.slice(0, 50)) {
    assert.ok(
      typeof reach.bankfullDepthM === 'number' && reach.bankfullDepthM >= 0.4,
      `reach ${reach.id} missing canonical bankfullDepthM`
    );
    assert.equal(estimateReachBankfullDepthM(reach), reach.bankfullDepthM);
    assert.ok(Array.isArray(reach.areaM2) && reach.areaM2.length === reach.kRef.length);
  }
  const inv = invertSrcStage(12, 0.045, reaches[reaches.length - 1], simFields.network.srcStagesM);
  assert.ok(inv.stageM > 0 && inv.velocityMs >= 0.15 && inv.velocityMs <= 8.5);

  const engine = new CascadeEngine(simFields);

  // 5. Peak-envelope (max_t) HWM evaluation dominates any single snapshot across an early-peaking storm
  const frontStorm = {
    rainMmHr: 40,
    durationMin: 180,
    progress: 0.78,
    soilMoisture: 'saturated',
    antecedent5dMm: 140,
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual',
    hyetograph: 'convective_front',
    debrisCoupling: 'coupled'
  };
  const peakEnv = engine.evaluatePeakEnvelopeAtStorm(frontStorm);
  engine.evaluate({ ...frontStorm, progress: 0.35 }, { skipValidation: true });
  const snapEarly = engine.sampleAtLngLat(100.319, -0.345);
  engine.evaluate({ ...frontStorm, progress: 0.78 }, { skipValidation: true });
  const snapLate = engine.sampleAtLngLat(100.319, -0.345);
  const peakSample = peakEnv.sampleAtLngLat(100.319, -0.345);
  assert.ok(
    peakSample.depthM + 1e-4 >= Math.max(snapEarly.depthM, snapLate.depthM),
    `peak-envelope depth (${peakSample.depthM}) must be >= early (${snapEarly.depthM}) and late (${snapLate.depthM}) snapshots`
  );
  assert.ok(
    peakSample.streamPowerWm2 >= Math.max(snapEarly.streamPowerWm2, snapLate.streamPowerWm2) - 1,
    'peak-envelope stream power must dominate individual snapshots'
  );

  // 6. Dynamic hydrograph lag differs across storm regimes & calibration uses reach holdout
  const kShort = engine.evaluate({ ...frontStorm, hyetograph: 'alternating_block', durationMin: 180, progress: 0.78 });
  const kLong = engine.evaluate(
    { ...frontStorm, rainMmHr: 7, durationMin: 2880, hyetograph: 'alternating_block', progress: 0.78 },
    { skipValidation: true }
  );
  assert.equal(kShort.validation.validationSplitStrategy, 'reach');
  assert.ok(
    kShort.peakTravelMin > 5 && kLong.peakTravelMin > kShort.peakTravelMin,
    `dynamic lag should respond to storm regime (3h=${kShort.peakTravelMin} min vs 48h=${kLong.peakTravelMin} min)`
  );

  // 7. Explicit non-volcanic soilProfile is honored even when soilErodibilityBase64 is present
  assert.ok(simFields.soilErodibilityBase64, 'expected regional soilErodibility raster');
  const andosolRes = engine.evaluate(
    { ...frontStorm, soilProfile: 'volcanic_andosol' },
    { skipValidation: true, nominalOnly: true }
  );
  const karstRes = engine.evaluate(
    { ...frontStorm, soilProfile: 'karst_limestone' },
    { skipValidation: true, nominalOnly: true }
  );
  assert.ok(
    karstRes.landslideAreaHa < andosolRes.landslideAreaHa,
    `karst_limestone (${karstRes.landslideAreaHa} ha) must remain more stable than volcanic_andosol (${andosolRes.landslideAreaHa} ha) even with soilErodibility present`
  );
});
