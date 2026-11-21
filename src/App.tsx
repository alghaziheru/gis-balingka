import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Droplets,
  Menu,
  Mountain,
  ShieldAlert,
  Wrench
} from 'lucide-react';
import { DrainageTab } from './components/DrainageTab';
import { EditorTab, type EditorSubTab } from './components/EditorTab';
import { EditorUnlockModal } from './components/EditorUnlockModal';
import { ElevationProfileModal } from './components/ElevationProfileModal';
import { FeedbackModal } from './components/FeedbackModal';
import { InfoDataModal } from './components/InfoDataModal';
import { MapView, type FlyRequest, type LoadedDatasets } from './components/MapView';
import { RainOverlay } from './components/RainOverlay';
import { SimulationTab } from './components/SimulationTab';
import { TelemetryDock } from './components/TelemetryDock';
import { TerrainTab } from './components/TerrainTab';
import { TopHud } from './components/TopHud';
import type { ActiveEditingWaterway } from './components/WaterwayEditorPanel';
import { I18N } from './i18n/translations';
import {
  buildStaticSeedWaterways,
  createSuggestion,
  createWaterway,
  deleteWaterway,
  fetchAuditLogs,
  fetchEditorStatus,
  fetchWaterwaysState,
  loadEditorName,
  loadStoredPassphrase,
  restoreDemSegment,
  revertAuditLog,
  saveEditorName,
  saveStoredPassphrase,
  suppressDemSegment,
  updateWaterway,
  verifyEditorPassphrase
} from './lib/api';
import { DemClient } from './lib/demClient';
import { loadChecklistState, saveChecklistState } from './lib/storage';
import type {
  ActiveTool,
  AuditLogEntry,
  BasemapId,
  DatasetMetadata,
  DemGridData,
  DrainageStatus,
  ElevationProfileResult,
  Language,
  LayerToggles,
  ProfileSample,
  RaindropTrace,
  SuppressedDemSegment,
  TabId,
  VerifiedWaterwayFeature,
  ViewMode
} from './types/gis';

