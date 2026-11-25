import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, MessageSquare, Settings } from 'lucide-react';
import { useT } from '../context/RegionContext';
import type { BasemapId, Language, ViewMode } from '../types/gis';

interface TopHudProps {
  lang: Language;
  viewMode: ViewMode;
  is3D: boolean;
  basemap: BasemapId;
  onChangeViewMode: (mode: ViewMode) => void;
  onToggle3D: (val: boolean) => void;
  onChangeBasemap: (bm: BasemapId) => void;
  onChangeLang: (lang: Language) => void;
  onOpenFeedback: () => void;
  onOpenInfo: () => void;
  children?: ReactNode;
}

export function TopHud({
  lang,
  viewMode,
  is3D,
  basemap,
  onChangeViewMode,
  onToggle3D,
  onChangeBasemap,
  onChangeLang,
  onOpenFeedback,
  onOpenInfo,
  children
}: TopHudProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const t = useT(lang);
  const isDetail = viewMode === 'detail';

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const surfaceModes: [BasemapId, string][] = isDetail
    ? [
        ['sat', t.bmSat],
        ['elev', t.bmElev],
        ['relief', t.bmRelief],
        ['slope', t.bmSlope],
        ['topo', t.bmTopo],
        ['osm', t.bmOsm]
      ]
    : [
        ['sat', t.bmSat],
        ['osm', t.bmOsm]
      ];

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-25 flex max-w-[calc(100vw-408px)] flex-col items-end gap-2.5 max-md:top-2 max-md:right-2 max-md:left-2 max-md:max-w-none">
      <div className="pointer-events-auto relative z-30 flex flex-wrap items-center justify-end gap-1.5 max-md:w-full max-md:flex-nowrap max-md:justify-end max-md:gap-1.5">
        {isDetail && (
        <div className="surface-panel inline-flex shrink-0 items-center gap-0.5 rounded-[10px] p-[3px] max-md:hidden">
          <button
            type="button"
            onClick={() => onToggle3D(false)}
            className={`min-h-[34px] rounded-[7px] px-2.5 py-1 text-[12.5px] font-semibold transition active:scale-[0.98] ${
              !is3D ? 'bg-[#161c1a] text-white' : 'text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]'
            }`}
          >
            2D
          </button>
          <button
            type="button"
            onClick={() => onToggle3D(true)}
            className={`min-h-[34px] rounded-[7px] px-2.5 py-1 text-[12.5px] font-semibold transition active:scale-[0.98] ${
              is3D ? 'bg-[#161c1a] text-white' : 'text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]'
            }`}
          >
            3D
          </button>
        </div>
      )}

      <div className="surface-panel no-scrollbar inline-flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-[10px] p-[3px] max-md:max-w-[calc(100vw-68px)]">
        {surfaceModes.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChangeBasemap(id)}
            className={`min-h-[34px] shrink-0 rounded-[7px] px-2.5 py-1 text-[12.5px] font-semibold transition active:scale-[0.98] max-md:px-2.5 max-md:text-[12px] ${
              basemap === id
                ? 'bg-[#161c1a] text-white'
                : 'text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Single Gear config button + anchored settings popover */}
      <div ref={menuRef} className="relative shrink-0">
        <div className="surface-panel inline-flex items-center rounded-[10px] p-[3px]">
          <button
            type="button"
            data-testid="hud-settings-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-label={t.btnSettings}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title={t.btnSettings}
            className={`grid h-[34px] w-[34px] place-items-center rounded-[7px] transition active:scale-[0.98] ${
              menuOpen ? 'bg-[#161c1a] text-white' : 'text-[#161c1a] hover:bg-[#f2f3ef]'
            }`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {menuOpen && (
          <div
            data-testid="hud-settings-popover"
            role="menu"
            aria-label={t.btnSettings}
            className="surface-panel absolute top-[calc(100%+6px)] right-0 z-30 w-[248px] rounded-xl p-3"
          >
            <div>
              <div className="mb-1.5 text-[11px] font-bold tracking-wide text-[#636f6a] uppercase">
                {t.settingsViewMode}
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#161c1a]/10 bg-[#f2f3ef] p-1">
                <button
                  type="button"
                  onClick={() => onChangeViewMode('simple')}
                  className={`min-h-[32px] rounded-md px-2 py-1 text-[12.5px] font-bold transition ${
                    viewMode === 'simple'
                      ? 'bg-[#0369a1] text-white shadow-xs'
                      : 'text-[#434d49] hover:text-[#161c1a]'
                  }`}
                >
                  {t.modeSimple}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeViewMode('detail')}
                  className={`min-h-[32px] rounded-md px-2 py-1 text-[12.5px] font-bold transition ${
                    viewMode === 'detail'
                      ? 'bg-[#0369a1] text-white shadow-xs'
                      : 'text-[#434d49] hover:text-[#161c1a]'
                  }`}
                >
                  {t.modeDetail}
                </button>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-bold tracking-wide text-[#636f6a] uppercase">
                {t.settingsLang}
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#161c1a]/10 bg-[#f2f3ef] p-1">
                <button
                  type="button"
                  onClick={() => onChangeLang('id')}
                  className={`min-h-[32px] rounded-md px-2 py-1 text-[12.5px] font-bold transition ${
                    lang === 'id'
                      ? 'bg-[#161c1a] text-white shadow-xs'
                      : 'text-[#434d49] hover:text-[#161c1a]'
                  }`}
                >
                  ID
                </button>
                <button
                  type="button"
                  onClick={() => onChangeLang('en')}
                  className={`min-h-[32px] rounded-md px-2 py-1 text-[12.5px] font-bold transition ${
                    lang === 'en'
                      ? 'bg-[#161c1a] text-white shadow-xs'
                      : 'text-[#434d49] hover:text-[#161c1a]'
                  }`}
                >
                  EN
                </button>
              </div>
            </div>

            <div className="my-2.5 border-t border-[#161c1a]/10" />

            <div className="flex flex-col gap-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenFeedback();
                }}
                className="flex min-h-[36px] w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-[#161c1a] transition hover:bg-[#f2f3ef]"
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-[#0369a1]" />
                <span>{t.btnFeedback}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="hud-info-btn"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenInfo();
                }}
                className="flex min-h-[36px] w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-[#161c1a] transition hover:bg-[#f2f3ef]"
              >
                <Info className="h-4 w-4 shrink-0 text-[#0369a1]" />
                <span>{t.btnInfoData}</span>
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
      {children}
    </div>
  );
}
