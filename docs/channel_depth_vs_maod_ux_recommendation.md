# UI/UX Recommendation: Dual-Metric Information Architecture (Channel Depth vs. mAOD Elevation)

**Role:** UI/UX Design Specialist (`ui_ux_designer`)  
**Date:** September 20, 2026  
**Target Audience:** Non-technical Somerset Levels residents, local flood wardens, parish councils, and hydrology enthusiasts.  
**Context:** Resolution of user request regarding display priority of Channel Depth (m) vs. Absolute Elevation (mAOD) across river telemetry nodes.

---

## 1. Executive Summary & UX Analysis

### The Core Dilemma
Hydrological telemetry serves two distinct user groups with conflicting mental models:
1. **Local Residents / General Public:** Think in **relative channel depth** or **river stage above bed** (e.g., *"The river is 0.45m deep today"* or *"It's at 2.2m near the bank"*). Displaying `76.14m AOD` as the primary headline for an upstream river gauge like Greenham creates severe **cognitive friction** because $76\text{ m}$ sounds like an astronomical, catastrophic wall of water if uncontextualized.
2. **Flood Operations / Lowland Polder Engineers:** Think in **absolute elevation (mAOD)** because gravity drainage, sluice gates, and spillway overtopping (e.g. Hookbridge crest at $7.45\text{ m AOD}$, Baltmoor Wall crest at $7.80\text{ m AOD}$) are defined by fixed geographical datum levels.

### The UI/UX Solution: Node-Specific Dual-Metric Hierarchy
We recommend an **Adaptive Information Architecture** based on **Node Taxonomy**:
- **Upstream / Channel Gauges:** Prioritize **Relative Channel Depth (m)** as the primary hero metric, with **Absolute Elevation (mAOD)** as supporting subtext.
- **Engineered Spillways & Polder Basins:** Prioritize **Absolute Elevation (mAOD)** alongside **Crest Elevation** and **Clearance Delta**, with **Channel/Moor Depth (m)** as secondary subtext.

---

## 2. User Mental Models & Cognitive Load Analysis

| Feature / Metric | Upstream River Gauges (e.g. Greenham, Chiselborough) | Engineered Spillways & Polders (e.g. Hookbridge, Baltmoor Wall) |
| :--- | :--- | :--- |
| **Primary User Question** | *"How high is the river in its channel? Is it near bankful?"* | *"Is water overtopping the spillway into the moor?"* |
| **Dominant Mental Model** | **Relative Depth / Stage Above Bed ($m$)** | **Absolute Elevation ($mAOD$) vs Crest Height** |
| **Cognitive Risk of Raw mAOD** | **HIGH.** $76.14\text{ m AOD}$ sounds terrifyingly high without knowing sea-level context. | **LOW.** $7.62\text{ m AOD}$ vs $7.45\text{ m Crest}$ provides instant, clear clearance comparison ($+0.17\text{ m}$). |
| **Primary Hero Metric** | **Relative Channel Depth ($m$)** (e.g. `0.45 m depth`) | **Absolute Elevation ($mAOD$)** (e.g. `7.62 m AOD`) |
| **Secondary Metric Display** | `76.59 m AOD` (Subtext badge with datum note) | `2.12 m channel depth` (Subtext secondary metric) |

---

## 3. Visual Hierarchy & Card Layout Strategy

### Category A: Upstream & In-Stream River Gauges
*(Nodes: Greenham 52107, Bishops Hull 52109, Taunton Bridge 52115, Chiselborough 52201)*

1. **Card Header:**
   - Plain-English location title (e.g., *River Tone at Greenham*).
   - High-contrast Status Token Pill (`🟢 NORMAL STAGE` / `⚠️ ELEVATED STAGE`).
   - Relative freshness timestamp (*"Updated 8 mins ago"*).

2. **Hero Metric Area:**
   - **Primary Display:** Large, bold tabular numbers showing **Relative Channel Depth** (`0.45 m depth`).
   - **Visual Stage Clearance Gauge:** Dynamic progress bar showing current depth relative to historical normal range and bankful threshold.

3. **Secondary Subtext & Technical Badges:**
   - **Absolute Elevation Badge:** Displayed in pill format: `76.59 m AOD (Datum: 76.14m AOD)`.
   - **Trend & 24h Change:** `▲ +0.08 m in last 3h`.

---

### Category B: Engineered Spillways & Polder Storage Basins
*(Nodes: Hookbridge 52118, Baltmoor Wall 52158, Curry Moor Basin 52127, Northmoor Basin 52159)*

1. **Card Header:**
   - Plain-English asset title (e.g., *Hookbridge Spillway — River Tone to Curry Moor*).
   - Status Token Pill (`🔴 OVERSPILLING` / `🟢 SECURE`).

2. **Hero Metric Area:**
   - **Primary Display:** Dual comparison layout — **Live Elevation** (`7.62 m AOD`) vs **Crest Elevation** (`7.45 m Crest`).
   - **Clearance Delta Badge:** Prominent status badge (`▲ Overtopping by +0.17 m` or `▼ Clearance: 0.25 m below crest`).

3. **Secondary Subtext & Channel Depth:**
   - **Relative Channel Depth:** `Channel Depth: 2.12 m`.
   - **Continuous Spill Duration & Flow Rate:** `⏱️ Active for 04h 12m` | `🌊 Est. Flow: ~14.2 m³/s`.

