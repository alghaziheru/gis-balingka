import { History, Waves } from 'lucide-react';
import { I18N } from '../i18n/translations';
import { AuditLogPanel } from './AuditLogPanel';
import { WaterwayEditorPanel, type ActiveEditingWaterway } from './WaterwayEditorPanel';
import type {
  ActiveTool,
  AuditLogEntry,
  Language,
  SuppressedDemSegment,
  VerifiedWaterwayFeature
} from '../types/gis';

export type EditorSubTab = 'waterways' | 'audit';

interface EditorTabProps {
  lang: Language;
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
  suppressedDem: SuppressedDemSegment[];
  editingWaterway: ActiveEditingWaterway | null;
  onStartDrawWaterway: () => void;
  onStartEditWaterway: (feature: VerifiedWaterwayFeature) => void;
  onUpdateEditingCoords: (coords: [number, number][]) => void;
  onCancelWaterwayEdit: () => void;
  onSaveWaterway: (draft: ActiveEditingWaterway, reason: string) => Promise<void>;
  onDeleteWaterway: (id: string, reason: string) => Promise<void>;
  onRestoreDem: (segId: string) => Promise<void>;
  onFlyToWaterway: (feature: VerifiedWaterwayFeature) => void;
  auditLogs: AuditLogEntry[];
  onRevertAuditLog: (logId: number) => Promise<void>;
  onFlyToAuditLog: (log: AuditLogEntry) => void;
}

export function EditorTab({
  lang,
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
  suppressedDem,
  editingWaterway,
  onStartDrawWaterway,
  onStartEditWaterway,
  onUpdateEditingCoords,
  onCancelWaterwayEdit,
  onSaveWaterway,
  onDeleteWaterway,
  onRestoreDem,
  onFlyToWaterway,
  auditLogs,
  onRevertAuditLog,
  onFlyToAuditLog
}: EditorTabProps) {
  const t = I18N[lang];

  const subTabs: [EditorSubTab, string, typeof Waves][] = [
    ['waterways', t.subWaterways, Waves],
    ['audit', t.subAudit, History]
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
        {subTabs.map(([id, label, Icon]) => {
          const active = subTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeSubTab(id)}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-bold transition ${
                active ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {subTab === 'waterways' && (
        <WaterwayEditorPanel
          lang={lang}
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
          onStartDrawNew={onStartDrawWaterway}
          onStartEditExisting={onStartEditWaterway}
          onUpdateDraftCoords={onUpdateEditingCoords}
          onCancelEdit={onCancelWaterwayEdit}
          onSaveWaterway={onSaveWaterway}
          onDeleteWaterway={onDeleteWaterway}
          onRestoreDem={onRestoreDem}
          onFlyToWaterway={onFlyToWaterway}
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
