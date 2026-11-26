import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GeoJSONSource, ImageSource, Map as MapLibreMap } from 'maplibre-gl';
import type { CascadeEngine } from '../../lib/cascadeEngine';
import type { MergedWaterwayReach } from '../../lib/geometry';
import { extractFloodPoolPolygons } from '../../lib/poolContours';
import type {
  CascadeSimParams,
  GeoFeature,
  GeoFeatureCollection,
  LayerToggles,
  SimMapViewMode,
  TabId,
  VerifiedWaterwayFeature
} from '../../types/gis';
import {
  asGeoInput,
  buildImageCoords,
  EMPTY_FC,
  HAND_LAYERS,
  interpolateLine,
  lerpHex,
  type LoadedDatasets
} from './types';

function buildStormCoreGeoJson(stormCore: [number, number] | null | undefined, active: boolean): GeoFeatureCollection {
  if (!active || !stormCore) return EMPTY_FC;
  const [lng, lat] = stormCore;
  const radiusKm = 2.4;
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const ring: [number, number][] = [];
  const segs = 32;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'ring' },
        geometry: { type: 'Polygon', coordinates: [ring] }
      },
      {
        type: 'Feature',
        properties: { kind: 'center' },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      }
    ]
  };
}

export function syncWaterwaySimStyling(map: MapLibreMap, isRaining: boolean): void {
  map.setPaintProperty('verified-waterways-casing', 'line-color', [
    'case',
    ['==', ['get', 'kind'], 'culvert'],
    '#334155',
    isRaining ? '#0c334a' : '#ffffff'
  ]);
  map.setPaintProperty(
    'verified-waterways-casing',
    'line-width',
    isRaining
      ? ['match', ['get', 'kind'], 'river', 7.8, 'stream', 6.0, 'culvert', 5.0, 4.8]
      : ['match', ['get', 'kind'], 'river', 6.4, 'stream', 5.2, 'culvert', 5.0, 4.2]
  );
  map.setPaintProperty('verified-waterways-casing', 'line-opacity', isRaining ? 0.78 : 0.9);
  map.setPaintProperty(
    'verified-waterways-line',
    'line-width',
    isRaining
      ? ['match', ['get', 'kind'], 'river', 4.8, 'stream', 3.5, 2.8]
      : ['match', ['get', 'kind'], 'river', 3.8, 'stream', 2.8, 2.3]
  );
  map.setPaintProperty('verified-waterways-line', 'line-opacity', isRaining ? 0.92 : 0.96);
  map.setPaintProperty('verified-culverts-line', 'line-opacity', 0.98);
}

