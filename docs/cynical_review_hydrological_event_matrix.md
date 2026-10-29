# 🔍 Cynical Code & Domain Review Audit

**Target Document:** `docs/hydrological_event_matrix_spec.md`  
**Reviewer:** Cynical Code Reviewer & Technical Auditor (`cynical_code_reviewer`)  
**Operating Philosophy:** Zero-Trust Engineering — Assume latent defects, mathematical fallacies, and physical inaccuracies until proven otherwise.  
**Governing Standards:** `.agents/AGENTS.md`, `.agents/skills/cynical-code-auditor/SKILL.md`, `.agents/skills/somerset-hydrology-validation/SKILL.md`.

---

## 1. Executive Verdict

- **Status:** **REJECTED WITH REQUIRED AMENDMENTS**
- **Confidence Rating:** **High** (Verified empirically against surveyed EA datums, hydraulic equations, measurement noise propagation, and database consistency).

### Executive Summary:
The Hydrological Event Matrix & State Transition Specification drafted in `docs/hydrological_event_matrix_spec.md` demonstrates commendable domain grounding in Somerset Levels flood engineering (accurate datums, polder pump trigger plan, 5-class taxonomy, and Villemonte weir physics). 

However, under rigorous zero-trust audit, the specification contains **one catastrophic mathematical defect in volume integration**, **three severe physical contradictions in state transition tables**, **internal taxonomy flip-flops between Milestone and Duration lifecycles**, **insufficient dual-gauge sensor noise deadbands**, and **omissions in SQLite referential integrity**.

It cannot be approved for life-safety telemetry processing without mandatory amendments.

---

## 2. Invariant Breakdown

| Domain / Invariant | Status | Empirical Evidence / Specification Reference |
| :--- | :---: | :--- |
| **Hydrological Ground Truth & Datums** | **PASS** | Surveyed datums Newlyn (+75.69m, +16.58m, +12.47m, +20.70m, +10.00m, +5.000m, +5.185m) correctly specified in Section 4 and 8. All stages evaluated strictly in mAOD. |
| **Alert Strict Bounding Inequality [RULE-ALT-01]** | **PASS** | All 19 stations satisfy $\text{minOnRecord} \le Z_{\text{invert}} < \text{typicalRangeLow} < \text{alert\_level} \le \text{maxOnRecord}$. Verified against EA `stageScale` calibrations. |
| **Canonical 5-Class Taxonomy [RULE-TAX-01..05]** | **PASS** | In-channel river gauges are strictly forbidden from defining crests or emitting overtopping events. Spillways define surveyed crest elevations. Lowland basins follow polder pump regimes without crest lines on hydrographs. |
| **Polder Pumping Sequencing [RULE-PUMP-01]** | **PASS** | Curry Moor (Mobile Order 5.80m, Active 6.10m, Critical 6.50m) and Northmoor (Mobile Order 4.80m, Active 5.20m, Critical 5.60m) match the EA Trigger Point Plan. Normal penning (< 7.30m Midelney, ~4.30m Curry Moor) does not trigger flood warnings. |
| **Inter-Moor Cascade vs. Levee Overtopping** | **PASS** | Correctly decouples Cuts Road cascade (Athelney Spillway 7.35m AOD, Curry Moor $\to$ Northmoor) from direct river overtopping (Baltmoor Wall 7.80m AOD). |
| **Villemonte Weir & Hydraulic Equations** | **WARN** | Free-flow and submerged reduction factor $[1 - S^{1.5}]^{0.385}$ are mathematically sound. However, reverse head condition ($h_{\text{moor}} > h_{\text{river}} \ge Z_{\text{crest}}$) contains an unnecessary constraint ($h_{\text{river}} \ge Z_{\text{crest}}$) that fails when river levels fall below crest. Clyse orifice formula lacks an engineering qualification regarding unbroadcast gate apertures. |
| **Finite State Transitions & Directional Hysteresis** | **FAIL** | Tables 4.1, 4.2, and 4.4 erroneously apply hysteresis deadbands on the **RISING** leg ($h \ge Z_{\text{crest}} - \delta$), which violates physical causality (weirs cannot overtop before reaching the crest). |
| **Anti-Flapping Sensor Noise Deadbands** | **FAIL** | Proposed $\delta = 2\text{cm}$ for Monk's Leaze Clyse head differential ($\Delta H$) is narrower than the composite $2\sigma$ measurement noise ($\pm 2.8\text{cm}$) of two independent ultrasonic sensors, guaranteeing state flapping near equilibrium. |
| **Event Lifecycle Integrity** | **FAIL** | Contradictions between Section 3, Section 4, and Section 7: `SPILLWAY_APPROACHING` is defined as a `MILESTONE` in Section 3 and Table 4.1, but instantiated and queried as an active `DURATION` event in Section 7. `PUMP_MOBILE_ACTIVE` is listed as `MILESTONE` in Section 3, but `DURATION` in Section 4.2. |
| **Volumetric Integration Algorithm** | **FAIL** | Section 7 line 654 calculates interval volume using `activeEvent.peak_discharge_m3s` (historic peak of the entire event) instead of the previous interval's discharge $Q(t_{k-1})$, massively overestimating accumulated volume by an order of magnitude. |
| **SQLite Schema & Data Integrity** | **WARN** | Missing check constraint linking `lifecycle_type` with `status`. Missing `current_discharge_m3s` column. Missing `image_hash` and `camera_snapshot_id` columns in `hydraulic_events` despite Section 5 workflow mandating image hash attachment. |
| **Camera Correlation & Anti-Thrashing** | **WARN** | 300-second rate-limiting cooldown and SSRF domain allowlists are sound. However, Table 5.1 omits `#huish` from Huish Episcopi's camera anchor URL. |
| **Single Source of Truth [RULE-SSOT-01]** | **WARN** | Deadband constants are defined as a local literal dictionary in Section 7 rather than being declared centrally in `src/js/hydro_engine.js`. |
| **Automated Dual Audit Test Suite** | **PASS** | Repository test suite passes 100% across all 94 domain and UI/UX invariant tests (`node --test`). |

