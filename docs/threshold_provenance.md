# Somerset Flood Telemetry: Authoritative Threshold Provenance Register

This document establishes the official evidence base and provenance register for all hydraulic thresholds, geodetic datums, operational action levels, and platform heuristics across the Somerset Flood Telemetry platform.

In accordance with our core governance principles:
* **[RULE-HUM-01] Epistemic Humility & Ban on Simulated Authority:** Plain, modest, and verifiable claims; zero uncalibrated modeling or simulated expertise.
* **[RULE-PROV-01] Third-Party Data Stewardship:** Raw telemetry belongs to the Environment Agency (OGL v3.0); we are a transparent conduit.
* **[RULE-SUB-01] Empirical Substantiation Invariant:** Every asserted threshold must trace directly to surveyed civil engineering geometry or published agency trigger plans.
* **[UI-COL-01] Strict Trichromatic Separation:** Provenance tokens use neutral chromatic encoding (`#1e293b` slate with soft borders); risk colors (Red, Amber, Green) are never used for metadata tags.

---

## The 4-Tier Provenance Taxonomy

Every threshold utilized in backend calculations, database records, chart lines, or UI badges belongs strictly to one of four tiers:

| Tier | Category | Definition | Authority / Source Type | UI Token |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **Surveyed Civil Geometry** | Fixed physical elevation of concrete, masonry, earthwork crests, clyse sills, road crowns, or river bed inverts in mAOD. | EA Asset Surveys, SRA Civil Engineering Reports, Ordnance Survey Benchmarks. | `📐 Surveyed` |
| **Tier 2** | **Statutory / Agency Trigger Point Plans** | Formal operational trigger stages published by statutory authorities to mobilize physical response (mobile pumps, road closures, gate adjustments). | EA Somerset Levels Trigger Point Plan (2014, rev. 2019/2021), Somerset Council Emergency Access Plans. | `📋 Agency Plan` |
| **Tier 3** | **EA Statistical Calibration Envelopes** | Baseline flood alert thresholds derived directly from the Environment Agency open telemetry API station calibrations. | Environment Agency Real-Time Flood-Monitoring API (`stageScale.typicalRangeHigh`). | `📊 EA Typical` |
| **Tier 4** | **Platform-Derived Telemetry Heuristics** | Empirical software interpretation rules and safety buffers applied to raw stage measurements. | Platform Engineering & Hydrology Rules (e.g. 15cm Near Crest buffer, differential head door states). | `⚙️ Derived` |

---

## 1. Network Station Threshold Registry (19 Topological Nodes)

