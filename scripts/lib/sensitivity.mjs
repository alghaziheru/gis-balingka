/**
 * Offline Global Sensitivity Analysis (Latin Hypercube Sampling + Spearman Rank + Morris Elementary Effects)
 * for CascadeEngine. Quantifies parameter dominance and validates the fast 7-scenario UI envelope.
 */

export const SENSITIVITY_FACTORS = [
  { id: 'rainScale', label: 'Rainfall Multiplier', min: 0.75, max: 1.25, unit: '×' },
  { id: 'antecedent5dMm', label: '5-Day Antecedent Rain (P5)', min: 20, max: 150, unit: 'mm' },
  { id: 'cnOffset', label: 'SCS Curve Number Offset', min: -6, max: 6, unit: 'CN' },
  { id: 'manningMult', label: 'Manning Roughness Multiplier', min: 0.75, max: 1.35, unit: '×' },
  { id: 'culvertBlockagePct', label: 'Culvert Blockage Ratio', min: 5, max: 85, unit: '%' },
  { id: 'cohesionMult', label: 'Soil Cohesion Multiplier', min: 0.75, max: 1.25, unit: '×' }
];

export const OUTPUT_METRICS = ['peakDischargeM3s', 'floodAreaHa', 'landslideAreaHa'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates an N x D stratified Latin Hypercube design in [0, 1)^D deterministically.
 */
export function generateLatinHypercube(nSamples, dims, seed = 20260401) {
  const rng = mulberry32(seed);
  const cols = Array.from({ length: dims }, () => {
    const strata = new Float64Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      strata[i] = (i + rng()) / nSamples;
    }
    for (let i = nSamples - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = strata[i];
      strata[i] = strata[j];
      strata[j] = tmp;
    }
    return strata;
  });

  const matrix = new Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const row = new Float64Array(dims);
    for (let d = 0; d < dims; d++) row[d] = cols[d][i];
    matrix[i] = row;
  }
  return matrix;
}

function rankArray(arr) {
  const indexed = arr.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v);
  const ranks = new Float64Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) * 0.5 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].idx] = avgRank;
    i = j + 1;
  }
  return ranks;
}