export function syncSimulationOverlays(opts: {
  map: MapLibreMap;
  tab: TabId;
  isRaining: boolean;
  simMapViewMode: SimMapViewMode;
  datasets: LoadedDatasets;
  layers: LayerToggles;
  simRain: number;
  simDurationMin: number;
  simProgress: number;
  simScenario: 'clogged' | 'cleared';
  cascadeEngine: CascadeEngine | null;
  cascadeParams: CascadeSimParams;
  verifiedWaterways: VerifiedWaterwayFeature[];
  lastCascadeKeyRef: MutableRefObject<string>;
  lastCascadeTsRef: MutableRefObject<number>;
  landslideCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  agreementCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  setPoolGlintPoints: Dispatch<SetStateAction<[number, number][]>>;
}): () => void {
  const { map, isRaining, simMapViewMode, tab } = opts;
  const vis = (on: boolean) => (on ? 'visible' : 'none');

  const showFlood = isRaining;
  const useDynamicCascade = Boolean(opts.cascadeEngine);
  let activeHandId: string | null = null;
  let handOpacity = 0.72;
  if (showFlood && !useDynamicCascade) {
    const accumulatedMm = opts.simRain * ((opts.simDurationMin * opts.simProgress) / 60);
    const effectiveLoad = opts.simRain * 0.45 + accumulatedMm * 0.55;
    const level = effectiveLoad < 45 ? 'low' : effectiveLoad < 105 ? 'med' : 'high';
    activeHandId = `hand-${opts.simScenario}-${level}`;
    const baseMax = opts.simScenario === 'cleared' ? 0.56 : 0.72;
    handOpacity = Math.min(baseMax, 0.22 + Math.min(1, opts.simProgress * 1.15) * (baseMax - 0.22));
  }
  for (const hid of HAND_LAYERS) {
    const isOn = hid === activeHandId;
    map.setLayoutProperty(hid, 'visibility', vis(isOn));
    if (isOn) map.setPaintProperty(hid, 'raster-opacity', handOpacity);
  }

  // Storm core footprint visual
  const stormCoreVisible =
    tab === 'sim' && opts.cascadeParams.rainPattern === 'storm_core' && Boolean(opts.cascadeParams.stormCore);
  const stormCoreSrc = map.getSource('src-storm-core') as GeoJSONSource | undefined;
  if (stormCoreSrc) {
    stormCoreSrc.setData(asGeoInput(buildStormCoreGeoJson(opts.cascadeParams.stormCore, stormCoreVisible)));
  }
  if (map.getLayer('storm-core-fill')) map.setLayoutProperty('storm-core-fill', 'visibility', vis(stormCoreVisible));
  if (map.getLayer('storm-core-ring')) map.setLayoutProperty('storm-core-ring', 'visibility', vis(stormCoreVisible));
  if (map.getLayer('storm-core-dot')) map.setLayoutProperty('storm-core-dot', 'visibility', vis(stormCoreVisible));

  const showCascadeLayers = showFlood && useDynamicCascade;
  const showSurveyOnly = tab === 'sim' && simMapViewMode === 'survey' && useDynamicCascade;
  const showDepthTiers = showCascadeLayers && simMapViewMode === 'depth';

  map.setLayoutProperty('sim-pools-yard-fill', 'visibility', vis(showDepthTiers));
  map.setLayoutProperty('sim-pools-yard-outline', 'visibility', vis(showDepthTiers));
  map.setLayoutProperty('sim-pools-knee-fill', 'visibility', vis(showDepthTiers));
  map.setLayoutProperty('sim-pools-knee-outline', 'visibility', vis(showDepthTiers));
  map.setLayoutProperty('sim-pools-deep-fill', 'visibility', vis(showDepthTiers));
  map.setLayoutProperty(
    'cascade-agreement-overlay',
    'visibility',
    vis(showCascadeLayers && simMapViewMode === 'confidence')
  );
  map.setLayoutProperty(
    'cascade-landslide-overlay',
    'visibility',
    vis(showCascadeLayers && simMapViewMode !== 'survey')
  );
  map.setLayoutProperty('sim-scour-reaches-line', 'visibility', vis(showCascadeLayers && simMapViewMode === 'scour'));
  map.setLayoutProperty('sim-survey-reaches-line', 'visibility', vis(showSurveyOnly));

  let cascadeTimer: number | null = null;
  if (!showCascadeLayers && !showSurveyOnly) {
    opts.lastCascadeKeyRef.current = '';
    const yardSrc = map.getSource('src-sim-pools-yard') as GeoJSONSource | undefined;
    const kneeSrc = map.getSource('src-sim-pools-knee') as GeoJSONSource | undefined;
    const deepSrc = map.getSource('src-sim-pools-deep') as GeoJSONSource | undefined;
    const scourSrc = map.getSource('src-sim-scour-reaches') as GeoJSONSource | undefined;
    const surveySrc = map.getSource('src-sim-survey-reaches') as GeoJSONSource | undefined;
    if (yardSrc) yardSrc.setData(asGeoInput(EMPTY_FC));
    if (kneeSrc) kneeSrc.setData(asGeoInput(EMPTY_FC));
    if (deepSrc) deepSrc.setData(asGeoInput(EMPTY_FC));
    if (scourSrc) scourSrc.setData(asGeoInput(EMPTY_FC));
    if (surveySrc) surveySrc.setData(asGeoInput(EMPTY_FC));
    opts.setPoolGlintPoints(prev => (prev.length > 0 ? [] : prev));
  } else if (opts.cascadeEngine) {
    const cp = opts.cascadeParams;
    const engine = opts.cascadeEngine;
    const ovKey = cp.structureBlockageOverrides
      ? Object.entries(cp.structureBlockageOverrides)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join(',')
      : '';
    const coreKey = cp.stormCore ? `${cp.stormCore[0].toFixed(4)},${cp.stormCore[1].toFixed(4)}` : '';
    const calKey = cp.calibrationProfile
      ? `${cp.calibrationProfile.manningMult}|${cp.calibrationProfile.cnOffset}|${cp.calibrationProfile.cohesionMult}`
      : 'def';
    const scenarioKey = [
      cp.rainMmHr,
      cp.durationMin,
      cp.soilMoisture,
      cp.antecedent5dMm ?? '',
      cp.rainPattern,
      cp.hyetograph ?? '',
      cp.orographicPctPerKm ?? '',
      coreKey,
      cp.drainCondition,
      cp.culvertBlockagePct ?? '',
      ovKey,
      cp.debrisCoupling ?? '',
      cp.forestScenario,
      calKey,
      simMapViewMode,
      opts.verifiedWaterways.length
    ].join('|');
    const cacheKey = `${scenarioKey}::${cp.progress.toFixed(3)}`;

    const renderCascade = () => {
      opts.lastCascadeKeyRef.current = cacheKey;
      opts.lastCascadeTsRef.current = performance.now();
      engine.evaluate(cp);

      const yardSrc = map.getSource('src-sim-pools-yard') as GeoJSONSource | undefined;
      const kneeSrc = map.getSource('src-sim-pools-knee') as GeoJSONSource | undefined;
      const deepSrc = map.getSource('src-sim-pools-deep') as GeoJSONSource | undefined;
      const scourSrc = map.getSource('src-sim-scour-reaches') as GeoJSONSource | undefined;
      const surveySrc = map.getSource('src-sim-survey-reaches') as GeoJSONSource | undefined;

      if (showCascadeLayers && simMapViewMode === 'depth') {
        const pools = extractFloodPoolPolygons(engine, opts.verifiedWaterways);
        if (yardSrc) yardSrc.setData(asGeoInput(pools.yard));
        if (kneeSrc) kneeSrc.setData(asGeoInput(pools.knee));
        if (deepSrc) deepSrc.setData(asGeoInput(pools.deep));
        opts.setPoolGlintPoints(pools.glintPoints);
      } else {
        opts.setPoolGlintPoints(prev => (prev.length > 0 ? [] : prev));
      }

      if (simMapViewMode === 'scour' || simMapViewMode === 'survey') {
        const diag = engine.buildReachDiagnosticsGeoJSON();
        if (scourSrc) scourSrc.setData(asGeoInput(diag.scourReaches));
        if (surveySrc) surveySrc.setData(asGeoInput(diag.surveyPriorityReaches));
      }

      if (showCascadeLayers) {
        const outSize = 256;
        const { landslideRgba, agreementRgba } = engine.renderRgba(outSize);
        const imgCoords = buildImageCoords(opts.datasets.bbox);

        if (!opts.landslideCanvasRef.current) {
          const c = document.createElement('canvas');
          c.width = outSize;
          c.height = outSize;
          opts.landslideCanvasRef.current = c;
        }
        let hasLandslidePixels = false;
        for (let ai = 3; ai < landslideRgba.length; ai += 4) {
          if (landslideRgba[ai] > 0) {
            hasLandslidePixels = true;
            break;
          }
        }
        const lsCanvas = opts.landslideCanvasRef.current;
        if (hasLandslidePixels || lsCanvas.dataset.empty !== '1') {
          const lCtx = lsCanvas.getContext('2d');
          if (lCtx) {
            lCtx.putImageData(new ImageData(new Uint8ClampedArray(landslideRgba), outSize, outSize), 0, 0);
            const srcLs = map.getSource('img-cascade-landslide') as ImageSource | undefined;
            if (srcLs && typeof srcLs.updateImage === 'function') {
              srcLs.updateImage({
                url: lsCanvas.toDataURL('image/png'),
                coordinates: imgCoords
              });
            }
          }
          lsCanvas.dataset.empty = hasLandslidePixels ? '0' : '1';
        }

        if (simMapViewMode === 'confidence') {
          if (!opts.agreementCanvasRef.current) {
            const c = document.createElement('canvas');
            c.width = outSize;
            c.height = outSize;
            opts.agreementCanvasRef.current = c;
          }
          const aCtx = opts.agreementCanvasRef.current.getContext('2d');
          if (aCtx) {
            aCtx.putImageData(new ImageData(new Uint8ClampedArray(agreementRgba), outSize, outSize), 0, 0);
            const srcAg = map.getSource('img-cascade-agreement') as ImageSource | undefined;
            if (srcAg && typeof srcAg.updateImage === 'function') {
              srcAg.updateImage({
                url: opts.agreementCanvasRef.current.toDataURL('image/png'),
                coordinates: imgCoords
              });
            }
          }
        }
      }
    };

    if (cacheKey !== opts.lastCascadeKeyRef.current) {
      const isScenarioSwitch = opts.lastCascadeKeyRef.current.split('::')[0] !== scenarioKey;
      const elapsed = performance.now() - opts.lastCascadeTsRef.current;
      if (isScenarioSwitch || elapsed >= 220) {
        renderCascade();
      } else {
        cascadeTimer = window.setTimeout(renderCascade, 225 - elapsed);
      }
    }
  }

  return () => {
    if (cascadeTimer !== null) window.clearTimeout(cascadeTimer);
  };
}

