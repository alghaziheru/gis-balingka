import type {
  CascadeSimParams,
  DebrisCouplingMode,
  HyetographType,
  SimCrossingNode,
  SimNetworkData,
  SimReachNode,
  WaterBalanceSummary
} from '../types/gis';

export interface HyetographStep {
  timeMin: number;
  rainMmHr: number;
  cumRainMm: number;
  isRecession: boolean;
}

export interface EnsembleMemberConfig {
  id: string;
  rainScale: number;
  cnDelta: number;
  manningScaleUnverified: number;
  manningScaleVerified: number;
  capScaleUnverified: number;
  capScaleVerified: number;
  demErrM: number;
  debrisScale: number;
  cohesionScale: number;
  phiDeltaDeg: number;
  soilDepthScale: number;
  ksMult: number;
}

/**
 * Seven deterministic scenario-sensitivity perturbation vectors (nominal + wet/dry,
 * rough/smooth channel, and geotechnical bounds) — not a Monte Carlo probability distribution.
 */
export const SIGMA_ENSEMBLE_MEMBERS: EnsembleMemberConfig[] = [
  {
    id: 'nominal',
    rainScale: 1.0,
    cnDelta: 0,
    manningScaleUnverified: 1.0,
    manningScaleVerified: 1.0,
    capScaleUnverified: 1.0,
    capScaleVerified: 1.0,
    demErrM: 0,
    debrisScale: 1.0,
    cohesionScale: 1.0,
    phiDeltaDeg: 0,
    soilDepthScale: 1.0,
    ksMult: 1.0
  },
  {
    id: 'wet_runoff',
    rainScale: 1.25,
    cnDelta: 5,
    manningScaleUnverified: 1.08,
    manningScaleVerified: 1.04,
    capScaleUnverified: 0.9,
    capScaleVerified: 0.95,
    demErrM: -0.15,
    debrisScale: 1.15,
    cohesionScale: 0.92,
    phiDeltaDeg: -1.0,
    soilDepthScale: 1.08,
    ksMult: 0.78
  },
  {
    id: 'dry_runoff',
    rainScale: 0.75,
    cnDelta: -5,
    manningScaleUnverified: 0.92,
    manningScaleVerified: 0.96,
    capScaleUnverified: 1.1,
    capScaleVerified: 1.05,
    demErrM: 0.15,
    debrisScale: 0.85,
    cohesionScale: 1.08,
    phiDeltaDeg: 1.0,
    soilDepthScale: 0.92,
    ksMult: 1.28
  },
  {
    id: 'rough_constricted',
    rainScale: 1.08,
    cnDelta: 2,
    manningScaleUnverified: 1.26,
    manningScaleVerified: 1.12,
    capScaleUnverified: 0.72,
    capScaleVerified: 0.88,
    demErrM: -0.1,
    debrisScale: 1.25,
    cohesionScale: 0.95,
    phiDeltaDeg: -0.5,
    soilDepthScale: 1.05,
    ksMult: 0.95
  },
  {
    id: 'smooth_open',
    rainScale: 0.92,
    cnDelta: -2,
    manningScaleUnverified: 0.78,
    manningScaleVerified: 0.89,
    capScaleUnverified: 1.28,
    capScaleVerified: 1.12,
    demErrM: 0.1,
    debrisScale: 0.75,
    cohesionScale: 1.05,
    phiDeltaDeg: 0.5,
    soilDepthScale: 0.95,
    ksMult: 1.05
  },
  {
    id: 'geotech_conservative',
    rainScale: 1.15,
    cnDelta: 3,
    manningScaleUnverified: 1.1,
    manningScaleVerified: 1.05,
    capScaleUnverified: 0.85,
    capScaleVerified: 0.93,
    demErrM: -0.35,
    debrisScale: 1.22,
    cohesionScale: 0.94,
    phiDeltaDeg: -0.8,
    soilDepthScale: 1.06,
    ksMult: 0.9
  },
  {
    id: 'geotech_optimistic',
    rainScale: 0.85,
    cnDelta: -3,
    manningScaleUnverified: 0.9,
    manningScaleVerified: 0.95,
    capScaleUnverified: 1.15,
    capScaleVerified: 1.07,
    demErrM: 0.35,
    debrisScale: 0.78,
    cohesionScale: 1.06,
    phiDeltaDeg: 0.8,
    soilDepthScale: 0.94,
    ksMult: 1.1
  }
];

export const RECESSION_MULTIPLIER = 1.28;

/**
 * Physical upper-bound rainfall intensity envelope (mm/hr) for West Sumatra storms
 * by duration (prevents non-physical extreme-intensity × multi-day totals).
 */
export function getMaxRealisticRainMmHr(durationMin: number): number {
  if (durationMin <= 30) return 140;
  if (durationMin <= 60) return 90;
  if (durationMin <= 120) return 60;
  if (durationMin <= 180) return 45;
  if (durationMin <= 360) return 30;
  if (durationMin <= 720) return 18;
  if (durationMin <= 1440) return 12;
  if (durationMin <= 2160) return 9;
  if (durationMin <= 2880) return 8;
  return 6;
}

/**
 * Bankfull channel incision depth (m) for Gunung Singgalang volcanic stream reaches.
 * Uses field-measured cross-section depth when present; otherwise uses tropical volcanic
 * incised hydraulic-geometry scaling (~0.60..1.18 m above DEM thalweg floor).
 */
