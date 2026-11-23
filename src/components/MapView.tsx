import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  GeoJSONSource,
  ImageSource,
  Map as MapLibreMap,
  Marker,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type FilterSpecification,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type StyleSpecification
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { isPointInNagari, lookupAgamAtPoint } from '../lib/agamLookup';
import type { CascadeEngine } from '../lib/cascadeEngine';
import type { DemClient } from '../lib/demClient';
import { buildFlowCorridors } from '../lib/flowRibbons';
import { extractAffectedBuildings, extractFloodPoolPolygons } from '../lib/poolContours';
import { computeRunoffMergeNetwork, haversineMeters, snapPointToWaterways, type MergedWaterwayReach } from '../lib/geometry';
import { getOverlayContrastPalette } from '../lib/mapPalette';
import { FlowFilamentOverlay } from './FlowFilamentOverlay';
import type {
  ActiveTool,
  AgamContextData,
  BasemapId,
  BBox,
  CascadeSimParams,
  DrainageStatus,
  GeoFeature,
  GeoFeatureCollection,
  GeoProperties,
  JorongBoundaryFeature,
  Language,
  LayerToggles,
  ProfileSample,
  RaindropTrace,
  StructureKind,
  TabId,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature,
  ViewMode,
  WaterwayKind
} from '../types/gis';

setWorkerUrl(maplibreWorkerUrl);

export interface FlyRequest {
  center: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  nonce: number;
}

export interface MapCameraState {
  zoom: number;
  bearing: number;
  pitch: number;
  metersPerPixel: number;
}

export interface MapControlHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
  projectLngLat?: (lng: number, lat: number) => { x: number; y: number } | null;
  getCameraAngles?: () => { pitch: number; bearing: number };
}

export interface LoadedDatasets {
  bbox: BBox;
  center: [number, number];
  mask: GeoFeatureCollection;
  watershed: GeoFeatureCollection;
  nagariBoundary: GeoFeatureCollection;
  settlements: GeoFeatureCollection;
  contours: GeoFeatureCollection;
  flowPaths: GeoFeatureCollection;
  osmContext: GeoFeatureCollection;
  drainageDraft: GeoFeatureCollection;
  agamRbiRivers: GeoFeatureCollection;
  agamContext: AgamContextData | null;
}

interface MapViewProps {
  datasets: LoadedDatasets;
  demClient: DemClient;
  lang: Language;
  viewMode: ViewMode;
  tab: TabId;
  is3D: boolean;
  basemap: BasemapId;
  exaggeration: number;
  layers: LayerToggles;
  flowDensity: number;
  activeTool: ActiveTool;
  simRain: number;
  simDurationMin: number;
  simProgress: number;
  simScenario: 'clogged' | 'cleared';
  rainAnimEnabled: boolean;
  cascadeEngine: CascadeEngine | null;
  cascadeParams: CascadeSimParams;
  drainFilter: 'all' | DrainageStatus;
  raindrop: RaindropTrace | null;
  profilePts: [number, number][];
  profileHover: ProfileSample | null;
  verifiedWaterways: VerifiedWaterwayFeature[];
  verifiedStructures: VerifiedStructureFeature[];
  jorongBoundaries: JorongBoundaryFeature[];
  suppressedDemIds: string[];
  dataVersion: number;
  apiAvailable: boolean;
  requiresPassphrase: boolean;
  editorUnlocked: boolean;
  editingWaterway: { id: string | null; coordinates: [number, number][]; sourceRef?: string | null } | null;
  editingStructure: { id: string | null; coordinates: [number, number]; sourceRef?: string | null } | null;
  drawVertices: [number, number][];
  flyRequest: FlyRequest | null;
  controlRef?: MutableRefObject<MapControlHandle | null>;
  onCameraChange?: (cam: MapCameraState) => void;
  onSelectJorongPill?: (preset: string) => void;
  onMapClick: (lngLat: [number, number]) => void;
  onOpenUnlock: () => void;
  onSelectWaterway: (feature: VerifiedWaterwayFeature) => void;
  onSelectStructure: (feature: VerifiedStructureFeature) => void;
  onVerifyCrossing: (
    draftId: string,
    coords: [number, number],
    suggestedName: string,
    suggestedKind: StructureKind
  ) => void;
  onMoveEditingStructure: (coords: [number, number]) => void;
  onPromoteDemSegment: (segId: string, coords: [number, number][]) => void;
  onPromoteRbiRiver: (name: string, kind: WaterwayKind, coords: [number, number][]) => void;
  onRedrawDemSegment: (segId: string) => void;
  onSuppressDemSegment: (segId: string) => void;
  onChangeEditingCoords: (coords: [number, number][]) => void;
  onSnapFeedback?: (msg: string) => void;
  onCursorTelemetry: (t: { lng: number; lat: number; elev: number; slope: number }) => void;
}

type MapGeoInput = Parameters<GeoJSONSource['setData']>[0];
const asGeoInput = (fc: GeoFeatureCollection): MapGeoInput => fc as unknown as MapGeoInput;

const EMPTY_FC: GeoFeatureCollection = { type: 'FeatureCollection', features: [] };
const TRANSPARENT_1PX_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const HAND_LAYERS = [
  'hand-clogged-low',
  'hand-clogged-med',
  'hand-clogged-high',
  'hand-cleared-low',
  'hand-cleared-med',
  'hand-cleared-high'
] as const;

function lerpHex(hexA: string, hexB: string, t: number): string {
  const f = Math.max(0, Math.min(1, t));
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const r = Math.round(((a >> 16) & 255) * (1 - f) + ((b >> 16) & 255) * f);
  const g = Math.round(((a >> 8) & 255) * (1 - f) + ((b >> 8) & 255) * f);
  const bl = Math.round((a & 255) * (1 - f) + (b & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function interpolateLine(coords: [number, number][], frac: number): [number, number] {
  if (coords.length < 2) return coords[0];
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const len = Math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]);
    segs.push(len);
    total += len;
  }
  let target = frac * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const r = segs[i] > 0 ? target / segs[i] : 0;
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * r,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * r
      ];
    }
    target -= segs[i];
  }
  return coords[coords.length - 1];
}

function subsampleCoordsForEditing(coords: [number, number][], maxPts = 18): [number, number][] {
  if (coords.length <= maxPts) return coords.map(c => [c[0], c[1]]);
  const out: [number, number][] = [];
  for (let i = 0; i < maxPts; i++) {
    const idx = i === maxPts - 1 ? coords.length - 1 : Math.round((i / (maxPts - 1)) * (coords.length - 1));
    out.push([coords[idx][0], coords[idx][1]]);
  }
  return out;
}

function registerCartographicIcons(map: MapLibreMap): void {
  const addCanvasIcon = (name: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
    if (map.hasImage(name)) return;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    draw(ctx, size);
    const img = ctx.getImageData(0, 0, size, size);
    map.addImage(name, { width: size, height: size, data: img.data });
  };

  // Directional amber-ochre chevron for DEM air limpasan lines
  addCanvasIcon('icon-flow-arrow', 18, (ctx, s) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.22);
    ctx.lineTo(s * 0.72, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.78);
    ctx.stroke();

    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.22);
    ctx.lineTo(s * 0.72, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.78);
    ctx.stroke();
  });

  // Directional white/navy chevron for verified waterways
  addCanvasIcon('icon-waterway-arrow', 20, (ctx, s) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0c4a6e';
    ctx.lineWidth = 4.0;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.24);
    ctx.lineTo(s * 0.72, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.76);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.24);
    ctx.lineTo(s * 0.72, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.76);
    ctx.stroke();
  });

  const statusPalette: Record<string, string> = {
    normal: '#047857',
    clogged: '#b45309',
    damaged: '#c2410c',
    critical: '#b91c1c'
  };

  for (const [status, fill] of Object.entries(statusPalette)) {
    // Culvert badge: rounded square with arch opening
    addCanvasIcon(`icon-culvert-${status}`, 28, (ctx, s) => {
      const pad = 3;
      const r = 6;
      const w = s - pad * 2;
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, w, r);
      ctx.fill();
      ctx.stroke();

      // White arch culvert symbol inside
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.62, s * 0.22, Math.PI, 0, false);
      ctx.lineTo(s * 0.72, s * 0.74);
      ctx.lineTo(s * 0.28, s * 0.74);
      ctx.closePath();
      ctx.fill();
    });

    // Bridge badge: rounded square with bridge span & abutments
    addCanvasIcon(`icon-bridge-${status}`, 28, (ctx, s) => {
      const pad = 3;
      const r = 6;
      const w = s - pad * 2;
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, w, r);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.24, s * 0.36);
      ctx.lineTo(s * 0.34, s * 0.48);
      ctx.lineTo(s * 0.66, s * 0.48);
      ctx.lineTo(s * 0.76, s * 0.36);
      ctx.moveTo(s * 0.34, s * 0.48);
      ctx.lineTo(s * 0.34, s * 0.72);
      ctx.moveTo(s * 0.66, s * 0.48);
      ctx.lineTo(s * 0.66, s * 0.72);
      ctx.stroke();
    });
  }

  const drawBadgeFrame = (ctx: CanvasRenderingContext2D, s: number, fill: string) => {
    const pad = 3;
    const w = s - pad * 2;
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(pad, pad, w, w, 6);
    ctx.fill();
    ctx.stroke();
  };

  // Unverified road-stream crossing badge
  addCanvasIcon('icon-crossing-unverified', 28, (ctx, s) => {
    drawBadgeFrame(ctx, s, '#475569');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.28, s * 0.35);
    ctx.lineTo(s * 0.72, s * 0.65);
    ctx.moveTo(s * 0.28, s * 0.65);
    ctx.lineTo(s * 0.72, s * 0.35);
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // Evacuation safe-ground shelter badge
  addCanvasIcon('icon-evacuation', 28, (ctx, s) => {
    drawBadgeFrame(ctx, s, '#047857');
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(s * 0.27, s * 0.5);
    ctx.lineTo(s * 0.5, s * 0.28);
    ctx.lineTo(s * 0.73, s * 0.5);
    ctx.lineTo(s * 0.64, s * 0.5);
    ctx.lineTo(s * 0.64, s * 0.72);
    ctx.lineTo(s * 0.36, s * 0.72);
    ctx.lineTo(s * 0.36, s * 0.5);
    ctx.closePath();
    ctx.fill();
  });

  // Steep slope (>38% DEMNAS) geometry badge
  addCanvasIcon('icon-landslide', 28, (ctx, s) => {
    drawBadgeFrame(ctx, s, '#b45309');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.27, s * 0.7);
    ctx.lineTo(s * 0.46, s * 0.34);
    ctx.lineTo(s * 0.73, s * 0.7);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.59, s * 0.32);
    ctx.lineTo(s * 0.77, s * 0.55);
    ctx.stroke();
  });
}

