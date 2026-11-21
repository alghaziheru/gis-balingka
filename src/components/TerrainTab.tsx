import { Droplets, TrendingUp } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { ActiveTool, Language, LayerToggles, RaindropTrace } from '../types/gis';

interface TerrainTabProps {
  lang: Language;
  layers: LayerToggles;
  exaggeration: number;
  flowDensity: number;
  activeTool: ActiveTool;
  raindrop: RaindropTrace | null;
  studyAreaKm2: number;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onChangeExag: (val: number) => void;
  onChangeFlowDensity: (density: number) => void;
  onToggleTool: (tool: 'raindrop' | 'profileA') => void;
  onClearRaindrop: () => void;
}

export function TerrainTab({
  lang,
  layers,
  exaggeration,
  flowDensity,
  activeTool,
  raindrop,
  studyAreaKm2,
  onToggleLayer,
  onChangeExag,
  onChangeFlowDensity,
  onToggleTool,
  onClearRaindrop
}: TerrainTabProps) {
  const t = I18N[lang];

  const layerItems: { key: keyof LayerToggles; label: string; swatch: string }[] = [
    { key: 'verifiedWaterways', label: t.lblVerifiedWaterways, swatch: '#0284c7' },
    { key: 'hillshade', label: t.lblHillshade, swatch: 'linear-gradient(135deg,#cbd5e1,#475569)' },
    { key: 'das', label: t.lblDas, swatch: 'rgba(2,132,199,0.25)' },
    { key: 'contours', label: t.lblContours, swatch: '#b45309' },
    { key: 'slope', label: t.lblSlope, swatch: 'rgba(234,88,12,0.55)' },
    { key: 'osmContext', label: t.lblOsmContext, swatch: '#475569' }
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
            {t.terrainLayersTitle}
          </span>
          <span className="font-mono-num text-[10.5px] font-bold text-[#12231c]">
            {studyAreaKm2.toFixed(1)} km²
          </span>
        </div>

        <div className="divide-y divide-dashed divide-[#12231c]/10">
          {layerItems.map(item => (
            <label key={item.key} className="flex cursor-pointer items-center justify-between gap-2.5 py-1.5">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[#12231c]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-black/15"
                  style={{ background: item.swatch }}
                />
                <span>{item.label}</span>
              </span>
              <input
                type="checkbox"
                checked={layers[item.key]}
                onChange={e => onToggleLayer(item.key, e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-[#0284c7]"
              />
            </label>
          ))}
        </div>

        <div className="mt-2.5 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs font-semibold text-[#3f524a]">
            <span>{t.lblExag}</span>
            <span className="font-mono-num text-[11.5px] font-bold text-[#12231c]">
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
            className="w-full cursor-pointer accent-[#0284c7]"
          />
        </div>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.flowDensityTitle}
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-[9px] border border-[#12231c]/12 bg-[#eff4f1] p-1">
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
                className={`rounded-[7px] py-1.5 text-[11.5px] font-bold transition ${
                  active ? 'bg-white text-[#0369a1] shadow-xs' : 'text-[#3f524a] hover:text-[#12231c]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 mb-0 text-[11.5px] text-[#3f524a]">{t.flowDensityHint}</p>
      </div>

      <div className="rounded-[11px] border border-[#12231c]/12 bg-white p-3 shadow-xs">
        <div className="mb-2 text-[11px] font-extrabold tracking-wider text-[#64776f] uppercase">
          {t.terrainToolsTitle}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onToggleTool('raindrop')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
              activeTool === 'raindrop'
                ? 'border-[#0369a1] bg-[#0284c7] text-white shadow-[0_0_0_3px_rgba(2,132,199,0.22)]'
                : 'border-[#12231c]/15 bg-white text-[#12231c] hover:bg-[#eff4f1]'
            }`}
          >
            <Droplets className="h-3.5 w-3.5" />
            <span>{t.btnRaindrop}</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleTool('profileA')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
              activeTool === 'profileA' || activeTool === 'profileB'
                ? 'border-[#0369a1] bg-[#0284c7] text-white shadow-[0_0_0_3px_rgba(2,132,199,0.22)]'
                : 'border-[#12231c]/15 bg-white text-[#12231c] hover:bg-[#eff4f1]'
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            <span>{t.btnProfile}</span>
          </button>
        </div>

        {raindrop && (
          <div className="mt-2.5 border-t border-dashed border-[#12231c]/15 pt-2.5">
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-xs text-[#12231c]">{t.raindropMetricsTitle}</strong>
              <button
                type="button"
                onClick={onClearRaindrop}
                className="rounded-md border border-[#12231c]/15 bg-[#eff4f1] px-2 py-0.5 text-[11px] font-bold hover:bg-[#e5ede8]"
              >
                {t.clear}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
                <div className="text-[10.5px] font-semibold text-[#64776f]">{t.mStartElev}</div>
                <div className="font-mono-num text-[13px] font-extrabold">{Math.round(raindrop.startElev)} mdpl</div>
              </div>
              <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
                <div className="text-[10.5px] font-semibold text-[#64776f]">{t.mEndElev}</div>
                <div className="font-mono-num text-[13px] font-extrabold">{Math.round(raindrop.endElev)} mdpl</div>
              </div>
              <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
                <div className="text-[10.5px] font-semibold text-[#64776f]">{t.mDrop}</div>
                <div className="font-mono-num text-[13px] font-extrabold">-{Math.round(raindrop.dropM)} m</div>
              </div>
              <div className="rounded-lg border border-[#12231c]/8 bg-[#eff4f1] px-2.5 py-1.5">
                <div className="text-[10.5px] font-semibold text-[#64776f]">{t.mLengthSlope}</div>
                <div className="font-mono-num text-[13px] font-extrabold">
                  {Math.round(raindrop.lengthM)} m · {raindrop.avgSlopePct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
