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

---

## 4. PoC v2 Improvements & Empirical Findings (`scripts/spike_tidal_height_v2.js`)

Following the initial `#25` spike (`scripts/spike_tidal_poc.js`), a second read-only PoC (`scripts/spike_tidal_height_v2.js`) was built to isolate and attack the actual error sources in **high-tide height prediction** (strictly offline/PoC — not promoted to production).

### Key Diagnosis: Why Rainfall RADAR (`#71`–`#76`) Does Not Help Tide Height
- **Estuary mouth (`52106` Hinkley Point & `52163` Dunball):** High water is governed by the Bristol Channel marine boundary (astronomical harmonics + shelf storm surge). Across 139 winter tides (`Dec 2025 – Feb 2026`), adding upstream river stage (`52119` Gaw Bridge + `52118` Hookbridge) to Hinkley HW changes Dunball HW error by **0.0 cm** (`3.6 cm` $\to$ `3.7 cm` MAE).
- **Upriver (`52124` West Quay Bridgwater & `52118` Hookbridge):** River discharge *does* lift the tidal crest (eliminating `-15.7 cm` winter bias at Bridgwater), but on a 1.5–12h tidal horizon that water is already in the channel and measured directly by our river stage gauges. Precipitation radar remains valuable for 12–48h *fluvial* early warning, not tide height.

### Concrete Modeling Improvements in PoC v2
1. **Full Bristol Channel Harmonic Suite (32–35 Constituents) + 18.6-Year Lunar Nodal Factors (`f, u`):**
   - The v1 PoC (5–10 constituents) omitted major resonant and nonlinear shallow-water semidiurnals that are unusually large in the Bristol Channel: `MU2` (`33.6 cm`), `L2` (`24.0 cm`), `NU2` (`15.8 cm`), `LDA2` (`12.8 cm`), `2SM2` (`12.0 cm`), `2N2` (`10.5 cm`), `T2` (`8.1 cm`), and `2MS6` (`5.2 cm`).
   - Expanding to a Rayleigh-gated 32–35 constituent set (`+ T2, Sa, Ssa` once `>= 365d` is available) with nodal factors and small ridge regularization (`1e-4`) cuts astronomical HW error roughly in half.
2. **High-Water Skew Surge Instead of 25h Boxcar Time-Series Residuals:**
   - On a steep macro-tidal flood (`~3 m/hr`), a 10-minute phase shift creates a fake ~50 cm instantaneous residual (`obs(t) - astro(t)`) that disappears at High Water. Meanwhile, the v1 25h boxcar `[t - 31h, t - 6h]` had an 18.5h effective lag that smeared fast Atlantic storms.
   - Switching to **Skew Surge** (`Observed HW - Predicted Astro HW`, using 3-point parabolic sub-15-min peak interpolation) + causal AR(1) persistence (`~12.4h` lead) removes the phase-error artifact.
3. **Offshore Meteorological Forcing Along the Surge Fetch:**
   - Replaced single-point sheltered Bridgwater Bay weather with 3 hourly Open-Meteo Archive fetch points (`data/tidal_poc_cache/tidal_poc_offshore_weather.json`, gitignored): **Bridgwater Bay** (`51.21°N, -3.13°W`), **Outer Bristol Channel** (`51.30°N, -4.20°W`), and **Celtic Sea mouth** (`51.00°N, -6.00°W`), using inverted barometer, 6h pressure tendency ($\Delta P / \Delta t$), and lagged quadratic WSW (`255°`) wind stress.
4. **Peak-to-Peak Two-Horizon Estuarine Cascade (`52106 -> 52163 -> 52124 -> 52118`):**
   - Stopped fitting sinusoidal harmonics directly to sill-truncated Dunball (`52163`), instead fitting harmonics only on open-water Hinkley (`52106`) and mapping peaks down the estuary.
   - Separated **Horizon 1 (~12h Forecast)** from **Horizon 2 (1–2h Wave-in-Channel Nowcast)** once Hinkley/Dunball physically crests.
