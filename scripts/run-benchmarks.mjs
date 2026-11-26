#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNasaPowerCrossCheck, runAnalyticalVerifications } from './lib/verification-benchmarks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const simFields = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'sim-fields.json'), 'utf8'));
const settlements = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'settlements.geojson'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'metadata.json'), 'utf8'));
const climateBaseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'climate-baseline.json'), 'utf8'));
const regionCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'region.config.json'), 'utf8'));

const analytical = runAnalyticalVerifications({ simFields, settlements, meta });
const center = regionCfg.dataCenter || [100.319, -0.345];
const nasaPower = await fetchNasaPowerCrossCheck({
  rootDir: ROOT,
  lat: Number(center[1]),
  lng: Number(center[0]),
  climateBaseline
});

const outDir = path.join(ROOT, 'docs', 'benchmarks');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'verification-summary.json');
const payload = {
  generatedAt: new Date().toISOString(),
  regionId: regionCfg.id,
  regionName: regionCfg.name,
  analytical,
  nasaPowerCrossCheck: nasaPower
};
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log(`Saved verification summary to ${path.relative(ROOT, outPath)}`);
console.log(`  SCS-CN SMA vs NRCS analytical: R2=${analytical.scsCnAnalytical.r2}, NSE=${analytical.scsCnAnalytical.nse}, RMSE=${analytical.scsCnAnalytical.rmseMm} mm`);
console.log(`  Muskingum-Cunge 10-reach check: lag=${analytical.muskingumChannel.lagMin} min, peakQ=${analytical.muskingumChannel.peakOutletQ} m3/s, volDiff=${analytical.muskingumChannel.volumeBalanceDiffPct}%`);
console.log(`  FHWA HDS-5 orifice max error: ${analytical.fhwaHds5Orifice.maxRelErrPct}%`);
console.log(`  Water-balance max |closureError|: ${analytical.waterBalanceClosure.maxAbsClosureErrorPct}%`);
console.log(`  Browser latency median (ms): 2h=${analytical.browserEngineLatencyMs.normal_2h_dry.medianMs}, 3h=${analytical.browserEngineLatencyMs.upland_3h_clogged.medianMs}, 48h=${analytical.browserEngineLatencyMs.monsoon_48h_surge.medianMs}`);
if (nasaPower.available) {
  console.log(
    `  NASA POWER cross-check (${nasaPower.yearsCount} yr): annual=${nasaPower.meanAnnualMm} mm/yr (vs ERA5×1.073 ${nasaPower.comparison.era5BmkgCorrectedMeanAnnualMm} mm/yr), R24_100=${nasaPower.comparison.nasaPowerR24T100} mm`
  );
} else {
  console.log(`  NASA POWER cross-check unavailable: ${nasaPower.reason}`);
}
