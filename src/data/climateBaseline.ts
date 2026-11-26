import { resolveSoilProfile, type SoilProfileId } from './soilProfiles.ts';

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

export interface ReturnPeriodBlock {
  max41yr: number;
  t2: number;
  t10Gumbel: number;
  t10Lp3: number;
  t50Gumbel: number;
  t50Lp3: number;
  t100Gumbel: number;
  t100Lp3: number;
}

export interface ClimateBaselineData {
  regionId: string;
  regionName: string;
  bmkgStations: readonly BmkgStationSummary[];
  era5Series: {
    targetCoord: readonly [number, number];
    gridCoord: readonly [number, number];
    gridElevM: number;
    period: string;
    yearsCount: number;
    daysCount: number;
    biasFactor: number;
    rawMeanAnnualMm: number;
    correctedMeanAnnualMm: number;
  };
  returnPeriodsMm: {
    r24: ReturnPeriodBlock;
    r48: ReturnPeriodBlock;
    r72: ReturnPeriodBlock;
  };
  idfCapsMmHr: Record<string, number>;
  bmkgHourlyScale: readonly { maxExclusive: number | null; id: string; en: string }[];
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

export const CLIMATE_BASELINE: ClimateBaselineData = {
  regionId: 'nagari-balingka',
  regionName: 'Nagari Balingka',
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
  idfCapsMmHr: {
    '30': 140,
    '60': 90,
    '120': 60,
    '180': 45,
    '360': 30,
    '720': 18,
    '1440': 12,
    '2160': 9,
    '2880': 8,
    '4320': 6
  },
  bmkgHourlyScale: [
    { maxExclusive: 5, id: 'Ringan', en: 'Light' },
    { maxExclusive: 10, id: 'Sedang', en: 'Moderate' },
    { maxExclusive: 20, id: 'Lebat', en: 'Heavy' },
    { maxExclusive: 50.001, id: 'Sangat Lebat', en: 'Very Heavy' },
    { maxExclusive: null, id: 'Ekstrem', en: 'Extreme' }
  ]
};

export interface AuditRegionMeta {
  name?: string;
  areaKm2?: number;
  officialBoundaryCode?: string;
  regionalOverlays?: {
    enabled?: boolean;
    providerName?: string;
  };
}

export function buildModelParameterAudit(
  baseline: ClimateBaselineData = CLIMATE_BASELINE,
  soilProfileId: SoilProfileId = 'volcanic_andosol',
  region?: AuditRegionMeta
): ParameterAuditEntry[] {
  const soil = resolveSoilProfile(soilProfileId);
  const regionName = region?.name || baseline.regionName || 'Wilayah Studi';
  const areaText = region?.areaKm2 ? `${region.areaKm2} km²` : 'luas wilayah aktif';
  const boundaryCode = region?.officialBoundaryCode ? ` ${region.officialBoundaryCode}` : '';
  const hasBmkg = baseline.bmkgStations.length > 0;
  const bmkgStationsText = baseline.bmkgStations.map(s => `${s.name} (${s.wmoId}, ${s.elevationM} m)`).join(' & ');
  const caps = baseline.idfCapsMmHr || CLIMATE_BASELINE.idfCapsMmHr;
  const rp = baseline.returnPeriodsMm;
  const yearsText = baseline.era5Series.yearsCount > 0 ? `${baseline.era5Series.yearsCount} thn` : 'bawaan';
  const daysText = baseline.era5Series.daysCount > 0 ? `n=${baseline.era5Series.daysCount.toLocaleString()} hari` : 'prior tropis';
  const useCountyOverlay = Boolean(region?.regionalOverlays?.enabled);
  const overlayName = region?.regionalOverlays?.providerName || 'Pemda/BIG';

  return [
    {
      id: 'dem-boundary',
      group: 'rainfall',
      badge: 'observed',
      paramId: `Elevasi DEM & Batas ${regionName}`,
      paramEn: `DEM Elevation & ${regionName} Boundary`,
      valueText: `Grid topografi terbuka · ${areaText}${boundaryCode ? ` · Kode${boundaryCode}` : ''}`,
      sourceId: useCountyOverlay
        ? `BIG DEMNAS, Peta RBI & batas wilayah${boundaryCode} (${regionName}).`
        : `BIG DEMNAS / Copernicus DEM GLO-30 & batas wilayah${boundaryCode} (${regionName}).`,
      sourceEn: useCountyOverlay
        ? `BIG DEMNAS, RBI & official village boundary${boundaryCode} (${regionName}).`
        : `BIG DEMNAS / Copernicus DEM GLO-30 & village boundary${boundaryCode} (${regionName}).`
    },
    {
      id: 'bmkg-monthly',
      group: 'rainfall',
      badge: hasBmkg ? 'observed' : 'literature',
      paramId: hasBmkg ? 'Iklim Lokal Bulanan & Faktor Koreksi Bias' : 'Basis Hujan Reanalisis Harian Lokal',
      paramEn: hasBmkg ? 'Local Monthly Climate & Bias Correction Factor' : 'Local Daily Reanalysis Climate Baseline',
      valueText: hasBmkg
        ? `×${baseline.era5Series.biasFactor} · Puncak ${Math.max(...baseline.bmkgStations.map(s => Math.round(s.peakMonthlyMm)))} mm/bln`
        : `×${baseline.era5Series.biasFactor} · ~${baseline.era5Series.correctedMeanAnnualMm} mm/thn`,
      sourceId: hasBmkg
        ? `Data Online BMKG (${baseline.bmkgStations[0]?.period || 'bulanan'}): ${bmkgStationsText}. Catatan: portal terbuka BMKG menyediakan rekap bulanan 2 tahun.`
        : `Seri harian ERA5-Land Open-Meteo (${baseline.era5Series.period}) pada koordinat pusat ${regionName}; faktor bias ×${baseline.era5Series.biasFactor} tanpa kalibrasi stasiun BMKG lokal.`,
      sourceEn: hasBmkg
        ? `BMKG Data Online (${baseline.bmkgStations[0]?.period || 'monthly'}): ${bmkgStationsText}. Note: free BMKG portal provides 2-yr monthly summaries only.`
        : `Open-Meteo ERA5-Land daily series (${baseline.era5Series.period}) at ${regionName}; bias factor ×${baseline.era5Series.biasFactor} (no local BMKG gauge factor configured).`
    },
    {
      id: 'era5-idf',
      group: 'rainfall',
      badge: baseline.era5Series.yearsCount > 0 ? 'observed' : 'literature',
      paramId: 'Batas Atas Hujan Multi-Durasi (IDF Mononobe)',
      paramEn: 'Multi-Duration Rainfall Upper Envelope (Mononobe IDF)',
      valueText: `2j ≤${caps['120'] ?? 60} · 3j ≤${caps['180'] ?? 45} · 6j ≤${caps['360'] ?? 30} · 24j ≤${caps['1440'] ?? 12} · 48j ≤${caps['2880'] ?? 8} · 72j ≤${caps['4320'] ?? 6} mm/jam`,
      sourceId: `Seri harian ERA5-Land Open-Meteo ${yearsText} (${baseline.era5Series.period}, ${daysText}) ×${baseline.era5Series.biasFactor}; Gumbel/LP3 SNI 2415:2016 (R24_100=${rp.r24.t100Gumbel} mm, R48_100=${rp.r48.t100Gumbel} mm, R72_100=${rp.r72.t100Gumbel} mm) + Mononobe sub-harian.`,
      sourceEn: `${yearsText} Open-Meteo ERA5-Land daily series (${baseline.era5Series.period}) ×${baseline.era5Series.biasFactor}; SNI 2415:2016 Gumbel/LP3 (R24_100=${rp.r24.t100Gumbel} mm, R48_100=${rp.r48.t100Gumbel} mm, R72_100=${rp.r72.t100Gumbel} mm) + Mononobe sub-daily scaling.`
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
      sourceId: 'ESA WorldCover 10m v200 dipetakan ke tabel USDA NRCS TR-55 / NEH-630 serta skema kontinu Soil Moisture Accounting (Michel, Vazken & Perrin, 2005).',
      sourceEn: 'ESA WorldCover 10m v200 mapped to USDA NRCS TR-55 / NEH-630 tables with continuous Soil Moisture Accounting (Michel, Vazken & Perrin, 2005).'
    },
    {
      id: 'interflow-bankfull',
      group: 'hydraulics',
      badge: 'conceptual',
      paramId: `Kedalaman Alur Normal & Perkolasi (${soil.labelId})`,
      paramEn: `Bankfull Channel Incision & Percolation (${soil.labelEn})`,
      valueText: `Alur 0,40–0,88 m · Perkolasi ${soil.percolationBaseMmHr.toFixed(1)}–${(soil.percolationBaseMmHr + soil.percolationForestMmHr + soil.percolationUplandMmHr).toFixed(1)} mm/jam · Manning n = 0,035–0,065`,
      sourceId: `Prior konseptual aliran bawah permukaan 2-reservoir (${soil.labelId}) dan geometri alur terbuka; belum diukur dengan AWLR atau survei penampang menyeluruh di ${regionName}.`,
      sourceEn: `Conceptual dual-reservoir interflow lag (${soil.labelEn}) and incised bankfull geometry prior; uncalibrated without local AWLR stream gauges or full cross-section surveys in ${regionName}.`
    },
    {
      id: 'culvert-hds5',
      group: 'hydraulics',
      badge: 'literature',
      paramId: 'Hidrolika Mulut Gorong-gorong & Persentase Sumbatan',
      paramEn: 'Culvert Inlet Orifice & Blockage Ratios',
      valueText: 'Cd = 0,62 · Sumbatan skenario 5% / 65% / 78%',
      sourceId: 'Persamaan kontrol mulut gorong-gorong US FHWA HDS-5 (2012); persentase sumbatan dan lonjakan sedimen 1/(1−Cv) (Takahashi, 1991) merupakan asumsi skenario pengguna/literatur.',
      sourceEn: 'US FHWA HDS-5 (2012) inlet orifice equation; blockage % and Takahashi (1991) sediment bulking 1/(1−Cv) act as literature/scenario priors.'
    },
    {
      id: 'fos-geotech',
      group: 'slope',
      badge: 'conceptual',
      paramId: `Kestabilan Lereng Infinite-Slope (${soil.labelId})`,
      paramEn: `Infinite-Slope FoS & Pore Coupling (${soil.labelEn})`,
      valueText: `γ=${soil.gammaS} kN/m³, c′=${soil.cSoilKpa} kPa, φ′=${soil.phiDeg}°, n_e≈${(soil.drainablePorosityMmPerM / 1000).toFixed(3)} · Jenuh 130–270 mm · ~20°`,
      sourceId: useCountyOverlay
        ? `Model Skempton–DeLory (1957) & Montgomery–Dietrich (1994) terkopel kausal dengan kebasahan SMA SCS-CN di atas peta tanah/geologi ${overlayName}; batas jenuh Caine (1980)/Guzzetti (2008) bersifat prior tanpa uji bor tanah.`
        : `Model Skempton–DeLory (1957) & Montgomery–Dietrich (1994) terkopel kausal dengan SMA SCS-CN memakai preset tanah ${soil.labelId} (tanpa uji bor/laboratorium lokal).`,
      sourceEn: useCountyOverlay
        ? `Skempton–DeLory (1957) & Montgomery–Dietrich (1994) causally coupled to SCS-CN SMA wetness over ${overlayName} soil/lithology polygons; Caine (1980)/Guzzetti (2008) thresholds lack borehole shear tests.`
        : `Skempton–DeLory (1957) & Montgomery–Dietrich (1994) causally coupled to SCS-CN SMA wetness using ${soil.labelEn} prior preset (no local borehole shear tests).`
    },
    {
      id: 'readiness-ensemble',
      group: 'confidence',
      badge: 'conceptual',
      paramId: 'Rentang Sensitivitas 7-Skenario & Batas Kesiapan Input',
      paramEn: '7-Scenario Sensitivity Envelope & Readiness Score Cap',
      valueText: '±25% hujan + variasi CN/Manning/geotek (Rendah/Tengah/Tinggi) · Maks 44/100',
      sourceId: 'Rentang sensitivitas deterministik 7 skenario (bukan persentil statistik P10–P90) dan uji silang blok spasial 50/50. Skor kesiapan dikunci ≤44/100 sampai minimal 3 Tanda Muka Air (HWM) dan penampang saluran terukur diunggah lewat Editor.',
      sourceEn: '7-scenario deterministic sensitivity envelope (Low/Central/High, not statistical P10–P90 percentiles) with 50/50 spatial-block holdout check. Input Readiness stays capped ≤44/100 until ≥3 field HWMs and measured cross-sections are saved.'
    }
  ];
}

export const MODEL_PARAMETER_AUDIT: ParameterAuditEntry[] = buildModelParameterAudit(CLIMATE_BASELINE, 'volcanic_andosol');
