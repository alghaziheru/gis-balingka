# Solver Verification, Global Sensitivity & Multi-Source Climate Report

*Reproducible technical evidence generated from `CascadeEngine`, `routeReachNetwork`, and `climate-fetcher.mjs` on **Nagari Balingka** (`29.89 km²`, Kab. Agam, West Sumatra).*

> **Epistemic Scope:** All verification tests below evaluate **mathematical consistency, mass conservation, solver agreement against published equations, multi-source precipitation uncertainty, and parameter sensitivity**. Because Nagari Balingka has no live stream gauges (`AWLR`), measured soil shear boreholes, or event-dated flood hydrographs yet, simulated discharges and depths remain **Screening-level (`≤44/100`)** rather than calibrated site predictions. See [`MODEL_LIMITATIONS.md`](./MODEL_LIMITATIONS.md) for a candid audit of physical ceilings (1D HAND vs. 2D avulsion, `'surge'` pulse heuristic, shallow-only FoS, and model-to-model BPBD intercomparison).

---

## 1. Analytical Solver Verification & Numerical Hygiene

Generated via `pnpm run benchmark` → [`docs/benchmarks/verification-summary.json`](./benchmarks/verification-summary.json):

| Verification Benchmark | Test Design | Measured Result | Acceptance Criterion |
|---|---|---|---|
| **Continuous SMA vs. Exact NRCS TR-55** | 15 storm totals (`P = 20–300 mm`, `CN = 72`, `S = 98.78 mm`, `Ia = 13.83 mm`, zero percolation, 28 steps) calling live production `stepReachSma()` vs analytical `Q = (P − Ia)² / (P − Ia + S)` | `R² = 1.00000`, `NSE = 1.00000`, `RMSE = 0.028 mm` | `R² > 0.999` |
| **SMA Catchments Mass-Balance Closure** | Full Nagari Balingka network across `15 mm/h × 2h` (`dry`), `40 mm/h × 3h` (`moist`), and `7 mm/h × 48h` (`surge`) checking `Rain = Ia + Runoff + ΔS + DeepPerc` | Max `|closureErrorPct| = 0.00000%` | `< 0.05%` |
| **1D Muskingum-Cunge Synthetic Channel** | 10-reach channel (`2.5 km`, `S = 0.02`, `W = 6.0 m`), `45 mm/h × 2h` storm + tail (`dt = 2.1 min`) | Lag `+19.3 min` (`27.8 → 47.1 min`), peak `38.75 m³/s`, `minQ = 0.0035 m³/s` (non-oscillatory), volume accounted `-6.05%` (slow tail outflow past cutoff) | Stable (`minQ ≥ 0`), positive lag |
| **FHWA HDS-5 Orifice & Bridge Capacity** | Pipe `Ø 0.80 m` (`Cd = 0.62`), Box `1.5 × 1.2 m` (`Cd = 0.66`), Bridge `4.0 × 2.5 m` (`Cd = 0.78`) vs analytical `Cd · A · √(2gH)` | Model `1.14`, `5.31`, `47.31 m³/s` · Max relative error `0.147%` | `< 0.5%` |
| **Browser Engine Latency (7-Member Envelope)** | 10 cache-cold evaluations on full `185 × 260` grid + `~13.8 m` DEMNAS HAND & `2,175` buildings | Median `59.86 ms` (`2h`), `46.77 ms` (`3h`), `100.43 ms` (`48h`); P95 `47.81–122.08 ms` | Interactive (`< 250 ms`) |

### Water-Balance Ledger Across Scenarios (`docs/benchmarks/verification-summary.json`)

*(Reconciled bankfull SRC datum: stage `0..bfD` stays in-channel while `stage > bfD` integrates DEMNAS HAND strictly at overbank depth `stage − bfD` with exact hydraulic cross-sectional area.)*

