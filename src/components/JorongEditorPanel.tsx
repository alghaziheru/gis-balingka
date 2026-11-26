import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Crosshair, Lock, Map, Pencil, Trash2, Unlock, Upload } from 'lucide-react';
import { useActiveRegion, useT } from '../context/RegionContext';
import type { JorongBoundaryFeature, JorongBoundaryStatus, Language } from '../types/gis';

export interface ActiveEditingJorong {
  id: string | null;
  name: string;
  status: JorongBoundaryStatus;
  sourceNote: string;
  coordinates: [number, number][];
}

interface JorongEditorPanelProps {
  lang: Language;
  apiAvailable: boolean;
  editorUnlocked: boolean;
  requiresPassphrase: boolean;
  actorName: string;
  onChangeActorName: (name: string) => void;
  onOpenUnlock: () => void;
  onLockEditor: () => void;
  boundaries: JorongBoundaryFeature[];
  editingJorong: ActiveEditingJorong | null;
  isDrawing: boolean;
  onStartDraw: () => void;
  onImportPolygon: (name: string, ring: [number, number][]) => void;
  onStartEditExisting: (feature: JorongBoundaryFeature) => void;
  onCancelEdit: () => void;
  onSaveJorong: (draft: ActiveEditingJorong, reason: string) => Promise<void>;
  onDeleteJorong: (id: string, reason: string) => Promise<void>;
  onFlyToJorong: (feature: JorongBoundaryFeature) => void;
  onNotify: (msg: string) => void;
}

