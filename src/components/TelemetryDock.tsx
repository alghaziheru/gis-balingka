import { useEffect, useRef, useState } from 'react';
import { Info, Layers, Minus, Plus, X } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { BasemapId, Language, LayerToggles, TabId, ViewMode } from '../types/gis';
import { LegendIcon, type LegendIconKind } from './LegendIcon';
import type { MapCameraState } from './MapView';

function computeMetricScale(metersPerPixel: number, maxWidthPx = 76): { widthPx: number; label: string } {
  const safeMpp = Number.isFinite(metersPerPixel) && metersPerPixel > 0.01 ? metersPerPixel : 10;
  const rawMeters = safeMpp * maxWidthPx;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawMeters)));
  const d = rawMeters / pow10;
  const nice = d >= 5 ? 5 * pow10 : d >= 2 ? 2 * pow10 : pow10;
  const widthPx = Math.max(28, Math.min(maxWidthPx, Math.round(nice / safeMpp)));
  const label = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
  return { widthPx, label };
}

function getBasemapAttribution(basemap: BasemapId, isEn: boolean): string {
  if (basemap === 'sat') {
    return import.meta.env.VITE_CUSTOM_IMAGERY_URL
      ? isEn
        ? 'Custom Satellite / Drone Imagery'
        : 'Citra Satelit / Drone Kustom'
      : 'Esri, Maxar, Earthstar Geographics';
  }
  if (basemap === 'osm') return '© OpenStreetMap contributors (ODbL)';
  if (basemap === 'topo') return 'OpenTopoMap (CC-BY-SA) · © OSM contributors';
  return 'BIG DEMNAS (~8.3m) · AWS Terrarium DEM';
}

