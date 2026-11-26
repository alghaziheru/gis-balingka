import { useEffect, useState, type FormEvent } from 'react';
import { Crosshair, Download, Gauge, Lock, MapPinPlus, Pencil, RotateCcw, SlidersHorizontal, Trash2, Unlock } from 'lucide-react';
import { useActiveRegion } from '../context/RegionContext';
import type { CascadeEngine } from '../lib/cascadeEngine';
import { buildFieldSurveyPriorityCsv, triggerBrowserDownload } from '../lib/scenarioExport';
import type {
  CalibrationMarkFeature,
  CalibrationMarkKind,
  CalibrationProfile,
  Language,
  SimNetworkData,
  ValidationMetrics
} from '../types/gis';

export interface ActiveEditingCalibrationMark {
  id: string | null;
  name: string;
  kind: CalibrationMarkKind;
  observedDepthM: number | null;
  rainMmHr: number;
  durationMin: number;
  antecedent5dMm: number;
  notes: string;
  coordinates: [number, number];
}

interface CalibrationEditorPanelProps {
  lang: Language;
  apiAvailable: boolean;
  editorUnlocked: boolean;
  requiresPassphrase: boolean;
  actorName: string;
  onChangeActorName: (name: string) => void;
  onOpenUnlock: () => void;
  onLockEditor: () => void;
  calibrationMarks: CalibrationMarkFeature[];
  calibrationProfile: CalibrationProfile | null;
  validationMetrics: ValidationMetrics;
  cascadeEngine: CascadeEngine | null;
  simNetwork?: SimNetworkData | null;
  editingMark: ActiveEditingCalibrationMark | null;
  isPlacingNew: boolean;
  onStartPlaceNew: () => void;
  onStartEditExisting: (feature: CalibrationMarkFeature) => void;
  onCancelEdit: () => void;
  onSaveMark: (draft: ActiveEditingCalibrationMark, reason: string) => Promise<void>;
  onDeleteMark: (id: string, reason: string) => Promise<void>;
  onFlyToMark: (feature: CalibrationMarkFeature) => void;
  onSaveProfile: (profile: CalibrationProfile, reason: string) => Promise<void>;
  onNotify: (msg: string) => void;
}