export function computeSpearmanRankCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const rx = rankArray(xs.slice(0, n));
  const ry = rankArray(ys.slice(0, n));
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += rx[i];
    my += ry[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx;
    const dy = ry[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 1e-12 ? Number((num / denom).toFixed(4)) : 0;
}

export function summarizeDistribution(values) {
  if (!values.length) {
    return { mean: 0, sd: 0, min: 0, p05: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / Math.max(1, n - 1);
  const q = frac => {
    const idx = Math.max(0, Math.min(n - 1, frac * (n - 1)));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return Number((sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo)).toFixed(2));
  };
  return {
    mean: Number(mean.toFixed(2)),
    sd: Number(Math.sqrt(Math.max(0, variance)).toFixed(2)),
    min: Number(sorted[0].toFixed(2)),
    p05: q(0.05),
    p10: q(0.1),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    p95: q(0.95),
    max: Number(sorted[n - 1].toFixed(2))
  };
}

function unitRowToParams(unitRow, baseScenario) {
  const vals = {};
  SENSITIVITY_FACTORS.forEach((f, idx) => {
    const u = Math.max(0, Math.min(1, unitRow[idx]));
    vals[f.id] = f.min + u * (f.max - f.min);
  });
  return {
    vals,
    params: {
      ...baseScenario,
      rainMmHr: Number((baseScenario.rainMmHr * vals.rainScale).toFixed(3)),
      antecedent5dMm: Number(vals.antecedent5dMm.toFixed(1)),
      culvertBlockagePct: Number(vals.culvertBlockagePct.toFixed(1)),
      calibrationProfile: {
        manningMult: Number(vals.manningMult.toFixed(3)),
        cnOffset: Number(vals.cnOffset.toFixed(2)),
        cohesionMult: Number(vals.cohesionMult.toFixed(3))
      }
    }
  };
}

export function runSensitivityAnalysis({
  engine,
  baseScenario,
  nLhs = 500,
  morrisTrajectories = 12,
  seed = 20260401
}) {
  const t0Ui = performance.now();
  const uiRes = engine.evaluate(baseScenario, { skipValidation: true });
  const uiRuntimeMs = Number((performance.now() - t0Ui).toFixed(2));

  // 1. Stratified Latin Hypercube Monte Carlo (nominalOnly fast evaluation)
  const D = SENSITIVITY_FACTORS.length;
  const lhsUnit = generateLatinHypercube(nLhs, D, seed);
  const factorSamples = Object.fromEntries(SENSITIVITY_FACTORS.map(f => [f.id, new Array(nLhs)]));
  const lhsOutputs = {
    peakDischargeM3s: new Array(nLhs),
    floodAreaHa: new Array(nLhs),
    landslideAreaHa: new Array(nLhs),
    affectedBuildingsFlood: new Array(nLhs),
    effectiveRunoffMm: new Array(nLhs)
  };

  const t0Lhs = performance.now();
  for (let i = 0; i < nLhs; i++) {
    const { vals, params } = unitRowToParams(lhsUnit[i], baseScenario);
    for (const f of SENSITIVITY_FACTORS) factorSamples[f.id][i] = vals[f.id];
    const res = engine.evaluate(params, { skipValidation: true, nominalOnly: true });
    lhsOutputs.peakDischargeM3s[i] = res.peakDischargeM3s;
    lhsOutputs.floodAreaHa[i] = res.floodAreaHa;
    lhsOutputs.landslideAreaHa[i] = res.landslideAreaHa;
    lhsOutputs.affectedBuildingsFlood[i] = res.affectedBuildingsFlood;
    lhsOutputs.effectiveRunoffMm[i] = res.effectiveRunoffMm;
  }
  const lhsRuntimeMs = Number((performance.now() - t0Lhs).toFixed(1));

  const distributions = {};
  for (const [k, arr] of Object.entries(lhsOutputs)) {
    distributions[k] = summarizeDistribution(arr);
  }

  const envelopeComparison = {};
  for (const m of OUTPUT_METRICS) {
    const uiEnv = uiRes.ensemble[m];
    const lhsDist = distributions[m];
    const uiSpan = Number((uiEnv.p90 - uiEnv.p10).toFixed(2));
    const lhsSpan = Number((lhsDist.p90 - lhsDist.p10).toFixed(2));
    envelopeComparison[m] = {
      uiLow: uiEnv.p10,
      uiCentral: uiEnv.p50,
      uiHigh: uiEnv.p90,
      uiSpan,
      lhsP10: lhsDist.p10,
      lhsP50: lhsDist.p50,
      lhsP90: lhsDist.p90,
      lhsSpan,
      spanCoverageRatio: lhsSpan > 1e-6 ? Number((uiSpan / lhsSpan).toFixed(2)) : 1.0
    };
  }

  // Spearman rank correlations & normalized rank-variance contribution
  const spearman = {};
  for (const m of OUTPUT_METRICS) {
    const rhos = {};
    let rhoSqSum = 0;
    for (const f of SENSITIVITY_FACTORS) {
      const rho = computeSpearmanRankCorrelation(factorSamples[f.id], lhsOutputs[m]);
      rhos[f.id] = rho;
      rhoSqSum += rho * rho;
    }
    spearman[m] = SENSITIVITY_FACTORS.map(f => ({
      factorId: f.id,
      label: f.label,
      rho: rhos[f.id],
      absRho: Number(Math.abs(rhos[f.id]).toFixed(4)),
      rankSharePct: rhoSqSum > 1e-9 ? Number((((rhos[f.id] * rhos[f.id]) / rhoSqSum) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.absRho - a.absRho);
  }

  // 2. Morris Elementary Effects (6-level grid with step delta = 0.5)
  const rng = mulberry32(seed + 991);
  const delta = 0.5;
  const levels = [0, 0.25, 0.5, 0.75, 1.0];
  const eeMap = {};
  for (const m of OUTPUT_METRICS) {
    eeMap[m] = Object.fromEntries(SENSITIVITY_FACTORS.map(f => [f.id, []]));
  }

  const t0Morris = performance.now();
  for (let tr = 0; tr < morrisTrajectories; tr++) {
    const cur = new Float64Array(D);
    for (let d = 0; d < D; d++) {
      cur[d] = levels[Math.floor(rng() * (levels.length - 1))];
    }
    const order = Array.from({ length: D }, (_, idx) => idx);
    for (let i = D - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }

    let prevRes = engine.evaluate(unitRowToParams(cur, baseScenario).params, {
      skipValidation: true,
      nominalOnly: true
    });
    for (const dIdx of order) {
      const next = new Float64Array(cur);
      const sign = next[dIdx] + delta <= 1.0 ? 1 : -1;
      const stepDelta = sign * delta;
      next[dIdx] = Math.max(0, Math.min(1, next[dIdx] + stepDelta));
      const nextRes = engine.evaluate(unitRowToParams(next, baseScenario).params, {
        skipValidation: true,
        nominalOnly: true
      });
      const fid = SENSITIVITY_FACTORS[dIdx].id;
      for (const m of OUTPUT_METRICS) {
        const ee = (nextRes[m] - prevRes[m]) / stepDelta;
        eeMap[m][fid].push(ee);
      }
      cur[dIdx] = next[dIdx];
      prevRes = nextRes;
    }
  }
  const morrisRuntimeMs = Number((performance.now() - t0Morris).toFixed(1));

  const morris = {};
  for (const m of OUTPUT_METRICS) {
    const rows = SENSITIVITY_FACTORS.map(f => {
      const ees = eeMap[m][f.id];
      const nE = Math.max(1, ees.length);
      const mu = ees.reduce((a, b) => a + b, 0) / nE;
      const muStar = ees.reduce((a, b) => a + Math.abs(b), 0) / nE;
      const v = ees.reduce((a, b) => a + (b - mu) * (b - mu), 0) / Math.max(1, nE - 1);
      return {
        factorId: f.id,
        label: f.label,
        mu: Number(mu.toFixed(3)),
        muStar: Number(muStar.toFixed(3)),
        sigma: Number(Math.sqrt(Math.max(0, v)).toFixed(3))
      };
    }).sort((a, b) => b.muStar - a.muStar);
    const totalMuStar = rows.reduce((s, r) => s + r.muStar, 0);
    morris[m] = rows.map(r => ({
      ...r,
      muStarSharePct: totalMuStar > 1e-9 ? Number(((r.muStar / totalMuStar) * 100).toFixed(1)) : 0
    }));
  }

  return {
    config: { nLhs, morrisTrajectories, seed, baseScenario },
    runtimeMs: { ui7MemberMs: uiRuntimeMs, lhsMs: lhsRuntimeMs, morrisMs: morrisRuntimeMs },
    distributions,
    envelopeComparison,
    spearman,
    morris
  };
}

export function buildSensitivityRankingCsv(scenariosMap) {
  const header = [
    'scenario',
    'output_metric',
    'factor_id',
    'factor_label',
    'spearman_rho',
    'spearman_share_pct',
    'morris_mu_star',
    'morris_mu_star_share_pct',
    'morris_sigma'
  ].join(',');

  const lines = [header];
  for (const [scenarioName, res] of Object.entries(scenariosMap)) {
    for (const m of OUTPUT_METRICS) {
      const spById = new Map(res.spearman[m].map(r => [r.factorId, r]));
      for (const mr of res.morris[m]) {
        const sp = spById.get(mr.factorId);
        lines.push(
          [
            scenarioName,
            m,
            mr.factorId,
            `"${mr.label}"`,
            sp ? sp.rho.toFixed(4) : '0',
            sp ? sp.rankSharePct.toFixed(1) : '0',
            mr.muStar.toFixed(3),
            mr.muStarSharePct.toFixed(1),
            mr.sigma.toFixed(3)
          ].join(',')
        );
      }
    }
  }
  return lines.join('\n') + '\n';
}
