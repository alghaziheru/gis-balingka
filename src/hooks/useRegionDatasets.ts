import { useCallback, useEffect, useState } from 'react';
import type { LoadedDatasets } from '../components/MapView';
import { getRegionDataBasePath, REGION, type RegionConfig } from '../config/region';
import { CLIMATE_BASELINE, type ClimateBaselineData } from '../data/climateBaseline';
import { DemClient } from '../lib/demClient';
import type { DatasetMetadata, DemGridData, SimFieldsData } from '../types/gis';

export interface CursorTelemetry {
  lng: number;
  lat: number;
  elev: number;
  slope: number;
}

export interface DatasetLoadProgress {
  loadedFiles: number;
  totalFiles: number;
  fraction: number;
  status: 'loading' | 'ready' | 'error';
}

const DATASET_WEIGHTS = {
  metadata: 0.016,
  demGrid: 0.2,
  mask: 0.016,
  watershed: 0.016,
  nagariBoundary: 0.016,
  subBoundaries: 0.016,
  settlements: 0.11,
  contours: 0.24,
  flowPaths: 0.05,
  osmContext: 0.04,
  drainageDraft: 0.02,
  simFields: 0.16,
  agamRbiRivers: 0.08,
  agamContext: 0.02
} as const;

const TOTAL_DATASET_FILES = Object.keys(DATASET_WEIGHTS).length;

export function useRegionDatasets(region: RegionConfig = REGION) {
  const [datasets, setDatasets] = useState<LoadedDatasets | null>(null);
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);
  const [demClient, setDemClient] = useState<DemClient | null>(null);
  const [simFields, setSimFields] = useState<SimFieldsData | null>(null);
  const [climateBaseline, setClimateBaseline] = useState<ClimateBaselineData>(CLIMATE_BASELINE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialTelemetry, setInitialTelemetry] = useState<CursorTelemetry | null>(null);
  const [datasetProgress, setDatasetProgress] = useState<DatasetLoadProgress>({
    loadedFiles: 0,
    totalFiles: TOTAL_DATASET_FILES,
    fraction: 0,
    status: 'loading'
  });
  const [retryNonce, setRetryNonce] = useState(0);

  const dataBasePath = getRegionDataBasePath(region);

  const retryLoad = useCallback(() => {
    setRetryNonce(n => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDatasets(null);
    setMetadata(null);
    setDemClient(null);
    setSimFields(null);
    setClimateBaseline(CLIMATE_BASELINE);
    setLoadError(null);
    setDatasetProgress({
      loadedFiles: 0,
      totalFiles: TOTAL_DATASET_FILES,
      fraction: 0,
      status: 'loading'
    });

    async function loadAll() {
      try {
        const emptyFc = { type: 'FeatureCollection' as const, features: [] };
        let loadedFiles = 0;
        let loadedWeight = 0;

        const fetchPart = async <T,>(
          path: string,
          weight: number,
          opts: { required?: boolean; fallback?: T } = {}
        ): Promise<T> => {
          const res = await fetch(`${dataBasePath}/${path}`);
          if (!res.ok) {
            if (opts.required) {
              throw new Error(`Failed to load geospatial datasets from ${dataBasePath}/`);
            }
            if ('fallback' in opts) {
              loadedFiles += 1;
              loadedWeight = Math.min(1, loadedWeight + weight);
              if (!cancelled) {
                setDatasetProgress({
                  loadedFiles,
                  totalFiles: TOTAL_DATASET_FILES,
                  fraction: loadedWeight,
                  status: 'loading'
                });
              }
              return opts.fallback as T;
            }
            throw new Error(`Failed to load ${path} from ${dataBasePath}/`);
          }
          const json = (await res.json()) as T;
          loadedFiles += 1;
          loadedWeight = Math.min(1, loadedWeight + weight);
          if (!cancelled) {
            setDatasetProgress({
              loadedFiles,
              totalFiles: TOTAL_DATASET_FILES,
              fraction: loadedWeight,
              status: 'loading'
            });
          }
          return json;
        };

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
          agamContext,
          climData
        ] = await Promise.all([
          fetchPart<DatasetMetadata>('metadata.json', DATASET_WEIGHTS.metadata, { required: true }),
          fetchPart<DemGridData>('dem-grid.json', DATASET_WEIGHTS.demGrid, { required: true }),
          fetchPart<LoadedDatasets['mask']>('mask.geojson', DATASET_WEIGHTS.mask),
          fetchPart<LoadedDatasets['watershed']>('watershed.geojson', DATASET_WEIGHTS.watershed),
          fetchPart<LoadedDatasets['nagariBoundary']>('nagari-boundary.geojson', DATASET_WEIGHTS.nagariBoundary, {
            fallback: emptyFc
          }),
          fetchPart<LoadedDatasets['subBoundaries']>('sub-boundaries.geojson', DATASET_WEIGHTS.subBoundaries, {
            fallback: emptyFc
          }),
          fetchPart<LoadedDatasets['settlements']>('settlements.geojson', DATASET_WEIGHTS.settlements, {
            fallback: emptyFc
          }),
          fetchPart<LoadedDatasets['contours']>('contours.geojson', DATASET_WEIGHTS.contours),
          fetchPart<LoadedDatasets['flowPaths']>('flow-paths.geojson', DATASET_WEIGHTS.flowPaths),
          fetchPart<LoadedDatasets['osmContext']>('osm-context.geojson', DATASET_WEIGHTS.osmContext),
          fetchPart<LoadedDatasets['drainageDraft']>('drainage-draft.geojson', DATASET_WEIGHTS.drainageDraft),
          fetchPart<SimFieldsData | null>('sim-fields.json', DATASET_WEIGHTS.simFields, { fallback: null }),
          fetchPart<LoadedDatasets['agamRbiRivers']>('agam-rbi-rivers.geojson', DATASET_WEIGHTS.agamRbiRivers, {
            fallback: emptyFc
          }),
          fetchPart<LoadedDatasets['agamContext']>('agam-context.json', DATASET_WEIGHTS.agamContext, {
            fallback: null
          }),
          fetchPart<ClimateBaselineData | null>('climate-baseline.json', 0, {
            fallback: null
          })
        ]);

        if (cancelled) return;
        const m = meta as DatasetMetadata;
        if (climData && typeof climData === 'object' && climData.returnPeriodsMm) {
          setClimateBaseline(climData as ClimateBaselineData);
        }
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
        setDatasetProgress({
          loadedFiles: TOTAL_DATASET_FILES,
          totalFiles: TOTAL_DATASET_FILES,
          fraction: 1,
          status: 'ready'
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Data load failed');
          setDatasetProgress(prev => ({ ...prev, status: 'error' }));
        }
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [region.id, dataBasePath, retryNonce]);

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
    climateBaseline,
    loadError,
    datasetProgress,
    retryLoad,
    initialTelemetry,
    reloadHydrologyData
  };
}
