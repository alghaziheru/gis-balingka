import type { MutableRefObject } from 'react';
import type { GeoJSONSource, ImageSource, Map as MapLibreMap } from 'maplibre-gl';
import type { CascadeEngine } from '../../lib/cascadeEngine';
import type { MergedWaterwayReach } from '../../lib/geometry';
import { extractFloodPoolPolygons } from '../../lib/poolContours';
import type {
  BBox,
  CascadeSimParams,
  DebrisCouplingMode,
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
  TRANSPARENT_1PX_PNG,
  type LoadedDatasets
} from './types';

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

type ImageCoords = [[number, number], [number, number], [number, number], [number, number]];

export interface CanvasMorphSlot {
  canvas: HTMLCanvasElement;
  current: Uint8ClampedArray;
  from: Uint8ClampedArray;
  target: Uint8ClampedArray;
  timerId: number | null;
  isEmpty: boolean;
}

export type CanvasMorphMap = Record<'flood' | 'landslide' | 'agreement', CanvasMorphSlot>;

export function createCanvasMorphMap(handles: {
  flood: HTMLCanvasElement;
  landslide: HTMLCanvasElement;
  agreement: HTMLCanvasElement;
}): CanvasMorphMap {
  const makeSlot = (canvas: HTMLCanvasElement): CanvasMorphSlot => {
    const len = canvas.width * canvas.height * 4;
    return {
      canvas,
      current: new Uint8ClampedArray(len),
      from: new Uint8ClampedArray(len),
      target: new Uint8ClampedArray(len),
      timerId: null,
      isEmpty: true
    };
  };
  return {
    flood: makeSlot(handles.flood),
    landslide: makeSlot(handles.landslide),
    agreement: makeSlot(handles.agreement)
  };
}

export function disposeCanvasMorphMap(_map: MapLibreMap | null, morphs: CanvasMorphMap | null): void {
  if (!morphs) return;
  for (const key of ['flood', 'landslide', 'agreement'] as const) {
    const slot = morphs[key];
    if (slot.timerId !== null) {
      window.clearTimeout(slot.timerId);
      slot.timerId = null;
    }
  }
}

function stopSlotTimer(slot: CanvasMorphSlot): void {
  if (slot.timerId !== null) {
    window.clearTimeout(slot.timerId);
    slot.timerId = null;
  }
}

function pushSlotToImageSource(
  map: MapLibreMap,
  slot: CanvasMorphSlot,
  sourceId: string,
  imgCoords: ImageCoords,
  isEmpty: boolean
): void {
  const src = map.getSource(sourceId) as ImageSource | undefined;
  if (!src || typeof src.updateImage !== 'function') return;

  if (isEmpty) {
    src.updateImage({ url: TRANSPARENT_1PX_PNG, coordinates: imgCoords });
    return;
  }

  const ctx = slot.canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(slot.canvas.width, slot.canvas.height);
  img.data.set(slot.current);
  ctx.putImageData(img, 0, 0);
  src.updateImage({
    url: slot.canvas.toDataURL('image/png'),
    coordinates: imgCoords
  });
}

function flushCanvasImmediate(
  map: MapLibreMap,
  slot: CanvasMorphSlot,
  sourceId: string,
  imgCoords: ImageCoords,
  nextTarget: Uint8Array | Uint8ClampedArray,
  isEmpty: boolean
): void {
  stopSlotTimer(slot);
  slot.current.set(nextTarget);
  slot.from.set(nextTarget);
  slot.target.set(nextTarget);
  slot.isEmpty = isEmpty;
  pushSlotToImageSource(map, slot, sourceId, imgCoords, isEmpty);
}

function pushBufferToImageSource(
  map: MapLibreMap,
  slot: CanvasMorphSlot,
  sourceId: string,
  imgCoords: ImageCoords,
  nextTarget: Uint8Array
): void {
  let hasAlpha = false;
  for (let i = 3; i < nextTarget.length; i += 4) {
    if (nextTarget[i] > 0) {
      hasAlpha = true;
      break;
    }
  }
  if (!hasAlpha && slot.isEmpty) return;

  slot.current.set(nextTarget);
  slot.isEmpty = !hasAlpha;
  pushSlotToImageSource(map, slot, sourceId, imgCoords, !hasAlpha);
}

