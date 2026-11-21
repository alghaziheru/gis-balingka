import { useEffect } from 'react';
import { X } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { DatasetMetadata, Language } from '../types/gis';

interface OssLicenseModalProps {
  open: boolean;
  lang: Language;
  metadata: DatasetMetadata | null;
  onClose: () => void;
}

export function OssLicenseModal({ open, lang, metadata, onClose }: OssLicenseModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const t = I18N[lang];
  const isEn = lang === 'en';

  const softwareRows = [
    { name: 'React 19 & React DOM & Vite & Tailwind', role: 'Frontend UI & build toolchain', license: 'MIT' },
    { name: 'MapLibre GL JS & Lucide', role: 'WebGL 2D/3D engine & vector icons', license: 'BSD-3 / ISC' },
    { name: 'geotiff.js + Pure-Node Hydrology', role: 'DEM processing & smooth PNG rendering', license: 'MIT' },
    { name: 'Copernicus DEM GLO-30 & Terrarium', role: 'Real elevation, contours & shaded relief', license: 'Open Data' },
    { name: 'OpenStreetMap & OpenTopoMap', role: 'Roads, waterways, bridges & topo basemap', license: 'ODbL / CC-BY-SA' },
    { name: 'Esri World Imagery (Default Satellite)', role: 'Sub-meter satellite mosaic (replaceable via VITE_CUSTOM_IMAGERY_URL)', license: 'Free w/ Attribution' }
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a1410]/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[86vh] w-full max-w-[580px] overflow-y-auto rounded-[18px] border border-[#12231c]/15 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-base font-extrabold text-[#12231c]">{t.ossTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#3f524a] hover:bg-[#eff4f1]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-[12.5px] text-[#3f524a]">{t.ossIntro}</p>

        {metadata && (
          <div className="mb-3 rounded-xl border border-[#0284c7]/25 bg-[#0284c7]/8 p-3 text-[11.5px] text-[#0c4a6e]">
            <div className="font-bold">
              {isEn ? 'Active Balingka Block Dataset:' : 'Dataset Blok Balingka Aktif:'} {metadata.demSource}
            </div>
            <div className="font-mono-num mt-1 text-[11px]">
              {metadata.studyAreaKm2} km² ({metadata.gridDimensions}) · {metadata.minElevM}–{metadata.maxElevM} mdpl ·{' '}
              {metadata.streamNetworkKm} km {isEn ? 'streams' : 'alur'} · {metadata.crossingsDetected}{' '}
              {isEn ? 'crossings' : 'persilangan'} · {metadata.osmPlaceCount} {isEn ? 'OSM places' : 'lokasi OSM'}
            </div>
          </div>
        )}

        <div className="my-3 flex flex-col gap-2">
          {softwareRows.map(r => (
            <div
              key={r.name}
              className="flex items-start justify-between gap-3 rounded-xl border border-[#12231c]/10 bg-[#eff4f1] px-3 py-2"
            >
              <div>
                <strong className="text-[12.5px] text-[#12231c]">{r.name}</strong>
                <div className="text-[11px] text-[#64776f]">{r.role}</div>
              </div>
              <span className="font-mono-num shrink-0 rounded-md bg-[#059669]/12 px-2 py-0.5 text-[10.5px] font-bold text-[#065f46]">
                {r.license}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-[#059669]/30 bg-[#059669]/10 p-3 text-[11.5px] text-[#064e3b]">
          {t.ossNextNote}
        </div>
      </div>
    </div>
  );
}
