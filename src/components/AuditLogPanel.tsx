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
  create: 'bg-[#059669]/12 text-[#065f46]',
  update: 'bg-[#0284c7]/12 text-[#0369a1]',
  promote_dem: 'bg-[#0ea5e9]/15 text-[#0369a1]',
  suppress_dem: 'bg-[#d97706]/14 text-[#92400e]',
  restore_dem: 'bg-[#059669]/12 text-[#065f46]',
  delete: 'bg-[#dc2626]/14 text-[#991b1b]',
  revert: 'bg-[#7c3aed]/14 text-[#5b21b6]',
  resolve_suggestion: 'bg-[#0d9488]/12 text-[#115e59]'
};

function summarizeDiff(log: AuditLogEntry, isEn: boolean): string {
  const b = log.before as Record<string, unknown> | null;
  const a = log.after as Record<string, unknown> | null;
  if (log.action === 'seed') {
    const count = Array.isArray(a?.seeded) ? a.seeded.length : 0;
    return isEn ? `Seeded ${count} OSM waterways` : `Seed ${count} sungai awal OSM`;
  }
  if (log.action === 'suppress_dem') {
    return isEn ? 'DEM segment hidden from reference' : 'Segmen DEM disembunyikan';
  }
  if (log.action === 'restore_dem') {
    return isEn ? 'DEM segment restored' : 'Segmen DEM dipulihkan';
  }
  if (b && a && Array.isArray(b.coordinates) && Array.isArray(a.coordinates)) {
    const bLen = Number(b.length_m || 0);
    const aLen = Number(a.length_m || 0);
    const ptsChange = b.coordinates.length !== a.coordinates.length ? ` · ${b.coordinates.length}→${a.coordinates.length} pts` : '';
    const statusChange = b.status !== a.status ? ` · ${b.status}→${a.status}` : '';
    return `${bLen}m → ${aLen}m${ptsChange}${statusChange}`;
  }
  if (!b && a && typeof a.length_m === 'number') {
    return `+${a.length_m}m (${Array.isArray(a.coordinates) ? a.coordinates.length : 0} pts)`;
  }
  if (b && !a && typeof b.length_m === 'number') {
    return isEn ? `Removed (${b.length_m}m)` : `Dihapus (${b.length_m}m)`;
  }
  return '';
}

function canRevertLog(log: AuditLogEntry): boolean {
  return log.action !== 'seed' && (log.entity_type === 'waterway' || log.entity_type === 'dem_segment');
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
    <div className="flex flex-col gap-2.5">
      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-1 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.auditTitle}
        </div>
        <p className="m-0 text-[11.5px] leading-relaxed text-[#3f524a]">{t.auditSubtitle}</p>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-[11px] border border-dashed border-[#12231c]/15 bg-white/80 px-3 py-5 text-center text-xs text-[#64776f]">
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
                className="rounded-[11px] border border-[#12231c]/12 bg-white p-2.5 shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono-num text-[10px] font-bold text-[#64776f]">#{log.id}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase ${
                          ACTION_BADGE[log.action] || 'bg-[#eff4f1] text-[#3f524a]'
                        }`}
                      >
                        {log.action}
                      </span>
                      <strong className="truncate text-xs text-[#12231c]">{log.entity_name}</strong>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-[#64776f]">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>
                        {timeStr} · <strong>{log.actor}</strong>
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onFlyToLog(log)}
                    title={t.viewMap}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded border border-[#12231c]/15 bg-white text-[#3f524a] hover:bg-[#eff4f1]"
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                </div>

                {log.reason && <p className="mt-1.5 mb-0 text-[11.5px] text-[#3f524a]">“{log.reason}”</p>}

                {(diffText || revertible) && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-dashed border-[#12231c]/10 pt-1.5">
                    <span className="font-mono-num text-[10.5px] font-semibold text-[#64776f]">
                      {diffText}
                    </span>
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
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-bold transition ${
                          isConfirm
                            ? 'border-[#dc2626] bg-[#dc2626] text-white'
                            : 'border-[#12231c]/15 bg-white text-[#3f524a] hover:bg-[#eff4f1]'
                        }`}
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
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
