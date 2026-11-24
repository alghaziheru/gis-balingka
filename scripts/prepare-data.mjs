import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  priorityFloodFill,
  computeD8,
  computeSlopePercent,
  computeHAND,
  burnStreamsIntoDem,
  extractFlowPathsGeoJSON,
  filterOverlappingFlowPaths,
  extractContoursGeoJSON,
  detectRoadStreamCrossings,
  renderSmoothTerrainRasters,
  renderSmoothHandFloodRasters,
  rasterizeAgamGrids,
  buildPolygonMaskGrid,
  isPointInFeatureCollection,
  computeFeatureCollectionAreaKm2,
  computeCascadeFields,
  haversineMeters
} from './lib/hydrology.mjs';
import {
  listCopernicusTiles,
  listWorldCoverTiles
} from './lib/tiles.mjs';
import { fetchDEM } from './lib/dem-loaders.mjs';
import {
  fetchRealOSM,
  fetchLandCover,
  fetchNagariBoundary,
  fetchSentinel2ScourChange,
  fetchGoogleOpenBuildings,
  fetchAgamOfficialGis
} from './lib/data-fetchers.mjs';
import {
  loadVerifiedWaterwaysForBurning,
  buildDrainageBottlenecks,
  buildSteepSlopeSeeds,
  buildElevatedFacilitySeeds,
  buildWatershedGeoJSON,
  buildStudioMaskGeoJSON,
  buildClippedSettlements,
  buildDatasetMetadata
} from './lib/export-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');

