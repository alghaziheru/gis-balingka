import { CHECKLIST_ITEMS, I18N } from '../i18n/translations';
import type { DrainageStatus, Language, LayerToggles } from '../types/gis';

interface DrainageTabProps {
  lang: Language;
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

  const filterChips: { id: 'all' | DrainageStatus; label: string; color?: string }[] = [
    { id: 'all', label: t.fAll },
    { id: 'normal', label: t.fNormal, color: '#059669' },
    { id: 'clogged', label: t.fClogged, color: '#d97706' },
    { id: 'damaged', label: t.fDamaged, color: '#ea580c' },
    { id: 'critical', label: t.fCritical, color: '#dc2626' }
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.drainFilterTitle}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filterChips.map(ch => {
            const active = drainFilter === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => onChangeFilter(ch.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition ${
                  active
                    ? 'border-[#12231c] bg-[#12231c] text-white'
                    : 'border-[#12231c]/15 bg-[#eff4f1] text-[#3f524a] hover:text-[#12231c]'
                }`}
              >
                {ch.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-[3px] border border-black/15"
                    style={{ background: ch.color }}
                  />
                )}
                <span>{ch.label}</span>
                <span className="font-mono-num text-[10.5px] opacity-80">{counts[ch.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.mitInfraTitle}
        </div>
        <div className="divide-y divide-dashed divide-[#12231c]/10">
          {(
            [
              ['bronjong', t.lblBronjong, '#0284c7'],
              ['landslide', t.lblLandslide, '#ea580c'],
              ['evac', t.lblEvac, '#059669']
            ] as [keyof LayerToggles, string, string][]
          ).map(([key, label, swatch]) => (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-2.5 py-1.5">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[#12231c]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-black/15"
                  style={{ background: swatch }}
                />
                <span>{label}</span>
              </span>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={e => onToggleLayer(key, e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-[#0284c7]"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.mitGuideTitle}
        </div>

        <div className="flex flex-col gap-2">
          <div className="rounded-[10px] border border-[#12231c]/12 bg-white p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-extrabold text-[#12231c]">{t.act1Title}</span>
              <button
                type="button"
                onClick={onFocusHulu}
                className="shrink-0 rounded-md border border-[#12231c]/15 bg-[#eff4f1] px-2 py-1 text-[11px] font-bold hover:bg-[#e5ede8]"
              >
                {t.viewMap}
              </button>
            </div>
            <p className="m-0 text-[11.8px] text-[#3f524a]">{t.act1Desc}</p>
          </div>

          <div className="rounded-[10px] border border-[#12231c]/12 bg-white p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-extrabold text-[#12231c]">{t.act2Title}</span>
              <button
                type="button"
                onClick={onFocusDrainage}
                className="shrink-0 rounded-md border border-[#12231c]/15 bg-[#eff4f1] px-2 py-1 text-[11px] font-bold hover:bg-[#e5ede8]"
              >
                {t.viewMap}
              </button>
            </div>
            <p className="m-0 mb-2 text-[11.8px] text-[#3f524a]">{t.act2Desc}</p>
            <button
              type="button"
              onClick={onJumpCompare}
              className="w-full rounded-lg border border-[#047857] bg-[#059669] px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:bg-[#047857]"
            >
              {t.act2Cta}
            </button>
          </div>

          <div className="rounded-[10px] border border-[#12231c]/12 bg-white p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-extrabold text-[#12231c]">{t.act3Title}</span>
              <button
                type="button"
                onClick={onFocusEvac}
                className="shrink-0 rounded-md border border-[#12231c]/15 bg-[#eff4f1] px-2 py-1 text-[11px] font-bold hover:bg-[#e5ede8]"
              >
                {t.viewMap}
              </button>
            </div>
            <p className="m-0 text-[11.8px] text-[#3f524a]">{t.act3Desc}</p>
            <div className="mt-2 flex flex-col gap-1.5 border-t border-dashed border-[#12231c]/12 pt-2">
              {CHECKLIST_ITEMS.map(item => {
                const checked = !!checklist[item.id];
                return (
                  <label key={item.id} className="flex cursor-pointer items-start gap-2 text-[11.8px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => onToggleChecklist(item.id, e.target.checked)}
                      className="mt-0.5 accent-[#059669]"
                    />
                    <span className={checked ? 'text-[#64776f] line-through' : 'text-[#12231c]'}>
                      {isEn ? item.enText : item.idText}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="mt-2 rounded-lg border border-[#0284c7]/25 bg-[#0284c7]/10 p-2 text-[11px] text-[#0c4a6e]">
              {t.emergencyNote}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
