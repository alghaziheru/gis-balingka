import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { haversineMeters } from './hydrology.mjs';
import { mergeBuildingsWithDedupe } from './data-fetchers.mjs';

export function loadVerifiedWaterwaysForBurning(rootDir, outDir) {
  const dbPath = path.join(rootDir, 'data', 'balingka.db');
  if (fs.existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { open: true });
      const wwCols = new Set(db.prepare('PRAGMA table_info(waterways)').all().map(c => c.name));
      const extraWw = [
        wwCols.has('width_pre_m') ? 'width_pre_m' : 'NULL AS width_pre_m',
        wwCols.has('width_post_m') ? 'width_post_m' : 'NULL AS width_post_m',
        wwCols.has('depth_m') ? 'depth_m' : 'NULL AS depth_m'
      ].join(', ');
      const rows = db.prepare(`SELECT id, name, kind, status, coordinates_json, ${extraWw} FROM waterways WHERE deleted = 0`).all();
      const supRows = db.prepare('SELECT seg_id FROM suppressed_dem_segments').all();
      let structures = [];
      try {
        const stCols = new Set(db.prepare('PRAGMA table_info(structures)').all().map(c => c.name));
        const extraSt = [
          stCols.has('opening_width_m') ? 'opening_width_m' : 'NULL AS opening_width_m',
          stCols.has('opening_height_m') ? 'opening_height_m' : 'NULL AS opening_height_m',
          stCols.has('default_blockage_pct') ? 'default_blockage_pct' : 'NULL AS default_blockage_pct'
        ].join(', ');
        const stRows = db
          .prepare(`SELECT id, name, kind, status, size_note, lng, lat, ${extraSt} FROM structures WHERE deleted = 0`)
          .all();
        structures = stRows.map(s => ({
          type: 'Feature',
          properties: {
            id: s.id,
            name: s.name,
            kind: s.kind,
            status: s.status,
            size_note: s.size_note || '',
            opening_width_m: s.opening_width_m ?? null,
            opening_height_m: s.opening_height_m ?? null,
            default_blockage_pct: s.default_blockage_pct ?? null
          },
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] }
        }));
      } catch {}
      db.close();
      return {
        source: 'sqlite',
        features: rows.map(r => ({
          type: 'Feature',
          properties: {
            id: r.id,
            name: r.name,
            kind: r.kind,
            status: r.status || 'normal',
            width_pre_m: r.width_pre_m ?? null,
            width_post_m: r.width_post_m ?? null,
            depth_m: r.depth_m ?? null,
            tier: r.kind === 'river' ? 1 : 2,
            catchment_ha: r.kind === 'river' ? 280 : 110
          },
          geometry: { type: 'LineString', coordinates: JSON.parse(r.coordinates_json) }
        })),
        structures,
        suppressedIds: new Set(supRows.map(s => s.seg_id))
      };
    } catch (err) {
      console.warn('Warning: could not read data/balingka.db for stream burning:', err.message);
    }
  }
  for (const geoPath of [
    path.join(outDir, 'verified-waterways.geojson'),
    path.join(rootDir, 'raw-data', 'verified-waterways.geojson')
  ]) {
    if (fs.existsSync(geoPath)) {
      const fc = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
      let suppressedIds = new Set();
      const supPath = path.join(path.dirname(geoPath), 'suppressed-dem.json');
      if (fs.existsSync(supPath)) {
        const arr = JSON.parse(fs.readFileSync(supPath, 'utf8'));
        if (Array.isArray(arr)) suppressedIds = new Set(arr.map(s => s.seg_id).filter(Boolean));
      }
      let structures = [];
      const stPath = path.join(path.dirname(geoPath), 'verified-structures.geojson');
      if (fs.existsSync(stPath)) {
        try {
          const stFc = JSON.parse(fs.readFileSync(stPath, 'utf8'));
          if (Array.isArray(stFc?.features)) {
            structures = stFc.features.filter(f => f?.geometry?.type === 'Point');
          }
        } catch {}
      }
      return {
        source: 'geojson',
        features: (fc.features || []).filter(f => f?.geometry?.type === 'LineString'),
        structures,
        suppressedIds
      };
    }
  }
  return { source: 'none', features: [], structures: [], suppressedIds: new Set() };
}

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

