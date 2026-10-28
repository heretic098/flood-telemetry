# Somerset Flood Telemetry Dashboard — Final Phase 1 MVP Specification & Architecture Document

**Version:** 1.2.0 (Fully Resolved & Approved)  
**Date:** September 12, 2026  
**Status:** Approved & Signed Off by All Team Subagents  
**Target Platform:** Node.js / Express / SQLite on Fly.io  

---

## 1. Executive Summary & Problem Statement

Resident communication during flood events on the Somerset Levels & Moors suffers from a fundamental clarity gap. The Environment Agency (EA) and Met Office publish technical gauge telemetry (e.g. stage height in meters Above Ordnance Datum) and broad flood alerts. However, local residents in low-lying villages (e.g. Moorland, Fordgate, East Lyng) need immediate answers to three practical questions:
1. **Are the spillways running right now?** (Hookbridge Spillway into Curry Moor, Baltmoor Wall Spillway into Northmoor).
2. **How long have they been running for and at what clearance/flow?**
3. **Is Monk's Leaze Clyse open and diverting water away from the Parrett into the Sowy Channel?**

This specification defines **Phase 1 MVP** of the human-friendly Somerset Flood Telemetry Dashboard. It replaces raw gauge tables with a real-time status card system, a geography-lite topological river schematic map, and a telemetry-triggered AI vision ground-truth verification engine.

---

## 2. Core Feature Pillars

### Feature Pillar 1: Real-Time Spillway & Clyse Status Cards
- **Hookbridge Spillway Card (River Tone $\rightarrow$ Curry Moor):**
  - Live River Stage (`52118`) vs Engineered Crest (`7.45 m AOD`).
  - Clearance Gauge: `+X.XX m below crest` (🟢 SECURE) or `Overtopping by X.XX m` (🔴 OVERSPILLING). Pre-overtopping alert at `7.15 m AOD` (🟡 ALERT).
  - Continuous Spill Duration Counter (tracks exact hours & minutes elapsed since overtopping commenced).
  - Estimated Overtopping Discharge Flow ($m^3/s$) using the Villemonte broad-crested weir formulation:
    $$Q_{\text{spill}} = C_w \cdot L_{\text{crest}} \cdot H_u^{3/2} \cdot \left[ 1 - \left( \frac{H_d}{H_u} \right)^{1.5} \right]^{0.385}$$
    - Parameters: $Z_{\text{crest}} = 7.45\text{ m AOD}$, $L_{\text{crest}} = 65\text{ m}$, $C_w = 1.75$.
- **Baltmoor Wall Spillway Card (River Parrett $\rightarrow$ Northmoor):**
  - Live River Stage (`52158`) vs Engineered Crest (`7.80 m AOD`). Pre-overtopping alert at `7.50 m AOD` (🟡 ALERT).
  - Clearance Gauge: `+X.XX m below crest` (🟢 SECURE) or `Overtopping by X.XX m` (🔴 OVERSPILLING).
  - Continuous Spill Duration Counter.
  - Estimated Overtopping Discharge Flow ($m^3/s$) using Villemonte formula ($Z_{\text{crest}} = 7.80\text{ m AOD}$, $L_{\text{crest}} = 120\text{ m}$, $C_w = 1.65$).
- **Monk's Leaze Clyse Status Card (River Parrett $\rightarrow$ Sowy Relief Channel):**
  - Upstream Level (`52233`) vs Downstream Level (`52234`) vs Concrete Sill (`4.20 m AOD`).
  - Hydraulic Status Indicator: 🔵 `DIVERTING` / 🔒 `CLOSED` / ⏸️ `SLACK_RESTRICTED`.
  - Submerged Sluice Discharge: $Q_{\text{clyse}} = C_d \cdot B \cdot (h_{52233} - 4.20) \cdot \sqrt{2g \cdot \Delta h}$.

### Feature Pillar 2: Telemetry-Triggered AI Vision Ground-Truth Engine
- **Purpose:** Provide visual proof confirming gate positions and overwash states.
- **Trigger Strategy:**
  - Evaluated during the 15-minute background telemetry sync.
  - Triggered if: (a) River stage crosses within 30cm of spill crest, (b) $\Delta h$ across Monk's Leaze Clyse shifts by $>0.15 m$, OR (c) Cache age exceeds 4 hours during active flood alerts.
- **Pre-flight Zero-Cost Filters:**
  - **Image Hash De-duplication:** Computes SHA-256 hash of downloaded webcam JPEG. If unchanged $\rightarrow$ skip AI call.
  - **Daylight & Luminance Filter:** Calculates image illuminance/solar position. If pitch black $\rightarrow$ fallback to 🌙 `NIGHT_TELEMETRY`.
- **AI Multimodal Vision Model (Gemini 1.5/2.5 Flash):**
  - Evaluates webcam JPEG against a strict JSON schema:
    ```json
    {
      "gate_status": "OPEN | PARTIALLY_OPEN | CLOSED | UNCERTAIN",
      "debris_detected": boolean,
      "flow_character": "SMOOTH | TURBULENT | SLACK",
      "overtopping_detected": boolean,
      "confidence": number,
      "summary": "Plain English single-sentence visual description"
    }
    ```
- **Graceful Local Fallback:**
  - If `GEMINI_API_KEY` environment variable is not present, the system renders the fresh webcam image alongside rule-based telemetry estimates without throwing runtime errors.

