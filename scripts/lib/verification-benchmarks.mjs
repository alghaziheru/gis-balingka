import fs from 'node:fs';
import path from 'node:path';
import { CascadeEngine, extractBuildingCentroids } from '../../src/lib/cascadeEngine.ts';
import {
  buildHyetograph,
  routeReachNetwork,
  SIGMA_ENSEMBLE_MEMBERS,
  stepReachSma
} from '../../src/lib/reachRouter.ts';
import { buildClimateBaselineFromDailySeries } from './climate-fetcher.mjs';
import { computeCrossingCapacityM3s, parseStructureOpening } from './reach-network.mjs';

function computeR2NseRmse(obs, pred) {
  const n = Math.min(obs.length, pred.length);
  if (n < 2) return { r2: 0, nse: 0, rmse: 0 };
  const meanObs = obs.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const e = obs[i] - pred[i];
    ssRes += e * e;
    const d = obs[i] - meanObs;
    ssTot += d * d;
  }
  const nse = ssTot > 1e-12 ? 1 - ssRes / ssTot : 1;
  const rmse = Math.sqrt(ssRes / n);
  return {
    r2: Number(Math.max(0, nse).toFixed(5)),
    nse: Number(nse.toFixed(5)),
    rmseMm: Number(rmse.toFixed(4))
  };
}

/**
 * 1. Continuous SMA Differential Integration vs Exact Analytical NRCS TR-55 Runoff:
 * Compares Michel et al. (2005) midpoint integration dQ/dPe = 1 - (1 - F/S)^2
 * against exact NRCS analytical Q(Pe) = Pe^2 / (Pe + S) with zero percolation.
 */
function verifyScsCnAnalytical({ cn = 72, iaFactor = 0.14 } = {}) {
  const s = 25400 / cn - 254;
  const ia = iaFactor * s;
  const exactList = [];
  const smaList = [];

  for (let pTotal = 20; pTotal <= 300; pTotal += 20) {
    const pe = Math.max(0, pTotal - ia);
    const qExact = pe > 0 ? (pe * pe) / (pe + s) : 0;

    // March 28-step uniform storm calling the live production stepReachSma() solver directly
    const steps = 28;
    const dp = pTotal / steps;
    const hydro = {
      reachSpatialMult: new Float32Array([1]),
      reachS: new Float32Array([s]),
      reachSoilFill: new Float32Array([0]),
      initSoilFill: new Float32Array([0]),
      reachIaRem: new Float32Array([ia]),
      reachPercolationMmHr: new Float32Array([0]),
      reachManning: new Float32Array([0.045]),
      reachHillFastAlpha: new Float32Array([1]),
      reachHillSlowAlpha: new Float32Array([1])
    };
    let qSma = 0;
    for (let t = 0; t < steps; t++) {
      const stepRes = stepReachSma(0, dp, false, 1 / steps, hydro);
      qSma += stepRes.totalSurfaceRunoffMm + stepRes.returnFlowMm;
    }
    exactList.push(qExact);
    smaList.push(qSma);
  }

  return {
    cn,
    sMm: Number(s.toFixed(2)),
    iaMm: Number(ia.toFixed(2)),
    samplePoints: exactList.length,
    ...computeR2NseRmse(exactList, smaList)
  };
}

/**
 * 2. Synthetic 10-Reach Linear Channel Muskingum-Cunge Verification:
 * Verifies discharge conservation, positive wave lag, and numerical stability (no negative flow).
 */
