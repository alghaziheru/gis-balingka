import { useEffect, useRef, type MutableRefObject } from 'react';
import { GeoJSONSource, Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { snapPointToWaterways } from '../../lib/geometry';
import type { ActiveTool, GeoFeature, Language, VerifiedWaterwayFeature } from '../../types/gis';
import { asGeoInput, EMPTY_FC } from './types';

export function useMapEditing(opts: {
  mapRef: MutableRefObject<MapLibreMap | null>;
  mapLoadedRef: MutableRefObject<boolean>;
  mapReady: boolean;
  activeTool: ActiveTool;
  drawVertices: [number, number][];
  editorUnlocked: boolean;
  editingWaterway: { id: string | null; coordinates: [number, number][]; sourceRef?: string | null } | null;
  editingStructure: { id: string | null; coordinates: [number, number]; sourceRef?: string | null } | null;
  langRef: MutableRefObject<Language>;
  verifiedWaterwaysRef: MutableRefObject<VerifiedWaterwayFeature[]>;
  editingWaterwayRef: MutableRefObject<{ id: string | null; coordinates: [number, number][]; sourceRef?: string | null } | null>;
  onChangeEditingCoordsRef: MutableRefObject<(coords: [number, number][]) => void>;
  onMoveEditingStructureRef: MutableRefObject<(coords: [number, number]) => void>;
  onSnapFeedbackRef: MutableRefObject<((msg: string) => void) | undefined>;
  isDraggingVertexRef: MutableRefObject<boolean>;
}): void {
  const vertexMarkersRef = useRef<Marker[]>([]);
  const structureEditMarkerRef = useRef<Marker | null>(null);

  useEffect(() => {
    const map = opts.mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = opts.activeTool ? 'crosshair' : '';
    if (opts.activeTool !== 'drawWaterway' && opts.activeTool !== 'redrawWaterway' && opts.mapLoadedRef.current) {
      const snapSrc = map.getSource('src-snap-indicator') as GeoJSONSource | undefined;
      if (snapSrc) snapSrc.setData(asGeoInput(EMPTY_FC));
    }
  }, [opts.activeTool]);

  useEffect(() => {
    const map = opts.mapRef.current;
    if (!map || !opts.mapLoadedRef.current) return;
    const src = map.getSource('src-draw-preview') as GeoJSONSource | undefined;
    if (src) {
      const feats: GeoFeature[] = opts.drawVertices.map(c => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: c }
      }));
      if (opts.drawVertices.length >= 2) {
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: opts.drawVertices }
        });
      }
      if (opts.activeTool === 'drawJorong' && opts.drawVertices.length >= 3) {
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[...opts.drawVertices, opts.drawVertices[0]]] }
        });
      }
      src.setData(asGeoInput({ type: 'FeatureCollection', features: feats }));
    }
  }, [opts.mapReady, opts.drawVertices, opts.activeTool]);

  const editingId = opts.editingWaterway?.id ?? null;
  const editingCoords = opts.editingWaterway?.coordinates ?? null;

  // Interactive draggable vertex & midpoint handles for waterway alignment correction
  useEffect(() => {
    const map = opts.mapRef.current;
    if (!map || !opts.mapLoadedRef.current) return;

    vertexMarkersRef.current.forEach(m => m.remove());
    vertexMarkersRef.current = [];
    opts.isDraggingVertexRef.current = false;

    const src = map.getSource('src-editing-waterway') as GeoJSONSource | undefined;
    if (!editingCoords || !opts.editorUnlocked || editingCoords.length < 2) {
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
        const cur = opts.editingWaterwayRef.current?.coordinates;
        if (!cur || cur.length <= 2) return;
        const next = cur.filter((_, i) => i !== idx);
        opts.onChangeEditingCoordsRef.current(next);
      };
      el.addEventListener('contextmenu', removeVertex);
      el.addEventListener('dblclick', removeVertex);

      const mk = new Marker({ element: el, anchor: 'center', draggable: true }).setLngLat(pt).addTo(map);
      mk.on('dragstart', () => {
        opts.isDraggingVertexRef.current = true;
      });
      mk.on('drag', () => {
        const ll = mk.getLngLat();
        const rawPt: [number, number] = [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))];
        const snap = snapPointToWaterways(rawPt, opts.verifiedWaterwaysRef.current, editingId, 22);
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
        opts.isDraggingVertexRef.current = false;
        const ll = mk.getLngLat();
        const rawPt: [number, number] = [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))];
        const snap = snapPointToWaterways(rawPt, opts.verifiedWaterwaysRef.current, editingId, 22);
        const snapSrc = map.getSource('src-snap-indicator') as GeoJSONSource | undefined;
        if (snapSrc) snapSrc.setData(asGeoInput(EMPTY_FC));
        if (snap.snapped) {
          mk.setLngLat(snap.point);
          if (snap.targetName) {
            opts.onSnapFeedbackRef.current?.(
              opts.langRef.current === 'en' ? `Snapped to ${snap.targetName}` : `Menempel ke ${snap.targetName}`
            );
          }
        }
        const cur = opts.editingWaterwayRef.current?.coordinates;
        if (!cur) return;
        const next = cur.map((c, i) => (i === idx ? snap.point : c));
        opts.onChangeEditingCoordsRef.current(next);
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
        const cur = opts.editingWaterwayRef.current?.coordinates;
        if (!cur) return;
        const next = [...cur.slice(0, i + 1), mid, ...cur.slice(i + 1)];
        opts.onChangeEditingCoordsRef.current(next);
      });
      const mk = new Marker({ element: el, anchor: 'center' }).setLngLat(mid).addTo(map);
      midpointMarkers.push(mk);
      vertexMarkersRef.current.push(mk);
    }

    return () => {
      opts.isDraggingVertexRef.current = false;
      vertexMarkersRef.current.forEach(m => m.remove());
      vertexMarkersRef.current = [];
    };
  }, [opts.mapReady, editingId, editingCoords, opts.editorUnlocked]);

  const editingStructId = opts.editingStructure?.id ?? null;
  const editingStructCoords = opts.editingStructure?.coordinates ?? null;

  // Draggable marker when editing or placing a culvert / bridge point
  useEffect(() => {
    const map = opts.mapRef.current;
    if (!map || !opts.mapLoadedRef.current) return;

    if (structureEditMarkerRef.current) {
      structureEditMarkerRef.current.remove();
      structureEditMarkerRef.current = null;
    }

    if (!editingStructCoords || !opts.editorUnlocked) return;

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
      opts.onMoveEditingStructureRef.current([Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))]);
    });
    structureEditMarkerRef.current = mk;

    return () => {
      if (structureEditMarkerRef.current) {
        structureEditMarkerRef.current.remove();
        structureEditMarkerRef.current = null;
      }
    };
  }, [opts.mapReady, editingStructId, editingStructCoords, opts.editorUnlocked]);
}