5. **Hardened Sensor QC:**
   - Strips `-99` sentinels (`52106`), `244514` spikes (`52124`), and stuck-high fault plateaus (`7.45–7.93 m` on `52163`, including partial transition days).

### Out-of-Sample Results — PoC v2.2 (Full 374-Day EA Archive: `2025-11-16` .. `2026-11-24`, `714,738` rows)
*Note: EA's public daily CSV archive is a rolling ~375-day window (dates prior to `2025-11-16` return HTTP 404). Each split below trains on ~199–267 days (`32` standard or `42` POL shallow-water constituents + 18.6y nodal), with `T2/Sa/Ssa` unlocking once an individual training split exceeds `365` days. Partial-outage guardrails (`gap <= 30m`, `>= 5` samples in `±60m`, `|skew| <= 1.50 m`) are enabled.*

| Metric | Summer / Autumn (`>= 2026-06-03`, n=312–320) | Winter Storm Stress-Test (`Dec 2025 – Feb 2026`, n=174) |
| :--- | :---: | :---: |
| **Hinkley (`52106`) 12h HW — A. 10-const v1 baseline** | 27.7 cm MAE / 73.7 cm P95 / 115.1 cm Max | 42.1 cm MAE / 100.7 cm P95 / 130.1 cm Max |
| **Hinkley (`52106`) 12h HW — B. 32-const + Nodal** | 14.8 cm MAE / 40.9 cm P95 / 76.6 cm Max | 25.4 cm MAE / 51.7 cm P95 / 81.6 cm Max |
| **Hinkley (`52106`) 12h HW — B2. POL-42 Compound Astro** | 11.5 cm MAE / 33.5 cm P95 / 64.8 cm Max | 21.1 cm MAE / 44.4 cm P95 / 72.2 cm Max |
| **Hinkley (`52106`) 12h HW — C. + Guarded AR(1) Skew** | 10.7 cm MAE / 27.2 cm P95 / 75.2 cm Max | 13.0 cm MAE / 31.2 cm P95 / 58.0 cm Max |
| **Hinkley (`52106`) 12h HW — D. + Offshore Met Forcing** | 10.0 cm MAE / 24.7 cm P95 / 47.7 cm Max | 12.2 cm MAE / 27.6 cm P95 / 62.3 cm Max |
| **Hinkley (`52106`) 12h HW — E1. Bias-Corrected Marine HW** | 16.2 cm MAE / 39.8 cm P95 / 57.6 cm Max | 17.4 cm MAE / 41.6 cm P95 / 66.3 cm Max |
| **Hinkley (`52106`) 12h HW — E2 (v2.1, Raw Marine Diff)** | 8.8 cm MAE / 23.1 cm P95 / 45.7 cm Max | 11.2 cm MAE / 27.1 cm P95 / 42.9 cm Max |
| **Hinkley (`52106`) 12h HW — E3 (v2.2, All 4 Fixes)** | **6.1 cm MAE / 15.9 cm P95 / 38.7 cm Max** | **7.8 cm MAE / 19.1 cm P95 / 31.7 cm Max** |
| **Hinkley (`52106`) Flood-Relevant High Tides (`>= 4.5 m`) — E3** | **5.6 cm MAE / 13.1 cm P95 / 29.0 cm Max** | **7.0 cm MAE / 15.8 cm P95 / 21.9 cm Max** |
| **Dunball (`52163`) HW — Horizon 1 (12h Forecast via E3)** | **8.0 cm MAE / 21.2 cm P95 / 40.6 cm Max** | **9.7 cm MAE / 21.6 cm P95 / 30.1 cm Max** |
| **Dunball (`52163`) HW — Horizon 2 (1–2h Nowcast)** | **4.4 cm MAE / 10.0 cm P95** | **4.8 cm MAE / 10.2 cm P95** |
| **Bridgwater (`52124`) HW — Horizon 1 (12h, Sea + River via E3)** | **8.7 cm MAE / 21.4 cm P95 / 39.6 cm Max** | **9.5 cm MAE / 24.7 cm P95 / 30.1 cm Max** |
| **Bridgwater (`52124`) HW — Horizon 2 (1–2h, Sea + River)** | **6.3 cm MAE / 14.6 cm P95** | **6.8 cm MAE / 16.5 cm P95** |

