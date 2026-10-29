---
name: somerset-hydrology-validation
description: >-
  Audits and validates station calibrations, vertical datums (mAOD), alert levels, structural taxonomy, and downhill hydraulic slopes across Somerset Levels flood infrastructure. Use whenever adding, modifying, or auditing stations, spillways, datums, or hydrology calculations.
---

# Somerset Levels Hydrological Domain Validation Skill

This skill provides the mandatory guidelines, hydraulic invariants, and calibration rules for working on the Somerset Levels & Moors river network topology and telemetry processing engine.

## 1. Vertical Datum Transformations

Water elevation cannot be compared across stations unless converted to the national geodetic reference frame (**mAOD Newlyn**).

$$h_{\text{mAOD}} = h_{\text{mASD}} + Z_{\text{datum}}$$

### Surveyed Station Datums:
- **52108 (Greenham - Upper Tone):** Datum = $+75.69\text{ m AOD}$
- **52109 (Bishops Hull - Mid Tone):** Datum = $+16.58\text{ m AOD}$
- **52111 (Taunton Market - Urban Tone):** Datum = $+12.47\text{ m AOD}$
- **52116 (Chiselborough - Upper Parrett):** Datum = $+20.70\text{ m AOD}$
- **52119 (Gaw Bridge - Mid Parrett):** Datum = $+10.00\text{ m AOD}$
- **Lowland & Estuary Stations:** Broadcast natively in mAOD from EA API (`stageScale.datum = 0`).

*Mandate:* Never perform arithmetic comparisons ($\Delta h = h_u - h_v$) or slope evaluations across stations with unadjusted datums.

---

## 2. Alert Level Strict Bounding

Every alert level MUST satisfy the physical operating inequality:

$$\text{minOnRecord} \le Z_{\text{invert}} < \text{typicalRangeLow} < \text{alert\_level} \le \text{maxOnRecord}$$