export function syncStormSky(
  map: MapLibreMap,
  lastSkyKeyRef: MutableRefObject<string>,
  opts: { tab: TabId; rainAnimEnabled: boolean; simProgress: number; simRain: number }
): void {
  const isStorm = opts.tab === 'sim' && opts.rainAnimEnabled && opts.simProgress > 0.02;
  const rawStormFactor = isStorm
    ? Math.min(1, opts.simRain / 130) * Math.min(1, opts.simProgress * 2.5)
    : 0;
  const stormFactor = Math.round(rawStormFactor * 10) / 10;
  const key = stormFactor.toFixed(1);
  if (key === lastSkyKeyRef.current) return;
  lastSkyKeyRef.current = key;

  try {
    if (stormFactor <= 0.01) {
      map.setSky({
        'sky-color': '#c9dce8',
        'horizon-color': '#e5ebe8',
        'fog-color': '#e5ebe8',
        'sky-horizon-blend': 0.5,
        'horizon-fog-blend': 0.7,
        'fog-ground-blend': 0.5
      });
    } else {
      map.setSky({
        'sky-color': lerpHex('#c9dce8', '#9eb4c6', stormFactor),
        'horizon-color': lerpHex('#e5ebe8', '#c8d4dc', stormFactor),
        'fog-color': lerpHex('#e5ebe8', '#c2cfd8', stormFactor),
        'sky-horizon-blend': Number((0.5 + stormFactor * 0.08).toFixed(2)),
        'horizon-fog-blend': Number((0.7 + stormFactor * 0.08).toFixed(2)),
        'fog-ground-blend': Number((0.5 + stormFactor * 0.08).toFixed(2))
      });
    }
  } catch {
    // Ignore if map style is not ready for sky updates
  }
}