### PoC v2.2 Worst-Miss Root-Cause Fixes (`Model E3`)
1. **De-Tided Open-Meteo Marine Surge (`marine_HW - marine_own_astro_HW`):** Subtracting Hinkley's astronomical tide from CMEMS's raw sea level (`v2.1`) contaminated the surge feature with ~17 cm of coarse-grid harmonic mismatch and shrunk its Ridge weight to `0.23`. Fitting harmonics directly to the Marine archive (on the train split only) and extracting both its de-tided peak skew and strictly causal `[t_HW - 24h, t_HW]` sub-tidal anomaly lifted its effective weight to `0.70–0.73`.
2. **Innovation / Error-Persistence `AR(1,2)`:** Replacing raw `prev_skew` persistence (which cut sudden storm arrivals in half and "ghosted" departing fronts) with persistence on prior *model error* (`prev_skew - prev_pureMarine` at `-12.4h` and `-24.8h`) eliminated both lag artifacts.
3. **POL-42 Bristol Channel Shallow-Water Compound Constituents:** Residual spectral analysis of Hinkley (`52106`) revealed ten `2.6–9.1 cm` cubic-friction compound constituents (`MSN2`, `SKM2`, `MNS2`, `MKS2`, `3M2S2`, `MSK2`, `M3`, `OQ2`, `MNUS2`, `3MS4`) plus compound `2MN2` nodal dominance at `L2`. Including them (with ridge `0.5`) cut pure astronomical error by `3.3–4.3 cm` MAE and removed `20–30 cm` of calm-weather equinoctial neap artifacts.
4. **2D Offshore Wind Stress (`255°` Along + `345°` Cross-Channel/Ekman) & Depth–Surge Interaction:** Projecting wind only onto `255°` missed NNW (`340°`) cross-channel set-down (e.g. `2026-01-08 22:20` `-43 cm` surge under `976.8 hPa` + `62 km/h` NNW gale). Adding orthogonal `345°` wind stress and `(H_astro - 4.3m) * pureMarineSkew` cut Winter flood-relevant (`>= 4.5 m`) worst miss nearly in half (`42.6 cm` $\to$ `21.9 cm`).