function formatHighwayId(hw) {
  return HIGHWAY_ID[String(hw || '').toLowerCase()] || 'jalan';
}

export function buildDrainageBottlenecks({ bigRbi, crossings, osmBridgeFeatures, inNagariPt }) {
  const bigCrossings = [];
  if (bigRbi) {
    const pushBigPoint = (prefix, idx, pt, labelId, labelEn, descId, descEn) => {
      const c = pt?.coords;
      if (!Array.isArray(c) || c.length < 2 || !inNagariPt(c)) return;
      if (bigCrossings.some(x => haversineMeters(c[0], c[1], x.coords[0], x.coords[1]) <= 22)) return;
      bigCrossings.push({
        id: `${prefix}${idx + 1}`,
        coords: c,
        kind: 'drainage',
        status: 'unverified',
        name_id: labelId,
        name_en: labelEn,
        desc_id: descId,
        desc_en: descEn
      });
    };
    (bigRbi.weirs || []).forEach((w, i) =>
      pushBigPoint(
        'big-weir-',
        i,
        w,
        w.name || `Bendung / Pintu Air RBI #${i + 1}`,
        w.name || `RBI Weir / Sluice Gate #${i + 1}`,
        'Bendung / pintu air resmi BIG RBI 50K (Des 2022) — cek kondisi operasional di lapangan.',
        'Official BIG RBI 50K (Dec 2022) weir / sluice gate — inspect condition in the field.'
      )
    );
    (bigRbi.bridges || []).forEach((b, i) =>
      pushBigPoint(
        'big-br-',
        i,
        b,
        b.name || `Jembatan RBI #${i + 1}`,
        b.name || `RBI Bridge #${i + 1}`,
        'Lokasi jembatan resmi BIG RBI 50K (Des 2022) — cek bentang & bebas sumbatan.',
        'Official BIG RBI 50K (Dec 2022) bridge location — inspect span and debris clearance.'
      )
    );
    (bigRbi.culverts || []).forEach((c, i) =>
      pushBigPoint(
        'big-culv-',
        i,
        c,
        c.name || `Gorong-gorong RBI #${i + 1}`,
        c.name || `RBI Culvert #${i + 1}`,
        'Titik gorong-gorong resmi BIG RBI 50K (Des 2022) — periksa apakah tersumbat/mencukupi.',
        'Official BIG RBI 50K (Dec 2022) culvert point — verify capacity and clogging status.'
      )
    );
  }

  return [
    ...bigCrossings,
    ...crossings
      .filter(
        c =>
          inNagariPt(c.coords) &&
          !bigCrossings.some(bc => haversineMeters(c.coords[0], c.coords[1], bc.coords[0], bc.coords[1]) <= 55)
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
    ...osmBridgeFeatures
      .filter(
        b =>
          inNagariPt(b.geometry.coordinates) &&
          !bigCrossings.some(
            bc => haversineMeters(b.geometry.coordinates[0], b.geometry.coordinates[1], bc.coords[0], bc.coords[1]) <= 35
          )
      )
      .map((b, idx) => ({
        id: `br-${idx + 1}`,
        coords: b.geometry.coordinates,
        kind: 'drainage',
        status: 'unverified',
        name_id: b.properties.name,
        name_en: b.properties.name.replace(/^Jembatan/, 'Bridge'),
        desc_id: `Jembatan ${formatHighwayId(b.properties.highway)} dari OpenStreetMap — belum dicek lapangan.`,
        desc_en: `OpenStreetMap bridge (${b.properties.highway}) — unverified in the field.`
      }))
  ];
}

export function buildSteepSlopeSeeds({ slope, width, height, bbox, nagariMask, areaScale }) {
  const landslideSeeds = [];
  const stepScan = Math.max(16, Math.round(16 * Math.sqrt(areaScale)));
  for (let r = 12; r < height - 12 && landslideSeeds.length < 3; r += stepScan) {
    for (let c = 12; c < width - 12 && landslideSeeds.length < 3; c += stepScan) {
      if (nagariMask && nagariMask[r * width + c] === 0) continue;
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
  return landslideSeeds;
}

export function buildElevatedFacilitySeeds({ bigRbi, osm, width, height, bbox, hand, agamGrids, inNagariPt }) {
  const evacFeatures = [];
  const bigFacilities = (bigRbi?.facilities || []).slice();
  const catOrder = { health: 0, gov: 1, school: 2, worship: 3 };
  bigFacilities.sort((a, b) => (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9));
  for (const bf of bigFacilities) {
    if (evacFeatures.length >= 8) break;
    const [lng, lat] = bf.coords || [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inNagariPt([lng, lat])) continue;
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const hVal = hand[row * width + col];
    const lsOfficial = agamGrids?.officialLandslide?.[row * width + col] ?? 0;
    if (hVal < 5 || lsOfficial >= 3) continue;
    if (evacFeatures.some(e => haversineMeters(lng, lat, e.geometry.coordinates[0], e.geometry.coordinates[1]) < 180)) {
      continue;
    }
    const label = bf.name || bf.remark || 'Fasilitas Publik RBI';
    evacFeatures.push({
      type: 'Feature',
      properties: {
        id: `ev-big-${evacFeatures.length + 1}`,
        kind: 'evacuation',
        status: 'normal',
        verified: false,
        name_id: `Fasilitas Umum (BIG RBI): ${label}`,
        name_en: `Public Facility (BIG RBI): ${label}`,
        desc_id: `Fasilitas publik resmi BIG RBI 50K (~${Math.round(hVal)}m di atas alur terdekat menurut HAND). Informasi data elevasi — bukan penetapan titik evakuasi resmi.`,
        desc_en: `Official BIG RBI 50K public facility (~${Math.round(hVal)}m above nearest channel via HAND). Elevation reference only — not an official evacuation designation.`
      },
      geometry: { type: 'Point', coordinates: [lng, lat] }
    });
  }
  for (const fac of osm.facilityFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = fac.geometry.coordinates;
    if (!inNagariPt([lng, lat])) continue;
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
  for (const pl of osm.placeFeatures) {
    if (evacFeatures.length >= 3) break;
    const [lng, lat] = pl.geometry.coordinates;
    if (!inNagariPt([lng, lat])) continue;
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
  return evacFeatures;
}

export function buildWatershedGeoJSON({ regionName, bbox, totalWidthM, totalHeightM }) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name_id: `Blok Peta ${regionName}`,
        name_en: `${regionName} Map Block`,
        area_km2: Number(((totalWidthM * totalHeightM) / 1e6).toFixed(2))
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[bbox.west, bbox.north], [bbox.east, bbox.north], [bbox.east, bbox.south], [bbox.west, bbox.south], [bbox.west, bbox.north]]]
      }
    }]
  };
}

