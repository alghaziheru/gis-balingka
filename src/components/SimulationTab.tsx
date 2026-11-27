import { useEffect, useId, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Download,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { useActiveRegion, useT } from '../context/RegionContext';
import type { ClimateBaselineData } from '../data/climateBaseline';
import type { PlaybackSpeed } from '../hooks/useSimulationController';
import { estimateChannelThresholds, resolveWaterwayCatchmentFromNetwork } from '../lib/channelHydraulics';
import type { DemClient } from '../lib/demClient';
import { getMaxRealisticRainMmHr, type RoutedReachState } from '../lib/reachRouter';
import {
  buildHydrographCsv,
  buildScenarioExportJson,
  triggerBrowserDownload
} from '../lib/scenarioExport';
import type {
  AgamStats,
  CascadeKpis,
  CascadeSimParams,
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
import { SimSpeedMenu } from './SimSpeedMenu';

interface SimulationTabProps {
  lang: Language;
  viewMode: ViewMode;
  playing: boolean;
  playbackSpeed: PlaybackSpeed;
  rainMm: number;
  durationMin: number;
  progress: number;
  liveElapsedMin: number;
  liveRainMmHr: number;
  isRecession: boolean;
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
  showOsmRoads: boolean;
  showDemFlows: boolean;
  verifiedIssueCount?: number;
  verifiedWaterways?: VerifiedWaterwayFeature[];
  simNetwork?: SimNetworkData | null;
  cascadeParams?: CascadeSimParams;
  routedNominal?: RoutedReachState | null;
  hasCalibrationProfile?: boolean;
  climateBaseline?: ClimateBaselineData;
  demClient?: DemClient | null;
  agamStats?: AgamStats;
  kpis: CascadeKpis;
  onTogglePlay: () => void;
  onResetSim: () => void;
  onChangeProgress: (progress: number) => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
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
  onToggleOsmRoads: (enabled: boolean) => void;
  onToggleDemFlows: (enabled: boolean) => void;
  onOpenMethodology: () => void;
}

const DURATION_STEPS_MIN = [30, 60, 120, 180, 360, 720, 1440, 2160, 2880, 4320] as const;

function durationMinToStepIdx(min: number): number {
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < DURATION_STEPS_MIN.length; i++) {
    const diff = Math.abs(DURATION_STEPS_MIN[i] - min);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function formatDurationClock(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDurationLabel(totalMinutes: number, isEn: boolean): string {
  if (totalMinutes >= 1440) {
    const h = Math.round(totalMinutes / 60);
    const days = totalMinutes / 1440;
    const dayStr = Number.isInteger(days)
      ? `${days} ${isEn ? (days === 1 ? 'day' : 'days') : 'hari'}`
      : `${isEn ? days.toFixed(1) : days.toFixed(1).replace('.', ',')} ${isEn ? 'days' : 'hari'}`;
    return `${h} ${isEn ? 'hr' : 'jam'} (${dayStr})`;
  }
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} ${isEn ? 'min' : 'mnt'}`;
  if (m === 0) return `${h} ${isEn ? 'hr' : 'jam'}`;
  return `${h} ${isEn ? 'hr' : 'jam'} ${m} ${isEn ? 'min' : 'mnt'}`;
}

function HairlineSlider({
  id,
  label,
  tooltip,
  valueText,
  min,
  max,
  step = 1,
  value,
  onChange,
  leftTick,
  midTick,
  rightTick,
  hint
}: {
  id: string;
  label: string;
  tooltip?: string;
  valueText: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (val: number) => void;
  leftTick?: string;
  midTick?: string;
  rightTick?: string;
  hint?: string;
}) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-[#434d49]">
          <label htmlFor={id} className="truncate">
            {label}
          </label>
          {tooltip && <InfoTooltip text={tooltip} label={label} />}
        </span>
        <span className="font-mono-num shrink-0 text-[12.5px] font-bold text-[#161c1a]">{valueText}</span>
      </div>
      <div className="relative flex h-[22px] items-center">
        <div className="pointer-events-none absolute inset-x-0 h-[2px] rounded-full bg-[#161c1a]/15">
          <div className="h-full rounded-full bg-[#0369a1]" style={{ width: `${pct}%` }} />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          onChange={e => onChange(parseInt(e.target.value, 10))}
          className="sim-range-input"
        />
      </div>
      {(leftTick || midTick || rightTick) && (
        <div className="flex justify-between text-[11px] font-medium text-[#636f6a]">
          <span>{leftTick}</span>
          {midTick && <span>{midTick}</span>}
          <span>{rightTick}</span>
        </div>
      )}
      {hint && <div className="text-[11px] leading-snug text-[#636f6a]">{hint}</div>}
    </div>
  );
}

function SegmentedPills<T extends string>({
  label,
  tooltip,
  value,
  options,
  onChange
}: {
  label: string;
  tooltip?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (val: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#434d49]">
        <span>{label}</span>
        {tooltip && <InfoTooltip text={tooltip} label={label} />}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map(opt => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={`btn-tactile min-h-[32px] truncate rounded-md px-2 py-1 text-[12px] font-semibold ${
                active
                  ? 'bg-white text-[#0369a1] shadow-xs'
                  : 'text-[#434d49] hover:text-[#161c1a]'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwitchRow({
  id,
  label,
  tooltip,
  checked,
  onChange
}: {
  id: string;
  label: string;
  tooltip?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <label htmlFor={id} className="cursor-pointer text-[13px] font-medium text-[#161c1a]">
          {label}
        </label>
        {tooltip && <InfoTooltip text={tooltip} label={label} />}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 ${
          checked
            ? 'border-[#0369a1] bg-[#0369a1]'
            : 'border-[#161c1a]/20 bg-[#f2f3ef]'
        }`}
      >
        <span
          className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-xs transition-transform duration-150 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  );
}

export function SimulationTab({
  lang,
  viewMode,
  playing,
  playbackSpeed,
  rainMm,
  durationMin,
  progress,
  liveElapsedMin,
  liveRainMmHr,
  isRecession: _isRecession,
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
  showOsmRoads,
  showDemFlows,
  verifiedIssueCount = 0,
  verifiedWaterways = [],
  simNetwork = null,
  cascadeParams,
  routedNominal = null,
  hasCalibrationProfile = false,
  climateBaseline,
  demClient = null,
  agamStats,
  kpis,
  onTogglePlay,
  onResetSim,
  onChangeProgress,
  onChangeSpeed,
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
  onToggleRbiRivers,
  onToggleOsmRoads,
  onToggleDemFlows,
  onOpenMethodology
}: SimulationTabProps) {
  const uid = useId();
  const region = useActiveRegion();
  const t = useT(lang);
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';
  const [selectedRiverId, setSelectedRiverId] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  // Spacebar toggles Play/Pause while on Simulation tab
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'SELECT' ||
          tag === 'TEXTAREA' ||
          tag === 'BUTTON' ||
          tag === 'A' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'slider'
        ) {
          return;
        }
      }
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      onTogglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onTogglePlay]);

  const overrideCount = Object.keys(structureBlockageOverrides).length;

  const activeScenario: 'normal' | 'upland' | 'extreme' | 'custom' =
    rainMm === 15 &&
    durationMin === 120 &&
    soilMoisture === 'moist' &&
    rainPattern === 'uniform' &&
    drainCondition === 'cleared' &&
    (!isDetail || forestScenario === 'actual')
      ? 'normal'
      : rainMm === 40 &&
          durationMin === 180 &&
          soilMoisture === 'moist' &&
          rainPattern === 'upland' &&
          drainCondition === 'clogged' &&
          (!isDetail || forestScenario === 'actual')
        ? 'upland'
        : rainMm === 7 &&
            durationMin === 2880 &&
            soilMoisture === 'moist' &&
            rainPattern === 'upland' &&
            drainCondition === (isDetail ? 'surge' : 'clogged') &&
            (!isDetail || forestScenario === 'actual')
          ? 'extreme'
          : 'custom';

  const rainCategoryLabel =
    rainMm < 5
      ? t.rainPresetLight
      : rainMm < 10
        ? t.rainPresetMed
        : rainMm < 20
          ? t.rainPresetHeavy
          : rainMm <= 50
            ? t.rainPresetVeryHeavy
            : t.rainPresetExtreme;

  const maxRainForDur = getMaxRealisticRainMmHr(durationMin, climateBaseline);
  const totalStormInputMm = Math.round(rainMm * (durationMin / 60));
  const climSrcTag = (climateBaseline?.bmkgStations.length ?? 1) > 0 ? 'BMKG–ERA5' : 'ERA5-Land';
  const climPeriodTag = climateBaseline?.era5Series?.yearsCount ? '1985–2025' : 'IDF';
  const isCalibrated = Boolean(kpis.inputCoverage?.isCalibrated);

  const formatHaValue = (ha: number): string => {
    if (ha <= 0) return '0 ha';
    if (isCalibrated) return `${ha.toFixed(1)} ha`;
    if (ha < 1) return '<1 ha';
    return `~${Math.round(ha)} ha`;
  };

  const formatMmValue = (mm: number): string => {
    if (mm <= 0) return '0 mm';
    if (isCalibrated) return `${mm.toFixed(1)} mm`;
    if (mm < 1) return '<1 mm';
    return `~${Math.round(mm)} mm`;
  };

  const confBadgeStyle =
    kpis.dataConfidenceLevel === 'high'
      ? 'bg-[#047857]/12 text-[#047857]'
      : kpis.dataConfidenceLevel === 'medium'
        ? 'bg-[#0369a1]/12 text-[#0369a1]'
        : 'bg-[#b45309]/14 text-[#92400e]';

  const cov = kpis.inputCoverage;
  const confTooltip = isEn
    ? `Input Readiness (${kpis.dataConfidenceScore}/100): ${
        cov
          ? `${cov.measuredReaches}/${cov.insideReaches} river cross-sections measured, ${cov.measuredCrossings}/${cov.totalCrossings} culvert openings measured, ${cov.hwmCount} High-Water Marks.`
          : 'Based on DEMNAS, Pemkab Agam soil/geology, and Sentinel-2 layers.'
      } Screening model — not calibrated against stream gauges.`
    : `Kesiapan Data Input (${kpis.dataConfidenceScore}/100): ${
        cov
          ? `${cov.measuredReaches}/${cov.insideReaches} penampang sungai terukur, ${cov.measuredCrossings}/${cov.totalCrossings} bukaan gorong-gorong terukur, ${cov.hwmCount} tanda tinggi air.`
          : 'Berdasarkan DEMNAS, peta tanah Pemkab Agam, dan Sentinel-2.'
      } Model penyaringan awal — belum terkalibrasi alat ukur sungai.`;

  const rainIntensityLabel = isDetail ? t.lblRainIntensity : t.lblRainIntensitySimple;
  const durationLabel = isDetail ? t.lblDuration : t.lblDurationSimple;
  const soilShortLabel = isDetail ? t.lblSoilShort : t.lblSoilShortSimple;
  const drainShortLabel = isDetail ? t.lblDrainShort : t.lblDrainShortSimple;
  const controlTitle = isDetail ? t.simControlTitle : t.simControlTitleSimple;
  const outputTitle = isDetail ? t.simOutputTitleDetail : t.simOutputTitleSimple;
  const kpiFloodLabel = isDetail ? t.kpiFloodArea : t.kpiFloodAreaSimple;
  const kpiLandslideLabel = isDetail ? t.kpiLandslideArea : t.kpiLandslideAreaSimple;

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
  const activeLayerCount = [showVerifiedWaterways, showRbiRivers, showOsmRoads, showDemFlows].filter(Boolean).length;

  const presets: { id: 'normal' | 'upland' | 'extreme'; title: string; meta: string }[] = [
    {
      id: 'normal',
      title: 'Normal',
      meta: isEn ? '15 mm/h · 2h' : '15 mm/j · 2j'
    },
    {
      id: 'upland',
      title: isEn ? 'Upland' : 'Hulu',
      meta: isEn ? '40 mm/h · 3h' : '40 mm/j · 3j'
    },
    {
      id: 'extreme',
      title: isEn ? 'Monsoon' : 'Monsun',
      meta: isEn ? '7 mm/h · 48h' : '7 mm/j · 48j'
    }
  ];

  return (
    <div className="flex flex-col gap-3.5">
      {/* Sticky Ultra-Clean 2-Part Playback + Scrubbable Hydrograph Card */}
      <div
        data-testid="sim-playback-card"
        className="sticky -top-3.5 z-10 -mx-3.5 -mt-3.5 border-b border-[#161c1a]/12 bg-white px-3.5 pt-3 pb-2.5 shadow-[0_4px_12px_-6px_rgba(22,28,26,0.10)]"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="sim-play-btn"
              onClick={onTogglePlay}
              className={`btn-tactile inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-white ${
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
              <span>{playing ? t.pause : isAtEnd ? t.simReplay : isEn ? 'Play' : 'Putar'}</span>
            </button>

            {progress > 0 && !isAtEnd && (
              <button
                type="button"
                data-testid="sim-reset-btn"
                onClick={onResetSim}
                aria-label={t.simReset}
                title={t.simReset}
                className="btn-tactile grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg border border-[#161c1a]/15 bg-white text-[#161c1a] hover:bg-[#f2f3ef]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}

            <SimSpeedMenu
              speed={playbackSpeed}
              onSelect={onChangeSpeed}
              lang={lang}
              placement="down"
              testId="sim-speed-btn"
            />
          </div>

          <div className="font-mono-num flex items-center gap-1.5 text-[11.5px] whitespace-nowrap">
            <span className="font-bold text-[#0369a1]">
              {formatDurationClock(liveElapsedMin)}
              <span className="font-normal text-[#636f6a]"> / {formatDurationClock(kpis.totalWindowMin)}</span>
            </span>
            {progress > 0.02 && (
              <span className="font-semibold text-[#434d49]">
                · {liveRainMmHr > 0.2 ? Math.round(liveRainMmHr) : 0} mm/{isEn ? 'h' : 'j'}
              </span>
            )}
          </div>
        </div>

        <div className="mt-2.5 border-t border-[#161c1a]/10 pt-2">
          <HydrographSparkline
            lang={lang}
            points={kpis.hydrograph}
            progress={progress}
            durationMin={durationMin}
            totalWindowMin={kpis.totalWindowMin}
            peakQ={kpis.peakDischargeM3s}
            peakQP10={kpis.ensemble.peakDischargeM3s.p10}
            peakQP90={kpis.ensemble.peakDischargeM3s.p90}
            isCalibrated={isCalibrated}
            mode={viewMode}
            interactive={true}
            compact={true}
            bare={true}
            onSeekProgress={onChangeProgress}
          />
        </div>
      </div>

      {/* Card 1: Scenario & Rain/Soil/Channel Parameters (Matching Peta/Drainase Card Recipe) */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold text-[#161c1a]">{controlTitle}</span>
          {activeScenario === 'custom' && (
            <span className="rounded bg-[#f2f3ef] px-1.5 py-0.5 text-[11px] font-semibold text-[#434d49]">
              {isEn ? 'Custom' : 'Kustom'}
            </span>
          )}
        </div>

        {/* 3 Quick-Scenario Preset Buttons */}
        <div className="mb-3 grid grid-cols-3 gap-1.5" role="group" aria-label={t.presetQuickTitle}>
          {presets.map(p => {
            const active = activeScenario === p.id;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`sim-preset-${p.id}`}
                onClick={() => onApplyPreset(p.id)}
                className={`btn-tactile flex flex-col items-start rounded-lg border px-2.5 py-2 text-left ${
                  active
                    ? 'border-[#0369a1] bg-[#0369a1]/[0.06] text-[#0369a1]'
                    : 'border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
                }`}
              >
                <span className="text-[12.5px] leading-tight font-bold">{p.title}</span>
                <span className={`font-mono-num mt-0.5 text-[10.5px] ${active ? 'text-[#0369a1]' : 'text-[#636f6a]'}`}>
                  {p.meta}
                </span>
              </button>
            );
          })}
        </div>

        {/* Parameters divided by 1px hairlines */}
        <div className="divide-y divide-[#161c1a]/10 border-t border-[#161c1a]/10">
          <div className="py-2.5">
            <HairlineSlider
              id={`${uid}-rain`}
              label={rainIntensityLabel}
              tooltip={t.infoRainIntensity}
              valueText={`${rainMm} ${isEn ? 'mm/hr' : 'mm/jam'} · ${rainCategoryLabel}`}
              min={1}
              max={maxRainForDur}
              step={maxRainForDur <= 24 ? 1 : 5}
              value={Math.min(rainMm, maxRainForDur)}
              onChange={onChangeRain}
              leftTick={t.rainLight}
              midTick={maxRainForDur >= 50 ? t.rainHeavy : undefined}
              rightTick={isEn ? `Max (${maxRainForDur})` : `Maks (${maxRainForDur})`}
              hint={
                isEn
                  ? `${climSrcTag} (${climPeriodTag}) Mononobe cap ≤${maxRainForDur} mm/hr · Total ~${totalStormInputMm} mm`
                  : `Batas ${climSrcTag} (${climPeriodTag}) ≤${maxRainForDur} mm/jam · Total ~${totalStormInputMm} mm`
              }
            />
          </div>

          <div className="py-2.5">
            <HairlineSlider
              id={`${uid}-duration`}
              label={durationLabel}
              tooltip={t.infoDuration}
              valueText={formatDurationLabel(durationMin, isEn)}
              min={0}
              max={DURATION_STEPS_MIN.length - 1}
              step={1}
              value={durationMinToStepIdx(durationMin)}
              onChange={idx => {
                const safeIdx = Math.max(0, Math.min(DURATION_STEPS_MIN.length - 1, idx));
                onChangeDuration(DURATION_STEPS_MIN[safeIdx]);
              }}
              leftTick={t.durMin}
              midTick={t.durMid}
              rightTick={t.durMax}
            />
          </div>

          <SegmentedPills
            label={soilShortLabel}
            tooltip={t.infoSoilMoisture}
            value={soilMoisture}
            options={[
              { value: 'dry', label: t.soilDry },
              { value: 'moist', label: t.soilMoist },
              { value: 'saturated', label: t.soilSaturated }
            ]}
            onChange={onChangeSoilMoisture}
          />

          <SegmentedPills
            label={drainShortLabel}
            tooltip={t.infoDrainState}
            value={drainCondition}
            options={
              isDetail
                ? [
                    { value: 'cleared', label: t.scCleared },
                    { value: 'clogged', label: t.scClogged },
                    { value: 'surge', label: isEn ? 'Surge' : 'Lonjakan' }
                  ]
                : [
                    { value: 'cleared', label: t.scCleared },
                    { value: 'clogged', label: t.scClogged }
                  ]
            }
            onChange={onChangeDrainCondition}
          />

          {isDetail && (
            <SegmentedPills
              label={t.lblForestShort}
              tooltip={t.infoForestScenario}
              value={forestScenario}
              options={[
                { value: 'actual', label: `${Math.round(forestActualPct)}%` },
                { value: 'degraded30', label: '-30%' },
                { value: 'degraded50', label: '-50%' }
              ]}
              onChange={onChangeForestScenario}
            />
          )}

          <div className="divide-y divide-[#161c1a]/10">
            <SwitchRow
              id={`${uid}-upland-check`}
              label={t.lblRainUplandCheck}
              tooltip={t.infoRainPattern}
              checked={rainPattern === 'upland'}
              onChange={checked => {
                if (checked) {
                  onClearStormCore();
                  onChangeRainPattern('upland');
                } else {
                  onChangeRainPattern('uniform');
                }
              }}
            />
            <SwitchRow
              id={`${uid}-anim-check`}
              label={t.lblRainAnim}
              tooltip={t.infoRainAnim}
              checked={rainAnimEnabled}
              onChange={onToggleRainAnim}
            />
          </div>
        </div>

        {/* Collapsible Advanced Physical Forcing (Detailed Mode Only) */}
        {isDetail && (
          <div className="mt-2 border-t border-[#161c1a]/10 pt-2">
            <button
              type="button"
              data-testid="sim-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen(v => !v)}
              className="flex min-h-[36px] w-full items-center justify-between gap-2 rounded-lg bg-[#fafaf8] px-2.5 py-1.5 text-[12.5px] font-bold text-[#161c1a] transition hover:bg-[#f2f3ef]"
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
              <div className="mt-2 flex flex-col divide-y divide-[#161c1a]/10 rounded-lg border border-[#161c1a]/10 bg-[#fafaf8] px-2.5 py-1 text-[12.5px]">
                <SegmentedPills
                  label={isEn ? 'Storm profile' : 'Pola hietograf'}
                  value={hyetograph}
                  options={[
                    { value: 'uniform', label: isEn ? 'Uniform' : 'Merata' },
                    { value: 'alternating_block', label: isEn ? 'Peak' : 'Puncak' },
                    { value: 'convective_front', label: isEn ? 'Front' : 'Awal' },
                    { value: 'double_burst', label: isEn ? 'Double' : 'Ganda' }
                  ]}
                  onChange={onChangeHyetograph}
                />

                <SegmentedPills
                  label={isEn ? 'Debris coupling' : 'Kopl. sedimen'}
                  value={debrisCoupling}
                  options={[
                    { value: 'clear', label: isEn ? 'Clear' : 'Bersih' },
                    { value: 'coupled', label: isEn ? 'Bulked' : 'Sedimen' },
                    { value: 'surge', label: isEn ? 'Jam Surge' : 'Sumbatan' }
                  ]}
                  onChange={onChangeDebrisCoupling}
                />

                <div className="py-2">
                  <HairlineSlider
                    id={`${uid}-p5`}
                    label={isEn ? '5-day antecedent rain (P5)' : 'Hujan 5 hari sebelumnya (P5)'}
                    valueText={`${antecedent5dMm} mm`}
                    min={0}
                    max={250}
                    step={5}
                    value={antecedent5dMm}
                    onChange={onChangeAntecedent5dMm}
                  />
                </div>

                <div className="py-2">
                  <HairlineSlider
                    id={`${uid}-oro`}
                    label={isEn ? 'Orographic gradient' : 'Gradien orografis lereng'}
                    valueText={`+${orographicPctPerKm}%/km`}
                    min={0}
                    max={80}
                    step={5}
                    value={orographicPctPerKm}
                    onChange={onChangeOrographicPctPerKm}
                  />
                </div>

                <div className="py-2">
                  <HairlineSlider
                    id={`${uid}-block`}
                    label={isEn ? 'Culvert blockage' : 'Sumbatan gorong-gorong'}
                    valueText={`${culvertBlockagePct}%`}
                    min={0}
                    max={100}
                    step={5}
                    value={culvertBlockagePct}
                    onChange={onChangeCulvertBlockagePct}
                  />
                  {overrideCount > 0 && (
                    <div className="mt-1 flex items-center justify-between rounded bg-[#0369a1]/8 px-2 py-1 text-[11px] font-semibold text-[#0369a1]">
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

                <div className="flex items-center justify-between gap-2 py-2">
                  <button
                    type="button"
                    onClick={onTogglePlaceStormCore}
                    className={`btn-tactile inline-flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] font-bold ${
                      isPlacingStormCore
                        ? 'border-[#0369a1] bg-[#0369a1] text-white'
                        : 'border-[#161c1a]/15 bg-white text-[#161c1a] hover:bg-[#f2f3ef]'
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
                      className="btn-tactile grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg border border-[#161c1a]/15 bg-white text-[#434d49] hover:bg-[#f2f3ef]"
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

      {/* Card 2: Collapsible River & Tributary Layers */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <button
          type="button"
          data-testid="sim-layers-toggle"
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen(v => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#161c1a]">
            <Layers className="h-3.5 w-3.5 text-[#0369a1]" />
            <span>{t.simRiversTitle}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono-num text-[11.5px] font-semibold text-[#636f6a]">
              {activeLayerCount}/4 {t.layersActiveCount}
            </span>
            {layersOpen ? (
              <ChevronUp className="h-4 w-4 text-[#636f6a]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#636f6a]" />
            )}
          </span>
        </button>

        {layersOpen && (
          <div className="mt-2 divide-y divide-[#161c1a]/10 border-t border-[#161c1a]/10 pt-1">
            <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
              <label
                htmlFor={`${uid}-sim-ww`}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#161c1a]"
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
                  className="flex min-w-0 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#161c1a]"
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

            <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
              <label
                htmlFor={`${uid}-sim-osm`}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#161c1a]"
              >
                <LegendIcon kind="osm" />
                <span className="leading-snug">{t.lblOsmContext}</span>
              </label>
              <input
                id={`${uid}-sim-osm`}
                data-testid="sim-toggle-osm-roads"
                type="checkbox"
                checked={showOsmRoads}
                onChange={e => onToggleOsmRoads(e.target.checked)}
                className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
              />
            </div>

            <div className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <label
                  htmlFor={`${uid}-sim-flow`}
                  className="flex min-w-0 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#161c1a]"
                >
                  <LegendIcon kind="flow" />
                  <span className="leading-snug">{isDetail ? t.lblFlowDetail : t.lblFlowSimple}</span>
                </label>
                <InfoTooltip text={t.infoFlowSimple} label={isDetail ? t.lblFlowDetail : t.lblFlowSimple} />
              </div>
              <input
                id={`${uid}-sim-flow`}
                data-testid="sim-toggle-dem-flows"
                type="checkbox"
                checked={showDemFlows}
                onChange={e => onToggleDemFlows(e.target.checked)}
                className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
              />
            </div>
          </div>
        )}
      </section>

      {/* Card 3: Model Output Summary */}
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[13px] font-bold text-[#161c1a]">{outputTitle}</span>
          <div className="flex items-center gap-1.5">
            {drainCondition === 'cleared' && progress > 0.03 && kpis.reductionPct > 0 && (
              <span className="font-mono-num rounded-md bg-[#047857]/12 px-2 py-0.5 text-[11px] font-bold text-[#047857]">
                -{kpis.reductionPct}% {isEn ? 'HAND zone' : isDetail ? 'zona HAND' : 'area cekungan'}
              </span>
            )}
            {isDetail && (
              <span
                data-testid="sim-data-confidence"
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${confBadgeStyle}`}
              >
                <ShieldCheck className="h-3 w-3 shrink-0" />
                <span className="font-mono-num">
                  {isCalibrated ? `Input ${kpis.dataConfidenceScore}/100` : `Screening ${kpis.dataConfidenceScore}/100`}
                </span>
                <InfoTooltip
                  text={confTooltip}
                  label={isEn ? 'Input Readiness' : 'Kesiapan Data Input'}
                />
              </span>
            )}
          </div>
        </div>

        {isDetail && kpis.validation.hwmCount === 0 && (
          <div
            data-testid="sim-uncalibrated-note"
            className="mb-2.5 rounded-md border border-[#161c1a]/10 bg-[#fafaf8] px-2.5 py-1.5 text-[11.5px] font-medium text-[#434d49]"
          >
            {isEn
              ? `Uncalibrated screening model · ${cov ? `${cov.measuredReaches}/${cov.insideReaches} cross-sections, ${cov.measuredCrossings}/${cov.totalCrossings} culverts measured` : '0 field river gauges'}`
              : `Model penyaringan belum terkalibrasi · ${cov ? `${cov.measuredReaches}/${cov.insideReaches} penampang & ${cov.measuredCrossings}/${cov.totalCrossings} gorong-gorong terukur` : '0 pos duga air'}`}
          </div>
        )}

        {/* Detailed-Only Map Overlay View Mode Switcher */}
        {isDetail && (
          <div
            data-testid="sim-map-view-switcher"
            className="mb-2.5 grid grid-cols-4 gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1"
          >
            {(
              [
                ['depth', isEn ? 'Depth' : 'Genangan'],
                ['confidence', isEn ? 'Spread' : 'Sebaran'],
                ['scour', isEn ? 'Scour ω' : 'Gerusan'],
                ['survey', isEn ? 'Survey' : 'Survei']
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChangeSimMapViewMode(mode)}
                className={`btn-tactile min-h-[30px] rounded-md px-1 text-[11.5px] font-bold ${
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

        {/* KPI Grid (matching TerrainTab metric cells) */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
              <span>{kpiFloodLabel}</span>
              <InfoTooltip text={t.infoKpiFlood} label={kpiFloodLabel} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#0369a1]">
              {formatHaValue(kpis.floodAreaHa)}
            </div>
            {showRanges && (
              <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                {isEn ? 'Sens.' : 'Sens.'}: {kpis.ensemble.floodAreaHa.p10.toFixed(0)}–{kpis.ensemble.floodAreaHa.p90.toFixed(0)} ha
              </div>
            )}
          </div>

          <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
            <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
              <span>{kpiLandslideLabel}</span>
              <InfoTooltip text={t.infoKpiLandslide} label={kpiLandslideLabel} />
            </div>
            <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#c2410c]">
              {formatHaValue(kpis.landslideAreaHa)}
            </div>
            {showRanges && (
              <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                {kpis.ensemble.landslideAreaHa.p10.toFixed(0)}–{kpis.ensemble.landslideAreaHa.p90.toFixed(0)} ha
                {kpis.runoutAreaHa && kpis.runoutAreaHa > 0 ? ` (+~${Math.round(kpis.runoutAreaHa)})` : ''}
              </div>
            )}
          </div>

          {!isDetail ? (
            <>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
                  <span>{t.kpiSimpleCrossings}</span>
                  <InfoTooltip text={t.infoKpiCrossings} label={t.kpiSimpleCrossings} />
                </div>
                <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
                  {kpis.chokeCount} {isEn ? 'spots' : 'titik'}
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
                  <span>{t.kpiTravelTimeSimple}</span>
                  <InfoTooltip text={t.infoKpiTravelTime} label={t.kpiTravelTimeSimple} />
                </div>
                <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
                  {progress > 0.02 ? `~${Math.round(kpis.peakTravelMin)} ${isEn ? 'min' : 'mnt'}` : '—'}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
                  <span>{t.kpiEffectiveRunoff}</span>
                  <InfoTooltip text={t.infoKpiRunoff} label={t.kpiEffectiveRunoff} />
                </div>
                <div className="font-mono-num mt-0.5 text-[14.5px] font-bold text-[#161c1a]">
                  {formatMmValue(kpis.effectiveRunoffMm)}
                </div>
                <div className="font-mono-num text-[10.5px] text-[#636f6a]">
                  Cv {(kpis.meanSedimentCv * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
                  <span>{t.kpiChoke}</span>
                  <InfoTooltip text={t.infoKpiCrossings} label={t.kpiChoke} />
                </div>
                <div className="font-mono-num mt-0.5 text-[15px] font-bold text-[#161c1a]">
                  {kpis.chokeCount} {isEn ? 'spots' : 'titik'}
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
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
                  {kpis.scourReachCount} {isEn ? 'scour reaches' : 'ruas gerusan'}
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="flex items-start justify-between gap-1 text-[12px] leading-tight text-[#636f6a]">
                  <span>{t.kpiTravelTime}</span>
                  <InfoTooltip text={t.infoKpiTravelTime} label={t.kpiTravelTime} />
                </div>
                <div className="font-mono-num mt-0.5 text-[14.5px] font-bold text-[#161c1a]">
                  {progress > 0.02 ? `~${Math.round(kpis.peakTravelMin)} ${isEn ? 'min' : 'mnt'}` : '—'}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Independent Validation Readout (Detailed Mode Only) */}
        {isDetail && (agamStats || kpis.validation.scourSampleCount > 0 || kpis.validation.hwmCount > 0) && (
          <div className="mt-2.5 rounded-lg border border-[#161c1a]/10 bg-[#fafaf8] px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between gap-1.5 text-[11.5px]">
              <span className="font-bold text-[#434d49]">
                {kpis.validation.hwmCount === 0
                  ? isEn
                    ? 'Spatial Pattern Sanity Check'
                    : 'Cek Pola Spasial (Belum Kalibrasi)'
                  : isEn
                    ? 'Independent Benchmark Skill'
                    : 'Validasi Independen Model'}
              </span>
              <div className="flex items-center gap-1">
                {kpis.validation.validationSplit === 'holdout' && (
                  <span className="rounded bg-[#047857]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#047857]">
                    {isEn ? 'Holdout' : 'Uji Terpisah'}
                  </span>
                )}
                {hasCalibrationProfile && (
                  <span className="rounded bg-[#0369a1]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#0369a1]">
                    {isEn ? 'Profile Active' : 'Profil Aktif'}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded border border-[#161c1a]/8 bg-white px-1.5 py-1">
                <div className="text-[10.5px] text-[#636f6a]">S2 Scour CSI</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">
                  {kpis.validation.scourCsi != null ? `${kpis.validation.scourCsi}%` : '—'}
                </div>
              </div>
              <div className="rounded border border-[#161c1a]/8 bg-white px-1.5 py-1">
                <div className="text-[10.5px] text-[#636f6a]">Agam AUC</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">
                  {kpis.validation.landslideAuc != null ? kpis.validation.landslideAuc.toFixed(2) : '—'}
                </div>
              </div>
              <div className="rounded border border-[#161c1a]/8 bg-white px-1.5 py-1">
                <div className="text-[10.5px] text-[#636f6a]">
                  HWM ({kpis.validation.hwmCount})
                </div>
                <div className="font-mono-num text-[12px] font-bold text-[#0369a1]">
                  {kpis.validation.hwmRmseM != null ? `${kpis.validation.hwmRmseM}m` : '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        {isDetail && (
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="sim-export-csv"
              onClick={() => {
                const csv = buildHydrographCsv(kpis);
                triggerBrowserDownload(csv, `${region.id}-hydrograph-${rainMm}mmh-${durationMin}m.csv`, 'text/csv;charset=utf-8');
              }}
              className="btn-tactile inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-1 text-[11.5px] font-bold text-[#161c1a] hover:border-[#0369a1]/40 hover:text-[#0369a1]"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>{isEn ? 'CSV Hydrograph' : 'CSV Hidrograf'}</span>
            </button>
            <button
              type="button"
              data-testid="sim-export-json"
              onClick={() => {
                const fallbackParams: CascadeSimParams = cascadeParams || {
                  rainMmHr: rainMm,
                  durationMin,
                  progress,
                  soilMoisture,
                  rainPattern,
                  drainCondition,
                  forestScenario,
                  hyetograph,
                  antecedent5dMm,
                  orographicPctPerKm,
                  stormCore,
                  culvertBlockagePct,
                  structureBlockageOverrides,
                  debrisCoupling
                };
                const json = buildScenarioExportJson(fallbackParams, kpis, simNetwork, routedNominal);
                triggerBrowserDownload(json, `${region.id}-scenario-${rainMm}mmh-${durationMin}m.json`, 'application/json;charset=utf-8');
              }}
              className="btn-tactile inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-1 text-[11.5px] font-bold text-[#161c1a] hover:border-[#0369a1]/40 hover:text-[#0369a1]"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>{isEn ? 'JSON Scenario' : 'JSON Skenario'}</span>
            </button>
          </div>
        )}

        <button
          type="button"
          data-testid="sim-open-methodology"
          onClick={onOpenMethodology}
          className="btn-tactile mt-2.5 flex w-full items-center justify-center rounded-lg border border-[#161c1a]/12 bg-[#fafaf8] px-3 py-1.5 text-[12px] font-semibold text-[#0369a1] hover:border-[#0369a1]/35 hover:bg-[#f2f3ef]"
        >
          {t.simSeeFormulasLink} →
        </button>
      </section>

      {/* Card 4 (Detailed only): River Width & Bank-Widening Threshold Calculator */}
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
              className="mb-2.5 min-h-[36px] w-full cursor-pointer rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#161c1a] transition hover:border-[#161c1a]/30"
            >
              {verifiedWaterways.map(w => (
                <option key={w.properties.id} value={w.properties.id}>
                  {w.properties.name} ({waterwayKindLabel[w.properties.kind] || w.properties.kind})
                </option>
              ))}
            </select>

            <div className="mb-2.5 grid grid-cols-4 gap-1.5 text-center">
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10.5px] text-[#636f6a]">{isEn ? 'Width' : 'Lebar'}</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">
                  {calc.widthPreM != null ? `${calc.widthPreM}→${calc.widthM}m` : `~${calc.widthM}m`}
                </div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10.5px] text-[#636f6a]">{isEn ? 'Depth' : 'Dalam'}</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">~{calc.depthM}m</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10.5px] text-[#636f6a]">{isEn ? 'Slope' : 'Lereng'}</div>
                <div className="font-mono-num text-[12px] font-bold text-[#161c1a]">{calc.slopePct}%</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-1.5 py-1.5">
                <div className="text-[10.5px] text-[#636f6a]">DAS</div>
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
