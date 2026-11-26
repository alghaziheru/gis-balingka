import type { MutableRefObject } from 'react';
import { Marker, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import { getOverlayContrastPalette } from '../../lib/mapPalette';
import type { ActiveTool, BasemapId, BBox, GeoFeature, TabId } from '../../types/gis';
import {
  asGeoInput,
  buildImageCoords,
  EMPTY_FC,
  HAND_LAYERS,
  TRANSPARENT_1PX_PNG,
  type LoadedDatasets
} from './types';

export function registerCartographicIcons(map: MapLibreMap): void {
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

export function createInitialMapStyle(bbox: BBox): StyleSpecification {
  const hasCustomImagery = Boolean(import.meta.env.VITE_CUSTOM_IMAGERY_URL);
  const satTileUrl =
    import.meta.env.VITE_CUSTOM_IMAGERY_URL ||
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const satMaxZoom = hasCustomImagery ? Number(import.meta.env.VITE_CUSTOM_IMAGERY_MAXZOOM || 20) : 18;
  const imgCoords = buildImageCoords(bbox);

  return {
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
      'img-cascade-agreement': { type: 'image', url: TRANSPARENT_1PX_PNG, coordinates: imgCoords },
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
}

export function addDataSourcesAndLayers(map: MapLibreMap, ds: LoadedDatasets, basemap: BasemapId): void {
  const p = getOverlayContrastPalette(basemap);
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

  // Dynamic physical cascade overlays (vector-sharp blue pools + steep-slope landslide risk + ensemble agreement)
  map.addLayer({
    id: 'cascade-landslide-overlay',
    type: 'raster',
    source: 'img-cascade-landslide',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0 }
  });

  map.addLayer({
    id: 'cascade-agreement-overlay',
    type: 'raster',
    source: 'img-cascade-agreement',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 }
  });

  // 3-tier calm cartographic depth contour bands (~13.8 m DEMNAS riverbank precision):
  // Tier 1 (0.12-0.30m shallow terrain flow): subtle translucent tint + dashed outline
  // Tier 2 (0.30-1.00m moderate basin depth): sky-blue + crisp hairline contour
  // Tier 3 (>1.00m deep channel / bankfull overflow): clear ocean blue (crisp on Relief/Elevasi)
  map.addSource('src-sim-pools-yard', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
  map.addLayer({
    id: 'sim-pools-yard-fill',
    type: 'fill',
    source: 'src-sim-pools-yard',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#7dd3fc', 'fill-opacity': 0.22, 'fill-antialias': true }
  });
  map.addLayer({
    id: 'sim-pools-yard-outline',
    type: 'line',
    source: 'src-sim-pools-yard',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0284c7', 'line-width': 1.0, 'line-dasharray': [3, 2], 'line-opacity': 0.50 }
  });

  map.addSource('src-sim-pools-knee', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
  map.addLayer({
    id: 'sim-pools-knee-fill',
    type: 'fill',
    source: 'src-sim-pools-knee',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.34, 'fill-antialias': true }
  });
  map.addLayer({
    id: 'sim-pools-knee-outline',
    type: 'line',
    source: 'src-sim-pools-knee',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0369a1', 'line-width': 1.05, 'line-opacity': 0.58 }
  });

  map.addSource('src-sim-pools-deep', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
  map.addLayer({
    id: 'sim-pools-deep-fill',
    type: 'fill',
    source: 'src-sim-pools-deep',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#0369a1', 'fill-opacity': 0.50, 'fill-antialias': true }
  });

  map.addSource('src-sim-scour-reaches', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
  map.addLayer({
    id: 'sim-scour-reaches-line',
    type: 'line',
    source: 'src-sim-scour-reaches',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'severity'], 'severe', '#b91c1c', '#d97706'],
      'line-width': ['match', ['get', 'severity'], 'severe', 5.2, 3.6],
      'line-opacity': 0.92
    }
  });

  map.addSource('src-sim-survey-reaches', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
  map.addLayer({
    id: 'sim-survey-reaches-line',
    type: 'line',
    source: 'src-sim-survey-reaches',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': [
        'match',
        ['get', 'dataConfidence'],
        'high',
        '#047857',
        'medium',
        '#0369a1',
        '#b45309'
      ],
      'line-width': ['interpolate', ['linear'], ['coalesce', ['get', 'priorityScore'], 40], 15, 2.4, 85, 5.0],
      'line-opacity': 0.9
    }
  });

  map.addSource('src-storm-core', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
  map.addLayer({
    id: 'storm-core-fill',
    type: 'fill',
    source: 'src-storm-core',
    filter: ['==', ['get', 'kind'], 'ring'],
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#0369a1', 'fill-opacity': 0.08 }
  });
  map.addLayer({
    id: 'storm-core-ring',
    type: 'line',
    source: 'src-storm-core',
    filter: ['==', ['get', 'kind'], 'ring'],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0369a1', 'line-width': 2.2, 'line-dasharray': [3, 2], 'line-opacity': 0.85 }
  });
  map.addLayer({
    id: 'storm-core-dot',
    type: 'circle',
    source: 'src-storm-core',
    filter: ['==', ['get', 'kind'], 'center'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 6,
      'circle-color': '#0369a1',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2
    }
  });

  map.addSource('src-calibration-marks', { type: 'geojson', data: asGeoInput(EMPTY_FC) });
  map.addLayer({
    id: 'calibration-marks-circle',
    type: 'circle',
    source: 'src-calibration-marks',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 6.5,
      'circle-color': [
        'match',
        ['get', 'kind'],
        'hwm',
        '#0369a1',
        'scour',
        '#d97706',
        '#b91c1c'
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.2
    }
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
}

export function addStaticPlaceAndContourMarkers(
  map: MapLibreMap,
  ds: LoadedDatasets,
  opts: {
    activeToolRef: MutableRefObject<ActiveTool>;
    onSelectJorongPillRef: MutableRefObject<((preset: string) => void) | undefined>;
  }
): { marker: Marker; el: HTMLElement }[] {
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
      if (opts.activeToolRef.current) return;
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
        opts.onSelectJorongPillRef.current?.(matchedPreset);
      }
      map.flyTo({ center: coords, zoom: 15.6, duration: 750 });
    });
    new Marker({ element: el, anchor: 'center' }).setLngLat(coords).addTo(map);
  }

  // Decluttered 100m contour chips
  const contourMarkers: { marker: Marker; el: HTMLElement }[] = [];
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
    contourMarkers.push({ marker, el });
  }
  return contourMarkers;
}

export function applyBasemapContrastPalette(
  map: MapLibreMap,
  basemap: BasemapId,
  tab: TabId,
  simProgress: number
): void {
  const pal = getOverlayContrastPalette(basemap);

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
    tab === 'sim' && simProgress > 0.02
      ? { casing: 0.45, line: 0.65 }
      : tab === 'sim'
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
}
