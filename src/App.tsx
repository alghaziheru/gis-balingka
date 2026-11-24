import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  CloudRain,
  Droplets,
  MapPin,
  Menu,
  Mountain,
  Wrench
} from 'lucide-react';
import { ActiveMapLegend } from './components/ActiveMapLegend';
import { DrainageTab } from './components/DrainageTab';
import { EditorTab } from './components/EditorTab';
import { EditorUnlockModal } from './components/EditorUnlockModal';
import { ElevationProfileModal } from './components/ElevationProfileModal';
import { FeedbackModal } from './components/FeedbackModal';
import { InfoDataModal, type InfoModalTab } from './components/InfoDataModal';
import { MapView, type FlyRequest, type MapCameraState, type MapControlHandle } from './components/MapView';
import { RainOverlay } from './components/RainOverlay';
import { SimulationTab } from './components/SimulationTab';
import { TelemetryDock } from './components/TelemetryDock';
import { TerrainTab } from './components/TerrainTab';
import { TopHud } from './components/TopHud';
import { REGION } from './config/region';
import { useEditorActions } from './hooks/useEditorActions';
import { useRegionDatasets, type CursorTelemetry } from './hooks/useRegionDatasets';
import { useSimulationController } from './hooks/useSimulationController';
import { I18N } from './i18n/translations';
import { createSuggestion, saveEditorName, saveStoredPassphrase } from './lib/api';
import { haversineMeters } from './lib/geometry';
import type {
  ActiveTool,
  BasemapId,
  DrainageStatus,
  ElevationProfileResult,
  Language,
  LayerToggles,
  ProfileSample,
  RaindropTrace,
  TabId,
  ViewMode
} from './types/gis';

const DEFAULT_LAYERS: LayerToggles = {
  verifiedWaterways: true,
  structures: true,
  unverifiedCrossings: false,
  settlements: true,
  landCover: false,
  scourChange: false,
  agamLandslide: false,
  agamRbiRivers: false,
  agamForestStatus: false,
  agamSoilGeology: false,
  hillshade: false,
  das: true,
  contours: false,
  slope: false,
  osmContext: false,
  landslide: true,
  evac: true
};

const DEFAULT_FLOW_DENSITY = 1;
const DEFAULT_VIEW_CENTER: [number, number] = REGION.defaultView.center;
const DEFAULT_VIEW_ZOOM = REGION.defaultView.zoom;

const MAP_LAYER_KEYS: (keyof LayerToggles)[] = [
  'verifiedWaterways',
  'structures',
  'unverifiedCrossings',
  'settlements',
  'landCover',
  'scourChange',
  'agamLandslide',
  'agamRbiRivers',
  'agamForestStatus',
  'agamSoilGeology',
  'hillshade',
  'das',
  'contours',
  'slope',
  'osmContext'
];

