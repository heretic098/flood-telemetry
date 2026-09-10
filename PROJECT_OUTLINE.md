# UK Flood Telemetry Dashboard (floodtelemetry.uk)

## Project Overview
An open-source, human-friendly real-time telemetry dashboard for tracking water levels, clyse/sluice gate operation, and spillway overtopping states across the Somerset Levels and Moors (River Tone and Parrett catchments).

---

## 1. Team Roles & Subagent Roster

The development of this project relies on 7 specialized agents configured in `.agents/AGENTS.md`:

| Subagent Role | Primary Responsibilities |
| :--- | :--- |
| **`climate_hydrology_scientist`** | Validates spillway crest elevations (mAOD), stage-discharge math, Environment Agency (EA) station IDs, and plain-English hydrological notes. |
| **`ui_ux_designer`** | Crafts information hierarchy, intuitive card layouts, color-blind accessible status tokens, and clear visual summaries for non-technical users. |
| **`fullstack_developer`** | Builds the responsive web interface, CSS token design system, dynamic cards, and EA API fetch client. |
| **`security_engineer`** | Audits API interactions, sanitizes dynamic telemetry inputs, handles CORS, and enforces defensive coding practices. |
| **`code_reviewer`** | Ensures code quality, maintainability, modern standard compliance, and WCAG accessibility (a11y). |
| **`qa_test_engineer`** | Creates test suites, mocks EA API responses (including missing data/outliers), and verifies differential head calculations. |
| **`devops_engineer`** | Configures local development servers, build/bundling tools, and deployment pipelines (e.g. GitHub Pages). |

---

## 2. Open Data Ingestion Strategy

To ensure scientific accuracy and early warning capability, the application ingests data from four primary open data feeds:

1. **EA Real-time Flood Monitoring API (`flood-monitoring`):**
   * High-frequency (15-minute) live stage telemetry for river and moor gauges.
2. **EA Hydrology Data API (`hydrology`):**
   * Station datums (Ordnance Datum Newlyn, $m$ AOD), quality-checked flow telemetry ($m^3/s$), and stage-discharge rating curves.
3. **UKHO Admiralty / BODC Tide API & EA Estuary Telemetry:**
   * High tide predictions for Bridgwater Bay and Hinkley Point to compute **Tide-Locking Window Forecasts** at Dunball Clyse.
4. **Open-Meteo API (Forecast Rainfall & Soil Moisture):**
   * Hourly precipitation forecasts and multi-depth soil moisture levels ($0-7\text{cm}, 7-28\text{cm}$) to calculate antecedent saturation and runoff risk 24–48 hours ahead.

---

## 3. UI/UX Progressive Disclosure & Micro-copy Standards

To accommodate non-technical users during high-stress flood events while retaining full data access for technical operators, components are structured into 3 visual layers:

* **Layer 1 (Instant Glance):** High-level Moor Status Badge + Plain-English Summary + Primary 24-Hour System Sparkline.
* **Layer 2 (Infrastructure Context):** Sluice & Clyse status pills (`Monk's Leaze: 🟢 100% OPEN`), Pumping Station pills (`Currymoor PS: 🟢 2/2 RUNNING`, `Saltmoor PS: ⚪ STANDBY`), and explicit clearance margins (`SECURE (+1.8m Clearance)`).
* **Layer 3 (Collapsible Technical Drawer):** Click to reveal individual sub-station gauge time-series with synchronized inline 24-hour micro-sparklines (Knapp Bridge, Curry Moor Basin, Bishops Hull, Stanmoor).

### A. Accessibility & Color-Blind Safe Status Tokens
All badges combine **Color + Distinct Symbol/Icon + Text Label**:

| State | Color Palette (Hex) | Symbol | Badge Text |
| :--- | :--- | :--- | :--- |
| **DRY / SECURE** | Green (`#1b7837`) | `✓` Shield | **SECURE** |
| **NEAR CREST** | Amber (`#b85600`) | `▲` Warning Triangle | **NEAR CREST** |
| **FREE OVERTOPPING** | Crimson (`#d7191c`) | `▼` Wave Down | **OVERTOPPING** |
| **SUBMERGED (DROWNED)** | Deep Purple (`#5e3c99`) | `≈` Submerged Wave | **SUBMERGED** |
| **REVERSE SPILL** | Magenta (`#ae017e`) | `↺` Reverse Arrow | **REVERSE SPILL** |
| **CLOSED / PENNING** | Dark Slate (`#333333`) | `🔒` Lock | **CLOSED** |
| **OPEN / DIVERTING** | Blue (`#0571b0`) | `➔` Flow Arrow | **OPEN** |
| **TIDE-LOCKED** | Orange (`#e66101`) | `🕒` Clock | **TIDE-LOCKED** |

