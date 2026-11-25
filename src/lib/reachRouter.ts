import type {
  CascadeSimParams,
  DebrisCouplingMode,
  HyetographType,
  SimCrossingNode,
  SimNetworkData,
  SimReachNode
} from '../types/gis';

export interface HyetographStep {
  timeMin: number;
  rainMmHr: number;
  cumRainMm: number;
  isRecession: boolean;
}

export interface EnsembleMemberConfig {
  id: string;
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

export const SIGMA_ENSEMBLE_MEMBERS: EnsembleMemberConfig[] = [
  {
    id: 'nominal',
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

export function resolveAntecedent5dMm(params: CascadeSimParams): number {
  if (typeof params.antecedent5dMm === 'number' && Number.isFinite(params.antecedent5dMm)) {
    return Math.max(0, Math.min(250, params.antecedent5dMm));
  }
  return params.soilMoisture === 'dry' ? 15 : params.soilMoisture === 'saturated' ? 150 : 65;
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
  const totalWindowMin = Math.round(safeDur * RECESSION_MULTIPLIER);
  const dtMin = totalWindowMin / totalSteps;
  const stormSteps = Math.max(4, Math.min(totalSteps - 2, Math.round(safeDur / dtMin)));
  const targetDepthMm = Math.max(0, rainMmHr) * (safeDur / 60);

  const weights = new Float64Array(stormSteps);
  let wSum = 0;
  for (let t = 0; t < stormSteps; t++) {
    const u = (t + 0.5) / stormSteps;
    let w = 1.0;
    if (hyetograph === 'convective_front') {
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
}

export function routeReachNetwork(opts: {
  network: SimNetworkData;
  minElevM: number;
  params: CascadeSimParams;
  member: EnsembleMemberConfig;
  hyetographSteps: HyetographStep[];
  dtMin: number;
  targetStepIdx: number;
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
    reachSedimentSupplyM3 = null,
    forceClearedCrossings = false
  } = opts;

  const R = network.reachCount;
  const T = hyetographSteps.length;
  const dtSec = Math.max(60, dtMin * 60);
  const stagesM = network.srcStagesM;

  const calManning = params.calibrationProfile?.manningMult ?? 1.0;
  const calCnOff = params.calibrationProfile?.cnOffset ?? 0;
  const antecedent5d = resolveAntecedent5dMm(params);
  const globalBlkPct = forceClearedCrossings ? 5 : resolveCulvertBlockagePct(params);
  const debrisMode = forceClearedCrossings ? 'clear' : resolveDebrisCoupling(params);
  const overrides = forceClearedCrossings ? {} : params.structureBlockageOverrides || {};

  // Group crossings by reach for O(1) lookup
  const crossingsByReach: SimCrossingNode[][] = Array.from({ length: R }, () => []);
  for (let i = 0; i < network.crossings.length; i++) {
    const c = network.crossings[i];
    if (c.reachId >= 0 && c.reachId < R) crossingsByReach[c.reachId].push(c);
  }

  // Precompute reach-level hydrological parameters
  const reachSpatialMult = new Float32Array(R);
  const reachS = new Float32Array(R);
  const reachIa = new Float32Array(R);
  const reachManning = new Float32Array(R);
  const reachHillAlpha = new Float32Array(R);

  for (let r = 0; r < R; r++) {
    const reach = network.reaches[r];
    reachSpatialMult[r] = computeSpatialRainFactor(
      reach.meanElevM,
      minElevM,
      reach.uplandFrac,
      reach.midCoord,
      params
    );
    let cn2 = reach.meanCn;
    if (reach.uplandFrac >= 0.42 && reach.forestFrac > 0.15) {
      if (params.forestScenario === 'degraded30') cn2 = Math.min(92, cn2 + 8 * reach.forestFrac);
      else if (params.forestScenario === 'degraded50') cn2 = Math.min(94, cn2 + 14 * reach.forestFrac);
    }
    const cn = adjustCnForAntecedent(cn2, antecedent5d, calCnOff + member.cnDelta);
    const sVal = Math.max(5, 25400 / cn - 254);
    reachS[r] = sVal;
    // Modern NRCS humid-watershed initial abstraction ratio lambda = 0.08 (Hawkins et al. 2009)
    reachIa[r] = 0.08 * sVal;

    // Physical Manning's n: rougher on steep cobble/forested mountain creeks, smoother on wider rivers
    const baseN =
      reach.slope >= 0.08
        ? 0.062
        : reach.waterwayKind === 'river'
          ? 0.042
          : 0.052;
    const isMeasured = reach.measuredWidthM != null && reach.measuredDepthM != null;
    const memberNScale = isMeasured ? member.manningScaleVerified : member.manningScaleUnverified;
    reachManning[r] = Math.max(0.022, Math.min(0.14, baseN * calManning * memberNScale));

    // Sub-catchment overland lag constant (linear reservoir)
    const tauHillMin = Math.max(4, Math.min(26, 6 + Math.sqrt(Math.max(0.02, reach.localAreaKm2)) * 11));
    reachHillAlpha[r] = 1 - Math.exp(-dtMin / tauHillMin);
  }

  // Dynamic state arrays per reach across time
  const qPrevIn = new Float32Array(R);
  const qPrevOut = new Float32Array(R);
  const qCurOut = new Float32Array(R);
  const hillStoreQ = new Float32Array(R);
  const prevCumRunoffMm = new Float32Array(R);

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

  // Build upstream adjacency list once for directional M1 backwater spillover into tributary mouths
  const upstreamOf: number[][] = Array.from({ length: R }, () => []);
  for (let r = 0; r < R; r++) {
    const d = network.reaches[r].downstreamId;
    if (d >= 0 && d < R) upstreamOf[d].push(r);
  }

  const safeTargetStep = Math.max(0, Math.min(T - 1, targetStepIdx));

  // Precompute reach-level routed sediment volume & surge pulse factors at target time
  const routedSedM3 = new Float32Array(R);
  if (debrisMode !== 'clear' && reachSedimentSupplyM3) {
    for (let r = 0; r < R; r++) {
      const reach = network.reaches[r];
      const localSed = (reachSedimentSupplyM3[r] || 0) * member.debrisScale;
      const totalSed = routedSedM3[r] + localSed;
      routedSedM3[r] = totalSed;
      const d = reach.downstreamId;
      if (d >= 0 && d < R) {
        // Steep channels transport debris efficiently; low-slope fans deposit sediment
        const delivery = reach.slope >= 0.06 ? 0.92 : reach.slope >= 0.03 ? 0.72 : 0.45;
        routedSedM3[d] += totalSed * delivery;
      }
    }
  }

  // Time marching over storm + recession
  const qInAccum = new Float32Array(R);
  const surgeDownBoost = new Float32Array(R);

  for (let t = 0; t < T; t++) {
    const step = hyetographSteps[t];
    qInAccum.fill(0);
    surgeDownBoost.fill(0);

    let areaWeightedRunoff = 0;
    let totalInsideArea = 0;
    let chokedNow = 0;
    const chokedIdsNow: string[] = [];

    // Topological upstream -> downstream Muskingum-Cunge pass
    for (let r = 0; r < R; r++) {
      const reach = network.reaches[r];
      const cumRainLocal = step.cumRainMm * reachSpatialMult[r];
      const ia = reachIa[r];
      const sVal = reachS[r];
      const cumRunoffMm = cumRainLocal > ia ? ((cumRainLocal - ia) ** 2) / (cumRainLocal - ia + sVal) : 0;
      const dRunoffMm = Math.max(0, cumRunoffMm - prevCumRunoffMm[r]);
      prevCumRunoffMm[r] = cumRunoffMm;

      if (reach.insideNagariFrac > 0.05) {
        areaWeightedRunoff += cumRunoffMm * reach.localAreaKm2;
        totalInsideArea += reach.localAreaKm2;
      }

      // Convert incremental runoff depth (mm) over local sub-catchment (km²) into m³/s
      const rawLatQ = (dRunoffMm * 1e-3 * (reach.localAreaKm2 * 1e6)) / dtSec;
      const alpha = reachHillAlpha[r];
      hillStoreQ[r] += alpha * (rawLatQ - hillStoreQ[r]);

      const qIn = qInAccum[r] + hillStoreQ[r];

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

      // Compute debris bulking & hydraulic state on monitor reach (every step) and all reaches (at target step)
      const needFullReach = t === safeTargetStep || r === monitorReachId;
      if (needFullReach) {
        let cv = 0;
        if (debrisMode !== 'clear' && routedSedM3[r] > 1 && qOut > 0.05) {
          // Spread mobilized volume over active storm pulse (~45 min characteristic debris wave)
          const progressScale = Math.min(1, (t + 1) / Math.max(1, safeTargetStep + 1));
          const qSed = (routedSedM3[r] * progressScale) / Math.max(1200, dtSec * 4.5);
          cv = Math.min(0.42, qSed / Math.max(0.1, qOut + qSed));
        }

        const surgeMult = debrisMode === 'surge' ? 1 + surgeDownBoost[r] : 1;
        const qBulk = (qOut / Math.max(0.58, 1 - cv)) * surgeMult;

        if (r === monitorReachId) {
          outletHydrographQ[t] = qOut;
          outletHydrographBulkQ[t] = qBulk;
          if (qBulk > peakOutletQ) peakOutletQ = qBulk;
        }

        if (t === safeTargetStep) {
          const rhoMix = 1000 * (1 - cv) + 2650 * cv;
          // Hyperconcentrated / debris flow increases effective flow resistance
          const nEff = reachManning[r] * (1 + 1.8 * cv);
          const { stageM, topWidthM } = invertSrcStage(qBulk, nEff, reach, stagesM);
          const omega = (rhoMix * 9.81 * qBulk * reach.slope) / Math.max(1.5, topWidthM);

          qWaterSnap[r] = qOut;
          qBulkSnap[r] = qBulk;
          stageNormalSnap[r] = stageM;
          sedimentCvSnap[r] = cv;
          streamPowerSnap[r] = omega;

          // Directional culvert/bridge capacity & upstream backwater impoundment
          const rCross = crossingsByReach[r];
          for (let ci = 0; ci < rCross.length; ci++) {
            const cr = rCross[ci];
            const overrideVal = overrides[cr.id];
            let blkPct: number;
            if (typeof overrideVal === 'number' && Number.isFinite(overrideVal)) {
              blkPct = overrideVal;
            } else if (forceClearedCrossings || params.drainCondition === 'cleared') {
              blkPct = Math.min(15, globalBlkPct);
            } else if (cr.verified) {
              // Respect field-verified structure condition modulated by global blockage control
              const statusFloor =
                cr.status === 'critical'
                  ? 72
                  : cr.status === 'damaged'
                    ? 52
                    : cr.status === 'clogged'
                      ? 60
                      : cr.defaultBlockagePct;
              blkPct = cr.status === 'normal' ? Math.min(globalBlkPct * 0.45, 35) : Math.max(statusFloor, globalBlkPct * 0.85);
            } else {
              blkPct = globalBlkPct;
            }
            const blkFrac = Math.max(0, Math.min(0.94, blkPct / 100));
            const capScale = cr.measuredOpening ? member.capScaleVerified : member.capScaleUnverified;
            const qCapEff = Math.max(0.25, cr.qCapM3s * (1 - blkFrac) * capScale);

            if (qBulk > qCapEff) {
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
              // Under surge mode, woody debris + high Cv at an overloaded crossing emits a localized downstream breach pulse
              if (debrisMode === 'surge' && (cv >= 0.05 || blkFrac >= 0.65) && d >= 0 && d < R) {
                const pulse = Math.min(0.45, 0.16 + cv * 0.8 + blkFrac * 0.18);
                if (pulse > surgeDownBoost[d]) surgeDownBoost[d] = pulse;
              }
            }
          }
          // Propagate attenuated surge pulse one more reach downstream
          if (debrisMode === 'surge' && surgeDownBoost[r] > 0.08 && d >= 0 && d < R) {
            const nextPulse = surgeDownBoost[r] * 0.68;
            if (nextPulse > surgeDownBoost[d]) surgeDownBoost[d] = nextPulse;
          }
        }
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
              backwaterStartLongSnap[u] = 0; // starts right at upstream reach outlet
              const lBwU = Math.max(60, (0.7 * spillHead) / Math.max(0.008, network.reaches[u].slope));
              backwaterLenFracSnap[u] = Math.min(1.0, lBwU / Math.max(40, network.reaches[u].lengthM));
            }
          }
        }
      }
    }
  }

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
    meanRunoffMm: meanRunoffMmSnap
  };
}
