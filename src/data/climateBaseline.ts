export type ParameterAuditGroup = 'rainfall' | 'runoff' | 'hydraulics' | 'slope' | 'confidence';
export type ParameterAuditBadge = 'observed' | 'literature' | 'conceptual';

export interface BmkgStationSummary {
  wmoId: string;
  name: string;
  elevationM: number;
  distanceKm: number;
  direction: string;
  period: string;
  monthsValid: number;
  meanMonthlyMm: number;
  estAnnualMm: number;
  peakMonthlyMm: number;
  peakMonth: string;
  meanRhPct: number;
  meanTempC: number;
  era5OverlapRatio: number;
}

export interface ParameterAuditEntry {
  id: string;
  group: ParameterAuditGroup;
  badge: ParameterAuditBadge;
  paramId: string;
  paramEn: string;
  valueText: string;
  sourceId: string;
  sourceEn: string;
}

export const CLIMATE_BASELINE = {
  bmkgStations: [
    {
      wmoId: '96165',
      name: 'Stasiun Geofisika Padang Panjang',
      elevationM: 735,
      distanceKm: 15.0,
      direction: 'SE',
      period: '2025-02 – 2026-09',
      monthsValid: 20,
      meanMonthlyMm: 320.2,
      estAnnualMm: 3842,
      peakMonthlyMm: 1027.8,
      peakMonth: '2025-11',
      meanRhPct: 90.0,
      meanTempC: 22.4,
      era5OverlapRatio: 1.133
    },
    {
      wmoId: '96167',
      name: 'Stasiun Klimatologi Sumatera Barat (Sicincin)',
      elevationM: 128,
      distanceKm: 22.3,
      direction: 'S',
      period: '2024-11 – 2026-09',
      monthsValid: 23,
      meanMonthlyMm: 347.0,
      estAnnualMm: 4164,
      peakMonthlyMm: 1184.6,
      peakMonth: '2025-11',
      meanRhPct: 85.7,
      meanTempC: 25.9,
      era5OverlapRatio: 1.012
    }
  ] satisfies BmkgStationSummary[],
  era5Series: {
    targetCoord: [-0.345, 100.319] as [number, number],
    gridCoord: [-0.3163, 100.3359] as [number, number],
    gridElevM: 1238,
    period: '1985-01-01 – 2025-12-31',
    yearsCount: 41,
    daysCount: 14975,
    biasFactor: 1.073,
    rawMeanAnnualMm: 3919,
    correctedMeanAnnualMm: 4203
  },
  returnPeriodsMm: {
    r24: {
      max41yr: 222,
      t2: 109,
      t10Gumbel: 175,
      t10Lp3: 170,
      t50Gumbel: 234,
      t50Lp3: 218,
      t100Gumbel: 259,
      t100Lp3: 238
    },
    r48: {
      max41yr: 306,
      t2: 153,
      t10Gumbel: 235,
      t10Lp3: 227,
      t50Gumbel: 306,
      t50Lp3: 283,
      t100Gumbel: 337,
      t100Lp3: 306
    },
    r72: {
      max41yr: 337,
      t2: 183,
      t10Gumbel: 270,
      t10Lp3: 262,
      t50Gumbel: 348,
      t50Lp3: 320,
      t100Gumbel: 380,
      t100Lp3: 342
    }
  },
  bmkgHourlyScale: [
    { maxExclusive: 5, id: 'Ringan', en: 'Light' },
    { maxExclusive: 10, id: 'Sedang', en: 'Moderate' },
    { maxExclusive: 20, id: 'Lebat', en: 'Heavy' },
    { maxExclusive: 50.001, id: 'Sangat Lebat', en: 'Very Heavy' },
    { maxExclusive: Infinity, id: 'Ekstrem', en: 'Extreme' }
  ]
} as const;

