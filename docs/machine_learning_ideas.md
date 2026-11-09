# Machine Learning, Pattern Discovery & Future Data Ideas

**Status:** Exploratory / Research Notes  
**Governing Rules:** `[RULE-HUM-01]` (Epistemic Humility), `[RULE-PROV-01]` (Anti-Overinterpretation), `[RULE-SUB-01]` (Empirical Substantiation), `[RULE-CALC-01]` (No Speculative Cumecs), `[RULE-CAM-01]` (Optical Field-of-View Fidelity)

---

## 1. Core Philosophy: "Scrape & Align First, Analyze Later"

Algorithms can be written, swapped, or thrown away in an afternoon, **but you can never go back and capture transient data you didn't record** (webcam frames, active EA Flood Warning polygons, or high-resolution 15-minute multi-station snapshots).

By ensuring our backend continuously scrapes and aligns the core physical signals onto a shared 15-minute clock in SQLite (and bulk-backfills multi-year historical CSV archives from the Environment Agency Hydrology API), we create a clean dataset that offline statistical and unsupervised machine learning tools can explore without risking black-box hallucinations in the live UI.

### The Core "Scrape First" Signals
1. **River & Polder Water Stage (`mAOD` / `m`):** All ~20+ gauges across the Tone, Parrett, Yeo, Isle, Sowy/KSD, Cary, Brue, and flanking moors (`15m` cadence).
2. **Upstream Tipping-Bucket Rainfall (`mm`):** EA rain gauges in the upper hills (Blackdown Hills, Crewkerne/Yeovil hills, Mendips, Pitminster) via the exact same EA Hydrology API (`15m` cadence + rolling `6h`, `24h`, `72h`, and `30d` totals).
3. **Estuarine & Coastal Tides (`mAOD`):** Measured stage at Dunball (`52120`), Northmoor (`52116`), and Saltmoor (`52109`) paired against deterministic astronomical tide predictions for Bridgwater Bay / Hinkley Point.
4. **Optical Webcam Ring Buffer & Event Archives:** 25 `thecfh.org` cameras across 7 hydraulic zones (`5m` poll cycle, `48h` rolling buffer + permanent transition sequences).
5. **Official EA Flood Alerts & Warnings:** Active flood warning/alert severity transitions across Somerset catchment target areas.

---

## 2. Why Naive Unsupervised ML Fails on River Networks (The Threshold Trap)

If you feed raw water stage time series from river and moor gauges into a standard linear correlation matrix, PCA, or naive autoencoder, the algorithm will fail to find the most important flood relationships because **engineered lowland drainage systems are piecewise non-linear**:

* **Example (Hookbridge Spillway & Curry Moor):**
  * For **98% of the year**, when the River Tone at Hookbridge (`52419`) is below `7.11m AOD`, the river and Curry Moor (`52420`) are separated by a solid clay flood bank. Their statistical correlation is near **zero**.
  * For the **2% of the year** when Hookbridge rises above `7.11m AOD`, water pours over the 115m spillway crest and the two gauges become **tightly coupled** (with a phase lag).
* **The Trap:** A naive algorithm averages the 98% dry-bank regime with the 2% overtopping regime and concludes that Hookbridge and Curry Moor are unrelated.

### How to Feature-Engineer for Unsupervised Discovery
Before feeding telemetry into clustering, manifold learning, or correlation algorithms, transform raw stages $h_i(t)$ into physically meaningful features:
1. **Rates of Change (First & Second Derivatives):** $\dot{h}_i(t) = \Delta h_i / \Delta t$ (`m/hr` over `1h`, `3h`, `6h` windows) and acceleration $\ddot{h}_i(t)$.
2. **Threshold Excess (Rectified Linear / ReLU Hinge Features):**
   $$e_i(t) = \max\big(0,\; h_i(t) - h_{\text{crest}}\big)$$
   For example, excess above Hookbridge Spillway (`7.11m AOD`), Allermoor Spillway (`6.73m AOD`), Athelney Spillway (`7.35m AOD`), or road crown levels (`4.30m AOD`).
3. **Hydraulic Head Differentials ($\Delta h$ across structures):**
   $$\Delta h_{A \to B}(t) = h_{\text{upstream}}(t) - h_{\text{downstream}}(t)$$
   Across Monks Leaze Clyse, Beer Wall Sluices, Dunball Clyse, and pumping station outfalls.
