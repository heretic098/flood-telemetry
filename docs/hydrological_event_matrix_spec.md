# Hydrological Event Matrix & State Transition Specification
## Somerset Levels & Moors Flood Telemetry Network

**Role:** Lead Climate & Hydrology Scientist (`climate_hydrology_scientist`), UI/UX Design Specialist (`ui_ux_designer`), & Cynical Code Auditor (`code_reviewer`)  
**Date:** November 2026 (Updated)  
**Status:** Authoritative Hydrological Domain Standard & System Architecture Specification (v2.1)  
**Governing Invariants:** `.agents/AGENTS.md` (`RULE-HUM-01`, `RULE-PROV-01`, `RULE-SUB-01`, `RULE-ENT-01`, `RULE-ALT-01..05`, `RULE-TAX-01..06`, `RULE-DAT-01..04`, `RULE-SLP-01..04`, `RULE-PUMP-01`, `RULE-NET-01`, `RULE-CALC-01`, `UI-COL-01..03`, `UI-ACC-01`)  
**Hydrological References:** Environment Agency Somerset Levels Trigger Point Plan; EA Hydrometry & Telemetry Service; Somerset Rivers Authority (SRA) Enhanced Programme; UK Geodetic Datum Newlyn (mAOD).  
**Target Subsystems:** `src/js/hydro_engine.js`, `server.js`, `telemetry.db` (`telemetry_events`), Automated Event Engine, Topology Inspector, AI Vision Inspection Pipeline.

---

## 1. Architectural Invariants: Ground-Truth Stage vs. Volumetric Speculation

### 1.1 Strict Ban on Volumetric & Discharge Speculation (`[RULE-CALC-01]`)
Environment Agency real-time APIs provide **water stage ($m$)** at 15-minute intervals. The API does **NOT** provide:
- Open-channel river rating curves ($Q(h)$) or bathymetric cross-sections;
- Sluice gate aperture telemetry ($w$) at diversion structures like Monk's Leaze Clyse;
- Electrical SCADA run-state or power telemetry from internal drainage board pumping stations.

> [!IMPORTANT]
> **No Volumetric Calculus:** Calculating, integrating, or broadcasting volumetric flow rates ($m^3/s$, cumecs, Megalitres/day, or cumulative volume $m^3$) as ground-truth telemetry or database triggers is **STRICTLY PROHIBITED**.
> 
> The system tracks **what is empirically measured with confidence**: exact water stage elevation ($\text{mAOD}$), structural clearance ($\text{m}$ to crest or road crown), event duration ($h$), and discrete operational state transitions.

### 1.2 Normalized Entity-State Architecture (`[RULE-TAX-06]`, `[RULE-ENT-01]`)
All assets, events, and UI components must strictly adhere to the tripartite relation:
$$\forall \text{ entity, UI component, database record, or event } E, \quad E \equiv \langle \text{asset\_type}, \text{asset\_id}, \text{status} \rangle$$

Bespoke concatenated event names (such as `CUTS_ROAD_CASCADE_START`, `MUCHELNEY_ROAD_INUNDATION`, or ad-hoc states like `EMERGENCY_PUMPING`, `STORM_SURGE`, `ELEVATED`) are **STRICTLY BANNED**. Every state must belong to the closed, normalized enum for that asset category.

---

## 2. Canonical Asset Types & Closed State Enums

Every hydraulic and transport asset in the network belongs strictly to one of six canonical asset types:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          6 CANONICAL ASSET TYPES                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. road        🛣️ Community highway access & flood passability             │
│  2. polder      🚜 Lowland flood retention basin & EA pumping triggers     │
│  3. spillway    🌊 Engineered lateral overflow weir into retention moor     │
│  4. tidal_gate  🌊 Macro-tidal estuarine outfall with gravity flap doors    │
│  5. sluice      🎛️ Controlled river diversion structure (clyse)            │
│  6. gauge       📡 In-channel open river hydrometric monitoring station     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Complete Normalized State Dictionary

