import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GeoJSONSource,
  ImageSource,
  Map as MapLibreMap,
  Marker,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type FilterSpecification
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { APP_BRAND } from '../config/region';
import { useActiveRegion } from '../context/RegionContext';
import { buildFlowCorridors } from '../lib/flowRibbons';
import { computeRunoffMergeNetwork, haversineMeters, type MergedWaterwayReach } from '../lib/geometry';
import { registerLocalDemRegion } from '../lib/localTerrainProtocol';
import type { GeoFeature } from '../types/gis';
import { FlowFilamentOverlay } from './FlowFilamentOverlay';
import {
  attachInteractiveLayerHandlers,
  attachMapClickAndCursorHandlers,
  attachTelemetryAndControls,
  useMapToolOverlays
} from './map/mapInteractions';
import {
  addDataSourcesAndLayers,
  addStaticPlaceAndContourMarkers,
  applyBasemapContrastPalette,
  createInitialMapStyle
} from './map/mapSetup';
import {
  startFlowParticleLoop,
  syncSimulationOverlays,
  syncStormSky,
  syncWaterwaySimStyling
} from './map/mapSimulation';
import {
  asGeoInput,
  buildImageCoords,
  EMPTY_FC,
  HAND_LAYERS,
  type FlyRequest,
  type LoadedDatasets,
  type MapCameraState,
  type MapControlHandle,
  type MapLoadState,
  type MapViewProps
} from './map/types';
import type { BasemapId } from '../types/gis';
import { useMapEditing } from './map/useMapEditing';

export type { FlyRequest, LoadedDatasets, MapCameraState, MapControlHandle, MapLoadState };

setWorkerUrl(maplibreWorkerUrl);

function getBasemapSourceId(bm: BasemapId): string {
  switch (bm) {
    case 'sat':
      return 'src-sat';
    case 'topo':
      return 'src-topo';
    case 'osm':
      return 'src-osm';
    case 'elev':
      return 'img-elev';
    case 'relief':
      return 'img-relief';
    case 'slope':
      return 'img-slope';
  }
}

function isSourceLoadedSafe(map: MapLibreMap, sourceId: string): boolean {
  try {
    return Boolean(map.getSource(sourceId) && map.isSourceLoaded(sourceId));
  } catch {
    return false;
  }
}

const INITIAL_VISIBLE_VECTOR_SOURCES = [
  'src-settlements',
  'src-flows',
  'src-mask',
  'src-nagari-boundary',
  'src-verified-waterways',
  'src-verified-structures',
  'src-verified-merged-flow'
] as const;

