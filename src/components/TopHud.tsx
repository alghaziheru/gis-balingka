import { Info, MessageSquare } from 'lucide-react';
import { I18N } from '../i18n/translations';
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
  onOpenInfo
}: TopHudProps) {
  const t = I18N[lang];
  const isDetail = viewMode === 'detail';

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
    <div className="pointer-events-auto absolute top-3 right-3 z-18 flex max-w-[calc(100vw-408px)] flex-wrap items-center justify-end gap-1.5 max-md:top-2 max-md:right-2 max-md:left-2 max-md:max-w-none max-md:flex-nowrap max-md:justify-between max-md:gap-1">
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

      <div className="surface-panel no-scrollbar inline-flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-[10px] p-[3px] max-md:max-w-[140px]">
        {surfaceModes.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChangeBasemap(id)}
            className={`min-h-[34px] shrink-0 rounded-[7px] px-2.5 py-1 text-[12.5px] font-semibold transition active:scale-[0.98] max-md:px-2 max-md:text-[12px] ${
              basemap === id
                ? 'bg-[#161c1a] text-white'
                : 'text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Ringkas / Lengkap mode switcher */}
      <div className="surface-panel inline-flex shrink-0 items-center gap-0.5 rounded-[10px] p-[3px]">
        <button
          type="button"
          onClick={() => onChangeViewMode('simple')}
          className={`min-h-[34px] rounded-[7px] px-2.5 py-1 text-[12.5px] font-bold transition active:scale-[0.98] max-md:px-2 max-md:text-[12px] ${
            viewMode === 'simple'
              ? 'bg-[#0369a1] text-white'
              : 'text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]'
          }`}
        >
          {t.modeSimple}
        </button>
        <button
          type="button"
          onClick={() => onChangeViewMode('detail')}
          className={`min-h-[34px] rounded-[7px] px-2.5 py-1 text-[12.5px] font-bold transition active:scale-[0.98] max-md:px-2 max-md:text-[12px] ${
            viewMode === 'detail'
              ? 'bg-[#0369a1] text-white'
              : 'text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]'
          }`}
        >
          {t.modeDetail}
        </button>
      </div>

      {/* Desktop ID | EN pair, compact single toggle on mobile */}
      <div className="surface-panel inline-flex shrink-0 items-center gap-0.5 rounded-[10px] p-[3px] max-md:hidden">
        <button
          type="button"
          onClick={() => onChangeLang('id')}
          className={`min-h-[34px] rounded-[7px] px-2 py-1 text-[12px] font-semibold transition ${
            lang === 'id' ? 'bg-[#161c1a] text-white' : 'text-[#434d49] hover:bg-[#f2f3ef]'
          }`}
        >
          ID
        </button>
        <button
          type="button"
          onClick={() => onChangeLang('en')}
          className={`min-h-[34px] rounded-[7px] px-2 py-1 text-[12px] font-semibold transition ${
            lang === 'en' ? 'bg-[#161c1a] text-white' : 'text-[#434d49] hover:bg-[#f2f3ef]'
          }`}
        >
          EN
        </button>
      </div>
      <div className="surface-panel hidden shrink-0 items-center rounded-[10px] p-[3px] max-md:inline-flex">
        <button
          type="button"
          onClick={() => onChangeLang(lang === 'id' ? 'en' : 'id')}
          aria-label="Switch language"
          className="min-h-[34px] rounded-[7px] bg-[#161c1a] px-2.5 py-1 text-[11.5px] font-bold text-white"
        >
          {lang.toUpperCase()}
        </button>
      </div>

      <div className="surface-panel inline-flex shrink-0 items-center gap-0.5 rounded-[10px] p-[3px]">
        <button
          type="button"
          onClick={onOpenFeedback}
          aria-label={t.btnFeedback}
          title={t.btnFeedback}
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12.5px] font-semibold text-[#161c1a] transition hover:bg-[#f2f3ef] active:scale-[0.98] max-md:px-2"
        >
          <MessageSquare className="h-3.5 w-3.5 text-[#0369a1]" />
          <span className="max-md:hidden">{t.btnFeedback}</span>
        </button>
        <button
          type="button"
          onClick={onOpenInfo}
          aria-label={t.btnInfoData}
          title={t.btnInfoData}
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12.5px] font-semibold text-[#161c1a] transition hover:bg-[#f2f3ef] active:scale-[0.98] max-md:px-2"
        >
          <Info className="h-3.5 w-3.5 text-[#0369a1]" />
          <span className="max-md:hidden">{t.btnInfoData}</span>
        </button>
      </div>
    </div>
  );
}