### Verified Station Thresholds (All 19 Network Stations):
| Station ID | Station Name | Class | Surveyed Datum | Typ. Low | Typ. High / Calibrated Alert | Max on Record | Structural / Operating Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **52108** | Greenham | `gauge` | $+75.69\text{ m}$ | $75.84\text{ m}$ | **$76.99\text{ m}$** | $77.89\text{ m}$ | Upper Tone in-channel river gauge |
| **52109** | Bishops Hull | `gauge` | $+16.58\text{ m}$ | $16.67\text{ m}$ | **$17.48\text{ m}$** | $19.17\text{ m}$ | Mid Tone in-channel river gauge |
| **52111** | Taunton Market | `gauge` | $+12.47\text{ m}$ | $13.29\text{ m}$ | **$14.24\text{ m}$** | $14.31\text{ m}$ | Urban Tone in-channel river gauge |
| **52162** | Bathpool Outfall | `gauge` | $0.00\text{ m}$ | $8.50\text{ m}$ | **$9.50\text{ m}$** | $11.03\text{ m}$ | Lower Tone in-channel river gauge |
| **52118** | Hookbridge Spillway | `spillway` | $0.00\text{ m}$ | $4.71\text{ m}$ | **$7.15\text{ m}$** | $8.10\text{ m}$ | Crest: $7.45\text{ m}$ (Alert: $30\text{cm}$ pre-spill) |
| **52127** | Curry Moor Basin | `polder_basin` | $0.00\text{ m}$ | $3.92\text{ m}$ | **$6.50\text{ m}$** | $8.05\text{ m}$ | Ground: $2.10\text{ m}$; Lead $4.00\text{m}$, Duty $4.30\text{m}$ |
| **52116** | Chiselborough | `gauge` | $+20.70\text{ m}$ | $20.75\text{ m}$ | **$22.50\text{ m}$** | $23.63\text{ m}$ | Upper Parrett in-channel river gauge |
| **52119** | Gaw Bridge | `gauge` | $+10.00\text{ m}$ | $10.23\text{ m}$ | **$12.80\text{ m}$** | $13.84\text{ m}$ | Mid Parrett in-channel river gauge |
| **52233** | Monk's Leaze Clyse Upstream | `clyse_gate` | $0.00\text{ m}$ | $6.01\text{ m}$ | **$7.90\text{ m}$** | $8.50\text{ m}$ | Sluice sill: $4.20\text{ m}$; Diverts to 52234 |
| **52234** | Monk's Leaze Clyse Downstream | `gauge` | $0.00\text{ m}$ | $6.01\text{ m}$ | **$7.60\text{ m}$** | $7.90\text{ m}$ | Sowy Intake; Bankfull capacity: $7.60\text{ m}$ |
| **52158** | Baltmoor Wall Spillway | `spillway` | $0.00\text{ m}$ | $3.55\text{ m}$ | **$7.50\text{ m}$** | $7.80\text{ m}$ | Crest: $7.80\text{ m}$ (Alert: $30\text{cm}$ pre-spill) |
| **52159** | Northmoor Basin | `polder_basin` | $0.00\text{ m}$ | $2.50\text{ m}$ | **$3.80\text{ m}$** | $5.89\text{ m}$ | Ground: $1.80\text{ m}$; Lead $3.40\text{m}$, Duty $3.70\text{m}$ |
| **52124** | West Quay Bridgwater | `gauge` | $0.00\text{ m}$ | $1.20\text{ m}$ | **$6.10\text{ m}$** | $8.09\text{ m}$ | Tidal flood alert threshold: $6.10\text{ m}$ |
| **52163** | Dunball Tidal | `tidal_outfall` | $0.00\text{ m}$ | $-1.50\text{ m}$ | **$6.50\text{ m}$** | $7.09\text{ m}$ | Storm surge alert (HAT $\approx 6.30\text{m}$, defenses $7.50\text{m}$) |
| **52157** | Beer Wall Upstream | `spillway` | $0.00\text{ m}$ | $2.33\text{ m}$ | **$4.20\text{ m}$** | $5.07\text{ m}$ | River typHigh: $4.16\text{m}$; Road crest: $7.30\text{ m}$ |
| **E9531** | Bradney | `gauge` | $0.00\text{ m}$ | $1.00\text{ m}$ | **$3.50\text{ m}$** | $4.44\text{ m}$ | King's Sedgemoor Drain mid-reach gauge |
| **E9094** | Dunball Inland KSD | `gauge` | $0.00\text{ m}$ | $1.00\text{ m}$ | **$3.50\text{ m}$** | $4.07\text{ m}$ | Inland KSD gravity discharge outfall |
| **52120** | Huish Episcopi PS | `gauge` | $+5.00\text{ m}$ | $6.44\text{ m}$ | **$8.48\text{ m}$** | $9.92\text{ m}$ | River Yeo gateway; $8.20\text{m}$ pump cut-off, $7.30\text{m}$ Muchelney road |
| **52153** | Midelney | `gauge` | $+5.185\text{ m}$ | $6.10\text{ m}$ | **$8.20\text{ m}$** | $9.12\text{ m}$ | River Isle gateway; headlocked when Parrett $\ge$ Isle stage |

*Anti-Pattern Warning:*
1. Fluvial stations: Setting an alert level below `typicalRangeLow` (e.g. Bathpool at 6.90m) triggers a permanent false overtopping alert during calm baseflow. Setting an alert above `maxOnRecord` prevents alerts from ever firing.
2. Coastal / tidal stations: Setting an alert level to Mean High Water Springs (MHWS, e.g. 5.50m at Dunball) triggers false alarms twice every month during ordinary astronomical spring tides. Coastal alerts must be calibrated above Highest Astronomical Tide (HAT $\approx 6.30\text{m} - 6.50\text{m}$) to flag genuine meteorological storm surges.

---

## 3. Canonical 5-Class Taxonomy

Every node belongs to exactly ONE class:
1. `spillway`: Broad-crested weir designed to spill into polders. **Must have** numerical `crest_elevation_mAOD`.
2. `gauge`: Open in-channel river monitor. **Never has** a crest height. Cannot have `OVERTOPPING` status. Reports in **channel depth** ($m$ depth).
3. `clyse_gate`: Controlled diversion sluice/penstock. **Must have** `sill_elevation_mAOD`.
4. `polder_basin`: Lowland storage retention moor. Governed by pump thresholds. **Does not have a crest on its hydrograph.**
5. `tidal_outfall`: Macro-tidal estuary flap gates.

---

## 4. Downhill Hydraulic Gradient