### Verified Lessons & Remaining Open Questions (PoC Backlog)
1. **BODC Multi-Year Hinkley Archive vs Rolling EA CSVs:** Hinkley Point is a UK NTSLF Class-A site operational since March 1990 (~2.6 MB/year uncompressed ASCII at 15-min intervals; **~13 MB for 5 years**, **~50 MB for a full 19-year nodal cycle**, compiling to **< 3 KB** of static harmonic constants at runtime). A 5-year fit cleanly resolves `Sa` (`7.3 cm`), `Ssa` (`3.4 cm`), and `T2` (`7.4 cm`), cutting pure astronomical MAE to ~`3–6 cm`, though net improvement on top of `Model E3` is modest (`~1–2 cm` MAE) because Innovation `AR(1,2)` + de-tided CMEMS already absorbs slow seasonal offsets.
2. **Admiralty UK Tidal API Benchmarking Role:** The UKHO Admiralty UK Tidal API (`Discovery` free tier: 6–7 days forward, no server-side caching, requires API key) supplies **pure astronomical predictions only (zero storm surge)** and does not cover inland estuarine/fluvial gauges (`52163`, `52124`). It is an ideal reference benchmark for *calm-weather astronomical accuracy*, whereas flood-relevant storm tides (`+50–82 cm` surges) still require our surge + estuarine cascade layer.
3. **Forecast-vs-Hindcast Verification (`Open-Meteo Previous Runs`):** Weather and marine caches in `data/tidal_poc_cache/` include both historical analyses/hindcasts and Day-1 `previous_runs` weather forecasts (evaluated in Section 5 below); historical Day-1 *marine* forecasts are not archived by Open-Meteo and remain a prospective validation item.
4. **Partial-outage guardrails (`2026-10-09 07:47`) resolved AR(1) poisoning:** Requiring `gap <= 30m`, `>= 5` samples in `±60m`, and `|skew| <= 1.50 m` stripped the fake `-253.3 cm` outage artifact and prevented `-127.4 cm` spillover onto the next tide.
5. **Canary gauge audit (`2025-12-05`, `2026-01-08/09`, `2026-02-05/06`, `2026-10-09`):**
   - **`E72539` (Hinkley NTSLF)** is a `0.0 cm` common-mode mirror of `52106` (identical 4h flatline at `1.277 mAOD` on `2026-10-09`) — **NOT** an independent outage fallback.
   - **`E72439` (Ilfracombe)** (`51.2111, -4.1124`) stayed 100% clean across all 6 winter storm days and `2026-10-09`, peaking a median **49 min ahead of Hinkley (`52106`)** and **58 min ahead of Dunball (`52163`)** — strong candidate independent coastal fallback & ~1h nowcast canary.
   - **`E73039` (Milford Haven)** (`51.7074, -5.0518`) also stayed 100% clean, peaking **33 min ahead of Hinkley** and **44 min ahead of Dunball**.
   - *(Minehead `51103` and Mumbles `E72939` are listed active on EA but currently return no live readings.)*
6. **Unresolved — Hookbridge (`52118`) Regime 2 Seasonal Bias:** Conditioning on pre-tide river stage (`headDiff + hPre`) tightened P95 by `~6–7.6 cm`, but did **not** eliminate the `+30 cm` winter-to-summer bias (`31.7–32.2 cm` MAE). This indicates a real seasonal channel/vegetation/penning shift that needs separate seasonal calibration (or rolling recent-tide calibration) if upriver Regime 2 crests are ever promoted. *(In winter floods `Dec–Feb`, `n=0` Regime 2 events occur because fluvial river stage is already above Dunball HW.)*

---

## 5. PoC v2.3 Storm Reality-Check (Verified — Offline PoC Only)

To evaluate what actually happens during fast-moving winter storms (rather than calm-weather astronomical tides), three offline validation checks were implemented and verified in `scripts/spike_tidal_height_v2.js` across the full 374-day archive (`2025-11-16 .. 2026-11-24`, `369` active EA archive days):

### 1. Honest Forecast-vs-Hindcast Audit (`Open-Meteo previous_runs`, Day-1 Forecasts)
Replaced ERA5 hindcast weather with actual historical **24-hour-ahead weather forecasts** (`data/tidal_poc_cache/tidal_poc_previous_runs_weather.json`, 0 nulls across `8,976` hours × 3 points) and evaluated the already-trained models strictly out-of-sample:

| Model | Regime (High Tides `>= 4.5 m`) | Hindcast MAE / RMSE / P95 | Day-1 Forecast MAE / RMSE / P95 | Delta MAE |
| :--- | :--- | :---: | :---: | :---: |
| **Model D** (Pure Weather + AR1) | Summer / Autumn (`n=168`) | `9.2 / 11.8 / 20.1 cm` | `9.7 / 12.2 / 22.9 cm` | **`+0.50 cm`** |
| **Model D** (Pure Weather + AR1) | Winter Storm (`n=91`) | `12.1 / 15.4 / 26.6 cm` | `12.2 / 15.4 / 27.1 cm` | **`+0.14 cm`** |
| **Model E3** (Hybrid + De-tided CMEMS) | Summer / Autumn (`n=168`) | `5.6 / 7.2 / 13.1 cm` | `6.0 / 7.6 / 14.5 cm` | **`+0.41 cm`** |
| **Model E3** (Hybrid + De-tided CMEMS) | Winter Storm (`n=91`) | `7.0 / 8.5 / 15.8 cm` | `6.9 / 8.4 / 15.4 cm` | **`-0.16 cm`** |

