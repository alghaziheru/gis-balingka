import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Droplets,
  MapPin,
  Menu,
  Mountain,
  Wrench
} from 'lucide-react';
import { DrainageTab } from './components/DrainageTab';
import { EditorTab, type EditorSubTab } from './components/EditorTab';
import { EditorUnlockModal } from './components/EditorUnlockModal';
import { ElevationProfileModal } from './components/ElevationProfileModal';
import { FeedbackModal } from './components/FeedbackModal';
import { InfoDataModal, type InfoModalTab } from './components/InfoDataModal';
import { MapView, type FlyRequest, type LoadedDatasets, type MapCameraState, type MapControlHandle } from './components/MapView';
import { RainOverlay } from './components/RainOverlay';
import { SimulationTab } from './components/SimulationTab';
import { TelemetryDock } from './components/TelemetryDock';
import { TerrainTab } from './components/TerrainTab';
import { TopHud } from './components/TopHud';
import type { ActiveEditingJorong } from './components/JorongEditorPanel';
import type { ActiveEditingStructure } from './components/StructureEditorPanel';
import type { ActiveEditingWaterway } from './components/WaterwayEditorPanel';
import { I18N } from './i18n/translations';
import {
  createJorongBoundary,
  createStructure,
  createSuggestion,
  createWaterway,
  deleteJorongBoundary,
  deleteStructure,
  deleteWaterway,
  fetchAuditLogs,
  fetchEditorStatus,
  fetchStaticVerifiedSeed,
  fetchWaterwaysState,
  loadEditorName,
  loadStoredPassphrase,
  recomputeHydrology,
  restoreDemSegment,
  revertAuditLog,
  saveEditorName,
  saveStoredPassphrase,
  suppressDemSegment,
  updateJorongBoundary,
  updateStructure,
  updateWaterway,
  verifyEditorPassphrase
} from './lib/api';
import { CascadeEngine, extractBuildingCentroids } from './lib/cascadeEngine';
import { DemClient } from './lib/demClient';
import { haversineMeters, orientCoordinatesDownhill } from './lib/geometry';
import type {
  ActiveTool,
  AuditLogEntry,
  BasemapId,
  CascadeKpis,
  CascadeSimParams,
  DatasetMetadata,
  DemGridData,
  DrainageStatus,
  DrainCondition,
  ElevationProfileResult,
  ForestScenario,
  HydroStatus,
  JorongBoundaryFeature,
  Language,
  LayerToggles,
  ProfileSample,
  RaindropTrace,
  RainPattern,
  SimFieldsData,
  SoilMoisture,
  SuppressedDemSegment,
  TabId,
  VerifiedStructureFeature,
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
  const [flowDensity, setFlowDensity] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSheetMode, setMobileSheetMode] = useState<'peek' | 'half' | 'full'>('peek');
  const [infoModalTab, setInfoModalTab] = useState<InfoModalTab | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const [layers, setLayers] = useState<LayerToggles>({
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
  });

  const [datasets, setDatasets] = useState<LoadedDatasets | null>(null);
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);
  const [demClient, setDemClient] = useState<DemClient | null>(null);
  const [simFields, setSimFields] = useState<SimFieldsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [raindrop, setRaindrop] = useState<RaindropTrace | null>(null);
  const [profilePts, setProfilePts] = useState<[number, number][]>([]);
  const [profileResult, setProfileResult] = useState<ElevationProfileResult | null>(null);
  const [profileHover, setProfileHover] = useState<ProfileSample | null>(null);

  // Interactive Rainfall -> Galodo Cascade Simulator (calm 00:00 dry start)
  const [simPlaying, setSimPlaying] = useState(false);
  const [simRain, setSimRain] = useState(45);
  const [simDurationMin, setSimDurationMin] = useState(120);
  const [simProgress, setSimProgress] = useState(0);
  const [soilMoisture, setSoilMoisture] = useState<SoilMoisture>('moist');
  const [rainPattern, setRainPattern] = useState<RainPattern>('uniform');
  const [drainCondition, setDrainCondition] = useState<DrainCondition>('clogged');
  const [forestScenario, setForestScenario] = useState<ForestScenario>('actual');
  const [rainAnimEnabled, setRainAnimEnabled] = useState(true);

  const [drainFilter, setDrainFilter] = useState<'all' | DrainageStatus>('all');
  const [drawVertices, setDrawVertices] = useState<[number, number][]>([]);

  const [editorSubTab, setEditorSubTab] = useState<EditorSubTab>('waterways');
  const [apiAvailable, setApiAvailable] = useState(false);
  const [requiresPassphrase, setRequiresPassphrase] = useState(false);
  const [editorUnlocked, setEditorUnlocked] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [actorName, setActorName] = useState(() => loadEditorName());
  const [verifiedWaterways, setVerifiedWaterways] = useState<VerifiedWaterwayFeature[]>([]);
  const [verifiedStructures, setVerifiedStructures] = useState<VerifiedStructureFeature[]>([]);
  const [jorongBoundaries, setJorongBoundaries] = useState<JorongBoundaryFeature[]>([]);
  const [suppressedDem, setSuppressedDem] = useState<SuppressedDemSegment[]>([]);
  const [editingWaterway, setEditingWaterway] = useState<ActiveEditingWaterway | null>(null);
  const [editingStructure, setEditingStructure] = useState<ActiveEditingStructure | null>(null);
  const [editingJorong, setEditingJorong] = useState<ActiveEditingJorong | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [hydroStatus, setHydroStatus] = useState<HydroStatus>({
    dirty: false,
    lastRecomputedAt: null,
    burnedCellCount: 0,
    verifiedWaterwayCount: 0
  });
  const [recomputingHydro, setRecomputingHydro] = useState(false);

  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null);
  const flyCounter = useRef(0);
  const mapControlRef = useRef<MapControlHandle | null>(null);
  const [mapCamera, setMapCamera] = useState<MapCameraState>({
    zoom: 13.6,
    bearing: -12,
    pitch: 36,
    metersPerPixel: 12.6
  });
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
        const [metaRes, demRes, maskRes, wsRes, nbRes, stRes, cntRes, flRes, osmRes, drnRes, sfRes, rbiRes, agamCtxRes] = await Promise.all([
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
          fetch('/data/agam-context.json')
        ]);

        if (!metaRes.ok || !demRes.ok) {
          throw new Error('Failed to load geospatial datasets from /data/');
        }

        const emptyFc = { type: 'FeatureCollection' as const, features: [] };
        const [meta, demGrid, mask, watershed, nagariBoundary, settlements, contours, flowPaths, osmContext, drainageDraft, sfData, agamRbiRivers, agamContext] =
          await Promise.all([
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
            agamCtxRes.ok ? agamCtxRes.json() : Promise.resolve(null)
          ]);

        if (cancelled) return;
        const m = meta as DatasetMetadata;
        const client = new DemClient(demGrid as DemGridData);
        setMetadata(m);
        setDemClient(client);
        setSimFields(sfData as SimFieldsData | null);
        setDatasets({
          bbox: m.bbox,
          center: m.center,
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
            setVerifiedStructures(wwState.structures);
            setJorongBoundaries(wwState.jorongBoundaries);
            setSuppressedDem(wwState.suppressedDem);
            setHydroStatus(wwState.hydroStatus);
            setAuditLogs(logs);
          }
        } else {
          setApiAvailable(false);
          const staticSeed = await fetchStaticVerifiedSeed(osmContext);
          if (!cancelled) {
            setVerifiedWaterways(staticSeed.waterways);
            setVerifiedStructures(staticSeed.structures);
            setSuppressedDem(staticSeed.suppressedDem);
          }
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

  const buildingCentroids = useMemo(
    () => extractBuildingCentroids(datasets?.settlements),
    [datasets?.settlements]
  );

  const cascadeEngine = useMemo(() => {
    if (!simFields) return null;
    const totalCrossings = (metadata?.crossingsDetected || 0) + (metadata?.bridgesDetected || 0) || 34;
    return new CascadeEngine(simFields, buildingCentroids, totalCrossings);
  }, [simFields, buildingCentroids, metadata?.crossingsDetected, metadata?.bridgesDetected]);

  const cascadeParams: CascadeSimParams = useMemo(
    () => ({
      rainMmHr: simRain,
      durationMin: simDurationMin,
      progress: simProgress,
      soilMoisture,
      rainPattern,
      drainCondition,
      forestScenario
    }),
    [simRain, simDurationMin, simProgress, soilMoisture, rainPattern, drainCondition, forestScenario]
  );

  const cascadeKpis: CascadeKpis = useMemo(() => {
    if (cascadeEngine) {
      return cascadeEngine.evaluate(cascadeParams);
    }
    const elapsedMin = simDurationMin * simProgress;
    const accumulatedMm = simRain * (elapsedMin / 60);
    return {
      stage: simProgress <= 0.02 ? 0 : simProgress <= 0.25 ? 1 : simProgress <= 0.55 ? 2 : simProgress <= 0.82 ? 3 : 4,
      alertLevel: 'normal',
      elapsedMin,
      accumulatedMm,
      effectiveRunoffMm: 0,
      floodAreaHa: 0,
      landslideAreaHa: 0,
      affectedBuildingsFlood: 0,
      affectedBuildingsLandslide: 0,
      chokeCount: 0,
      reductionPct: 0,
      peakTravelMin: 75,
      runoffIndex: 0,
      officialLandslideOverlapPct: 0
    };
  }, [cascadeEngine, cascadeParams, simRain, simDurationMin, simProgress]);

  const verifiedIssueCount = useMemo(
    () => verifiedStructures.filter(s => ['clogged', 'damaged', 'critical'].includes(s.properties.status)).length,
    [verifiedStructures]
  );

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
      verifiedStructures.map(s => s.properties.source_ref).filter(Boolean).map(String)
    );
    for (const s of verifiedStructures) {
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
          if (verifiedStructures.some(s => haversineMeters(fc[0], fc[1], s.geometry.coordinates[0], s.geometry.coordinates[1]) <= 45)) {
            continue;
          }
        }
        counts.all += 1;
        const st = String(f.properties.status || 'unverified') as DrainageStatus;
        if (st in counts) counts[st] += 1;
      }
    }
    return counts;
  }, [datasets, verifiedStructures]);

  const handleChangeViewMode = (next: ViewMode) => {
    setViewMode(next);
    if (next === 'simple') {
      if (basemap !== 'sat' && basemap !== 'osm') {
        setBasemap('sat');
      }
      if (tab === 'editor') {
        setTab('terrain');
      }
      if (forestScenario !== 'actual') {
        setForestScenario('actual');
      }
      if (drainCondition === 'surge') {
        setDrainCondition('clogged');
      }
      if (editingWaterway) {
        setEditingWaterway(null);
      }
      if (editingStructure) {
        setEditingStructure(null);
      }
      if (editingJorong) {
        setEditingJorong(null);
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
      setRaindrop(demClient.traceRaindrop(lngLat[0], lngLat[1], verifiedWaterways));
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
      setEditingStructure({
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

  const refreshSqliteState = async () => {
    const [wwState, logs] = await Promise.all([fetchWaterwaysState(), fetchAuditLogs()]);
    setVerifiedWaterways(wwState.waterways);
    setVerifiedStructures(wwState.structures);
    setJorongBoundaries(wwState.jorongBoundaries);
    setSuppressedDem(wwState.suppressedDem);
    setHydroStatus(wwState.hydroStatus);
    setAuditLogs(logs);
  };

  const handleRecomputeHydrology = async () => {
    setRecomputingHydro(true);
    try {
      const res = await recomputeHydrology({ actor: actorName, carveDepthM: 3.5 });
      const nextVer = Date.now();
      const [metaRes, flowRes, draftRes, sfRes, logs] = await Promise.all([
        fetch(`/data/metadata.json?v=${nextVer}`),
        fetch(`/data/flow-paths.geojson?v=${nextVer}`),
        fetch(`/data/drainage-draft.geojson?v=${nextVer}`),
        fetch(`/data/sim-fields.json?v=${nextVer}`),
        fetchAuditLogs()
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
      setVerifiedWaterways(res.state.waterways.features);
      setVerifiedStructures(res.state.structures?.features || []);
      setSuppressedDem(res.state.suppressedDem);
      setHydroStatus(res.hydroStatus);
      setAuditLogs(logs);
      setDataVersion(nextVer);
      notify(
        lang === 'en'
          ? `DEM updated (${res.summary.burnedCellCount} cells) & flow/HAND maps recomputed.`
          : `DEM berhasil diperbarui (${res.summary.burnedCellCount} sel) & peta aliran/HAND dihitung ulang.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Hydrology recompute failed');
    } finally {
      setRecomputingHydro(false);
    }
  };

  const handleCameraPreset = (preset: string) => {
    setCameraPreset(preset);
    const presets: Record<string, { center: [number, number]; zoom: number; pitch: number; bearing: number }> = {
      center: { center: [100.319, -0.345], zoom: 13.6, pitch: is3D ? 36 : 0, bearing: is3D ? -12 : 0 },
      subarang: { center: [100.326183, -0.326062], zoom: 15.5, pitch: is3D ? 34 : 0, bearing: is3D ? -12 : 0 },
      hilalang: { center: [100.327863, -0.341817], zoom: 15.6, pitch: is3D ? 34 : 0, bearing: is3D ? -8 : 0 },
      pahambatan: { center: [100.319315, -0.339606], zoom: 15.6, pitch: is3D ? 34 : 0, bearing: is3D ? -10 : 0 }
    };
    const p = presets[preset];
    if (p) {
      flyTo(p.center, { zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
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

  const suppressedDemIds = useMemo(() => suppressedDem.map(s => s.seg_id), [suppressedDem]);
  const mapEditingWaterway = useMemo(
    () =>
      editingWaterway
        ? {
            id: editingWaterway.id,
            coordinates: editingWaterway.coordinates,
            sourceRef: editingWaterway.sourceRef
          }
        : null,
    [editingWaterway?.id, editingWaterway?.coordinates, editingWaterway?.sourceRef]
  );

  const mapEditingStructure = useMemo(
    () =>
      editingStructure
        ? {
            id: editingStructure.id,
            coordinates: editingStructure.coordinates,
            sourceRef: editingStructure.sourceRef
          }
        : null,
    [editingStructure?.id, editingStructure?.coordinates, editingStructure?.sourceRef]
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
          layers={layers}
          flowDensity={flowDensity}
          activeTool={activeTool}
          simRain={simRain}
          simDurationMin={simDurationMin}
          simProgress={simProgress}
          simScenario={drainCondition === 'cleared' ? 'cleared' : 'clogged'}
          cascadeEngine={cascadeEngine}
          cascadeParams={cascadeParams}
          drainFilter={drainFilter}
          raindrop={raindrop}
          profilePts={profilePts}
          profileHover={profileHover}
          verifiedWaterways={verifiedWaterways}
          verifiedStructures={verifiedStructures}
          jorongBoundaries={jorongBoundaries}
          suppressedDemIds={suppressedDemIds}
          dataVersion={dataVersion}
          apiAvailable={apiAvailable}
          requiresPassphrase={requiresPassphrase}
          editorUnlocked={editorUnlocked}
          editingWaterway={mapEditingWaterway}
          editingStructure={mapEditingStructure}
          drawVertices={drawVertices}
          flyRequest={flyRequest}
          controlRef={mapControlRef}
          onCameraChange={setMapCamera}
          onSelectJorongPill={setCameraPreset}
          onMapClick={handleMapClick}
          onOpenUnlock={() => setUnlockModalOpen(true)}
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
              widthPreM: feat.properties.width_pre_m ?? null,
              widthPostM: feat.properties.width_post_m ?? null,
              depthM: feat.properties.depth_m ?? null,
              coordinates: feat.geometry.coordinates.map(c => [c[0], c[1]])
            });
          }}
          onSelectStructure={feat => {
            setViewMode('detail');
            setTab('editor');
            setEditorSubTab('structures');
            setEditingStructure({
              id: feat.properties.id,
              name: feat.properties.name,
              kind: feat.properties.kind,
              status: feat.properties.status,
              source: feat.properties.source,
              sourceRef: feat.properties.source_ref,
              sizeNote: feat.properties.size_note,
              notes: feat.properties.notes,
              coordinates: [feat.geometry.coordinates[0], feat.geometry.coordinates[1]]
            });
          }}
          onVerifyCrossing={(draftId, coords, suggestedName, suggestedKind) => {
            setViewMode('detail');
            setTab('editor');
            setEditorSubTab('structures');
            setEditingStructure({
              id: null,
              name: suggestedName,
              kind: suggestedKind,
              status: 'normal',
              source: 'crossing_promoted',
              sourceRef: draftId,
              sizeNote: '',
              notes: '',
              coordinates: coords
            });
          }}
          onMoveEditingStructure={coords => {
            setEditingStructure(prev => (prev ? { ...prev, coordinates: coords } : prev));
          }}
          onPromoteDemSegment={(segId, coords) => {
            setViewMode('detail');
            setTab('editor');
            setEditorSubTab('waterways');
            const oriented = demClient
              ? orientCoordinatesDownhill(coords, (x, y) => demClient.getElevation(x, y)).coordinates
              : coords;
            setEditingWaterway({
              id: null,
              name: `Alur Koreksi (${segId})`,
              kind: 'stream',
              status: 'normal',
              source: 'dem_promoted',
              sourceRef: segId,
              notes: '',
              coordinates: oriented
            });
          }}
          onPromoteRbiRiver={(name, kind, coords) => {
            setViewMode('detail');
            setTab('editor');
            setEditorSubTab('waterways');
            const oriented = demClient
              ? orientCoordinatesDownhill(coords, (x, y) => demClient.getElevation(x, y)).coordinates
              : coords;
            setEditingWaterway({
              id: null,
              name,
              kind,
              status: 'normal',
              source: 'manual',
              sourceRef: null,
              notes: 'Sumber awal: Pemkab Agam RBI 1:50.000',
              coordinates: oriented
            });
          }}
          onRedrawDemSegment={segId => {
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
              coordinates: []
            });
            setDrawVertices([]);
            setActiveTool('redrawWaterway');
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
          onSnapFeedback={msg => notify(msg)}
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
        active={tab === 'sim' && rainAnimEnabled && simProgress > 0.01}
        intensityMmHr={simRain}
        rainPattern={rainPattern}
        lang={lang}
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
              studyAreaKm2={metadata?.studyAreaKm2 || 29.9}
              buildingCount={metadata?.buildingCount}
              landCoverStats={metadata?.landCoverStats}
              scourStats={metadata?.scourStats}
              agamStats={metadata?.agamStats}
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
              soilMoisture={soilMoisture}
              rainPattern={rainPattern}
              drainCondition={drainCondition}
              forestScenario={forestScenario}
              forestActualPct={metadata?.landCoverStats?.forestPct ?? 74}
              rainAnimEnabled={rainAnimEnabled}
              verifiedIssueCount={verifiedIssueCount}
              verifiedWaterways={verifiedWaterways}
              demClient={demClient}
              agamStats={metadata?.agamStats}
              kpis={cascadeKpis}
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
              onChangeSoilMoisture={setSoilMoisture}
              onChangeRainPattern={setRainPattern}
              onChangeDrainCondition={setDrainCondition}
              onChangeForestScenario={setForestScenario}
              onApplyPreset={preset => {
                setSimPlaying(false);
                if (preset === 'normal') {
                  setSimRain(25);
                  setSimDurationMin(90);
                  setSoilMoisture('dry');
                  setRainPattern('uniform');
                  setDrainCondition('cleared');
                  setForestScenario('actual');
                } else if (preset === 'upland') {
                  setSimRain(80);
                  setSimDurationMin(180);
                  setSoilMoisture('saturated');
                  setRainPattern('upland');
                  setDrainCondition('clogged');
                  setForestScenario('actual');
                } else {
                  setSimRain(120);
                  setSimDurationMin(180);
                  setSoilMoisture('saturated');
                  setRainPattern('upland');
                  setDrainCondition(viewMode === 'detail' ? 'surge' : 'clogged');
                  setForestScenario('actual');
                }
                setSimProgress(0.05);
                setSimPlaying(true);
              }}
              onToggleRainAnim={setRainAnimEnabled}
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
                flyTo([100.322, -0.346], { zoom: 14.4, pitch: 54, bearing: -20 });
              }}
              onFocusDrainage={() => {
                setDrainFilter('all');
                flyTo([100.3248, -0.3365], { zoom: 15.0, pitch: 35, bearing: -10 });
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
              demClient={demClient}
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
                setEditingStructure(null);
                setEditingJorong(null);
              }}
              verifiedWaterways={verifiedWaterways}
              verifiedStructures={verifiedStructures}
              jorongBoundaries={jorongBoundaries}
              suppressedDem={suppressedDem}
              editingWaterway={editingWaterway}
              editingStructure={editingStructure}
              editingJorong={editingJorong}
              hydroStatus={hydroStatus}
              recomputingHydro={recomputingHydro}
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
                  widthPreM: feat.properties.width_pre_m ?? null,
                  widthPostM: feat.properties.width_post_m ?? null,
                  depthM: feat.properties.depth_m ?? null,
                  coordinates: feat.geometry.coordinates.map(c => [c[0], c[1]])
                });
                const mid = feat.geometry.coordinates[Math.floor(feat.geometry.coordinates.length / 2)];
                if (mid) flyTo(mid, { zoom: 15.6 });
              }}
              onStartRedrawEditing={() => {
                setDrawVertices([]);
                setActiveTool(prev => (prev === 'redrawWaterway' ? null : 'redrawWaterway'));
              }}
              onFlipEditingDirection={() => {
                setEditingWaterway(prev => {
                  if (!prev || prev.coordinates.length < 2) return prev;
                  return { ...prev, coordinates: [...prev.coordinates].reverse() };
                });
                notify(lang === 'en' ? 'Flow direction flipped.' : 'Arah aliran dibalik (Hulu ↔ Hilir).');
              }}
              onUpdateEditingCoords={coords => {
                setEditingWaterway(prev => (prev ? { ...prev, coordinates: coords } : prev));
              }}
              onCancelWaterwayEdit={() => {
                setEditingWaterway(null);
                if (activeTool === 'redrawWaterway') {
                  setActiveTool(null);
                  setDrawVertices([]);
                }
              }}
              onSaveWaterway={async (draft, reason) => {
                try {
                  if (draft.id) {
                    await updateWaterway(draft.id, {
                      name: draft.name,
                      kind: draft.kind,
                      status: draft.status,
                      notes: draft.notes,
                      width_pre_m: draft.widthPreM ?? null,
                      width_post_m: draft.widthPostM ?? null,
                      depth_m: draft.depthM ?? null,
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
                      width_pre_m: draft.widthPreM ?? null,
                      width_post_m: draft.widthPostM ?? null,
                      depth_m: draft.depthM ?? null,
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
              onRecomputeHydrology={handleRecomputeHydrology}
              onFlyToWaterway={feat => {
                const mid = feat.geometry.coordinates[Math.floor(feat.geometry.coordinates.length / 2)];
                if (mid) flyTo(mid, { zoom: 15.6 });
              }}
              onStartPlaceStructure={() => {
                setEditingStructure(null);
                setActiveTool(prev => (prev === 'placeStructure' ? null : 'placeStructure'));
              }}
              onStartEditStructure={feat => {
                setEditingStructure({
                  id: feat.properties.id,
                  name: feat.properties.name,
                  kind: feat.properties.kind,
                  status: feat.properties.status,
                  source: feat.properties.source,
                  sourceRef: feat.properties.source_ref,
                  sizeNote: feat.properties.size_note,
                  notes: feat.properties.notes,
                  coordinates: [feat.geometry.coordinates[0], feat.geometry.coordinates[1]]
                });
                flyTo(feat.geometry.coordinates, { zoom: 16.0 });
              }}
              onCancelStructureEdit={() => {
                setEditingStructure(null);
                if (activeTool === 'placeStructure') setActiveTool(null);
              }}
              onSaveStructure={async (draft, reason) => {
                try {
                  if (draft.id) {
                    await updateStructure(draft.id, {
                      name: draft.name,
                      kind: draft.kind,
                      status: draft.status,
                      size_note: draft.sizeNote,
                      notes: draft.notes,
                      coordinates: draft.coordinates,
                      actor: actorName,
                      reason
                    });
                  } else {
                    await createStructure({
                      name: draft.name,
                      kind: draft.kind,
                      status: draft.status,
                      source: draft.source,
                      source_ref: draft.sourceRef || null,
                      size_note: draft.sizeNote,
                      notes: draft.notes,
                      coordinates: draft.coordinates,
                      actor: actorName,
                      reason
                    });
                  }
                  setEditingStructure(null);
                  await refreshSqliteState();
                  notify(
                    lang === 'en'
                      ? 'Structure saved & logged.'
                      : 'Titik gorong-gorong tersimpan & dicatat di Riwayat.'
                  );
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Save failed');
                }
              }}
              onDeleteStructure={async (id, reason) => {
                try {
                  await deleteStructure(id, { actor: actorName, reason });
                  setEditingStructure(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? 'Structure removed & logged.' : 'Titik dihapus & dicatat di Riwayat.');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Delete failed');
                }
              }}
              onFlyToStructure={feat => {
                flyTo(feat.geometry.coordinates, { zoom: 16.0 });
              }}
              onStartDrawJorong={() => {
                setEditingJorong(null);
                setDrawVertices([]);
                setActiveTool(prev => (prev === 'drawJorong' ? null : 'drawJorong'));
              }}
              onImportJorongPolygon={(name, ring) => {
                setEditingJorong({
                  id: null,
                  name,
                  status: 'indicative',
                  sourceNote: 'Impor GeoJSON',
                  coordinates: ring
                });
                const mid = ring[Math.floor(ring.length / 2)];
                if (mid) flyTo(mid, { zoom: 14.8 });
              }}
              onStartEditJorong={feat => {
                const ring = feat.geometry.coordinates[0] || [];
                setEditingJorong({
                  id: feat.properties.id,
                  name: feat.properties.name,
                  status: feat.properties.status,
                  sourceNote: feat.properties.source_note,
                  coordinates: ring.map(c => [c[0], c[1]])
                });
                const mid = ring[Math.floor(ring.length / 2)];
                if (mid) flyTo(mid, { zoom: 14.8 });
              }}
              onCancelJorongEdit={() => {
                setEditingJorong(null);
                if (activeTool === 'drawJorong') {
                  setActiveTool(null);
                  setDrawVertices([]);
                }
              }}
              onSaveJorong={async (draft, reason) => {
                try {
                  if (draft.id) {
                    await updateJorongBoundary(draft.id, {
                      name: draft.name,
                      status: draft.status,
                      source_note: draft.sourceNote,
                      coordinates: draft.coordinates,
                      actor: actorName,
                      reason
                    });
                  } else {
                    await createJorongBoundary({
                      name: draft.name,
                      status: draft.status,
                      source_note: draft.sourceNote,
                      coordinates: draft.coordinates,
                      actor: actorName,
                      reason
                    });
                  }
                  setEditingJorong(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? 'Jorong boundary saved & logged.' : 'Batas Jorong tersimpan & dicatat.');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Save failed');
                }
              }}
              onDeleteJorong={async (id, reason) => {
                try {
                  await deleteJorongBoundary(id, { actor: actorName, reason });
                  setEditingJorong(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? 'Jorong boundary removed.' : 'Batas Jorong dihapus.');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Delete failed');
                }
              }}
              onFlyToJorong={feat => {
                const ring = feat.geometry.coordinates[0] || [];
                const mid = ring[Math.floor(ring.length / 2)];
                if (mid) flyTo(mid, { zoom: 14.8 });
              }}
              auditLogs={auditLogs}
              onRevertAuditLog={async logId => {
                try {
                  await revertAuditLog(logId, { actor: actorName, reason: `Revert log #${logId}` });
                  setEditingWaterway(null);
                  setEditingStructure(null);
                  setEditingJorong(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? `Reverted #${logId}` : `Perubahan #${logId} berhasil dipulihkan`);
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Revert failed');
                }
              }}
              onFlyToAuditLog={log => {
                const snap = (log.after || log.before) as {
                  coordinates?: [number, number][] | [number, number];
                  lng?: number;
                  lat?: number;
                } | null;
                if (snap) {
                  if (typeof snap.lng === 'number' && typeof snap.lat === 'number') {
                    flyTo([snap.lng, snap.lat], { zoom: 16.0 });
                  } else if (Array.isArray(snap.coordinates) && snap.coordinates.length > 0) {
                    if (typeof snap.coordinates[0] === 'number' && typeof snap.coordinates[1] === 'number') {
                      flyTo(snap.coordinates as [number, number], { zoom: 16.0 });
                    } else {
                      const line = snap.coordinates as [number, number][];
                      const mid = line[Math.floor(line.length / 2)];
                      if (mid) flyTo(mid, { zoom: 15.6 });
                    }
                  }
                }
              }}
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
          {(activeTool === 'drawWaterway' || activeTool === 'redrawWaterway' || activeTool === 'drawJorong') && (
            <button
              type="button"
              onClick={() => {
                if (activeTool === 'drawJorong') {
                  if (drawVertices.length < 3) {
                    notify(lang === 'en' ? 'At least 3 vertices required for a polygon.' : 'Minimal 3 titik batas diperlukan untuk poligon Jorong.');
                    return;
                  }
                  setEditingJorong({
                    id: null,
                    name: '',
                    status: 'indicative',
                    sourceNote: '',
                    coordinates: [...drawVertices]
                  });
                  setDrawVertices([]);
                  setActiveTool(null);
                  return;
                }
                if (drawVertices.length < 2) {
                  notify(t.toastNeed2Pts);
                  return;
                }
                const oriented = demClient
                  ? orientCoordinatesDownhill(drawVertices, (x, y) => demClient.getElevation(x, y))
                  : { coordinates: [...drawVertices], reversed: false };
                if (activeTool === 'redrawWaterway' && editingWaterway) {
                  setEditingWaterway({
                    ...editingWaterway,
                    coordinates: oriented.coordinates
                  });
                } else {
                  setEditingWaterway({
                    id: null,
                    name: '',
                    kind: 'canal',
                    status: 'normal',
                    source: 'manual',
                    notes: '',
                    coordinates: oriented.coordinates
                  });
                }
                if (oriented.reversed) {
                  notify(
                    lang === 'en'
                      ? 'Auto-oriented downhill (upstream → downstream).'
                      : 'Arah jalur otomatis disesuaikan ke hilir (hulu → hilir).'
                  );
                }
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
        mapCamera={mapCamera}
        onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
        onChangeFlowDensity={setFlowDensity}
        onZoomIn={() => mapControlRef.current?.zoomIn()}
        onZoomOut={() => mapControlRef.current?.zoomOut()}
        onResetNorth={() => mapControlRef.current?.resetNorth()}
        onOpenSources={() => setInfoModalTab('api')}
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
        open={infoModalTab !== null}
        initialTab={infoModalTab ?? 'guide'}
        lang={lang}
        metadata={metadata}
        apiAvailable={apiAvailable}
        verifiedCount={verifiedWaterways.length}
        onNotify={notify}
        onClose={() => setInfoModalTab(null)}
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
