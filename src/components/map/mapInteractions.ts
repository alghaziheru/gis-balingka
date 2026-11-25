import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  GeoJSONSource,
  Marker,
  Popup,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
  type MapMouseEvent
} from 'maplibre-gl';
import type { CascadeEngine } from '../../lib/cascadeEngine';
import type { DemClient } from '../../lib/demClient';
import { haversineMeters, snapPointToWaterways } from '../../lib/geometry';
import type {
  ActiveTool,
  CascadeSimParams,
  GeoProperties,
  Language,
  ProfileSample,
  RaindropTrace,
  StructureKind,
  TabId,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature,
  ViewMode,
  WaterwayKind
} from '../../types/gis';
import {
  openAgamPointAttributesPopup,
  openAgamRbiPopup,
  openCorridorExplainPopup,
  openDemFlowPopup,
  openGenericPointPopup,
  openVerifiedStructurePopup,
  openVerifiedWaterwayPopup,
  type MapPopupContext
} from './mapPopups';
import { asGeoInput, EMPTY_FC, interpolateLine, type LoadedDatasets, type MapCameraState, type MapControlHandle } from './types';

export function attachTelemetryAndControls(
  map: MapLibreMap,
  containerRef: MutableRefObject<HTMLDivElement | null>,
  controlRefProp: MutableRefObject<MutableRefObject<MapControlHandle | null> | undefined>,
  onCameraChangeRef: MutableRefObject<((cam: MapCameraState) => void) | undefined>
): { emitCamera: (force?: boolean) => void; cleanup: () => void } {
  if (controlRefProp.current) {
    controlRefProp.current.current = {
      zoomIn: () => map.zoomIn({ duration: 250 }),
      zoomOut: () => map.zoomOut({ duration: 250 }),
      resetNorth: () => map.easeTo({ bearing: 0, pitch: 0, duration: 400 }),
      projectLngLat: (lng: number, lat: number) => {
        const pt = map.project([lng, lat]);
        return { x: pt.x, y: pt.y };
      },
      getCameraAngles: () => ({ pitch: map.getPitch(), bearing: map.getBearing() })
    };
  }

  const computeMetersPerPixel = (): number => {
    const el = containerRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    if (w >= 120 && h >= 120) {
      const cx = w / 2;
      const cy = h / 2;
      const samplePx = 100;
      const left = map.unproject([cx - samplePx / 2, cy]);
      const right = map.unproject([cx + samplePx / 2, cy]);
      const mpp = haversineMeters(left.lng, left.lat, right.lng, right.lat) / samplePx;
      if (Number.isFinite(mpp) && mpp > 0.01) return mpp;
    }
    const lat = map.getCenter().lat;
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
  };

  let lastCam: MapCameraState | null = null;
  let camRafId = 0;
  const emitCamera = (force = false) => {
    const zoom = map.getZoom();
    const bearing = map.getBearing();
    const pitch = map.getPitch();
    const metersPerPixel = computeMetersPerPixel();
    if (
      !force &&
      lastCam &&
      Math.abs(bearing - lastCam.bearing) < 0.3 &&
      Math.abs(pitch - lastCam.pitch) < 0.5 &&
      Math.abs(zoom - lastCam.zoom) < 0.05 &&
      Math.abs(metersPerPixel - lastCam.metersPerPixel) / Math.max(0.01, lastCam.metersPerPixel) < 0.02
    ) {
      return;
    }
    const nextCam: MapCameraState = { zoom, bearing, pitch, metersPerPixel };
    lastCam = nextCam;
    onCameraChangeRef.current?.(nextCam);
  };

  const scheduleCameraEmit = () => {
    if (camRafId) return;
    camRafId = requestAnimationFrame(() => {
      camRafId = 0;
      emitCamera(false);
    });
  };

  map.on('move', scheduleCameraEmit);
  map.on('moveend', () => emitCamera(true));
  map.on('resize', () => emitCamera(true));

  return {
    emitCamera,
    cleanup: () => {
      if (camRafId) cancelAnimationFrame(camRafId);
      if (controlRefProp.current) controlRefProp.current.current = null;
    }
  };
}