For non-tidal open fluvial reaches:
$$h_{\text{upstream}} - h_{\text{downstream}} \ge -0.05\text{ m}$$
Upland reaches must exhibit steep drop ($> 0.50\text{ m}$):
- Greenham ($76.14$) $\to$ Bishops Hull ($16.93$)
- Bishops Hull ($16.93$) $\to$ Taunton Market ($13.12$)
- Taunton Market ($13.12$) $\to$ Bathpool ($7.54$)
- Chiselborough ($20.75$) $\to$ Gaw Bridge ($10.42$)
- Gaw Bridge ($10.42$) $\to$ Monk's Leaze Clyse ($6.75$)

---

## 5. Estuarine Baseflow Reachability & Fluvial Continuity

Every open river channel in the system must connect to the sea outfall during normal baseflow:

$$\forall \text{ river station } s \notin \{\text{polder\_basins}\}, \quad \exists \text{ path } \mathcal{P}(s \rightsquigarrow \text{sea\_outfall}) \subseteq \mathcal{E}_{\text{main\_river} \cup \text{sea\_outfall}}$$

* **Lateral Weirs vs River Terminators:** Spillways such as Hookbridge (`52118`) and Baltmoor Wall (`52158`) are lateral overflow weirs, NOT channel dead ends. When water is below crest, the river channel must continue downstream to its confluence (`52118` $\to$ `52158` at Burrowbridge).
* **Graph Traversal over Metadata:** Never assume a river is connected because it appears in a text list or documentation array (`chains`). Network validation must traverse the directed graph `edges` using breadth-first or depth-first search to confirm an unbroken path to Dunball Tidal Outfall (`52163`).

---

## 6. Polder Pumping Calibration & Penning Separation (`[RULE-PUMP-01]`)

1. **EA Trigger Point Plan Calibrations:**
   - **Curry Moor (`52127` — Currymoor PS & Stanmoor PS):**
     - Ground invert: $2.10\text{m AOD}$
     - Winter Fixed Pumps: Lead $4.00\text{m}$, Duty $4.30\text{m}$ | Summer Penning Fixed Pumps: Lead $4.30\text{m}$, Duty $4.60\text{m}$
     - EA Temporary Mobile Pumps: **Ordered at $5.80\text{m AOD}$**, **Active at $6.10\text{m AOD}$**, **Critical Storage at $6.50\text{m AOD}$**
   - **Northmoor (`52159` — Saltmoor PS & Northmoor PS):**
     - Ground invert: $1.80\text{m AOD}$
     - Winter Fixed Pumps: Lead $3.40\text{m}$, Duty $3.70\text{m}$ | Summer Penning Fixed Pumps: Lead $3.65\text{m}$, Duty $3.90\text{m}$
     - EA Temporary Mobile Pumps: **Ordered at $4.80\text{m AOD}$**, **Active at $5.20\text{m AOD}$**, **Critical Storage at $5.60\text{m AOD}$**
2. **Penning vs. Emergency Alert Separation:**
   - Normal summer/autumn IDB penning levels (e.g., Curry Moor held at $\sim 4.30\text{m}–4.48\text{m AOD}$ or Monk's Leaze Clyse penning the Parrett at $\sim 6.73\text{m AOD}$ above Midelney baseflow at $\sim 6.63\text{m AOD}$) are routine agricultural water management states.
   - Mobile pump triggers and global `WARNING` banners (`severity <= 4`) must NEVER fire during normal baseflow or summer penning (`Midelney < 7.30m AOD`).

---

## 7. Inter-Moor Cascade vs. River Levee Overtopping

Northmoor (`52159`) has two distinct floodwater entry pathways that must never be conflated or disconnected:
1. **Athelney Spillway (`7.35m AOD` across Cuts Road — `polder_overflow` edge `52127 -> 52159`):**
   - When Curry Moor (`52127`) fills to $\ge 7.35\text{m AOD}$, stored water cascades north-east across Cuts Road (East Lyng to Athelney) into Northmoor (`52159`).
2. **Baltmoor Wall (`7.80m AOD` Levee Defense — `spillway_overtopping` edge `52158 -> 52159`):**
   - Protects East Lyng and Northmoor directly against River Tone / River Parrett confluence water at Burrowbridge up to $7.80\text{m AOD}$.

---

## 8. Verification Command

Always verify all hydrological domain rules before finishing:
```bash
node --test tests/hydrological_network_audit.test.js
```