### B. Micro-copy & Naming Standards
* **Clearance Margins:** Never use vague single words like "STABLE". Always display explicit clearance metrics (e.g. `Baltmoor Wall: SECURE (+1.8m Clearance)` and `Water Trend: Steady (0 cm/hr)`).
* **Geographic Naming:** Avoid confusing jargon like "KSD". Use **"Sedgemoor Drain"** in cards (`Outfall: Sedgemoor Drain ➔ Parrett Estuary`) with hover tooltips displaying the full name: *"King's Sedgemoor Drain (KSD)"*.
* **Catchment Subtitles:** Every card header features a river tag (e.g. `Catchment: River Tone`, `Catchment: River Parrett`, `Diverts: Parrett ➔ Sedgemoor Drain`).

### C. Tailored 24-Hour Sparklines
* **Curry Moor & Northmoor:** Stage elevation trend ($m\text{AOD}$) with threshold lines.
* **Sowy Relief Channel:** Volumetric flow rate ($m^3/s$) showing active flood relief diversion.
* **Dunball Sea Outfall:** Dual-line stage overlay (dashed sea tide curve vs solid inland drain level) with shaded tide-lock window extending to the right edge (NOW).

---

## 4. Hydrological & Hydraulic Core Logic

### A. Refined Clyse & Sluice Gate Inference Matrix
Calculated using differential head $\Delta h = h_{\text{upstream}} - h_{\text{downstream}}$ and stage zero offsets in mAOD:

* **CLOSED / PENNING:** $\Delta h \ge 0.20\text{m}$ AND $h_{\text{upstream}} > Z_{\text{sill}}$ (Upstream stacked up).
* **OPEN / GRAVITY DISCHARGE:** $0.05\text{m} \le \Delta h < 0.20\text{m}$ AND $h_{\text{upstream}} > Z_{\text{sill}}$ AND active positive flow trend.
* **TIDE-LOCKED / FLAP CLOSED:** $\Delta h \le 0$ ($h_{\text{downstream}} \ge h_{\text{upstream}}$) at tidal outfalls (Dunball Clyse).
* **EQUILIBRIUM / SLACK WATER:** $|\Delta h| < 0.05\text{m}$ (Equalized levels with low flow).

### B. Spillway Hydraulic State Machine (Villemonte Submergence Model)
Given upstream river head $H_u = h_{\text{river}} - Z_{\text{crest}}$ and downstream tailwater head $H_d = h_{\text{moor}} - Z_{\text{crest}}$:

1. **DRY / SECURE:** $H_u < -0.15\text{m}$
2. **NEAR CREST:** $-0.15\text{m} \le H_u < 0\text{m}$
3. **FREE OVERTOPPING:** $H_u \ge 0\text{m}$ AND Submergence Ratio $S = H_d / H_u < 0.70$
4. **DROWNED / SUBMERGED:** $H_u \ge 0\text{m}$ AND Submergence Ratio $S = H_d / H_u \ge 0.70$ (Tailwater reduces spill efficiency).
5. **REVERSE OVERTOPPING:** $H_d > H_u \ge 0\text{m}$ (Water spills from flooded moor back into channel).

---

## 5. 3-Tier Dynamic Spillway Crest Elevation Architecture

To handle peat settlement, embankment erosion/scour, and periodic EA regrading without relying purely on static numbers:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Tier 1: Surveyed Baseline (hydro_config.json)                          │
 │ Initial baseline elevations (mAOD) from surveyed EA AIMS & LIDAR DEMs   │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ Fallback / Base
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Tier 2: Defra AIMS / WCS Data Sync                                     │
 │ Automated background sync querying official EA surveyed asset layers   │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ Refines Baseline
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Tier 3: Telemetry Hydro-Calibration Engine                             │
 │ Monitors twin gauges (river & moor). Detects onset of rate-of-rise     │
 │ dh_moor/dt > 0 to auto-estimate effective crest height Z_eff in real-time│
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Multi-Hazard Global Status Aggregating Engine

The top global status bar evaluates all 4 systems and calculates the **Worst-Case Hazard State** using a strict priority hierarchy:

1. **Global System Counter Pill:** `[ 🔴 2 Overtopping | 🟢 2 Secure ]`
2. **Dynamic Multi-Moor Text String:**
   - **If 1 Moor Flooding:** `ACTION REQUIRED: CURRY MOOR OVERTOPPING | DUNBALL TIDE-LOCKED`
   - **If 2+ Moors Flooding:** `CRITICAL: CURRY MOOR & NORTHMOOR BOTH OVERTOPPING | DUNBALL TIDE-LOCKED`
   - **If All Secure:** `SYSTEM SECURE — ALL 4 MOORS NORMAL | GRAVITY DISCHARGE ACTIVE`

