import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { EditorSubTab } from '../components/EditorTab';
import type { ActiveEditingJorong } from '../components/JorongEditorPanel';
import type { LoadedDatasets } from '../components/MapView';
import type { ActiveEditingStructure } from '../components/StructureEditorPanel';
import type { ActiveEditingWaterway } from '../components/WaterwayEditorPanel';
import { getRegionDataBasePath, REGION, type RegionConfig } from '../config/region';
import { getTranslations } from '../i18n/translations';
import {
  createJorongBoundary,
  createStructure,
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
} from '../lib/api';
import type { DemClient } from '../lib/demClient';
import { orientCoordinatesDownhill } from '../lib/geometry';
import type {
  ActiveTool,
  AuditLogEntry,
  HydroStatus,
  JorongBoundaryFeature,
  Language,
  StructureKind,
  SuppressedDemSegment,
  TabId,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature,
  ViewMode,
  WaterwayKind
} from '../types/gis';

export function useEditorActions(opts: {
  region: RegionConfig;
  datasets: LoadedDatasets | null;
  demClient: DemClient | null;
  lang: Language;
  activeTool: ActiveTool;
  setActiveTool: Dispatch<SetStateAction<ActiveTool>>;
  setDrawVertices: Dispatch<SetStateAction<[number, number][]>>;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  setTab: Dispatch<SetStateAction<TabId>>;
  notify: (msg: string) => void;
  flyTo: (center: [number, number], flyOpts?: { zoom?: number; pitch?: number; bearing?: number }) => void;
  reloadHydrologyData: (nextVer: number) => Promise<void>;
}) {
  const region = opts.region || REGION;
  const regionId = region.id;
  const dataBasePath = getRegionDataBasePath(region);
  const [editorSubTab, setEditorSubTab] = useState<EditorSubTab>('waterways');
  const [apiAvailable, setApiAvailable] = useState(false);
  const [requiresPassphrase, setRequiresPassphrase] = useState(false);
  const [editorUnlocked, setEditorUnlocked] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [actorName, setActorName] = useState(() => loadEditorName(region.authorities.defaultEditorName));
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
  const [editorHydrated, setEditorHydrated] = useState(false);
  const hydratedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setVerifiedWaterways([]);
    setVerifiedStructures([]);
    setJorongBoundaries([]);
    setSuppressedDem([]);
    setEditingWaterway(null);
    setEditingStructure(null);
    setEditingJorong(null);
    setAuditLogs([]);
    setDataVersion(0);
    setEditorHydrated(false);
    hydratedKeyRef.current = null;
    setActorName(loadEditorName(region.authorities.defaultEditorName));
  }, [regionId, region.authorities.defaultEditorName]);

  const osmContext = opts.datasets?.osmContext;
  useEffect(() => {
    if (!osmContext) return;
    const key = `${regionId}:${osmContext.features.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    let cancelled = false;
    async function hydrateEditor() {
      try {
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
          const [wwState, logs] = await Promise.all([
            fetchWaterwaysState(regionId),
            fetchAuditLogs(150, regionId)
          ]);
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
          const staticSeed = await fetchStaticVerifiedSeed(osmContext!, dataBasePath);
          if (!cancelled) {
            setVerifiedWaterways(staticSeed.waterways);
            setVerifiedStructures(staticSeed.structures);
            setSuppressedDem(staticSeed.suppressedDem);
          }
        }
      } catch {
        // Ignore hydration errors; static datasets remain viewable
      } finally {
        if (!cancelled) setEditorHydrated(true);
      }
    }
    hydrateEditor();
    return () => {
      cancelled = true;
    };
  }, [osmContext, regionId, dataBasePath]);

  const refreshSqliteState = useCallback(async () => {
    const [wwState, logs] = await Promise.all([
      fetchWaterwaysState(regionId),
      fetchAuditLogs(150, regionId)
    ]);
    setVerifiedWaterways(wwState.waterways);
    setVerifiedStructures(wwState.structures);
    setJorongBoundaries(wwState.jorongBoundaries);
    setSuppressedDem(wwState.suppressedDem);
    setHydroStatus(wwState.hydroStatus);
    setAuditLogs(logs);
  }, [regionId]);

  const handleRecomputeHydrology = useCallback(async () => {
    setRecomputingHydro(true);
    try {
      const res = await recomputeHydrology({ actor: actorName, carveDepthM: 3.5 }, regionId);
      const nextVer = Date.now();
      await opts.reloadHydrologyData(nextVer);
      const logs = await fetchAuditLogs(150, regionId);
      setVerifiedWaterways(res.state.waterways.features);
      setVerifiedStructures(res.state.structures?.features || []);
      setSuppressedDem(res.state.suppressedDem);
      setHydroStatus(res.hydroStatus);
      setAuditLogs(logs);
      setDataVersion(nextVer);
      opts.notify(
        opts.lang === 'en'
          ? `DEM updated (${res.summary.burnedCellCount} cells adjusted) & flow/HAND maps recomputed.`
          : `DEM berhasil diperbarui (${res.summary.burnedCellCount} sel disesuaikan) & peta aliran/HAND dihitung ulang.`
      );
    } catch (err) {
      opts.notify(err instanceof Error ? err.message : 'Hydrology recompute failed');
    } finally {
      setRecomputingHydro(false);
    }
  }, [actorName, opts, regionId]);

  const suppressedDemIds = useMemo(() => suppressedDem.map(s => s.seg_id), [suppressedDem]);
  const verifiedIssueCount = useMemo(
    () => verifiedStructures.filter(s => ['clogged', 'damaged', 'critical'].includes(s.properties.status)).length,
    [verifiedStructures]
  );

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

  const resetEditorForSimpleMode = useCallback(() => {
    if (editingWaterway) setEditingWaterway(null);
    if (editingStructure) setEditingStructure(null);
    if (editingJorong) setEditingJorong(null);
  }, [editingWaterway, editingStructure, editingJorong]);

  const selectWaterwayFromMap = useCallback(
    (feat: VerifiedWaterwayFeature) => {
      opts.setViewMode('detail');
      opts.setTab('editor');
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
    },
    [opts]
  );

  const selectStructureFromMap = useCallback(
    (feat: VerifiedStructureFeature) => {
      opts.setViewMode('detail');
      opts.setTab('editor');
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
    },
    [opts]
  );

  const verifyCrossingFromMap = useCallback(
    (draftId: string, coords: [number, number], suggestedName: string, suggestedKind: StructureKind) => {
      opts.setViewMode('detail');
      opts.setTab('editor');
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
    },
    [opts]
  );

  const promoteDemSegmentFromMap = useCallback(
    (segId: string, coords: [number, number][]) => {
      opts.setViewMode('detail');
      opts.setTab('editor');
      setEditorSubTab('waterways');
      const oriented = opts.demClient
        ? orientCoordinatesDownhill(coords, (x, y) => opts.demClient!.getElevation(x, y)).coordinates
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
    },
    [opts]
  );

  const promoteRbiRiverFromMap = useCallback(
    (name: string, kind: WaterwayKind, coords: [number, number][]) => {
      opts.setViewMode('detail');
      opts.setTab('editor');
      setEditorSubTab('waterways');
      const oriented = opts.demClient
        ? orientCoordinatesDownhill(coords, (x, y) => opts.demClient!.getElevation(x, y)).coordinates
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
    },
    [opts]
  );

  const redrawDemSegmentFromMap = useCallback(
    (segId: string) => {
      opts.setViewMode('detail');
      opts.setTab('editor');
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
      opts.setDrawVertices([]);
      opts.setActiveTool('redrawWaterway');
    },
    [opts]
  );

  const suppressDemSegmentFromMap = useCallback(
    async (segId: string) => {
      try {
        await suppressDemSegment(
          {
            seg_id: segId,
            reason: 'Ditandai keliru langsung dari peta',
            actor: actorName
          },
          regionId
        );
        await refreshSqliteState();
        opts.notify(
          opts.lang === 'en' ? `Hidden DEM segment ${segId}` : `Segmen ${segId} disembunyikan & dicatat`
        );
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Failed to suppress');
      }
    },
    [actorName, opts, refreshSqliteState, regionId]
  );

  const finishDrawing = useCallback(
    (drawVertices: [number, number][]) => {
      const t = getTranslations(region)[opts.lang];
      if (opts.activeTool === 'drawJorong') {
        if (drawVertices.length < 3) {
          opts.notify(
            opts.lang === 'en'
              ? 'At least 3 vertices required for a polygon.'
              : 'Minimal 3 titik batas diperlukan untuk poligon Jorong.'
          );
          return;
        }
        setEditingJorong({
          id: null,
          name: '',
          status: 'indicative',
          sourceNote: '',
          coordinates: [...drawVertices]
        });
        opts.setDrawVertices([]);
        opts.setActiveTool(null);
        return;
      }
      if (drawVertices.length < 2) {
        opts.notify(t.toastNeed2Pts);
        return;
      }
      const oriented = opts.demClient
        ? orientCoordinatesDownhill(drawVertices, (x, y) => opts.demClient!.getElevation(x, y))
        : { coordinates: [...drawVertices], reversed: false };
      if (opts.activeTool === 'redrawWaterway' && editingWaterway) {
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
        opts.notify(
          opts.lang === 'en'
            ? 'Auto-oriented downhill (upstream → downstream).'
            : 'Arah jalur otomatis disesuaikan ke hilir (hulu → hilir).'
        );
      }
      opts.setDrawVertices([]);
      opts.setActiveTool(null);
    },
    [editingWaterway, opts]
  );

  const editorTabActions = {
    onChangeSubTab: (sub: EditorSubTab) => {
      setEditorSubTab(sub);
      if (opts.activeTool) {
        opts.setActiveTool(null);
        opts.setDrawVertices([]);
      }
    },
    onChangeActorName: (name: string) => {
      setActorName(name);
      saveEditorName(name);
    },
    onOpenUnlock: () => setUnlockModalOpen(true),
    onLockEditor: () => {
      saveStoredPassphrase('');
      setEditorUnlocked(false);
      setEditingWaterway(null);
      setEditingStructure(null);
      setEditingJorong(null);
    },
    onStartDrawWaterway: () => {
      setEditingWaterway(null);
      opts.setDrawVertices([]);
      opts.setActiveTool(prev => (prev === 'drawWaterway' ? null : 'drawWaterway'));
    },
    onStartEditWaterway: (feat: VerifiedWaterwayFeature) => {
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
      if (mid) opts.flyTo(mid, { zoom: 15.6 });
    },
    onStartRedrawEditing: () => {
      opts.setDrawVertices([]);
      opts.setActiveTool(prev => (prev === 'redrawWaterway' ? null : 'redrawWaterway'));
    },
    onFlipEditingDirection: () => {
      setEditingWaterway(prev => {
        if (!prev || prev.coordinates.length < 2) return prev;
        return { ...prev, coordinates: [...prev.coordinates].reverse() };
      });
      opts.notify(opts.lang === 'en' ? 'Flow direction flipped.' : 'Arah aliran dibalik (Hulu ↔ Hilir).');
    },
    onUpdateEditingCoords: (coords: [number, number][]) => {
      setEditingWaterway(prev => (prev ? { ...prev, coordinates: coords } : prev));
    },
    onCancelWaterwayEdit: () => {
      setEditingWaterway(null);
      if (opts.activeTool === 'redrawWaterway') {
        opts.setActiveTool(null);
        opts.setDrawVertices([]);
      }
    },
    onSaveWaterway: async (draft: ActiveEditingWaterway, reason: string) => {
      try {
        if (draft.id) {
          await updateWaterway(
            draft.id,
            {
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
            },
            regionId
          );
        } else {
          await createWaterway(
            {
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
            },
            regionId
          );
        }
        setEditingWaterway(null);
        await refreshSqliteState();
        opts.notify(
          opts.lang === 'en' ? 'Waterway saved & logged.' : 'Jalur sungai tersimpan & dicatat di Riwayat.'
        );
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Save failed');
      }
    },
    onDeleteWaterway: async (id: string, reason: string) => {
      try {
        await deleteWaterway(id, { actor: actorName, reason }, regionId);
        setEditingWaterway(null);
        await refreshSqliteState();
        opts.notify(opts.lang === 'en' ? 'Waterway removed & logged.' : 'Jalur dihapus & dicatat di Riwayat.');
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    onRestoreDem: async (segId: string) => {
      try {
        await restoreDemSegment(segId, { actor: actorName, reason: 'Pulihkan segmen DEM' }, regionId);
        await refreshSqliteState();
        opts.notify(opts.lang === 'en' ? `Restored ${segId}` : `Segmen ${segId} dipulihkan`);
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Restore failed');
      }
    },
    onRecomputeHydrology: handleRecomputeHydrology,
    onFlyToWaterway: (feat: VerifiedWaterwayFeature) => {
      const mid = feat.geometry.coordinates[Math.floor(feat.geometry.coordinates.length / 2)];
      if (mid) opts.flyTo(mid, { zoom: 15.6 });
    },
    onStartPlaceStructure: () => {
      setEditingStructure(null);
      opts.setActiveTool(prev => (prev === 'placeStructure' ? null : 'placeStructure'));
    },
    onStartEditStructure: (feat: VerifiedStructureFeature) => {
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
      opts.flyTo(feat.geometry.coordinates, { zoom: 16.0 });
    },
    onCancelStructureEdit: () => {
      setEditingStructure(null);
      if (opts.activeTool === 'placeStructure') opts.setActiveTool(null);
    },
    onSaveStructure: async (draft: ActiveEditingStructure, reason: string) => {
      try {
        if (draft.id) {
          await updateStructure(
            draft.id,
            {
              name: draft.name,
              kind: draft.kind,
              status: draft.status,
              size_note: draft.sizeNote,
              notes: draft.notes,
              coordinates: draft.coordinates,
              actor: actorName,
              reason
            },
            regionId
          );
        } else {
          await createStructure(
            {
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
            },
            regionId
          );
        }
        setEditingStructure(null);
        await refreshSqliteState();
        opts.notify(
          opts.lang === 'en'
            ? 'Structure saved & logged.'
            : 'Titik gorong-gorong tersimpan & dicatat di Riwayat.'
        );
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Save failed');
      }
    },
    onDeleteStructure: async (id: string, reason: string) => {
      try {
        await deleteStructure(id, { actor: actorName, reason }, regionId);
        setEditingStructure(null);
        await refreshSqliteState();
        opts.notify(opts.lang === 'en' ? 'Structure removed & logged.' : 'Titik dihapus & dicatat di Riwayat.');
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    onFlyToStructure: (feat: VerifiedStructureFeature) => {
      opts.flyTo(feat.geometry.coordinates, { zoom: 16.0 });
    },
    onStartDrawJorong: () => {
      setEditingJorong(null);
      opts.setDrawVertices([]);
      opts.setActiveTool(prev => (prev === 'drawJorong' ? null : 'drawJorong'));
    },
    onImportJorongPolygon: (name: string, ring: [number, number][]) => {
      setEditingJorong({
        id: null,
        name,
        status: 'indicative',
        sourceNote: 'Impor GeoJSON',
        coordinates: ring
      });
      const mid = ring[Math.floor(ring.length / 2)];
      if (mid) opts.flyTo(mid, { zoom: 14.8 });
    },
    onStartEditJorong: (feat: JorongBoundaryFeature) => {
      const ring = feat.geometry.coordinates[0] || [];
      setEditingJorong({
        id: feat.properties.id,
        name: feat.properties.name,
        status: feat.properties.status,
        sourceNote: feat.properties.source_note,
        coordinates: ring.map(c => [c[0], c[1]])
      });
      const mid = ring[Math.floor(ring.length / 2)];
      if (mid) opts.flyTo(mid, { zoom: 14.8 });
    },
    onCancelJorongEdit: () => {
      setEditingJorong(null);
      if (opts.activeTool === 'drawJorong') {
        opts.setActiveTool(null);
        opts.setDrawVertices([]);
      }
    },
    onSaveJorong: async (draft: ActiveEditingJorong, reason: string) => {
      try {
        if (draft.id) {
          await updateJorongBoundary(
            draft.id,
            {
              name: draft.name,
              status: draft.status,
              source_note: draft.sourceNote,
              coordinates: draft.coordinates,
              actor: actorName,
              reason
            },
            regionId
          );
        } else {
          await createJorongBoundary(
            {
              name: draft.name,
              status: draft.status,
              source_note: draft.sourceNote,
              coordinates: draft.coordinates,
              actor: actorName,
              reason
            },
            regionId
          );
        }
        setEditingJorong(null);
        await refreshSqliteState();
        opts.notify(
          opts.lang === 'en' ? 'Jorong boundary saved & logged.' : 'Batas Jorong tersimpan & dicatat.'
        );
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Save failed');
      }
    },
    onDeleteJorong: async (id: string, reason: string) => {
      try {
        await deleteJorongBoundary(id, { actor: actorName, reason }, regionId);
        setEditingJorong(null);
        await refreshSqliteState();
        opts.notify(opts.lang === 'en' ? 'Jorong boundary removed.' : 'Batas Jorong dihapus.');
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    onFlyToJorong: (feat: JorongBoundaryFeature) => {
      const ring = feat.geometry.coordinates[0] || [];
      const mid = ring[Math.floor(ring.length / 2)];
      if (mid) opts.flyTo(mid, { zoom: 14.8 });
    },
    onRevertAuditLog: async (logId: number) => {
      try {
        await revertAuditLog(
          logId,
          {
            actor: actorName,
            reason: opts.lang === 'en' ? `Revert log #${logId}` : `Pulihkan perubahan #${logId}`
          },
          regionId
        );
        setEditingWaterway(null);
        setEditingStructure(null);
        setEditingJorong(null);
        await refreshSqliteState();
        opts.notify(opts.lang === 'en' ? `Reverted #${logId}` : `Perubahan #${logId} berhasil dipulihkan`);
      } catch (err) {
        opts.notify(err instanceof Error ? err.message : 'Revert failed');
      }
    },
    onFlyToAuditLog: (log: AuditLogEntry) => {
      const snap = (log.after || log.before) as {
        coordinates?: [number, number][] | [number, number];
        lng?: number;
        lat?: number;
      } | null;
      if (snap) {
        if (typeof snap.lng === 'number' && typeof snap.lat === 'number') {
          opts.flyTo([snap.lng, snap.lat], { zoom: 16.0 });
        } else if (Array.isArray(snap.coordinates) && snap.coordinates.length > 0) {
          if (typeof snap.coordinates[0] === 'number' && typeof snap.coordinates[1] === 'number') {
            opts.flyTo(snap.coordinates as [number, number], { zoom: 16.0 });
          } else {
            const line = snap.coordinates as [number, number][];
            const mid = line[Math.floor(line.length / 2)];
            if (mid) opts.flyTo(mid, { zoom: 15.6 });
          }
        }
      }
    }
  };

  return {
    editorSubTab,
    apiAvailable,
    requiresPassphrase,
    editorUnlocked,
    setEditorUnlocked,
    unlockModalOpen,
    setUnlockModalOpen,
    actorName,
    setActorName,
    verifiedWaterways,
    verifiedStructures,
    jorongBoundaries,
    suppressedDem,
    suppressedDemIds,
    verifiedIssueCount,
    editingWaterway,
    setEditingWaterway,
    editingStructure,
    setEditingStructure,
    editingJorong,
    mapEditingWaterway,
    mapEditingStructure,
    auditLogs,
    dataVersion,
    editorHydrated,
    hydroStatus,
    recomputingHydro,
    resetEditorForSimpleMode,
    selectWaterwayFromMap,
    selectStructureFromMap,
    verifyCrossingFromMap,
    promoteDemSegmentFromMap,
    promoteRbiRiverFromMap,
    redrawDemSegmentFromMap,
    suppressDemSegmentFromMap,
    finishDrawing,
    editorTabActions
  };
}