* **Takeaway:** Day-1 Open-Meteo pressure and wind forecasts hold up cleanly (`< 0.5 cm` degradation vs ERA5 hindcast).
* **Honesty caveat:** Open-Meteo's `previous_runs` API does **not** archive historical Day-1 **marine** forecasts (`previous-runs-api.open-meteo.com/v1/marine` returns `404`; `sea_level_height_msl_previous_day1` returns all-`null`). Thus `Model D` is a 100% honest Day-1 forecast test, whereas `Model E3`'s marine surge input (`pure_marine`) remains CMEMS archive analysis.

### 2. Nearshore Wave & Swell Setup Check (`Model E4`)
Added 7 strictly causal wave/swell features (`wave_height`, onshore `wave_height * max(0, cos(dir - 255°))`, `swell_wave_height` at `t_HW` and `t_HW - 3h` from `data/tidal_poc_cache/tidal_poc_marine_waves.json`, 0 nulls) on top of `Model E3`:

* **Summer / Autumn (High `>= 4.5 m`):** `Model E3` `5.6 cm` MAE (`29.0 cm` Max) vs `Model E4` `5.8 cm` MAE (`29.4 cm` Max).
* **Winter Storm (High `>= 4.5 m`):** `Model E3` `7.0 cm` MAE (`21.9 cm` Max) vs `Model E4` `7.0 cm` MAE (`22.4 cm` Max).
* **Verdict: Reject (`Model E4` adds slight noise, zero gain).** Hinkley Point is a rocky-coast gauge rather than a shallow surf beach, and local 2D wind stress + CMEMS already capture wind-driven setup.

### 3. Full-Year Coastal Canary ~1h Nowcast & Outage-Healing Benchmark (`E72439` Ilfracombe & `E73039` Milford Haven)
Backfilled the full 369-day EA archive (`35,300` rows for `E72439` Ilfracombe; `35,327` rows for `E73039` Milford Haven; `0.0 mm` diff on all 767 overlap points) into `ea_somerset_archive.db` and ran strictly out-of-sample coastal nowcasts:

| Canary & Method (`High Tides >= 4.5 m`) | Median Lead (`-> 52106 / -> 52163`) | Summer/Autumn MAE / P95 / Max (`n=170 / 138`) | Winter Storm MAE / P95 / Max (`n=91 / 90`) |
| :--- | :---: | :---: | :---: |
| **`E72439` Ilfracombe -> `52106` Hinkley** (Skew + Local 2D Wind) | **42–43 min** | **`4.8 / 11.2 / 32.4 cm`** | **`4.9 / 12.1 / 19.1 cm`** (`-0.4 cm` Bias) |
| **`E72439` Ilfracombe -> `52163` Dunball** (Skew + Local 2D Wind) | **49–54 min** | **`6.0 / 12.6 / 37.2 cm`** | **`7.7 / 17.5 / 24.8 cm`** |
| **`E73039` Milford Haven -> `52106` Hinkley** (Skew + Local 2D Wind) | **28 min** | `6.3 / 14.0 / 24.4 cm` | `7.3 / 16.2 / 24.4 cm` |
| **`E73039` Milford Haven -> `52163` Dunball** (Skew + Local 2D Wind) | **35–40 min** | `7.7 / 17.3 / 18.8 cm` | `10.7 / 25.8 / 36.7 cm` |

