# Estuarine & Coastal Tidal Forecasting: Practical Methods Guide

This note captures the general methodology and minimum data requirements learned from the Issue #25 Somerset Levels tidal surge & Dunball tide-lock PoC (`scripts/spike_tidal_poc.js`, `scripts/backfill_ea_archive.js`). It is intended as a reusable checklist if we apply similar work to other coastal tide gauges, estuarine outfalls, or tide-locked structures in the future.

---

## 1. Minimum Viable Inputs ("What You Need First")

Before writing any model code, verify that you have:

1. **An open-coast / outer-estuary reference tide gauge**
   - **Resolution:** 15-minute (or finer) water level in a consistent datum (`mAOD` Newlyn).
   - **Span:**
     - `>= 28–45 days` minimum to separate `M2`, `S2`, `N2` (spring–neap + lunar perigee) and shallow-water overtides (`M4`, `MS4`, `MN4`).
     - `>= 183 days` (~6 months) to safely separate `K2` from `S2` and `P1` from `K1` (Rayleigh criterion).
     - `>= 365 days` to fit seasonal constituents (`Sa`, `Ssa`).
   - *Somerset example:* Hinkley Point (`52106`).

2. **A target estuarine / outfall gauge**
   - **Resolution & datum:** 15-minute `mAOD`, **covering both dry baseflow and winter high-flow seasons**. A model validated only on late-summer/autumn baseflow can fail badly in winter.
   - *Somerset example:* Dunball Sluice (`52163`).

3. **A receiving-channel gauge (for tide-locked outfalls/sluices)**
   - Tide-locking happens when `H_estuary >= H_channel` (plus any flap-gate headloss), **not** at a fixed elevation. You need the inland channel stage right behind the outfall.
   - *Somerset example:* King's Sedgemoor Drain at Dunball (`E9094`).

4. **Upstream river & rainfall gauges (for fluvial-tidal interaction)**
   - Essential whenever freshwater runoff modulates the estuary's low-tide floor, ebb duration, or inland channel stage during a lock window.

5. **Clean unit & datum normalization**
   - Upstream public archives are not always consistent across years. For example, EA archive CSVs from Dec 2025 – early 2026 used `-m` suffixes on `52163` and `E9094` where live telemetry uses `-mAOD`. Always normalize by station/parameter prefix and verify vertical datums before merging series.

---

## 2. Core Pipeline

### Step 1: Fit the Astronomical Tide with Rayleigh Guardrails
Use ordinary least-squares harmonic regression on the outer coastal gauge, **strictly gated by training span** so near-collinear constituents do not overfit:
- **14–27 days:** `M2`, `S2`, `K1`, `O1`, `M4`, `MS4`
- **28–182 days:** add `N2`, `MN4`
- **183+ days:** add `K2`, `P1`
- **365+ days:** add `Sa`, `Ssa`

*Why shallow-water overtides (`M4`, `MS4`, `MN4`) matter:* In macro-tidal, shallow estuaries like the Bristol Channel, the tide curve is asymmetric (faster flood, slower ebb). Fitting directly on local 15-minute gauge data captures this asymmetry; 4-point High/Low Water tide tables do not give you the intermediate curve shape without extra interpolation assumptions.

### Step 2: Extract Causal Non-Tidal Surge (25h Low-Pass, Not Short-Lag Residual)
Compute `residual(t) = observed(t) - astronomical(t)`.
- **Do not** persist a raw short-lag (e.g. 6-hour) residual forward. Any unmodeled semidiurnal constituent error (`~12.4h` period) flips sign ~6 hours later, making predictions worse.
- **Do** use a **causal 25-hour rolling mean** (~2 tidal cycles) of past residuals. This averages out semidiurnal/diurnal fitting errors and isolates slow meteorological/sub-tidal surge.
- To forecast surge *beyond* simple 25h persistence (e.g. fast-moving Atlantic lows), pair historical 25h surge residuals with forecast sea-level pressure (inverted barometer `~ -1 cm/hPa`) and coastal wind speed/direction (e.g. from a free marine/weather forecast feed).

### Step 3: Transfer Coast -> Estuary Directionally (Flood vs. Ebb)
An estuarine gauge is not a simple time-shifted copy of the outer coast:
- **Fit flood (rising) and ebb (falling) mid-tide crossings separately.** Flood propagation speed and amplitude attenuation differ from ebb drainage.
- **Do not try to predict the estuarine low-tide floor from the coastal gauge.** Below mid-tide, estuarine low water is governed by channel sill geometry and freshwater river discharge, not the sea.

### Step 4: Estimate Tide-Lock Intervals Properly
For a gravity outfall (`H_tide >= H_channel`):
1. **Use linear sub-sample interpolation** between 15-minute readings to find `t_close` and `t_open`; otherwise 15-minute quantization adds unnecessary step error.
2. **Account for channel rise during the lock.** Freezing `H_channel` at `t_close - 3h` works in dry weather when the inland drain barely moves (`~15 cm` in Aug–Nov), but fails in winter when `E9094` can climb `1.5–2.3 m` during a single 5-hour lock. Using the prior tidal cycle (`H_channel(t - 12.5h)`) as a causal baseline cut winter `E9094(t_open)` error sharply (`150.9 cm -> 14.8 cm` MAE in Dec–Jan) with zero fitted parameters; adding upstream river/rain wave tracking is the logical next step when fluvial inflow is changing rapidly.

---

## 3. Validation & Governance Rules

- **Strict chronological splits only:** Never use random/shuffled cross-validation on tidal or river time series. Train on earlier months, test on later months (and explicitly test across **both** summer baseflow and winter flood seasons).
- **Separate research DB during backtesting:** Keep bulk historical CSV backfills in an isolated gitignored database (e.g. `ea_somerset_archive.db`) rather than mutating the production `telemetry.db`.
- **Compare against simple causal baselines:** Every added term (wind, pressure, upstream lag) must beat simple persistence (`t - 12.5h` / 25h low-pass) out-of-sample before being trusted.
- **No unmeasured hydrology (`[RULE-CALC-01]`, `[RULE-SUB-01]`):** Work strictly in observed/predicted **stage (`mAOD`)**, **clearance (`m`)**, and **duration (`min`/`h`)** unless you actually have calibrated rating curves, gate apertures, and pump telemetry.