---

## 3. Cynical Scrutiny: Edge Cases & Potential Hazards

### Defect 1: Catastrophic Volumetric Overestimation in Trapezoidal Integration
- **Code Reference:** Section 7, `updateDurationEvent()`, line 654:
  ```javascript
  const avgFlow = (Number(activeEvent.peak_discharge_m3s || flowM3s) + flowM3s) / 2;
  const intervalVolume = avgFlow * dtSeconds;
  ```
- **Hazard:** `activeEvent.peak_discharge_m3s` represents the all-time maximum flow rate observed during the entire multi-day event. In standard numerical integration, the trapezoidal rule requires the discharge at the previous observation step:
  $$\Delta V_k = \frac{Q(t_{k-1}) + Q(t_k)}{2} \cdot \Delta t$$
- **Reproduction Scenario:** A spillway overtopping event experiences a brief peak flow of $24.0\text{ m}^3/\text{s}$ at hour 4. Twelve hours later, the flow has receded to a calm trickle of $0.8\text{ m}^3/\text{s}$ (with $Q(t_{k-1}) = 0.9\text{ m}^3/\text{s}$). The reference code computes:
  $$\text{avgFlow} = \frac{24.0 + 0.8}{2} = 12.4\text{ m}^3/\text{s}$$
  The computed interval volume is $12.4 \times 900 = 11,160\text{ m}^3$, instead of the true physical volume $\frac{0.9 + 0.8}{2} \times 900 = 765\text{ m}^3$. This overestimates flood redistribution by **1,358%**, leading emergency managers to believe polders are filled to capacity when they are not.
- **Required Mitigation:** Add `current_discharge_m3s REAL` to `hydraulic_events`. Update line 654 to:
  ```javascript
  const prevFlow = Number(activeEvent.current_discharge_m3s ?? flowM3s);
  const avgFlow = (prevFlow + flowM3s) / 2;
  ```

---

### Defect 2: Physical Contradiction in Rising Trigger Thresholds
- **Code References:** Table 4.1 line 201 (`SPILLWAY_OVERTOPPING_ACTIVE`), Table 4.2 line 262 (`INTER_MOOR_CASCADE_ACTIVE`), Table 4.4 line 311 (`TIDE_LOCK_ACTIVE`).
- **Hazard:** The tables state:
  - `SPILLWAY_OVERTOPPING_ACTIVE`: Trigger Condition (Rising) = $h_{\text{river}} \ge Z_{\text{crest}} - 0.03\text{m}$.
  - `INTER_MOOR_CASCADE_ACTIVE`: Trigger Condition (Rising) = $h_{52127} \ge 7.32\text{m AOD}$.
  - `TIDE_LOCK_ACTIVE`: Trigger Condition (Rising) = $h_{\text{sea}} \ge h_{\text{inland}} - 0.05\text{m}$.
