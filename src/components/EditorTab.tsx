import { Gauge, History, Map as MapIcon, MapPin, Waves } from 'lucide-react';
import { useT } from '../context/RegionContext';
import type { CascadeEngine } from '../lib/cascadeEngine';
import type { DemClient } from '../lib/demClient';
import { AuditLogPanel } from './AuditLogPanel';
import { CalibrationEditorPanel, type ActiveEditingCalibrationMark } from './CalibrationEditorPanel';
import { JorongEditorPanel, type ActiveEditingJorong } from './JorongEditorPanel';
import { StructureEditorPanel, type ActiveEditingStructure } from './StructureEditorPanel';
import { WaterwayEditorPanel, type ActiveEditingWaterway } from './WaterwayEditorPanel';
import type {
  ActiveTool,
  AuditLogEntry,
  CalibrationMarkFeature,
  CalibrationProfile,
  HydroStatus,
  JorongBoundaryFeature,
  Language,
  SimNetworkData,
  SuppressedDemSegment,
  ValidationMetrics,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature
} from '../types/gis';

export type EditorSubTab = 'waterways' | 'structures' | 'jorong' | 'calibration' | 'audit';

interface EditorTabProps {
  lang: Language;
  demClient: DemClient | null;
  subTab: EditorSubTab;
  onChangeSubTab: (sub: EditorSubTab) => void;
  activeTool: ActiveTool;
  onNotify: (msg: string) => void;
  apiAvailable: boolean;
  editorUnlocked: boolean;
  requiresPassphrase: boolean;
  actorName: string;
  onChangeActorName: (name: string) => void;
  onOpenUnlock: () => void;
  onLockEditor: () => void;
  verifiedWaterways: VerifiedWaterwayFeature[];
  verifiedStructures: VerifiedStructureFeature[];
  jorongBoundaries: JorongBoundaryFeature[];
  calibrationMarks: CalibrationMarkFeature[];
  calibrationProfile: CalibrationProfile | null;
  validationMetrics: ValidationMetrics;
  cascadeEngine: CascadeEngine | null;
  simNetwork?: SimNetworkData | null;
  suppressedDem: SuppressedDemSegment[];
  editingWaterway: ActiveEditingWaterway | null;
  editingStructure: ActiveEditingStructure | null;
  editingJorong: ActiveEditingJorong | null;
  editingCalibrationMark: ActiveEditingCalibrationMark | null;
  hydroStatus: HydroStatus;
  recomputingHydro: boolean;
  onStartDrawWaterway: () => void;
  onStartEditWaterway: (feature: VerifiedWaterwayFeature) => void;
  onStartRedrawEditing: () => void;
  onFlipEditingDirection: () => void;
  onUpdateEditingCoords: (coords: [number, number][]) => void;
  onCancelWaterwayEdit: () => void;
  onSaveWaterway: (draft: ActiveEditingWaterway, reason: string) => Promise<void>;
  onDeleteWaterway: (id: string, reason: string) => Promise<void>;
  onStartPlaceStructure: () => void;
  onStartEditStructure: (feature: VerifiedStructureFeature) => void;
  onCancelStructureEdit: () => void;
  onSaveStructure: (draft: ActiveEditingStructure, reason: string) => Promise<void>;
  onDeleteStructure: (id: string, reason: string) => Promise<void>;
  onFlyToStructure: (feature: VerifiedStructureFeature) => void;
  onStartDrawJorong: () => void;
  onImportJorongPolygon: (name: string, ring: [number, number][]) => void;
  onStartEditJorong: (feature: JorongBoundaryFeature) => void;
  onCancelJorongEdit: () => void;
  onSaveJorong: (draft: ActiveEditingJorong, reason: string) => Promise<void>;
  onDeleteJorong: (id: string, reason: string) => Promise<void>;
  onFlyToJorong: (feature: JorongBoundaryFeature) => void;
  onStartPlaceCalibrationMark: () => void;
  onStartEditCalibrationMark: (feature: CalibrationMarkFeature) => void;
  onCancelCalibrationMarkEdit: () => void;
  onSaveCalibrationMark: (draft: ActiveEditingCalibrationMark, reason: string) => Promise<void>;
  onDeleteCalibrationMark: (id: string, reason: string) => Promise<void>;
  onFlyToCalibrationMark: (feature: CalibrationMarkFeature) => void;
  onSaveCalibrationProfile: (profile: CalibrationProfile, reason: string) => Promise<void>;
  onRestoreDem: (segId: string) => Promise<void>;
  onRecomputeHydrology: () => Promise<void>;
  onFlyToWaterway: (feature: VerifiedWaterwayFeature) => void;
  auditLogs: AuditLogEntry[];
  onRevertAuditLog: (logId: number) => Promise<void>;
  onFlyToAuditLog: (log: AuditLogEntry) => void;
}

