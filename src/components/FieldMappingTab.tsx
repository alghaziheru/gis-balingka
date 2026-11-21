import { useState, type FormEvent } from 'react';
import { Crosshair, History, Info, MapPin, MessageSquarePlus, Pencil, Route, Trash2, Waves } from 'lucide-react';
import { I18N } from '../i18n/translations';
import { parseImportedGeoJSON } from '../lib/storage';
import { AuditLogPanel } from './AuditLogPanel';
import { SuggestionBoxPanel } from './SuggestionBoxPanel';
import { WaterwayEditorPanel, type ActiveEditingWaterway } from './WaterwayEditorPanel';
import type {
  ActiveTool,
  AuditLogEntry,
  CitizenSuggestion,
  CommunityFeature,
  DrainageStatus,
  FeatureCategory,
  Language,
  SuggestionStatus,
  SuppressedDemSegment,
  VerifiedWaterwayFeature
} from '../types/gis';

export type FieldSubTab = 'waterways' | 'points' | 'audit' | 'suggestions';

interface FieldMappingTabProps {
  lang: Language;
  subTab: FieldSubTab;
  onChangeSubTab: (sub: FieldSubTab) => void;
  activeTool: ActiveTool;
  features: CommunityFeature[];
  draftGeom: CommunityFeature['geometry'] | null;
  getElevation: (lng: number, lat: number) => number;
  onToggleTool: (tool: 'addPoint' | 'drawLine') => void;
  onUseGps: () => void;
  onClearDraftGeom: () => void;
  onSaveFeature: (feature: CommunityFeature, isEdit: boolean) => void;
  onDeleteFeature: (id: string) => void;
  onFlyToFeature: (feature: CommunityFeature) => void;
  onImportFeatures: (imported: CommunityFeature[]) => void;
  onClearAll: () => void;
  onNotify: (msg: string) => void;
  // 2-Layer Waterways + SQLite Audit Trail + Suggestions
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
  suggestions: CitizenSuggestion[];
  suggestionPin: [number, number] | null;
  onTogglePickSuggestionPin: () => void;
  onClearSuggestionPin: () => void;
  onSubmitSuggestion: (payload: {
    reporter_name: string;
    contact: string;
    category: string;
    location_name: string;
    message: string;
    lng: number | null;
    lat: number | null;
  }) => Promise<void>;
  onUpdateSuggestionStatus: (id: number, status: SuggestionStatus, resolution_note: string) => Promise<void>;
  onFlyToCoords: (coords: [number, number]) => void;
}