export function buildStudioMaskGeoJSON({ regionName, bbox, nagariBoundary }) {
  // Inverted studio mask polygon covering the globe with inner cutout matching official region boundary
  const ensureRingWinding = (ring, wantCcw) => {
    let area2 = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    const isCcw = area2 > 0;
    return isCcw === wantCcw ? ring : [...ring].reverse();
  };
  const maskHoles = [];
  for (const feat of nagariBoundary?.features || []) {
    const geom = feat?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && geom.coordinates?.[0]?.length >= 4) {
      maskHoles.push(ensureRingWinding(geom.coordinates[0], true));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates || []) {
        if (poly?.[0]?.length >= 4) maskHoles.push(ensureRingWinding(poly[0], true));
      }
    }
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: `Studio Mask Outside Official ${regionName}` },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[-180, 85], [180, 85], [180, -85], [-180, -85], [-180, 85]],
          ...(maskHoles.length > 0
            ? maskHoles
            : [[[bbox.west, bbox.north], [bbox.west, bbox.south], [bbox.east, bbox.south], [bbox.east, bbox.north], [bbox.west, bbox.north]]])
        ]
      }
    }]
  };
}

function polygonCentroid(feat) {
  const g = feat?.geometry;
  const ring = g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : g?.coordinates?.[0];
  if (!ring?.length) return null;
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
  return [sx / n, sy / n];
}