export interface MapInteractionRefs {
  popupRef: MutableRefObject<Popup | null>;
  activeToolRef: MutableRefObject<ActiveTool>;
  langRef: MutableRefObject<Language>;
  viewModeRef: MutableRefObject<ViewMode>;
  demRef: MutableRefObject<DemClient>;
  tabRef: MutableRefObject<TabId>;
  simProgressRef: MutableRefObject<number>;
  cascadeEngineRef: MutableRefObject<CascadeEngine | null>;
  cascadeParamsRef: MutableRefObject<CascadeSimParams>;
  editorUnlockedRef: MutableRefObject<boolean>;
  apiAvailableRef: MutableRefObject<boolean>;
  requiresPassphraseRef: MutableRefObject<boolean>;
  datasetsRef: MutableRefObject<LoadedDatasets>;
  verifiedWaterwaysRef: MutableRefObject<VerifiedWaterwayFeature[]>;
  verifiedStructuresRef: MutableRefObject<VerifiedStructureFeature[]>;
  editingWaterwayRef: MutableRefObject<{ id: string | null; coordinates: [number, number][]; sourceRef?: string | null } | null>;
  isDraggingVertexRef: MutableRefObject<boolean>;
  onMapClickRef: MutableRefObject<(lngLat: [number, number]) => void>;
  onCursorRef: MutableRefObject<(t: { lng: number; lat: number; elev: number; slope: number }) => void>;
  onOpenUnlockRef: MutableRefObject<() => void>;
  onSelectStructureRef: MutableRefObject<(feature: VerifiedStructureFeature) => void>;
  onSelectWaterwayRef: MutableRefObject<(feature: VerifiedWaterwayFeature) => void>;
  onVerifyCrossingRef: MutableRefObject<
    (draftId: string, coords: [number, number], suggestedName: string, suggestedKind: StructureKind) => void
  >;
  onRedrawDemRef: MutableRefObject<(segId: string) => void>;
  onPromoteDemRef: MutableRefObject<(segId: string, coords: [number, number][]) => void>;
  onSuppressDemRef: MutableRefObject<(segId: string) => void>;
  onPromoteRbiRef: MutableRefObject<(name: string, kind: WaterwayKind, coords: [number, number][]) => void>;
  onSetStructureBlockageOverrideRef: MutableRefObject<((structureId: string, pct: number | null) => void) | undefined>;
  onSnapFeedbackRef: MutableRefObject<((msg: string) => void) | undefined>;
}

const INTERACTIVE_LAYERS = [
  'verified-structures-symbol',
  'draft-points',
  'community-points',
  'community-lines',
  'verified-waterways-line',
  'verified-culverts-line',
  'flows-line',
  'agam-rbi-line'
] as const;

export function attachInteractiveLayerHandlers(map: MapLibreMap, refs: MapInteractionRefs): void {
  const buildPopupCtx = (): MapPopupContext => ({
    map,
    popupRef: refs.popupRef,
    lang: refs.langRef.current,
    viewMode: refs.viewModeRef.current,
    tab: refs.tabRef.current,
    demClient: refs.demRef.current,
    editorUnlocked: refs.editorUnlockedRef.current,
    apiAvailable: refs.apiAvailableRef.current,
    requiresPassphrase: refs.requiresPassphraseRef.current,
    structureBlockageOverrides: refs.cascadeParamsRef.current.structureBlockageOverrides,
    onSetStructureBlockageOverride: (stId, pct) => refs.onSetStructureBlockageOverrideRef.current?.(stId, pct),
    onVerifyCrossing: (draftId, coords, name, kind) =>
      refs.onVerifyCrossingRef.current(draftId, coords, name, kind),
    onOpenUnlock: () => refs.onOpenUnlockRef.current(),
    onSelectStructure: feat => refs.onSelectStructureRef.current(feat),
    onSelectWaterway: feat => refs.onSelectWaterwayRef.current(feat),
    onRedrawDemSegment: segId => refs.onRedrawDemRef.current(segId),
    onPromoteDemSegment: (segId, coords) => refs.onPromoteDemRef.current(segId, coords),
    onSuppressDemSegment: segId => refs.onSuppressDemRef.current(segId),
    onPromoteRbiRiver: (name, kind, coords) => refs.onPromoteRbiRef.current(name, kind, coords)
  });

  for (const lid of INTERACTIVE_LAYERS) {
    map.on('mouseenter', lid, () => {
      if (!refs.activeToolRef.current) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', lid, () => {
      if (!refs.activeToolRef.current) map.getCanvas().style.cursor = '';
    });
    map.on('click', lid, (e: MapLayerMouseEvent) => {
      if (refs.activeToolRef.current) return;
      const feat = e.features?.[0];
      if (!feat) return;
      const propsObj = (feat.properties || {}) as GeoProperties;
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const ctx = buildPopupCtx();

      if (lid === 'verified-structures-symbol') {
        openVerifiedStructurePopup(ctx, lngLat, propsObj, refs.verifiedStructuresRef.current);
        return;
      }
      if (lid === 'verified-waterways-line' || lid === 'verified-culverts-line') {
        openVerifiedWaterwayPopup(ctx, lngLat, propsObj, refs.verifiedWaterwaysRef.current);
        return;
      }
      if (lid === 'flows-line') {
        openDemFlowPopup(ctx, lngLat, propsObj, refs.datasetsRef.current.flowPaths);
        return;
      }
      if (lid === 'agam-rbi-line') {
        openAgamRbiPopup(ctx, lngLat, propsObj, feat.geometry);
        return;
      }

      const isComm = lid.startsWith('community');
      openGenericPointPopup(ctx, lngLat, propsObj, isComm);
    });
  }
}

