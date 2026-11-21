import { ShieldCheck } from 'lucide-react';
import { I18N } from '../i18n/translations';
import type { BasemapId, Language } from '../types/gis';

interface TopHudProps {
  lang: Language;
  is3D: boolean;
  basemap: BasemapId;
  cameraPreset: string;
  onToggle3D: (val: boolean) => void;
  onChangeBasemap: (bm: BasemapId) => void;
  onChangeCameraPreset: (preset: string) => void;
  onChangeLang: (lang: Language) => void;
  onOpenOss: () => void;
}

export function TopHud({
  lang,
  is3D,
  basemap,
  cameraPreset,
  onToggle3D,
  onChangeBasemap,
  onChangeCameraPreset,
  onChangeLang,
  onOpenOss
}: TopHudProps) {
  const t = I18N[lang];

  const surfaceModes: [BasemapId, string][] = [
    ['sat', t.bmSat],
    ['elev', t.bmElev],
    ['relief', t.bmRelief],
    ['slope', t.bmSlope],
    ['topo', t.bmTopo],
    ['osm', t.bmOsm]
  ];

  return (
    <div className="pointer-events-auto absolute top-3 right-3 z-18 flex max-w-[calc(100vw-416px)] flex-wrap items-center justify-end gap-1.5 max-md:top-2 max-md:right-2 max-md:left-2 max-md:max-w-none max-md:justify-between">
      <div className="glass inline-flex items-center gap-0.5 rounded-[11px] p-[3px]">
        <button
          type="button"
          onClick={() => onToggle3D(false)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition max-md:px-2 max-md:py-1 max-md:text-[11px] ${
            !is3D ? 'bg-[#12231c] text-white' : 'text-[#3f524a] hover:bg-[#12231c]/5 hover:text-[#12231c]'
          }`}
        >
          2D
        </button>
        <button
          type="button"
          onClick={() => onToggle3D(true)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition max-md:px-2 max-md:py-1 max-md:text-[11px] ${
            is3D ? 'bg-[#12231c] text-white' : 'text-[#3f524a] hover:bg-[#12231c]/5 hover:text-[#12231c]'
          }`}
        >
          3D
        </button>
      </div>

      {/* CutSheetRX Surface & Basemap Switcher */}
      <div className="glass no-scrollbar inline-flex items-center gap-0.5 overflow-x-auto rounded-[11px] p-[3px] max-md:max-w-[205px]">
        {surfaceModes.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChangeBasemap(id)}
            className={`shrink-0 rounded-lg px-2 py-1.5 text-xs font-bold transition max-md:px-1.5 max-md:py-1 max-md:text-[11px] ${
              basemap === id
                ? 'bg-[#12231c] text-white'
                : 'text-[#3f524a] hover:bg-[#12231c]/5 hover:text-[#12231c]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="glass inline-flex items-center rounded-[11px] p-[3px]">
        <select
          aria-label="Camera Presets"
          value={cameraPreset}
          onChange={e => onChangeCameraPreset(e.target.value)}
          className="cursor-pointer bg-transparent px-2 py-1 text-xs font-bold text-[#12231c] outline-none max-md:max-w-[110px] max-md:px-1 max-md:text-[11px]"
        >
          <option value="center">{t.camCenter}</option>
          <option value="hulu">{t.camHulu}</option>
          <option value="pahambatan">{t.camPahambatan}</option>
          <option value="hilalang">{t.camHilalang}</option>
          <option value="subarang">{t.camSubarang}</option>
          <option value="block">{t.camBlock}</option>
        </select>
      </div>

      <div className="glass inline-flex items-center gap-0.5 rounded-[11px] p-[3px]">
        <button
          type="button"
          onClick={() => onChangeLang('id')}
          className={`rounded-lg px-2 py-1.5 text-xs font-bold transition max-md:px-1.5 max-md:py-1 max-md:text-[11px] ${
            lang === 'id' ? 'bg-[#12231c] text-white' : 'text-[#3f524a] hover:bg-[#12231c]/5'
          }`}
        >
          ID
        </button>
        <button
          type="button"
          onClick={() => onChangeLang('en')}
          className={`rounded-lg px-2 py-1.5 text-xs font-bold transition max-md:px-1.5 max-md:py-1 max-md:text-[11px] ${
            lang === 'en' ? 'bg-[#12231c] text-white' : 'text-[#3f524a] hover:bg-[#12231c]/5'
          }`}
        >
          EN
        </button>
      </div>

      <div className="glass inline-flex items-center rounded-[11px] p-[3px]">
        <button
          type="button"
          onClick={onOpenOss}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#3f524a] transition hover:bg-[#12231c]/5 hover:text-[#12231c] max-md:px-2 max-md:py-1 max-md:text-[11px]"
          title={t.ossTitle}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>OSS</span>
        </button>
      </div>
    </div>
  );
}
