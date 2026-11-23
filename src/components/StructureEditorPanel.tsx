import { useEffect, useState, type FormEvent } from 'react';
import { Crosshair, Lock, MapPinPlus, Pencil, Trash2, Unlock } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type {
  DrainageStatus,
  Language,
  StructureKind,
  StructureSource,
  VerifiedStructureFeature
} from '../types/gis';

export interface ActiveEditingStructure {
  id: string | null;
  name: string;
  kind: StructureKind;
  status: Exclude<DrainageStatus, 'unverified'>;
  source: StructureSource;
  sourceRef?: string | null;
  sizeNote: string;
  notes: string;
  coordinates: [number, number];
}

interface StructureEditorPanelProps {
  lang: Language;
  apiAvailable: boolean;
  editorUnlocked: boolean;
  requiresPassphrase: boolean;
  actorName: string;
  onChangeActorName: (name: string) => void;
  onOpenUnlock: () => void;
  onLockEditor: () => void;
  structures: VerifiedStructureFeature[];
  editingStructure: ActiveEditingStructure | null;
  isPlacingNew: boolean;
  onStartPlaceNew: () => void;
  onStartEditExisting: (feature: VerifiedStructureFeature) => void;
  onCancelEdit: () => void;
  onSaveStructure: (draft: ActiveEditingStructure, reason: string) => Promise<void>;
  onDeleteStructure: (id: string, reason: string) => Promise<void>;
  onFlyToStructure: (feature: VerifiedStructureFeature) => void;
}

