import { resolveSoilProfile, SOIL_PROFILES } from '../data/soilProfiles.ts';
import type { CascadeSimParams, SimFieldsData } from '../types/gis';
import {
  computeSpatialRainFactor,
  resolveAntecedent5dMm,
  type EnsembleMemberConfig,
  type HyetographStep
} from './reachRouter.ts';

export interface SlopeStabilityInputs {
  fields: SimFieldsData;
  elevM: Uint16Array | null;
  slopePct: Uint8Array;
  twi: Uint8Array | null;
  curvature: Uint8Array | null;
  soilDepthCm: Uint8Array | null;
  geologyFactor: Uint8Array | null;
  soilErodibility: Uint8Array | null;
  rootCohesion: Uint8Array;
  isForest: Uint8Array;
  uplandWeight: Uint8Array;
  reachId: Uint16Array | null;
  nagariMask: Uint8Array | null;
  params: CascadeSimParams;
  hyetographSteps: HyetographStep[];
  targetStepIdx: number;
  reachSmaFillSeries?: Float32Array | null;
  cumRainMm: number;
  cellAreaM2: number;
}

export interface SlopeStabilityResult {
  fosP50: Float32Array;
  landslideRiskGrid: Float32Array; // 0..1 instability intensity (strictly leakage-free: zero officialLandslide bias!)
  landslideProbGrid: Float32Array; // 0..1 3-scenario deterministic sensitivity agreement index (not a calibrated probability)
  landslideRunoutGrid: Float32Array; // 0..1 indicative ~20 deg geometric downslope runout shadow
  reachSedimentSupplyM3: Float32Array;
  checkpointSteps: number[];
  cumSedM3ByCheckpoint: Float32Array[]; // Causal cumulative mobilized hillslope sediment (m³) per storm checkpoint
  landslideCellsP10: number; // Low sensitivity scenario cell count
  landslideCellsP50: number; // Central scenario cell count
  landslideCellsP90: number; // High sensitivity scenario cell count
  runoutCells: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-6, e1 - e0)));
  return t * t * (3 - 2 * t);
}

function invSmoothstep(lo: number, hi: number, x: number): number {
  // Returns 1 when x <= lo, smoothly dropping to 0 when x >= hi
  return 1 - smoothstep(lo, hi, x);
}

/**
 * Physically based, leakage-free Infinite-Slope Factor of Safety (SHALSTAB / TRIGRS-lite):
 *
 *   FoS(x,y,t) = (c_soil * geo + c_root) / (gamma_s * Z * sin(b) * cos(b))
 *              + (tan(phi') / tan(b)) * max(0.12, 1 - m(t) * (gamma_w / gamma_s))
 *
 * Strictly EXCLUDES Pemkab Agam officialLandslide polygons so they serve as an honest,
 * independent validation benchmark. Aggregates mobilized shallow-slide volume into
 * each cell's exact draining reach for coupled debris-flow (galodo) bulking.
 */