- **Physics Violation:** A physical barrier (weir lip, road crown) cannot overtop until stage reaches the actual physical crest! Subtracting the deadband $\delta$ on the *rising leg* causes overtopping to trigger while water is still 3 cm below the weir lip ($7.42\text{m AOD}$ at Hookbridge). The hysteresis deadband applies **strictly to the falling/exit leg** ($h < Z_{\text{crest}} - \delta$).
- **Required Mitigation:** Correct all table rows:
  - Rising Trigger: $h \ge Z_{\text{crest}}$ (e.g. $7.45\text{m}$, $7.35\text{m}$).
  - Falling Exit: $h < Z_{\text{crest}} - \delta$ (e.g. $< 7.42\text{m}$, $< 7.32\text{m}$).

---

### Defect 3: Lifecycle Inconsistency (Milestone vs. Duration Flip-Flop)
- **References:** Section 3 (lines 125, 127) vs Section 4.1 (line 199) vs Section 7 (lines 604–625).
- **Hazard:** Section 3 classifies `SPILLWAY_APPROACHING` as a `MILESTONE` event. Table 4.1 also lists it as `Milestone` with a clear condition. However, Section 7 implements `SPILLWAY_APPROACHING` by calling `openDurationEvent` and `closeDurationEvent`, querying for `status = 'ACTIVE'`. If `SPILLWAY_APPROACHING` is a milestone, it has `status = 'OCCURRED'` and zero duration.
- **Required Mitigation:** Formalize the lifecycle definitions:
  - `SPILLWAY_APPROACHING`: Duration event representing an active cautionary pre-overtopping state ($Z_{\text{crest}} - 0.30\text{m} \le h < Z_{\text{crest}}$).
  - `PUMP_MOBILE_ACTIVE`: Duration event tracking continuous temporary pumping.
  - `PUMP_MOBILE_ORDERED`: Point-in-time logistics dispatch `MILESTONE`.

---

### Defect 4: Inadequate Deadband for Monk's Leaze Clyse Dual-Gauge Differential ($\Delta H$)
- **Reference:** Section 2.2 Table line 102 (`clyse_gate` deadband $\delta = 0.02\text{m}$).
- **Hazard:** The gate differential is computed from two independent sensors: $\Delta H = h_{52233} - h_{52234}$. With individual sensor measurement uncertainty $\sigma \approx 0.01\text{m}$, the composite standard error is:
  $$\sigma_{\Delta H} = \sqrt{\sigma_1^2 + \sigma_2^2} = \sqrt{0.01^2 + 0.01^2} \approx 0.0141\text{ m} \quad (1.41\text{ cm})$$
  The $95\%$ confidence interval ($2\sigma$) is $2.82\text{ cm}$. A deadband of only $2.0\text{ cm}$ is narrower than natural sensor noise. Telemetry jitter will induce continuous oscillation between `CLYSE_DIVERSION_OPEN` and `THROTTLED`/`CLOSED`.
- **Required Mitigation:** Increase the dual-gauge differential deadband to $\delta_{\Delta H} = 0.05\text{m}$ (5 cm).

---

### Defect 5: State Collision and Priority Ambiguity in Clyse Gates
- **Reference:** Section 4.3 Table lines 286, 289.
- **Hazard:** When $h_{\text{down}} \ge h_{\text{up}}$, $\Delta H = 0$. This simultaneously satisfies:
  - `CLYSE_REVERSE_LOCK` ($h_{\text{down}} \ge h_{\text{up}}$, Severity 2)
  - `CLYSE_PENNING_CLOSED` ($\Delta H \le 0.05\text{m}$, Severity 5)
  Without an explicit precedence rule, an implementation evaluating `CLYSE_PENNING_CLOSED` first will classify a severe downstream head reversal as routine nominal penning.
- **Required Mitigation:** Guard `CLYSE_PENNING_CLOSED` with $h_{\text{up}} > h_{\text{down}}$, and enforce strict evaluation order: Reverse Lock $\to$ Throttled $\to$ Open $\to$ Penning Closed.

---

### Defect 6: Flawed Spillway Reverse Head Invariant
- **Reference:** Section 4.1 line 203:
  $$h_{\text{moor}} > h_{\text{river}} \ge Z_{\text{crest}}$$
- **Hydraulic Flaw:** If the river hydrograph recedes rapidly below crest ($h_{\text{river}} < Z_{\text{crest}}$) following a flash flood peak, while the polder basin remains impounded above crest ($h_{\text{moor}} > Z_{\text{crest}}$), reverse overtopping is physically occurring. However, this rule requires $h_{\text{river}} \ge Z_{\text{crest}}$, causing the event to prematurely clear or fail to trigger!
- **Required Mitigation:** Formulate the reverse spillway overtopping condition as:
  $$h_{\text{moor}} \ge Z_{\text{crest}} \quad \text{AND} \quad h_{\text{moor}} > h_{\text{river}}$$

