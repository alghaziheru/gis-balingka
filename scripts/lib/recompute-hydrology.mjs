import fs from 'node:fs';
import path from 'node:path';
import {
  buildPolygonMaskGrid,
  burnStreamsIntoDem,
  computeD8,
  computeHAND,
  computeSlopePercent,
  detectRoadStreamCrossings,
  extractFlowPathsGeoJSON,
  filterOverlappingFlowPaths,
  haversineMeters,
  priorityFloodFill,
  renderSmoothHandFloodRasters,
  computeCascadeFields
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
  verifiedStructures = [],
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
  const activeStructures = (verifiedStructures || []).filter(
    f => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2
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

  const areaScale = (30.9 * 30.9) / Math.max(1, cellSizeX * cellSizeY);
  const handStreamThreshold = Math.max(10, Math.round(75 * areaScale));
  const filled = priorityFloodFill(hydroElev, width, height);
  const { dir, acc } = computeD8(filled, width, height, cellSizeX, cellSizeY);
  const slope = computeSlopePercent(rawElev, width, height, cellSizeX, cellSizeY);
  const hand = computeHAND(rawElev, dir, acc, width, height, handStreamThreshold);

  const rawFlowPaths = extractFlowPathsGeoJSON(rawElev, dir, acc, gridMeta, {
    main: Math.max(40, Math.round(240 * areaScale)),
    normal: Math.max(15, Math.round(75 * areaScale)),
    detail: Math.max(8, Math.round(25 * areaScale))
  });
  const deduped = filterOverlappingFlowPaths(rawFlowPaths, activeVerified, 48, 0.55);
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

  const verifiedRefSet = new Set(
    activeStructures.map(s => s.properties?.source_ref).filter(Boolean).map(String)
  );
  const isCoveredByStructure = (id, coords) => {
    if (verifiedRefSet.has(id)) return true;
    return activeStructures.some(s => {
      const sc = s.geometry.coordinates;
      return haversineMeters(coords[0], coords[1], sc[0], sc[1]) <= 45;
    });
  };

  let existingDraftPts = [];
  try {
    const prevDraft = readJsonWithFallback(publicDataDir, distDataDir, 'drainage-draft.geojson');
    existingDraftPts = prevDraft?.features || [];
  } catch {}
  const preservedBigCrossings = existingDraftPts
    .filter(f => {
      const id = String(f?.properties?.id || '');
      return (id.startsWith('big-culv-') || id.startsWith('big-br-') || id.startsWith('big-weir-')) && f?.geometry?.type === 'Point';
    })
    .map(f => ({
      id: String(f.properties.id),
      coords: f.geometry.coordinates,
      kind: 'drainage',
      status: 'unverified',
      name_id: String(f.properties.name_id || ''),
      name_en: String(f.properties.name_en || ''),
      desc_id: String(f.properties.desc_id || ''),
      desc_en: String(f.properties.desc_en || '')
    }));

  const HIGHWAY_ID = {
    trunk: 'jalan nasional',
    primary: 'jalan utama',
    secondary: 'jalan kolektor',
    tertiary: 'jalan penghubung',
    residential: 'jalan permukiman',
    unclassified: 'jalan nagari',
    service: 'jalan akses',
    track: 'jalan tanah/kebun',
    path: 'jalan setapak',
    footway: 'jalan setapak'
  };
  const formatHighwayId = hw => HIGHWAY_ID[String(hw || '').toLowerCase()] || 'jalan';

  const rawDraftBottlenecks = [
    ...preservedBigCrossings,
    ...crossings
      .filter(
        c =>
          !preservedBigCrossings.some(
            bc => haversineMeters(c.coords[0], c.coords[1], bc.coords[0], bc.coords[1]) <= 55
          )
      )
      .map((c, idx) => ({
        id: `cross-${idx + 1}`,
        coords: c.coords,
        kind: 'drainage',
        status: 'unverified',
        name_id: c.roadName ? `Perlintasan ${c.roadName}` : `Persilangan Jalan–Alur #${idx + 1}`,
        name_en: c.roadName ? `Crossing at ${c.roadName}` : `Road–Stream Crossing #${idx + 1}`,
        desc_id: `Titik silang ${formatHighwayId(c.highway)} & alur perkiraan DEM (belum dicek lapangan).`,
        desc_en: `DEM road (${c.highway}) & computed channel crossing (unverified in the field).`
      })),
    ...bridgeFeatures
      .filter(
        b =>
          !preservedBigCrossings.some(
            bc => haversineMeters(b.geometry.coordinates[0], b.geometry.coordinates[1], bc.coords[0], bc.coords[1]) <= 35
          )
      )
      .map((b, idx) => ({
        id: `br-${idx + 1}`,
        coords: b.geometry.coordinates,
        kind: 'drainage',
        status: 'unverified',
        name_id: b.properties.name,
        name_en: String(b.properties.name || '').replace(/^Jembatan/, 'Bridge'),
        desc_id: `Jembatan ${formatHighwayId(b.properties.highway)} dari OpenStreetMap — belum dicek lapangan.`,
        desc_en: `OpenStreetMap bridge (${b.properties.highway}) — unverified in the field.`
      }))
  ];

  const draftCrossings = rawDraftBottlenecks.filter(b => !isCoveredByStructure(b.id, b.coords));
  const prioritizedVerifiedBottlenecks = activeStructures
    .filter(s => ['clogged', 'damaged', 'critical'].includes(String(s.properties?.status || '')))
    .map(s => ({
      id: s.properties.id,
      coords: s.geometry.coordinates,
      kind: s.properties.kind,
      status: s.properties.status
    }));
  const bottlenecks = [...prioritizedVerifiedBottlenecks, ...draftCrossings];

  let nagariMask = null;
  try {
    const nagariBoundary = readJsonWithFallback(publicDataDir, distDataDir, 'nagari-boundary.geojson');
    if (nagariBoundary?.features?.length) {
      nagariMask = buildPolygonMaskGrid(nagariBoundary, gridMeta);
    }
  } catch {}

  const handRasters = renderSmoothHandFloodRasters(hand, slope, bottlenecks, gridMeta, 768, nagariMask);

  let lcClasses = null;
  let soilErodibility = null;
  let officialLandslide = null;
  let agamSummary = null;
  for (const dir of [publicDataDir, distDataDir]) {
    if (!dir) continue;
    if (!lcClasses) {
      const lcPath = path.join(dir, 'landcover-grid.json');
      if (fs.existsSync(lcPath)) {
        try {
          const lcJson = JSON.parse(fs.readFileSync(lcPath, 'utf8'));
          if (lcJson?.classesBase64) {
            const buf = Buffer.from(lcJson.classesBase64, 'base64');
            if (buf.length === width * height) lcClasses = new Uint8Array(buf);
          }
        } catch {}
      }
    }
    if (!soilErodibility) {
      const agamGridPath = path.join(dir, 'agam-grids.json');
      if (fs.existsSync(agamGridPath)) {
        try {
          const agJson = JSON.parse(fs.readFileSync(agamGridPath, 'utf8'));
          const sBuf = agJson?.soilErodibilityBase64 ? Buffer.from(agJson.soilErodibilityBase64, 'base64') : null;
          const lBuf = agJson?.officialLandslideBase64 ? Buffer.from(agJson.officialLandslideBase64, 'base64') : null;
          if (sBuf?.length === width * height) soilErodibility = new Uint8Array(sBuf);
          if (lBuf?.length === width * height) officialLandslide = new Uint8Array(lBuf);
          if (agJson?.summary) agamSummary = agJson.summary;
        } catch {}
      }
    }
  }
  const simFields = computeCascadeFields({
    rawElev,
    filled,
    dir,
    acc,
    slope,
    hand,
    landCoverClasses: lcClasses,
    soilErodibility,
    officialLandslide,
    nagariMask,
    agamSummary,
    bottlenecks,
    gridMeta
  });

  const landslideSeeds = [];
  const stepScan = Math.max(16, Math.round(16 * Math.sqrt(areaScale)));
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
            status: 'normal',
            verified: false,
            name_id: `Titik Kemiringan Terjal #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            name_en: `Steep Slope Point #${landslideSeeds.length + 1} (${Math.round(sl)}%)`,
            desc_id: `Kemiringan lereng ~${Math.round(sl)}% dihitung dari elevasi BIG DEMNAS 8m (data geometri topografi).`,
            desc_en: `~${Math.round(sl)}% terrain slope computed from BIG DEMNAS 8m elevation (pure geometry measurement).`
          },
          geometry: { type: 'Point', coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] }
        });
      }
    }
  }

  const preservedBigEvac = existingDraftPts.filter(
    f => String(f?.properties?.id || '').startsWith('ev-big-') && f?.geometry?.type === 'Point'
  );
  const evacFeatures = preservedBigEvac.map(f => {
    const [lng, lat] = f.geometry.coordinates;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const hVal = Math.round(hand[row * width + col]);
    const cleanNameId = String(f.properties.name_id || '').replace(
      /^Kandidat Evakuasi:\s*/i,
      'Fasilitas Umum (BIG RBI): '
    );
    const cleanNameEn = String(f.properties.name_en || '').replace(
      /^Evacuation Candidate:\s*/i,
      'Public Facility (BIG RBI): '
    );
    return {
      ...f,
      properties: {
        ...f.properties,
        name_id: cleanNameId,
        name_en: cleanNameEn,
        desc_id: `Fasilitas publik resmi BIG RBI 50K (~${hVal}m di atas alur terdekat menurut HAND). Informasi data elevasi — bukan penetapan titik evakuasi resmi.`,
        desc_en: `Official BIG RBI 50K public facility (~${hVal}m above nearest channel via HAND). Elevation reference only — not an official evacuation designation.`
      }
    };
  });
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
          name_id: `Fasilitas Umum (OSM): ${fac.properties.name}`,
          name_en: `Public Facility (OSM): ${fac.properties.name}`,
          desc_id: `Fasilitas publik OSM berada ~${Math.round(hVal)}m di atas dasar alur terdekat menurut HAND. Informasi data elevasi — bukan penetapan titik evakuasi resmi.`,
          desc_en: `OSM public facility situated ~${Math.round(hVal)}m above nearest channel via HAND. Elevation reference only — not an official evacuation designation.`
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
          name_id: `Titik Elevasi Tinggi (OSM): ${pl.properties.name}`,
          name_en: `Elevated Point (OSM): ${pl.properties.name}`,
          desc_id: `Lokasi lahan tinggi (~${Math.round(hVal)}m di atas alur terdekat menurut HAND) di sekitar ${pl.properties.name}. Informasi data elevasi — bukan penetapan titik evakuasi resmi.`,
          desc_en: `Elevated ground (~${Math.round(hVal)}m above nearest channel via HAND) near ${pl.properties.name}. Elevation reference only — not an official evacuation designation.`
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
    fs.writeFileSync(path.join(dir, 'sim-fields.json'), JSON.stringify(simFields));
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