| Asset Type (`asset_type`) | Closed State Enum (`state`) | Severity Tier | Operational Meaning |
| :--- | :--- | :---: | :--- |
| **`road`** | `PASSABLE`<br>`ENCROACHING`<br>`IMPASSABLE` | **1 (NOMINAL)**<br>**3 (WARNING)**<br>**4 (CRITICAL)** | Road crown dry; passable to standard traffic.<br>Margin water / ditch bank-full splash risk; low vehicle caution.<br>Water depth $> 15\text{cm}$; carriageway flooded and impassable. |
| **`polder`** | `STANDBY`<br>`DUTY_PUMPING`<br>`MOBILE_ORDERED`<br>`MOBILE_ACTIVE`<br>`CRITICAL` | **1 (NOMINAL)**<br>**2 (ACTIVE)**<br>**3 (WARNING)**<br>**3 (WARNING)**<br>**4 (CRITICAL)** | Basin water below pump trigger; gravity draining or penning.<br>Fixed permanent station duty pumps running.<br>Water rising; EA Trigger Point reached to order contractor pumps.<br>Contractor high-volume mobile pumps on site and running.<br>Basin retention capacity near full; overspill risk. |
| **`spillway`** | `SECURE`<br>`NEAR_CREST`<br>`OVERTOPPING` | **1 (NOMINAL)**<br>**3 (WARNING)**<br>**4 (CRITICAL)** | River stage $> 15\text{cm}$ below surveyed concrete weir crest.<br>River stage within $15\text{cm}$ of weir lip; overtopping imminent.<br>River stage $\ge$ crest elevation; active overflow into moor. |
| **`tidal_gate`** | `DISCHARGING`<br>`TIDE_LOCKED` | **1 (NOMINAL)**<br>**2 (ACTIVE)** | Flap gates pushed open by head differential; emptying to sea.<br>Estuary tide higher than inland drain; flap gates held shut. |
| **`sluice`** | `CLOSED`<br>`DIVERTING`<br>`THROTTLED`<br>`REVERSE_LOCK` | **1 (NOMINAL)**<br>**2 (ACTIVE)**<br>**3 (WARNING)**<br>**3 (WARNING)** | Gates down in agricultural penning mode or retaining river.<br>Gates open; water actively diverting through bypass channel.<br>Downstream receiving reach full; diversion capacity restricted.<br>Downstream head higher than upstream; sealed to prevent backflow. |
| **`gauge`** | `NORMAL`<br>`ALERT` | **1 (NOMINAL)**<br>**3 (WARNING)** | River level within EA typical seasonal envelope.<br>River level exceeds EA typical high flood boundary. |

---

## 3. The 4-Tier Consequence-Based Alerting Model

To ensure alerts are immediately digestible to non-technical Somerset residents, parish flood wardens, and commuters, the system bridges IT severity conventions (`OK`, `INFO`, `WARN`, `CRITICAL`) directly into **human consequence language**.

