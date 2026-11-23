import { useEffect, useState } from 'react';
import { BookOpen, Code2, Database, Download, ExternalLink, ShieldAlert, X } from 'lucide-react';
import { I18N } from '../i18n/translations';
import { fetchExportBundle } from '../lib/api';
import type { DatasetMetadata, Language } from '../types/gis';

export type InfoModalTab = 'guide' | 'method' | 'api';

interface InfoDataModalProps {
  open: boolean;
  initialTab?: InfoModalTab;
  lang: Language;
  metadata: DatasetMetadata | null;
  apiAvailable: boolean;
  verifiedCount: number;
  onNotify: (msg: string) => void;
  onClose: () => void;
}

export function InfoDataModal({
  open,
  initialTab = 'guide',
  lang,
  metadata,
  apiAvailable,
  verifiedCount,
  onNotify,
  onClose
}: InfoDataModalProps) {
  const [activeTab, setActiveTab] = useState<InfoModalTab>(initialTab);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

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

  const handleDownloadBundle = async () => {
    setDownloading(true);
    try {
      const bundle = await fetchExportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'balingka-waterways-audit-bundle.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotify(t.toastExported);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const tabs: { id: InfoModalTab; label: string; Icon: typeof BookOpen }[] = [
    { id: 'guide', label: t.infoTabGuide, Icon: BookOpen },
    { id: 'method', label: t.infoTabMethod, Icon: Database },
    { id: 'api', label: t.infoTabApi, Icon: Code2 }
  ];

  const softwareRows = [
    { name: 'React 19, TypeScript, Vite & Tailwind CSS', role: isEn ? 'Open-source web UI & build tools' : 'Antarmuka web & sistem build terbuka', license: 'MIT' },
    { name: 'MapLibre GL JS & Lucide Icons', role: isEn ? 'Interactive 2D/3D map engine & icons' : 'Mesin peta 2D/3D interaktif & ikon', license: 'BSD-3 / ISC' },
    { name: 'Node.js SQLite & Pure-Node Hydrology', role: isEn ? 'DEM processing, HAND model & audit storage' : 'Pengolahan elevasi, model HAND & riwayat data', license: 'MIT' },
    { name: 'BIG DEMNAS (~8.3m) & RBI 50K Agam (Dec 2022)', role: isEn ? 'High-resolution DEM, rivers, culverts, bridges & public shelters' : 'Elevasi tanah ~8,3m, sungai, gorong-gorong, jembatan & fasilitas umum resmi BIG', license: 'Public Gov Data (BIG)' },
    { name: 'BIG Batas Wilayah Desa/Nagari (June 2026)', role: isEn ? 'Official Nagari Balingka polygon (13.06.05.2003)' : 'Poligon resmi batas Nagari Balingka (13.06.05.2003)', license: 'Public Gov Data (BIG)' },
    { name: 'ESA WorldCover 10m v200', role: isEn ? '10m forest, cropland & built-up land cover' : 'Tutupan lahan hutan, kebun, sawah & terbangun (10m)', license: 'CC-BY-4.0' },
    { name: 'Copernicus Sentinel-2 L2A (10m)', role: isEn ? 'Pre vs post vegetation-index (NDVI) difference (Dec 2022 vs Jul 2024)' : 'Selisih indeks vegetasi (NDVI) satelit antara 24 Des 2022 dan 11 Jul 2024 (10m)', license: 'Copernicus Open License' },
    { name: 'OpenStreetMap & OpenTopoMap', role: isEn ? 'Buildings, roads, rivers, bridges & topo basemap' : 'Bangunan, jalan, sungai, jembatan & peta topografi', license: 'ODbL / CC-BY-SA' },
    { name: 'Google Open Buildings v3', role: isEn ? 'Rural building footprint supplement (confidence >= 0.75)' : 'Pelengkap tapak bangunan pedesaan (kepercayaan >= 0,75)', license: 'CC-BY-4.0' },
    { name: 'Pemkab Agam Open GIS (ArcGIS Web Maps)', role: isEn ? 'Ground-movement map, soil (Andosol), geology, BMKG rainfall & SK 35 forest' : 'Peta gerakan tanah, jenis tanah (Andosol), geologi, curah hujan BMKG & hutan SK 35', license: 'Public Gov Data' },
    { name: 'Esri World Imagery', role: isEn ? 'Satellite basemap (replaceable with drone tiles)' : 'Citra satelit (dapat diganti citra drone lokal)', license: 'Free w/ Attribution' }
  ];

  const apiEndpoints = [
    { method: 'GET', path: '/api/waterways', desc: isEn ? 'Verified waterways GeoJSON & hidden DEM IDs' : 'GeoJSON sungai terverifikasi & segmen DEM tersembunyi' },
    { method: 'GET', path: '/api/audit', desc: isEn ? 'Full chronological change log with snapshots' : 'Riwayat perubahan lengkap beserta snapshot sebelum/sesudah' },
    { method: 'GET', path: '/api/suggestions', desc: isEn ? 'General user feedback entries' : 'Daftar masukan (feedback) umum pengguna' },
    { method: 'POST', path: '/api/suggestions', desc: isEn ? 'Submit general feedback (no auth)' : 'Kirim masukan umum (tanpa login)' },
    { method: 'GET', path: '/api/export/bundle', desc: isEn ? 'Download combined GeoJSON + audit JSON' : 'Unduh gabungan GeoJSON terverifikasi + log audit' }
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#161c1a]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-[660px] flex-col overflow-hidden rounded-2xl border border-[#161c1a]/15 bg-[#ffffff] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#161c1a]/12 bg-[#fafaf8] px-5 py-4">
          <div>
            <h2 id="info-modal-title" className="m-0 text-[16px] font-extrabold text-[#161c1a]">
              {isEn ? 'About Nagari Balingka Map & Open Data' : 'Tentang Peta Nagari Balingka & Data Terbuka'}
            </h2>
            <p className="mt-0.5 mb-0 text-[13px] text-[#434d49]">
              {isEn
                ? 'Public information for residents, researchers, government, and developers'
                : 'Informasi publik untuk warga, peneliti, pemerintah nagari/daerah, dan pengembang'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#161c1a]/12 bg-white text-[#434d49] hover:bg-[#f2f3ef] hover:text-[#161c1a]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 border-b border-[#161c1a]/12 bg-[#f2f3ef] px-5 py-2">
          {tabs.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-bold transition ${
                  active
                    ? 'border border-[#161c1a]/12 bg-white text-[#0369a1] shadow-xs'
                    : 'text-[#434d49] hover:bg-white/60 hover:text-[#161c1a]'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="sidebar-scroll flex-1 overflow-y-auto px-5 py-4 text-[13.5px] leading-relaxed text-[#161c1a]">
          {activeTab === 'guide' && (
            <div className="flex flex-col gap-4">
              <p className="m-0 text-[#434d49]">
                {isEn
                  ? 'This open spatial data viewer displays geographic datasets from BIG, Pemkab Agam, ESA/Copernicus, and OpenStreetMap alongside field-verified river and culvert records in Nagari Balingka — without making disaster declarations or predictions.'
                  : 'Portal data terbuka ini menampilkan kumpulan data geospasial resmi dan terbuka (BIG, Pemkab Agam, ESA/Copernicus, OpenStreetMap) serta catatan kondisi sungai dan gorong-gorong lapangan di Nagari Balingka — tanpa membuat kesimpulan atau pernyataan status bencana.'}
              </p>

              <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4">
                <h3 className="m-0 mb-2.5 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Quick 30-second guide' : 'Panduan singkat membaca peta'}
                </h3>
                <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[13.5px] text-[#434d49]">
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Map tab:' : 'Tab Peta:'}</strong>{' '}
                    {isEn
                      ? 'Jump to a Jorong (Pahambatan, Koto Hilalang, Subarang) and toggle verified rivers, vegetation-change layers, Pemkab Agam reference maps, or DEMNAS slope-flow lines.'
                      : 'Pilih Jorong (Pahambatan, Koto Hilalang, Subarang) dan tampilkan data sungai terverifikasi, perubahan tutupan vegetasi, peta referensi Pemkab Agam, atau arah kemiringan elevasi DEMNAS.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Simulation tab:' : 'Tab Simulasi:'}</strong>{' '}
                    {isEn
                      ? 'Explore a computational terrain flow model across rainfall and channel-state input parameters (educational visualization only, not a hazard prediction).'
                      : 'Eksplorasi model visualisasi aliran topografi berdasarkan variasi parameter input hujan dan saluran (hanya untuk visualisasi komputasi, bukan prediksi bencana).'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Drainage tab:' : 'Tab Drainase:'}</strong>{' '}
                    {isEn
                      ? 'Filter culverts and bridges by field physical condition, inspect steep DEM slope points or elevated BIG RBI facilities, and access official agency references.'
                      : 'Saring gorong-gorong dan jembatan berdasarkan kondisi fisik lapangan, lihat titik kemiringan DEM maupun fasilitas umum BIG RBI, serta rujukan instansi berwenang.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Feedback button:' : 'Tombol Feedback:'}</strong>{' '}
                    {isEn
                      ? 'Share general suggestions on usability, map clarity, or new features without logging in.'
                      : 'Kirim saran umum terkait kemudahan tampilan, kejelasan data, atau usulan fitur tanpa perlu login.'}
                  </li>
                </ul>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-[#b45309]/30 bg-[#b45309]/8 p-3.5 text-[13px] text-[#78350f]">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b45309]" />
                <div>
                  <strong className="block font-bold">
                    {isEn ? 'Application Scope & Role Boundaries' : 'Ruang Lingkup & Batas Peran Aplikasi'}
                  </strong>
                  <span>
                    {isEn
                      ? 'This application strictly displays open spatial data, topographic computations (HAND / D8 / SCS-CN), and field infrastructure records. It does NOT issue disaster warnings, declare landslide/flood hazards, or designate official evacuation sites. Official hazard assessments, forecasts, and emergency directives belong exclusively to BNPB, BPBD Kab. Agam, BMKG, PVMBG, and Wali Nagari Balingka.'
                      : 'Aplikasi ini hanya berfungsi sebagai media tampilan data spasial terbuka, komputasi topografi (HAND / D8 / SCS-CN), dan inventaris saluran lapangan. Aplikasi ini TIDAK menetapkan status bahaya, potensi longsor/banjir, maupun titik evakuasi resmi. Seluruh pernyataan potensi bahaya, peringatan dini cuaca, dan arahan evakuasi hanya bersumber dari BNPB, BPBD Kab. Agam, BMKG, PVMBG, peneliti berwenang, serta Pemerintah Nagari Balingka.'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'method' && (
            <div className="flex flex-col gap-4">
              {metadata && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3">
                    <div className="text-[12px] text-[#636f6a]">{isEn ? 'Study block' : 'Luas blok peta'}</div>
                    <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                      {metadata.studyAreaKm2} km²
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3">
                    <div className="text-[12px] text-[#636f6a]">{isEn ? 'Elevation range' : 'Rentang ketinggian'}</div>
                    <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                      {metadata.minElevM}–{metadata.maxElevM} mdpl
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3">
                    <div className="text-[12px] text-[#636f6a]">{isEn ? 'Verified waterways' : 'Alur terverifikasi'}</div>
                    <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                      {verifiedCount} {isEn ? 'lines' : 'jalur'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3">
                    <div className="text-[12px] text-[#636f6a]">{isEn ? 'Stream network' : 'Jaringan aliran DEM'}</div>
                    <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                      {metadata.streamNetworkKm} km
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3">
                    <div className="text-[12px] text-[#636f6a]">{isEn ? 'Road crossings' : 'Persilangan jalan'}</div>
                    <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                      {metadata.crossingsDetected} ({metadata.bridgesDetected} {isEn ? 'bridges' : 'jembatan'})
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3">
                    <div className="text-[12px] text-[#636f6a]">{isEn ? 'DEM resolution' : 'Resolusi elevasi'}</div>
                    <div className="font-mono-num text-[15px] font-bold text-[#161c1a]">
                      {metadata.resolutionMeters}m ({metadata.gridDimensions})
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2.5 rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4">
                <h3 className="m-0 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Hydrology & terrain pipeline' : 'Cara kerja pemodelan topografi'}
                </h3>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">1. DEM & Stream Burning:</strong>{' '}
                  {isEn
                    ? 'Elevation uses BIG DEMNAS (~8.3m terrain resolution). Verified community waterways are gently burned into the elevation copy prior to flow routing.'
                    : 'Elevasi menggunakan BIG DEMNAS resolusi ~8,3 meter. Jalur sungai yang sudah diverifikasi warga ditanamkan ke salinan DEM sebelum perhitungan aliran.'}
                </p>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">2. D8 Flow & HAND Model:</strong>{' '}
                  {isEn
                    ? 'Priority-Flood depression filling and D8 routing compute topographic flow paths and HAND (Height Above Nearest Drainage) elevation-relative indices.'
                    : 'Pengisian cekungan Priority-Flood dan perutean D8 menghitung arah kemiringan aliran topografi serta indeks HAND (ketinggian relatif terhadap alur terdekat).'}
                </p>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">3. {isEn ? 'Known Accuracy Limits:' : 'Batas Akurasi:'}</strong>{' '}
                  {isEn
                    ? 'Computed DEMNAS 8m D8 lines (dashed) can differ from narrow roadside drains and culverts in the field. Use Detailed mode → Waterways to verify or correct them.'
                    : 'Garis komputasi dari DEMNAS 8m (garis putus-putus) dapat berbeda dari parit atau gorong-gorong sempit di lapangan. Gunakan mode Lengkap → Jalur Air untuk verifikasi data lapangan.'}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'api' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4">
                <div>
                  <h3 className="m-0 text-[14px] font-bold text-[#161c1a]">
                    {isEn ? 'Download Community Dataset' : 'Unduh Data Terbuka Balingka'}
                  </h3>
                  <p className="mt-0.5 mb-0 text-[13px] text-[#434d49]">
                    {isEn
                      ? 'Includes verified waterways GeoJSON, hidden DEM segments, and full audit history.'
                      : 'Berisi berkas GeoJSON sungai terverifikasi, segmen DEM tersaring, dan riwayat audit lengkap.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={downloading || !apiAvailable}
                  onClick={handleDownloadBundle}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0369a1] px-3.5 py-2 text-[13px] font-bold text-white transition hover:bg-[#075985] disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  <span>{downloading ? '...' : t.wwExportBundle}</span>
                </button>
              </div>

              <div>
                <h3 className="m-0 mb-2 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Public Read & Report Endpoints' : 'Endpoint API Publik'}
                </h3>
                <div className="divide-y divide-[#161c1a]/10 rounded-xl border border-[#161c1a]/12 bg-white">
                  {apiEndpoints.map(ep => (
                    <div key={ep.path + ep.method} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-num rounded bg-[#f2f3ef] px-1.5 py-0.5 text-[11px] font-bold text-[#0369a1]">
                          {ep.method}
                        </span>
                        <code className="font-mono-num text-[12px] font-semibold text-[#161c1a]">{ep.path}</code>
                      </div>
                      <span className="text-[12.5px] text-[#434d49]">{ep.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="m-0 mb-2 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Open-Source Stack & Data Attribution (MIT)' : 'Perangkat Lunak & Sumber Data Terbuka (MIT)'}
                </h3>
                <div className="divide-y divide-[#161c1a]/10 rounded-xl border border-[#161c1a]/12 bg-white">
                  {softwareRows.map(r => (
                    <div key={r.name} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                      <div>
                        <div className="text-[13px] font-bold text-[#161c1a]">{r.name}</div>
                        <div className="text-[12px] text-[#636f6a]">{r.role}</div>
                      </div>
                      <span className="font-mono-num shrink-0 rounded-md bg-[#047857]/10 px-2 py-0.5 text-[11.5px] font-bold text-[#047857]">
                        {r.license}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] px-3.5 py-2.5 text-[12.5px] text-[#434d49]">
                <span>
                  {isEn
                    ? 'Upgrade elevation with BIG DEMNAS 8m or custom drone orthophotos via prepare-data.'
                    : 'Dapat ditingkatkan dengan GeoTIFF BIG DEMNAS 8m atau citra drone lokal via skrip prepare-data.'}
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#636f6a]" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