function renderFilteredDepthRgba(
  filteredDepth: Float32Array,
  width: number,
  height: number,
  outSize: number,
  sedimentCv: number,
  debrisCoupling: DebrisCouplingMode
): Uint8Array {
  const rgba = new Uint8Array(outSize * outSize * 4);
  const turbidity = Math.min(
    0.42,
    Math.max(0, (sedimentCv - 0.025) * 3.2) +
      (debrisCoupling === 'surge' ? 0.22 : debrisCoupling === 'coupled' ? 0.12 : 0)
  );

  for (let y = 0; y < outSize; y++) {
    const yf = (y / Math.max(1, outSize - 1)) * (height - 1);
    for (let x = 0; x < outSize; x++) {
      const xf = (x / Math.max(1, outSize - 1)) * (width - 1);
      const depth = sampleBilinear(filteredDepth, width, height, xf, yf);
      if (depth <= 0.08) continue;

      const pIdx = (y * outSize + x) * 4;
      const alpha = smoothstep(0.08, 0.34, depth) * 182;
      let r: number;
      let g: number;
      let b: number;
      if (depth <= 0.9) {
        const f = smoothstep(0.12, 0.9, depth);
        r = 125 * (1 - f) + 14 * f;
        g = 211 * (1 - f) + 142 * f;
        b = 252 * (1 - f) + 206 * f;
      } else {
        const f = smoothstep(0.9, 2.2, depth);
        r = 14 * (1 - f) + 3 * f;
        g = 142 * (1 - f) + 105 * f;
        b = 206 * (1 - f) + 161 * f;
      }

      if (turbidity > 0.01) {
        r = r * (1 - turbidity) + 132 * turbidity;
        g = g * (1 - turbidity) + 108 * turbidity;
        b = b * (1 - turbidity) + 84 * turbidity;
      }

      rgba[pIdx] = clamp255(r);
      rgba[pIdx + 1] = clamp255(g);
      rgba[pIdx + 2] = clamp255(b);
      rgba[pIdx + 3] = clamp255(alpha);
    }
  }
  return rgba;
}

function buildStormFootprintGeoJson(
  cp: CascadeSimParams,
  _uplandBbox: BBox | null | undefined,
  tab: TabId
): { fc: GeoFeatureCollection; visible: boolean; hasCenterDot: boolean } {
  if (tab !== 'sim') {
    return { fc: EMPTY_FC, visible: false, hasCenterDot: false };
  }
  if (cp.rainPattern === 'storm_core' && cp.stormCore) {
    const [lng, lat] = cp.stormCore;
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
      visible: true,
      hasCenterDot: true,
      fc: {
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
      }
    };
  }
  return { fc: EMPTY_FC, visible: false, hasCenterDot: false };
}

function setLayerVisibilityIfChanged(map: MapLibreMap, layerId: string, visible: boolean): void {
  if (!map.getLayer(layerId)) return;
  const nextVis = visible ? 'visible' : 'none';
  if (map.getLayoutProperty(layerId, 'visibility') !== nextVis) {
    map.setLayoutProperty(layerId, 'visibility', nextVis);
  }
}

