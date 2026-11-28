import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REGION, type RegionConfig } from '../config/region';
import type { ClimateBaselineData } from '../data/climateBaseline';
import { CascadeEngine, computeRecessionDurationMin, extractBuildingCentroids } from '../lib/cascadeEngine';
import { getMaxRealisticRainMmHr } from '../lib/reachRouter';
import { computeUplandBounds } from '../lib/flowField';
import type { CascadeWorkerResponse, PlaybackPoolRings } from '../workers/cascadeWorker';
import type {
  CalibrationMarkFeature,
  CalibrationProfile,
  CascadeKpis,
  CascadeSimParams,
  DatasetMetadata,
  DebrisCouplingMode,
  DrainCondition,
  ForestScenario,
  GeoFeatureCollection,
  HydrographPoint,
  HyetographType,
  RainPattern,
  SimFieldsData,
  SimMapViewMode,
  SoilMoisture,
  VerifiedWaterwayFeature,
  ViewMode
} from '../types/gis';

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const BASE_SIM_MINUTES_PER_SEC = 10;
const UI_MIN_RECESSION_MIN = 240;

export interface PlaybackHydroGrids {
  depthGrid: Float32Array | null;
  runoffGrid: Float32Array | null;
  pools: PlaybackPoolRings | null;
  poolsVersion: number;
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
    p.debrisCoupling ?? '',
    p.minRecessionMin ?? ''
  ].join('|');
}

function sampleHydrographAtTime(
  points: HydrographPoint[],
  elapsedMin: number,
  fallbackRain: number,
  isRecession: boolean
): { rainMmHr: number; qM3s: number } {
  if (!points || points.length === 0) {
    return { rainMmHr: isRecession ? 0 : fallbackRain, qM3s: 0 };
  }
  if (elapsedMin <= points[0].timeMin) {
    return { rainMmHr: points[0].rainMmHr, qM3s: points[0].qBulkP50 };
  }
  const last = points[points.length - 1];
  if (elapsedMin >= last.timeMin) {
    return { rainMmHr: last.rainMmHr, qM3s: last.qBulkP50 };
  }
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timeMin <= elapsedMin) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = Math.max(1e-4, b.timeMin - a.timeMin);
  const t = Math.max(0, Math.min(1, (elapsedMin - a.timeMin) / span));
  return {
    rainMmHr: a.rainMmHr + (b.rainMmHr - a.rainMmHr) * t,
    qM3s: a.qBulkP50 + (b.qBulkP50 - a.qBulkP50) * t
  };
}