export function estimateReachBankfullDepthM(reach: SimReachNode): number {
  if (reach.measuredDepthM != null && Number.isFinite(reach.measuredDepthM) && reach.measuredDepthM > 0.2) {
    return Math.min(2.2, reach.measuredDepthM * 0.85);
  }
  const areaTerm = 0.42 * Math.pow(Math.max(0.08, reach.upstreamAreaKm2), 0.18);
  const kindBoost = reach.waterwayKind === 'river' ? 0.12 : 0.0;
  return Math.max(0.40, Math.min(0.88, areaTerm + kindBoost));
}

export function resolveAntecedent5dMm(params: CascadeSimParams): number {
  if (typeof params.antecedent5dMm === 'number' && Number.isFinite(params.antecedent5dMm)) {
    return Math.max(0, Math.min(250, params.antecedent5dMm));
  }
  return params.soilMoisture === 'dry' ? 15 : params.soilMoisture === 'saturated' ? 150 : 45;
}

export function resolveHyetograph(params: CascadeSimParams): HyetographType {
  return params.hyetograph || 'alternating_block';
}

export function resolveOrographicPct(params: CascadeSimParams): number {
  if (typeof params.orographicPctPerKm === 'number' && Number.isFinite(params.orographicPctPerKm)) {
    return Math.max(0, Math.min(80, params.orographicPctPerKm));
  }
  return params.rainPattern === 'upland' ? 45 : 18;
}

export function resolveCulvertBlockagePct(params: CascadeSimParams): number {
  if (typeof params.culvertBlockagePct === 'number' && Number.isFinite(params.culvertBlockagePct)) {
    return Math.max(0, Math.min(100, params.culvertBlockagePct));
  }
  return params.drainCondition === 'cleared' ? 5 : params.drainCondition === 'surge' ? 78 : 65;
}

export function resolveDebrisCoupling(params: CascadeSimParams): DebrisCouplingMode {
  if (params.debrisCoupling) return params.debrisCoupling;
  return params.drainCondition === 'surge' ? 'surge' : 'coupled';
}

/**
 * Smooth continuous SCS Curve Number antecedent moisture adjustment driven by
 * 5-day antecedent precipitation P5 (mm): 0 mm -> AMC-I, 55 mm -> AMC-II, >=140 mm -> AMC-III.
 */
export function adjustCnForAntecedent(cn2: number, antecedent5dMm: number, cnOffset = 0): number {
  const base = Math.max(35, Math.min(96, cn2 + cnOffset));
  const cn1 = (4.2 * base) / (10 - 0.058 * base);
  const cn3 = (23 * base) / (10 + 0.13 * base);
  const p5 = Math.max(0, Math.min(250, antecedent5dMm));
  let cn: number;
  if (p5 <= 55) {
    const f = p5 / 55;
    cn = cn1 + (base - cn1) * f;
  } else {
    const f = Math.min(1, (p5 - 55) / 85);
    cn = base + (cn3 - base) * f;
  }
  return Math.max(30, Math.min(98, cn));
}

/**
 * Exact mass-conserving rainfall hyetograph over the active storm duration plus
 * zero-rain post-storm recession window.
 */
export function buildHyetograph(
  rainMmHr: number,
  durationMin: number,
  hyetograph: HyetographType,
  totalSteps = 28
): { steps: HyetographStep[]; totalWindowMin: number; dtMin: number; stormSteps: number } {
  const safeDur = Math.max(15, durationMin);
  // Multi-day monsoon events use a bounded 6-hour drainage recession instead of scaling linearly
  const recessionMin =
    safeDur >= 720
      ? Math.round(Math.min(safeDur * 0.28, 360))
      : Math.max(1, Math.round(safeDur * (RECESSION_MULTIPLIER - 1)));
  const totalWindowMin = safeDur + recessionMin;
  const dtMin = totalWindowMin / totalSteps;
  const stormSteps = Math.max(4, Math.min(totalSteps - 2, Math.round(safeDur / dtMin)));
  const targetDepthMm = Math.max(0, rainMmHr) * (safeDur / 60);

  const weights = new Float64Array(stormSteps);
  let wSum = 0;
  const isMultiDay = safeDur >= 720;
  for (let t = 0; t < stormSteps; t++) {
    const u = (t + 0.5) / stormSteps;
    let w = 1.0;
    if (isMultiDay) {
      // Multi-day monsoon pattern: steady background rain saturating regolith + realistic embedded convective rainband(s)
      if (hyetograph === 'convective_front') {
        w = 0.44 + 4.0 * Math.exp(-Math.pow((u - 0.36) / 0.07, 2));
      } else if (hyetograph === 'alternating_block') {
        w = 0.40 + 4.5 * Math.exp(-Math.pow((u - 0.80) / 0.065, 2));
      } else if (hyetograph === 'double_burst') {
        w =
          0.36 +
          2.5 * Math.exp(-Math.pow((u - 0.38) / 0.065, 2)) +
          3.6 * Math.exp(-Math.pow((u - 0.80) / 0.065, 2));
      }
    } else if (hyetograph === 'convective_front') {
      // Intense tropical convective burst peaking early (~22% into storm)
      w = 0.25 + 2.35 * Math.exp(-Math.pow((u - 0.22) / 0.22, 2));
    } else if (hyetograph === 'alternating_block') {
      // NRCS / SCS Alternating Block design storm peaking near 45%
      w = 0.22 + 2.45 * Math.exp(-Math.pow((u - 0.45) / 0.2, 2));
    } else if (hyetograph === 'double_burst') {
      // Twin orographic convective cells
      w =
        0.2 +
        1.75 * Math.exp(-Math.pow((u - 0.26) / 0.14, 2)) +
        1.95 * Math.exp(-Math.pow((u - 0.72) / 0.15, 2));
    }
    weights[t] = w;
    wSum += w;
  }

  const steps: HyetographStep[] = [];
  let cum = 0;
  for (let t = 0; t < totalSteps; t++) {
    const timeMin = (t + 1) * dtMin;
    let stepDepthMm = 0;
    const isRecession = t >= stormSteps;
    if (!isRecession && wSum > 0) {
      stepDepthMm = targetDepthMm * (weights[t] / wSum);
    }
    cum += stepDepthMm;
    steps.push({
      timeMin,
      rainMmHr: (stepDepthMm / dtMin) * 60,
      cumRainMm: cum,
      isRecession
    });
  }

  return { steps, totalWindowMin, dtMin, stormSteps };
}