export function EditorTab({
  lang,
  demClient,
  subTab,
  onChangeSubTab,
  activeTool,
  onNotify,
  apiAvailable,
  editorUnlocked,
  requiresPassphrase,
  actorName,
  onChangeActorName,
  onOpenUnlock,
  onLockEditor,
  verifiedWaterways,
  verifiedStructures,
  jorongBoundaries,
  calibrationMarks,
  calibrationProfile,
  validationMetrics,
  cascadeEngine,
  simNetwork = null,
  suppressedDem,
  editingWaterway,
  editingStructure,
  editingJorong,
  editingCalibrationMark,
  hydroStatus,
  recomputingHydro,
  onStartDrawWaterway,
  onStartEditWaterway,
  onStartRedrawEditing,
  onFlipEditingDirection,
  onUpdateEditingCoords,
  onCancelWaterwayEdit,
  onSaveWaterway,
  onDeleteWaterway,
  onStartPlaceStructure,
  onStartEditStructure,
  onCancelStructureEdit,
  onSaveStructure,
  onDeleteStructure,
  onFlyToStructure,
  onStartDrawJorong,
  onImportJorongPolygon,
  onStartEditJorong,
  onCancelJorongEdit,
  onSaveJorong,
  onDeleteJorong,
  onFlyToJorong,
  onStartPlaceCalibrationMark,
  onStartEditCalibrationMark,
  onCancelCalibrationMarkEdit,
  onSaveCalibrationMark,
  onDeleteCalibrationMark,
  onFlyToCalibrationMark,
  onSaveCalibrationProfile,
  onRestoreDem,
  onRecomputeHydrology,
  onFlyToWaterway,
  auditLogs,
  onRevertAuditLog,
  onFlyToAuditLog
}: EditorTabProps) {
  const t = useT(lang);

  const subTabs: [EditorSubTab, string, typeof Waves][] = [
    ['waterways', t.subWaterways, Waves],
    ['structures', t.subStructures, MapPin],
    ['jorong', t.subJorong, MapIcon],
    ['calibration', t.subCalibration, Gauge],
    ['audit', t.subAudit, History]
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-5 gap-1 rounded-xl border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
        {subTabs.map(([id, label, Icon]) => {
          const active = subTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeSubTab(id)}
              className={`flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 text-center text-[10px] leading-tight font-bold transition ${
                active ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-full">{label}</span>
            </button>
          );
        })}
      </div>

      {subTab === 'waterways' && (
        <WaterwayEditorPanel
          lang={lang}
          demClient={demClient}
          apiAvailable={apiAvailable}
          editorUnlocked={editorUnlocked}
          requiresPassphrase={requiresPassphrase}
          actorName={actorName}
          onChangeActorName={onChangeActorName}
          onOpenUnlock={onOpenUnlock}
          onLockEditor={onLockEditor}
          waterways={verifiedWaterways}
          suppressedDem={suppressedDem}
          editingWaterway={editingWaterway}
          isDrawingNew={activeTool === 'drawWaterway'}
          isRedrawing={activeTool === 'redrawWaterway'}
          hydroStatus={hydroStatus}
          recomputingHydro={recomputingHydro}
          onStartDrawNew={onStartDrawWaterway}
          onStartEditExisting={onStartEditWaterway}
          onStartRedrawEditing={onStartRedrawEditing}
          onFlipEditingDirection={onFlipEditingDirection}
          onUpdateDraftCoords={onUpdateEditingCoords}
          onCancelEdit={onCancelWaterwayEdit}
          onSaveWaterway={onSaveWaterway}
          onDeleteWaterway={onDeleteWaterway}
          onRestoreDem={onRestoreDem}
          onRecomputeHydrology={onRecomputeHydrology}
          onFlyToWaterway={onFlyToWaterway}
          onNotify={onNotify}
        />
      )}

      {subTab === 'structures' && (
        <StructureEditorPanel
          lang={lang}
          apiAvailable={apiAvailable}
          editorUnlocked={editorUnlocked}
          requiresPassphrase={requiresPassphrase}
          actorName={actorName}
          onChangeActorName={onChangeActorName}
          onOpenUnlock={onOpenUnlock}
          onLockEditor={onLockEditor}
          structures={verifiedStructures}
          editingStructure={editingStructure}
          isPlacingNew={activeTool === 'placeStructure'}
          onStartPlaceNew={onStartPlaceStructure}
          onStartEditExisting={onStartEditStructure}
          onCancelEdit={onCancelStructureEdit}
          onSaveStructure={onSaveStructure}
          onDeleteStructure={onDeleteStructure}
          onFlyToStructure={onFlyToStructure}
        />
      )}

      {subTab === 'jorong' && (
        <JorongEditorPanel
          lang={lang}
          apiAvailable={apiAvailable}
          editorUnlocked={editorUnlocked}
          requiresPassphrase={requiresPassphrase}
          actorName={actorName}
          onChangeActorName={onChangeActorName}
          onOpenUnlock={onOpenUnlock}
          onLockEditor={onLockEditor}
          boundaries={jorongBoundaries}
          editingJorong={editingJorong}
          isDrawing={activeTool === 'drawJorong'}
          onStartDraw={onStartDrawJorong}
          onImportPolygon={onImportJorongPolygon}
          onStartEditExisting={onStartEditJorong}
          onCancelEdit={onCancelJorongEdit}
          onSaveJorong={onSaveJorong}
          onDeleteJorong={onDeleteJorong}
          onFlyToJorong={onFlyToJorong}
          onNotify={onNotify}
        />
      )}

      {subTab === 'calibration' && (
        <CalibrationEditorPanel
          lang={lang}
          apiAvailable={apiAvailable}
          editorUnlocked={editorUnlocked}
          requiresPassphrase={requiresPassphrase}
          actorName={actorName}
          onChangeActorName={onChangeActorName}
          onOpenUnlock={onOpenUnlock}
          onLockEditor={onLockEditor}
          calibrationMarks={calibrationMarks}
          calibrationProfile={calibrationProfile}
          validationMetrics={validationMetrics}
          cascadeEngine={cascadeEngine}
          simNetwork={simNetwork}
          editingMark={editingCalibrationMark}
          isPlacingNew={activeTool === 'placeCalibrationMark'}
          onStartPlaceNew={onStartPlaceCalibrationMark}
          onStartEditExisting={onStartEditCalibrationMark}
          onCancelEdit={onCancelCalibrationMarkEdit}
          onSaveMark={onSaveCalibrationMark}
          onDeleteMark={onDeleteCalibrationMark}
          onFlyToMark={onFlyToCalibrationMark}
          onSaveProfile={onSaveCalibrationProfile}
          onNotify={onNotify}
        />
      )}

      {subTab === 'audit' && (
        <AuditLogPanel
          lang={lang}
          logs={auditLogs}
          editorUnlocked={editorUnlocked}
          apiAvailable={apiAvailable}
          onRevert={onRevertAuditLog}
          onFlyToLog={onFlyToAuditLog}
        />
      )}
    </div>
  );
}