```
IT / Syslog Severity      Consequence Tier          Plain-English State                     Visual Encoding
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
[Level 1: OK]             Nominal                   "Normal Baseflow" / "Normal Penning"    🟢 Green / 🔵 Deep Blue
[Level 2: INFO]           Active Management         "Pumping Active" / "Sluice Diverting"   💧 Cyan / ⚪ Neutral Slate
[Level 3: WARN]           Elevated Proximity Risk   "Water Rising" / "Approaching Crest"    🟡 Warning Amber (`#f59e0b`)
[Level 4: CRITICAL]       Active Inundation         "Spillway Overtopping" / "Impassable"   🔴 Emergency Red (`#ef4444`)
```

### Progressive Disclosure Framework (3 UI Levels)
To eliminate panic while preserving precision:
1. **Level 0 (Hero / Glanceable Badge):** Consequence token in plain words: `SECURE`, `PUMPING ACTIVE`, `NEAR CREST`, `OVERTOPPING`.
2. **Level 1 (Subtext / Delta Metric):** Physical clearance in human units with 3-hour trend vectors: `18cm below spillway crest (▲ Rising)` or `+1.45m clearance to road crown (— Steady)`.
3. **Level 2 (Topology Drawer & Methodology):** Exact geodetic elevation in mAOD, seasonal regime badge (`☀️ Summer Penning` vs `❄️ Winter Flood`), and statutory threshold provenance tag (Tier 1 Surveyed, Tier 2 EA Trigger Plan, Tier 3 EA Statistical).

> [!NOTE]
> **The "So What?" Rule:** No alert may ever be presented as a raw isolated number (e.g. `Stage: 7.32m`). Every elevated state must be accompanied by a plain-English explanation stating what equipment is running, the physical clearance remaining, and the immediate consequence.

### 3.1 The Centimetre Rule for Sub-Metre Clearances
Clearances below $1.00\text{m}$ MUST be presented in whole centimetres (e.g. `18cm below crest` or `85cm clearance to road crown`, NEVER `0.18m` or `0.85m`). Resident cognitive stress testing demonstrates that `0.18m` is frequently misread as $1.8\text{m}$ (an order-of-magnitude error). Clearances $\ge 1.00\text{m}$ are formatted in metres with two decimals (e.g. `+1.45m margin`).

### 3.2 3-Hour Trend Momentum Vectors
Every Level 1 subtext metric includes a 3-hour rate-of-change vector:
- `▲ Rising` ($\ge +2\text{cm}/3\text{h}$)
- `▼ Receding` ($\le -2\text{cm}/3\text{h}$)
- `— Steady` ($|\Delta h| < 2\text{cm}/3\text{h}$)

This gives residents and flood wardens immediate awareness of momentum without needing to inspect sparkline charts.

### 3.3 Plain-English Translation Dictionary
To bridge hydraulic engineering jargon to non-technical community terminology, the UI and event narratives strictly translate domain concepts:

| Technical / Engineering Term | Community Plain-English Translation | Resident Context & Meaning |
| :--- | :--- | :--- |
| **`mAOD`** | Height above sea level | Metres Above Ordnance Datum Newlyn. E.g., *"Height above sea level; local fields sit at ~4.2m."* |
| **`Bed invert`** | Riverbed floor | The lowest surveyed point of the channel bed. |
| **`Clyse`** | Water gate / diversion structure | Traditional Somerset term for an intake or tidal structure equipped with sluice doors or gravity flap gates. |
| **`Sill`** | Concrete intake ledge | The raised concrete base or threshold over which water enters a sluice or culvert. |
| **`Differential head` ($\Delta h$)** | Water level difference | The difference in water height across a barrier, driving gravity flow from high to low. |
| **`Polder`** | Embanked flood storage moor | Lowland basin protected by river levees that stores overflow floodwaters and relies on pumps to drain. |
| **`Penning`** | Summer ditch water retention | Maintaining water levels high in rhynes during summer for agricultural wet-fencing, irrigation, and peat conservation. |
| **`Freeboard`** | Safety margin | The remaining vertical distance between current water level and the top of a bank, weir, or road. |

---

## 4. Hardware Normalisation: Fixed Duty Pumps vs. Emergency Mobile Pumps

A critical domain distinction exists between automated, fixed station equipment and emergency contractor deployments:

| Operating Dimension | Fixed Duty Pumping (`DUTY_PUMPING`) | Emergency Mobile Pumping (`MOBILE_ACTIVE`) |
| :--- | :--- | :--- |
| **Physical Equipment** | Permanent electric/diesel pumps in fixed concrete sumps (e.g. Currymoor PS, Northmoor PS, Huish Episcopi PS). | Temporary ultra-high-volume diesel pumps brought on flatbed trailers by contractor convoys. |
| **Operational Role** | Routine, automated evacuation of winter rainfall within designed system capacity. | Civil defense emergency response when gravity outfalls are blocked or fixed stations are overwhelmed. |
| **Severity Tier** | **Tier 2: Active Management** (Green/Cyan/Slate — calm, controlled). | **Tier 3: Warning** (Amber — high logistical mobilization). |
| **Locations in Somerset** | Currymoor PS, Northmoor PS, Saltmoor PS, Huish Episcopi PS. | Currymoor PS (Stage 3), Northmoor PS (Stage 3) (EA Somerset Levels Trigger Point Plan). |

### 4.1 The Dunball Outfall Reality
- **Structural Reality:** Dunball Clyse is historically and structurally a **pure gravity tidal flap gate** (`asset_type: 'tidal_gate'`, `asset_id: 'dunball_outfall'`) with zero permanent pumps. Under normal conditions, it discharges purely by gravity when the tide goes out (`DISCHARGING` vs `TIDE_LOCKED`).
- **Emergency Mobilization Protocol:** When catastrophic flooding strikes the Levels and high tides lock the flap gates for extended cycles, the EA may manually deploy contractor-operated high-capacity mobile pumps (e.g. Dutch Van Heck trailer units) to pump over the clyse into the Parrett Estuary.
- **Strict Ban on Simulated Automated Pump Runs (`[RULE-SUB-01]`, `[RULE-HUM-01]`):** Dunball is NOT a polder basin. The platform does NOT invent an artificial `dunball_pumps` polder entity or assert automated active pumping from routine inland stage rises (such as $2.80\text{m AOD}$, an ~18cm rise above baseflow). We only ingest stage telemetry; we do not simulate unmeasured SCADA pump run-states.

---

## 5. Seasonal Operating Regimes (Summer Penning vs. Winter Flood)

The Somerset Drainage Boards (IDB) and Environment Agency operate two distinct seasonal water level regimes across the Levels:

```
                  ☀️ SUMMER PENNING REGIME (Apr 15 – Oct 15)
