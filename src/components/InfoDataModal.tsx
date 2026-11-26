import { useEffect, useState } from 'react';
import { BookOpen, BookText, Code2, Database, ExternalLink, PlayCircle, Search, ShieldAlert, X } from 'lucide-react';
import { CLIMATE_BASELINE, MODEL_PARAMETER_AUDIT, type ParameterAuditBadge } from '../data/climateBaseline';
import { GLOSSARY_ENTRIES } from '../data/glossary';
import { REGION } from '../config/region';
import { I18N } from '../i18n/translations';
import type { DatasetMetadata, Language } from '../types/gis';

export type InfoModalTab = 'guide' | 'method' | 'glossary' | 'api';

const GITHUB_REPO_URL = REGION.repositoryUrl;
const GITHUB_DATA_SOURCES_URL = `${GITHUB_REPO_URL}/blob/main/DATA_SOURCES.md`;

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

  const t = I18N[lang];
  const isEn = lang === 'en';

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

  const hasRegionalOverlays = REGION.regionalOverlays.enabled;
  const hasSentinelChange = REGION.regionalOverlays.sentinelChangeAvailable;
  const subRegionList = REGION.cameraPresets
    .filter(p => p.id !== 'center')
    .map(p => p.label)
    .slice(0, 4)
    .join(', ');
  const demLabel = metadata?.demSource || 'BIG DEMNAS (~8.3m) / Copernicus DEM GLO-30';
  const boundaryCodeSuffix = REGION.officialBoundaryCode ? ` (${REGION.officialBoundaryCode})` : '';

  const softwareRows = [
    { name: 'React 19, TypeScript, Vite & Tailwind CSS', role: isEn ? 'Open-source web UI & build tools' : 'Antarmuka web & alat pengembangan terbuka', license: 'MIT' },
    { name: 'MapLibre GL JS & Lucide Icons', role: isEn ? 'Interactive 2D/3D map engine & icons' : 'Mesin peta 2D/3D interaktif & ikon', license: 'BSD-3 / ISC' },
    { name: 'Node.js SQLite & Pure-Node Hydrology', role: isEn ? 'DEM processing, HAND model & audit storage' : 'Pengolahan elevasi, model HAND & riwayat data', license: 'MIT' },
    {
      name: hasRegionalOverlays
        ? `BIG DEMNAS (~8.3m) & RBI 50K ${REGION.regency}`
        : demLabel,
      role: isEn
        ? 'Elevation grid, terrain slope, contours, rivers & public facilities'
        : 'Elevasi tanah, kemiringan lereng, kontur, jaringan sungai & fasilitas umum',
      license: demLabel.includes('BIG') ? 'Public Gov Data (BIG)' : 'Open Data'
    },
    ...(REGION.officialBoundaryCode
      ? [
          {
            name: 'BIG Batas Wilayah Desa/Nagari',
            role: isEn
              ? `Official ${REGION.name} boundary polygon${boundaryCodeSuffix}`
              : `Poligon resmi batas ${REGION.name}${boundaryCodeSuffix}`,
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
            name: `${REGION.regionalOverlays.providerName} Open GIS (ArcGIS Web Maps)`,
            role: isEn
              ? 'Ground-movement map, soil, geology, BMKG rainfall & protected forest'
              : 'Peta gerakan tanah, jenis tanah, geologi, curah hujan BMKG & kawasan hutan',
            license: 'Public Gov Data'
          },
          {
            name: 'BMKG Data Online (96165 & 96167) & Open-Meteo ERA5-Land',
            role: isEn
              ? 'Padang Panjang & Sicincin monthly baseline (2024–2026) + 41-yr bias-corrected daily rainfall (1985–2025)'
              : 'Basis bulanan Padang Panjang & Sicincin (2024–2026) + hujan harian ERA5-Land 41 tahun terkoreksi bias (1985–2025)',
            license: 'BMKG / CC-BY-4.0'
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
              {isEn ? `About ${REGION.appTitle.en} & Open Data` : `Tentang ${REGION.appTitle.id} & Data Terbuka`}
            </h2>
            <p className="mt-0.5 mb-0 text-[13px] text-[#434d49]">
              {isEn
                ? 'Public information for residents, researchers, government, and developers'
                : `Informasi publik untuk warga, peneliti, pemerintah ${REGION.adminLevelLabel.id.toLowerCase()}/daerah, dan pengembang`}
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
                  ? `This open spatial data viewer displays geographic datasets from BIG${hasRegionalOverlays ? `, ${REGION.regionalOverlays.providerName}` : ''}, ESA/Copernicus, and OpenStreetMap alongside field-verified river and culvert records in ${REGION.name} — without making disaster declarations or predictions.`
                  : `Portal data terbuka ini menampilkan kumpulan data geospasial resmi dan terbuka (BIG${hasRegionalOverlays ? `, ${REGION.regionalOverlays.providerName}` : ''}, ESA/Copernicus, OpenStreetMap) serta catatan kondisi sungai dan gorong-gorong lapangan di ${REGION.name} — tanpa membuat kesimpulan atau pernyataan status bencana.`}
              </p>

              <div className="rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4">
                <h3 className="m-0 mb-2.5 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Quick 30-second guide' : 'Panduan singkat membaca peta'}
                </h3>
                <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[13.5px] text-[#434d49]">
                  <li>
                    <strong className="text-[#161c1a]">{isEn ? 'Map tab:' : 'Tab Peta:'}</strong>{' '}
                    {isEn
                      ? `Jump to a ${REGION.subRegionLabel.en}${subRegionList ? ` (${subRegionList})` : ''} and toggle verified rivers${hasRegionalOverlays ? `, vegetation-change layers, ${REGION.regionalOverlays.providerName} reference maps,` : ','} or DEM slope-flow lines.`
                      : `Pilih ${REGION.subRegionLabel.id}${subRegionList ? ` (${subRegionList})` : ''} dan tampilkan data sungai terverifikasi${hasRegionalOverlays ? `, perubahan tutupan vegetasi, peta referensi ${REGION.regionalOverlays.providerName},` : ','} atau arah kemiringan elevasi DEM.`}
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
                      ? `This application strictly displays open spatial data, topographic computations (HAND / D8 / SCS-CN), and field infrastructure records. It does NOT issue disaster warnings, declare landslide/flood hazards, or designate official evacuation sites. Official hazard assessments, forecasts, and emergency directives belong exclusively to BNPB, ${REGION.authorities.bpbdLabel}, BMKG, PVMBG, and ${REGION.authorities.localAuthorityShort}.`
                      : `Aplikasi ini hanya berfungsi sebagai media tampilan data spasial terbuka, komputasi topografi (HAND / D8 / SCS-CN), dan inventaris saluran lapangan. Aplikasi ini TIDAK menetapkan status bahaya, potensi longsor/banjir, maupun titik evakuasi resmi. Seluruh pernyataan potensi bahaya, peringatan dini cuaca, dan arahan evakuasi hanya bersumber dari BNPB, ${REGION.authorities.bpbdLabel}, BMKG, PVMBG, peneliti berwenang, serta ${REGION.authorities.localAuthorityShort}.`}
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
                    {isEn
                      ? '2. 1D Muskingum-Cunge Routing & DEMNAS Rating Curves:'
                      : '2. Penelusuran 1D Muskingum-Cunge & Kurva Kapasitas DEMNAS:'}
                  </strong>{' '}
                  {isEn
                    ? 'Priority-Flood D8 routing builds a reach network with full-resolution HAND Synthetic Rating Curves (overridden by field-measured cross-sections), directional upstream culvert backwater, coupled leakage-free Infinite-Slope stability (FoS) with ~20° downslope shadow and debris bulking, and a 7-scenario sensitivity ensemble (soil/channel parameters + ±25% rainfall).'
                    : 'Penelusuran Priority-Flood D8 membentuk jaringan segmen sungai dengan Synthetic Rating Curves HAND beresolusi penuh (mengikuti ukuran penampang lapangan bila tersedia), efek balik air (backwater) arah hulu di gorong-gorong, analisis kestabilan lereng Infinite-Slope (FoS) dengan bayangan lintasan ~20° dan pengali sedimen, serta ansambel sensitivitas 7 skenario (parameter + ±25% hujan).'}
                </p>
                <p className="m-0 text-[13px] text-[#434d49]">
                  <strong className="text-[#161c1a]">
                    {isEn ? '3. Independent Validation & Accuracy Limits:' : '3. Validasi Independen & Batas Akurasi:'}
                  </strong>{' '}
                  {isEn
                    ? 'Model outputs are benchmarked independently against Sentinel-2 river-corridor NDVI scour, held-out Pemkab Agam polygons, and field High-Water Marks without leaking reference polygons into the physics formulas. Use Detailed mode → Editor to enter measured channel/culvert dimensions and raise Input Completeness.'
                    : 'Keluaran model diuji secara independen terhadap perubahan vegetasi koridor sungai Sentinel-2, poligon terbuka Pemkab Agam (dipisah dari rumus fisika), serta tanda tinggi air lapangan. Gunakan mode Lengkap → Editor untuk memasukkan ukuran saluran/gorong-gorong nyata dan melengkapi Input Model.'}
                </p>
              </div>

              <div
                data-testid="method-scientific-refs"
                className="flex flex-col gap-2.5 rounded-xl border border-[#161c1a]/12 bg-[#fafaf8] p-4"
              >
                <h3 className="m-0 text-[14px] font-bold text-[#161c1a]">
                  {isEn ? 'Formulas & Scientific References' : 'Rumus & Referensi Ilmiah'}
                </h3>
                <p className="m-0 text-[12.5px] text-[#434d49]">
                  {isEn
                    ? 'Every calculation in this simulator uses standard published open-literature equations rather than proprietary forecasting algorithms:'
                    : 'Seluruh perhitungan simulasi menggunakan persamaan baku dari literatur hidrologi & geomorfologi terbuka:'}
                </p>
                <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[12.5px] text-[#434d49]">
                  <li>
                    <strong className="text-[#161c1a]">Priority-Flood DEM Filling:</strong> Barnes, Lehman &amp; Mulla (2014),{' '}
                    <em>Computers &amp; Geosciences</em> 62 — {isEn ? 'acyclic depression conditioning.' : 'pengisian cekungan mikro DEM agar aliran selalu mengalir ke hilir.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">D8 Flow Routing:</strong> O&apos;Callaghan &amp; Mark (1984),{' '}
                    <em>CVGIP</em> 28(3) — {isEn ? 'steepest-descent direction & catchment accumulation.' : 'penentuan arah aliran tercuram ke 8 sel tetangga dan luas DAS.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">HAND &amp; Synthetic Rating Curves (HAND-SRC):</strong> Nobre et al. (2011),{' '}
                    <em>J. Hydrology</em> 404; Zheng et al. (2018), <em>JAWRA</em> 54(4) —{' '}
                    {isEn ? 'relative height above nearest drainage and stage–discharge curves.' : 'tinggi medan terhadap alur terdekat serta kurva hubungan tinggi air–debit.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">SCS Curve Number (SCS-CN):</strong> USDA NRCS (1986 / 2004),{' '}
                    <em>TR-55 &amp; NEH Part 630</em> —{' '}
                    {isEn ? 'surface runoff volume from ESA WorldCover classes & 5-day antecedent moisture.' : 'volume limpasan dari tutupan lahan ESA WorldCover dan kebasahan tanah awal.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">Continuous SCS-CN Soil-Moisture Accounting &amp; Bankfull Containment:</strong> Michel, Vazken &amp; Perrin (2005),{' '}
                    <em>Water Resour. Res.</em> 41 —{' '}
                    {isEn
                      ? 'progressive Andosol soil-storage saturation over multi-day storms and incised bankfull channel depth containment under normal showers.'
                      : 'penjenuhan bertahap simpanan tanah vulkanik Andosol saat hujan menerus multi-hari serta daya tampung alur sungai normal sebelum meluap.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">1D Muskingum-Cunge &amp; Manning Formula:</strong> Cunge (1969),{' '}
                    <em>J. Hydraulic Research</em> 7(2); Manning (1891) —{' '}
                    {isEn ? 'reach-by-reach hydrograph routing Q (m³/s) and bankfull channel capacity.' : 'penelusuran hidrograf debit Q (m³/s) per segmen sungai dan kapasitas penampang saluran.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">Culvert Hydraulics (HDS-5):</strong> US FHWA (2012),{' '}
                    <em>Hydraulic Design of Highway Culverts</em> —{' '}
                    {isEn ? 'orifice inlet control and upstream backwater head at road crossings.' : 'kapasitas mulut gorong-gorong dan kenaikan air arah hulu akibat hambatan.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">Infinite-Slope Stability (FoS):</strong> Skempton &amp; DeLory (1957); Montgomery &amp; Dietrich (1994),{' '}
                    <em>Water Resour. Res.</em> 30(4) —{' '}
                    {isEn ? 'coupled terrain slope, soil cohesion, root strength, and pore saturation.' : 'rasio tahanan geser tanah & akar vegetasi terhadap kemiringan lereng jenuh air.'}
                  </li>
                  <li>
                    <strong className="text-[#161c1a]">Debris Bulking &amp; Stream Power (ω):</strong> Takahashi (1991); Bagnold (1966),{' '}
                    <em>USGS Prof. Paper 422-I</em> —{' '}
                    {isEn ? 'sediment bulking 1/(1 − Cv) and specific stream power ω = ρgQS/W.' : 'pengali volume sedimen 1/(1 − Cv) dan energi erosi tebing ω = ρgQS/W.'}
                  </li>
                </ul>

                <div className="mt-1 rounded-lg border border-[#161c1a]/12 bg-white p-3 text-[12px] text-[#434d49]">
                  <strong className="mb-1.5 block text-[12.5px] text-[#161c1a]">
                    {isEn
                      ? 'Conceptual Priors & Known Model Limitations (What This Model Does NOT Simulate)'
                      : 'Parameterisasi Konseptual & Batas Model (Yang TIDAK Disimulasikan)'}
                  </strong>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-4.5">
                    <li>
                      <strong className="text-[#161c1a]">
                        {isEn ? 'Uncalibrated conceptual priors:' : 'Konstanta konseptual belum terkalibrasi:'}
                      </strong>{' '}
                      {isEn
                        ? 'Volcanic Andosol retention multipliers, dual-reservoir interflow lags, and incised bankfull depths are literature-inspired conceptual priors — not site-fitted against live gauges.'
                        : 'Faktor simpanan tanah Andosol, jeda aliran bawah permukaan, dan kedalaman tampung alur normal merupakan perkiraan konseptual sebelum ada pengukuran AWLR lapangan.'}
                    </li>
                    <li>
                      <strong className="text-[#161c1a]">
                        {isEn ? '1D HAND vs. 2D channel avulsion:' : 'Model 1D HAND (tanpa pindah alur 2D / avulsion):'}
                      </strong>{' '}
                      {isEn
                        ? 'HAND projects 1D water stage onto nearby valley pixels; it cannot model 2D momentum or debris flows jumping riverbanks down roads.'
                        : 'HAND memproyeksikan tinggi muka air 1D ke lembah sekitar; tidak mensimulasikan aliran bebas 2D maupun luapan galodo yang berpindah jalur mengikuti badan jalan.'}
                    </li>
                    <li>
                      <strong className="text-[#161c1a]">
                        {isEn ? 'Slope initiation & geometric shadow vs. debris rheology:' : 'Inisiasi lereng & bayangan geometris (bukan reologi lumpur):'}
                      </strong>{' '}
                      {isEn
                        ? 'Infinite-Slope FoS locates steep initiation zones and traces an indicative ~20° downslope shadow; it does not simulate non-Newtonian boulder transport or exact runout volume.'
                        : 'Infinite-Slope FoS memetakan lereng awal yang jenuh dan bayangan lintasan ~20°, bukan dinamika material batu/lumpur non-Newtonian maupun jarak endapan pasti.'}
                    </li>
                    <li>
                      <strong className="text-[#161c1a]">
                        {isEn ? 'Snapshot backwater & IDF envelope:' : 'Efek sumbatan snapshot & batas hujan IDF:'}
                      </strong>{' '}
                      {isEn
                        ? 'Culvert backwater and debris surge are snapshot approximations rather than dynamic dam-break reservoir storage; slider intensity is capped by an upper-bound West Sumatra IDF curve.'
                        : 'Kenaikan muka air hulu gorong-gorong dan lonjakan sumbatan bersifat perkiraan sesaat (bukan perambatan jebolnya bendungan alami secara dinamis); slider hujan dibatasi kurva wajar IDF.'}
                    </li>
                  </ul>
                </div>

                <div
                  data-testid="method-parameter-audit"
                  className="mt-1 flex flex-col gap-3 rounded-xl border border-[#161c1a]/14 bg-white p-3.5 text-[12px] text-[#434d49]"
                >
                  <div>
                    <h4 className="m-0 text-[13px] font-bold text-[#161c1a]">
                      {isEn
                        ? 'Climate Calibration & Audit of Every Simulation Number'
                        : 'Kalibrasi Iklim & Sumber Semua Angka Simulasi'}
                    </h4>
                    <p className="mt-1 mb-0 text-[12px] text-[#434d49]">
                      {isEn
                        ? `Rainfall scenarios combine 41 years of Open-Meteo ERA5-Land daily rainfall (${CLIMATE_BASELINE.era5Series.period}, n=${CLIMATE_BASELINE.era5Series.daysCount.toLocaleString()} days) bias-corrected (×${CLIMATE_BASELINE.era5Series.biasFactor}) against official BMKG Data Online monthly files, because free BMKG downloads provide 2-year monthly summaries rather than ≥20-year daily gauges.`
                        : `Skenario curah hujan menggabungkan seri harian ERA5-Land Open-Meteo 41 tahun (${CLIMATE_BASELINE.era5Series.period}, n=${CLIMATE_BASELINE.era5Series.daysCount.toLocaleString()} hari) yang dikoreksi bias (×${CLIMATE_BASELINE.era5Series.biasFactor}) terhadap berkas bulanan resmi BMKG Data Online (akun terbuka hanya menyediakan rekap bulanan 2 tahun, belum seri harian ≥20 tahun).`}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {CLIMATE_BASELINE.bmkgStations.map(st => (
                      <div key={st.wmoId} className="rounded-lg border border-[#161c1a]/12 bg-[#fafaf8] p-2.5">
                        <div className="text-[12px] font-bold text-[#161c1a]">
                          {st.name} (WMO {st.wmoId})
                        </div>
                        <div className="text-[11px] text-[#636f6a]">
                          {st.elevationM} mdpl · {st.distanceKm} km {st.direction} · {st.period} ({st.monthsValid}{' '}
                          {isEn ? 'mo' : 'bln'})
                        </div>
                        <div className="font-mono-num mt-1 text-[11.5px] font-semibold text-[#0369a1]">
                          {isEn
                            ? `Mean ${st.meanMonthlyMm} mm/mo (~${st.estAnnualMm} mm/yr) · Peak ${st.peakMonthlyMm} mm (${st.peakMonth}) · Bias ×${st.era5OverlapRatio}`
                            : `Rata-rata ${st.meanMonthlyMm} mm/bln (~${st.estAnnualMm} mm/thn) · Puncak ${st.peakMonthlyMm} mm (${st.peakMonth}) · Bias ×${st.era5OverlapRatio}`}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-[#161c1a]/12 bg-[#f2f3ef]/70 px-3 py-2 text-[11.5px] text-[#434d49]">
                    <strong className="text-[#161c1a]">
                      {isEn ? 'SNI 2415:2016 Frequency Summary (Balingka 41-yr ×1.073): ' : 'Ringkasan Kala Ulang SNI 2415:2016 (Balingka 41 thn ×1,073): '}
                    </strong>
                    <span className="font-mono-num">
                      1-hari (R24): T10={CLIMATE_BASELINE.returnPeriodsMm.r24.t10Gumbel} mm · T100={CLIMATE_BASELINE.returnPeriodsMm.r24.t100Gumbel} mm (LP3 {CLIMATE_BASELINE.returnPeriodsMm.r24.t100Lp3}) ·{' '}
                      2-hari (R48): T100={CLIMATE_BASELINE.returnPeriodsMm.r48.t100Gumbel} mm ·{' '}
                      3-hari (R72): T100={CLIMATE_BASELINE.returnPeriodsMm.r72.t100Gumbel} mm
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-[#161c1a]/12">
                    <table className="w-full border-collapse text-left text-[11.5px]">
                      <thead>
                        <tr className="border-b border-[#161c1a]/12 bg-[#fafaf8] text-[11px] font-bold text-[#161c1a]">
                          <th className="px-2.5 py-2">{isEn ? 'Parameter' : 'Parameter'}</th>
                          <th className="px-2.5 py-2">{isEn ? 'Value in Model' : 'Nilai di Model'}</th>
                          <th className="px-2.5 py-2">{isEn ? 'Status & Source' : 'Status & Sumber'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#161c1a]/10">
                        {MODEL_PARAMETER_AUDIT.map(row => {
                          const badgeMap: Record<ParameterAuditBadge, { cls: string; labelId: string; labelEn: string }> = {
                            observed: {
                              cls: 'bg-[#047857]/12 text-[#047857]',
                              labelId: 'Observasi Lokal',
                              labelEn: 'Observed Local'
                            },
                            literature: {
                              cls: 'bg-[#0369a1]/12 text-[#0369a1]',
                              labelId: 'Literatur Baku',
                              labelEn: 'Published Literature'
                            },
                            conceptual: {
                              cls: 'bg-[#b45309]/14 text-[#92400e]',
                              labelId: 'Prior Konseptual',
                              labelEn: 'Conceptual Prior'
                            }
                          };
                          const b = badgeMap[row.badge];
                          return (
                            <tr key={row.id} className="align-top">
                              <td className="px-2.5 py-2 font-semibold text-[#161c1a]">
                                {isEn ? row.paramEn : row.paramId}
                              </td>
                              <td className="font-mono-num px-2.5 py-2 text-[#161c1a]">{row.valueText}</td>
                              <td className="px-2.5 py-2 text-[#434d49]">
                                <span className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${b.cls}`}>
                                  {isEn ? b.labelEn : b.labelId}
                                </span>
                                <div>{isEn ? row.sourceEn : row.sourceId}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-1 flex items-start gap-2 rounded-lg border border-[#b45309]/25 bg-[#b45309]/8 px-3 py-2 text-[12px] text-[#78350f]">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b45309]" />
                  <span>
                    {isEn
                      ? 'Transparency notice: This app is developed as an open civic spatial tool, not by a government meteorology/hydrology agency. Because Nagari Balingka has no live stream gauges (AWLR) or full cross-section surveys yet, hydrograph and depth outputs are uncalibrated literature estimates and NOT official hazard forecasts.'
                      : 'Catatan transparansi: Aplikasi ini dikembangkan sebagai alat eksplorasi data spasial terbuka. Karena Nagari Balingka belum memiliki pos duga muka air sungai (AWLR) atau survei penampang menyeluruh, grafik hidrograf dan perkiraan kedalaman merupakan hasil rumus literatur yang belum terkalibrasi lapangan — bukan ramalan cuaca/kebencanaan resmi.'}
                  </span>
                </div>
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