export function startFlowParticleLoop(
  map: MapLibreMap,
  refs: {
    flowAnimActiveRef: MutableRefObject<boolean>;
    particlesClearedRef: MutableRefObject<boolean>;
    animPathsRef: MutableRefObject<GeoFeature[]>;
    suppressedDemSetRef: MutableRefObject<Set<string>>;
    mergingFlowIdsRef: MutableRefObject<Set<string>>;
    layersRef: MutableRefObject<LayerToggles>;
    mergedReachesRef: MutableRefObject<MergedWaterwayReach[]>;
    verifiedWaterwaysRef: MutableRefObject<VerifiedWaterwayFeature[]>;
  }
): () => void {
  let animTimerId = 0;
  let particlePhase = 0;
  let lastTs = 0;

  const stepAnim = (ts: number) => {
    if (ts - lastTs > 50) {
      const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0.05);
      lastTs = ts;
      const animActive = refs.flowAnimActiveRef.current;
      const src = map.getSource('src-flow-particles') as GeoJSONSource | undefined;

      if (!animActive) {
        if (src && !refs.particlesClearedRef.current) {
          src.setData(asGeoInput(EMPTY_FC));
          refs.particlesClearedRef.current = true;
        }
      } else {
        refs.particlesClearedRef.current = false;
        const speed = 0.16;
        particlePhase = (particlePhase + dt * speed) % 1;

        if (src) {
          const features: GeoFeature[] = [];
          const animPaths = refs.animPathsRef.current;
          for (let i = 0; i < animPaths.length; i++) {
            const f = animPaths[i];
            if (f.geometry.type !== 'LineString') continue;
            const segId = String(f.properties?.id || '');
            if (refs.suppressedDemSetRef.current.has(segId)) continue;
            const tier = Number(f.properties?.tier || 2);
            const lenM = Number(f.properties?.length_m || 0);
            const isMerging = refs.mergingFlowIdsRef.current.has(segId);
            const coords = f.geometry.coordinates;
            const count = tier === 1 || (isMerging && lenM >= 150) ? 2 : 1;
            for (let k = 0; k < count; k++) {
              const frac = (particlePhase + k / count + i * 0.17) % 1;
              features.push({
                type: 'Feature',
                properties: { kind: 'dem', radius: tier === 1 ? 3.2 : 2.5 },
                geometry: { type: 'Point', coordinates: interpolateLine(coords, frac) }
              });
            }
          }

          if (refs.layersRef.current.verifiedWaterways) {
            const mergedReaches = refs.mergedReachesRef.current;
            const mergedWwIds = new Set<string>();
            for (let i = 0; i < mergedReaches.length; i++) {
              const reach = mergedReaches[i];
              mergedWwIds.add(reach.waterwayId);
              const coords = reach.coordinates;
              if (!coords || coords.length < 2) continue;
              const count = Math.max(2, Math.min(12, Math.round(reach.lengthM / 220)));
              const radius = reach.kind === 'river' ? 3.7 : 3.2;
              for (let k = 0; k < count; k++) {
                const frac = (particlePhase + k / count + i * 0.11) % 1;
                features.push({
                  type: 'Feature',
                  properties: { kind: 'merged', radius, mix: frac },
                  geometry: { type: 'Point', coordinates: interpolateLine(coords, frac) }
                });
              }
            }

            for (let i = 0; i < refs.verifiedWaterwaysRef.current.length; i++) {
              const ww = refs.verifiedWaterwaysRef.current[i];
              if (mergedWwIds.has(ww.properties.id)) continue;
              const isRiver = ww.properties.kind === 'river';
              const coords = ww.geometry.coordinates;
              if (!coords || coords.length < 2) continue;
              const count = Math.max(1, Math.min(8, Math.round((ww.properties.length_m || 400) / 320)));
              const radius = isRiver ? 3.0 : 2.5;
              for (let k = 0; k < count; k++) {
                const frac = (particlePhase + k / count + i * 0.13) % 1;
                features.push({
                  type: 'Feature',
                  properties: { kind: 'verified', radius },
                  geometry: { type: 'Point', coordinates: interpolateLine(coords, frac) }
                });
              }
            }
          }

          src.setData(asGeoInput({ type: 'FeatureCollection', features }));
        }
      }
    }
    animTimerId = requestAnimationFrame(stepAnim);
  };
  animTimerId = requestAnimationFrame(stepAnim);

  return () => cancelAnimationFrame(animTimerId);
}
