import { AlertCircle, RotateCw } from 'lucide-react';
import { useT } from '../context/RegionContext';
import type { Language } from '../types/gis';

interface SidebarSkeletonProps {
  lang: Language;
  loadError: string | null;
  onRetry: () => void;
}

/** Daylight skeleton placeholders for the sidebar while initial region datasets load. */
export function SidebarSkeleton({ lang, loadError, onRetry }: SidebarSkeletonProps) {
  const t = useT(lang);

  if (loadError) {
    return (
      <div
        data-testid="sidebar-load-error"
        className="surface-card rounded-xl border-[#b91c1c]/25 p-3.5"
      >
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b91c1c]" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-[#161c1a]">{t.loadErrorTitle}</div>
            <p className="mt-1 text-[12px] leading-snug text-[#434d49]">{loadError}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-[#0369a1] px-3 py-1.5 text-[12.5px] font-bold text-white transition hover:bg-[#075985]"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>{t.loadRetry}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="sidebar-skeleton" aria-busy="true" className="space-y-3">
      <div className="surface-card rounded-xl p-3">
        <div className="h-3 w-28 animate-pulse rounded bg-[#e8ebe7]" />
        <div className="mt-2.5 h-9 w-full animate-pulse rounded-lg bg-[#f2f3ef]" />
      </div>

      <div className="surface-card rounded-xl p-3">
        <div className="flex items-center justify-between border-b border-[#161c1a]/10 pb-2.5">
          <div className="h-3.5 w-36 animate-pulse rounded bg-[#e8ebe7]" />
          <div className="h-5 w-14 animate-pulse rounded bg-[#f2f3ef]" />
        </div>
        <div className="mt-3 space-y-2.5">
          {[0, 1, 2, 3, 4].map(row => (
            <div key={row} className="flex items-center gap-2.5 py-1">
              <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-[#e8ebe7]" />
              <div className="h-3.5 flex-1 animate-pulse rounded bg-[#f2f3ef]" />
              <div className="h-4 w-8 shrink-0 animate-pulse rounded-full bg-[#e8ebe7]" />
            </div>
          ))}
        </div>
      </div>

      <div className="surface-card rounded-xl p-3">
        <div className="h-3.5 w-32 animate-pulse rounded bg-[#e8ebe7]" />
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="h-9 animate-pulse rounded-lg bg-[#f2f3ef]" />
          <div className="h-9 animate-pulse rounded-lg bg-[#f2f3ef]" />
        </div>
      </div>
    </div>
  );
}