export function evaluateSlopeStability(
  input: SlopeStabilityInputs,
  nominalMember: EnsembleMemberConfig,
  conservativeMember: EnsembleMemberConfig,
  optimisticMember: EnsembleMemberConfig,
  reachCount: number
): SlopeStabilityResult {
  const {
    fields,
    elevM,
    slopePct,
    twi,
    curvature,
    soilDepthCm,
    geologyFactor,
    soilErodibility,
    rootCohesion,
    isForest,
    uplandWeight,
    reachId,
    nagariMask,
    params,
    hyetographSteps,
    targetStepIdx,
    reachSmaFillSeries = null,
    cumRainMm,
    cellAreaM2
  } = input;

  const { width, height, bbox, minElev } = fields;
  const n = width * height;
  const fosP50 = new Float32Array(n).fill(3.0);
  const landslideRiskGrid = new Float32Array(n);
  const landslideProbGrid = new Float32Array(n);
  const landslideRunoutGrid = new Float32Array(n);
  const safeReachCount = Math.max(1, reachCount);
  const reachSedimentSupplyM3 = new Float32Array(safeReachCount);

  // Storm-intrinsic causal checkpoints (never depend on playback targetStepIdx)
  const T = Math.max(1, hyetographSteps.length);
  const safeTargetStep = Math.max(0, Math.min(T - 1, targetStepIdx));
  const targetCpCount = Math.min(T, 10);
  const checkpointSet = new Set<number>();
  for (let k = 0; k < targetCpCount; k++) {
    const idx = targetCpCount === 1 ? 0 : Math.round((k / (targetCpCount - 1)) * (T - 1));
    checkpointSet.add(idx);
  }
  const checkpointSteps = Array.from(checkpointSet).sort((a, b) => a - b);
  const K = checkpointSteps.length;
  const cumSedM3ByCheckpoint = checkpointSteps.map(() => new Float32Array(safeReachCount));
  const cpProgArr = new Float64Array(K);
  const cpRampArr = new Float64Array(K);
  const cpCumRainArr = new Float64Array(K);
  const cpInstRainArr = new Float64Array(K);
  const cpElapsedHrArr = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const sIdx = checkpointSteps[k];
    const cpProg = T > 1 ? sIdx / (T - 1) : 1;
    cpProgArr[k] = cpProg;
    cpRampArr[k] = smoothstep(0.06, 0.35, cpProg);
    cpCumRainArr[k] = hyetographSteps[sIdx]?.cumRainMm ?? cumRainMm;
    cpInstRainArr[k] = hyetographSteps[sIdx]?.rainMmHr ?? params.rainMmHr;
    cpElapsedHrArr[k] = (hyetographSteps[sIdx]?.timeMin ?? 0) / 60;
  }

  const antecedent5d = resolveAntecedent5dMm(params);
  const calCohesion = params.calibrationProfile?.cohesionMult ?? 1.0;
  const dLng = (bbox.east - bbox.west) / width;
  const dLat = (bbox.north - bbox.south) / height;

  // Base antecedent wetness factor driven by continuous 5-day antecedent rainfall P5 (mm)
  const p5Frac = Math.min(1, antecedent5d / 190);
  const baseWetness = 0.05 + 0.45 * Math.pow(p5Frac, 0.92);
  const stormRamp = smoothstep(0.06, 0.35, params.progress);
  const elapsedHr = Math.max(0, (params.durationMin / 60) * Math.min(1, params.progress * 1.15));
  const targetInstRain = hyetographSteps[safeTargetStep]?.rainMmHr ?? params.rainMmHr;

  let landslideCellsP10 = 0;
  let landslideCellsP50 = 0;
  let landslideCellsP90 = 0;

  const evalCellFos = (
    tanB: number,
    sinCosB: number,
    zBaseM: number,
    gammaS: number,
    cBaseKpa: number,
    phiBaseDeg: number,
    mBase: number,
    mem: EnsembleMemberConfig
  ): number => {
    const zM = Math.max(0.25, zBaseM * mem.soilDepthScale);
    const cEff = Math.max(0.8, cBaseKpa * calCohesion * mem.cohesionScale);
    const phiRad = ((phiBaseDeg + mem.phiDeltaDeg) * Math.PI) / 180;
    const mEff = Math.max(0, Math.min(1.0, mBase / Math.sqrt(Math.max(0.5, mem.ksMult))));
    const cohesTerm = cEff / Math.max(0.5, gammaS * zM * sinCosB);
    const fricTerm = (Math.tan(phiRad) / Math.max(0.05, tanB)) * Math.max(0.12, 1 - mEff * (9.81 / gammaS));
    return cohesTerm + fricTerm;
  };

  for (let r = 0; r < height; r++) {
    const lat = bbox.north - (r + 0.5) * dLat;
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (nagariMask && nagariMask[i] === 0) continue;

      const sl = slopePct[i];
      if (sl < 10) continue; // Flat valley floors are unconditionally stable against shallow sliding

      const tanB = sl / 100;
      const sinCosB = tanB / (1 + tanB * tanB);

      const defaultSoil = resolveSoilProfile(params.soilProfile);
      const cellSoil = soilErodibility
        ? soilErodibility[i] >= 200
          ? SOIL_PROFILES.volcanic_andosol
          : SOIL_PROFILES.cambisol_loam
        : defaultSoil;
      const gammaS = cellSoil.gammaS;

      const geoMult = geologyFactor ? geologyFactor[i] / 100 : 1.0;
      const isIntactBedrock = geoMult >= 1.03;
      const phiBaseDeg = cellSoil.phiDeg + (geoMult - 0.98) * 32;

      let zBaseM = soilDepthCm ? Math.max(0.32, soilDepthCm[i] / 100) : cellSoil.defaultDepthM;
      if (isIntactBedrock && sl > 42) {
        zBaseM = Math.max(0.32, zBaseM * Math.max(0.45, 1 - ((sl - 42) / 60) * 0.55));
      }

      const cSoilKpa = cellSoil.cSoilKpa * Math.pow(geoMult, 2.6);
      const anchorBonus = zBaseM < 0.9 ? 1 + (0.9 - zBaseM) * 1.15 : 1.0;
      let cRootKpa = (0.35 + (rootCohesion[i] / 255) * 4.4) * anchorBonus;
      const isUpForest = isForest[i] === 1 && uplandWeight[i] >= 115;
      if (isUpForest) {
        if (params.forestScenario === 'degraded30') cRootKpa *= 0.55;
        else if (params.forestScenario === 'degraded50') cRootKpa *= 0.3;
      }
      const cBaseKpa = cSoilKpa + cRootKpa;

      const twiVal = twi ? 2 + (twi[i] / 255) * 16 : 7.5;
      const twiBoost = 0.65 + 0.68 * smoothstep(5.0, 12.2, twiVal);
      const curvNorm = curvature ? (curvature[i] - 128) / 120 : 0; // <0 = convergent hollow
      const hollowBoost = Math.max(0.78, Math.min(1.3, 1 - curvNorm * 0.28));

      const lng = bbox.west + (c + 0.5) * dLng;
      const cellElev = elevM ? elevM[i] : minElev + (uplandWeight[i] / 255) * 1400;
      const spatialMult = computeSpatialRainFactor(cellElev, minElev, uplandWeight[i] / 255, [lng, lat], params);

      const kLatMmHr = cellSoil.kLatMmHr / Math.max(0.75, twiBoost * 0.92);
      const infilStorageMm = Math.max(70, zBaseM * cellSoil.drainablePorosityMmPerM);
      const p5DrainMult = Math.min(1.05, 0.5 + (1 - p5Frac) * 0.45);
      const rid = reachId ? reachId[i] : 65535;
      const hasValidReach = Boolean(reachSmaFillSeries && rid < reachCount);

      const evalWetnessAt = (
        cumRain: number,
        instRain: number,
        elHr: number,
        smaFill: number,
        rainScale: number
      ): number => {
        const scaledCumRain = cumRain * spatialMult * rainScale;
        const latDrainMm = Math.min(infilStorageMm * 0.32, kLatMmHr * elHr * p5DrainMult);
        const netAccum = Math.max(0, scaledCumRain - latDrainMm);
        const prolongedSat = smoothstep(130, 270, scaledCumRain);
        const effRate = Math.max(instRain, params.rainMmHr * 0.5) * rainScale;
        const scaledRateRatio = Math.min(1.4, Math.max(0.28, effRate / 35));
        const rateEff = Math.max(0.64 + 0.36 * scaledRateRatio, prolongedSat);
        // Unify hillslope pore pressure with dynamic reach SMA soil-moisture fullness F(t)/S
        const scaledSma = Math.max(0, Math.min(1, smaFill * (0.85 + 0.15 * rainScale)));
        const unifiedBase = hasValidReach ? baseWetness * 0.48 + scaledSma * 0.52 : baseWetness;
        const stormDelta = Math.min(0.98, (netAccum / infilStorageMm) * twiBoost * hollowBoost * rateEff);
        const smaStormBoost = hasValidReach ? 0.78 + 0.22 * scaledSma : 1.0;
        return Math.min(1.0, unifiedBase * twiBoost * 0.72 + stormDelta * smaStormBoost);
      };

      const targetSma = hasValidReach
        ? reachSmaFillSeries![safeTargetStep * reachCount + rid]
        : baseWetness;
      const mBase = evalWetnessAt(cumRainMm, targetInstRain, elapsedHr, targetSma, nominalMember.rainScale);
      const fosNom = evalCellFos(tanB, sinCosB, zBaseM, gammaS, cBaseKpa, phiBaseDeg, mBase, nominalMember);
      fosP50[i] = Number(Math.min(5.0, fosNom).toFixed(2));

      if (sl < 20) continue; // Only steep slopes (>=20%) contribute to shallow landslide failure & debris yield

      const mCons = evalWetnessAt(cumRainMm, targetInstRain, elapsedHr, targetSma, conservativeMember.rainScale);
      const mOpt = evalWetnessAt(cumRainMm, targetInstRain, elapsedHr, targetSma, optimisticMember.rainScale);
      const fosCons = evalCellFos(tanB, sinCosB, zBaseM, gammaS, cBaseKpa, phiBaseDeg, mCons, conservativeMember);
      const fosOpt = evalCellFos(tanB, sinCosB, zBaseM, gammaS, cBaseKpa, phiBaseDeg, mOpt, optimisticMember);

      // Smooth instability risk index (0..1) centered around FoS = 1.0 (higher when FoS drops below 1.18)
      const riskNom = invSmoothstep(0.76, 1.18, fosNom) * stormRamp;
      const riskCons = invSmoothstep(0.76, 1.18, fosCons) * stormRamp;
      const riskOpt = invSmoothstep(0.76, 1.18, fosOpt) * stormRamp;

      if (riskNom > 0.06) landslideRiskGrid[i] = riskNom;

      // 3-scenario deterministic sensitivity agreement index across low/central/high geotech bounds
      const failScore =
        (fosOpt < 1.05 ? 0.34 : 0) +
        (fosNom < 1.05 ? 0.36 : 0) +
        (fosCons < 1.05 ? 0.3 : 0);
      landslideProbGrid[i] = failScore * stormRamp;

      if (riskOpt >= 0.28) landslideCellsP10++;
      if (riskNom >= 0.28) landslideCellsP50++;
      if (riskCons >= 0.28) landslideCellsP90++;

      // Couple failing hillslopes causally into their downstream D8 reach sediment supply
      if (reachId && rid < reachCount) {
        const deliveryEfficiency = 0.06 + 0.12 * smoothstep(24, 50, sl);
        const baseCellVol = cellAreaM2 * zBaseM * deliveryEfficiency;
        if (fosNom < 1.12 && stormRamp > 0.05) {
          const mobFrac = invSmoothstep(0.72, 1.12, fosNom) * stormRamp;
          reachSedimentSupplyM3[rid] += baseCellVol * mobFrac;
        }

        // Precompute fast, strictly causal cumulative sediment trajectory across storm checkpoints
        const zNom = Math.max(0.25, zBaseM * nominalMember.soilDepthScale);
        const cNom = Math.max(0.8, cBaseKpa * calCohesion * nominalMember.cohesionScale);
        const phiRadNom = ((phiBaseDeg + nominalMember.phiDeltaDeg) * Math.PI) / 180;
        const cohesTermNom = cNom / Math.max(0.5, gammaS * zNom * sinCosB);
        const fricSlopeNom = Math.tan(phiRadNom) / Math.max(0.05, tanB);
        const ksScaleNom = Math.sqrt(Math.max(0.5, nominalMember.ksMult));
        const gammaRatio = 9.81 / gammaS;

        let cellPeakMob = 0;
        for (let k = 0; k < K; k++) {
          const cpRamp = cpRampArr[k];
          if (cpRamp > 0.05) {
            const cpSma = hasValidReach
              ? reachSmaFillSeries![checkpointSteps[k] * reachCount + rid]
              : baseWetness;
            const mCp = evalWetnessAt(
              cpCumRainArr[k],
              cpInstRainArr[k],
              cpElapsedHrArr[k],
              cpSma,
              nominalMember.rainScale
            );
            const mEffCp = Math.max(0, Math.min(1.0, mCp / ksScaleNom));
            const fosCp = cohesTermNom + fricSlopeNom * Math.max(0.12, 1 - mEffCp * gammaRatio);
            if (fosCp < 1.12) {
              const mobCp = invSmoothstep(0.72, 1.12, fosCp) * cpRamp;
              if (mobCp > cellPeakMob) cellPeakMob = mobCp;
            }
          }
          if (cellPeakMob > 0) {
            cumSedM3ByCheckpoint[k][rid] += baseCellVol * cellPeakMob;
          }
        }
      }
    }
  }

  // Indicative ~20 deg geometric downslope runout shadow (tan(20°) ≈ 0.364) from initiating slopes
  const cellX = Math.max(5, fields.cellSizeX || 33);
  const cellY = Math.max(5, fields.cellSizeY || 33);
  const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1];
  const stepDistArr = dx.map((gx, k) => Math.hypot(gx * cellX, dy[k] * cellY));
  const elevAt = (idx: number) => (elevM ? elevM[idx] : minElev + (uplandWeight[idx] / 255) * 1400);

  for (let i = 0; i < n; i++) {
    const riskNom = landslideRiskGrid[i];
    if (riskNom < 0.28) continue;
    const startElev = elevAt(i);
    let cur = i;
    let curElev = startElev;
    let distM = 0;
    for (let step = 1; step <= 10; step++) {
      const cr = Math.floor(cur / width);
      const cc = cur - cr * width;
      let bestNi = -1;
      let bestGrad = 0;
      let bestDist = cellX;
      let bestElev = curElev;
      for (let k = 0; k < 8; k++) {
        const nr = cr + dy[k];
        const nc = cc + dx[k];
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
        const ni = nr * width + nc;
        const nElev = elevAt(ni);
        const drop = curElev - nElev;
        if (drop <= 0) continue;
        const grad = drop / stepDistArr[k];
        if (grad > bestGrad) {
          bestGrad = grad;
          bestNi = ni;
          bestDist = stepDistArr[k];
          bestElev = nElev;
        }
      }
      if (bestNi < 0) break;
      if (nagariMask && nagariMask[bestNi] === 0) break;
      distM += bestDist;
      const reachRatio = (startElev - bestElev) / Math.max(1, distM);
      if (reachRatio < 0.364) break;
      const shadowVal = riskNom * Math.max(0.25, 1 - step / 11);
      if (shadowVal > landslideRunoutGrid[bestNi]) {
        landslideRunoutGrid[bestNi] = shadowVal;
      }
      cur = bestNi;
      curElev = bestElev;
    }
  }

  let runoutCells = 0;
  for (let i = 0; i < n; i++) {
    if (landslideRiskGrid[i] >= 0.18) {
      landslideRunoutGrid[i] = 0;
    } else if (landslideRunoutGrid[i] >= 0.22) {
      runoutCells++;
    }
  }

  return {
    fosP50,
    landslideRiskGrid,
    landslideProbGrid,
    landslideRunoutGrid,
    reachSedimentSupplyM3,
    checkpointSteps,
    cumSedM3ByCheckpoint,
    landslideCellsP10,
    landslideCellsP50,
    landslideCellsP90,
    runoutCells
  };
}