export function attachMapClickAndCursorHandlers(map: MapLibreMap, refs: MapInteractionRefs): void {
  map.on('click', (e: MapMouseEvent) => {
    const tool = refs.activeToolRef.current;
    const pt: [number, number] = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];
    if (!tool) {
      const hitLayers = INTERACTIVE_LAYERS.filter(lid => Boolean(map.getLayer(lid)));
      const hits = hitLayers.length > 0 ? map.queryRenderedFeatures(e.point, { layers: hitLayers }) : [];
      if (hits.length > 0) return;

      // Click-to-explain corridor water zone / scour / survey / agreement during active simulation
      if (refs.tabRef.current === 'sim' && refs.cascadeEngineRef.current) {
        const simLayers = [
          'sim-pools-shallow-fill',
          'sim-pools-deep-fill',
          'sim-scour-reaches-line',
          'sim-survey-reaches-line'
        ].filter(lid => Boolean(map.getLayer(lid)));
        const simHits = simLayers.length > 0 ? map.queryRenderedFeatures(e.point, { layers: simLayers }) : [];
        const sample = refs.cascadeEngineRef.current.sampleAtLngLat(e.lngLat.lng, e.lngLat.lat);
        const hasActiveSignal =
          refs.simProgressRef.current > 0.02 &&
          sample.insideNagari &&
          (sample.depthP90M > 0.1 || sample.fos < 1.35 || sample.streamPowerWm2 >= 280);
        if (simHits.length > 0 || hasActiveSignal) {
          openCorridorExplainPopup(map, refs.popupRef, [e.lngLat.lng, e.lngLat.lat], {
            lang: refs.langRef.current,
            demClient: refs.demRef.current,
            cascadeEngine: refs.cascadeEngineRef.current,
            cascadeParams: refs.cascadeParamsRef.current
          });
          return;
        }
      }

      openAgamPointAttributesPopup(map, refs.popupRef, pt, {
        lang: refs.langRef.current,
        demClient: refs.demRef.current,
        nagariBoundary: refs.datasetsRef.current.nagariBoundary,
        agamContext: refs.datasetsRef.current.agamContext
      });
      return;
    }

    if (tool === 'drawWaterway' || tool === 'redrawWaterway') {
      const snap = snapPointToWaterways(
        pt,
        refs.verifiedWaterwaysRef.current,
        refs.editingWaterwayRef.current?.id || null,
        22
      );
      if (snap.snapped && snap.targetName) {
        refs.onSnapFeedbackRef.current?.(
          refs.langRef.current === 'en' ? `Snapped to ${snap.targetName}` : `Menempel ke ${snap.targetName}`
        );
      }
      refs.onMapClickRef.current(snap.point);
      return;
    }
    refs.onMapClickRef.current(pt);
  });

  let lastTel = 0;
  map.on('mousemove', (e: MapMouseEvent) => {
    if (refs.isDraggingVertexRef.current) return;
    const now = performance.now();
    if (now - lastTel < 65) return;
    lastTel = now;
    const { lng, lat } = e.lngLat;
    const tool = refs.activeToolRef.current;
    if (tool === 'drawWaterway' || tool === 'redrawWaterway') {
      const snapSrc = map.getSource('src-snap-indicator') as GeoJSONSource | undefined;
      if (snapSrc) {
        const snap = snapPointToWaterways(
          [lng, lat],
          refs.verifiedWaterwaysRef.current,
          refs.editingWaterwayRef.current?.id || null,
          22
        );
        snapSrc.setData(
          asGeoInput(
            snap.snapped
              ? {
                  type: 'FeatureCollection',
                  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: snap.point } }]
                }
              : EMPTY_FC
          )
        );
      }
    }
    refs.onCursorRef.current({
      lng,
      lat,
      elev: refs.demRef.current.getElevation(lng, lat),
      slope: refs.demRef.current.getSlopePercent(lng, lat)
    });
  });
}