export function MapView(props: MapViewProps) {
  const region = useActiveRegion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLoadedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const lastTerrainExagRef = useRef<number | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const contourMarkersRef = useRef<{ marker: Marker; el: HTMLElement }[]>([]);

  const activeToolRef = useRef(props.activeTool);
  activeToolRef.current = props.activeTool;
  const langRef = useRef(props.lang);
  langRef.current = props.lang;
  const viewModeRef = useRef(props.viewMode);
  viewModeRef.current = props.viewMode;
  const demRef = useRef(props.demClient);
  demRef.current = props.demClient;
  const onMapClickRef = useRef(props.onMapClick);
  onMapClickRef.current = props.onMapClick;
  const onCursorRef = useRef(props.onCursorTelemetry);
  onCursorRef.current = props.onCursorTelemetry;
  const onCameraChangeRef = useRef(props.onCameraChange);
  onCameraChangeRef.current = props.onCameraChange;
  const onSelectJorongPillRef = useRef(props.onSelectJorongPill);
  onSelectJorongPillRef.current = props.onSelectJorongPill;
  const controlRefProp = useRef(props.controlRef);
  controlRefProp.current = props.controlRef;
  const tabRef = useRef(props.tab);
  tabRef.current = props.tab;
  const basemapRef = useRef(props.basemap);
  basemapRef.current = props.basemap;
  const simProgressRef = useRef(props.simProgress);
  simProgressRef.current = props.simProgress;
  const cascadeEngineRef = useRef(props.cascadeEngine);
  cascadeEngineRef.current = props.cascadeEngine;
  const cascadeParamsRef = useRef(props.cascadeParams);
  cascadeParamsRef.current = props.cascadeParams;
  const [poolGlintPoints, setPoolGlintPoints] = useState<[number, number][]>([]);
  const lastSkyKeyRef = useRef('');
  const landslideCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const agreementCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCascadeTsRef = useRef(0);
  const lastCascadeKeyRef = useRef('');

  const corridors = useMemo(
    () =>
      buildFlowCorridors(
        props.verifiedWaterways,
        props.datasets.flowPaths,
        props.suppressedDemIds,
        (lng, lat) => props.demClient.getElevation(lng, lat),
        props.datasets.agamRbiRivers,
        {
          includeVerified: props.layers.verifiedWaterways,
          includeRbi: props.layers.agamRbiRivers,
          nagariBoundary: props.datasets.nagariBoundary
        }
      ),
    [
      props.verifiedWaterways,
      props.datasets.flowPaths,
      props.datasets.agamRbiRivers,
      props.datasets.nagariBoundary,
      props.suppressedDemIds,
      props.demClient,
      props.layers.verifiedWaterways,
      props.layers.agamRbiRivers
    ]
  );

  const editorUnlockedRef = useRef(props.editorUnlocked);
  editorUnlockedRef.current = props.editorUnlocked;
  const verifiedWaterwaysRef = useRef(props.verifiedWaterways);
  verifiedWaterwaysRef.current = props.verifiedWaterways;
  const verifiedStructuresRef = useRef(props.verifiedStructures);
  verifiedStructuresRef.current = props.verifiedStructures;
  const suppressedDemSetRef = useRef(new Set(props.suppressedDemIds));
  suppressedDemSetRef.current = new Set(props.suppressedDemIds);
  const editingWaterwayRef = useRef(props.editingWaterway);
  editingWaterwayRef.current = props.editingWaterway;
  const onSelectWaterwayRef = useRef(props.onSelectWaterway);
  onSelectWaterwayRef.current = props.onSelectWaterway;
  const onSelectStructureRef = useRef(props.onSelectStructure);
  onSelectStructureRef.current = props.onSelectStructure;
  const onVerifyCrossingRef = useRef(props.onVerifyCrossing);
  onVerifyCrossingRef.current = props.onVerifyCrossing;
  const onMoveEditingStructureRef = useRef(props.onMoveEditingStructure);
  onMoveEditingStructureRef.current = props.onMoveEditingStructure;
  const onPromoteDemRef = useRef(props.onPromoteDemSegment);
  onPromoteDemRef.current = props.onPromoteDemSegment;
  const onPromoteRbiRef = useRef(props.onPromoteRbiRiver);
  onPromoteRbiRef.current = props.onPromoteRbiRiver;
  const onSuppressDemRef = useRef(props.onSuppressDemSegment);
  onSuppressDemRef.current = props.onSuppressDemSegment;
  const onChangeEditingCoordsRef = useRef(props.onChangeEditingCoords);
  onChangeEditingCoordsRef.current = props.onChangeEditingCoords;
  const datasetsRef = useRef(props.datasets);
  datasetsRef.current = props.datasets;
  const layersRef = useRef(props.layers);
  layersRef.current = props.layers;
  const apiAvailableRef = useRef(props.apiAvailable);
  apiAvailableRef.current = props.apiAvailable;
  const requiresPassphraseRef = useRef(props.requiresPassphrase);
  requiresPassphraseRef.current = props.requiresPassphrase;
  const onOpenUnlockRef = useRef(props.onOpenUnlock);
  onOpenUnlockRef.current = props.onOpenUnlock;
  const onRedrawDemRef = useRef(props.onRedrawDemSegment);
  onRedrawDemRef.current = props.onRedrawDemSegment;
  const onSetStructureBlockageOverrideRef = useRef(props.onSetStructureBlockageOverride);
  onSetStructureBlockageOverrideRef.current = props.onSetStructureBlockageOverride;
  const onSnapFeedbackRef = useRef(props.onSnapFeedback);
  onSnapFeedbackRef.current = props.onSnapFeedback;
  const animPathsRef = useRef<GeoFeature[]>([]);
  const flowAnimActiveRef = useRef(false);
  const mergedReachesRef = useRef<MergedWaterwayReach[]>([]);
  const mergingFlowIdsRef = useRef<Set<string>>(new Set());
  const particlesClearedRef = useRef(true);
  const isDraggingVertexRef = useRef(false);
  const isRaining = props.tab === 'sim' && props.simProgress > 0.02;
  const onLoadStateChangeRef = useRef(props.onLoadStateChange);
  onLoadStateChangeRef.current = props.onLoadStateChange;
  const activeBasemapRef = useRef(props.basemap);
  activeBasemapRef.current = props.basemap;
  const is3DRef = useRef(props.is3D);
  is3DRef.current = props.is3D;
  const prevBasemapRef = useRef<BasemapId>(props.basemap);
  const basemapCleanupRef = useRef<(() => void) | null>(null);
  const hydratedSyncedRef = useRef(false);
  const loadStateRef = useRef<MapLoadState>({
    styleReady: false,
    initialTilesReady: false,
    initialTimedOut: false,
    tileProgress: 0,
    basemapSwitching: false,
    basemapTimedOut: false,
    activeBasemap: props.basemap
  });

  const emitLoadState = (patch: Partial<MapLoadState>) => {
    loadStateRef.current = { ...loadStateRef.current, ...patch };
    onLoadStateChangeRef.current?.({ ...loadStateRef.current });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    hydratedSyncedRef.current = false;
    emitLoadState({
      styleReady: false,
      initialTilesReady: false,
      initialTimedOut: false,
      tileProgress: 0,
      basemapSwitching: false,
      basemapTimedOut: false,
      activeBasemap: props.basemap
    });

    registerLocalDemRegion(props.region.id, props.demClient);

    const { bbox, center } = props.datasets;
    const pad = 0.02;
    const centerPreset = props.region.cameraPresets[0];
    const map = new MapLibreMap({
      container: containerRef.current,
      style: createInitialMapStyle(bbox, props.dataBasePath, props.region.id),
      center,
      zoom: props.region.defaultView.zoom ?? 15.6,
      minZoom: 11.4,
      maxZoom: 19,
      maxBounds: [
        [bbox.west - pad, bbox.south - pad],
        [bbox.east + pad, bbox.north + pad]
      ],
      pitch: props.is3D ? (centerPreset?.pitch3D ?? 36) : 0,
      bearing: props.is3D ? (centerPreset?.bearing3D ?? -12) : 0,
      maxPitch: 66,
      attributionControl: false
    });
    mapRef.current = map;

    const telemetryControls = attachTelemetryAndControls(map, containerRef, controlRefProp, onCameraChangeRef);
    const interactionRefs = {
      popupRef,
      activeToolRef,
      langRef,
      viewModeRef,
      demRef,
      tabRef,
      simProgressRef,
      cascadeEngineRef,
      cascadeParamsRef,
      editorUnlockedRef,
      apiAvailableRef,
      requiresPassphraseRef,
      datasetsRef,
      verifiedWaterwaysRef,
      verifiedStructuresRef,
      editingWaterwayRef,
      isDraggingVertexRef,
      onMapClickRef,
      onCursorRef,
      onOpenUnlockRef,
      onSelectStructureRef,
      onSelectWaterwayRef,
      onVerifyCrossingRef,
      onRedrawDemRef,
      onPromoteDemRef,
      onSuppressDemRef,
      onPromoteRbiRef,
      onSetStructureBlockageOverrideRef,
      onSnapFeedbackRef
    };

    let stopParticles: (() => void) | null = null;
    let layersMounted = false;
    let initialFinished = false;
    let settlingInitial = false;
    let outerTimeoutId: number | null = null;
    let initialTimeoutId: number | null = null;
    let initialRafId: number | null = null;
    let settleRaf1: number | null = null;
    let settleRaf2: number | null = null;
    let initialPollId: number | null = null;

    const onSettleRender = () => {
      if (initialFinished) return;
      settleRaf1 = requestAnimationFrame(() => {
        if (initialFinished) return;
        settleRaf2 = requestAnimationFrame(() => {
          finishInitialLoad(false);
        });
      });
    };

    const cleanupInitialWatchers = () => {
      if (outerTimeoutId !== null) {
        window.clearTimeout(outerTimeoutId);
        outerTimeoutId = null;
      }
      if (initialTimeoutId !== null) {
        window.clearTimeout(initialTimeoutId);
        initialTimeoutId = null;
      }
      if (initialRafId !== null) {
        cancelAnimationFrame(initialRafId);
        initialRafId = null;
      }
      if (settleRaf1 !== null) {
        cancelAnimationFrame(settleRaf1);
        settleRaf1 = null;
      }
      if (settleRaf2 !== null) {
        cancelAnimationFrame(settleRaf2);
        settleRaf2 = null;
      }
      if (initialPollId !== null) {
        window.clearInterval(initialPollId);
        initialPollId = null;
      }
      map.off('style.load', onStyleLoad);
      map.off('sourcedata', onSourceData);
      map.off('render', onSettleRender);
    };

    const finishInitialLoad = (timedOut: boolean) => {
      if (initialFinished) return;
      initialFinished = true;
      cleanupInitialWatchers();
      emitLoadState({
        styleReady: true,
        initialTilesReady: true,
        initialTimedOut: timedOut,
        tileProgress: 1
      });
    };

    const checkInitialReady = () => {
      if (initialFinished || settlingInitial || !mapLoadedRef.current || !hydratedSyncedRef.current) return;
      const ready =
        isSourceLoadedSafe(map, getBasemapSourceId(activeBasemapRef.current)) &&
        (!is3DRef.current || isSourceLoadedSafe(map, 'dem-terrain')) &&
        INITIAL_VISIBLE_VECTOR_SOURCES.every(id => isSourceLoadedSafe(map, id));
      if (ready) {
        settlingInitial = true;
        if (initialPollId !== null) {
          window.clearInterval(initialPollId);
          initialPollId = null;
        }
        map.once('render', onSettleRender);
        map.triggerRepaint();
      }
    };

    const onSourceData = (e: {
      dataType?: string;
      sourceId?: string;
      isSourceLoaded?: boolean;
      tile?: unknown;
    }) => {
      if (initialFinished || e.sourceId === 'src-flow-particles') return;
      if (e.dataType === 'source' && (e.tile || e.isSourceLoaded)) {
        const cap = mapLoadedRef.current ? 0.96 : 0.85;
        const prev = loadStateRef.current.tileProgress;
        const next = Math.min(cap, prev + (cap - prev) * 0.22);
        if (next > prev) {
          emitLoadState({ tileProgress: next });
        }
      }
      if (mapLoadedRef.current) {
        checkInitialReady();
      }
    };

    const onStyleLoad = () => {
      if (layersMounted) return;
      layersMounted = true;
      if (outerTimeoutId !== null) {
        window.clearTimeout(outerTimeoutId);
        outerTimeoutId = null;
      }
      if (!initialFinished && initialTimeoutId === null) {
        initialTimeoutId = window.setTimeout(() => finishInitialLoad(true), 12_000);
      }

      const ds = props.datasets;
      addDataSourcesAndLayers(map, ds, activeBasemapRef.current);
      contourMarkersRef.current = addStaticPlaceAndContourMarkers(map, ds, {
        region: props.region,
        activeToolRef,
        onSelectJorongPillRef
      });
      attachInteractiveLayerHandlers(map, interactionRefs);

      animPathsRef.current = ds.flowPaths.features
        .filter((f: GeoFeature) => f.geometry.type === 'LineString' && Number(f.properties?.tier) <= 2)
        .sort((a: GeoFeature, b: GeoFeature) => Number(b.properties?.length_m || 0) - Number(a.properties?.length_m || 0))
        .slice(0, 38);

      stopParticles = startFlowParticleLoop(map, {
        flowAnimActiveRef,
        particlesClearedRef,
        animPathsRef,
        suppressedDemSetRef,
        mergingFlowIdsRef,
        layersRef,
        mergedReachesRef,
        verifiedWaterwaysRef
      });

      mapLoadedRef.current = true;
      setMapReady(true);
      telemetryControls.emitCamera(true);
      emitLoadState({
        styleReady: true,
        tileProgress: Math.max(loadStateRef.current.tileProgress, 0.2)
      });
      initialRafId = requestAnimationFrame(() => checkInitialReady());
      if (!initialFinished) {
        initialPollId = window.setInterval(checkInitialReady, 150);
      }
    };

    outerTimeoutId = window.setTimeout(() => finishInitialLoad(true), 15_000);
    map.on('sourcedata', onSourceData);
    map.once('style.load', onStyleLoad);

    attachMapClickAndCursorHandlers(map, interactionRefs);

    return () => {
      cleanupInitialWatchers();
      basemapCleanupRef.current?.();
      basemapCleanupRef.current = null;
      telemetryControls.cleanup();
      stopParticles?.();
      hydratedSyncedRef.current = false;
      mapLoadedRef.current = false;
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync surfaces, smooth overlays, filters, and terrain exaggeration
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !mapReady || !map.getLayer('basemap-sat')) return;

    const vis = (on: boolean) => (on ? 'visible' : 'none');

    // CutSheetRX Surface Modes & Basemaps
    map.setLayoutProperty('basemap-sat', 'visibility', vis(props.basemap === 'sat'));
    map.setLayoutProperty('basemap-topo', 'visibility', vis(props.basemap === 'topo'));
    map.setLayoutProperty('basemap-osm', 'visibility', vis(props.basemap === 'osm'));
    map.setLayoutProperty('surface-relief', 'visibility', vis(props.basemap === 'relief' || props.basemap === 'slope'));
    map.setLayoutProperty('surface-elev', 'visibility', vis(props.basemap === 'elev'));
    map.setLayoutProperty('surface-slope-base', 'visibility', vis(props.basemap === 'slope'));

    if (prevBasemapRef.current !== props.basemap) {
      const nextBm = props.basemap;
      prevBasemapRef.current = nextBm;
      basemapCleanupRef.current?.();
      basemapCleanupRef.current = null;

      if (loadStateRef.current.initialTilesReady) {
        const targetSourceId = getBasemapSourceId(nextBm);
        let settled = false;
        let started = false;
        let settleCheckTimer: number | null = null;
        let settleRaf = 0;
        let pollId: number | null = null;
        let timeoutId: number | null = null;
        let renderTriggered = false;

        const cleanupWatcher = () => {
          settled = true;
          if (settleCheckTimer !== null) window.clearTimeout(settleCheckTimer);
          if (settleRaf) cancelAnimationFrame(settleRaf);
          if (pollId !== null) window.clearInterval(pollId);
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          map.off('sourcedataloading', onSourceDataLoading);
          map.off('sourcedata', onBmSourceData);
          map.off('render', onBmRender);
        };

        const finishSwitch = (timedOut: boolean) => {
          if (settled) return;
          const wasStarted = started;
          cleanupWatcher();
          basemapCleanupRef.current = null;
          if (wasStarted) {
            emitLoadState({
              basemapSwitching: false,
              basemapTimedOut: timedOut,
              activeBasemap: nextBm
            });
          }
        };

        const beginTracking = () => {
          if (settled || started) return;
          started = true;
          if (settleCheckTimer !== null) {
            window.clearTimeout(settleCheckTimer);
            settleCheckTimer = null;
          }
          map.off('render', onBmRender);
          emitLoadState({
            basemapSwitching: true,
            basemapTimedOut: false,
            activeBasemap: nextBm
          });
          timeoutId = window.setTimeout(() => finishSwitch(true), 10_000);
          pollId = window.setInterval(() => {
            if (!settled && isSourceLoadedSafe(map, targetSourceId)) {
              settleRaf = requestAnimationFrame(() => finishSwitch(false));
            }
          }, 150);
        };

        const onSourceDataLoading = (e: { sourceId?: string }) => {
          if (!settled && e.sourceId === targetSourceId) {
            beginTracking();
          }
        };

        const onBmSourceData = (e: { sourceId?: string }) => {
          if (settled || e.sourceId !== targetSourceId) return;
          if (!started && !isSourceLoadedSafe(map, targetSourceId)) {
            beginTracking();
          } else if (started && isSourceLoadedSafe(map, targetSourceId)) {
            settleRaf = requestAnimationFrame(() => finishSwitch(false));
          }
        };

        const onBmRender = () => {
          if (settled || started || renderTriggered) return;
          renderTriggered = true;
          if (!isSourceLoadedSafe(map, targetSourceId)) {
            beginTracking();
          }
        };

        map.on('sourcedataloading', onSourceDataLoading);
        map.on('sourcedata', onBmSourceData);
        map.on('render', onBmRender);
        basemapCleanupRef.current = cleanupWatcher;
        map.triggerRepaint();

        // Give MapLibre time to render and queue tiles for the newly enabled basemap
        settleCheckTimer = window.setTimeout(() => {
          if (settled || started) return;
          if (isSourceLoadedSafe(map, targetSourceId)) {
            cleanupWatcher();
            basemapCleanupRef.current = null;
            emitLoadState({
              basemapSwitching: false,
              basemapTimedOut: false,
              activeBasemap: nextBm
            });
          } else {
            beginTracking();
          }
        }, 450);
      }
    }

    map.setLayoutProperty('hillshade-layer', 'visibility', vis(props.layers.hillshade));
    const nextExag = props.is3D ? props.exaggeration : 0.4;
    if (nextExag !== lastTerrainExagRef.current) {
      map.setTerrain({ source: 'dem-terrain', exaggeration: nextExag });
      lastTerrainExagRef.current = nextExag;
    }

    map.setLayoutProperty('nagari-boundary-casing', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('nagari-boundary-line', 'visibility', vis(props.layers.das));
    if (map.getLayer('sub-boundaries-casing')) {
      map.setLayoutProperty('sub-boundaries-casing', 'visibility', vis(props.layers.das));
    }
    if (map.getLayer('sub-boundaries-line')) {
      map.setLayoutProperty('sub-boundaries-line', 'visibility', vis(props.layers.das));
    }
    map.setLayoutProperty('jorong-fill', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('jorong-casing', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('jorong-line', 'visibility', vis(props.layers.das));
    const showSettlements = props.layers.settlements && props.tab !== 'sim';
    map.setLayoutProperty('settlements-residential-fill', 'visibility', vis(showSettlements));
    map.setLayoutProperty('settlements-buildings-fill', 'visibility', vis(showSettlements));
    map.setLayoutProperty('settlements-buildings-line', 'visibility', vis(showSettlements));
    map.setLayoutProperty('landcover-overlay', 'visibility', vis(props.layers.landCover));
    map.setLayoutProperty('scour-change-overlay', 'visibility', vis(props.layers.scourChange));
    map.setLayoutProperty('agam-landslide-fill', 'visibility', vis(props.layers.agamLandslide));
    map.setLayoutProperty('agam-landslide-casing', 'visibility', vis(props.layers.agamLandslide));
    map.setLayoutProperty('agam-landslide-line', 'visibility', vis(props.layers.agamLandslide));
    map.setLayoutProperty('agam-forest-fill', 'visibility', vis(props.layers.agamForestStatus));
    map.setLayoutProperty('agam-forest-casing', 'visibility', vis(props.layers.agamForestStatus));
    map.setLayoutProperty('agam-forest-line', 'visibility', vis(props.layers.agamForestStatus));
    map.setLayoutProperty('agam-soil-fill', 'visibility', vis(props.layers.agamSoilGeology));
    map.setLayoutProperty('agam-soil-casing', 'visibility', vis(props.layers.agamSoilGeology));
    map.setLayoutProperty('agam-soil-line', 'visibility', vis(props.layers.agamSoilGeology));
    map.setLayoutProperty('agam-rbi-casing', 'visibility', vis(props.layers.agamRbiRivers));
    map.setLayoutProperty('agam-rbi-line', 'visibility', vis(props.layers.agamRbiRivers));
    map.setLayoutProperty('contours-casing', 'visibility', vis(props.layers.contours));
    map.setLayoutProperty('contours-line', 'visibility', vis(props.layers.contours));

    const jbSrc = map.getSource('src-jorong-boundaries') as GeoJSONSource | undefined;
    if (jbSrc) {
      jbSrc.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: props.jorongBoundaries as unknown as GeoFeature[]
        })
      );
    }
    contourMarkersRef.current.forEach(c => {
      c.el.style.display = props.layers.contours ? 'block' : 'none';
    });
    map.setLayoutProperty('slope-overlay', 'visibility', vis(props.layers.slope && props.basemap !== 'slope'));
    map.setLayoutProperty('osm-roads-casing', 'visibility', vis(props.layers.osmContext));
    map.setLayoutProperty('osm-roads', 'visibility', vis(props.layers.osmContext));
    map.setLayoutProperty('verified-waterways-casing', 'visibility', vis(props.layers.verifiedWaterways));
    map.setLayoutProperty('verified-waterways-line', 'visibility', vis(props.layers.verifiedWaterways));
    map.setLayoutProperty('verified-culverts-line', 'visibility', vis(props.layers.verifiedWaterways));
    map.setLayoutProperty('verified-waterways-arrows', 'visibility', vis(props.layers.verifiedWaterways && !isRaining));
    syncWaterwaySimStyling(map, isRaining);

    const wwSrc = map.getSource('src-verified-waterways') as GeoJSONSource | undefined;
    if (wwSrc) {
      wwSrc.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: props.verifiedWaterways as unknown as GeoFeature[]
        })
      );
    }

    const stSrc = map.getSource('src-verified-structures') as GeoJSONSource | undefined;
    if (stSrc) {
      const filteredStructures =
        props.tab === 'drainage' && props.drainFilter !== 'all'
          ? props.verifiedStructures.filter(s => s.properties.status === props.drainFilter)
          : props.verifiedStructures;
      stSrc.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: filteredStructures as unknown as GeoFeature[]
        })
      );
    }
    const showStructures =
      props.tab === 'drainage' || props.tab === 'editor' ? true : props.layers.structures;
    map.setLayoutProperty('verified-structures-symbol', 'visibility', vis(showStructures));

    const showStressRings =
      !isRaining &&
      showStructures &&
      props.verifiedStructures.some(s => ['clogged', 'damaged', 'critical'].includes(s.properties.status));
    map.setLayoutProperty('verified-structures-stress-ring', 'visibility', vis(showStressRings));
    if (showStressRings) {
      map.setFilter(
        'verified-structures-stress-ring',
        ['in', ['get', 'status'], ['literal', ['clogged', 'damaged', 'critical']]]
      );
    }

    const maxTier = props.flowDensity;
    const flowVis = maxTier > 0;
    const flowAnimActive = props.tab !== 'sim' && props.flowDensity > 0;
    flowAnimActiveRef.current = flowAnimActive;

    map.setLayoutProperty('flows-glow', 'visibility', vis(flowVis));
    map.setLayoutProperty('flows-line', 'visibility', vis(flowVis));
    map.setLayoutProperty('flows-arrows', 'visibility', vis(flowVis));
    map.setLayoutProperty('flow-particles', 'visibility', vis(flowAnimActive));
    if (flowVis) {
      const tierExpr: ExpressionSpecification = ['<=', ['get', 'tier'], maxTier];
      const flowFilter: FilterSpecification =
        props.suppressedDemIds.length > 0
          ? ['all', tierExpr, ['!', ['in', ['get', 'id'], ['literal', props.suppressedDemIds]]]]
          : tierExpr;
      map.setFilter('flows-glow', flowFilter);
      map.setFilter('flows-line', flowFilter);
      map.setFilter('flows-arrows', flowFilter);
    }

    const suppressedSet = new Set(props.suppressedDemIds);
    const visibleFlows = flowVis
      ? props.datasets.flowPaths.features.filter(
          f =>
            f.geometry.type === 'LineString' &&
            Number(f.properties?.tier || 2) <= maxTier &&
            !suppressedSet.has(String(f.properties?.id || ''))
        )
      : [];

    const mergedSrc = map.getSource('src-verified-merged-flow') as GeoJSONSource | undefined;
    const confSrc = map.getSource('src-runoff-confluences') as GeoJSONSource | undefined;

    if (flowVis && props.layers.verifiedWaterways) {
      const mergeNet = computeRunoffMergeNetwork(visibleFlows, props.verifiedWaterways, 45);
      mergedReachesRef.current = mergeNet.mergedReaches;
      mergingFlowIdsRef.current = mergeNet.mergingFlowIds;
      if (mergedSrc) {
        mergedSrc.setData(
          asGeoInput({
            type: 'FeatureCollection',
            features: mergeNet.mergedReaches.map(r => ({
              type: 'Feature',
              properties: {
                kind: r.kind,
                status: r.status,
                waterwayId: r.waterwayId,
                directRunoff: r.directRunoff
              },
              geometry: { type: 'LineString', coordinates: r.coordinates }
            }))
          })
        );
      }
      if (confSrc) {
        confSrc.setData(
          asGeoInput({
            type: 'FeatureCollection',
            features: mergeNet.confluences.map(c => ({
              type: 'Feature',
              properties: {
                waterwayId: c.waterwayId,
                waterwayName: c.waterwayName,
                maxTier: c.maxTier
              },
              geometry: { type: 'Point', coordinates: c.coordinates }
            }))
          })
        );
      }
      map.setLayoutProperty('verified-waterways-merged-glow', 'visibility', 'visible');
      map.setLayoutProperty('runoff-confluences-ring', 'visibility', 'visible');
      map.setLayoutProperty('runoff-confluences-dot', 'visibility', 'visible');
      map.setPaintProperty(
        'verified-waterways-merged-glow',
        'line-opacity',
        isRaining ? 0.56 : 0.42
      );
    } else {
      mergedReachesRef.current = [];
      mergingFlowIdsRef.current = new Set();
      if (mergedSrc) mergedSrc.setData(asGeoInput(EMPTY_FC));
      if (confSrc) confSrc.setData(asGeoInput(EMPTY_FC));
      map.setLayoutProperty('verified-waterways-merged-glow', 'visibility', 'none');
      map.setLayoutProperty('runoff-confluences-ring', 'visibility', 'none');
      map.setLayoutProperty('runoff-confluences-dot', 'visibility', 'none');
    }

    const mergingSet = mergingFlowIdsRef.current;
    animPathsRef.current = [...visibleFlows]
      .sort((a, b) => {
        const am = mergingSet.has(String(a.properties?.id || '')) ? 1 : 0;
        const bm = mergingSet.has(String(b.properties?.id || '')) ? 1 : 0;
        if (am !== bm) return bm - am;
        return Number(b.properties?.length_m || 0) - Number(a.properties?.length_m || 0);
      })
      .slice(0, 60);

    const calSrc = map.getSource('src-calibration-marks') as GeoJSONSource | undefined;
    if (calSrc) {
      calSrc.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: props.calibrationMarks as unknown as GeoFeature[]
        })
      );
    }
    const showCalMarks =
      props.calibrationMarks.length > 0 && (props.tab === 'editor' || (props.tab === 'sim' && props.viewMode === 'detail'));
    if (map.getLayer('calibration-marks-circle')) {
      map.setLayoutProperty('calibration-marks-circle', 'visibility', vis(showCalMarks));
    }

    // Draft Crossings (filtered to hide points already covered by verified structures) & Hazard/Evac Points
    const draftSrc = map.getSource('src-draft-pts') as GeoJSONSource | undefined;
    if (draftSrc) {
      const verifiedRefSet = new Set(
        props.verifiedStructures.map(s => s.properties.source_ref).filter(Boolean).map(String)
      );
      const dedupedDrafts = props.datasets.drainageDraft.features.filter(f => {
        if (f.properties?.kind !== 'drainage') return true;
        const fId = String(f.properties?.id || '');
        if (verifiedRefSet.has(fId)) return false;
        if (f.geometry.type === 'Point') {
          const coords = f.geometry.coordinates;
          if (
            props.verifiedStructures.some(
              s =>
                haversineMeters(
                  coords[0],
                  coords[1],
                  s.geometry.coordinates[0],
                  s.geometry.coordinates[1]
                ) <= 45
            )
          ) {
            return false;
          }
        }
        return true;
      });
      draftSrc.setData(asGeoInput({ type: 'FeatureCollection', features: dedupedDrafts }));
    }

    const showDraftPts =
      !isRaining &&
      (props.tab === 'drainage' ||
        (props.tab === 'editor' && props.layers.unverifiedCrossings) ||
        (props.tab === 'terrain' && props.layers.unverifiedCrossings));
    map.setLayoutProperty('draft-points', 'visibility', vis(showDraftPts));
    if (showDraftPts) {
      const anyClauses: ExpressionSpecification[] = [];
      if (props.tab === 'terrain' || props.tab === 'editor') {
        anyClauses.push(['==', ['get', 'kind'], 'drainage']);
      } else if (props.tab === 'sim') {
        anyClauses.push(['==', ['get', 'kind'], 'drainage']);
        if (props.layers.evac) anyClauses.push(['==', ['get', 'kind'], 'evacuation']);
      } else {
        if (props.drainFilter === 'all') {
          anyClauses.push(['==', ['get', 'kind'], 'drainage']);
        } else {
          anyClauses.push(['all', ['==', ['get', 'kind'], 'drainage'], ['==', ['get', 'status'], props.drainFilter]]);
        }
        if (props.layers.landslide) anyClauses.push(['==', ['get', 'kind'], 'landslide']);
        if (props.layers.evac) anyClauses.push(['==', ['get', 'kind'], 'evacuation']);
      }
      map.setFilter('draft-points', ['any', ...anyClauses] as FilterSpecification);
    }
    if (props.editorHydrated) {
      hydratedSyncedRef.current = true;
    }
  }, [
    mapReady,
    props.editorHydrated,
    props.basemap,
    props.is3D,
    props.exaggeration,
    props.layers,
    props.flowDensity,
    props.tab,
    isRaining,
    props.lang,
    props.viewMode,
    props.rainAnimEnabled,
    props.drainFilter,
    props.verifiedWaterways,
    props.verifiedStructures,
    props.jorongBoundaries,
    props.calibrationMarks,
    props.datasets.drainageDraft,
    props.datasets.flowPaths,
    props.suppressedDemIds
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !mapReady || !map.getLayer('basemap-sat')) return;
    return syncSimulationOverlays({
      map,
      tab: props.tab,
      isRaining,
      simMapViewMode: props.simMapViewMode,
      datasets: props.datasets,
      layers: props.layers,
      simRain: props.simRain,
      simDurationMin: props.simDurationMin,
      simProgress: props.simProgress,
      simScenario: props.simScenario,
      cascadeEngine: props.cascadeEngine,
      cascadeParams: props.cascadeParams,
      verifiedWaterways: props.verifiedWaterways,
      lastCascadeKeyRef,
      lastCascadeTsRef,
      landslideCanvasRef,
      agreementCanvasRef,
      setPoolGlintPoints
    });
  }, [
    mapReady,
    props.tab,
    isRaining,
    props.simMapViewMode,
    props.datasets,
    props.layers,
    props.simRain,
    props.simDurationMin,
    props.simProgress,
    props.simScenario,
    props.cascadeEngine,
    props.cascadeParams,
    props.verifiedWaterways
  ]);

  const quantizedSkyProgress = Math.round(props.simProgress * 10) / 10;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    syncStormSky(map, lastSkyKeyRef, {
      tab: props.tab,
      rainAnimEnabled: props.rainAnimEnabled,
      simProgress: quantizedSkyProgress,
      simRain: props.simRain
    });
  }, [mapReady, props.tab, props.rainAnimEnabled, quantizedSkyProgress, props.simRain]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    applyBasemapContrastPalette(map, props.basemap, props.tab, isRaining ? 1 : 0);
  }, [mapReady, props.basemap, props.tab, isRaining]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    map.easeTo({
      pitch: props.is3D ? 36 : 0,
      bearing: props.is3D ? -12 : 0,
      duration: 600
    });
  }, [mapReady, props.is3D]);

  // Refresh recomputed flow paths, drainage crossings, and HAND flood rasters live
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    animPathsRef.current = props.datasets.flowPaths.features
      .filter((f: GeoFeature) => f.geometry.type === 'LineString' && Number(f.properties?.tier) <= 2)
      .sort((a: GeoFeature, b: GeoFeature) => Number(b.properties?.length_m || 0) - Number(a.properties?.length_m || 0))
      .slice(0, 38);

    const flowSrc = map.getSource('src-flows') as GeoJSONSource | undefined;
    if (flowSrc) flowSrc.setData(asGeoInput(props.datasets.flowPaths));

    const draftSrc = map.getSource('src-draft-pts') as GeoJSONSource | undefined;
    if (draftSrc) draftSrc.setData(asGeoInput(props.datasets.drainageDraft));

    if (props.dataVersion > 0) {
      const imgCoords = buildImageCoords(props.datasets.bbox);
      const base = props.dataBasePath.replace(/\/+$/, '');
      for (const hid of HAND_LAYERS) {
        const imgSrc = map.getSource(`img-${hid}`) as ImageSource | undefined;
        if (imgSrc && typeof imgSrc.updateImage === 'function') {
          imgSrc.updateImage({
            url: `${base}/raster-${hid}.png?v=${props.dataVersion}`,
            coordinates: imgCoords
          });
        }
      }
    }
  }, [mapReady, props.dataVersion, props.datasets]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.flyRequest) return;
    map.flyTo({
      center: props.flyRequest.center,
      zoom: props.flyRequest.zoom ?? 14.8,
      pitch: props.flyRequest.pitch ?? (props.is3D ? 36 : 0),
      bearing: props.flyRequest.bearing ?? (props.is3D ? -12 : 0),
      duration: 900
    });
  }, [props.flyRequest, props.is3D]);

  useMapToolOverlays({
    mapRef,
    mapLoadedRef,
    mapReady,
    raindrop: props.raindrop,
    profilePts: props.profilePts,
    profileHover: props.profileHover
  });

  useMapEditing({
    mapRef,
    mapLoadedRef,
    mapReady,
    activeTool: props.activeTool,
    drawVertices: props.drawVertices,
    editorUnlocked: props.editorUnlocked,
    editingWaterway: props.editingWaterway,
    editingStructure: props.editingStructure,
    langRef,
    verifiedWaterwaysRef,
    editingWaterwayRef,
    onChangeEditingCoordsRef,
    onMoveEditingStructureRef,
    onSnapFeedbackRef,
    isDraggingVertexRef
  });

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-label={`${APP_BRAND.name} — ${region.name}`} />
      <FlowFilamentOverlay
        active={props.tab === 'sim' && props.simProgress > 0.02 && Boolean(props.cascadeEngine)}
        mapRef={mapRef}
        corridors={corridors}
        glintPoints={poolGlintPoints}
        nagariBoundary={props.datasets.nagariBoundary}
        rainMmHr={props.simRain}
        durationMin={props.simDurationMin}
        progress={props.simProgress}
        drainCondition={props.cascadeParams.drainCondition}
        rainPattern={props.cascadeParams.rainPattern}
        soilMoisture={props.cascadeParams.soilMoisture}
        cascadeEngine={props.cascadeEngine}
      />
    </div>
  );
}