Ditches & rhynes held HIGH (~4.30–4.45m AOD on Curry Moor, 6.90m AOD at Huish)
Goal: Wet-fencing for livestock, agricultural irrigation, and preventing peat soil drying/shrinkage.

                  ❄️ WINTER FLOOD REGIME (Oct 16 – Apr 14)
Water levels drawn DOWN to minimum baseflow to maximise retention/sponge capacity for fluvial storms.
```

### Threshold Dynamic Behavior
1. **Duty Pump Thresholds Shift Seasonally:**
   - At Currymoor PS: Duty pump trigger shifts from $4.30\text{m AOD}$ (Winter) to $4.45\text{m AOD}$ (Summer).
   - At Huish Episcopi PS: Lead pump shifts from $6.30\text{m}$ to $6.70\text{m}$; Duty pump shifts from $6.50\text{m}$ to $6.90\text{m}$.
   - *Reason:* Pumps must not fight the agricultural penning boards during summer.
2. **Emergency & Structural Thresholds Remain Constant:**
   - Mobile Pumps Ordered ($5.80\text{m}$), Mobile Pumps Active ($6.10\text{m}$), Hookbridge Crest ($7.45\text{m}$), and Cuts Road Crown ($7.35\text{m}$) are absolute physical geometry and never change with the season.
3. **Public Reassurance (`[RULE-PUMP-01]`):**
   - Elevated water during summer is badged as `☀️ Normal Summer Penning (Ditches Held for Agriculture & Peat)` to reassure the public that water is high by deliberate design, not an unmanaged flood.

---

## 6. Deep-Dive Structure Case Studies

### 6.1 Pumping Station & Lowland Basin: Curry Moor Basin (`52127`)
- **Asset Type:** `polder` | **Asset ID:** `curry_moor`
- **Physical Datums:** Basin floor $2.10\text{m AOD}$; Overspill inflow $7.45\text{m AOD}$ (Hookbridge).

```
       ▲ 7.45m AOD ─── Inundation via Hookbridge Spillway
       │
Tier 4 │ 6.50m AOD ─── CRITICAL: Basin Storage Near Full Capacity
       │ 6.10m AOD ─── WARNING: Mobile Pumps Active (Stage 3, EA Plan)
Tier 3 │ 5.80m AOD ─── WARNING: Mobile Pumps Ordered / Mobilising (Stage 2)
       │ 
Tier 2 │ 4.30m AOD (Winter) / 4.45m AOD (Summer) ─── ACTIVE: Duty Pumping
       │