/**
 * Spatial rainfall multiplier combining elevation-driven orographic enhancement
 * and either uniform, upland-focused, or user-placed localized convective storm core.
 */
export function computeSpatialRainFactor(
  elevM: number,
  minElevM: number,
  uplandFrac: number,
  coord: [number, number],
  params: CascadeSimParams
): number {
  const oroPct = resolveOrographicPct(params);
  const elevKm = Math.max(0, (elevM - minElevM) / 1000);
  const oroFactor = 1 + (oroPct / 100) * elevKm;

  if (params.rainPattern === 'storm_core' && params.stormCore) {
    const [cx, cy] = params.stormCore;
    const dxKm = (coord[0] - cx) * 111.32;
    const dyKm = (coord[1] - cy) * 110.54;
    const distSq = dxKm * dxKm + dyKm * dyKm;
    // Localized ~2.4 km convective core peaking at 1.48x with gentle periphery
    const coreFactor = 0.16 + 1.32 * Math.exp(-distSq / (2 * 2.4 * 2.4));
    return coreFactor * (0.85 + 0.15 * oroFactor);
  }

  if (params.rainPattern === 'upland') {
    const upFocus = 0.25 + 1.15 * Math.max(0, Math.min(1, uplandFrac));
    return upFocus * oroFactor;
  }

  // Uniform baseline gently modulated by orographic gradient around valley mean (~0.35 km)
  return oroFactor / (1 + (oroPct / 100) * 0.35);
}

/**
 * Invert a reach's HAND-derived Synthetic Rating Curve (SRC) to get normal stage (m),
 * top width (m), and flow velocity (m/s) for a given discharge Q (m³/s) and Manning's n.
 */
export function invertSrcStage(
  qM3s: number,
  manningN: number,
  reach: SimReachNode,
  stagesM: number[]
): { stageM: number; topWidthM: number; velocityMs: number } {
  if (qM3s <= 1e-4 || reach.kRef.length === 0) {
    return { stageM: 0, topWidthM: reach.topW[0] || 2.0, velocityMs: 0 };
  }
  const reqK = qM3s * Math.max(0.018, manningN);
  const kArr = reach.kRef;
  const wArr = reach.topW;
  const lastIdx = kArr.length - 1;

  let stageM: number;
  let topWidthM: number;

  if (reqK <= kArr[0]) {
    const f = reqK / Math.max(1e-5, kArr[0]);
    stageM = stagesM[0] * Math.pow(Math.max(0, f), 0.62);
    topWidthM = wArr[0];
  } else if (reqK >= kArr[lastIdx]) {
    const extraRatio = reqK / Math.max(1e-5, kArr[lastIdx]);
    stageM = Math.min(7.5, stagesM[lastIdx] * Math.pow(extraRatio, 0.36));
    topWidthM = wArr[lastIdx] * Math.pow(extraRatio, 0.2);
  } else {
    let hi = 1;
    while (hi < lastIdx && kArr[hi] < reqK) hi++;
    const lo = hi - 1;
    const span = Math.max(1e-6, kArr[hi] - kArr[lo]);
    const t = Math.max(0, Math.min(1, (reqK - kArr[lo]) / span));
    stageM = stagesM[lo] + (stagesM[hi] - stagesM[lo]) * t;
    topWidthM = wArr[lo] + (wArr[hi] - wArr[lo]) * t;
  }

  const estArea = Math.max(0.25, topWidthM * stageM * 0.68);
  const velocityMs = Math.max(0.15, Math.min(8.5, qM3s / estArea));
  return { stageM, topWidthM: Math.max(1.2, topWidthM), velocityMs };
}

export interface ReachSedimentSeries {
  checkpointSteps: number[];
  cumSedM3ByCheckpoint: Float32Array[];
}

export interface ReachSmaHistory {
  smaFillSeries: Float32Array;
}

export interface RoutedReachState {
  qWater: Float32Array;
  qBulk: Float32Array;
  stageNormal: Float32Array;
  backwaterHead: Float32Array;
  backwaterStartLong: Float32Array; // backwater applies for cellLongFrac >= this value (upstream of crossing!)
  backwaterLenFrac: Float32Array;
  sedimentCv: Float32Array;
  streamPowerWm2: Float32Array;
  chokedCount: number;
  chokedCrossingIds: string[];
  outletHydrographQ: Float32Array;
  outletHydrographBulkQ: Float32Array;
  peakOutletQ: number;
  meanRunoffMm: number;
  waterBalance: WaterBalanceSummary;
}

interface PreparedReachHydroParams {
  reachSpatialMult: Float32Array;
  reachS: Float32Array;
  reachSoilFill: Float32Array;
  initSoilFill: Float32Array;
  reachIaRem: Float32Array;
  reachPercolationMmHr: Float32Array;
  reachManning: Float32Array;
  reachHillFastAlpha: Float32Array;
  reachHillSlowAlpha: Float32Array;
}

