import fs from 'node:fs';
import path from 'node:path';

export const STANDARD_IDF_DURATIONS_MIN = [30, 60, 120, 180, 360, 720, 1440, 2160, 2880, 4320];

export const DEFAULT_TROPICAL_IDF_CAPS = {
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
};

export const OFFICIAL_BMKG_HOURLY_SCALE = [
  { maxExclusive: 5, id: 'Ringan', en: 'Light' },
  { maxExclusive: 10, id: 'Sedang', en: 'Moderate' },
  { maxExclusive: 20, id: 'Lebat', en: 'Heavy' },
  { maxExclusive: 50.001, id: 'Sangat Lebat', en: 'Very Heavy' },
  { maxExclusive: null, id: 'Ekstrem', en: 'Extreme' }
];

function roundToSliderStep(val) {
  if (val <= 24) return Math.max(4, Math.ceil(val));
  return Math.max(25, Math.min(180, Math.ceil(val / 5) * 5));
}

/**
 * Extracts valid annual 1-day, 2-day, and 3-day maxima and mean annual rainfall
 * from daily precipitation series (requiring >=300 valid days per calendar year).
 */
export function computeAnnualMaxima(dailyDates, dailyMm) {
  const byYear = new Map();
  let totalValidDays = 0;

  for (let i = 0; i < dailyDates.length; i++) {
    const val = dailyMm[i];
    if (val == null || !Number.isFinite(val) || val < 0) continue;
    const year = String(dailyDates[i]).slice(0, 4);
    if (!year || year.length < 4) continue;
    const r2 = i >= 1 && dailyMm[i - 1] != null ? val + dailyMm[i - 1] : val;
    const r3 = i >= 2 && dailyMm[i - 1] != null && dailyMm[i - 2] != null ? val + dailyMm[i - 1] + dailyMm[i - 2] : r2;
    let st = byYear.get(year);
    if (!st) {
      st = { count: 0, sum: 0, max1: 0, max2: 0, max3: 0 };
      byYear.set(year, st);
    }
    st.count++;
    st.sum += val;
    if (val > st.max1) st.max1 = val;
    if (r2 > st.max2) st.max2 = r2;
    if (r3 > st.max3) st.max3 = r3;
    totalValidDays++;
  }

  const annualMax1d = [];
  const annualMax2d = [];
  const annualMax3d = [];
  let sumAnnual = 0;
  let yearsCount = 0;

  for (const [, st] of [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (st.count < 300) continue;
    annualMax1d.push(st.max1);
    annualMax2d.push(st.max2);
    annualMax3d.push(st.max3);
    sumAnnual += st.sum;
    yearsCount++;
  }

  return {
    annualMax1d,
    annualMax2d,
    annualMax3d,
    meanAnnualMm: yearsCount > 0 ? Math.round(sumAnnual / yearsCount) : 0,
    yearsCount,
    daysCount: totalValidDays
  };
}

/**
 * SNI 2415:2016 Gumbel Type I extremal distribution quantiles using sample mean and std dev.
 */
export function computeGumbelQuantiles(annualMax) {
  const vals = annualMax.filter(v => Number.isFinite(v) && v > 0);
  const n = vals.length;
  if (n === 0) return { maxObs: 0, t2: 0, t10: 0, t50: 0, t100: 0 };

  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / Math.max(1, n - 1);
  const sd = Math.sqrt(Math.max(1e-6, variance));

  const yn = 0.5772;
  const sn = 1.28255;
  const qOfT = T => {
    const yt = -Math.log(-Math.log(1 - 1 / T));
    const kt = (yt - yn) / sn;
    return Math.round(Math.max(0, mean + kt * sd));
  };

  return {
    maxObs: Math.round(Math.max(...vals)),
    t2: qOfT(2),
    t10: qOfT(10),
    t50: qOfT(50),
    t100: qOfT(100)
  };
}

/**
 * SNI 2415:2016 Log-Pearson Type III (LP3) frequency quantiles with Wilson-Hilferty approximation.
 */
export function computeLp3Quantiles(annualMax) {
  const logs = annualMax.filter(v => Number.isFinite(v) && v > 0).map(v => Math.log10(v));
  const n = logs.length;
  if (n < 3) return { t10: 0, t50: 0, t100: 0 };

  const meanL = logs.reduce((a, b) => a + b, 0) / n;
  const s2 = logs.reduce((acc, l) => acc + (l - meanL) * (l - meanL), 0) / Math.max(1, n - 1);
  const sdL = Math.sqrt(Math.max(1e-8, s2));
  const m3 = logs.reduce((acc, l) => acc + Math.pow(l - meanL, 3), 0);
  const cs = (n * m3) / Math.max(1e-8, (n - 1) * (n - 2) * Math.pow(sdL, 3));

  const kOf = (z, skew) => {
    if (Math.abs(skew) < 1e-4) return z;
    const k = skew / 6;
    const k2 = k * k;
    return z + (z * z - 1) * k + (1 / 3) * (z * z * z - 6 * z) * k2 - (z * z - 1) * k2 * k + z * Math.pow(k, 4) + (1 / 3) * Math.pow(k, 5);
  };

  // Standard normal variates for exceedance probabilities 1/10, 1/50, 1/100
  return {
    t10: Math.round(Math.pow(10, meanL + kOf(1.28155, cs) * sdL)),
    t50: Math.round(Math.pow(10, meanL + kOf(2.05375, cs) * sdL)),
    t100: Math.round(Math.pow(10, meanL + kOf(2.32635, cs) * sdL))
  };
}

/**
 * Computes physical upper-bound rainfall intensity caps (mm/hr) from 100-year 24/48/72h totals
 * using Mononobe scaling for sub-daily durations (I = (R24/24) * (24/t)^(2/3)).
 */
export function deriveMononobeIdfEnvelope(returnPeriodsMm) {
  const r24Base = Math.max(80, returnPeriodsMm?.r24?.t100Gumbel || 200);
  const r48Base = Math.max(r24Base * 1.15, returnPeriodsMm?.r48?.t100Gumbel || Math.round(r24Base * 1.3));
  const r72Base = Math.max(r48Base * 1.05, returnPeriodsMm?.r72?.t100Gumbel || Math.round(r24Base * 1.45));

  const caps = {};
  for (const durMin of STANDARD_IDF_DURATIONS_MIN) {
    const hr = durMin / 60;
    let rawRate;
    if (durMin <= 1440) {
      rawRate = (r24Base / 24) * Math.pow(24 / hr, 2 / 3);
      // Realistic upper clamp on 30-min convective burst intensity
      if (durMin === 30) rawRate = Math.min(180, Math.max(70, rawRate * 0.96));
    } else if (durMin === 2160) {
      const r36 = (r24Base + r48Base) * 0.52;
      rawRate = (r36 / 36) * 1.08;
    } else if (durMin === 2880) {
      rawRate = (r48Base / 48) * 1.12;
    } else {
      rawRate = (r72Base / 72) * 1.12;
    }
    caps[String(durMin)] = roundToSliderStep(rawRate);
  }
  return caps;
}

/**
 * Builds a complete, reproducible ClimateBaselineData object from raw daily rainfall arrays.
 */
export function buildClimateBaselineFromDailySeries({
  regionId,
  regionName,
  targetCoord,
  gridCoord,
  gridElevM = 0,
  dailyDates,
  dailyMm,
  biasFactor = 1.0,
  bmkgStations = []
}) {
  const safeBias = Number.isFinite(biasFactor) && biasFactor > 0.2 ? Number(biasFactor) : 1.0;
  const rawMax = computeAnnualMaxima(dailyDates, dailyMm);
  const correctedDaily = dailyMm.map(v => (v == null || !Number.isFinite(v) ? v : v * safeBias));
  const corrMax = computeAnnualMaxima(dailyDates, correctedDaily);

  const g1 = computeGumbelQuantiles(corrMax.annualMax1d);
  const lp1 = computeLp3Quantiles(corrMax.annualMax1d);
  const g2 = computeGumbelQuantiles(corrMax.annualMax2d);
  const lp2 = computeLp3Quantiles(corrMax.annualMax2d);
  const g3 = computeGumbelQuantiles(corrMax.annualMax3d);
  const lp3 = computeLp3Quantiles(corrMax.annualMax3d);

  const period =
    dailyDates.length >= 2
      ? `${dailyDates[0]} – ${dailyDates[dailyDates.length - 1]}`
      : '1985-01-01 – 2025-12-31';

  const returnPeriodsMm = {
    r24: {
      max41yr: g1.maxObs,
      t2: g1.t2,
      t10Gumbel: g1.t10,
      t10Lp3: lp1.t10,
      t50Gumbel: g1.t50,
      t50Lp3: lp1.t50,
      t100Gumbel: g1.t100,
      t100Lp3: lp1.t100
    },
    r48: {
      max41yr: g2.maxObs,
      t2: g2.t2,
      t10Gumbel: g2.t10,
      t10Lp3: lp2.t10,
      t50Gumbel: g2.t50,
      t50Lp3: lp2.t50,
      t100Gumbel: g2.t100,
      t100Lp3: lp2.t100
    },
    r72: {
      max41yr: g3.maxObs,
      t2: g3.t2,
      t10Gumbel: g3.t10,
      t10Lp3: lp3.t10,
      t50Gumbel: g3.t50,
      t50Lp3: lp3.t50,
      t100Gumbel: g3.t100,
      t100Lp3: lp3.t100
    }
  };

  return {
    regionId: String(regionId || 'custom-region'),
    regionName: String(regionName || regionId || 'Custom Region'),
    bmkgStations,
    era5Series: {
      targetCoord: [Number(targetCoord[0].toFixed(4)), Number(targetCoord[1].toFixed(4))],
      gridCoord: [Number(gridCoord[0].toFixed(4)), Number(gridCoord[1].toFixed(4))],
      gridElevM: Math.round(gridElevM),
      period,
      yearsCount: corrMax.yearsCount,
      daysCount: corrMax.daysCount,
      biasFactor: Number(safeBias.toFixed(3)),
      rawMeanAnnualMm: rawMax.meanAnnualMm,
      correctedMeanAnnualMm: corrMax.meanAnnualMm
    },
    returnPeriodsMm,
    idfCapsMmHr: deriveMononobeIdfEnvelope(returnPeriodsMm),
    bmkgHourlyScale: OFFICIAL_BMKG_HOURLY_SCALE
  };
}

async function fetchEra5ArchiveDaily(lat, lng) {
  const chunks = [
    ['1985-01-01', '1994-12-31'],
    ['1995-01-01', '2004-12-31'],
    ['2005-01-01', '2014-12-31'],
    ['2015-01-01', '2025-12-31']
  ];
  const allDates = [];
  const allMm = [];
  let gridLat = lat;
  let gridLng = lng;
  let gridElevM = 0;

  for (const [start, end] of chunks) {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${start}&end_date=${end}&daily=precipitation_sum&timezone=UTC`;
    let json = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
        break;
      } catch (err) {
        if (attempt === 2) throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    if (typeof json?.latitude === 'number') gridLat = json.latitude;
    if (typeof json?.longitude === 'number') gridLng = json.longitude;
    if (typeof json?.elevation === 'number') gridElevM = json.elevation;
    const dates = json?.daily?.time || [];
    const vals = json?.daily?.precipitation_sum || [];
    for (let i = 0; i < dates.length; i++) {
      allDates.push(dates[i]);
      allMm.push(vals[i] ?? 0);
    }
  }

  return { gridLat, gridLng, gridElevM, dailyDates: allDates, dailyMm: allMm };
}

/**
 * Loads cached climate baseline or fetches 41-year Open-Meteo ERA5-Land daily precipitation
 * for the region's `dataCenter`, computing SNI 2415:2016 return periods & Mononobe IDF envelope.
 */
export async function fetchOrBuildClimateBaseline({
  rootDir,
  outDir = path.join(rootDir, 'public', 'data'),
  regionCfg,
  refresh = false
}) {
  const regionId = String(regionCfg?.id || 'custom-region');
  const regionName = String(regionCfg?.name || regionId);
  const existingPath = path.join(outDir, 'climate-baseline.json');

  if (!refresh && regionId === 'nagari-balingka' && fs.existsSync(existingPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      if (existing?.regionId === 'nagari-balingka') return existing;
    } catch {}
  }

  const center = regionCfg?.dataCenter || [
    (Number(regionCfg.bbox.west) + Number(regionCfg.bbox.east)) / 2,
    (Number(regionCfg.bbox.south) + Number(regionCfg.bbox.north)) / 2
  ];
  const targetLng = Number(center[0]);
  const targetLat = Number(center[1]);
  const biasFactor = Number(regionCfg?.hydrology?.climateBiasFactor || 1.0);
  const cachePath = path.join(rootDir, 'raw-data', `era5-climate-${regionId}.json`);

  let rawSeries = null;
  if (!refresh && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (
        cached?.dailyDates?.length > 1000 &&
        Math.abs(cached.targetLat - targetLat) < 0.02 &&
        Math.abs(cached.targetLng - targetLng) < 0.02
      ) {
        rawSeries = cached;
      }
    } catch {}
  }

  if (!rawSeries) {
    try {
      const fetched = await fetchEra5ArchiveDaily(targetLat, targetLng);
      rawSeries = { targetLat, targetLng, ...fetched };
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(rawSeries));
      console.log(`Fetched 41-yr ERA5-Land climate baseline for ${regionName} (${fetched.dailyDates.length} days).`);
    } catch (err) {
      console.warn(`[climate-fetcher] Open-Meteo archive fetch unavailable (${err instanceof Error ? err.message : err}); using tropical fallback IDF baseline.`);
      const fallbackRp = {
        r24: { max41yr: 185, t2: 95, t10Gumbel: 145, t10Lp3: 140, t50Gumbel: 185, t50Lp3: 175, t100Gumbel: 205, t100Lp3: 192 },
        r48: { max41yr: 245, t2: 130, t10Gumbel: 190, t10Lp3: 185, t50Gumbel: 245, t50Lp3: 230, t100Gumbel: 270, t100Lp3: 250 },
        r72: { max41yr: 280, t2: 155, t10Gumbel: 220, t10Lp3: 212, t50Gumbel: 280, t50Lp3: 262, t100Gumbel: 305, t100Lp3: 282 }
      };
      return {
        regionId,
        regionName,
        bmkgStations: [],
        era5Series: {
          targetCoord: [Number(targetLat.toFixed(4)), Number(targetLng.toFixed(4))],
          gridCoord: [Number(targetLat.toFixed(4)), Number(targetLng.toFixed(4))],
          gridElevM: 0,
          period: 'fallback-tropical-default',
          yearsCount: 0,
          daysCount: 0,
          biasFactor: 1.0,
          rawMeanAnnualMm: 2400,
          correctedMeanAnnualMm: 2400
        },
        returnPeriodsMm: fallbackRp,
        idfCapsMmHr: DEFAULT_TROPICAL_IDF_CAPS,
        bmkgHourlyScale: OFFICIAL_BMKG_HOURLY_SCALE
      };
    }
  }

  return buildClimateBaselineFromDailySeries({
    regionId,
    regionName,
    targetCoord: [targetLat, targetLng],
    gridCoord: [rawSeries.gridLat, rawSeries.gridLng],
    gridElevM: rawSeries.gridElevM,
    dailyDates: rawSeries.dailyDates,
    dailyMm: rawSeries.dailyMm,
    biasFactor,
    bmkgStations: []
  });
}
