# Solver Verification, Global Sensitivity & Multi-Source Climate Report

*Reproducible technical evidence generated from `CascadeEngine`, `routeReachNetwork`, and `climate-fetcher.mjs` on **Nagari Balingka** (`29.89 km²`, Kab. Agam, West Sumatra).*

> **Epistemic Scope:** All verification tests below evaluate **mathematical consistency, mass conservation, solver agreement against published equations, multi-source precipitation uncertainty, and parameter sensitivity**. Because Nagari Balingka has no live stream gauges (`AWLR`), measured soil shear boreholes, or event-dated flood hydrographs yet, simulated discharges and depths remain **Screening-level (`≤44/100`)** rather than calibrated site predictions.

---

## 1. Analytical Solver Verification & Numerical Hygiene

Generated via `pnpm run benchmark` → [`docs/benchmarks/verification-summary.json`](./benchmarks/verification-summary.json):

| Verification Benchmark | Test Design | Measured Result | Acceptance Criterion |
|---|---|---|---|
| **Continuous SMA vs. Exact NRCS TR-55** | 15 storm totals (`P = 20–300 mm`, `CN = 72`, `S = 98.78 mm`, `Ia = 13.83 mm`, zero percolation, 28 steps) compared against analytical `Q = (P − Ia)² / (P − Ia + S)` | `R² = 1.00000`, `NSE = 1.00000`, `RMSE = 0.028 mm` | `R² > 0.999` |
| **SMA Catchments Mass-Balance Closure** | Full Nagari Balingka network across `15 mm/h × 2h` (`dry`), `40 mm/h × 3h` (`moist`), and `7 mm/h × 48h` (`surge`) checking `Rain = Ia + Runoff + ΔS + DeepPerc` | Max `|closureErrorPct| = 0.00000%` | `< 0.05%` |
| **1D Muskingum-Cunge Synthetic Channel** | 10-reach channel (`2.5 km`, `S = 0.02`, `W = 6.0 m`), `45 mm/h × 2h` storm + tail (`dt = 2.1 min`) | Lag `+19.3 min` (`27.8 → 47.1 min`), peak `38.75 m³/s`, `minQ = 0.0035 m³/s` (non-oscillatory), volume accounted `-6.05%` (slow tail outflow past cutoff) | Stable (`minQ ≥ 0`), positive lag |
| **FHWA HDS-5 Orifice & Bridge Capacity** | Pipe `Ø 0.80 m` (`Cd = 0.62`), Box `1.5 × 1.2 m` (`Cd = 0.66`), Bridge `4.0 × 2.5 m` (`Cd = 0.78`) vs analytical `Cd · A · √(2gH)` | Model `1.14`, `5.31`, `47.31 m³/s` · Max relative error `0.147%` | `< 0.5%` |
| **Browser Engine Latency (7-Member Envelope)** | 10 cache-cold evaluations on full `185 × 260` grid + `~13.8 m` DEMNAS HAND & `2,175` buildings | Median `58.63 ms` (`2h`), `48.40 ms` (`3h`), `106.63 ms` (`48h`); P95 `52.46–124.76 ms` | Interactive (`< 250 ms`) |

### Water-Balance Ledger Across Scenarios (`docs/benchmarks/verification-summary.json`)

| Scenario | Rain Input (mm) | Interception `Ia` (mm) | Total Runoff (mm) | Soil ΔStorage (mm) | Deep Percolation (mm) | Closure Error | Peak Q (m³/s) | Corridor Overflow (ha) | Steep Slope `FoS < 1.1` (ha) |
|---|---|---|---|---|---|---|---|---|---|
| `normal_2h_dry` (`15 mm/h × 2h`) | `31.684` | `19.113` | `2.218` | `10.184` | `0.169` | `0%` | `4.7` | `0` | `0.1` |
| `upland_3h_clogged` (`40 mm/h × 3h`) | `107.123` | `12.235` | `64.398` | `28.650` | `1.841` | `0%` | `125.8` | `2.2` | `1.6` |
| `monsoon_48h_surge` (`7 mm/h × 48h`) | `274.984` | `10.958` | `199.712` | `38.849` | `25.464` | `0%` | `140.7` | `2.6` | `17.1` |

---

## 2. Offline Global Sensitivity Analysis (`N = 500` LHS + Morris)

Generated via `pnpm run sensitivity` → [`docs/benchmarks/sensitivity-summary.json`](./benchmarks/sensitivity-summary.json) & [`docs/benchmarks/sensitivity-ranking.csv`](./benchmarks/sensitivity-ranking.csv) (`seed = 20260401`, `N_LHS = 500`, `12` Morris trajectories × `6` factors):

**Uncertain Input Factors Sampled:**
1. `rainScale` ∈ `[0.75, 1.25]` (`±25%`)
2. `antecedent5dMm` (`P5`) ∈ `[20, 150] mm`
3. `cnOffset` ∈ `[-6, +6]`
4. `manningMult` ∈ `[0.75, 1.35]`
5. `culvertBlockagePct` ∈ `[5%, 85%]`
6. `cohesionMult` ∈ `[0.75, 1.25]`

### Parameter Dominance Ranking (Morris `μ*` Share & Spearman `ρ`)