export function App() {
  const [lang, setLang] = useState<Language>('id');
  const [viewMode, setViewMode] = useState<ViewMode>('simple');
  const [tab, setTab] = useState<TabId>('terrain');
  const [is3D, setIs3D] = useState(true);
  const [basemap, setBasemap] = useState<BasemapId>('sat');
  const [cameraPreset, setCameraPreset] = useState('center');
  const [exaggeration, setExaggeration] = useState(1.35);
  const [flowDensity, setFlowDensity] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSheetMode, setMobileSheetMode] = useState<'peek' | 'half' | 'full'>('peek');
  const [infoOpen, setInfoOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const [layers, setLayers] = useState<LayerToggles>({
    verifiedWaterways: true,
    hillshade: false,
    das: true,
    contours: false,
    slope: false,
    osmContext: false,
    bronjong: true,
    landslide: true,
    evac: true
  });

  const [datasets, setDatasets] = useState<LoadedDatasets | null>(null);
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);
  const [demClient, setDemClient] = useState<DemClient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [raindrop, setRaindrop] = useState<RaindropTrace | null>(null);
  const [profilePts, setProfilePts] = useState<[number, number][]>([]);
  const [profileResult, setProfileResult] = useState<ElevationProfileResult | null>(null);
  const [profileHover, setProfileHover] = useState<ProfileSample | null>(null);

  // Interactive Rainfall Intensity × Duration Simulator
  const [simPlaying, setSimPlaying] = useState(false);
  const [simRain, setSimRain] = useState(80);
  const [simDurationMin, setSimDurationMin] = useState(120);
  const [simProgress, setSimProgress] = useState(0.75);
  const [simScenario, setSimScenario] = useState<'clogged' | 'cleared'>('clogged');
  const [rainAnimEnabled, setRainAnimEnabled] = useState(true);

  const [drainFilter, setDrainFilter] = useState<'all' | DrainageStatus>('all');
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => loadChecklistState());
  const [drawVertices, setDrawVertices] = useState<[number, number][]>([]);

  const [editorSubTab, setEditorSubTab] = useState<EditorSubTab>('waterways');
  const [apiAvailable, setApiAvailable] = useState(false);
  const [requiresPassphrase, setRequiresPassphrase] = useState(false);
  const [editorUnlocked, setEditorUnlocked] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [actorName, setActorName] = useState(() => loadEditorName());
  const [verifiedWaterways, setVerifiedWaterways] = useState<VerifiedWaterwayFeature[]>([]);
  const [suppressedDem, setSuppressedDem] = useState<SuppressedDemSegment[]>([]);
  const [editingWaterway, setEditingWaterway] = useState<ActiveEditingWaterway | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null);
  const flyCounter = useRef(0);
  const [cursorTelemetry, setCursorTelemetry] = useState({
    lng: 100.3245,
    lat: -0.3355,
    elev: 1089,
    slope: 8
  });

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const t = I18N[lang];

  const notify = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  };

  const flyTo = (center: [number, number], opts?: { zoom?: number; pitch?: number; bearing?: number }) => {
    flyCounter.current += 1;
    setFlyRequest({ center, ...opts, nonce: flyCounter.current });
  };

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [metaRes, demRes, maskRes, wsRes, cntRes, flRes, osmRes, drnRes] = await Promise.all([
          fetch('/data/metadata.json'),
          fetch('/data/dem-grid.json'),
          fetch('/data/mask.geojson'),
          fetch('/data/watershed.geojson'),
          fetch('/data/contours.geojson'),
          fetch('/data/flow-paths.geojson'),
          fetch('/data/osm-context.geojson'),
          fetch('/data/drainage-draft.geojson')
        ]);

        if (!metaRes.ok || !demRes.ok) {
          throw new Error('Failed to load geospatial datasets from /data/');
        }

        const [meta, demGrid, mask, watershed, contours, flowPaths, osmContext, drainageDraft] =
          await Promise.all([
            metaRes.json(),
            demRes.json(),
            maskRes.json(),
            wsRes.json(),
            cntRes.json(),
            flRes.json(),
            osmRes.json(),
            drnRes.json()
          ]);

        if (cancelled) return;
        const m = meta as DatasetMetadata;
        const client = new DemClient(demGrid as DemGridData);
        setMetadata(m);
        setDemClient(client);
        setDatasets({
          bbox: m.bbox,
          center: m.center,
          mask,
          watershed,
          contours,
          flowPaths,
          osmContext,
          drainageDraft
        });
        setCursorTelemetry({
          lng: m.center[0],
          lat: m.center[1],
          elev: client.getElevation(m.center[0], m.center[1]),
          slope: client.getSlopePercent(m.center[0], m.center[1])
        });

        const edStatus = await fetchEditorStatus();
        if (cancelled) return;
        if (edStatus) {
          setApiAvailable(true);
          setRequiresPassphrase(edStatus.requiresPassphrase);
          if (edStatus.unlockedByDefault) {
            setEditorUnlocked(true);
          } else {
            const savedPass = loadStoredPassphrase();
            if (savedPass) {
              const valid = await verifyEditorPassphrase(savedPass);
              if (!cancelled && valid) setEditorUnlocked(true);
              else if (!cancelled) saveStoredPassphrase('');
            }
          }
          const [wwState, logs] = await Promise.all([fetchWaterwaysState(), fetchAuditLogs()]);
          if (!cancelled) {
            setVerifiedWaterways(wwState.waterways);
            setSuppressedDem(wwState.suppressedDem);
            setAuditLogs(logs);
          }
        } else {
          setApiAvailable(false);
          setVerifiedWaterways(buildStaticSeedWaterways(osmContext));
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Data load failed');
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeTool) {
        setActiveTool(null);
        setDrawVertices([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool]);

  useEffect(() => {
    if (!simPlaying) return;
    const id = window.setInterval(() => {
      setSimProgress(prev => {
        if (prev >= 1) {
          setSimPlaying(false);
          return 1;
        }
        const next = Math.min(1, prev + 0.008);
        if (next >= 1) setSimPlaying(false);
        return next;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [simPlaying]);

  const simKpis = useMemo(() => {
    const elapsedMin = simDurationMin * simProgress;
    const accumulatedMm = simRain * (elapsedMin / 60);
    const effectiveLoad = simRain * 0.45 + accumulatedMm * 0.55;
    const level: 'low' | 'med' | 'high' = effectiveLoad < 45 ? 'low' : effectiveLoad < 105 ? 'med' : 'high';

    const cloggedHa = metadata?.simAreasHa?.clogged[level] ?? 0;
    const clearedHa = metadata?.simAreasHa?.cleared[level] ?? 0;
    const buildFactor = simProgress <= 0.03 ? 0 : Math.min(1, 0.25 + simProgress * 0.75);
    const activeAreaHa = (simScenario === 'cleared' ? clearedHa : cloggedHa) * buildFactor;
    const reductionPct = cloggedHa > 0 ? Math.max(0, Math.round((1 - clearedHa / cloggedHa) * 100)) : 0;

    const totalCrossings = (metadata?.crossingsDetected || 0) + (metadata?.bridgesDetected || 0);
    const chokeCount =
      simScenario === 'cleared' || simProgress <= 0.03
        ? 0
        : Math.round(totalCrossings * Math.min(1, effectiveLoad / 120) * buildFactor);
    const runoffIndex =
      simProgress <= 0.03 ? 0 : Math.min(100, Math.round((effectiveLoad / 145) * 95));

    return { elapsedMin, accumulatedMm, activeAreaHa, reductionPct, chokeCount, runoffIndex };
  }, [metadata, simRain, simDurationMin, simProgress, simScenario]);

  const drainageCounts = useMemo(() => {
    const counts: Record<'all' | DrainageStatus, number> = {
      all: 0,
      normal: 0,
      clogged: 0,
      damaged: 0,
      critical: 0
    };
    if (datasets) {
      for (const f of datasets.drainageDraft.features) {
        if (f.properties?.kind !== 'drainage') continue;
        counts.all += 1;
        const st = String(f.properties.status) as DrainageStatus;
        if (st in counts) counts[st] += 1;
      }
    }
    return counts;
  }, [datasets]);

  const handleChangeViewMode = (next: ViewMode) => {
    setViewMode(next);
    if (next === 'simple') {
      if (basemap !== 'sat' && basemap !== 'osm') {
        setBasemap('sat');
      }
      if (tab === 'editor') {
        setTab('terrain');
      }
      if (activeTool) {
        setActiveTool(null);
        setDrawVertices([]);
      }
    }
  };

  const handleMapClick = (lngLat: [number, number]) => {
    if (!demClient) return;
    if (activeTool === 'raindrop') {
      setRaindrop(demClient.traceRaindrop(lngLat[0], lngLat[1]));
      setActiveTool(null);
    } else if (activeTool === 'profileA') {
      setProfileResult(null);
      setProfileHover(null);
      setProfilePts([lngLat]);
      setActiveTool('profileB');
    } else if (activeTool === 'profileB') {
      const ptA = profilePts[0];
      if (!ptA) return;
      setProfilePts([ptA, lngLat]);
      setProfileResult(demClient.sampleElevationProfile(ptA, lngLat, 60));
      setActiveTool(null);
    } else if (activeTool === 'drawWaterway') {
      setDrawVertices(prev => [...prev, lngLat]);
    }
  };

  const refreshSqliteState = async () => {
    const [wwState, logs] = await Promise.all([fetchWaterwaysState(), fetchAuditLogs()]);
    setVerifiedWaterways(wwState.waterways);
    setSuppressedDem(wwState.suppressedDem);
    setAuditLogs(logs);
  };

  const handleCameraPreset = (preset: string) => {
    setCameraPreset(preset);
    const presets: Record<string, { center: [number, number]; zoom: number; pitch: number; bearing: number }> = {
      center: { center: [100.324444, -0.335556], zoom: 14.3, pitch: is3D ? 36 : 0, bearing: is3D ? -12 : 0 },
      hulu: { center: [100.322, -0.346], zoom: 14.4, pitch: 56, bearing: -20 },
      pahambatan: { center: [100.319315, -0.339606], zoom: 15.6, pitch: is3D ? 34 : 0, bearing: -10 },
      hilalang: { center: [100.327863, -0.341817], zoom: 15.6, pitch: is3D ? 34 : 0, bearing: -8 },
      subarang: { center: [100.326183, -0.326062], zoom: 15.5, pitch: is3D ? 34 : 0, bearing: -12 },
      block: { center: [100.324444, -0.335556], zoom: 13.1, pitch: is3D ? 32 : 0, bearing: 0 }
    };
    const p = presets[preset];
    if (p) {
      if (preset === 'hulu' && !is3D) setIs3D(true);
      flyTo(p.center, { zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
    }
  };

  const bannerMessage = (() => {
    if (activeTool === 'raindrop') return t.bannerRaindrop;
    if (activeTool === 'profileA') return t.bannerProfileA;
    if (activeTool === 'profileB') return t.bannerProfileB;
    if (activeTool === 'drawWaterway') return t.bannerDrawWaterway;
    return '';
  })();

  const navTabs =
    viewMode === 'detail'
      ? ([
          ['terrain', t.tabTerrain, Mountain],
          ['sim', t.tabSim, Droplets],
          ['drainage', t.tabDrainage, ShieldAlert],
          ['editor', t.tabEditor, Wrench]
        ] as const)
      : ([
          ['terrain', t.tabTerrain, Mountain],
          ['sim', t.tabSim, Droplets],
          ['drainage', t.tabDrainage, ShieldAlert]
        ] as const);

  const mobileHeightClass =
    mobileSheetMode === 'full'
      ? 'max-md:h-[82vh]'
      : mobileSheetMode === 'half'
      ? 'max-md:h-[52vh]'
      : 'max-md:h-[126px]';

  return (
    <div className={`relative h-screen w-screen overflow-hidden ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {datasets && demClient ? (
        <MapView
          datasets={datasets}
          demClient={demClient}
          lang={lang}
          viewMode={viewMode}
          tab={tab}
          is3D={is3D}
          basemap={basemap}
          exaggeration={exaggeration}
          layers={layers}
          flowDensity={flowDensity}
          activeTool={activeTool}
          simRain={simRain}
          simDurationMin={simDurationMin}
          simProgress={simProgress}
          simScenario={simScenario}
          drainFilter={drainFilter}
          raindrop={raindrop}
          profilePts={profilePts}
          profileHover={profileHover}
          verifiedWaterways={verifiedWaterways}
          suppressedDemIds={suppressedDem.map(s => s.seg_id)}
          editorUnlocked={editorUnlocked}
          editingWaterway={
            editingWaterway
              ? {
                  id: editingWaterway.id,
                  coordinates: editingWaterway.coordinates,
                  sourceRef: editingWaterway.sourceRef
                }
              : null
          }
          drawVertices={drawVertices}
          flyRequest={flyRequest}
          onMapClick={handleMapClick}
          onSelectWaterway={feat => {
            setViewMode('detail');
            setTab('editor');
            setEditorSubTab('waterways');
            setEditingWaterway({
              id: feat.properties.id,
              name: feat.properties.name,
              kind: feat.properties.kind,
              status: feat.properties.status,
              source: feat.properties.source,
              sourceRef: feat.properties.source_ref,
              notes: feat.properties.notes,
              coordinates: feat.geometry.coordinates.map(c => [c[0], c[1]])
            });
          }}
          onPromoteDemSegment={(segId, coords) => {
            setViewMode('detail');
            setTab('editor');
            setEditorSubTab('waterways');
            setEditingWaterway({
              id: null,
              name: `Alur Koreksi (${segId})`,
              kind: 'stream',
              status: 'normal',
              source: 'dem_promoted',
              sourceRef: segId,
              notes: '',
              coordinates: coords
            });
          }}
          onSuppressDemSegment={async segId => {
            try {
              await suppressDemSegment({
                seg_id: segId,
                reason: 'Ditandai keliru langsung dari peta',
                actor: actorName
              });
              await refreshSqliteState();
              notify(lang === 'en' ? `Hidden DEM segment ${segId}` : `Segmen ${segId} disembunyikan & dicatat`);
            } catch (err) {
              notify(err instanceof Error ? err.message : 'Failed to suppress');
            }
          }}
          onChangeEditingCoords={coords => {
            setEditingWaterway(prev => (prev ? { ...prev, coordinates: coords } : prev));
          }}
          onCursorTelemetry={setCursorTelemetry}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#e8ebe7] p-4">
          <div className="surface-panel rounded-2xl px-6 py-4 text-center">
            <div className="text-[14px] font-bold text-[#161c1a]">
              {loadError ? `Error: ${loadError}` : t.loadingData}
            </div>
          </div>
        </div>
      )}

      {/* Falling Rain Animation Overlay during Simulation */}
      <RainOverlay active={tab === 'sim' && rainAnimEnabled && simProgress > 0.01} intensityMmHr={simRain} />

      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className="surface-panel absolute top-3 left-3 z-19 inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-bold text-[#161c1a] transition hover:bg-white max-md:hidden"
        >
          <Menu className="h-4 w-4 text-[#0369a1]" />
          <span>{t.openPanel}</span>
        </button>
      )}

      <aside
        className={`surface-panel absolute top-3 bottom-3 left-3 z-20 flex w-[376px] flex-col overflow-hidden rounded-2xl transition-[height,transform] duration-200 max-md:top-auto max-md:right-2 max-md:bottom-2 max-md:left-2 max-md:w-auto max-md:max-h-[82vh] max-md:rounded-2xl ${
          sidebarCollapsed ? '-translate-x-[calc(100%+20px)] max-md:translate-x-0' : ''
        } ${mobileHeightClass}`}
      >
        <button
          type="button"
          onClick={() =>
            setMobileSheetMode(m => (m === 'peek' ? 'half' : m === 'half' ? 'full' : 'peek'))
          }
          aria-label="Toggle mobile panel height"
          className="hidden min-h-[24px] w-full shrink-0 items-center justify-center pt-1.5 pb-0.5 max-md:flex"
        >
          <span className="h-1.5 w-11 rounded-full bg-[#161c1a]/25" />
        </button>

        <header className="shrink-0 border-b border-[#161c1a]/12 bg-white px-4 py-3 max-md:px-3.5 max-md:py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-[10px] bg-[#0369a1] text-white max-md:h-7 max-md:w-7">
                <Droplets className="h-4.5 w-4.5 max-md:h-4 max-md:w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="m-0 truncate text-[16px] leading-tight font-extrabold tracking-tight text-[#161c1a] max-md:text-[14.5px]">
                  {t.appTitle}
                </h1>
                <div className="mt-0.5 truncate text-[12px] font-medium text-[#636f6a] max-md:hidden">
                  {t.subtitle}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse panel"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#434d49] hover:bg-[#f2f3ef] max-md:hidden"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </header>

        <nav
          aria-label="Main navigation"
          className={`grid shrink-0 gap-1 border-b border-[#161c1a]/12 bg-[#f2f3ef] px-2.5 py-1.5 ${
            viewMode === 'detail' ? 'grid-cols-4' : 'grid-cols-3'
          }`}
        >
          {navTabs.map(([id, label, Icon]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (window.innerWidth < 768) {
                    if (mobileSheetMode === 'peek') {
                      setMobileSheetMode('half');
                    } else if (tab === id) {
                      setMobileSheetMode(m => (m === 'half' ? 'full' : 'half'));
                    }
                  }
                  setTab(id);
                  if (activeTool) {
                    setActiveTool(null);
                    setDrawVertices([]);
                  }
                  if (id !== 'sim') setSimPlaying(false);
                }}
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-center text-[12px] leading-tight font-bold transition ${
                  active
                    ? 'border border-[#161c1a]/10 bg-white text-[#0369a1] shadow-xs'
                    : 'text-[#434d49] hover:bg-white/60 hover:text-[#161c1a]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div
          className={`sidebar-scroll flex-1 overflow-y-auto px-3.5 pt-3.5 pb-4 ${
            mobileSheetMode === 'peek' ? 'max-md:hidden' : ''
          }`}
        >
          {tab === 'terrain' && (
            <TerrainTab
              lang={lang}
              viewMode={viewMode}
              basemap={basemap}
              layers={layers}
              exaggeration={exaggeration}
              flowDensity={flowDensity}
              activeTool={activeTool}
              raindrop={raindrop}
              studyAreaKm2={metadata?.studyAreaKm2 || 20.9}
              cameraPreset={cameraPreset}
              onSelectPreset={handleCameraPreset}
              onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
              onChangeExag={setExaggeration}
              onChangeFlowDensity={setFlowDensity}
              onToggleTool={tool => {
                setActiveTool(prev => (prev === tool || (tool === 'profileA' && prev === 'profileB') ? null : tool));
              }}
              onClearRaindrop={() => setRaindrop(null)}
              onSwitchToDetail={() => handleChangeViewMode('detail')}
            />
          )}

          {tab === 'sim' && (
            <SimulationTab
              lang={lang}
              viewMode={viewMode}
              playing={simPlaying}
              rainMm={simRain}
              durationMin={simDurationMin}
              progress={simProgress}
              scenario={simScenario}
              rainAnimEnabled={rainAnimEnabled}
              layers={layers}
              kpis={simKpis}
              onTogglePlay={() => {
                if (simPlaying) {
                  setSimPlaying(false);
                } else {
                  if (simProgress >= 1) setSimProgress(0);
                  setSimPlaying(true);
                }
              }}
              onResetSim={() => {
                setSimPlaying(false);
                setSimProgress(0);
              }}
              onChangeProgress={p => {
                setSimPlaying(false);
                setSimProgress(p);
              }}
              onChangeRain={setSimRain}
              onChangeDuration={setSimDurationMin}
              onChangeScenario={setSimScenario}
              onToggleRainAnim={setRainAnimEnabled}
              onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
            />
          )}

          {tab === 'drainage' && (
            <DrainageTab
              lang={lang}
              viewMode={viewMode}
              drainFilter={drainFilter}
              counts={drainageCounts}
              layers={layers}
              checklist={checklist}
              onChangeFilter={setDrainFilter}
              onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
              onToggleChecklist={(id, val) => {
                const next = { ...checklist, [id]: val };
                setChecklist(next);
                saveChecklistState(next);
              }}
              onFocusHulu={() => {
                setLayers(prev => ({ ...prev, slope: true }));
                setIs3D(true);
                flyTo([100.322, -0.346], { zoom: 14.4, pitch: 54, bearing: -20 });
              }}
              onFocusDrainage={() => {
                setDrainFilter('all');
                flyTo([100.3248, -0.3365], { zoom: 15.0, pitch: 35, bearing: -10 });
              }}
              onJumpCompare={() => {
                setTab('sim');
                setSimRain(100);
                setSimDurationMin(120);
                setSimProgress(1);
                setSimScenario('cleared');
                setSimPlaying(false);
              }}
              onFocusEvac={() => {
                setLayers(prev => ({ ...prev, evac: true }));
                flyTo([100.325, -0.337], { zoom: 15.0, pitch: 32, bearing: 0 });
              }}
            />
          )}

          {tab === 'editor' && viewMode === 'detail' && (
            <EditorTab
              lang={lang}
              subTab={editorSubTab}
              onChangeSubTab={sub => {
                setEditorSubTab(sub);
                if (activeTool) {
                  setActiveTool(null);
                  setDrawVertices([]);
                }
              }}
              activeTool={activeTool}
              onNotify={notify}
              apiAvailable={apiAvailable}
              editorUnlocked={editorUnlocked}
              requiresPassphrase={requiresPassphrase}
              actorName={actorName}
              onChangeActorName={name => {
                setActorName(name);
                saveEditorName(name);
              }}
              onOpenUnlock={() => setUnlockModalOpen(true)}
              onLockEditor={() => {
                saveStoredPassphrase('');
                setEditorUnlocked(false);
                setEditingWaterway(null);
              }}
              verifiedWaterways={verifiedWaterways}
              suppressedDem={suppressedDem}
              editingWaterway={editingWaterway}
              onStartDrawWaterway={() => {
                setEditingWaterway(null);
                setDrawVertices([]);
                setActiveTool(prev => (prev === 'drawWaterway' ? null : 'drawWaterway'));
              }}
              onStartEditWaterway={feat => {
                setEditingWaterway({
                  id: feat.properties.id,
                  name: feat.properties.name,
                  kind: feat.properties.kind,
                  status: feat.properties.status,
                  source: feat.properties.source,
                  sourceRef: feat.properties.source_ref,
                  notes: feat.properties.notes,
                  coordinates: feat.geometry.coordinates.map(c => [c[0], c[1]])
                });
                const mid = feat.geometry.coordinates[Math.floor(feat.geometry.coordinates.length / 2)];
                if (mid) flyTo(mid, { zoom: 15.6 });
              }}
              onUpdateEditingCoords={coords => {
                setEditingWaterway(prev => (prev ? { ...prev, coordinates: coords } : prev));
              }}
              onCancelWaterwayEdit={() => setEditingWaterway(null)}
              onSaveWaterway={async (draft, reason) => {
                try {
                  if (draft.id) {
                    await updateWaterway(draft.id, {
                      name: draft.name,
                      kind: draft.kind,
                      status: draft.status,
                      notes: draft.notes,
                      coordinates: draft.coordinates,
                      actor: actorName,
                      reason
                    });
                  } else {
                    await createWaterway({
                      name: draft.name,
                      kind: draft.kind,
                      status: draft.status,
                      source: draft.source,
                      source_ref: draft.sourceRef || null,
                      notes: draft.notes,
                      coordinates: draft.coordinates,
                      actor: actorName,
                      reason
                    });
                  }
                  setEditingWaterway(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? 'Waterway saved & logged.' : 'Jalur sungai tersimpan & dicatat di Riwayat.');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Save failed');
                }
              }}
              onDeleteWaterway={async (id, reason) => {
                try {
                  await deleteWaterway(id, { actor: actorName, reason });
                  setEditingWaterway(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? 'Waterway removed & logged.' : 'Jalur dihapus & dicatat di Riwayat.');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Delete failed');
                }
              }}
              onRestoreDem={async segId => {
                try {
                  await restoreDemSegment(segId, { actor: actorName, reason: 'Pulihkan segmen DEM' });
                  await refreshSqliteState();
                  notify(lang === 'en' ? `Restored ${segId}` : `Segmen ${segId} dipulihkan`);
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Restore failed');
                }
              }}
              onFlyToWaterway={feat => {
                const mid = feat.geometry.coordinates[Math.floor(feat.geometry.coordinates.length / 2)];
                if (mid) flyTo(mid, { zoom: 15.6 });
              }}
              auditLogs={auditLogs}
              onRevertAuditLog={async logId => {
                try {
                  await revertAuditLog(logId, { actor: actorName, reason: `Revert log #${logId}` });
                  setEditingWaterway(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? `Reverted #${logId}` : `Perubahan #${logId} berhasil dipulihkan`);
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Revert failed');
                }
              }}
              onFlyToAuditLog={log => {
                const snap = (log.after || log.before) as { coordinates?: [number, number][] } | null;
                if (snap && Array.isArray(snap.coordinates) && snap.coordinates.length > 0) {
                  const mid = snap.coordinates[Math.floor(snap.coordinates.length / 2)];
                  flyTo(mid, { zoom: 15.6 });
                }
              }}
            />
          )}
        </div>
      </aside>

      <TopHud
        lang={lang}
        viewMode={viewMode}
        is3D={is3D}
        basemap={basemap}
        onChangeViewMode={handleChangeViewMode}
        onToggle3D={setIs3D}
        onChangeBasemap={setBasemap}
        onChangeLang={setLang}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenInfo={() => setInfoOpen(true)}
      />

      {activeTool && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-16 z-19 inline-flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-full bg-[#161c1a] px-4 py-2 text-[12.5px] font-semibold text-white shadow-xl max-md:top-14 max-md:left-1/2 max-md:px-3 max-md:py-1.5 ${
            sidebarCollapsed ? 'left-1/2' : 'left-[calc(50%+188px)]'
          }`}
        >
          <span>{bannerMessage}</span>
          {activeTool === 'drawWaterway' && (
            <button
              type="button"
              onClick={() => {
                if (drawVertices.length < 2) {
                  notify(t.toastNeed2Pts);
                  return;
                }
                setEditingWaterway({
                  id: null,
                  name: '',
                  kind: 'canal',
                  status: 'normal',
                  source: 'manual',
                  notes: '',
                  coordinates: [...drawVertices]
                });
                setDrawVertices([]);
                setActiveTool(null);
              }}
              className="rounded-full bg-[#047857] px-3 py-1 text-[12px] font-bold text-white"
            >
              {t.finishDraw}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setActiveTool(null);
              setDrawVertices([]);
            }}
            className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-bold text-white hover:bg-white/25"
          >
            {t.cancelEsc}
          </button>
        </div>
      )}

      <ElevationProfileModal
        lang={lang}
        profile={profileResult}
        sidebarCollapsed={sidebarCollapsed}
        onHoverSample={setProfileHover}
        onClose={() => {
          setProfileResult(null);
          setProfilePts([]);
          setProfileHover(null);
        }}
      />

      <TelemetryDock
        lang={lang}
        viewMode={viewMode}
        tab={tab}
        basemap={basemap}
        layers={layers}
        flowDensity={flowDensity}
        mobileSheetMode={mobileSheetMode}
        cursorTelemetry={cursorTelemetry}
        onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
        onChangeFlowDensity={setFlowDensity}
      />

      <FeedbackModal
        open={feedbackOpen}
        lang={lang}
        apiAvailable={apiAvailable}
        onSubmit={async payload => {
          try {
            await createSuggestion({
              reporter_name: payload.name || (lang === 'en' ? 'Anonymous' : 'Anonim'),
              contact: '',
              category: payload.topic,
              location_name: 'General Web Feedback',
              message: payload.message,
              lng: null,
              lat: null
            });
            notify(t.feedbackSentToast);
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Failed to send feedback');
          }
        }}
        onClose={() => setFeedbackOpen(false)}
      />

      <InfoDataModal
        open={infoOpen}
        lang={lang}
        metadata={metadata}
        apiAvailable={apiAvailable}
        verifiedCount={verifiedWaterways.length}
        onNotify={notify}
        onClose={() => setInfoOpen(false)}
      />

      <EditorUnlockModal
        open={unlockModalOpen}
        lang={lang}
        requiresPassphrase={requiresPassphrase}
        actorName={actorName}
        onClose={() => setUnlockModalOpen(false)}
        onUnlocked={(pass, nextActor) => {
          saveStoredPassphrase(pass);
          saveEditorName(nextActor);
          setActorName(nextActor);
          setEditorUnlocked(true);
          notify(lang === 'en' ? 'Editor Mode unlocked.' : 'Mode Editor berhasil dibuka.');
        }}
      />

      {toast && (
        <div className="fixed top-16 right-3.5 z-60 rounded-xl bg-[#161c1a] px-4 py-2.5 text-[13px] font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
export default App;
