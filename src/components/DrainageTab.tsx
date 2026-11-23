import { useId } from 'react';
import { Building2, ExternalLink } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { DrainageStatus, Language, LayerToggles, ViewMode } from '../types/gis';
import { InfoTooltip } from './InfoTooltip';
import { LegendIcon, type LegendIconKind } from './LegendIcon';

interface DrainageTabProps {
  lang: Language;
  viewMode: ViewMode;
  drainFilter: 'all' | DrainageStatus;
  counts: Record<'all' | DrainageStatus, number>;
  layers: LayerToggles;
  onChangeFilter: (filter: 'all' | DrainageStatus) => void;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onFocusHulu: () => void;
  onFocusDrainage: () => void;
  onFocusEvac: () => void;
}

export function DrainageTab({
  lang,
  viewMode,
  drainFilter,
  counts,
  layers,
  onChangeFilter,
  onToggleLayer,
  onFocusHulu,
  onFocusDrainage,
  onFocusEvac
}: DrainageTabProps) {
  const uid = useId();
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';

  const filterChips: { id: 'all' | DrainageStatus; label: string; color?: string }[] = [
    { id: 'all', label: t.fAll },
    { id: 'unverified', label: t.fUnverified, color: '#64748b' },
    { id: 'normal', label: t.fNormal, color: '#047857' },
    { id: 'clogged', label: t.fClogged, color: '#b45309' },
    { id: 'damaged', label: t.fDamaged, color: '#c2410c' },
    { id: 'critical', label: t.fCritical, color: '#b91c1c' }
  ];

  const infraLayers: [keyof LayerToggles, string, LegendIconKind, string?][] = [
    ['evac', t.lblEvac, 'evacuation', t.infoPublicHighGround],
    ['landslide', t.lblLandslide, 'landslide', t.infoLandslideSlope]
  ];

  const officialAgencies = [
    {
      name: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
      role: isEn
        ? 'Official weather forecasts & extreme rainfall warnings'
        : 'Prakiraan cuaca & peringatan dini cuaca ekstrem resmi',
      href: 'https://www.bmkg.go.id'
    },
    {
      name: 'BPBD Kab. Agam & BNPB',
      role: isEn
        ? 'Official disaster status declarations, early warnings & evacuation directives'
        : 'Penetapan status bencana, informasi potensi bahaya & arahan evakuasi resmi',
      href: 'https://bnpb.go.id'
    },
    {
      name: 'PVMBG — Badan Geologi (ESDM)',
      role: isEn
        ? 'Official ground-movement / landslide susceptibility assessments'
        : 'Kajian resmi zona gerakan tanah & geologi kebencanaan',
      href: 'https://vsi.esdm.go.id'
    },
    {
      name: isEn ? 'Wali Nagari Balingka Office & Wali Jorong' : 'Kantor Wali Nagari Balingka & Wali Jorong',
      role: isEn
        ? 'Local coordination, field infrastructure verification & community updates'
        : 'Koordinasi lapangan, verifikasi saluran setempat & informasi resmi nagari',
      href: null
    }
  ];

  return (
    <div className="flex flex-col gap-3.5">
      {/* Crossing Status Filters + Factual Reference Points */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex items-center gap-1.5">
          <span className="text-[13px] font-bold text-[#161c1a]">{t.drainInventoryTitle}</span>
          <InfoTooltip
            text={isDetail ? t.drainFilterTitle : t.drainSimpleHint}
            label={t.drainInventoryTitle}
          />
        </div>

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
          {infraLayers.map(([key, label, iconKind, info]) => (
            <div key={key} className="flex min-h-[42px] items-center justify-between gap-2.5 py-1">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <label
                  htmlFor={`${uid}-${key}`}
                  className="flex min-w-0 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#161c1a]"
                >
                  <LegendIcon kind={iconKind} />
                  <span>{label}</span>
                </label>
                {info && <InfoTooltip text={info} label={label} />}
              </div>
              <input
                id={`${uid}-${key}`}
                type="checkbox"
                checked={layers[key]}
                onChange={e => onToggleLayer(key, e.target.checked)}
                className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Quick Map Data Focus */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 text-[13px] font-bold text-[#161c1a]">{t.quickNavTitle}</div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={onFocusDrainage}
            className="min-h-[38px] rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-1.5 text-[12px] font-semibold text-[#161c1a] transition hover:bg-[#f2f3ef]"
          >
            {t.quickFocusCulverts}
          </button>
          <button
            type="button"
            onClick={onFocusHulu}
            className="min-h-[38px] rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-1.5 text-[12px] font-semibold text-[#161c1a] transition hover:bg-[#f2f3ef]"
          >
            {t.quickFocusUpland}
          </button>
          <button
            type="button"
            onClick={onFocusEvac}
            className="min-h-[38px] rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-1.5 text-[12px] font-semibold text-[#161c1a] transition hover:bg-[#f2f3ef]"
          >
            {t.quickFocusFacilities}
          </button>
        </div>
      </section>

      {/* Official References & Contacts */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-1.5 flex items-center gap-2 text-[13px] font-bold text-[#161c1a]">
          <Building2 className="h-4 w-4 shrink-0 text-[#0369a1]" />
          <span>{t.officialRefTitle}</span>
        </div>
        <p className="m-0 mb-2.5 text-[12.5px] leading-relaxed text-[#434d49]">{t.officialRefIntro}</p>

        <div className="divide-y divide-[#161c1a]/10 rounded-lg border border-[#161c1a]/10 bg-[#fafaf8]">
          {officialAgencies.map(item => (
            <div key={item.name} className="flex items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold text-[#161c1a]">{item.name}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-[#434d49]">{item.role}</div>
              </div>
              {item.href && (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={item.name}
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[#161c1a]/15 bg-white text-[#0369a1] hover:bg-[#f2f3ef]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