4. **Antecedent Wetness / Saturation Proxy:** 72-hour storm rainfall paired with a 30-day exponentially decayed Antecedent Precipitation Index ($\text{API}_{30}$).

---

## 3. Four High-Value Unsupervised ML Applications ("Picking the Bones Out of the Data")

These techniques can be run offline (in Python/Node scripts or notebooks against a replica of `flood_cache.db`) so we can inspect what they find with our own eyes and only promote transparent, human-verifiable rules to the dashboard.

### A. "Historical Twins" — $k$-Nearest Neighbours ($k$-NN) & Dynamic Time Warping (DTW)
Instead of building a black-box neural network to predict tomorrow's river stage, treat every 24-hour window in history as a state vector:
$$\mathbf{x}(t) = \Big[\text{Rain}_{6\text{h}},\; \text{Rain}_{24\text{h}},\; \text{API}_{30},\; \text{TideRange},\; h_{\text{Gawbridge}},\; \dot{h}_{\text{Gawbridge}},\; h_{\text{Hookbridge}},\; \dot{h}_{\text{Hookbridge}},\; h_{\text{CurryMoor}},\; \dots\Big]$$

* **How it works:** Given today's live state vector $\mathbf{x}(t_{\text{now}})$, run an unsupervised **Nearest-Neighbour ($k$-NN)** or **multi-dimensional Dynamic Time Warping (DTW)** search across 10+ years of historical EA telemetry to find the 3 to 5 historical flood events that looked most identical to right now.
* **Why it passes `[RULE-HUM-01]`:** It never pretends to be a hydrodynamic simulator. It states a verifiable historical fact:
  > *"The 3 closest historical matches to today's catchment trajectory were **19 Jan 2026**, **23 Dec 2020**, and **04 Feb 2014**. Here are their actual 48-hour trajectories overlaid as ghost lines on today's chart."*
* **Human verification:** Any user can look at the ghost sparklines from those 3 past storms alongside today's curve and judge for themselves how closely they match.

### B. Reverse-Engineering Unbroadcast Operator Actions (Regime Clustering)
The Environment Agency does not publish live SCADA telemetry showing when sluice gates (Monks Leaze Clyse, Oath Lock, Beer Wall tilting weirs) are opened or when additional mobile pumps are started at Curry Moor, Saltmoor, or Dunball.

* **How it works:** Run unsupervised density clustering (**HDBSCAN** or **Gaussian Mixture Models**) on the joint distribution of upstream stage, downstream stage, and downstream rate-of-change:
  $$\big(h_{\text{Parrett at Monks Leaze}},\; h_{\text{Sowy/KSD}},\; \dot{h}_{\text{Sowy/KSD}}\big)$$
* **What it uncovers:**
  1. **Closed-Gate Regime:** When Monks Leaze Clyse is closed and Allermoor (`6.73m AOD`) is not overtopping, $\dot{h}_{\text{Sowy}}$ is decoupled from $h_{\text{Parrett}}$.
  2. **Manual Sluice Diversion Regime:** When EA operators open Monks Leaze (`< 6.73m AOD`), a distinct cluster appears where Sowy stage rises rapidly in proportion to $\sqrt{h_{\text{Parrett}} - h_{\text{Sowy}}}$.
  3. **Spillway Overtopping Regime:** Above `6.73m AOD`, a third steeper cluster appears as the 35m Allermoor fixed weir begins spilling.
  4. **Polder Drawdown Rates:** Clustering $\dot{h}_{\text{CurryMoor}}$ during receding river conditions naturally separates **gravity drainage**, **fixed duty pumping (3 permanent pumps)**, and **high-capacity mobile pump drawdown**, giving us true empirical drawdown rates (`mm/hr`) for each mode.

### C. Empirical Wave Celerity & Lag Discovery (Windowed Cross-Correlation Matrix)
How long does a flood crest take to travel down each arm of the catchment, and how much faster does that wave travel when the floodplain is already wet vs. dry?

* **How it works:** Compute a sliding-window **lagged cross-correlation matrix** $R_{ij}(\tau)$ across all station pairs $(i, j)$ for time lags $\tau \in [0\text{h}, 72\text{h}]$ on the rising-limb derivative $\dot{h}(t)$, stratified by antecedent wetness ($\text{API}_{30}$):
  * `Rain (Upper Hills)` $\xrightarrow{\tau_1}$ `Chiselborough (52184)` $\xrightarrow{\tau_2}$ `Gawbridge (52211)` $\xrightarrow{\tau_3}$ `Huish Episcopi / Langport` $\xrightarrow{\tau_4}$ `Burrowbridge / Saltmoor`
  * `Rain (Blackdowns)` $\xrightarrow{\tau_a}$ `Bishops Hull (52407)` $\xrightarrow{\tau_b}$ `Knapp / Hookbridge (52419)` $\xrightarrow{\tau_c}$ `Curry Moor (52420)`
