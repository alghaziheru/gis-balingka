import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Droplets,
  Info,
  MapPin,
  Menu,
  Mountain,
  ShieldAlert
} from 'lucide-react';
import { DrainageTab } from './components/DrainageTab';
import { EditorUnlockModal } from './components/EditorUnlockModal';
import { ElevationProfileModal } from './components/ElevationProfileModal';
import { FieldMappingTab, type FieldSubTab } from './components/FieldMappingTab';
import { MapView, type FlyRequest, type LoadedDatasets } from './components/MapView';
import { OssLicenseModal } from './components/OssLicenseModal';
import { SimulationTab } from './components/SimulationTab';
import { TelemetryDock } from './components/TelemetryDock';
import { TerrainTab } from './components/TerrainTab';
import { TopHud } from './components/TopHud';
import type { ActiveEditingWaterway } from './components/WaterwayEditorPanel';
import { I18N, SIM_STAGES } from './i18n/translations';
import {
  buildStaticSeedWaterways,
  createSuggestion,
  createWaterway,
  deleteWaterway,
  fetchAuditLogs,
  fetchEditorStatus,
  fetchSuggestions,
  fetchWaterwaysState,
  loadEditorName,
  loadStoredPassphrase,
  restoreDemSegment,
  revertAuditLog,
  saveEditorName,
  saveStoredPassphrase,
  suppressDemSegment,
  updateSuggestionStatus,
  updateWaterway,
  verifyEditorPassphrase
} from './lib/api';
import { DemClient } from './lib/demClient';
import {
  loadChecklistState,
  loadCommunityFeatures,
  saveChecklistState,
  saveCommunityFeatures
} from './lib/storage';
import type {
  ActiveTool,
  AuditLogEntry,
  BasemapId,
  CitizenSuggestion,
  CommunityFeature,
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
  VerifiedWaterwayFeature
} from './types/gis';