export function StructureEditorPanel({
  lang,
  apiAvailable,
  editorUnlocked,
  requiresPassphrase,
  actorName,
  onChangeActorName,
  onOpenUnlock,
  onLockEditor,
  structures,
  editingStructure,
  isPlacingNew,
  onStartPlaceNew,
  onStartEditExisting,
  onCancelEdit,
  onSaveStructure,
  onDeleteStructure,
  onFlyToStructure
}: StructureEditorPanelProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StructureKind>('culvert');
  const [status, setStatus] = useState<Exclude<DrainageStatus, 'unverified'>>('normal');
  const [sizeNote, setSizeNote] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editingStructure) return;
    setName(editingStructure.name);
    setKind(editingStructure.kind);
    setStatus(editingStructure.status);
    setSizeNote(editingStructure.sizeNote);
    setNotes(editingStructure.notes);
    setReason(
      editingStructure.source === 'crossing_promoted'
        ? 'Verifikasi lapangan titik perlintasan jalan–alur'
        : ''
    );
  }, [editingStructure?.id, editingStructure?.sourceRef, editingStructure?.source]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingStructure || !name.trim()) return;
    setBusy(true);
    try {
      await onSaveStructure(
        {
          ...editingStructure,
          name: name.trim(),
          kind,
          status,
          sizeNote: sizeNote.trim(),
          notes: notes.trim()
        },
        reason.trim()
      );
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  const statusPill: Record<string, string> = {
    normal: 'bg-[#047857]/12 text-[#047857]',
    clogged: 'bg-[#b45309]/14 text-[#b45309]',
    damaged: 'bg-[#c2410c]/14 text-[#c2410c]',
    critical: 'bg-[#b91c1c]/14 text-[#b91c1c]'
  };

  const statusLabel: Record<string, string> = {
    normal: t.fNormal,
    clogged: t.fClogged,
    damaged: t.fDamaged,
    critical: t.fCritical
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
              ? 'Read-only preview mode: saving culvert and bridge points is only active when connected to the application server.'
              : 'Mode pratinjau baca saja: fitur penyimpanan titik gorong-gorong hanya aktif saat terhubung ke server aplikasi.'}
          </p>
        )}

        {editorUnlocked && apiAvailable && (
          <div className="mt-3 flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="st-actor">
                {t.editorActorLabel}
              </label>
              <input
                id="st-actor"
                type="text"
                value={actorName}
                onChange={e => onChangeActorName(e.target.value)}
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <button
              type="button"
              onClick={onStartPlaceNew}
              className={`inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-[13px] font-bold transition ${
                isPlacingNew
                  ? 'border-[#0369a1] bg-[#0369a1] text-white'
                  : 'border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
              }`}
            >
              <MapPinPlus className="h-4 w-4" />
              <span>{t.btnAddStructure}</span>
            </button>
          </div>
        )}
      </section>

      {editingStructure && editorUnlocked && apiAvailable && (
        <section className="rounded-xl border-2 border-[#0369a1] bg-white p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-[13.5px] text-[#0369a1]">
              {editingStructure.id
                ? isEn
                  ? 'Edit Culvert / Bridge'
                  : 'Edit Gorong-gorong / Jembatan'
                : isEn
                ? 'Verify / Add Culvert or Bridge'
                : 'Verifikasi / Tambah Titik'}
            </strong>
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-md border border-[#161c1a]/15 bg-white px-2.5 py-1 text-[12px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
            >
              {isEn ? 'Cancel' : 'Batal'}
            </button>
          </div>

          <div className="font-mono-num mb-2.5 rounded-lg bg-[#f2f3ef] px-2.5 py-2 text-[11.5px] text-[#434d49]">
            {editingStructure.coordinates[1].toFixed(5)}, {editingStructure.coordinates[0].toFixed(5)} ·{' '}
            {isEn ? 'Drag pin on map to adjust' : 'Geser pin di peta untuk meluruskan'}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="st-name">
                {t.stNameLabel}
              </label>
              <input
                id="st-name"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="cth. Gorong-gorong Simpang Pahambatan"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="st-kind">
                  {t.stKindLabel}
                </label>
                <select
                  id="st-kind"
                  value={kind}
                  onChange={e => setKind(e.target.value as StructureKind)}
                  className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-2.5 py-1.5 text-[13px]"
                >
                  <option value="culvert">{isEn ? 'Culvert' : 'Gorong-gorong'}</option>
                  <option value="bridge">{isEn ? 'Bridge' : 'Jembatan'}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="st-status">
                  {t.wwStatusLabel}
                </label>
                <select
                  id="st-status"
                  value={status}
                  onChange={e => setStatus(e.target.value as Exclude<DrainageStatus, 'unverified'>)}
                  className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-2.5 py-1.5 text-[13px]"
                >
                  <option value="normal">{t.fNormal}</option>
                  <option value="clogged">{t.fClogged}</option>
                  <option value="damaged">{t.fDamaged}</option>
                  <option value="critical">{t.fCritical}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="st-size">
                {t.stSizeLabel}
              </label>
              <input
                id="st-size"
                type="text"
                value={sizeNote}
                onChange={e => setSizeNote(e.target.value)}
                placeholder="cth. Box 1.2m × 1.0m / Pipa Ø 80cm"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="st-notes">
                {t.lblFNotes}
              </label>
              <input
                id="st-notes"
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="cth. Tertutup ranting saat hujan lebat"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="st-reason">
                {t.wwReasonLabel}
              </label>
              <input
                id="st-reason"
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="cth. Hasil pengecekan lapangan bersama wali jorong"
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
              {editingStructure.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!editingStructure.id) return;
                    setBusy(true);
                    try {
                      await onDeleteStructure(editingStructure.id, reason.trim() || 'Hapus titik dari editor');
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
      )}

      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#161c1a]">{t.stListTitle}</span>
          <span className="font-mono-num rounded-full border border-[#161c1a]/12 bg-[#f2f3ef] px-2.5 py-0.5 text-[12px] font-bold">
            {structures.length}
          </span>
        </div>

        {structures.length === 0 ? (
          <p className="m-0 rounded-lg border border-dashed border-[#161c1a]/15 bg-[#fafaf8] px-3 py-4 text-center text-[12.5px] text-[#636f6a]">
            {isEn
              ? 'No verified culverts or bridges yet. Click "Add Culvert / Bridge Point" or verify an unverified crossing in Drainage.'
              : 'Belum ada gorong-gorong/jembatan terverifikasi. Tambah titik baru atau verifikasi titik abu-abu di tab Drainase.'}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-[#161c1a]/10">
            {structures.map(st => (
              <div key={st.properties.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-[#161c1a]">{st.properties.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                        statusPill[st.properties.status] || statusPill.normal
                      }`}
                    >
                      {statusLabel[st.properties.status] || st.properties.status}
                    </span>
                    <span className="font-mono-num text-[11.5px] text-[#636f6a]">
                      {st.properties.kind === 'bridge'
                        ? isEn
                          ? 'Bridge'
                          : 'Jembatan'
                        : isEn
                        ? 'Culvert'
                        : 'Gorong-gorong'}
                      {st.properties.size_note ? ` · ${st.properties.size_note}` : ''}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onFlyToStructure(st)}
                    title={t.viewMap}
                    aria-label={t.viewMap}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] text-[#434d49] hover:bg-[#f2f3ef]"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                  {editorUnlocked && apiAvailable && (
                    <button
                      type="button"
                      onClick={() => onStartEditExisting(st)}
                      title={isEn ? 'Edit structure' : 'Edit titik'}
                      aria-label={isEn ? 'Edit structure' : 'Edit titik'}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-[#0369a1]/30 bg-white text-[#0369a1] hover:bg-[#0369a1]/10"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