export function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLoadedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const lastTerrainExagRef = useRef<number | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const contourMarkersRef = useRef<{ marker: Marker; el: HTMLElement }[]>([]);
  const raindropMarkerRef = useRef<Marker | null>(null);
  const raindropAnimRef = useRef<number | null>(null);
  const profileABRef = useRef<Marker[]>([]);
  const profileHoverMarkerRef = useRef<Marker | null>(null);
  const vertexMarkersRef = useRef<Marker[]>([]);
  const structureEditMarkerRef = useRef<Marker | null>(null);

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
  const flowDensityRef = useRef(props.flowDensity);
  flowDensityRef.current = props.flowDensity;
  const simRainRef = useRef(props.simRain);
  simRainRef.current = props.simRain;
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

  const openPopup = (lngLat: [number, number], p: GeoProperties | undefined, isCommunity = false) => {
    const map = mapRef.current;
    if (!map || !p) return;
    if (popupRef.current) popupRef.current.remove();

    const isEn = langRef.current === 'en';
    const isDetail = viewModeRef.current === 'detail';
    const name = isEn ? p.name_en || p.name : p.name_id || p.name;
    const desc = isEn ? p.desc_en || p.notes || '' : p.desc_id || p.notes || '';
    const status = String(p.status || 'normal');

    const badgeColors: Record<string, string> = {
      unverified: 'background:rgba(100,116,139,0.14);color:#475569',
      normal: 'background:rgba(4,120,87,0.12);color:#047857',
      clogged: 'background:rgba(180,83,9,0.14);color:#b45309',
      damaged: 'background:rgba(194,65,12,0.14);color:#c2410c',
      critical: 'background:rgba(185,28,28,0.14);color:#b91c1c'
    };
    const statusNames: Record<string, { id: string; en: string }> = {
      unverified: { id: 'Perlu Cek Lapangan', en: 'Needs Field Check' },
      normal: { id: 'Normal', en: 'Normal' },
      clogged: { id: 'Tersumbat', en: 'Clogged' },
      damaged: { id: 'Rusak', en: 'Damaged' },
      critical: { id: 'Rusak Berat', en: 'Severe' }
    };
    const isSteepSlopePoint = p.kind === 'landslide';
    const isElevatedFacility = p.kind === 'evacuation';
    const st = statusNames[status] || statusNames.unverified;
    const badgeStyle = isSteepSlopePoint
      ? 'background:rgba(180,83,9,0.14);color:#b45309'
      : isElevatedFacility
      ? 'background:rgba(4,120,87,0.12);color:#047857'
      : badgeColors[status] || badgeColors.unverified;
    const badgeText = isSteepSlopePoint
      ? isEn
        ? 'DEMNAS Slope Data'
        : 'Data Kemiringan DEMNAS'
      : isElevatedFacility
      ? isEn
        ? 'Official BIG RBI 50K'
        : 'Data Resmi BIG RBI 50K'
      : isEn
      ? st.en
      : st.id;
    const tagText = isCommunity
      ? isEn
        ? 'Resident Note (Local)'
        : 'Catatan Warga (Lokal)'
      : isSteepSlopePoint
      ? isEn
        ? 'Terrain Geometry Point · BIG DEMNAS 8m'
        : 'Titik Geometri Elevasi · BIG DEMNAS 8m'
      : isElevatedFacility
      ? isEn
        ? 'Elevated Public Facility · Not an Official Evacuation Designation'
        : 'Fasilitas Umum Elevasi Tinggi · Bukan Penetapan Evakuasi Resmi'
      : status === 'unverified'
      ? isEn
        ? 'DEM Road–Channel Crossing / Reference Point (Unverified)'
        : 'Titik Silang Jalan–Alur DEM / Data Referensi (Belum Dicek)'
      : isEn
      ? 'Field Survey / Monitored Point'
      : 'Titik Pantau Lapangan';
    const elev = Math.round(demRef.current.getElevation(lngLat[0], lngLat[1]));

    const canVerifyCrossing =
      p.kind === 'drainage' &&
      status === 'unverified' &&
      editorUnlockedRef.current &&
      apiAvailableRef.current;
    const canUnlockCrossing =
      p.kind === 'drainage' &&
      status === 'unverified' &&
      !editorUnlockedRef.current &&
      apiAvailableRef.current &&
      requiresPassphraseRef.current;

    const actionBtnHtml = canVerifyCrossing
      ? `<button id="popup-verify-crossing" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
          ${isEn ? 'Verify as Culvert / Bridge' : 'Verifikasi sebagai Gorong-gorong / Jembatan'}
        </button>`
      : canUnlockCrossing
      ? `<button id="popup-unlock-crossing" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
          ${isEn ? 'Unlock Editor to Verify Point' : 'Buka Editor untuk Verifikasi Titik'}
        </button>`
      : '';

    const html = `
      <div>
        <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;${badgeStyle}">
          ${escapeHtml(badgeText)}
        </span>
        <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(name)}</h4>
        <div style="margin-bottom:6px;font-size:11.5px;font-weight:600;color:#636f6a;">
          ${escapeHtml(tagText)}
        </div>
        ${desc ? `<p style="margin:0 0 8px;font-size:12.5px;line-height:1.45;color:#434d49;">${escapeHtml(desc)}</p>` : ''}
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#636f6a;">
          ${isDetail ? `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)} · ` : ''}~${elev} mdpl
        </div>
        ${actionBtnHtml}
      </div>
    `;

    const pop = new Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
    popupRef.current = pop;
    if (canVerifyCrossing) {
      pop.getElement()?.querySelector('#popup-verify-crossing')?.addEventListener('click', () => {
        pop.remove();
        const draftId = String(p.id || '');
        const suggestedKind: StructureKind =
          draftId.startsWith('br-') || draftId.startsWith('big-br-') ? 'bridge' : 'culvert';
        onVerifyCrossingRef.current(draftId, lngLat, String(name || ''), suggestedKind);
      });
    } else if (canUnlockCrossing) {
      pop.getElement()?.querySelector('#popup-unlock-crossing')?.addEventListener('click', () => {
        pop.remove();
        onOpenUnlockRef.current();
      });
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const { bbox, center } = props.datasets;

    const hasCustomImagery = Boolean(import.meta.env.VITE_CUSTOM_IMAGERY_URL);
    const satTileUrl =
      import.meta.env.VITE_CUSTOM_IMAGERY_URL ||
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    const satMaxZoom = hasCustomImagery
      ? Number(import.meta.env.VITE_CUSTOM_IMAGERY_MAXZOOM || 20)
      : 18;

    const imgCoords: [[number, number], [number, number], [number, number], [number, number]] = [
      [bbox.west, bbox.north],
      [bbox.east, bbox.north],
      [bbox.east, bbox.south],
      [bbox.west, bbox.south]
    ];

    const initialStyle: StyleSpecification = {
      version: 8,
      sources: {
        'src-sat': {
          type: 'raster',
          tiles: [satTileUrl],
          tileSize: 256,
          maxzoom: satMaxZoom,
          attribution: 'Esri, Maxar, Earthstar Geographics'
        },
        'src-topo': {
          type: 'raster',
          tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 17,
          attribution: 'OpenTopoMap (CC-BY-SA) · OSM'
        },
        'src-osm': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© OpenStreetMap contributors (ODbL)'
        },
        'img-elev': { type: 'image', url: '/data/raster-elev.png', coordinates: imgCoords },
        'img-relief': { type: 'image', url: '/data/raster-relief.png', coordinates: imgCoords },
        'img-slope': { type: 'image', url: '/data/raster-slope.png', coordinates: imgCoords },
        'img-landcover': { type: 'image', url: '/data/raster-landcover.png', coordinates: imgCoords },
        'img-scour-change': { type: 'image', url: '/data/raster-scour-change.png', coordinates: imgCoords },
        'img-cascade-landslide': { type: 'image', url: TRANSPARENT_1PX_PNG, coordinates: imgCoords },
        'img-hand-clogged-low': { type: 'image', url: '/data/raster-hand-clogged-low.png', coordinates: imgCoords },
        'img-hand-clogged-med': { type: 'image', url: '/data/raster-hand-clogged-med.png', coordinates: imgCoords },
        'img-hand-clogged-high': { type: 'image', url: '/data/raster-hand-clogged-high.png', coordinates: imgCoords },
        'img-hand-cleared-low': { type: 'image', url: '/data/raster-hand-cleared-low.png', coordinates: imgCoords },
        'img-hand-cleared-med': { type: 'image', url: '/data/raster-hand-cleared-med.png', coordinates: imgCoords },
        'img-hand-cleared-high': { type: 'image', url: '/data/raster-hand-cleared-high.png', coordinates: imgCoords },
        'dem-terrain': {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 15,
          encoding: 'terrarium'
        },
        'dem-hillshade': {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 15,
          encoding: 'terrarium'
        }
      },
      layers: [
        { id: 'basemap-sat', type: 'raster', source: 'src-sat', layout: { visibility: 'visible' } },
        { id: 'basemap-topo', type: 'raster', source: 'src-topo', layout: { visibility: 'none' } },
        { id: 'basemap-osm', type: 'raster', source: 'src-osm', layout: { visibility: 'none' } },
        {
          id: 'surface-relief',
          type: 'raster',
          source: 'img-relief',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 }
        },
        {
          id: 'surface-elev',
          type: 'raster',
          source: 'img-elev',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 }
        },
        {
          id: 'surface-slope-base',
          type: 'raster',
          source: 'img-slope',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.88, 'raster-fade-duration': 0 }
        },
        {
          id: 'hillshade-layer',
          type: 'hillshade',
          source: 'dem-hillshade',
          layout: { visibility: 'none' },
          paint: {
            'hillshade-exaggeration': 0.45,
            'hillshade-shadow-color': '#182b23',
            'hillshade-highlight-color': '#ffffff',
            'hillshade-illumination-direction': 315
          }
        }
      ],
      terrain: { source: 'dem-terrain', exaggeration: 1.35 },
      sky: {
        'sky-color': '#c9dce8',
        'horizon-color': '#e5ebe8',
        'fog-color': '#e5ebe8',
        'sky-horizon-blend': 0.5,
        'horizon-fog-blend': 0.7,
        'fog-ground-blend': 0.5
      }
    };

    const pad = 0.015;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: initialStyle,
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

    if (props.controlRef) {
      props.controlRef.current = {
        zoomIn: () => mapRef.current?.zoomIn({ duration: 250 }),
        zoomOut: () => mapRef.current?.zoomOut({ duration: 250 }),
        resetNorth: () => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 }),
        projectLngLat: (lng: number, lat: number) => {
          const m = mapRef.current;
          if (!m) return null;
          const pt = m.project([lng, lat]);
          return { x: pt.x, y: pt.y };
        },
        getCameraAngles: () => {
          const m = mapRef.current;
          if (!m) return { pitch: 0, bearing: 0 };
          return { pitch: m.getPitch(), bearing: m.getBearing() };
        }
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

    let animTimerId = 0;
    let particlePhase = 0;
    let lastTs = 0;

    map.on('load', () => {
      const ds = props.datasets;
      const p = getOverlayContrastPalette(props.basemap);
      registerCartographicIcons(map);

      // 10m ESA WorldCover forest & land-cover overlay
      map.addLayer({
        id: 'landcover-overlay',
        type: 'raster',
        source: 'img-landcover',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 150 }
      });

      // 10m Sentinel-2 pre-vs-post disaster scour & vegetation loss overlay
      map.addLayer({
        id: 'scour-change-overlay',
        type: 'raster',
        source: 'img-scour-change',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.78, 'raster-fade-duration': 150 }
      });

      // Smooth slope overlay (when toggled on top of Satellite/Elev/Topo)
      map.addLayer({
        id: 'slope-overlay',
        type: 'raster',
        source: 'img-slope',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 150 }
      });

      // Smooth anti-aliased HAND flood layers (6 pre-rendered raster overlays)
      for (const hid of HAND_LAYERS) {
        map.addLayer({
          id: hid,
          type: 'raster',
          source: `img-${hid}`,
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.86, 'raster-fade-duration': 180 }
        });
      }

      // Dynamic physical cascade overlays (vector-sharp blue pools + steep-slope landslide risk)
      map.addLayer({
        id: 'cascade-landslide-overlay',
        type: 'raster',
        source: 'img-cascade-landslide',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0 }
      });

      map.addSource('src-sim-pools-shallow', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'sim-pools-shallow-fill',
        type: 'fill',
        source: 'src-sim-pools-shallow',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.34, 'fill-antialias': true }
      });

      map.addSource('src-sim-pools-deep', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'sim-pools-deep-fill',
        type: 'fill',
        source: 'src-sim-pools-deep',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#0284c7', 'fill-opacity': 0.34, 'fill-antialias': true }
      });

      map.addSource('src-sim-affected-buildings', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'sim-affected-buildings-line',
        type: 'line',
        source: 'src-sim-affected-buildings',
        minzoom: 13.5,
        layout: { visibility: 'none' },
        paint: { 'line-color': '#f59e0b', 'line-width': 1.25, 'line-opacity': 0.78 }
      });

      map.addSource('src-settlements', { type: 'geojson', data: asGeoInput(ds.settlements) });
      map.addLayer({
        id: 'settlements-residential-fill',
        type: 'fill',
        source: 'src-settlements',
        filter: ['==', ['get', 'kind'], 'residential'],
        layout: { visibility: 'visible' },
        paint: { 'fill-color': '#d97706', 'fill-opacity': 0.14 }
      });
      map.addLayer({
        id: 'settlements-buildings-fill',
        type: 'fill',
        source: 'src-settlements',
        filter: ['==', ['get', 'kind'], 'building'],
        minzoom: 13.2,
        layout: { visibility: 'visible' },
        paint: { 'fill-color': '#ea580c', 'fill-opacity': 0.28 }
      });
      map.addLayer({
        id: 'settlements-buildings-line',
        type: 'line',
        source: 'src-settlements',
        filter: ['==', ['get', 'kind'], 'building'],
        minzoom: 13.5,
        layout: { visibility: 'visible' },
        paint: { 'line-color': '#9a3412', 'line-width': 0.85, 'line-opacity': 0.82 }
      });

      map.addSource('src-osm-context', { type: 'geojson', data: asGeoInput(ds.osmContext) });
      map.addLayer({
        id: 'osm-roads-casing',
        type: 'line',
        source: 'src-osm-context',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.roads.casingColor,
          'line-width': ['case', ['==', ['get', 'highway'], 'secondary'], p.roads.secondaryCasingWidth, p.roads.localCasingWidth],
          'line-opacity': p.roads.casingOpacity
        }
      });
      map.addLayer({
        id: 'osm-roads',
        type: 'line',
        source: 'src-osm-context',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'highway'], 'secondary'], p.roads.secondaryCoreColor, p.roads.localCoreColor],
          'line-width': ['case', ['==', ['get', 'highway'], 'secondary'], p.roads.secondaryCoreWidth, p.roads.localCoreWidth],
          'line-opacity': 0.96
        }
      });

      map.addSource('src-contours', { type: 'geojson', data: asGeoInput(ds.contours) });
      map.addLayer({
        id: 'contours-casing',
        type: 'line',
        source: 'src-contours',
        filter: ['==', ['get', 'major'], true],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#161c1a',
          'line-width': 3.0,
          'line-opacity': p.contours.majorCasingOpacity
        }
      });
      map.addLayer({
        id: 'contours-line',
        type: 'line',
        source: 'src-contours',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'major'], true], p.contours.majorColor, p.contours.minorColor],
          'line-width': ['case', ['==', ['get', 'major'], true], 1.65, 1.0],
          'line-opacity': ['case', ['==', ['get', 'major'], true], p.contours.majorOpacity, p.contours.minorOpacity]
        }
      });

      map.addSource('src-agam-rbi', { type: 'geojson', data: asGeoInput(ds.agamRbiRivers || EMPTY_FC) });
      map.addLayer({
        id: 'agam-rbi-casing',
        type: 'line',
        source: 'src-agam-rbi',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.agamRbi.casingColor,
          'line-width': ['match', ['get', 'kind'], 'river', 5.2, 3.8],
          'line-opacity': p.agamRbi.casingOpacity
        }
      });
      map.addLayer({
        id: 'agam-rbi-line',
        type: 'line',
        source: 'src-agam-rbi',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.agamRbi.lineColor,
          'line-width': ['match', ['get', 'kind'], 'river', 3.0, 2.1],
          'line-dasharray': [4, 2.2],
          'line-opacity': p.agamRbi.lineOpacity
        }
      });

      map.addSource('src-flows', { type: 'geojson', data: asGeoInput(ds.flowPaths) });
      map.addLayer({
        id: 'flows-glow',
        type: 'line',
        source: 'src-flows',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.flows.backingColor,
          'line-width': ['match', ['get', 'tier'], 1, 4.8, 2, 3.6, 2.6],
          'line-opacity': p.flows.backingOpacity
        }
      });
      map.addLayer({
        id: 'flows-line',
        type: 'line',
        source: 'src-flows',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.flows.lineColor,
          'line-width': ['match', ['get', 'tier'], 1, 2.4, 2, 1.7, 1.25],
          'line-dasharray': [2.2, 2.2],
          'line-opacity': p.flows.lineOpacity
        }
      });
      map.addLayer({
        id: 'flows-arrows',
        type: 'symbol',
        source: 'src-flows',
        layout: {
          visibility: 'none',
          'symbol-placement': 'line',
          'symbol-spacing': 75,
          'icon-image': 'icon-flow-arrow',
          'icon-size': 0.78,
          'icon-allow-overlap': false,
          'icon-rotation-alignment': 'map',
          'icon-keep-upright': false
        }
      });

      map.addSource('src-verified-merged-flow', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'verified-waterways-merged-glow',
        type: 'line',
        source: 'src-verified-merged-flow',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': ['match', ['get', 'kind'], 'river', 13.5, 'stream', 11.5, 9.5],
          'line-opacity': 0.42,
          'line-blur': 1.5
        }
      });

      map.addSource('src-verified-waterways', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'verified-waterways-casing',
        type: 'line',
        source: 'src-verified-waterways',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'kind'], 'culvert'], '#334155', '#ffffff'],
          'line-width': ['match', ['get', 'kind'], 'river', 6.4, 'stream', 5.2, 'culvert', 5.0, 4.2],
          'line-opacity': 0.9
        }
      });
      map.addLayer({
        id: 'verified-waterways-line',
        type: 'line',
        source: 'src-verified-waterways',
        filter: ['!=', ['get', 'kind'], 'culvert'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'status'], 'clogged'],
            '#b45309',
            ['==', ['get', 'status'], 'damaged'],
            '#c2410c',
            ['==', ['get', 'status'], 'critical'],
            '#b91c1c',
            ['match', ['get', 'kind'], 'canal', '#0d9488', 'drain', '#0d9488', '#0369a1']
          ],
          'line-width': ['match', ['get', 'kind'], 'river', 3.8, 'stream', 2.8, 2.3],
          'line-opacity': 0.96
        }
      });
      map.addLayer({
        id: 'verified-culverts-line',
        type: 'line',
        source: 'src-verified-waterways',
        filter: ['==', ['get', 'kind'], 'culvert'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'status'],
            'clogged',
            '#f59e0b',
            'damaged',
            '#fb923c',
            'critical',
            '#f87171',
            '#2dd4bf'
          ],
          'line-width': 2.6,
          'line-dasharray': [1.4, 1.4],
          'line-opacity': 0.98
        }
      });

      map.addLayer({
        id: 'verified-waterways-arrows',
        type: 'symbol',
        source: 'src-verified-waterways',
        layout: {
          visibility: 'visible',
          'symbol-placement': 'line',
          'symbol-spacing': 82,
          'icon-image': 'icon-waterway-arrow',
          'icon-size': ['match', ['get', 'kind'], 'river', 0.92, 'stream', 0.84, 0.78],
          'icon-allow-overlap': false,
          'icon-rotation-alignment': 'map',
          'icon-keep-upright': false
        },
        paint: { 'icon-opacity': 0.96 }
      });

      map.addSource('src-runoff-confluences', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'runoff-confluences-ring',
        type: 'circle',
        source: 'src-runoff-confluences',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 8.5,
          'circle-color': 'rgba(56, 189, 248, 0.24)',
          'circle-stroke-color': '#0369a1',
          'circle-stroke-width': 1.5
        }
      });
      map.addLayer({
        id: 'runoff-confluences-dot',
        type: 'circle',
        source: 'src-runoff-confluences',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 4.2,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.6
        }
      });

      map.addSource('src-flow-particles', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'flow-particles',
        type: 'circle',
        source: 'src-flow-particles',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': [
            'match',
            ['get', 'kind'],
            'dem',
            '#fef3c7',
            'merged',
            [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'mix'], 1],
              0,
              '#fde68a',
              0.16,
              '#7dd3fc',
              0.48,
              '#e0f2fe'
            ],
            '#e0f2fe'
          ],
          'circle-stroke-color': [
            'match',
            ['get', 'kind'],
            'dem',
            '#b45309',
            'merged',
            [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'mix'], 1],
              0,
              '#b45309',
              0.18,
              '#0284c7',
              1,
              '#0369a1'
            ],
            '#0369a1'
          ],
          'circle-stroke-width': ['match', ['get', 'kind'], 'dem', 1.5, 'merged', 1.8, 1.6],
          'circle-opacity': 0.94
        }
      });

      map.addSource('src-das', { type: 'geojson', data: asGeoInput(ds.watershed) });
      map.addLayer({
        id: 'das-line',
        type: 'line',
        source: 'src-das',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#1b382d', 'line-width': 2.2, 'line-opacity': 0.65 }
      });

      const agamCtx = ds.agamContext;
      map.addSource('src-agam-landslide', {
        type: 'geojson',
        data: asGeoInput(agamCtx?.landslideHazard || EMPTY_FC)
      });
      map.addLayer({
        id: 'agam-landslide-fill',
        type: 'fill',
        source: 'src-agam-landslide',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'match',
            ['get', 'level'],
            'Tinggi',
            p.agamLandslide.highFill,
            'Sedang',
            p.agamLandslide.medFill,
            p.agamLandslide.lowFill
          ],
          'fill-opacity': p.agamLandslide.fillOpacity
        }
      });
      map.addLayer({
        id: 'agam-landslide-casing',
        type: 'line',
        source: 'src-agam-landslide',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.agamLandslide.casingColor,
          'line-width': 3.0,
          'line-opacity': p.agamLandslide.casingOpacity
        }
      });
      map.addLayer({
        id: 'agam-landslide-line',
        type: 'line',
        source: 'src-agam-landslide',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'level'],
            'Tinggi',
            p.agamLandslide.highLine,
            'Sedang',
            p.agamLandslide.medLine,
            p.agamLandslide.lowLine
          ],
          'line-width': p.agamLandslide.lineWidth
        }
      });

      map.addSource('src-agam-forest', {
        type: 'geojson',
        data: asGeoInput(agamCtx?.forestStatus || EMPTY_FC)
      });
      map.addLayer({
        id: 'agam-forest-fill',
        type: 'fill',
        source: 'src-agam-forest',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'match',
            ['get', 'fungsi'],
            'HL',
            p.agamForest.hlFill,
            'KSA/KPA',
            p.agamForest.ksaFill,
            p.agamForest.aplFill
          ],
          'fill-opacity': ['match', ['get', 'fungsi'], 'APL', 0.05, p.agamForest.fillOpacity]
        }
      });
      map.addLayer({
        id: 'agam-forest-casing',
        type: 'line',
        source: 'src-agam-forest',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.agamForest.casingColor,
          'line-width': 3.4,
          'line-opacity': p.agamForest.casingOpacity
        }
      });
      map.addLayer({
        id: 'agam-forest-line',
        type: 'line',
        source: 'src-agam-forest',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.agamForest.lineColor,
          'line-width': p.agamForest.lineWidth,
          'line-dasharray': [4, 2]
        }
      });

      map.addSource('src-agam-soil', {
        type: 'geojson',
        data: asGeoInput(agamCtx?.soil || EMPTY_FC)
      });
      map.addLayer({
        id: 'agam-soil-fill',
        type: 'fill',
        source: 'src-agam-soil',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'match',
            ['get', 'soilType'],
            'Andosol',
            p.agamSoil.andosolFill,
            p.agamSoil.otherFill
          ],
          'fill-opacity': p.agamSoil.fillOpacity
        }
      });
      map.addLayer({
        id: 'agam-soil-casing',
        type: 'line',
        source: 'src-agam-soil',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.agamSoil.casingColor,
          'line-width': 3.0,
          'line-opacity': p.agamSoil.casingOpacity
        }
      });
      map.addLayer({
        id: 'agam-soil-line',
        type: 'line',
        source: 'src-agam-soil',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.agamSoil.lineColor,
          'line-width': p.agamSoil.lineWidth
        }
      });

      // Studio Mask hiding everything outside the official Nagari Balingka territory
      map.addSource('src-mask', { type: 'geojson', data: asGeoInput(ds.mask) });
      map.addLayer({
        id: 'studio-mask-fill',
        type: 'fill',
        source: 'src-mask',
        paint: { 'fill-color': '#e5ebe8', 'fill-opacity': 1 }
      });

      map.addSource('src-nagari-boundary', { type: 'geojson', data: asGeoInput(ds.nagariBoundary) });
      map.addLayer({
        id: 'nagari-boundary-casing',
        type: 'line',
        source: 'src-nagari-boundary',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 4.5, 'line-opacity': 0.85 }
      });
      map.addLayer({
        id: 'nagari-boundary-line',
        type: 'line',
        source: 'src-nagari-boundary',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#14532d', 'line-width': 2.5, 'line-dasharray': [5, 2.5], 'line-opacity': 0.96 }
      });

      map.addSource('src-jorong-boundaries', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'jorong-fill',
        type: 'fill',
        source: 'src-jorong-boundaries',
        paint: {
          'fill-color': ['case', ['==', ['get', 'status'], 'verified'], '#0f766e', '#64748b'],
          'fill-opacity': 0.1
        }
      });
      map.addLayer({
        id: 'jorong-casing',
        type: 'line',
        source: 'src-jorong-boundaries',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['case', ['==', ['get', 'status'], 'verified'], 4.4, 3.6],
          'line-opacity': 0.85
        }
      });
      map.addLayer({
        id: 'jorong-line',
        type: 'line',
        source: 'src-jorong-boundaries',
        paint: {
          'line-color': ['case', ['==', ['get', 'status'], 'verified'], '#0f766e', '#475569'],
          'line-width': ['case', ['==', ['get', 'status'], 'verified'], 2.4, 1.8],
          'line-dasharray': [3, 2]
        }
      });

      map.addSource('src-draft-pts', { type: 'geojson', data: asGeoInput(ds.drainageDraft) });
      map.addLayer({
        id: 'draft-points',
        type: 'symbol',
        source: 'src-draft-pts',
        layout: {
          visibility: 'none',
          'icon-image': [
            'match',
            ['get', 'kind'],
            'evacuation',
            'icon-evacuation',
            'landslide',
            'icon-landslide',
            'icon-crossing-unverified'
          ],
          'icon-size': ['match', ['get', 'kind'], 'drainage', 0.78, 0.92],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      });

      map.addSource('src-verified-structures', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'verified-structures-stress-ring',
        type: 'circle',
        source: 'src-verified-structures',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 15,
          'circle-color': 'rgba(180, 83, 9, 0.16)',
          'circle-stroke-color': '#b45309',
          'circle-stroke-width': 2
        }
      });
      map.addLayer({
        id: 'verified-structures-symbol',
        type: 'symbol',
        source: 'src-verified-structures',
        layout: {
          visibility: 'visible',
          'icon-image': ['concat', 'icon-', ['get', 'kind'], '-', ['get', 'status']],
          'icon-size': 0.92,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      });

      map.addSource('src-raindrop', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'raindrop-glow',
        type: 'line',
        source: 'src-raindrop',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#38bdf8', 'line-width': 8, 'line-opacity': 0.35 }
      });
      map.addLayer({
        id: 'raindrop-line',
        type: 'line',
        source: 'src-raindrop',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0284c7', 'line-width': 3.5 }
      });

      map.addSource('src-profile', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'profile-casing',
        type: 'line',
        source: 'src-profile',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 5.5, 'line-opacity': 0.92 }
      });
      map.addLayer({
        id: 'profile-line',
        type: 'line',
        source: 'src-profile',
        paint: { 'line-color': '#12231c', 'line-width': 3, 'line-dasharray': [2, 2] }
      });

      map.addSource('src-community', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'community-lines',
        type: 'line',
        source: 'src-community',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'status'],
            'normal',
            '#059669',
            'clogged',
            '#d97706',
            'damaged',
            '#ea580c',
            'critical',
            '#dc2626',
            '#0284c7'
          ],
          'line-width': 4,
          'line-dasharray': [3, 1.5]
        }
      });
      map.addLayer({
        id: 'community-points',
        type: 'circle',
        source: 'src-community',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 7.5,
          'circle-color': [
            'match',
            ['get', 'status'],
            'normal',
            '#059669',
            'clogged',
            '#d97706',
            'damaged',
            '#ea580c',
            'critical',
            '#dc2626',
            '#0284c7'
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5
        }
      });

      map.addSource('src-draw-preview', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'draw-preview-poly',
        type: 'fill',
        source: 'src-draw-preview',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#0284c7', 'fill-opacity': 0.18 }
      });
      map.addLayer({
        id: 'draw-preview-line',
        type: 'line',
        source: 'src-draw-preview',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#0284c7', 'line-width': 3, 'line-dasharray': [2, 2] }
      });
      map.addLayer({
        id: 'draw-preview-pts',
        type: 'circle',
        source: 'src-draw-preview',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#0284c7',
          'circle-stroke-width': 2.5
        }
      });

      map.addSource('src-editing-waterway', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'editing-waterway-line',
        type: 'line',
        source: 'src-editing-waterway',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#06b6d4', 'line-width': 3.5, 'line-dasharray': [2, 1.5] }
      });

      map.addSource('src-snap-indicator', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'snap-indicator-ring',
        type: 'circle',
        source: 'src-snap-indicator',
        paint: {
          'circle-radius': 9,
          'circle-color': 'rgba(5, 150, 105, 0.16)',
          'circle-stroke-color': '#059669',
          'circle-stroke-width': 2.5
        }
      });

      // Balingka-only OSM Jorong / Village labels
      const placedLabels: [number, number][] = [];
      const priorityPlaces = ds.osmContext.features
        .filter((f: GeoFeature) => f.properties?.kind === 'place' && f.geometry.type === 'Point')
        .sort((a: GeoFeature, b: GeoFeature) => {
          const ap = a.properties?.place === 'village' ? 0 : 1;
          const bp = b.properties?.place === 'village' ? 0 : 1;
          return ap - bp;
        });

      const bbox = ds.bbox;
      for (const f of priorityPlaces) {
        if (f.geometry.type !== 'Point') continue;
        const coords = f.geometry.coordinates;
        if (
          coords[0] < bbox.west + 0.0025 ||
          coords[0] > bbox.east - 0.002 ||
          coords[1] < bbox.south + 0.002 ||
          coords[1] > bbox.north - 0.002
        ) {
          continue;
        }
        const tooClose = placedLabels.some(p => Math.hypot(p[0] - coords[0], p[1] - coords[1]) < 0.003);
        if (tooClose) continue;
        placedLabels.push(coords);
        const placeName = String(f.properties?.name || '');
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'jorong-pill';
        el.textContent = placeName;
        el.addEventListener('click', ev => {
          ev.stopPropagation();
          if (activeToolRef.current) return;
          const norm = placeName.trim().toLowerCase();
          const matchedPreset =
            norm === 'balingka'
              ? 'center'
              : norm === 'subarang'
              ? 'subarang'
              : norm === 'koto hilalang'
              ? 'hilalang'
              : norm === 'pahambatan'
              ? 'pahambatan'
              : null;
          if (matchedPreset) {
            onSelectJorongPillRef.current?.(matchedPreset);
          }
          map.flyTo({ center: coords, zoom: 15.6, duration: 750 });
        });
        new Marker({ element: el, anchor: 'center' }).setLngLat(coords).addTo(map);
      }

      // Decluttered 100m contour chips
      const seenElev = new Set<number>();
      for (const f of ds.contours.features) {
        const elev = Number(f.properties?.elev);
        if (!f.properties?.major || seenElev.has(elev) || f.geometry.type !== 'LineString') continue;
        if (f.geometry.coordinates.length < 8) continue;
        seenElev.add(elev);
        const mid = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
        const el = document.createElement('div');
        el.className = 'contour-chip';
        el.textContent = `${elev}m`;
        const marker = new Marker({ element: el, anchor: 'center' }).setLngLat(mid).addTo(map);
        contourMarkersRef.current.push({ marker, el });
      }

      const interactiveLayers = [
        'verified-structures-symbol',
        'draft-points',
        'community-points',
        'community-lines',
        'verified-waterways-line',
        'verified-culverts-line',
        'flows-line',
        'agam-rbi-line'
      ];
      for (const lid of interactiveLayers) {
        map.on('mouseenter', lid, () => {
          if (!activeToolRef.current) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', lid, () => {
          if (!activeToolRef.current) map.getCanvas().style.cursor = '';
        });
        map.on('click', lid, (e: MapLayerMouseEvent) => {
          if (activeToolRef.current) return;
          const feat = e.features?.[0];
          if (!feat) return;
          const propsObj = (feat.properties || {}) as GeoProperties;
          const isEn = langRef.current === 'en';

          if (lid === 'verified-structures-symbol') {
            if (popupRef.current) popupRef.current.remove();
            const stId = String(propsObj.id || '');
            const fullSt = verifiedStructuresRef.current.find(s => s.properties.id === stId);
            const canEdit = editorUnlockedRef.current && apiAvailableRef.current && Boolean(fullSt);
            const canUnlock = !editorUnlockedRef.current && apiAvailableRef.current && requiresPassphraseRef.current;
            const isDetail = viewModeRef.current === 'detail';
            const kindLabel =
              propsObj.kind === 'bridge'
                ? isEn
                  ? 'Bridge'
                  : 'Jembatan'
                : isEn
                ? 'Culvert'
                : 'Gorong-gorong';
            const statusLabels: Record<string, { id: string; en: string; color: string; bg: string }> = {
              normal: { id: 'Normal', en: 'Normal', color: '#047857', bg: 'rgba(4,120,87,0.12)' },
              clogged: { id: 'Tersumbat', en: 'Clogged', color: '#b45309', bg: 'rgba(180,83,9,0.14)' },
              damaged: { id: 'Rusak', en: 'Damaged', color: '#c2410c', bg: 'rgba(194,65,12,0.14)' },
              critical: { id: 'Rusak Berat', en: 'Severe', color: '#b91c1c', bg: 'rgba(185,28,28,0.14)' }
            };
            const stInfo = statusLabels[String(propsObj.status)] || statusLabels.normal;
            let actionHtml = '';
            if (canEdit) {
              actionHtml = `<button id="popup-edit-st" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
                ${isEn ? 'Edit Culvert / Bridge' : 'Edit Titik Gorong-gorong'}
              </button>`;
            } else if (canUnlock) {
              actionHtml = `<button id="popup-unlock-st" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
                ${isEn ? 'Unlock Editor to Edit' : 'Buka Editor untuk Edit'}
              </button>`;
            }
            const html = `
              <div>
                <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:${stInfo.bg};color:${stInfo.color};">
                  ${escapeHtml(isEn ? stInfo.en : stInfo.id)} · ${escapeHtml(isEn ? 'Verified' : 'Terverifikasi')}
                </span>
                <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(propsObj.name)}</h4>
                <div style="font-size:12.5px;color:#434d49;margin-bottom:6px;">
                  ${escapeHtml(kindLabel)}${propsObj.size_note ? ` · ${escapeHtml(propsObj.size_note)}` : ''}
                </div>
                ${propsObj.notes ? `<p style="margin:0 0 6px;font-size:12.5px;line-height:1.45;color:#434d49;">${escapeHtml(propsObj.notes)}</p>` : ''}
                ${isDetail && propsObj.updated_by ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#636f6a;">${escapeHtml(propsObj.updated_by)}</div>` : ''}
                ${actionHtml}
              </div>
            `;
            const pop = new Popup({ offset: 12 }).setLngLat([e.lngLat.lng, e.lngLat.lat]).setHTML(html).addTo(map);
            popupRef.current = pop;
            if (canEdit && fullSt) {
              pop.getElement()?.querySelector('#popup-edit-st')?.addEventListener('click', () => {
                pop.remove();
                onSelectStructureRef.current(fullSt);
              });
            } else if (canUnlock) {
              pop.getElement()?.querySelector('#popup-unlock-st')?.addEventListener('click', () => {
                pop.remove();
                onOpenUnlockRef.current();
              });
            }
            return;
          }

          if (lid === 'verified-waterways-line' || lid === 'verified-culverts-line') {
            if (popupRef.current) popupRef.current.remove();
            const wwId = String(propsObj.id || '');
            const fullFeat = verifiedWaterwaysRef.current.find(w => w.properties.id === wwId);
            const canEdit = editorUnlockedRef.current && apiAvailableRef.current && Boolean(fullFeat);
            const canUnlock = !editorUnlockedRef.current && apiAvailableRef.current && requiresPassphraseRef.current;
            const isDetail = viewModeRef.current === 'detail';
            const kindLabels: Record<string, { id: string; en: string }> = {
              river: { id: 'Sungai Utama', en: 'River' },
              stream: { id: 'Anak Sungai', en: 'Stream' },
              canal: { id: 'Bandar / Irigasi', en: 'Canal' },
              drain: { id: 'Parit / Drainase', en: 'Drain' },
              culvert: { id: 'Gorong-gorong', en: 'Culvert' }
            };
            const statusLabels: Record<string, { id: string; en: string }> = {
              normal: { id: 'Normal', en: 'Normal' },
              clogged: { id: 'Tersumbat', en: 'Clogged' },
              damaged: { id: 'Rusak', en: 'Damaged' },
              critical: { id: 'Rusak Berat', en: 'Severe' }
            };
            const kLabel = kindLabels[String(propsObj.kind)]?.[isEn ? 'en' : 'id'] || String(propsObj.kind || '');
            const sLabel = statusLabels[String(propsObj.status)]?.[isEn ? 'en' : 'id'] || String(propsObj.status || '');
            let actionHtml = '';
            if (canEdit) {
              actionHtml = `<button id="popup-edit-ww" type="button" style="margin-top:6px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
                ${isEn ? 'Correct Alignment / Direction' : 'Koreksi Jalur & Arah'}
              </button>`;
            } else if (canUnlock) {
              actionHtml = `<button id="popup-unlock-ww" type="button" style="margin-top:6px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
                ${isEn ? 'Unlock Editor to Correct' : 'Buka Editor untuk Koreksi'}
              </button>`;
            } else if (!apiAvailableRef.current) {
              actionHtml = `<div style="margin-top:6px;padding:6px 8px;border-radius:6px;background:#f2f3ef;font-size:11px;color:#434d49;">
                ${isEn ? 'Read-only preview: editing waterways & embedding into DEM requires the application server.' : 'Mode baca saja: pengeditan jalur sungai & penyisipan ke DEM hanya aktif saat terhubung ke server aplikasi.'}
              </div>`;
            }
            const html = `
              <div>
                <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:rgba(3,105,161,0.12);color:#0369a1;">
                  ${escapeHtml(isEn ? 'Verified Waterway' : 'Sungai / Saluran Terverifikasi')}
                </span>
                <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(propsObj.name)}</h4>
                <div style="font-size:12.5px;color:#434d49;margin-bottom:6px;">
                  ${escapeHtml(kLabel)} · ${escapeHtml(sLabel)} · ${escapeHtml(propsObj.length_m)} m
                </div>
                ${propsObj.notes ? `<p style="margin:0 0 6px;font-size:12.5px;line-height:1.45;color:#434d49;">${escapeHtml(propsObj.notes)}</p>` : ''}
                ${isDetail && propsObj.updated_by ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#636f6a;margin-bottom:6px;">${escapeHtml(propsObj.updated_by)}</div>` : ''}
                ${actionHtml}
              </div>
            `;
            const pop = new Popup({ offset: 12 }).setLngLat([e.lngLat.lng, e.lngLat.lat]).setHTML(html).addTo(map);
            popupRef.current = pop;
            if (canEdit && fullFeat) {
              pop.getElement()?.querySelector('#popup-edit-ww')?.addEventListener('click', () => {
                pop.remove();
                onSelectWaterwayRef.current(fullFeat);
              });
            } else if (canUnlock) {
              pop.getElement()?.querySelector('#popup-unlock-ww')?.addEventListener('click', () => {
                pop.remove();
                onOpenUnlockRef.current();
              });
            }
            return;
          }

          if (lid === 'flows-line') {
            if (popupRef.current) popupRef.current.remove();
            const segId = String(propsObj.id || '');
            const rawFlow = datasetsRef.current.flowPaths.features.find(f => String(f.properties?.id) === segId);
            const coords =
              rawFlow?.geometry.type === 'LineString'
                ? subsampleCoordsForEditing(rawFlow.geometry.coordinates, 18)
                : [];
            const canEdit = editorUnlockedRef.current && apiAvailableRef.current && coords.length >= 2;
            const canUnlock = !editorUnlockedRef.current && apiAvailableRef.current && requiresPassphraseRef.current;
            const isDetail = viewModeRef.current === 'detail';
            let flowActionHtml = '';
            if (canEdit) {
              flowActionHtml = `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
                <button id="popup-redraw-dem" type="button" style="padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
                  ${isEn ? 'Trace Real River Fresh' : 'Gambar Ulang Sungai Asli'}
                </button>
                <button id="popup-promote-dem" type="button" style="padding:6px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
                  ${isEn ? 'Adjust Existing Vertices' : 'Geser Titik Jalur'}
                </button>
                <button id="popup-suppress-dem" type="button" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(22,28,26,0.2);background:#fff;color:#b91c1c;font-size:12px;font-weight:700;cursor:pointer;">
                  ${isEn ? 'Mark False & Hide Segment' : 'Tandai Keliru & Sembunyikan'}
                </button>
              </div>`;
            } else if (canUnlock) {
              flowActionHtml = `<button id="popup-unlock-dem" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
                ${isEn ? 'Unlock Editor to Fix Path' : 'Buka Editor untuk Koreksi Jalur'}
              </button>`;
            } else if (!apiAvailableRef.current) {
              flowActionHtml = `<div style="margin-top:8px;padding:6px 8px;border-radius:6px;background:#f2f3ef;font-size:11px;color:#434d49;">
                ${isEn ? 'Read-only preview: correcting this estimated path requires the application server.' : 'Mode baca saja: koreksi garis perkiraan ini hanya aktif saat terhubung ke server aplikasi.'}
              </div>`;
            }
            const html = `
              <div>
                <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:rgba(180,83,9,0.14);color:#b45309;">
                  ${escapeHtml(isEn ? 'DEMNAS Elevation Computation' : 'Perkiraan Elevasi DEMNAS')}
                </span>
                <h4 style="margin:0 0 4px;font-size:13.5px;font-weight:700;color:#161c1a;">
                  ${isDetail ? escapeHtml(segId) : escapeHtml(isEn ? 'Runoff Flow Path (DEM Estimate)' : 'Alur Limpasan Air (Perkiraan DEM)')}
                </h4>
                <p style="margin:0 0 6px;font-size:12.5px;line-height:1.45;color:#434d49;">
                  ${
                    isEn
                      ? 'Mathematically computed (D8) from BIG DEMNAS 8m elevation — not a permanent river or field survey.'
                      : 'Dihitung otomatis secara matematis (D8) dari elevasi BIG DEMNAS 8m — bukan sungai permanen maupun survei lapangan.'
                  }
                </p>
                ${
                  isDetail
                    ? `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#636f6a;margin-bottom:6px;">
                        DAS ~${escapeHtml(propsObj.catchment_ha)} ha · ${escapeHtml(propsObj.length_m)} m · ${escapeHtml(propsObj.slope_pct)}%
                      </div>`
                    : ''
                }
                ${flowActionHtml}
              </div>
            `;
            const pop = new Popup({ offset: 12 }).setLngLat([e.lngLat.lng, e.lngLat.lat]).setHTML(html).addTo(map);
            popupRef.current = pop;
            if (canEdit) {
              pop.getElement()?.querySelector('#popup-redraw-dem')?.addEventListener('click', () => {
                pop.remove();
                onRedrawDemRef.current(segId);
              });
              pop.getElement()?.querySelector('#popup-promote-dem')?.addEventListener('click', () => {
                pop.remove();
                onPromoteDemRef.current(segId, coords);
              });
              pop.getElement()?.querySelector('#popup-suppress-dem')?.addEventListener('click', () => {
                pop.remove();
                onSuppressDemRef.current(segId);
              });
            } else if (canUnlock) {
              pop.getElement()?.querySelector('#popup-unlock-dem')?.addEventListener('click', () => {
                pop.remove();
                onOpenUnlockRef.current();
              });
            }
            return;
          }

          if (lid === 'agam-rbi-line') {
            if (popupRef.current) popupRef.current.remove();
            const rbiName = String(propsObj.name || 'Anak Sungai RBI');
            const rbiKind: WaterwayKind = propsObj.kind === 'river' ? 'river' : 'stream';
            const rawCoords = (feat.geometry.type === 'LineString' ? feat.geometry.coordinates : []) as [number, number][];
            const coords = rawCoords.map((c: [number, number]) => [Number(c[0]), Number(c[1])] as [number, number]);
            const canEdit = editorUnlockedRef.current && apiAvailableRef.current;
            const canUnlock = !editorUnlockedRef.current && apiAvailableRef.current && requiresPassphraseRef.current;
            const actionHtml = canEdit
              ? `<button id="popup-promote-rbi" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#0369a1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">
                  ${isEn ? 'Promote to Verified Waterway' : 'Jadikan Jalur Air Terverifikasi'}
                </button>`
              : canUnlock
              ? `<button id="popup-unlock-rbi" type="button" style="margin-top:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid #0369a1;background:#fff;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">
                  ${isEn ? 'Unlock Editor to Promote' : 'Buka Editor untuk Verifikasi'}
                </button>`
              : '';
            const html = `
              <div>
                <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:6px;background:rgba(14,116,144,0.14);color:#0e7490">
                  Pemkab Agam · RBI 1:50k
                </span>
                <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#161c1a;">${escapeHtml(rbiName)}</h4>
                <div style="font-size:11.5px;color:#434d49;">DAS ${escapeHtml(propsObj.das || 'MASANG KIRI')}</div>
                ${actionHtml}
              </div>
            `;
            const pop = new Popup({ offset: 12 }).setLngLat([e.lngLat.lng, e.lngLat.lat]).setHTML(html).addTo(map);
            popupRef.current = pop;
            if (canEdit) {
              pop.getElement()?.querySelector('#popup-promote-rbi')?.addEventListener('click', () => {
                pop.remove();
                onPromoteRbiRef.current(rbiName, rbiKind, coords);
              });
            } else if (canUnlock) {
              pop.getElement()?.querySelector('#popup-unlock-rbi')?.addEventListener('click', () => {
                pop.remove();
                onOpenUnlockRef.current();
              });
            }
            return;
          }

          const isComm = lid.startsWith('community');
          openPopup([e.lngLat.lng, e.lngLat.lat], propsObj, isComm);
        });
      }

      animPathsRef.current = ds.flowPaths.features
        .filter((f: GeoFeature) => f.geometry.type === 'LineString' && Number(f.properties?.tier) <= 2)
        .sort((a: GeoFeature, b: GeoFeature) => Number(b.properties?.length_m || 0) - Number(a.properties?.length_m || 0))
        .slice(0, 38);

      const stepAnim = (ts: number) => {
        if (ts - lastTs > 50) {
          const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0.05);
          lastTs = ts;
          const animActive = flowAnimActiveRef.current;
          const src = map.getSource('src-flow-particles') as GeoJSONSource | undefined;

          if (!animActive) {
            if (src && !particlesClearedRef.current) {
              src.setData(asGeoInput(EMPTY_FC));
              particlesClearedRef.current = true;
            }
          } else {
            particlesClearedRef.current = false;
            const speed = 0.16;
            particlePhase = (particlePhase + dt * speed) % 1;

            if (src) {
              const features: GeoFeature[] = [];
              const animPaths = animPathsRef.current;
              for (let i = 0; i < animPaths.length; i++) {
                const f = animPaths[i];
                if (f.geometry.type !== 'LineString') continue;
                const segId = String(f.properties?.id || '');
                if (suppressedDemSetRef.current.has(segId)) continue;
                const tier = Number(f.properties?.tier || 2);
                const lenM = Number(f.properties?.length_m || 0);
                const isMerging = mergingFlowIdsRef.current.has(segId);
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

              if (layersRef.current.verifiedWaterways) {
                const mergedReaches = mergedReachesRef.current;
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

                for (let i = 0; i < verifiedWaterwaysRef.current.length; i++) {
                  const ww = verifiedWaterwaysRef.current[i];
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

      mapLoadedRef.current = true;
      setMapReady(true);
      emitCamera(true);
    });

    map.on('click', (e: MapMouseEvent) => {
      const tool = activeToolRef.current;
      const pt: [number, number] = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];
      if (!tool) {
        const hitLayers = [
          'verified-structures-symbol',
          'draft-points',
          'community-points',
          'community-lines',
          'verified-waterways-line',
          'verified-culverts-line',
          'flows-line',
          'agam-rbi-line'
        ].filter(lid => Boolean(map.getLayer(lid)));
        const hits = hitLayers.length > 0 ? map.queryRenderedFeatures(e.point, { layers: hitLayers }) : [];
        if (hits.length > 0) return;

        // Click-to-explain corridor water zone during active simulation
        if (tabRef.current === 'sim' && simProgressRef.current > 0.02 && cascadeEngineRef.current) {
          const poolLayers = ['sim-pools-shallow-fill', 'sim-pools-deep-fill'].filter(lid =>
            Boolean(map.getLayer(lid))
          );
          const poolHits = poolLayers.length > 0 ? map.queryRenderedFeatures(e.point, { layers: poolLayers }) : [];
          if (poolHits.length > 0) {
            if (popupRef.current) popupRef.current.remove();
            const isEn = langRef.current === 'en';
            const elev = Math.round(demRef.current.getElevation(pt[0], pt[1]));
            const sample = cascadeEngineRef.current.sampleAtLngLat(pt[0], pt[1]);
            const cp = cascadeParamsRef.current;
            const drainLabel =
              cp.drainCondition === 'cleared'
                ? isEn
                  ? 'Cleared'
                  : 'Lancar'
                : cp.drainCondition === 'surge'
                  ? isEn
                    ? 'Clogged + Surge'
                    : 'Tersumbat + Gelombang'
                  : isEn
                    ? 'Clogged'
                    : 'Tersumbat';
            const soilLabel =
              cp.soilMoisture === 'dry'
                ? isEn
                  ? 'Dry'
                  : 'Kering'
                : cp.soilMoisture === 'moist'
                  ? isEn
                    ? 'Moist'
                    : 'Lembab'
                  : isEn
                    ? 'Saturated'
                    : 'Jenuh';
            const html = `
              <div style="min-width:235px;max-width:290px;">
                <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:4px;padding-right:18px;line-height:1.35;">
                  ${
                    isEn
                      ? 'Low-Lying River Corridor Zone (~40 m Model)'
                      : 'Zona Elevasi Rendah Koridor Sungai (Model ~40 m)'
                  }
                </div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#434d49;margin-bottom:6px;">
                  ${elev} mdpl · HAND ~${sample.handM.toFixed(1)} m
                </div>
                <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:11.5px;">
                  <span style="color:#636f6a;">${isEn ? 'Scenario' : 'Skenario'}</span>
                  <strong style="color:#161c1a;text-align:right;">${cp.rainMmHr} mm/${isEn ? 'hr' : 'jam'} · ${drainLabel} · ${soilLabel}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:11.5px;">
                  <span style="color:#636f6a;">${isEn ? 'Effective runoff' : 'Limpasan efektif'}</span>
                  <strong style="color:#161c1a;">~${Math.round(sample.runoffMm)} mm</strong>
                </div>
                <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:11.5px;">
                  <span style="color:#636f6a;">${isEn ? 'Indicative depth' : 'Kedalaman indikatif'}</span>
                  <strong style="color:#0369a1;">~${sample.depthM.toFixed(1)} m</strong>
                </div>
                <div style="margin-top:6px;font-size:10.5px;line-height:1.4;color:#434d49;">
                  ${
                    isEn
                      ? 'This shaded zone marks low-lying valley/river-corridor cells (~40 m grid) relative to the nearest drainage channel. When culverts clog during heavy rain, runoff can spread around this corridor. It is NOT a house-level flood survey or an official BNPB/BPBD/BMKG warning.'
                      : 'Area biru ini menandakan koridor lembah/sungai yang elevasinya rendah terhadap alur air terdekat pada skala grid ~40 m. Bila gorong-gorong/saluran tersumbat saat hujan deras, limpasan berpotensi meluas ke sekitar area ini. Ini BUKAN pengukuran banjir per rumah dan bukan peringatan resmi BNPB/BPBD/BMKG.'
                  }
                </div>
              </div>
            `;
            const pop = new Popup({ offset: 12, maxWidth: '320px' })
              .setLngLat([e.lngLat.lng, e.lngLat.lat])
              .setHTML(html)
              .addTo(map);
            popupRef.current = pop;
            return;
          }
        }

        if (!isPointInNagari(datasetsRef.current.nagariBoundary, pt[0], pt[1])) return;
        const agamCtx = datasetsRef.current.agamContext;
        const prof = lookupAgamAtPoint(agamCtx, pt[0], pt[1]);
        if (!prof) return;

        if (popupRef.current) popupRef.current.remove();
        const isEn = langRef.current === 'en';
        const elev = Math.round(demRef.current.getElevation(pt[0], pt[1]));
        const slope = Math.round(demRef.current.getSlopePercent(pt[0], pt[1]));
        const lsLevel =
          prof.landslideLevel ||
          (isEn
            ? 'Outside mapped polygon (not a safety guarantee)'
            : 'Tidak termasuk poligon peta (bukan jaminan aman)');
        const lsColor =
          prof.landslideLevel === 'Tinggi'
            ? '#b91c1c'
            : prof.landslideLevel === 'Sedang'
            ? '#b45309'
            : prof.landslideLevel === 'Rendah'
            ? '#3f6212'
            : '#636f6a';
        const row = (label: string, val: string | null) =>
          val
            ? `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:12px;">
                <span style="color:#636f6a;flex-shrink:0;">${escapeHtml(label)}</span>
                <strong style="color:#161c1a;text-align:right;">${escapeHtml(val)}</strong>
              </div>`
            : '';

        const html = `
          <div style="min-width:220px;">
            <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:4px;">
              ${isEn ? 'Pemkab Agam Open Map Attributes' : 'Atribut Peta Terbuka Pemkab Agam'}
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#434d49;margin-bottom:6px;">
              ${elev} mdpl · ${isEn ? 'Slope' : 'Lereng'} ${slope}%
            </div>
            <div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(22,28,26,0.08);font-size:12px;">
              <span style="color:#636f6a;">${isEn ? 'Ground Movement Map' : 'Peta Gerakan Tanah'}</span>
              <strong style="color:${lsColor};text-align:right;">${escapeHtml(lsLevel)}</strong>
            </div>
            ${row(isEn ? 'Soil Type' : 'Jenis Tanah', prof.soilType ? `${prof.soilType}${prof.soilSensitivity ? ` (${prof.soilSensitivity})` : ''}` : null)}
            ${row(isEn ? 'Geology' : 'Geologi', prof.geology)}
            ${row(isEn ? 'Forest SK 35' : 'Kawasan Hutan', prof.forestLabel ? `${prof.forestStatus} · ${prof.forestLabel}` : prof.forestStatus)}
            ${row(isEn ? 'BMKG Rainfall' : 'Curah Hujan', prof.rainfallAnnualMm)}
            <div style="margin-top:6px;font-size:10.5px;line-height:1.35;color:#636f6a;">
              ${escapeHtml(
                isEn
                  ? 'Source: Pemkab Agam Open GIS (reference polygon attributes, not a house-level survey).'
                  : 'Sumber: Pemkab Agam Open GIS (atribut poligon referensi, bukan pengukuran per rumah).'
              )}
            </div>
          </div>
        `;
        popupRef.current = new Popup({ offset: 10 }).setLngLat(pt).setHTML(html).addTo(map);
        return;
      }
      if (tool === 'drawWaterway' || tool === 'redrawWaterway') {
        const snap = snapPointToWaterways(
          pt,
          verifiedWaterwaysRef.current,
          editingWaterwayRef.current?.id || null,
          22
        );
        if (snap.snapped && snap.targetName) {
          onSnapFeedbackRef.current?.(
            langRef.current === 'en' ? `Snapped to ${snap.targetName}` : `Menempel ke ${snap.targetName}`
          );
        }
        onMapClickRef.current(snap.point);
        return;
      }
      onMapClickRef.current(pt);
    });

    let lastTel = 0;
    map.on('mousemove', (e: MapMouseEvent) => {
      if (isDraggingVertexRef.current) return;
      const now = performance.now();
      if (now - lastTel < 65) return;
      lastTel = now;
      const { lng, lat } = e.lngLat;
      const tool = activeToolRef.current;
      if (tool === 'drawWaterway' || tool === 'redrawWaterway') {
        const snapSrc = map.getSource('src-snap-indicator') as GeoJSONSource | undefined;
        if (snapSrc) {
          const snap = snapPointToWaterways(
            [lng, lat],
            verifiedWaterwaysRef.current,
            editingWaterwayRef.current?.id || null,
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
      onCursorRef.current({
        lng,
        lat,
        elev: demRef.current.getElevation(lng, lat),
        slope: demRef.current.getSlopePercent(lng, lat)
      });
    });

    return () => {
      if (camRafId) cancelAnimationFrame(camRafId);
      cancelAnimationFrame(animTimerId);
      if (raindropAnimRef.current) cancelAnimationFrame(raindropAnimRef.current);
      if (controlRefProp.current) controlRefProp.current.current = null;
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

    // Physical Cascade Flood & Landslide Overlays (falling back to static HAND if cascadeEngine unavailable)
    const showFlood = isRaining;
    const useDynamicCascade = Boolean(props.cascadeEngine);
    let activeHandId: string | null = null;
    let handOpacity = 0.72;
    if (showFlood && !useDynamicCascade) {
      const accumulatedMm = props.simRain * ((props.simDurationMin * props.simProgress) / 60);
      const effectiveLoad = props.simRain * 0.45 + accumulatedMm * 0.55;
      const level = effectiveLoad < 45 ? 'low' : effectiveLoad < 105 ? 'med' : 'high';
      activeHandId = `hand-${props.simScenario}-${level}`;
      const baseMax = props.simScenario === 'cleared' ? 0.56 : 0.72;
      handOpacity = Math.min(baseMax, 0.22 + Math.min(1, props.simProgress * 1.15) * (baseMax - 0.22));
    }
    for (const hid of HAND_LAYERS) {
      const isOn = hid === activeHandId;
      map.setLayoutProperty(hid, 'visibility', vis(isOn));
      if (isOn) map.setPaintProperty(hid, 'raster-opacity', handOpacity);
    }

    const showCascadeLayers = showFlood && useDynamicCascade;
    map.setLayoutProperty('sim-pools-shallow-fill', 'visibility', vis(showCascadeLayers));
    map.setLayoutProperty('sim-pools-deep-fill', 'visibility', vis(showCascadeLayers));
    map.setLayoutProperty(
      'sim-affected-buildings-line',
      'visibility',
      vis(showCascadeLayers && props.layers.settlements)
    );
    map.setLayoutProperty('cascade-landslide-overlay', 'visibility', vis(showCascadeLayers));
    let cascadeTimer: number | null = null;
    if (!showCascadeLayers) {
      lastCascadeKeyRef.current = '';
      const shallowSrc = map.getSource('src-sim-pools-shallow') as GeoJSONSource | undefined;
      const deepSrc = map.getSource('src-sim-pools-deep') as GeoJSONSource | undefined;
      const bldSrc = map.getSource('src-sim-affected-buildings') as GeoJSONSource | undefined;
      if (shallowSrc) shallowSrc.setData(asGeoInput(EMPTY_FC));
      if (deepSrc) deepSrc.setData(asGeoInput(EMPTY_FC));
      if (bldSrc) bldSrc.setData(asGeoInput(EMPTY_FC));
      setPoolGlintPoints(prev => (prev.length > 0 ? [] : prev));
    } else if (props.cascadeEngine) {
      const cp = props.cascadeParams;
      const engine = props.cascadeEngine;
      const cacheKey = `${cp.rainMmHr}|${cp.durationMin}|${cp.progress.toFixed(3)}|${cp.soilMoisture}|${cp.rainPattern}|${cp.drainCondition}|${cp.forestScenario}|${props.verifiedWaterways.length}`;
      const renderCascade = () => {
        lastCascadeKeyRef.current = cacheKey;
        lastCascadeTsRef.current = performance.now();
        engine.evaluate(cp);

        const pools = extractFloodPoolPolygons(engine, props.verifiedWaterways);
        const shallowSrc = map.getSource('src-sim-pools-shallow') as GeoJSONSource | undefined;
        const deepSrc = map.getSource('src-sim-pools-deep') as GeoJSONSource | undefined;
        const bldSrc = map.getSource('src-sim-affected-buildings') as GeoJSONSource | undefined;
        if (shallowSrc) shallowSrc.setData(asGeoInput(pools.shallow));
        if (deepSrc) deepSrc.setData(asGeoInput(pools.deep));
        if (bldSrc) {
          bldSrc.setData(
            asGeoInput(extractAffectedBuildings(props.datasets.settlements, pools.filteredDepth, engine.fields))
          );
        }
        setPoolGlintPoints(pools.glintPoints);

        const outSize = 256;
        const { landslideRgba } = engine.renderRgba(outSize);

        if (!landslideCanvasRef.current) {
          const c = document.createElement('canvas');
          c.width = outSize;
          c.height = outSize;
          landslideCanvasRef.current = c;
        }

        const { bbox } = props.datasets;
        const imgCoords: [[number, number], [number, number], [number, number], [number, number]] = [
          [bbox.west, bbox.north],
          [bbox.east, bbox.north],
          [bbox.east, bbox.south],
          [bbox.west, bbox.south]
        ];

        const lCtx = landslideCanvasRef.current.getContext('2d');
        if (lCtx) {
          lCtx.putImageData(new ImageData(new Uint8ClampedArray(landslideRgba), outSize, outSize), 0, 0);
          const srcLs = map.getSource('img-cascade-landslide') as ImageSource | undefined;
          if (srcLs && typeof srcLs.updateImage === 'function') {
            srcLs.updateImage({ url: landslideCanvasRef.current.toDataURL('image/png'), coordinates: imgCoords });
          }
        }
      };

      if (cacheKey !== lastCascadeKeyRef.current) {
        const elapsed = performance.now() - lastCascadeTsRef.current;
        if (elapsed >= 70) {
          renderCascade();
        } else {
          cascadeTimer = window.setTimeout(renderCascade, 75 - elapsed);
        }
      }
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
    return () => {
      if (cascadeTimer !== null) window.clearTimeout(cascadeTimer);
    };
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
    const isStorm = props.tab === 'sim' && props.rainAnimEnabled && props.simProgress > 0.02;
    const stormFactor = isStorm
      ? Math.min(1, props.simRain / 130) * Math.min(1, props.simProgress * 2.5)
      : 0;
    const key = stormFactor.toFixed(2);
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
  }, [mapReady, props.tab, props.rainAnimEnabled, props.simProgress, props.simRain]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const pal = getOverlayContrastPalette(props.basemap);

    map.setPaintProperty('osm-roads-casing', 'line-color', pal.roads.casingColor);
    map.setPaintProperty('osm-roads-casing', 'line-opacity', pal.roads.casingOpacity);
    map.setPaintProperty('osm-roads-casing', 'line-width', [
      'case',
      ['==', ['get', 'highway'], 'secondary'],
      pal.roads.secondaryCasingWidth,
      pal.roads.localCasingWidth
    ]);
    map.setPaintProperty('osm-roads', 'line-color', [
      'case',
      ['==', ['get', 'highway'], 'secondary'],
      pal.roads.secondaryCoreColor,
      pal.roads.localCoreColor
    ]);
    map.setPaintProperty('osm-roads', 'line-width', [
      'case',
      ['==', ['get', 'highway'], 'secondary'],
      pal.roads.secondaryCoreWidth,
      pal.roads.localCoreWidth
    ]);

    map.setPaintProperty('contours-casing', 'line-opacity', pal.contours.majorCasingOpacity);
    map.setPaintProperty('contours-line', 'line-color', [
      'case',
      ['==', ['get', 'major'], true],
      pal.contours.majorColor,
      pal.contours.minorColor
    ]);
    map.setPaintProperty('contours-line', 'line-opacity', [
      'case',
      ['==', ['get', 'major'], true],
      pal.contours.majorOpacity,
      pal.contours.minorOpacity
    ]);

    map.setPaintProperty('flows-glow', 'line-color', pal.flows.backingColor);
    map.setPaintProperty('flows-glow', 'line-opacity', pal.flows.backingOpacity);
    map.setPaintProperty('flows-line', 'line-color', pal.flows.lineColor);
    map.setPaintProperty('flows-line', 'line-opacity', pal.flows.lineOpacity);

    const rbiSimScale =
      props.tab === 'sim' && props.simProgress > 0.02
        ? { casing: 0.45, line: 0.65 }
        : props.tab === 'sim'
          ? { casing: 0.62, line: 0.78 }
          : { casing: 1, line: 1 };
    map.setPaintProperty('agam-rbi-casing', 'line-color', pal.agamRbi.casingColor);
    map.setPaintProperty('agam-rbi-casing', 'line-opacity', pal.agamRbi.casingOpacity * rbiSimScale.casing);
    map.setPaintProperty('agam-rbi-line', 'line-color', pal.agamRbi.lineColor);
    map.setPaintProperty('agam-rbi-line', 'line-opacity', pal.agamRbi.lineOpacity * rbiSimScale.line);

    map.setPaintProperty('agam-forest-fill', 'fill-color', [
      'match',
      ['get', 'fungsi'],
      'HL',
      pal.agamForest.hlFill,
      'KSA/KPA',
      pal.agamForest.ksaFill,
      pal.agamForest.aplFill
    ]);
    map.setPaintProperty('agam-forest-fill', 'fill-opacity', [
      'match',
      ['get', 'fungsi'],
      'APL',
      0.05,
      pal.agamForest.fillOpacity
    ]);
    map.setPaintProperty('agam-forest-casing', 'line-color', pal.agamForest.casingColor);
    map.setPaintProperty('agam-forest-casing', 'line-opacity', pal.agamForest.casingOpacity);
    map.setPaintProperty('agam-forest-line', 'line-color', pal.agamForest.lineColor);
    map.setPaintProperty('agam-forest-line', 'line-width', pal.agamForest.lineWidth);

    map.setPaintProperty('agam-soil-fill', 'fill-color', [
      'match',
      ['get', 'soilType'],
      'Andosol',
      pal.agamSoil.andosolFill,
      pal.agamSoil.otherFill
    ]);
    map.setPaintProperty('agam-soil-fill', 'fill-opacity', pal.agamSoil.fillOpacity);
    map.setPaintProperty('agam-soil-casing', 'line-color', pal.agamSoil.casingColor);
    map.setPaintProperty('agam-soil-casing', 'line-opacity', pal.agamSoil.casingOpacity);
    map.setPaintProperty('agam-soil-line', 'line-color', pal.agamSoil.lineColor);
    map.setPaintProperty('agam-soil-line', 'line-width', pal.agamSoil.lineWidth);

    map.setPaintProperty('agam-landslide-fill', 'fill-color', [
      'match',
      ['get', 'level'],
      'Tinggi',
      pal.agamLandslide.highFill,
      'Sedang',
      pal.agamLandslide.medFill,
      pal.agamLandslide.lowFill
    ]);
    map.setPaintProperty('agam-landslide-fill', 'fill-opacity', pal.agamLandslide.fillOpacity);
    map.setPaintProperty('agam-landslide-casing', 'line-color', pal.agamLandslide.casingColor);
    map.setPaintProperty('agam-landslide-casing', 'line-opacity', pal.agamLandslide.casingOpacity);
    map.setPaintProperty('agam-landslide-line', 'line-color', [
      'match',
      ['get', 'level'],
      'Tinggi',
      pal.agamLandslide.highLine,
      'Sedang',
      pal.agamLandslide.medLine,
      pal.agamLandslide.lowLine
    ]);
    map.setPaintProperty('agam-landslide-line', 'line-width', pal.agamLandslide.lineWidth);
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
      const { bbox } = props.datasets;
      const imgCoords: [[number, number], [number, number], [number, number], [number, number]] = [
        [bbox.west, bbox.north],
        [bbox.east, bbox.north],
        [bbox.east, bbox.south],
        [bbox.west, bbox.south]
      ];
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
    if (!map) return;
    map.getCanvas().style.cursor = props.activeTool ? 'crosshair' : '';
    if (props.activeTool !== 'drawWaterway' && props.activeTool !== 'redrawWaterway' && mapLoadedRef.current) {
      const snapSrc = map.getSource('src-snap-indicator') as GeoJSONSource | undefined;
      if (snapSrc) snapSrc.setData(asGeoInput(EMPTY_FC));
    }
  }, [props.activeTool]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const src = map.getSource('src-raindrop') as GeoJSONSource | undefined;
    if (raindropAnimRef.current) cancelAnimationFrame(raindropAnimRef.current);
    if (raindropMarkerRef.current) {
      raindropMarkerRef.current.remove();
      raindropMarkerRef.current = null;
    }

    if (!props.raindrop || props.raindrop.coordinates.length < 2) {
      if (src) src.setData(asGeoInput(EMPTY_FC));
      return;
    }

    const coords = props.raindrop.coordinates;
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
  }, [mapReady, props.raindrop]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    profileABRef.current.forEach(m => m.remove());
    profileABRef.current = [];

    props.profilePts.forEach((pt, idx) => {
      const el = document.createElement('div');
      el.className = 'marker-ab';
      el.textContent = idx === 0 ? 'A' : 'B';
      profileABRef.current.push(new Marker({ element: el, anchor: 'center' }).setLngLat(pt).addTo(map));
    });

    const src = map.getSource('src-profile') as GeoJSONSource | undefined;
    if (src) {
      if (props.profilePts.length === 2) {
        src.setData(
          asGeoInput({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: props.profilePts } }]
          })
        );
      } else {
        src.setData(asGeoInput(EMPTY_FC));
      }
    }
  }, [mapReady, props.profilePts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    if (!props.profileHover) {
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
        .setLngLat([props.profileHover.lng, props.profileHover.lat])
        .addTo(map);
    } else {
      profileHoverMarkerRef.current.setLngLat([props.profileHover.lng, props.profileHover.lat]);
    }
  }, [mapReady, props.profileHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const src = map.getSource('src-draw-preview') as GeoJSONSource | undefined;
    if (src) {
      const feats: GeoFeature[] = props.drawVertices.map(c => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: c }
      }));
      if (props.drawVertices.length >= 2) {
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: props.drawVertices }
        });
      }
      if (props.activeTool === 'drawJorong' && props.drawVertices.length >= 3) {
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[...props.drawVertices, props.drawVertices[0]]] }
        });
      }
      src.setData(asGeoInput({ type: 'FeatureCollection', features: feats }));
    }
  }, [mapReady, props.drawVertices, props.activeTool]);

  const editingId = props.editingWaterway?.id ?? null;
  const editingCoords = props.editingWaterway?.coordinates ?? null;

  // Interactive draggable vertex & midpoint handles for waterway alignment correction
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    vertexMarkersRef.current.forEach(m => m.remove());
    vertexMarkersRef.current = [];
    isDraggingVertexRef.current = false;

    const src = map.getSource('src-editing-waterway') as GeoJSONSource | undefined;
    if (!editingCoords || !props.editorUnlocked || editingCoords.length < 2) {
      if (src) src.setData(asGeoInput(EMPTY_FC));
      return;
    }

    const coords = editingCoords;
    const liveCoords = coords.map(c => [c[0], c[1]] as [number, number]);
    const midpointMarkers: Marker[] = [];
    if (src) {
      src.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: liveCoords } }]
        })
      );
    }

    // Vertex drag handles
    coords.forEach((pt, idx) => {
      const el = document.createElement('div');
      const roleClass =
        idx === 0 ? 'vertex-handle--start' : idx === coords.length - 1 ? 'vertex-handle--end' : '';
      const roleLabel =
        idx === 0 ? ' [Hulu / Upstream]' : idx === coords.length - 1 ? ' [Hilir / Downstream]' : '';
      el.className = `vertex-handle ${roleClass}`.trim();
      el.title = `Vertex #${idx + 1}${roleLabel} (Drag to move, right-click/double-click to remove)`;
      el.addEventListener('click', ev => ev.stopPropagation());
      const removeVertex = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const cur = editingWaterwayRef.current?.coordinates;
        if (!cur || cur.length <= 2) return;
        const next = cur.filter((_, i) => i !== idx);
        onChangeEditingCoordsRef.current(next);
      };
      el.addEventListener('contextmenu', removeVertex);
      el.addEventListener('dblclick', removeVertex);

      const mk = new Marker({ element: el, anchor: 'center', draggable: true }).setLngLat(pt).addTo(map);
      mk.on('dragstart', () => {
        isDraggingVertexRef.current = true;
      });
      mk.on('drag', () => {
        const ll = mk.getLngLat();
        const rawPt: [number, number] = [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))];
        const snap = snapPointToWaterways(
          rawPt,
          verifiedWaterwaysRef.current,
          editingId,
          22
        );
        liveCoords[idx] = snap.point;
        if (idx > 0 && midpointMarkers[idx - 1]) {
          const prevPt = liveCoords[idx - 1];
          midpointMarkers[idx - 1].setLngLat([
            Number(((prevPt[0] + snap.point[0]) / 2).toFixed(6)),
            Number(((prevPt[1] + snap.point[1]) / 2).toFixed(6))
          ]);
        }
        if (idx < liveCoords.length - 1 && midpointMarkers[idx]) {
          const nextPt = liveCoords[idx + 1];
          midpointMarkers[idx].setLngLat([
            Number(((snap.point[0] + nextPt[0]) / 2).toFixed(6)),
            Number(((snap.point[1] + nextPt[1]) / 2).toFixed(6))
          ]);
        }
        if (src) {
          src.setData(
            asGeoInput({
              type: 'FeatureCollection',
              features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: liveCoords } }]
            })
          );
        }
        const snapSrc = map.getSource('src-snap-indicator') as GeoJSONSource | undefined;
        if (snapSrc) {
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
      });
      mk.on('dragend', () => {
        isDraggingVertexRef.current = false;
        const ll = mk.getLngLat();
        const rawPt: [number, number] = [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))];
        const snap = snapPointToWaterways(
          rawPt,
          verifiedWaterwaysRef.current,
          editingId,
          22
        );
        const snapSrc = map.getSource('src-snap-indicator') as GeoJSONSource | undefined;
        if (snapSrc) snapSrc.setData(asGeoInput(EMPTY_FC));
        if (snap.snapped) {
          mk.setLngLat(snap.point);
          if (snap.targetName) {
            onSnapFeedbackRef.current?.(
              langRef.current === 'en' ? `Snapped to ${snap.targetName}` : `Menempel ke ${snap.targetName}`
            );
          }
        }
        const cur = editingWaterwayRef.current?.coordinates;
        if (!cur) return;
        const next = cur.map((c, i) => (i === idx ? snap.point : c));
        onChangeEditingCoordsRef.current(next);
      });
      vertexMarkersRef.current.push(mk);
    });

    // Midpoint (+) insert handles
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const mid: [number, number] = [
        Number(((a[0] + b[0]) / 2).toFixed(6)),
        Number(((a[1] + b[1]) / 2).toFixed(6))
      ];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'midpoint-handle';
      el.textContent = '+';
      el.title = 'Insert vertex here';
      el.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const cur = editingWaterwayRef.current?.coordinates;
        if (!cur) return;
        const next = [...cur.slice(0, i + 1), mid, ...cur.slice(i + 1)];
        onChangeEditingCoordsRef.current(next);
      });
      const mk = new Marker({ element: el, anchor: 'center' }).setLngLat(mid).addTo(map);
      midpointMarkers.push(mk);
      vertexMarkersRef.current.push(mk);
    }

    return () => {
      isDraggingVertexRef.current = false;
      vertexMarkersRef.current.forEach(m => m.remove());
      vertexMarkersRef.current = [];
    };
  }, [mapReady, editingId, editingCoords, props.editorUnlocked]);

  const editingStructId = props.editingStructure?.id ?? null;
  const editingStructCoords = props.editingStructure?.coordinates ?? null;

  // Draggable marker when editing or placing a culvert / bridge point
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    if (structureEditMarkerRef.current) {
      structureEditMarkerRef.current.remove();
      structureEditMarkerRef.current = null;
    }

    if (!editingStructCoords || !props.editorUnlocked) return;

    const el = document.createElement('div');
    el.className = 'vertex-handle vertex-handle--start';
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.borderWidth = '3px';
    el.title = 'Drag to adjust culvert / bridge position';
    el.addEventListener('click', ev => ev.stopPropagation());

    const mk = new Marker({ element: el, anchor: 'center', draggable: true })
      .setLngLat(editingStructCoords)
      .addTo(map);
    mk.on('dragend', () => {
      const ll = mk.getLngLat();
      onMoveEditingStructureRef.current([Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))]);
    });
    structureEditMarkerRef.current = mk;

    return () => {
      if (structureEditMarkerRef.current) {
        structureEditMarkerRef.current.remove();
        structureEditMarkerRef.current = null;
      }
    };
  }, [mapReady, editingStructId, editingStructCoords, props.editorUnlocked]);

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
