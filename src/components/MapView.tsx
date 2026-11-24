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
import { buildFlowCorridors } from '../lib/flowRibbons';
import { computeRunoffMergeNetwork, haversineMeters, type MergedWaterwayReach } from '../lib/geometry';
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
  type MapViewProps
} from './map/types';
import { useMapEditing } from './map/useMapEditing';

export type { FlyRequest, LoadedDatasets, MapCameraState, MapControlHandle };

setWorkerUrl(maplibreWorkerUrl);

export function MapView(props: MapViewProps) {
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
  const simProgressRef = useRef(props.simProgress);
  simProgressRef.current = props.simProgress;
  const cascadeEngineRef = useRef(props.cascadeEngine);
  cascadeEngineRef.current = props.cascadeEngine;
  const cascadeParamsRef = useRef(props.cascadeParams);
  cascadeParamsRef.current = props.cascadeParams;
  const [poolGlintPoints, setPoolGlintPoints] = useState<[number, number][]>([]);
  const lastSkyKeyRef = useRef('');
  const landslideCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
          includeRbi: props.layers.agamRbiRivers
        }
      ),
    [
      props.verifiedWaterways,
      props.datasets.flowPaths,
      props.datasets.agamRbiRivers,
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
  const onSnapFeedbackRef = useRef(props.onSnapFeedback);
  onSnapFeedbackRef.current = props.onSnapFeedback;
  const animPathsRef = useRef<GeoFeature[]>([]);
  const flowAnimActiveRef = useRef(false);
  const mergedReachesRef = useRef<MergedWaterwayReach[]>([]);
  const mergingFlowIdsRef = useRef<Set<string>>(new Set());
  const particlesClearedRef = useRef(true);
  const isDraggingVertexRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const { bbox, center } = props.datasets;
    const pad = 0.015;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: createInitialMapStyle(bbox),
      center,
      zoom: 15.6,
      minZoom: 11.4,
      maxZoom: 19,
      maxBounds: [
        [bbox.west - pad, bbox.south - pad],
        [bbox.east + pad, bbox.north + pad]
      ],
      pitch: 36,
      bearing: -12,
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
      onSnapFeedbackRef
    };

    let stopParticles: (() => void) | null = null;
    map.on('load', () => {
      const ds = props.datasets;
      addDataSourcesAndLayers(map, ds, props.basemap);
      contourMarkersRef.current = addStaticPlaceAndContourMarkers(map, ds, {
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
    });

    attachMapClickAndCursorHandlers(map, interactionRefs);

    return () => {
      telemetryControls.cleanup();
      stopParticles?.();
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
    if (!map || !mapLoadedRef.current) return;

    const vis = (on: boolean) => (on ? 'visible' : 'none');

    // CutSheetRX Surface Modes & Basemaps
    map.setLayoutProperty('basemap-sat', 'visibility', vis(props.basemap === 'sat'));
    map.setLayoutProperty('basemap-topo', 'visibility', vis(props.basemap === 'topo'));
    map.setLayoutProperty('basemap-osm', 'visibility', vis(props.basemap === 'osm'));
    map.setLayoutProperty('surface-relief', 'visibility', vis(props.basemap === 'relief' || props.basemap === 'slope'));
    map.setLayoutProperty('surface-elev', 'visibility', vis(props.basemap === 'elev'));
    map.setLayoutProperty('surface-slope-base', 'visibility', vis(props.basemap === 'slope'));

    map.setLayoutProperty('hillshade-layer', 'visibility', vis(props.layers.hillshade));
    const nextExag = props.is3D ? props.exaggeration : 0.4;
    if (nextExag !== lastTerrainExagRef.current) {
      map.setTerrain({ source: 'dem-terrain', exaggeration: nextExag });
      lastTerrainExagRef.current = nextExag;
    }

    const isRaining = props.tab === 'sim' && props.simProgress > 0.02;

    map.setLayoutProperty('nagari-boundary-casing', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('nagari-boundary-line', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('jorong-fill', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('jorong-casing', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('jorong-line', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('settlements-residential-fill', 'visibility', vis(props.layers.settlements && !isRaining));
    map.setLayoutProperty('settlements-buildings-fill', 'visibility', vis(props.layers.settlements && !isRaining));
    map.setLayoutProperty('settlements-buildings-line', 'visibility', vis(props.layers.settlements && !isRaining));
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

    const maxTier = props.tab === 'sim' ? 0 : props.flowDensity;
    const flowVis = props.tab !== 'sim' && maxTier > 0;
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
        isRaining ? Math.min(0.64, 0.34 + props.simProgress * 0.24 + (props.simRain / 150) * 0.1) : 0.42
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

    const cleanupCascade = syncSimulationOverlays({
      map,
      isRaining,
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
      setPoolGlintPoints
    });

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

    return cleanupCascade;
  }, [
    mapReady,
    props.basemap,
    props.is3D,
    props.exaggeration,
    props.layers,
    props.flowDensity,
    props.tab,
    props.simRain,
    props.simDurationMin,
    props.simProgress,
    props.simScenario,
    props.lang,
    props.rainAnimEnabled,
    props.cascadeEngine,
    props.cascadeParams,
    props.drainFilter,
    props.verifiedWaterways,
    props.verifiedStructures,
    props.jorongBoundaries,
    props.datasets.drainageDraft,
    props.datasets.flowPaths,
    props.suppressedDemIds
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    syncStormSky(map, lastSkyKeyRef, {
      tab: props.tab,
      rainAnimEnabled: props.rainAnimEnabled,
      simProgress: props.simProgress,
      simRain: props.simRain
    });
  }, [mapReady, props.tab, props.rainAnimEnabled, props.simProgress, props.simRain]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    applyBasemapContrastPalette(map, props.basemap, props.tab, props.simProgress);
  }, [mapReady, props.basemap, props.tab, props.simProgress]);

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
      for (const hid of HAND_LAYERS) {
        const imgSrc = map.getSource(`img-${hid}`) as ImageSource | undefined;
        if (imgSrc && typeof imgSrc.updateImage === 'function') {
          imgSrc.updateImage({
            url: `/data/raster-${hid}.png?v=${props.dataVersion}`,
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
      <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-label="Balingka GIS Map" />
      <FlowFilamentOverlay
        active={props.tab === 'sim' && props.simProgress > 0.02 && Boolean(props.cascadeEngine)}
        mapRef={mapRef}
        corridors={corridors}
        glintPoints={poolGlintPoints}
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
