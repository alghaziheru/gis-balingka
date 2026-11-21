import { CHECKLIST_ITEMS, I18N } from '../i18n/translations';
import type { DrainageStatus, Language, LayerToggles, ViewMode } from '../types/gis';

interface DrainageTabProps {
  lang: Language;
  viewMode: ViewMode;
  drainFilter: 'all' | DrainageStatus;
  counts: Record<'all' | DrainageStatus, number>;
  layers: LayerToggles;
  checklist: Record<string, boolean>;
  onChangeFilter: (filter: 'all' | DrainageStatus) => void;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onToggleChecklist: (id: string, checked: boolean) => void;
  onFocusHulu: () => void;
  onFocusDrainage: () => void;
  onJumpCompare: () => void;
  onFocusEvac: () => void;
}

export function DrainageTab({
  lang,
  viewMode,
  drainFilter,
  counts,
  layers,
  checklist,
  onChangeFilter,
  onToggleLayer,
  onToggleChecklist,
  onFocusHulu,
  onFocusDrainage,
  onJumpCompare,
  onFocusEvac
}: DrainageTabProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';

  const filterChips: { id: 'all' | DrainageStatus; label: string; color?: string }[] = [
    { id: 'all', label: t.fAll },
    { id: 'normal', label: t.fNormal, color: '#047857' },
    { id: 'clogged', label: t.fClogged, color: '#b45309' },
    { id: 'damaged', label: t.fDamaged, color: '#c2410c' },
    { id: 'critical', label: t.fCritical, color: '#b91c1c' }
  ];

  const infraLayers: [keyof LayerToggles, string, string][] = isDetail
    ? [
        ['evac', t.lblEvac, '#047857'],
        ['landslide', t.lblLandslide, '#c2410c'],
        ['bronjong', t.lblBronjong, '#0369a1']
      ]
    : [
        ['evac', t.lblEvac, '#047857'],
        ['landslide', t.lblLandslide, '#c2410c']
      ];

  return (
    <div className="flex flex-col gap-3.5">
      {/* Unified Interactive Legend + Crossing Status Filters + Hazard Layers */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-1 text-[13px] font-bold text-[#161c1a]">{t.drainLegendTitle}</div>
        <p className="mt-0 mb-2.5 text-[12.5px] text-[#636f6a]">
          {isDetail ? t.drainFilterTitle : t.drainSimpleHint}
        </p>

        <div className="flex flex-wrap gap-1.5 border-b border-[#161c1a]/10 pb-3">
          {filterChips.map(ch => {
            const active = drainFilter === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => onChangeFilter(ch.id)}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${
                  active
                    ? 'border-[#161c1a] bg-[#161c1a] text-white'
                    : 'border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
                }`}
              >
                {ch.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-white/80"
                    style={{ background: ch.color }}
                  />
                )}
                <span>{ch.label}</span>
                <span className="font-mono-num text-[11.5px] opacity-80">{counts[ch.id]}</span>
              </button>
            );
          })}
        </div>

        <div className="divide-y divide-[#161c1a]/10 pt-1.5">
          {infraLayers.map(([key, label, swatch]) => (
            <label key={key} className="flex min-h-[42px] cursor-pointer items-center justify-between gap-2.5 py-1">
              <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-white shadow-[0_0_0_1px_rgba(22,28,26,0.2)]"
                  style={{ background: swatch }}
                />
                <span>{label}</span>
              </span>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={e => onToggleLayer(key, e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 text-[13px] font-bold text-[#161c1a]">{t.mitGuideTitle}</div>

        <div className="flex flex-col divide-y divide-[#161c1a]/10">
          <div className="pb-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-bold text-[#161c1a]">{t.act1Title}</span>
              <button
                type="button"
                onClick={onFocusHulu}
                className="shrink-0 rounded-md border border-[#161c1a]/15 bg-[#fafaf8] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] hover:bg-[#f2f3ef]"
              >
                {t.viewMap}
              </button>
            </div>
            <p className="m-0 text-[13px] leading-relaxed text-[#434d49]">{t.act1Desc}</p>
          </div>

          <div className="py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-bold text-[#161c1a]">{t.act2Title}</span>
              <button
                type="button"
                onClick={onFocusDrainage}
                className="shrink-0 rounded-md border border-[#161c1a]/15 bg-[#fafaf8] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] hover:bg-[#f2f3ef]"
              >
                {t.viewMap}
              </button>
            </div>
            <p className="m-0 mb-2.5 text-[13px] leading-relaxed text-[#434d49]">{t.act2Desc}</p>
            <button
              type="button"
              onClick={onJumpCompare}
              className="min-h-[38px] w-full rounded-lg bg-[#047857] px-3 py-2 text-[12.5px] font-bold text-white transition hover:bg-[#065f46]"
            >
              {t.act2Cta}
            </button>
          </div>

          <div className="pt-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-bold text-[#161c1a]">{t.act3Title}</span>
              <button
                type="button"
                onClick={onFocusEvac}
                className="shrink-0 rounded-md border border-[#161c1a]/15 bg-[#fafaf8] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] hover:bg-[#f2f3ef]"
              >
                {t.viewMap}
              </button>
            </div>
            <p className="m-0 mb-2 text-[13px] text-[#434d49]">{t.act3Desc}</p>
            <div className="flex flex-col divide-y divide-[#161c1a]/8">
              {CHECKLIST_ITEMS.map(item => {
                const checked = !!checklist[item.id];
                return (
                  <label key={item.id} className="flex min-h-[40px] cursor-pointer items-start gap-2.5 py-2 text-[13px] leading-snug">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => onToggleChecklist(item.id, e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#047857]"
                    />
                    <span className={checked ? 'text-[#636f6a] line-through' : 'text-[#161c1a]'}>
                      {isEn ? item.enText : item.idText}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="mt-2.5 rounded-r-lg border-l-[3px] border-[#0369a1] bg-[#0369a1]/8 px-3 py-2 text-[12.5px] leading-snug text-[#161c1a]">
              {t.emergencyNote}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
