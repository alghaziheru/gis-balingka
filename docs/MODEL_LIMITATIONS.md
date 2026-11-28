# Model Scope, Known Limitations & Open Invitation to Researchers

> **Who built this:** **Peta Alur Air (`gis-balingka`)** is an open-source (**MIT**) civic spatial web application built by an independent software developer — **not** by a government meteorology/hydrology agency or geotechnical consulting lab. Because it is open source and public-facing, we document every physical simplification and known limitation openly so residents, students, and researchers know exactly what this tool can and cannot do.

---

## 1. What This Simulator *Is* (and *Is Not*)

- **What it is:** A **Tier-1 / Tier-2 participatory hydro-geomorphic screening and educational tool** that runs standard open-literature hydrology and slope-stability equations directly in the browser (`~50–110 ms`) on open geospatial data (**BIG DEMNAS**, **ESA WorldCover 10m**, **OpenStreetMap**, **Pemkab Agam Open GIS**, **Open-Meteo ERA5-Land**, **BMKG monthly summaries**) and can progressively assimilate field-measured culvert dimensions, river cross-sections, and High-Water Marks (**[`FIELD_SURVEY_PROTOCOL.md`](./FIELD_SURVEY_PROTOCOL.md)**).
- **What it is NOT:**
  - Not a certified hydraulic engineering design tool (such as `HEC-RAS 2D`, `LISFLOOD-FP`, `Iber`, `FLO-2D`, or `RAMMS`).
  - Not an official weather forecast, disaster warning, or house-level flood depth guarantee. Official hazard assessments, forecasts, and evacuation instructions belong exclusively to **BNPB**, **BPBD**, **BMKG**, **PVMBG**, and local **Wali Nagari / Kepala Desa** authorities.

---

## 2. Known Physical & Methodological Limitations

Every item below corresponds directly to inspectable source code so domain experts can audit or improve it:

1. **1D D8 + HAND Ceiling (No 2D Momentum, Avulsion, or Alluvial-Fan Spreading)**
   - *Where:* [`src/lib/reachRouter.ts`](../src/lib/reachRouter.ts), [`src/lib/cascadeEngine.ts`](../src/lib/cascadeEngine.ts), [`scripts/lib/reach-network.mjs`](../scripts/lib/reach-network.mjs).
   - *Limitation:* Water is routed 1D along static D8 reaches via Muskingum-Cunge and projected onto valley pixels via **Height Above Nearest Drainage (HAND)** Synthetic Rating Curves. On steep volcanic slopes and alluvial fans (*galodo* / lahar terrain), real flows can jump riverbanks (**avulsion**), travel down road corridors across drainage divides, spread laterally across convex fans, or raise channel beds mid-event through boulder/sediment deposition (**aggradation**). A 1D D8+HAND model cannot simulate those 2D/morphodynamic behaviors.

2. **Uncalibrated Screening Priors (`≤ 44/100` Readiness Cap)**
   - *Where:* [`src/lib/cascadeEngine.ts`](../src/lib/cascadeEngine.ts), [`src/data/soilProfiles.ts`](../src/data/soilProfiles.ts).
   - *Limitation:* Without local automatic water-level recorders (`AWLR`), full field river cross-section surveys, or borehole shear tests, Manning's `n`, dual-reservoir volcanic interflow lags, regional bankfull hydraulic geometry, and soil cohesion/friction presets remain conceptual literature priors. The UI intentionally caps readiness at **`Screening ≤ 44/100`** and rounds uncalibrated outputs (`~`) until field cross-sections, culvert openings, and `≥ 3` High-Water Marks are entered.

3. **Debris-Flow `'Surge'` Mode Is a Scenario Pulse Heuristic (Not Dynamic Dam-Break Storage)**
   - *Where:* [`src/lib/reachRouter.ts`](../src/lib/reachRouter.ts) (`surgeDownBoost`).
   - *Limitation:* Standard clear-water and sediment-bulked (`1 / (1 − Cv)`) routing obeys exact SMA water-balance closure (`0.000%` error in [`VERIFICATION_REPORT.md`](./VERIFICATION_REPORT.md)). However, Detailed mode's optional **`Surge`** setting applies a downstream multiplicative pulse (`up to +45%`, decaying per reach) when crossings choke, rather than physically impounding water volume upstream and releasing a finite dam-break wave. Treat `'Surge'` as a qualitative stress-test scenario rather than a volume-conserving dam-break simulation.