export function useSimulationController(opts: {
  simFields: SimFieldsData | null;
  settlements: GeoFeatureCollection | undefined;
  metadata: DatasetMetadata | null;
  climateBaseline?: ClimateBaselineData;
  region?: RegionConfig;
  calibrationMarks?: CalibrationMarkFeature[];
  calibrationProfile?: CalibrationProfile | null;
  verifiedWaterways?: VerifiedWaterwayFeature[];
}) {
  // Interactive Rainfall -> Hydro-Geomorphic Cascade Simulator (calm 00:00 normal baseline)
  const [simPlaying, setSimPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [simRain, setSimRain] = useState(15);
  const [simDurationMin, setSimDurationMin] = useState(120);
  const [simProgress, setSimProgress] = useState(0);
  const speedRef = useRef<PlaybackSpeed>(playbackSpeed);
  speedRef.current = playbackSpeed;
  const safeDur = Math.max(15, simDurationMin);
  const recessionMin = computeRecessionDurationMin(safeDur, UI_MIN_RECESSION_MIN);
  const totalWindowMin = safeDur + recessionMin;
  const totalWindowMinRef = useRef(totalWindowMin);
  totalWindowMinRef.current = totalWindowMin;
  const [soilMoisture, setSoilMoistureState] = useState<SoilMoisture>('moist');
  const [antecedent5dMm, setAntecedent5dMmState] = useState(45);
  const [rainPattern, setRainPattern] = useState<RainPattern>('uniform');
  const [drainCondition, setDrainConditionState] = useState<DrainCondition>('cleared');
  const [culvertBlockagePct, setCulvertBlockagePct] = useState(5);
  const [structureBlockageOverrides, setStructureBlockageOverrides] = useState<Record<string, number>>({});
  const [forestScenario, setForestScenario] = useState<ForestScenario>('actual');
  const [hyetograph, setHyetograph] = useState<HyetographType>('alternating_block');
  const [orographicPctPerKm, setOrographicPctPerKm] = useState(15);
  const [stormCore, setStormCore] = useState<[number, number] | null>(null);
  const [debrisCoupling, setDebrisCoupling] = useState<DebrisCouplingMode>('clear');
  const [simMapViewMode, setSimMapViewMode] = useState<SimMapViewMode>('depth');
  const [rainAnimEnabled, setRainAnimEnabled] = useState(true);
  const [simShowWaterways, setSimShowWaterways] = useState(true);
  const [simShowOsmRoads, setSimShowOsmRoads] = useState(true);

  const setRainSafe = useCallback(
    (rain: number) => {
      const maxRain = getMaxRealisticRainMmHr(simDurationMin, opts.climateBaseline);
      setSimRain(Math.max(1, Math.min(maxRain, Math.round(rain))));
    },
    [simDurationMin, opts.climateBaseline]
  );

  const setDurationSafe = useCallback(
    (minutes: number) => {
      setSimDurationMin(minutes);
      const maxRain = getMaxRealisticRainMmHr(minutes, opts.climateBaseline);
      setSimRain(prev => Math.min(prev, maxRain));
    },
    [opts.climateBaseline]
  );

  const setSoilMoisture = useCallback((m: SoilMoisture) => {
    setSoilMoistureState(m);
    setAntecedent5dMmState(m === 'dry' ? 15 : m === 'saturated' ? 150 : 45);
  }, []);

  const setAntecedent5dMm = useCallback((mm: number) => {
    const clamped = Math.max(0, Math.min(250, Math.round(mm)));
    setAntecedent5dMmState(clamped);
    setSoilMoistureState(clamped <= 30 ? 'dry' : clamped >= 115 ? 'saturated' : 'moist');
  }, []);

  const setDrainCondition = useCallback((d: DrainCondition) => {
    setDrainConditionState(d);
    if (d === 'cleared') {
      setCulvertBlockagePct(5);
      setDebrisCoupling(prev => (prev === 'surge' ? 'coupled' : prev));
    } else if (d === 'clogged') {
      setCulvertBlockagePct(65);
      setDebrisCoupling(prev => (prev === 'surge' ? 'coupled' : prev));
    } else {
      setCulvertBlockagePct(80);
      setDebrisCoupling('surge');
    }
  }, []);

  const setStructureBlockageOverride = useCallback((structureId: string, pct: number | null) => {
    setStructureBlockageOverrides(prev => {
      const next = { ...prev };
      if (pct === null) delete next[structureId];
      else next[structureId] = Math.max(0, Math.min(100, Math.round(pct)));
      return next;
    });
  }, []);

  const clearStructureBlockageOverrides = useCallback(() => {
    setStructureBlockageOverrides({});
  }, []);

  useEffect(() => {
    if (!simPlaying) return;
    let rafId = 0;
    let lastTick = performance.now();
    let accumMs = 0;

    const tick = (now: number) => {
      const dtMs = Math.max(0, Math.min(80, now - lastTick));
      lastTick = now;
      accumMs += dtMs;
      if (accumMs >= 80) {
        const simMinDelta = (accumMs / 1000) * BASE_SIM_MINUTES_PER_SEC * speedRef.current;
        const step = simMinDelta / Math.max(15, totalWindowMinRef.current);
        accumMs = 0;
        setSimProgress(prev => {
          if (prev >= 1) {
            setSimPlaying(false);
            return 1;
          }
          const next = Math.min(1, prev + step);
          if (next >= 1) setSimPlaying(false);
          return next;
        });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [simPlaying]);

  const buildingCentroids = useMemo(() => extractBuildingCentroids(opts.settlements), [opts.settlements]);

  const cascadeEngine = useMemo(() => {
    if (!opts.simFields) return null;
    const totalCrossings =
      (opts.metadata?.crossingsDetected || 0) + (opts.metadata?.bridgesDetected || 0) || 34;
    return new CascadeEngine(opts.simFields, buildingCentroids, totalCrossings, opts.calibrationMarks || []);
  }, [opts.simFields, buildingCentroids, opts.metadata?.crossingsDetected, opts.metadata?.bridgesDetected]);

  useEffect(() => {
    if (cascadeEngine) {
      cascadeEngine.setCalibrationMarks(opts.calibrationMarks || []);
    }
  }, [cascadeEngine, opts.calibrationMarks]);

  const playbackGridsRef = useRef<PlaybackHydroGrids>({
    depthGrid: null,
    runoffGrid: null,
    pools: null,
    poolsVersion: 0
  });
  const workerRef = useRef<Worker | null>(null);
  const workerBusyRef = useRef(false);
  const workerReqIdRef = useRef(0);
  const pendingEvalRef = useRef<CascadeSimParams | null>(null);
  const [workerResult, setWorkerResult] = useState<{ scenarioKey: string; kpis: CascadeKpis } | null>(null);
  const lastSyncRef = useRef<{ scenarioKey: string; kpis: CascadeKpis } | null>(null);

  useEffect(() => {
    if (!opts.simFields || typeof Worker === 'undefined') return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/cascadeWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      return;
    }
    workerRef.current = worker;
    workerBusyRef.current = false;
    pendingEvalRef.current = null;
    const totalCrossings =
      (opts.metadata?.crossingsDetected || 0) + (opts.metadata?.bridgesDetected || 0) || 34;

    worker.onmessage = (e: MessageEvent<CascadeWorkerResponse>) => {
      const msg = e.data;
      if (!msg || msg.type !== 'result') return;
      workerBusyRef.current = false;
      playbackGridsRef.current = {
        depthGrid: msg.depthGrid,
        runoffGrid: msg.runoffGrid,
        pools: msg.pools ?? null,
        poolsVersion: playbackGridsRef.current.poolsVersion + 1
      };
      setWorkerResult({ scenarioKey: msg.scenarioKey, kpis: msg.kpis });

      const nextParams = pendingEvalRef.current;
      if (nextParams) {
        pendingEvalRef.current = null;
        workerBusyRef.current = true;
        const reqId = ++workerReqIdRef.current;
        worker.postMessage({
          type: 'evaluate',
          reqId,
          params: nextParams,
          nominalOnly: true,
          skipValidation: true,
          extractPools: true
        });
      }
    };

    worker.postMessage({
      type: 'init',
      fields: opts.simFields,
      buildingCentroids,
      totalCrossings,
      calibrationMarks: opts.calibrationMarks || [],
      verifiedWaterways: opts.verifiedWaterways || []
    });

    return () => {
      pendingEvalRef.current = null;
      workerBusyRef.current = false;
      workerRef.current = null;
      worker.terminate();
    };
    // Calibration marks and verified waterways update incrementally via messages below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.simFields, buildingCentroids, opts.metadata?.crossingsDetected, opts.metadata?.bridgesDetected]);

  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'calibrationMarks',
        calibrationMarks: opts.calibrationMarks || []
      });
    }
  }, [opts.calibrationMarks]);

  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'verifiedWaterways',
        verifiedWaterways: opts.verifiedWaterways || []
      });
    }
  }, [opts.verifiedWaterways]);

  const uplandBbox = useMemo(() => (opts.simFields ? computeUplandBounds(opts.simFields) : null), [opts.simFields]);

  // Scale step quantization with simulation window so short (2h) and long (48h) runs update smoothly
  const playQuantSteps = Math.max(36, Math.min(180, Math.round(totalWindowMin / 18)));
  const restQuantSteps = Math.max(40, Math.min(180, Math.round(totalWindowMin / 15)));
  const quantSteps = simPlaying ? playQuantSteps : restQuantSteps;
  const engineProgress =
    simProgress <= 0.02 ? 0 : Math.min(1, Math.round(simProgress * quantSteps) / quantSteps);

  const cascadeParams: CascadeSimParams = useMemo(
    () => ({
      rainMmHr: simRain,
      durationMin: simDurationMin,
      progress: engineProgress,
      soilMoisture,
      rainPattern,
      drainCondition,
      forestScenario,
      hyetograph,
      antecedent5dMm,
      orographicPctPerKm,
      stormCore,
      culvertBlockagePct,
      structureBlockageOverrides,
      debrisCoupling,
      minRecessionMin: UI_MIN_RECESSION_MIN,
      soilProfile: (opts.region ?? REGION).hydrology?.soilProfile,
      calibrationProfile: opts.calibrationProfile || null
    }),
    [
      simRain,
      simDurationMin,
      engineProgress,
      soilMoisture,
      rainPattern,
      drainCondition,
      forestScenario,
      hyetograph,
      antecedent5dMm,
      orographicPctPerKm,
      stormCore,
      culvertBlockagePct,
      structureBlockageOverrides,
      debrisCoupling,
      opts.region,
      opts.calibrationProfile
    ]
  );

  const scenarioKey = useMemo(() => buildScenarioKey(cascadeParams), [cascadeParams]);

  // Dispatch off-thread worker evaluations during active playback so the main thread executes 0 heavy routing passes
  useEffect(() => {
    if (!simPlaying) {
      playbackGridsRef.current = {
        depthGrid: null,
        runoffGrid: null,
        pools: null,
        poolsVersion: playbackGridsRef.current.poolsVersion + 1
      };
      pendingEvalRef.current = null;
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;
    if (workerBusyRef.current) {
      pendingEvalRef.current = cascadeParams;
      return;
    }
    workerBusyRef.current = true;
    const reqId = ++workerReqIdRef.current;
    worker.postMessage({
      type: 'evaluate',
      reqId,
      params: cascadeParams,
      nominalOnly: true,
      skipValidation: true,
      extractPools: true
    });
  }, [simPlaying, cascadeParams]);

  const cascadeKpis: CascadeKpis = useMemo(() => {
    if (simPlaying && workerRef.current) {
      if (workerResult && workerResult.scenarioKey === scenarioKey) {
        return workerResult.kpis;
      }
      if (lastSyncRef.current && lastSyncRef.current.scenarioKey === scenarioKey) {
        return lastSyncRef.current.kpis;
      }
    }
    if (cascadeEngine && !simPlaying) {
      const res = cascadeEngine.evaluate(cascadeParams);
      lastSyncRef.current = { scenarioKey, kpis: res };
      return res;
    }
    if (cascadeEngine && simPlaying && !workerRef.current) {
      return cascadeEngine.evaluate(cascadeParams, { nominalOnly: true, skipValidation: true });
    }
    const elapsedMin = totalWindowMin * engineProgress;
    const accumulatedMm = simRain * (Math.min(simDurationMin, elapsedMin) / 60);
    return {
      stage: engineProgress <= 0.02 ? 0 : engineProgress <= 0.25 ? 1 : engineProgress <= 0.55 ? 2 : engineProgress <= 0.82 ? 3 : 4,
      alertLevel: 'normal',
      elapsedMin,
      totalWindowMin,
      isRecession: elapsedMin > simDurationMin,
      accumulatedMm,
      effectiveRunoffMm: 0,
      floodAreaHa: 0,
      landslideAreaHa: 0,
      affectedBuildingsFlood: 0,
      affectedBuildingsDeep: 0,
      affectedBuildingsLandslide: 0,
      representativeStageM: 0,
      representativeStageP10M: 0,
      representativeStageP90M: 0,
      chokeCount: 0,
      reductionPct: 0,
      peakTravelMin: 75,
      runoffIndex: 0,
      officialLandslideOverlapPct: 0,
      peakDischargeM3s: 0,
      maxStreamPowerWm2: 0,
      meanSedimentCv: 0,
      scourReachCount: 0,
      dataConfidenceScore: 42,
      dataConfidenceLevel: 'low',
      inputCoverage: {
        insideReaches: 0,
        verifiedReaches: 0,
        measuredReaches: 0,
        totalCrossings: 0,
        verifiedCrossings: 0,
        measuredCrossings: 0,
        hwmCount: opts.calibrationMarks?.length || 0,
        isCalibrated: false
      },
      runoutAreaHa: 0,
      ensemble: {
        floodAreaHa: { p10: 0, p50: 0, p90: 0 },
        landslideAreaHa: { p10: 0, p50: 0, p90: 0 },
        affectedBuildingsFlood: { p10: 0, p50: 0, p90: 0 },
        affectedBuildingsLandslide: { p10: 0, p50: 0, p90: 0 },
        peakDischargeM3s: { p10: 0, p50: 0, p90: 0 }
      },
      hydrograph: lastSyncRef.current?.kpis.hydrograph ?? [],
      validation: {
        scourCsi: null,
        scourPod: null,
        scourFar: null,
        scourSampleCount: 0,
        landslideAuc: null,
        landslidePod: null,
        landslideCsi: null,
        hwmRmseM: null,
        hwmHitRatePct: null,
        hwmCount: 0
      }
    };
  }, [
    cascadeEngine,
    cascadeParams,
    scenarioKey,
    simPlaying,
    workerResult,
    simRain,
    simDurationMin,
    engineProgress,
    opts.calibrationMarks
  ]);

  const liveElapsedMin = cascadeKpis.totalWindowMin * simProgress;
  const liveIsRecession = simProgress > 0.02 && liveElapsedMin > simDurationMin;
  const liveHydroSample = useMemo(
    () =>
      simProgress <= 0.02
        ? { rainMmHr: 0, qM3s: 0 }
        : sampleHydrographAtTime(cascadeKpis.hydrograph, liveElapsedMin, simRain, liveIsRecession),
    [cascadeKpis.hydrograph, liveElapsedMin, simRain, liveIsRecession, simProgress]
  );

  const cyclePlaybackSpeed = useCallback(() => {
    setPlaybackSpeed(prev => {
      const idx = PLAYBACK_SPEEDS.indexOf(prev);
      return PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    });
  }, []);

  const togglePlay = useCallback(() => {
    if (simPlaying) {
      setSimPlaying(false);
    } else {
      if (simProgress >= 1) setSimProgress(0);
      setSimPlaying(true);
    }
  }, [simPlaying, simProgress]);

  const resetSim = useCallback(() => {
    setSimPlaying(false);
    setSimProgress(0);
  }, []);

  const changeProgress = useCallback((p: number) => {
    setSimPlaying(false);
    setSimProgress(p);
  }, []);

  const applyPreset = useCallback((preset: 'normal' | 'upland' | 'extreme', viewMode: ViewMode) => {
    setSimPlaying(false);
    setPlaybackSpeed(1);
    setStormCore(null);
    if (preset === 'normal') {
      // BMKG Lebat (15 mm/hr x 2h = 30 mm) — stays contained within incised channels
      setSimRain(Math.min(15, getMaxRealisticRainMmHr(120, opts.climateBaseline)));
      setSimDurationMin(120);
      setSoilMoistureState('moist');
      setAntecedent5dMmState(45);
      setRainPattern('uniform');
      setDrainConditionState('cleared');
      setCulvertBlockagePct(5);
      setForestScenario('actual');
      setHyetograph('alternating_block');
      setOrographicPctPerKm(15);
      setDebrisCoupling('clear');
    } else if (preset === 'upland') {
      // BMKG Sangat Lebat upland storm (40 mm/hr x 3h = 120 mm, within 41-yr 24h range)
      setSimRain(Math.min(40, getMaxRealisticRainMmHr(180, opts.climateBaseline)));
      setSimDurationMin(180);
      setSoilMoistureState('moist');
      setAntecedent5dMmState(65);
      setRainPattern('upland');
      setDrainConditionState('clogged');
      setCulvertBlockagePct(65);
      setForestScenario('actual');
      setHyetograph('alternating_block');
      setOrographicPctPerKm(45);
      setDebrisCoupling('coupled');
    } else {
      // 48h continuous monsoon event (7 mm/hr x 48h = 336 mm)
      setSimRain(Math.min(7, getMaxRealisticRainMmHr(2880, opts.climateBaseline)));
      setSimDurationMin(2880);
      setSoilMoistureState('moist');
      setAntecedent5dMmState(75);
      setRainPattern('upland');
      setDrainConditionState(viewMode === 'detail' ? 'surge' : 'clogged');
      setCulvertBlockagePct(78);
      setForestScenario('actual');
      setHyetograph('alternating_block');
      setOrographicPctPerKm(48);
      setDebrisCoupling(viewMode === 'detail' ? 'surge' : 'coupled');
    }
    setSimProgress(0.05);
    setSimPlaying(true);
  }, [opts.climateBaseline]);

  const resetForSimpleMode = useCallback(() => {
    if (forestScenario !== 'actual') setForestScenario('actual');
    if (drainCondition === 'surge') {
      setDrainConditionState('clogged');
      setCulvertBlockagePct(65);
    }
    if (rainPattern === 'storm_core') {
      setRainPattern('uniform');
      setStormCore(null);
    }
    if (simMapViewMode !== 'depth') setSimMapViewMode('depth');
    if (Object.keys(structureBlockageOverrides).length > 0) setStructureBlockageOverrides({});
  }, [forestScenario, drainCondition, rainPattern, simMapViewMode, structureBlockageOverrides]);

  return {
    simPlaying,
    setSimPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    cyclePlaybackSpeed,
    simRain,
    setSimRain: setRainSafe,
    simDurationMin,
    setSimDurationMin: setDurationSafe,
    simProgress,
    liveElapsedMin,
    liveIsRecession,
    liveRainMmHr: liveHydroSample.rainMmHr,
    liveDischargeM3s: liveHydroSample.qM3s,
    soilMoisture,
    setSoilMoisture,
    antecedent5dMm,
    setAntecedent5dMm,
    rainPattern,
    setRainPattern,
    drainCondition,
    setDrainCondition,
    culvertBlockagePct,
    setCulvertBlockagePct,
    structureBlockageOverrides,
    setStructureBlockageOverride,
    clearStructureBlockageOverrides,
    forestScenario,
    setForestScenario,
    hyetograph,
    setHyetograph,
    orographicPctPerKm,
    setOrographicPctPerKm,
    stormCore,
    setStormCore,
    debrisCoupling,
    setDebrisCoupling,
    simMapViewMode,
    setSimMapViewMode,
    rainAnimEnabled,
    setRainAnimEnabled,
    simShowWaterways,
    setSimShowWaterways,
    simShowOsmRoads,
    setSimShowOsmRoads,
    cascadeEngine,
    playbackGridsRef,
    uplandBbox,
    cascadeParams,
    cascadeKpis,
    togglePlay,
    resetSim,
    changeProgress,
    applyPreset,
    resetForSimpleMode
  };
}
