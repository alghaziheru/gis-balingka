import { AlertTriangle, CloudRain, Pause, Play, RotateCcw } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { Language, LayerToggles, ViewMode } from '../types/gis';

interface SimulationTabProps {
  lang: Language;
  viewMode: ViewMode;
  playing: boolean;
  rainMm: number;
  durationMin: number;
  progress: number;
  scenario: 'clogged' | 'cleared';
  rainAnimEnabled: boolean;
  layers: LayerToggles;
  kpis: {
    elapsedMin: number;
    accumulatedMm: number;
    activeAreaHa: number;
    reductionPct: number;
    chokeCount: number;
    runoffIndex: number;
  };
  onTogglePlay: () => void;
  onResetSim: () => void;
  onChangeProgress: (progress: number) => void;
  onChangeRain: (rain: number) => void;
  onChangeDuration: (minutes: number) => void;
  onChangeScenario: (sc: 'clogged' | 'cleared') => void;
  onToggleRainAnim: (enabled: boolean) => void;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
}

function formatDurationClock(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDurationLabel(totalMinutes: number, isEn: boolean): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} ${isEn ? 'min' : 'mnt'}`;
  if (m === 0) return `${h} ${isEn ? 'hr' : 'jam'}`;
  return `${h} ${isEn ? 'hr' : 'jam'} ${m} ${isEn ? 'min' : 'mnt'}`;
}

export function SimulationTab({
  lang,
  viewMode,
  playing,
  rainMm,
  durationMin,
  progress,
  scenario,
  rainAnimEnabled,
  layers,
  kpis,
  onTogglePlay,
  onResetSim,
  onChangeProgress,
  onChangeRain,
  onChangeDuration,
  onChangeScenario,
  onToggleRainAnim,
  onToggleLayer
}: SimulationTabProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';

  const rainPresets = [
    { mm: 20, label: t.rainPresetLight, sub: '20' },
    { mm: 45, label: t.rainPresetMed, sub: '45' },
    { mm: 80, label: t.rainPresetHeavy, sub: '80' },
    { mm: 120, label: t.rainPresetExtreme, sub: '120' }
  ];

  const activePresetMm =
    rainMm <= 32 ? 20 : rainMm <= 62 ? 45 : rainMm <= 100 ? 80 : 120;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start gap-2.5 rounded-r-xl border-l-[3px] border-[#b45309] bg-[#b45309]/8 px-3.5 py-2.5 text-[13px] leading-snug text-[#78350f]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#b45309]" />
        <span>{isDetail ? t.simDisclaimerDetail : t.simDisclaimer}</span>
      </div>

      {/* Live Storm Playback & Timeline */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold text-[#161c1a]">{t.simPlaybackTitle}</span>
          <span className="font-mono-num rounded-md bg-[#f2f3ef] px-2 py-0.5 text-[12px] font-bold text-[#161c1a]">
            {formatDurationClock(kpis.elapsedMin)} / {formatDurationClock(durationMin)}
          </span>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0369a1] px-3.5 py-2 text-[13px] font-bold text-white transition hover:bg-[#075985]"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{playing ? t.pause : t.play}</span>
          </button>
          <button
            type="button"
            onClick={onResetSim}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-white px-3 py-2 text-[13px] font-semibold text-[#161c1a] hover:bg-[#f2f3ef]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t.simReset}</span>
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[12.5px] font-semibold text-[#434d49]">
            <span>{t.lblTimeline}</span>
            <span className="font-mono-num text-[#0369a1]">
              {t.lblAccumulated}: {kpis.accumulatedMm.toFixed(1)} mm
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(progress * 100)}
            onChange={e => onChangeProgress(parseInt(e.target.value, 10) / 100)}
            aria-label={t.lblTimeline}
            className="w-full cursor-pointer accent-[#0369a1]"
          />
          <div className="flex justify-between text-[11.5px] font-medium text-[#636f6a]">
            <span>00:00</span>
            <span>{formatDurationClock(durationMin / 2)}</span>
            <span>{formatDurationClock(durationMin)}</span>
          </div>
        </div>

        <label className="mt-2.5 flex min-h-[38px] cursor-pointer items-center justify-between gap-2 border-t border-[#161c1a]/10 pt-2.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-[#161c1a]">
            <CloudRain className="h-4 w-4 text-[#0369a1]" />
            <span>{t.lblRainAnim}</span>
          </span>
          <input
            type="checkbox"
            checked={rainAnimEnabled}
            onChange={e => onToggleRainAnim(e.target.checked)}
            className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
          />
        </label>
      </section>

      {/* Dual Intensity & Duration Sliders */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-3 text-[13px] font-bold text-[#161c1a]">{t.simControlTitle}</div>

        {/* Rainfall Intensity: quick presets + smooth slider in BOTH modes */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[13px] font-semibold text-[#434d49]">
            <span>{t.lblRainIntensity}</span>
            <span className="font-mono-num text-[13px] font-bold text-[#161c1a]">
              {rainMm} {isEn ? 'mm/hr' : 'mm/jam'}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {rainPresets.map(p => {
              const active = activePresetMm === p.mm;
              return (
                <button
                  key={p.mm}
                  type="button"
                  onClick={() => onChangeRain(p.mm)}
                  className={`flex min-h-[40px] flex-col items-center justify-center rounded-lg border px-1 py-1 text-center transition ${
                    active
                      ? 'border-[#0369a1] bg-[#0369a1] text-white'
                      : 'border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
                  }`}
                >
                  <span className="text-[12px] font-bold leading-tight">{p.label}</span>
                  <span className={`font-mono-num text-[10px] ${active ? 'text-white/85' : 'text-[#636f6a]'}`}>
                    {p.sub}
                  </span>
                </button>
              );
            })}
          </div>

          <input
            type="range"
            min={10}
            max={150}
            step={5}
            value={rainMm}
            aria-label={t.lblRainIntensity}
            onChange={e => onChangeRain(parseInt(e.target.value, 10))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />
          <div className="flex justify-between text-[11.5px] font-medium text-[#636f6a]">
            <span>{t.rainLight}</span>
            <span>{t.rainHeavy}</span>
            <span>{t.rainExtreme}</span>
          </div>
        </div>

        {/* Storm Duration Slider in BOTH modes */}
        <div className="mt-3.5 flex flex-col gap-1.5 border-t border-[#161c1a]/10 pt-3">
          <div className="flex items-center justify-between text-[13px] font-semibold text-[#434d49]">
            <span>{t.lblDuration}</span>
            <span className="font-mono-num text-[13px] font-bold text-[#161c1a]">
              {formatDurationLabel(durationMin, isEn)}
            </span>
          </div>
          <input
            type="range"
            min={15}
            max={360}
            step={15}
            value={durationMin}
            aria-label={t.lblDuration}
            onChange={e => onChangeDuration(parseInt(e.target.value, 10))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />
          <div className="flex justify-between text-[11.5px] font-medium text-[#636f6a]">
            <span>{t.durMin}</span>
            <span>{t.durMid}</span>
            <span>{t.durMax}</span>
          </div>
        </div>

        {/* Culvert Condition */}
        <div className="mt-3.5 border-t border-[#161c1a]/10 pt-3">
          <div className="mb-1.5 text-[13px] font-semibold text-[#434d49]">{t.lblDrainState}</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
            <button
              type="button"
              onClick={() => onChangeScenario('clogged')}
              className={`min-h-[38px] rounded-md py-1.5 text-[12.5px] font-bold transition ${
                scenario === 'clogged'
                  ? 'bg-white text-[#b91c1c] shadow-xs'
                  : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              {t.scClogged}
            </button>
            <button
              type="button"
              onClick={() => onChangeScenario('cleared')}
              className={`min-h-[38px] rounded-md py-1.5 text-[12.5px] font-bold transition ${
                scenario === 'cleared'
                  ? 'bg-white text-[#047857] shadow-xs'
                  : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              {t.scCleared}
            </button>
          </div>
        </div>

        <div
          className={`mt-3 rounded-lg px-3 py-2 text-[13px] font-semibold ${
            progress <= 0.03
              ? 'bg-[#f2f3ef] text-[#434d49]'
              : scenario === 'cleared'
              ? 'bg-[#047857]/10 text-[#047857]'
              : 'bg-[#b91c1c]/10 text-[#b91c1c]'
          }`}
        >
          {progress <= 0.03
            ? isEn
              ? 'Storm at 00:00 — press Play or drag timeline to watch runoff build up.'
              : 'Hujan baru dimulai (00:00) — tekan Putar atau geser waktu untuk melihat dampak genangan.'
            : scenario === 'cleared'
            ? isEn
              ? `-${kpis.reductionPct}% localized overflow around crossings${isDetail ? ' (HAND model)' : ''}`
              : `-${kpis.reductionPct}% potensi luapan di sekitar perlintasan${isDetail ? ' (model HAND)' : ''}`
            : isEn
            ? 'Blocked crossings push floodwater onto nearby low roads and yards.'
            : 'Gorong-gorong tersumbat memperluas genangan air ke jalan dan halaman warga.'}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="text-[12px] text-[#636f6a]">{isDetail ? t.kpiArea : t.kpiSimpleArea}</div>
            <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
              {kpis.activeAreaHa.toFixed(1)} ha
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="text-[12px] text-[#636f6a]">{isDetail ? t.kpiChoke : t.kpiSimpleCrossings}</div>
            <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
              {kpis.chokeCount} {isEn ? 'spots' : 'titik'}
            </div>
          </div>
          {isDetail && (
            <>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="text-[12px] text-[#636f6a]">{t.kpiRunoff}</div>
                <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">{kpis.runoffIndex} / 100</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="text-[12px] text-[#636f6a]">{t.kpiReduction}</div>
                <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                  {scenario === 'cleared' && progress > 0.03 ? `-${kpis.reductionPct}%` : isEn ? 'Baseline' : 'Dasar'}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Unified Flood & Point Legend + Interactive Toggles */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 text-[13px] font-bold text-[#161c1a]">{t.simLegendTitle}</div>
        <div className="flex flex-col gap-1.5 border-b border-[#161c1a]/10 pb-2.5">
          <div className="flex items-center gap-2.5 text-[13px] text-[#161c1a]">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#b91c1c]" />
            <span>
              {isEn ? 'High flood risk zone' : 'Zona rawan genangan tinggi'}
              {isDetail ? ' (HAND ≤2,2m)' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-[#161c1a]">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#0284c7]" />
            <span>
              {isEn ? 'Moderate flood zone' : 'Zona genangan sedang'}
              {isDetail ? ' (HAND ≤4,8m)' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-[#161c1a]">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#38bdf8]" />
            <span>
              {isEn ? 'Outer spread zone' : 'Zona perluasan air'}
              {isDetail ? ' (HAND ≤8,0m)' : ''}
            </span>
          </div>
        </div>

        <div className="divide-y divide-[#161c1a]/10 pt-1">
          <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-2.5 py-1">
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
              <span className="h-3 w-3 shrink-0 rounded-full border border-white bg-[#047857] shadow-[0_0_0_1px_rgba(22,28,26,0.2)]" />
              <span>{t.lblEvac}</span>
            </span>
            <input
              type="checkbox"
              checked={layers.evac}
              onChange={e => onToggleLayer('evac', e.target.checked)}
              className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
            />
          </label>
          {isDetail && (
            <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-2.5 py-1">
              <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
                <span className="h-3 w-3 shrink-0 rounded-full border border-white bg-[#0369a1] shadow-[0_0_0_1px_rgba(22,28,26,0.2)]" />
                <span>{t.lblBronjong}</span>
              </span>
              <input
                type="checkbox"
                checked={layers.bronjong}
                onChange={e => onToggleLayer('bronjong', e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>
          )}
        </div>
      </section>
    </div>
  );
}
