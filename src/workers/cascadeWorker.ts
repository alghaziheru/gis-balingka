import { CascadeEngine } from '../lib/cascadeEngine';
import { extractFloodPoolPolygons, marchingSquaresPolygons } from '../lib/poolContours';
import type {
  CalibrationMarkFeature,
  CascadeKpis,
  CascadeSimParams,
  GeoFeatureCollection,
  SimFieldsData,
  VerifiedWaterwayFeature
} from '../types/gis';

export interface PlaybackPoolRings {
  yard: [number, number][][];
  knee: [number, number][][];
  deep: [number, number][][];
  landslide: [number, number][][];
  runout: [number, number][][];
}

export type CascadeWorkerRequest =
  | {
      type: 'init';
      fields: SimFieldsData;
      buildingCentroids: [number, number][];
      totalCrossings: number;
      calibrationMarks: CalibrationMarkFeature[];
      verifiedWaterways?: VerifiedWaterwayFeature[];
    }
  | {
      type: 'calibrationMarks';
      calibrationMarks: CalibrationMarkFeature[];
    }
  | {
      type: 'verifiedWaterways';
      verifiedWaterways: VerifiedWaterwayFeature[];
    }
  | {
      type: 'evaluate';
      reqId: number;
      params: CascadeSimParams;
      nominalOnly?: boolean;
      skipValidation?: boolean;
      extractPools?: boolean;
    };

export type CascadeWorkerResponse = {
  type: 'result';
  reqId: number;
  scenarioKey: string;
  kpis: CascadeKpis;
  depthGrid: Float32Array;
  runoffGrid: Float32Array;
  pools?: PlaybackPoolRings | null;
};

let engine: CascadeEngine | null = null;
let verifiedWaterways: VerifiedWaterwayFeature[] = [];

function extractOuterRings(fc: GeoFeatureCollection): [number, number][][] {
  const rings: [number, number][][] = [];
  for (let i = 0; i < fc.features.length; i++) {
    const geom = fc.features[i].geometry;
    if (geom?.type === 'Polygon' && geom.coordinates[0]?.length >= 3) {
      rings.push(geom.coordinates[0]);
    }
  }
  return rings;
}

function buildScenarioKey(p: CascadeSimParams): string {
  return [
    p.rainMmHr,
    p.durationMin,
    p.soilMoisture,
    p.antecedent5dMm ?? '',
    p.rainPattern,
    p.drainCondition,
    p.culvertBlockagePct ?? '',
    p.forestScenario,
    p.hyetograph ?? '',
    p.orographicPctPerKm ?? '',
    p.debrisCoupling ?? ''
  ].join('|');
}

const workerScope = self as unknown as {
  onmessage: ((e: MessageEvent<CascadeWorkerRequest>) => void) | null;
  postMessage: (message: CascadeWorkerResponse, transfer: Transferable[]) => void;
};

workerScope.onmessage = (e: MessageEvent<CascadeWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    verifiedWaterways = msg.verifiedWaterways || [];
    engine = new CascadeEngine(
      msg.fields,
      msg.buildingCentroids,
      msg.totalCrossings,
      msg.calibrationMarks
    );
    return;
  }
  if (msg.type === 'calibrationMarks') {
    engine?.setCalibrationMarks(msg.calibrationMarks);
    return;
  }
  if (msg.type === 'verifiedWaterways') {
    verifiedWaterways = msg.verifiedWaterways || [];
    return;
  }
  if (msg.type === 'evaluate') {
    if (!engine) return;
    const kpis = engine.evaluate(msg.params, {
      nominalOnly: msg.nominalOnly,
      skipValidation: msg.skipValidation
    });
    const depthGrid = new Float32Array(engine.getFloodDepthGrid());
    const runoffGrid = new Float32Array(engine.getRunoffMmGrid());
    let pools: PlaybackPoolRings | null = null;
    if (msg.extractPools) {
      const poolResult = extractFloodPoolPolygons(engine, verifiedWaterways);
      const mask = engine.getNagariMask();
      const { width, height, bbox } = engine.fields;
      const lsFc = marchingSquaresPolygons(
        engine.getLandslideRiskGrid(),
        width,
        height,
        bbox,
        0.3,
        mask,
        1
      );
      const runoutFc = marchingSquaresPolygons(
        engine.getLandslideRunoutGrid(),
        width,
        height,
        bbox,
        0.25,
        mask,
        1
      );
      pools = {
        yard: extractOuterRings(poolResult.yard),
        knee: extractOuterRings(poolResult.knee),
        deep: extractOuterRings(poolResult.deep),
        landslide: extractOuterRings(lsFc),
        runout: extractOuterRings(runoutFc)
      };
    }
    workerScope.postMessage(
      {
        type: 'result',
        reqId: msg.reqId,
        scenarioKey: buildScenarioKey(msg.params),
        kpis,
        depthGrid,
        runoffGrid,
        pools
      },
      [depthGrid.buffer, runoffGrid.buffer]
    );
  }
};
