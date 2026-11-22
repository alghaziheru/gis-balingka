import type {
  CascadeAlertLevel,
  CascadeKpis,
  CascadeSimParams,
  GeoFeatureCollection,
  SimFieldsData
} from '../types/gis';

function decodeBase64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeUint16(b64: string, expectedLen: number): Uint16Array {
  const bytes = decodeBase64Bytes(b64);
  return new Uint16Array(bytes.buffer, bytes.byteOffset, Math.min(expectedLen, Math.floor(bytes.byteLength / 2)));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-6, e1 - e0)));
  return t * t * (3 - 2 * t);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function sampleBilinear(grid: Float32Array, w: number, h: number, xf: number, yf: number): number {
  const x = Math.max(0, Math.min(w - 1.0001, xf));
  const y = Math.max(0, Math.min(h - 1.0001, yf));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = grid[y0 * w + x0] * (1 - tx) + grid[y0 * w + x1] * tx;
  const bot = grid[y1 * w + x0] * (1 - tx) + grid[y1 * w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

export function extractBuildingCentroids(settlements: GeoFeatureCollection | null | undefined): [number, number][] {
  if (!settlements?.features) return [];
  const pts: [number, number][] = [];
  for (const f of settlements.features) {
    if (f.properties?.kind !== 'building' || f.geometry?.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0];
    if (!ring || ring.length < 3) continue;
    const len = ring.length > 1 ? ring.length - 1 : ring.length;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < len; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    pts.push([sx / len, sy / len]);
  }
  return pts;
}

export class CascadeEngine {
  readonly fields: SimFieldsData;
  private readonly n: number;
  private readonly cellHa: number;
  private readonly totalCrossings: number;
  private readonly handDm: Uint16Array;
  private readonly slopePct: Uint8Array;
  private readonly accNorm: Uint8Array;
  private readonly travelTimeTenthMin: Uint16Array;
  private readonly cnBase: Uint8Array;
  private readonly rootCohesion: Uint8Array;
  private readonly isForest: Uint8Array;
  private readonly uplandWeight: Uint8Array;
  private readonly uplandAccRatio: Uint8Array;
  private readonly bottleneckProx: Uint8Array;
  private readonly soilErodibility: Uint8Array | null;
  private readonly officialLandslide: Uint8Array | null;
  private readonly nagariMask: Uint8Array | null;
  private readonly buildingCells: Int32Array;
  private readonly floodDepthGrid: Float32Array;
  private readonly landslideRiskGrid: Float32Array;

  constructor(fields: SimFieldsData, buildingCentroids: [number, number][] = [], totalCrossings = 34) {
    this.fields = fields;
    this.n = fields.width * fields.height;
    this.cellHa = (fields.cellSizeX * fields.cellSizeY) / 10000;
    this.totalCrossings = totalCrossings;

    this.handDm = decodeUint16(fields.handDmBase64, this.n);
    this.slopePct = decodeBase64Bytes(fields.slopePctBase64);
    this.accNorm = decodeBase64Bytes(fields.accNormBase64);
    this.travelTimeTenthMin = decodeUint16(fields.travelTimeTenthMinBase64, this.n);
    this.cnBase = decodeBase64Bytes(fields.cnBaseBase64);
    this.rootCohesion = decodeBase64Bytes(fields.rootCohesionBase64);
    this.isForest = decodeBase64Bytes(fields.isForestBase64);
    this.uplandWeight = decodeBase64Bytes(fields.uplandWeightBase64);
    this.uplandAccRatio = decodeBase64Bytes(fields.uplandAccRatioBase64);
    this.bottleneckProx = decodeBase64Bytes(fields.bottleneckProxBase64);
    this.soilErodibility = fields.soilErodibilityBase64 ? decodeBase64Bytes(fields.soilErodibilityBase64) : null;
    this.officialLandslide = fields.officialLandslideBase64 ? decodeBase64Bytes(fields.officialLandslideBase64) : null;
    this.nagariMask = fields.nagariMaskBase64 ? decodeBase64Bytes(fields.nagariMaskBase64) : null;

    const { width, height, bbox } = fields;
    const mapped: number[] = [];
    for (let i = 0; i < buildingCentroids.length; i++) {
      const [lng, lat] = buildingCentroids[i];
      if (lng < bbox.west || lng > bbox.east || lat < bbox.south || lat > bbox.north) continue;
      const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
      const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
      mapped.push(row * width + col);
    }
    this.buildingCells = new Int32Array(mapped);
    this.floodDepthGrid = new Float32Array(this.n);
    this.landslideRiskGrid = new Float32Array(this.n);
  }

  evaluate(params: CascadeSimParams): CascadeKpis {
    const p = Math.max(0, Math.min(1, params.progress));
    const elapsedMin = params.durationMin * p;
    const accumulatedMm = params.rainMmHr * (elapsedMin / 60);

    if (p <= 0.02) {
      this.floodDepthGrid.fill(0);
      this.landslideRiskGrid.fill(0);
      return {
        stage: 0,
        alertLevel: 'normal',
        elapsedMin,
        accumulatedMm,
        effectiveRunoffMm: 0,
        floodAreaHa: 0,
        landslideAreaHa: 0,
        affectedBuildingsFlood: 0,
        affectedBuildingsLandslide: 0,
        chokeCount: 0,
        reductionPct: 0,
        peakTravelMin: this.fields.p90TravelMin,
        runoffIndex: 0,
        officialLandslideOverlapPct: 0
      };
    }

    const stage: 0 | 1 | 2 | 3 | 4 = p <= 0.25 ? 1 : p <= 0.55 ? 2 : p <= 0.82 ? 3 : 4;
    const refTravel = Math.max(18, this.fields.p90TravelMin);
    const waveFrontMin = Math.max(elapsedMin, p * refTravel * 1.32);

    const isSaturated = params.soilMoisture === 'saturated';
    const isDry = params.soilMoisture === 'dry';
    const amcSat = isDry ? 0.12 : params.soilMoisture === 'moist' ? 0.36 : 0.68;
    const intensityBoost = 0.75 + (params.rainMmHr / 150) * 0.55;
    const surgeWave =
      params.drainCondition === 'surge' && p > 0.42 ? 0.32 * smoothstep(0.42, 0.72, p) : 0;

    // Upland effective rainfall & CN for routed channel supply
    const cnUplandBase =
      params.forestScenario === 'degraded50' ? 84 : params.forestScenario === 'degraded30' ? 78 : 70;
    const cnUpland = isDry
      ? (4.2 * cnUplandBase) / (10 - 0.058 * cnUplandBase)
      : isSaturated
      ? (23 * cnUplandBase) / (10 + 0.13 * cnUplandBase)
      : cnUplandBase;
    const sUpland = Math.max(5, 25400 / Math.max(30, Math.min(98, cnUpland)) - 254);
    const iaUpland = 0.2 * sUpland;
    const pUpland = accumulatedMm * (params.rainPattern === 'upland' ? 1.35 : 1.05);
    const qUpland = pUpland > iaUpland ? (pUpland - iaUpland) ** 2 / (pUpland - iaUpland + sUpland) : 0;

    let floodCells = 0;
    let clearedCompareCells = 0;
    let cloggedCompareCells = 0;
    let landslideCells = 0;
    let lsModelHigh = 0;
    let lsMatchedOfficial = 0;
    let sumRunoff = 0;

    let insideCells = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.nagariMask && this.nagariMask[i] === 0) {
        this.floodDepthGrid[i] = 0;
        this.landslideRiskGrid[i] = 0;
        continue;
      }
      insideCells++;
      const cellTc = this.travelTimeTenthMin[i] * 0.1;
      const wave = smoothstep(cellTc - 4, cellTc + 10, waveFrontMin);

      const uw = this.uplandWeight[i] / 255;
      const isUpForest = this.isForest[i] === 1 && this.uplandWeight[i] >= 115;

      let cn2 = this.cnBase[i];
      if (isUpForest) {
        if (params.forestScenario === 'degraded30') cn2 = Math.min(92, cn2 + 8);
        else if (params.forestScenario === 'degraded50') cn2 = Math.min(94, cn2 + 14);
      }
      const cn = isDry
        ? (4.2 * cn2) / (10 - 0.058 * cn2)
        : isSaturated
        ? (23 * cn2) / (10 + 0.13 * cn2)
        : cn2;
      const sVal = Math.max(5, 25400 / Math.max(30, Math.min(98, cn)) - 254);
      const ia = 0.2 * sVal;

      const localRainFactor =
        params.rainPattern === 'upland' ? 0.18 + 1.25 * smoothstep(0.32, 0.78, uw) : 1.0;
      const pLocal = accumulatedMm * localRainFactor;
      const qLocal = pLocal > ia ? (pLocal - ia) ** 2 / (pLocal - ia + sVal) : 0;

      const upRatio = this.uplandAccRatio[i] / 255;
      const accN = this.accNorm[i] / 255;
      const qRouted =
        qLocal * (1 - upRatio * 0.75) + qUpland * (upRatio * 0.75) + qUpland * upRatio * accN * 0.35;
      sumRunoff += qRouted;

      const sl = this.slopePct[i];
      let depth = 0;
      if (sl <= 24 && wave > 0.08 && qRouted > 0.5) {
        const handM = this.handDm[i] * 0.1;
        const accF = 0.45 + accN * 0.85;
        const bProx = this.bottleneckProx[i] / 255;

        const runoffDrive = Math.pow(qRouted / 185, 0.74) * 1.85;
        const basePot = Math.min(3.4, runoffDrive * intensityBoost * accF * wave);
        const clearedPot = basePot * (1 - bProx * 0.58);
        const cloggedPot = basePot * (1 + bProx * 0.45);
        if (clearedPot > handM + 0.16 && (handM > 0 || clearedPot > 0.4)) clearedCompareCells++;
        if (cloggedPot > handM + 0.16 && (handM > 0 || cloggedPot > 0.4)) cloggedCompareCells++;

        const drainMult =
          params.drainCondition === 'cleared'
            ? 1 - bProx * 0.58
            : params.drainCondition === 'clogged'
            ? 1 + bProx * 0.45
            : 1 + bProx * 0.48 + surgeWave * accN;
        const stageM = Math.min(4.0, basePot * drainMult);
        if (stageM > handM + 0.08) {
          depth = stageM - handM;
          if (depth >= 0.15 && (handM > 0 || depth >= 0.4)) floodCells++;
        }
      }
      this.floodDepthGrid[i] = depth;

      let lsRisk = 0;
      if (sl >= 26) {
        const tanTheta = sl / 100;
        let soilStrength = 0.5 + (this.rootCohesion[i] / 255) * 0.48;
        if (isUpForest) {
          if (params.forestScenario === 'degraded30') soilStrength *= 0.82;
          else if (params.forestScenario === 'degraded50') soilStrength *= 0.68;
        }
        const poreIdx = amcSat * 0.45 + Math.min(0.85, (pLocal / 140) * (0.45 + 0.55 * p));
        const soilFactor = this.soilErodibility ? 0.85 + 0.35 * (this.soilErodibility[i] / 255) : 1.0;
        const officialVal = this.officialLandslide ? this.officialLandslide[i] : 0;
        const officialBias = officialVal === 3 ? 1.15 : officialVal === 2 ? 1.04 : officialVal === 1 ? 0.94 : 1.0;
        const instab = (tanTheta * (0.65 + 0.72 * poreIdx) * soilFactor * officialBias) / soilStrength;
        const r = smoothstep(0.92, 1.55, instab) * smoothstep(0.18, 0.45, p);
        if (r > 0.08) {
          lsRisk = r;
          if (r >= 0.25) landslideCells++;
          if (r >= 0.45) {
            lsModelHigh++;
            if (officialVal >= 2) lsMatchedOfficial++;
          }
        }
      }
      this.landslideRiskGrid[i] = lsRisk;
    }

    let affectedBuildingsFlood = 0;
    let affectedBuildingsLandslide = 0;
    for (let i = 0; i < this.buildingCells.length; i++) {
      const idx = this.buildingCells[i];
      if (this.floodDepthGrid[idx] >= 0.18) affectedBuildingsFlood++;
      if (this.landslideRiskGrid[idx] >= 0.25) affectedBuildingsLandslide++;
    }

    const floodAreaHa = Number((floodCells * this.cellHa).toFixed(1));
    const landslideAreaHa = Number((landslideCells * this.cellHa).toFixed(1));
    const effectiveRunoffMm = Number((sumRunoff / Math.max(1, insideCells)).toFixed(1));
    const reductionPct =
      cloggedCompareCells > 0
        ? Math.max(0, Math.round((1 - clearedCompareCells / cloggedCompareCells) * 100))
        : 0;
    const chokeCount =
      params.drainCondition === 'cleared'
        ? Math.round(this.totalCrossings * Math.min(0.25, floodAreaHa / 260))
        : Math.round(this.totalCrossings * Math.min(1, floodAreaHa / 120));
    const runoffIndex = Math.min(100, Math.round((effectiveRunoffMm / 180) * 100));

    let alertLevel: CascadeAlertLevel = 'normal';
    if (
      floodAreaHa >= 125 ||
      landslideAreaHa >= 25 ||
      (params.drainCondition === 'surge' && floodAreaHa >= 100)
    ) {
      alertLevel = 'kritis';
    } else if (floodAreaHa >= 70 || landslideAreaHa >= 15 || affectedBuildingsFlood >= 160) {
      alertLevel = 'siaga';
    } else if (floodAreaHa >= 15 || landslideAreaHa >= 5 || affectedBuildingsFlood >= 20) {
      alertLevel = 'waspada';
    }

    return {
      stage,
      alertLevel,
      elapsedMin,
      accumulatedMm,
      effectiveRunoffMm,
      floodAreaHa,
      landslideAreaHa,
      affectedBuildingsFlood,
      affectedBuildingsLandslide,
      chokeCount,
      reductionPct,
      peakTravelMin: this.fields.p90TravelMin,
      runoffIndex,
      officialLandslideOverlapPct:
        lsModelHigh > 0 ? Math.round((lsMatchedOfficial / lsModelHigh) * 100) : 0
    };
  }

  renderRgba(outSize = 256): { floodRgba: Uint8Array; landslideRgba: Uint8Array } {
    const { width, height } = this.fields;
    const floodRgba = new Uint8Array(outSize * outSize * 4);
    const landslideRgba = new Uint8Array(outSize * outSize * 4);

    for (let y = 0; y < outSize; y++) {
      const yf = (y / Math.max(1, outSize - 1)) * (height - 1);
      for (let x = 0; x < outSize; x++) {
        const xf = (x / Math.max(1, outSize - 1)) * (width - 1);
        const pIdx = (y * outSize + x) * 4;

        const depth = sampleBilinear(this.floodDepthGrid, width, height, xf, yf);
        if (depth > 0.06) {
          const alpha = smoothstep(0.06, 0.35, depth) * 168;
          let r: number;
          let g: number;
          let b: number;
          if (depth <= 0.9) {
            const f = smoothstep(0.12, 0.9, depth);
            r = 125 * (1 - f) + 2 * f;
            g = 211 * (1 - f) + 132 * f;
            b = 252 * (1 - f) + 199 * f;
          } else {
            const f = smoothstep(0.9, 2.2, depth);
            r = 2 * (1 - f) + 3 * f;
            g = 132 * (1 - f) + 105 * f;
            b = 199 * (1 - f) + 161 * f;
          }
          floodRgba[pIdx] = clamp255(r);
          floodRgba[pIdx + 1] = clamp255(g);
          floodRgba[pIdx + 2] = clamp255(b);
          floodRgba[pIdx + 3] = clamp255(alpha);
        }

        const risk = sampleBilinear(this.landslideRiskGrid, width, height, xf, yf);
        if (risk > 0.18) {
          const alpha = smoothstep(0.18, 0.55, risk) * 165;
          const f = smoothstep(0.25, 0.78, risk);
          landslideRgba[pIdx] = clamp255(234 * (1 - f) + 185 * f);
          landslideRgba[pIdx + 1] = clamp255(88 * (1 - f) + 28 * f);
          landslideRgba[pIdx + 2] = clamp255(12 * (1 - f) + 28 * f);
          landslideRgba[pIdx + 3] = clamp255(alpha);
        }
      }
    }

    return { floodRgba, landslideRgba };
  }
}