function prepareReachHydroParams(
  network: SimNetworkData,
  minElevM: number,
  params: CascadeSimParams,
  member: EnsembleMemberConfig,
  dtMin: number
): PreparedReachHydroParams {
  const R = network.reachCount;
  const calManning = params.calibrationProfile?.manningMult ?? 1.0;
  const calCnOff = params.calibrationProfile?.cnOffset ?? 0;
  const antecedent5d = resolveAntecedent5dMm(params);
  const antecedentFill = Math.max(0.06, Math.min(0.84, antecedent5d / 185));

  const reachSpatialMult = new Float32Array(R);
  const reachS = new Float32Array(R);
  const reachSoilFill = new Float32Array(R);
  const initSoilFill = new Float32Array(R);
  const reachIaRem = new Float32Array(R);
  const reachPercolationMmHr = new Float32Array(R);
  const reachManning = new Float32Array(R);
  const reachHillFastAlpha = new Float32Array(R);
  const reachHillSlowAlpha = new Float32Array(R);

  for (let r = 0; r < R; r++) {
    const reach = network.reaches[r];
    reachSpatialMult[r] = computeSpatialRainFactor(
      reach.meanElevM,
      minElevM,
      reach.uplandFrac,
      reach.midCoord,
      params
    );
    // Volcanic humic Andosol + intact montane forest provide high infiltration porosity (-4 CN),
    // which is lost under upland forest degradation.
    let cn2 = reach.meanCn - 4.0 * reach.forestFrac;
    if (reach.uplandFrac >= 0.42 && reach.forestFrac > 0.15) {
      if (params.forestScenario === 'degraded30') cn2 = Math.min(92, cn2 + 10 * reach.forestFrac);
      else if (params.forestScenario === 'degraded50') cn2 = Math.min(95, cn2 + 17 * reach.forestFrac);
    }
    const cnBase = Math.max(32, Math.min(95, cn2 + calCnOff + member.cnDelta));
    const sVal = Math.max(12, (25400 / cnBase - 254) * (1.06 + 0.08 * reach.forestFrac));
    reachS[r] = sVal;

    const initFill = antecedentFill * (1 - 0.15 * reach.forestFrac);
    const f0 = sVal * initFill;
    reachSoilFill[r] = f0;
    initSoilFill[r] = f0;
    reachIaRem[r] = 0.14 * sVal * Math.max(0.05, 1 - antecedentFill * 1.15);

    reachPercolationMmHr[r] = 0.9 + 1.1 * reach.forestFrac + 0.4 * reach.uplandFrac;

    const baseN =
      reach.slope >= 0.08
        ? 0.062
        : reach.waterwayKind === 'river'
          ? 0.042
          : 0.052;
    const isMeasured = reach.measuredWidthM != null && reach.measuredDepthM != null;
    const memberNScale = isMeasured ? member.manningScaleVerified : member.manningScaleUnverified;
    reachManning[r] = Math.max(0.022, Math.min(0.14, baseN * calManning * memberNScale));

    const tauFastMin = Math.max(8, Math.min(34, 8 + Math.sqrt(Math.max(0.02, reach.localAreaKm2)) * 12));
    const tauSlowMin = Math.max(150, Math.min(270, 165 + reach.forestFrac * 75 + reach.uplandFrac * 30));
    reachHillFastAlpha[r] = 1 - Math.exp(-dtMin / tauFastMin);
    reachHillSlowAlpha[r] = 1 - Math.exp(-dtMin / tauSlowMin);
  }

  return {
    reachSpatialMult,
    reachS,
    reachSoilFill,
    initSoilFill,
    reachIaRem,
    reachPercolationMmHr,
    reachManning,
    reachHillFastAlpha,
    reachHillSlowAlpha
  };
}

interface StepSmaResult {
  dRainLocal: number;
  iaTaken: number;
  totalSurfaceRunoffMm: number;
  drainMm: number;
  returnFlowMm: number;
  u0: number;
  fillRatio: number;
}

/**
 * Advances continuous Soil Moisture Accounting (SCS-CN) by one timestep with exact mass closure:
 * dRainLocal === iaTaken + (totalSurfaceRunoffMm + returnFlowMm) + (F_after - F_before) + (drainMm - returnFlowMm).
 */
function stepReachSma(
  r: number,
  dRainLocal: number,
  isRecession: boolean,
  dtHr: number,
  hydro: PreparedReachHydroParams
): StepSmaResult {
  const sVal = hydro.reachS[r];
  const fillBefore = hydro.reachSoilFill[r];

  const iaTaken = Math.min(hydro.reachIaRem[r], dRainLocal);
  hydro.reachIaRem[r] -= iaTaken;
  const pEff = Math.max(0, dRainLocal - iaTaken);

  const u0 = Math.max(0, Math.min(1, fillBefore / sVal));
  let totalSurfaceRunoffMm = 0;
  if (pEff > 0) {
    const uMid = Math.max(0, Math.min(1, (fillBefore + 0.5 * pEff * (1 - u0) * (1 - u0)) / sVal));
    const oneMinusU = 1 - uMid;
    const runoffFrac = 1 - oneMinusU * oneMinusU;
    let dRunoffMm = pEff * runoffFrac;
    const dInfil = pEff - dRunoffMm;
    const rawFill = fillBefore + dInfil;
    if (rawFill > sVal) {
      dRunoffMm += rawFill - sVal;
      hydro.reachSoilFill[r] = sVal;
    } else {
      hydro.reachSoilFill[r] = rawFill;
    }
    totalSurfaceRunoffMm = dRunoffMm;
  }

  const fillRatio = Math.min(1, hydro.reachSoilFill[r] / sVal);
  const drainMm = Math.min(
    hydro.reachSoilFill[r],
    hydro.reachPercolationMmHr[r] * Math.pow(fillRatio, 1.35) * dtHr
  );
  hydro.reachSoilFill[r] = Math.max(0, hydro.reachSoilFill[r] - drainMm);
  const returnRatio = Math.max(0, Math.min(1, (fillRatio - 0.65) / 0.3));
  const returnFlowMm = isRecession ? drainMm * returnRatio * 0.4 : drainMm * returnRatio;

  return {
    dRainLocal,
    iaTaken,
    totalSurfaceRunoffMm,
    drainMm,
    returnFlowMm,
    u0,
    fillRatio: Math.min(1, hydro.reachSoilFill[r] / sVal)
  };
}

