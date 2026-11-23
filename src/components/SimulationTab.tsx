import { useId, useState } from 'react';
import { AlertTriangle, Pause, Play, RotateCcw } from 'lucide-react';
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
  RainPattern,
  SoilMoisture,
  VerifiedWaterwayFeature,
  ViewMode
} from '../types/gis';
import { InfoTooltip } from './InfoTooltip';
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
  onToggleRainAnim
}: SimulationTabProps) {
  const uid = useId();
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';
  const [selectedRiverId, setSelectedRiverId] = useState<string>('');

  const activeScenario: 'normal' | 'upland' | 'extreme' | 'custom' =
    rainMm === 25 &&
    durationMin === 90 &&
    soilMoisture === 'dry' &&
    rainPattern === 'uniform' &&
    drainCondition === 'cleared' &&
    (!isDetail || forestScenario === 'actual')
      ? 'normal'
      : rainMm === 80 &&
          durationMin === 180 &&
          soilMoisture === 'saturated' &&
          rainPattern === 'upland' &&
          drainCondition === 'clogged' &&
          (!isDetail || forestScenario === 'actual')
        ? 'upland'
        : rainMm === 120 &&
            durationMin === 180 &&
            soilMoisture === 'saturated' &&
            rainPattern === 'upland' &&
            drainCondition === (isDetail ? 'surge' : 'clogged') &&
            (!isDetail || forestScenario === 'actual')
          ? 'extreme'
          : 'custom';

  const rainCategoryLabel =
    rainMm <= 32
      ? t.rainPresetLight
      : rainMm <= 62
        ? t.rainPresetMed
        : rainMm <= 100
          ? t.rainPresetHeavy
          : t.rainPresetExtreme;

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

  const agamCalibrationTooltip = agamStats
    ? isEn
      ? `Open Pemkab Agam polygon attributes used as model inputs (${agamStats.andosolPct}% Andosol soil). ${
          kpis.landslideAreaHa > 0
            ? `${kpis.officialLandslideOverlapPct}% of modeled steep-slope cells overlap Pemkab Agam Medium/High ground-movement polygons.`
            : `Pemkab Agam ground-movement polygons: ${agamStats.officialHighPct}% High, ${agamStats.officialMedPct}% Medium.`
        }`
      : `Atribut peta terbuka Pemkab Agam yang dipakai sebagai input model (${agamStats.andosolPct}% tanah Andosol). ${
          kpis.landslideAreaHa > 0
            ? `${kpis.officialLandslideOverlapPct}% sel lereng curam pada luaran model beririsan dengan poligon Peta Gerakan Tanah Sedang/Tinggi Pemkab Agam.`
            : `Poligon Peta Gerakan Tanah Pemkab Agam: ${agamStats.officialHighPct}% Tinggi, ${agamStats.officialMedPct}% Sedang.`
        }`
    : '';

  const isAtEnd = !playing && progress >= 0.99;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Compact Sticky Playback Bar */}
      <div className="sticky -top-3.5 z-10 -mx-3.5 -mt-3.5 border-b border-[#161c1a]/12 bg-white px-3.5 pt-3 pb-2.5 shadow-[0_4px_12px_-6px_rgba(22,28,26,0.12)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] font-bold text-[#161c1a]">{stageTitle}</span>
            <InfoTooltip text={stageDesc} label={stageTitle} />
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${alertStyle.bg} ${alertStyle.text}`}>
            {alertText}
          </span>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold text-white transition ${
              playing ? 'bg-[#161c1a] hover:bg-[#2a3330]' : 'bg-[#0369a1] hover:bg-[#075985]'
            }`}
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5" />
            ) : isAtEnd ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>{playing ? t.pause : isAtEnd ? t.simReplay : t.play}</span>
          </button>
          <button
            type="button"
            onClick={onResetSim}
            disabled={progress === 0 && !playing}
            aria-label={t.simReset}
            title={t.simReset}
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg border border-[#161c1a]/15 bg-white text-[#161c1a] transition hover:bg-[#f2f3ef] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="font-mono-num font-bold text-[#0369a1]">
              {formatDurationClock(kpis.elapsedMin)} / {formatDurationClock(durationMin)}
            </span>
            <span className="font-mono-num font-semibold text-[#434d49]">
              {kpis.accumulatedMm.toFixed(1)} mm
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
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map(st => (
              <div
                key={st}
                className={`h-1 rounded-full transition ${
                  kpis.stage >= st ? 'bg-[#0369a1]' : 'bg-[#161c1a]/12'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-start justify-between gap-1.5 rounded-md border border-[#b45309]/25 bg-[#b45309]/8 px-2.5 py-1.5 text-[11px] leading-snug font-semibold text-[#78350f]">
          <span className="flex min-w-0 items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b45309]" />
            <span>{t.simIndicativeShort}</span>
          </span>
          <InfoTooltip
            text={isDetail ? t.simDisclaimerDetail : t.simDisclaimer}
            label={isEn ? 'Model scope & disclaimer' : 'Penjelasan batas model'}
          />
        </div>
      </div>

      {/* Rain, Soil & Channel Parameters — Strictly Dropdown, Slider, Checkbox */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 text-[13px] font-bold text-[#161c1a]">{t.simControlTitle}</div>

        {/* Dropdown 1: Scenario Preset (single-line) */}
        <div className="flex items-center justify-between gap-2.5 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-semibold text-[#434d49]">
            <label htmlFor={`${uid}-scenario`} className="truncate">
              {t.presetQuickTitle}
            </label>
            <InfoTooltip text={t.infoScenario} label={t.presetQuickTitle} />
          </div>
          <select
            id={`${uid}-scenario`}
            value={activeScenario}
            onChange={e => {
              const val = e.target.value;
              if (val === 'normal' || val === 'upland' || val === 'extreme') {
                onApplyPreset(val);
              }
            }}
            className="min-h-[34px] w-[158px] shrink-0 cursor-pointer rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] transition hover:border-[#161c1a]/30"
          >
            <option value="custom">{t.presetCustom}</option>
            <option value="normal">{t.presetNormal}</option>
            <option value="upland">{t.presetUpland}</option>
            <option value="extreme">{t.presetExtreme}</option>
          </select>
        </div>

        {/* Slider 1: Rainfall Intensity */}
        <div className="mt-2.5 flex flex-col gap-1.5 border-t border-[#161c1a]/10 pt-3">
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="flex items-center gap-1.5 font-semibold text-[#434d49]">
              <label htmlFor={`${uid}-rain`}>{t.lblRainIntensity}</label>
              <InfoTooltip text={t.infoRainIntensity} label={t.lblRainIntensity} />
            </span>
            <span className="font-mono-num shrink-0 font-bold text-[#161c1a]">
              {rainMm} {isEn ? 'mm/hr' : 'mm/jam'} · {rainCategoryLabel}
            </span>
          </div>
          <input
            id={`${uid}-rain`}
            type="range"
            min={10}
            max={150}
            step={5}
            value={rainMm}
            onChange={e => onChangeRain(parseInt(e.target.value, 10))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />
          <div className="flex justify-between text-[11px] font-medium text-[#636f6a]">
            <span>{t.rainLight}</span>
            <span>{t.rainHeavy}</span>
            <span>{t.rainExtreme}</span>
          </div>
        </div>

        {/* Slider 2: Storm Duration */}
        <div className="mt-3 flex flex-col gap-1.5 border-t border-[#161c1a]/10 pt-3">
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="flex items-center gap-1.5 font-semibold text-[#434d49]">
              <label htmlFor={`${uid}-duration`}>{t.lblDuration}</label>
              <InfoTooltip text={t.infoDuration} label={t.lblDuration} />
            </span>
            <span className="font-mono-num shrink-0 font-bold text-[#161c1a]">
              {formatDurationLabel(durationMin, isEn)}
            </span>
          </div>
          <input
            id={`${uid}-duration`}
            type="range"
            min={15}
            max={360}
            step={15}
            value={durationMin}
            onChange={e => onChangeDuration(parseInt(e.target.value, 10))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />
          <div className="flex justify-between text-[11px] font-medium text-[#636f6a]">
            <span>{t.durMin}</span>
            <span>{t.durMid}</span>
            <span>{t.durMax}</span>
          </div>
        </div>

        {/* Single-line Parameter Dropdowns */}
        <div className="mt-3 divide-y divide-[#161c1a]/10 border-t border-[#161c1a]/10">
          {/* Dropdown 2: Soil Moisture */}
          <div className="flex items-center justify-between gap-2.5 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-semibold text-[#434d49]">
              <label htmlFor={`${uid}-soil`} className="truncate">
                {t.lblSoilShort}
              </label>
              <InfoTooltip text={t.infoSoilMoisture} label={t.lblSoilShort} />
            </div>
            <select
              id={`${uid}-soil`}
              value={soilMoisture}
              onChange={e => onChangeSoilMoisture(e.target.value as SoilMoisture)}
              className="min-h-[34px] w-[158px] shrink-0 cursor-pointer rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] transition hover:border-[#161c1a]/30"
            >
              <option value="dry">{t.soilDry}</option>
              <option value="moist">{t.soilMoist}</option>
              <option value="saturated">{t.soilSaturated}</option>
            </select>
          </div>

          {/* Dropdown 3: Culvert & Channel State */}
          <div className="flex items-center justify-between gap-2.5 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-semibold text-[#434d49]">
              <label htmlFor={`${uid}-drain`} className="truncate">
                {t.lblDrainShort}
              </label>
              <InfoTooltip text={t.infoDrainState} label={t.lblDrainShort} />
            </div>
            <select
              id={`${uid}-drain`}
              value={drainCondition}
              onChange={e => onChangeDrainCondition(e.target.value as DrainCondition)}
              className="min-h-[34px] w-[158px] shrink-0 cursor-pointer rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] transition hover:border-[#161c1a]/30"
            >
              <option value="cleared">{t.scCleared}</option>
              <option value="clogged">{t.scClogged}</option>
              {isDetail && <option value="surge">{t.scSurge}</option>}
            </select>
          </div>

          {/* Dropdown 4 (Detailed only): Upland Forest What-If */}
          {isDetail && (
            <div className="flex items-center justify-between gap-2.5 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-semibold text-[#434d49]">
                <label htmlFor={`${uid}-forest`} className="truncate">
                  {t.lblForestShort}
                </label>
                <InfoTooltip text={t.infoForestScenario} label={t.lblForestShort} />
              </div>
              <select
                id={`${uid}-forest`}
                value={forestScenario}
                onChange={e => onChangeForestScenario(e.target.value as ForestScenario)}
                className="min-h-[34px] w-[158px] shrink-0 cursor-pointer rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] transition hover:border-[#161c1a]/30"
              >
                <option value="actual">
                  {isEn ? `Actual (${Math.round(forestActualPct)}%)` : `Aktual (${Math.round(forestActualPct)}%)`}
                </option>
                <option value="degraded30">{t.forestDeg30}</option>
                <option value="degraded50">{t.forestDeg50}</option>
              </select>
            </div>
          )}
        </div>

        {/* Checkboxes: Rainfall Focus & Falling Rain Visual */}
        <div className="divide-y divide-[#161c1a]/10 border-t border-[#161c1a]/10 pt-1">
          <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <label
                htmlFor={`${uid}-upland-check`}
                className="cursor-pointer text-[12.5px] font-semibold text-[#161c1a]"
              >
                {t.lblRainUplandCheck}
              </label>
              <InfoTooltip text={t.infoRainPattern} label={t.lblRainUplandCheck} />
            </div>
            <input
              id={`${uid}-upland-check`}
              type="checkbox"
              checked={rainPattern === 'upland'}
              onChange={e => onChangeRainPattern(e.target.checked ? 'upland' : 'uniform')}
              className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
            />
          </div>

          <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <label
                htmlFor={`${uid}-anim-check`}
                className="cursor-pointer text-[12.5px] font-semibold text-[#161c1a]"
              >
                {t.lblRainAnim}
              </label>
              <InfoTooltip text={t.infoRainAnim} label={t.lblRainAnim} />
            </div>
            <input
              id={`${uid}-anim-check`}
              type="checkbox"
              checked={rainAnimEnabled}
              onChange={e => onToggleRainAnim(e.target.checked)}
              className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
            />
          </div>
        </div>

        {verifiedIssueCount > 0 && progress > 0.02 && drainCondition !== 'cleared' && (
          <div className="mt-2.5 rounded-lg bg-[#b45309]/10 px-3 py-2 text-[12px] font-semibold text-[#92400e]">
            {isEn
              ? `${verifiedIssueCount} field-recorded clogged/damaged culvert(s) highlighted on map.`
              : `${verifiedIssueCount} titik gorong-gorong berstatus tersumbat/rusak di lapangan disorot pada peta.`}
          </div>
        )}
      </section>

      {/* Model Output Summary */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[13px] font-bold text-[#161c1a]">
            {isEn ? 'Computed Model Outputs' : 'Ringkasan Luaran Model'}
          </span>
          <div className="flex items-center gap-1.5">
            {drainCondition === 'cleared' && progress > 0.03 && kpis.reductionPct > 0 && (
              <span className="font-mono-num rounded-md bg-[#047857]/12 px-2 py-0.5 text-[11px] font-bold text-[#047857]">
                -{kpis.reductionPct}% {isEn ? 'HAND zone' : 'area model'}
              </span>
            )}
            {isDetail && agamStats && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f2f3ef] px-2 py-0.5 text-[10.5px] font-semibold text-[#434d49]">
                <span>{t.agamCalibrationBadge}</span>
                <InfoTooltip text={agamCalibrationTooltip} label={t.agamCalibrationBadge} />
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
              <span>{t.kpiFloodArea}</span>
              <InfoTooltip text={t.infoKpiFlood} label={t.kpiFloodArea} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#0369a1]">
              {kpis.floodAreaHa.toFixed(1)} ha
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
              <span>{t.kpiLandslideArea}</span>
              <InfoTooltip text={t.infoKpiLandslide} label={t.kpiLandslideArea} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#c2410c]">
              {kpis.landslideAreaHa.toFixed(1)} ha
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
              <span>{t.kpiBuildings}</span>
              <InfoTooltip text={t.infoKpiBuildings} label={t.kpiBuildings} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
              ~{kpis.affectedBuildingsFlood}
              {kpis.affectedBuildingsLandslide > 0 ? ` (+${kpis.affectedBuildingsLandslide})` : ''}
            </div>
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
              <span>{isDetail ? t.kpiChoke : t.kpiSimpleCrossings}</span>
              <InfoTooltip text={t.infoKpiCrossings} label={isDetail ? t.kpiChoke : t.kpiSimpleCrossings} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
              {kpis.chokeCount} {isEn ? 'spots' : 'titik'}
            </div>
          </div>

          {isDetail && (
            <>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
                  <span>{t.kpiEffectiveRunoff}</span>
                  <InfoTooltip text={t.infoKpiRunoff} label={t.kpiEffectiveRunoff} />
                </div>
                <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
                  {kpis.effectiveRunoffMm.toFixed(1)} mm
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
                  <span>{t.kpiTravelTime}</span>
                  <InfoTooltip text={t.infoKpiTravelTime} label={t.kpiTravelTime} />
                </div>
                <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
                  ~{Math.round(kpis.peakTravelMin)} {isEn ? 'min' : 'mnt'}
                </div>
              </div>
            </>
          )}
        </div>
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

        const overflowLabel = isEn ? 'Bankfull capacity (Manning)' : 'Kapasitas penuh tebing (Manning)';
        const wideningLabel = isEn ? 'High stream power (ω ≥ 300 W/m²)' : 'Energi arus tinggi (ω ≥ 300 W/m²)';
        const scourLabel = isEn ? 'Extreme stream power (ω ≥ 1000)' : 'Energi arus ekstrem (ω ≥ 1000)';

        return (
          <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-[13px] font-bold text-[#161c1a]">{t.channelCalcTitle}</span>
                <InfoTooltip text={t.infoChannelCalc} label={t.channelCalcTitle} />
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
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
              className="mb-2.5 min-h-[38px] w-full cursor-pointer rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#161c1a] transition hover:border-[#161c1a]/30"
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
              <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0369a1]/8 px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-1 font-semibold text-[#161c1a]">
                  <span className="truncate">{overflowLabel}</span>
                  <InfoTooltip text={t.infoThresholdOverflow} label={overflowLabel} />
                </span>
                <span className="font-mono-num shrink-0 font-bold text-[#0369a1]">
                  {calc.overflowRange[0]}–{calc.overflowRange[1]} {isEn ? 'mm/hr' : 'mm/jam'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-[#b45309]/10 px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-1 font-semibold text-[#161c1a]">
                  <span className="truncate">{wideningLabel}</span>
                  <InfoTooltip text={t.infoThresholdWidening} label={wideningLabel} />
                </span>
                <span className="font-mono-num shrink-0 font-bold text-[#b45309]">
                  {calc.wideningRange[0]}–{calc.wideningRange[1]} {isEn ? 'mm/hr' : 'mm/jam'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-[#b91c1c]/10 px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-1 font-semibold text-[#161c1a]">
                  <span className="truncate">{scourLabel}</span>
                  <InfoTooltip text={t.infoThresholdScour} label={scourLabel} />
                </span>
                <span className="font-mono-num shrink-0 font-bold text-[#b91c1c]">
                  {calc.severeScourRange[0]}–{calc.severeScourRange[1]} {isEn ? 'mm/hr' : 'mm/jam'}
                </span>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Compact Read-Only Computed Output Legend */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 text-[13px] font-bold text-[#161c1a]">{t.simLegendTitle}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] leading-snug text-[#161c1a]">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              <LegendIcon kind="flow" />
            </span>
            <span>{isEn ? 'Modeled flow direction' : 'Arah aliran model'}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-[3px] bg-[#0369a1]" />
            <span className="flex items-center gap-1">
              <span>{isEn ? 'Deep basin (>1.5m HAND)' : 'Cekungan utama (>1,5m HAND)'}</span>
              <InfoTooltip
                text={t.infoLegendDeep}
                label={isEn ? 'Deep HAND basin' : 'Cekungan utama HAND'}
              />
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-[3px] bg-[#7dd3fc]" />
            <span>{isEn ? 'Shallow basin (HAND)' : 'Cekungan dangkal (HAND)'}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-[3px] bg-[#ea580c]" />
            <span className="flex items-center gap-1">
              <span>{isEn ? 'Steep slope (model)' : 'Lereng curam jenuh (model)'}</span>
              <InfoTooltip
                text={t.infoLegendLandslide}
                label={isEn ? 'Saturated steep slope (model)' : 'Lereng curam terjenuhkan (model)'}
              />
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
