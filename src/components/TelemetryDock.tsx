import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { BasemapId, Language, LayerToggles, TabId } from '../types/gis';

interface TelemetryDockProps {
  lang: Language;
  tab: TabId;
  basemap: BasemapId;
  layers: LayerToggles;
  cursorTelemetry: {
    lng: number;
    lat: number;
    elev: number;
    slope: number;
  };
}

export function TelemetryDock({ lang, tab, basemap, layers, cursorTelemetry }: TelemetryDockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = I18N[lang];
  const isEn = lang === 'en';

  const legendItems: { color: string; text: string }[] = [];
  if (tab === 'terrain') {
    if (layers.verifiedWaterways) {
      legendItems.push({ color: '#0369a1', text: isEn ? 'Verified waterways & drains' : 'Sungai & drainase terverifikasi' });
    }
    legendItems.push({ color: '#38bdf8', text: isEn ? 'DEM runoff estimate (dashed)' : 'Estimasi alur DEM (putus-putus)' });
    if (basemap === 'elev') {
      legendItems.push({ color: '#84b860', text: isEn ? 'Valley → Highland elevation' : 'Elevasi lembah → lereng tinggi' });
    }
    if (basemap === 'slope' || layers.slope) {
      legendItems.push({ color: '#ea580c', text: isEn ? 'Smooth slope heatmap (>15%)' : 'Kemiringan lereng halus (>15%)' });
    }
    if (layers.contours) legendItems.push({ color: '#b45309', text: isEn ? '25m smooth contours' : 'Garis kontur halus 25m' });
    if (layers.das) legendItems.push({ color: '#1b382d', text: isEn ? 'Balingka block border' : 'Bingkai blok Balingka' });
    if (layers.osmContext) legendItems.push({ color: '#475569', text: isEn ? 'OSM roads & rivers' : 'Jalan & sungai OSM' });
  } else if (tab === 'sim') {
    legendItems.push({ color: '#dc2626', text: isEn ? 'Very low HAND (≤2.2m)' : 'Zona sangat rendah (HAND ≤2.2m)' });
    legendItems.push({ color: '#0284c7', text: isEn ? 'Moderate HAND (≤4.8m)' : 'Zona sedang (HAND ≤4.8m)' });
    legendItems.push({ color: '#38bdf8', text: isEn ? 'Outer spread (≤8.0m)' : 'Zona perluasan (HAND ≤8.0m)' });
    legendItems.push({ color: '#059669', text: isEn ? 'Cleared / evacuation' : 'Drainase normal / evakuasi' });
  } else {
    legendItems.push({ color: '#059669', text: isEn ? 'Normal / Evacuation' : 'Normal / Evakuasi' });
    legendItems.push({ color: '#d97706', text: isEn ? 'Clogged crossing' : 'Perlintasan tersumbat' });
    legendItems.push({ color: '#ea580c', text: isEn ? 'Bridge / Steep point' : 'Jembatan / Lereng terjal' });
    legendItems.push({ color: '#dc2626', text: isEn ? 'Critical main crossing' : 'Titik kritis alur utama' });
    legendItems.push({ color: '#0284c7', text: isEn ? 'Candidate check dam' : 'Kandidat cekdam / bronjong' });
  }

  return (
    <div className="pointer-events-none absolute right-3 bottom-9 z-16 flex flex-col items-end gap-1.5 max-md:top-[92px] max-md:right-2 max-md:bottom-auto">
      <div className="glass pointer-events-auto w-[232px] rounded-xl px-3 py-2 text-[11.5px] max-md:hidden">
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="flex w-full items-center justify-between text-[11px] font-extrabold tracking-wider text-[#3f524a] uppercase"
        >
          <span>{t.legendTitle}</span>
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {!collapsed && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {legendItems.map(item => (
              <div key={item.text} className="flex items-center gap-2 text-[#12231c]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-black/15"
                  style={{ background: item.color }}
                />
                <span className="leading-tight">{item.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        data-testid="telemetry-pill"
        className="glass font-mono-num pointer-events-auto flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap text-[#12231c] max-md:gap-1.5 max-md:px-2 max-md:py-1 max-md:text-[10.5px]"
      >
        <span className="max-md:hidden">
          {cursorTelemetry.lat.toFixed(4)}, {cursorTelemetry.lng.toFixed(4)}
        </span>
        <span className="max-md:hidden">·</span>
        <span>{Math.round(cursorTelemetry.elev)} mdpl</span>
        <span>·</span>
        <span>
          {t.slopeWord} {cursorTelemetry.slope}%
        </span>
      </div>
    </div>
  );
}