Tier 1 │ 2.10m AOD ─── NOMINAL: Basin Floor (Standby / Gravity Drainage)
```

| Basin Stage ($h_{\text{mAOD}}$) | Internal State | Severity Tier | Resident UI Badge & Plain-English Description |
| :--- | :--- | :---: | :--- |
| $< 4.30\text{m}$ (Winter)<br>$< 4.45\text{m}$ (Summer) | `STANDBY` | **1 (NOMINAL)** | 🟢 **STANDBY**<br>`+1.50m storage to pump start`<br>*"Moor ditches at normal seasonal level; gravity draining to river."* |
| $\ge 4.30\text{m}$ (Winter)<br>$\ge 4.45\text{m}$ (Summer) | `DUTY_PUMPING` | **2 (ACTIVE)** | 💧 **PUMPING ACTIVE**<br>`Duty Pumps ON (4.30m trigger)`<br>*"Permanent station pumps running to evacuate rainfall."* |
| $\ge 5.80\text{m}$ AOD | `MOBILE_ORDERED` | **3 (WARNING)** | 🟡 **MOBILE PUMPS ORDERED**<br>`30cm below emergency active stage`<br>*"Water rising across moor; EA has ordered contractor mobile pumps."* |
| $\ge 6.10\text{m}$ AOD | `MOBILE_ACTIVE` | **3 (WARNING)** | 🟡 **EMERGENCY PUMPING**<br>`35cm below critical moor capacity`<br>*"High-capacity mobile pumps deployed and running alongside station."* |
| $\ge 6.50\text{m}$ AOD | `CRITICAL` | **4 (CRITICAL)** | 🔴 **CRITICAL STORAGE**<br>`Storage capacity full`<br>*"Curry Moor storage near capacity. Cuts Road remains PASSABLE with 85cm clearance to road crown (Crown is 7.35m AOD)."* |

---

### 6.2 Engineered Spillway: Hookbridge Spillway (`52118`)
- **Asset Type:** `spillway` | **Asset ID:** `hookbridge`
- **Physical Datums:** River bed $3.30\text{m AOD}$; Broad-crested weir crest $7.45\text{m AOD}$.

```
       ▲ 7.45m AOD ─── CRITICAL: Concrete Weir Crest (Overtopping into Curry Moor)
Tier 4 │
Tier 3 │ 7.30m AOD ─── WARNING: 15cm Near-Crest Pre-Warning Buffer
       │ 7.15m AOD ─── WARNING: EA River Tone Typical High Flood Alert
Tier 1 │ 
       │ 3.30m AOD ─── NOMINAL: River Tone Bed Invert
```

| River Tone Stage ($h_{\text{mAOD}}$) | Internal State | Severity Tier | Resident UI Badge & Plain-English Description |
| :--- | :--- | :---: | :--- |
| $< 7.30\text{m}$ AOD | `SECURE` | **1 (NOMINAL)** | 🟢 **SECURE**<br>`42cm clearance to weir crest`<br>*"River Tone passing safely within channel banks."* |
| $7.30\text{m}$ to $7.44\text{m}$ AOD | `NEAR_CREST` | **3 (WARNING)** | 🟡 **NEAR CREST**<br>`⚠️ 8cm below crest`<br>*"Spillway near crest. Overtopping into Curry Moor will occur if river rises 8cm."* |
| $\ge 7.45\text{m}$ AOD | `OVERTOPPING` | **4 (CRITICAL)** | 🔴 **OVERTOPPING**<br>`▲ Overtopping by +14cm`<br>*"River Tone is actively spilling over Hookbridge weir into Curry Moor."* |

*(Note: The River Tone in-channel gauge `52118` simultaneously evaluates `ALERT` when stage $\ge 7.15\text{m}$, providing advance notification before the spillway reaches `NEAR_CREST` at $7.30\text{m}$.)*

---

### 6.3 Controlled Intake Sluice: Monk's Leaze Clyse (`52233` / `52234`)
- **Asset Type:** `sluice` | **Asset ID:** `monks_leaze_clyse`
- **Physical Datums:** Concrete intake sill $4.20\text{m AOD}$; Sowy bed $4.20\text{m AOD}$.

```
       ▲ 7.90m AOD ─── Parrett Intake Bankfull Alert
       │ 7.60m AOD ─── Downstream Sowy Channel Capacity Full
       │ 7.20m AOD ─── EA Operational Diversion Threshold
       │ 4.20m AOD ─── Surveyed Intake Sill / Sowy Channel Bed
