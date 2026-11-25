import type { SimNetworkData, SoilMoisture } from '../types/gis';
import { adjustCnForAntecedent } from './reachRouter.ts';

export interface ChannelHydraulicInput {
  widthM: number;
  widthPreM?: number | null;
  depthM: number;
  slopePct: number;
  catchmentKm2: number;
  soilMoisture: SoilMoisture;
  antecedent5dMm?: number;
  manningN?: number;
  sedimentCv?: number;
}

export interface ChannelHydraulicResult {
  widthM: number;
  widthPreM: number | null;
  widthDeltaM: number | null;
  widthDeltaPct: number | null;
  depthM: number;
  slopePct: number;
  catchmentKm2: number;
  bankfullVelocityMs: number;
  bankfullDischargeM3s: number;
  overflowRainMmHr: number;
  overflowRange: [number, number];
  wideningRainMmHr: number;
  wideningRange: [number, number];
  severeScourRainMmHr: number;
  severeScourRange: [number, number];
}

/**
 * Look up true DEMNAS-derived upstream catchment area (km²) and average slope (%)
 * for a verified waterway from the topological reach network instead of using hardcoded defaults.
 */
export function resolveWaterwayCatchmentFromNetwork(
  waterwayId: string,
  network: SimNetworkData | null | undefined,
  fallbackKind: string
): { catchmentKm2: number; slopePct: number | null; fromDemNetwork: boolean } {
  if (network?.reaches?.length) {
    let maxArea = 0;
    let weightedSlope = 0;
    let totalLen = 0;
    for (const r of network.reaches) {
      if (r.verifiedWaterwayId === waterwayId) {
        if (r.upstreamAreaKm2 > maxArea) maxArea = r.upstreamAreaKm2;
        weightedSlope += r.slope * 100 * r.lengthM;
        totalLen += r.lengthM;
      }
    }
    if (maxArea > 0.05) {
      return {
        catchmentKm2: Number(maxArea.toFixed(2)),
        slopePct: totalLen > 0 ? Number((weightedSlope / totalLen).toFixed(1)) : null,
        fromDemNetwork: true
      };
    }
  }
  return {
    catchmentKm2: fallbackKind === 'river' ? 3.8 : 1.4,
    slopePct: null,
    fromDemNetwork: false
  };
}

export function estimateChannelThresholds(input: ChannelHydraulicInput): ChannelHydraulicResult {
  const widthM = Math.max(0.5, Math.min(120, Number(input.widthM) || 4));
  const widthPreM =
    input.widthPreM !== null && input.widthPreM !== undefined && Number(input.widthPreM) > 0
      ? Math.max(0.5, Math.min(120, Number(input.widthPreM)))
      : null;
  const depthM = Math.max(0.2, Math.min(20, Number(input.depthM) || 1.2));
  const slopePct = Math.max(0.5, Math.min(35, Number(input.slopePct) || 4));
  const catchmentKm2 = Math.max(0.1, Math.min(80, Number(input.catchmentKm2) || 2.8));
  const cv = Math.max(0, Math.min(0.4, Number(input.sedimentCv) || 0));
  const manningN = Math.max(0.02, Math.min(0.14, (Number(input.manningN) || 0.045) * (1 + 1.8 * cv)));

  let runoffCoeff: number;
  if (typeof input.antecedent5dMm === 'number' && Number.isFinite(input.antecedent5dMm)) {
    // Derive effective runoff ratio directly from continuous SCS-CN antecedent state
    const cn = adjustCnForAntecedent(74, input.antecedent5dMm, 0);
    runoffCoeff = Math.max(0.25, Math.min(0.86, (cn - 35) / 68));
  } else {
    runoffCoeff =
      input.soilMoisture === 'dry' ? 0.34 : input.soilMoisture === 'saturated' ? 0.76 : 0.54;
  }

  const areaCs = widthM * depthM;
  const wettedP = widthM + 2 * depthM;
  const rh = areaCs / Math.max(0.1, wettedP);
  const slopeFrac = slopePct / 100;

  const bankfullVelocityMs = (1 / manningN) * Math.pow(rh, 2 / 3) * Math.sqrt(slopeFrac);
  const bankfullDischargeM3s = areaCs * bankfullVelocityMs;

  // Specific stream power omega = rho_m * g * Q * S / W
  // 300 W/m2 = active bank erosion & widening threshold; 1000 W/m2 = severe galodo scour
  const rhoG = (1000 * (1 - cv) + 2650 * cv) * 9.81;
  const qWidenM3s = (300 * widthM) / (rhoG * slopeFrac);
  const qSevereM3s = (1000 * widthM) / (rhoG * slopeFrac);

  // Account for debris bulking reducing the clear-water rain required to reach Q_bulk
  const bulkFactor = 1 / Math.max(0.6, 1 - cv);
  const qToRainMmHr = (q: number) => (3.6 * q) / (runoffCoeff * catchmentKm2 * bulkFactor);

  const overflowRainMmHr = qToRainMmHr(bankfullDischargeM3s);
  const wideningRainMmHr = qToRainMmHr(Math.max(qWidenM3s, bankfullDischargeM3s * 0.85));
  const severeScourRainMmHr = qToRainMmHr(Math.max(qSevereM3s, bankfullDischargeM3s * 1.45));

  const makeRange = (val: number): [number, number] => [
    Math.max(5, Math.round(val * 0.75)),
    Math.max(8, Math.round(val * 1.25))
  ];

  const widthDeltaM = widthPreM !== null ? Number((widthM - widthPreM).toFixed(2)) : null;
  const widthDeltaPct =
    widthPreM !== null && widthPreM > 0 ? Number((((widthM - widthPreM) / widthPreM) * 100).toFixed(1)) : null;

  return {
    widthM: Number(widthM.toFixed(2)),
    widthPreM: widthPreM !== null ? Number(widthPreM.toFixed(2)) : null,
    widthDeltaM,
    widthDeltaPct,
    depthM: Number(depthM.toFixed(2)),
    slopePct: Number(slopePct.toFixed(1)),
    catchmentKm2: Number(catchmentKm2.toFixed(2)),
    bankfullVelocityMs: Number(bankfullVelocityMs.toFixed(2)),
    bankfullDischargeM3s: Number(bankfullDischargeM3s.toFixed(1)),
    overflowRainMmHr: Number(overflowRainMmHr.toFixed(1)),
    overflowRange: makeRange(overflowRainMmHr),
    wideningRainMmHr: Number(wideningRainMmHr.toFixed(1)),
    wideningRange: makeRange(wideningRainMmHr),
    severeScourRainMmHr: Number(severeScourRainMmHr.toFixed(1)),
    severeScourRange: makeRange(severeScourRainMmHr)
  };
}
