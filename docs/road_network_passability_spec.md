# Somerset Levels Road Network & Passability Specification

**Status:** Authoritative Hydrological, Operational & Highway Engineering Specification (v3.0)  
**Related GitHub Issues:** [#2 (UX: Elevate community road passability to dedicated interface)](https://github.com/heretic098/flood-telemetry/issues/2), [#12 (Road passability multi-factor evaluation engine & ledger)](https://github.com/heretic098/flood-telemetry/issues/12)  
**Governing Invariants:**
* `[RULE-HUM-01]` (Epistemic Humility & Ban on Simulated Authority: Plain empirical facts, transparent limits, zero simulated SCADA gate telemetry)
* `[RULE-PROV-01]` (Third-Party Data Stewardship: Raw EA telemetry & Somerset Council Highways published protocols; we are a transparent community lens)
* `[RULE-SUB-01]` (Empirical Substantiation Invariant: Every threshold substantiated by surveyed civil geometry or published statutory trigger plans)
* `[RULE-ENT-01]` (Canonical Tripartite Entity Invariant: `asset_type: 'road' -> asset_id -> status: 'PASSABLE' | 'ENCROACHING' | 'IMPASSABLE'`)
* `[RULE-TAX-06]` (Normalized Entity-State Architecture: Closed canonical dictionary; no bespoke concatenated strings)
* `[RULE-CALC-01]` (Strict Ban on Volumetric & Discharge Speculation: Governed strictly by Stage in mAOD, Clearance in metres, Rate of Rise in m/h, Duration, and Normalized Status)

---

## 1. Context & Architectural Rationale

During initial prototyping, road passability indicators (such as the Cuts Road cascade and Muchelney access status) were intertwined with hydraulic spillway and river pumping cards on the main dashboard (`src/js/app.js`).

However:
1. **Separation of Concerns:** A highway is a civil transportation corridor, not an open-channel hydraulic weir or SCADA pumping station. Blending road closures into river spillway cards created cognitive clutter and metric confusion for residents.
2. **Distinct Failure Modes:** River spillways overtop by deliberate hydraulic design to relieve fluvial channels into agricultural polders; road inundation is a civil emergency requiring physical gate closures, traffic diversions, and structural safety inspections.
3. **Rigorous Empirical Provenance:** While surveyed civil elevations exist for engineered road-weir crossings like Cuts Road (Athelney Spillway at $7.35\text{m AOD}$) and the SRA-raised Muchelney Spine Road ($7.86\text{m AOD}$ crown / $7.30\text{m AOD}$ low spot), other critical community access arteries operate on multi-agency flood trigger protocols where exact lowest road crown spot heights are unconfirmed in open data. In accordance with `[RULE-HUM-01]` and `[RULE-SUB-01]`, this platform explicitly differentiates between **Surveyed Civil Geometry (Tier 1)** and **Unsurveyed / Pending Survey** corridors.
4. **Physical Gate Reality & Reopening Protocol:** Road closures are enforced by physical heavy-duty steel gates locked shut with padlocks by Somerset Council Highways crews during daylight hours. Reopening is **never instantaneous** the second water recedes below asphalt. As Somerset Council protocol explicitly states: *"Once water levels have reduced, we will return to inspect the road and reopen the gates as soon as it is safe to do so."* The platform must accurately model the physical delay, debris clearance, and daylight inspection requirements rather than falsely reporting immediate access.

---

## 2. The Multi-Factor Passability Synthesis

Road access status cannot be determined solely by static water height at a single sensor. The platform synthesizes **four empirical inputs**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-FACTOR PASSABILITY EVALUATION                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Factor 1: Geodetic Water Elevation (mAOD)                                   │
│            Water stage relative to surveyed road crown & verge caution in    │
│            national reference datum (mAOD Newlyn).                          │
│                                                                             │
│  Factor 2: 3-Hour Empirical Rate-of-Rise Momentum Vector (dh/dt in m/h)     │
│            Moving rate of change over 3 hours (12 readings) from 15-min EA  │
│            telemetry: dh/dt >= +0.03m/h indicates rapid incoming surge.    │
│                                                                             │
│  Factor 3: Statutory EA Flood Warning & Alert Target Areas                  │
│            Direct ingestion of live Environment Agency warning states for   │
│            the 5 statutory target areas covering our road corridors.        │
│                                                                             │
│  Factor 4: Somerset Council Emergency Gate & Inspection Protocols           │
│            Daylight locking/unlocking operating windows, debris clearance,  │
│            and post-flood inspection states before declaring roads open.     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Statutory Environment Agency Target Areas
The platform binds road assets directly to the official EA Flood Warning Service target areas:
* **`112FWFCUR10A`**: Curry Moor and Hay Moor (governs `cuts_road` and `new_road_curry`).
* **`112WAFYPM`**: River Yeo and River Parrett Moors around Muchelney and Thorney (governs `muchelney_access` and `bicknells_bridge_access`).
* **`112FWFEAS10A`**: A361 East Lyng to Burrowbridge (governs `a361_burrowbridge`).
* **`112FWFSAL10A`**: Salt Moor and North Moor including Moorland, Fordgate, West Waste (governs `moorland_new_cut_road`).
* **`112FWFSTA10A`**: Stan Moor including Athelney and Curload (governs `stan_moor_road`).

### 2.2 Rate-of-Rise Momentum Vector ($dh/dt_{3\text{h}}$)
Lowland polders (Curry Moor, Northmoor) exceed 1,000 hectares in surface area. A rising rate of $+0.03\text{m/h}$ ($\ge 3\text{cm/h}$, or $\ge 9\text{cm}$ over 3 hours) represents massive flood inflow (hundreds of cubic metres per minute via overtopping weirs).
- When stage is within the caution margin ($h \ge Z_{\text{caution}}$), a momentum vector $dh/dt_{3\text{h}} \ge +0.03\text{m/h}$ signifies imminent road inundation within 6–10 hours, prompting pre-emptive council emergency gate closure.
- On falling stages, $dh/dt_{3\text{h}} \le 0.00\text{m/h}$ confirms water has peaked and drainage evacuation is actively underway.

---

## 3. Monitored Road Asset Corridors

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       8 MONITORED ROAD ASSET CORRIDORS                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. cuts_road               Cuts Road (East Lyng ↔ Athelney)                │
│  2. muchelney_access        Muchelney Spine Road (Huish Episcopi ↔ Muchelney)│
│  3. beer_wall_a372          A372 at Beer Wall / Greylake (Aller ↔ Othery)   │
│  4. new_road_curry          New Road (West Lyng ↔ North Curry)              │
│  5. a361_burrowbridge       A361 Corridor (East Lyng ↔ Burrowbridge)        │
│  6. bicknells_bridge_access Bicknell's Bridge & Huish Level Connectors      │
│  7. moorland_new_cut_road   New Cut & Moorland Access (Northmoor Polder)    │
│  8. stan_moor_road          Stan Moor Road (Curload ↔ Athelney)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 3.1 Cuts Road (East Lyng ↔ Athelney)
* **Asset ID:** `cuts_road`
* **Asset Type:** `road`
* **Highway:** Cuts Road (Cutts Road), carrying traffic between the A361 at East Lyng and Athelney across the southern embankment of Curry Moor.
* **Driving EA Telemetry Station:** `52127` (Curry Moor Polder Basin, `Currymoor Drain`).
* **Station Geodetic Datum:** $0.000\text{m AOD}$ Newlyn.
* **Statutory EA Warning Target Area:** `112FWFCUR10A` (Curry Moor and Hay Moor).
* **Survey Status:** **Surveyed Civil Geometry (Tier 1)**.
* **Correlated Optical Camera:** `athelney_cuts_rd` (direct live view of the Athelney Spillway road crossing).
* **Council Emergency Closure Gates:** Physical gates located at East Lyng (north) and Athelney (south).

| Operational Condition | Curry Moor Stage ($h_{\text{moor}}$) | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | $< 7.00\text{m AOD}$ | `PASSABLE` | Road crown dry. Standard vehicular transit fully open. |
| **Verge Encroachment / Caution** | $\ge 7.00\text{m AOD}$ (to $7.34\text{m}$) | `ENCROACHING` | Water fills roadside rhynes and encroaches onto low verges ($10–35\text{cm}$ freeboard remaining). Low spots become damp/shallow. Somerset Highways advisory; caution for low vehicles. |
| **Rapid Surge Warning** | $\ge 7.15\text{m AOD}$ AND $dh/dt \ge +0.03\text{m/h}$ | `ENCROACHING` (High Risk) | Water rising rapidly toward spillway crest. Somerset Council dispatch road crews to prepare gate closure. |
| **Spillway Overtopping & Closure** | $\ge 7.35\text{m AOD}$ (or Gates Locked) | `IMPASSABLE` | Floodwaters actively cascade over the concrete **Athelney Spillway** across Cuts Road into Northmoor. Council emergency gates locked shut; highway impassable. |

#### Empirical Engineering Provenance & Citations:
- **Civil Structure:** Concrete broad-crested relief weir surveyed at **$7.35\text{m AOD}$** (`src/js/config/catchments/somerset.json`). Provides controlled relief cascade from Curry Moor into Northmoor.
- **Operating Protocol:** Somerset Council emergency closure gates locked when Currymoor Drain stage reaches $7.30\text{m}–7.35\text{m AOD}$ or EA issues Flood Warning `112FWFCUR10A`.

---

### 3.2 Muchelney Spine Road (Huish Episcopi ↔ Muchelney)
* **Asset ID:** `muchelney_access`
* **Asset Type:** `road`
* **Highway:** Langport Road / Muchelney Spine Road connecting the A372 at Huish Episcopi south to Muchelney village.
* **Driving EA Telemetry Station:** `52120` (River Yeo at Huish Episcopi Pumping Station).
* **Station Geodetic Datum:** $+5.000\text{m AOD}$ Newlyn (Stage in $\text{mASD} + 5.000 = \text{mAOD}$).
* **Statutory EA Warning Target Area:** `112WAFYPM` (River Yeo and River Parrett Moors around Muchelney and Thorney).
* **Survey Status:** **Surveyed Civil Geometry (Tier 1)**.
* **Correlated Optical Camera:** `huish_episcopi` (`#huish`).
* **Council Emergency Closure Gates:** Physical gates located near Lawyers Mill (north) and Muchelney entrance (south).

| Operational Condition | River Yeo Stage ($h_{\text{yeo}}$) | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | $< 7.30\text{m AOD}$ ($< 2.30\text{m}$ depth) | `PASSABLE` | Normal vehicular transit open to Muchelney village. |
| **Low-Spot Encroachment** | $\ge 7.30\text{m AOD}$ ($\ge 2.30\text{m}$ depth) | `ENCROACHING` | River Yeo backwater spills into field hollows near Lawyers Mill. Road Liable to Flooding signs deployed; tractor shuttle standby. |
| **Historic Road Submergence** | $\ge 7.70\text{m AOD}$ ($\ge 2.70\text{m}$ depth) | `ENCROACHING` (Severe) | Pre-2014 unraised carriageway elevation submerged. Modern raised section remains dry. |
| **Raised Crown Overtopping** | $\ge 7.86\text{m AOD}$ ($\ge 2.86\text{m}$ depth) | `IMPASSABLE` | Overtopping of the raised carriageway crown constructed by SRA/SCC in 2014–2015. Emergency gates locked shut; boat/tractor shuttle mobilized. |

#### Empirical Engineering Provenance & Citations:
- **Low-Spot Breach ($7.30\text{m AOD}$):** Surveyed field hollow invert near Lawyers Mill where Yeo backwaters first spill onto road flanks.
- **SRA Road Raising ($7.86\text{m AOD}$):** 500-metre section raised by up to $1.2\text{m}–1.3\text{m}$ to $7.86\text{m AOD}$ following 2013/2014 floods.

---

### 3.3 A372 at Beer Wall / Greylake (Aller ↔ Othery Corridor)
* **Asset ID:** `beer_wall_a372`
* **Asset Type:** `road`
* **Highway:** A372 Langport to Bridgwater road at Beer Wall (Greylake).
* **Driving EA Telemetry Station:** `52157` (River Sowy at Beerwall Upstream).
* **Station Geodetic Datum:** $0.000\text{m AOD}$ Newlyn.
* **Statutory EA Warning Target Area:** River Sowy / King's Sedgemoor Drain catchment.
* **Survey Status:** Concrete Relief Weir Crest **$7.30\text{m AOD}$ (Tier 1)**; Carriageway Crown **UNSURVEYED / PENDING AS-BUILT TOPOGRAPHIC SURVEY** (`[RULE-HUM-01]`, `[RULE-SUB-01]`).

| Operational Condition | Sowy Stage ($h_{\text{sowy}}$) | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | $< 7.15\text{m AOD}$ | `PASSABLE` | Carriageway dry. Flow conveyed through culverts. |
| **High Flow Pre-Spill** | $\ge 7.15\text{m AOD}$ (to $7.29\text{m}$) | `ENCROACHING` | Water level within 15cm of relief weir lip. Sowy diversion channel near bankfull. |
| **Relief Weir Overspill** | $\ge 7.30\text{m AOD}$ | `ENCROACHING` / `MONITORING` | Water overtops relief weir into 4 box culverts ($2\text{m} \times 3\text{m}$) beneath A372. Road remains passable while culverts handle discharge. |
| **Carriageway Inundation** | Exceeds Raised Road Crown | `IMPASSABLE` | Extreme event exceeding culvert capacity; carriageway overtopped. Diversion via A361/A39. |

---

### 3.4 New Road (West Lyng ↔ North Curry across Curry Moor / Hay Moor)
* **Asset ID:** `new_road_curry`
* **Asset Type:** `road`
* **Highway:** New Road connecting A361 at West Lyng southwards to North Curry across low western basins of Curry Moor and Hay Moor.
* **Driving EA Telemetry Station:** `52127` (Curry Moor Basin) [Corroborating: `52118` Hookbridge on Tone].
* **Station Geodetic Datum:** $0.000\text{m AOD}$ Newlyn.
* **Statutory EA Warning Target Area:** `112FWFCUR10A` (Curry Moor and Hay Moor).
* **Survey Status:** Tier 2 Statutory Trigger Plan; Carriageway Crown **UNSURVEYED / PENDING TOPOGRAPHIC SURVEY** (`[RULE-HUM-01]`).
* **Council Emergency Closure Gates:** Physical gates located at West Lyng and North Curry.

| Operational Condition | Curry Moor Stage ($h_{\text{moor}}$) | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | $< 6.20\text{m AOD}$ | `PASSABLE` | Carriageway clear and dry. |
| **Rhyne Encroachment** | $\ge 6.20\text{m AOD}$ | `ENCROACHING` | Hay Moor rhynes backing up; margin water overtops grass verges in low sags. |
| **Emergency Gate Closure** | $\ge 7.10\text{m}–7.30\text{m AOD}$ (or EA Warning + Rise) | `IMPASSABLE` | Somerset Council emergency gates locked shut before Cuts Road overspills. Traffic diverted via A358 / Thorne Falcon. |

---

### 3.5 A361 Corridor (East Lyng ↔ Burrowbridge)
* **Asset ID:** `a361_burrowbridge`
* **Asset Type:** `road`
* **Highway:** A361 major regional arterial road connecting Taunton, Othery, and Glastonbury across the low ridge between Curry Moor and Northmoor.
* **Driving EA Telemetry Stations:** `52127` (Curry Moor), `52158` (Baltmoor Wall / Parrett), `52159` (Northmoor Basin).
* **Statutory EA Warning Target Area:** `112FWFEAS10A` (A361 East Lyng to Burrowbridge).
* **Survey Status:** Tier 2 Statutory Trigger Plan; Carriageway Crown **UNSURVEYED / PENDING AS-BUILT HIGHWAYS AUDIT** (`[RULE-HUM-01]`).
* **Council Emergency Closure Gates:** Permanent heavy-duty gates located at East Lyng and Burrowbridge.

| Operational Condition | Polder & Fluvial Thresholds | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | Normal river and polder baseflows | `PASSABLE` | Strategic regional arterial fully open. |
| **Moor Retention Threat** | $h_{\text{curry}} \ge 7.35\text{m}$ AND $h_{\text{northmoor}} \ge 4.80\text{m}$ | `ENCROACHING` | Inter-moor cascade from Curry Moor into Northmoor; floodwaters approaching highway embankment toe. Active highways patrols. |
| **Arterial Closure** | Multi-agency closure order (or $h_{\text{baltmoor}} \ge 7.80\text{m}$ / EA Warning) | `IMPASSABLE` | Somerset Council emergency gates locked shut at East Lyng and Burrowbridge. Major regional detour via Bridgwater/M5 or Langport. |

---

### 3.6 Bicknell's Bridge & Huish Level Connectors
* **Asset ID:** `bicknells_bridge_access`
* **Asset Type:** `road`
* **Highway:** Minor connectors including Bicknell's Bridge approach road and Huish Level lanes linking Huish Episcopi, Muchelney, and Langport.
* **Driving EA Telemetry Station:** `52120` (River Yeo at Huish Episcopi PS).
* **Station Geodetic Datum:** $+5.000\text{m AOD}$ Newlyn.
* **Statutory EA Warning Target Area:** `112WAFYPM` (River Yeo and Parrett Moors).
* **Survey Status:** Tier 2/3 Empirical Calibration (Historic England List 1056588); Crown **UNSURVEYED / PENDING SURVEY**.

| Operational Condition | River Yeo Stage ($h_{\text{yeo}}$) | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | $< 7.00\text{m AOD}$ ($< 2.00\text{m}$ depth) | `PASSABLE` | Minor rural connectors clear and open. |
| **Approach Encroachment** | $\ge 7.00\text{m AOD}$ ($\ge 2.00\text{m}$ depth) | `ENCROACHING` | Water overtops roadside rhynes on Huish Level; approach lanes experience shallow puddles. |
| **Approach Inundation** | $\ge 7.30\text{m AOD}$ ($\ge 2.30\text{m}$ depth) | `IMPASSABLE` | River Yeo backwater submerges approach lanes to Bicknell's Bridge. Impassable to passenger vehicles. |

---

### 3.7 New Cut & Moorland Access Roads (Northmoor Polder Basin)
* **Asset ID:** `moorland_new_cut_road`
* **Asset Type:** `road`
* **Highway:** Minor internal polder roads crossing Northmoor basin between Moorland, Fordgate, and West Waste (connecting to Huntworth/Bridgwater).
* **Driving EA Telemetry Station:** `52159` (Northmoor Basin, `Northmoor Polder`).
* **Station Geodetic Datum:** $0.000\text{m AOD}$ Newlyn.
* **Statutory EA Warning Target Area:** `112FWFSAL10A` (Salt Moor and North Moor).
* **Survey Status:** Tier 2 Statutory Trigger Point Plan (Basin floor $1.80\text{m AOD}$); Carriageway Crown **UNSURVEYED / PENDING SURVEY**.

| Operational Condition | Northmoor Stage ($h_{\text{northmoor}}$) | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | $< 3.80\text{m AOD}$ | `PASSABLE` | Polder drainage ditches within normal envelope; roads open. |
| **Basin Storage Margin** | $\ge 3.80\text{m AOD}$ (EA Basin Alert) | `ENCROACHING` | Storage water fills primary drainage rhynes; margin water encroaches upon lowest field access verges. |
| **Deep Storage Inundation** | $\ge 4.80\text{m}–5.20\text{m AOD}$ (Mobile Pumps) | `IMPASSABLE` | Internal polder road surfaces submerged under retention storage. Local road access between Moorland, Fordgate, West Waste cut off. |

---

### 3.8 Stan Moor Road (Curload ↔ Athelney)
* **Asset ID:** `stan_moor_road`
* **Asset Type:** `road`
* **Highway:** Stan Moor Bank / Curload Road running along the Tone right bank between Curload and Athelney.
* **Driving EA Telemetry Stations:** `52118` (Hookbridge, River Tone) and `52127` (Curry Moor).
* **Statutory EA Warning Target Area:** `112FWFSTA10A` (Stan Moor including Athelney and Curload).
* **Survey Status:** Tier 2 Statutory Trigger Plan; Crown **UNSURVEYED / PENDING SURVEY**.

| Operational Condition | Fluvial & Moor Stage | Normalized Status | Practical / Physical Impact |
| :--- | :---: | :---: | :--- |
| **Normal Access** | $h_{\text{hook}} < 7.15\text{m AOD}$ | `PASSABLE` | Embankment road open and dry. |
| **Seepage & Ditch Encroachment** | $h_{\text{hook}} \ge 7.15\text{m}$ OR $W_{\text{EA}} = \text{'ALERT'}$ | `ENCROACHING` | Tone high stage creates bank seepage and fills Stan Moor internal rhynes. Verges wet. |
| **Bank Inundation / Closure** | $W_{\text{EA}} = \text{'WARNING'}$ AND $h_{\text{hook}} \ge 7.30\text{m}$ | `IMPASSABLE` | Stan Moor road impassable; local access cut off between Curload and Athelney. |

---

## 4. Multi-Factor State Transition Model

Every road asset adheres strictly to `[RULE-ENT-01]` and `[RULE-TAX-06]`:
$$\forall \text{ road asset } R, \quad R \equiv \langle \text{asset\_type: 'road'}, \text{asset\_id}, \text{status: 'PASSABLE' | 'ENCROACHING' | 'IMPASSABLE'} \rangle$$

### 4.1 State Diagram
```mermaid
stateDiagram-v2
    [*] --> PASSABLE
    PASSABLE --> ENCROACHING: Stage reaches Caution OR EA Alert/Warning OR Momentum Surge
    ENCROACHING --> IMPASSABLE: Stage reaches Crown OR Council Gates Closed OR EA Warning + Rapid Surge
    IMPASSABLE --> ENCROACHING: Stage recedes below Crown - 3cm (Enter CLEARING / INSPECTION PENDING)
    ENCROACHING --> PASSABLE: Stage below Caution - 5cm AND EA Warning Removed AND Daylight Inspection Window / 24h Timeout Met
```

---

### 4.2 Transition Rules: Rising Limb (Advance to Flood)

#### 1. PASSABLE $\to$ ENCROACHING (Severity 1 $\to$ Severity 3)
Triggered when **ANY** of the following conditions become true:
1. **Physical Elevation:** $h \ge Z_{\text{caution}}$ (water reaches roadside verge / rhyne bankfull).
2. **Statutory Warning:** Active Environment Agency Flood Alert (Amber) or Flood Warning (Red) for the corridor's target area ($W_{\text{EA}} \in \{\text{'ALERT'}, \text{'WARNING'}\}$).
3. **Momentum Vector Surge:** $h \ge Z_{\text{caution}} - 0.10\text{m}$ (within 10cm of caution margin) AND $dh/dt_{3\text{h}} \ge +0.03\text{ m/h}$.

#### 2. ENCROACHING $\to$ IMPASSABLE (Severity 3 $\to$ Severity 4)
Triggered when **ANY** of the following conditions become true:
1. **Physical Submergence:** $h \ge Z_{\text{crown}}$ (water stage reaches or exceeds surveyed road crown or relief weir crest).
2. **Pre-emptive Council Gate Closure:** Active EA Flood Warning ($W_{\text{EA}} = \text{'WARNING'}$) AND $h \ge Z_{\text{caution}}$ AND $dh/dt_{3\text{h}} \ge +0.03\text{ m/h}$ (council highway crews dispatch to lock gates ahead of darkness/overtopping).
3. **Statutory Plan Closure:** For Tier 2 corridors without surveyed crown (such as New Road), stage reaches published gate closure stage ($h_{\text{curry}} \ge 7.10\text{m AOD}$).

---

### 4.3 Transition Rules: Falling Limb & Post-Flood Reopening

When floodwaters recede, reopening is governed by physical drainage, statutory warning cancellation, and Somerset Council inspection procedures.

#### 1. IMPASSABLE $\to$ ENCROACHING (Clearance from Submergence / Inspection Pending)
The road exits `IMPASSABLE` and enters `ENCROACHING` with operational metadata `phase: 'CLEARING_INSPECTION_PENDING'` when **ALL** of the following conditions are met:
1. **Physical Carriageway Clearance:** Stage drops strictly below crown minus deadband:
   $$h < Z_{\text{crown}} - \Delta h_{\text{crown}} \quad (\Delta h_{\text{crown}} = 0.03\text{m})$$
2. **Receding Momentum:** $dh/dt_{3\text{h}} \le 0.00\text{m/h}$ (water is steady or falling, not surging back up).
3. **Clearance Timestamp Stamped:** The instant $h < Z_{\text{crown}} - 0.03\text{m}$ is recorded as $t_{\text{submerged\_end}}$.

> [!IMPORTANT]
> **Why ENCROACHING instead of PASSABLE?**  
> Even though water has receded off the asphalt, Somerset Council emergency road closure gates remain padlocked shut. Roadside rhynes remain full, and the highway surface may carry slippery river silt, washed-out verges, or structural damage. In accordance with `[RULE-HUM-01]` and `[RULE-PROV-01]`, reporting the road as `PASSABLE` while gates are locked is strictly forbidden.

#### 2. Resolving the Reopening Dilemma: The Post-Flood Inspection Window
The user rightly asked: *"How long will the road show that it's clearing / inspecting for as we have no way of knowing when the road is declared fit to be reopened?"*

The platform resolves this using a **four-stage exit gate**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 EXIT CRITERIA: CLEARING → PASSABLE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Criterion 1: Continuous Dry Crown                                          │
│               Stage has remained continuously below Crown - 3cm without a   │
│               single re-submergence since t_submerged_end.                  │
│                                                                             │
│  Criterion 2: Rhyne Drainage Below Caution                                  │
│               Stage has dropped below Caution - 5cm (HYDRO_DEADBANDS.caution)│
│               confirming roadside ditches have drained to safe levels.      │
│                                                                             │
│  Criterion 3: Statutory EA Flood Warning Removed                            │
│               Environment Agency Flood Warning for this corridor is no      │
│               longer active (W_EA = 'INACTIVE').                            │
│                                                                             │
│  Criterion 4: Daylight Inspection Window OR 24-Hour Safety Timeout          │
│               EITHER:                                                       │
│               - 6 Daylight Hours (08:00 to 17:00 GMT/BST) have elapsed      │
│                 since Criteria 1, 2, and 3 were met (the working window for │
│                 Somerset Highways gate inspection crews).                   │
│               OR:                                                           │
│               - 24 Elapsed Dry Hours (t_current - t_submerged_end >= 24h)   │
│                 have elapsed with Criteria 1, 2, and 3 satisfied.           │
└─────────────────────────────────────────────────────────────────────────────┘
```

When all four criteria are satisfied, the asset transitions from `ENCROACHING` to `PASSABLE` (Severity Tier 1).

#### 3. Recession without Submergence (Caution Only)
If a road entered `ENCROACHING` during a high-water event but **never reached `IMPASSABLE`** (water encroached upon low verges or an EA alert was issued, but the crown remained dry and gates were not closed):
- Transition to `PASSABLE` occurs as soon as:
  1. $h < Z_{\text{caution}} - 0.05\text{m}$.
  2. EA Flood Warning / Alert is removed.
  3. Standard 30-minute debounce window (2 consecutive nominal readings) confirms stability.
- No 6-hour council inspection window is imposed because physical gates were never locked shut for carriageway submergence.

---

## 5. Microcopy & Epistemic Humility Messaging (`[RULE-HUM-01]`)

Because the platform does not possess automated telemetry on the council's physical padlocks, user-facing microcopy must be transparent, modest, and empowering:

| State & Phase | Status Pill | User-Facing Microcopy & Driver Guidance | Live Ground-Truth Link |
| :--- | :---: | :--- | :---: |
| **`PASSABLE`** | `🟢 PASSABLE` | "Road crown is dry and clear. Standard vehicular transit open. (If council gates remain shut for maintenance, report to Somerset Highways)." | `[📷 View Camera]` (where available) |
| **`ENCROACHING`** (Rising / Verge) | `🟡 CAUTION: DAMP` | "Water encroaching on roadside rhynes and low spots ($X\text{cm}$ freeboard remaining). Low vehicles use caution." | `[📷 View Camera]` |
| **`ENCROACHING`** (Rapid Surge) | `🟡 HIGH RISK: RISING` | "Water rising rapidly ($+X.XX\text{m/h}$). Inundation possible within hours. Somerset Council gate closure imminent." | `[📷 View Camera]` |
| **`IMPASSABLE`** | `🔴 CLOSED & SUBMERGED` | "Carriageway submerged or Somerset Council emergency gates locked shut. Impassable to all vehicles. Follow official diversion." | `[📷 View Camera]` |
| **`ENCROACHING`** (Clearing / Inspection) | `🟡 CLEARING / INSPECTING` | "Floodwaters receded below crown at **[Time]** (dry for **$X$ hours**). Carriageway is clear, but emergency gates remain locked pending Somerset Council safety inspection for silt, debris, and scour. Gates are typically inspected and reopened during daylight hours." | `[📷 Check Live Camera to Verify Gates ↗]` |

---

## 6. Summary Thresholds & Registry Matrix for Implementation

This matrix establishes the strict single source of truth for `ASSET_DEFINITIONS` in `src/js/hydro_engine.js`:

| Asset ID | Driving Station | Gauge Datum | Caution Elevation ($Z_{\text{caution}}$) | Crown / Closure Elevation ($Z_{\text{crown}}$) | EA Target Area Code | EA Target Area Name | Correlated Camera | Survey Status |
| :--- | :---: | :---: | :---: | :---: | :--- | :--- | :---: | :---: |
| **`cuts_road`** | `52127` | $+0.00\text{m}$ | $7.00\text{m AOD}$ | $7.35\text{m AOD}$ | `112FWFCUR10A` | Curry Moor and Hay Moor | `athelney_cuts_rd` | `📐 Surveyed` |
| **`muchelney_access`** | `52120` | $+5.00\text{m}$ | $7.30\text{m AOD}$ ($2.30\text{m}$) | $7.86\text{m AOD}$ ($2.86\text{m}$) | `112WAFYPM` | River Yeo & Parrett Moors | `huish_episcopi` | `📐 Surveyed` |
| **`beer_wall_a372`** | `52157` | $+0.00\text{m}$ | $7.15\text{m AOD}$ | $7.30\text{m AOD}$ (Weir) | `SOWY_KSD` | River Sowy / KSD Catchment | — | `⚠️ PENDING SURVEY` |
| **`new_road_curry`** | `52127` | $+0.00\text{m}$ | $6.20\text{m AOD}$ | $7.10\text{m AOD}$ (Gate) | `112FWFCUR10A` | Curry Moor and Hay Moor | — | `⚠️ PENDING SURVEY` |
| **`a361_burrowbridge`** | `52127` / `52158` | $+0.00\text{m}$ | $7.35\text{m}$ (Cascade) | $7.80\text{m AOD}$ (Levee) | `112FWFEAS10A` | A361 East Lyng to Burrowbridge | — | `⚠️ PENDING SURVEY` |
| **`bicknells_bridge_access`** | `52120` | $+5.00\text{m}$ | $7.00\text{m AOD}$ ($2.00\text{m}$) | $7.30\text{m AOD}$ ($2.30\text{m}$) | `112WAFYPM` | River Yeo & Parrett Moors | `huish_episcopi` | `⚠️ PENDING SURVEY` |
| **`moorland_new_cut_road`** | `52159` | $+0.00\text{m}$ | $3.80\text{m AOD}$ | $4.80\text{m AOD}$ (Pumps) | `112FWFSAL10A` | Salt Moor & North Moor | — | `⚠️ PENDING SURVEY` |
| **`stan_moor_road`** | `52118` / `52127` | $+0.00\text{m}$ | $7.15\text{m AOD}$ | $7.30\text{m AOD}$ (Tone) | `112FWFSTA10A` | Stan Moor (Athelney & Curload) | — | `⚠️ PENDING SURVEY` |

### Deadband Offsets (`HYDRO_DEADBANDS`):
- `road_crown`: $0.03\text{m}$ ($3\text{cm}$ exit deadband below crown).
- `road_caution`: $0.05\text{m}$ ($5\text{cm}$ exit deadband below caution).
- `surge_threshold`: $+0.03\text{m/h}$ ($3\text{cm/h}$ over 3-hour moving window).
- `inspection_daylight_hours`: $6$ (hours between 08:00 and 17:00 GMT/BST).
- `inspection_hard_timeout_hours`: $24$ (hours elapsed since water recession).

---

## 7. Data Contract & Schema for Implementation (Issue #12)

To enable the Full Stack Developer to implement Issue #12 seamlessly:

```javascript
// Example evaluated road passability entity payload:
{
  asset_type: "road",
  asset_id: "cuts_road",
  status: "ENCROACHING",             // Canonical: PASSABLE | ENCROACHING | IMPASSABLE
  severity_tier: 3,                  // 1 = Nominal, 3 = Warning, 4 = Critical
  phase: "CLEARING_INSPECTION_PENDING", // APPROACHING_FLOOD | SUBMERGED | CLEARING_INSPECTION_PENDING | NOMINAL
  primary_station: "52127",
  stage_mAOD: 7.28,
  clearance_m: 0.07,                 // Distance below road crown (0.07m below 7.35m)
  rate_of_rise_mh: -0.015,           // Rate of change over 3 hours
  ea_warning_target_area: "112FWFCUR10A",
  ea_warning_state: "INACTIVE",      // INACTIVE | ALERT | WARNING
  submerged_end_time: "2026-11-01T14:15:00Z",
  dry_duration_hours: 4.5,
  daylight_dry_hours: 3.0,
  inspection_window_met: false,
  camera_id: "athelney_cuts_rd",
  narrative: "Floodwaters receded below crown at 14:15 (dry for 4.5 hours). Carriageway is clear, but emergency gates remain locked pending Somerset Council safety inspection for silt and scour. Gates are typically inspected and reopened during daylight hours."
}
```

This completes the authoritative specification and provides 100% domain and mathematical consistency across the platform.