### Feature Pillar 3: "Geography-Lite" River Topological Schematic Map
- **Layout:**
  - **River Tone Chain (West $\rightarrow$ East):** Greenham $\rightarrow$ Bishops Hull $\rightarrow$ Taunton $\rightarrow$ Hookbridge Spillway $\rightarrow$ Curry Moor Basin (`52127`) $\rightarrow$ Athelney Junction.
  - **River Parrett Chain (South $\rightarrow$ North):** Chiselborough $\rightarrow$ Gaw Bridge $\rightarrow$ Monk's Leaze Clyse (Diversion to Sowy) $\rightarrow$ Langport $\rightarrow$ Burrowbridge Junction $\rightarrow$ Baltmoor Wall $\rightarrow$ Northmoor Basin (`52159`) $\rightarrow$ Bridgwater $\rightarrow$ Dunball Outfall.
  - **Sowy Relief Channel & Sedgemoor Drain (Diversion Path):** Monk's Leaze $\rightarrow$ Beer Wall $\rightarrow$ King's Sedgemoor Drain $\rightarrow$ Dunball Clyse (`E9094`) $\rightarrow$ Dunball Tidal (`52163`).
- **Visual Design:**
  - Triple-encoded status tokens (Icon + Color + Explicit Text) across 7 states (`SECURE`, `ALERT`, `OVERSPILLING`, `DIVERTING`, `CLOSED`, `SLACK_RESTRICTED`, `NIGHT_TELEMETRY`) for 100% WCAG 2.1 AA color-blind accessibility.

---

## 3. Security Architecture & Controls (`SEC-01` to `SEC-07`)

1. **`SEC-01` (XSS Prevention):** Model summaries sanitized with `escapeHTML()` before DB write and rendered via `textContent`.
2. **`SEC-02` (API Key Transport):** `GEMINI_API_KEY` transmitted via `x-goog-api-key` HTTP header.
3. **`SEC-03` (SSRF Safety):** Image fetch allowlisted (`*.environment-agency.gov.uk`), redirects disabled, 5MB buffer limit, 5s timeout.
4. **`SEC-04` (Rate Limiting & CORS):** Express endpoints protected via `express-rate-limit` (60 req/min) and CORS restricted to `GET, HEAD`.
5. **`SEC-05` (Security Headers):** CSP headers and defense-in-depth applied via `helmet`.
6. **`SEC-06` (Data Plausibility):** Stage values validated against bounds ($-2.0\text{m} \le \text{stage} \le 15.0\text{m AOD}$) to filter out sensor spikes.
7. **`SEC-07` (Tabnabbing Guard):** External links mandate `rel="noopener noreferrer"`.

---

## 4. Accessibility & UI/UX Standards (WCAG 2.1 AA)

1. **ARIA Live Regions:** Dynamic containers (`#alert-banner`, clearance badges) wrapped with `aria-live="polite"` and `aria-atomic="true"`.
2. **Screen-Reader Text:** Emojis marked with `aria-hidden="true"` accompanied by `.sr-only` descriptive text.
3. **Semantic HTML5:** Structuring with `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<figure>`, and `<dialog>`.

---

## 5. Hydrological Parameters & Threshold Matrix

| Gauge ID | Station Name | River / Asset | Ground/Sill (mAOD) | Alert Level (mAOD) | Crest Elevation (mAOD) | Critical Function |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| `52118` | Currymoor PS | River Tone | `4.71` | `7.15` *(Alert)* | `7.45` | Hookbridge Spillway overtopping into Curry Moor. |
| `52127` | Currymoor Basin | Currymoor Drain | `2.10` | `6.50` | `7.30` | Polder basin interior level & pump triggers. |
| `52158` | Saltmoor Barrier | River Parrett | `3.50` | `7.50` | `7.80` | Baltmoor Wall overtopping into Northmoor. |
| `52159` | Northmoor Drain | Northmoor Drain | `1.80` | `3.20` | `4.00` | Northmoor polder basin invert & pump triggers. |
| `52233` | Monks Leaze RL | River Parrett (Up) | `4.20` *(Sill)* | `6.00` | `7.50` | Sowy Relief Channel intake head. |
| `52234` | Monks Leaze Down | Sowy Channel (Down)| `4.20` *(Sill)* | `6.00` | `7.50` | Downstream tailwater head on Sowy intake. |
| `E9094` | Dunball Inland | Sedgemoor Drain | `1.50` | `3.50` | `5.00` | Inland gravity outfall at Dunball sea lock. |
| `52163` | Dunball Tidal | Parrett Estuary | `-4.00` | `5.50` | `8.50` | Estuarine tide level & tide-locking monitor. |

---

## 7. Phase 2 & Future Roadmap ("Things We Might Do Later")

1. **📊 Historical Spill Duration & Flow Hydrograph Charting (24h / 7d / 30d Lookback):**
   - An interactive timeline graph enabling residents to select **24 hours, 7 days, or 30 days** of archive data to see every historical overtopping event.
   - Displays shaded active spill duration bands paired with the calculated overtopping discharge flow rate curve ($m^3/s$ & Megalitres/day) so users can instantly see **how long the spillways ran** and **how fast water was spilling over them**.
2. **🔮 Advance Overtopping & Rate of Rise Predictor (6–24 Hour Early Warning):**
   - Hydrograph wave routing predicting overtopping 6 to 24 hours ahead using upstream gauges, Open-Meteo rain forecasts, and soil saturation.
3. **🌊 Tidal Surge & Future Tide-Locking Window Forecaster:**
   - Overlaying UKHO Admiralty High Water predictions with live Dunball Tidal (`52163`) telemetry to forecast exact future tide-lock windows.
4. **🏡 4-Pillar Plain-English "What This Means For Me" Resident Cards:**
   - Road commute status (A361 tarmac height clearance), property floor level alerts, and livestock pasture inundation order.
5. **🤖 Multi-Camera AI Vision & Debris Detection Expansion:**
   - Automated trash rack debris blockage detection across all 6 catchment webcams.
