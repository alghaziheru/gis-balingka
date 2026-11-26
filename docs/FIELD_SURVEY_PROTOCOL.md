# Field Survey Protocol — Peta Alur Air Hydrology Calibration (Tier 3)

> **Why this matters:** Adding **10 real culvert/bridge opening measurements**, **10 river cross-sections**, and **3+ High-Water Marks (HWM)** improves hydraulic model reliability far more than complex 2D equations running on unverified geometric assumptions.

---

## 1. Equipment Needed (Zero Specialized Gear)
- 1 × 5 m or 10 m **carpenter/fiberglass tape measure** (or laser distance meter).
- 1 × **smartphone with GPS** (offline maps / camera for timestamped photos).
- 1 × printed **Priority Survey Sheet (CSV)** downloaded from **Detailed Mode → Editor → Calibrate → Download Field Survey Priority Sheet (CSV)**.
- Optional: **permanent marker / chalk** to measure mud or water-line heights on concrete bridge abutments.

---

## 2. Priority Targets to Measure First

Download `<region-id>-field-survey-priority.csv` (e.g., `nagari-balingka-field-survey-priority.csv`) directly in the app. It ranks the highest-drainage-area unmeasured structures and reaches in the active region (highest `upstream_area_km2` first).

### A. Culverts & Bridges (Target: Top 10 Crossings)
At each bridge or road culvert:
1. **Opening Shape & Dimensions**:
   - **Box culvert / Bridge span:** measure clear internal **width (m)** and **height from channel bed to soffit/deck underside (m)** (e.g., `Box 2.2m x 1.5m` or `Bridge 6.5m x 2.8m`).
   - **Pipe culvert:** measure **internal diameter** (e.g., `Pipa Ø 80cm` or `Ø 1.0m`; if twin pipes, note `2x Ø 80cm`).
2. **Physical Condition**:
   - `normal` (clear opening, intact concrete/stone masonry)
   - `clogged` (sediment, boulders, branches, or trash blocking >30% of opening)
   - `damaged` (cracked headwall, undermined apron, scouring)
   - `critical` (`Rusak Berat` — structural collapse, severe undercutting, or >70% obstruction)
3. **Enter into App:** **Detailed → Editor → Structures → Select/Place structure → Enter `size_note` (e.g., `Box 1.8m x 1.2m`), `status`, and `Save`.**

### B. River & Stream Cross-Sections (Target: Top 10 Reaches)
Choose straight, uniform 15–30 m stretches away from bends or bridge piers:
1. **Top bankfull width (`width_post_m`)**: measure distance between left and right top-of-bank edges where water begins spilling onto adjacent fields/yards.
2. **Historical pre-scour width (`width_pre_m`, optional)**: if residents clearly remember an earlier channel width before bank widening, record it separately.
3. **Channel depth (`depth_m`)**: average vertical drop from top-of-bank level down to the deepest bed thalweg.
4. **Enter into App:** **Detailed → Editor → Waterways → Select reach → Enter `width_post_m`, `depth_m` → Save → Click `Burn into DEM & Recompute`.**

### C. High-Water Marks / `Tanda Tinggi Air` (Target: ≥ 3 Points)
After any notable storm or heavy rain event:
1. Look for **mud lines on bridge piers/culvert headwalls**, flattened grass/debris lodged in roadside shrubs, or eyewitness wall marks.
2. Measure vertical height **above local ground or channel bed (`observed_depth_m`)** with a tape measure.
3. Record approximate **hourly rain rate (`rain_mm_hr`)**, **storm duration (`duration_min`)**, and **prior 5-day rain (`P5 mm`, from BMKG/rain gauge or local log)**.
4. **Enter into App:** **Detailed → Editor → Calibrate → Add Field Benchmark Point → Click location → Enter observed depth & storm inputs → Save → Run `Auto-Solve`.**

---

## 3. Data Quality & Safety Rules
- **Safety first:** Never enter active floodwaters or unstable cliff bases during heavy rain. Measure cross-sections and culverts only during dry weather or low baseflow.
- **Keep coordinates accurate:** Stand beside the bridge/culvert for 10 seconds so phone GPS settles before snapping or checking against OSM road crossings in the app.
- **Never delete audit trail:** Always include your name and brief field reason when saving edits so university researchers and Nagari officials can trace field-verified measurements vs. DEM estimates.
