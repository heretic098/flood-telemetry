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

## 4. Community Road Passability Thresholds (Tier 1 & Tier 2)

Documented in detail in `docs/road_network_passability_spec.md`:

| Road Asset | Surveyed Sills | Operating Agency / Plan | Action Protocol |
| :--- | :--- | :--- | :--- |
| **Cuts Road (East Lyng to Athelney)** | • Lowest Crown: $7.35\text{m AOD}$<br>• Submerged: $> 7.35\text{m AOD}$ | Somerset Council Highways / EA Trigger Point Plan | • $h_{\text{curry}} \ge 7.05\text{m}$: Encroaching margin warning (10-30cm freeboard).<br>• $h_{\text{curry}} \ge 7.35\text{m}$: Road impassable; flood gates closed by Somerset Highways. |
| **Muchelney Access (Lawyers Mill & Spine Road)** | • Low-point Sill: $7.30\text{m AOD}$<br>• Raised Spine: $7.70\text{m AOD}$<br>• High Crown: $7.86\text{m AOD}$ | Somerset Rivers Authority (SRA) 2014 Road Raising Scheme & Council Emergency Access Plan | • $h_{\text{yeo}} \ge 7.30\text{m}$: Lawyers Mill impassable.<br>• $h_{\text{yeo}} \ge 7.70\text{m}$: Raised spine impassable; village cut off from road access; emergency SRA/Council boat service mobilized. |

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
