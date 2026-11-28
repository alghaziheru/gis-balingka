import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  CloudRain,
  Droplets,
  MapPin,
  Menu,
  Mountain,
  Wrench
} from 'lucide-react';
import { ActiveMapLegend } from './components/ActiveMapLegend';
import { BrandMark } from './components/BrandMark';
import { DrainageTab } from './components/DrainageTab';
import { EditorTab } from './components/EditorTab';
import { EditorUnlockModal } from './components/EditorUnlockModal';
import { ElevationProfileModal } from './components/ElevationProfileModal';
import { FeedbackModal } from './components/FeedbackModal';
import { InfoDataModal, type InfoModalTab } from './components/InfoDataModal';
import { MapLoadingOverlay } from './components/MapLoadingOverlay';
import { MapView, type FlyRequest, type MapCameraState, type MapControlHandle, type MapLoadState } from './components/MapView';
import { RainOverlay } from './components/RainOverlay';
import { SimulationDisclaimerModal } from './components/SimulationDisclaimerModal';
import { SidebarSkeleton } from './components/SidebarSkeleton';
import { SimTimelineDock } from './components/SimTimelineDock';
import { SimulationTab } from './components/SimulationTab';
import { TelemetryDock } from './components/TelemetryDock';
import { TerrainTab } from './components/TerrainTab';
import { TopHud } from './components/TopHud';
import {
  DEFAULT_REGION_ID,
  getRegionById,
  getRegionDataBasePath,
  groupRegionsByDistrict,
  isValidRegionId,
  REGIONS
} from './config/region';
import { RegionContext } from './context/RegionContext';
import { useEditorActions } from './hooks/useEditorActions';
import { useRegionDatasets, type CursorTelemetry } from './hooks/useRegionDatasets';
import { useSimulationController } from './hooks/useSimulationController';
import { getTranslations } from './i18n/translations';
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
const LAST_REGION_KEY = 'peta_alur_air_last_region_v1';
const SIM_DISCLAIMER_SESSION_KEY = 'balingka_sim_disclaimer_session_v1';
const SIM_DISCLAIMER_HIDE_KEY = 'balingka_sim_disclaimer_hide_v1';

function makeInitialMapLoadState(basemap: BasemapId): MapLoadState {
  return {
    styleReady: false,
    initialTilesReady: false,
    initialTimedOut: false,
    tileProgress: 0,
    basemapSwitching: false,
    basemapTimedOut: false,
    activeBasemap: basemap
  };
}

function getRegionIdFromUrlOnly(): string {
  if (typeof window === 'undefined') return DEFAULT_REGION_ID;
  const param = new URLSearchParams(window.location.search).get('region');
  return isValidRegionId(param) ? param! : DEFAULT_REGION_ID;
}

function getInitialRegionId(): string {
  if (typeof window === 'undefined') return DEFAULT_REGION_ID;
  const param = new URLSearchParams(window.location.search).get('region');
  if (isValidRegionId(param)) return param!;
  try {
    const saved = window.localStorage.getItem(LAST_REGION_KEY);
    if (isValidRegionId(saved)) return saved!;
  } catch {
    // ignore storage failures
  }
  return DEFAULT_REGION_ID;
}

