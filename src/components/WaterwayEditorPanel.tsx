import { useEffect, useState, type FormEvent } from 'react';
import { Crosshair, Download, Lock, Pencil, Plus, RotateCcw, Trash2, Undo2, Unlock } from 'lucide-react';
import { I18N } from '../i18n/translations';
import { fetchExportBundle } from '../lib/api';
import type {
  DrainageStatus,
  Language,
  SuppressedDemSegment,
  VerifiedWaterwayFeature,
  WaterwayKind,
  WaterwaySource
} from '../types/gis';

export interface ActiveEditingWaterway {
  id: string | null;
  name: string;
  kind: WaterwayKind;
  status: DrainageStatus;
  source: WaterwaySource;
  sourceRef?: string | null;
  notes: string;
  coordinates: [number, number][];
}

interface WaterwayEditorPanelProps {
  lang: Language;
  apiAvailable: boolean;
  editorUnlocked: boolean;
  requiresPassphrase: boolean;
  actorName: string;
  onChangeActorName: (name: string) => void;
  onOpenUnlock: () => void;
  onLockEditor: () => void;
  waterways: VerifiedWaterwayFeature[];
  suppressedDem: SuppressedDemSegment[];
  editingWaterway: ActiveEditingWaterway | null;
  isDrawingNew: boolean;
  onStartDrawNew: () => void;
  onStartEditExisting: (feature: VerifiedWaterwayFeature) => void;
  onUpdateDraftCoords: (coords: [number, number][]) => void;
  onCancelEdit: () => void;
  onSaveWaterway: (draft: ActiveEditingWaterway, reason: string) => Promise<void>;
  onDeleteWaterway: (id: string, reason: string) => Promise<void>;
  onRestoreDem: (segId: string) => Promise<void>;
  onFlyToWaterway: (feature: VerifiedWaterwayFeature) => void;
  onNotify: (msg: string) => void;
}