export function CalibrationEditorPanel({
  lang,
  apiAvailable,
  editorUnlocked,
  requiresPassphrase,
  actorName,
  onChangeActorName,
  onOpenUnlock,
  onLockEditor,
  calibrationMarks,
  calibrationProfile,
  validationMetrics,
  cascadeEngine,
  simNetwork = null,
  editingMark,
  isPlacingNew,
  onStartPlaceNew,
  onStartEditExisting,
  onCancelEdit,
  onSaveMark,
  onDeleteMark,
  onFlyToMark,
  onSaveProfile,
  onNotify
}: CalibrationEditorPanelProps) {
  const region = useActiveRegion();
  const isEn = lang === 'en';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CalibrationMarkKind>('hwm');
  const [depthStr, setDepthStr] = useState('0.8');
  const [rainStr, setRainStr] = useState('40');
  const [durStr, setDurStr] = useState('180');
  const [p5Str, setP5Str] = useState('120');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [manningMult, setManningMult] = useState<number>(calibrationProfile?.manningMult ?? 1.0);
  const [cnOffset, setCnOffset] = useState<number>(calibrationProfile?.cnOffset ?? 0);
  const [cohesionMult, setCohesionMult] = useState<number>(calibrationProfile?.cohesionMult ?? 1.0);
  const [autoProposal, setAutoProposal] = useState<{
    profile: CalibrationProfile;
    metrics: ValidationMetrics;
    baselineMetrics: ValidationMetrics;
    evaluatedCount: number;
  } | null>(null);

  useEffect(() => {
    setManningMult(calibrationProfile?.manningMult ?? 1.0);
    setCnOffset(calibrationProfile?.cnOffset ?? 0);
    setCohesionMult(calibrationProfile?.cohesionMult ?? 1.0);
  }, [calibrationProfile?.manningMult, calibrationProfile?.cnOffset, calibrationProfile?.cohesionMult]);

  useEffect(() => {
    if (!editingMark) return;
    setName(editingMark.name);
    setKind(editingMark.kind);
    setDepthStr(editingMark.observedDepthM != null ? String(editingMark.observedDepthM) : '');
    setRainStr(String(editingMark.rainMmHr));
    setDurStr(String(editingMark.durationMin));
    setP5Str(String(editingMark.antecedent5dMm));
    setNotes(editingMark.notes);
    setReason('');
  }, [editingMark?.id, editingMark?.coordinates[0], editingMark?.coordinates[1]]);

  const handleSubmitMark = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingMark || !name.trim()) return;
    setBusy(true);
    try {
      const parsedDepth = depthStr.trim() === '' ? null : Number(depthStr);
      await onSaveMark(
        {
          ...editingMark,
          name: name.trim(),
          kind,
          observedDepthM: kind === 'hwm' && parsedDepth !== null && Number.isFinite(parsedDepth) ? parsedDepth : null,
          rainMmHr: Math.max(10, Math.min(250, Number(rainStr) || 80)),
          durationMin: Math.max(15, Math.min(4320, Math.round(Number(durStr) || 180))),
          antecedent5dMm: Math.max(0, Math.min(250, Number(p5Str) || 90)),
          notes: notes.trim()
        },
        reason.trim()
      );
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  const handleAutoCalibrate = () => {
    if (!cascadeEngine) return;
    const res = cascadeEngine.runLocalCalibration();
    setAutoProposal(res);
    setManningMult(res.profile.manningMult);
    setCnOffset(res.profile.cnOffset);
    setCohesionMult(res.profile.cohesionMult);
    onNotify(
      isEn
        ? `Evaluated ${res.evaluatedCount} parameter sets. Review & save calibration profile.`
        : `Mengevaluasi ${res.evaluatedCount} kombinasi parameter. Tinjau lalu simpan profil.`
    );
  };

  const kindLabel: Record<CalibrationMarkKind, string> = isEn
    ? { hwm: 'High-Water Mark', scour: 'Bank Scour', landslide_scar: 'Slope Scar' }
    : { hwm: 'Tanda Tinggi Air', scour: 'Gerusan Tebing', landslide_scar: 'Bekas Longsoran' };

  return (
    <div className="flex flex-col gap-3.5">
      {/* Editor Lock Status */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold ${
              editorUnlocked ? 'bg-[#047857]/12 text-[#047857]' : 'bg-[#b45309]/12 text-[#b45309]'
            }`}
          >
            {editorUnlocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            <span>
              {editorUnlocked
                ? isEn
                  ? 'Editor Unlocked'
                  : 'Mode Editor Aktif'
                : isEn
                  ? 'Editor Locked'
                  : 'Mode Editor Terkunci'}
            </span>
          </div>

          {apiAvailable && requiresPassphrase && !editorUnlocked && (
            <button
              type="button"
              onClick={onOpenUnlock}
              className="min-h-[34px] rounded-lg bg-[#0369a1] px-3 py-1 text-[12px] font-bold text-white hover:bg-[#075985]"
            >
              {isEn ? 'Unlock' : 'Buka Kunci'}
            </button>
          )}
          {apiAvailable && requiresPassphrase && editorUnlocked && (
            <button
              type="button"
              onClick={onLockEditor}
              className="min-h-[34px] rounded-lg border border-[#161c1a]/15 bg-white px-3 py-1 text-[12px] font-semibold text-[#434d49] hover:bg-[#f2f3ef]"
            >
              {isEn ? 'Lock' : 'Kunci'}
            </button>
          )}
        </div>

        {editorUnlocked && apiAvailable && (
          <div className="mt-3 flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="cal-actor">
                {isEn ? 'Recorder / Editor Name' : 'Nama Pencatat / Editor'}
              </label>
              <input
                id="cal-actor"
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
              <span>{isEn ? 'Add Field Benchmark Point' : 'Tambah Titik Benchmark Lapangan'}</span>
            </button>
          </div>
        )}
      </section>

      {/* Regional Parameter Calibration Card */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#161c1a]">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#0369a1]" />
            <span>{isEn ? 'Local Model Calibration' : 'Kalibrasi Parameter Lokal'}</span>
          </div>
          {calibrationProfile && (
            <span className="font-mono-num rounded-full bg-[#0369a1]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#0369a1]">
              {isEn ? 'Active' : 'Aktif'}
            </span>
          )}
        </div>

        <div className="mb-2.5 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-lg bg-[#fafaf8] px-2 py-1.5">
            <div className="text-[10px] text-[#636f6a]">Scour CSI</div>
            <div className="font-mono-num text-[12.5px] font-bold text-[#161c1a]">
              {validationMetrics.scourCsi != null ? `${validationMetrics.scourCsi}%` : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-2 py-1.5">
            <div className="text-[10px] text-[#636f6a]">Agam AUC</div>
            <div className="font-mono-num text-[12.5px] font-bold text-[#161c1a]">
              {validationMetrics.landslideAuc != null ? validationMetrics.landslideAuc.toFixed(2) : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-2 py-1.5">
            <div className="text-[10px] text-[#636f6a]">HWM RMSE</div>
            <div className="font-mono-num text-[12.5px] font-bold text-[#0369a1]">
              {validationMetrics.hwmRmseM != null ? `${validationMetrics.hwmRmseM}m` : '—'}
            </div>
          </div>
        </div>

        {calibrationMarks.length < 3 && (
          <div className="mb-2.5 rounded-lg border border-[#b45309]/25 bg-[#b45309]/8 px-2.5 py-2 text-[11px] leading-snug text-[#78350f]">
            {isEn
              ? 'Sentinel-2 Scour CSI & Agam AUC are spatial pattern sanity checks against a synthetic benchmark storm. Record ≥3 field High-Water Marks (HWM) below for true hydraulic depth calibration.'
              : 'Scour CSI Sentinel-2 & AUC Agam hanya mengecek kecocokan pola spasial terhadap badai uji sintetis. Catat minimal 3 titik Tanda Tinggi Air (HWM) di bawah untuk kalibrasi kedalaman sungai nyata.'}
          </div>
        )}

        <button
          type="button"
          data-testid="download-survey-priority-csv"
          onClick={() => {
            const csv = buildFieldSurveyPriorityCsv(simNetwork);
            triggerBrowserDownload(csv, `${region.id}-field-survey-priority.csv`, 'text/csv;charset=utf-8');
            onNotify(
              isEn
                ? 'Downloaded prioritized culvert & river field survey sheet (CSV).'
                : 'Daftar prioritas survei gorong-gorong & penampang sungai (CSV) diunduh.'
            );
          }}
          className="mb-3 inline-flex min-h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2.5 py-1.5 text-[11.5px] font-bold text-[#161c1a] transition hover:border-[#0369a1]/40 hover:text-[#0369a1]"
        >
          <Download className="h-3.5 w-3.5 text-[#0369a1]" />
          <span>
            {isEn
              ? 'Download Field Survey Priority Sheet (CSV)'
              : 'Unduh Daftar Prioritas Survei Lapangan (CSV)'}
          </span>
        </button>

        <div className="flex flex-col gap-2 text-[12px]">
          <div className="flex items-center justify-between">
            <label htmlFor="cal-manning" className="font-semibold text-[#434d49]">
              Manning n ×
            </label>
            <span className="font-mono-num font-bold text-[#161c1a]">{manningMult.toFixed(2)}×</span>
          </div>
          <input
            id="cal-manning"
            type="range"
            min={0.7}
            max={1.4}
            step={0.02}
            value={manningMult}
            disabled={!editorUnlocked || !apiAvailable}
            onChange={e => setManningMult(Number(e.target.value))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />

          <div className="flex items-center justify-between">
            <label htmlFor="cal-cn" className="font-semibold text-[#434d49]">
              SCS-CN {isEn ? 'offset' : 'koreksi'}
            </label>
            <span className="font-mono-num font-bold text-[#161c1a]">
              {cnOffset > 0 ? `+${cnOffset}` : cnOffset}
            </span>
          </div>
          <input
            id="cal-cn"
            type="range"
            min={-6}
            max={6}
            step={1}
            value={cnOffset}
            disabled={!editorUnlocked || !apiAvailable}
            onChange={e => setCnOffset(Number(e.target.value))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />

          <div className="flex items-center justify-between">
            <label htmlFor="cal-coh" className="font-semibold text-[#434d49]">
              {isEn ? 'Soil cohesion ×' : 'Kohesi tanah ×'}
            </label>
            <span className="font-mono-num font-bold text-[#161c1a]">{cohesionMult.toFixed(2)}×</span>
          </div>
          <input
            id="cal-coh"
            type="range"
            min={0.75}
            max={1.3}
            step={0.05}
            value={cohesionMult}
            disabled={!editorUnlocked || !apiAvailable}
            onChange={e => setCohesionMult(Number(e.target.value))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />
        </div>

        {autoProposal && (
          <div className="mt-2.5 rounded-lg border border-[#0369a1]/25 bg-[#0369a1]/6 px-2.5 py-2 text-[11.5px] text-[#161c1a]">
            <div className="font-bold text-[#0369a1]">
              {isEn
                ? 'Bounded Solver (50% Spatial Block Holdout)'
                : 'Rekomendasi Kalibrasi (Uji Terpisah 50% Blok Spasial)'}
            </div>
            <div className="font-mono-num mt-0.5 text-[11px] text-[#434d49]">
              n×{autoProposal.profile.manningMult.toFixed(2)} · CN {autoProposal.profile.cnOffset >= 0 ? '+' : ''}
              {autoProposal.profile.cnOffset} · c×{autoProposal.profile.cohesionMult.toFixed(2)}
            </div>
            {autoProposal.metrics.hwmRmseM != null && (
              <div className="font-mono-num mt-0.5 text-[11px] text-[#047857]">
                RMSE: {autoProposal.baselineMetrics.hwmRmseM ?? '—'}m → {autoProposal.metrics.hwmRmseM}m
              </div>
            )}
          </div>
        )}

        {editorUnlocked && apiAvailable && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={handleAutoCalibrate}
              disabled={!cascadeEngine || busy}
              className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#0369a1] bg-white px-2.5 py-1.5 text-[12px] font-bold text-[#0369a1] hover:bg-[#0369a1]/8 disabled:opacity-50"
            >
              <Gauge className="h-3.5 w-3.5" />
              <span>{isEn ? 'Auto-Solve' : 'Cari Optimal'}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSaveProfile(
                    {
                      manningMult,
                      cnOffset,
                      cohesionMult,
                      rmseM: autoProposal?.metrics.hwmRmseM ?? validationMetrics.hwmRmseM,
                      scourCsi: autoProposal?.metrics.scourCsi ?? validationMetrics.scourCsi,
                      landslideAuc: autoProposal?.metrics.landslideAuc ?? validationMetrics.landslideAuc
                    },
                    isEn ? 'Save calibrated regional hydrology parameters' : 'Simpan profil kalibrasi hidrologi wilayah'
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="min-h-[36px] flex-1 rounded-lg bg-[#0369a1] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#075985] disabled:opacity-50"
            >
              {isEn ? 'Save Profile' : 'Simpan Profil'}
            </button>
            <button
              type="button"
              title={isEn ? 'Reset to default (1.0 / 0 / 1.0)' : 'Kembalikan bawaan'}
              onClick={async () => {
                setManningMult(1.0);
                setCnOffset(0);
                setCohesionMult(1.0);
                setAutoProposal(null);
                setBusy(true);
                try {
                  await onSaveProfile(
                    { manningMult: 1.0, cnOffset: 0, cohesionMult: 1.0 },
                    isEn ? 'Reset calibration profile to physical defaults' : 'Reset profil kalibrasi ke bawaan fisik'
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="grid h-[36px] w-[36px] place-items-center rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] text-[#434d49] hover:bg-[#f2f3ef]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* Active Mark Edit Form */}
      {editingMark && editorUnlocked && apiAvailable && (
        <section className="rounded-xl border-2 border-[#0369a1] bg-white p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-[13.5px] text-[#0369a1]">
              {editingMark.id
                ? isEn
                  ? 'Edit Benchmark Mark'
                  : 'Edit Titik Benchmark'
                : isEn
                  ? 'New Field Benchmark Mark'
                  : 'Titik Benchmark Lapangan Baru'}
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
            {editingMark.coordinates[1].toFixed(5)}, {editingMark.coordinates[0].toFixed(5)}
          </div>

          <form onSubmit={handleSubmitMark} className="flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="cm-name">
                {isEn ? 'Location / Mark Name' : 'Nama Lokasi / Tanda'}
              </label>
              <input
                id="cm-name"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isEn ? 'e.g. Culvert wall water mark' : 'cth. Bekas muka air dinding jembatan'}
                className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-3 py-1.5 text-[13px] outline-none focus:border-[#0369a1]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="cm-kind">
                  {isEn ? 'Observation Type' : 'Jenis Pengamatan'}
                </label>
                <select
                  id="cm-kind"
                  value={kind}
                  onChange={e => setKind(e.target.value as CalibrationMarkKind)}
                  className="min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 bg-white px-2 py-1.5 text-[12.5px]"
                >
                  <option value="hwm">{kindLabel.hwm}</option>
                  <option value="scour">{kindLabel.scour}</option>
                  <option value="landslide_scar">{kindLabel.landslide_scar}</option>
                </select>
              </div>
              {kind === 'hwm' && (
                <div>
                  <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="cm-depth">
                    {isEn ? 'Observed Depth (m)' : 'Tinggi Air (m)'}
                  </label>
                  <input
                    id="cm-depth"
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="15"
                    value={depthStr}
                    onChange={e => setDepthStr(e.target.value)}
                    className="font-mono-num min-h-[38px] w-full rounded-lg border border-[#161c1a]/20 px-2.5 py-1.5 text-[13px]"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[#434d49]" htmlFor="cm-rain">
                  {isEn ? 'Rain mm/h' : 'Hujan mm/j'}
                </label>
                <input
                  id="cm-rain"
                  type="number"
                  min={10}
                  max={250}
                  value={rainStr}
                  onChange={e => setRainStr(e.target.value)}
                  className="font-mono-num min-h-[34px] w-full rounded-lg border border-[#161c1a]/20 px-2 py-1 text-[12.5px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[#434d49]" htmlFor="cm-dur">
                  {isEn ? 'Dur (min)' : 'Dur (mnt)'}
                </label>
                <input
                  id="cm-dur"
                  type="number"
                  min={15}
                  max={4320}
                  step={15}
                  value={durStr}
                  onChange={e => setDurStr(e.target.value)}
                  className="font-mono-num min-h-[34px] w-full rounded-lg border border-[#161c1a]/20 px-2 py-1 text-[12.5px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[#434d49]" htmlFor="cm-p5">
                  P5 (mm)
                </label>
                <input
                  id="cm-p5"
                  type="number"
                  min={0}
                  max={250}
                  value={p5Str}
                  onChange={e => setP5Str(e.target.value)}
                  className="font-mono-num min-h-[34px] w-full rounded-lg border border-[#161c1a]/20 px-2 py-1 text-[12.5px]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[#434d49]" htmlFor="cm-notes">
                {isEn ? 'Field Observation Notes' : 'Catatan Pengamatan Lapangan'}
              </label>
              <input
                id="cm-notes"
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={isEn ? 'e.g. Mud line measured on concrete bridge pier' : 'cth. Garis lumpur terukur di pilar jembatan'}
                className="min-h-[36px] w-full rounded-lg border border-[#161c1a]/20 px-2.5 py-1 text-[12.5px]"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="min-h-[38px] flex-1 rounded-lg bg-[#0369a1] py-1.5 text-[13px] font-bold text-white hover:bg-[#075985] disabled:opacity-60"
              >
                {busy ? '...' : isEn ? 'Save Benchmark' : 'Simpan Titik'}
              </button>
              {editingMark.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!editingMark.id) return;
                    setBusy(true);
                    try {
                      await onDeleteMark(editingMark.id, reason.trim() || 'Hapus titik benchmark');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-[#b91c1c]/30 bg-white px-3 text-[#b91c1c] hover:bg-[#b91c1c]/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {/* Recorded Benchmarks List */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#161c1a]">
            {isEn ? 'Field Calibration Marks' : 'Daftar Benchmark Lapangan'}
          </span>
          <span className="font-mono-num rounded-full border border-[#161c1a]/12 bg-[#f2f3ef] px-2.5 py-0.5 text-[12px] font-bold">
            {calibrationMarks.length}
          </span>
        </div>

        {calibrationMarks.length === 0 ? (
          <p className="m-0 rounded-lg border border-dashed border-[#161c1a]/15 bg-[#fafaf8] px-3 py-3.5 text-center text-[12px] text-[#636f6a]">
            {isEn
              ? 'No field calibration points recorded yet. Add High-Water Marks or scour observations to compute local RMSE & improve regional calibration.'
              : 'Belum ada titik benchmark lapangan. Tambahkan tanda tinggi air atau bekas gerusan untuk menghitung RMSE lokal & kalibrasi model.'}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-[#161c1a]/10">
            {calibrationMarks.map(m => (
              <div key={m.properties.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-bold text-[#161c1a]">{m.properties.name}</div>
                  <div className="font-mono-num mt-0.5 text-[11px] text-[#636f6a]">
                    {kindLabel[m.properties.kind]}
                    {m.properties.observed_depth_m != null ? ` · ${m.properties.observed_depth_m}m` : ''}
                    {` · ${m.properties.rain_mm_hr}mm/h`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onFlyToMark(m)}
                    className="grid h-7.5 w-7.5 place-items-center rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] text-[#434d49] hover:bg-[#f2f3ef]"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                  {editorUnlocked && apiAvailable && (
                    <button
                      type="button"
                      onClick={() => onStartEditExisting(m)}
                      className="grid h-7.5 w-7.5 place-items-center rounded-lg border border-[#0369a1]/30 bg-white text-[#0369a1] hover:bg-[#0369a1]/10"
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