function verifyMuskingumChannel() {
  const R = 10;
  const reaches = [];
  const srcStagesM = [0.25, 0.5, 1.0, 2.0, 4.0];
  const width = 6.0;
  const slope = 0.02;
  const lengthM = 250;
  const kRef = srcStagesM.map(h => {
    const a = width * h;
    const rh = a / (width + 2 * h);
    return Number((a * Math.pow(rh, 2 / 3) * Math.sqrt(slope)).toFixed(3));
  });

  for (let r = 0; r < R; r++) {
    reaches.push({
      id: r,
      downstreamId: r < R - 1 ? r + 1 : -1,
      lengthM,
      slope,
      upstreamAreaKm2: Number(((r + 1) * 0.2).toFixed(2)),
      localAreaKm2: 0.2,
      meanElevM: 1200 - r * 5,
      meanSlopePct: slope * 100,
      meanCn: 88,
      forestFrac: 0.2,
      meanTwi: 8,
      uplandFrac: 0.1,
      insideNagariFrac: 1.0,
      headCoord: [100.31, -0.34 - r * 0.002],
      midCoord: [100.31, -0.341 - r * 0.002],
      outletCoord: [100.31, -0.342 - r * 0.002],
      coords: [
        [100.31, -0.34 - r * 0.002],
        [100.31, -0.342 - r * 0.002]
      ],
      kRef,
      topW: srcStagesM.map(() => width),
      verifiedWaterwayId: null,
      waterwayName: `Reach ${r + 1}`,
      waterwayKind: 'stream',
      measuredWidthM: width,
      measuredWidthPreM: null,
      measuredDepthM: 1.5,
      dataConfidence: 'high'
    });
  }

  const network = {
    version: 2,
    srcStagesM,
    reachCount: R,
    crossingCount: 0,
    reaches,
    crossings: []
  };

  const hy = buildHyetograph(45, 120, 'convective_front', 72);
  // Extend tail with zero-rain drain steps so wave empties through reach #9
  const extraSteps = [...hy.steps];
  const lastCum = extraSteps[extraSteps.length - 1].cumRainMm;
  for (let i = 1; i <= 48; i++) {
    extraSteps.push({
      timeMin: hy.steps[hy.steps.length - 1].timeMin + i * hy.dtMin,
      rainMmHr: 0,
      cumRainMm: lastCum,
      isRecession: true
    });
  }

  const routed = routeReachNetwork({
    network,
    minElevM: 1100,
    params: {
      rainMmHr: 45,
      durationMin: 120,
      progress: 1.0,
      soilMoisture: 'saturated',
      antecedent5dMm: 140,
      rainPattern: 'uniform',
      drainCondition: 'cleared',
      forestScenario: 'actual',
      hyetograph: 'convective_front',
      debrisCoupling: 'clear',
      soilProfile: 'cambisol_loam'
    },
    member: SIGMA_ENSEMBLE_MEMBERS[0],
    hyetographSteps: extraSteps,
    dtMin: hy.dtMin,
    targetStepIdx: extraSteps.length - 1
  });

  const dtSec = hy.dtMin * 60;
  let routedOutVolM3 = 0;
  let minQ = Infinity;
  let maxRainIdx = 0;
  let maxQIdx = 0;
  for (let t = 0; t < extraSteps.length; t++) {
    const q = routed.outletHydrographQ[t];
    routedOutVolM3 += q * dtSec;
    if (q < minQ) minQ = q;
    if (extraSteps[t].rainMmHr > extraSteps[maxRainIdx].rainMmHr) maxRainIdx = t;
    if (q > routed.outletHydrographQ[maxQIdx]) maxQIdx = t;
  }

  const totalAreaM2 = R * 0.2 * 1e6;
  const generatedRunoffVolM3 = (routed.meanRunoffMm * 1e-3) * totalAreaM2;
  const volDiffPct =
    generatedRunoffVolM3 > 0
      ? Number((((routedOutVolM3 - generatedRunoffVolM3) / generatedRunoffVolM3) * 100).toFixed(2))
      : 0;

  return {
    reachCount: R,
    channelLengthKm: (R * lengthM) / 1000,
    peakRainMin: Number(extraSteps[maxRainIdx].timeMin.toFixed(1)),
    peakOutletMin: Number(extraSteps[maxQIdx].timeMin.toFixed(1)),
    lagMin: Number((extraSteps[maxQIdx].timeMin - extraSteps[maxRainIdx].timeMin).toFixed(1)),
    peakOutletQ: Number(routed.peakOutletQ.toFixed(2)),
    minQ: Number(minQ.toFixed(4)),
    generatedRunoffVolM3: Math.round(generatedRunoffVolM3),
    routedOutVolM3: Math.round(routedOutVolM3),
    volumeBalanceDiffPct: volDiffPct
  };
}

/**
 * 3. FHWA HDS-5 Submerged Orifice Check against exact analytical Cd * A * sqrt(2 * g * H_eff).
 */
