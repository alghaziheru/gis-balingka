import { useCallback, useEffect, useMemo, useState } from 'react';
import { CascadeEngine, extractBuildingCentroids, RECESSION_MULTIPLIER } from '../lib/cascadeEngine';
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
  calibrationMarks?: CalibrationMarkFeature[];
  calibrationProfile?: CalibrationProfile | null;
}) {
  // Interactive Rainfall -> Hydro-Geomorphic Cascade Simulator (calm 00:00 dry start)
  const [simPlaying, setSimPlaying] = useState(false);
  const [simRain, setSimRain] = useState(45);
  const [simDurationMin, setSimDurationMin] = useState(120);
  const [simProgress, setSimProgress] = useState(0);
  const [soilMoisture, setSoilMoistureState] = useState<SoilMoisture>('moist');
  const [antecedent5dMm, setAntecedent5dMmState] = useState(65);
  const [rainPattern, setRainPattern] = useState<RainPattern>('uniform');
  const [drainCondition, setDrainConditionState] = useState<DrainCondition>('clogged');
  const [culvertBlockagePct, setCulvertBlockagePct] = useState(65);
  const [structureBlockageOverrides, setStructureBlockageOverrides] = useState<Record<string, number>>({});
  const [forestScenario, setForestScenario] = useState<ForestScenario>('actual');
  const [hyetograph, setHyetograph] = useState<HyetographType>('alternating_block');
  const [orographicPctPerKm, setOrographicPctPerKm] = useState(25);
  const [stormCore, setStormCore] = useState<[number, number] | null>(null);
  const [debrisCoupling, setDebrisCoupling] = useState<DebrisCouplingMode>('coupled');
  const [simMapViewMode, setSimMapViewMode] = useState<SimMapViewMode>('depth');
  const [rainAnimEnabled, setRainAnimEnabled] = useState(true);
  const [simShowVerifiedWaterways, setSimShowVerifiedWaterways] = useState(true);
  const [simShowRbiRivers, setSimShowRbiRivers] = useState(true);

  const setSoilMoisture = useCallback((m: SoilMoisture) => {
    setSoilMoistureState(m);
    setAntecedent5dMmState(m === 'dry' ? 15 : m === 'saturated' ? 150 : 65);
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
    const id = window.setInterval(() => {
      setSimProgress(prev => {
        if (prev >= 1) {
          setSimPlaying(false);
          return 1;
        }
        const next = Math.min(1, prev + 0.008);
        if (next >= 1) setSimPlaying(false);
        return next;
      });
    }, 80);
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
      affectedBuildingsLandslide: 0,
      chokeCount: 0,
      reductionPct: 0,
      peakTravelMin: 75,
      runoffIndex: 0,
      officialLandslideOverlapPct: 0,
      peakDischargeM3s: 0,
      maxStreamPowerWm2: 0,
      meanSedimentCv: 0,
      scourReachCount: 0,
      dataConfidenceScore: 50,
      dataConfidenceLevel: 'medium',
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
      setSimRain(25);
      setSimDurationMin(90);
      setSoilMoistureState('dry');
      setAntecedent5dMmState(15);
      setRainPattern('uniform');
      setDrainConditionState('cleared');
      setCulvertBlockagePct(5);
      setForestScenario('actual');
      setHyetograph('uniform');
      setOrographicPctPerKm(15);
      setDebrisCoupling('clear');
    } else if (preset === 'upland') {
      setSimRain(80);
      setSimDurationMin(180);
      setSoilMoistureState('saturated');
      setAntecedent5dMmState(145);
      setRainPattern('upland');
      setDrainConditionState('clogged');
      setCulvertBlockagePct(65);
      setForestScenario('actual');
      setHyetograph('alternating_block');
      setOrographicPctPerKm(45);
      setDebrisCoupling('coupled');
    } else {
      setSimRain(120);
      setSimDurationMin(180);
      setSoilMoistureState('saturated');
      setAntecedent5dMmState(175);
      setRainPattern('upland');
      setDrainConditionState(viewMode === 'detail' ? 'surge' : 'clogged');
      setCulvertBlockagePct(80);
      setForestScenario('actual');
      setHyetograph('convective_front');
      setOrographicPctPerKm(55);
      setDebrisCoupling(viewMode === 'detail' ? 'surge' : 'coupled');
    }
    setSimProgress(0.05);
    setSimPlaying(true);
  }, []);

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
    setSimRain,
    simDurationMin,
    setSimDurationMin,
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