---

## 7. Time Machine & Historical Replay UX

### Phase 1 (Initial Implementation): Scrubber & Datepicker
* **LIVE Stream Toggle:** Clicking the header `LIVE` pill toggles between live 15-minute telemetry polling and **Historical Replay Mode**.
* **Presets & Custom Datepicker:** Quick presets (`[ LIVE ]`, `[ 6h ]`, `[ 24h ]`, `[ 7 Days ]`, `[ 28 Days ]`) plus a custom calendar datepicker popover.
* **Timeline Scrubber:** Dragging the scrubber slider re-evaluates all 4 Moor Cards, Clyses, and Spillways to show the exact state at that past timestamp.
* **Synchronized Sparkline Pins:** A vertical indicator pin tracks across all 4 card sparklines simultaneously.
* **Historical Warning Banner:** Distinct Amber/Purple header banner (`⚠️ HISTORICAL REPLAY MODE — Viewing 14:00 GMT on 12 Jan 2024`) prevents user confusion between current weather and past flood events.

### Phase 2 Roadmap: Animated Replay Playback (`▶ / ❚❚`)
* **Animated Flood Event Replay:** A play/pause simulation controller (`▶ Play / ❚❚ Pause`, `1x / 2x / 5x speed`) allowing users to watch flood events propagate across the Somerset Levels (e.g. Curry Moor filling and spilling over 48 hours).

---

## 8. Infrastructure & Deployment Architecture (Fly.io + SQLite)

The system is deployed as a single lightweight Node.js container on **Fly.io** (`lhr` region) with an embedded **SQLite WAL** database for ultra-fast local caching (<2ms response times):

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Fly.io Container (somerset-flood-dashboard)                 │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Node.js Native HTTP & API Server (server.js on Port 8080)             │
│ 2. In-Process 5-Minute Telemetry Poller (Background Sync)               │
│ 3. Hydrological & Hydraulic Physics Engines                              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Microsecond Local WAL I/O
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Embedded SQLite Database (telemetry.db)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│ • SQLite WAL Mode (PRAGMA journal_mode=WAL;)                            │
│ • Caches 15-minute gauge stage telemetry (8 EA stations / 768 points)    │
│ • Serves single /api/status endpoint to client browsers in <2ms         │
└─────────────────────────────────────────────────────────────────────────┘
```

* **Live Production URL:** **[https://somerset-flood-dashboard.fly.dev](https://somerset-flood-dashboard.fly.dev)**
* **Cost:** $0.00/month (within Fly.io free hobby tier allowances).
* **Configuration:** 1 shared-cpu Machine with 512MB RAM (`min_machines_running = 0` to prevent duplicate EA polling).
* **Performance:** Sub-50ms total client dashboard render time, 100% resilient against temporary upstream EA API throttling or outage.
* **API Key Secrets:** **None required for core operations!** The Environment Agency Flood Monitoring API is an open public REST endpoint.

---

## 9. Directory Structure

```
/home/jonathan/Desktop/somerset-flood-dashboard/
├── .agents/
│   └── AGENTS.md                  # Team definitions & project rules
├── PROJECT_OUTLINE.md             # Master system design document
├── README.md                      # Quickstart guide
├── Dockerfile                     # Container build for Fly.io
├── fly.toml                       # Fly.io deployment & volume config
├── package.json                   # Dependencies & test scripts
├── src/
│   ├── index.html                 # Accessible dashboard interface
│   ├── css/
│   │   ├── tokens.css             # Color palette, spacing, WCAG accessibility tokens
│   │   └── styles.css             # Card layouts & responsive grid
│   └── js/
│       ├── config/
│       │   └── hydro_config.json  # Station IDs, baseline crests, and datums
│       ├── db/
│       │   └── schema.sql         # SQLite telemetry schema & index definitions
│       ├── api/
│       │   ├── ea_telemetry.js    # EA 15-min stage & hydrology API fetcher
│       │   ├── tide_api.js        # UKHO tide forecast & tide-locking window logic
│       │   └── weather_api.js     # Open-Meteo rainfall & soil moisture fetcher
│       ├── hydro_engine.js        # Villemonte spillway & differential head logic
│       └── app.js                 # UI renderer & progressive disclosure controller
└── tests/
    ├── hydro_engine.test.js       # Villemonte & gate inference unit tests
    └── api_mocks.js               # Mocked EA telemetry & offline error fallbacks
```