```

| Hydraulic Condition | Internal State | Severity Tier | Resident UI Badge & Plain-English Description |
| :--- | :--- | :---: | :--- |
| $h_{\text{up}} < 7.20\text{m}$ AOD | `CLOSED` | **1 (NOMINAL)** | ⚪ **PENNING / CLOSED**<br>`0.85m below gate intake trigger`<br>*"Penstock gates closed. River Parrett conveys all water downstream."* |
| $h_{\text{up}} \ge 7.20\text{m}$ AND<br>$h_{\text{down}} < 7.60\text{m}$ ($\Delta h \ge +5\text{cm}$) | `DIVERTING` | **2 (ACTIVE)** | 💧 **DIVERTING TO SOWY**<br>`+28cm gravity diversion head`<br>*"Gates open: diverting excess Parrett floodwater into Sowy bypass."* |
| $h_{\text{up}} \ge 7.20\text{m}$ AND<br>$h_{\text{down}} \ge 7.60\text{m}$ ($\Delta h < +5\text{cm}$) | `THROTTLED` | **3 (WARNING)** | 🟡 **SLACK / THROTTLED**<br>`Sowy downstream at 7.62m capacity`<br>*"Sowy Relief Channel full; downstream water level restricting diversion."* |
| $h_{\text{down}} > h_{\text{up}}$ | `REVERSE_LOCK` | **3 (WARNING)** | 🟡 **REVERSE LOCK**<br>`Downstream head higher than river`<br>*"Gates sealed to prevent reverse flooding from Sowy back into Parrett."* |

---

### 6.4 Macro-Tidal Outfall Complex: Dunball Clyse (`52163` / `E9094`)
The Dunball outfall complex monitors two crucial, distinct dimensions for Somerset residents:
1. **The Physical Flap Gates:** (`tidal_gate` / `dunball_outfall`): Passive doors swinging open on low tide and pushed shut on high tide.
2. **Emergency Mobile Pump Deployment Readiness:** (`dunball_mobile_ps`): Evaluates whether water levels in the King's Sedgemoor Drain (KSD) have reached the official **EA Somerset Levels Trigger Point Plan** stages where contractor mobile pumps **should or should not be deployed on site**.

```
       ▲ 6.50m AOD ─── Parrett Estuary Storm Surge / High Spring Tide Alert (Gauge 52163)
       │
       │ 3.50m AOD (Winter) / 3.70m (Summer) ─── Emergency Pumping Stage: Mobile Pumps Should Be Active
       │ 3.30m AOD (Winter) / 3.50m (Summer) ─── EA Trigger Point: Mobile Pumps Should Be Mobilised
       │ 2.80m AOD (Winter) / 3.10m (Summer) ─── Elevated Drain Watch (Pre-deployment monitoring)
       │
       │ Sea < Inland ─── Low Tide: Gravity Discharge into Parrett Estuary (DISCHARGING)
       │ Sea >= Inland ─── High Tide: Tide-Locked Flap Doors Closed (TIDE_LOCKED)