const REGION_GROUPS = groupRegionsByDistrict(REGIONS);

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
  const [activeRegionId, setActiveRegionId] = useState<string>(() => getInitialRegionId());
  const activeRegion = useMemo(() => getRegionById(activeRegionId), [activeRegionId]);
  const dataBasePath = useMemo(() => getRegionDataBasePath(activeRegion), [activeRegion]);

  const [lang, setLang] = useState<Language>('id');
  const [viewMode, setViewMode] = useState<ViewMode>('simple');
  const [tab, setTab] = useState<TabId>('terrain');
  const [is3D, setIs3D] = useState(true);
  const [basemap, setBasemap] = useState<BasemapId>('sat');
  const [cameraPreset, setCameraPreset] = useState('center');
  const [exaggeration, setExaggeration] = useState(1.35);
  const [flowDensity, setFlowDensity] = useState(DEFAULT_FLOW_DENSITY);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const preSimBasemapRef = useRef<BasemapId>('sat');
  const tabRef = useRef<TabId>(tab);
  tabRef.current = tab;
  const basemapRef = useRef<BasemapId>(basemap);
  basemapRef.current = basemap;
  const [mobileSheetMode, setMobileSheetMode] = useState<'peek' | 'half' | 'full'>('peek');
  const [infoModalTab, setInfoModalTab] = useState<InfoModalTab | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [simDisclaimerOpen, setSimDisclaimerOpen] = useState(false);
  const prevTabBeforeSimRef = useRef<TabId>('terrain');
  const simPauseRef = useRef<() => void>(() => {});
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
    zoom: activeRegion.defaultView.zoom,
    bearing: activeRegion.cameraPresets[0]?.bearing3D ?? -12,
    pitch: activeRegion.cameraPresets[0]?.pitch3D ?? 36,
    metersPerPixel: 3.15
  });
  const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetry>({
    lng: activeRegion.defaultView.center[0],
    lat: activeRegion.defaultView.center[1],
    elev: 1089,
    slope: 8
  });

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [mapLoad, setMapLoad] = useState<MapLoadState>(() => makeInitialMapLoadState(basemap));

  const t = useMemo(() => getTranslations(activeRegion)[lang], [activeRegion, lang]);

  useEffect(() => {
    document.title = `${t.brandName} — ${activeRegion.name}`;
  }, [t.brandName, activeRegion.name]);

  useEffect(() => {
    const onPopState = () => {
      setActiveRegionId(getRegionIdFromUrlOnly());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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

  const {
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
  } = useRegionDatasets(activeRegion);

  useEffect(() => {
    setMapLoad(makeInitialMapLoadState(basemapRef.current));
  }, [activeRegionId]);

  const handleRetryLoad = useCallback(() => {
    setMapLoad(makeInitialMapLoadState(basemapRef.current));
    retryLoad();
  }, [retryLoad]);

  useEffect(() => {
    if (initialTelemetry) {
      setCursorTelemetry(initialTelemetry);
    }
  }, [initialTelemetry]);

  const handleTabChange = useCallback(
    (nextTabOrUpdater: SetStateAction<TabId>) => {
      const prevTab = tabRef.current;
      const nextTab = typeof nextTabOrUpdater === 'function' ? nextTabOrUpdater(prevTab) : nextTabOrUpdater;
      if (nextTab === prevTab) return;
      if (prevTab !== 'sim' && nextTab === 'sim') {
        preSimBasemapRef.current = basemapRef.current;
        setBasemap('elev');
        let seen = false;
        try {
          seen =
            window.sessionStorage.getItem(SIM_DISCLAIMER_SESSION_KEY) === '1' ||
            window.localStorage.getItem(SIM_DISCLAIMER_HIDE_KEY) === '1';
        } catch {
          seen = false;
        }
        if (!seen) {
          prevTabBeforeSimRef.current = prevTab;
          simPauseRef.current();
          setSimDisclaimerOpen(true);
        }
      } else if (prevTab === 'sim' && nextTab !== 'sim') {
        const saved = preSimBasemapRef.current;
        setBasemap(viewMode === 'simple' && saved !== 'sat' && saved !== 'osm' ? 'sat' : saved);
      }
      setTab(nextTab);
    },
    [viewMode]
  );

  const editor = useEditorActions({
    region: activeRegion,
    datasets,
    demClient,
    lang,
    activeTool,
    setActiveTool,
    setDrawVertices,
    setViewMode,
    setTab: handleTabChange,
    notify,
    flyTo,
    reloadHydrologyData
  });

  const sim = useSimulationController({
    simFields,
    settlements: datasets?.settlements,
    metadata,
    climateBaseline,
    region: activeRegion,
    calibrationMarks: editor.calibrationMarks,
    calibrationProfile: editor.calibrationProfile,
    verifiedWaterways: editor.verifiedWaterways
  });
  simPauseRef.current = () => sim.setSimPlaying(false);

  const handleSelectRegion = useCallback(
    (nextId: string) => {
      if (nextId === activeRegionId || !isValidRegionId(nextId)) return;
      const nextRegion = getRegionById(nextId);
      const url = new URL(window.location.href);
      if (nextId === DEFAULT_REGION_ID) url.searchParams.delete('region');
      else url.searchParams.set('region', nextId);
      window.history.pushState(null, '', url.toString());
      try {
        window.localStorage.setItem(LAST_REGION_KEY, nextId);
      } catch {
        // ignore storage failures
      }

      setActiveRegionId(nextId);
      setCameraPreset('center');
      setRaindrop(null);
      setProfilePts([]);
      setProfileResult(null);
      setProfileHover(null);
      setActiveTool(null);
      setDrawVertices([]);
      setDrainFilter('all');
      setSimDisclaimerOpen(false);
      sim.resetSim();
      const preset0 = nextRegion.cameraPresets[0];
      setMapCamera(prev => ({
        ...prev,
        zoom: nextRegion.defaultView.zoom,
        pitch: is3D ? (preset0?.pitch3D ?? 36) : 0,
        bearing: is3D ? (preset0?.bearing3D ?? -12) : 0
      }));
    },
    [activeRegionId, is3D, sim]
  );

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
      if (tab === 'sim') {
        if (basemap !== 'relief' && basemap !== 'elev') {
          setBasemap('elev');
        }
      } else if (basemap !== 'sat' && basemap !== 'osm') {
        setBasemap('sat');
      }
      if (tab === 'editor') {
        handleTabChange('terrain');
      }
      sim.resetForSimpleMode();
      editor.resetEditorForSimpleMode();
      if (activeTool) {
        setActiveTool(null);
        setDrawVertices([]);
      }
    }
  };

  const allowedSimBasemaps: BasemapId[] = useMemo(
    () => (viewMode === 'detail' ? ['relief', 'elev', 'slope'] : ['relief', 'elev']),
    [viewMode]
  );

  const effectiveBasemap: BasemapId =
    tab === 'sim' ? (allowedSimBasemaps.includes(basemap) ? basemap : 'elev') : basemap;

  const handleChangeBasemap = useCallback(
    (next: BasemapId) => {
      if (tab === 'sim' && !allowedSimBasemaps.includes(next)) {
        return;
      }
      setBasemap(next);
    },
    [tab, allowedSimBasemaps]
  );

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
        openingWidthM: null,
        openingHeightM: null,
        defaultBlockagePct: null,
        notes: '',
        coordinates: lngLat
      });
      setActiveTool(null);
    } else if (activeTool === 'placeStormCore') {
      sim.setStormCore(lngLat);
      sim.setRainPattern('storm_core');
      setActiveTool(null);
      notify(lang === 'en' ? 'Localized storm core placed (~2.4 km).' : 'Pusat badai lokal diletakkan (~2,4 km).');
    } else if (activeTool === 'placeCalibrationMark') {
      editor.setEditingCalibrationMark({
        id: null,
        name: '',
        kind: 'hwm',
        observedDepthM: 0.8,
        rainMmHr: sim.simRain,
        durationMin: sim.simDurationMin,
        antecedent5dMm: sim.antecedent5dMm,
        notes: '',
        coordinates: lngLat
      });
      setActiveTool(null);
    }
  };

  const handleCameraPreset = (preset: string) => {
    setCameraPreset(preset);
    const match = activeRegion.cameraPresets.find(p => p.id === preset);
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
    if (activeTool === 'placeStormCore') return t.bannerPlaceStormCore;
    if (activeTool === 'placeCalibrationMark') return t.bannerPlaceCalibrationMark;
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
            verifiedWaterways: sim.simShowWaterways,
            agamRbiRivers: sim.simShowWaterways,
            osmContext: sim.simShowOsmRoads
          }
        : layers,
    [tab, layers, sim.simShowWaterways, sim.simShowOsmRoads]
  );

  const effectiveFlowDensity = tab === 'sim' ? 0 : flowDensity;

  const mobileHeightClass =
    mobileSheetMode === 'full'
      ? 'max-md:h-[82vh]'
      : mobileSheetMode === 'half'
      ? 'max-md:h-[52vh]'
      : 'max-md:h-[126px]';

  return (
    <RegionContext.Provider value={activeRegion}>
      <div className={`relative h-screen w-screen overflow-hidden ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {datasets && demClient ? (
          <MapView
            key={activeRegion.id}
            region={activeRegion}
            dataBasePath={dataBasePath}
            datasets={datasets}
          demClient={demClient}
          lang={lang}
          viewMode={viewMode}
          tab={tab}
          is3D={is3D}
          basemap={effectiveBasemap}
          exaggeration={exaggeration}
          layers={effectiveLayers}
          flowDensity={effectiveFlowDensity}
          activeTool={activeTool}
          simRain={sim.simRain}
          simDurationMin={sim.simDurationMin}
          simProgress={sim.simProgress}
          liveElapsedMin={sim.liveElapsedMin}
          simPlaying={sim.simPlaying}
          playbackSpeed={sim.playbackSpeed}
          uplandBbox={sim.uplandBbox}
          liveRainMmHr={sim.liveRainMmHr}
          meanSedimentCv={sim.cascadeKpis.meanSedimentCv}
          isRecession={sim.liveIsRecession}
          simScenario={sim.drainCondition === 'cleared' ? 'cleared' : 'clogged'}
          rainAnimEnabled={sim.rainAnimEnabled}
          simMapViewMode={sim.simMapViewMode}
          cascadeEngine={sim.cascadeEngine}
          playbackGridsRef={sim.playbackGridsRef}
          cascadeParams={sim.cascadeParams}
          drainFilter={drainFilter}
          raindrop={raindrop}
          profilePts={profilePts}
          profileHover={profileHover}
          verifiedWaterways={editor.verifiedWaterways}
          verifiedStructures={editor.verifiedStructures}
          jorongBoundaries={editor.jorongBoundaries}
          calibrationMarks={editor.calibrationMarks}
          suppressedDemIds={editor.suppressedDemIds}
          dataVersion={editor.dataVersion}
          editorHydrated={editor.editorHydrated}
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
          onSetStructureBlockageOverride={sim.setStructureBlockageOverride}
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
          onLoadStateChange={setMapLoad}
        />
      ) : (
        <div className="h-full w-full bg-[#e8ebe7]" />
      )}

      {/* Falling Rain Animation Overlay during Simulation */}
      <RainOverlay
        active={tab === 'sim' && sim.rainAnimEnabled && sim.simProgress > 0.02}
        playing={sim.simPlaying}
        playbackSpeed={sim.playbackSpeed}
        intensityMmHr={sim.simRain}
        liveRainMmHr={sim.liveRainMmHr}
        basemap={effectiveBasemap}
        rainPattern={sim.rainPattern}
        uplandBbox={sim.uplandBbox}
        stormCore={sim.stormCore}
        isRecession={sim.liveIsRecession}
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

        <header className="shrink-0 border-b border-[#161c1a]/12 bg-white px-4 py-3 max-md:px-3 max-md:py-2">
          <div className="flex flex-col gap-2 max-md:flex-row max-md:items-center max-md:justify-between max-md:gap-2">
            <div className="flex min-w-0 items-center justify-between gap-2 max-md:shrink-0">
              <div className="flex min-w-0 items-center gap-2.5 max-md:gap-2">
                <div className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-[10px] bg-[#0369a1] text-white max-md:h-7 max-md:w-7 max-md:rounded-[8px]">
                  <BrandMark className="h-5 w-5 max-md:h-4 max-md:w-4" />
                </div>
                <div className="min-w-0">
                  <h1 className="m-0 truncate text-[16px] leading-tight font-extrabold tracking-tight text-[#161c1a] max-md:text-[14.5px]">
                    {t.brandName}
                  </h1>
                  <div className="mt-0.5 truncate text-[11.5px] font-medium text-[#636f6a] max-md:hidden">
                    {t.brandTagline}
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

            <div className="relative flex min-w-0 items-center gap-2 rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] px-2.5 py-1.5 transition focus-within:border-[#0369a1] focus-within:bg-white hover:border-[#161c1a]/22 max-md:max-w-[54%] max-md:rounded-lg max-md:px-2 max-md:py-1">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-[#0369a1]" />
              <div className="min-w-0 flex-1">
                <select
                  data-testid="region-select"
                  aria-label={lang === 'en' ? 'Select region' : 'Pilih wilayah'}
                  value={activeRegionId}
                  onChange={e => handleSelectRegion(e.target.value)}
                  className="w-full cursor-pointer appearance-none truncate bg-transparent pr-5 text-[13px] leading-tight font-bold text-[#161c1a] focus:outline-none max-md:text-[12px]"
                >
                  {REGION_GROUPS.map(grp => (
                    <optgroup key={`${grp.district}-${grp.regency}`} label={`${grp.district}, ${grp.regency}`}>
                      {grp.regions.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="mt-0.5 truncate text-[11px] font-medium text-[#636f6a] max-md:hidden">
                  {t.subtitle}
                </div>
              </div>
              <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 shrink-0 text-[#0369a1] max-md:right-1.5" />
            </div>
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
                  handleTabChange(id);
                  if (activeTool) {
                    setActiveTool(null);
                    setDrawVertices([]);
                  }
                  if (id !== 'sim') {
                    sim.setSimPlaying(false);
                  }
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
          {!datasets || !demClient ? (
            <SidebarSkeleton lang={lang} loadError={loadError} onRetry={handleRetryLoad} />
          ) : (
            <>
          {tab === 'terrain' && (
            <TerrainTab
              lang={lang}
              viewMode={viewMode}
              layers={layers}
              exaggeration={exaggeration}
              flowDensity={flowDensity}
              activeTool={activeTool}
              raindrop={raindrop}
              studyAreaKm2={metadata?.studyAreaKm2 || activeRegion.areaKm2}
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
              playbackSpeed={sim.playbackSpeed}
              rainMm={sim.simRain}
              durationMin={sim.simDurationMin}
              progress={sim.simProgress}
              liveElapsedMin={sim.liveElapsedMin}
              liveRainMmHr={sim.liveRainMmHr}
              isRecession={sim.liveIsRecession}
              soilMoisture={sim.soilMoisture}
              antecedent5dMm={sim.antecedent5dMm}
              rainPattern={sim.rainPattern}
              drainCondition={sim.drainCondition}
              culvertBlockagePct={sim.culvertBlockagePct}
              structureBlockageOverrides={sim.structureBlockageOverrides}
              forestScenario={sim.forestScenario}
              hyetograph={sim.hyetograph}
              orographicPctPerKm={sim.orographicPctPerKm}
              stormCore={sim.stormCore}
              debrisCoupling={sim.debrisCoupling}
              simMapViewMode={sim.simMapViewMode}
              isPlacingStormCore={activeTool === 'placeStormCore'}
              forestActualPct={metadata?.landCoverStats?.forestPct ?? 74}
              rainAnimEnabled={sim.rainAnimEnabled}
              showWaterways={sim.simShowWaterways}
              showOsmRoads={sim.simShowOsmRoads}
              verifiedIssueCount={editor.verifiedIssueCount}
              verifiedWaterways={editor.verifiedWaterways}
              simNetwork={simFields?.network ?? null}
              cascadeParams={sim.cascadeParams}
              routedNominal={sim.cascadeEngine?.getLastRoutedNominal() ?? null}
              hasCalibrationProfile={Boolean(editor.calibrationProfile)}
              climateBaseline={climateBaseline}
              demClient={demClient}
              agamStats={metadata?.agamStats}
              kpis={sim.cascadeKpis}
              onTogglePlay={sim.togglePlay}
              onResetSim={sim.resetSim}
              onChangeProgress={sim.changeProgress}
              onChangeSpeed={sim.setPlaybackSpeed}
              onChangeRain={sim.setSimRain}
              onChangeDuration={sim.setSimDurationMin}
              onChangeSoilMoisture={sim.setSoilMoisture}
              onChangeAntecedent5dMm={sim.setAntecedent5dMm}
              onChangeRainPattern={sim.setRainPattern}
              onChangeDrainCondition={sim.setDrainCondition}
              onChangeCulvertBlockagePct={sim.setCulvertBlockagePct}
              onClearStructureBlockageOverrides={sim.clearStructureBlockageOverrides}
              onChangeForestScenario={sim.setForestScenario}
              onChangeHyetograph={sim.setHyetograph}
              onChangeOrographicPctPerKm={sim.setOrographicPctPerKm}
              onTogglePlaceStormCore={() =>
                setActiveTool(prev => (prev === 'placeStormCore' ? null : 'placeStormCore'))
              }
              onClearStormCore={() => {
                sim.setStormCore(null);
                if (sim.rainPattern === 'storm_core') sim.setRainPattern('uniform');
              }}
              onChangeDebrisCoupling={sim.setDebrisCoupling}
              onChangeSimMapViewMode={sim.setSimMapViewMode}
              onApplyPreset={preset => sim.applyPreset(preset, viewMode)}
              onToggleRainAnim={sim.setRainAnimEnabled}
              onToggleWaterways={sim.setSimShowWaterways}
              onToggleOsmRoads={sim.setSimShowOsmRoads}
              onOpenMethodology={() => setInfoModalTab('method')}
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
                const v = activeRegion.drainageFocus.upland;
                flyTo(v.center, { zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
              }}
              onFocusDrainage={() => {
                setDrainFilter('all');
                const v = activeRegion.drainageFocus.culverts;
                flyTo(v.center, { zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
              }}
              onFocusEvac={() => {
                setLayers(prev => ({ ...prev, evac: true }));
                const v = activeRegion.drainageFocus.facilities;
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
              calibrationMarks={editor.calibrationMarks}
              calibrationProfile={editor.calibrationProfile}
              validationMetrics={sim.cascadeKpis.validation}
              cascadeEngine={sim.cascadeEngine}
              simNetwork={simFields?.network ?? null}
              suppressedDem={editor.suppressedDem}
              editingWaterway={editor.editingWaterway}
              editingStructure={editor.editingStructure}
              editingJorong={editor.editingJorong}
              editingCalibrationMark={editor.editingCalibrationMark}
              hydroStatus={editor.hydroStatus}
              recomputingHydro={editor.recomputingHydro}
              auditLogs={editor.auditLogs}
              {...editor.editorTabActions}
            />
          )}
            </>
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
        tab={tab}
        is3D={is3D}
        basemap={effectiveBasemap}
        onChangeViewMode={handleChangeViewMode}
        onToggle3D={setIs3D}
        onChangeBasemap={handleChangeBasemap}
        onChangeLang={setLang}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenInfo={() => setInfoModalTab('guide')}
      >
        {tab === 'sim' &&
          sim.rainAnimEnabled &&
          sim.simProgress > 0.01 &&
          !sim.cascadeKpis.isRecession &&
          (sim.rainPattern === 'upland' || (sim.rainPattern === 'storm_core' && Boolean(sim.stormCore))) && (
            <div
              data-testid="upland-rain-pill"
              className="surface-panel pointer-events-none relative z-10 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] leading-none font-bold text-[#0369a1] max-md:hidden"
            >
              <CloudRain className="h-3.5 w-3.5 shrink-0" />
              <span>{sim.rainPattern === 'storm_core' ? t.stormCoreRainPill : t.uplandRainPill}</span>
            </div>
          )}

        <ActiveMapLegend
          lang={lang}
          viewMode={viewMode}
          tab={tab}
          basemap={effectiveBasemap}
          layers={effectiveLayers}
          flowDensity={effectiveFlowDensity}
          simProgress={sim.simProgress}
          simMapViewMode={sim.simMapViewMode}
          rainPattern={sim.rainPattern}
          stormCore={sim.stormCore}
          drainFilter={drainFilter}
          elevRange={metadata ? [metadata.minElevM, metadata.maxElevM] : undefined}
          landCoverStats={metadata?.landCoverStats}
          scourStats={metadata?.scourStats}
        />
      </TopHud>

      {tab === 'sim' && datasets && demClient && (
        <SimTimelineDock
          lang={lang}
          playing={sim.simPlaying}
          playbackSpeed={sim.playbackSpeed}
          progress={sim.simProgress}
          liveElapsedMin={sim.liveElapsedMin}
          mobileSheetMode={mobileSheetMode}
          onTogglePlay={sim.togglePlay}
          onResetSim={sim.resetSim}
          onChangeProgress={sim.changeProgress}
          onChangeSpeed={sim.setPlaybackSpeed}
        />
      )}

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
        basemap={effectiveBasemap}
        layers={effectiveLayers}
        flowDensity={effectiveFlowDensity}
        simProgress={sim.simProgress}
        drainFilter={drainFilter}
        elevRange={metadata ? [metadata.minElevM, metadata.maxElevM] : undefined}
        landCoverStats={metadata?.landCoverStats}
        scourStats={metadata?.scourStats}
        mobileSheetMode={mobileSheetMode}
        cursorTelemetry={cursorTelemetry}
        mapCamera={mapCamera}
        onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
        onToggleSimWaterways={sim.setSimShowWaterways}
        onToggleSimOsmRoads={sim.setSimShowOsmRoads}
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
            await createSuggestion(
              {
                reporter_name: payload.name || (lang === 'en' ? 'Anonymous' : 'Anonim'),
                contact: '',
                category: payload.topic,
                location_name: `General Web Feedback (${activeRegion.name})`,
                message: payload.message,
                lng: null,
                lat: null
              },
              activeRegionId
            );
            notify(t.feedbackSentToast);
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Failed to send feedback');
          }
        }}
        onClose={() => setFeedbackOpen(false)}
      />

      <SimulationDisclaimerModal
        open={simDisclaimerOpen}
        lang={lang}
        climateBaseline={climateBaseline}
        onConfirm={dontShowAgain => {
          try {
            window.sessionStorage.setItem(SIM_DISCLAIMER_SESSION_KEY, '1');
            if (dontShowAgain) window.localStorage.setItem(SIM_DISCLAIMER_HIDE_KEY, '1');
          } catch {
            // ignore storage errors
          }
          setSimDisclaimerOpen(false);
        }}
        onCancel={() => {
          setSimDisclaimerOpen(false);
          handleTabChange(prevTabBeforeSimRef.current);
        }}
        onOpenSources={() => {
          try {
            window.sessionStorage.setItem(SIM_DISCLAIMER_SESSION_KEY, '1');
          } catch {
            // ignore storage errors
          }
          setSimDisclaimerOpen(false);
          setInfoModalTab('method');
        }}
      />

      <InfoDataModal
        open={infoModalTab !== null}
        initialTab={infoModalTab ?? 'guide'}
        lang={lang}
        metadata={metadata}
        climateBaseline={climateBaseline}
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

      <MapLoadingOverlay
        lang={lang}
        regionName={activeRegion.name}
        sidebarCollapsed={sidebarCollapsed}
        datasetProgress={datasetProgress}
        loadError={loadError}
        editorHydrated={editor.editorHydrated}
        mapLoad={mapLoad}
        basemapLabel={
          basemap === 'sat'
            ? t.bmSat
            : basemap === 'osm'
            ? t.bmOsm
            : basemap === 'topo'
            ? t.bmTopo
            : basemap === 'elev'
            ? t.bmElev
            : basemap === 'relief'
            ? t.bmRelief
            : t.bmSlope
        }
        onRetry={handleRetryLoad}
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
    </RegionContext.Provider>
  );
}
export default App;