export function App() {
  const [lang, setLang] = useState<Language>('id');
  const [viewMode, setViewMode] = useState<ViewMode>('simple');
  const [tab, setTab] = useState<TabId>('terrain');
  const [is3D, setIs3D] = useState(true);
  const [basemap, setBasemap] = useState<BasemapId>('sat');
  const [cameraPreset, setCameraPreset] = useState('center');
  const [exaggeration, setExaggeration] = useState(1.35);
  const [flowDensity, setFlowDensity] = useState(DEFAULT_FLOW_DENSITY);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSheetMode, setMobileSheetMode] = useState<'peek' | 'half' | 'full'>('peek');
  const [infoModalTab, setInfoModalTab] = useState<InfoModalTab | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS);

  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [raindrop, setRaindrop] = useState<RaindropTrace | null>(null);
  const [profilePts, setProfilePts] = useState<[number, number][]>([]);
  const [profileResult, setProfileResult] = useState<ElevationProfileResult | null>(null);
  const [profileHover, setProfileHover] = useState<ProfileSample | null>(null);
  const [drainFilter, setDrainFilter] = useState<'all' | DrainageStatus>('all');
  const [drawVertices, setDrawVertices] = useState<[number, number][]>([]);

  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null);
  const flyCounter = useRef(0);
  const mapControlRef = useRef<MapControlHandle | null>(null);
  const [mapCamera, setMapCamera] = useState<MapCameraState>({
    zoom: DEFAULT_VIEW_ZOOM,
    bearing: -12,
    pitch: 36,
    metersPerPixel: 3.15
  });
  const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetry>({
    lng: DEFAULT_VIEW_CENTER[0],
    lat: DEFAULT_VIEW_CENTER[1],
    elev: 1089,
    slope: 8
  });

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const t = I18N[lang];

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const flyTo = useCallback(
    (center: [number, number], opts?: { zoom?: number; pitch?: number; bearing?: number }) => {
      flyCounter.current += 1;
      setFlyRequest({ center, ...opts, nonce: flyCounter.current });
    },
    []
  );

  const { datasets, metadata, demClient, simFields, loadError, initialTelemetry, reloadHydrologyData } =
    useRegionDatasets();

  useEffect(() => {
    if (initialTelemetry) {
      setCursorTelemetry(initialTelemetry);
    }
  }, [initialTelemetry]);

  const sim = useSimulationController({
    simFields,
    settlements: datasets?.settlements,
    metadata
  });

  const editor = useEditorActions({
    datasets,
    demClient,
    lang,
    activeTool,
    setActiveTool,
    setDrawVertices,
    setViewMode,
    setTab,
    notify,
    flyTo,
    reloadHydrologyData
  });

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

  const drainageCounts = useMemo(() => {
    const counts: Record<'all' | DrainageStatus, number> = {
      all: 0,
      unverified: 0,
      normal: 0,
      clogged: 0,
      damaged: 0,
      critical: 0
    };
    const verifiedRefSet = new Set(
      editor.verifiedStructures.map(s => s.properties.source_ref).filter(Boolean).map(String)
    );
    for (const s of editor.verifiedStructures) {
      counts.all += 1;
      const st = s.properties.status;
      if (st in counts) counts[st] += 1;
    }
    if (datasets) {
      for (const f of datasets.drainageDraft.features) {
        if (f.properties?.kind !== 'drainage') continue;
        const fid = String(f.properties?.id || '');
        if (verifiedRefSet.has(fid)) continue;
        if (f.geometry.type === 'Point') {
          const fc = f.geometry.coordinates;
          if (
            editor.verifiedStructures.some(
              s => haversineMeters(fc[0], fc[1], s.geometry.coordinates[0], s.geometry.coordinates[1]) <= 45
            )
          ) {
            continue;
          }
        }
        counts.all += 1;
        const st = String(f.properties.status || 'unverified') as DrainageStatus;
        if (st in counts) counts[st] += 1;
      }
    }
    return counts;
  }, [datasets, editor.verifiedStructures]);

  const handleChangeViewMode = (next: ViewMode) => {
    setViewMode(next);
    if (next === 'simple') {
      if (basemap !== 'sat' && basemap !== 'osm') {
        setBasemap('sat');
      }
      if (tab === 'editor') {
        setTab('terrain');
      }
      sim.resetForSimpleMode();
      editor.resetEditorForSimpleMode();
      if (activeTool) {
        setActiveTool(null);
        setDrawVertices([]);
      }
    }
  };

  const handleMapClick = (lngLat: [number, number]) => {
    if (!demClient) return;
    if (activeTool === 'raindrop') {
      setRaindrop(demClient.traceRaindrop(lngLat[0], lngLat[1], editor.verifiedWaterways));
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
    } else if (activeTool === 'drawWaterway' || activeTool === 'redrawWaterway' || activeTool === 'drawJorong') {
      setDrawVertices(prev => [...prev, lngLat]);
    } else if (activeTool === 'placeStructure') {
      editor.setEditingStructure({
        id: null,
        name: '',
        kind: 'culvert',
        status: 'normal',
        source: 'manual',
        sourceRef: null,
        sizeNote: '',
        notes: '',
        coordinates: lngLat
      });
      setActiveTool(null);
    }
  };

  const handleCameraPreset = (preset: string) => {
    setCameraPreset(preset);
    const match = REGION.cameraPresets.find(p => p.id === preset);
    if (match) {
      flyTo(match.center, {
        zoom: match.zoom,
        pitch: is3D ? match.pitch3D : 0,
        bearing: is3D ? match.bearing3D : 0
      });
    }
  };

  const bannerMessage = (() => {
    if (activeTool === 'raindrop') return t.bannerRaindrop;
    if (activeTool === 'profileA') return t.bannerProfileA;
    if (activeTool === 'profileB') return t.bannerProfileB;
    if (activeTool === 'drawWaterway') return t.bannerDrawWaterway;
    if (activeTool === 'redrawWaterway') return t.bannerRedrawWaterway;
    if (activeTool === 'placeStructure') return t.bannerPlaceStructure;
    if (activeTool === 'drawJorong') return t.bannerDrawJorong;
    return '';
  })();

  const navTabs =
    viewMode === 'detail'
      ? ([
          ['terrain', t.tabTerrain, Mountain],
          ['sim', t.tabSim, Droplets],
          ['drainage', t.tabDrainage, MapPin],
          ['editor', t.tabEditor, Wrench]
        ] as const)
      : ([
          ['terrain', t.tabTerrain, Mountain],
          ['sim', t.tabSim, Droplets],
          ['drainage', t.tabDrainage, MapPin]
        ] as const);

  const effectiveLayers = useMemo<LayerToggles>(
    () =>
      tab === 'sim'
        ? {
            ...layers,
            verifiedWaterways: sim.simShowVerifiedWaterways,
            agamRbiRivers: sim.simShowRbiRivers
          }
        : layers,
    [tab, layers, sim.simShowVerifiedWaterways, sim.simShowRbiRivers]
  );

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
          layers={effectiveLayers}
          flowDensity={flowDensity}
          activeTool={activeTool}
          simRain={sim.simRain}
          simDurationMin={sim.simDurationMin}
          simProgress={sim.simProgress}
          simScenario={sim.drainCondition === 'cleared' ? 'cleared' : 'clogged'}
          rainAnimEnabled={sim.rainAnimEnabled}
          cascadeEngine={sim.cascadeEngine}
          cascadeParams={sim.cascadeParams}
          drainFilter={drainFilter}
          raindrop={raindrop}
          profilePts={profilePts}
          profileHover={profileHover}
          verifiedWaterways={editor.verifiedWaterways}
          verifiedStructures={editor.verifiedStructures}
          jorongBoundaries={editor.jorongBoundaries}
          suppressedDemIds={editor.suppressedDemIds}
          dataVersion={editor.dataVersion}
          apiAvailable={editor.apiAvailable}
          requiresPassphrase={editor.requiresPassphrase}
          editorUnlocked={editor.editorUnlocked}
          editingWaterway={editor.mapEditingWaterway}
          editingStructure={editor.mapEditingStructure}
          drawVertices={drawVertices}
          flyRequest={flyRequest}
          controlRef={mapControlRef}
          onCameraChange={setMapCamera}
          onSelectJorongPill={setCameraPreset}
          onMapClick={handleMapClick}
          onOpenUnlock={() => editor.setUnlockModalOpen(true)}
          onSelectWaterway={editor.selectWaterwayFromMap}
          onSelectStructure={editor.selectStructureFromMap}
          onVerifyCrossing={editor.verifyCrossingFromMap}
          onMoveEditingStructure={coords => {
            editor.setEditingStructure(prev => (prev ? { ...prev, coordinates: coords } : prev));
          }}
          onPromoteDemSegment={editor.promoteDemSegmentFromMap}
          onPromoteRbiRiver={editor.promoteRbiRiverFromMap}
          onRedrawDemSegment={editor.redrawDemSegmentFromMap}
          onSuppressDemSegment={editor.suppressDemSegmentFromMap}
          onChangeEditingCoords={coords => {
            editor.setEditingWaterway(prev => (prev ? { ...prev, coordinates: coords } : prev));
          }}
          onSnapFeedback={notify}
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
      <RainOverlay
        active={tab === 'sim' && sim.rainAnimEnabled && sim.simProgress > 0.02}
        intensityMmHr={sim.simRain}
        rainPattern={sim.rainPattern}
        uplandBbox={sim.uplandBbox}
        mapControlRef={mapControlRef}
      />

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
                  if (id !== 'sim') sim.setSimPlaying(false);
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
              layers={layers}
              exaggeration={exaggeration}
              flowDensity={flowDensity}
              activeTool={activeTool}
              raindrop={raindrop}
              studyAreaKm2={metadata?.studyAreaKm2 || 29.9}
              buildingCount={metadata?.buildingCount}
              agamStats={metadata?.agamStats}
              cameraPreset={cameraPreset}
              onSelectPreset={handleCameraPreset}
              onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
              onResetDefaultLayers={() => {
                setLayers(prev => {
                  const next = { ...prev };
                  for (const key of MAP_LAYER_KEYS) {
                    next[key] = DEFAULT_LAYERS[key];
                  }
                  return next;
                });
                setFlowDensity(DEFAULT_FLOW_DENSITY);
              }}
              onClearAllLayers={() => {
                setLayers(prev => {
                  const next = { ...prev };
                  for (const key of MAP_LAYER_KEYS) {
                    next[key] = false;
                  }
                  return next;
                });
                setFlowDensity(0);
              }}
              onClearAgamLayers={() => {
                setLayers(prev => ({
                  ...prev,
                  agamLandslide: false,
                  agamRbiRivers: false,
                  agamForestStatus: false,
                  agamSoilGeology: false
                }));
              }}
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
              playing={sim.simPlaying}
              rainMm={sim.simRain}
              durationMin={sim.simDurationMin}
              progress={sim.simProgress}
              soilMoisture={sim.soilMoisture}
              rainPattern={sim.rainPattern}
              drainCondition={sim.drainCondition}
              forestScenario={sim.forestScenario}
              forestActualPct={metadata?.landCoverStats?.forestPct ?? 74}
              rainAnimEnabled={sim.rainAnimEnabled}
              showVerifiedWaterways={sim.simShowVerifiedWaterways}
              showRbiRivers={sim.simShowRbiRivers}
              verifiedIssueCount={editor.verifiedIssueCount}
              verifiedWaterways={editor.verifiedWaterways}
              demClient={demClient}
              agamStats={metadata?.agamStats}
              kpis={sim.cascadeKpis}
              onTogglePlay={sim.togglePlay}
              onResetSim={sim.resetSim}
              onChangeProgress={sim.changeProgress}
              onChangeRain={sim.setSimRain}
              onChangeDuration={sim.setSimDurationMin}
              onChangeSoilMoisture={sim.setSoilMoisture}
              onChangeRainPattern={sim.setRainPattern}
              onChangeDrainCondition={sim.setDrainCondition}
              onChangeForestScenario={sim.setForestScenario}
              onApplyPreset={preset => sim.applyPreset(preset, viewMode)}
              onToggleRainAnim={sim.setRainAnimEnabled}
              onToggleVerifiedWaterways={sim.setSimShowVerifiedWaterways}
              onToggleRbiRivers={sim.setSimShowRbiRivers}
            />
          )}

          {tab === 'drainage' && (
            <DrainageTab
              lang={lang}
              viewMode={viewMode}
              drainFilter={drainFilter}
              counts={drainageCounts}
              layers={layers}
              onChangeFilter={setDrainFilter}
              onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
              onFocusHulu={() => {
                setLayers(prev => ({ ...prev, slope: true }));
                setIs3D(true);
                const v = REGION.drainageFocus.upland;
                flyTo(v.center, { zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
              }}
              onFocusDrainage={() => {
                setDrainFilter('all');
                const v = REGION.drainageFocus.culverts;
                flyTo(v.center, { zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
              }}
              onFocusEvac={() => {
                setLayers(prev => ({ ...prev, evac: true }));
                const v = REGION.drainageFocus.facilities;
                flyTo(v.center, { zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
              }}
            />
          )}

          {tab === 'editor' && viewMode === 'detail' && (
            <EditorTab
              lang={lang}
              demClient={demClient}
              subTab={editor.editorSubTab}
              activeTool={activeTool}
              onNotify={notify}
              apiAvailable={editor.apiAvailable}
              editorUnlocked={editor.editorUnlocked}
              requiresPassphrase={editor.requiresPassphrase}
              actorName={editor.actorName}
              verifiedWaterways={editor.verifiedWaterways}
              verifiedStructures={editor.verifiedStructures}
              jorongBoundaries={editor.jorongBoundaries}
              suppressedDem={editor.suppressedDem}
              editingWaterway={editor.editingWaterway}
              editingStructure={editor.editingStructure}
              editingJorong={editor.editingJorong}
              hydroStatus={editor.hydroStatus}
              recomputingHydro={editor.recomputingHydro}
              auditLogs={editor.auditLogs}
              {...editor.editorTabActions}
            />
          )}
        </div>

        <div
          className={`shrink-0 border-t border-[#161c1a]/10 bg-[#fafaf8] px-3.5 py-2 text-[11px] leading-snug text-[#636f6a] ${
            mobileSheetMode === 'peek' ? 'max-md:hidden' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => setInfoModalTab('guide')}
            className="text-left transition hover:text-[#0369a1]"
          >
            {t.sidebarScopeFooter} →
          </button>
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
        onOpenInfo={() => setInfoModalTab('guide')}
      >
        {tab === 'sim' && sim.rainAnimEnabled && sim.simProgress > 0.01 && sim.rainPattern === 'upland' && (
          <div
            data-testid="upland-rain-pill"
            className="surface-panel pointer-events-none relative z-10 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] leading-none font-bold text-[#0369a1] max-md:hidden"
          >
            <CloudRain className="h-3.5 w-3.5 shrink-0" />
            <span>{t.uplandRainPill}</span>
          </div>
        )}

        <ActiveMapLegend
          lang={lang}
          viewMode={viewMode}
          tab={tab}
          basemap={basemap}
          layers={effectiveLayers}
          flowDensity={flowDensity}
          simProgress={sim.simProgress}
          drainFilter={drainFilter}
          elevRange={metadata ? [metadata.minElevM, metadata.maxElevM] : undefined}
          landCoverStats={metadata?.landCoverStats}
          scourStats={metadata?.scourStats}
        />
      </TopHud>

      {activeTool && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-16 z-19 inline-flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-full bg-[#161c1a] px-4 py-2 text-[12.5px] font-semibold text-white shadow-xl max-md:top-14 max-md:left-1/2 max-md:px-3 max-md:py-1.5 ${
            sidebarCollapsed ? 'left-1/2' : 'left-[calc(50%+188px)]'
          }`}
        >
          <span>{bannerMessage}</span>
          {(activeTool === 'drawWaterway' || activeTool === 'redrawWaterway' || activeTool === 'drawJorong') && (
            <button
              type="button"
              onClick={() => editor.finishDrawing(drawVertices)}
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
        layers={effectiveLayers}
        flowDensity={flowDensity}
        simProgress={sim.simProgress}
        drainFilter={drainFilter}
        elevRange={metadata ? [metadata.minElevM, metadata.maxElevM] : undefined}
        landCoverStats={metadata?.landCoverStats}
        scourStats={metadata?.scourStats}
        mobileSheetMode={mobileSheetMode}
        cursorTelemetry={cursorTelemetry}
        mapCamera={mapCamera}
        onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
        onToggleSimVerifiedWaterways={sim.setSimShowVerifiedWaterways}
        onToggleSimRbiRivers={sim.setSimShowRbiRivers}
        onChangeFlowDensity={setFlowDensity}
        onZoomIn={() => mapControlRef.current?.zoomIn()}
        onZoomOut={() => mapControlRef.current?.zoomOut()}
        onResetNorth={() => mapControlRef.current?.resetNorth()}
        onOpenSources={() => setInfoModalTab('api')}
      />

      <FeedbackModal
        open={feedbackOpen}
        lang={lang}
        apiAvailable={editor.apiAvailable}
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
        open={infoModalTab !== null}
        initialTab={infoModalTab ?? 'guide'}
        lang={lang}
        metadata={metadata}
        verifiedCount={editor.verifiedWaterways.length}
        onClose={() => setInfoModalTab(null)}
      />

      <EditorUnlockModal
        open={editor.unlockModalOpen}
        lang={lang}
        requiresPassphrase={editor.requiresPassphrase}
        actorName={editor.actorName}
        onClose={() => editor.setUnlockModalOpen(false)}
        onUnlocked={(pass, nextActor) => {
          saveStoredPassphrase(pass);
          saveEditorName(nextActor);
          editor.setActorName(nextActor);
          editor.setEditorUnlocked(true);
          notify(lang === 'en' ? 'Editor Mode unlocked.' : 'Mode Editor berhasil dibuka.');
        }}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed z-60 max-w-[92vw] -translate-x-1/2 rounded-xl bg-[#161c1a] px-4 py-2.5 text-[13px] font-semibold text-white shadow-xl max-md:top-14 max-md:left-1/2 ${
            activeTool ? 'top-28' : 'top-16'
          } ${sidebarCollapsed ? 'left-1/2' : 'left-[calc(50%+188px)]'}`}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
export default App;