| Scenario | Rain Input (mm) | Interception `Ia` (mm) | Total Runoff (mm) | Soil ΔStorage (mm) | Deep Percolation (mm) | Closure Error | Peak Q (m³/s) | Corridor Overflow (ha) | Steep Slope `FoS < 1.1` (ha) |
|---|---|---|---|---|---|---|---|---|---|
| `normal_2h_dry` (`15 mm/h × 2h`) | `31.684` | `19.113` | `2.218` | `10.184` | `0.169` | `0%` | `4.7` | `0` | `0.1` |
| `upland_3h_clogged` (`40 mm/h × 3h`) | `107.123` | `12.235` | `64.398` | `28.650` | `1.841` | `0%` | `124.2` | `12.7` | `1.6` |
| `monsoon_48h_surge` (`7 mm/h × 48h`) | `274.984` | `10.958` | `199.712` | `38.849` | `25.464` | `0%` | `140.4` | `16.9` | `17.3` |

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
| **`upland_3h`** (`40 mm/h × 3h`, `120 mm`) | `peakDischargeM3s` | `antecedent5dMm` (`P5`) | `52.2%` | `+0.8305` | `rainScale` | `37.8%` | `+0.5247` |
| `upland_3h` | `floodAreaHa` | `antecedent5dMm` (`P5`) | `33.2%` | `+0.6207` | `manningMult` | `26.8%` | `+0.5398` |
| `upland_3h` | `landslideAreaHa` | `cohesionMult` | `52.9%` | `-0.9323` | `rainScale` | `27.6%` | `+0.2655` |
| **`monsoon_48h`** (`7 mm/h × 48h`, `336 mm`) | `peakDischargeM3s` | `rainScale` | `48.6%` | `+0.8328` | `culvertBlockagePct` | `30.3%` (`σ=37.3`) | `+0.3709` |
| `monsoon_48h` | `floodAreaHa` | `rainScale` | `31.5%` | `+0.7020` | `manningMult` | `30.0%` | `+0.5954` |
| `monsoon_48h` | `landslideAreaHa` | `cohesionMult` | `56.0%` | `-0.8870` | `rainScale` | `34.6%` | `+0.4292` |

### Fast 7-Scenario UI Sensitivity Envelope vs. `N = 500` LHS (`P10–P50–P90`)

| Scenario | Output Metric | Fast 7-Scenario UI Bounds `[Low .. Central .. High]` | `N = 500` LHS `[P10 .. P50 .. P90]` | Span Coverage (`UI / LHS`) |
|---|---|---|---|---|
| `upland_3h` | `peakDischargeM3s` | `[92.7 .. 124.2 .. 159.1] m³/s` | `[80.13 .. 144.7 .. 209.85] m³/s` | `0.51×` |
| `upland_3h` | `floodAreaHa` | `[1.9 .. 12.7 .. 21.4] ha` | `[10.4 .. 13.7 .. 21.61] ha` | `1.74×` |
| `upland_3h` | `landslideAreaHa` | `[0.2 .. 1.6 .. 15.3] ha` | `[0.3 .. 1.8 .. 23.1] ha` | `0.66×` |
| `monsoon_48h` | `peakDischargeM3s` | `[113.5 .. 143.2 .. 174.4] m³/s` | `[87.39 .. 118.15 .. 156.23] m³/s` | `0.88×` |
| `monsoon_48h` | `floodAreaHa` | `[4.5 .. 17.0 .. 26.7] ha` | `[12.09 .. 15.1 .. 20.3] ha` | `2.70×` |
| `monsoon_48h` | `landslideAreaHa` | `[0.9 .. 18.8 .. 64.4] ha` | `[1.3 .. 16.9 .. 64.16] ha` | `1.01×` |

**Methodological Implication:** Because the live 7-scenario UI envelope co-varies multiple parameter bounds simultaneously while fixing antecedent `P5` at the user-selected value (whereas `N = 500` LHS samples `P5` uniformly across `[20, 150] mm`), the UI envelope captures `0.51–0.66×` of `upland_3h` discharge/slope variance while bounding `1.74–2.70×` of `floodAreaHa` spread — reinforcing why UI ranges are explicitly labeled *7-scenario sensitivity bounds* rather than statistical P10–P90 percentiles. Meanwhile, Morris/Spearman proves why the participatory Editor & [`FIELD_SURVEY_PROTOCOL.md`](./FIELD_SURVEY_PROTOCOL.md) prioritize **5-day antecedent wetness tracking**, **channel Manning geometry**, **culvert blockage inspections** (threshold interaction `σ = 37.3` in 48h surge), and **soil shear cohesion (`c′`)**: together they drive >80% of output spread.

---

## 3. Multi-Source 41-Year Precipitation Cross-Comparison (`1985–2025`)

Comparing three independent open-data baselines at Nagari Balingka (`-0.345, 100.319`), using finite-sample **SNI 2415:2016** Gumbel parameters (`Yn = 0.5441`, `Sn = 1.1434` at `n = 41`):