export function FieldMappingTab({
  lang,
  subTab,
  onChangeSubTab,
  activeTool,
  features,
  draftGeom,
  getElevation,
  onToggleTool,
  onUseGps,
  onClearDraftGeom,
  onSaveFeature,
  onDeleteFeature,
  onFlyToFeature,
  onImportFeatures,
  onClearAll,
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
  onFlyToAuditLog,
  suggestions,
  suggestionPin,
  onTogglePickSuggestionPin,
  onClearSuggestionPin,
  onSubmitSuggestion,
  onUpdateSuggestionStatus,
  onFlyToCoords
}: FieldMappingTabProps) {
  const t = I18N[lang];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<FeatureCategory>('drainage');
  const [status, setStatus] = useState<DrainageStatus>('clogged');
  const [notes, setNotes] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draftGeom) {
      onNotify(t.toastNeedCoords);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;

    const feature: CommunityFeature = {
      type: 'Feature',
      properties: {
        id: editingId || `cf-${Date.now()}`,
        name: trimmed,
        category,
        status,
        notes: notes.trim(),
        createdAt: new Date().toISOString()
      },
      geometry: draftGeom
    };

    onSaveFeature(feature, Boolean(editingId));
    setEditingId(null);
    setName('');
    setNotes('');
    onClearDraftGeom();
    onNotify(t.toastSaved);
  };

  const handleExport = () => {
    const fc = {
      type: 'FeatureCollection',
      name: 'nagari-balingka-field-mapping',
      features
    };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'balingka-field-mapping.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onNotify(t.toastExported);
  };

  const statusBadge: Record<DrainageStatus, string> = {
    normal: 'bg-[#059669]/12 text-[#065f46]',
    clogged: 'bg-[#d97706]/14 text-[#92400e]',
    damaged: 'bg-[#ea580c]/14 text-[#9a3412]',
    critical: 'bg-[#dc2626]/14 text-[#991b1b]'
  };

  const subTabs: [FieldSubTab, string, typeof Waves][] = [
    ['waterways', t.subWaterways, Waves],
    ['points', t.subPoints, MapPin],
    ['audit', t.subAudit, History],
    ['suggestions', t.subSuggest, MessageSquarePlus]
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-1 rounded-[10px] border border-[#12231c]/12 bg-[#eff4f1] p-1">
        {subTabs.map(([id, label, Icon]) => {
          const active = subTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeSubTab(id)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-[7px] px-1 py-1.5 text-center text-[10px] leading-tight font-bold transition ${
                active ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#3f524a] hover:text-[#12231c]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="truncate max-w-full">{label}</span>
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

      {subTab === 'suggestions' && (
        <SuggestionBoxPanel
          lang={lang}
          suggestions={suggestions}
          apiAvailable={apiAvailable}
          editorUnlocked={editorUnlocked}
          suggestionPin={suggestionPin}
          isPickingPin={activeTool === 'pickSuggestion'}
          onTogglePickPin={onTogglePickSuggestionPin}
          onClearPin={onClearSuggestionPin}
          onSubmitSuggestion={onSubmitSuggestion}
          onUpdateStatus={onUpdateSuggestionStatus}
          onFlyToPin={onFlyToCoords}
        />
      )}

      {subTab === 'points' && (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-[#0284c7]/25 bg-[#0284c7]/10 p-2.5 text-[11.5px] text-[#0c4a6e]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t.fieldHint}</span>
          </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.fieldCaptureTitle}
        </div>

        <div className="mb-1.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onToggleTool('addPoint')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-bold transition ${
              activeTool === 'addPoint'
                ? 'border-[#0369a1] bg-[#0284c7] text-white'
                : 'border-[#12231c]/15 bg-white hover:bg-[#eff4f1]'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            <span>{t.btnAddPoint}</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleTool('drawLine')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-bold transition ${
              activeTool === 'drawLine'
                ? 'border-[#0369a1] bg-[#0284c7] text-white'
                : 'border-[#12231c]/15 bg-white hover:bg-[#eff4f1]'
            }`}
          >
            <Route className="h-3.5 w-3.5" />
            <span>{t.btnDrawLine}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onUseGps}
          className="mb-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#12231c]/15 bg-white px-2.5 py-2 text-xs font-bold hover:bg-[#eff4f1]"
        >
          <Crosshair className="h-3.5 w-3.5" />
          <span>{t.btnUseGps}</span>
        </button>

        {draftGeom && (
          <div className="font-mono-num mb-2.5 rounded-lg border border-[#059669]/30 bg-[#059669]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#064e3b]">
            {draftGeom.type === 'Point'
              ? `Point: ${draftGeom.coordinates[1].toFixed(5)}, ${draftGeom.coordinates[0].toFixed(5)} (~${Math.round(
                  getElevation(draftGeom.coordinates[0], draftGeom.coordinates[1])
                )} mdpl)`
              : `LineString: ${draftGeom.coordinates.length} vertices`}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="f-name">
              {t.lblFName}
            </label>
            <input
              id="f-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="cth. Gorong-gorong Simpang Pahambatan"
              className="w-full rounded-lg border border-[#12231c]/20 bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0284c7]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="f-cat">
                {t.lblFCat}
              </label>
              <select
                id="f-cat"
                value={category}
                onChange={e => setCategory(e.target.value as FeatureCategory)}
                className="w-full rounded-lg border border-[#12231c]/20 bg-white px-2 py-1.5 text-[12px]"
              >
                <option value="drainage">Drainase / Gorong</option>
                <option value="floodmark">Tanda Banjir Nov 2025</option>
                <option value="landslide">Longsor / Tebing</option>
                <option value="mitigation">Bronjong / Cekdam</option>
                <option value="evacuation">Titik Evakuasi</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="f-status">
                {t.lblFStatus}
              </label>
              <select
                id="f-status"
                value={status}
                onChange={e => setStatus(e.target.value as DrainageStatus)}
                className="w-full rounded-lg border border-[#12231c]/20 bg-white px-2 py-1.5 text-[12px]"
              >
                <option value="normal">Normal</option>
                <option value="clogged">Tersumbat</option>
                <option value="damaged">Rusak</option>
                <option value="critical">Kritis</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="f-notes">
              {t.lblFNotes}
            </label>
            <textarea
              id="f-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="cth. Sedimentasi pasir & ranting menutup ±60% lubang gorong-gorong"
              className="w-full rounded-lg border border-[#12231c]/20 bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0284c7]"
            />
          </div>

          <div className="flex gap-1.5">
            <button
              type="submit"
              className="flex-1 rounded-lg border border-[#0369a1] bg-[#0284c7] py-2 text-xs font-bold text-white hover:bg-[#0369a1]"
            >
              {t.btnSaveField}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setName('');
                setNotes('');
                onClearDraftGeom();
              }}
              className="rounded-lg border border-[#12231c]/15 bg-white px-3 py-2 text-xs font-bold hover:bg-[#eff4f1]"
            >
              {t.reset}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
            {t.savedFieldTitle}
          </span>
          <span className="font-mono-num text-[11.5px] font-bold">{features.length}</span>
        </div>

        <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
          {features.length === 0 ? (
            <p className="m-0 py-1 text-[11.5px] text-[#64776f]">{t.savedEmpty}</p>
          ) : (
            features.map(f => (
              <div
                key={f.properties.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[#12231c]/10 bg-[#eff4f1] px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-[#12231c]">
                    {f.geometry.type === 'Point' ? '● ' : '〰 '}
                    {f.properties.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[#64776f]">
                    <span className={`rounded-full px-1.5 py-0.2 font-bold ${statusBadge[f.properties.status]}`}>
                      {f.properties.status}
                    </span>
                    <span>{f.properties.category}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onFlyToFeature(f)}
                    className="rounded-md border border-[#12231c]/15 bg-white px-1.5 py-1 text-[11px] font-bold hover:bg-[#e5ede8]"
                    title="Zoom"
                  >
                    ⌖
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(f.properties.id);
                      setName(f.properties.name);
                      setCategory(f.properties.category);
                      setStatus(f.properties.status);
                      setNotes(f.properties.notes);
                    }}
                    className="rounded-md border border-[#12231c]/15 bg-white p-1 hover:bg-[#e5ede8]"
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFeature(f.properties.id)}
                    className="rounded-md border border-[#dc2626]/30 bg-[#fff5f5] p-1 text-[#dc2626] hover:bg-[#dc2626]/12"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg border border-[#12231c]/15 bg-white py-1.5 text-xs font-bold hover:bg-[#eff4f1]"
          >
            {t.btnExport}
          </button>
          <label className="cursor-pointer rounded-lg border border-[#12231c]/15 bg-white py-1.5 text-center text-xs font-bold hover:bg-[#eff4f1]">
            <span>{t.btnImport}</span>
            <input
              type="file"
              accept=".geojson,.json,application/json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const imported = parseImportedGeoJSON(String(reader.result || ''));
                    onImportFeatures(imported);
                    onNotify(`${t.toastImported} (${imported.length})`);
                  } catch {
                    onNotify('Invalid GeoJSON');
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              setTimeout(() => setConfirmClear(false), 4000);
              return;
            }
            setConfirmClear(false);
            onClearAll();
            onNotify(t.toastCleared);
          }}
          className="mt-2 w-full rounded-lg border border-[#dc2626]/35 bg-[#fff5f5] py-1.5 text-[11.5px] font-bold text-[#dc2626] hover:bg-[#dc2626]/12"
        >
          {confirmClear ? t.btnClearConfirm : t.btnClearLocal}
        </button>
      </div>
        </>
      )}
    </div>
  );
}