export function syncWaterwaySimStyling(map: MapLibreMap, tab: TabId, isRaining: boolean): void {
  if (tab !== 'sim') {
    map.setPaintProperty('verified-waterways-casing', 'line-color', [
      'case',
      ['==', ['get', 'kind'], 'culvert'],
      '#334155',
      '#ffffff'
    ]);
    map.setPaintProperty(
      'verified-waterways-casing',
      'line-width',
      ['match', ['get', 'kind'], 'river', 6.4, 'stream', 5.2, 'culvert', 5.0, 4.2]
    );
    map.setPaintProperty('verified-waterways-casing', 'line-opacity', 0.9);
    map.setPaintProperty('verified-waterways-line', 'line-color', [
      'case',
      ['==', ['get', 'status'], 'clogged'],
      '#b45309',
      ['==', ['get', 'status'], 'damaged'],
      '#c2410c',
      ['==', ['get', 'status'], 'critical'],
      '#b91c1c',
      ['match', ['get', 'kind'], 'canal', '#0d9488', 'drain', '#0d9488', '#0369a1']
    ]);
    map.setPaintProperty(
      'verified-waterways-line',
      'line-width',
      ['match', ['get', 'kind'], 'river', 3.8, 'stream', 2.8, 2.3]
    );
    map.setPaintProperty('verified-waterways-line', 'line-opacity', 0.96);
    map.setPaintProperty('verified-culverts-line', 'line-opacity', 0.98);
    return;
  }

  // In Simulation, style the single unified solid hydro-blue watershed hierarchy with subtle wet deepening
  if (map.getLayer('sim-waterways-halo')) {
    map.setPaintProperty('sim-waterways-halo', 'line-width', isRaining ? 4.8 : 4.4);
    map.setPaintProperty('sim-waterways-halo', 'line-opacity', isRaining ? 0.36 : 0.28);
  }
  if (map.getLayer('sim-waterways-line')) {
    map.setPaintProperty(
      'sim-waterways-line',
      'line-color',
      isRaining
        ? ['match', ['get', 'order'], 1, '#154663', 2, '#225c7a', 3, '#33708e', '#4b849e']
        : ['match', ['get', 'order'], 1, '#1b5270', 2, '#286787', 3, '#3a7a99', '#538ca6']
    );
    map.setPaintProperty(
      'sim-waterways-line',
      'line-width',
      isRaining
        ? ['match', ['get', 'order'], 1, 3.2, 2, 1.9, 3, 1.3, 0.9]
        : ['match', ['get', 'order'], 1, 2.9, 2, 1.75, 3, 1.2, 0.85]
    );
    map.setPaintProperty(
      'sim-waterways-line',
      'line-opacity',
      isRaining
        ? ['match', ['get', 'order'], 1, 0.96, 2, 0.90, 3, 0.82, 0.62]
        : ['match', ['get', 'order'], 1, 0.94, 2, 0.88, 3, 0.80, 0.56]
    );
  }
}

