import { useEffect, useRef, useState } from 'react';
import {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type FilterSpecification,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type StyleSpecification
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { DemClient } from '../lib/demClient';
import type {
  ActiveTool,
  BasemapId,
  BBox,
  CommunityFeature,
  DrainageStatus,
  GeoFeature,
  GeoFeatureCollection,
  GeoProperties,
  Language,
  LayerToggles,
  ProfileSample,
  RaindropTrace,
  TabId,
  VerifiedWaterwayFeature
} from '../types/gis';

setWorkerUrl(maplibreWorkerUrl);

export interface FlyRequest {
  center: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  nonce: number;
}

export interface LoadedDatasets {
  bbox: BBox;
  center: [number, number];
  mask: GeoFeatureCollection;
  watershed: GeoFeatureCollection;
  contours: GeoFeatureCollection;
  flowPaths: GeoFeatureCollection;
  osmContext: GeoFeatureCollection;
  drainageDraft: GeoFeatureCollection;
}

interface MapViewProps {
  datasets: LoadedDatasets;
  demClient: DemClient;
  lang: Language;
  tab: TabId;
  is3D: boolean;
  basemap: BasemapId;
  exaggeration: number;
  layers: LayerToggles;
  flowDensity: number;
  activeTool: ActiveTool;
  simStage: number;
  simRain: number;
  simScenario: 'clogged' | 'cleared';
  drainFilter: 'all' | DrainageStatus;
  raindrop: RaindropTrace | null;
  profilePts: [number, number][];
  profileHover: ProfileSample | null;
  communityFeatures: CommunityFeature[];
  verifiedWaterways: VerifiedWaterwayFeature[];
  suppressedDemIds: string[];
  editorUnlocked: boolean;
  editingWaterway: { id: string | null; coordinates: [number, number][]; sourceRef?: string | null } | null;
  suggestionPin: [number, number] | null;
  draftGeom: CommunityFeature['geometry'] | null;
  drawVertices: [number, number][];
  flyRequest: FlyRequest | null;
  onMapClick: (lngLat: [number, number]) => void;
  onSelectWaterway: (feature: VerifiedWaterwayFeature) => void;
  onPromoteDemSegment: (segId: string, coords: [number, number][]) => void;
  onSuppressDemSegment: (segId: string) => void;
  onChangeEditingCoords: (coords: [number, number][]) => void;
  onCursorTelemetry: (t: { lng: number; lat: number; elev: number; slope: number }) => void;
}

type MapGeoInput = Parameters<GeoJSONSource['setData']>[0];
const asGeoInput = (fc: GeoFeatureCollection): MapGeoInput => fc as unknown as MapGeoInput;

const EMPTY_FC: GeoFeatureCollection = { type: 'FeatureCollection', features: [] };

const HAND_LAYERS = [
  'hand-clogged-low',
  'hand-clogged-med',
  'hand-clogged-high',
  'hand-cleared-low',
  'hand-cleared-med',
  'hand-cleared-high'
] as const;

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
  const draftMarkerRef = useRef<Marker | null>(null);
  const suggestionMarkerRef = useRef<Marker | null>(null);
  const vertexMarkersRef = useRef<Marker[]>([]);

  const activeToolRef = useRef(props.activeTool);
  activeToolRef.current = props.activeTool;
  const langRef = useRef(props.lang);
  langRef.current = props.lang;
  const demRef = useRef(props.demClient);
  demRef.current = props.demClient;
  const onMapClickRef = useRef(props.onMapClick);
  onMapClickRef.current = props.onMapClick;
  const onCursorRef = useRef(props.onCursorTelemetry);
  onCursorRef.current = props.onCursorTelemetry;
  const tabRef = useRef(props.tab);
  tabRef.current = props.tab;
  const flowDensityRef = useRef(props.flowDensity);
  flowDensityRef.current = props.flowDensity;
  const simRainRef = useRef(props.simRain);
  simRainRef.current = props.simRain;
  const editorUnlockedRef = useRef(props.editorUnlocked);
  editorUnlockedRef.current = props.editorUnlocked;
  const verifiedWaterwaysRef = useRef(props.verifiedWaterways);
  verifiedWaterwaysRef.current = props.verifiedWaterways;
  const suppressedDemSetRef = useRef(new Set(props.suppressedDemIds));
  suppressedDemSetRef.current = new Set(props.suppressedDemIds);
  const editingWaterwayRef = useRef(props.editingWaterway);
  editingWaterwayRef.current = props.editingWaterway;
  const onSelectWaterwayRef = useRef(props.onSelectWaterway);
  onSelectWaterwayRef.current = props.onSelectWaterway;
  const onPromoteDemRef = useRef(props.onPromoteDemSegment);
  onPromoteDemRef.current = props.onPromoteDemSegment;
  const onSuppressDemRef = useRef(props.onSuppressDemSegment);
  onSuppressDemRef.current = props.onSuppressDemSegment;
  const onChangeEditingCoordsRef = useRef(props.onChangeEditingCoords);
  onChangeEditingCoordsRef.current = props.onChangeEditingCoords;

  const openPopup = (lngLat: [number, number], p: GeoProperties | undefined, isCommunity = false) => {
    const map = mapRef.current;
    if (!map || !p) return;
    if (popupRef.current) popupRef.current.remove();

    const isEn = langRef.current === 'en';
    const name = isEn ? p.name_en || p.name : p.name_id || p.name;
    const desc = isEn ? p.desc_en || p.notes || '' : p.desc_id || p.notes || '';
    const status = String(p.status || 'normal');

    const badgeColors: Record<string, string> = {
      normal: 'background:rgba(5,150,105,0.12);color:#065f46',
      clogged: 'background:rgba(217,119,6,0.14);color:#92400e',
      damaged: 'background:rgba(234,88,12,0.14);color:#9a3412',
      critical: 'background:rgba(220,38,38,0.14);color:#991b1b'
    };
    const statusNames: Record<string, { id: string; en: string }> = {
      normal: { id: 'Normal', en: 'Normal' },
      clogged: { id: 'Tersumbat', en: 'Clogged' },
      damaged: { id: 'Rusak', en: 'Damaged' },
      critical: { id: 'Kritis', en: 'Critical' }
    };
    const st = statusNames[status] || statusNames.normal;
    const tagText = isCommunity
      ? isEn
        ? 'Community Field Entry (Local)'
        : 'Data Lapangan Warga (Lokal)'
      : isEn
      ? 'Auto-Seeded Draft — Needs Verification'
      : 'Draft Otomatis — Perlu Verifikasi Warga';
    const elev = Math.round(demRef.current.getElevation(lngLat[0], lngLat[1]));

    const html = `
      <div>
        <span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:10.5px;font-weight:800;margin-bottom:5px;${badgeColors[status] || badgeColors.normal}">
          ${escapeHtml(isEn ? st.en : st.id)}
        </span>
        <h4 style="margin:0 0 4px;font-size:13.5px;font-weight:800;color:#12231c;">${escapeHtml(name)}</h4>
        <div style="display:inline-block;margin-bottom:6px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(217,119,6,0.14);color:#92400e;">
          ${escapeHtml(tagText)}
        </div>
        ${desc ? `<p style="margin:0 0 6px;font-size:12px;color:#3f524a;">${escapeHtml(desc)}</p>` : ''}
        <div style="font-family:monospace;font-size:10.5px;color:#64776f;">
          ${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)} · ~${elev} mdpl
        </div>
      </div>
    `;

    popupRef.current = new Popup({ offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
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

    const pad = 0.008;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: initialStyle,
      center,
      zoom: 14.3,
      minZoom: 12.6,
      maxZoom: 19,
      maxBounds: [
        [bbox.west - pad, bbox.south - pad],
        [bbox.east + pad, bbox.north + pad]
      ],
      pitch: 36,
      bearing: -12,
      maxPitch: 66
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left');
    map.addControl(new ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    let animTimerId = 0;
    let particlePhase = 0;
    let lastTs = 0;

    map.on('load', () => {
      const ds = props.datasets;

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

      map.addSource('src-osm-context', { type: 'geojson', data: asGeoInput(ds.osmContext) });
      map.addLayer({
        id: 'osm-roads',
        type: 'line',
        source: 'src-osm-context',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#475569', 'line-width': 1.5, 'line-opacity': 0.78 }
      });
      map.addLayer({
        id: 'osm-waterways',
        type: 'line',
        source: 'src-osm-context',
        filter: ['==', ['get', 'kind'], 'waterway'],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0ea5e9', 'line-width': 2.5, 'line-opacity': 0.88 }
      });

      map.addSource('src-contours', { type: 'geojson', data: asGeoInput(ds.contours) });
      map.addLayer({
        id: 'contours-line',
        type: 'line',
        source: 'src-contours',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'major'], true], '#78350f', '#b45309'],
          'line-width': ['case', ['==', ['get', 'major'], true], 1.6, 0.85],
          'line-opacity': ['case', ['==', ['get', 'major'], true], 0.82, 0.45]
        }
      });

      map.addSource('src-flows', { type: 'geojson', data: asGeoInput(ds.flowPaths) });
      map.addLayer({
        id: 'flows-glow',
        type: 'line',
        source: 'src-flows',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': ['match', ['get', 'tier'], 1, 5.0, 2, 3.4, 2.0],
          'line-opacity': 0.18
        }
      });
      map.addLayer({
        id: 'flows-line',
        type: 'line',
        source: 'src-flows',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': ['match', ['get', 'tier'], 1, 2.2, 2, 1.5, 1.0],
          'line-dasharray': [2.5, 2],
          'line-opacity': 0.78
        }
      });

      map.addSource('src-verified-waterways', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'verified-waterways-casing',
        type: 'line',
        source: 'src-verified-waterways',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['match', ['get', 'kind'], 'river', 6.2, 'stream', 5.2, 4.4],
          'line-opacity': 0.85
        }
      });
      map.addLayer({
        id: 'verified-waterways-line',
        type: 'line',
        source: 'src-verified-waterways',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'status'],
            'normal',
            '#0369a1',
            'clogged',
            '#d97706',
            'damaged',
            '#ea580c',
            'critical',
            '#dc2626',
            '#0369a1'
          ],
          'line-width': ['match', ['get', 'kind'], 'river', 3.6, 'stream', 2.8, 2.3],
          'line-opacity': 0.96
        }
      });

      map.addSource('src-flow-particles', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
      map.addLayer({
        id: 'flow-particles',
        type: 'circle',
        source: 'src-flow-particles',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': '#e0f2fe',
          'circle-stroke-color': '#0284c7',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.95
        }
      });

      // Studio Mask hiding everything outside the Nagari Balingka block + crisp architectural border
      map.addSource('src-mask', { type: 'geojson', data: asGeoInput(ds.mask) });
      map.addLayer({
        id: 'studio-mask-fill',
        type: 'fill',
        source: 'src-mask',
        paint: { 'fill-color': '#e5ebe8', 'fill-opacity': 1 }
      });

      map.addSource('src-das', { type: 'geojson', data: asGeoInput(ds.watershed) });
      map.addLayer({
        id: 'das-line',
        type: 'line',
        source: 'src-das',
        paint: { 'line-color': '#1b382d', 'line-width': 2.5, 'line-opacity': 0.9 }
      });

      map.addSource('src-draft-pts', { type: 'geojson', data: asGeoInput(ds.drainageDraft) });
      map.addLayer({
        id: 'draft-points',
        type: 'circle',
        source: 'src-draft-pts',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'evacuation', 7.5, 'bronjong', 7, 6],
          'circle-color': [
            'case',
            ['==', ['get', 'kind'], 'evacuation'],
            '#059669',
            ['==', ['get', 'kind'], 'bronjong'],
            '#0284c7',
            ['==', ['get', 'kind'], 'landslide'],
            '#ea580c',
            [
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
              '#d97706'
            ]
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
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
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'jorong-pill';
        el.textContent = String(f.properties?.name || '');
        el.addEventListener('click', ev => {
          ev.stopPropagation();
          if (activeToolRef.current) return;
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
        'draft-points',
        'community-points',
        'community-lines',
        'osm-waterways',
        'verified-waterways-line',
        'flows-line'
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

          if (lid === 'verified-waterways-line') {
            if (popupRef.current) popupRef.current.remove();
            const wwId = String(propsObj.id || '');
            const fullFeat = verifiedWaterwaysRef.current.find(w => w.properties.id === wwId);
            const canEdit = editorUnlockedRef.current && Boolean(fullFeat);
            const html = `
              <div>
                <span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:800;margin-bottom:5px;background:rgba(2,132,199,0.12);color:#0369a1;">
                  ${escapeHtml(isEn ? 'Verified Waterway' : 'Sungai / Drainase Terverifikasi')}
                </span>
                <h4 style="margin:0 0 4px;font-size:13.5px;font-weight:800;color:#12231c;">${escapeHtml(propsObj.name)}</h4>
                <div style="font-size:11.5px;color:#3f524a;margin-bottom:6px;">
                  ${escapeHtml(propsObj.kind)} · ${escapeHtml(propsObj.status)} · ${escapeHtml(propsObj.length_m)}m
                </div>
                ${propsObj.notes ? `<p style="margin:0 0 6px;font-size:11.5px;color:#3f524a;">${escapeHtml(propsObj.notes)}</p>` : ''}
                <div style="font-family:monospace;font-size:10px;color:#64776f;">
                  ${escapeHtml(propsObj.updated_by || '')}
                </div>
                ${
                  canEdit
                    ? `<button id="popup-edit-ww" type="button" style="margin-top:8px;width:100%;padding:6px 10px;border-radius:7px;border:1px solid #0369a1;background:#0284c7;color:#fff;font-size:11.5px;font-weight:700;cursor:pointer;">
                        ${isEn ? 'Correct Alignment' : 'Koreksi Jalur Ini'}
                      </button>`
                    : ''
                }
              </div>
            `;
            const pop = new Popup({ offset: 12 }).setLngLat([e.lngLat.lng, e.lngLat.lat]).setHTML(html).addTo(map);
            popupRef.current = pop;
            if (canEdit && fullFeat) {
              pop.getElement()?.querySelector('#popup-edit-ww')?.addEventListener('click', () => {
                pop.remove();
                onSelectWaterwayRef.current(fullFeat);
              });
            }
            return;
          }

          if (lid === 'flows-line') {
            if (popupRef.current) popupRef.current.remove();
            const segId = String(propsObj.id || '');
            const rawFlow = ds.flowPaths.features.find(f => String(f.properties?.id) === segId);
            const coords =
              rawFlow?.geometry.type === 'LineString'
                ? subsampleCoordsForEditing(rawFlow.geometry.coordinates, 18)
                : [];
            const canEdit = editorUnlockedRef.current && coords.length >= 2;
            const html = `
              <div>
                <span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:800;margin-bottom:5px;background:rgba(217,119,6,0.14);color:#92400e;">
                  ${escapeHtml(isEn ? '30m DEM Runoff Estimate' : 'Estimasi Alur Limpasan (DEM 30m)')}
                </span>
                <h4 style="margin:0 0 4px;font-size:13px;font-weight:800;color:#12231c;">${escapeHtml(segId)}</h4>
                <p style="margin:0 0 6px;font-size:11.5px;color:#3f524a;">
                  ${
                    isEn
                      ? 'Computed automatically from 30m satellite elevation; may differ from actual village drains by 15–45m.'
                      : 'Dihitung otomatis dari elevasi satelit 30m; dapat meleset 15–45m dari sungai/bandar asli.'
                  }
                </p>
                <div style="font-family:monospace;font-size:10.5px;color:#64776f;">
                  DAS ~${escapeHtml(propsObj.catchment_ha)} ha · ${escapeHtml(propsObj.length_m)} m · ${escapeHtml(propsObj.slope_pct)}%
                </div>
                ${
                  canEdit
                    ? `<div style="display:flex;flex-direction:column;gap:5px;margin-top:8px;">
                        <button id="popup-promote-dem" type="button" style="padding:6px 8px;border-radius:7px;border:1px solid #0369a1;background:#0284c7;color:#fff;font-size:11px;font-weight:700;cursor:pointer;">
                          ${isEn ? 'Promote & Adjust Vertices' : 'Promosikan & Koreksi Jalur'}
                        </button>
                        <button id="popup-suppress-dem" type="button" style="padding:5px 8px;border-radius:7px;border:1px solid rgba(18,35,28,0.2);background:#fff;color:#991b1b;font-size:11px;font-weight:700;cursor:pointer;">
                          ${isEn ? 'Mark False & Hide Segment' : 'Tandai Keliru & Sembunyikan'}
                        </button>
                      </div>`
                    : ''
                }
              </div>
            `;
            const pop = new Popup({ offset: 12 }).setLngLat([e.lngLat.lng, e.lngLat.lat]).setHTML(html).addTo(map);
            popupRef.current = pop;
            if (canEdit) {
              pop.getElement()?.querySelector('#popup-promote-dem')?.addEventListener('click', () => {
                pop.remove();
                onPromoteDemRef.current(segId, coords);
              });
              pop.getElement()?.querySelector('#popup-suppress-dem')?.addEventListener('click', () => {
                pop.remove();
                onSuppressDemRef.current(segId);
              });
            }
            return;
          }

          const isComm = lid.startsWith('community');
          openPopup([e.lngLat.lng, e.lngLat.lat], propsObj, isComm);
        });
      }

      const animPaths = ds.flowPaths.features
        .filter((f: GeoFeature) => f.geometry.type === 'LineString' && Number(f.properties?.tier) <= 2)
        .sort((a: GeoFeature, b: GeoFeature) => Number(b.properties?.length_m || 0) - Number(a.properties?.length_m || 0))
        .slice(0, 38);

      const stepAnim = (ts: number) => {
        if (ts - lastTs > 50) {
          const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0.05);
          lastTs = ts;
          const speed = tabRef.current === 'sim' ? 0.14 + (simRainRef.current / 130) * 0.28 : 0.16;
          particlePhase = (particlePhase + dt * speed) % 1;

          const src = map.getSource('src-flow-particles') as GeoJSONSource | undefined;
          if (src) {
            const maxTier = tabRef.current === 'sim' ? 2 : flowDensityRef.current;
            if (maxTier === 0) {
              src.setData(asGeoInput(EMPTY_FC));
            } else {
              const features: GeoFeature[] = [];
              for (let i = 0; i < animPaths.length; i++) {
                const f = animPaths[i];
                if (f.geometry.type !== 'LineString') continue;
                if (suppressedDemSetRef.current.has(String(f.properties?.id || ''))) continue;
                const tier = Number(f.properties?.tier || 2);
                if (tier > maxTier) continue;
                const coords = f.geometry.coordinates;
                const count = tier === 1 ? 2 : 1;
                for (let k = 0; k < count; k++) {
                  const frac = (particlePhase + k / count + i * 0.17) % 1;
                  features.push({
                    type: 'Feature',
                    properties: { radius: tier === 1 ? 3.8 : 2.8 },
                    geometry: { type: 'Point', coordinates: interpolateLine(coords, frac) }
                  });
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
    });

    map.on('click', (e: MapMouseEvent) => {
      if (!activeToolRef.current) return;
      onMapClickRef.current([e.lngLat.lng, e.lngLat.lat]);
    });

    let lastTel = 0;
    map.on('mousemove', (e: MapMouseEvent) => {
      const now = performance.now();
      if (now - lastTel < 65) return;
      lastTel = now;
      const { lng, lat } = e.lngLat;
      onCursorRef.current({
        lng,
        lat,
        elev: demRef.current.getElevation(lng, lat),
        slope: demRef.current.getSlopePercent(lng, lat)
      });
    });

    return () => {
      cancelAnimationFrame(animTimerId);
      if (raindropAnimRef.current) cancelAnimationFrame(raindropAnimRef.current);
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

    map.setLayoutProperty('das-line', 'visibility', vis(props.layers.das));
    map.setLayoutProperty('contours-line', 'visibility', vis(props.layers.contours));
    contourMarkersRef.current.forEach(c => {
      c.el.style.display = props.layers.contours ? 'block' : 'none';
    });
    map.setLayoutProperty('slope-overlay', 'visibility', vis(props.layers.slope && props.basemap !== 'slope'));
    map.setLayoutProperty('osm-roads', 'visibility', vis(props.layers.osmContext));
    map.setLayoutProperty('osm-waterways', 'visibility', vis(props.layers.osmContext));
    map.setLayoutProperty('verified-waterways-casing', 'visibility', vis(props.layers.verifiedWaterways));
    map.setLayoutProperty('verified-waterways-line', 'visibility', vis(props.layers.verifiedWaterways));

    const wwSrc = map.getSource('src-verified-waterways') as GeoJSONSource | undefined;
    if (wwSrc) {
      wwSrc.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: props.verifiedWaterways as unknown as GeoFeature[]
        })
      );
    }

    const maxTier = props.tab === 'sim' ? 2 : props.flowDensity;
    const flowVis = maxTier > 0;
    map.setLayoutProperty('flows-glow', 'visibility', vis(flowVis));
    map.setLayoutProperty('flows-line', 'visibility', vis(flowVis));
    map.setLayoutProperty('flow-particles', 'visibility', vis(flowVis));
    if (flowVis) {
      const tierExpr: ExpressionSpecification = ['<=', ['get', 'tier'], maxTier];
      const flowFilter: FilterSpecification =
        props.suppressedDemIds.length > 0
          ? ['all', tierExpr, ['!', ['in', ['get', 'id'], ['literal', props.suppressedDemIds]]]]
          : tierExpr;
      map.setFilter('flows-glow', flowFilter);
      map.setFilter('flows-line', flowFilter);
    }

    // Smooth HAND Raster Overlays for Simulation Tab
    const showFlood = props.tab === 'sim';
    let activeHandId: string | null = null;
    let handOpacity = 0.85;
    if (showFlood) {
      const stageBoost = [0.45, 0.78, 1.0, 0.95][props.simStage] ?? 1.0;
      const effectiveRain = props.simRain * stageBoost;
      const level = effectiveRain < 55 ? 'low' : effectiveRain < 95 ? 'med' : 'high';
      activeHandId = `hand-${props.simScenario}-${level}`;
      handOpacity = props.simScenario === 'cleared' ? 0.72 : Math.min(0.92, 0.65 + (effectiveRain / 130) * 0.27);
    }
    for (const hid of HAND_LAYERS) {
      const isOn = hid === activeHandId;
      map.setLayoutProperty(hid, 'visibility', vis(isOn));
      if (isOn) map.setPaintProperty(hid, 'raster-opacity', handOpacity);
    }

    // Draft Drainage & Mitigation Points
    const showDraftPts = props.tab === 'drainage' || props.tab === 'sim';
    map.setLayoutProperty('draft-points', 'visibility', vis(showDraftPts));
    if (showDraftPts) {
      const anyClauses: ExpressionSpecification[] = [];
      if (props.tab === 'sim') {
        anyClauses.push(['==', ['get', 'kind'], 'drainage']);
        if (props.layers.bronjong) anyClauses.push(['==', ['get', 'kind'], 'bronjong']);
        if (props.layers.evac) anyClauses.push(['==', ['get', 'kind'], 'evacuation']);
      } else {
        if (props.drainFilter === 'all') {
          anyClauses.push(['==', ['get', 'kind'], 'drainage']);
        } else {
          anyClauses.push(['all', ['==', ['get', 'kind'], 'drainage'], ['==', ['get', 'status'], props.drainFilter]]);
        }
        if (props.layers.bronjong) anyClauses.push(['==', ['get', 'kind'], 'bronjong']);
        if (props.layers.landslide) anyClauses.push(['==', ['get', 'kind'], 'landslide']);
        if (props.layers.evac) anyClauses.push(['==', ['get', 'kind'], 'evacuation']);
      }
      map.setFilter('draft-points', ['any', ...anyClauses] as FilterSpecification);
    }
  }, [
    mapReady,
    props.basemap,
    props.is3D,
    props.exaggeration,
    props.layers,
    props.flowDensity,
    props.tab,
    props.simStage,
    props.simRain,
    props.simScenario,
    props.drainFilter,
    props.verifiedWaterways,
    props.suppressedDemIds
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    map.easeTo({
      pitch: props.is3D ? 36 : 0,
      bearing: props.is3D ? -12 : 0,
      duration: 600
    });
  }, [mapReady, props.is3D]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = props.activeTool ? 'crosshair' : '';
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
    const src = map.getSource('src-community') as GeoJSONSource | undefined;
    if (src) {
      src.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: props.communityFeatures as unknown as GeoFeature[]
        })
      );
    }
  }, [mapReady, props.communityFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    if (draftMarkerRef.current) {
      draftMarkerRef.current.remove();
      draftMarkerRef.current = null;
    }
    if (props.draftGeom?.type === 'Point') {
      const el = document.createElement('div');
      el.className = 'marker-dot';
      el.style.background = '#059669';
      draftMarkerRef.current = new Marker({ element: el, anchor: 'center' })
        .setLngLat(props.draftGeom.coordinates)
        .addTo(map);
    }

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
      src.setData(asGeoInput({ type: 'FeatureCollection', features: feats }));
    }
  }, [mapReady, props.draftGeom, props.drawVertices]);

  // Suggestion location pin marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    if (suggestionMarkerRef.current) {
      suggestionMarkerRef.current.remove();
      suggestionMarkerRef.current = null;
    }
    if (props.suggestionPin) {
      const el = document.createElement('div');
      el.className = 'marker-dot';
      el.style.background = '#d97706';
      suggestionMarkerRef.current = new Marker({ element: el, anchor: 'center' })
        .setLngLat(props.suggestionPin)
        .addTo(map);
    }
  }, [mapReady, props.suggestionPin]);

  // Interactive draggable vertex & midpoint handles for waterway alignment correction
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    vertexMarkersRef.current.forEach(m => m.remove());
    vertexMarkersRef.current = [];

    const src = map.getSource('src-editing-waterway') as GeoJSONSource | undefined;
    const editing = props.editingWaterway;
    if (!editing || !props.editorUnlocked || editing.coordinates.length < 2) {
      if (src) src.setData(asGeoInput(EMPTY_FC));
      return;
    }

    const coords = editing.coordinates;
    if (src) {
      src.setData(
        asGeoInput({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }]
        })
      );
    }

    // Vertex drag handles
    coords.forEach((pt, idx) => {
      const el = document.createElement('div');
      el.className = 'vertex-handle';
      el.title = `Vertex #${idx + 1} (Drag to move, right-click/double-click to remove)`;
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
      mk.on('dragend', () => {
        const ll = mk.getLngLat();
        const cur = editingWaterwayRef.current?.coordinates;
        if (!cur) return;
        const next = cur.map((c, i) =>
          i === idx ? ([Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))] as [number, number]) : c
        );
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
      vertexMarkersRef.current.push(mk);
    }

    return () => {
      vertexMarkersRef.current.forEach(m => m.remove());
      vertexMarkersRef.current = [];
    };
  }, [mapReady, props.editingWaterway, props.editorUnlocked]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-label="Balingka GIS Map" />;
}
