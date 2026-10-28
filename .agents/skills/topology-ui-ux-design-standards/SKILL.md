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

## 6. WCAG 2.1 AA Triple Encoding & Sizing

1. **Triple Encoding:** Never use color alone. Every status state MUST combine:
   $$\text{Status} = \text{Contrast Color} + \text{Geometric Shape/Icon} + \text{Verbal Uppercase Text}$$
   - Examples: `🔴 OVERSPILLING`, `🟢 SECURE`, `🔵 DIVERTING`, `⛔ TIDE-LOCKED`.
2. **Contrast Ratios:**
   - Normal text: $\ge 4.5:1$ against `#0f172a`.
   - Non-text graphical components (lines, rings, icons): $\ge 3:1$.
3. **Touch Targets:**
   - Minimum $44 \times 44\text{px}$ on all interactive buttons, filters, and SVG node hit proxies (`r=24` transparent circle).

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

## 8. Verification Command

Always verify all UI/UX rules before finishing:
```bash
node --test tests/topology_ui_ux_audit.test.js
```

