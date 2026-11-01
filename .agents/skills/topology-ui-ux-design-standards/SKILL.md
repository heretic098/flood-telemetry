---
name: topology-ui-ux-design-standards
description: >-
  Enforces visual hierarchy, semantic color zones, dynamic threshold styling, spatial monotonicity, Cartesian label alignment, and WCAG 2.1 AA accessibility for flood telemetry and river network topology views. Use whenever creating or modifying UI components, SVG graphics, sparklines, cards, or inspector drawers.
---

# Topology UI/UX Visual & Accessibility Design Standards Skill

This skill provides the mandatory guidelines, visual rules, and heuristic invariants for designing and reviewing flood monitoring interfaces, SVG schematics, and sparkline charts for non-technical residents and parish flood wardens.

## 1. Strict Trichromatic Separation (Zero Semantic Collisions)

No color token may occupy more than one semantic zone:

$$\mathcal{C}_{\text{nominal}} \cap \mathcal{C}_{\text{alert}} = \emptyset, \quad \mathcal{C}_{\text{nominal}} \cap \mathcal{C}_{\text{overspill}} = \emptyset, \quad \mathcal{C}_{\text{alert}} \cap \mathcal{C}_{\text{overspill}} = \emptyset$$

* **Zone 1: Nominal, Active & Secure (Green, Cyan, Deep Blue):**
  - Baseflow, clearance $> 30\text{cm}$, open gravity discharge at sea outfalls, active diversions.
  - Colors: `#10b981`, `#38bdf8`, `#0284c7`, `#0c4a6e`.
  - *Rule:* Active low-tide sea discharge at Dunball MUST render in **Estuarine Deep Blue (`#0284c7`)**. It is strictly forbidden from using warning orange (`#fb923c`) or amber (`#f59e0b`).
* **Zone 2: Restricted, Pre-Warning & Slack (Amber, Orange, Slate):**
  - River within $30\text{cm}$ of crest, gate closure, tide-locked outfall flaps.
  - Colors: `#f59e0b`, `#fbbf24`, `#64748b`.
* **Zone 3: Overtopping & Critical Breach (Red):**
  - Stage $\ge$ crest elevation, active levee overtopping, emergency overflow.
  - Colors: `#ef4444`, `#7f1d1d`, `#dc2626`.

---

## 2. Dynamic Semantic Threshold Styling (Ban Panic Red on Safe Limits)

Threshold lines on hydrographs (e.g. spillway crests or alert levels) MUST dynamically adapt their stroke and badge colors to match real-time danger:
1. **Dormant / Safe Stage ($> 30\text{cm}$ below crest):**
   - Stroke: **Muted Neutral Slate (`#64748b`)** with dashed pattern `stroke-dasharray="4 3"`.
   - Badge: `rgba(30, 41, 59, 0.9)` background, `#94a3b8` text (`Crest X.XXm`).
   - *Rationale:* A concrete crest 3 metres above calm baseflow is not an emergency. Never style a safe limit in red.
2. **Pre-Warning Alert ($\le 30\text{cm}$ below crest):**
   - Stroke: **Alert Amber (`#f59e0b`)**.
   - Badge: `rgba(120, 53, 15, 0.9)` background, `#fde68a` text (`⚠️ Crest X.XXm`).
3. **Active Overtopping ($h \ge h_{\text{crest}}$):**
   - Stroke: **Emergency Red (`#ef4444`)**.
   - Badge: `rgba(127, 29, 29, 0.9)` background, `#fca5a5` text (`▲ Overtopping X.XXm`).

---

## 3. Spatial Monotonicity & Cartesian Label Alignment

1. **Non-Redundancy Rule:**
   $$\forall y_1 < y_2 \implies v(y_1) \ge v(y_2)$$
   Two separated gridlines ($\Delta y > 0$) must **NEVER** display identical numeric string labels.
2. **Flat-Line Hydrograph Reassurance:**
   When 24h stage variance $< 1\text{cm}$ or formatted min equals max:
   - Collapse dual top/bottom gridlines into a **single horizontal line** at vertical center ($y = \text{marginTop} + \text{drawHeight}/2$).
   - Render badge: `Steady X.XXm` at the center guide.
   - Header stat pill displays: `Δ 0cm (Steady)`.
   - The telemetry line sits directly on the center guide.
