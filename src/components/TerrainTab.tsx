import { useId } from 'react';
import { Droplets, MapPin, RotateCcw, SlidersHorizontal, TrendingUp, X } from 'lucide-react';
import { useActiveRegion, useT } from '../context/RegionContext';
import type {
  ActiveTool,
  AgamStats,
  Language,
  LayerToggles,
  RaindropTrace,
  ViewMode
} from '../types/gis';
import { InfoTooltip } from './InfoTooltip';
import { LegendIcon, type LegendIconKind } from './LegendIcon';

interface TerrainTabProps {
  lang: Language;
  viewMode: ViewMode;
  layers: LayerToggles;
  exaggeration: number;
  flowDensity: number;
  activeTool: ActiveTool;
  raindrop: RaindropTrace | null;
  studyAreaKm2: number;
  buildingCount?: number;
  agamStats?: AgamStats;
  cameraPreset: string;
  onSelectPreset: (preset: string) => void;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onResetDefaultLayers: () => void;
  onClearAllLayers: () => void;
  onClearAgamLayers: () => void;
  onChangeExag: (val: number) => void;
  onChangeFlowDensity: (density: number) => void;
  onToggleTool: (tool: 'raindrop' | 'profileA') => void;
  onClearRaindrop: () => void;
  onSwitchToDetail: () => void;
}

