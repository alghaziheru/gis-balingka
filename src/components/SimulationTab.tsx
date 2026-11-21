import { AlertTriangle, Pause, Play } from 'lucide-react';
import { I18N, SIM_STAGES } from '../i18n/translations';
import type { Language } from '../types/gis';

interface SimulationTabProps {
  lang: Language;
  playing: boolean;
  stageIndex: number;
  rainMm: number;
  scenario: 'clogged' | 'cleared';
  kpis: {
    activeAreaHa: number;
    reductionPct: number;
    chokeCount: number;
    runoffIndex: number;
  };
  onTogglePlay: () => void;
  onSelectStage: (idx: number) => void;
  onChangeRain: (rain: number) => void;
  onChangeScenario: (sc: 'clogged' | 'cleared') => void;
}

export function SimulationTab({
  lang,
  playing,
  stageIndex,
  rainMm,
  scenario,
  kpis,
  onTogglePlay,
  onSelectStage,
  onChangeRain,
  onChangeScenario
}: SimulationTabProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const stage = SIM_STAGES[stageIndex] || SIM_STAGES[0];

  const stageNames = isEn
    ? ['1. Start', '2. Upstream', '3. Peak', '4. Solution']
    : ['1. Awal', '2. Hulu', '3. Puncak', '4. Solusi'];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-xl border border-[#d97706]/30 bg-[#d97706]/12 p-2.5 text-[11.5px] text-[#78350f]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t.simDisclaimer}</span>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
            {t.simPlaybackTitle}
          </span>
          <span className="font-mono-num text-[11px] font-bold text-[#12231c]">{stage.time}</span>
        </div>

        <div className="mb-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlay}
            className="inline-flex items-center gap-1 rounded-lg border border-[#0369a1] bg-[#0284c7] px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:bg-[#0369a1]"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{playing ? t.pause : t.play}</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectStage((stageIndex - 1 + SIM_STAGES.length) % SIM_STAGES.length)}
            className="rounded-lg border border-[#12231c]/15 bg-white px-2.5 py-1.5 text-[11.5px] font-bold hover:bg-[#eff4f1]"
          >
            ‹ {t.prev}
          </button>
          <button
            type="button"
            onClick={() => onSelectStage((stageIndex + 1) % SIM_STAGES.length)}
            className="rounded-lg border border-[#12231c]/15 bg-white px-2.5 py-1.5 text-[11.5px] font-bold hover:bg-[#eff4f1]"
          >
            {t.next} ›
          </button>
        </div>

        <div className="mb-2.5 grid grid-cols-4 gap-1">
          {stageNames.map((lbl, idx) => (
            <button
              key={lbl}
              type="button"
              onClick={() => onSelectStage(idx)}
              className={`rounded-lg border py-1.5 text-center text-[11px] font-bold transition ${
                stageIndex === idx
                  ? 'border-[#0369a1] bg-[#0284c7] text-white'
                  : 'border-[#12231c]/12 bg-[#eff4f1] text-[#3f524a] hover:text-[#12231c]'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="rounded-r-lg border-l-[3px] border-[#0284c7] bg-[#eff4f1] px-2.5 py-2">
          <h4 className="m-0 mb-1 text-[13px] font-extrabold text-[#12231c]">
            {isEn ? stage.title_en : stage.title_id}
          </h4>
          <p className="m-0 text-xs text-[#3f524a]">{isEn ? stage.desc_en : stage.desc_id}</p>
        </div>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.whatIfTitle}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs font-semibold text-[#3f524a]">
            <span>{t.lblRainIntensity}</span>
            <span className="font-mono-num text-[11.5px] font-bold text-[#12231c]">
              {rainMm} {isEn ? 'mm/hr' : 'mm/jam'}
            </span>
          </div>
          <input
            type="range"
            min={20}
            max={130}
            step={5}
            value={rainMm}
            onChange={e => onChangeRain(parseInt(e.target.value, 10))}
            className="w-full cursor-pointer accent-[#0284c7]"
          />
          <div className="flex justify-between text-[10px] font-semibold text-[#64776f]">
            <span>{t.rainLight}</span>
            <span>{t.rainHeavy}</span>
            <span>{t.rainExtreme}</span>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[11px] font-bold text-[#3f524a]">{t.lblDrainState}</div>
          <div className="grid grid-cols-2 gap-1 rounded-[9px] border border-[#12231c]/12 bg-[#eff4f1] p-1">
            <button
              type="button"
              onClick={() => onChangeScenario('clogged')}
              className={`rounded-[7px] py-1.5 text-[11.5px] font-bold transition ${
                scenario === 'clogged'
                  ? 'bg-[#fef2f2] text-[#dc2626] shadow-xs'
                  : 'text-[#3f524a] hover:text-[#12231c]'
              }`}
            >
              {t.scClogged}
            </button>
            <button
              type="button"
              onClick={() => onChangeScenario('cleared')}
              className={`rounded-[7px] py-1.5 text-[11.5px] font-bold transition ${
                scenario === 'cleared'
                  ? 'bg-[#ecfdf5] text-[#047857] shadow-xs'
                  : 'text-[#3f524a] hover:text-[#12231c]'
              }`}
            >
              {t.scCleared}
            </button>
          </div>
        </div>

        <div
          className={`mt-2.5 rounded-lg px-2.5 py-1.5 text-center text-[11.5px] font-bold ${
            scenario === 'cleared'
              ? 'bg-[#059669]/12 text-[#065f46]'
              : 'bg-[#dc2626]/12 text-[#991b1b]'
          }`}
        >
          {scenario === 'cleared'
            ? isEn
              ? `-${kpis.reductionPct}% localized crossing-zone overflow (HAND model)`
              : `-${kpis.reductionPct}% potensi luapan di sekitar perlintasan (model HAND)`
            : isEn
            ? 'Blocked crossings expand backwater pooling into low-HAND zones'
            : 'Sumbatan perlintasan memperluas genangan di zona rendah HAND'}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
            <div className="text-[10.5px] font-semibold text-[#64776f]">{t.kpiArea}</div>
            <div className="font-mono-num text-[13px] font-extrabold">{kpis.activeAreaHa.toFixed(1)} ha</div>
          </div>
          <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
            <div className="text-[10.5px] font-semibold text-[#64776f]">{t.kpiChoke}</div>
            <div className="font-mono-num text-[13px] font-extrabold">
              {kpis.chokeCount} {isEn ? 'spots' : 'titik'}
            </div>
          </div>
          <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
            <div className="text-[10.5px] font-semibold text-[#64776f]">{t.kpiRunoff}</div>
            <div className="font-mono-num text-[13px] font-extrabold">{kpis.runoffIndex} / 100</div>
          </div>
          <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
            <div className="text-[10.5px] font-semibold text-[#64776f]">{t.kpiReduction}</div>
            <div className="font-mono-num text-[13px] font-extrabold">
              {scenario === 'cleared' ? `-${kpis.reductionPct}%` : isEn ? 'Baseline' : 'Dasar'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