function verifyHds5Orifice() {
  const cases = [
    { label: 'Pipe Ø 0.80m', kind: 'culvert', size_note: 'Pipa Ø 80cm', cd: 0.62, headScale: 0.85 },
    { label: 'Box 1.50m × 1.20m', kind: 'culvert', size_note: 'Box 1.5m x 1.2m', cd: 0.66, headScale: 0.85 },
    { label: 'Bridge 4.0m × 2.5m', kind: 'bridge', size_note: '4.0m x 2.5m', cd: 0.78, headScale: 0.75 }
  ];
  const g = 9.81;
  const rows = [];
  let maxRelErrPct = 0;

  for (const c of cases) {
    const opening = parseStructureOpening({ size_note: c.size_note });
    const qModel = computeCrossingCapacityM3s({ kind: c.kind, opening, upstreamAreaKm2: 2.0 });
    const area = opening.isCircular
      ? Math.PI * (opening.widthM * 0.5) ** 2
      : opening.widthM * opening.heightM;
    const hEff = Math.max(0.35, opening.heightM * c.headScale);
    const qAnalytical = c.cd * area * Math.sqrt(2 * g * hEff);
    const relErrPct = Number(((Math.abs(qModel - qAnalytical) / qAnalytical) * 100).toFixed(3));
    if (relErrPct > maxRelErrPct) maxRelErrPct = relErrPct;
    rows.push({
      label: c.label,
      qModelM3s: qModel,
      qAnalyticalM3s: Number(qAnalytical.toFixed(2)),
      relErrPct
    });
  }
  return { maxRelErrPct, cases: rows };
}

/**
 * 4. Runs full analytical + mass-balance + browser-equivalent runtime benchmarks on CascadeEngine.
 */
