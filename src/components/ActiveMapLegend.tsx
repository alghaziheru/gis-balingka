import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type {
  BasemapId,
  DrainageStatus,
  LandCoverStats,
  Language,
  LayerToggles,
  ScourStats,
  SimMapViewMode,
  TabId,
  ViewMode
} from '../types/gis';
import { InfoTooltip } from './InfoTooltip';
import { LegendIcon } from './LegendIcon';

export interface ActiveMapLegendProps {
  lang: Language;
  viewMode: ViewMode;
  tab: TabId;
  basemap: BasemapId;
  layers: LayerToggles;
  flowDensity: number;
  simProgress: number;
  simMapViewMode?: SimMapViewMode;
  drainFilter: 'all' | DrainageStatus;
  elevRange?: [number, number];
  landCoverStats?: LandCoverStats;
  scourStats?: ScourStats;
}

interface LegendRow {
  key: string;
  node: ReactNode;
}

export function ActiveMapLegend({
  lang,
  viewMode,
  tab,
  basemap,
  layers,
  flowDensity,
  simProgress,
  simMapViewMode = 'depth',
  drainFilter,
  elevRange,
  landCoverStats,
  scourStats
}: ActiveMapLegendProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = I18N[lang];
  const isEn = lang === 'en';
  const isRaining = tab === 'sim' && simProgress > 0.02;

  const modelRows: LegendRow[] = [];
  if (isRaining) {
    if (simMapViewMode === 'confidence') {
      modelRows.push(
        {
          key: 'model-conf-high',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#0369a1]/80" />
              <span>{isEn ? 'High ensemble agreement (≥80%)' : 'Kesepakatan ansambel tinggi (≥80%)'}</span>
            </div>
          )
        },
        {
          key: 'model-conf-mid',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#38bdf8]/55" />
              <span>{isEn ? 'Uncertain margin (20–80%)' : 'Batas ketidakpastian (20–80%)'}</span>
            </div>
          )
        }
      );
    } else if (simMapViewMode === 'scour') {
      modelRows.push(
        {
          key: 'model-scour-severe',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-1.5 w-5 shrink-0 rounded-full bg-[#b91c1c]" />
              <span>{isEn ? 'Extreme stream power (ω ≥ 1000 W/m²)' : 'Energi gerusan ekstrem (ω ≥ 1000 W/m²)'}</span>
            </div>
          )
        },
        {
          key: 'model-scour-mod',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-1.5 w-5 shrink-0 rounded-full bg-[#d97706]" />
              <span>{isEn ? 'High bank-scour energy (ω ≥ 300 W/m²)' : 'Energi gerusan tebing (ω ≥ 300 W/m²)'}</span>
            </div>
          )
        }
      );
    } else if (simMapViewMode === 'survey') {
      modelRows.push(
        {
          key: 'model-surv-low',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-1.5 w-5 shrink-0 rounded-full bg-[#b45309]" />
              <span>{isEn ? 'Low confidence (priority for field survey)' : 'Prioritas survei (belum terukur)'}</span>
            </div>
          )
        },
        {
          key: 'model-surv-med',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-1.5 w-5 shrink-0 rounded-full bg-[#0369a1]" />
              <span>{isEn ? 'Medium (verified alignment, est. width)' : 'Menengah (jalur terverifikasi)'}</span>
            </div>
          )
        },
        {
          key: 'model-surv-high',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-1.5 w-5 shrink-0 rounded-full bg-[#047857]" />
              <span>{isEn ? 'High (field-measured cross-section)' : 'Tinggi (penampang terukur lapangan)'}</span>
            </div>
          )
        }
      );
    } else {
      modelRows.push(
        {
          key: 'model-flow',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span
                className="inline-flex h-3.5 w-6 shrink-0 items-center justify-center rounded-[3px] bg-[#1e293b]"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 12" className="h-3 w-5">
                  <path d="M2 3.5 C8 2.5, 16 4.5, 22 3.5" stroke="#ffffff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                  <path d="M2 6.5 C8 5.5, 16 7.5, 22 6.5" stroke="#e0f2fe" strokeWidth="1.1" fill="none" strokeLinecap="round" />
                  <path d="M2 9.5 C8 8.5, 16 10.5, 22 9.5" stroke="#ffffff" strokeWidth="1.0" fill="none" strokeLinecap="round" />
                </svg>
              </span>
              <span>{isEn ? 'Simulated runoff flow' : 'Aliran limpasan simulasi'}</span>
            </div>
          )
        },
        {
          key: 'model-hand-deep',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#0284c7]/75" />
              <span className="flex min-w-0 items-center gap-1">
                <span>{isEn ? 'River-corridor swelling (deep)' : 'Genangan koridor sungai (utama)'}</span>
                <InfoTooltip
                  text={t.infoLegendDeep}
                  label={isEn ? 'Deep HAND corridor' : 'Genangan koridor sungai utama'}
                />
              </span>
            </div>
          )
        },
        {
          key: 'model-hand-shallow',
          node: (
            <div className="flex items-center gap-2 text-[#161c1a]">
              <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#38bdf8]/55" />
              <span>{isEn ? 'River-corridor swelling (shallow)' : 'Genangan koridor sungai (dangkal)'}</span>
            </div>
          )
        }
      );
    }

    if (simMapViewMode !== 'survey') {
      modelRows.push({
        key: 'model-steep-slope',
        node: (
          <div className="flex items-center gap-2 text-[#161c1a]">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#ea580c]" />
            <span className="flex min-w-0 items-center gap-1">
              <span>{isEn ? 'Steep slope FoS < 1.1 (model)' : 'Lereng curam FoS < 1,1 (model)'}</span>
              <InfoTooltip
                text={t.infoLegendLandslide}
                label={isEn ? 'Saturated steep slope (model)' : 'Lereng curam jenuh air'}
              />
            </span>
          </div>
        )
      });
    }
  }

  const overlayRows: LegendRow[] = [];
  if (basemap === 'elev') {
    const [minE, maxE] = elevRange ?? [1032, 2869];
    const fmt = (n: number) => Math.round(n).toLocaleString(isEn ? 'en-US' : 'id-ID');
    overlayRows.push({
      key: 'surf-elev',
      node: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 font-semibold text-[#161c1a]">
            <span>{t.bmElev}</span>
            <span className="font-mono-num text-[10.5px] font-semibold text-[#636f6a]">
              {fmt(minE)} → {fmt(maxE)} mdpl
            </span>
          </div>
          <span
            className="block h-2 w-full rounded-[3px] border border-black/12"
            style={{ background: 'linear-gradient(90deg,#84b860,#eab308,#92400e)' }}
            aria-hidden="true"
          />
        </div>
      )
    });
  }

  if (basemap === 'slope' || layers.slope) {
    overlayRows.push({
      key: 'surf-slope',
      node: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 font-semibold text-[#161c1a]">
            <span>{t.bmSlope}</span>
            <span className="font-mono-num text-[10.5px] font-semibold text-[#636f6a]">&gt;15%</span>
          </div>
          <span
            className="block h-2 w-full rounded-[3px] border border-black/12"
            style={{ background: 'linear-gradient(90deg,#f59e0b,#c2410c)' }}
            aria-hidden="true"
          />
        </div>
      )
    });
  }

  if (layers.landCover) {
    overlayRows.push({
      key: 'ov-landcover',
      node: (
        <div className="flex flex-col gap-1">
          <div className="font-semibold text-[#161c1a]">{t.lblLandCover}</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-[#434d49]">
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
        </div>
      )
    });
  }

  if (layers.scourChange) {
    overlayRows.push({
      key: 'ov-scour',
      node: (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 font-semibold text-[#161c1a]">
            <span>{isEn ? 'Sentinel-2 Veg. Change' : 'Perubahan Vegetasi Sentinel-2'}</span>
            {scourStats && (
              <span className="font-mono-num shrink-0 text-[10px] font-medium text-[#636f6a]">
                {scourStats.preDate} → {scourStats.postDate}
              </span>
            )}
          </div>
          {scourStats && (
            <div className="font-mono-num text-[10.5px] font-semibold text-[#991b1b]">
              {scourStats.totalScourHa} ha ({scourStats.corridorScourHa} ha {isEn ? 'valley' : 'lembah'})
            </div>
          )}
          <div className="flex flex-col gap-0.5 text-[11px] text-[#434d49]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#991b1b]" />
              <span>{isEn ? 'Strong vegetation decrease' : 'Penurunan vegetasi tinggi'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[#d97706]" />
              <span>{isEn ? 'Moderate vegetation decrease' : 'Penurunan vegetasi sedang'}</span>
            </span>
          </div>
        </div>
      )
    });
  }

  if (layers.agamLandslide) {
    overlayRows.push({
      key: 'ov-agam-ls',
      node: (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 font-semibold text-[#161c1a]">
            <span>{isEn ? 'Ground Movement' : 'Peta Gerakan Tanah'}</span>
            <span className="text-[10px] font-medium text-[#636f6a]">Pemkab Agam / BPBD</span>
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-[#434d49]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#dc2626]" />
              <span>{isEn ? 'High' : 'Tinggi'}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#d97706]" />
              <span>{isEn ? 'Medium' : 'Sedang'}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#65a30d]" />
              <span>{isEn ? 'Low' : 'Rendah'}</span>
            </span>
          </div>
        </div>
      )
    });
  }

  if (layers.agamForestStatus) {
    overlayRows.push({
      key: 'ov-agam-forest',
      node: (
        <div className="flex flex-col gap-1">
          <div className="font-semibold text-[#161c1a]">
            {isEn ? 'Forest Status (SK 35)' : 'Kawasan Hutan (SK 35)'}
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-[#434d49]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#22c55e]" />
              <span>{isEn ? 'Protected (HL)' : 'Hutan Lindung (HL)'}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#14b8a6]" />
              <span>KSA/KPA</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] border border-[#161c1a]/20 bg-[#cbd5e1]" />
              <span>APL</span>
            </span>
          </div>
        </div>
      )
    });
  }

  if (layers.agamSoilGeology) {
    overlayRows.push({
      key: 'ov-agam-soil',
      node: (
        <div className="flex flex-col gap-1">
          <div className="font-semibold text-[#161c1a]">
            {isEn ? 'Soil Type (Agam)' : 'Jenis Tanah (Agam)'}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#434d49]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#f59e0b]" />
              <span>Andosol</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[#94a3b8]" />
              <span>{isEn ? 'Kambisol / Other' : 'Kambisol / Lainnya'}</span>
            </span>
          </div>
        </div>
      )
    });
  }

  if (layers.hillshade) {
    overlayRows.push({
      key: 'ov-hillshade',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="hillshade" />
          <span>{t.lblHillshade}</span>
        </div>
      )
    });
  }

  const mapRows: LegendRow[] = [];
  if (layers.verifiedWaterways) {
    mapRows.push({
      key: 'map-ww',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="waterway" />
          <span>{t.lblVerifiedWaterways}</span>
        </div>
      )
    });
  }
  if (layers.agamRbiRivers) {
    mapRows.push({
      key: 'map-rbi',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="agamRbi" />
          <span>{t.lblAgamRbiRivers}</span>
        </div>
      )
    });
  }
  if (tab !== 'sim' && flowDensity > 0) {
    mapRows.push({
      key: 'map-flow',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="flow" />
          <span>{viewMode === 'detail' ? t.lblFlowDetail : t.lblFlowSimple}</span>
        </div>
      )
    });
  }

  const showStructures = tab === 'drainage' || tab === 'editor' || layers.structures;
  if (showStructures) {
    mapRows.push({
      key: 'map-structures',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="bridge" size={16} />
          <span>{t.lblStructures}</span>
        </div>
      )
    });
  }

  const showDraftCrossings =
    tab === 'drainage' || (!isRaining && layers.unverifiedCrossings);
  if (showDraftCrossings) {
    mapRows.push({
      key: 'map-crossings',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="crossing" size={16} />
          <span>{t.lblUnverifiedCrossings}</span>
        </div>
      )
    });
  }

  if (tab === 'drainage') {
    const statuses: { id: DrainageStatus; label: string; color: string }[] = [
      { id: 'unverified', label: t.fUnverified, color: '#64748b' },
      { id: 'normal', label: t.fNormal, color: '#047857' },
      { id: 'clogged', label: t.fClogged, color: '#b45309' },
      { id: 'damaged', label: t.fDamaged, color: '#c2410c' },
      { id: 'critical', label: t.fCritical, color: '#b91c1c' }
    ];
    mapRows.push({
      key: 'map-drain-status',
      node: (
        <div className="flex flex-wrap gap-x-2.5 gap-y-1 rounded-md bg-[#f2f3ef] px-2 py-1.5 text-[11px]">
          {statuses.map(st => {
            const dimmed = drainFilter !== 'all' && drainFilter !== st.id;
            const highlighted = drainFilter === st.id;
            return (
              <span
                key={st.id}
                className={`inline-flex items-center gap-1 transition-opacity ${
                  dimmed ? 'opacity-35' : highlighted ? 'font-bold text-[#161c1a]' : 'text-[#434d49]'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/80"
                  style={{ background: st.color }}
                />
                <span>{st.label}</span>
              </span>
            );
          })}
        </div>
      )
    });
  }

  if (tab === 'drainage' && layers.evac) {
    mapRows.push({
      key: 'map-evac',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="evacuation" size={16} />
          <span>{t.lblEvac}</span>
        </div>
      )
    });
  }

  if (tab === 'drainage' && layers.landslide) {
    mapRows.push({
      key: 'map-landslide',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="landslide" size={16} />
          <span>{t.lblLandslide}</span>
        </div>
      )
    });
  }

  if (isRaining && layers.settlements) {
    mapRows.push({
      key: 'map-sim-buildings',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <span
            className="h-3 w-3 shrink-0 rounded-[2px] border-[1.5px] border-[#f59e0b] bg-transparent"
            aria-hidden="true"
          />
          <span>{isEn ? 'Buildings in modeled corridor' : 'Bangunan di zona koridor model'}</span>
        </div>
      )
    });
  }

  if (layers.settlements && !isRaining) {
    mapRows.push({
      key: 'map-settlements',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="settlements" size={16} />
          <span>{t.lblSettlements}</span>
        </div>
      )
    });
  }

  if (layers.contours) {
    mapRows.push({
      key: 'map-contours',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="contour" />
          <span>{t.lblContours}</span>
        </div>
      )
    });
  }

  if (layers.osmContext) {
    mapRows.push({
      key: 'map-osm',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="osm" />
          <span>{t.lblOsmContext}</span>
        </div>
      )
    });
  }

  if (layers.das) {
    mapRows.push({
      key: 'map-das',
      node: (
        <div className="flex items-center gap-2 text-[#161c1a]">
          <LegendIcon kind="das" />
          <span>{t.lblDas}</span>
        </div>
      )
    });
  }

  const activeCount = modelRows.length + overlayRows.length + mapRows.length;
  if (activeCount === 0) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="active-map-legend-toggle"
        aria-expanded={false}
        aria-label={t.legendExpand}
        title={t.legendExpand}
        onClick={() => setCollapsed(false)}
        className="surface-panel pointer-events-auto relative z-10 inline-flex min-h-[34px] items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[12px] font-bold text-[#161c1a] transition hover:bg-white max-md:hidden"
      >
        <Layers className="h-3.5 w-3.5 shrink-0 text-[#0369a1]" />
        <span>{t.legendToggle}</span>
        <span className="font-mono-num rounded bg-[#f2f3ef] px-1.5 py-0.5 text-[10.5px] font-bold text-[#434d49]">
          {activeCount}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-[#636f6a]" />
      </button>
    );
  }

  const sections: { id: string; title: string; rows: LegendRow[] }[] = [
    { id: 'model', title: t.legendSecModel, rows: modelRows },
    { id: 'overlays', title: t.legendSecOverlays, rows: overlayRows },
    { id: 'map', title: t.legendSecMap, rows: mapRows }
  ].filter(sec => sec.rows.length > 0);

  return (
    <section
      data-testid="active-map-legend"
      aria-label={t.legendActiveTitle}
      className="surface-panel pointer-events-auto relative z-10 w-[292px] overflow-hidden rounded-xl max-md:hidden"
    >
      <button
        type="button"
        data-testid="active-map-legend-toggle"
        aria-expanded={true}
        aria-label={t.legendCollapse}
        title={t.legendCollapse}
        onClick={() => setCollapsed(true)}
        className="flex w-full items-center justify-between gap-2 border-b border-[#161c1a]/10 bg-white px-3 py-2 text-left transition hover:bg-[#f2f3ef]"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-[#161c1a]">
          <Layers className="h-3.5 w-3.5 shrink-0 text-[#0369a1]" />
          <span className="truncate">{t.legendActiveTitle}</span>
          <span className="font-mono-num shrink-0 rounded bg-[#f2f3ef] px-1.5 py-0.5 text-[10.5px] font-bold text-[#434d49]">
            {activeCount}
          </span>
        </span>
        <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[#636f6a]" />
      </button>

      <div className="sidebar-scroll max-h-[calc(100vh-320px)] overflow-y-auto px-3 py-2.5 text-[11.5px] leading-snug">
        {sections.map((sec, idx) => (
          <div
            key={sec.id}
            className={idx > 0 ? 'mt-2.5 border-t border-[#161c1a]/10 pt-2.5' : ''}
          >
            <div className="mb-1.5 text-[10.5px] font-bold tracking-wide text-[#636f6a] uppercase">
              {sec.title}
            </div>
            <div className="flex flex-col gap-1.5">
              {sec.rows.map(row => (
                <div key={row.key}>{row.node}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