* **Winter storm improvement over 12h forecast:** Once Ilfracombe crests (~50 min before Dunball), Hinkley winter high-tide error drops from **`7.0 cm` MAE / `15.8 cm` P95 / `21.9 cm` Max** (`Model E3` at 12h) down to **`4.9 cm` MAE / `12.1 cm` P95 / `19.1 cm` Max**, and Dunball winter max error drops from **`30.1 cm`** to **`24.8 cm`**.
* **Hinkley Outage Healing (`2026-10-09` morning 4h flatline):** While `52106` (and its mirror `E72539`) were stuck at `1.277 mAOD`, `E72439` Ilfracombe cleanly measured `4.178 mAOD` at `04:50 UTC` (`skew = +6.0 cm`) and projected Dunball (`52163`, observed `5.851 mAOD` at `05:42 UTC`, **52 min later**) to **`5.854 mAOD` (`+0.3 cm` error, Direct Quad)** / **`5.943 mAOD` (`+9.2 cm` error, Skew transfer)**.
* **Takeaway:** **Ilfracombe (`E72439`) + local 2D wind** is the clear primary ~50-minute storm nowcast & Hinkley outage-fallback gauge (same south Bristol Channel shore); **Milford Haven (`E73039`)** works as a secondary fallback if Ilfracombe is offline.

---

## 6. Final Closing Checks for Issue #25 (Verified — Offline PoC Complete)

Two final bounded checks were completed to establish honest operational error bars for follow-up tickets `#78` and `#79` and draw a line under Issue `#25`:

### 1. Dunball Tide-Lock Timing (`t_close`, `t_open`, `duration` in Minutes — `scripts/spike_tidal_height_v2.js`)
Evaluated out-of-sample against observed `52163 >= E9094` crossings using Day-1 `previous_runs` forecast weather and causal prior-cycle `E9094(t - 12.5h)`:

| Regime & Model (Prior-Cycle `E9094(t - 12.5h)`) | Matched (`mis/fls`) | `t_close` MAE / P95 | `t_open` MAE / P95 | `duration` MAE / P95 |
| :--- | :---: | :---: | :---: | :---: |
| **Summer/Autumn (`n=241–247`) — A. v1 Baseline** | `241/247 (6/1)` | `15.0 / 40.1 min` | `17.6 / 45.6 min` | `19.9 / 48.9 min` |
| **Summer/Autumn — B. Model D (12h Day-1, no CMEMS)** | `241/241 (0/2)` | **`5.4 / 13.3 min`** (`4.2m` flood-rel) | **`10.8 / 21.6 min`** (`9.6m` flood-rel) | **`13.0 / 26.3 min`** |
| **Summer/Autumn — D. `E72439` Nowcast (~50m)** | `247/247 (0/1)` | **`5.0 / 13.8 min`** | **`10.8 / 19.9 min`** | **`11.2 / 20.0 min`** |
| **Winter Flood (`Dec–Feb`, `n=165`) — A. v1 Baseline** | `156/165 (9/4)` | `29.2 / 50.1 min` | `28.8 / 95.7 min` | `38.4 / 99.2 min` |
| **Winter Flood — B. Model D (12h Day-1, no CMEMS)** | `164/165 (1/6)` | `25.9 / 55.2 min` (`32.8m` KSD>=3m) | **`13.0 / 44.6 min`** (`11.4m` flood-rel) | `30.1 / 62.8 min` |
| **Winter Flood — C. Model E3 (12h Day-1 + CMEMS)** | `165/165 (0/7)` | `27.0 / 56.1 min` | `13.5 / 47.4 min` | `33.1 / 78.3 min` |
| **Winter Flood — D. `E72439` Nowcast (~50m)** | `164/165 (1/7)` | `28.2 / 57.0 min` | **`12.7 / 51.6 min`** (`10.8m` flood-rel) | **`13.0 / 51.6 min`** |

* **Takeaway for `#79`:** Pure-weather **`Model D` (Day-1, zero CMEMS dependency)** matches or beats `Model E3` on Dunball timing. Honest UI framing should quote **`±15 min` for door-opening (`t_open`) and summer locks**, and **`±30 min` for winter high-drain door-closing (`t_close`)** (where open-sluice discharge holds `52163` within `11–18 cm` of `E9094` on the rising limb).