export function runAnalyticalVerifications({ simFields, settlements = null, meta = null }) {
  const scsCheck = verifyScsCnAnalytical();
  const muskingumCheck = verifyMuskingumChannel();
  const hds5Check = verifyHds5Orifice();

  const centroids = settlements ? extractBuildingCentroids(settlements) : [];
  const totalCrossings = meta ? (meta.crossingsDetected || 0) + (meta.bridgesDetected || 0) || 37 : 37;
  const engine = new CascadeEngine(simFields, centroids, totalCrossings);

  const closureScenarios = [
    {
      name: 'normal_2h_dry',
      params: {
        rainMmHr: 15,
        durationMin: 120,
        progress: 0.9,
        soilMoisture: 'dry',
        antecedent5dMm: 10,
        rainPattern: 'uniform',
        drainCondition: 'cleared',
        forestScenario: 'actual'
      }
    },
    {
      name: 'upland_3h_clogged',
      params: {
        rainMmHr: 40,
        durationMin: 180,
        progress: 0.78,
        soilMoisture: 'moist',
        antecedent5dMm: 65,
        rainPattern: 'upland',
        drainCondition: 'clogged',
        forestScenario: 'actual'
      }
    },
    {
      name: 'monsoon_48h_surge',
      params: {
        rainMmHr: 7,
        durationMin: 2880,
        progress: 0.78,
        soilMoisture: 'moist',
        antecedent5dMm: 75,
        rainPattern: 'upland',
        drainCondition: 'surge',
        forestScenario: 'actual'
      }
    }
  ];

  const waterBalanceChecks = [];
  let maxClosureErrorPct = 0;
  for (const sc of closureScenarios) {
    const res = engine.evaluate(sc.params, { skipValidation: true });
    const errPct = Math.abs(res.waterBalance?.closureErrorPct ?? 0);
    if (errPct > maxClosureErrorPct) maxClosureErrorPct = errPct;
    waterBalanceChecks.push({
      scenario: sc.name,
      rainInputMm: res.waterBalance?.rainInputMm ?? 0,
      interceptionMm: res.waterBalance?.interceptionMm ?? 0,
      totalRunoffMm: res.waterBalance?.totalRunoffMm ?? 0,
      soilStorageDeltaMm: res.waterBalance?.soilStorageDeltaMm ?? 0,
      deepPercolationMm: res.waterBalance?.deepPercolationMm ?? 0,
      closureErrorPct: res.waterBalance?.closureErrorPct ?? 0,
      peakDischargeM3s: res.peakDischargeM3s,
      floodAreaHa: res.floodAreaHa,
      landslideAreaHa: res.landslideAreaHa
    });
  }

  // Runtime latency benchmark (median & P95 across 10 cache-cold evaluations of varying progress)
  const runtimeTimings = {};
  for (const sc of closureScenarios) {
    const times = [];
    for (let it = 0; it < 10; it++) {
      const p = 0.25 + it * 0.07;
      const t0 = performance.now();
      engine.evaluate({ ...sc.params, progress: p }, { skipValidation: true });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    runtimeTimings[sc.name] = {
      medianMs: Number(times[Math.floor(times.length * 0.5)].toFixed(2)),
      p95Ms: Number(times[Math.min(times.length - 1, Math.floor(times.length * 0.9))].toFixed(2))
    };
  }

  return {
    scsCnAnalytical: scsCheck,
    muskingumChannel: muskingumCheck,
    fhwaHds5Orifice: hds5Check,
    waterBalanceClosure: {
      maxAbsClosureErrorPct: Number(maxClosureErrorPct.toFixed(5)),
      scenarios: waterBalanceChecks
    },
    browserEngineLatencyMs: runtimeTimings
  };
}

/**
 * 5. Cross-check 41-year ERA5-Land daily precipitation against NASA POWER (PRECTOTCORR)
 * on the same period (1985-2025) to quantify multi-source satellite/reanalysis rainfall spread.
 */
export async function fetchNasaPowerCrossCheck({ rootDir, lat, lng, climateBaseline }) {
  const cachePath = path.join(rootDir, 'raw-data', 'nasa-power-cache.json');
  let rawPower = null;

  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (
        cached?.dailyDates?.length > 1000 &&
        Math.abs(cached.lat - lat) < 0.05 &&
        Math.abs(cached.lng - lng) < 0.05
      ) {
        rawPower = cached;
      }
    } catch {}
  }

  if (!rawPower) {
    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&start=19850101&end=20251231&format=JSON`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rec = json?.properties?.parameter?.PRECTOTCORR || {};
      const entries = Object.entries(rec)
        .filter(([, v]) => v != null && Number.isFinite(v) && v >= 0)
        .sort((a, b) => a[0].localeCompare(b[0]));
      if (entries.length < 1000) throw new Error('Insufficient NASA POWER daily records');
      rawPower = {
        lat,
        lng,
        dailyDates: entries.map(([d]) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`),
        dailyMm: entries.map(([, v]) => Number(v))
      };
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(rawPower));
    } catch (err) {
      return {
        available: false,
        reason: err instanceof Error ? err.message : String(err)
      };
    }
  }

  const powerBaseline = buildClimateBaselineFromDailySeries({
    regionId: climateBaseline.regionId,
    regionName: climateBaseline.regionName,
    targetCoord: [lat, lng],
    gridCoord: [lat, lng],
    gridElevM: climateBaseline.era5Series.gridElevM,
    dailyDates: rawPower.dailyDates,
    dailyMm: rawPower.dailyMm,
    biasFactor: 1.0
  });

  return {
    available: true,
    source: 'NASA POWER Daily Agroclimatology (PRECTOTCORR, ~0.5° MERRA-2 + satellite blend)',
    period: powerBaseline.era5Series.period,
    yearsCount: powerBaseline.era5Series.yearsCount,
    daysCount: powerBaseline.era5Series.daysCount,
    meanAnnualMm: powerBaseline.era5Series.rawMeanAnnualMm,
    returnPeriodsMm: powerBaseline.returnPeriodsMm,
    comparison: {
      era5RawMeanAnnualMm: climateBaseline.era5Series.rawMeanAnnualMm,
      era5BmkgCorrectedMeanAnnualMm: climateBaseline.era5Series.correctedMeanAnnualMm,
      nasaPowerMeanAnnualMm: powerBaseline.era5Series.rawMeanAnnualMm,
      era5BmkgR24T100: climateBaseline.returnPeriodsMm.r24.t100Gumbel,
      nasaPowerR24T100: powerBaseline.returnPeriodsMm.r24.t100Gumbel,
      era5BmkgR48T100: climateBaseline.returnPeriodsMm.r48.t100Gumbel,
      nasaPowerR48T100: powerBaseline.returnPeriodsMm.r48.t100Gumbel,
      era5BmkgR72T100: climateBaseline.returnPeriodsMm.r72.t100Gumbel,
      nasaPowerR72T100: powerBaseline.returnPeriodsMm.r72.t100Gumbel
    }
  };
}
