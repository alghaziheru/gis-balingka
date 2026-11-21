import { useEffect, useState } from 'react';
import { BookOpen, Code2, Database, Download, ExternalLink, ShieldAlert, X } from 'lucide-react';
import { I18N } from '../i18n/translations';
import { fetchExportBundle } from '../lib/api';
import type { DatasetMetadata, Language } from '../types/gis';

export type InfoModalTab = 'guide' | 'method' | 'api';

interface InfoDataModalProps {
  open: boolean;
  lang: Language;
  metadata: DatasetMetadata | null;
  apiAvailable: boolean;
  verifiedCount: number;
  onNotify: (msg: string) => void;
  onClose: () => void;
}

export function InfoDataModal({
  open,
  lang,
  metadata,
  apiAvailable,
  verifiedCount,
  onNotify,
  onClose
}: InfoDataModalProps) {
  const [activeTab, setActiveTab] = useState<InfoModalTab>('guide');
  const [downloading, setDownloading] = useState(false);

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
    { name: 'Copernicus DEM GLO-30 & AWS Terrarium', role: isEn ? '30m terrain elevation & contour source' : 'Sumber elevasi tanah 30m & kontur', license: 'Open Data' },
    { name: 'OpenStreetMap & OpenTopoMap', role: isEn ? 'Roads, rivers, bridges & topo basemap' : 'Jalan, sungai, jembatan & peta topografi', license: 'ODbL / CC-BY-SA' },
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
                  ? 'This open map helps residents and local authorities understand water flow from the southern slopes of Mount Singgalang, identify flood-prone lowlands, check culvert conditions, and report issues directly from the field.'
                  : 'Peta terbuka ini membantu warga dan perangkat nagari melihat arah aliran air dari lereng selatan Gunung Singgalang, mengenali wilayah dataran rendah rawan genangan, memantau kondisi gorong-gorong, dan melaporkan temuan lapangan secara langsung.'}
              </p>

              <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4">
                <h3 className="m-0 mb-2.5 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Quick 30-second guide' : 'Panduan singkat membaca peta'}
                </h3>
                <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[13.5px] text-[#434d49]">
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Map tab:' : 'Tab Peta:'}</strong>{' '}
                    {isEn
                      ? 'Jump straight to your Jorong (Pahambatan, Koto Hilalang, Subarang) and toggle verified streams vs. rainwater estimates.'
                      : 'Pilih langsung Jorong Anda (Pahambatan, Koto Hilalang, Subarang) untuk melihat sungai terverifikasi dan perkiraan aliran air hujan.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Simulation tab:' : 'Tab Simulasi:'}</strong>{' '}
                    {isEn
                      ? 'Test rainfall intensity and storm duration with live falling rain and compare clogged vs. cleared culverts.'
                      : 'Uji intensitas dan durasi curah hujan beserta animasi hujan turun, lalu bandingkan saluran tersumbat vs. normal.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Preparedness tab:' : 'Tab Siaga:'}</strong>{' '}
                    {isEn
                      ? 'View critical road crossings, evacuation points on higher ground, and keep a household readiness checklist.'
                      : 'Cek titik persilangan jalan–sungai yang kritis, lokasi evakuasi tinggi, dan daftar siaga keluarga.'}
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
                    {isEn ? 'Important safety disclaimer' : 'Catatan penting & batas penggunaan'}
                  </strong>
                  <span>
                    {isEn
                      ? 'Flood zones and runoff lines are indicative terrain-based estimates from open satellite data — not certified engineering models. Always follow official instructions from Wali Nagari Balingka and BPBD Kab. Agam.'
                      : 'Zona genangan dan garis aliran merupakan perkiraan indikatif berbasis topografi terbuka — bukan kajian hidrolika teknik bersertifikat. Saat cuaca ekstrem, selalu ikuti arahan resmi Wali Nagari Balingka dan BPBD Kab. Agam.'}
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
                    ? 'Elevation uses Copernicus DEM GLO-30 (replaceable with 8m BIG DEMNAS GeoTIFF). Verified community waterways are gently burned into the elevation copy prior to flow routing.'
                    : 'Elevasi menggunakan Copernicus DEM GLO-30 (dapat ditingkatkan dengan GeoTIFF BIG DEMNAS 8m). Jalur sungai yang sudah diverifikasi warga ditanamkan ke salinan DEM sebelum perhitungan aliran.'}
                </p>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">2. D8 Flow & HAND Model:</strong>{' '}
                  {isEn
                    ? 'Priority-Flood depression filling and D8 routing compute catchment drainage and HAND (Height Above Nearest Drainage) to estimate low-lying flood susceptibility.'
                    : 'Pengisian cekungan Priority-Flood dan perutean D8 menghitung arah aliran serta indeks HAND (ketinggian relatif terhadap alur terdekat) untuk memetakan zona rendah rawan genangan.'}
                </p>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">3. {isEn ? 'Known Accuracy Limits:' : 'Batas Akurasi:'}</strong>{' '}
                  {isEn
                    ? 'Unverified 30m DEM runoff lines (dashed) can drift 15–45m from narrow village irrigation ditches. Use Detailed mode → Waterways to verify or correct them.'
                    : 'Garis perkiraan dari DEM 30m (garis putus-putus) dapat meleset 15–45 meter dari posisi parit atau bandar asli. Gunakan mode Lengkap → Jalur Sungai untuk koreksi lapangan.'}
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