---

### Defect 7: SQLite Schema Deficiencies & Phantom Foreign Keys
- **Reference:** Section 6.1 DDL.
- **Issues:**
  1. No check constraint binds `lifecycle_type` to `status`:
     ```sql
     CHECK (
       (lifecycle_type = 'DURATION' AND status IN ('ACTIVE', 'CLOSED')) OR
       (lifecycle_type = 'MILESTONE' AND status = 'OCCURRED')
     )
     ```
  2. `camera_id TEXT` is commented as a foreign key, but no parent camera table is defined.
  3. Section 5 specifies attaching `image_hash` and referencing `camera_analysis`, yet `hydraulic_events` lacks an `image_hash` column or `camera_snapshot_id REFERENCES camera_analysis(id)`.
  4. Missing `current_discharge_m3s REAL` column necessary for trapezoidal numerical integration.

---

### Defect 8: Omission of Initial Muchelney Road Flooding ($7.30\text{m AOD}$)
- **Reference:** Section 4.5 line 329 vs Table 4.5.
- **Issue:** Section 4.5 text documents $7.30\text{m AOD}$ as the initial road encroachment threshold, but Table 4.5 omits it entirely, listing only `MUCHELNEY_CUTOFF_RISK` ($7.70\text{m AOD}$). In operational hydrology, $7.30\text{m AOD}$ triggers emergency road closure signage and community tractor shuttle operations.
- **Required Mitigation:** Add `MUCHELNEY_ROAD_INUNDATED` ($h_{\text{yeo}} \ge 7.30\text{m AOD}$, Severity 4) to Table 4.5.

---

### Defect 9: Camera Anchor URL Discrepancy
- **Reference:** Section 5.1 Table 5.1 line 392.
- **Issue:** Huish Episcopi host URL anchor is listed as `thecfh.org/parretttonewsom.php` without an anchor fragment. The codebase (`src/js/app.js` line 864) and upstream cameras all use fragment anchors (`thecfh.org/parretttonewsom.php#huish`).
- **Required Mitigation:** Add `#huish` anchor to Table 5.1.

---

### Defect 10: Single Source of Truth Hysteresis Declarations [RULE-SSOT-01]
- **Reference:** Section 7 lines 536–544.
- **Issue:** Deadband constants are declared locally in the class constructor rather than exported from `src/js/hydro_engine.js`.
- **Required Mitigation:** Add `HYDRO_DEADBANDS` to `src/js/hydro_engine.js` alongside `HYDRO_THRESHOLDS`.

---

## 4. Required Amendments Summary

Before this specification is approved as an authoritative domain standard:
1. **Fix Trapezoidal Integration:** Add `current_discharge_m3s` to `hydraulic_events` and compute $\Delta V = \frac{Q(t_{k-1}) + Q(t_k)}{2} \Delta t$.
2. **Correct Rising Triggers:** Update all rising transition triggers to $h \ge Z_{\text{crest}}$ without subtracting deadbands.
3. **Harmonize Lifecycles:** Unify `SPILLWAY_APPROACHING` as `DURATION` across Section 3, Section 4, and Section 7.
4. **Expand Clyse Deadband:** Increase Monk's Leaze Clyse differential deadband to $\delta_{\Delta H} = 0.05\text{m}$.
5. **Add State Precedence to Clyse Gates:** Enforce `CLYSE_REVERSE_LOCK` over `CLYSE_PENNING_CLOSED`.
6. **Correct Reverse Head Logic:** Define reverse spillway flow as $h_{\text{moor}} \ge Z_{\text{crest}} \land h_{\text{moor}} > h_{\text{river}}$.
7. **Harden SQLite DDL:** Add lifecycle-status CHECK constraint, `current_discharge_m3s`, and explicit `image_hash` / `camera_snapshot_id` columns.
8. **Restore Muchelney Road Event:** Include `MUCHELNEY_ROAD_INUNDATED` ($7.30\text{m AOD}$) in the matrix.
9. **Fix Huish Camera Anchor:** Append `#huish` to camera URL anchor.
10. **Export `HYDRO_DEADBANDS`:** Place all hysteresis values into `src/js/hydro_engine.js`.

---

## 5. Final Recommendation

**REJECTED WITH REQUIRED AMENDMENTS.**  
The specification provides a solid foundation for Somerset Levels hydrology, but its algorithmic and physical contradictions in volumetric tracking, rising triggers, and sensor deadbands pose life-safety data integrity risks. Once the 10 amendments above are incorporated, the specification will be ready for engineering sign-off.
