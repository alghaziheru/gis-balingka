import { useCallback, useEffect, useMemo, useState } from 'react';
import { CascadeEngine, extractBuildingCentroids } from '../lib/cascadeEngine';
import { computeUplandBounds } from '../lib/flowField';
import type {
  CascadeKpis,
  CascadeSimParams,
  DatasetMetadata,
  DrainCondition,
  ForestScenario,
  GeoFeatureCollection,
  RainPattern,
  SimFieldsData,
  SoilMoisture,
  ViewMode
} from '../types/gis';

export function useSimulationController(opts: {
  simFields: SimFieldsData | null;
  settlements: GeoFeatureCollection | undefined;
  metadata: DatasetMetadata | null;
}) {
  // Interactive Rainfall -> Galodo Cascade Simulator (calm 00:00 dry start)
  const [simPlaying, setSimPlaying] = useState(false);
  const [simRain, setSimRain] = useState(45);
  const [simDurationMin, setSimDurationMin] = useState(120);
  const [simProgress, setSimProgress] = useState(0);
  const [soilMoisture, setSoilMoisture] = useState<SoilMoisture>('moist');
  const [rainPattern, setRainPattern] = useState<RainPattern>('uniform');
  const [drainCondition, setDrainCondition] = useState<DrainCondition>('clogged');
  const [forestScenario, setForestScenario] = useState<ForestScenario>('actual');
  const [rainAnimEnabled, setRainAnimEnabled] = useState(true);
  const [simShowVerifiedWaterways, setSimShowVerifiedWaterways] = useState(true);
  const [simShowRbiRivers, setSimShowRbiRivers] = useState(true);

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
    return new CascadeEngine(opts.simFields, buildingCentroids, totalCrossings);
  }, [opts.simFields, buildingCentroids, opts.metadata?.crossingsDetected, opts.metadata?.bridgesDetected]);

  const uplandBbox = useMemo(() => (opts.simFields ? computeUplandBounds(opts.simFields) : null), [opts.simFields]);

  const cascadeParams: CascadeSimParams = useMemo(
    () => ({
      rainMmHr: simRain,
      durationMin: simDurationMin,
      progress: simProgress,
      soilMoisture,
      rainPattern,
      drainCondition,
      forestScenario
    }),
    [simRain, simDurationMin, simProgress, soilMoisture, rainPattern, drainCondition, forestScenario]
  );

  const cascadeKpis: CascadeKpis = useMemo(() => {
    if (cascadeEngine) {
      return cascadeEngine.evaluate(cascadeParams);
    }
    const elapsedMin = simDurationMin * simProgress;
    const accumulatedMm = simRain * (elapsedMin / 60);
    return {
      stage: simProgress <= 0.02 ? 0 : simProgress <= 0.25 ? 1 : simProgress <= 0.55 ? 2 : simProgress <= 0.82 ? 3 : 4,
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
      peakTravelMin: 75,
      runoffIndex: 0,
      officialLandslideOverlapPct: 0
    };
  }, [cascadeEngine, cascadeParams, simRain, simDurationMin, simProgress]);

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
    if (preset === 'normal') {
      setSimRain(25);
      setSimDurationMin(90);
      setSoilMoisture('dry');
      setRainPattern('uniform');
      setDrainCondition('cleared');
      setForestScenario('actual');
    } else if (preset === 'upland') {
      setSimRain(80);
      setSimDurationMin(180);
      setSoilMoisture('saturated');
      setRainPattern('upland');
      setDrainCondition('clogged');
      setForestScenario('actual');
    } else {
      setSimRain(120);
      setSimDurationMin(180);
      setSoilMoisture('saturated');
      setRainPattern('upland');
      setDrainCondition(viewMode === 'detail' ? 'surge' : 'clogged');
      setForestScenario('actual');
    }
    setSimProgress(0.05);
    setSimPlaying(true);
  }, []);

  const resetForSimpleMode = useCallback(() => {
    if (forestScenario !== 'actual') {
      setForestScenario('actual');
    }
    if (drainCondition === 'surge') {
      setDrainCondition('clogged');
    }
  }, [forestScenario, drainCondition]);

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
    rainPattern,
    setRainPattern,
    drainCondition,
    setDrainCondition,
    forestScenario,
    setForestScenario,
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