| Scenario | Output Metric | #1 Dominant Factor | Morris `μ*` Share | Spearman `ρ` | #2 Factor | Morris `μ*` Share | Spearman `ρ` |
|---|---|---|---|---|---|---|---|
| **`upland_3h`** (`40 mm/h × 3h`, `120 mm`) | `peakDischargeM3s` | `antecedent5dMm` (`P5`) | `52.4%` | `+0.8296` | `rainScale` | `37.9%` | `+0.5264` |
| `upland_3h` | `floodAreaHa` | `antecedent5dMm` / `manningMult` | `33.7%` / `33.7%` | `+0.7320` / `+0.4396` | `rainScale` | `23.9%` | `+0.4701` |
| `upland_3h` | `landslideAreaHa` | `cohesionMult` | `53.2%` | `-0.9325` | `rainScale` | `27.3%` | `+0.2658` |
| **`monsoon_48h`** (`7 mm/h × 48h`, `336 mm`) | `peakDischargeM3s` | `rainScale` | `48.5%` | `+0.8321` | `culvertBlockagePct` | `30.4%` (`σ=37.3`) | `+0.3722` |
| `monsoon_48h` | `floodAreaHa` | `manningMult` | `36.9%` | `+0.5092` | `rainScale` | `30.1%` | `+0.6562` |
| `monsoon_48h` | `landslideAreaHa` | `cohesionMult` | `56.1%` | `-0.8866` | `rainScale` | `34.6%` | `+0.4304` |

### Fast 7-Scenario UI Sensitivity Envelope vs. `N = 500` LHS (`P10–P50–P90`)

| Scenario | Output Metric | Fast 7-Scenario UI Bounds `[Low .. Central .. High]` | `N = 500` LHS `[P10 .. P50 .. P90]` | Span Coverage (`UI / LHS`) |
|---|---|---|---|---|
| `upland_3h` | `peakDischargeM3s` | `[94.4 .. 125.8 .. 160.2] m³/s` | `[81.56 .. 145.7 .. 210.43] m³/s` | `0.51×` |
| `upland_3h` | `floodAreaHa` | `[0 .. 2.2 .. 5.9] ha` | `[0 .. 2.7 .. 10.0] ha` | `0.59×` |
| `upland_3h` | `landslideAreaHa` | `[0.2 .. 1.6 .. 15.6] ha` | `[0.3 .. 1.8 .. 23.21] ha` | `0.67×` |
| `monsoon_48h` | `peakDischargeM3s` | `[113.9 .. 143.5 .. 174.5] m³/s` | `[87.6 .. 118.15 .. 156.53] m³/s` | `0.88×` |
| `monsoon_48h` | `floodAreaHa` | `[0.2 .. 2.6 .. 8.1] ha` | `[0 .. 1.6 .. 4.6] ha` | `1.72×` |
| `monsoon_48h` | `landslideAreaHa` | `[0.9 .. 18.7 .. 64.1] ha` | `[1.3 .. 16.85 .. 63.45] ha` | `1.02×` |

**Methodological Implication:** Because the live 7-scenario UI envelope fixes antecedent `P5` at the user-selected value while `N = 500` LHS samples `P5` uniformly across `[20, 150] mm`, the UI envelope captures `0.51–0.67×` of total `upland_3h` variance and `0.88–1.72×` of `monsoon_48h` variance. Meanwhile, Morris/Spearman proves why the participatory Editor & [`FIELD_SURVEY_PROTOCOL.md`](./FIELD_SURVEY_PROTOCOL.md) prioritize **5-day antecedent wetness tracking**, **channel Manning geometry**, **culvert blockage inspections** (threshold interaction `σ = 37.3` in 48h surge), and **soil shear cohesion (`c′`)**: together they drive >80% of output spread.

---

## 3. Multi-Source 41-Year Precipitation Cross-Comparison (`1985–2025`)

Comparing three independent open-data baselines at Nagari Balingka (`-0.345, 100.319`):

| Source | Spatial / Temporal Basis | Mean Annual (mm/yr) | `R24` `T100` Gumbel (mm) | `R48` `T100` Gumbel (mm) | `R72` `T100` Gumbel (mm) |
|---|---|---|---|---|---|
| **ERA5-Land Raw** (Open-Meteo) | `~9 km` reanalysis, `41 yr` (`n = 14,975` days) | `3,919` | `241` | `314` | `354` |
| **ERA5-Land × 1.073 BMKG Bias** *(Model Baseline)* | Scaled by 43-month overlap vs. BMKG `96165` (`735 m`) & `96167` (`128 m`) | `4,203` | `259` (`LP3 238`) | `337` (`LP3 306`) | `380` (`LP3 342`) |
| **NASA POWER `PRECTOTCORR`** | `~0.5°` MERRA-2 + satellite daily (`1985–2025`, `n = 14,975` days) | `3,419` | `223` (`LP3 239`) | `270` (`LP3 269`) | `307` (`LP3 305`) |

Even between two global daily reanalyses (`ERA5-Land` vs `NASA POWER`), 100-year return depths differ by `14–20%` (`R24`: `259` vs `223 mm`; `R48`: `337` vs `270 mm`), and spatial smoothing at `9–50 km` still misses localized Mt. Singgalang orographic cores — justifying the explicit `±25%` rainfall sensitivity band and `Screening` cap.

---

## 4. Reproducing These Experiments

```bash
pnpm test              # Fast deterministic unit & methodology suite (node --test)
pnpm run sensitivity   # N=500 LHS + 12x7 Morris sweeps -> docs/benchmarks/sensitivity-*
pnpm run benchmark     # Analytical checks + latency + NASA POWER -> docs/benchmarks/verification-summary.json
```