3. **Cartesian Truth (No Misaligned Labels):**
   - Axis labels MUST match the projected coordinate value at that exact line.
   - Never place a label reading `Max 4.47m` at the top of an axis that has been expanded to $7.55\text{m}$.
   - Ensure the plotted telemetry line physically touches `Max` and `Min` coordinates.

---

## 4. Adaptive Sparkline Scaling & Taxonomy Scoping

1. **Auto-Scale to Telemetry:**
   - Sparklines must auto-scale around the active 24h readings ($[\text{rawMin}, \text{rawMax}]$) so that real telemetry waves, tidal oscillations, and baseflow stability are visually readable.
   - Do NOT inflate the Y-axis by 300% to include a distant, dormant crest.
2. **Spillway Proximity Gate:**
   - Spillway crest lines only enter the sparkline viewport when the river is within active proximity ($0.80\text{m}$) of crest or actively overtopping.
   - Distance to crest is always prominently displayed in the hero banner (`2.95m below crest`) and clearance progress bar above the chart.
3. **Scope Crest Lines Strictly to Spillways:**
   - Polder storage basins (`52127`, `52159`) and river gauges (`52108`, `52109`, `52111`, etc.) do **NOT** display spillway crest lines on their 24h hydrographs.

---

## 5. Hero Metric by Asset Taxonomy

```
┌───────────────────────────────────────┬───────────────────────────────────────┐
│     TAXONOMY A: SPILLWAYS & BASINS    │    TAXONOMY B: IN-STREAM RIVER GAUGES │
│   (Hookbridge, Baltmoor, Curry Moor)  │   (Greenham, Bishops Hull, Taunton)   │
├───────────────────────────────────────┼───────────────────────────────────────┤
│ HERO: Absolute Elevation (mAOD)       │ HERO: Relative Channel Depth (m depth)│
│ "7.62 mAOD"                           │ "0.45 m depth"                        │
├───────────────────────────────────────┼───────────────────────────────────────┤
│ SECONDARY: Engineered Crest           │ SECONDARY: Surface Elevation Subtext  │
│ "Engineered Crest: 7.45mAOD"          │ "Surface Elevation: 76.59mAOD"        │
├───────────────────────────────────────┼───────────────────────────────────────┤
│ CLEARANCE BADGE: Delta to Crest       │ CLEARANCE BADGE: Datum / Alert Head   │
│ "▲ Overtopping by +0.17m over crest"  │ "Gauge Zero: 76.14mAOD" or            │
│ or "0.25m below crest"                │ "0.85m below alert"                   │
└───────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 6. Contrast & Readability: APCA & WCAG 2.1 AA Dual Standard

The platform enforces the **Accessible Perceptual Contrast Algorithm (APCA)** as its primary perceptual readability engine for dark mode, while maintaining **WCAG 2.1 AA** (4.5:1 text, 3:1 graphical) as the absolute statutory floor.

### 1. Why APCA Governs Our Dark-Mode Interface:
WCAG 2.1's mathematical ratio $(L_1 + 0.05)/(L_2 + 0.05)$ is symmetric and assumes black text on white paper. It fails on dark-mode monitors because:
- Human pupil dilation and spatial frequency make thin, light colored text (e.g. cyan `#38bdf8`) feel washed out and illegible against dark backgrounds (`#0f172a`), despite technically scoring 6.8:1 under WCAG 2.1.
- APCA models human visual cone response, rod halation, spatial frequency (font size and weight), and polarity (light text on dark background).

### 2. APCA Lightness Contrast ($L_c$) Thresholds:
For dark-mode backgrounds (`#0f172a`, `rgba(15, 23, 42, ...)`):
- **Small & Compact Text ($<14\text{px}$, or font weight $<500$):** Target APCA $|L_c| \ge 90$. Use high-luminance text such as `#f8fafc` or `#ffffff` ($L_c \approx 102$).
- **Interactive Controls & Buttons (e.g. Camera links, Filter pills, Navigation):** Target APCA $|L_c| \ge 75$. Text must use high-contrast foregrounds (`#f8fafc`, `#ffffff`), with solid backdrops (`#0f172a`) and prominent borders (`rgba(56, 189, 248, 0.6)`).
- **Secondary / Informational Text ($\ge 14\text{px}$ bold or $\ge 16\text{px}$ regular):** Minimum APCA $|L_c| \ge 60$.
- **Statutory Floor:** WCAG 2.1 AA contrast ratio MUST simultaneously exceed $\ge 4.5:1$ for all text and $\ge 3:1$ for graphical objects.

