import type { MutableRefObject } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
import type { RegionConfig } from '../../config/region';
import type { CascadeEngine } from '../../lib/cascadeEngine';
import type { DemClient } from '../../lib/demClient';
import type {
  ActiveTool,
  AgamContextData,
  BasemapId,
  BBox,
  CalibrationMarkFeature,
  CascadeSimParams,
  DrainageStatus,
  GeoFeatureCollection,
  JorongBoundaryFeature,
  Language,
  LayerToggles,
  ProfileSample,
  RaindropTrace,
  SimMapViewMode,
  StructureKind,
  TabId,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature,
  ViewMode,
  WaterwayKind
} from '../../types/gis';

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

export interface MapLoadState {
  styleReady: boolean;
  initialTilesReady: boolean;
  initialTimedOut: boolean;
  tileProgress: number;
  basemapSwitching: boolean;
  basemapTimedOut: boolean;
  activeBasemap: BasemapId;
}

export interface LoadedDatasets {
  bbox: BBox;
  center: [number, number];
  mask: GeoFeatureCollection;
  watershed: GeoFeatureCollection;
  nagariBoundary: GeoFeatureCollection;
  subBoundaries: GeoFeatureCollection;
  settlements: GeoFeatureCollection;
  contours: GeoFeatureCollection;
  flowPaths: GeoFeatureCollection;
  osmContext: GeoFeatureCollection;
  drainageDraft: GeoFeatureCollection;
  agamRbiRivers: GeoFeatureCollection;
  agamContext: AgamContextData | null;
}

export interface MapViewProps {
  region: RegionConfig;
  dataBasePath: string;
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
  simMapViewMode: SimMapViewMode;
  cascadeEngine: CascadeEngine | null;
  cascadeParams: CascadeSimParams;
  drainFilter: 'all' | DrainageStatus;
  raindrop: RaindropTrace | null;
  profilePts: [number, number][];
  profileHover: ProfileSample | null;
  verifiedWaterways: VerifiedWaterwayFeature[];
  verifiedStructures: VerifiedStructureFeature[];
  jorongBoundaries: JorongBoundaryFeature[];
  calibrationMarks: CalibrationMarkFeature[];
  suppressedDemIds: string[];
  dataVersion: number;
  editorHydrated: boolean;
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
  onSetStructureBlockageOverride?: (structureId: string, pct: number | null) => void;
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
  onLoadStateChange?: (state: MapLoadState) => void;
}

export type MapGeoInput = Parameters<GeoJSONSource['setData']>[0];
export const asGeoInput = (fc: GeoFeatureCollection): MapGeoInput => fc as unknown as MapGeoInput;

export const EMPTY_FC: GeoFeatureCollection = { type: 'FeatureCollection', features: [] };
export const TRANSPARENT_1PX_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export const HAND_LAYERS = [
  'hand-clogged-low',
  'hand-clogged-med',
  'hand-clogged-high',
  'hand-cleared-low',
  'hand-cleared-med',
  'hand-cleared-high'
] as const;

export function buildImageCoords(bbox: BBox): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [bbox.west, bbox.north],
    [bbox.east, bbox.north],
    [bbox.east, bbox.south],
    [bbox.west, bbox.south]
  ];
}

export function lerpHex(hexA: string, hexB: string, t: number): string {
  const f = Math.max(0, Math.min(1, t));
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const r = Math.round(((a >> 16) & 255) * (1 - f) + ((b >> 16) & 255) * f);
  const g = Math.round(((a >> 8) & 255) * (1 - f) + ((b >> 8) & 255) * f);
  const bl = Math.round((a & 255) * (1 - f) + (b & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function interpolateLine(coords: [number, number][], frac: number): [number, number] {
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

export function subsampleCoordsForEditing(coords: [number, number][], maxPts = 18): [number, number][] {
  if (coords.length <= maxPts) return coords.map(c => [c[0], c[1]]);
  const out: [number, number][] = [];
  for (let i = 0; i < maxPts; i++) {
    const idx = i === maxPts - 1 ? coords.length - 1 : Math.round((i / (maxPts - 1)) * (coords.length - 1));
    out.push([coords[idx][0], coords[idx][1]]);
  }
  return out;
}