---

## 4. Status Tokens & WCAG 2.1 AA Accessibility Specs

To ensure readability for color-blind users and high-contrast compliance (WCAG 2.1 AA $\ge 4.5:1$ contrast ratio):

$$\text{Status Token} = \text{Distinct Icon Symbol} + \text{High-Contrast Background/Text Color} + \text{Explicit Uppercase Label}$$

### Standardized Token Matrix

| Status State | Symbol | Light Mode Token (Hex) | Dark Mode Token (Hex) | Accessible Label |
| :--- | :---: | :--- | :--- | :--- |
| **NORMAL STAGE** | 🟢 | Text `#064E3B`, Bg `#D1FAE5`, Border `#A7F3D0` | Text `#6EE7B7`, Bg `#064E3B`, Border `#059669` | `🟢 NORMAL STAGE` |
| **ELEVATED STAGE** | 🟡 | Text `#451A03`, Bg `#FEF3C7`, Border `#FDE68A` | Text `#FDE68A`, Bg `#451A03`, Border `#B45309` | `🟡 ELEVATED STAGE` |
| **BANKFUL / ALERT** | ⚠️ | Text `#78350F`, Bg `#FEF3C7`, Border `#FDE68A` | Text `#FDE68A`, Bg `#78350F`, Border `#D97706` | `⚠️ ALERT (<30cm to Bank/Crest)` |
| **OVERSPILLING** | 🔴 | Text `#7F1D1D`, Bg `#FEE2E2`, Border `#FCA5A5` | Text `#FCA5A5`, Bg `#7F1D1D`, Border `#DC2626` | `🔴 OVERSPILLING` |
| **DIVERTING** | 🔵 | Text `#0C4A6E`, Bg `#E0F2FE`, Border `#BAE6FD` | Text `#BAE6FD`, Bg `#0C4A6E`, Border `#0284C7` | `🔵 DIVERTING (Parrett → Sowy)` |

---

## 5. Concrete Wireframe Mockups

### Wireframe 1: Upstream River Gauge Card (Greenham)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  RIVER TONE AT GREENHAM                     [ 🟢 NORMAL STAGE ]              │
│  Station ID: 52107                          Updated 6 mins ago               │
├──────────────────────────────────────────────────────────────────────────────┤
│  PRIMARY HERO METRIC:                                                        │
│  0.45 m  channel depth                      ▲ +0.02 m in 3h                  │
│  [========--------------------------------] Normal Range (0.20m – 1.10m)    │
├──────────────────────────────────────────────────────────────────────────────┤
│  SECONDARY METRICS & DATUM:                                                  │
│  Elevation: 76.59 m AOD   │  Stage Zero Datum: 76.14 m AOD                   │
│  Bankful Depth: 1.85 m    │  Clearance to Bank: 1.40 m                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe 2: Engineered Spillway Card (Hookbridge)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  HOOKBRIDGE SPILLWAY (RIVER TONE)           [ 🔴 OVERSPILLING ]              │
│  Tone River Overwash into Curry Moor        Updated 4 mins ago               │
├──────────────────────────────────────────────────────────────────────────────┤
│  PRIMARY HERO METRICS & CLEARANCE:                                           │
│  7.62 m AOD  /  7.45 m Crest                [ ▲ OVERTOPPING +0.17 m ]        │
│  [========================================||||||] Overtopping Crest          │
├──────────────────────────────────────────────────────────────────────────────┤
│  SECONDARY HYDROLOGICAL METRICS:                                             │
│  Channel Depth: 2.12 m depth   │  Est. Overwash Flow: ~14.2 m³/s            │
│  Spill Duration: 04h 12m       │  Target Moor Basin: Curry Moor (52127)      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe 3: Lowland Polder Storage Basin Card (Curry Moor)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CURRY MOOR STORAGE BASIN                   [ ⚠️ POLDER FILLING ]            │
│  Lowland Flood Storage (Capacity: 11.2M m³) Updated 10 mins ago              │
├──────────────────────────────────────────────────────────────────────────────┤
│  PRIMARY HERO METRICS & ELEVATION:                                           │
│  4.80 m AOD  (Moor Water Level)             [ 📊 64% Storage Volume ]        │
│  Ground Level: 2.10 m AOD                   Polder Depth: 2.70 m water depth│
│  [=============================-----------------] Max Capacity: 6.50 m AOD   │
├──────────────────────────────────────────────────────────────────────────────┤
│  PUMPING & DISCHARGE STATUS:                                                 │
│  Hookbridge Inflow: ACTIVE (~14.2 m³/s)                                      │
│  Athelney Pumping Outfall: IDLE (Tide Locked at River Tone)                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation & CSS Guidelines

```css
/* Hero Display Rules */
.metric-hero {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.metric-hero--depth {
  font-size: 2.25rem; /* 36px */
  font-weight: 800;
  color: #0F172A; /* Slate-900 */
}

.metric-unit-badge {
  font-size: 1.0rem;
  font-weight: 600;
  color: #475569; /* Slate-600 */
  padding: 0.2rem 0.5rem;
  background-color: #F1F5F9;
  border-radius: 0.375rem;
  margin-left: 0.5rem;
}

/* Secondary Elevation Subtext */
.elevation-subtext {
  font-size: 0.875rem; /* 14px */
  font-weight: 500;
  color: #64748B;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
```
