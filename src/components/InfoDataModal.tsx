import { useEffect, useState } from 'react';
import { BookOpen, BookText, Code2, Database, ExternalLink, PlayCircle, Search, ShieldAlert, X } from 'lucide-react';
import { GLOSSARY_ENTRIES } from '../data/glossary';
import { useActiveRegion, useT } from '../context/RegionContext';
import type { DatasetMetadata, Language } from '../types/gis';

export type InfoModalTab = 'guide' | 'method' | 'glossary' | 'api';

interface InfoDataModalProps {
  open: boolean;
  initialTab?: InfoModalTab;
  lang: Language;
  metadata: DatasetMetadata | null;
  verifiedCount: number;
  onClose: () => void;
}

export function InfoDataModal(props: InfoDataModalProps) {
  if (!props.open) return null;
  return <InfoDataModalContent key={props.initialTab ?? 'guide'} {...props} />;
}

function InfoDataModalContent({
  open,
  initialTab = 'guide',
  lang,
  metadata,
  verifiedCount,
  onClose
}: InfoDataModalProps) {
  const [activeTab, setActiveTab] = useState<InfoModalTab>(initialTab);
  const [glossaryQuery, setGlossaryQuery] = useState('');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const region = useActiveRegion();
  const t = useT(lang);
  const isEn = lang === 'en';
  const GITHUB_REPO_URL = region.repositoryUrl;
  const GITHUB_DATA_SOURCES_URL = `${GITHUB_REPO_URL}/blob/main/DATA_SOURCES.md`;

  const tabs: { id: InfoModalTab; label: string; Icon: typeof BookOpen }[] = [
    { id: 'guide', label: t.infoTabGuide, Icon: BookOpen },
    { id: 'method', label: t.infoTabMethod, Icon: Database },
    { id: 'glossary', label: t.infoTabGlossary, Icon: BookText },
    { id: 'api', label: t.infoTabApi, Icon: Code2 }
  ];

  const normalizedQuery = glossaryQuery.trim().toLowerCase();
  const filteredGlossary = GLOSSARY_ENTRIES.filter(entry => {
    if (!normalizedQuery) return true;
    const haystack = [
      entry.termId,
      entry.termEn,
      entry.shortId ?? '',
      entry.shortEn ?? '',
      entry.descId,
      entry.descEn
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const hasRegionalOverlays = region.regionalOverlays.enabled;
  const hasSentinelChange = region.regionalOverlays.sentinelChangeAvailable;
  const subRegionList = region.cameraPresets
    .filter(p => p.id !== 'center')
    .map(p => p.label)
    .slice(0, 4)
    .join(', ');
  const demLabel = metadata?.demSource || 'BIG DEMNAS (~8.3m) / Copernicus DEM GLO-30';
  const boundaryCodeSuffix = region.officialBoundaryCode ? ` (${region.officialBoundaryCode})` : '';

  const softwareRows = [
    { name: 'React 19, TypeScript, Vite & Tailwind CSS', role: isEn ? 'Open-source web UI & build tools' : 'Antarmuka web & alat pengembangan terbuka', license: 'MIT' },
    { name: 'MapLibre GL JS & Lucide Icons', role: isEn ? 'Interactive 2D/3D map engine & icons' : 'Mesin peta 2D/3D interaktif & ikon', license: 'BSD-3 / ISC' },
    { name: 'Node.js SQLite & Pure-Node Hydrology', role: isEn ? 'DEM processing, HAND model & audit storage' : 'Pengolahan elevasi, model HAND & riwayat data', license: 'MIT' },
    {
      name: demLabel,
      role: isEn
        ? 'Elevation grid, terrain slope, contours, rivers & public facilities'
        : 'Elevasi tanah, kemiringan lereng, kontur, jaringan sungai & fasilitas umum',
      license: demLabel.includes('BIG') ? 'Public Gov Data (BIG)' : 'Open Data'
    },
    ...(region.officialBoundaryCode
      ? [
          {
            name: 'BIG Batas Wilayah Desa/Nagari',
            role: isEn
              ? `Official ${region.name} boundary polygon${boundaryCodeSuffix}`
              : `Poligon resmi batas ${region.name}${boundaryCodeSuffix}`,
            license: 'Public Gov Data (BIG)'
          }
        ]
      : []),
    { name: 'ESA WorldCover 10m v200', role: isEn ? '10m forest, cropland & built-up land cover' : 'Tutupan lahan hutan, kebun, sawah & terbangun (10 m)', license: 'CC-BY-4.0' },
    ...(hasSentinelChange
      ? [
          {
            name: 'Copernicus Sentinel-2 L2A (10m)',
            role: isEn
              ? 'Pre vs post vegetation-index (NDVI) difference (Dec 2022 vs Jul 2024)'
              : 'Selisih indeks vegetasi (NDVI) satelit antara 24 Des 2022 dan 11 Jul 2024 (10 m)',
            license: 'Copernicus Open License'
          }
        ]
      : []),
    { name: 'OpenStreetMap & OpenTopoMap', role: isEn ? 'Buildings, roads, rivers, bridges & topo basemap' : 'Bangunan, jalan, sungai, jembatan & peta topografi', license: 'ODbL / CC-BY-SA' },
    ...(hasRegionalOverlays
      ? [
          {
            name: 'Google Open Buildings v3',
            role: isEn ? 'Rural building footprint supplement (confidence >= 0.75)' : 'Pelengkap tapak bangunan pedesaan (kepercayaan >= 0,75)',
            license: 'CC-BY-4.0'
          },
          {
            name: `${region.regionalOverlays.providerName} Open GIS (ArcGIS Web Maps)`,
            role: isEn
              ? 'Ground-movement map, soil, geology, BMKG rainfall & protected forest'
              : 'Peta gerakan tanah, jenis tanah, geologi, curah hujan BMKG & kawasan hutan',
            license: 'Public Gov Data'
          }
        ]
      : []),
    { name: 'Esri World Imagery', role: isEn ? 'Satellite basemap (replaceable with drone tiles)' : 'Citra satelit (dapat diganti citra drone lokal)', license: 'Free w/ Attribution' }
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
      <div className="flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-[#161c1a]/15 bg-[#ffffff] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#161c1a]/12 bg-[#fafaf8] px-5 py-4">
          <div>
            <h2 id="info-modal-title" className="m-0 text-[16px] font-extrabold text-[#161c1a]">
              {isEn ? `About ${region.appTitle.en} & Open Data` : `Tentang ${region.appTitle.id} & Data Terbuka`}
            </h2>
            <p className="mt-0.5 mb-0 text-[13px] text-[#434d49]">
              {isEn
                ? 'Public information for residents, researchers, government, and developers'
                : `Informasi publik untuk warga, peneliti, pemerintah ${region.adminLevelLabel.id.toLowerCase()}/daerah, dan pengembang`}
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

        <div className="grid grid-cols-2 gap-1 border-b border-[#161c1a]/12 bg-[#f2f3ef] px-5 py-2 sm:grid-cols-4">
          {tabs.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`info-tab-${id}`}
                onClick={() => setActiveTab(id)}
                className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12.5px] font-bold ${
                  active
                    ? 'border-[#161c1a]/12 bg-white text-[#0369a1] shadow-xs'
                    : 'border-transparent text-[#434d49] hover:bg-white/60 hover:text-[#161c1a]'
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
                  ? `This open spatial data viewer displays geographic datasets from BIG${hasRegionalOverlays ? `, ${region.regionalOverlays.providerName}` : ''}, ESA/Copernicus, and OpenStreetMap alongside field-verified river and culvert records in ${region.name} — without making disaster declarations or predictions.`
                  : `Portal data terbuka ini menampilkan kumpulan data geospasial resmi dan terbuka (BIG${hasRegionalOverlays ? `, ${region.regionalOverlays.providerName}` : ''}, ESA/Copernicus, OpenStreetMap) serta catatan kondisi sungai dan gorong-gorong lapangan di ${region.name} — tanpa membuat kesimpulan atau pernyataan status bencana.`}
              </p>

              <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4">
                <h3 className="m-0 mb-2.5 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Quick 30-second guide' : 'Panduan singkat membaca peta'}
                </h3>
                <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[13.5px] text-[#434d49]">
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Map tab:' : 'Tab Peta:'}</strong>{' '}
                    {isEn
                      ? `Jump to a ${region.subRegionLabel.en}${subRegionList ? ` (${subRegionList})` : ''} and toggle verified rivers${hasRegionalOverlays ? `, vegetation-change layers, ${region.regionalOverlays.providerName} reference maps,` : ','} or DEM slope-flow lines.`
                      : `Pilih ${region.subRegionLabel.id}${subRegionList ? ` (${subRegionList})` : ''} dan tampilkan data sungai terverifikasi${hasRegionalOverlays ? `, perubahan tutupan vegetasi, peta referensi ${region.regionalOverlays.providerName},` : ','} atau arah kemiringan elevasi DEM.`}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Simulation tab:' : 'Tab Simulasi:'}</strong>{' '}
                    {isEn
                      ? 'Explore a computational terrain flow model across rainfall and channel-state input parameters (educational visualization only, not a hazard prediction).'
                      : 'Eksplorasi visualisasi aliran topografi berdasarkan variasi skenario hujan dan kondisi saluran (hanya untuk simulasi komputasi, bukan prediksi bencana).'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Drainage tab:' : 'Tab Drainase:'}</strong>{' '}
                    {isEn
                      ? 'Filter culverts and bridges by field physical condition, inspect steep DEM slope points or elevated public facilities, and access official agency references.'
                      : 'Saring gorong-gorong dan jembatan berdasarkan kondisi fisik lapangan, lihat titik kemiringan DEM maupun fasilitas umum, serta rujukan instansi berwenang.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Feedback button:' : 'Tombol Masukan:'}</strong>{' '}
                    {isEn
                      ? 'Share general suggestions on usability, map clarity, or new features without logging in.'
                      : 'Kirim saran umum terkait kemudahan tampilan, kejelasan data, atau usulan fitur tanpa perlu masuk.'}
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
                      ? `This application strictly displays open spatial data, topographic computations (HAND / D8 / SCS-CN), and field infrastructure records. It does NOT issue disaster warnings, declare landslide/flood hazards, or designate official evacuation sites. Official hazard assessments, forecasts, and emergency directives belong exclusively to BNPB, ${region.authorities.bpbdLabel}, BMKG, PVMBG, and ${region.authorities.localAuthorityShort}.`
                      : `Aplikasi ini hanya berfungsi sebagai media tampilan data spasial terbuka, komputasi topografi (HAND / D8 / SCS-CN), dan inventaris saluran lapangan. Aplikasi ini TIDAK menetapkan status bahaya, potensi longsor/banjir, maupun titik evakuasi resmi. Seluruh pernyataan potensi bahaya, peringatan dini cuaca, dan arahan evakuasi hanya bersumber dari BNPB, ${region.authorities.bpbdLabel}, BMKG, PVMBG, peneliti berwenang, serta ${region.authorities.localAuthorityShort}.`}
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
                  <strong className="text-[#161c1a]">
                    {isEn ? '1. DEM & Stream Burning:' : '1. Data Elevasi DEM & Penyisipan Sungai (Stream Burning):'}
                  </strong>{' '}
                  {isEn
                    ? 'Elevation uses BIG DEMNAS (~8.3m terrain resolution). Verified community waterways are gently burned into the elevation copy prior to flow routing.'
                    : 'Elevasi menggunakan BIG DEMNAS resolusi ~8,3 meter. Jalur sungai yang sudah diverifikasi warga disisipkan ke salinan DEM sebelum penelusuran arah aliran.'}
                </p>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">
                    {isEn ? '2. D8 Flow & HAND Model:' : '2. Penelusuran Aliran D8 & Indeks HAND:'}
                  </strong>{' '}
                  {isEn
                    ? 'Priority-Flood depression filling and D8 routing compute topographic flow paths and HAND (Height Above Nearest Drainage) elevation-relative indices.'
                    : 'Pengisian cekungan Priority-Flood dan penelusuran arah aliran D8 menghitung arah kemiringan topografi serta indeks HAND (ketinggian relatif terhadap alur terdekat).'}
                </p>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">3. {isEn ? 'Known Accuracy Limits:' : 'Batas Akurasi:'}</strong>{' '}
                  {isEn
                    ? 'Computed DEMNAS 8m D8 lines (dashed) can differ from narrow roadside drains and culverts in the field. Use Detailed mode → Waterways to verify or correct them.'
                    : 'Garis komputasi dari DEMNAS 8 m (garis putus-putus) dapat berbeda dari parit atau gorong-gorong sempit di lapangan. Gunakan mode Lengkap → Jalur Air untuk verifikasi data lapangan.'}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'glossary' && (
            <div className="flex flex-col gap-3.5" data-testid="glossary-panel">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#636f6a]" />
                <input
                  type="text"
                  data-testid="glossary-search"
                  value={glossaryQuery}
                  onChange={e => setGlossaryQuery(e.target.value)}
                  placeholder={t.glossarySearchPlaceholder}
                  aria-label={t.glossarySearchPlaceholder}
                  className="min-h-[40px] w-full rounded-xl border border-[#161c1a]/18 bg-[#fafaf8] pr-9 pl-9 text-[13px] font-medium text-[#161c1a] placeholder:text-[#636f6a] focus:border-[#0369a1] focus:bg-white focus:outline-none"
                />
                {glossaryQuery && (
                  <button
                    type="button"
                    onClick={() => setGlossaryQuery('')}
                    aria-label={t.clear}
                    className="absolute top-1/2 right-2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-[#636f6a] hover:bg-[#161c1a]/8 hover:text-[#161c1a]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {filteredGlossary.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] px-4 py-6 text-center">
                  <p className="m-0 text-[13px] font-medium text-[#434d49]">{t.glossaryEmpty}</p>
                  <button
                    type="button"
                    onClick={() => setGlossaryQuery('')}
                    className="min-h-[34px] rounded-lg border border-[#161c1a]/15 bg-white px-3 py-1 text-[12.5px] font-bold text-[#0369a1] hover:bg-[#f2f3ef]"
                  >
                    {t.glossaryResetSearch}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {filteredGlossary.map(entry => {
                    const term = isEn ? entry.termEn : entry.termId;
                    const short = isEn ? entry.shortEn : entry.shortId;
                    const desc = isEn ? entry.descEn : entry.descId;
                    return (
                      <article
                        key={entry.id}
                        data-testid={`glossary-entry-${entry.id}`}
                        className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-3.5"
                      >
                        <div className="min-w-0">
                          <h3 className="m-0 text-[14px] font-bold text-[#161c1a]">{term}</h3>
                          {short && (
                            <div className="text-[11.5px] font-semibold text-[#0369a1]">{short}</div>
                          )}
                        </div>
                        <p className="mt-2 mb-0 text-[13px] leading-relaxed text-[#434d49]">{desc}</p>
                        {entry.links.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {entry.links.map(link => {
                              const label = isEn ? link.labelEn : link.labelId;
                              const isVideo = link.kind === 'video';
                              return (
                                <a
                                  key={link.href}
                                  href={link.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex min-h-[28px] items-center gap-1.5 rounded-lg border border-[#161c1a]/15 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#0369a1] transition hover:border-[#0369a1]/40 hover:bg-[#f2f3ef]"
                                >
                                  {isVideo ? (
                                    <PlayCircle className="h-3.5 w-3.5 shrink-0" />
                                  ) : (
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                  )}
                                  <span>{label}</span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'api' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4">
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 text-[14px] font-bold text-[#161c1a]">
                    {isEn ? 'Open-Source Repository (GitHub)' : 'Repositori Kode Sumber Terbuka (GitHub)'}
                  </h3>
                  <p className="mt-0.5 mb-0 text-[13px] text-[#434d49]">
                    {isEn
                      ? 'Access the complete MIT-licensed source code, open spatial datasets, processing tools, and documentation on GitHub.'
                      : 'Akses kode program lengkap berlisensi MIT, data spasial terbuka, alat pengolahan data, dan dokumentasi proyek melalui GitHub.'}
                  </p>
                </div>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="info-github-link"
                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-[#0369a1] px-3.5 py-2 text-[13px] font-bold text-white transition hover:bg-[#075985]"
                >
                  <span>{isEn ? 'Open on GitHub' : 'Buka di GitHub'}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
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

              <a
                href={GITHUB_DATA_SOURCES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] px-3.5 py-2.5 text-[12.5px] text-[#434d49] transition hover:border-[#0369a1]/40 hover:text-[#161c1a]"
              >
                <span>
                  {isEn
                    ? 'Upgrade elevation with BIG DEMNAS 8m or custom drone orthophotos via the data preparation guide on GitHub.'
                    : 'Dapat ditingkatkan dengan GeoTIFF BIG DEMNAS 8 m atau citra drone lokal melalui panduan pengolahan data di GitHub.'}
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#0369a1]" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
