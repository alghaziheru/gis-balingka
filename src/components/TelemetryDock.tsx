import { useState } from 'react';
import { Layers, X } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { BasemapId, Language, LayerToggles, TabId, ViewMode } from '../types/gis';
import { LegendIcon, type LegendIconKind } from './LegendIcon';

interface TelemetryDockProps {
  lang: Language;
  viewMode: ViewMode;
  tab: TabId;
  basemap: BasemapId;
  layers: LayerToggles;
  flowDensity: number;
  mobileSheetMode: 'peek' | 'half' | 'full';
  cursorTelemetry: {
    lng: number;
    lat: number;
    elev: number;
    slope: number;
  };
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onChangeFlowDensity: (density: number) => void;
}

export function TelemetryDock({
  lang,
  viewMode,
  tab,
  basemap,
  layers,
  flowDensity,
  mobileSheetMode,
  cursorTelemetry,
  onToggleLayer,
  onChangeFlowDensity
}: TelemetryDockProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';

  const mobileToggleItems: {
    id: string;
    label: string;
    icon: LegendIconKind;
    checked: boolean;
    onChange: (val: boolean) => void;
  }[] = [];

  if (tab === 'terrain' || tab === 'editor') {
    mobileToggleItems.push({
      id: 'ww',
      label: t.lblVerifiedWaterways,
      icon: 'waterway',
      checked: layers.verifiedWaterways,
      onChange: v => onToggleLayer('verifiedWaterways', v)
    });
    mobileToggleItems.push({
      id: 'st',
      label: t.lblStructures,
      icon: 'bridge',
      checked: layers.structures,
      onChange: v => onToggleLayer('structures', v)
    });
    mobileToggleItems.push({
      id: 'set',
      label: t.lblSettlements,
      icon: 'settlements',
      checked: layers.settlements,
      onChange: v => onToggleLayer('settlements', v)
    });
    mobileToggleItems.push({
      id: 'lc',
      label: t.lblLandCover,
      icon: 'landCover',
      checked: layers.landCover,
      onChange: v => onToggleLayer('landCover', v)
    });
    mobileToggleItems.push({
      id: 'scour',
      label: t.lblScourChange,
      icon: 'scourChange',
      checked: layers.scourChange,
      onChange: v => onToggleLayer('scourChange', v)
    });
    mobileToggleItems.push({
      id: 'agamLs',
      label: t.lblAgamLandslide,
      icon: 'agamLandslide',
      checked: layers.agamLandslide,
      onChange: v => onToggleLayer('agamLandslide', v)
    });
    mobileToggleItems.push({
      id: 'flow',
      label: t.lblFlowSimple,
      icon: 'flow',
      checked: flowDensity > 0,
      onChange: v => onChangeFlowDensity(v ? 1 : 0)
    });
    mobileToggleItems.push({
      id: 'das',
      label: t.lblDas,
      icon: 'das',
      checked: layers.das,
      onChange: v => onToggleLayer('das', v)
    });
    if (isDetail) {
      mobileToggleItems.push({
        id: 'agamRbi',
        label: t.lblAgamRbiRivers,
        icon: 'agamRbi',
        checked: layers.agamRbiRivers,
        onChange: v => onToggleLayer('agamRbiRivers', v)
      });
      mobileToggleItems.push({
        id: 'agamForest',
        label: t.lblAgamForest,
        icon: 'agamForest',
        checked: layers.agamForestStatus,
        onChange: v => onToggleLayer('agamForestStatus', v)
      });
      mobileToggleItems.push({
        id: 'agamSoil',
        label: t.lblAgamSoil,
        icon: 'agamSoil',
        checked: layers.agamSoilGeology,
        onChange: v => onToggleLayer('agamSoilGeology', v)
      });
      mobileToggleItems.push({
        id: 'contours',
        label: t.lblContours,
        icon: 'contour',
        checked: layers.contours,
        onChange: v => onToggleLayer('contours', v)
      });
      mobileToggleItems.push({
        id: 'slope',
        label: t.lblSlope,
        icon: 'slope',
        checked: layers.slope,
        onChange: v => onToggleLayer('slope', v)
      });
      mobileToggleItems.push({
        id: 'osm',
        label: t.lblOsmContext,
        icon: 'osm',
        checked: layers.osmContext,
        onChange: v => onToggleLayer('osmContext', v)
      });
    }
  } else if (tab === 'sim') {
    mobileToggleItems.push({
      id: 'set',
      label: t.lblSettlements,
      icon: 'settlements',
      checked: layers.settlements,
      onChange: v => onToggleLayer('settlements', v)
    });
    mobileToggleItems.push({
      id: 'evac',
      label: t.lblEvac,
      icon: 'evacuation',
      checked: layers.evac,
      onChange: v => onToggleLayer('evac', v)
    });
    if (isDetail) {
      mobileToggleItems.push({
        id: 'bronjong',
        label: t.lblBronjong,
        icon: 'bronjong',
        checked: layers.bronjong,
        onChange: v => onToggleLayer('bronjong', v)
      });
    }
  } else {
    mobileToggleItems.push({
      id: 'evac',
      label: t.lblEvac,
      icon: 'evacuation',
      checked: layers.evac,
      onChange: v => onToggleLayer('evac', v)
    });
    mobileToggleItems.push({
      id: 'landslide',
      label: t.lblLandslide,
      icon: 'landslide',
      checked: layers.landslide,
      onChange: v => onToggleLayer('landslide', v)
    });
    if (isDetail) {
      mobileToggleItems.push({
        id: 'bronjong',
        label: t.lblBronjong,
        icon: 'bronjong',
        checked: layers.bronjong,
        onChange: v => onToggleLayer('bronjong', v)
      });
    }
  }

  return (
    <>
      {/* Desktop: clean single elevation/telemetry pill only (no duplicate Legend box) */}
      <div className="pointer-events-none absolute right-3 bottom-9 z-16 flex flex-col items-end max-md:hidden">
        <div
          data-testid="telemetry-pill"
          className="surface-panel font-mono-num pointer-events-auto flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-[#161c1a]"
        >
          {isDetail ? (
            <>
              <span>
                {cursorTelemetry.lat.toFixed(4)}, {cursorTelemetry.lng.toFixed(4)}
              </span>
              <span className="text-[#636f6a]">·</span>
              <span>{Math.round(cursorTelemetry.elev)} mdpl</span>
              <span className="text-[#636f6a]">·</span>
              <span>
                {t.slopeWord} {cursorTelemetry.slope}%
              </span>
            </>
          ) : (
            <span>
              {isEn ? 'Elevation' : 'Ketinggian'}: {Math.round(cursorTelemetry.elev)} m dpl
            </span>
          )}
        </div>
      </div>

      {/* Mobile: interactive Legend + Layer Checklist popover */}
      {mobileSheetMode !== 'full' && (
        <div
          className={`pointer-events-none fixed right-2.5 z-19 hidden max-md:flex max-md:flex-col max-md:items-end max-md:gap-2 ${
            mobileSheetMode === 'peek' ? 'bottom-[140px]' : 'bottom-[calc(52vh+12px)]'
          }`}
        >
          {mobileOpen && (
            <div className="surface-panel pointer-events-auto w-[264px] rounded-xl p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between border-b border-[#161c1a]/10 pb-1.5">
                <span className="text-[13px] font-bold text-[#161c1a]">{t.terrainLayersTitle}</span>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={t.close}
                  className="grid h-7 w-7 place-items-center rounded-md text-[#434d49] hover:bg-[#f2f3ef]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {tab === 'sim' && (
                <div className="mb-2 flex flex-col gap-1 border-b border-[#161c1a]/10 pb-2 text-[12px]">
                  <div className="flex items-center gap-2 text-[#161c1a]">
                    <LegendIcon kind="flow" size={16} />
                    <span>{isEn ? 'Rain runoff wave (DEM)' : 'Gelombang air limpasan'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#161c1a]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#0369a1]" />
                    <span>{isEn ? 'Deep valley surge (>1.5m)' : 'Luapan koridor utama (>1,5m)'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#161c1a]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#7dd3fc]" />
                    <span>{isEn ? 'Shallow low-ground overflow' : 'Genangan koridor rendah'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#161c1a]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#ea580c]" />
                    <span>{isEn ? 'Saturated steep slope (landslide)' : 'Lereng jenuh rawan longsor'}</span>
                  </div>
                </div>
              )}

              {tab === 'drainage' && (
                <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 border-b border-[#161c1a]/10 pb-2 text-[11.5px] text-[#434d49]">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full border border-[#475569] bg-[#e2e8f0]" /> {t.fUnverified}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#b91c1c]" /> {t.fCritical}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#c2410c]" /> {t.fDamaged}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#b45309]" /> {t.fClogged}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#047857]" /> {t.fNormal}
                  </span>
                </div>
              )}

              {(basemap === 'elev' || basemap === 'slope') && tab === 'terrain' && (
                <div className="mb-2 flex items-center gap-2 rounded-md bg-[#fafaf8] px-2 py-1.5 text-[11.5px] text-[#434d49]">
                  <span
                    className="h-2.5 w-3.5 shrink-0 rounded-[2px]"
                    style={{
                      background:
                        basemap === 'elev'
                          ? 'linear-gradient(90deg,#84b860,#eab308,#92400e)'
                          : 'linear-gradient(90deg,#f59e0b,#c2410c)'
                    }}
                  />
                  <span>{basemap === 'elev' ? t.bmElev : t.bmSlope}</span>
                </div>
              )}

              <div className="flex flex-col divide-y divide-[#161c1a]/8">
                {mobileToggleItems.map(item => (
                  <label
                    key={item.id}
                    className="flex min-h-[36px] cursor-pointer items-center justify-between gap-2 py-1 text-[12.5px] text-[#161c1a]"
                  >
                    <span className="flex items-center gap-2">
                      <LegendIcon kind={item.icon} size={16} />
                      <span className="leading-snug">{item.label}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={e => item.onChange(e.target.checked)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-[#0369a1]"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen(v => !v)}
            className="surface-panel pointer-events-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold text-[#161c1a] shadow-md"
          >
            <Layers className="h-3.5 w-3.5 text-[#0369a1]" />
            <span>{t.legendToggle}</span>
          </button>
        </div>
      )}
    </>
  );
}
