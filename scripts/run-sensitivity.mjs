#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CascadeEngine, extractBuildingCentroids } from '../src/lib/cascadeEngine.ts';
import { buildSensitivityRankingCsv, runSensitivityAnalysis } from './lib/sensitivity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { nLhs: 500, trajectories: 12, seed: 20260401, outDir: path.join(ROOT, 'docs', 'benchmarks') };
  for (const a of argv) {
    if (a.startsWith('--n=')) out.nLhs = Math.max(10, parseInt(a.slice(4), 10) || 500);
    else if (a.startsWith('--trajectories=')) out.trajectories = Math.max(2, parseInt(a.slice(15), 10) || 12);
    else if (a.startsWith('--seed=')) out.seed = parseInt(a.slice(7), 10) || 20260401;
    else if (a.startsWith('--out=')) out.outDir = path.resolve(ROOT, a.slice(6));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const simFields = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'sim-fields.json'), 'utf8'));
const settlements = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'settlements.geojson'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'metadata.json'), 'utf8'));
const totalCrossings = (meta.crossingsDetected || 0) + (meta.bridgesDetected || 0) || 37;
const engine = new CascadeEngine(simFields, extractBuildingCentroids(settlements), totalCrossings);

const scenarios = {
  upland_3h: {
    rainMmHr: 40,
    durationMin: 180,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 65,
    rainPattern: 'upland',
    drainCondition: 'clogged',
    forestScenario: 'actual',
    hyetograph: 'alternating_block',
    orographicPctPerKm: 45,
    culvertBlockagePct: 65,
    debrisCoupling: 'coupled'
  },
  monsoon_48h: {
    rainMmHr: 7,
    durationMin: 2880,
    progress: 0.78,
    soilMoisture: 'moist',
    antecedent5dMm: 75,
    rainPattern: 'upland',
    drainCondition: 'surge',
    forestScenario: 'actual',
    hyetograph: 'alternating_block',
    orographicPctPerKm: 48,
    culvertBlockagePct: 78,
    debrisCoupling: 'surge'
  }
};

const results = {};
for (const [name, baseScenario] of Object.entries(scenarios)) {
  results[name] = runSensitivityAnalysis({
    engine,
    baseScenario,
    nLhs: args.nLhs,
    morrisTrajectories: args.trajectories,
    seed: args.seed
  });
}

fs.mkdirSync(args.outDir, { recursive: true });
const summaryPayload = {
  generatedAt: new Date().toISOString(),
  nLhs: args.nLhs,
  morrisTrajectories: args.trajectories,
  seed: args.seed,
  scenarios: results
};
const summaryPath = path.join(args.outDir, 'sensitivity-summary.json');
const csvPath = path.join(args.outDir, 'sensitivity-ranking.csv');
fs.writeFileSync(summaryPath, JSON.stringify(summaryPayload, null, 2) + '\n');
fs.writeFileSync(csvPath, buildSensitivityRankingCsv(results));

console.log(`Saved sensitivity summary to ${path.relative(ROOT, summaryPath)} & ${path.relative(ROOT, csvPath)}`);
for (const [name, res] of Object.entries(results)) {
  console.log(`\n[${name}] (UI 7-env: ${res.runtimeMs.ui7MemberMs}ms | LHS ${args.nLhs}: ${res.runtimeMs.lhsMs}ms | Morris ${args.trajectories}x7: ${res.runtimeMs.morrisMs}ms)`);
  for (const m of ['peakDischargeM3s', 'floodAreaHa', 'landslideAreaHa']) {
    const ec = res.envelopeComparison[m];
    const topM = res.morris[m][0];
    const topS = res.spearman[m][0];
    console.log(
      `  ${m}: UI=[${ec.uiLow}..${ec.uiCentral}..${ec.uiHigh}] vs LHS P10-P90=[${ec.lhsP10}..${ec.lhsP50}..${ec.lhsP90}] (coverage=${ec.spanCoverageRatio}x) | Top Morris=${topM.factorId} (${topM.muStarSharePct}%) | Top Spearman=${topS.factorId} (rho=${topS.rho})`
    );
  }
}
