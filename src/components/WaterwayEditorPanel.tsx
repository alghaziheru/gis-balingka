import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Crosshair,
  Download,
  Lock,
  Pencil,
  PenTool,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
  Unlock
} from 'lucide-react';
import { useActiveRegion, useT } from '../context/RegionContext';
import { fetchExportBundle } from '../lib/api';
import type { DemClient } from '../lib/demClient';
import type {
  DrainageStatus,
  HydroStatus,
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
  widthPreM?: number | null;
  widthPostM?: number | null;
  depthM?: number | null;
  coordinates: [number, number][];
}

interface WaterwayEditorPanelProps {
  lang: Language;
  demClient: DemClient | null;
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
  isRedrawing: boolean;
  hydroStatus: HydroStatus;
  recomputingHydro: boolean;
  onStartDrawNew: () => void;
  onStartEditExisting: (feature: VerifiedWaterwayFeature) => void;
  onStartRedrawEditing: () => void;
  onFlipEditingDirection: () => void;
  onUpdateDraftCoords: (coords: [number, number][]) => void;
  onCancelEdit: () => void;
  onSaveWaterway: (draft: ActiveEditingWaterway, reason: string) => Promise<void>;
  onDeleteWaterway: (id: string, reason: string) => Promise<void>;
  onRestoreDem: (segId: string) => Promise<void>;
  onRecomputeHydrology: () => Promise<void>;
  onFlyToWaterway: (feature: VerifiedWaterwayFeature) => void;
  onNotify: (msg: string) => void;
}