### 3. Triple Encoding Invariant:
Never use color alone. Every status state MUST combine:
$$\text{Status} = \text{Contrast Color} + \text{Geometric Shape/Icon} + \text{Verbal Uppercase Text}$$
- Examples: `🔴 OVERSPILLING`, `🟢 SECURE`, `🔵 DIVERTING`, `⛔ TIDE-LOCKED`.

### 4. Touch Targets:
- Minimum $44 \times 44\text{px}$ on all interactive buttons, filters, camera links, and SVG node hit proxies (`r=24` transparent circle).

---

## 7. Interactive Hydrograph Inspection & Timeline Scrubbing Invariant

Sparklines must NEVER be rendered as inert, dead SVG paths:
1. **Interactive DOM Scaffold:**
   - Sparkline SVG MUST be wrapped in `.sparkline-wrapper` with `tabindex="0"`, `role="region"`, and accessible scrubbing instructions in `aria-label`.
   - SVG element MUST serialize `data-points`, `data-timestamps`, `data-ymin`, `data-ymax`, and `data-unit`.
   - SVG MUST contain `.sparkline-crosshair` (dashed vertical guide), `.sparkline-dot-highlight` (primary reading indicator), `.sparkline-dot-halo` (outer halo), and a transparent hit overlay `.sparkline-touch-overlay` (`touch-action: none; cursor: crosshair`).
   - Wrapper MUST include a floating `.sparkline-tooltip` displaying exact timestamp (`18 Oct 21:45 GMT`) and stage reading.
2. **Synchronous Crosshairs & Event Binding:**
   - Any function rendering a sparkline (in Main Dashboard or Topology Drawer) MUST immediately bind scrubbing event listeners (`pointermove`, `touchmove`, `pointerleave`) and keyboard events (`ArrowLeft`, `ArrowRight`, `Home`, `End`, `Escape`).
3. **Sticky Inspector Timeout:**
   - On cursor/touch departure, active crosshairs MUST persist gracefully for $1.2\text{s}$ to $1.5\text{s}$ before auto-fading, avoiding flickering when users glance between graph and stats.

---

## 8. Cross-View Parity & Mandatory Headless Chrome Visual Inspection (`[UI-VIS-01]`)

Static source assertions cannot detect mismatched CSS selectors, unstyled pills, or overlapping SVG coordinates. Every UI/UX change MUST undergo live visual verification using Headless Chrome before sign-off:

1. **Single Source of Truth Across Views:**
   - The Main Dashboard (`index.html`) and Topology View (`topology.html`) must display 100% identical global header banners (`#alert-banner`) and counter pills (`#counter-pill`), driven by `aggregateGlobalStatus()` in `/api/status` and `src/js/hydro_engine.js`.
   - Station status badges and hydrograph colors in the Topology Inspector (`src/js/topology.js`) must match the Main Dashboard (`src/js/app.js`), including Estuarine Deep Blue (`#0284c7`) and `🕒 TIDE-LOCKED` (`badge-tide-locked` / `status-tide-locked`) for Dunball Tidal Outfall (`52163`).
2. **Headless Chrome Screenshot Capture & Visual Inspection Protocol (`npm run snapshot`):**
   Execute the pre-calibrated parallel snapshot script (`scripts/capture_views.js`), which automatically reuses `localhost:3000` (or spins up an ephemeral server if none is running) and renders both views concurrently at full unclipped heights (`1440x1850` for Dashboard, `1440x1250` for Topology):
   ```bash
   npm run snapshot
   # Or inspect a specific station in the Topology drawer:
   node scripts/capture_views.js --station=52163
   ```
   Then call `read_file` on `/tmp/flood-snapshots/dashboard_main.png` and `/tmp/flood-snapshots/topology_52163.png` and visually verify:
   - Global status banner and counter pill text/color match 100% across `index.html` and `topology.html`.
   - Hero stage metrics (`.stage-num`), status pills (`.status-pill`), and clearance pills render with proper typography and semantic borders.
   - On-canvas SVG infrastructure badges (`Hookbridge Spillway 7.45m`, `Athelney Spillway 7.35m (Cuts Rd)`, `Baltmoor Wall 7.80m`, `Monk's Leaze Clyse 4.20m`) do not collide with or obscure station node rings or labels.

---

## 9. Verification Command

Always verify all UI/UX rules via the automated test suite AND Headless Chrome screenshot inspection before finishing:
```bash
node --test tests/topology_ui_ux_audit.test.js
```

