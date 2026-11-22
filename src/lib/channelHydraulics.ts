import type { SoilMoisture } from '../types/gis';

export interface ChannelHydraulicInput {
  widthM: number;
  widthPreM?: number | null;
  depthM: number;
  slopePct: number;
  catchmentKm2: number;
  soilMoisture: SoilMoisture;
  manningN?: number;
}

export interface ChannelHydraulicResult {
  widthM: number;
  widthPreM: number | null;
  widthDeltaM: number | null;
  widthDeltaPct: number | null;
  depthM: number;
  slopePct: number;
  bankfullVelocityMs: number;
  bankfullDischargeM3s: number;
  overflowRainMmHr: number;
  overflowRange: [number, number];
  wideningRainMmHr: number;
  wideningRange: [number, number];
  severeScourRainMmHr: number;
  severeScourRange: [number, number];
}

export function estimateChannelThresholds(input: ChannelHydraulicInput): ChannelHydraulicResult {
  const widthM = Math.max(0.5, Math.min(120, Number(input.widthM) || 4));
  const widthPreM =
    input.widthPreM !== null && input.widthPreM !== undefined && Number(input.widthPreM) > 0
      ? Math.max(0.5, Math.min(120, Number(input.widthPreM)))
      : null;
  const depthM = Math.max(0.2, Math.min(20, Number(input.depthM) || 1.2));
  const slopePct = Math.max(0.5, Math.min(35, Number(input.slopePct) || 4));
  const catchmentKm2 = Math.max(0.2, Math.min(25, Number(input.catchmentKm2) || 2.8));
  const manningN = Math.max(0.02, Math.min(0.12, Number(input.manningN) || 0.045));

  const runoffCoeff =
    input.soilMoisture === 'dry' ? 0.34 : input.soilMoisture === 'saturated' ? 0.76 : 0.54;

  const areaCs = widthM * depthM;
  const wettedP = widthM + 2 * depthM;
  const rh = areaCs / Math.max(0.1, wettedP);
  const slopeFrac = slopePct / 100;

  const bankfullVelocityMs = (1 / manningN) * Math.pow(rh, 2 / 3) * Math.sqrt(slopeFrac);
  const bankfullDischargeM3s = areaCs * bankfullVelocityMs;

  // Specific stream power omega = rho * g * Q * S / W (rho*g = 9810 N/m3)
  // 300 W/m2 = active bank erosion & widening threshold; 1000 W/m2 = severe galodo scour
  const qWidenM3s = (300 * widthM) / (9810 * slopeFrac);
  const qSevereM3s = (1000 * widthM) / (9810 * slopeFrac);

  const qToRainMmHr = (q: number) => (3.6 * q) / (runoffCoeff * catchmentKm2);

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
