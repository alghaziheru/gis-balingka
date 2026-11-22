import fs from 'node:fs';
import path from 'node:path';
import {
  burnStreamsIntoDem,
  computeD8,
  computeHAND,
  computeSlopePercent,
  detectRoadStreamCrossings,
  extractFlowPathsGeoJSON,
  filterOverlappingFlowPaths,
  haversineMeters,
  priorityFloodFill,
  renderSmoothHandFloodRasters
} from './hydrology.mjs';

function decodeElevBase64(elevBase64, expectedLen) {
  const buf = Buffer.from(elevBase64, 'base64');
  const int16 = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const out = new Float32Array(expectedLen);
  for (let i = 0; i < expectedLen; i++) {
    out[i] = int16[i] ?? 1089;
  }
  return out;
}

function readJsonWithFallback(primaryDir, fallbackDir, filename) {
  const primaryPath = path.join(primaryDir, filename);
  if (fs.existsSync(primaryPath)) {
    return JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
  }
  if (fallbackDir) {
    const fbPath = path.join(fallbackDir, filename);
    if (fs.existsSync(fbPath)) {
      return JSON.parse(fs.readFileSync(fbPath, 'utf8'));
    }
  }
  throw new Error(`Missing required dataset ${filename} in ${primaryDir}`);
}