/**
 * Precomputes the nominal reach soil-storage fullness trajectory F(t)/S across all storm steps,
 * completely independent of playback progress, so hillslope pore pressure and surface runoff share
 * a unified, strictly causal SMA water balance.
 */
export function computeNominalReachSmaHistory(opts: {
  network: SimNetworkData;
  minElevM: number;
  params: CascadeSimParams;
  hyetographSteps: HyetographStep[];
  dtMin: number;
}): ReachSmaHistory {
  const { network, minElevM, params, hyetographSteps, dtMin } = opts;
  const R = network.reachCount;
  const T = hyetographSteps.length;
  const dtHr = dtMin / 60;
  const hydro = prepareReachHydroParams(network, minElevM, params, SIGMA_ENSEMBLE_MEMBERS[0], dtMin);
  const smaFillSeries = new Float32Array(T * R);

  for (let t = 0; t < T; t++) {
    const step = hyetographSteps[t];
    const stepRainMm = t === 0 ? step.cumRainMm : Math.max(0, step.cumRainMm - hyetographSteps[t - 1].cumRainMm);
    const rowOff = t * R;
    for (let r = 0; r < R; r++) {
      const res = stepReachSma(r, stepRainMm * hydro.reachSpatialMult[r], step.isRecession, dtHr, hydro);
      smaFillSeries[rowOff + r] = res.fillRatio;
    }
  }

  return { smaFillSeries };
}

function sampleCausalCumSedAtStep(
  series: ReachSedimentSeries | null | undefined,
  legacySupply: Float32Array | null | undefined,
  stepIdx: number,
  totalSteps: number,
  reachCount: number,
  reachIdx: number
): number {
  if (series && series.checkpointSteps.length > 0 && series.cumSedM3ByCheckpoint.length > 0) {
    const cps = series.checkpointSteps;
    const vals = series.cumSedM3ByCheckpoint;
    if (stepIdx <= cps[0]) return vals[0][reachIdx] || 0;
    const last = cps.length - 1;
    if (stepIdx >= cps[last]) return vals[last][reachIdx] || 0;
    for (let k = 1; k < cps.length; k++) {
      if (stepIdx <= cps[k]) {
        const s0 = cps[k - 1];
        const s1 = cps[k];
        const span = Math.max(1, s1 - s0);
        const f = (stepIdx - s0) / span;
        const v0 = vals[k - 1][reachIdx] || 0;
        const v1 = vals[k][reachIdx] || 0;
        return v0 + (v1 - v0) * f;
      }
    }
    return vals[last][reachIdx] || 0;
  }
  if (legacySupply && reachIdx < reachCount) {
    const frac = (stepIdx + 1) / Math.max(1, totalSteps);
    return (legacySupply[reachIdx] || 0) * frac;
  }
  return 0;
}

