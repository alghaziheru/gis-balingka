import { useCallback, useEffect, useState } from 'react';
import type { LoadedDatasets } from '../components/MapView';
import { REGION } from '../config/region';
import { CLIMATE_BASELINE, type ClimateBaselineData } from '../data/climateBaseline';
import { DemClient } from '../lib/demClient';
import type { DatasetMetadata, DemGridData, SimFieldsData } from '../types/gis';

export interface CursorTelemetry {
  lng: number;
  lat: number;
  elev: number;
  slope: number;
}

export function useRegionDatasets() {
  const [datasets, setDatasets] = useState<LoadedDatasets | null>(null);
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);
  const [demClient, setDemClient] = useState<DemClient | null>(null);
  const [simFields, setSimFields] = useState<SimFieldsData | null>(null);
  const [climateBaseline, setClimateBaseline] = useState<ClimateBaselineData>(CLIMATE_BASELINE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialTelemetry, setInitialTelemetry] = useState<CursorTelemetry | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [
          metaRes,
          demRes,
          maskRes,
          wsRes,
          nbRes,
          stRes,
          cntRes,
          flRes,
          osmRes,
          drnRes,
          sfRes,
          rbiRes,
          agamCtxRes,
          climRes
        ] = await Promise.all([
          fetch('/data/metadata.json'),
          fetch('/data/dem-grid.json'),
          fetch('/data/mask.geojson'),
          fetch('/data/watershed.geojson'),
          fetch('/data/nagari-boundary.geojson'),
          fetch('/data/settlements.geojson'),
          fetch('/data/contours.geojson'),
          fetch('/data/flow-paths.geojson'),
          fetch('/data/osm-context.geojson'),
          fetch('/data/drainage-draft.geojson'),
          fetch('/data/sim-fields.json'),
          fetch('/data/agam-rbi-rivers.geojson'),
          fetch('/data/agam-context.json'),
          fetch('/data/climate-baseline.json')
        ]);

        if (!metaRes.ok || !demRes.ok) {
          throw new Error('Failed to load geospatial datasets from /data/');
        }

        const emptyFc = { type: 'FeatureCollection' as const, features: [] };
        const [
          meta,
          demGrid,
          mask,
          watershed,
          nagariBoundary,
          settlements,
          contours,
          flowPaths,
          osmContext,
          drainageDraft,
          sfData,
          agamRbiRivers,
          agamContext,
          climData
        ] = await Promise.all([
          metaRes.json(),
          demRes.json(),
          maskRes.json(),
          wsRes.json(),
          nbRes.ok ? nbRes.json() : Promise.resolve(emptyFc),
          stRes.ok ? stRes.json() : Promise.resolve(emptyFc),
          cntRes.json(),
          flRes.json(),
          osmRes.json(),
          drnRes.json(),
          sfRes.ok ? sfRes.json() : Promise.resolve(null),
          rbiRes.ok ? rbiRes.json() : Promise.resolve(emptyFc),
          agamCtxRes.ok ? agamCtxRes.json() : Promise.resolve(null),
          climRes.ok ? climRes.json() : Promise.resolve(null)
        ]);

        if (cancelled) return;
        const m = meta as DatasetMetadata;
        if (climData && typeof climData === 'object' && climData.returnPeriodsMm) {
          setClimateBaseline(climData as ClimateBaselineData);
        }
        const client = new DemClient(demGrid as DemGridData);
        const balingkaPlace = (
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
            f.properties?.name?.trim().toLowerCase() === 'balingka'
        );
        const initialCenter: [number, number] = balingkaPlace?.geometry?.coordinates ?? REGION.defaultView.center;
        setMetadata(m);
        setDemClient(client);
        setSimFields(sfData as SimFieldsData | null);
        setDatasets({
          bbox: m.bbox,
          center: initialCenter,
          mask,
          watershed,
          nagariBoundary,
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
  }, []);

  const reloadHydrologyData = useCallback(async (nextVer: number) => {
    const [metaRes, flowRes, draftRes, sfRes] = await Promise.all([
      fetch(`/data/metadata.json?v=${nextVer}`),
      fetch(`/data/flow-paths.geojson?v=${nextVer}`),
      fetch(`/data/drainage-draft.geojson?v=${nextVer}`),
      fetch(`/data/sim-fields.json?v=${nextVer}`)
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
  }, []);

  return {
    datasets,
    metadata,
    demClient,
    simFields,
    climateBaseline,
    loadError,
    initialTelemetry,
    reloadHydrologyData
  };
}
