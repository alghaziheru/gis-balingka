import { useCallback, useEffect, useState } from 'react';
import type { LoadedDatasets } from '../components/MapView';
import { getRegionDataBasePath, REGION, type RegionConfig } from '../config/region';
import { DemClient } from '../lib/demClient';
import type { DatasetMetadata, DemGridData, SimFieldsData } from '../types/gis';

export interface CursorTelemetry {
  lng: number;
  lat: number;
  elev: number;
  slope: number;
}

export function useRegionDatasets(region: RegionConfig = REGION) {
  const [datasets, setDatasets] = useState<LoadedDatasets | null>(null);
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);
  const [demClient, setDemClient] = useState<DemClient | null>(null);
  const [simFields, setSimFields] = useState<SimFieldsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialTelemetry, setInitialTelemetry] = useState<CursorTelemetry | null>(null);

  const dataBasePath = getRegionDataBasePath(region);

  useEffect(() => {
    let cancelled = false;
    setDatasets(null);
    setMetadata(null);
    setDemClient(null);
    setSimFields(null);
    setLoadError(null);

    async function loadAll() {
      try {
        const [
          metaRes,
          demRes,
          maskRes,
          wsRes,
          nbRes,
          sbRes,
          stRes,
          cntRes,
          flRes,
          osmRes,
          drnRes,
          sfRes,
          rbiRes,
          agamCtxRes
        ] = await Promise.all([
          fetch(`${dataBasePath}/metadata.json`),
          fetch(`${dataBasePath}/dem-grid.json`),
          fetch(`${dataBasePath}/mask.geojson`),
          fetch(`${dataBasePath}/watershed.geojson`),
          fetch(`${dataBasePath}/nagari-boundary.geojson`),
          fetch(`${dataBasePath}/sub-boundaries.geojson`),
          fetch(`${dataBasePath}/settlements.geojson`),
          fetch(`${dataBasePath}/contours.geojson`),
          fetch(`${dataBasePath}/flow-paths.geojson`),
          fetch(`${dataBasePath}/osm-context.geojson`),
          fetch(`${dataBasePath}/drainage-draft.geojson`),
          fetch(`${dataBasePath}/sim-fields.json`),
          fetch(`${dataBasePath}/agam-rbi-rivers.geojson`),
          fetch(`${dataBasePath}/agam-context.json`)
        ]);

        if (!metaRes.ok || !demRes.ok) {
          throw new Error(`Failed to load geospatial datasets from ${dataBasePath}/`);
        }

        const emptyFc = { type: 'FeatureCollection' as const, features: [] };
        const [
          meta,
          demGrid,
          mask,
          watershed,
          nagariBoundary,
          subBoundaries,
          settlements,
          contours,
          flowPaths,
          osmContext,
          drainageDraft,
          sfData,
          agamRbiRivers,
          agamContext
        ] = await Promise.all([
          metaRes.json(),
          demRes.json(),
          maskRes.json(),
          wsRes.json(),
          nbRes.ok ? nbRes.json() : Promise.resolve(emptyFc),
          sbRes.ok ? sbRes.json() : Promise.resolve(emptyFc),
          stRes.ok ? stRes.json() : Promise.resolve(emptyFc),
          cntRes.json(),
          flRes.json(),
          osmRes.json(),
          drnRes.json(),
          sfRes.ok ? sfRes.json() : Promise.resolve(null),
          rbiRes.ok ? rbiRes.json() : Promise.resolve(emptyFc),
          agamCtxRes.ok ? agamCtxRes.json() : Promise.resolve(null)
        ]);

        if (cancelled) return;
        const m = meta as DatasetMetadata;
        const client = new DemClient(demGrid as DemGridData);
        const matchName = region.shortName.trim().toLowerCase();
        const regionPlace = (
          osmContext as {
            features?: Array<{
              geometry?: { type?: string; coordinates?: [number, number] };
              properties?: { kind?: string; name?: string };
            }>;
          }
        ).features?.find(
          f =>
            f.properties?.kind === 'place' &&
            f.geometry?.type === 'Point' &&
            f.properties?.name?.trim().toLowerCase() === matchName
        );
        const initialCenter: [number, number] =
          region.id === 'nagari-balingka'
            ? regionPlace?.geometry?.coordinates ?? region.defaultView.center
            : region.defaultView.center;
        setMetadata(m);
        setDemClient(client);
        setSimFields(sfData as SimFieldsData | null);
        setDatasets({
          bbox: m.bbox,
          center: initialCenter,
          mask,
          watershed,
          nagariBoundary,
          subBoundaries,
          settlements,
          contours,
          flowPaths,
          osmContext,
          drainageDraft,
          agamRbiRivers,
          agamContext
        });
        setInitialTelemetry({
          lng: initialCenter[0],
          lat: initialCenter[1],
          elev: client.getElevation(initialCenter[0], initialCenter[1]),
          slope: client.getSlopePercent(initialCenter[0], initialCenter[1])
        });
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Data load failed');
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [region.id, dataBasePath]);

  const reloadHydrologyData = useCallback(
    async (nextVer: number) => {
      const [metaRes, flowRes, draftRes, sfRes] = await Promise.all([
        fetch(`${dataBasePath}/metadata.json?v=${nextVer}`),
        fetch(`${dataBasePath}/flow-paths.geojson?v=${nextVer}`),
        fetch(`${dataBasePath}/drainage-draft.geojson?v=${nextVer}`),
        fetch(`${dataBasePath}/sim-fields.json?v=${nextVer}`)
      ]);
      if (metaRes.ok && flowRes.ok && draftRes.ok) {
        const [nextMeta, nextFlows, nextDraft, nextSf] = await Promise.all([
          metaRes.json(),
          flowRes.json(),
          draftRes.json(),
          sfRes.ok ? sfRes.json() : Promise.resolve(null)
        ]);
        setMetadata(nextMeta as DatasetMetadata);
        if (nextSf) setSimFields(nextSf as SimFieldsData);
        setDatasets(prev =>
          prev
            ? {
                ...prev,
                flowPaths: nextFlows,
                drainageDraft: nextDraft
              }
            : prev
        );
      }
    },
    [dataBasePath]
  );

  return {
    datasets,
    metadata,
    demClient,
    simFields,
    loadError,
    initialTelemetry,
    reloadHydrologyData
  };
}