export function buildClippedSettlements({ osm, googleBuildings, inNagariPt }) {
  const osmBuildingsInside = osm.buildingFeatures.filter(f => {
    const c = polygonCentroid(f);
    return c && inNagariPt(c);
  });
  const googleBuildingsInside = (googleBuildings || []).filter(f => {
    const c = polygonCentroid(f);
    return c && inNagariPt(c);
  });
  const residentialInside = osm.residentialFeatures.filter(f => {
    const c = polygonCentroid(f);
    return c && inNagariPt(c);
  });
  const { mergedBuildings, googleAddedCount } = mergeBuildingsWithDedupe(osmBuildingsInside, googleBuildingsInside);
  const settlements = {
    type: 'FeatureCollection',
    features: [...residentialInside, ...mergedBuildings]
  };
  const settlementStats = {
    osmBuildings: osmBuildingsInside.length,
    googleOpenBuildingsAdded: googleAddedCount,
    totalBuildings: mergedBuildings.length,
    residentialZones: residentialInside.length,
    openBuildingsConfidenceMin: 0.75
  };
  return { settlements, settlementStats, mergedBuildings, residentialInside, googleAddedCount };
}

export function buildDatasetMetadata({
  regionCfg,
  regionName,
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
}) {
  const licenses = [
    { name: 'MapLibre GL JS', license: 'BSD-3-Clause' },
    { name: sourceLabel, license: sourceLabel.includes('BIG') ? 'Public Government Data (Badan Informasi Geospasial)' : 'Open Geospatial Data' },
    ...(hasNagariBoundary
      ? [{ name: nagariSrcLabel, license: regionCfg.officialBoundaryCode ? `Public Government Data (${regionCfg.officialBoundaryCode})` : 'Open Boundary GeoJSON' }]
      : []),
    ...(scourStats ? [{ name: 'Copernicus Sentinel-2 L2A (10m)', license: 'Copernicus Open License (ESA)' }] : []),
    ...(landCoverStats ? [{ name: 'ESA WorldCover 10m v200', license: 'CC-BY-4.0 (ESA / Copernicus)' }] : []),
    ...(googleAddedCount > 0 ? [{ name: 'Google Open Buildings v3', license: 'CC-BY-4.0 (Google Research / Cloud Open Data)' }] : []),
    ...(agamStats
      ? [{ name: `${regionCfg.regionalOverlays?.providerName || 'Regional'} Open GIS`, license: 'Public Government Data' }]
      : []),
    { name: 'Esri World Imagery', license: 'Free w/ Attribution (No API Key)' },
    { name: 'OpenStreetMap & OpenTopoMap', license: 'ODbL / CC-BY-SA' }
  ];

  return {
    generatedAt: new Date().toISOString(),
    regionId: regionCfg.id || 'nagari-balingka',
    regionName,
    center,
    bbox,
    demSource: sourceLabel,
    gridDimensions: `${width}x${height}`,
    resolutionMeters: Number(((cellSizeX + cellSizeY) / 2).toFixed(1)),
    minElevM: Math.round(minElev),
    maxElevM: Math.round(maxElev),
    studyAreaKm2: officialAreaKm2,
    streamNetworkKm: Number(totalStreamKm.toFixed(1)),
    osmPlaceCount: osm.placeFeatures.length,
    osmWaterwayCount: osm.waterwayFeatures.length,
    osmRoadCount: osm.roadFeatures.length,
    buildingCount: mergedBuildings.length,
    residentialZoneCount: residentialInside.length,
    crossingsDetected: crossings.filter(c => inNagariPt(c.coords)).length,
    bridgesDetected: osm.bridgeFeatures.filter(b => inNagariPt(b.geometry.coordinates)).length,
    simAreasHa: handRasters.simAreasHa,
    verifiedWaterwayCount: verified.features.length,
    hydroConditioned,
    settlementStats,
    ...(agamStats ? { agamStats } : {}),
    ...(landCoverStats ? { landCoverStats } : {}),
    ...(scourStats ? { scourStats } : {}),
    ...(hasNagariBoundary ? { nagariBoundarySource: nagariSrcLabel } : {}),
    licenses
  };
}
