import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RotateCw, X } from 'lucide-react';
import { useT } from '../context/RegionContext';
import type { DatasetLoadProgress } from '../hooks/useRegionDatasets';
import type { Language } from '../types/gis';
import type { MapLoadState } from './map/types';

export interface MapLoadingOverlayProps {
  lang: Language;
  regionName: string;
  sidebarCollapsed: boolean;
  datasetProgress: DatasetLoadProgress;
  loadError: string | null;
  editorHydrated: boolean;
  mapLoad: MapLoadState;
  basemapLabel: string;
  onRetry: () => void;
}

/** Two-stage map loading indicator: centered checklist card -> compact map-top tile pill. */
export function MapLoadingOverlay({
  lang,
  regionName,
  sidebarCollapsed,
  datasetProgress,
  loadError,
  editorHydrated,
  mapLoad,
  basemapLabel,
  onRetry
}: MapLoadingOverlayProps) {
  const t = useT(lang);
  const [dismissedCycle, setDismissedCycle] = useState(false);
  const [readyFlash, setReadyFlash] = useState(false);
  const maxPctRef = useRef(0);
  const readyTimerRef = useRef<number | null>(null);
  const prevInitialReadyRef = useRef(mapLoad.initialTilesReady);
  const prevBasemapSwitchingRef = useRef(mapLoad.basemapSwitching);

  const clearReadyTimer = () => {
    if (readyTimerRef.current !== null) {
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  };

  // Reset monotonic floor and timers when switching regions or retrying datasets
  useEffect(() => {
    maxPctRef.current = 0;
    setDismissedCycle(false);
    setReadyFlash(false);
    clearReadyTimer();
  }, [regionName]);

  useEffect(() => {
    if (datasetProgress.status === 'loading' && datasetProgress.loadedFiles === 0) {
      maxPctRef.current = 0;
      setDismissedCycle(false);
      setReadyFlash(false);
      clearReadyTimer();
    }
  }, [datasetProgress.status, datasetProgress.loadedFiles]);

  // Trigger brief "Map ready" flash on non-timed-out completion; un-dismiss on basemap switches
  useEffect(() => {
    const prevInitial = prevInitialReadyRef.current;
    const prevBasemap = prevBasemapSwitchingRef.current;
    prevInitialReadyRef.current = mapLoad.initialTilesReady;
    prevBasemapSwitchingRef.current = mapLoad.basemapSwitching;

    if (!prevBasemap && mapLoad.basemapSwitching) {
      setDismissedCycle(false);
      setReadyFlash(false);
      clearReadyTimer();
      return;
    }

    const initialJustFinished =
      !prevInitial &&
      mapLoad.initialTilesReady &&
      !mapLoad.initialTimedOut &&
      datasetProgress.status === 'ready';
    const basemapJustFinished =
      prevBasemap && !mapLoad.basemapSwitching && !mapLoad.basemapTimedOut;

    if (initialJustFinished || basemapJustFinished) {
      setReadyFlash(true);
      clearReadyTimer();
      readyTimerRef.current = window.setTimeout(() => {
        setReadyFlash(false);
        readyTimerRef.current = null;
      }, 700);
    }
  }, [
    datasetProgress.status,
    mapLoad.initialTilesReady,
    mapLoad.initialTimedOut,
    mapLoad.basemapSwitching,
    mapLoad.basemapTimedOut
  ]);

  useEffect(() => () => clearReadyTimer(), []);

  let rawPct = 0;
  if (datasetProgress.status !== 'ready') {
    rawPct = Math.round(datasetProgress.fraction * 55);
  } else if (!mapLoad.styleReady) {
    rawPct = Math.round(55 + 4 + (editorHydrated ? 6 : 0));
  } else if (!mapLoad.initialTilesReady) {
    rawPct = Math.round(55 + 14 + (editorHydrated ? 6 : 0) + mapLoad.tileProgress * 24);
  } else {
    rawPct = 100;
  }

  if (rawPct > maxPctRef.current) {
    maxPctRef.current = rawPct;
  }
  const displayPct = Math.min(100, Math.max(0, maxPctRef.current));

  const mapCenterAreaClass = `pointer-events-none fixed inset-y-0 right-0 z-18 flex items-center justify-center p-4 max-md:top-14 max-md:right-0 max-md:bottom-[134px] max-md:left-0 ${
    sidebarCollapsed ? 'left-0' : 'left-[388px]'
  }`;

  // 1. Dataset error card
  if (datasetProgress.status === 'error' || loadError) {
    return (
      <div className={mapCenterAreaClass}>
        <div
          data-testid="map-loading-error"
          role="alert"
          className="surface-panel pointer-events-auto w-full max-w-[340px] rounded-2xl p-5"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#b91c1c]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-extrabold text-[#161c1a]">{t.loadErrorTitle}</div>
              <p className="mt-1 text-[12.5px] leading-snug text-[#434d49]">{loadError}</p>
              <button
                type="button"
                data-testid="map-loading-retry"
                onClick={onRetry}
                className="mt-3.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0369a1] px-3.5 py-1.5 text-[12.5px] font-bold text-white transition hover:bg-[#075985]"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>{t.loadRetry}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Stage 1-2: Centered progress card while datasets or map engine load
  if (datasetProgress.status !== 'ready' || !mapLoad.styleReady) {
    const datasetsDone = datasetProgress.status === 'ready';
    const engineActive = datasetsDone && !mapLoad.styleReady;

    return (
      <div className={mapCenterAreaClass}>
        <div
          data-testid="map-loading-card"
          role="status"
          aria-live="polite"
          className="surface-panel pointer-events-auto w-full max-w-[340px] rounded-2xl p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-extrabold tracking-tight text-[#161c1a]">
                {regionName}
              </div>
              <div className="mt-0.5 text-[12px] font-medium text-[#636f6a]">{t.loadSubtitle}</div>
            </div>
            <div className="font-mono-num shrink-0 text-[18px] leading-none font-extrabold text-[#0369a1]">
              {displayPct}%
            </div>
          </div>

          <div
            role="progressbar"
            aria-valuenow={displayPct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-[#f2f3ef]"
          >
            <div
              className="h-full rounded-full bg-[#0369a1] transition-[width] duration-200"
              style={{ width: `${Math.max(4, displayPct)}%` }}
            />
          </div>

          <ul className="mt-4 space-y-2 text-[12.5px]">
            <li className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                {datasetsDone ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#047857]" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0369a1]" />
                )}
                <span className={datasetsDone ? 'font-semibold text-[#161c1a]' : 'font-bold text-[#161c1a]'}>
                  {t.loadStageDatasets}
                </span>
              </span>
              <span className="font-mono-num shrink-0 rounded bg-[#f2f3ef] px-1.5 py-0.5 text-[11px] font-bold text-[#434d49]">
                {datasetProgress.loadedFiles}/{datasetProgress.totalFiles}
              </span>
            </li>

            <li className="flex items-center gap-2">
              {mapLoad.styleReady ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#047857]" />
              ) : engineActive ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0369a1]" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-[#161c1a]/20 bg-[#fafaf8]" />
              )}
              <span className={engineActive ? 'font-bold text-[#161c1a]' : 'font-medium text-[#636f6a]'}>
                {t.loadStageEngine}
              </span>
            </li>

            <li className="flex items-center gap-2">
              <span className="h-4 w-4 shrink-0 rounded-full border border-[#161c1a]/20 bg-[#fafaf8]" />
              <span className="font-medium text-[#636f6a]">{t.loadStageTiles}</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  // 3. Stage 3: Compact map-top pill while initial tiles or basemap tiles stream, plus brief "Map ready" flash
  const showInitialPill = !mapLoad.initialTilesReady;
  const showBasemapPill = mapLoad.basemapSwitching;
  const showReadyPill = readyFlash && !showInitialPill && !showBasemapPill;

  if (dismissedCycle || (!showInitialPill && !showBasemapPill && !showReadyPill)) {
    return null;
  }

  const pillPositionClass = `fixed top-16 z-26 max-w-[calc(100vw-24px)] -translate-x-1/2 max-md:top-14 max-md:left-1/2 ${
    sidebarCollapsed ? 'left-1/2' : 'left-[calc(50%+188px)]'
  }`;

  return (
    <div
      data-testid="map-loading-pill"
      role="status"
      aria-live="polite"
      className={`${pillPositionClass} surface-panel inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-[#161c1a]`}
    >
      {showReadyPill ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#047857]" />
          <span className="whitespace-nowrap font-bold text-[#047857]">{t.loadReady}</span>
          <span className="font-mono-num text-[11px] font-bold text-[#047857]">100%</span>
        </>
      ) : showBasemapPill ? (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#0369a1]" />
          <span className="truncate">
            {t.loadPillBasemap} ({basemapLabel})...
          </span>
          <button
            type="button"
            onClick={() => setDismissedCycle(true)}
            aria-label={t.loadDismiss}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#636f6a] transition hover:bg-[#f2f3ef] hover:text-[#161c1a]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#0369a1]" />
          <span className="truncate">{t.loadPillTiles}</span>
          <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[#f2f3ef] max-md:hidden">
            <div
              className="h-full rounded-full bg-[#0369a1] transition-[width] duration-200"
              style={{ width: `${displayPct}%` }}
            />
          </div>
          <span className="font-mono-num shrink-0 text-[11px] font-bold text-[#0369a1]">{displayPct}%</span>
          <button
            type="button"
            onClick={() => setDismissedCycle(true)}
            aria-label={t.loadDismiss}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#636f6a] transition hover:bg-[#f2f3ef] hover:text-[#161c1a]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