export function syncSimulationOverlays(opts: {
  map: MapLibreMap;
  tab: TabId;
  isRaining: boolean;
  simPlaying: boolean;
  simMapViewMode: SimMapViewMode;
  datasets: LoadedDatasets;
  layers: LayerToggles;
  simRain: number;
  simDurationMin: number;
  simProgress: number;
  simScenario: 'clogged' | 'cleared';
  uplandBbox: BBox | null;
  meanSedimentCv: number;
  cascadeEngine: CascadeEngine | null;
  cascadeParams: CascadeSimParams;
  verifiedWaterways: VerifiedWaterwayFeature[];
  lastCascadeKeyRef: MutableRefObject<string>;
  lastCascadeTsRef: MutableRefObject<number>;
  lastFootprintKeyRef: MutableRefObject<string>;
  lastPoolEmptyRef: MutableRefObject<{ yard: boolean; knee: boolean; deep: boolean }>;
  canvasMorphsRef: MutableRefObject<CanvasMorphMap | null>;
}): () => void {
  const { map, isRaining, simPlaying, simMapViewMode, tab } = opts;

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
    setLayerVisibilityIfChanged(map, hid, isOn);
    if (isOn) map.setPaintProperty(hid, 'raster-opacity', handOpacity);
  }

  // Storm footprint (Storm Core or Upland rain focus) — only push GeoJSON when region/mode changes
  const cpForFootprint = opts.cascadeParams;
  const footprintCoreKey = cpForFootprint.stormCore
    ? `${cpForFootprint.stormCore[0].toFixed(4)},${cpForFootprint.stormCore[1].toFixed(4)}`
    : '';
  const footprintBboxKey = opts.uplandBbox
    ? `${opts.uplandBbox.west.toFixed(4)},${opts.uplandBbox.south.toFixed(4)}`
    : '';
  const footprintKey = `${tab}|${cpForFootprint.rainPattern}|${footprintCoreKey}|${footprintBboxKey}`;
  if (footprintKey !== opts.lastFootprintKeyRef.current) {
    opts.lastFootprintKeyRef.current = footprintKey;
    const footprint = buildStormFootprintGeoJson(cpForFootprint, opts.uplandBbox, tab);
    const stormCoreSrc = map.getSource('src-storm-core') as GeoJSONSource | undefined;
    if (stormCoreSrc) {
      stormCoreSrc.setData(asGeoInput(footprint.fc));
    }
    setLayerVisibilityIfChanged(map, 'storm-core-fill', footprint.visible);
    setLayerVisibilityIfChanged(map, 'storm-core-ring', footprint.visible);
    setLayerVisibilityIfChanged(map, 'storm-core-dot', footprint.hasCenterDot);
  }

  const showCascadeLayers = showFlood && useDynamicCascade;
  const showSurveyOnly = tab === 'sim' && simMapViewMode === 'survey' && useDynamicCascade;
  const showDepthTiers = showCascadeLayers && simMapViewMode === 'depth';

  setLayerVisibilityIfChanged(map, 'cascade-flood-overlay', showDepthTiers);
  setLayerVisibilityIfChanged(map, 'sim-pools-yard-fill', showDepthTiers);
  setLayerVisibilityIfChanged(map, 'sim-pools-yard-outline', showDepthTiers);
  setLayerVisibilityIfChanged(map, 'sim-pools-knee-fill', showDepthTiers);
  setLayerVisibilityIfChanged(map, 'sim-pools-knee-outline', showDepthTiers);
  setLayerVisibilityIfChanged(map, 'sim-pools-deep-fill', showDepthTiers);
  setLayerVisibilityIfChanged(map, 'cascade-agreement-overlay', showCascadeLayers && simMapViewMode === 'confidence');
  setLayerVisibilityIfChanged(map, 'cascade-landslide-overlay', showCascadeLayers && simMapViewMode !== 'survey');
  setLayerVisibilityIfChanged(map, 'sim-scour-reaches-line', showCascadeLayers && simMapViewMode === 'scour');
  setLayerVisibilityIfChanged(map, 'sim-survey-reaches-line', showSurveyOnly);

  const imgCoords = buildImageCoords(opts.datasets.bbox);

  let cascadeTimer: number | null = null;
  if (!showCascadeLayers && !showSurveyOnly) {
    opts.lastCascadeKeyRef.current = '';
    const yardSrc = map.getSource('src-sim-pools-yard') as GeoJSONSource | undefined;
    const kneeSrc = map.getSource('src-sim-pools-knee') as GeoJSONSource | undefined;
    const deepSrc = map.getSource('src-sim-pools-deep') as GeoJSONSource | undefined;
    const scourSrc = map.getSource('src-sim-scour-reaches') as GeoJSONSource | undefined;
    const surveySrc = map.getSource('src-sim-survey-reaches') as GeoJSONSource | undefined;
    if (yardSrc && !opts.lastPoolEmptyRef.current.yard) {
      yardSrc.setData(asGeoInput(EMPTY_FC));
      opts.lastPoolEmptyRef.current.yard = true;
    }
    if (kneeSrc && !opts.lastPoolEmptyRef.current.knee) {
      kneeSrc.setData(asGeoInput(EMPTY_FC));
      opts.lastPoolEmptyRef.current.knee = true;
    }
    if (deepSrc && !opts.lastPoolEmptyRef.current.deep) {
      deepSrc.setData(asGeoInput(EMPTY_FC));
      opts.lastPoolEmptyRef.current.deep = true;
    }
    if (scourSrc) scourSrc.setData(asGeoInput(EMPTY_FC));
    if (surveySrc) surveySrc.setData(asGeoInput(EMPTY_FC));

    const morphs = opts.canvasMorphsRef.current;
    if (morphs) {
      if (!morphs.flood.isEmpty) {
        flushCanvasImmediate(map, morphs.flood, 'img-cascade-flood', imgCoords, new Uint8Array(morphs.flood.current.length), true);
      }
      if (!morphs.landslide.isEmpty) {
        flushCanvasImmediate(map, morphs.landslide, 'img-cascade-landslide', imgCoords, new Uint8Array(morphs.landslide.current.length), true);
      }
      if (!morphs.agreement.isEmpty) {
        flushCanvasImmediate(map, morphs.agreement, 'img-cascade-agreement', imgCoords, new Uint8Array(morphs.agreement.current.length), true);
      }
    }
  } else if (opts.cascadeEngine) {
    const cp = opts.cascadeParams;
    const engine = opts.cascadeEngine;

    // Keep MapLibre WebGL 100% idle during active continuous playback so Canvas2D animations never stall.
    // Full hi-res 13.8m vector contours & 3D draped rasters update immediately on pause, scrub, or finish.
    if (simPlaying) {
      const yardSrc = map.getSource('src-sim-pools-yard') as GeoJSONSource | undefined;
      const kneeSrc = map.getSource('src-sim-pools-knee') as GeoJSONSource | undefined;
      const deepSrc = map.getSource('src-sim-pools-deep') as GeoJSONSource | undefined;
      if (yardSrc && !opts.lastPoolEmptyRef.current.yard) {
        yardSrc.setData(asGeoInput(EMPTY_FC));
        opts.lastPoolEmptyRef.current.yard = true;
      }
      if (kneeSrc && !opts.lastPoolEmptyRef.current.knee) {
        kneeSrc.setData(asGeoInput(EMPTY_FC));
        opts.lastPoolEmptyRef.current.knee = true;
      }
      if (deepSrc && !opts.lastPoolEmptyRef.current.deep) {
        deepSrc.setData(asGeoInput(EMPTY_FC));
        opts.lastPoolEmptyRef.current.deep = true;
      }
      const morphs = opts.canvasMorphsRef.current;
      if (morphs) {
        if (!morphs.flood.isEmpty) {
          flushCanvasImmediate(map, morphs.flood, 'img-cascade-flood', imgCoords, new Uint8Array(morphs.flood.current.length), true);
        }
        if (!morphs.landslide.isEmpty) {
          flushCanvasImmediate(map, morphs.landslide, 'img-cascade-landslide', imgCoords, new Uint8Array(morphs.landslide.current.length), true);
        }
        if (!morphs.agreement.isEmpty) {
          flushCanvasImmediate(map, morphs.agreement, 'img-cascade-agreement', imgCoords, new Uint8Array(morphs.agreement.current.length), true);
        }
      }
      return () => {};
    }

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
    const cacheKey = `${scenarioKey}::${simPlaying ? 'play' : 'rest'}::${cp.progress.toFixed(3)}`;
    const renderCascade = () => {
      opts.lastCascadeKeyRef.current = cacheKey;
      opts.lastCascadeTsRef.current = performance.now();
      engine.evaluate(cp, simPlaying ? { nominalOnly: true, skipValidation: true } : undefined);

      const yardSrc = map.getSource('src-sim-pools-yard') as GeoJSONSource | undefined;
      const kneeSrc = map.getSource('src-sim-pools-knee') as GeoJSONSource | undefined;
      const deepSrc = map.getSource('src-sim-pools-deep') as GeoJSONSource | undefined;
      const scourSrc = map.getSource('src-sim-scour-reaches') as GeoJSONSource | undefined;
      const surveySrc = map.getSource('src-sim-survey-reaches') as GeoJSONSource | undefined;
      const morphs = opts.canvasMorphsRef.current;

      if (simPlaying) {
        // Clear vector contour polygons once when entering playback; raster overlays render smoothly at ~2ms
        if (yardSrc && !opts.lastPoolEmptyRef.current.yard) {
          yardSrc.setData(asGeoInput(EMPTY_FC));
          opts.lastPoolEmptyRef.current.yard = true;
        }
        if (kneeSrc && !opts.lastPoolEmptyRef.current.knee) {
          kneeSrc.setData(asGeoInput(EMPTY_FC));
          opts.lastPoolEmptyRef.current.knee = true;
        }
        if (deepSrc && !opts.lastPoolEmptyRef.current.deep) {
          deepSrc.setData(asGeoInput(EMPTY_FC));
          opts.lastPoolEmptyRef.current.deep = true;
        }
      } else if (showCascadeLayers && simMapViewMode === 'depth') {
        const pools = extractFloodPoolPolygons(engine, opts.verifiedWaterways);
        const yardEmpty = pools.yard.features.length === 0;
        const kneeEmpty = pools.knee.features.length === 0;
        const deepEmpty = pools.deep.features.length === 0;
        if (yardSrc && !(yardEmpty && opts.lastPoolEmptyRef.current.yard)) {
          yardSrc.setData(asGeoInput(pools.yard));
          opts.lastPoolEmptyRef.current.yard = yardEmpty;
        }
        if (kneeSrc && !(kneeEmpty && opts.lastPoolEmptyRef.current.knee)) {
          kneeSrc.setData(asGeoInput(pools.knee));
          opts.lastPoolEmptyRef.current.knee = kneeEmpty;
        }
        if (deepSrc && !(deepEmpty && opts.lastPoolEmptyRef.current.deep)) {
          deepSrc.setData(asGeoInput(pools.deep));
          opts.lastPoolEmptyRef.current.deep = deepEmpty;
        }
        if (morphs) {
          const floodRgba = renderFilteredDepthRgba(
            pools.filteredDepth,
            pools.gridWidth,
            pools.gridHeight,
            morphs.flood.canvas.width,
            opts.meanSedimentCv,
            cp.debrisCoupling ?? 'clear'
          );
          pushBufferToImageSource(map, morphs.flood, 'img-cascade-flood', imgCoords, floodRgba);
        }
      }

      if (simMapViewMode === 'scour' || simMapViewMode === 'survey') {
        const diag = engine.buildReachDiagnosticsGeoJSON();
        if (scourSrc) scourSrc.setData(asGeoInput(diag.scourReaches));
        if (surveySrc) surveySrc.setData(asGeoInput(diag.surveyPriorityReaches));
      }

      if (showCascadeLayers && morphs) {
        const outSize = morphs.landslide.canvas.width;
        const { floodRgba, landslideRgba, agreementRgba } = engine.renderRgba(outSize);
        if (simPlaying && simMapViewMode === 'depth') {
          pushBufferToImageSource(map, morphs.flood, 'img-cascade-flood', imgCoords, floodRgba);
        }
        pushBufferToImageSource(map, morphs.landslide, 'img-cascade-landslide', imgCoords, landslideRgba);
        if (simMapViewMode === 'confidence') {
          pushBufferToImageSource(map, morphs.agreement, 'img-cascade-agreement', imgCoords, agreementRgba);
        }
      }
    };

    if (cacheKey !== opts.lastCascadeKeyRef.current) {
      const isScenarioSwitch = opts.lastCascadeKeyRef.current.split('::')[0] !== scenarioKey;
      const elapsed = performance.now() - opts.lastCascadeTsRef.current;
      const throttleMs = simPlaying ? 950 : 60;
      if (isScenarioSwitch || elapsed >= throttleMs) {
        renderCascade();
      } else {
        cascadeTimer = window.setTimeout(renderCascade, throttleMs - elapsed);
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
  opts: { tab: TabId; rainAnimEnabled: boolean; simProgress: number; simRain: number; isRecession?: boolean }
): void {
  const isStorm = opts.tab === 'sim' && opts.rainAnimEnabled && opts.simProgress > 0.02 && !opts.isRecession;
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