export function WaterwayEditorPanel({
  lang,
  demClient,
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
  isRedrawing,
  hydroStatus,
  recomputingHydro,
  onStartDrawNew,
  onStartEditExisting,
  onStartRedrawEditing,
  onFlipEditingDirection,
  onUpdateDraftCoords,
  onCancelEdit,
  onSaveWaterway,
  onDeleteWaterway,
  onRestoreDem,
  onRecomputeHydrology,
  onFlyToWaterway,
  onNotify
}: WaterwayEditorPanelProps) {
  const region = useActiveRegion();
  const t = useT(lang);
  const isEn = lang === 'en';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WaterwayKind>('stream');
  const [status, setStatus] = useState<DrainageStatus>('normal');
  const [notes, setNotes] = useState('');
  const [widthPreStr, setWidthPreStr] = useState('');
  const [widthPostStr, setWidthPostStr] = useState('');
  const [depthStr, setDepthStr] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editingWaterway) return;
    setName(editingWaterway.name);
    setKind(editingWaterway.kind);
    setStatus(editingWaterway.status);
    setNotes(editingWaterway.notes);
    setWidthPreStr(editingWaterway.widthPreM != null ? String(editingWaterway.widthPreM) : '');
    setWidthPostStr(editingWaterway.widthPostM != null ? String(editingWaterway.widthPostM) : '');
    setDepthStr(editingWaterway.depthM != null ? String(editingWaterway.depthM) : '');
    setReason(editingWaterway.source === 'dem_promoted' ? 'Verifikasi & sesuaikan segmen DEM ke lapangan' : '');
  }, [editingWaterway?.id, editingWaterway?.sourceRef, editingWaterway?.source]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingWaterway || editingWaterway.coordinates.length < 2) {
      onNotify(t.toastNeed2Pts);
      return;
    }
    if (!name.trim()) return;
    const parseOptM = (s: string): number | null => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : null;
    };
    setBusy(true);
    try {
      await onSaveWaterway(
        {
          ...editingWaterway,
          name: name.trim(),
          kind,
          status,
          notes: notes.trim(),
          widthPreM: parseOptM(widthPreStr),
          widthPostM: parseOptM(widthPostStr),
          depthM: parseOptM(depthStr)
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
      const bundle = await fetchExportBundle(region.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${region.id}-waterways-audit-bundle.json`;
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
    unverified: 'bg-[#64748b]/12 text-[#475569]',
    normal: 'bg-[#047857]/12 text-[#047857]',
    clogged: 'bg-[#b45309]/14 text-[#b45309]',
    damaged: 'bg-[#c2410c]/14 text-[#c2410c]',
    critical: 'bg-[#b91c1c]/14 text-[#b91c1c]'
  };

  const statusLabel: Record<DrainageStatus, string> = {
    unverified: t.fUnverified,
    normal: t.fNormal,
    clogged: t.fClogged,
    damaged: t.fDamaged,
    critical: t.fCritical
  };

  const kindLabel: Record<WaterwayKind, string> = isEn
    ? {
        river: 'River',
        stream: 'Stream',
        canal: 'Canal',
        drain: 'Drain',
        culvert: 'Culvert'
      }
    : {
        river: 'Sungai Utama',
        stream: 'Anak Sungai',
        canal: 'Bandar / Irigasi',
        drain: 'Parit / Drainase',
        culvert: 'Gorong-gorong'
      };

  return (
    <div className="flex flex-col gap-3.5">
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold ${
              editorUnlocked ? 'bg-[#047857]/12 text-[#047857]' : 'bg-[#b45309]/12 text-[#b45309]'
            }`}
          >
            {editorUnlocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            <span>{editorUnlocked ? t.editorOpenBadge : t.editorLockedBadge}</span>
          </div>

          {apiAvailable && requiresPassphrase && !editorUnlocked && (
            <button
              type="button"
              onClick={onOpenUnlock}
              className="min-h-[34px] rounded-lg bg-[#0369a1] px-3 py-1 text-[12px] font-bold text-white hover:bg-[#075985]"
            >
              {t.editorUnlockBtn}
            </button>
          )}
          {apiAvailable && requiresPassphrase && editorUnlocked && (
            <button
              type="button"
              onClick={onLockEditor}
              className="min-h-[34px] rounded-lg border border-[#161c1a]/15 bg-white px-3 py-1 text-[12px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
            >
              {t.editorLockBtn}
            </button>
          )}
        </div>

        {!apiAvailable && (
          <p className="mt-2.5 mb-0 text-[12.5px] text-[#78350f]">
            {isEn
              ? 'Read-only preview mode: saving waterway edits and change history is only active when connected to the application server.'
              : 'Mode pratinjau baca saja: fitur penyimpanan koreksi & riwayat hanya aktif saat terhubung ke server aplikasi.'}
          </p>
        )}

        {editorUnlocked && apiAvailable && (
          <div className="mt-3 flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="ww-actor">
                {t.editorActorLabel}
              </label>
              <input
                id="ww-actor"
                type="text"
                value={actorName}
                onChange={e => onChangeActorName(e.target.value)}
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <button
              type="button"
              onClick={onStartDrawNew}
              className={`inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-[13px] font-bold transition ${
                isDrawingNew
                  ? 'border-[#0369a1] bg-[#0369a1] text-white'
                  : 'border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
              }`}
            >
              <Plus className="h-4 w-4" />
              <span>{t.btnDrawWaterway}</span>
            </button>
          </div>
        )}
      </section>

      {editingWaterway && editorUnlocked && apiAvailable && (() => {
        const coords = editingWaterway.coordinates;
        const hasCoords = coords.length >= 2;
        const startElev = hasCoords && demClient ? Math.round(demClient.getElevation(coords[0][0], coords[0][1])) : null;
        const endElev =
          hasCoords && demClient
            ? Math.round(demClient.getElevation(coords[coords.length - 1][0], coords[coords.length - 1][1]))
            : null;
        const uphillWarning = startElev !== null && endElev !== null && startElev < endElev;

        return (
          <section className="rounded-xl border-2 border-[#0369a1] bg-white p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-[13.5px] text-[#0369a1]">
                {editingWaterway.id
                  ? isEn
                    ? 'Editing Waterway Vertices'
                    : 'Sedang Mengoreksi Jalur'
                  : isEn
                  ? 'New / Verified DEM Waterway'
                  : 'Jalur Baru / Verifikasi Segmen DEM'}
              </strong>
              <span className="font-mono-num rounded bg-[#0369a1]/10 px-2 py-0.5 text-[12px] font-bold text-[#0369a1]">
                {coords.length} {isEn ? 'pts' : 'titik'}
              </span>
            </div>

            {hasCoords && startElev !== null && endElev !== null && (
              <div
                className={`mb-2.5 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-[12px] ${
                  uphillWarning
                    ? 'border-[#b45309]/35 bg-[#b45309]/10 text-[#92400e]'
                    : 'border-[#047857]/25 bg-[#047857]/8 text-[#065f46]'
                }`}
              >
                <span className="font-semibold">{t.wwDirectionSummary}</span>
                <span className="font-mono-num font-bold">
                  {startElev} mdpl → {endElev} mdpl {uphillWarning ? (isEn ? '(Uphill!)' : '(Menanjak!)') : ''}
                </span>
              </div>
            )}

            <p className="mb-2.5 rounded-lg bg-[#f2f3ef] p-2.5 text-[12.5px] text-[#434d49]">{t.wwEditHint}</p>

            <div className="mb-3 flex flex-wrap gap-1.5">
              {hasCoords && (
                <button
                  type="button"
                  onClick={onFlipEditingDirection}
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-[#161c1a]/15 bg-white px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] hover:bg-[#f2f3ef]"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 text-[#0369a1]" />
                  <span>{t.wwFlipDir}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onStartRedrawEditing}
                className={`inline-flex min-h-[34px] items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-semibold transition ${
                  isRedrawing
                    ? 'border-[#0369a1] bg-[#0369a1] text-white'
                    : 'border-[#161c1a]/15 bg-white text-[#161c1a] hover:bg-[#f2f3ef]'
                }`}
              >
                <PenTool className="h-3.5 w-3.5" />
                <span>{t.wwTraceFresh}</span>
              </button>
              {coords.length > 2 && (
                <button
                  type="button"
                  onClick={() => onUpdateDraftCoords(coords.slice(0, -1))}
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-[#161c1a]/15 bg-white px-2.5 py-1 text-[12px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>{isEn ? 'Pop Last Pt' : 'Hapus Titik Akhir'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onCancelEdit}
                className="min-h-[34px] rounded-md border border-[#161c1a]/15 bg-white px-2.5 py-1 text-[12px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
              >
                {isEn ? 'Cancel' : 'Batal'}
              </button>
            </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="ww-name">
                {t.wwNameLabel}
              </label>
              <input
                id="ww-name"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="cth. Batang Ngalai"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="ww-kind">
                  {t.wwKindLabel}
                </label>
                <select
                  id="ww-kind"
                  value={kind}
                  onChange={e => setKind(e.target.value as WaterwayKind)}
                  className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-2.5 py-1.5 text-[13px]"
                >
                  <option value="river">{isEn ? 'River' : 'Sungai Utama'}</option>
                  <option value="stream">{isEn ? 'Stream / Creek' : 'Anak Sungai'}</option>
                  <option value="canal">{isEn ? 'Irrigation Canal' : 'Bandar / Irigasi'}</option>
                  <option value="drain">{isEn ? 'Roadside Drain' : 'Parit / Drainase'}</option>
                  <option value="culvert">{isEn ? 'Culvert' : 'Gorong-gorong'}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="ww-status">
                  {t.wwStatusLabel}
                </label>
                <select
                  id="ww-status"
                  value={status}
                  onChange={e => setStatus(e.target.value as DrainageStatus)}
                  className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-2.5 py-1.5 text-[13px]"
                >
                  <option value="normal">{t.fNormal}</option>
                  <option value="clogged">{t.fClogged}</option>
                  <option value="damaged">{t.fDamaged}</option>
                  <option value="critical">{t.fCritical}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[#434d49]" htmlFor="ww-wpre">
                  {t.lblWidthPre}
                </label>
                <input
                  id="ww-wpre"
                  type="number"
                  step="0.1"
                  min="0.2"
                  max="200"
                  value={widthPreStr}
                  onChange={e => setWidthPreStr(e.target.value)}
                  placeholder="cth. 3.5"
                  className="font-mono-num min-h-[36px] w-full rounded-lg border border-[#161c1a]/20 px-2 py-1 text-[12.5px] outline-none focus:border-[#0369a1]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[#434d49]" htmlFor="ww-wpost">
                  {t.lblWidthPost}
                </label>
                <input
                  id="ww-wpost"
                  type="number"
                  step="0.1"
                  min="0.2"
                  max="200"
                  value={widthPostStr}
                  onChange={e => setWidthPostStr(e.target.value)}
                  placeholder="cth. 7.0"
                  className="font-mono-num min-h-[36px] w-full rounded-lg border border-[#161c1a]/20 px-2 py-1 text-[12.5px] outline-none focus:border-[#0369a1]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[#434d49]" htmlFor="ww-depth">
                  {t.lblDepthM}
                </label>
                <input
                  id="ww-depth"
                  type="number"
                  step="0.1"
                  min="0.2"
                  max="30"
                  value={depthStr}
                  onChange={e => setDepthStr(e.target.value)}
                  placeholder="cth. 1.5"
                  className="font-mono-num min-h-[36px] w-full rounded-lg border border-[#161c1a]/20 px-2 py-1 text-[12.5px] outline-none focus:border-[#0369a1]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="ww-notes">
                {t.lblFNotes}
              </label>
              <input
                id="ww-notes"
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="cth. Lebar ±4m, tebing beton"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="ww-reason">
                {t.wwReasonLabel}
              </label>
              <input
                id="ww-reason"
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t.wwReasonPlaceholder}
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="min-h-[40px] flex-1 rounded-lg bg-[#0369a1] py-2 text-[13px] font-bold text-white hover:bg-[#075985] disabled:opacity-60"
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
                  className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-[#b91c1c]/30 bg-white px-3 text-[#b91c1c] hover:bg-[#b91c1c]/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </form>
        </section>
        );
      })()}

      {apiAvailable && (
        <section
          className={`rounded-xl border p-3.5 ${
            hydroStatus.dirty ? 'border-[#b45309]/40 bg-[#fffbeb]' : 'border-[#161c1a]/12 bg-white'
          }`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-[#161c1a]">{t.hydroCardTitle}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                hydroStatus.dirty
                  ? 'bg-[#b45309]/15 text-[#b45309]'
                  : 'bg-[#047857]/12 text-[#047857]'
              }`}
            >
              {!hydroStatus.dirty && <CheckCircle2 className="h-3 w-3" />}
              <span>{hydroStatus.dirty ? t.hydroDirtyBadge : t.hydroSyncedBadge}</span>
            </span>
          </div>

          <p className="mb-2.5 text-[12px] leading-relaxed text-[#434d49]">{t.hydroRecomputeDesc}</p>

          {(hydroStatus.lastRecomputedAt || hydroStatus.burnedCellCount > 0) && (
            <div className="font-mono-num mb-2.5 text-[11px] text-[#636f6a]">
              {hydroStatus.burnedCellCount > 0
                ? `${hydroStatus.burnedCellCount} ${isEn ? 'adjusted DEM cells' : 'sel DEM disesuaikan'}`
                : ''}
              {hydroStatus.lastRecomputedAt
                ? `${hydroStatus.burnedCellCount > 0 ? ' · ' : ''}${new Date(hydroStatus.lastRecomputedAt).toLocaleString()}`
                : ''}
            </div>
          )}

          {editorUnlocked ? (
            <button
              type="button"
              disabled={recomputingHydro}
              onClick={onRecomputeHydrology}
              className={`inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-bold text-white transition disabled:opacity-60 ${
                hydroStatus.dirty ? 'bg-[#b45309] hover:bg-[#92400e]' : 'bg-[#0369a1] hover:bg-[#075985]'
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${recomputingHydro ? 'animate-spin' : ''}`} />
              <span>{recomputingHydro ? t.hydroRecomputing : t.hydroRecomputeBtn}</span>
            </button>
          ) : (
            <div className="text-[12px] font-medium text-[#636f6a]">
              {isEn
                ? 'Unlock Editor Mode to embed waterways into DEM & recompute flow.'
                : 'Buka Mode Editor untuk menyisipkan jalur sungai ke DEM & menghitung ulang aliran.'}
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#161c1a]">{t.wwListTitle}</span>
          <span className="font-mono-num rounded-full border border-[#161c1a]/12 bg-[#f2f3ef] px-2.5 py-0.5 text-[12px] font-bold">
            {waterways.length}
          </span>
        </div>

        <div className="flex flex-col divide-y divide-[#161c1a]/10">
          {waterways.map(w => (
            <div key={w.properties.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-[#161c1a]">{w.properties.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                      statusPill[w.properties.status] || statusPill.normal
                    }`}
                  >
                    {statusLabel[w.properties.status] || w.properties.status}
                  </span>
                  <span className="font-mono-num text-[11.5px] text-[#636f6a]">
                    {kindLabel[w.properties.kind] || w.properties.kind} · {w.properties.length_m} m
                    {w.properties.width_post_m ? ` · L=${w.properties.width_post_m} m` : ''}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onFlyToWaterway(w)}
                  title={t.viewMap}
                  aria-label={t.viewMap}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] text-[#434d49] hover:bg-[#f2f3ef]"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
                {editorUnlocked && apiAvailable && (
                  <button
                    type="button"
                    onClick={() => onStartEditExisting(w)}
                    title={isEn ? 'Edit alignment' : 'Koreksi jalur'}
                    aria-label={isEn ? 'Edit alignment' : 'Koreksi jalur'}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[#0369a1]/30 bg-white text-[#0369a1] hover:bg-[#0369a1]/10"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {suppressedDem.length > 0 && (
          <div className="mt-3 border-t border-[#161c1a]/10 pt-3">
            <div className="mb-1.5 text-[12px] font-bold text-[#434d49]">
              {t.wwSuppressedTitle} ({suppressedDem.length})
            </div>
            <div className="flex flex-col gap-1">
              {suppressedDem.map(s => (
                <div key={s.seg_id} className="flex items-center justify-between gap-2 rounded-lg bg-[#f2f3ef] px-2.5 py-1.5 text-[12px]">
                  <span className="font-mono-num truncate text-[#434d49]">{s.seg_id}</span>
                  {editorUnlocked && apiAvailable && (
                    <button
                      type="button"
                      onClick={() => onRestoreDem(s.seg_id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-[#161c1a]/15 bg-white px-2 py-0.5 text-[11px] font-bold text-[#161c1a] hover:bg-[#fafaf8]"
                    >
                      <RotateCcw className="h-3 w-3" />
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
            className="mt-3 inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] py-1.5 text-[12.5px] font-bold text-[#161c1a] hover:bg-[#f2f3ef]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t.wwExportBundle}</span>
          </button>
        )}
      </section>
    </div>
  );
}
