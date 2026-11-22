import { Droplets, MapPin, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { ActiveTool, BasemapId, Language, LayerToggles, RaindropTrace, ViewMode } from '../types/gis';

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
  cameraPreset: string;
  onSelectPreset: (preset: string) => void;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onChangeExag: (val: number) => void;
  onChangeFlowDensity: (density: number) => void;
  onToggleTool: (tool: 'raindrop' | 'profileA') => void;
  onClearRaindrop: () => void;
  onSwitchToDetail: () => void;
}

function LayerGlyph({
  kind
}: {
  kind: 'waterway' | 'canal' | 'structure' | 'crossing' | 'flow' | 'das' | 'hillshade' | 'contour' | 'slope' | 'osm';
}) {
  if (kind === 'waterway') {
    return <span className="inline-block h-[3.5px] w-4 shrink-0 rounded-full bg-[#0369a1]" />;
  }
  if (kind === 'canal') {
    return <span className="inline-block h-[2.5px] w-4 shrink-0 rounded-full bg-[#0d9488]" />;
  }
  if (kind === 'structure') {
    return <span className="inline-block h-3 w-3 shrink-0 rounded-[3px] border border-white bg-[#047857] shadow-[0_0_0_1px_rgba(22,28,26,0.2)]" />;
  }
  if (kind === 'crossing') {
    return <span className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-[#475569] bg-[#e2e8f0]" />;
  }
  if (kind === 'flow') {
    return <span className="inline-block h-0 w-4 shrink-0 border-t-2 border-dashed border-[#b45309]" />;
  }
  if (kind === 'das') {
    return <span className="inline-block h-3 w-4 shrink-0 rounded-[2px] border-2 border-[#1b382d] bg-[#1b382d]/10" />;
  }
  if (kind === 'contour') {
    return <span className="inline-block h-[2px] w-4 shrink-0 rounded-full bg-[#b45309]" />;
  }
  if (kind === 'slope') {
    return (
      <span
        className="inline-block h-3 w-4 shrink-0 rounded-[3px] border border-black/15"
        style={{ background: 'linear-gradient(90deg,#f59e0b,#c2410c)' }}
      />
    );
  }
  if (kind === 'osm') {
    return <span className="inline-block h-[2.5px] w-4 shrink-0 rounded-full bg-[#475569]" />;
  }
  return <span className="inline-block h-3 w-4 shrink-0 rounded-[3px] border border-black/15 bg-[#64748b]" />;
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
  cameraPreset,
  onSelectPreset,
  onToggleLayer,
  onChangeExag,
  onChangeFlowDensity,
  onToggleTool,
  onClearRaindrop,
  onSwitchToDetail
}: TerrainTabProps) {
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';

  const jorongPresets = [
    { id: 'center', label: t.camCenter },
    { id: 'pahambatan', label: t.camPahambatan },
    { id: 'hilalang', label: t.camHilalang },
    { id: 'subarang', label: t.camSubarang },
    { id: 'hulu', label: t.camHulu }
  ];

  const detailLayerItems: {
    key: keyof LayerToggles;
    label: string;
    glyph: 'waterway' | 'structure' | 'crossing' | 'hillshade' | 'das' | 'contour' | 'slope' | 'osm';
  }[] = [
    { key: 'verifiedWaterways', label: t.lblVerifiedWaterways, glyph: 'waterway' },
    { key: 'structures', label: t.lblStructures, glyph: 'structure' },
    { key: 'unverifiedCrossings', label: t.lblUnverifiedCrossings, glyph: 'crossing' },
    { key: 'hillshade', label: t.lblHillshade, glyph: 'hillshade' },
    { key: 'das', label: t.lblDas, glyph: 'das' },
    { key: 'contours', label: t.lblContours, glyph: 'contour' },
    { key: 'slope', label: t.lblSlope, glyph: 'slope' },
    { key: 'osmContext', label: t.lblOsmContext, glyph: 'osm' }
  ];

  const jorongCard = (
    <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-[#161c1a]">
        <MapPin className="h-3.5 w-3.5 text-[#0369a1]" />
        <span>{t.jorongQuickTitle}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {jorongPresets.map(p => {
          const active = cameraPreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPreset(p.id)}
              className={`min-h-[38px] rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition active:scale-[0.98] ${
                active
                  ? 'border-[#0369a1] bg-[#0369a1] text-white'
                  : 'border-[#161c1a]/15 bg-[#fafaf8] text-[#161c1a] hover:bg-[#f2f3ef]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </section>
  );

  if (!isDetail) {
    return (
      <div className="flex flex-col gap-3.5">
        <p className="m-0 text-[13.5px] leading-relaxed text-[#434d49]">{t.mapSimpleIntro}</p>

        {jorongCard}

        <section className="rounded-xl border border-[#161c1a]/12 bg-white p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-bold text-[#161c1a]">{t.terrainLayersTitle}</span>
            <span className="font-mono-num text-[12px] font-semibold text-[#636f6a]">
              {studyAreaKm2.toFixed(1)} km²
            </span>
          </div>

          <div className="divide-y divide-[#161c1a]/10">
            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                <LayerGlyph kind="waterway" />
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
              <LayerGlyph kind="canal" />
              <span>{t.lblVerifiedCanals}</span>
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                <LayerGlyph kind="structure" />
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
                <LayerGlyph kind="flow" />
                <span>{t.lblFlowSimple}</span>
              </span>
              <input
                type="checkbox"
                checked={flowDensity > 0}
                onChange={e => onChangeFlowDensity(e.target.checked ? 1 : 0)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#161c1a]">
                <LayerGlyph kind="das" />
                <span>{t.lblDas}</span>
              </span>
              <input
                type="checkbox"
                checked={layers.das}
                onChange={e => onToggleLayer('das', e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>
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
            <label key={item.key} className="flex min-h-[40px] cursor-pointer items-center justify-between gap-2.5 py-1.5">
              <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#161c1a]">
                <LayerGlyph kind={item.glyph} />
                <span>{item.label}</span>
              </span>
              <input
                type="checkbox"
                checked={layers[item.key]}
                onChange={e => onToggleLayer(item.key, e.target.checked)}
                className="h-4.5 w-4.5 cursor-pointer accent-[#0369a1]"
              />
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-[#161c1a]/10 pt-3">
          <div className="flex items-center justify-between text-[13px] font-semibold text-[#434d49]">
            <span>{t.lblExag}</span>
            <span className="font-mono-num text-[12.5px] font-bold text-[#161c1a]">
              {exaggeration.toFixed(1)}×
            </span>
          </div>
          <input
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
        <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#161c1a]">
          <LayerGlyph kind="flow" />
          <span>{t.flowDensityTitle}</span>
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
        <p className="mt-2.5 mb-0 text-[12.5px] leading-relaxed text-[#434d49]">{t.flowDensityHint}</p>
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