function CompassNeedle({ bearing, pitch }: { bearing: number; pitch: number }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="block transition-transform duration-150"
      style={{ transform: `rotateX(${Math.min(55, Math.max(0, pitch))}deg) rotateZ(${-bearing}deg)` }}
    >
      <polygon points="9,2.2 12,9 9,8.1 6,9" fill="#b91c1c" />
      <polygon points="9,15.8 12,9 9,9.9 6,9" fill="#636f6a" />
      <circle cx="9" cy="9" r="1.2" fill="#fafaf8" stroke="#161c1a" strokeWidth="0.9" />
    </svg>
  );
}

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
  mapCamera: MapCameraState;
  onToggleLayer: (key: keyof LayerToggles, val: boolean) => void;
  onChangeFlowDensity: (density: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  onOpenSources: () => void;
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
  mapCamera,
  onToggleLayer,
  onChangeFlowDensity,
  onZoomIn,
  onZoomOut,
  onResetNorth,
  onOpenSources
}: TelemetryDockProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [attribOpen, setAttribOpen] = useState(false);
  const attribRef = useRef<HTMLDivElement | null>(null);
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isDetail = viewMode === 'detail';
  const scale = computeMetricScale(mapCamera.metersPerPixel);
  const basemapCredit = getBasemapAttribution(basemap, isEn);

  useEffect(() => {
    if (!attribOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (attribRef.current && !attribRef.current.contains(e.target as Node)) {
        setAttribOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAttribOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [attribOpen]);

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
  }

  return (
    <>
      {/* Desktop: unified bottom-right nav pill (+/-/Compass) + status bar (scale | telemetry | (i)) */}
      <div className="pointer-events-none absolute right-3 bottom-3 z-16 flex flex-col items-end gap-1.5 max-md:hidden">
        <div
          data-testid="map-nav-controls"
          className="surface-panel pointer-events-auto flex flex-col divide-y divide-[#161c1a]/10 overflow-hidden rounded-[10px]"
        >
          <button
            type="button"
            data-testid="map-zoom-in"
            onClick={onZoomIn}
            aria-label={t.zoomIn}
            title={t.zoomIn}
            className="grid h-[34px] w-[34px] place-items-center text-[#161c1a] transition hover:bg-[#f2f3ef] active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="map-zoom-out"
            onClick={onZoomOut}
            aria-label={t.zoomOut}
            title={t.zoomOut}
            className="grid h-[34px] w-[34px] place-items-center text-[#161c1a] transition hover:bg-[#f2f3ef] active:scale-[0.97]"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="map-compass"
            onClick={onResetNorth}
            aria-label={t.resetNorth}
            title={t.resetNorth}
            className="grid h-[34px] w-[34px] place-items-center text-[#161c1a] transition hover:bg-[#f2f3ef] active:scale-[0.97]"
          >
            <CompassNeedle bearing={mapCamera.bearing} pitch={mapCamera.pitch} />
          </button>
        </div>

        <div
          ref={attribRef}
          data-testid="telemetry-pill"
          className="surface-panel font-mono-num pointer-events-auto relative flex min-h-[34px] items-center gap-2 rounded-[10px] px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap text-[#161c1a]"
        >
          <div data-testid="map-scale-bar" className="flex flex-col items-center justify-center" title={scale.label}>
            <span className="text-[10px] leading-none font-semibold text-[#434d49]">{scale.label}</span>
            <span
              className="mt-1 block h-[4px] border-x border-b border-[#161c1a]/55"
              style={{ width: `${scale.widthPx}px` }}
            />
          </div>

          <span className="h-3.5 w-px shrink-0 bg-[#161c1a]/12" aria-hidden="true" />

          {isDetail ? (
            <span>
              {cursorTelemetry.lat.toFixed(4)}, {cursorTelemetry.lng.toFixed(4)} · {Math.round(cursorTelemetry.elev)} mdpl ·{' '}
              {t.slopeWord} {cursorTelemetry.slope}%
            </span>
          ) : (
            <span>{Math.round(cursorTelemetry.elev)} mdpl</span>
          )}

          <span className="h-3.5 w-px shrink-0 bg-[#161c1a]/12" aria-hidden="true" />

          <button
            type="button"
            data-testid="map-attrib-btn"
            onClick={() => setAttribOpen(o => !o)}
            aria-label={t.btnAttribution}
            aria-expanded={attribOpen}
            title={t.btnAttribution}
            className={`grid h-[24px] w-[24px] shrink-0 place-items-center rounded-md transition ${
              attribOpen ? 'bg-[#161c1a] text-white' : 'text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]'
            }`}
          >
            <Info className="h-3.5 w-3.5" />
          </button>

          {attribOpen && (
            <div
              data-testid="map-attrib-popover"
              className="surface-panel font-sans absolute right-0 bottom-[calc(100%+8px)] z-30 w-[272px] rounded-xl p-3 text-left whitespace-normal"
            >
              <div className="mb-1 text-[11px] font-bold tracking-wide text-[#636f6a] uppercase">
                {t.btnAttribution}
              </div>
              <div className="text-[12px] font-bold text-[#161c1a]">{basemapCredit}</div>
              <div className="mt-1 text-[11.5px] leading-snug text-[#434d49]">
                BIG DEMNAS &amp; RBI 50K · Batas Nagari BIG (2026) · ESA WorldCover · Pemkab Agam · MapLibre GL
              </div>
              <div className="my-2 border-t border-[#161c1a]/10" />
              <button
                type="button"
                data-testid="map-attrib-open-sources"
                onClick={() => {
                  setAttribOpen(false);
                  onOpenSources();
                }}
                className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-bold text-[#0369a1] transition hover:bg-[#f2f3ef]"
              >
                {t.openSourcesBtn}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: optional floating compass (only when rotated) + interactive Legend popover */}
      {mobileSheetMode !== 'full' && (
        <div
          className={`pointer-events-none fixed right-2.5 z-19 hidden max-md:flex max-md:flex-col max-md:items-end max-md:gap-2 ${
            mobileSheetMode === 'peek' ? 'bottom-[140px]' : 'bottom-[calc(52vh+12px)]'
          }`}
        >
          {Math.abs(mapCamera.bearing) > 2 && (
            <button
              type="button"
              data-testid="mobile-compass-btn"
              onClick={onResetNorth}
              aria-label={t.resetNorth}
              title={t.resetNorth}
              className="surface-panel pointer-events-auto grid h-10 w-10 place-items-center rounded-full shadow-md transition active:scale-[0.96]"
            >
              <CompassNeedle bearing={mapCamera.bearing} pitch={0} />
            </button>
          )}
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
                    <span>{isEn ? 'Modeled flow direction (DEM)' : 'Arah aliran model (DEM)'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#161c1a]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#0369a1]" />
                    <span>{isEn ? 'Deep basin (>1.5m HAND)' : 'Cekungan utama (>1,5m HAND)'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#161c1a]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#7dd3fc]" />
                    <span>{isEn ? 'Shallow basin (HAND)' : 'Cekungan dangkal (HAND)'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#161c1a]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#ea580c]" />
                    <span>{isEn ? 'Saturated steep slope (model)' : 'Lereng curam jenuh (model)'}</span>
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