export function recomputeHydrologyFromLocalData({
  publicDataDir,
  distDataDir = null,
  verifiedFeatures = [],
  suppressedDemIds = new Set(),
  carveDepthM = 3.5
}) {
  const demGrid = readJsonWithFallback(publicDataDir, distDataDir, 'dem-grid.json');
  const osmContext = readJsonWithFallback(publicDataDir, distDataDir, 'osm-context.geojson');
  const metadata = readJsonWithFallback(publicDataDir, distDataDir, 'metadata.json');

  const { width, height, bbox } = demGrid;
  const rawElev = decodeElevBase64(demGrid.elevBase64, width * height);
  const midLat = (bbox.south + bbox.north) / 2;
  const totalWidthM = haversineMeters(bbox.west, midLat, bbox.east, midLat);
  const totalHeightM = haversineMeters(bbox.west, bbox.south, bbox.west, bbox.north);
  const cellSizeX = totalWidthM / width;
  const cellSizeY = totalHeightM / height;
  const gridMeta = { width, height, bbox, cellSizeX, cellSizeY };

  const activeVerified = (verifiedFeatures || []).filter(
    f => f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2
  );

  let hydroElev = rawElev;
  let burnedCellCount = 0;
  let hydroConditioned = false;
  if (activeVerified.length > 0) {
    const burned = burnStreamsIntoDem(rawElev, activeVerified, gridMeta, carveDepthM);
    hydroElev = burned.elev;
    burnedCellCount = burned.burnedCellCount;
    hydroConditioned = burnedCellCount > 0;
  }

  const filled = priorityFloodFill(hydroElev, width, height);
  const { dir, acc } = computeD8(filled, width, height, cellSizeX, cellSizeY);
  const slope = computeSlopePercent(rawElev, width, height, cellSizeX, cellSizeY);
  const hand = computeHAND(rawElev, dir, acc, width, height, 75);

  const rawFlowPaths = extractFlowPathsGeoJSON(rawElev, dir, acc, gridMeta, {
    main: 240,
    normal: 75,
    detail: 25
  });
  const deduped = filterOverlappingFlowPaths(rawFlowPaths, activeVerified, 28);
  const flowPaths = {
    type: 'FeatureCollection',
    features: deduped.features
  };

  const osmFeatures = osmContext.features || [];
  const roadFeatures = osmFeatures.filter(f => f?.properties?.kind === 'road');
  const bridgeFeatures = osmFeatures.filter(f => f?.properties?.kind === 'bridge');
  const facilityFeatures = osmFeatures.filter(f => f?.properties?.kind === 'facility');
  const placeFeatures = osmFeatures.filter(f => f?.properties?.kind === 'place');

  const activeFlowFeatures = flowPaths.features.filter(f => !suppressedDemIds.has(f.properties.id));
  const combinedStreams = [
    ...activeVerified.map(f => ({
      ...f,
      properties: {
        tier: f.properties?.kind === 'river' ? 1 : 2,
        catchment_ha: f.properties?.kind === 'river' ? 280 : 110,
        ...f.properties
      }
    })),
    ...activeFlowFeatures
  ];
  const crossings = detectRoadStreamCrossings(roadFeatures, combinedStreams, 85);

  const bottlenecks = [
    ...crossings.map((c, idx) => ({
      id: `cross-${idx + 1}`,
      coords: c.coords,
      kind: 'drainage',
      status: c.tier === 1 ? 'critical' : 'clogged',
      name_id: c.roadName ? `Perlintasan Alur ${c.roadName}` : `Gorong / Perlintasan Jalan–Alur #${idx + 1}`,
      name_en: c.roadName ? `Stream Crossing at ${c.roadName}` : `Road–Stream Crossing #${idx + 1}`,
      desc_id: `Persilangan jalan OSM (${c.highway}) dengan alur air (DAS hulu ~${c.catchment_ha} ha). Perlu cek kapasitas gorong-gorong.`,
      desc_en: `Intersection of OSM road (${c.highway}) and stream channel (~${c.catchment_ha} ha upstream catchment). Verify culvert capacity.`
    })),
    ...bridgeFeatures.map((b, idx) => ({
      id: `br-${idx + 1}`,
      coords: b.geometry.coordinates,
      kind: 'drainage',
      status: 'damaged',
      name_id: b.properties.name,
      name_en: String(b.properties.name || '').replace(/^Jembatan/, 'Bridge'),
      desc_id: `Jembatan jalan (${b.properties.highway}) dari OpenStreetMap — cek kondisi tebing & sumbatan material.`,
      desc_en: `OpenStreetMap bridge (${b.properties.highway}) — inspect abutment stability and debris clearance.`
    }))
  ];

  const handRasters = renderSmoothHandFloodRasters(hand, slope, bottlenecks, gridMeta, 768);

  const checkDamFeatures = [];
  for (const fp of flowPaths.features) {
    if (fp.properties.tier === 2 && fp.properties.slope_pct >= 11 && checkDamFeatures.length < 4) {
      const mid = fp.geometry.coordinates[Math.floor(fp.geometry.coordinates.length / 2)];
      checkDamFeatures.push({
        type: 'Feature',
        properties: {
          id: `cd-${checkDamFeatures.length + 1}`,
          kind: 'bronjong',
          status: 'normal',
          verified: false,
          name_id: `Kandidat Cekdam / Bronjong Hulu #${checkDamFeatures.length + 1}`,
          name_en: `Candidate Check Dam / Gabion #${checkDamFeatures.length + 1}`,
          desc_id: `Alur hulu curam (${fp.properties.slope_pct}% lereng, DAS ${fp.properties.catchment_ha} ha). Potensial penahan sedimen/kayu.`,
          desc_en: `Steep upland channel (${fp.properties.slope_pct}% slope, ${fp.properties.catchment_ha} ha catchment). Potential debris-trap site.`
        },
        geometry: { type: 'Point', coordinates: mid }
      });
    }
  }

  const landslideSeeds = [];
  const stepScan = 16;
  for (let r = 12; r < height - 12 && landslideSeeds.length < 3; r += stepScan) {
    for (let c = 12; c < width - 12 && landslideSeeds.length < 3; c += stepScan) {
      const sl = slope[r * width + c];
      if (sl >= 38) {
        const lng = bbox.west + ((c + 0.5) / width) * (bbox.east - bbox.west);
        const lat = bbox.north - ((r + 0.5) / height) * (bbox.north - bbox.south);
        landslideSeeds.push({
          type: 'Feature',
          properties: {
            id: `ls-${landslideSeeds.length + 1}`,
            kind: 'landslide',
            status: 'critical',
            verified: false,
            name_id: `Titik Lereng Terjal #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            name_en: `Steep Slope Point #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            desc_id: `Kemiringan ~${Math.round(sl)}% terdeteksi dari DEM; rawan luncuran tanah saat hujan berkepanjangan.`,
            desc_en: `~${Math.round(sl)}% slope detected from DEM; susceptible to earthslides during heavy rain.`
          },
          geometry: { type: 'Point', coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] }
        });
      }
    }
  }

  const evacFeatures = [];
  for (const fac of facilityFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = fac.geometry.coordinates;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const hVal = hand[row * width + col];
    if (hVal >= 5) {
      evacFeatures.push({
        type: 'Feature',
        properties: {
          id: `ev-${evacFeatures.length + 1}`,
          kind: 'evacuation',
          status: 'normal',
          verified: false,
          name_id: `Kandidat Evakuasi: ${fac.properties.name}`,
          name_en: `Evacuation Candidate: ${fac.properties.name}`,
          desc_id: `Fasilitas publik OSM berada ~${Math.round(hVal)}m di atas dasar sungai terdekat.`,
          desc_en: `OSM public facility situated ~${Math.round(hVal)}m above nearest drainage channel.`
        },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }
  }
  for (const pl of placeFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = pl.geometry.coordinates;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const hVal = hand[row * width + col];
    if (hVal >= 6) {
      evacFeatures.push({
        type: 'Feature',
        properties: {
          id: `ev-${evacFeatures.length + 1}`,
          kind: 'evacuation',
          status: 'normal',
          verified: false,
          name_id: `Kandidat Titik Kumpul: ${pl.properties.name}`,
          name_en: `Assembly Point Candidate: ${pl.properties.name}`,
          desc_id: `Lahan tinggi (~${Math.round(hVal)}m di atas alur sungai terdekat) di sekitar ${pl.properties.name}.`,
          desc_en: `Elevated ground (~${Math.round(hVal)}m above nearest channel) near ${pl.properties.name}.`
        },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }
  }

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
      ...checkDamFeatures,
      ...landslideSeeds,
      ...evacFeatures
    ]
  };

  const recomputedAt = new Date().toISOString();
  const totalStreamKm = flowPaths.features.reduce((s, f) => s + f.properties.length_m, 0) / 1000;
  const nextMetadata = {
    ...metadata,
    streamNetworkKm: Number(totalStreamKm.toFixed(1)),
    crossingsDetected: crossings.length,
    bridgesDetected: bridgeFeatures.length,
    simAreasHa: handRasters.simAreasHa,
    verifiedWaterwayCount: activeVerified.length,
    hydroConditioned,
    hydroRecomputedAt: recomputedAt,
    burnedCellCount
  };

  const writeTargets = [publicDataDir];
  if (
    distDataDir &&
    fs.existsSync(distDataDir) &&
    path.resolve(distDataDir) !== path.resolve(publicDataDir)
  ) {
    writeTargets.push(distDataDir);
  }

  for (const dir of writeTargets) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'flow-paths.geojson'), JSON.stringify(flowPaths));
    fs.writeFileSync(path.join(dir, 'drainage-draft.geojson'), JSON.stringify(drainageDraft));
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(nextMetadata));
    for (const [k, buf] of Object.entries(handRasters.pngs)) {
      fs.writeFileSync(path.join(dir, `raster-hand-${k}.png`), buf);
    }
  }

  return {
    hydroConditioned,
    burnedCellCount,
    verifiedWaterwayCount: activeVerified.length,
    flowSegmentCount: flowPaths.features.length,
    filteredOverlapCount: deduped.filteredCount,
    crossingsDetected: crossings.length,
    simAreasHa: handRasters.simAreasHa,
    recomputedAt
  };
}