export function routeReachNetwork(opts: {
  network: SimNetworkData;
  minElevM: number;
  params: CascadeSimParams;
  member: EnsembleMemberConfig;
  hyetographSteps: HyetographStep[];
  dtMin: number;
  targetStepIdx: number;
  reachSedimentSeries?: ReachSedimentSeries | null;
  reachSedimentSupplyM3?: Float32Array | null;
  forceClearedCrossings?: boolean;
}): RoutedReachState {
  const {
    network,
    minElevM,
    params,
    member,
    hyetographSteps,
    dtMin,
    targetStepIdx,
    reachSedimentSeries = null,
    reachSedimentSupplyM3 = null,
    forceClearedCrossings = false
  } = opts;

  const R = network.reachCount;
  const T = hyetographSteps.length;
  const dtSec = Math.max(60, dtMin * 60);
  const stagesM = network.srcStagesM;

  const globalBlkPct = forceClearedCrossings ? 5 : resolveCulvertBlockagePct(params);
  const debrisMode = forceClearedCrossings ? 'clear' : resolveDebrisCoupling(params);
  const overrides = forceClearedCrossings ? {} : params.structureBlockageOverrides || {};

  // Group crossings by reach for O(1) lookup
  const crossingsByReach: SimCrossingNode[][] = Array.from({ length: R }, () => []);
  for (let i = 0; i < network.crossings.length; i++) {
    const c = network.crossings[i];
    if (c.reachId >= 0 && c.reachId < R) crossingsByReach[c.reachId].push(c);
  }

  const hydro = prepareReachHydroParams(network, minElevM, params, member, dtMin);
  const {
    reachSpatialMult,
    reachSoilFill,
    initSoilFill,
    reachManning,
    reachHillFastAlpha,
    reachHillSlowAlpha
  } = hydro;
  const reachCumRunoffMm = new Float32Array(R);

  // Dynamic state arrays per reach across time
  const qPrevIn = new Float32Array(R);
  const qPrevOut = new Float32Array(R);
  const qCurOut = new Float32Array(R);
  const hillFastStoreQ = new Float32Array(R);
  const hillSlowStoreQ = new Float32Array(R);

  // Causal active sediment storage and cumulative mobilized sediment per reach
  const prevCumSedM3 = new Float32Array(R);
  const sedStoreM3 = new Float32Array(R);
  const routedCumSedM3 = new Float32Array(R);
  const tauSedSec = 2100;
  const sedReleaseFrac = 1 - Math.exp(-dtSec / tauSedSec);

  // Target snapshot outputs
  const qWaterSnap = new Float32Array(R);
  const qBulkSnap = new Float32Array(R);
  const stageNormalSnap = new Float32Array(R);
  const backwaterHeadSnap = new Float32Array(R);
  const backwaterStartLongSnap = new Float32Array(R).fill(1.0);
  const backwaterLenFracSnap = new Float32Array(R);
  const sedimentCvSnap = new Float32Array(R);
  const streamPowerSnap = new Float32Array(R);

  // Track catchment outlet hydrograph (largest upstreamAreaKm2 reach inside/touching Nagari)
  let monitorReachId = R - 1;
  let maxMonArea = -1;
  for (let r = 0; r < R; r++) {
    const reach = network.reaches[r];
    if (reach.insideNagariFrac >= 0.15 && reach.upstreamAreaKm2 > maxMonArea) {
      maxMonArea = reach.upstreamAreaKm2;
      monitorReachId = r;
    }
  }

  const outletHydrographQ = new Float32Array(T);
  const outletHydrographBulkQ = new Float32Array(T);
  let peakOutletQ = 0;
  let chokedCountSnap = 0;
  let chokedCrossingIdsSnap: string[] = [];
  let meanRunoffMmSnap = 0;

  let wbAreaWeight = 0;
  for (let r = 0; r < R; r++) {
    if (network.reaches[r].insideNagariFrac > 0.05) {
      wbAreaWeight += network.reaches[r].localAreaKm2;
    }
  }
  let wbRainAreaSum = 0;
  let wbIaAreaSum = 0;
  let wbRunoffAreaSum = 0;
  let wbDeepPercAreaSum = 0;
  let wbStorageDeltaAreaSum = 0;

  // Build upstream adjacency list once for directional M1 backwater spillover into tributary mouths
  const upstreamOf: number[][] = Array.from({ length: R }, () => []);
  for (let r = 0; r < R; r++) {
    const d = network.reaches[r].downstreamId;
    if (d >= 0 && d < R) upstreamOf[d].push(r);
  }

  const safeTargetStep = Math.max(0, Math.min(T - 1, targetStepIdx));

  // Time marching over storm + recession
  const qInAccum = new Float32Array(R);
  const surgeDownBoost = new Float32Array(R);

  const dtHr = dtMin / 60;
  for (let t = 0; t < T; t++) {
    const step = hyetographSteps[t];
    const stepRainMm = t === 0 ? step.cumRainMm : Math.max(0, step.cumRainMm - hyetographSteps[t - 1].cumRainMm);
    qInAccum.fill(0);
    surgeDownBoost.fill(0);

    let areaWeightedRunoff = 0;
    let totalInsideArea = 0;
    let chokedNow = 0;
    const chokedIdsNow: string[] = [];

    // Topological upstream -> downstream Muskingum-Cunge pass with continuous SMA SCS-CN
    for (let r = 0; r < R; r++) {
      const reach = network.reaches[r];
      const dRainLocal = stepRainMm * reachSpatialMult[r] * member.rainScale;
      const sma = stepReachSma(r, dRainLocal, step.isRecession, dtHr, hydro);

      const stepTotalRunoffMm = sma.totalSurfaceRunoffMm + sma.returnFlowMm;
      reachCumRunoffMm[r] += stepTotalRunoffMm;

      if (reach.insideNagariFrac > 0.05) {
        const wArea = reach.localAreaKm2;
        areaWeightedRunoff += reachCumRunoffMm[r] * wArea;
        totalInsideArea += wArea;
        if (t <= safeTargetStep) {
          wbRainAreaSum += dRainLocal * wArea;
          wbIaAreaSum += sma.iaTaken * wArea;
          wbRunoffAreaSum += stepTotalRunoffMm * wArea;
          wbDeepPercAreaSum += (sma.drainMm - sma.returnFlowMm) * wArea;
          if (t === safeTargetStep) {
            wbStorageDeltaAreaSum += (reachSoilFill[r] - initSoilFill[r]) * wArea;
          }
        }
      }

      const slowFrac = Math.max(0.12, Math.min(0.62, (0.34 + 0.24 * reach.forestFrac) * (1 - sma.u0 * 0.72)));
      const fastRunoffMm = sma.totalSurfaceRunoffMm * (1 - slowFrac);
      const slowRunoffMm = sma.totalSurfaceRunoffMm * slowFrac + sma.returnFlowMm;

      // Convert incremental fast stormflow & slow volcanic interflow (mm) over local sub-catchment (km²) into m³/s
      const areaM2 = reach.localAreaKm2 * 1e6;
      const rawFastQ = (fastRunoffMm * 1e-3 * areaM2) / dtSec;
      const rawSlowQ = (slowRunoffMm * 1e-3 * areaM2) / dtSec;
      hillFastStoreQ[r] += reachHillFastAlpha[r] * (rawFastQ - hillFastStoreQ[r]);
      hillSlowStoreQ[r] += reachHillSlowAlpha[r] * (rawSlowQ - hillSlowStoreQ[r]);

      const qIn = qInAccum[r] + hillFastStoreQ[r] + hillSlowStoreQ[r];

      // Estimate wave celerity & Muskingum-Cunge routing weights
      const qRef = Math.max(0.15, (qIn + qPrevOut[r]) * 0.5);
      const rough = reachManning[r];
      const invRef = invertSrcStage(qRef, rough, reach, stagesM);
      const celerity = Math.max(0.45, Math.min(5.8, invRef.velocityMs * 1.55));
      const K = Math.max(20, reach.lengthM / celerity);
      const rawX = 0.5 - qRef / Math.max(1e-3, 2 * invRef.topWidthM * reach.slope * celerity * reach.lengthM);
      // Clamp X so C0, C1, C2 remain strictly non-negative (zero numerical oscillation)
      const maxStableX = Math.min(0.42, (0.5 * dtSec) / Math.max(1, K) - 0.02);
      const X = Math.max(0.0, Math.min(rawX, maxStableX));

      const denom = Math.max(1e-4, K * (1 - X) + 0.5 * dtSec);
      const c0 = Math.max(0, (0.5 * dtSec - K * X) / denom);
      const c1 = Math.max(0, (0.5 * dtSec + K * X) / denom);
      const c2 = Math.max(0, (K * (1 - X) - 0.5 * dtSec) / denom);
      const cSum = c0 + c1 + c2 || 1;

      const qOut = Math.max(0, (c0 * qIn + c1 * qPrevIn[r] + c2 * qPrevOut[r]) / cSum);
      qCurOut[r] = qOut;
      qPrevIn[r] = qIn;
      qPrevOut[r] = qOut;

      const d = reach.downstreamId;
      if (d >= 0 && d < R) {
        qInAccum[d] += qOut;
      }

      // Strictly causal sediment release & downstream debris routing (never depends on targetStepIdx)
      let cv = 0;
      if (debrisMode !== 'clear') {
        const cumNow =
          sampleCausalCumSedAtStep(reachSedimentSeries, reachSedimentSupplyM3, t, T, R, r) * member.debrisScale;
        const dLocalSed = Math.max(0, cumNow - prevCumSedM3[r]);
        if (cumNow > prevCumSedM3[r]) prevCumSedM3[r] = cumNow;
        sedStoreM3[r] += dLocalSed;
        routedCumSedM3[r] += dLocalSed;

        const releasedSedM3 = sedStoreM3[r] * sedReleaseFrac;
        sedStoreM3[r] -= releasedSedM3;
        if (d >= 0 && d < R && releasedSedM3 > 0) {
          const delivery = reach.slope >= 0.06 ? 0.92 : reach.slope >= 0.03 ? 0.72 : 0.45;
          const delivM3 = releasedSedM3 * delivery;
          sedStoreM3[d] += delivM3;
          routedCumSedM3[d] += delivM3;
        }
        if (qOut > 0.35 && releasedSedM3 > 0.01) {
          const qSed = releasedSedM3 / dtSec;
          cv = Math.min(0.42, qSed / Math.max(0.1, qOut + qSed));
        }
      }

      const rCross = crossingsByReach[r];
      const needCrossingCheck = t === safeTargetStep || (debrisMode === 'surge' && rCross.length > 0);
      const needFullReach = t === safeTargetStep || r === monitorReachId || needCrossingCheck;

      if (needFullReach) {
        const surgeMult = debrisMode === 'surge' ? 1 + surgeDownBoost[r] : 1;
        const qBulk = (qOut / Math.max(0.58, 1 - cv)) * surgeMult;

        if (r === monitorReachId) {
          outletHydrographQ[t] = qOut;
          outletHydrographBulkQ[t] = qBulk;
          if (qBulk > peakOutletQ) peakOutletQ = qBulk;
        }

        if (t === safeTargetStep || needCrossingCheck) {
          const rhoMix = 1000 * (1 - cv) + 2650 * cv;
          // Hyperconcentrated / debris flow increases effective flow resistance
          const nEff = reachManning[r] * (1 + 2.2 * cv);
          const { stageM, topWidthM } = invertSrcStage(qBulk, nEff, reach, stagesM);

          if (t === safeTargetStep) {
            const omega = (rhoMix * 9.81 * qBulk * reach.slope) / Math.max(1.5, topWidthM);
            qWaterSnap[r] = qOut;
            qBulkSnap[r] = qBulk;
            stageNormalSnap[r] = stageM;
            sedimentCvSnap[r] = cv;
            streamPowerSnap[r] = omega;
          }

          if (rCross.length > 0) {
            const woodyDebrisBonus =
              forceClearedCrossings || params.drainCondition === 'cleared'
                ? 0
                : Math.min(20, (routedCumSedM3[r] / 2500) * 10);

            for (let ci = 0; ci < rCross.length; ci++) {
              const cr = rCross[ci];
              const overrideVal = overrides[cr.id];
              let blkPct: number;
              if (typeof overrideVal === 'number' && Number.isFinite(overrideVal)) {
                blkPct = overrideVal;
              } else if (forceClearedCrossings || params.drainCondition === 'cleared') {
                blkPct = Math.min(15, globalBlkPct);
              } else if (cr.verified) {
                const statusFloor =
                  cr.status === 'critical'
                    ? 72
                    : cr.status === 'damaged'
                      ? 52
                      : cr.status === 'clogged'
                        ? 60
                        : cr.defaultBlockagePct;
                const baseBlk =
                  cr.status === 'normal' ? Math.min(globalBlkPct * 0.45, 35) : Math.max(statusFloor, globalBlkPct * 0.85);
                blkPct = Math.min(94, baseBlk + woodyDebrisBonus);
              } else {
                blkPct = Math.min(94, globalBlkPct + woodyDebrisBonus);
              }
              const blkFrac = Math.max(0, Math.min(0.94, blkPct / 100));
              const capScale = cr.measuredOpening ? member.capScaleVerified : member.capScaleUnverified;
              const reliefBoost = forceClearedCrossings || params.drainCondition === 'cleared' ? 1.22 : 1.05;
              const qCapEff = Math.max(0.4, cr.qCapM3s * reliefBoost * (1 - blkFrac) * capScale);

              if (qBulk > qCapEff) {
                if (t === safeTargetStep) {
                  chokedNow++;
                  chokedIdsNow.push(cr.id);
                  const qExcess = qBulk - qCapEff;
                  const roadWeirW = Math.max(3.5, topWidthM * 1.4);
                  const dh = Math.min(
                    2.6,
                    0.42 * Math.pow(qExcess / roadWeirW, 2 / 3) + 0.32 * blkFrac * Math.min(1.6, stageM)
                  );
                  if (dh > backwaterHeadSnap[r]) {
                    backwaterHeadSnap[r] = dh;
                    backwaterStartLongSnap[r] = cr.longFrac;
                    const lBwM = Math.max(85, (0.72 * dh) / Math.max(0.008, reach.slope));
                    backwaterLenFracSnap[r] = Math.min(1.5, lBwM / Math.max(40, reach.lengthM));
                  }
                }
                if (debrisMode === 'surge' && (cv >= 0.05 || blkFrac >= 0.65) && d >= 0 && d < R) {
                  const pulse = Math.min(0.45, 0.16 + cv * 0.8 + blkFrac * 0.18);
                  if (pulse > surgeDownBoost[d]) surgeDownBoost[d] = pulse;
                }
              }
            }
          }
        }
      }
      // Propagate attenuated surge pulse one reach downstream causally at every step in surge mode
      if (debrisMode === 'surge' && surgeDownBoost[r] > 0.08 && d >= 0 && d < R) {
        const nextPulse = surgeDownBoost[r] * 0.68;
        if (nextPulse > surgeDownBoost[d]) surgeDownBoost[d] = nextPulse;
      }
    }

    if (t === safeTargetStep) {
      chokedCountSnap = chokedNow;
      chokedCrossingIdsSnap = chokedIdsNow;
      meanRunoffMmSnap = totalInsideArea > 0 ? areaWeightedRunoff / totalInsideArea : 0;

      // Propagate directional M1 backwater strictly upstream into tributary mouths when backwater reaches reach head
      for (let r = R - 1; r >= 0; r--) {
        const bw = backwaterHeadSnap[r];
        if (bw <= 0.15) continue;
        const reachHeadSpan = 1 - backwaterStartLongSnap[r];
        if (backwaterLenFracSnap[r] > reachHeadSpan) {
          const residualFrac = Math.max(0, 1 - reachHeadSpan / Math.max(0.05, backwaterLenFracSnap[r]));
          const spillHead = bw * residualFrac * 0.72;
          if (spillHead <= 0.12) continue;
          const ups = upstreamOf[r];
          for (let ui = 0; ui < ups.length; ui++) {
            const u = ups[ui];
            if (spillHead > backwaterHeadSnap[u]) {
              backwaterHeadSnap[u] = spillHead;
              backwaterStartLongSnap[u] = 0;
              const lBwU = Math.max(60, (0.7 * spillHead) / Math.max(0.008, network.reaches[u].slope));
              backwaterLenFracSnap[u] = Math.min(1.0, lBwU / Math.max(40, network.reaches[u].lengthM));
            }
          }
        }
      }
    }
  }

  const denomArea = wbAreaWeight > 0 ? wbAreaWeight : 1;
  const rainInputMm = wbRainAreaSum / denomArea;
  const interceptionMm = wbIaAreaSum / denomArea;
  const totalRunoffMm = wbRunoffAreaSum / denomArea;
  const soilStorageDeltaMm = wbStorageDeltaAreaSum / denomArea;
  const deepPercolationMm = wbDeepPercAreaSum / denomArea;
  const closureErrorMm = rainInputMm - (interceptionMm + totalRunoffMm + soilStorageDeltaMm + deepPercolationMm);
  const closureErrorPct = rainInputMm > 1e-6 ? (closureErrorMm / rainInputMm) * 100 : 0;

  return {
    qWater: qWaterSnap,
    qBulk: qBulkSnap,
    stageNormal: stageNormalSnap,
    backwaterHead: backwaterHeadSnap,
    backwaterStartLong: backwaterStartLongSnap,
    backwaterLenFrac: backwaterLenFracSnap,
    sedimentCv: sedimentCvSnap,
    streamPowerWm2: streamPowerSnap,
    chokedCount: chokedCountSnap,
    chokedCrossingIds: chokedCrossingIdsSnap,
    outletHydrographQ,
    outletHydrographBulkQ,
    peakOutletQ,
    meanRunoffMm: meanRunoffMmSnap,
    waterBalance: {
      rainInputMm: Number(rainInputMm.toFixed(3)),
      interceptionMm: Number(interceptionMm.toFixed(3)),
      totalRunoffMm: Number(totalRunoffMm.toFixed(3)),
      soilStorageDeltaMm: Number(soilStorageDeltaMm.toFixed(3)),
      deepPercolationMm: Number(deepPercolationMm.toFixed(3)),
      closureErrorMm: Number(closureErrorMm.toFixed(5)),
      closureErrorPct: Number(closureErrorPct.toFixed(4))
    }
  };
}
