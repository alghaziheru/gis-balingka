import { useId } from 'react';
import { Droplets, MapPin, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type {
  ActiveTool,
  AgamStats,
  BasemapId,
  LandCoverStats,
  Language,
  LayerToggles,
  RaindropTrace,
  ScourStats,
  ViewMode
} from '../types/gis';
import { InfoTooltip } from './InfoTooltip';
import { LegendIcon, type LegendIconKind } from './LegendIcon';

interface TerrainTabProps {
  lang: Language;
  viewMode: ViewMode;
  basemap: BasemapId;
  layers: LayerToggles;
  exaggeration: number;
  flowDensity: number;
  activeTool: ActiveTool;
  raindrop: RaindropTrace | null;
  studyAreaKm2: number;
  buildingCount?: number;
  landCoverStats?: LandCoverStats;
  scourStats?: ScourStats;
  agamStats?: AgamStats;
  cameraPreset: string;
  onSelectPreset: (preset: string) => void;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onChangeExag: (val: number) => void;
  onChangeFlowDensity: (density: number) => void;
  onToggleTool: (tool: 'raindrop' | 'profileA') => void;
  onClearRaindrop: () => void;
  onSwitchToDetail: () => void;
}

export function TerrainTab({
  lang,
  viewMode,
  basemap,
  layers,
  exaggeration,
  flowDensity,
  activeTool,
  raindrop,
  studyAreaKm2,
  buildingCount,
  landCoverStats,
  scourStats,
  agamStats,
  cameraPreset,
  onSelectPreset,
  onToggleLayer,
  onChangeExag,
  onChangeFlowDensity,
  onToggleTool,
  onClearRaindrop,
  onSwitchToDetail
}: TerrainTabProps) {
  const uid = useId();
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';

  const jorongPresets = [
    { id: 'center', label: t.camCenter },
    { id: 'subarang', label: t.camSubarang },
    { id: 'hilalang', label: t.camHilalang },
    { id: 'pahambatan', label: t.camPahambatan }
  ];

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

  const landCoverKey = layers.landCover && (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-[#fafaf8] px-2.5 py-2 text-[11.5px] text-[#434d49]">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#15803d]" />
        <span className="truncate">{t.lcForest}</span>
        {landCoverStats && <strong className="font-mono-num ml-auto text-[#161c1a]">{landCoverStats.forestPct}%</strong>}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#65a30d]" />
        <span className="truncate">{t.lcShrubGrass}</span>
        {landCoverStats && <strong className="font-mono-num ml-auto text-[#161c1a]">{landCoverStats.shrubGrassPct}%</strong>}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#ca8a04]" />
        <span className="truncate">{t.lcCropland}</span>
        {landCoverStats && <strong className="font-mono-num ml-auto text-[#161c1a]">{landCoverStats.croplandPct}%</strong>}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#b91c1c]" />
        <span className="truncate">{t.lcBuiltup}</span>
        {landCoverStats && <strong className="font-mono-num ml-auto text-[#161c1a]">{landCoverStats.builtupPct}%</strong>}
      </span>
    </div>
  );

  const scourKey = layers.scourChange && (
    <div className="rounded-lg bg-[#fafaf8] px-2.5 py-2 text-[11.5px] leading-snug text-[#434d49]">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 font-semibold text-[#161c1a]">
        <span className="whitespace-nowrap">
          {scourStats ? `${scourStats.preDate} → ${scourStats.postDate}` : '2022-12-24 → 2024-07-11'}
        </span>
        {scourStats && (
          <span className="font-mono-num whitespace-nowrap text-[#991b1b]">
            {scourStats.totalScourHa} ha ({scourStats.corridorScourHa} ha {isEn ? 'valley' : 'lembah'})
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[#991b1b]" />{' '}
          {isEn ? 'Strong vegetation decrease' : 'Penurunan vegetasi tinggi'}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[#d97706]" />{' '}
          {isEn ? 'Moderate vegetation decrease' : 'Penurunan vegetasi sedang'}
        </span>
      </div>
    </div>
  );

  const agamLandslideKey = layers.agamLandslide && (
    <div className="rounded-lg bg-[#fafaf8] px-2.5 py-2 text-[11.5px] leading-snug text-[#434d49]">
      <div className="mb-1 font-semibold text-[#161c1a]">
        {isEn
          ? 'Ground Movement Classes — Source: Pemkab Agam / BPBD'
          : 'Kelas Peta Gerakan Tanah — Sumber: Pemkab Agam / BPBD'}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[#dc2626]" /> {isEn ? 'High' : 'Tinggi'}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[#d97706]" /> {isEn ? 'Medium' : 'Sedang'}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-[#65a30d]" /> {isEn ? 'Low' : 'Rendah'}
        </span>
      </div>
      <div className="mt-1 text-[10.5px] text-[#636f6a]">
        {isEn
          ? 'Tap map to view open-map polygon attributes (reference layer, not a per-house survey).'
          : 'Klik peta untuk melihat atribut poligon data terbuka (lapisan referensi, bukan pengukuran per-rumah).'}
      </div>
    </div>
  );

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
              <span className="text-[13px] font-bold text-[#161c1a]">{t.terrainLayersTitle}</span>
              <InfoTooltip text={t.mapSimpleIntro} label={t.terrainLayersTitle} />
            </span>
            <span className="font-mono-num shrink-0 text-[12px] font-semibold text-[#636f6a]">
              {studyAreaKm2.toFixed(1)} km²
            </span>
          </div>

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

            <div className="flex items-center gap-2.5 py-2 pl-0.5 text-[12.5px] text-[#434d49]">
              <LegendIcon kind="canal" />
              <span>{t.lblVerifiedCanals}</span>
            </div>

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

            <div className="py-1.5">
              <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3">
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
              {landCoverKey && <div className="mt-1.5">{landCoverKey}</div>}
            </div>

            <div className="py-1.5">
              <div className="flex min-h-[40px] items-center justify-between gap-3">
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
              {scourKey && <div className="mt-1.5">{scourKey}</div>}
            </div>

            <div className="py-1.5">
              <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3">
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
              {agamLandslideKey && <div className="mt-1.5">{agamLandslideKey}</div>}
            </div>

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
          <span className="text-[13px] font-bold text-[#161c1a]">{t.terrainLayersTitle}</span>
          <span className="font-mono-num text-[12px] font-semibold text-[#636f6a]">
            {studyAreaKm2.toFixed(1)} km²
          </span>
        </div>

        {(basemap === 'elev' || basemap === 'slope') && (
          <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-[#fafaf8] px-2.5 py-2 text-[12.5px] font-medium text-[#161c1a]">
            <span
              className="inline-block h-3 w-5 shrink-0 rounded-[3px] border border-black/15"
              style={{
                background:
                  basemap === 'elev'
                    ? 'linear-gradient(90deg,#84b860,#eab308,#92400e)'
                    : 'linear-gradient(90deg,#f59e0b,#c2410c)'
              }}
            />
            <span>
              {basemap === 'elev'
                ? isEn
                  ? 'Active surface: Valley → Highland elevation'
                  : 'Permukaan aktif: Elevasi lembah → lereng tinggi'
                : isEn
                ? 'Active surface: Slope steepness (>15%)'
                : 'Permukaan aktif: Kemiringan lereng (>15%)'}
            </span>
          </div>
        )}

        <div className="divide-y divide-[#161c1a]/10">
          {detailLayerItems.map(item => (
            <div key={item.key} className="py-1.5">
              <div className="flex min-h-[38px] items-center justify-between gap-2.5">
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
              {item.key === 'landCover' && landCoverKey && <div className="mt-1.5">{landCoverKey}</div>}
              {item.key === 'scourChange' && scourKey && <div className="mt-1.5">{scourKey}</div>}
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

      <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-[13px] font-bold text-[#161c1a]">{t.agamRefTitle}</span>
            <InfoTooltip text={t.agamClickHint} label={t.agamRefTitle} />
          </span>
          {agamStats?.rbiRiversCount ? (
            <span className="font-mono-num shrink-0 text-[11px] font-semibold text-[#636f6a]">
              RBI {agamStats.rbiRiversCount} {isEn ? 'reaches' : 'ruas'}
            </span>
          ) : null}
        </div>
        <div className="divide-y divide-[#161c1a]/10">
          <div className="py-1.5">
            <label className="flex min-h-[38px] cursor-pointer items-center justify-between gap-2.5">
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
            {agamLandslideKey && <div className="mt-1.5">{agamLandslideKey}</div>}
          </div>

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