export function useMapToolOverlays(opts: {
  mapRef: MutableRefObject<MapLibreMap | null>;
  mapLoadedRef: MutableRefObject<boolean>;
  mapReady: boolean;
  raindrop: RaindropTrace | null;
  profilePts: [number, number][];
  profileHover: ProfileSample | null;
}): void {
  const raindropMarkerRef = useRef<Marker | null>(null);
  const raindropAnimRef = useRef<number | null>(null);
  const profileABRef = useRef<Marker[]>([]);
  const profileHoverMarkerRef = useRef<Marker | null>(null);

  useEffect(() => {
    const map = opts.mapRef.current;
    if (!map || !opts.mapLoadedRef.current) return;
    const src = map.getSource('src-raindrop') as GeoJSONSource | undefined;
    if (raindropAnimRef.current) cancelAnimationFrame(raindropAnimRef.current);
    if (raindropMarkerRef.current) {
      raindropMarkerRef.current.remove();
      raindropMarkerRef.current = null;
    }

    if (!opts.raindrop || opts.raindrop.coordinates.length < 2) {
      if (src) src.setData(asGeoInput(EMPTY_FC));
      return;
    }

    const coords = opts.raindrop.coordinates;
    if (src) {
      src.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }]
        })
      );
    }

    const el = document.createElement('div');
    el.className = 'marker-dot';
    el.style.background = '#0ea5e9';
    const mk = new Marker({ element: el, anchor: 'center' }).setLngLat(coords[0]).addTo(map);
    raindropMarkerRef.current = mk;

    let p = 0;
    const step = () => {
      p = Math.min(1, p + 0.016);
      mk.setLngLat(interpolateLine(coords, p));
      if (p < 1) raindropAnimRef.current = requestAnimationFrame(step);
    };
    raindropAnimRef.current = requestAnimationFrame(step);

    return () => {
      if (raindropAnimRef.current) {
        cancelAnimationFrame(raindropAnimRef.current);
        raindropAnimRef.current = null;
      }
      if (raindropMarkerRef.current) {
        raindropMarkerRef.current.remove();
        raindropMarkerRef.current = null;
      }
    };
  }, [opts.mapReady, opts.raindrop]);

  useEffect(() => {
    const map = opts.mapRef.current;
    if (!map || !opts.mapLoadedRef.current) return;
    profileABRef.current.forEach(m => m.remove());
    profileABRef.current = [];

    opts.profilePts.forEach((pt, idx) => {
      const el = document.createElement('div');
      el.className = 'marker-ab';
      el.textContent = idx === 0 ? 'A' : 'B';
      profileABRef.current.push(new Marker({ element: el, anchor: 'center' }).setLngLat(pt).addTo(map));
    });

    const src = map.getSource('src-profile') as GeoJSONSource | undefined;
    if (src) {
      if (opts.profilePts.length === 2) {
        src.setData(
          asGeoInput({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: opts.profilePts } }]
          })
        );
      } else {
        src.setData(asGeoInput(EMPTY_FC));
      }
    }
  }, [opts.mapReady, opts.profilePts]);

  useEffect(() => {
    const map = opts.mapRef.current;
    if (!map || !opts.mapLoadedRef.current) return;
    if (!opts.profileHover) {
      if (profileHoverMarkerRef.current) {
        profileHoverMarkerRef.current.remove();
        profileHoverMarkerRef.current = null;
      }
      return;
    }
    if (!profileHoverMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'marker-dot';
      el.style.background = '#dc2626';
      profileHoverMarkerRef.current = new Marker({ element: el, anchor: 'center' })
        .setLngLat([opts.profileHover.lng, opts.profileHover.lat])
        .addTo(map);
    } else {
      profileHoverMarkerRef.current.setLngLat([opts.profileHover.lng, opts.profileHover.lat]);
    }
  }, [opts.mapReady, opts.profileHover]);
}