export function WaterwayEditorPanel({
  lang,
  apiAvailable,
  editorUnlocked,
  requiresPassphrase,
  actorName,
  onChangeActorName,
  onOpenUnlock,
  onLockEditor,
  waterways,
  suppressedDem,
  editingWaterway,
  isDrawingNew,
  onStartDrawNew,
  onStartEditExisting,
  onUpdateDraftCoords,
  onCancelEdit,
  onSaveWaterway,
  onDeleteWaterway,
  onRestoreDem,
  onFlyToWaterway,
  onNotify
}: WaterwayEditorPanelProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WaterwayKind>('stream');
  const [status, setStatus] = useState<DrainageStatus>('normal');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editingWaterway) return;
    setName(editingWaterway.name);
    setKind(editingWaterway.kind);
    setStatus(editingWaterway.status);
    setNotes(editingWaterway.notes);
    setReason(editingWaterway.source === 'dem_promoted' ? 'Promosi & sesuaikan segmen DEM ke lapangan' : '');
  }, [editingWaterway?.id, editingWaterway?.sourceRef, editingWaterway?.source]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingWaterway || editingWaterway.coordinates.length < 2) {
      onNotify(t.toastNeed2Pts);
      return;
    }
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSaveWaterway(
        {
          ...editingWaterway,
          name: name.trim(),
          kind,
          status,
          notes: notes.trim()
        },
        reason.trim()
      );
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadBundle = async () => {
    try {
      const bundle = await fetchExportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'balingka-waterways-audit-bundle.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotify(t.toastExported);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const statusPill: Record<DrainageStatus, string> = {
    normal: 'bg-[#059669]/12 text-[#065f46]',
    clogged: 'bg-[#d97706]/14 text-[#92400e]',
    damaged: 'bg-[#ea580c]/14 text-[#9a3412]',
    critical: 'bg-[#dc2626]/14 text-[#991b1b]'
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Editor Status Banner */}
      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
              editorUnlocked ? 'bg-[#059669]/12 text-[#065f46]' : 'bg-[#d97706]/14 text-[#92400e]'
            }`}
          >
            {editorUnlocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            <span>{editorUnlocked ? t.editorOpenBadge : t.editorLockedBadge}</span>
          </div>

          {apiAvailable && requiresPassphrase && !editorUnlocked && (
            <button
              type="button"
              onClick={onOpenUnlock}
              className="rounded-lg border border-[#0369a1] bg-[#0284c7] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#0369a1]"
            >
              {t.editorUnlockBtn}
            </button>
          )}
          {apiAvailable && requiresPassphrase && editorUnlocked && (
            <button
              type="button"
              onClick={onLockEditor}
              className="rounded-lg border border-[#12231c]/15 bg-white px-2.5 py-1 text-[11px] font-bold text-[#3f524a] hover:bg-[#eff4f1]"
            >
              {t.editorLockBtn}
            </button>
          )}
        </div>

        {!apiAvailable && (
          <p className="mt-2 mb-0 text-[11px] text-[#92400e]">
            {isEn
              ? 'Static read-only preview: run `pnpm run server` alongside Vite to persist SQLite edits & audit logs.'
              : 'Mode pratinjau statis: jalankan `pnpm run server` agar koreksi & audit trail tersimpan ke SQLite.'}
          </p>
        )}

        {editorUnlocked && apiAvailable && (
          <div className="mt-2.5 flex flex-col gap-2">
            <div>
              <label className="mb-1 block text-[10.5px] font-bold text-[#3f524a]" htmlFor="ww-actor">
                {t.editorActorLabel}
              </label>
              <input
                id="ww-actor"
                type="text"
                value={actorName}
                onChange={e => onChangeActorName(e.target.value)}
                className="w-full rounded-lg border border-[#12231c]/18 px-2.5 py-1 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>

            <button
              type="button"
              onClick={onStartDrawNew}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-bold transition ${
                isDrawingNew
                  ? 'border-[#0369a1] bg-[#0284c7] text-white'
                  : 'border-[#12231c]/15 bg-[#eff4f1] text-[#12231c] hover:bg-[#e2ece7]'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.btnDrawWaterway}</span>
            </button>
          </div>
        )}
      </div>

      {/* Active Vertex Editing Card */}
      {editingWaterway && editorUnlocked && apiAvailable && (
        <div className="rounded-[11px] border-2 border-[#0284c7] bg-white p-3 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <strong className="text-xs text-[#0369a1]">
              {editingWaterway.id
                ? isEn
                  ? 'Editing Waterway Vertices'
                  : 'Sedang Mengoreksi Jalur'
                : isEn
                ? 'New / Promoted Waterway'
                : 'Jalur Baru / Promosi DEM'}
            </strong>
            <span className="font-mono-num rounded bg-[#0284c7]/10 px-1.5 py-0.5 text-[10.5px] font-bold text-[#0369a1]">
              {editingWaterway.coordinates.length} pts
            </span>
          </div>

          <p className="mb-2 rounded-lg bg-[#eff4f1] p-2 text-[11px] text-[#3f524a]">{t.wwEditHint}</p>

          <div className="mb-2 flex gap-1.5">
            {editingWaterway.coordinates.length > 2 && (
              <button
                type="button"
                onClick={() => onUpdateDraftCoords(editingWaterway.coordinates.slice(0, -1))}
                className="inline-flex items-center gap-1 rounded-md border border-[#12231c]/15 bg-white px-2 py-1 text-[11px] font-bold text-[#3f524a] hover:bg-[#eff4f1]"
              >
                <Undo2 className="h-3 w-3" />
                <span>{isEn ? 'Pop Last Pt' : 'Hapus Titik Akhir'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-md border border-[#12231c]/15 bg-white px-2 py-1 text-[11px] font-bold text-[#3f524a] hover:bg-[#eff4f1]"
            >
              {isEn ? 'Cancel' : 'Batal'}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="ww-name">
                {t.wwNameLabel}
              </label>
              <input
                id="ww-name"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="cth. Batang Ngalai"
                className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="ww-kind">
                  {t.wwKindLabel}
                </label>
                <select
                  id="ww-kind"
                  value={kind}
                  onChange={e => setKind(e.target.value as WaterwayKind)}
                  className="w-full rounded-lg border border-[#12231c]/20 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="river">{isEn ? 'River' : 'Sungai Utama'}</option>
                  <option value="stream">{isEn ? 'Stream / Creek' : 'Anak Sungai'}</option>
                  <option value="canal">{isEn ? 'Irrigation Canal' : 'Bandar / Irigasi'}</option>
                  <option value="drain">{isEn ? 'Roadside Drain' : 'Parit / Drainase'}</option>
                  <option value="culvert">{isEn ? 'Culvert' : 'Gorong-gorong'}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="ww-status">
                  {t.wwStatusLabel}
                </label>
                <select
                  id="ww-status"
                  value={status}
                  onChange={e => setStatus(e.target.value as DrainageStatus)}
                  className="w-full rounded-lg border border-[#12231c]/20 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="normal">{t.fNormal}</option>
                  <option value="clogged">{t.fClogged}</option>
                  <option value="damaged">{t.fDamaged}</option>
                  <option value="critical">{t.fCritical}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="ww-notes">
                {t.lblFNotes}
              </label>
              <input
                id="ww-notes"
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="cth. Lebar ±4m, tebing beton"
                className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-[#3f524a]" htmlFor="ww-reason">
                {t.wwReasonLabel}
              </label>
              <input
                id="ww-reason"
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t.wwReasonPlaceholder}
                className="w-full rounded-lg border border-[#12231c]/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#0284c7]"
              />
            </div>

            <div className="flex gap-1.5 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-lg border border-[#0369a1] bg-[#0284c7] py-2 text-xs font-bold text-white hover:bg-[#0369a1] disabled:opacity-60"
              >
                {busy ? '...' : t.wwSaveBtn}
              </button>
              {editingWaterway.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!editingWaterway.id) return;
                    setBusy(true);
                    try {
                      await onDeleteWaterway(editingWaterway.id, reason.trim() || 'Hapus jalur dari editor');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  title={t.wwDeleteBtn}
                  className="inline-flex items-center justify-center rounded-lg border border-[#dc2626]/30 bg-white px-2.5 text-[#dc2626] hover:bg-[#dc2626]/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* List of Verified Waterways */}
      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
            {t.wwListTitle}
          </span>
          <span className="font-mono-num rounded-full border border-[#12231c]/12 bg-[#eff4f1] px-2 py-0.5 text-[11px] font-bold">
            {waterways.length}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {waterways.map(w => (
            <div
              key={w.properties.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[#12231c]/12 bg-[#f8faf9] px-2.5 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-[#12231c]">{w.properties.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase ${
                      statusPill[w.properties.status] || statusPill.normal
                    }`}
                  >
                    {w.properties.status}
                  </span>
                  <span className="font-mono-num text-[10.5px] text-[#64776f]">
                    {w.properties.kind} · {w.properties.length_m}m
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onFlyToWaterway(w)}
                  title={t.viewMap}
                  className="grid h-6.5 w-6.5 place-items-center rounded border border-[#12231c]/15 bg-white text-[#3f524a] hover:bg-[#eff4f1]"
                >
                  <Crosshair className="h-3 w-3" />
                </button>
                {editorUnlocked && apiAvailable && (
                  <button
                    type="button"
                    onClick={() => onStartEditExisting(w)}
                    title={isEn ? 'Edit alignment' : 'Koreksi jalur'}
                    className="grid h-6.5 w-6.5 place-items-center rounded border border-[#0284c7]/30 bg-white text-[#0369a1] hover:bg-[#0284c7]/10"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {suppressedDem.length > 0 && (
          <div className="mt-3 border-t border-dashed border-[#12231c]/12 pt-2.5">
            <div className="mb-1.5 text-[10.5px] font-extrabold tracking-wider text-[#64776f] uppercase">
              {t.wwSuppressedTitle} ({suppressedDem.length})
            </div>
            <div className="flex flex-col gap-1">
              {suppressedDem.map(s => (
                <div key={s.seg_id} className="flex items-center justify-between gap-2 rounded bg-[#eff4f1] px-2 py-1 text-[11px]">
                  <span className="font-mono-num truncate text-[#3f524a]">{s.seg_id}</span>
                  {editorUnlocked && apiAvailable && (
                    <button
                      type="button"
                      onClick={() => onRestoreDem(s.seg_id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-[#12231c]/15 bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#12231c] hover:bg-white/80"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      <span>{t.wwRestoreDem}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {apiAvailable && (
          <button
            type="button"
            onClick={handleDownloadBundle}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#12231c]/15 bg-white py-1.5 text-xs font-bold text-[#12231c] hover:bg-[#eff4f1]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t.wwExportBundle}</span>
          </button>
        )}
      </div>
    </div>
  );
}
