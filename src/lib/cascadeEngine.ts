import type {
  CalibrationMarkFeature,
  CalibrationProfile,
  CascadeAlertLevel,
  CascadeKpis,
  CascadeSimParams,
  DataConfidenceLevel,
  GeoFeature,
  GeoFeatureCollection,
  HydrographPoint,
  SimFieldsData,
  ValidationMetrics
} from '../types/gis';
import {
  buildHyetograph,
  RECESSION_MULTIPLIER,
  resolveHyetograph,
  routeReachNetwork,
  SIGMA_ENSEMBLE_MEMBERS,
  type RoutedReachState
} from './reachRouter.ts';
import { evaluateSlopeStability } from './slopeStability.ts';
import { computeValidationMetrics, solveBoundedCalibration } from './validationMetrics.ts';

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

function percentileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, q * (sorted.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const f = idx - lo;
  return sorted[lo] * (1 - f) + sorted[hi] * f;
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

export interface PointSimDiagnostics {
  depthM: number;
  depthP10M: number;
  depthP90M: number;
  agreementPct: number;
  handM: number;
  runoffMm: number;
  bottleneckProx: number;
  insideNagari: boolean;
  dischargeM3s: number;
  upstreamAreaKm2: number;
  sedimentCv: number;
  streamPowerWm2: number;
  fos: number;
  reachId: number;
  reachName: string | null;
  dataConfidence: DataConfidenceLevel;
}

export class CascadeEngine {
  readonly fields: SimFieldsData;
  private readonly n: number;
  private readonly cellHa: number;
  private readonly cellAreaM2: number;
  private readonly totalCrossings: number;

  private readonly elevM: Uint16Array | null;
  private readonly handDm: Uint16Array;
  private readonly slopePct: Uint8Array;
  private readonly accNorm: Uint8Array;
  private readonly travelTimeTenthMin: Uint16Array;
  private readonly rootCohesion: Uint8Array;
  private readonly isForest: Uint8Array;
  private readonly uplandWeight: Uint8Array;
  private readonly twi: Uint8Array | null;
  private readonly curvature: Uint8Array | null;
  private readonly soilDepthCm: Uint8Array | null;
  private readonly geologyFactor: Uint8Array | null;
  private readonly reachId: Uint16Array | null;
  private readonly reachLongFrac: Uint8Array | null;
  private readonly bottleneckProx: Uint8Array;
  private readonly soilErodibility: Uint8Array | null;
  private readonly officialLandslide: Uint8Array | null;
  private readonly scourMask: Uint8Array | null;
  private readonly nagariMask: Uint8Array | null;
  private readonly buildingCells: Int32Array;

  private readonly floodDepthGrid: Float32Array;
  private readonly floodDepthP10Grid: Float32Array;
  private readonly floodDepthP90Grid: Float32Array;
  private readonly floodAgreementGrid: Float32Array; // 0..1 fraction of ensemble members inundating cell
  private readonly landslideRiskGrid: Float32Array;
  private readonly fosGrid: Float32Array;
  private readonly runoffMmGrid: Float32Array;

  private lastRoutedNominal: RoutedReachState | null = null;
  private calibrationMarks: CalibrationMarkFeature[] = [];
  private cachedValidationKey = '';
  private cachedValidation: ValidationMetrics | null = null;

  constructor(
    fields: SimFieldsData,
    buildingCentroids: [number, number][] = [],
    totalCrossings = 34,
    calibrationMarks: CalibrationMarkFeature[] = []
  ) {
    this.fields = fields;
    this.n = fields.width * fields.height;
    this.cellAreaM2 = fields.cellSizeX * fields.cellSizeY;
    this.cellHa = this.cellAreaM2 / 10000;
    this.totalCrossings = totalCrossings;
    this.calibrationMarks = calibrationMarks;

    this.elevM = fields.elevMBase64 ? decodeUint16(fields.elevMBase64, this.n) : null;
    this.handDm = decodeUint16(fields.handDmBase64, this.n);
    this.slopePct = decodeBase64Bytes(fields.slopePctBase64);
    this.accNorm = decodeBase64Bytes(fields.accNormBase64);
    this.travelTimeTenthMin = decodeUint16(fields.travelTimeTenthMinBase64, this.n);
    this.rootCohesion = decodeBase64Bytes(fields.rootCohesionBase64);
    this.isForest = decodeBase64Bytes(fields.isForestBase64);
    this.uplandWeight = decodeBase64Bytes(fields.uplandWeightBase64);
    this.twi = fields.twiBase64 ? decodeBase64Bytes(fields.twiBase64) : null;
    this.curvature = fields.curvatureBase64 ? decodeBase64Bytes(fields.curvatureBase64) : null;
    this.soilDepthCm = fields.soilDepthCmBase64 ? decodeBase64Bytes(fields.soilDepthCmBase64) : null;
    this.geologyFactor = fields.geologyFactorBase64 ? decodeBase64Bytes(fields.geologyFactorBase64) : null;
    this.reachId = fields.reachIdBase64 ? decodeUint16(fields.reachIdBase64, this.n) : null;
    this.reachLongFrac = fields.reachLongFracBase64 ? decodeBase64Bytes(fields.reachLongFracBase64) : null;
    this.bottleneckProx = decodeBase64Bytes(fields.bottleneckProxBase64);
    this.soilErodibility = fields.soilErodibilityBase64 ? decodeBase64Bytes(fields.soilErodibilityBase64) : null;
    this.officialLandslide = fields.officialLandslideBase64 ? decodeBase64Bytes(fields.officialLandslideBase64) : null;
    this.scourMask = fields.scourMaskBase64 ? decodeBase64Bytes(fields.scourMaskBase64) : null;
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
    this.floodDepthP10Grid = new Float32Array(this.n);
    this.floodDepthP90Grid = new Float32Array(this.n);
    this.floodAgreementGrid = new Float32Array(this.n);
    this.landslideRiskGrid = new Float32Array(this.n);
    this.fosGrid = new Float32Array(this.n).fill(3.0);
    this.runoffMmGrid = new Float32Array(this.n);
  }

  setCalibrationMarks(marks: CalibrationMarkFeature[]): void {
    this.calibrationMarks = marks;
    this.cachedValidationKey = '';
  }

  getFloodDepthGrid(): Float32Array {
    return this.floodDepthGrid;
  }

  getFloodAgreementGrid(): Float32Array {
    return this.floodAgreementGrid;
  }

  getLandslideRiskGrid(): Float32Array {
    return this.landslideRiskGrid;
  }

  getFosGrid(): Float32Array {
    return this.fosGrid;
  }

  getRunoffMmGrid(): Float32Array {
    return this.runoffMmGrid;
  }

  getHandDm(): Uint16Array {
    return this.handDm;
  }

  getNagariMask(): Uint8Array | null {
    return this.nagariMask;
  }

  getBottleneckProx(): Uint8Array {
    return this.bottleneckProx;
  }

  getAccNorm(): Uint8Array {
    return this.accNorm;
  }

  getSlopePct(): Uint8Array {
    return this.slopePct;
  }

  getUplandWeight(): Uint8Array {
    return this.uplandWeight;
  }

  getTravelTimeTenthMin(): Uint16Array {
    return this.travelTimeTenthMin;
  }

  getLastRoutedNominal(): RoutedReachState | null {
    return this.lastRoutedNominal;
  }

  /**
   * Computes local data-readiness confidence score (0-100) reflecting verified geometry,
   * measured channel cross-sections, measured culvert openings, DEMNAS resolution, and HWM benchmarks.
   */
  computeDataConfidence(): { score: number; level: DataConfidenceLevel } {
    const net = this.fields.network;
    if (!net || net.reachCount === 0) {
      return { score: 42, level: 'low' };
    }

    let insideReaches = 0;
    let verifiedGeomReaches = 0;
    let measuredCsReaches = 0;
    for (const r of net.reaches) {
      if (r.insideNagariFrac < 0.1) continue;
      insideReaches++;
      if (r.verifiedWaterwayId) verifiedGeomReaches++;
      if (r.measuredWidthM != null && r.measuredDepthM != null) measuredCsReaches++;
    }
    let verifiedCrossings = 0;
    let measuredCrossings = 0;
    for (const c of net.crossings) {
      if (c.verified) verifiedCrossings++;
      if (c.measuredOpening) measuredCrossings++;
    }

    const demScore = (this.fields.sourceDemResM ?? 30) <= 18 ? 28 : 16;
    const agamScore = this.soilDepthCm && this.geologyFactor ? 16 : 6;
    const scourScore = this.scourMask ? 10 : 0;
    const wwGeomScore = Math.min(14, (verifiedGeomReaches / Math.max(1, insideReaches * 0.25)) * 14);
    const wwCsScore = Math.min(14, (measuredCsReaches / Math.max(1, insideReaches * 0.15)) * 14);
    const crossScore =
      net.crossings.length > 0
        ? Math.min(10, ((verifiedCrossings * 0.6 + measuredCrossings * 0.4) / Math.max(1, net.crossings.length * 0.35)) * 10)
        : 4;
    const hwmScore = Math.min(8, this.calibrationMarks.length * 2.5);

    const score = Math.max(25, Math.min(98, Math.round(demScore + agamScore + scourScore + wwGeomScore + wwCsScore + crossScore + hwmScore)));
    const level: DataConfidenceLevel = score >= 74 ? 'high' : score >= 54 ? 'medium' : 'low';
    return { score, level };
  }

  /**
   * Build GeoJSON reaches for live Stream-Power Scour and Survey-Priority overlays on the map.
   */
  buildReachDiagnosticsGeoJSON(): { scourReaches: GeoFeatureCollection; surveyPriorityReaches: GeoFeatureCollection } {
    const net = this.fields.network;
    const routed = this.lastRoutedNominal;
    if (!net || !routed) {
      return {
        scourReaches: { type: 'FeatureCollection', features: [] },
        surveyPriorityReaches: { type: 'FeatureCollection', features: [] }
      };
    }

    const scourFeatures: GeoFeature[] = [];
    const surveyFeatures: GeoFeature[] = [];

    for (let r = 0; r < net.reachCount; r++) {
      const reach = net.reaches[r];
      if (reach.insideNagariFrac < 0.08 || reach.coords.length < 2) continue;

      const omega = routed.streamPowerWm2[r] || 0;
      const qBulk = routed.qBulk[r] || 0;
      const cv = routed.sedimentCv[r] || 0;

      if (omega >= 280 && qBulk >= 0.4) {
        scourFeatures.push({
          type: 'Feature',
          properties: {
            id: `scour-r-${r}`,
            reachId: r,
            name: reach.waterwayName || `Alur #${r + 1}`,
            omegaWm2: Math.round(omega),
            severity: omega >= 1000 ? 'severe' : 'moderate',
            qBulkM3s: Number(qBulk.toFixed(1)),
            sedimentCvPct: Math.round(cv * 100),
            dataConfidence: reach.dataConfidence
          },
          geometry: { type: 'LineString', coordinates: reach.coords }
        });
      }

      // Survey priority score: high flow/upstream area + low field verification
      const unverifiedWeight =
        reach.dataConfidence === 'low' ? 1.0 : reach.dataConfidence === 'medium' ? 0.55 : 0.15;
      const priorityScore = Math.min(
        100,
        Math.round(unverifiedWeight * (30 + Math.log10(1 + reach.upstreamAreaKm2 * 6) * 42 + (qBulk > 2 ? 20 : 0)))
      );
      if (reach.upstreamAreaKm2 >= 0.25) {
        surveyFeatures.push({
          type: 'Feature',
          properties: {
            id: `survey-r-${r}`,
            reachId: r,
            name: reach.waterwayName || `Alur #${r + 1}`,
            dataConfidence: reach.dataConfidence,
            priorityScore,
            upstreamAreaKm2: reach.upstreamAreaKm2,
            hasMeasuredCs: reach.measuredWidthM != null && reach.measuredDepthM != null
          },
          geometry: { type: 'LineString', coordinates: reach.coords }
        });
      }
    }

    return {
      scourReaches: { type: 'FeatureCollection', features: scourFeatures },
      surveyPriorityReaches: { type: 'FeatureCollection', features: surveyFeatures }
    };
  }

  sampleAtLngLat(lng: number, lat: number): PointSimDiagnostics {
    const { width, height, bbox, network } = this.fields;
    if (lng < bbox.west || lng > bbox.east || lat < bbox.south || lat > bbox.north) {
      return {
        depthM: 0,
        depthP10M: 0,
        depthP90M: 0,
        agreementPct: 0,
        handM: 0,
        runoffMm: 0,
        bottleneckProx: 0,
        insideNagari: false,
        dischargeM3s: 0,
        upstreamAreaKm2: 0,
        sedimentCv: 0,
        streamPowerWm2: 0,
        fos: 3.0,
        reachId: -1,
        reachName: null,
        dataConfidence: 'low'
      };
    }
    const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
    const idx = row * width + col;
    const insideNagari = !this.nagariMask || this.nagariMask[idx] !== 0;

    const rid = this.reachId ? this.reachId[idx] : 65535;
    const validReach = Boolean(network && rid < network.reachCount);
    const reach = validReach && network ? network.reaches[rid] : null;
    const routed = this.lastRoutedNominal;

    return {
      depthM: this.floodDepthGrid[idx] || 0,
      depthP10M: this.floodDepthP10Grid[idx] || 0,
      depthP90M: this.floodDepthP90Grid[idx] || 0,
      agreementPct: Math.round((this.floodAgreementGrid[idx] || 0) * 100),
      handM: (this.handDm[idx] || 0) * 0.1,
      runoffMm: this.runoffMmGrid[idx] || 0,
      bottleneckProx: this.bottleneckProx[idx] || 0,
      insideNagari,
      dischargeM3s: validReach && routed ? Number((routed.qBulk[rid] || 0).toFixed(2)) : 0,
      upstreamAreaKm2: reach ? reach.upstreamAreaKm2 : 0,
      sedimentCv: validReach && routed ? Number((routed.sedimentCv[rid] || 0).toFixed(3)) : 0,
      streamPowerWm2: validReach && routed ? Math.round(routed.streamPowerWm2[rid] || 0) : 0,
      fos: Number((this.fosGrid[idx] || 3.0).toFixed(2)),
      reachId: validReach ? rid : -1,
      reachName: reach?.waterwayName || null,
      dataConfidence: reach?.dataConfidence || 'low'
    };
  }

  private evaluateReachStageForCell(routed: RoutedReachState, rid: number, cellLong: number): number {
    let stage = routed.stageNormal[rid] || 0;
    const bwHead = routed.backwaterHead[rid] || 0;
    if (bwHead > 0.05) {
      const startLong = routed.backwaterStartLong[rid];
      // Directional M1 backwater: ONLY affects cells upstream of the crossing (cellLong >= startLong)!
      if (cellLong >= startLong - 0.02) {
        const distUp = Math.max(0, cellLong - startLong);
        const lenFrac = Math.max(0.08, routed.backwaterLenFrac[rid]);
        if (distUp <= lenFrac) {
          const decay = 1 - distUp / lenFrac;
          stage += bwHead * decay * decay;
        }
      }
    }
    return stage;
  }

  evaluate(params: CascadeSimParams, opts?: { skipValidation?: boolean }): CascadeKpis {
    const p = Math.max(0, Math.min(1, params.progress));
    const hyetographType = resolveHyetograph(params);
    const { steps, totalWindowMin, dtMin, stormSteps } = buildHyetograph(
      params.rainMmHr,
      params.durationMin,
      hyetographType,
      28
    );

    const elapsedMin = totalWindowMin * p;
    const isRecession = elapsedMin > params.durationMin;
    const targetStepIdx = Math.max(0, Math.min(steps.length - 1, Math.floor(p * (steps.length - 1))));
    const accumulatedMm = p <= 0.02 ? 0 : steps[targetStepIdx].cumRainMm;
    const { score: dataConfidenceScore, level: dataConfidenceLevel } = this.computeDataConfidence();

    const emptyVal: ValidationMetrics = this.cachedValidation || {
      scourCsi: null,
      scourPod: null,
      scourFar: null,
      scourSampleCount: 0,
      landslideAuc: null,
      landslidePod: null,
      landslideCsi: null,
      hwmRmseM: null,
      hwmHitRatePct: null,
      hwmCount: this.calibrationMarks.length
    };

    if (p <= 0.02 || !this.fields.network || !this.reachId) {
      this.floodDepthGrid.fill(0);
      this.floodDepthP10Grid.fill(0);
      this.floodDepthP90Grid.fill(0);
      this.floodAgreementGrid.fill(0);
      this.landslideRiskGrid.fill(0);
      this.fosGrid.fill(3.0);
      this.runoffMmGrid.fill(0);
      this.lastRoutedNominal = null;

      return {
        stage: 0,
        alertLevel: 'normal',
        elapsedMin,
        totalWindowMin,
        isRecession: false,
        accumulatedMm: 0,
        effectiveRunoffMm: 0,
        floodAreaHa: 0,
        landslideAreaHa: 0,
        affectedBuildingsFlood: 0,
        affectedBuildingsLandslide: 0,
        chokeCount: 0,
        reductionPct: 0,
        peakTravelMin: this.fields.p90TravelMin,
        runoffIndex: 0,
        officialLandslideOverlapPct: 0,
        peakDischargeM3s: 0,
        maxStreamPowerWm2: 0,
        meanSedimentCv: 0,
        scourReachCount: 0,
        dataConfidenceScore,
        dataConfidenceLevel,
        ensemble: {
          floodAreaHa: { p10: 0, p50: 0, p90: 0 },
          landslideAreaHa: { p10: 0, p50: 0, p90: 0 },
          affectedBuildingsFlood: { p10: 0, p50: 0, p90: 0 },
          affectedBuildingsLandslide: { p10: 0, p50: 0, p90: 0 },
          peakDischargeM3s: { p10: 0, p50: 0, p90: 0 }
        },
        hydrograph: steps.map(s => ({
          timeMin: Math.round(s.timeMin),
          rainMmHr: Number(s.rainMmHr.toFixed(1)),
          qP10: 0,
          qP50: 0,
          qP90: 0,
          qBulkP50: 0,
          isRecession: s.isRecession
        })),
        validation: emptyVal
      };
    }

    const stage: 0 | 1 | 2 | 3 | 4 = p <= 0.25 ? 1 : p <= 0.55 ? 2 : p <= 0.82 ? 3 : 4;
    const net = this.fields.network;
    const R = net.reachCount;

    // 1. Leakage-free Physical Slope Stability (Infinite-Slope FoS) + Hillslope Sediment Yield per Reach
    const slopeRes = evaluateSlopeStability(
      {
        fields: this.fields,
        elevM: this.elevM,
        slopePct: this.slopePct,
        twi: this.twi,
        curvature: this.curvature,
        soilDepthCm: this.soilDepthCm,
        geologyFactor: this.geologyFactor,
        soilErodibility: this.soilErodibility,
        rootCohesion: this.rootCohesion,
        isForest: this.isForest,
        uplandWeight: this.uplandWeight,
        reachId: this.reachId,
        nagariMask: this.nagariMask,
        params,
        cumRainMm: accumulatedMm,
        cellAreaM2: this.cellAreaM2
      },
      SIGMA_ENSEMBLE_MEMBERS[0], // nominal
      SIGMA_ENSEMBLE_MEMBERS[5], // geotech_conservative
      SIGMA_ENSEMBLE_MEMBERS[6], // geotech_optimistic
      R
    );

    this.fosGrid.set(slopeRes.fosP50);
    this.landslideRiskGrid.set(slopeRes.landslideRiskGrid);

    // 2. Run 7-Member Deterministic Sigma-Point Hydraulic Ensemble (<3 ms total!)
    const M = SIGMA_ENSEMBLE_MEMBERS.length;
    const routedMembers: RoutedReachState[] = new Array(M);
    for (let m = 0; m < M; m++) {
      routedMembers[m] = routeReachNetwork({
        network: net,
        minElevM: this.fields.minElev,
        params,
        member: SIGMA_ENSEMBLE_MEMBERS[m],
        hyetographSteps: steps,
        dtMin,
        targetStepIdx,
        reachSedimentSupplyM3: slopeRes.reachSedimentSupplyM3
      });
    }

    // Counterfactual cleared run on nominal member for exact culvert-clearing reduction %
    const clearedRef = routeReachNetwork({
      network: net,
      minElevM: this.fields.minElev,
      params,
      member: SIGMA_ENSEMBLE_MEMBERS[0],
      hyetographSteps: steps,
      dtMin,
      targetStepIdx,
      reachSedimentSupplyM3: slopeRes.reachSedimentSupplyM3,
      forceClearedCrossings: true
    });

    const nom = routedMembers[0];
    this.lastRoutedNominal = nom;

    // 3. Single-pass cell mapping for P10/P50/P90 depths, ensemble agreement %, and area KPIs
    const memberFloodCells = new Int32Array(M);
    let clearedCells = 0;
    let lsModelHigh = 0;
    let lsMatchedOfficial = 0;
    const depthsBuf = new Float32Array(M);
    const sortedDepths = new Array<number>(M);

    for (let i = 0; i < this.n; i++) {
      if (this.nagariMask && this.nagariMask[i] === 0) {
        this.floodDepthGrid[i] = 0;
        this.floodDepthP10Grid[i] = 0;
        this.floodDepthP90Grid[i] = 0;
        this.floodAgreementGrid[i] = 0;
        this.runoffMmGrid[i] = 0;
        continue;
      }

      const rid = this.reachId[i];
      if (rid >= R) {
        this.floodDepthGrid[i] = 0;
        this.floodDepthP10Grid[i] = 0;
        this.floodDepthP90Grid[i] = 0;
        this.floodAgreementGrid[i] = 0;
        this.runoffMmGrid[i] = nom.meanRunoffMm;
        continue;
      }

      this.runoffMmGrid[i] = nom.meanRunoffMm;
      const sl = this.slopePct[i];
      const cellLong = this.reachLongFrac ? this.reachLongFrac[i] / 255 : 0.5;

      // Track independent Pemkab Agam overlap strictly for reporting (never used in FoS formula!)
      if (this.landslideRiskGrid[i] >= 0.42) {
        lsModelHigh++;
        if (this.officialLandslide && this.officialLandslide[i] >= 2) lsMatchedOfficial++;
      }

      if (sl <= 28) {
        const handM = this.handDm[i] * 0.1;
        let wetVotes = 0;
        for (let m = 0; m < M; m++) {
          const st = this.evaluateReachStageForCell(routedMembers[m], rid, cellLong);
          const effHand = Math.max(0, handM + SIGMA_ENSEMBLE_MEMBERS[m].demErrM);
          const d = st > effHand + 0.08 ? st - effHand : 0;
          depthsBuf[m] = d;
          sortedDepths[m] = d;
          if (d >= 0.15 && (handM > 0 || d >= 0.38)) {
            memberFloodCells[m]++;
            wetVotes++;
          }
        }
        sortedDepths.sort((a, b) => a - b);
        this.floodDepthGrid[i] = depthsBuf[0]; // Nominal P50
        this.floodDepthP10Grid[i] = percentileSorted(sortedDepths, 0.15);
        this.floodDepthP90Grid[i] = percentileSorted(sortedDepths, 0.85);
        this.floodAgreementGrid[i] = wetVotes / M;

        const clearedSt = this.evaluateReachStageForCell(clearedRef, rid, cellLong);
        const clearedD = clearedSt > handM + 0.08 ? clearedSt - handM : 0;
        if (clearedD >= 0.15 && (handM > 0 || clearedD >= 0.38)) clearedCells++;
      } else {
        this.floodDepthGrid[i] = 0;
        this.floodDepthP10Grid[i] = 0;
        this.floodDepthP90Grid[i] = 0;
        this.floodAgreementGrid[i] = 0;
      }
    }

    // 4. Affected building counts across P10 / P50 / P90
    let bldFloodP10 = 0;
    let bldFloodP50 = 0;
    let bldFloodP90 = 0;
    let bldLsP10 = 0;
    let bldLsP50 = 0;
    let bldLsP90 = 0;
    for (let i = 0; i < this.buildingCells.length; i++) {
      const idx = this.buildingCells[i];
      if (this.floodDepthP10Grid[idx] >= 0.18) bldFloodP10++;
      if (this.floodDepthGrid[idx] >= 0.18) bldFloodP50++;
      if (this.floodDepthP90Grid[idx] >= 0.18) bldFloodP90++;

      const prob = slopeRes.landslideProbGrid[idx];
      if (prob >= 0.85) bldLsP10++;
      if (this.landslideRiskGrid[idx] >= 0.28) bldLsP50++;
      if (prob >= 0.25) bldLsP90++;
    }

    // 5. Ensemble summary ranges
    const sortedAreas = Array.from(memberFloodCells, c => Number((c * this.cellHa).toFixed(1))).sort((a, b) => a - b);
    const floodAreaP50 = Number((memberFloodCells[0] * this.cellHa).toFixed(1));
    const floodAreaP10 = Number(Math.min(floodAreaP50, percentileSorted(sortedAreas, 0.15)).toFixed(1));
    const floodAreaP90 = Number(Math.max(floodAreaP50, percentileSorted(sortedAreas, 0.85)).toFixed(1));

    const lsAreaP10 = Number((slopeRes.landslideCellsP10 * this.cellHa).toFixed(1));
    const lsAreaP50 = Number((slopeRes.landslideCellsP50 * this.cellHa).toFixed(1));
    const lsAreaP90 = Number((slopeRes.landslideCellsP90 * this.cellHa).toFixed(1));

    const sortedPeakQ = routedMembers.map(rm => rm.peakOutletQ).sort((a, b) => a - b);
    const peakQP50 = Number(nom.peakOutletQ.toFixed(1));
    const peakQP10 = Number(Math.min(peakQP50, percentileSorted(sortedPeakQ, 0.15)).toFixed(1));
    const peakQP90 = Number(Math.max(peakQP50, percentileSorted(sortedPeakQ, 0.85)).toFixed(1));

    // Reach stream-power & sediment summaries inside Nagari
    let maxStreamPowerWm2 = 0;
    let scourReachCount = 0;
    let cvSum = 0;
    let cvActive = 0;
    for (let r = 0; r < R; r++) {
      if (net.reaches[r].insideNagariFrac < 0.1) continue;
      const om = nom.streamPowerWm2[r] || 0;
      if (om > maxStreamPowerWm2) maxStreamPowerWm2 = om;
      if (om >= 300 && nom.qBulk[r] >= 0.4) scourReachCount++;
      if (nom.qBulk[r] >= 0.3) {
        cvSum += nom.sedimentCv[r] || 0;
        cvActive++;
      }
    }
    const meanSedimentCv = cvActive > 0 ? Number((cvSum / cvActive).toFixed(3)) : 0;

    // Outlet hydrograph across storm + recession with P10/P50/P90 bands
    const hydrograph: HydrographPoint[] = new Array(steps.length);
    const qStepBuf = new Array<number>(M);
    for (let t = 0; t < steps.length; t++) {
      for (let m = 0; m < M; m++) qStepBuf[m] = routedMembers[m].outletHydrographBulkQ[t] || 0;
      qStepBuf.sort((a, b) => a - b);
      hydrograph[t] = {
        timeMin: Math.round(steps[t].timeMin),
        rainMmHr: Number(steps[t].rainMmHr.toFixed(1)),
        qP10: Number(percentileSorted(qStepBuf, 0.15).toFixed(1)),
        qP50: Number((nom.outletHydrographQ[t] || 0).toFixed(1)),
        qP90: Number(percentileSorted(qStepBuf, 0.85).toFixed(1)),
        qBulkP50: Number((nom.outletHydrographBulkQ[t] || 0).toFixed(1)),
        isRecession: t >= stormSteps
      };
    }

    const effectiveRunoffMm = Number(nom.meanRunoffMm.toFixed(1));
    const reductionPct =
      memberFloodCells[0] > 0 && memberFloodCells[0] > clearedCells
        ? Math.max(0, Math.round((1 - clearedCells / memberFloodCells[0]) * 100))
        : 0;
    const chokeCount = Math.min(this.totalCrossings, nom.chokedCount);
    const runoffIndex = Math.min(100, Math.round((effectiveRunoffMm / 180) * 100));

    let alertLevel: CascadeAlertLevel = 'normal';
    if (
      floodAreaP50 >= 120 ||
      lsAreaP50 >= 25 ||
      (params.drainCondition === 'surge' && floodAreaP50 >= 95)
    ) {
      alertLevel = 'kritis';
    } else if (floodAreaP50 >= 65 || lsAreaP50 >= 15 || bldFloodP50 >= 150) {
      alertLevel = 'siaga';
    } else if (floodAreaP50 >= 15 || lsAreaP50 >= 5 || bldFloodP50 >= 20) {
      alertLevel = 'waspada';
    }

    // 6. Independent Validation Metrics (memoized by scenario + calibration profile to stay <1 ms while scrubbing)
    let validation = emptyVal;
    if (!opts?.skipValidation) {
      const valKey = `${params.rainMmHr}|${params.durationMin}|${params.soilMoisture}|${params.antecedent5dMm ?? ''}|${params.drainCondition}|${params.forestScenario}|${params.debrisCoupling ?? ''}|${params.calibrationProfile?.manningMult ?? 1}|${params.calibrationProfile?.cnOffset ?? 0}|${params.calibrationProfile?.cohesionMult ?? 1}|${this.calibrationMarks.length}|${targetStepIdx >= Math.floor(stormSteps * 0.7) ? 'peak' : 'early'}`;
      if (valKey !== this.cachedValidationKey || !this.cachedValidation) {
        this.cachedValidationKey = valKey;
        this.cachedValidation = computeValidationMetrics({
          fields: this.fields,
          scourMask: this.scourMask,
          officialLandslide: this.officialLandslide,
          nagariMask: this.nagariMask,
          reachId: this.reachId,
          handDm: this.handDm,
          slopePct: this.slopePct,
          floodDepthP50: this.floodDepthGrid,
          fosP50: this.fosGrid,
          reachStreamPowerWm2: nom.streamPowerWm2,
          calibrationMarks: this.calibrationMarks,
          evaluateAtStorm:
            this.calibrationMarks.length > 0
              ? stormParams => {
                  const sub = new CascadeEngine(this.fields, [], this.totalCrossings, []);
                  sub.evaluate({ ...stormParams, calibrationProfile: params.calibrationProfile }, { skipValidation: true });
                  return {
                    sampleAtLngLat: (lng, lat) => {
                      const s = sub.sampleAtLngLat(lng, lat);
                      return { depthM: s.depthM, streamPowerWm2: s.streamPowerWm2, fos: s.fos };
                    }
                  };
                }
              : undefined
        });
      }
      validation = this.cachedValidation;
    }

    return {
      stage,
      alertLevel,
      elapsedMin,
      totalWindowMin,
      isRecession,
      accumulatedMm,
      effectiveRunoffMm,
      floodAreaHa: floodAreaP50,
      landslideAreaHa: lsAreaP50,
      affectedBuildingsFlood: bldFloodP50,
      affectedBuildingsLandslide: bldLsP50,
      chokeCount,
      reductionPct,
      peakTravelMin: this.fields.p90TravelMin,
      runoffIndex,
      officialLandslideOverlapPct:
        lsModelHigh > 0 ? Math.round((lsMatchedOfficial / lsModelHigh) * 100) : 0,
      peakDischargeM3s: peakQP50,
      maxStreamPowerWm2: Math.round(maxStreamPowerWm2),
      meanSedimentCv,
      scourReachCount,
      dataConfidenceScore,
      dataConfidenceLevel,
      ensemble: {
        floodAreaHa: { p10: floodAreaP10, p50: floodAreaP50, p90: floodAreaP90 },
        landslideAreaHa: { p10: lsAreaP10, p50: lsAreaP50, p90: lsAreaP90 },
        affectedBuildingsFlood: { p10: bldFloodP10, p50: bldFloodP50, p90: bldFloodP90 },
        affectedBuildingsLandslide: { p10: bldLsP10, p50: bldLsP50, p90: bldLsP90 },
        peakDischargeM3s: { p10: peakQP10, p50: peakQP50, p90: peakQP90 }
      },
      hydrograph,
      validation
    };
  }

  /**
   * Runs bounded deterministic local parameter calibration against Sentinel-2 scour,
   * held-out Pemkab Agam polygons, and any field-recorded High-Water Marks.
   */
  runLocalCalibration(): {
    profile: CalibrationProfile;
    metrics: ValidationMetrics;
    baselineMetrics: ValidationMetrics;
    evaluatedCount: number;
  } {
    const benchStorm: CascadeSimParams = {
      rainMmHr: 95,
      durationMin: 180,
      progress: 0.78,
      soilMoisture: 'saturated',
      antecedent5dMm: 140,
      rainPattern: 'upland',
      drainCondition: 'clogged',
      forestScenario: 'actual',
      hyetograph: 'alternating_block',
      debrisCoupling: 'coupled'
    };

    return solveBoundedCalibration(candidate => {
      const sub = new CascadeEngine(this.fields, [], this.totalCrossings, this.calibrationMarks);
      const res = sub.evaluate({ ...benchStorm, calibrationProfile: candidate });
      return res.validation;
    });
  }

  renderRgba(outSize = 256): { floodRgba: Uint8Array; landslideRgba: Uint8Array; agreementRgba: Uint8Array } {
    const { width, height } = this.fields;
    const floodRgba = new Uint8Array(outSize * outSize * 4);
    const landslideRgba = new Uint8Array(outSize * outSize * 4);
    const agreementRgba = new Uint8Array(outSize * outSize * 4);

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

        const agree = sampleBilinear(this.floodAgreementGrid, width, height, xf, yf);
        if (agree > 0.14) {
          // Daylight confidence palette: >=80% crisp deep cyan-blue (#0369a1), 20-80% soft uncertain sky (#38bdf8)
          const highConf = smoothstep(0.55, 0.85, agree);
          agreementRgba[pIdx] = clamp255(56 * (1 - highConf) + 3 * highConf);
          agreementRgba[pIdx + 1] = clamp255(189 * (1 - highConf) + 105 * highConf);
          agreementRgba[pIdx + 2] = clamp255(248 * (1 - highConf) + 161 * highConf);
          agreementRgba[pIdx + 3] = clamp255((0.28 + 0.44 * highConf) * smoothstep(0.14, 0.25, agree) * 255);
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

    return { floodRgba, landslideRgba, agreementRgba };
  }
}

export { RECESSION_MULTIPLIER };