| Station ID | Asset Name & River | Node Type | Threshold Metric | Value (mAOD) | Provenance Tier | Authoritative Citation / Ground Truth Source |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **52108** | Greenham (Upper Tone) | `gauge` | Datum Offset<br>Bed Invert<br>Alert Level | +75.69m<br>75.72m<br>76.99m | **Tier 1**<br>**Tier 1**<br>**Tier 3** | EA Gauge Survey (Ordnance Datum Newlyn)<br>EA Bed Invert Survey<br>EA `stageScale.typicalRangeHigh` (1.30m stage) |
| **52109** | Bishops Hull (Mid Tone) | `gauge` | Datum Offset<br>Bed Invert<br>Alert Level | +16.58m<br>16.60m<br>17.48m | **Tier 1**<br>**Tier 1**<br>**Tier 3** | EA Gauge Survey (ODN)<br>EA Bed Invert Survey<br>EA `stageScale.typicalRangeHigh` (0.90m stage) |
| **52111** | Taunton Market | `gauge` | Datum Offset<br>Bed Invert<br>Alert Level | +12.47m<br>12.67m<br>14.24m | **Tier 1**<br>**Tier 1**<br>**Tier 3** | EA Gauge Survey (ODN)<br>EA Bed Invert Survey<br>EA `stageScale.typicalRangeHigh` (1.77m stage) |
| **52162** | Bathpool Outfall | `gauge` | Datum Offset<br>Bed Invert<br>Alert Level | +0.00m (mAOD)<br>7.50m<br>9.50m | **Tier 1**<br>**Tier 1**<br>**Tier 3** | Direct mAOD station stream<br>Channel Bed Invert Survey<br>EA Typical High Flood Boundary |
| **52118** | Hookbridge Spillway | `spillway` | Spillway Crest<br>Near-Crest Buffer<br>Alert Level<br>Bed Invert | 7.45m<br>7.30m<br>7.15m<br>3.30m | **Tier 1**<br>**Tier 4**<br>**Tier 3**<br>**Tier 1** | EA / SRA Survey: Concrete Broad-Crested Relief Weir<br>Platform 15cm Pre-Overtopping Buffer<br>EA `stageScale.typicalRangeHigh`<br>Tone Channel Bed Invert |
| **52127** | Curry Moor Basin | `polder_basin` | Spillway Crest<br>Alert Level<br>Duty Pumps ON<br>Mobile Pumps Order<br>Mobile Pumps Active<br>Ground Bed Floor | 7.45m<br>6.50m<br>4.30m<br>5.80m<br>6.10m<br>2.10m | **Tier 1**<br>**Tier 3**<br>**Tier 2**<br>**Tier 2**<br>**Tier 2**<br>**Tier 1** | Hookbridge Weir Overspill Inflow Elevation<br>EA Flood Alert Warning Stage<br>EA Somerset Levels Trigger Point Plan (Duty Pump)<br>EA Somerset Levels Trigger Point Plan (Currymoor PS)<br>EA Somerset Levels Trigger Point Plan (Currymoor PS)<br>Surveyed Mean Basin Floor Elevation (ODN) |
| **52116** | Chiselborough (Upper Parrett) | `gauge` | Datum Offset<br>Bed Invert<br>Alert Level | +20.70m<br>20.70m<br>22.50m | **Tier 1**<br>**Tier 1**<br>**Tier 3** | EA Gauge Survey (ODN)<br>EA Bed Invert Survey<br>EA `stageScale.typicalRangeHigh` (1.80m stage) |
| **52119** | Gaw Bridge (Mid Parrett) | `gauge` | Datum Offset<br>Bed Invert<br>Alert Level | +10.00m<br>10.16m<br>12.80m | **Tier 1**<br>**Tier 1**<br>**Tier 3** | EA Gauge Survey (ODN)<br>EA Bed Invert Survey<br>EA `stageScale.typicalRangeHigh` (2.80m stage) |
| **52120** | Huish Episcopi PS (Yeo) | `gauge` | Datum Offset<br>Bed Invert<br>Winter Duty Pumps<br>Summer Duty Pumps<br>River Cut-off Lock<br>Alert Level | +5.00m<br>5.80m<br>6.50m<br>6.90m<br>8.20m<br>8.48m | **Tier 1**<br>**Tier 1**<br>**Tier 2**<br>**Tier 2**<br>**Tier 2**<br>**Tier 3** | EA Gauge Survey (ODN)<br>Yeo Channel Bed Invert<br>EA Winter Pumping Operating Rules<br>EA Summer Penning Operating Rules<br>EA Operating Rule: Pumps cut off to protect Parrett<br>EA `stageScale.typicalRangeHigh` (3.48m stage) |
| **52153** | Midelney (River Isle) | `gauge` | Datum Offset<br>Bed Invert<br>FSA Duty Pumping<br>FSA Head-Lock Alert<br>Alert Level | +5.185m<br>5.50m<br>6.70m<br>8.20m<br>8.20m | **Tier 1**<br>**Tier 1**<br>**Tier 2**<br>**Tier 2**<br>**Tier 3** | EA Gauge Survey (ODN)<br>Isle Channel Bed Invert<br>West Moor FSA Operating Strategy<br>Reverse Flap Lock Threshold (Head-locked to Parrett)<br>EA `stageScale.typicalRangeHigh` (3.01m stage) |
| **52233** | Monk's Leaze Clyse (Upstream) | `clyse_gate` | Concrete Intake Sill<br>Operational Diversion<br>Intake Alert Level<br>Bed Invert | 4.20m<br>7.20m<br>7.90m<br>4.20m | **Tier 1**<br>**Tier 2**<br>**Tier 3**<br>**Tier 1** | Surveyed Intake Sill of Sowy Relief Channel<br>EA Operating Protocol: Penstocks opened to relieve Parrett<br>EA `stageScale.typicalRangeHigh`<br>Parrett River Bed at Intake |
| **52234** | Monk's Leaze Clyse (Downstream) | `gauge` | Channel Bed<br>Alert Level | 4.20m<br>7.60m | **Tier 1**<br>**Tier 3** | Sowy Channel Invert at Clyse Tailwater<br>EA `stageScale.typicalRangeHigh` |
| **52158** | Baltmoor Wall | `spillway` | Embankment Crest<br>Near-Crest Buffer<br>Alert Level<br>Bed Invert | 7.80m<br>7.65m<br>7.50m<br>3.50m | **Tier 1**<br>**Tier 4**<br>**Tier 3**<br>**Tier 1** | Surveyed Armored Levee Crest at Burrowbridge<br>Platform 15cm Pre-Overtopping Buffer<br>EA `stageScale.typicalRangeHigh`<br>Parrett Channel Invert at Confluence |
| **52159** | Northmoor Basin | `polder_basin` | Embankment Crest<br>Alert Level<br>Duty Pumps ON<br>Mobile Pumps Order<br>Mobile Pumps Active<br>Ground Bed Floor | 7.80m<br>3.80m<br>3.70m<br>4.80m<br>5.20m<br>1.80m | **Tier 1**<br>**Tier 3**<br>**Tier 2**<br>**Tier 2**<br>**Tier 2**<br>**Tier 1** | Baltmoor Wall Levee Defense Elevation<br>EA Basin High Storage Alert<br>EA Trigger Point Plan: Northmoor/Saltmoor PS Duty<br>EA Trigger Point Plan: Northmoor/Saltmoor PS Mobile Order<br>EA Trigger Point Plan: Northmoor/Saltmoor PS Mobile Active<br>Surveyed Mean Basin Floor Elevation (ODN) |
| **52124** | West Quay Bridgwater | `gauge` | Bed Invert<br>Alert Level | 0.50m<br>6.10m | **Tier 1**<br>**Tier 3** | Parrett Estuarine Channel Bed at Bridgwater Town Bridge<br>EA `stageScale.typicalRangeHigh` (High Tide Alert) |
| **52163** | Dunball Tidal Outfall | `tidal_outfall` | Estuary Outfall Bed<br>High Tide Alert<br>Tide-Lock Condition | -1.50m<br>6.50m<br>Sea $\ge$ Inland | **Tier 1**<br>**Tier 3**<br>**Tier 4** | Surveyed Outfall Apron Invert (ODN)<br>EA Estuarine Storm Surge Alert Stage<br>Hydrostatic flap gate balance ($\Delta h = h_{\text{sea}} - h_{\text{ksd}} \ge 0$) |
| **52157** | Beerwall Upstream (Greylake) | `spillway` | Sowy Relief Crest<br>Alert Level<br>Bed Invert | 7.30m<br>4.20m<br>2.30m | **Tier 1**<br>**Tier 3**<br>**Tier 1** | Surveyed Concrete Weir Crest at Beer Wall Culverts<br>EA `stageScale.typicalRangeHigh`<br>Sowy Channel Bed Invert |
| **E9531** | Bradney (King's Sedgemoor) | `gauge` | Drain Invert<br>Alert Level | 1.00m<br>3.50m | **Tier 1**<br>**Tier 3** | KSD Drain Bed Invert<br>EA `stageScale.typicalRangeHigh` |
| **E9094** | Dunball Inland KSD Outfall | `gauge` | Clyse Upstream Apron<br>Alert Level | 0.50m<br>3.50m | **Tier 1**<br>**Tier 3** | Inland Gravity Sluice Bed Apron<br>EA `stageScale.typicalRangeHigh` |

---

## 2. Polder Storage & Pumping Station Operational Trigger Plans (Tier 2)

All pumping operational stages are inferred strictly from moor basin water elevation ($h_{\text{mAOD}}$) using published agency plans. The platform **never asserts SCADA pump electrical run telemetry** ([RULE-SUB-01], [RULE-PROV-01]).

### 2.1 Curry Moor & Currymoor Pumping Station (`52127`)
* **Governing Plan:** Environment Agency *Somerset Levels & Moors Trigger Point Plan* (Currymoor Operational Chapter).
* **Basin Floor:** $2.10\text{m AOD}$ (Dry pasture).
* **Summer Penning Target:** $4.30\text{m} - 4.45\text{m AOD}$ (Routine ditch agricultural penning).
* **Winter Baseflow Evacuation:**
  - $h \ge 4.00\text{m AOD}$: Permanent Lead Pump starts.
  - $h \ge 4.30\text{m AOD}$: Permanent Duty Pumps run (Full station duty, 2 pumps).
* **Emergency Mobilization:**
  - $h \ge 5.80\text{m AOD}$: **Mobile Pumps Ordered / Mobilizing** (EA contractor standby & transport to site).
  - $h \ge 6.10\text{m AOD}$: **Emergency Mobile Pumps Active** (Tractor/diesel high-volume pump operation).
  - $h \ge 6.50\text{m AOD}$: **Critical Overfill Risk** (Moor capacity reaching $85\%$; severe risk of inter-moor cascade across Cuts Road).

### 2.2 Northmoor & Saltmoor Pumping Stations (`52159`)
* **Governing Plan:** Environment Agency *Somerset Levels & Moors Trigger Point Plan* (Northmoor & Saltmoor Chapter).
* **Basin Floor:** $1.80\text{m AOD}$ (Dry basin floor).
* **Winter Baseflow Evacuation:**
  - $h \ge 3.40\text{m AOD}$: Lead Permanent Pump starts.
  - $h \ge 3.70\text{m AOD}$: Full Permanent Duty Pumps run (4 pumps across Saltmoor + Northmoor stations).
* **Emergency Mobilization:**
  - $h \ge 4.80\text{m AOD}$: **Mobile Pumps Ordered / Mobilizing**.
  - $h \ge 5.20\text{m AOD}$: **Emergency Mobile Pumps Active**.
  - $h \ge 5.60\text{m AOD}$: **Critical Storage Reserve Exhausted** (Moor reaches high retention).

---

## 3. Civil Engineering Infrastructure Surveys (Tier 1)

All structural geometries are fixed geodetic benchmarks surveyed relative to Ordnance Datum Newlyn (ODN):

1. **Hookbridge Spillway (`52118`):**
   - **Surveyed Weir Crest:** $7.45\text{m AOD}$.
   - **Civil Type:** Armored broad-crested concrete levee weir on River Tone left bank.
   - **Function:** Primary engineered relief overflow into Curry Moor retention polder.

2. **Athelney Spillway & Cuts Road:**
   - **Surveyed Concrete Sill:** $7.35\text{m AOD}$.
   - **Civil Type:** Armored road-crest weir on south bank of Curry Moor basin.
   - **Function:** Controlled inter-moor emergency cascade from Curry Moor into Northmoor.

3. **Baltmoor Wall (`52158`):**
   - **Surveyed Levee Defense Crest:** $7.80\text{m AOD}$.
   - **Civil Type:** Reinforced clay & stone flood embankment at Burrowbridge.
   - **Function:** Defense levee protecting Northmoor from direct River Parrett fluvial surge. Overtopping occurs only when Parrett exceeds $7.80\text{m AOD}$.

4. **Monk's Leaze Clyse (`52233`):**
   - **Surveyed Intake Sill:** $4.20\text{m AOD}$.
   - **Civil Type:** Controlled penstock intake sluice structure on River Parrett right bank.
   - **Function:** Gravity intake diverting floodwaters from River Parrett into Sowy Relief Channel.

5. **Beer Wall Relief Weir (`52157`):**
   - **Surveyed Overflow Crest:** $7.30\text{m AOD}$.
   - **Civil Type:** SRA/EA upgraded twin-culvert relief weir at Greylake.
   - **Function:** Passes floodwaters from Sowy Channel under A361 into King's Sedgemoor Drain (KSD).

---

## 4. Community Road Passability Thresholds (Tier 1, Tier 2 & Tier 4)

Documented in complete engineering detail in [`docs/road_network_passability_spec.md`](file:///home/jonathan/Desktop/flood-telemetry/docs/road_network_passability_spec.md).

In accordance with `[RULE-ENT-01]`, road assets adhere strictly to the tripartite entity schema (`asset_type: 'road'`, `asset_id`, `status: 'PASSABLE' | 'ENCROACHING' | 'IMPASSABLE'`). In accordance with `[RULE-HUM-01]` and `[RULE-SUB-01]`, assets whose precise carriageway crown spot heights have not been confirmed in published engineering surveys are transparently designated as `⚠️ PENDING SURVEY` rather than adopting speculative numbers:

| Asset ID | Road Corridor | Driving Station | Gauge Datum | Encroaching Stage | Impassable Stage | Provenance Tier | Survey Status & Authoritative Citation |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`cuts_road`** | Cuts Road (East Lyng ↔ Athelney) | `52127` (Curry Moor) | $+0.00\text{m}$ (mAOD) | $7.00\text{m AOD}$ | $7.35\text{m AOD}$ | **Tier 1** (Crest)<br>**Tier 2** (Gates) | `📐 Surveyed Civil Geometry`<br>Concrete Athelney Spillway relief crest ($7.35\text{m AOD}$). Somerset Council emergency closure gates locked at $7.30–7.35\text{m AOD}$. |
| **`muchelney_access`** | Muchelney Spine Road / Langport Road | `52120` (Huish PS) | $+5.000\text{m AOD}$ | $7.30\text{m AOD}$ ($2.30\text{m}$ depth) | $7.86\text{m AOD}$ ($2.86\text{m}$ depth) | **Tier 1** (Crown)<br>**Tier 2** (Breach) | `📐 Surveyed Civil Geometry`<br>SRA / SCC 2014 Road Raising Scheme ($7.86\text{m AOD}$ crown). Low-spot field hollow breach at Lawyers Mill ($7.30\text{m AOD}$). |
| **`beer_wall_a372`** | A372 at Beer Wall / Greylake | `52157` (Sowy Beerwall) | $+0.00\text{m}$ (mAOD) | $7.15\text{m AOD}$ (15cm buffer) | $7.30\text{m AOD}$ (Relief Weir) | **Tier 1** (Weir)<br>**Tier 4** (Buffer) | `⚠️ PENDING HIGHWAYS AS-BUILT SURVEY`<br>Concrete relief weir crest surveyed at $7.30\text{m AOD}$. Raised A372 road crown over culverts pending official Highways topographic release. |
| **`new_road_curry`** | New Road (West Lyng ↔ North Curry) | `52127` (Curry Moor) | $+0.00\text{m}$ (mAOD) | $6.20\text{m AOD}$ (Moor Rhyne) | $7.10–7.30\text{m AOD}$ (Gate Closure) | **Tier 2** (Plan) | `⚠️ PENDING TOPOGRAPHIC SURVEY`<br>Correlated to Curry Moor storage & EA Flood Warning `051FWF124`. Gates closed by Somerset Council Highways before Athelney spillway activation. |
| **`a361_burrowbridge`** | A361 Corridor (East Lyng ↔ Burrowbridge) | `52127` / `52158` | $+0.00\text{m}$ (mAOD) | $7.35\text{m}$ (Athelney cascade) | Multi-agency order ($7.80\text{m}$ levee) | **Tier 2** (Plan) | `⚠️ PENDING HIGHWAYS AUDIT`<br>Regional arterial ridge route. Emergency gates closed under EA Flood Warning `051FWF126` when Curry Moor overspill and Northmoor retention threaten carriageway. |
| **`bicknells_bridge_access`** | Bicknell's Bridge & Huish Level | `52120` (Huish PS) | $+5.000\text{m AOD}$ | $7.00\text{m AOD}$ ($2.00\text{m}$ depth) | $7.30\text{m AOD}$ ($2.30\text{m}$ depth) | **Tier 2 / Tier 3** | `⚠️ PENDING TOPOGRAPHIC SURVEY`<br>Historic 1830 bridge across River Yeo. Approach verges flooded at $7.00\text{m AOD}$; approaches submerged at $7.30\text{m AOD}$ (Historic England List 1056588). |
| **`moorland_new_cut_road`** | New Cut & Moorland Access Roads | `52159` (Northmoor) | $+0.00\text{m}$ (mAOD) | $3.80\text{m AOD}$ (Basin Alert) | $4.80–5.20\text{m AOD}$ (Mobile Pumping) | **Tier 2** (Trigger) | `⚠️ PENDING TOPOGRAPHIC SURVEY`<br>Lowland basin floor surveyed at $1.80\text{m AOD}$. Internal polder lanes submerged during severe storage retention under EA Trigger Point Plan. |

---

## 5. Platform-Derived Heuristics & Buffers (Tier 4)

These thresholds are derived internally by the platform's software logic. They must always be accompanied by transparent microcopy explaining that they represent safety margins or hydrostatic checks rather than official agency alerts:

1. **Spillway Freeboard Warning Buffer ($15\text{cm}$):**
   - Trigger: $h_{\text{river}} \ge Z_{\text{crest}} - 0.15\text{m}$.
   - Evaluates: `NEAR_CREST` warning state.
   - Justification: Provides residents with $\approx 15\text{cm}$ advance warning before uncontrolled overtopping commences.

2. **Dunball Tidal Gate Hydrostatic Differential ($\Delta h$):**
   - $\Delta h = h_{\text{ksd}} - h_{\text{sea}}$.
   - If $\Delta h < 0\text{m}$: Sea stage exceeds inland drain stage. Passive tidal flap doors close under reverse hydrostatic pressure (`TIDE_LOCKED`).
   - If $\Delta h \ge 0.05\text{m}$: Inland drain exceeds estuary tide by $\ge 5\text{cm}$. Flap doors open for gravity discharge (`DISCHARGING`).

3. **Dunball Emergency High-Volume Mobile Pump Contingency Plan (Tier 2 / Tier 4):**
   - Structural Reality: Dunball Outfall has zero permanent fixed pumps and discharges purely by gravity (`DISCHARGING` vs `TIDE_LOCKED`).
   - Emergency Mobilization Plan (EA Trigger Point Plan): In severe flood events when tide-locking traps water in the King's Sedgemoor Drain, the EA mobilizes contractor high-volume trailer pumps over the clyse:
     * **Winter Triggers:** Pre-monitoring watch at $2.80\text{m AOD}$; Mobile Pumps Ordered at $3.30\text{m AOD}$; Mobile Pumps Active at $3.50\text{m AOD}$; Critical storage at $3.80\text{m AOD}$.
     * **Summer Triggers:** Pre-monitoring watch at $3.10\text{m AOD}$; Mobile Pumps Ordered at $3.50\text{m AOD}$; Mobile Pumps Active at $3.70\text{m AOD}$; Critical storage at $4.10\text{m AOD}$.
   - Platform Reporting Role: The platform explicitly reports **whether mobile contractor pumps should or should not be on site** based on surveyed KSD stage relative to these trigger points, with transparent microcopy: *"Inferred from inland KSD stage relative to the EA Somerset Levels Trigger Point Plan."*