export function App() {
  const [lang, setLang] = useState<Language>('id');
  const [tab, setTab] = useState<TabId>('terrain');
  const [is3D, setIs3D] = useState(true);
  const [basemap, setBasemap] = useState<BasemapId>('sat');
  const [cameraPreset, setCameraPreset] = useState('center');
  const [exaggeration, setExaggeration] = useState(1.35);
  const [flowDensity, setFlowDensity] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSheetMode, setMobileSheetMode] = useState<0 | 1 | 2>(0); // 0=half, 1=expanded, 2=collapsed
  const [ossOpen, setOssOpen] = useState(false);

  // Clean crisp startup: sharp satellite + verified waterways + DEM estimate + Balingka block border
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

  const [simPlaying, setSimPlaying] = useState(false);
  const [simStage, setSimStage] = useState(0);
  const [simRain, setSimRain] = useState(120);
  const [simScenario, setSimScenario] = useState<'clogged' | 'cleared'>('clogged');

  const [drainFilter, setDrainFilter] = useState<'all' | DrainageStatus>('all');
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => loadChecklistState());
  const [communityFeatures, setCommunityFeatures] = useState<CommunityFeature[]>(() => loadCommunityFeatures());
  const [draftGeom, setDraftGeom] = useState<CommunityFeature['geometry'] | null>(null);
  const [drawVertices, setDrawVertices] = useState<[number, number][]>([]);

  // 2-Layer Waterways + SQLite Audit Trail + Suggestions
  const [fieldSubTab, setFieldSubTab] = useState<FieldSubTab>('waterways');
  const [apiAvailable, setApiAvailable] = useState(false);
  const [requiresPassphrase, setRequiresPassphrase] = useState(false);
  const [editorUnlocked, setEditorUnlocked] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [actorName, setActorName] = useState(() => loadEditorName());
  const [verifiedWaterways, setVerifiedWaterways] = useState<VerifiedWaterwayFeature[]>([]);
  const [suppressedDem, setSuppressedDem] = useState<SuppressedDemSegment[]>([]);
  const [editingWaterway, setEditingWaterway] = useState<ActiveEditingWaterway | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [suggestions, setSuggestions] = useState<CitizenSuggestion[]>([]);
  const [suggestionPin, setSuggestionPin] = useState<[number, number] | null>(null);

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
          const [wwState, logs, sugs] = await Promise.all([
            fetchWaterwaysState(),
            fetchAuditLogs(),
            fetchSuggestions()
          ]);
          if (!cancelled) {
            setVerifiedWaterways(wwState.waterways);
            setSuppressedDem(wwState.suppressedDem);
            setAuditLogs(logs);
            setSuggestions(sugs);
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
      setSimStage(prev => {
        const next = (prev + 1) % SIM_STAGES.length;
        const st = SIM_STAGES[next];
        setSimRain(st.rain);
        setSimScenario(st.scenario);
        flyTo(st.camera.center, { zoom: st.camera.zoom, pitch: st.camera.pitch, bearing: st.camera.bearing });
        return next;
      });
    }, 3600);
    return () => window.clearInterval(id);
  }, [simPlaying]);

  const simKpis = useMemo(() => {
    const stageBoost = [0.45, 0.78, 1.0, 0.95][simStage] ?? 1.0;
    const effectiveRain = simRain * stageBoost;
    const level: 'low' | 'med' | 'high' = effectiveRain < 55 ? 'low' : effectiveRain < 95 ? 'med' : 'high';

    const cloggedHa = metadata?.simAreasHa?.clogged[level] ?? 0;
    const clearedHa = metadata?.simAreasHa?.cleared[level] ?? 0;
    const activeAreaHa = simScenario === 'cleared' ? clearedHa : cloggedHa;
    const reductionPct = cloggedHa > 0 ? Math.max(0, Math.round((1 - clearedHa / cloggedHa) * 100)) : 0;

    const totalCrossings = (metadata?.crossingsDetected || 0) + (metadata?.bridgesDetected || 0);
    const chokeCount = simScenario === 'cleared' ? 0 : Math.round(totalCrossings * Math.min(1, effectiveRain / 115));
    const runoffIndex = Math.min(100, Math.round((simRain / 130) * 85 + (simStage >= 1 ? 12 : 0)));

    return { activeAreaHa, reductionPct, chokeCount, runoffIndex };
  }, [metadata, simStage, simRain, simScenario]);

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
    for (const cf of communityFeatures) {
      if (cf.properties.category !== 'drainage') continue;
      counts.all += 1;
      counts[cf.properties.status] += 1;
    }
    return counts;
  }, [datasets, communityFeatures]);

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
    } else if (activeTool === 'addPoint') {
      setDraftGeom({ type: 'Point', coordinates: lngLat });
      setActiveTool(null);
    } else if (activeTool === 'drawLine' || activeTool === 'drawWaterway') {
      setDrawVertices(prev => [...prev, lngLat]);
    } else if (activeTool === 'pickSuggestion') {
      setSuggestionPin(lngLat);
      setActiveTool(null);
    }
  };

  const refreshSqliteState = async () => {
    const [wwState, logs, sugs] = await Promise.all([
      fetchWaterwaysState(),
      fetchAuditLogs(),
      fetchSuggestions()
    ]);
    setVerifiedWaterways(wwState.waterways);
    setSuppressedDem(wwState.suppressedDem);
    setAuditLogs(logs);
    setSuggestions(sugs);
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
    if (activeTool === 'addPoint') return t.bannerAddPoint;
    if (activeTool === 'drawLine') return t.bannerDrawLine;
    if (activeTool === 'drawWaterway') return t.bannerDrawWaterway;
    if (activeTool === 'pickSuggestion') return t.bannerPickSuggestion;
    return '';
  })();

  const handleSelectStage = (idx: number) => {
    setSimPlaying(false);
    setSimStage(idx);
    const st = SIM_STAGES[idx];
    if (st) {
      setSimRain(st.rain);
      setSimScenario(st.scenario);
      flyTo(st.camera.center, { zoom: st.camera.zoom, pitch: st.camera.pitch, bearing: st.camera.bearing });
    }
  };

  const mobileHeightClass =
    mobileSheetMode === 1
      ? 'max-md:h-[76vh]'
      : mobileSheetMode === 2
      ? 'max-md:h-[112px]'
      : 'max-md:h-[48vh]';

  return (
    <div className={`relative h-screen w-screen overflow-hidden ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {datasets && demClient ? (
        <MapView
          datasets={datasets}
          demClient={demClient}
          lang={lang}
          tab={tab}
          is3D={is3D}
          basemap={basemap}
          exaggeration={exaggeration}
          layers={layers}
          flowDensity={flowDensity}
          activeTool={activeTool}
          simStage={simStage}
          simRain={simRain}
          simScenario={simScenario}
          drainFilter={drainFilter}
          raindrop={raindrop}
          profilePts={profilePts}
          profileHover={profileHover}
          communityFeatures={communityFeatures}
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
          suggestionPin={suggestionPin}
          draftGeom={draftGeom}
          drawVertices={drawVertices}
          flyRequest={flyRequest}
          onMapClick={handleMapClick}
          onSelectWaterway={feat => {
            setTab('field');
            setFieldSubTab('waterways');
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
            setTab('field');
            setFieldSubTab('waterways');
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
        <div className="flex h-full w-full items-center justify-center bg-[#e5ebe8] p-4">
          <div className="glass rounded-2xl px-5 py-4 text-center shadow-lg">
            <div className="text-sm font-extrabold text-[#12231c]">
              {loadError ? `Error: ${loadError}` : t.loadingData}
            </div>
          </div>
        </div>
      )}

      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className="glass absolute top-3 left-3 z-19 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-[#12231c] max-md:hidden"
        >
          <Menu className="h-4 w-4" />
          <span>{t.openPanel}</span>
        </button>
      )}

      <aside
        className={`glass absolute top-3 bottom-3 left-3 z-20 flex w-[384px] flex-col overflow-hidden rounded-2xl transition-transform duration-300 max-md:top-auto max-md:right-2 max-md:bottom-2 max-md:left-2 max-md:w-auto max-md:max-h-[78vh] max-md:rounded-[18px] ${
          sidebarCollapsed ? '-translate-x-[calc(100%+20px)] max-md:translate-x-0' : ''
        } ${mobileHeightClass}`}
      >
        <button
          type="button"
          onClick={() => setMobileSheetMode(m => ((m + 1) % 3) as 0 | 1 | 2)}
          aria-label="Toggle mobile panel height"
          className="hidden w-full shrink-0 items-center justify-center pt-2 pb-1 max-md:flex"
        >
          <span className="h-1 w-10 rounded-full bg-[#12231c]/25" />
        </button>

        <div className="shrink-0 border-b border-[#12231c]/12 bg-white/65 px-3.5 pt-3 pb-2.5 max-md:pt-1 max-md:pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#0f3d2e] to-[#0284c7] text-white shadow-sm max-md:h-7 max-md:w-7">
                <Droplets className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <h1 className="m-0 truncate text-[15px] leading-tight font-extrabold tracking-tight text-[#12231c] max-md:text-[13.5px]">
                  {t.appTitle}
                </h1>
                <div className="font-mono-num mt-0.5 text-[11px] text-[#64776f]">{t.subtitle}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse panel"
              className="grid h-7.5 w-7.5 shrink-0 place-items-center rounded-lg text-[#3f524a] hover:bg-[#eff4f1] max-md:hidden"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#0284c7]/25 bg-[#0284c7]/10 px-2 py-1 text-[10px] leading-snug font-bold text-[#0c4a6e] max-md:hidden">
            <Info className="h-3 w-3 shrink-0" />
            <span>{t.draftBadge}</span>
          </div>
        </div>

        <nav className="grid shrink-0 grid-cols-4 gap-1 border-b border-[#12231c]/12 bg-[#eff4f1]/80 px-2.5 py-2">
          {(
            [
              ['terrain', t.tabTerrain, Mountain],
              ['sim', t.tabSim, Droplets],
              ['drainage', t.tabDrainage, ShieldAlert],
              ['field', t.tabField, MapPin]
            ] as const
          ).map(([id, label, Icon]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  if (activeTool) {
                    setActiveTool(null);
                    setDrawVertices([]);
                  }
                  if (id !== 'sim') setSimPlaying(false);
                }}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-[9px] py-1.5 text-center text-[10.5px] leading-tight font-bold transition max-md:text-[10px] ${
                  active
                    ? 'border border-[#12231c]/12 bg-white text-[#0369a1] shadow-xs'
                    : 'text-[#3f524a] hover:bg-white/60 hover:text-[#12231c]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-scroll flex-1 overflow-y-auto px-3.5 pt-3 pb-4">
          {tab === 'terrain' && (
            <TerrainTab
              lang={lang}
              layers={layers}
              exaggeration={exaggeration}
              flowDensity={flowDensity}
              activeTool={activeTool}
              raindrop={raindrop}
              studyAreaKm2={metadata?.studyAreaKm2 || 20.9}
              onToggleLayer={(key, val) => setLayers(prev => ({ ...prev, [key]: val }))}
              onChangeExag={setExaggeration}
              onChangeFlowDensity={setFlowDensity}
              onToggleTool={tool => {
                setActiveTool(prev => (prev === tool || (tool === 'profileA' && prev === 'profileB') ? null : tool));
              }}
              onClearRaindrop={() => setRaindrop(null)}
            />
          )}

          {tab === 'sim' && (
            <SimulationTab
              lang={lang}
              playing={simPlaying}
              stageIndex={simStage}
              rainMm={simRain}
              scenario={simScenario}
              kpis={simKpis}
              onTogglePlay={() => setSimPlaying(p => !p)}
              onSelectStage={handleSelectStage}
              onChangeRain={setSimRain}
              onChangeScenario={setSimScenario}
            />
          )}

          {tab === 'drainage' && (
            <DrainageTab
              lang={lang}
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
                handleSelectStage(3);
              }}
              onFocusEvac={() => {
                setLayers(prev => ({ ...prev, evac: true }));
                flyTo([100.325, -0.337], { zoom: 15.0, pitch: 32, bearing: 0 });
              }}
            />
          )}

          {tab === 'field' && demClient && (
            <FieldMappingTab
              lang={lang}
              subTab={fieldSubTab}
              onChangeSubTab={sub => {
                setFieldSubTab(sub);
                if (activeTool) {
                  setActiveTool(null);
                  setDrawVertices([]);
                }
              }}
              activeTool={activeTool}
              features={communityFeatures}
              draftGeom={draftGeom}
              getElevation={(lng, lat) => demClient.getElevation(lng, lat)}
              onToggleTool={tool => {
                setDrawVertices([]);
                setActiveTool(prev => (prev === tool ? null : tool));
              }}
              onUseGps={() => {
                if (!navigator.geolocation) {
                  notify(t.toastGpsErr);
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  pos => {
                    const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
                    setDraftGeom({ type: 'Point', coordinates: coords });
                    flyTo(coords, { zoom: 16 });
                    notify(t.toastGpsOk);
                  },
                  () => notify(t.toastGpsErr),
                  { enableHighAccuracy: true, timeout: 7000 }
                );
              }}
              onClearDraftGeom={() => {
                setDraftGeom(null);
                setDrawVertices([]);
                setActiveTool(null);
              }}
              onSaveFeature={(feature, isEdit) => {
                const next = isEdit
                  ? communityFeatures.map(f => (f.properties.id === feature.properties.id ? feature : f))
                  : [feature, ...communityFeatures];
                setCommunityFeatures(next);
                saveCommunityFeatures(next);
              }}
              onDeleteFeature={id => {
                const next = communityFeatures.filter(f => f.properties.id !== id);
                setCommunityFeatures(next);
                saveCommunityFeatures(next);
              }}
              onFlyToFeature={f => {
                const c = f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0];
                flyTo(c, { zoom: 16.0 });
              }}
              onImportFeatures={imported => {
                const next = [...imported, ...communityFeatures];
                setCommunityFeatures(next);
                saveCommunityFeatures(next);
                if (imported.length > 0) {
                  const c =
                    imported[0].geometry.type === 'Point'
                      ? imported[0].geometry.coordinates
                      : imported[0].geometry.coordinates[0];
                  flyTo(c, { zoom: 15.0 });
                }
              }}
              onClearAll={() => {
                setCommunityFeatures([]);
                saveCommunityFeatures([]);
              }}
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
                  notify(lang === 'en' ? 'Waterway saved & logged to SQLite.' : 'Jalur sungai tersimpan ke SQLite & Audit Trail.');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Save failed');
                }
              }}
              onDeleteWaterway={async (id, reason) => {
                try {
                  await deleteWaterway(id, { actor: actorName, reason });
                  setEditingWaterway(null);
                  await refreshSqliteState();
                  notify(lang === 'en' ? 'Waterway removed & logged.' : 'Jalur dihapus & dicatat di Audit Trail.');
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
              suggestions={suggestions}
              suggestionPin={suggestionPin}
              onTogglePickSuggestionPin={() => {
                setActiveTool(prev => (prev === 'pickSuggestion' ? null : 'pickSuggestion'));
              }}
              onClearSuggestionPin={() => setSuggestionPin(null)}
              onSubmitSuggestion={async payload => {
                try {
                  await createSuggestion(payload);
                  await refreshSqliteState();
                  notify(t.suggestSentToast);
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Failed to send suggestion');
                }
              }}
              onUpdateSuggestionStatus={async (id, status, resolution_note) => {
                try {
                  await updateSuggestionStatus(id, { status, resolution_note, actor: actorName });
                  await refreshSqliteState();
                  notify(lang === 'en' ? 'Suggestion updated' : 'Status saran diperbarui');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Update failed');
                }
              }}
              onFlyToCoords={coords => flyTo(coords, { zoom: 16.0 })}
            />
          )}
        </div>
      </aside>

      <TopHud
        lang={lang}
        is3D={is3D}
        basemap={basemap}
        cameraPreset={cameraPreset}
        onToggle3D={setIs3D}
        onChangeBasemap={setBasemap}
        onChangeCameraPreset={handleCameraPreset}
        onChangeLang={setLang}
        onOpenOss={() => setOssOpen(true)}
      />

      {activeTool && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-16 z-19 inline-flex max-w-[90vw] -translate-x-1/2 items-center gap-2.5 rounded-full bg-[#0c241b] px-3 py-2 text-xs font-semibold text-white shadow-xl max-md:top-14 max-md:left-1/2 max-md:px-2.5 max-md:py-1.5 max-md:text-[11px] ${
            sidebarCollapsed ? 'left-1/2' : 'left-[calc(50%+192px)]'
          }`}
        >
          <span>{bannerMessage}</span>
          {(activeTool === 'drawLine' || activeTool === 'drawWaterway') && (
            <button
              type="button"
              onClick={() => {
                if (drawVertices.length < 2) {
                  notify(t.toastNeed2Pts);
                  return;
                }
                if (activeTool === 'drawWaterway') {
                  setEditingWaterway({
                    id: null,
                    name: '',
                    kind: 'canal',
                    status: 'normal',
                    source: 'manual',
                    notes: '',
                    coordinates: [...drawVertices]
                  });
                } else {
                  setDraftGeom({ type: 'LineString', coordinates: [...drawVertices] });
                }
                setDrawVertices([]);
                setActiveTool(null);
              }}
              className="rounded-full bg-[#059669] px-2.5 py-1 text-[11px] font-bold text-white"
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
            className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/25"
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

      <TelemetryDock lang={lang} tab={tab} basemap={basemap} layers={layers} cursorTelemetry={cursorTelemetry} />

      <OssLicenseModal open={ossOpen} lang={lang} metadata={metadata} onClose={() => setOssOpen(false)} />

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
        <div className="fixed top-16 right-3.5 z-60 rounded-[10px] bg-[#12231c] px-3.5 py-2 text-xs font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
export default App;
