import { useId, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { I18N } from '../i18n/translations';
import { estimateChannelThresholds, resolveWaterwayCatchmentFromNetwork } from '../lib/channelHydraulics';
import type { DemClient } from '../lib/demClient';
import type {
  AgamStats,
  CascadeAlertLevel,
  CascadeKpis,
  DebrisCouplingMode,
  DrainCondition,
  ForestScenario,
  HyetographType,
  Language,
  RainPattern,
  SimMapViewMode,
  SimNetworkData,
  SoilMoisture,
  VerifiedWaterwayFeature,
  ViewMode
} from '../types/gis';
import { HydrographSparkline } from './HydrographSparkline';
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
  antecedent5dMm: number;
  rainPattern: RainPattern;
  drainCondition: DrainCondition;
  culvertBlockagePct: number;
  structureBlockageOverrides: Record<string, number>;
  forestScenario: ForestScenario;
  hyetograph: HyetographType;
  orographicPctPerKm: number;
  stormCore: [number, number] | null;
  debrisCoupling: DebrisCouplingMode;
  simMapViewMode: SimMapViewMode;
  isPlacingStormCore: boolean;
  forestActualPct: number;
  rainAnimEnabled: boolean;
  showVerifiedWaterways: boolean;
  showRbiRivers: boolean;
  verifiedIssueCount?: number;
  verifiedWaterways?: VerifiedWaterwayFeature[];
  simNetwork?: SimNetworkData | null;
  hasCalibrationProfile?: boolean;
  demClient?: DemClient | null;
  agamStats?: AgamStats;
  kpis: CascadeKpis;
  onTogglePlay: () => void;
  onResetSim: () => void;
  onChangeProgress: (progress: number) => void;
  onChangeRain: (rain: number) => void;
  onChangeDuration: (minutes: number) => void;
  onChangeSoilMoisture: (m: SoilMoisture) => void;
  onChangeAntecedent5dMm: (mm: number) => void;
  onChangeRainPattern: (p: RainPattern) => void;
  onChangeDrainCondition: (d: DrainCondition) => void;
  onChangeCulvertBlockagePct: (pct: number) => void;
  onClearStructureBlockageOverrides: () => void;
  onChangeForestScenario: (f: ForestScenario) => void;
  onChangeHyetograph: (h: HyetographType) => void;
  onChangeOrographicPctPerKm: (pct: number) => void;
  onTogglePlaceStormCore: () => void;
  onClearStormCore: () => void;
  onChangeDebrisCoupling: (mode: DebrisCouplingMode) => void;
  onChangeSimMapViewMode: (mode: SimMapViewMode) => void;
  onApplyPreset: (preset: 'normal' | 'upland' | 'extreme') => void;
  onToggleRainAnim: (enabled: boolean) => void;
  onToggleVerifiedWaterways: (enabled: boolean) => void;
  onToggleRbiRivers: (enabled: boolean) => void;
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
  antecedent5dMm,
  rainPattern,
  drainCondition,
  culvertBlockagePct,
  structureBlockageOverrides,
  forestScenario,
  hyetograph,
  orographicPctPerKm,
  stormCore,
  debrisCoupling,
  simMapViewMode,
  isPlacingStormCore,
  forestActualPct,
  rainAnimEnabled,
  showVerifiedWaterways,
  showRbiRivers,
  verifiedIssueCount = 0,
  verifiedWaterways = [],
  simNetwork = null,
  hasCalibrationProfile = false,
  demClient = null,
  agamStats,
  kpis,
  onTogglePlay,
  onResetSim,
  onChangeProgress,
  onChangeRain,
  onChangeDuration,
  onChangeSoilMoisture,
  onChangeAntecedent5dMm,
  onChangeRainPattern,
  onChangeDrainCondition,
  onChangeCulvertBlockagePct,
  onClearStructureBlockageOverrides,
  onChangeForestScenario,
  onChangeHyetograph,
  onChangeOrographicPctPerKm,
  onTogglePlaceStormCore,
  onClearStormCore,
  onChangeDebrisCoupling,
  onChangeSimMapViewMode,
  onApplyPreset,
  onToggleRainAnim,
  onToggleVerifiedWaterways,
  onToggleRbiRivers
}: SimulationTabProps) {
  const uid = useId();
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';
  const [selectedRiverId, setSelectedRiverId] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const overrideCount = Object.keys(structureBlockageOverrides).length;

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

  const confBadgeStyle =
    kpis.dataConfidenceLevel === 'high'
      ? 'bg-[#047857]/12 text-[#047857]'
      : kpis.dataConfidenceLevel === 'medium'
        ? 'bg-[#0369a1]/12 text-[#0369a1]'
        : 'bg-[#b45309]/14 text-[#92400e]';

  const confTooltip = isEn
    ? `Data Confidence (${kpis.dataConfidenceScore}/100): combines BIG DEMNAS resolution, Pemkab Agam soil/geology layers, Sentinel-2 scour reference, field-verified waterways/cross-sections, measured culvert openings, and recorded High-Water Marks.`
    : `Kepercayaan Data (${kpis.dataConfidenceScore}/100): menggabungkan resolusi BIG DEMNAS, lapisan tanah/geologi Pemkab Agam, referensi Sentinel-2, sungai & penampang terukur lapangan, dimensi gorong-gorong, serta benchmark tinggi air.`;

  const rainIntensityLabel = isDetail ? t.lblRainIntensity : t.lblRainIntensitySimple;
  const durationLabel = isDetail ? t.lblDuration : t.lblDurationSimple;
  const soilShortLabel = isDetail ? t.lblSoilShort : t.lblSoilShortSimple;
  const drainShortLabel = isDetail ? t.lblDrainShort : t.lblDrainShortSimple;
  const controlTitle = isDetail ? t.simControlTitle : t.simControlTitleSimple;
  const outputTitle = isDetail ? t.simOutputTitleDetail : t.simOutputTitleSimple;
  const kpiFloodLabel = isDetail ? t.kpiFloodArea : t.kpiFloodAreaSimple;
  const kpiLandslideLabel = isDetail ? t.kpiLandslideArea : t.kpiLandslideAreaSimple;
  const kpiBuildingsLabel = isDetail ? t.kpiBuildings : t.kpiBuildingsSimple;

  const waterwayKindLabel: Record<string, string> = isEn
    ? { river: 'River', stream: 'Stream', canal: 'Canal', drain: 'Drain', culvert: 'Culvert' }
    : {
        river: 'Sungai Utama',
        stream: 'Anak Sungai',
        canal: 'Bandar / Irigasi',
        drain: 'Parit / Drainase',
        culvert: 'Gorong-gorong'
      };

  const isAtEnd = !playing && progress >= 0.99;
  const showRanges = progress > 0.02;

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
          <div className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="flex items-center gap-1.5">
              <span className="font-mono-num font-bold text-[#0369a1]">
                {formatDurationClock(kpis.elapsedMin)} / {formatDurationClock(kpis.totalWindowMin)}
              </span>
              {kpis.isRecession && progress > 0.02 && (
                <span className="rounded bg-[#0369a1]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#0369a1]">
                  {t.simRecessionBadge}
                </span>
              )}
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

      {/* Rain, Soil & Channel Parameters */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 text-[13px] font-bold text-[#161c1a]">{controlTitle}</div>

        {/* Dropdown 1: Scenario Preset */}
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
              <label htmlFor={`${uid}-rain`}>{rainIntensityLabel}</label>
              <InfoTooltip text={t.infoRainIntensity} label={rainIntensityLabel} />
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
              <label htmlFor={`${uid}-duration`}>{durationLabel}</label>
              <InfoTooltip text={t.infoDuration} label={durationLabel} />
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
          {/* Soil Moisture */}
          <div className="flex items-center justify-between gap-2.5 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-semibold text-[#434d49]">
              <label htmlFor={`${uid}-soil`} className="truncate">
                {soilShortLabel}
              </label>
              <InfoTooltip text={t.infoSoilMoisture} label={soilShortLabel} />
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

          {/* Culvert & Channel State */}
          <div className="flex items-center justify-between gap-2.5 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-semibold text-[#434d49]">
              <label htmlFor={`${uid}-drain`} className="truncate">
                {drainShortLabel}
              </label>
              <InfoTooltip text={t.infoDrainState} label={drainShortLabel} />
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

          {/* Upland Forest What-If (Detailed only) */}
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
              onChange={e => {
                if (e.target.checked) {
                  onClearStormCore();
                  onChangeRainPattern('upland');
                } else {
                  onChangeRainPattern('uniform');
                }
              }}
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

        {/* Collapsible Advanced Physical Forcing (Detailed Mode Only) */}
        {isDetail && (
          <div className="mt-2 border-t border-[#161c1a]/10 pt-2">
            <button
              type="button"
              data-testid="sim-advanced-toggle"
              onClick={() => setAdvancedOpen(v => !v)}
              className="flex min-h-[36px] w-full items-center justify-between gap-2 rounded-lg bg-[#fafaf8] px-2.5 py-1.5 text-[12px] font-bold text-[#161c1a] transition hover:bg-[#f2f3ef]"
            >
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#0369a1]" />
                <span>{isEn ? 'Advanced Physical Forcing' : 'Parameter Fisika Lanjutan'}</span>
              </span>
              {advancedOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-[#636f6a]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[#636f6a]" />
              )}
            </button>

            {advancedOpen && (
              <div className="mt-2 flex flex-col gap-2.5 rounded-lg border border-[#161c1a]/10 bg-[#fafaf8] p-2.5 text-[12px]">
                {/* Hyetograph Temporal Profile */}
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`${uid}-hyeto`} className="font-semibold text-[#434d49]">
                    {isEn ? 'Storm profile' : 'Pola hietograf'}
                  </label>
                  <select
                    id={`${uid}-hyeto`}
                    value={hyetograph}
                    onChange={e => onChangeHyetograph(e.target.value as HyetographType)}
                    className="min-h-[32px] w-[150px] rounded-md border border-[#161c1a]/18 bg-white px-2 py-1 text-[11.5px] font-semibold text-[#161c1a]"
                  >
                    <option value="uniform">{isEn ? 'Uniform' : 'Merata (Uniform)'}</option>
                    <option value="alternating_block">{isEn ? 'Center Peak' : 'Puncak Tengah'}</option>
                    <option value="convective_front">{isEn ? 'Convective Front' : 'Hentakan Awal'}</option>
                    <option value="double_burst">{isEn ? 'Double Burst' : 'Dua Gelombang'}</option>
                  </select>
                </div>

                {/* Debris / Sediment Coupling */}
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`${uid}-debris`} className="font-semibold text-[#434d49]">
                    {isEn ? 'Debris coupling' : 'Kopl. sedimen'}
                  </label>
                  <select
                    id={`${uid}-debris`}
                    value={debrisCoupling}
                    onChange={e => onChangeDebrisCoupling(e.target.value as DebrisCouplingMode)}
                    className="min-h-[32px] w-[150px] rounded-md border border-[#161c1a]/18 bg-white px-2 py-1 text-[11.5px] font-semibold text-[#161c1a]"
                  >
                    <option value="clear">{isEn ? 'Clear water' : 'Air bersih'}</option>
                    <option value="coupled">{isEn ? 'Coupled bulking' : 'Terkopel sedimen'}</option>
                    <option value="surge">{isEn ? 'Debris-jam surge' : 'Gelombang sumbatan'}</option>
                  </select>
                </div>

                {/* Continuous Antecedent 5-day Rainfall P5 */}
                <div className="flex flex-col gap-1 border-t border-[#161c1a]/8 pt-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${uid}-p5`} className="font-semibold text-[#434d49]">
                      {isEn ? '5-day antecedent rain (P5)' : 'Hujan 5 hari sebelumnya (P5)'}
                    </label>
                    <span className="font-mono-num font-bold text-[#161c1a]">{antecedent5dMm} mm</span>
                  </div>
                  <input
                    id={`${uid}-p5`}
                    type="range"
                    min={0}
                    max={250}
                    step={5}
                    value={antecedent5dMm}
                    onChange={e => onChangeAntecedent5dMm(parseInt(e.target.value, 10))}
                    className="w-full cursor-pointer accent-[#0369a1]"
                  />
                </div>

                {/* Orographic Elevation Gradient */}
                <div className="flex flex-col gap-1 border-t border-[#161c1a]/8 pt-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${uid}-oro`} className="font-semibold text-[#434d49]">
                      {isEn ? 'Orographic gradient' : 'Gradien orografis lereng'}
                    </label>
                    <span className="font-mono-num font-bold text-[#161c1a]">+{orographicPctPerKm}%/km</span>
                  </div>
                  <input
                    id={`${uid}-oro`}
                    type="range"
                    min={0}
                    max={80}
                    step={5}
                    value={orographicPctPerKm}
                    onChange={e => onChangeOrographicPctPerKm(parseInt(e.target.value, 10))}
                    className="w-full cursor-pointer accent-[#0369a1]"
                  />
                </div>

                {/* Culvert Blockage Severity */}
                <div className="flex flex-col gap-1 border-t border-[#161c1a]/8 pt-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${uid}-block`} className="font-semibold text-[#434d49]">
                      {isEn ? 'Culvert blockage' : 'Sumbatan gorong-gorong'}
                    </label>
                    <span className="font-mono-num font-bold text-[#161c1a]">{culvertBlockagePct}%</span>
                  </div>
                  <input
                    id={`${uid}-block`}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={culvertBlockagePct}
                    onChange={e => onChangeCulvertBlockagePct(parseInt(e.target.value, 10))}
                    className="w-full cursor-pointer accent-[#0369a1]"
                  />
                  {overrideCount > 0 && (
                    <div className="mt-0.5 flex items-center justify-between rounded bg-[#0369a1]/8 px-2 py-1 text-[11px] font-semibold text-[#0369a1]">
                      <span>
                        {isEn
                          ? `${overrideCount} per-culvert override(s) active`
                          : `${overrideCount} pengaturan per titik aktif`}
                      </span>
                      <button
                        type="button"
                        onClick={onClearStructureBlockageOverrides}
                        className="underline hover:text-[#075985]"
                      >
                        {isEn ? 'Clear' : 'Reset'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Localized Convective Storm Core Placement */}
                <div className="flex items-center justify-between gap-2 border-t border-[#161c1a]/8 pt-2">
                  <button
                    type="button"
                    onClick={onTogglePlaceStormCore}
                    className={`inline-flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-bold transition ${
                      isPlacingStormCore
                        ? 'border-[#0369a1] bg-[#0369a1] text-white'
                        : 'border-[#161c1a]/18 bg-white text-[#161c1a] hover:bg-[#f2f3ef]'
                    }`}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    <span>
                      {stormCore
                        ? isEn
                          ? 'Move Storm Core'
                          : 'Pindah Pusat Badai'
                        : isEn
                          ? 'Place Storm Core (~2.4km)'
                          : 'Letakkan Pusat Badai (~2,4km)'}
                    </span>
                  </button>
                  {stormCore && (
                    <button
                      type="button"
                      onClick={onClearStormCore}
                      title={isEn ? 'Clear storm core' : 'Hapus pusat badai'}
                      className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-md border border-[#161c1a]/15 bg-white text-[#434d49] hover:bg-[#f2f3ef]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {verifiedIssueCount > 0 && progress > 0.02 && drainCondition !== 'cleared' && (
          <div className="mt-2.5 rounded-lg bg-[#b45309]/10 px-3 py-2 text-[12px] font-semibold text-[#92400e]">
            {isEn
              ? `${verifiedIssueCount} field-recorded clogged/damaged culvert(s) highlighted on map.`
              : `${verifiedIssueCount} titik gorong-gorong berstatus tersumbat/rusak di lapangan disorot pada peta.`}
          </div>
        )}
      </section>

      {/* River & Tributary Layers shown during Simulation */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-1.5 text-[13px] font-bold text-[#161c1a]">{t.simRiversTitle}</div>
        <div className="divide-y divide-[#161c1a]/10">
          <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
            <label
              htmlFor={`${uid}-sim-ww`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[12.5px] font-medium text-[#161c1a]"
            >
              <LegendIcon kind="waterway" />
              <span className="leading-snug">{t.lblVerifiedWaterways}</span>
            </label>
            <input
              id={`${uid}-sim-ww`}
              data-testid="sim-toggle-verified-waterways"
              type="checkbox"
              checked={showVerifiedWaterways}
              onChange={e => onToggleVerifiedWaterways(e.target.checked)}
              className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
            />
          </div>

          <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <label
                htmlFor={`${uid}-sim-rbi`}
                className="flex min-w-0 cursor-pointer items-center gap-2 text-[12.5px] font-medium text-[#161c1a]"
              >
                <LegendIcon kind="agamRbi" />
                <span className="leading-snug">{t.lblAgamRbiRivers}</span>
              </label>
              <InfoTooltip text={t.infoSimRbiRivers} label={t.lblAgamRbiRivers} />
            </div>
            <input
              id={`${uid}-sim-rbi`}
              data-testid="sim-toggle-rbi-rivers"
              type="checkbox"
              checked={showRbiRivers}
              onChange={e => onToggleRbiRivers(e.target.checked)}
              className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
            />
          </div>
        </div>
      </section>

      {/* Model Output Summary */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[13px] font-bold text-[#161c1a]">{outputTitle}</span>
          <div className="flex items-center gap-1.5">
            {drainCondition === 'cleared' && progress > 0.03 && kpis.reductionPct > 0 && (
              <span className="font-mono-num rounded-md bg-[#047857]/12 px-2 py-0.5 text-[11px] font-bold text-[#047857]">
                -{kpis.reductionPct}% {isEn ? 'HAND zone' : isDetail ? 'zona HAND' : 'area cekungan'}
              </span>
            )}
            <span
              data-testid="sim-data-confidence"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${confBadgeStyle}`}
            >
              <ShieldCheck className="h-3 w-3 shrink-0" />
              <span className="font-mono-num">
                {isEn ? 'Conf' : 'Data'} {kpis.dataConfidenceScore}/100
              </span>
              <InfoTooltip text={confTooltip} label={isEn ? 'Data Confidence Score' : 'Skor Kepercayaan Data'} />
            </span>
          </div>
        </div>

        {/* Detailed-Only Map Overlay View Mode Switcher */}
        {isDetail && (
          <div
            data-testid="sim-map-view-switcher"
            className="mb-2.5 grid grid-cols-4 gap-1 rounded-lg border border-[#161c1a]/10 bg-[#f2f3ef] p-0.5"
          >
            {(
              [
                ['depth', isEn ? 'Depth' : 'Genangan'],
                ['confidence', isEn ? 'Agree %' : 'Ansambel'],
                ['scour', isEn ? 'Scour ω' : 'Gerusan'],
                ['survey', isEn ? 'Survey' : 'Survei']
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChangeSimMapViewMode(mode)}
                className={`min-h-[28px] rounded-md px-1 text-[11px] font-bold transition ${
                  simMapViewMode === mode
                    ? 'bg-white text-[#0369a1] shadow-xs'
                    : 'text-[#434d49] hover:text-[#161c1a]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Hydrograph & P10-P90 Envelope */}
        {(isDetail || progress > 0.02) && kpis.hydrograph.length > 1 && (
          <div className="mb-2.5">
            <HydrographSparkline
              lang={lang}
              points={kpis.hydrograph}
              progress={progress}
              durationMin={durationMin}
              totalWindowMin={kpis.totalWindowMin}
              peakQ={kpis.peakDischargeM3s}
              peakQP10={kpis.ensemble.peakDischargeM3s.p10}
              peakQP90={kpis.ensemble.peakDischargeM3s.p90}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
              <span>{kpiFloodLabel}</span>
              <InfoTooltip text={t.infoKpiFlood} label={kpiFloodLabel} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#0369a1]">
              {kpis.floodAreaHa.toFixed(1)} ha
            </div>
            {showRanges && (
              <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                P10–P90: {kpis.ensemble.floodAreaHa.p10.toFixed(0)}–{kpis.ensemble.floodAreaHa.p90.toFixed(0)} ha
              </div>
            )}
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
              <span>{kpiLandslideLabel}</span>
              <InfoTooltip text={t.infoKpiLandslide} label={kpiLandslideLabel} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#c2410c]">
              {kpis.landslideAreaHa.toFixed(1)} ha
            </div>
            {showRanges && (
              <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                P10–P90: {kpis.ensemble.landslideAreaHa.p10.toFixed(0)}–{kpis.ensemble.landslideAreaHa.p90.toFixed(0)} ha
              </div>
            )}
          </div>
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
              <span>{kpiBuildingsLabel}</span>
              <InfoTooltip text={t.infoKpiBuildings} label={kpiBuildingsLabel} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
              ~{kpis.affectedBuildingsFlood}
              {kpis.affectedBuildingsLandslide > 0 ? ` (+${kpis.affectedBuildingsLandslide})` : ''}
            </div>
            {showRanges && (
              <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                [{kpis.ensemble.affectedBuildingsFlood.p10}–{kpis.ensemble.affectedBuildingsFlood.p90}]
              </div>
            )}
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
                <div className="font-mono-num mt-0.5 text-[14.5px] font-bold text-[#161c1a]">
                  {kpis.effectiveRunoffMm.toFixed(1)} mm
                </div>
                <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                  Q {kpis.peakDischargeM3s.toFixed(1)} m³/s · Cv {(kpis.meanSedimentCv * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[11.5px] leading-tight text-[#636f6a]">
                  <span>{isEn ? 'Max Stream Power' : 'Energi Gerusan Maks'}</span>
                  <InfoTooltip
                    text={
                      isEn
                        ? 'Specific stream power ω = ρgQS/W across Nagari reaches; ω ≥ 300 W/m² marks bank erosion potential.'
                        : 'Specific stream power ω = ρgQS/W di seluruh ruas alur Nagari; ω ≥ 300 W/m² menandai potensi gerusan tebing.'
                    }
                    label={isEn ? 'Stream power' : 'Energi gerusan'}
                  />
                </div>
                <div className="font-mono-num mt-0.5 text-[14.5px] font-bold text-[#161c1a]">
                  {kpis.maxStreamPowerWm2} W/m²
                </div>
                <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                  {kpis.scourReachCount} {isEn ? 'scour reaches' : 'ruas gerusan'} · ~{Math.round(kpis.peakTravelMin)}{' '}
                  {isEn ? 'm' : 'mnt'}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Independent Validation Readout (Detailed Mode Only) */}
        {isDetail && (agamStats || kpis.validation.scourSampleCount > 0 || kpis.validation.hwmCount > 0) && (
          <div className="mt-2.5 rounded-lg border border-[#161c1a]/10 bg-[#fafaf8] px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between gap-1.5 text-[11px]">
              <span className="font-bold text-[#434d49]">
                {isEn ? 'Independent Benchmark Skill' : 'Validasi Independen Model'}
              </span>
              {hasCalibrationProfile && (
                <span className="rounded bg-[#0369a1]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#0369a1]">
                  {isEn ? 'Calibrated' : 'Terkalibrasi'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded bg-white px-1.5 py-1 border border-[#161c1a]/8">
                <div className="text-[10px] text-[#636f6a]">S2 Scour CSI</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">
                  {kpis.validation.scourCsi != null ? `${kpis.validation.scourCsi}%` : '—'}
                </div>
              </div>
              <div className="rounded bg-white px-1.5 py-1 border border-[#161c1a]/8">
                <div className="text-[10px] text-[#636f6a]">Agam AUC</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">
                  {kpis.validation.landslideAuc != null ? kpis.validation.landslideAuc.toFixed(2) : '—'}
                </div>
              </div>
              <div className="rounded bg-white px-1.5 py-1 border border-[#161c1a]/8">
                <div className="text-[10px] text-[#636f6a]">
                  HWM ({kpis.validation.hwmCount})
                </div>
                <div className="font-mono-num text-[12px] font-bold text-[#0369a1]">
                  {kpis.validation.hwmRmseM != null ? `${kpis.validation.hwmRmseM}m` : '—'}
                </div>
              </div>
            </div>
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

        const netCatch = resolveWaterwayCatchmentFromNetwork(
          activeWw.properties.id,
          simNetwork,
          activeWw.properties.kind
        );

        let slopePct = netCatch.slopePct ?? (activeWw.properties.kind === 'river' ? 3.5 : 6.5);
        if (netCatch.slopePct == null && demClient && coords.length >= 2) {
          const e0 = demClient.getElevation(coords[0][0], coords[0][1]);
          const e1 = demClient.getElevation(coords[coords.length - 1][0], coords[coords.length - 1][1]);
          const len = Math.max(80, activeWw.properties.length_m || 400);
          const s = (Math.abs(e0 - e1) / len) * 100;
          if (s >= 0.8) slopePct = s;
        }

        const calc = estimateChannelThresholds({
          widthM: widthPostM,
          widthPreM,
          depthM,
          slopePct,
          catchmentKm2: netCatch.catchmentKm2,
          soilMoisture,
          antecedent5dMm,
          sedimentCv: kpis.meanSedimentCv
        });

        const overflowLabel = isEn ? 'Bankfull capacity (Manning)' : 'Kapasitas penuh saluran (Manning)';
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
                    : 'Perkiraan bawaan'}
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
                  {w.properties.name} ({waterwayKindLabel[w.properties.kind] || w.properties.kind})
                </option>
              ))}
            </select>

            <div className="mb-2.5 grid grid-cols-4 gap-1.5 text-center">
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10px] text-[#636f6a]">{isEn ? 'Width' : 'Lebar'}</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">
                  {calc.widthPreM != null ? `${calc.widthPreM}→${calc.widthM}m` : `~${calc.widthM}m`}
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10px] text-[#636f6a]">{isEn ? 'Depth' : 'Dalam'}</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">~{calc.depthM}m</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10px] text-[#636f6a]">{isEn ? 'Slope' : 'Lereng'}</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">{calc.slopePct}%</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10px] text-[#636f6a]">DAS</div>
                <div className="font-mono-num text-[12px] font-bold text-[#0369a1]">
                  {calc.catchmentKm2} km²
                </div>
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
    </div>
  );
}
