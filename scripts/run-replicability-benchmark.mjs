#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModelParameterAudit } from '../src/data/climateBaseline.ts';
import { CascadeEngine, extractBuildingCentroids } from '../src/lib/cascadeEngine.ts';
import { getMaxRealisticRainMmHr } from '../src/lib/reachRouter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CASE_STUDY_CONFIG = {
  id: 'desa-sriharjo',
  name: 'Desa Sriharjo',
  shortName: 'Sriharjo',
  adminLevelLabel: { id: 'Desa', en: 'Village' },
  subRegionLabel: { id: 'Padukuhan', en: 'Hamlet' },
  district: 'Kec. Imogiri',
  regency: 'Kab. Bantul',
  province: 'DI Yogyakarta',
  officialBoundaryCode: '34.02.10.2003',
  officialBoundaryNameMatch: 'SRIHARJO',
  appTitle: { id: 'Peta Desa Sriharjo', en: 'Desa Sriharjo Map' },
  areaKm2: 11.0,
  uplandLandmark: { id: 'Perbukitan Imogiri & Lembah Oyo', en: 'Imogiri Hills & Oyo Valley' },
  mainRivers: ['Kali Oyo', 'Kali Opak'],
  bbox: { west: 110.39, south: -7.96, east: 110.422, north: -7.932 },
  defaultView: { center: [110.406, -7.946], zoom: 15.0 },
  dataCenter: [110.406, -7.946],
  cameraPresets: [
    { id: 'center', label: 'Sriharjo', center: [110.406, -7.946], zoom: 15.0, pitch3D: 34, bearing3D: 0 }
  ],
  subRegionSuggestions: ['Sompok', 'Wunut', 'Mojohuro'],
  drainageFocus: {
    upland: { center: [110.415, -7.95], zoom: 14.6, pitch: 45, bearing: -15 },
    culverts: { center: [110.406, -7.946], zoom: 15.0, pitch: 32, bearing: 0 },
    facilities: { center: [110.402, -7.944], zoom: 15.0, pitch: 30, bearing: 0 }
  },
  authorities: {
    bpbdLabel: 'BPBD Kab. Bantul',
    localOfficeId: 'Kalurahan Sriharjo',
    localOfficeEn: 'Sriharjo Village Office',
    localAuthorityShort: 'Lurah Sriharjo',
    defaultEditorName: 'Relawan Sriharjo'
  },
  regionalOverlays: {
    enabled: false,
    providerName: 'Open Data Global',
    rbiAvailable: false,
    sentinelChangeAvailable: false,
    localDemFilename: '',
    bigRbiZipName: '',
    bigRbiGdbName: '',
    bigDesaGdbName: '',
    bigRbiDasName: ''
  },
  hydrology: {
    soilProfile: 'alluvial_clay',
    climateBiasFactor: 1.0,
    climateSourceNote: 'Unadjusted 41-yr Open-Meteo ERA5-Land daily reanalysis (no local BMKG bias factor configured)'
  },
  repositoryUrl: 'https://github.com/alghaziheru/gis-balingka'
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gis-replicability-case2-'));
try {
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmpDir, 'node_modules'), 'dir');
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmpDir, 'scripts'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'src'), path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'server'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server', 'regions.mjs'), path.join(tmpDir, 'server', 'regions.mjs'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmpDir, 'package.json'));
  fs.writeFileSync(path.join(tmpDir, 'region.config.json'), JSON.stringify(CASE_STUDY_CONFIG, null, 2));

  console.log(`[replicability] Running Option A prepare-data for ${CASE_STUDY_CONFIG.name} in ${tmpDir}...`);
  const tStart = performance.now();
  const proc = spawnSync(process.execPath, ['scripts/prepare-data.mjs'], {
    cwd: tmpDir,
    stdio: 'inherit',
    timeout: 240000
  });
  const setupTimeSec = Number(((performance.now() - tStart) / 1000).toFixed(2));
  if (proc.status !== 0) {
    throw new Error(`prepare-data failed with status ${proc.status}`);
  }

  const outDataDir = path.join(tmpDir, 'public', 'data');
  const files = fs.readdirSync(outDataDir);
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += fs.statSync(path.join(outDataDir, f)).size;
  }

  const metadata = JSON.parse(fs.readFileSync(path.join(outDataDir, 'metadata.json'), 'utf8'));
  const simFields = JSON.parse(fs.readFileSync(path.join(outDataDir, 'sim-fields.json'), 'utf8'));
  const climateBaseline = JSON.parse(fs.readFileSync(path.join(outDataDir, 'climate-baseline.json'), 'utf8'));
  const settlements = JSON.parse(fs.readFileSync(path.join(outDataDir, 'settlements.geojson'), 'utf8'));

  const totalCrossings = (metadata.crossingsDetected || 0) + (metadata.bridgesDetected || 0) || 10;
  const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), totalCrossings);

  const normalParams = {
    rainMmHr: Math.min(15, getMaxRealisticRainMmHr(120, climateBaseline)),
    durationMin: 120,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 45,
    rainPattern: 'uniform',
    drainCondition: 'cleared',
    forestScenario: 'actual',
    soilProfile: 'alluvial_clay'
  };
  const intenseCap = getMaxRealisticRainMmHr(180, climateBaseline);
  const intenseParams = {
    rainMmHr: Math.min(40, intenseCap),
    durationMin: 180,
    soilMoisture: 'moist',
    antecedent5dMm: 65,
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual',
    hyetograph: 'alternating_block',
    debrisCoupling: 'coupled',
    soilProfile: 'alluvial_clay'
  };

  const normalKpis = engine.evaluate(normalParams, { skipValidation: true });
  const earlyIntense = engine.evaluate({ ...intenseParams, progress: 0.45 }, { skipValidation: true });
  const lateIntense = engine.evaluate({ ...intenseParams, progress: 0.9 }, { skipValidation: true });

  const causalHydrograph =
    earlyIntense.peakDischargeM3s === lateIntense.peakDischargeM3s &&
    earlyIntense.hydrograph.every(
      (pt, idx) => pt.qBulkP50 === lateIntense.hydrograph[idx]?.qBulkP50
    );

  const maxClosureErrorPct = Number(
    Math.max(
      Math.abs(normalKpis.waterBalance?.closureErrorPct ?? 0),
      Math.abs(earlyIntense.waterBalance?.closureErrorPct ?? 0),
      Math.abs(lateIntense.waterBalance?.closureErrorPct ?? 0)
    ).toFixed(5)
  );

  const auditRows = buildModelParameterAudit(climateBaseline, 'alluvial_clay', CASE_STUDY_CONFIG);
  const auditRaw = JSON.stringify(auditRows);
  const zeroBalingkaLeakage =
    !auditRaw.includes('Balingka') &&
    !auditRaw.includes('Padang Panjang') &&
    !auditRaw.includes('Sicincin');

  const summary = {
    generatedAt: new Date().toISOString(),
    regionId: CASE_STUDY_CONFIG.id,
    regionName: CASE_STUDY_CONFIG.name,
    locationLabel: `${CASE_STUDY_CONFIG.district}, ${CASE_STUDY_CONFIG.regency}, ${CASE_STUDY_CONFIG.province}`,
    dataTrack: `Option A (Automatic Global Open Data: ${metadata.demSource} + ${metadata.landCoverStats ? 'ESA WorldCover 10m' : 'Default CN fallback'} + OSM + ERA5-Land)`,
    soilProfile: 'alluvial_clay',
    setupTimeSec,
    artifacts: {
      fileCount: files.length,
      totalSizeMb: Number((totalBytes / (1024 * 1024)).toFixed(2))
    },
    terrainAndNetwork: {
      demSource: metadata.demSource,
      gridDimensions: metadata.gridDimensions,
      resolutionMeters: metadata.resolutionMeters,
      minElevM: metadata.minElevM,
      maxElevM: metadata.maxElevM,
      studyAreaKm2: metadata.studyAreaKm2,
      reachCount: simFields.network?.reachCount ?? 0,
      crossingsDetected: metadata.crossingsDetected,
      bridgesDetected: metadata.bridgesDetected,
      buildingCount: metadata.buildingCount ?? settlements.features.length,
      landCoverStats: metadata.landCoverStats ?? null
    },
    climate: {
      yearsCount: climateBaseline.era5Series.yearsCount,
      meanAnnualMm: climateBaseline.era5Series.correctedMeanAnnualMm,
      r24T100GumbelMm: climateBaseline.returnPeriodsMm.r24.t100Gumbel,
      r48T100GumbelMm: climateBaseline.returnPeriodsMm.r48.t100Gumbel,
      idf3hCapMmHr: intenseCap
    },
    simulationChecks: {
      normal2h: {
        rainMmHr: normalParams.rainMmHr,
        peakDischargeM3s: normalKpis.peakDischargeM3s,
        floodAreaHa: normalKpis.floodAreaHa,
        landslideAreaHa: normalKpis.landslideAreaHa,
        closureErrorPct: normalKpis.waterBalance?.closureErrorPct ?? 0
      },
      intense3h: {
        rainMmHr: intenseParams.rainMmHr,
        peakDischargeM3s: lateIntense.peakDischargeM3s,
        floodAreaHa: lateIntense.floodAreaHa,
        landslideAreaHa: lateIntense.landslideAreaHa,
        effectiveRunoffMm: lateIntense.effectiveRunoffMm,
        closureErrorPct: lateIntense.waterBalance?.closureErrorPct ?? 0
      }
    },
    checks: {
      causalHydrograph,
      maxClosureErrorPct,
      zeroBalingkaLeakage,
      auditRowCount: auditRows.length
    }
  };

  const outPath = path.join(ROOT, 'docs', 'benchmarks', 'replicability-summary.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`[replicability] Saved ${path.relative(ROOT, outPath)} in ${setupTimeSec}s`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