function loadRegionConfig() {
  const cfgPath = path.join(ROOT, 'region.config.json');
  if (fs.existsSync(cfgPath)) {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
  return {
    name: 'Nagari Balingka',
    bbox: { west: 100.278, south: -0.408, east: 100.345, north: -0.314 },
    dataCenter: [100.319, -0.345],
    regionalOverlays: {
      enabled: true,
      sentinelChangeAvailable: true,
      localDemFilename: 'demnas-balingka.tif'
    }
  };
}

const REGION_CFG = loadRegionConfig();
const BBOX = {
  west: Number(REGION_CFG.bbox.west),
  south: Number(REGION_CFG.bbox.south),
  east: Number(REGION_CFG.bbox.east),
  north: Number(REGION_CFG.bbox.north)
};

const REGION_NAME = String(REGION_CFG.name || 'Nagari Balingka');
const COPERNICUS_TILES = listCopernicusTiles(BBOX);
const WORLDCOVER_TILES = listWorldCoverTiles(BBOX);

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Clean up old blocky polygon GeoJSONs if present
  for (const oldFile of ['slope-zones.geojson', 'hand-flood-zones.geojson']) {
    const p = path.join(OUT_DIR, oldFile);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const dem = await fetchDEM({
    rootDir: ROOT,
    regionCfg: REGION_CFG,
    bbox: BBOX,
    regionName: REGION_NAME,
    copernicusTiles: COPERNICUS_TILES
  });
  const { elev, width, height, bbox, sourceLabel } = dem;
  const midLat = (bbox.south + bbox.north) / 2;
  const totalWidthM = haversineMeters(bbox.west, midLat, bbox.east, midLat);
  const totalHeightM = haversineMeters(bbox.west, bbox.south, bbox.west, bbox.north);
  const cellSizeX = totalWidthM / width;
  const cellSizeY = totalHeightM / height;
  const gridMeta = { width, height, bbox, cellSizeX, cellSizeY };

  console.log(`DEM ready: ${width}x${height} cells (~${cellSizeX.toFixed(1)}m x ${cellSizeY.toFixed(1)}m), bbox=${JSON.stringify(bbox)}`);

  const nagariBoundary = await fetchNagariBoundary(ROOT, REGION_CFG);
  const nagariMask = nagariBoundary ? buildPolygonMaskGrid(nagariBoundary, gridMeta) : null;
  const inNagariPt = pt => !nagariBoundary || isPointInFeatureCollection(pt, nagariBoundary);
  const lineTouchesNagari = coords => !nagariBoundary || coords.some(c => isPointInFeatureCollection(c, nagariBoundary));

  let minElev = Infinity, maxElev = -Infinity;
  for (let i = 0; i < elev.length; i++) {
    if (nagariMask && nagariMask[i] === 0) continue;
    if (elev[i] < minElev) minElev = elev[i];
    if (elev[i] > maxElev) maxElev = elev[i];
  }

  const verified = loadVerifiedWaterwaysForBurning(ROOT, OUT_DIR);
  let hydroElev = elev;
  let hydroConditioned = false;
  if (verified.features.length > 0) {
    const burned = burnStreamsIntoDem(elev, verified.features, gridMeta, 3.5);
    hydroElev = burned.elev;
    hydroConditioned = burned.burnedCellCount > 0;
    console.log(`Stream-burning (${verified.source}): carved ${verified.features.length} verified waterways (${burned.burnedCellCount} cells).`);
  }

  const areaScale = (30.9 * 30.9) / Math.max(1, cellSizeX * cellSizeY);
  const handStreamThreshold = Math.max(10, Math.round(75 * areaScale));
  const filled = priorityFloodFill(hydroElev, width, height);
  const { dir, acc } = computeD8(filled, width, height, cellSizeX, cellSizeY);
  const slope = computeSlopePercent(elev, width, height, cellSizeX, cellSizeY);
  const hand = computeHAND(elev, dir, acc, width, height, handStreamThreshold);

  const rawFlowPaths = extractFlowPathsGeoJSON(elev, dir, acc, gridMeta, {
    main: Math.max(40, Math.round(240 * areaScale)),
    normal: Math.max(15, Math.round(75 * areaScale)),
    detail: Math.max(8, Math.round(25 * areaScale))
  });
  const deduped = filterOverlappingFlowPaths(rawFlowPaths, verified.features, 48, 0.55);
  const flowPaths = {
    type: 'FeatureCollection',
    features: deduped.features.filter(f => f.geometry.type === 'LineString' && lineTouchesNagari(f.geometry.coordinates))
  };
  const contours = extractContoursGeoJSON(elev, gridMeta, 25);

  const bigRbiPath = path.join(ROOT, 'raw-data', 'big-rbi-2022.json');
  let bigRbi = null;
  if (fs.existsSync(bigRbiPath)) {
    try {
      bigRbi = JSON.parse(fs.readFileSync(bigRbiPath, 'utf8'));
      console.log(`Loaded official BIG RBI 50K (Dec 2022): ${bigRbi.rivers?.length || 0} rivers, ${bigRbi.culverts?.length || 0} culverts, ${bigRbi.bridges?.length || 0} bridges.`);
    } catch {}
  }

  const useRegional = Boolean(REGION_CFG.regionalOverlays?.enabled);
  const useSentinel = Boolean(REGION_CFG.regionalOverlays?.sentinelChangeAvailable);
  const [osm, landCover, scourChange, googleBuildings, agamGis] = await Promise.all([
    fetchRealOSM(bbox, REGION_NAME),
    fetchLandCover(bbox, width, height, WORLDCOVER_TILES, REGION_NAME, nagariMask),
    useSentinel ? fetchSentinel2ScourChange(bbox, hand, gridMeta, nagariMask) : Promise.resolve(null),
    useRegional ? fetchGoogleOpenBuildings(ROOT, bbox) : Promise.resolve([]),
    useRegional ? fetchAgamOfficialGis(ROOT, OUT_DIR, bbox) : Promise.resolve(null)
  ]);

  const activeFlowFeatures = flowPaths.features.filter(f => !verified.suppressedIds.has(f.properties.id));
  const combinedStreams = [
    ...verified.features.map(f => ({
      ...f,
      properties: {
        tier: f.properties?.tier || 1,
        catchment_ha: f.properties?.catchment_ha || 180,
        ...f.properties
      }
    })),
    ...activeFlowFeatures
  ];
  const crossings = detectRoadStreamCrossings(osm.roadFeatures, combinedStreams, 85);
  const bottlenecks = buildDrainageBottlenecks({
    bigRbi,
    crossings,
    osmBridgeFeatures: osm.bridgeFeatures,
    inNagariPt
  });

  // Render smooth anti-aliased CutSheetRX-style Terrain & HAND PNG overlays
  console.log('Rendering smooth 1024x1024 CutSheetRX terrain rasters & HAND flood overlays...');
  const terrainRasters = renderSmoothTerrainRasters(elev, slope, gridMeta, 1024);
  const handRasters = renderSmoothHandFloodRasters(hand, slope, bottlenecks, gridMeta, 768, nagariMask);

  fs.writeFileSync(path.join(OUT_DIR, 'raster-relief.png'), terrainRasters.reliefPng);
  fs.writeFileSync(path.join(OUT_DIR, 'raster-elev.png'), terrainRasters.elevPng);
  fs.writeFileSync(path.join(OUT_DIR, 'raster-slope.png'), terrainRasters.slopePng);
  for (const [k, buf] of Object.entries(handRasters.pngs)) {
    fs.writeFileSync(path.join(OUT_DIR, `raster-hand-${k}.png`), buf);
  }

  const landslideSeeds = buildSteepSlopeSeeds({ slope, width, height, bbox, nagariMask, areaScale });

  let agamGrids = null;
  if (agamGis?.agamContext) {
    agamGrids = rasterizeAgamGrids(agamGis.agamContext, gridMeta, nagariMask);
  }

  const evacFeatures = buildElevatedFacilitySeeds({
    bigRbi,
    osm,
    width,
    height,
    bbox,
    hand,
    agamGrids,
    inNagariPt
  });

  const drainageDraft = {
    type: 'FeatureCollection',
    features: [
      ...bottlenecks.map(b => ({
        type: 'Feature',
        properties: {
          id: b.id,
          kind: b.kind,
          status: b.status,
          verified: false,
          name_id: b.name_id,
          name_en: b.name_en,
          desc_id: b.desc_id,
          desc_en: b.desc_en
        },
        geometry: { type: 'Point', coordinates: b.coords }
      })),
      ...landslideSeeds,
      ...evacFeatures
    ]
  };

  const int16Elev = new Int16Array(elev.length);
  for (let i = 0; i < elev.length; i++) int16Elev[i] = Math.round(elev[i]);
  const demGridJson = {
    width,
    height,
    bbox,
    cellSizeX: Number(cellSizeX.toFixed(2)),
    cellSizeY: Number(cellSizeY.toFixed(2)),
    minElev: Math.round(minElev),
    maxElev: Math.round(maxElev),
    elevBase64: Buffer.from(int16Elev.buffer).toString('base64')
  };

  const watershedGeoJSON = buildWatershedGeoJSON({ regionName: REGION_NAME, bbox, totalWidthM, totalHeightM });
  const maskGeoJSON = buildStudioMaskGeoJSON({ regionName: REGION_NAME, bbox, nagariBoundary });
  const osmContext = {
    type: 'FeatureCollection',
    features: [
      ...osm.placeFeatures,
      ...osm.waterwayFeatures,
      ...osm.roadFeatures,
      ...osm.bridgeFeatures,
      ...osm.facilityFeatures
    ]
  };

  const { settlements, settlementStats, mergedBuildings, residentialInside, googleAddedCount } =
    buildClippedSettlements({ osm, googleBuildings, inNagariPt });

  const officialAreaKm2 = nagariBoundary
    ? computeFeatureCollectionAreaKm2(nagariBoundary)
    : Number(((totalWidthM * totalHeightM) / 1e6).toFixed(2));
  const totalStreamKm = flowPaths.features.reduce((s, f) => s + f.properties.length_m, 0) / 1000;
  const center = Array.isArray(REGION_CFG.dataCenter)
    ? REGION_CFG.dataCenter
    : [Number(((bbox.west + bbox.east) / 2).toFixed(5)), Number(((bbox.south + bbox.north) / 2).toFixed(5))];

  const writeJson = (name, obj) => fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj));

  if (landCover) {
    fs.writeFileSync(path.join(OUT_DIR, 'raster-landcover.png'), landCover.lcPng);
    writeJson('landcover-grid.json', landCover.lcGridJson);
  }
  let lcClasses = landCover?.dsClasses || null;
  if (!lcClasses) {
    const lcGridPath = path.join(OUT_DIR, 'landcover-grid.json');
    if (fs.existsSync(lcGridPath)) {
      try {
        const lcJson = JSON.parse(fs.readFileSync(lcGridPath, 'utf8'));
        if (lcJson?.classesBase64) {
          const buf = Buffer.from(lcJson.classesBase64, 'base64');
          if (buf.length === width * height) lcClasses = new Uint8Array(buf);
        }
      } catch {}
    }
  }

  const rawRbiList = bigRbi?.rivers?.length > 0 ? bigRbi.rivers : agamGis?.rbiRivers?.features || [];
  const filteredRbi = rawRbiList.filter(f => f?.geometry?.type === 'LineString' && lineTouchesNagari(f.geometry.coordinates));
  const rbiCollection = filteredRbi.length > 0 ? { type: 'FeatureCollection', features: filteredRbi } : null;
  if (rbiCollection) {
    writeJson('agam-rbi-rivers.geojson', rbiCollection);
  }
  if (agamGis?.agamContext && agamGrids) {
    writeJson('agam-context.json', agamGis.agamContext);
    writeJson('agam-grids.json', {
      width,
      height,
      summary: agamGrids.summary,
      soilErodibilityBase64: Buffer.from(agamGrids.soilErodibility.buffer).toString('base64'),
      officialLandslideBase64: Buffer.from(agamGrids.officialLandslide.buffer).toString('base64')
    });
  }

  const simFields = computeCascadeFields({
    rawElev: elev,
    filled,
    dir,
    acc,
    slope,
    hand,
    landCoverClasses: lcClasses,
    soilErodibility: agamGrids?.soilErodibility || null,
    officialLandslide: agamGrids?.officialLandslide || null,
    nagariMask,
    agamSummary: agamGrids?.summary || null,
    bottlenecks,
    gridMeta
  });
  writeJson('sim-fields.json', simFields);
  if (scourChange) {
    fs.writeFileSync(path.join(OUT_DIR, 'raster-scour-change.png'), scourChange.png);
  }
  const nagariPath = path.join(OUT_DIR, 'nagari-boundary.geojson');
  if (nagariBoundary) {
    writeJson('nagari-boundary.geojson', nagariBoundary);
  } else if (!useRegional || !fs.existsSync(nagariPath)) {
    writeJson('nagari-boundary.geojson', { type: 'FeatureCollection', features: [] });
  }

  let existingMeta = {};
  const metaPath = path.join(OUT_DIR, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    try { existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
  }
  const landCoverStats = landCover?.stats || (useRegional ? existingMeta.landCoverStats : undefined);
  const scourStats = scourChange?.stats || (useSentinel ? existingMeta.scourStats : undefined);
  const hasNagariBoundary = Boolean(nagariBoundary);
  const agamStats = agamGis
    ? {
        source: agamGis.agamContext.source,
        rbiRiversCount: rbiCollection?.features?.length || agamGis.rbiRivers.features.length,
        ...(agamGrids?.summary || {})
      }
    : useRegional
      ? existingMeta.agamStats
      : undefined;

  const nagariSrcLabel =
    nagariBoundary?.features?.[0]?.properties?.source ||
    (REGION_CFG.officialBoundaryCode
      ? `Batas Administrasi ${REGION_NAME} (${REGION_CFG.officialBoundaryCode})`
      : `Batas Administrasi ${REGION_NAME}`);

  const metadata = buildDatasetMetadata({
    regionCfg: REGION_CFG,
    regionName: REGION_NAME,
    center,
    bbox,
    sourceLabel,
    width,
    height,
    cellSizeX,
    cellSizeY,
    minElev,
    maxElev,
    officialAreaKm2,
    totalStreamKm,
    osm,
    mergedBuildings,
    residentialInside,
    crossings,
    handRasters,
    verified,
    hydroConditioned,
    settlementStats,
    agamStats,
    landCoverStats,
    scourStats,
    hasNagariBoundary,
    nagariSrcLabel,
    googleAddedCount,
    inNagariPt
  });

  writeJson('metadata.json', metadata);
  writeJson('dem-grid.json', demGridJson);
  writeJson('watershed.geojson', watershedGeoJSON);
  writeJson('mask.geojson', maskGeoJSON);
  writeJson('contours.geojson', contours);
  writeJson('flow-paths.geojson', flowPaths);
  writeJson('osm-context.geojson', osmContext);
  writeJson('settlements.geojson', settlements);
  writeJson('drainage-draft.geojson', drainageDraft);

  console.log(`Generated spatial assets for ${REGION_NAME} in public/data/:`);
  console.log(`  Block: ${metadata.studyAreaKm2} km2 (${metadata.gridDimensions}, ${metadata.minElevM}..${metadata.maxElevM}m)`);
  console.log(`  Smooth streams: ${flowPaths.features.length} reaches (${metadata.streamNetworkKm} km, snapped=${deduped.snappedCount})`);
  console.log(`  Smooth contours: ${contours.features.length} polylines`);
  console.log(`  OSM places: ${osm.placeFeatures.length}, roads: ${osm.roadFeatures.length}, buildings: ${osm.buildingFeatures.length}, residential zones: ${osm.residentialFeatures.length}, crossings: ${crossings.length}`);
  if (landCoverStats) console.log('  ESA WorldCover 10m (%):', JSON.stringify(landCoverStats));
  console.log(`  HAND areas (ha):`, JSON.stringify(metadata.simAreasHa));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
