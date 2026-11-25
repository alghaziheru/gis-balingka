import { useState } from 'react';
import { Clock, Crosshair, RotateCcw } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { AuditLogEntry, Language } from '../types/gis';

interface AuditLogPanelProps {
  lang: Language;
  logs: AuditLogEntry[];
  editorUnlocked: boolean;
  apiAvailable: boolean;
  onRevert: (logId: number) => Promise<void>;
  onFlyToLog: (log: AuditLogEntry) => void;
}

const ACTION_BADGE: Record<string, string> = {
  seed: 'bg-[#475569]/12 text-[#334155]',
  import_seed: 'bg-[#475569]/12 text-[#334155]',
  create: 'bg-[#047857]/12 text-[#047857]',
  update: 'bg-[#0369a1]/12 text-[#0369a1]',
  create_structure: 'bg-[#047857]/12 text-[#047857]',
  verify_crossing: 'bg-[#0284c7]/14 text-[#0369a1]',
  update_structure: 'bg-[#0369a1]/12 text-[#0369a1]',
  delete_structure: 'bg-[#b91c1c]/12 text-[#b91c1c]',
  create_jorong: 'bg-[#047857]/12 text-[#047857]',
  update_jorong: 'bg-[#0369a1]/12 text-[#0369a1]',
  delete_jorong: 'bg-[#b91c1c]/12 text-[#b91c1c]',
  create_calibration_mark: 'bg-[#047857]/12 text-[#047857]',
  update_calibration_mark: 'bg-[#0369a1]/12 text-[#0369a1]',
  delete_calibration_mark: 'bg-[#b91c1c]/12 text-[#b91c1c]',
  update_calibration_profile: 'bg-[#0f766e]/12 text-[#0f766e]',
  promote_dem: 'bg-[#0284c7]/14 text-[#0369a1]',
  suppress_dem: 'bg-[#b45309]/14 text-[#b45309]',
  restore_dem: 'bg-[#047857]/12 text-[#047857]',
  delete: 'bg-[#b91c1c]/12 text-[#b91c1c]',
  revert: 'bg-[#0f766e]/12 text-[#115e59]',
  resolve_suggestion: 'bg-[#0f766e]/12 text-[#115e59]',
  recompute_hydrology: 'bg-[#0369a1]/12 text-[#0369a1]'
};

const ACTION_LABEL: Record<string, { id: string; en: string }> = {
  seed: { id: 'Data Awal', en: 'Initial Data' },
  import_seed: { id: 'Impor Data', en: 'Data Import' },
  create: { id: 'Tambah Jalur', en: 'Add Waterway' },
  update: { id: 'Ubah Jalur', en: 'Update Waterway' },
  delete: { id: 'Hapus Jalur', en: 'Delete Waterway' },
  create_structure: { id: 'Tambah Titik', en: 'Add Structure' },
  verify_crossing: { id: 'Verifikasi Titik', en: 'Verify Crossing' },
  update_structure: { id: 'Ubah Titik', en: 'Update Structure' },
  delete_structure: { id: 'Hapus Titik', en: 'Delete Structure' },
  create_jorong: { id: 'Tambah Jorong', en: 'Add Jorong' },
  update_jorong: { id: 'Ubah Jorong', en: 'Update Jorong' },
  delete_jorong: { id: 'Hapus Jorong', en: 'Delete Jorong' },
  create_calibration_mark: { id: 'Tambah Benchmark', en: 'Add Benchmark' },
  update_calibration_mark: { id: 'Ubah Benchmark', en: 'Update Benchmark' },
  delete_calibration_mark: { id: 'Hapus Benchmark', en: 'Delete Benchmark' },
  update_calibration_profile: { id: 'Kalibrasi Model', en: 'Model Calibration' },
  promote_dem: { id: 'Verifikasi DEM', en: 'Verify DEM' },
  suppress_dem: { id: 'Sembunyikan DEM', en: 'Hide DEM' },
  restore_dem: { id: 'Pulihkan DEM', en: 'Restore DEM' },
  revert: { id: 'Pulihkan Data', en: 'Revert' },
  resolve_suggestion: { id: 'Tindak Lanjut', en: 'Resolved' },
  recompute_hydrology: { id: 'Hitung Ulang DEM', en: 'Recompute DEM' }
};

const STATUS_LABEL: Record<string, { id: string; en: string }> = {
  unverified: { id: 'Belum Dicek', en: 'Unverified' },
  normal: { id: 'Normal', en: 'Normal' },
  clogged: { id: 'Tersumbat', en: 'Clogged' },
  damaged: { id: 'Rusak', en: 'Damaged' },
  critical: { id: 'Rusak Berat', en: 'Severe' }
};

function formatStatus(val: unknown, isEn: boolean): string {
  const key = String(val || '');
  return STATUS_LABEL[key]?.[isEn ? 'en' : 'id'] || key;
}