* **Actionable UI Output:** Powers a simple, high-confidence **"Upstream Peak Tracker"** on downstream station cards:
  > *"Upstream at Gawbridge peaked 2.5 hours ago at 11.40m AOD and is now falling (-0.04 m/hr). Historical crest lag to Langport in wet winter conditions is 5–7 hours."*

### D. Multi-Station Residual Anomaly & Sensor Drift Detection (PCA / Isolation Forests)
Currently (`#36`), our health check only detects when a single sensor completely stops reporting (`OFFLINE`) or freezes on an identical millimetre reading for 2 hours (`FLATLINE`). It cannot detect a silted-up pressure transducer that still fluctuates slightly but drifts `0.25m` out of calibration.

* **How it works:** Gauges on hydraulically connected reaches (e.g., `Langport`, `Athelney`, `Burrowbridge`, or `Roath`, `Beer Wall`, `KSD Back Ditch`) lie on a low-dimensional manifold during non-spilling conditions.
* Fitting a robust **Principal Component Analysis (PCA) residual monitor** or **Isolation Forest** across neighbouring station differentials flags whenever a single gauge diverges from the physical envelope of its upstream and downstream neighbours—creating an early warning to trigger an optical staff-gauge board check (`#54`).

---

## 4. Wider Future Capabilities — Triage & Honesty Matrix

From our roadmap discussion, here is how adjacent data sources rank by **"Can we keep ourselves honest and verify the output with our own eyes?"**:

| Tier | Domain / Idea | Why It's Honest & Verifiable (or Why It's Deferred) | Status / Issue |
| :--- | :--- | :--- | :--- |
| **Tier 1: Ready & Grounded** | **Optical Event Keyframes & Mini-Timelapse Playback** | Pure ground truth: *"An event happened at 14:15; here is the looping sequence of webcam frames from `T-60m` to `T+60m`."* Zero AI guesswork. | **Active (`v2.5.0`: #22, #23, #24)** |
| **Tier 1: Ready & Grounded** | **Southern Moors, EA Alerts & Sowy Controls** | Direct EA sensor stages (`mAOD`) and official EA warning feeds mapped to surveyed weir crests (`6.73m`, `7.35m AOD`). | **Planned (`v2.6.0`: #52, #53, #55)** |
| **Tier 2: High Value & Easy to Sanity-Check** | **Upstream EA Tipping-Bucket Rain Gauges (`6h/24h/72h`)** | Same EA Hydrology API we already use. Gives 24–48h early warning before rivers even begin to rise. Easy to verify against local weather. | Candidate for `v2.7.0` |
| **Tier 2: High Value & Easy to Sanity-Check** | **Upstream Wave / Peak Lag Tracker & Rate-of-Rise (`m/hr`)** | Simple derivative math + empirical travel times from upstream peaks (`Gawbridge` $\to$ `Langport`, `Bishops Hull` $\to$ `Hookbridge`). | Candidate for `v2.7.0` |
| **Tier 2: High Value & Easy to Sanity-Check** | **Tide Measurements $\to$ Surge Residual & Tide-Lock Window** | Start by overlaying published Hinkley/Burnham astronomical tide times and measuring live surge residual ($h_{\text{measured}} - h_{\text{astron}}$) and Dunball/Saltmoor tide-lock duration. | **Logged (#25)** |
| **Tier 3: Structured & Guardrailed AI** | **Optical Staff Gauge Board Cross-Check & Camera-Archetype Vision** | Constrained to 5 strict physical camera archetypes (Weed Screens, Spillways, Mobile Pump Pads, Roads, Staff Boards), always shown right next to the source JPEG. | **Logged (#54, #56)** |
| **Tier 4: "Cool, Maybe One Day" Bucket** | **DEFRA 1m LiDAR Bathymetry & Sentinel-1 C-Band SAR Satellite** | High-precision 1m road crown profiles and radar flood footprints are awesome on paper, but require heavy geospatial pipelines (GeoTIFF / Copernicus STAC / radar backscatter) where errors are harder to sanity-check without GIS tooling. | **Parked / Future Exploration** |