export function JorongEditorPanel({
  lang,
  apiAvailable,
  editorUnlocked,
  requiresPassphrase,
  actorName,
  onChangeActorName,
  onOpenUnlock,
  onLockEditor,
  boundaries,
  editingJorong,
  isDrawing,
  onStartDraw,
  onImportPolygon,
  onStartEditExisting,
  onCancelEdit,
  onSaveJorong,
  onDeleteJorong,
  onFlyToJorong,
  onNotify
}: JorongEditorPanelProps) {
  const region = useActiveRegion();
  const JORONG_SUGGESTIONS = region.subRegionSuggestions;
  const t = useT(lang);
  const isEn = lang === 'en';
  const [name, setName] = useState('');
  const [status, setStatus] = useState<JorongBoundaryStatus>('indicative');
  const [sourceNote, setSourceNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingJorong) return;
    setName(editingJorong.name);
    setStatus(editingJorong.status);
    setSourceNote(editingJorong.sourceNote);
    setReason('');
  }, [editingJorong?.id, editingJorong?.coordinates?.length]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingJorong || !name.trim() || editingJorong.coordinates.length < 3) return;
    setBusy(true);
    try {
      await onSaveJorong(
        {
          ...editingJorong,
          name: name.trim(),
          status,
          sourceNote: sourceNote.trim()
        },
        reason.trim()
      );
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  const handleFileImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text()) as {
        type?: string;
        features?: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }>;
        geometry?: { type?: string; coordinates?: unknown };
        properties?: Record<string, unknown>;
      };
      const feat =
        json.type === 'FeatureCollection'
          ? json.features?.find(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
          : json.type === 'Feature'
          ? json
          : null;
      if (!feat?.geometry) {
        throw new Error(isEn ? 'No Polygon found in GeoJSON.' : 'Tidak ditemukan poligon dalam GeoJSON.');
      }
      const rawRing =
        feat.geometry.type === 'MultiPolygon'
          ? (feat.geometry.coordinates as [number, number][][][])[0]?.[0]
          : (feat.geometry.coordinates as [number, number][][])[0];
      if (!Array.isArray(rawRing) || rawRing.length < 3) {
        throw new Error(isEn ? 'Invalid polygon coordinates.' : 'Koordinat poligon tidak valid.');
      }
      const suggestedName = String(
        feat.properties?.name || feat.properties?.JORONG || feat.properties?.NAMA || file.name.replace(/\.(geo)?json$/i, '')
      );
      onImportPolygon(suggestedName, rawRing.map(pt => [Number(pt[0]), Number(pt[1])]));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Import GeoJSON failed');
    }
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

        <p className="mt-2.5 mb-0 text-[12px] leading-relaxed text-[#434d49]">
          {isEn
            ? `Official sub-${region.adminLevelLabel.en.toLowerCase()} ${region.subRegionLabel.en} boundaries are not yet open digitally. Draft indicative polygons here or import GeoJSON from ${region.authorities.localAuthorityShort}.`
            : `Batas resmi antar ${region.subRegionLabel.id} belum tersedia digital terbuka. Gambar poligon indikatif atau impor GeoJSON dari ${region.authorities.localAuthorityShort} untuk disahkan bersama.`}
        </p>

        {editorUnlocked && apiAvailable && (
          <div className="mt-3 flex flex-col gap-2">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="jb-actor">
                {t.editorActorLabel}
              </label>
              <input
                id="jb-actor"
                type="text"
                value={actorName}
                onChange={e => onChangeActorName(e.target.value)}
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={onStartDraw}
                className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition ${
                  isDrawing
                    ? 'border-[#0369a1] bg-[#0369a1] text-white'
                    : 'border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
                }`}
              >
                <Map className="h-3.5 w-3.5" />
                <span>{t.btnDrawJorong}</span>
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-white px-2.5 py-1.5 text-[12px] font-bold text-[#161c1a] hover:bg-[#f2f3ef]"
              >
                <Upload className="h-3.5 w-3.5 text-[#0369a1]" />
                <span>{isEn ? 'Import GeoJSON' : 'Impor GeoJSON'}</span>
              </button>
              <input ref={fileRef} type="file" accept=".geojson,.json" onChange={handleFileImport} className="hidden" />
            </div>
          </div>
        )}
      </section>

      {editingJorong && editorUnlocked && apiAvailable && (
        <section className="rounded-xl border-2 border-[#0369a1] bg-white p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-[13.5px] text-[#0369a1]">
              {editingJorong.id
                ? isEn
                  ? 'Editing Jorong Boundary'
                  : 'Edit Batas Jorong'
                : isEn
                ? 'New Jorong Boundary'
                : 'Batas Jorong Baru'}
            </strong>
            <span className="font-mono-num rounded bg-[#0369a1]/10 px-2 py-0.5 text-[12px] font-bold text-[#0369a1]">
              {editingJorong.coordinates.length} {isEn ? 'pts' : 'titik'}
            </span>
          </div>

          <div className="mb-2.5 flex flex-wrap gap-1">
            {JORONG_SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setName(s)}
                className="rounded-md border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-0.5 text-[11px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
              >
                {s}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="jb-name">
                {isEn ? 'Jorong name' : 'Nama Jorong'}
              </label>
              <input
                id="jb-name"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="cth. Jorong Pahambatan"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13.5px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="jb-status">
                {isEn ? 'Verification status' : 'Status pengesahan'}
              </label>
              <select
                id="jb-status"
                value={status}
                onChange={e => setStatus(e.target.value as JorongBoundaryStatus)}
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-2.5 py-1.5 text-[13px]"
              >
                <option value="indicative">{t.jorongIndicative}</option>
                <option value="verified">{t.jorongVerified}</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="jb-source">
                {isEn ? 'Source / agreement note' : 'Catatan sumber / musyawarah'}
              </label>
              <input
                id="jb-source"
                type="text"
                value={sourceNote}
                onChange={e => setSourceNote(e.target.value)}
                placeholder="cth. Sketsa musyawarah Wali Jorong & Wali Nagari"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="jb-reason">
                {t.wwReasonLabel}
              </label>
              <input
                id="jb-reason"
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="cth. Tambah batas indikatif Jorong Pahambatan"
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13px] outline-none focus:border-[#0369a1]"
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
              <button
                type="button"
                onClick={onCancelEdit}
                className="min-h-[40px] rounded-lg border border-[#161c1a]/15 bg-white px-3 text-[12.5px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
              >
                {isEn ? 'Cancel' : 'Batal'}
              </button>
              {editingJorong.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!editingJorong.id) return;
                    setBusy(true);
                    try {
                      await onDeleteJorong(editingJorong.id, reason.trim() || 'Hapus batas jorong');
                    } finally {
                      setBusy(false);
                    }
                  }}
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
          <span className="text-[13px] font-bold text-[#161c1a]">{t.jorongListTitle}</span>
          <span className="font-mono-num rounded-full border border-[#161c1a]/12 bg-[#f2f3ef] px-2.5 py-0.5 text-[12px] font-bold">
            {boundaries.length}
          </span>
        </div>

        {boundaries.length === 0 ? (
          <p className="m-0 text-[12.5px] text-[#636f6a]">
            {isEn
              ? 'No Jorong boundaries drawn yet.'
              : 'Belum ada batas Jorong yang digambar atau diimpor.'}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-[#161c1a]/10">
            {boundaries.map(b => (
              <div key={b.properties.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-[#161c1a]">{b.properties.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                        b.properties.status === 'verified'
                          ? 'bg-[#047857]/12 text-[#047857]'
                          : 'bg-[#64748b]/12 text-[#475569]'
                      }`}
                    >
                      {b.properties.status === 'verified' ? t.jorongVerified : t.jorongIndicative}
                    </span>
                    <span className="font-mono-num text-[11.5px] text-[#636f6a]">
                      {b.properties.area_ha.toFixed(1)} ha
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onFlyToJorong(b)}
                    aria-label={t.viewMap}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] text-[#434d49] hover:bg-[#f2f3ef]"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                  {editorUnlocked && apiAvailable && (
                    <button
                      type="button"
                      onClick={() => onStartEditExisting(b)}
                      aria-label="Edit Jorong"
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
