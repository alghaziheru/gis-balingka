import { useCallback, useEffect, useMemo, useState } from 'react';
import { REGION, type RegionConfig } from '../config/region';
import type { ClimateBaselineData } from '../data/climateBaseline';
import { CascadeEngine, extractBuildingCentroids, RECESSION_MULTIPLIER } from '../lib/cascadeEngine';
import { getMaxRealisticRainMmHr } from '../lib/reachRouter';
import { computeUplandBounds } from '../lib/flowField';
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
  HyetographType,
  RainPattern,
  SimFieldsData,
  SimMapViewMode,
  SoilMoisture,
  ViewMode
} from '../types/gis';

export function useSimulationController(opts: {
  simFields: SimFieldsData | null;
  settlements: GeoFeatureCollection | undefined;
  metadata: DatasetMetadata | null;
  climateBaseline?: ClimateBaselineData;
  region?: RegionConfig;
  calibrationMarks?: CalibrationMarkFeature[];
  calibrationProfile?: CalibrationProfile | null;
}) {
  // Interactive Rainfall -> Hydro-Geomorphic Cascade Simulator (calm 00:00 normal baseline)
  const [simPlaying, setSimPlaying] = useState(false);
  const [simRain, setSimRain] = useState(15);
  const [simDurationMin, setSimDurationMin] = useState(120);
  const [simProgress, setSimProgress] = useState(0);
  const [soilMoisture, setSoilMoistureState] = useState<SoilMoisture>('moist');
  const [antecedent5dMm, setAntecedent5dMmState] = useState(45);
  const [rainPattern, setRainPattern] = useState<RainPattern>('uniform');
  const [drainCondition, setDrainConditionState] = useState<DrainCondition>('cleared');
  const [culvertBlockagePct, setCulvertBlockagePct] = useState(5);
  const [structureBlockageOverrides, setStructureBlockageOverrides] = useState<Record<string, number>>({});
  const [forestScenario, setForestScenario] = useState<ForestScenario>('actual');
  const [hyetograph, setHyetograph] = useState<HyetographType>('uniform');
  const [orographicPctPerKm, setOrographicPctPerKm] = useState(15);
  const [stormCore, setStormCore] = useState<[number, number] | null>(null);
  const [debrisCoupling, setDebrisCoupling] = useState<DebrisCouplingMode>('clear');
  const [simMapViewMode, setSimMapViewMode] = useState<SimMapViewMode>('depth');
  const [rainAnimEnabled, setRainAnimEnabled] = useState(true);
  const [simShowVerifiedWaterways, setSimShowVerifiedWaterways] = useState(true);
  const [simShowRbiRivers, setSimShowRbiRivers] = useState(true);
  const [simShowOsmRoads, setSimShowOsmRoads] = useState(true);
  const [simShowDemFlows, setSimShowDemFlows] = useState(false);

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
    let lastTick = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dtMs = Math.max(40, Math.min(450, now - lastTick));
      lastTick = now;
      const step = dtMs / 11000;
      setSimProgress(prev => {
        if (prev >= 1) {
          setSimPlaying(false);
          return 1;
        }
        const next = Math.min(1, prev + step);
        if (next >= 1) setSimPlaying(false);
        return next;
      });
    }, 180);
    return () => window.clearInterval(id);
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

  const uplandBbox = useMemo(() => (opts.simFields ? computeUplandBounds(opts.simFields) : null), [opts.simFields]);

  const cascadeParams: CascadeSimParams = useMemo(
    () => ({
      rainMmHr: simRain,
      durationMin: simDurationMin,
      progress: simProgress,
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
      soilProfile: (opts.region ?? REGION).hydrology?.soilProfile,
      calibrationProfile: opts.calibrationProfile || null
    }),
    [
      simRain,
      simDurationMin,
      simProgress,
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

  const cascadeKpis: CascadeKpis = useMemo(() => {
    if (cascadeEngine) {
      return cascadeEngine.evaluate(cascadeParams);
    }
    const totalWindowMin = Math.round(simDurationMin * RECESSION_MULTIPLIER);
    const elapsedMin = totalWindowMin * simProgress;
    const accumulatedMm = simRain * (Math.min(simDurationMin, elapsedMin) / 60);
    return {
      stage: simProgress <= 0.02 ? 0 : simProgress <= 0.25 ? 1 : simProgress <= 0.55 ? 2 : simProgress <= 0.82 ? 3 : 4,
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
      hydrograph: [],
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
  }, [cascadeEngine, cascadeParams, simRain, simDurationMin, simProgress, opts.calibrationMarks]);

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
      setHyetograph('uniform');
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
    simRain,
    setSimRain: setRainSafe,
    simDurationMin,
    setSimDurationMin: setDurationSafe,
    simProgress,
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
    simShowVerifiedWaterways,
    setSimShowVerifiedWaterways,
    simShowRbiRivers,
    setSimShowRbiRivers,
    simShowOsmRoads,
    setSimShowOsmRoads,
    simShowDemFlows,
    setSimShowDemFlows,
    cascadeEngine,
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