export const MODEL_PARAMETER_AUDIT: ParameterAuditEntry[] = [
  {
    id: 'dem-boundary',
    group: 'rainfall',
    badge: 'observed',
    paramId: 'Elevasi DEMNAS & Batas Resmi Nagari',
    paramEn: 'DEMNAS Elevation & Official Nagari Boundary',
    valueText: '8,3–13,8 m grid · 1.032–2.869 mdpl · 29,89 km² (2.175 bangunan)',
    sourceId: 'BIG DEMNAS, Peta RBI 1:50k (Des 2022) & Batas Desa BIG 13.06.05.2003 (Jun 2026)',
    sourceEn: 'BIG DEMNAS, RBI 1:50k (Dec 2022) & BIG Village Boundary 13.06.05.2003 (Jun 2026)'
  },
  {
    id: 'bmkg-monthly',
    group: 'rainfall',
    badge: 'observed',
    paramId: 'Iklim Lokal Bulanan & Faktor Koreksi Bias',
    paramEn: 'Local Monthly Climate & Bias Correction Factor',
    valueText: '×1,073 · Puncak Nov 2025: 1.028 mm (96165) & 1.185 mm (96167)',
    sourceId:
      'Data Online BMKG (Nov 2024–Sep 2026): Stamet/Geof Padang Panjang (96165, 735 m) & Staklim Sumbar/Sicincin (96167, 128 m). Catatan: akun terbuka BMKG hanya menyediakan rekap bulanan 2 tahun.',
    sourceEn:
      'BMKG Data Online (Nov 2024–Sep 2026): Padang Panjang (96165, 735 m) & Sicincin (96167, 128 m). Note: free BMKG portal provides 2-yr monthly summaries only.'
  },
  {
    id: 'era5-idf',
    group: 'rainfall',
    badge: 'observed',
    paramId: 'Batas Atas Hujan Multi-Durasi (IDF Mononobe)',
    paramEn: 'Multi-Duration Rainfall Upper Envelope (Mononobe IDF)',
    valueText: '2j ≤60 · 3j ≤45 · 6j ≤30 · 24j ≤12 (288 mm) · 48j ≤8 (384 mm) · 72j ≤6 mm/jam',
    sourceId:
      'Seri harian ERA5-Land Open-Meteo 41 thn (1985–2025, n=14.975 hari) ×1,073 BMKG; Gumbel/LP3 SNI 2415:2016 (R24_100=259 mm, R48_100=337 mm, R72_100=380 mm) + diskritisasi Mononobe untuk durasi sub-harian.',
    sourceEn:
      '41-yr Open-Meteo ERA5-Land daily series (1985–2025, n=14,975 days) ×1.073 BMKG bias; SNI 2415:2016 Gumbel/LP3 (R24_100=259 mm, R48_100=337 mm, R72_100=380 mm) + Mononobe sub-daily scaling.'
  },
  {
    id: 'bmkg-hourly',
    group: 'rainfall',
    badge: 'literature',
    paramId: 'Kategori Intensitas Hujan Per Jam',
    paramEn: 'Hourly Rainfall Intensity Classes',
    valueText: 'Ringan <5 · Sedang 5–<10 · Lebat 10–<20 · Sangat Lebat 20–50 · Ekstrem >50 mm/jam',
    sourceId: 'Standar operasional intensitas curah hujan per jam BMKG.',
    sourceEn: 'Official BMKG operational hourly rainfall intensity classification.'
  },
  {
    id: 'scs-cn',
    group: 'runoff',
    badge: 'literature',
    paramId: 'Limpasan Permukaan SCS-CN & Kebasahan Awal (P5)',
    paramEn: 'SCS-CN Runoff & 5-Day Antecedent Moisture (P5)',
    valueText: 'CN2 55–90 · P5 = 15 / 45 / 150 mm (Kering / Lembap / Jenuh)',
    sourceId:
      'ESA WorldCover 10m v200 dipetakan ke tabel USDA NRCS TR-55 / NEH-630 serta skema kontinu Soil Moisture Accounting (Michel, Vazken & Perrin, 2005).',
    sourceEn:
      'ESA WorldCover 10m v200 mapped to USDA NRCS TR-55 / NEH-630 tables with continuous Soil Moisture Accounting (Michel, Vazken & Perrin, 2005).'
  },
  {
    id: 'interflow-bankfull',
    group: 'hydraulics',
    badge: 'conceptual',
    paramId: 'Kedalaman Alur Normal (Bankfull) & Perkolasi Andosol',
    paramEn: 'Bankfull Channel Incision & Andosol Percolation/Lag',
    valueText: 'Alur 0,40–0,88 m (atau 0,85× terukur) · Perkolasi 0,9–2,4 mm/jam · Manning n = 0,035–0,065',
    sourceId:
      'Prior konseptual aliran bawah permukaan 2-reservoir dan geometri alur vulkanik; belum diukur dengan AWLR atau survei penampang menyeluruh di Nagari Balingka.',
    sourceEn:
      'Conceptual dual-reservoir volcanic interflow lag and incised bankfull geometry prior; uncalibrated without local AWLR stream gauges or full cross-section surveys.'
  },
  {
    id: 'culvert-hds5',
    group: 'hydraulics',
    badge: 'literature',
    paramId: 'Hidrolika Mulut Gorong-gorong & Persentase Sumbatan',
    paramEn: 'Culvert Inlet Orifice & Blockage Ratios',
    valueText: 'Cd = 0,62 · Sumbatan skenario 5% / 65% / 78%',
    sourceId:
      'Persamaan kontrol mulut gorong-gorong US FHWA HDS-5 (2012); persentase sumbatan dan lonjakan sedimen 1/(1−Cv) (Takahashi, 1991) merupakan asumsi skenario pengguna/literatur.',
    sourceEn:
      'US FHWA HDS-5 (2012) inlet orifice equation; blockage % and Takahashi (1991) sediment bulking 1/(1−Cv) act as literature/scenario priors.'
  },
  {
    id: 'fos-geotech',
    group: 'slope',
    badge: 'conceptual',
    paramId: 'Kestabilan Lereng Infinite-Slope & Ambang Jenuh Hujan',
    paramEn: 'Infinite-Slope FoS & Cumulative Saturation Threshold',
    valueText: 'Andosol γ=17,4 kN/m³, c′=2,0 kPa, φ′=27,5°, n_e≈0,155 (155 mm/m) · Jenuh 130–270 mm · ~20°',
    sourceId:
      'Model Skempton–DeLory (1957) & Montgomery–Dietrich (1994) terkopel kausal dengan kebasahan SMA SCS-CN di atas poligon tanah/geologi Pemkab Agam; porositas aktif & batas jenuh Caine (1980)/Guzzetti (2008) bersifat prior tanpa uji bor tanah.',
    sourceEn:
      'Skempton–DeLory (1957) & Montgomery–Dietrich (1994) causally coupled to SCS-CN SMA wetness over Pemkab Agam soil/lithology polygons; drainable porosity & Caine (1980)/Guzzetti (2008) wetting thresholds lack borehole shear tests.'
  },
  {
    id: 'readiness-ensemble',
    group: 'confidence',
    badge: 'conceptual',
    paramId: 'Rentang Sensitivitas 7-Skenario & Batas Kesiapan Input',
    paramEn: '7-Scenario Sensitivity Envelope & Readiness Score Cap',
    valueText: '±25% hujan + variasi CN/Manning/geotek (Rendah/Tengah/Tinggi) · Maks 44/100',
    sourceId:
      'Rentang sensitivitas deterministik 7 skenario (bukan persentil statistik P10–P90) dan uji silang blok spasial 50/50. Skor kesiapan dikunci ≤44/100 sampai minimal 3 Tanda Muka Air (HWM) dan penampang saluran terukur diunggah lewat Editor.',
    sourceEn:
      '7-scenario deterministic sensitivity envelope (Low/Central/High, not statistical P10–P90 percentiles) with 50/50 spatial-block holdout check. Input Readiness stays capped ≤44/100 until ≥3 field HWMs and measured cross-sections are saved.'
  }
];