export function TerrainTab({
  lang,
  viewMode,
  layers,
  exaggeration,
  flowDensity,
  activeTool,
  raindrop,
  studyAreaKm2,
  buildingCount,
  agamStats,
  cameraPreset,
  onSelectPreset,
  onToggleLayer,
  onResetDefaultLayers,
  onClearAllLayers,
  onClearAgamLayers,
  onChangeExag,
  onChangeFlowDensity,
  onToggleTool,
  onClearRaindrop,
  onSwitchToDetail
}: TerrainTabProps) {
  const uid = useId();
  const region = useActiveRegion();
  const t = useT(lang);
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';

  const mapLayerKeys: (keyof LayerToggles)[] = [
    'verifiedWaterways',
    'structures',
    'unverifiedCrossings',
    'settlements',
    'landCover',
    'scourChange',
    'agamLandslide',
    'agamRbiRivers',
    'agamForestStatus',
    'agamSoilGeology',
    'hillshade',
    'das',
    'contours',
    'slope',
    'osmContext'
  ];
  const defaultTrueKeys = new Set<keyof LayerToggles>([
    'verifiedWaterways',
    'structures',
    'settlements',
    'das'
  ]);
  const agamLayerKeys: (keyof LayerToggles)[] = [
    'agamLandslide',
    'agamRbiRivers',
    'agamForestStatus',
    'agamSoilGeology'
  ];

  const activeMapLayerCount =
    mapLayerKeys.filter(k => layers[k]).length + (flowDensity > 0 ? 1 : 0);
  const isAtDefaultLayers =
    flowDensity === 1 && mapLayerKeys.every(k => layers[k] === defaultTrueKeys.has(k));
  const activeAgamCount = agamLayerKeys.filter(k => layers[k]).length;

  const layerQuickActions = (
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-[#161c1a]/10 pb-2">
      <span
        data-testid="layers-active-count"
        className="font-mono-num text-[11.5px] font-semibold text-[#434d49]"
      >
        {activeMapLayerCount} {t.layersActiveCount}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid="layers-reset-default"
          disabled={isAtDefaultLayers}
          onClick={onResetDefaultLayers}
          className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-0.5 text-[11.5px] font-semibold text-[#0369a1] transition hover:bg-[#0369a1]/8 disabled:cursor-not-allowed disabled:border-[#161c1a]/10 disabled:bg-[#f2f3ef] disabled:text-[#636f6a]/55"
        >
          <RotateCcw className="h-3 w-3 shrink-0" />
          <span>{t.layersResetDefault}</span>
        </button>
        <button
          type="button"
          data-testid="layers-clear-all"
          disabled={activeMapLayerCount === 0}
          onClick={onClearAllLayers}
          className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-[#161c1a]/15 bg-[#fafaf8] px-2 py-0.5 text-[11.5px] font-semibold text-[#434d49] transition hover:border-[#b91c1c]/30 hover:bg-[#b91c1c]/8 hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:border-[#161c1a]/10 disabled:bg-[#f2f3ef] disabled:text-[#636f6a]/55"
        >
          <X className="h-3 w-3 shrink-0" />
          <span>{t.layersClearAll}</span>
        </button>
      </div>
    </div>
  );

  const jorongPresets = region.cameraPresets.map(p => ({ id: p.id, label: p.label }));
  const hasRegionalOverlays = region.regionalOverlays.enabled;
  const hasSentinelChange = region.regionalOverlays.sentinelChangeAvailable;

  const detailLayerItems: {
    key: keyof LayerToggles;
    label: string;
    glyph: LegendIconKind;
    badge?: string;
    info?: string;
  }[] = [
    { key: 'verifiedWaterways', label: t.lblVerifiedWaterways, glyph: 'waterway' },
    { key: 'structures', label: t.lblStructures, glyph: 'bridge' },
    {
      key: 'settlements',
      label: t.lblSettlements,
      glyph: 'settlements',
      badge: buildingCount ? buildingCount.toLocaleString(isEn ? 'en-US' : 'id-ID') : undefined
    },
    { key: 'landCover', label: t.lblLandCover, glyph: 'landCover' },
    { key: 'scourChange', label: t.lblScourChange, glyph: 'scourChange', info: t.infoScourChange },
    { key: 'unverifiedCrossings', label: t.lblUnverifiedCrossings, glyph: 'crossing' },
    { key: 'hillshade', label: t.lblHillshade, glyph: 'hillshade' },
    { key: 'das', label: t.lblDas, glyph: 'das', info: t.jorongBoundaryNote },
    { key: 'contours', label: t.lblContours, glyph: 'contour' },
    { key: 'slope', label: t.lblSlope, glyph: 'slope' },
    { key: 'osmContext', label: t.lblOsmContext, glyph: 'osm' }
  ];

  const jorongCard = (
    <section className="rounded-xl border border-[#161c1a]/12 bg-white px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2.5">
        <label
          htmlFor={`${uid}-jorong`}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-bold text-[#161c1a]"
        >
          <MapPin className="h-3.5 w-3.5 shrink-0 text-[#0369a1]" />
          <span className="truncate">{t.jorongQuickTitle}</span>
        </label>
        <select
          id={`${uid}-jorong`}
          data-testid="jorong-select"
          value={cameraPreset}
          onChange={e => onSelectPreset(e.target.value)}
          className="min-h-[34px] w-[158px] shrink-0 cursor-pointer rounded-lg border border-[#161c1a]/20 bg-[#fafaf8] px-2.5 py-1 text-[12.5px] font-semibold text-[#161c1a] transition hover:border-[#161c1a]/30"
        >
          {jorongPresets.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );

  if (!isDetail) {
    return (
      <div className="flex flex-col gap-3.5">
        {jorongCard}

        <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-[13px] font-bold text-[#161c1a]">{t.mapLayersTitle}</span>
              <InfoTooltip text={t.mapSimpleIntro} label={t.mapLayersTitle} />
            </span>
            <span className="font-mono-num shrink-0 text-[12px] font-semibold text-[#636f6a]">
              {studyAreaKm2.toFixed(1)} km²
            </span>
          </div>

          {layerQuickActions}

          <div className="divide-y divide-[#161c1a]/10">
            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                <LegendIcon kind="waterway" />
                <span>{t.lblVerifiedWaterways}</span>
              </span>
              <input
                type="checkbox"
                checked={layers.verifiedWaterways}
                onChange={e => onToggleLayer('verifiedWaterways', e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                <LegendIcon kind="bridge" />
                <span>{t.lblStructures}</span>
              </span>
              <input
                type="checkbox"
                checked={layers.structures}
                onChange={e => onToggleLayer('structures', e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                <LegendIcon kind="settlements" />
                <span>{t.lblSettlements}</span>
                {buildingCount ? (
                  <span className="font-mono-num rounded bg-[#f2f3ef] px-1.5 py-0.5 text-[11px] font-semibold text-[#434d49]">
                    {buildingCount.toLocaleString(isEn ? 'en-US' : 'id-ID')}
                  </span>
                ) : null}
              </span>
              <input
                type="checkbox"
                checked={layers.settlements}
                onChange={e => onToggleLayer('settlements', e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                <LegendIcon kind="landCover" />
                <span>{t.lblLandCover}</span>
              </span>
              <input
                type="checkbox"
                checked={layers.landCover}
                onChange={e => onToggleLayer('landCover', e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>

            {hasSentinelChange && (
              <div className="flex min-h-[44px] items-center justify-between gap-3 py-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <label
                    htmlFor={`${uid}-simple-scour`}
                    className="flex min-w-0 cursor-pointer items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]"
                  >
                    <LegendIcon kind="scourChange" />
                    <span>{t.lblScourChange}</span>
                  </label>
                  <InfoTooltip text={t.infoScourChange} label={t.lblScourChange} />
                </div>
                <input
                  id={`${uid}-simple-scour`}
                  type="checkbox"
                  checked={layers.scourChange}
                  onChange={e => onToggleLayer('scourChange', e.target.checked)}
                  className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
                />
              </div>
            )}

            {hasRegionalOverlays && (
              <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
                <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                  <LegendIcon kind="agamLandslide" />
                  <span>{t.lblAgamLandslide}</span>
                </span>
                <input
                  type="checkbox"
                  checked={layers.agamLandslide}
                  onChange={e => onToggleLayer('agamLandslide', e.target.checked)}
                  className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
                />
              </label>
            )}

            <div className="flex min-h-[44px] items-center justify-between gap-3 py-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <label
                  htmlFor={`${uid}-simple-flow`}
                  className="flex min-w-0 cursor-pointer items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]"
                >
                  <LegendIcon kind="flow" />
                  <span>{t.lblFlowSimple}</span>
                </label>
                <InfoTooltip text={t.infoFlowSimple} label={t.lblFlowSimple} />
              </div>
              <input
                id={`${uid}-simple-flow`}
                type="checkbox"
                checked={flowDensity > 0}
                onChange={e => onChangeFlowDensity(e.target.checked ? 1 : 0)}
                className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
              />
            </div>

            <div className="py-1.5">
              <div className="flex min-h-[40px] items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <label
                    htmlFor={`${uid}-simple-das`}
                    className="flex min-w-0 cursor-pointer items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]"
                  >
                    <LegendIcon kind="das" />
                    <span>{t.lblDas}</span>
                  </label>
                  <InfoTooltip text={t.jorongBoundaryNote} label={t.lblDas} />
                </div>
                <input
                  id={`${uid}-simple-das`}
                  type="checkbox"
                  checked={layers.das}
                  onChange={e => onToggleLayer('das', e.target.checked)}
                  className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-2 rounded-xl border border-[#161c1a]/12 bg-[#f2f3ef] p-3.5">
          <p className="m-0 text-[13px] text-[#434d49]">{t.switchToDetailPrompt}</p>
          <button
            type="button"
            onClick={onSwitchToDetail}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-white px-3 py-2 text-[13px] font-bold text-[#161c1a] transition hover:bg-[#fafaf8]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#0369a1]" />
            <span>{t.switchToDetailBtn}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {jorongCard}

      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#161c1a]">{t.mapLayersTitle}</span>
          <span className="font-mono-num text-[12px] font-semibold text-[#636f6a]">
            {studyAreaKm2.toFixed(1)} km²
          </span>
        </div>

        {layerQuickActions}

        <div className="divide-y divide-[#161c1a]/10">
          {detailLayerItems.map(item => (
            <div key={item.key} className="flex min-h-[40px] items-center justify-between gap-2.5 py-1">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <label
                  htmlFor={`${uid}-detail-${item.key}`}
                  className="flex min-w-0 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[#161c1a]"
                >
                  <LegendIcon kind={item.glyph} />
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span className="font-mono-num rounded bg-[#f2f3ef] px-1.5 py-0.5 text-[11px] font-semibold text-[#434d49]">
                      {item.badge}
                    </span>
                  ) : null}
                </label>
                {item.info && <InfoTooltip text={item.info} label={item.label} />}
              </div>
              <input
                id={`${uid}-detail-${item.key}`}
                type="checkbox"
                checked={layers[item.key]}
                onChange={e => onToggleLayer(item.key, e.target.checked)}
                className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#0369a1]"
              />
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-[#161c1a]/10 pt-3">
          <div className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[#434d49]">
            <span className="flex items-center gap-1.5">
              <label htmlFor={`${uid}-exag`}>{t.lblExag}</label>
              <InfoTooltip text={t.infoExag} label={t.lblExag} />
            </span>
            <span className="font-mono-num text-[12.5px] font-bold text-[#161c1a]">
              {exaggeration.toFixed(1)}×
            </span>
          </div>
          <input
            id={`${uid}-exag`}
            type="range"
            min={1.0}
            max={2.2}
            step={0.1}
            value={exaggeration}
            onChange={e => onChangeExag(parseFloat(e.target.value))}
            className="w-full cursor-pointer accent-[#0369a1]"
          />
        </div>
      </section>

      {hasRegionalOverlays && (
      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-[13px] font-bold text-[#161c1a]">{t.agamRefTitle}</span>
            <InfoTooltip text={t.agamClickHint} label={t.agamRefTitle} />
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {activeAgamCount > 0 && (
              <button
                type="button"
                data-testid="agam-layers-clear"
                onClick={onClearAgamLayers}
                className="inline-flex min-h-[24px] items-center gap-0.5 rounded-md border border-[#161c1a]/15 bg-[#fafaf8] px-1.5 py-0.5 text-[11px] font-semibold text-[#434d49] transition hover:border-[#b91c1c]/30 hover:bg-[#b91c1c]/8 hover:text-[#b91c1c]"
              >
                <X className="h-3 w-3 shrink-0" />
                <span>{t.layersClearSection}</span>
              </button>
            )}
            {agamStats?.rbiRiversCount ? (
              <span className="font-mono-num text-[11px] font-semibold text-[#636f6a]">
                RBI {agamStats.rbiRiversCount} {isEn ? 'reaches' : 'ruas'}
              </span>
            ) : null}
          </div>
        </div>
        <div className="divide-y divide-[#161c1a]/10">
          <label className="flex min-h-[38px] cursor-pointer items-center justify-between gap-2.5 py-1.5">
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
              <LegendIcon kind="agamLandslide" />
              <span>{t.lblAgamLandslide}</span>
            </span>
            <input
              type="checkbox"
              checked={layers.agamLandslide}
              onChange={e => onToggleLayer('agamLandslide', e.target.checked)}
              className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
            />
          </label>

          <label className="flex min-h-[38px] cursor-pointer items-center justify-between gap-2.5 py-1.5">
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
              <LegendIcon kind="agamRbi" />
              <span>{t.lblAgamRbiRivers}</span>
            </span>
            <input
              type="checkbox"
              checked={layers.agamRbiRivers}
              onChange={e => onToggleLayer('agamRbiRivers', e.target.checked)}
              className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
            />
          </label>

          <label className="flex min-h-[38px] cursor-pointer items-center justify-between gap-2.5 py-1.5">
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
              <LegendIcon kind="agamForest" />
              <span>{t.lblAgamForest}</span>
            </span>
            <input
              type="checkbox"
              checked={layers.agamForestStatus}
              onChange={e => onToggleLayer('agamForestStatus', e.target.checked)}
              className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
            />
          </label>

          <label className="flex min-h-[38px] cursor-pointer items-center justify-between gap-2.5 py-1.5">
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
              <LegendIcon kind="agamSoil" />
              <span>{t.lblAgamSoil}</span>
            </span>
            <input
              type="checkbox"
              checked={layers.agamSoilGeology}
              onChange={e => onToggleLayer('agamSoilGeology', e.target.checked)}
              className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
            />
          </label>
        </div>
      </section>
      )}

      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#161c1a]">
          <LegendIcon kind="flow" />
          <span>{t.flowDensityTitle}</span>
          <InfoTooltip text={t.flowDensityHint} label={t.flowDensityTitle} />
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef] p-1">
          {[
            [0, t.densOff],
            [1, t.densMain],
            [2, t.densNormal],
            [3, t.densDetail]
          ].map(([val, label]) => {
            const active = flowDensity === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => onChangeFlowDensity(Number(val))}
                className={`min-h-[34px] rounded-md py-1 text-[12.5px] font-semibold transition ${
                  active ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#434d49] hover:text-[#161c1a]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2.5 text-[13px] font-bold text-[#161c1a]">{t.terrainToolsTitle}</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onToggleTool('raindrop')}
            className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${
              activeTool === 'raindrop'
                ? 'border-[#0369a1] bg-[#0369a1] text-white'
                : 'border-[#161c1a]/15 bg-white text-[#161c1a] hover:bg-[#f2f3ef]'
            }`}
          >
            <Droplets className="h-3.5 w-3.5" />
            <span>{t.btnRaindrop}</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleTool('profileA')}
            className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${
              activeTool === 'profileA' || activeTool === 'profileB'
                ? 'border-[#0369a1] bg-[#0369a1] text-white'
                : 'border-[#161c1a]/15 bg-white text-[#161c1a] hover:bg-[#f2f3ef]'
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            <span>{t.btnProfile}</span>
          </button>
        </div>

        {raindrop && (
          <div className="mt-3 border-t border-[#161c1a]/10 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-[13px] text-[#161c1a]">{t.raindropMetricsTitle}</strong>
              <button
                type="button"
                onClick={onClearRaindrop}
                className="rounded-md border border-[#161c1a]/15 bg-[#f2f3ef] px-2.5 py-1 text-[12px] font-semibold text-[#161c1a] hover:bg-[#e5e7e2]"
              >
                {t.clear}
              </button>
            </div>
            {raindrop.snappedToWaterway && (
              <div className="mb-2 rounded-lg border border-[#0369a1]/25 bg-[#0369a1]/8 px-2.5 py-1.5 text-[12px] font-semibold text-[#0369a1]">
                {isEn
                  ? `Drains into verified waterway: ${raindrop.snappedToWaterway}`
                  : `Masuk ke sungai terverifikasi: ${raindrop.snappedToWaterway}`}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="text-[12px] text-[#636f6a]">{t.mStartElev}</div>
                <div className="font-mono-num text-[14px] font-bold">{Math.round(raindrop.startElev)} mdpl</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="text-[12px] text-[#636f6a]">{t.mEndElev}</div>
                <div className="font-mono-num text-[14px] font-bold">{Math.round(raindrop.endElev)} mdpl</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="text-[12px] text-[#636f6a]">{t.mDrop}</div>
                <div className="font-mono-num text-[14px] font-bold">-{Math.round(raindrop.dropM)} m</div>
              </div>
              <div className="rounded-lg bg-[#fafaf8] px-3 py-2">
                <div className="text-[12px] text-[#636f6a]">{t.mLengthSlope}</div>
                <div className="font-mono-num text-[14px] font-bold">
                  {Math.round(raindrop.lengthM)} m · {raindrop.avgSlopePct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