4. **Shallow Infinite-Slope Stability & Geometric `~20°` Runout Shadow**
   - *Where:* [`src/lib/slopeStability.ts`](../src/lib/slopeStability.ts).
   - *Limitation:* Hillslope instability uses a translational **Infinite-Slope Factor of Safety** (`Skempton–DeLory` / `SHALSTAB`-style) driven by a phenomenological pore-wetness index coupled to reach SMA storage and topographic wetness (`TWI`/curvature). It does **not** solve transient 3D Richard's unsaturated flow, deep rotational/compound landslides, or volcanic Andosol matric-suction collapse/liquefaction. The downslope shadow traces a single-direction D8 path up to `10` cells (`~330 m`) down to `H/L = tan(20°)` — whereas real liquefied volcanic debris flows in channels can travel much farther at lower angles (`8°–15°`) with lateral spreading.

5. **Climate Downscaling & Sub-Daily Tropical Extremes**
   - *Where:* [`scripts/lib/climate-fetcher.mjs`](../scripts/lib/climate-fetcher.mjs), [`src/data/climateBaseline.ts`](../src/data/climateBaseline.ts).
   - *Limitation:* Multi-duration rainfall caps derive from 41-year **ERA5-Land (`~9 km`)** daily series scaled by a 2-year monthly ratio from nearby **BMKG** stations (`128 m` and `735 m` elevation vs. Nagari Balingka's `1,032–2,869 m`) and disaggregated sub-daily using the **Mononobe** formula. Reanalysis grid smoothing misses hyper-local mountain convective cores, and monthly-mean bias scaling does not replace multi-decade sub-hourly rain-gauge IDF records.

6. **Validation vs. Model Intercomparison & Calibration Guardrails**
   - *Where:* [`src/lib/validationMetrics.ts`](../src/lib/validationMetrics.ts), [`src/components/CalibrationEditorPanel.tsx`](../src/components/CalibrationEditorPanel.tsx).
   - *Limitation:*
     - Comparing modeled FoS against the **Pemkab Agam / BPBD ground-movement map** (`BPBD Map AUC`) is a **model-to-model intercomparison** (both heavily reflect terrain slope and geology), **not** validation against a dated inventory of observed landslide scars.
     - **Copernicus Sentinel-2 NDVI scour change** (`Dec 2022 vs Jul 2024`) integrates 18.5 months of surface change rather than a single gauged storm. To prevent equifinality overfitting, UI `Auto-Solve` calibration is locked until at least **3 field High-Water Marks** are recorded.
     - The **7-scenario sensitivity envelope** in the UI perturbs correlated parameter corners (`±25%` rain + hydraulic/geotech bounds) and is **not** a formal Monte Carlo probability distribution (see the `N = 500` LHS comparison in [`VERIFICATION_REPORT.md`](./VERIFICATION_REPORT.md)).
     - The **Channel Capacity Calculator (Manning)** card in Detailed mode is a **standalone steady-state Manning + Rational Method quick check**, separate from the transient 1D Muskingum-Cunge hydrograph above it.

---

## 3. Open Invitation to Researchers, Students & Practitioners

If you are a **hydrologist, hydraulic engineer, geomorphologist, university lecturer, student, or local disaster practitioner**, your critiques and contributions are explicitly welcome:

- **Audit the math & open an issue / PR:** Every solver equation lives in plain TypeScript/ESM under [`src/lib/`](../src/lib/) and [`scripts/lib/`](../scripts/lib/), backed by automated verification benchmarks (`pnpm run benchmark`, `pnpm run sensitivity`).
- **Contribute field ground truth:** Follow [`FIELD_SURVEY_PROTOCOL.md`](./FIELD_SURVEY_PROTOCOL.md) — measuring just **10 culvert openings**, **10 river cross-sections**, and **≥ 3 post-storm High-Water Marks** with a tape measure and smartphone GPS improves local reliability far more than complex uncalibrated equations.
- **Cross-check against 2D institutional models:** Comparing our screening outputs against `HEC-RAS 2D`, `LISFLOOD-FP`, or `Iber` runs on Nagari Balingka or Malalak is hugely valuable for identifying where 1D HAND under-predicts or misses avulsion pathways.
