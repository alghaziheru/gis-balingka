import { useEffect, useState } from 'react';
import { BookOpen, Database, Droplets, ShieldAlert, X } from 'lucide-react';
import { useActiveRegion } from '../context/RegionContext';
import { CLIMATE_BASELINE, type ClimateBaselineData } from '../data/climateBaseline';
import type { Language } from '../types/gis';

interface SimulationDisclaimerModalProps {
  open: boolean;
  lang: Language;
  climateBaseline?: ClimateBaselineData;
  onConfirm: (dontShowAgain: boolean) => void;
  onCancel: () => void;
  onOpenSources: () => void;
}

export function SimulationDisclaimerModal({
  open,
  lang,
  climateBaseline,
  onConfirm,
  onCancel,
  onOpenSources
}: SimulationDisclaimerModalProps) {
  const region = useActiveRegion();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDontShowAgain(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const isEn = lang === 'en';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#161c1a]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sim-disclaimer-title"
      data-testid="sim-disclaimer-modal"
      onClick={e => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-[#161c1a]/15 bg-[#ffffff] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#161c1a]/12 bg-[#fafaf8] px-5 py-4">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0369a1]/12 text-[#0369a1]">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 id="sim-disclaimer-title" className="m-0 text-[15.5px] font-extrabold text-[#161c1a]">
                {isEn
                  ? 'Before Viewing the Flow Simulation'
                  : 'Sebelum Melihat Simulasi Aliran'}
              </h2>
              <p className="mt-0.5 mb-0 text-[12.5px] text-[#434d49]">
                {isEn
                  ? `Open-data educational visualization for ${region.name} — read scope & limits`
                  : `Visualisasi edukatif data terbuka ${region.name} — kenali cakupan & batasnya`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={isEn ? 'Close' : 'Tutup'}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#161c1a]/12 bg-white text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="sidebar-scroll flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-[#161c1a]">
          <div className="rounded-xl border border-[#0369a1]/22 bg-[#f2f3ef]/70 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-[#0369a1]">
              <Droplets className="h-3.5 w-3.5 shrink-0" />
              <span>{isEn ? '1. What Is Shown on the Map' : '1. Yang Ditampilkan di Peta'}</span>
            </div>
            <p className="m-0 text-[12.5px] text-[#434d49]">
              {isEn
                ? 'Blue lines and valley shading show terrain runoff paths and estimated valley flow depth. Orange/red zones mark saturated steep slopes where heavy rain weakens soil cohesion — they represent wet steep soil, NOT standing floodwater.'
                : 'Garis biru dan arsir lembah menggambarkan arah limpasan topografi serta perkiraan kedalaman air lembah. Area jingga/merah menandakan tanah lereng curam yang jenuh air (bukan genangan banjir).'}
            </p>
          </div>

          <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-[#161c1a]">
              <Database className="h-3.5 w-3.5 shrink-0 text-[#434d49]" />
              <span>{isEn ? '2. Data Basis & Current Limits' : '2. Basis Data & Keterbatasan Saat Ini'}</span>
            </div>
            <p className="m-0 text-[12.5px] text-[#434d49]">
              {(() => {
                const activeClim = climateBaseline ?? CLIMATE_BASELINE;
                const hasBmkg = activeClim.bmkgStations.length > 0;
                const stationNames = activeClim.bmkgStations.map(s => `${s.name.replace(/^Stasiun [^ ]+ /, '')} (${s.wmoId})`).join(' & ');
                const years = activeClim.era5Series.yearsCount || 41;
                if (isEn) {
                  return hasBmkg
                    ? `Built from open topography, ESA WorldCover 10m, and ${years}-year ERA5-Land daily rainfall (${activeClim.era5Series.period}) bias-corrected (×${activeClim.era5Series.biasFactor}) to BMKG ${stationNames} monthly data. Because ${region.name} has no live stream gauges (AWLR) or soil boreholes yet, readiness stays capped at Screening (≤44/100).`
                    : `Built from open topography, ESA WorldCover 10m, and ${years}-year ERA5-Land daily rainfall (${activeClim.era5Series.period}, bias ×${activeClim.era5Series.biasFactor}) for ${region.name}. Because no live stream gauges (AWLR) or soil boreholes are configured yet, readiness stays capped at Screening (≤44/100).`;
                }
                return hasBmkg
                  ? `Dihitung dari topografi terbuka, tutupan lahan ESA WorldCover 10 m, dan hujan harian ERA5-Land ${years} tahun (${activeClim.era5Series.period}) yang dikoreksi bias (×${activeClim.era5Series.biasFactor}) terhadap data bulanan BMKG ${stationNames}. Karena ${region.name} belum memiliki pos AWLR atau uji bor tanah lapangan, status data dikunci pada Skrining Awal (≤44/100).`
                  : `Dihitung dari topografi terbuka, tutupan lahan ESA WorldCover 10 m, dan seri hujan harian ERA5-Land ${years} tahun (${activeClim.era5Series.period}, faktor bias ×${activeClim.era5Series.biasFactor}) untuk ${region.name}. Karena belum ada pos AWLR atau uji bor tanah lapangan, status data dikunci pada Skrining Awal (≤44/100).`;
              })()}
            </p>
          </div>

          <div className="rounded-xl border border-[#b45309]/30 bg-[#b45309]/8 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-[#92400e]">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[#b45309]" />
              <span>{isEn ? '3. What This Model Is NOT' : '3. Bukan Peringatan Resmi'}</span>
            </div>
            <p className="m-0 text-[12.5px] text-[#78350f]">
              {isEn
                ? `This is NOT an official weather forecast, disaster alert, or house-level flood depth measurement. Official hazard warnings and emergency instructions belong solely to BNPB, ${region.authorities.bpbdLabel}, BMKG, PVMBG, and ${region.authorities.localAuthorityShort}.`
                : `Bukan prakiraan cuaca resmi, bukan peringatan dini bencana, dan bukan ukuran tinggi air per rumah. Pernyataan status bahaya dan evakuasi resmi hanya berasal dari BNPB, ${region.authorities.bpbdLabel}, BMKG, PVMBG, serta ${region.authorities.localAuthorityShort}.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[#434d49] select-none">
              <input
                type="checkbox"
                data-testid="sim-disclaimer-dont-show"
                checked={dontShowAgain}
                onChange={e => setDontShowAgain(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-[#161c1a]/30 accent-[#0369a1]"
              />
              <span>
                {isEn ? "Don't show again in this browser" : 'Jangan tampilkan lagi di browser ini'}
              </span>
            </label>

            <button
              type="button"
              data-testid="sim-disclaimer-sources-link"
              onClick={onOpenSources}
              className="text-[12px] font-bold text-[#0369a1] underline-offset-2 hover:underline"
            >
              {isEn ? 'View source of every number →' : 'Lihat sumber semua angka →'}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-[#161c1a]/12 bg-[#fafaf8] px-5 py-3.5">
          <button
            type="button"
            data-testid="sim-disclaimer-cancel"
            onClick={onCancel}
            className="min-h-[38px] rounded-xl border border-[#161c1a]/15 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#434d49] transition hover:bg-[#f2f3ef] hover:text-[#161c1a]"
          >
            {isEn ? 'Back to Map' : 'Kembali ke Peta'}
          </button>
          <button
            type="button"
            data-testid="sim-disclaimer-confirm"
            onClick={() => onConfirm(dontShowAgain)}
            className="min-h-[38px] rounded-xl bg-[#0369a1] px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-[#075985]"
          >
            {isEn ? 'Understood & Continue' : 'Mengerti & Lanjut Simulasi'}
          </button>
        </div>
      </div>
    </div>
  );
}