| Source | Spatial / Temporal Basis | Mean Annual (mm/yr) | `R24` `T100` Gumbel (mm) | `R48` `T100` Gumbel (mm) | `R72` `T100` Gumbel (mm) |
|---|---|---|---|---|---|
| **ERA5-Land Raw** (Open-Meteo) | `~9 km` reanalysis, `41 yr` (`n = 14,975` days) | `3,919` | `241` | `314` | `354` |
| **ERA5-Land × 1.073 BMKG Bias** *(Model Baseline)* | Scaled by 43-month overlap vs. BMKG `96165` (`735 m`) & `96167` (`128 m`) | `4,203` | `259` (`LP3 238`) | `337` (`LP3 306`) | `380` (`LP3 342`) |
| **NASA POWER `PRECTOTCORR`** | `~0.5°` MERRA-2 + satellite daily (`1985–2025`, `n = 14,975` days) | `3,419` | `237` (`LP3 239`) | `285` (`LP3 269`) | `324` (`LP3 305`) |

Even between two global daily reanalyses (`ERA5-Land` vs `NASA POWER`), 100-year return depths differ by `9–15%` (`R24`: `259` vs `237 mm`; `R48`: `337` vs `285 mm`), and spatial smoothing at `9–50 km` still misses localized Mt. Singgalang orographic cores — justifying the explicit `±25%` rainfall sensitivity band and `Screening` cap.

---

## 4. Multi-Village Replicability Case Study (`Option A` — Desa Sriharjo, Kab. Bantul, DI Yogyakarta)

To verify zero-hardcoding portability outside West Sumatra without any local BIG `.gdb`/DEMNAS archives, `pnpm run replicability` spins up an isolated temporary directory configured only with `region.config.json` for **Desa Sriharjo** (`Kec. Imogiri, Kab. Bantul, DI Yogyakarta`, `-7.946, 110.406`, `soilProfile: "alluvial_clay"`), executes `prepare-data.mjs` end-to-end on Option A global open data, and evaluates `CascadeEngine` + `buildModelParameterAudit`. Generated artifact: [`docs/benchmarks/replicability-summary.json`](./benchmarks/replicability-summary.json).

*Fallback resilience verified during run:* Copernicus DEM GLO-30 COG hit the bounded 20 s timeout (`Copernicus COG request timed out after 20s`) and automatically fell back to `AWS Mapzen Terrarium DEM (Fallback z13)`; ESA WorldCover COG returned `fetch failed` and cleanly used the default CN fallback, completing asset generation in **`127.23 s`** (`21` files, `4.72 MB`).

| Metric / Invariant | Nagari Balingka *(Case Study #1, Track B)* | Desa Sriharjo *(Case Study #2, Track A)* |
|---|---|---|
| **DEM & Grid** | `BIG DEMNAS 8m` (`542×760`, `13.8 m`) | `AWS Mapzen Terrarium DEM (Fallback z13)` (`160×160`, `20.7 m`) |
| **Area & Relief** | `29.89 km²` · `1,032–2,869 m` | `10.97 km²` · `16–373 m` |
| **Hydrologic Network & Exposure** | `54` crossings, `6` bridges, `2,175` buildings | `73` reaches, `24` crossings, `2` bridges, `3,123` OSM buildings |
| **Soil Profile Preset** | `volcanic_andisol` | `alluvial_clay` |
| **41-Yr Climate (`1985–2025`)** | `4,203 mm/yr` (`1.073×` BMKG bias), `R24 T100 = 259 mm`, `R48 T100 = 337 mm` | `1,856 mm/yr` (`1.0×` ERA5-Land), `R24 T100 = 185 mm`, `R48 T100 = 243 mm` |
| **Normal 2h Check (`15 mm/h × 2h`)** | Peak `4.7 m³/s` *(dry)*, closure `0%` | Peak `7.6 m³/s` *(moist)*, flood `0 ha`, landslide `0 ha`, closure `0%` |
| **Intense 3h Check (`IDF-capped`)** | `40 mm/h × 3h` → Peak `125.8 m³/s`, overflow `2.2 ha`, slope `1.6 ha`, closure `0%` | `35 mm/h × 3h` (local 3h cap `35 mm/h`) → Peak `33.9 m³/s`, runoff `52.5 mm`, flood `0 ha`, landslide `0 ha`, closure `0%` |
| **Causal Hydrograph & Parameter Hygiene** | Scrubbing `progress` leaves full hydrograph unchanged | `causalHydrograph = true`, `maxClosureErrorPct = 0%`, `zeroBalingkaLeakage = true` across `9` audit rows |

---

## 5. Reproducing These Experiments

```bash
pnpm test              # Fast deterministic unit & methodology suite (node --test)
pnpm run sensitivity   # N=500 LHS + 12x7 Morris sweeps -> docs/benchmarks/sensitivity-*
pnpm run benchmark     # Analytical checks + latency + NASA POWER -> docs/benchmarks/verification-summary.json
pnpm run replicability # Isolated Option A second-village portability test -> docs/benchmarks/replicability-summary.json
```