function summarizeDiff(log: AuditLogEntry, isEn: boolean): string {
  const b = log.before as Record<string, unknown> | null;
  const a = log.after as Record<string, unknown> | null;
  const ptUnit = isEn ? 'pts' : 'titik';
  if (log.action === 'seed') {
    const count = Array.isArray(a?.seeded) ? a.seeded.length : 0;
    return isEn ? `Seeded ${count} OSM waterways` : `Data awal ${count} sungai OSM`;
  }
  if (log.action === 'recompute_hydrology') {
    const cells = Number(a?.burnedCellCount || 0);
    const ww = Number(a?.verifiedWaterwayCount || 0);
    return isEn
      ? `Embedded ${ww} waterways (${cells} DEM cells)`
      : `Sisipkan ${ww} sungai (${cells} sel DEM disesuaikan)`;
  }
  if (log.action === 'suppress_dem') {
    return isEn ? 'DEM segment hidden from reference' : 'Perkiraan DEM disembunyikan';
  }
  if (log.action === 'restore_dem') {
    return isEn ? 'DEM segment restored' : 'Perkiraan DEM dipulihkan';
  }
  if (b && a && Array.isArray(b.coordinates) && Array.isArray(a.coordinates)) {
    const bLen = Number(b.length_m || 0);
    const aLen = Number(a.length_m || 0);
    const ptsChange =
      b.coordinates.length !== a.coordinates.length
        ? ` · ${b.coordinates.length}→${a.coordinates.length} ${ptUnit}`
        : '';
    const statusChange =
      b.status !== a.status ? ` · ${formatStatus(b.status, isEn)}→${formatStatus(a.status, isEn)}` : '';
    return `${bLen} m → ${aLen} m${ptsChange}${statusChange}`;
  }
  if (!b && a && typeof a.length_m === 'number') {
    return `+${a.length_m} m (${Array.isArray(a.coordinates) ? a.coordinates.length : 0} ${ptUnit})`;
  }
  if (b && !a && typeof b.length_m === 'number') {
    return isEn ? `Removed (${b.length_m} m)` : `Dihapus (${b.length_m} m)`;
  }
  return '';
}

function canRevertLog(log: AuditLogEntry): boolean {
  return (
    log.action !== 'seed' &&
    log.action !== 'recompute_hydrology' &&
    (log.entity_type === 'waterway' ||
      log.entity_type === 'structure' ||
      log.entity_type === 'dem_segment' ||
      log.entity_type === 'jorong' ||
      log.entity_type === 'calibration_mark' ||
      log.entity_type === 'calibration_profile')
  );
}

export function AuditLogPanel({
  lang,
  logs,
  editorUnlocked,
  apiAvailable,
  onRevert,
  onFlyToLog
}: AuditLogPanelProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-1 text-[13.5px] font-bold text-[#161c1a]">{t.auditTitle}</div>
        <p className="m-0 text-[12.5px] leading-relaxed text-[#434d49]">{t.auditSubtitle}</p>
      </section>

      {logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#161c1a]/15 bg-white px-3 py-6 text-center text-[13px] text-[#636f6a]">
          {t.auditEmpty}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {logs.map(log => {
            const diffText = summarizeDiff(log, isEn);
            const revertible = apiAvailable && editorUnlocked && canRevertLog(log);
            const isConfirm = confirmId === log.id;
            const timeStr = log.created_at
              ? new Date(log.created_at).toLocaleString(isEn ? 'en-GB' : 'id-ID', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : '';

            return (
              <div
                key={log.id}
                data-testid={`audit-row-${log.id}`}
                className="rounded-xl border border-[#161c1a]/12 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono-num text-[11px] font-bold text-[#636f6a]">#{log.id}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          ACTION_BADGE[log.action] || 'bg-[#f2f3ef] text-[#434d49]'
                        }`}
                      >
                        {ACTION_LABEL[log.action]?.[isEn ? 'en' : 'id'] || log.action}
                      </span>
                      <strong className="truncate text-[13px] text-[#161c1a]">{log.entity_name}</strong>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[#636f6a]">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>
                        {timeStr} · <strong className="text-[#434d49]">{log.actor}</strong>
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onFlyToLog(log)}
                    title={t.viewMap}
                    aria-label={t.viewMap}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] text-[#434d49] hover:bg-[#f2f3ef]"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                </div>

                {log.reason && <p className="mt-1.5 mb-0 text-[12.5px] text-[#434d49]">“{log.reason}”</p>}

                {(diffText || revertible) && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#161c1a]/10 pt-2">
                    <span className="font-mono-num text-[11.5px] font-semibold text-[#636f6a]">{diffText}</span>
                    {revertible && (
                      <button
                        type="button"
                        disabled={busyId === log.id}
                        onClick={async () => {
                          if (!isConfirm) {
                            setConfirmId(log.id);
                            window.setTimeout(() => setConfirmId(c => (c === log.id ? null : c)), 3500);
                            return;
                          }
                          setBusyId(log.id);
                          try {
                            await onRevert(log.id);
                            setConfirmId(null);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className={`inline-flex min-h-[32px] items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-bold transition ${
                          isConfirm
                            ? 'border-[#b91c1c] bg-[#b91c1c] text-white'
                            : 'border-[#161c1a]/15 bg-white text-[#434d49] hover:bg-[#f2f3ef]'
                        }`}
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>{isConfirm ? t.auditRevertConfirm : t.auditRevertBtn}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
