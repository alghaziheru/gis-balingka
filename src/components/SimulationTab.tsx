import { useState } from 'react';
import { AlertTriangle, CloudRain, Mountain, Pause, Play, RotateCcw } from 'lucide-react';
import { I18N } from '../i18n/translations';
import { estimateChannelThresholds } from '../lib/channelHydraulics';
import type { DemClient } from '../lib/demClient';
import type {
  AgamStats,
  CascadeAlertLevel,
  CascadeKpis,
  DrainCondition,
  ForestScenario,
  Language,
  LayerToggles,
  RainPattern,
  SoilMoisture,
  VerifiedWaterwayFeature,
  ViewMode
} from '../types/gis';
import { LegendIcon } from './LegendIcon';

interface SimulationTabProps {
  lang: Language;
  viewMode: ViewMode;
  playing: boolean;
  rainMm: number;
  durationMin: number;
  progress: number;
  soilMoisture: SoilMoisture;
  rainPattern: RainPattern;
  drainCondition: DrainCondition;
  forestScenario: ForestScenario;
  forestActualPct: number;
  rainAnimEnabled: boolean;
  layers: LayerToggles;
  verifiedIssueCount?: number;
  verifiedWaterways?: VerifiedWaterwayFeature[];
  demClient?: DemClient | null;
  agamStats?: AgamStats;
  kpis: CascadeKpis;
  onTogglePlay: () => void;
  onResetSim: () => void;
  onChangeProgress: (progress: number) => void;
  onChangeRain: (rain: number) => void;
  onChangeDuration: (minutes: number) => void;
  onChangeSoilMoisture: (m: SoilMoisture) => void;
  onChangeRainPattern: (p: RainPattern) => void;
  onChangeDrainCondition: (d: DrainCondition) => void;
  onChangeForestScenario: (f: ForestScenario) => void;
  onApplyPreset: (preset: 'normal' | 'upland' | 'extreme') => void;
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

const ALERT_BADGE: Record<CascadeAlertLevel, { bg: string; text: string }> = {
  normal: { bg: 'bg-[#047857]/12', text: 'text-[#047857]' },
  waspada: { bg: 'bg-[#b45309]/14', text: 'text-[#92400e]' },
  siaga: { bg: 'bg-[#c2410c]/14', text: 'text-[#c2410c]' },
  kritis: { bg: 'bg-[#b91c1c]/14', text: 'text-[#b91c1c]' }
};

export function SimulationTab({
  lang,
  viewMode,
  playing,
  rainMm,
  durationMin,
  progress,
  soilMoisture,
  rainPattern,
  drainCondition,
  forestScenario,
  forestActualPct,
  rainAnimEnabled,
  layers,
  verifiedIssueCount = 0,
  verifiedWaterways = [],
  demClient = null,
  agamStats,
  kpis,
  onTogglePlay,
  onResetSim,
  onChangeProgress,
  onChangeRain,
  onChangeDuration,
  onChangeSoilMoisture,
  onChangeRainPattern,
  onChangeDrainCondition,
  onChangeForestScenario,
  onApplyPreset,
  onToggleRainAnim,
  onToggleLayer
}: SimulationTabProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';
  const [selectedRiverId, setSelectedRiverId] = useState<string>('');

  const rainPresets = [
    { mm: 20, label: t.rainPresetLight, sub: '20' },
    { mm: 45, label: t.rainPresetMed, sub: '45' },
    { mm: 80, label: t.rainPresetHeavy, sub: '80' },
    { mm: 120, label: t.rainPresetExtreme, sub: '120' }
  ];

  const activePresetMm =
    rainMm <= 32 ? 20 : rainMm <= 62 ? 45 : rainMm <= 100 ? 80 : 120;

  const alertText =
    kpis.alertLevel === 'kritis'
      ? t.alertKritis
      : kpis.alertLevel === 'siaga'
      ? t.alertSiaga
      : kpis.alertLevel === 'waspada'
      ? t.alertWaspada
      : t.alertNormal;
  const alertStyle = ALERT_BADGE[kpis.alertLevel];

  const stageTitle =
    kpis.stage === 0
      ? t.stage0Title
      : kpis.stage === 1
      ? t.stage1Title
      : kpis.stage === 2
      ? t.stage2Title
      : kpis.stage === 3
      ? t.stage3Title
      : t.stage4Title;

  const stageDesc =
    kpis.stage === 0
      ? t.stage0Desc
      : kpis.stage === 1
      ? t.stage1Desc
      : kpis.stage === 2
      ? t.stage2Desc
      : kpis.stage === 3
      ? t.stage3Desc
      : t.stage4Desc;

  const drainOptions: { id: DrainCondition; label: string; activeText: string }[] = isDetail
    ? [
        { id: 'cleared', label: t.scCleared, activeText: 'text-[#047857]' },
        { id: 'clogged', label: t.scClogged, activeText: 'text-[#b45309]' },
        { id: 'surge', label: t.scSurge, activeText: 'text-[#b91c1c]' }
      ]
    : [
        { id: 'clogged', label: t.scClogged, activeText: 'text-[#b45309]' },
        { id: 'cleared', label: t.scCleared, activeText: 'text-[#047857]' }
      ];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start gap-2.5 rounded-r-xl border-l-[3px] border-[#b45309] bg-[#b45309]/8 px-3.5 py-2.5 text-[12.5px] leading-snug text-[#78350f]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#b45309]" />
        <span>{isDetail ? t.simDisclaimerDetail : t.simDisclaimer}</span>
      </div>

      {/* Live Cascade Playback & 4-Stage Progress */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold text-[#161c1a]">{t.simPlaybackTitle}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${alertStyle.bg} ${alertStyle.text}`}>
            {alertText}
          </span>
        </div>

        {/* 4-Stage Cascade Bar */}
        <div className="mb-2.5 rounded-lg bg-[#fafaf8] p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold text-[#161c1a]">{stageTitle}</span>
            <span className="font-mono-num text-[11.5px] font-bold text-[#0369a1]">
              {formatDurationClock(kpis.elapsedMin)} / {formatDurationClock(durationMin)}
            </span>
          </div>
          <div className="mb-1.5 grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map(st => (
              <div
                key={st}
                className={`h-1.5 rounded-full transition ${
                  kpis.stage >= st ? 'bg-[#0369a1]' : 'bg-[#161c1a]/12'
                }`}
              />
            ))}
          </div>
          <p className="m-0 text-[12px] leading-snug text-[#434d49]">{stageDesc}</p>
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

      {/* Quick Scenario Presets */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 text-[12.5px] font-bold text-[#434d49]">{t.presetQuickTitle}</div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => onApplyPreset('normal')}
            className="min-h-[38px] rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-1.5 text-[12px] font-bold text-[#047857] hover:bg-[#f2f3ef]"
          >
            {t.presetNormal}
          </button>
          <button
            type="button"
            onClick={() => onApplyPreset('upland')}
            className="min-h-[38px] rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-1.5 text-[12px] font-bold text-[#b45309] hover:bg-[#f2f3ef]"
          >
            {t.presetUpland}
          </button>
          <button
            type="button"
            onClick={() => onApplyPreset('extreme')}
            className="min-h-[38px] rounded-lg border border-[#b91c1c]/30 bg-[#b91c1c]/8 px-2 py-1.5 text-[12px] font-bold text-[#b91c1c] hover:bg-[#b91c1c]/14"
          >
            {t.presetExtreme}
          </button>
        </div>
      </section>

      {/* Rain, Soil & Channel Parameters */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-3 text-[13px] font-bold text-[#161c1a]">{t.simControlTitle}</div>

        {/* Rainfall Intensity */}
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

        {/* Storm Duration */}
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

        {/* Soil Moisture (Antecedent Rainfall) */}
        <div className="mt-3.5 border-t border-[#161c1a]/10 pt-3">
          <div className="mb-1.5 text-[13px] font-semibold text-[#434d49]">{t.lblSoilMoisture}</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
            {(
              [
                ['dry', t.soilDry, 'text-[#047857]'],
                ['moist', t.soilMoist, 'text-[#0369a1]'],
                ['saturated', t.soilSaturated, 'text-[#b91c1c]']
              ] as const
            ).map(([id, label, activeCls]) => (
              <button
                key={id}
                type="button"
                onClick={() => onChangeSoilMoisture(id)}
                className={`min-h-[36px] rounded-md py-1 text-[12.5px] font-bold transition ${
                  soilMoisture === id ? `bg-white ${activeCls} shadow-xs` : 'text-[#434d49] hover:text-[#161c1a]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Rainfall Spatial Pattern */}
        <div className="mt-3 border-t border-[#161c1a]/10 pt-3">
          <div className="mb-1.5 text-[13px] font-semibold text-[#434d49]">{t.lblRainPattern}</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
            <button
              type="button"
              onClick={() => onChangeRainPattern('uniform')}
              className={`min-h-[36px] rounded-md py-1 text-[12.5px] font-bold transition ${
                rainPattern === 'uniform' ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              {t.rainUniform}
            </button>
            <button
              type="button"
              onClick={() => onChangeRainPattern('upland')}
              className={`inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md py-1 text-[12.5px] font-bold transition ${
                rainPattern === 'upland' ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              <Mountain className="h-3.5 w-3.5" />
              <span>{t.rainUpland}</span>
            </button>
          </div>
        </div>

        {/* Culvert & Debris Blockage Condition */}
        <div className="mt-3 border-t border-[#161c1a]/10 pt-3">
          <div className="mb-1.5 text-[13px] font-semibold text-[#434d49]">{t.lblDrainState}</div>
          <div
            className={`grid gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1 ${
              isDetail ? 'grid-cols-3' : 'grid-cols-2'
            }`}
          >
            {drainOptions.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeDrainCondition(opt.id)}
                className={`min-h-[36px] rounded-md px-1.5 py-1 text-[12px] font-bold transition ${
                  drainCondition === opt.id
                    ? `bg-white ${opt.activeText} shadow-xs`
                    : 'text-[#434d49] hover:text-[#161c1a]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Detailed-only Upland Forest What-If */}
        {isDetail && (
          <div className="mt-3 border-t border-[#161c1a]/10 pt-3">
            <div className="mb-1.5 flex items-center justify-between text-[13px] font-semibold text-[#434d49]">
              <span>{t.lblForestScenario}</span>
              <span className="font-mono-num text-[11.5px] text-[#15803d]">{forestActualPct}%</span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
              {(
                [
                  ['actual', t.forestActual, 'text-[#15803d]'],
                  ['degraded30', t.forestDeg30, 'text-[#b45309]'],
                  ['degraded50', t.forestDeg50, 'text-[#b91c1c]']
                ] as const
              ).map(([id, label, activeCls]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeForestScenario(id)}
                  className={`min-h-[36px] rounded-md px-1 py-1 text-[11.5px] font-bold transition ${
                    forestScenario === id ? `bg-white ${activeCls} shadow-xs` : 'text-[#434d49] hover:text-[#161c1a]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {verifiedIssueCount > 0 && progress > 0.02 && drainCondition !== 'cleared' && (
          <div className="mt-3 rounded-lg bg-[#b45309]/10 px-3 py-2 text-[12px] font-semibold text-[#92400e]">
            {isEn
              ? `${verifiedIssueCount} field-confirmed clogged/critical culvert(s) highlighted on map.`
              : `${verifiedIssueCount} gorong-gorong bermasalah di lapangan disorot terlebih dulu di peta.`}
          </div>
        )}
      </section>

      {/* Indicative Cascade KPIs */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#161c1a]">
            {isEn ? 'Indicative Cascade Impact' : 'Ringkasan Dampak Indikatif'}
          </span>
          {drainCondition === 'cleared' && progress > 0.03 && kpis.reductionPct > 0 && (
            <span className="font-mono-num rounded-md bg-[#047857]/12 px-2 py-0.5 text-[11.5px] font-bold text-[#047857]">
              -{kpis.reductionPct}% {isEn ? 'overflow' : 'luapan'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="text-[12px] text-[#636f6a]">{t.kpiFloodArea}</div>
            <div className="font-mono-num text-[15px] font-bold text-[#0369a1]">
              {kpis.floodAreaHa.toFixed(1)} ha
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="text-[12px] text-[#636f6a]">{t.kpiLandslideArea}</div>
            <div className="font-mono-num text-[15px] font-bold text-[#c2410c]">
              {kpis.landslideAreaHa.toFixed(1)} ha
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="text-[12px] text-[#636f6a]">{t.kpiBuildings}</div>
            <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
              ~{kpis.affectedBuildingsFlood}
              {kpis.affectedBuildingsLandslide > 0 ? ` (+${kpis.affectedBuildingsLandslide})` : ''}
            </div>
            <div className="mt-0.5 text-[10.5px] leading-tight text-[#636f6a]">{t.kpiBuildingsNote}</div>
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
                <div className="text-[12px] text-[#636f6a]">{t.kpiEffectiveRunoff}</div>
                <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                  {kpis.effectiveRunoffMm.toFixed(1)} mm
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="text-[12px] text-[#636f6a]">{t.kpiTravelTime}</div>
                <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                  ~{Math.round(kpis.peakTravelMin)} {isEn ? 'min' : 'mnt'}
                </div>
              </div>
            </>
          )}
        </div>
        {isDetail && agamStats && (
          <div className="mt-2.5 rounded-lg bg-[#fafaf8] px-2.5 py-2 text-[11.5px] leading-snug text-[#434d49]">
            <strong className="text-[#161c1a]">
              {isEn ? 'Pemkab Agam Calibration:' : 'Kalibrasi Pemkab Agam:'}
            </strong>{' '}
            {isEn
              ? `${agamStats.andosolPct}% volcanic Andosol soil.`
              : `${agamStats.andosolPct}% tanah vulkanik Andosol.`}{' '}
            {kpis.landslideAreaHa > 0
              ? isEn
                ? `${kpis.officialLandslideOverlapPct}% of high-risk modeled slopes match official BPBD Medium/High zones.`
                : `${kpis.officialLandslideOverlapPct}% zona lereng kritis cocok dengan peta Rawan Gerakan Tanah Sedang/Tinggi Pemkab Agam.`
              : isEn
              ? `Official zones: ${agamStats.officialHighPct}% High, ${agamStats.officialMedPct}% Medium.`
              : `Zona resmi: ${agamStats.officialHighPct}% Tinggi, ${agamStats.officialMedPct}% Sedang.`}
          </div>
        )}
      </section>

      {/* Detailed-only River Width & Bank-Widening Threshold Calculator */}
      {isDetail && verifiedWaterways.length > 0 && (() => {
        const activeWw =
          verifiedWaterways.find(w => w.properties.id === selectedRiverId) ||
          verifiedWaterways.find(w => w.properties.kind === 'river') ||
          verifiedWaterways[0];
        const coords = activeWw.geometry.coordinates;
        const hasMeasured = activeWw.properties.width_post_m != null || activeWw.properties.width_pre_m != null;
        const widthPostM = activeWw.properties.width_post_m ?? (activeWw.properties.kind === 'river' ? 6.5 : 3.2);
        const widthPreM = activeWw.properties.width_pre_m ?? null;
        const depthM = activeWw.properties.depth_m ?? (activeWw.properties.kind === 'river' ? 1.6 : 0.9);

        let slopePct = activeWw.properties.kind === 'river' ? 3.5 : 6.5;
        if (demClient && coords.length >= 2) {
          const e0 = demClient.getElevation(coords[0][0], coords[0][1]);
          const e1 = demClient.getElevation(coords[coords.length - 1][0], coords[coords.length - 1][1]);
          const len = Math.max(80, activeWw.properties.length_m || 400);
          const s = (Math.abs(e0 - e1) / len) * 100;
          if (s >= 0.8) slopePct = s;
        }
        const catchmentKm2 = activeWw.properties.kind === 'river' ? 3.8 : 1.4;
        const calc = estimateChannelThresholds({
          widthM: widthPostM,
          widthPreM,
          depthM,
          slopePct,
          catchmentKm2,
          soilMoisture
        });

        return (
          <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-[#161c1a]">{t.channelCalcTitle}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                  hasMeasured ? 'bg-[#047857]/12 text-[#047857]' : 'bg-[#64748b]/12 text-[#475569]'
                }`}
              >
                {hasMeasured
                  ? isEn
                    ? 'Field measured'
                    : 'Ukuran lapangan'
                  : isEn
                  ? 'Default est.'
                  : 'Estimasi default'}
              </span>
            </div>

            <select
              aria-label={t.channelCalcTitle}
              value={activeWw.properties.id}
              onChange={e => setSelectedRiverId(e.target.value)}
              className="mb-2.5 min-h-[36px] w-full rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1 text-[12.5px] font-semibold text-[#161c1a]"
            >
              {verifiedWaterways.map(w => (
                <option key={w.properties.id} value={w.properties.id}>
                  {w.properties.name} ({w.properties.kind})
                </option>
              ))}
            </select>

            <div className="mb-2.5 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-[#fafaf8] px-2 py-1.5">
                <div className="text-[10.5px] text-[#636f6a]">{isEn ? 'Width' : 'Lebar'}</div>
                <div className="font-mono-num text-[12.5px] font-bold text-[#161c1a]">
                  {calc.widthPreM != null ? `${calc.widthPreM}→${calc.widthM}m` : `~${calc.widthM}m`}
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-2 py-1.5">
                <div className="text-[10.5px] text-[#636f6a]">{isEn ? 'Depth' : 'Dalam'}</div>
                <div className="font-mono-num text-[12.5px] font-bold text-[#161c1a]">~{calc.depthM}m</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-2 py-1.5">
                <div className="text-[10.5px] text-[#636f6a]">{isEn ? 'Slope' : 'Lereng'}</div>
                <div className="font-mono-num text-[12.5px] font-bold text-[#161c1a]">{calc.slopePct}%</div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 text-[12px]">
              <div className="flex items-center justify-between rounded-lg bg-[#0369a1]/8 px-2.5 py-1.5">
                <span className="font-semibold text-[#161c1a]">
                  {isEn ? 'Bankfull overflow (Manning)' : 'Mulai meluap (Manning)'}
                </span>
                <span className="font-mono-num font-bold text-[#0369a1]">
                  {calc.overflowRange[0]}–{calc.overflowRange[1]} {isEn ? 'mm/hr' : 'mm/jam'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#b45309]/10 px-2.5 py-1.5">
                <span className="font-semibold text-[#161c1a]">
                  {isEn ? 'Bank widening (ω ≥ 300 W/m²)' : 'Pelebaran tebing (ω ≥ 300 W/m²)'}
                </span>
                <span className="font-mono-num font-bold text-[#b45309]">
                  {calc.wideningRange[0]}–{calc.wideningRange[1]} {isEn ? 'mm/hr' : 'mm/jam'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#b91c1c]/10 px-2.5 py-1.5">
                <span className="font-semibold text-[#161c1a]">
                  {isEn ? 'Severe galodo scour (ω ≥ 1000)' : 'Gerusan galodo berat (ω ≥ 1000)'}
                </span>
                <span className="font-mono-num font-bold text-[#b91c1c]">
                  {calc.severeScourRange[0]}–{calc.severeScourRange[1]} {isEn ? 'mm/hr' : 'mm/jam'}
                </span>
              </div>
            </div>

            <p className="mt-2 mb-0 text-[11px] leading-snug text-[#636f6a]">
              {isEn
                ? '±25% range using Manning (n=0.045) & Specific Stream Power under active soil moisture. Enter field-measured widths in Editor → Waterways.'
                : 'Rentang ±25% berdasarkan rumus Manning (n=0,045) & Specific Stream Power pada kondisi tanah aktif. Ukur lebar asli di Editor → Jalur Air agar lebih presisi.'}
            </p>
          </section>
        );
      })()}

      {/* Unified Cascade Legend + Toggles */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 text-[13px] font-bold text-[#161c1a]">{t.simLegendTitle}</div>
        <div className="flex flex-col gap-1.5 border-b border-[#161c1a]/10 pb-2.5">
          <div className="flex items-center gap-2.5 text-[13px] text-[#161c1a]">
            <LegendIcon kind="flow" />
            <span>
              {isEn ? 'Rainwater runoff wave (upstream → river)' : 'Gelombang air limpasan (hulu → sungai)'}
            </span>
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-[#161c1a]">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#0369a1]" />
            <span>{isEn ? 'Deep valley surge (>1.5m HAND proxy)' : 'Luapan koridor utama (>1,5m)'}</span>
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-[#161c1a]">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#7dd3fc]" />
            <span>{isEn ? 'Shallow low-ground overflow' : 'Genangan koridor rendah'}</span>
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-[#161c1a]">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#ea580c]" />
            <span>{isEn ? 'Saturated steep slope (landslide risk)' : 'Lereng jenuh rawan longsor'}</span>
          </div>
        </div>

        <div className="divide-y divide-[#161c1a]/10 pt-1">
          <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-2.5 py-1">
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
              <LegendIcon kind="settlements" />
              <span>{t.lblSettlements}</span>
            </span>
            <input
              type="checkbox"
              checked={layers.settlements}
              onChange={e => onToggleLayer('settlements', e.target.checked)}
              className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
            />
          </label>
          <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-2.5 py-1">
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
              <LegendIcon kind="evacuation" />
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
                <LegendIcon kind="bronjong" />
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