```

| Monitored Dimension | Asset Entity | Condition | Normalized State | Severity Tier | Resident UI Badge & Plain-English Description (Answering "Should pumps be there?") |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Sea Doors** | `tidal_gate`<br>`dunball_outfall` | $h_{\text{sea}} < h_{\text{ksd}}$ | `DISCHARGING` | **1 (NOMINAL)** | 🔵 **DISCHARGING (LOW TIDE)**<br>`Estuary 1.80m below drain`<br>*"Low tide in estuary: safe gravity discharge to sea."* *(Estuarine Deep Blue)* |
| **Sea Doors** | `tidal_gate`<br>`dunball_outfall` | $h_{\text{sea}} \ge h_{\text{ksd}}$ | `TIDE_LOCKED` | **2 (ACTIVE)** | ⚪ **TIDE-LOCKED (HIGH TIDE)**<br>`Next low-tide window ~3h 15m`<br>*"Normal high tide holding flap gates closed; inland drain storing water."* |
| **Mobile Pump Deployment** | `dunball_mobile_ps`<br>*(Emergency Pumps)* | $h_{\text{ksd}} < 3.30\text{m}$ (Winter)<br>$< 3.50\text{m}$ (Summer) | `STANDBY` | **1 (NOMINAL)** | 🟢 **NO PUMPS REQUIRED**<br>`+70cm storage buffer to mobilization trigger`<br>*"Inland drain within normal storage capacity. Mobile pumps are NOT required on site."* |
| **Mobile Pump Deployment** | `dunball_mobile_ps`<br>*(Emergency Pumps)* | $h_{\text{ksd}} \ge 3.30\text{m}$ (Winter)<br>while tide-locked | `MOBILE_ORDERED` | **3 (WARNING)** | 🟡 **MOBILE PUMPS SHOULD BE MOBILISING**<br>`Drain >= 3.30m while tide-locked`<br>*"EA Trigger Point reached: contractor mobile pumps should be deploying to Dunball."* |
| **Mobile Pump Deployment** | `dunball_mobile_ps`<br>*(Emergency Pumps)* | $h_{\text{ksd}} \ge 3.50\text{m}$ (Winter)<br>while tide-locked | `MOBILE_ACTIVE` | **3 (WARNING)** | 🔴 **MOBILE PUMPS REQUIRED ACTIVE**<br>`Drain >= 3.50m (Emergency stage)`<br>*"Emergency stage reached: high-volume mobile pumps should be running over the clyse into the estuary."* |
| **Estuary Surge** | `gauge`<br>`52163` | $h_{\text{sea}} \ge 6.50\text{m}$ | `ALERT` | **3 (WARNING)** | 🟡 **TIDAL SURGE ALERT**<br>`Estuary 6.65m AOD`<br>*"High spring tide / surge in Parrett Estuary; outfall heavily locked."* |

> [!NOTE]
> **Transparent Inferred Operational Status (`[RULE-SUB-01]`, `[RULE-HUM-01]`):** Dunball possesses zero permanent fixed pumps and discharges by gravity. The platform evaluates whether emergency mobile pumps **should or should not be deployed** based strictly on surveyed KSD stage relative to the published **EA Somerset Levels Trigger Point Plan**. User-facing microcopy explicitly qualifies this status: *"Inferred from inland King's Sedgemoor Drain stage relative to the EA Somerset Levels Trigger Point Plan."*

---

## 7. Anti-Flapping Hysteresis Deadbands & Debounce Session Window

### 7.1 Directional Physical Deadbands (`HYDRO_DEADBANDS`)
To prevent sensor noise and wind ripples from toggling states back and forth, all exit transitions enforce calibrated directional deadbands:

```javascript
export const HYDRO_DEADBANDS = {
  weir_crest: 0.03,    // 3cm weir crest overtopping exit
  pre_spill: 0.05,     // 5cm approaching buffer exit
  polder_pump: 0.05,   // 5cm pumping station deactivation
  road_crown: 0.03,    // 3cm road inundation clearance exit
  road_caution: 0.05,  // 5cm road caution margin exit
  clyse_head: 0.05,    // 5cm dual-gauge differential head
  tidal_flap: 0.05,    // 5cm sea flap cracking head differential
  river_gauge: 0.05    // 5cm in-channel flood alert clearance
};
```

### 7.2 30-Minute Debounce Cooldown (Decision 4)
- **Active Session Tracking:** When an asset transitions into an elevated state (`severity_tier >= 2`), a session record opens with `start_time` and `status = 'ACTIVE'`.
- **Peak Tracking:** Every 15-minute polling cycle updates `peak_stage_mAOD` and active duration while the session remains active.
- **Closure Cooldown & Debounce Timing:** An active session is **NOT closed on a single dip below threshold**. It requires **two consecutive nominal readings** (a 30-minute quiet window) before closing the event. Upon closure, `end_time` is stamped as the timestamp of the **first nominal reading** that exited the deadband (not the second confirmation reading, preserving chronological accuracy).

### 7.3 Zero-Trust Telemetry Rule (`[RULE-PROV-01]`, `[RULE-SUB-01]`)
Missing, corrupted, or null sensor telemetry MUST NEVER fall back to synthetic baseflow or dormant assumptions during active events.
- If an upstream telemetry station drops offline, times out, or returns null / HTTP 500 while an asset is in an elevated state (`severity_tier >= 2`), the evaluation engine MUST NOT close the event or assume water levels have dropped.
- Telemetry dropouts **freeze active session evaluation** in an explicit `TELEMETRY_INTERRUPTED` state, retaining peak stages and elapsed durations.
- Active flood events close **strictly when valid empirical telemetry resumes** and provides two consecutive confirmed readings below the deadband threshold.

---

## 8. Embedded Database Ledger Schema (`telemetry_events`)

The legacy `spill_events` table (which previously contained speculative cumec columns) is dropped and replaced with the unified `telemetry_events` table:

```sql
CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_type TEXT NOT NULL CHECK(asset_type IN ('road', 'polder', 'spillway', 'tidal_gate', 'sluice', 'gauge')),
  asset_id TEXT NOT NULL,
  from_state TEXT CHECK(from_state IS NULL OR from_state IN (
    'PASSABLE', 'ENCROACHING', 'IMPASSABLE',
    'STANDBY', 'DUTY_PUMPING', 'MOBILE_ORDERED', 'MOBILE_ACTIVE', 'CRITICAL',
    'SECURE', 'NEAR_CREST', 'OVERTOPPING',
    'DISCHARGING', 'TIDE_LOCKED',
    'CLOSED', 'DIVERTING', 'THROTTLED', 'REVERSE_LOCK',
    'NORMAL', 'ALERT'
  )),
  to_state TEXT NOT NULL CHECK(to_state IN (
    'PASSABLE', 'ENCROACHING', 'IMPASSABLE',
    'STANDBY', 'DUTY_PUMPING', 'MOBILE_ORDERED', 'MOBILE_ACTIVE', 'CRITICAL',
    'SECURE', 'NEAR_CREST', 'OVERTOPPING',
    'DISCHARGING', 'TIDE_LOCKED',
    'CLOSED', 'DIVERTING', 'THROTTLED', 'REVERSE_LOCK',
    'NORMAL', 'ALERT'
  )),
  severity_tier INTEGER NOT NULL CHECK(severity_tier BETWEEN 1 AND 4),
  start_time TEXT NOT NULL,                                  -- ISO 8601 UTC timestamp
  end_time TEXT,                                            -- NULL while session is ACTIVE
  duration_seconds INTEGER,                                 -- Computed on event closure
  trigger_stage_mAOD REAL NOT NULL,                        -- Stage that tripped the threshold
  peak_stage_mAOD REAL NOT NULL,                           -- Highest water elevation during session
  clearance_m REAL,                                        -- Clearance to crest or road crown
  camera_id TEXT,                                          -- Correlated ground-truth webcam
  image_hash TEXT,                                         -- SHA-256 hash of verification frame
  camera_snapshot_id INTEGER,                              -- FK to camera_analysis record
  narrative TEXT NOT NULL,                                 -- Plain-English community explanation
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CLOSED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_asset 
  ON telemetry_events(asset_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_telemetry_events_active 
  ON telemetry_events(asset_id, status);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_start 
  ON telemetry_events(start_time DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_tier 
  ON telemetry_events(severity_tier, status);
```

### Scope & Backfill Policy (Decision 5)
- **Live-Only Generation:** The engine starts logging from the moment of deployment.
- **No Retroactive Backfill:** Live operational databases are not retroactively backfilled with synthetic historical records, preserving pure third-party empirical provenance ([`[RULE-PROV-01]`](file:///home/jonathan/Desktop/flood-telemetry/.agents/AGENTS.md)). Historical benchmark comparisons are conducted offline.
