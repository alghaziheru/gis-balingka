import { History, MapPin, Waves } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { DemClient } from '../lib/demClient';
import { AuditLogPanel } from './AuditLogPanel';
import { StructureEditorPanel, type ActiveEditingStructure } from './StructureEditorPanel';
import { WaterwayEditorPanel, type ActiveEditingWaterway } from './WaterwayEditorPanel';
import type {
  ActiveTool,
  AuditLogEntry,
  HydroStatus,
  Language,
  SuppressedDemSegment,
  VerifiedStructureFeature,
  VerifiedWaterwayFeature
} from '../types/gis';

export type EditorSubTab = 'waterways' | 'structures' | 'audit';

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
  suppressedDem: SuppressedDemSegment[];
  editingWaterway: ActiveEditingWaterway | null;
  editingStructure: ActiveEditingStructure | null;
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
  suppressedDem,
  editingWaterway,
  editingStructure,
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
  onRestoreDem,
  onRecomputeHydrology,
  onFlyToWaterway,
  auditLogs,
  onRevertAuditLog,
  onFlyToAuditLog
}: EditorTabProps) {
  const t = I18N[lang];

  const subTabs: [EditorSubTab, string, typeof Waves][] = [
    ['waterways', t.subWaterways, Waves],
    ['structures', t.subStructures, MapPin],
    ['audit', t.subAudit, History]
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
        {subTabs.map(([id, label, Icon]) => {
          const active = subTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeSubTab(id)}
              className={`flex min-h-[40px] items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-bold whitespace-nowrap transition ${
                active ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
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