### 2. Extreme-Surge Tail Stress-Test (`2023–2025` UK Storms — `scripts/spike_extreme_surge_tail.js`)
Evaluated models trained **strictly on 2025–2026** out-of-sample against 6 major 2023–2025 UK storms (**Ciaran, Isha/Jocelyn, Kathleen/Pierrick, Bert, Darragh, Éowyn/Herminia**, `n = 78` clean HW peaks; `n = 20` extreme positive surges `+50.0 to +101.5 cm`) fetched from the open **UNESCO IOC** 15-minute NOC/NTSLF archive (`hink` & `ilfa`, verified against `ea_somerset_archive.db` overlap `2026-01-07..10` to **`0.00 mm` max diff**: `hink` `-5.9000 m`, `ilfa` `-4.8000 m`; cached in `data/tidal_poc_cache/tidal_poc_ioc_*.json`):

| Subset & Model (Trained on 2025–2026 Only) | n | MAE | RMSE | P95 | Max | Bias | Tail Capture |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **All 2023–2025 Storm Cycles — Pure `POL-45` Astro** | 78 | `33.5 cm` | `41.8 cm` | `79.1 cm` | `101.5 cm` | `-23.9 cm` | — |
| **All 2023–2025 Storm Cycles — `Model D` (12h Weather+AR1)** | 77 | `18.1 cm` | `22.7 cm` | `45.2 cm` | `59.0 cm` | `-5.6 cm` | — |
| **All 2023–2025 Storm Cycles — `ilfa` Nowcast (Skew+2DW)** | 78 | **`9.8 cm`** | **`12.0 cm`** | **`20.1 cm`** | **`38.5 cm`** | **`+1.0 cm`** | — |
| **Extreme Tail (`skew >= +50 cm`) — `Model D` (12h)** | 20 | `29.4 cm` | `31.6 cm` | `45.2 cm` | `59.0 cm` | **`-28.6 cm`** | **59.2%** |
| **Extreme Tail (`skew >= +50 cm`) — `ilfa` (Skew only)** | 20 | `16.1 cm` | `22.7 cm` | `29.0 cm` | `75.3 cm` | `-15.7 cm` | 77.6% |
| **Extreme Tail (`skew >= +50 cm`) — `ilfa` (Skew + 2DW)** | 20 | **`8.7 cm`** | **`10.2 cm`** | **`16.5 cm`** | **`17.3 cm`** | **`-6.7 cm`** | **90.4%** |

* **Critical Findings:**
  1. **`Model D` (12h Weather) systematically underpredicts `+50 to +101.5 cm` extreme surges** (capturing only **59.2%**, max miss `-59.0 cm` during Storm Darragh `2024-12-06`). At 12h lead, linear weather regressions trained on a moderate year cannot fully extrapolate nonlinear shelf-surge amplification and must carry a clear uncertainty band in severe gales.
  2. **`E72439` / `ilfa` (Ilfracombe) + Local 2D Wind holds up in `+1.0 m` extreme surges** (**90.4%** tail capture, **`8.7 cm` MAE**, **`17.3 cm` max error** across all 20 extreme surges — e.g. `+100.2 cm` Storm Ciaran missed by only `-3.2 cm`, `+66.8 cm` Storm Kathleen `6.13 mAOD` spring peak missed by `+1.5 cm`). Adding Local 2D Wind cut Ilfracombe's extreme-tail max error from `75.3 cm` down to `17.3 cm`.
  3. **Real-world Hinkley outage during Storm Pierrick (`2024-04-09 05:30..08:30`):** `hink` froze at `4.003 mAOD` for 3.25h right across a `~7.34 mAOD` spring-tide storm peak while `ilfa` stayed 100% clean — reinforcing `#78`'s independent canary failover design.
