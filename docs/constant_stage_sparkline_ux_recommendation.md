# UX Design Specification: Constant / Flat Stage Hydrograph Sparkline Pattern

**Role:** UI/UX Design Specialist (`ui_ux_designer`)  
**Date:** September 20, 2026  
**Target Audience:** Somerset Levels & Moors Residents, Flood Wardens, & Full-Stack Developers  
**Reference Code:** `src/js/app.js` (`renderSingleSparkline`, `renderDualSparkline`)

---

## 1. Executive Summary & User Critique Analysis

### The User Critique
> *"There are two lines with a considerable separation. One of which is the max and the other the min. Both say 5cm. It looks bogus. Having 2 lines separated by a chunk of screen with the same number on them"*

### UX & Visualization Principle Violation
The user's critique points directly to a fundamental violation of cartographic and graphical integrity: **Spatial Monotonicity**. 

In any standard 2D Cartesian coordinate system:
1. **Vertical Distance Implies Numeric Value Delta:** Screen position along the Y-axis must monotonically map to numerical values. A vertical separation of 43px (~60px SVG canvas height) communicates to the human eye that the top position represents a higher value than the bottom position.
2. **Conflicting Signal:** Labeling both the top dashed boundary line and the bottom dashed boundary line with `0.05m` (5cm) creates an immediate visual contradiction. The interface visually claims that $y_{\text{top}} > y_{\text{bottom}}$ while simultaneously labeling $y_{\text{top}} = 0.05\text{m}$ and $y_{\text{bottom}} = 0.05\text{m}$.
3. **User Impact:** For non-technical residents relying on quick situational awareness, this "bogus" display undermines trust in the system's accuracy and creates confusion about whether water levels are changing or stationary.

---

## 2. Root Cause Analysis

In `src/js/app.js` (lines 987–1074), when river stage telemetry remains constant over 24 hours (e.g. `[0.05, 0.05, 0.05, 0.05]`):

1. `rawMin` and `rawMax` are both calculated as `0.05`.
2. `rawRange` evaluates to `0.00m` (`< 0.50m` `minSpan`).
3. The renderer centers the viewport around `midpoint = 0.05m`, setting `yMin = -0.20m` and `yMax = 0.30m`.
4. **The Bug:** When rendering the gridlines and Y-axis text labels, the component attaches `rawMax` (`0.05m`) to the top dashed gridline (`y = marginTop`) and `rawMin` (`0.05m`) to the bottom dashed gridline (`y = height - marginBottom`).

### Visual Anatomy of Current (Broken) State
```
┌────────────────────────────────────────────────────────────────────────────┐
│ Inland KSD (E9094)   Current: 0.05mAOD | Min: 0.05m | Max: 0.05m | Δ 0cm  │
├────────────────────────────────────────────────────────────────────────────┤
│ -------------------------------------------------------- [ Max 0.05m ] ❌  │ <-- Top dashed line (y = 16px)
│                                                                            │
│ ────────────────────────────────────────────────────────                  │ <-- Polyline at midpoint (y = 37.5px)
│                                                                            │
│ -------------------------------------------------------- [ Min 0.05m ] ❌  │ <-- Bottom dashed line (y = 59px)
└────────────────────────────────────────────────────────────────────────────┘
  Vertical gap = 43px, but BOTH labels claim to be 0.05m!
```

---

## 3. Recommended UI Solution & UX Pattern

When the active window telemetry variation is zero or negligible (`rawRange < 0.01m` / $1\text{ cm}$):

### Recommended Pattern: **Single Central Reference Line + Center Badge**

Instead of drawing two boundary lines with identical labels:
1. **Gridlines:** Collapse the top and bottom gridlines into a **single horizontal reference line** positioned at the exact vertical center (`y = marginTop + drawHeight / 2`).
2. **Y-Axis Labeling:** Render a single, clean central pill/label anchored right: `Steady 0.05m` or `0.05m (Steady)`.
3. **Polyline Rendering:** The telemetry polyline runs directly along this central reference line.
4. **Header Stats Bar:** Display `Min: 0.05m`, `Max: 0.05m`, and a neutral steady range pill `Δ 0cm (Steady)`.

### Alternative Pattern B (Hydrological Scale Bounds Context)
If top and bottom boundary lines are retained, they must be labeled with their **true viewport scale bounds** (`yMax` and `yMin` derived from `minSpan`), rather than `rawMax` and `rawMin`:
- Top line labeled: `0.30m` (Viewport Upper Bound)
- Bottom line labeled: `0.00m` or `-0.20m` (Viewport Lower Bound / Channel Bed)
- Center telemetry line annotated: `0.05m (Steady Stage)`

*Recommendation:* **Pattern A (Single Central Reference Line)** is strongly preferred for sparkline components as it dramatically improves scannability, reduces visual noise (high data-ink ratio), and clearly signals a stationary stage.

---

## 4. Detailed Visual Layout Specification

### Option A: Single Central Reference Line (Primary Recommendation)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Inland KSD (E9094)   Current: 0.05mAOD  Min: 0.05m  Max: 0.05m  [Δ 0cm]   │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ ── ── ── ── ── ───────────────●────────────────── ── ── [ Steady 0.05m ]   │ <-- Single Center Guide + Line (y = 37.5px)
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
  Clean 1-line display clearly communicates zero change / constant stage.
```

### Option B: Scaled Viewport Bounds (Alternative Context Pattern)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Inland KSD (E9094)   Current: 0.05mAOD  Min: 0.05m  Max: 0.05m  [Δ 0cm]   │
├────────────────────────────────────────────────────────────────────────────┤
│ - - - - - - - - - - - - - - - - - - - - - - - - - - - - [ Scale 0.30m ]   │ <-- True Viewport Max (yMax)
│                                                                            │
│ ──────────────────────────────●──────────────────────── [ Stage 0.05m ]   │ <-- Polyline & Center Tag
│                                                                            │
│ - - - - - - - - - - - - - - - - - - - - - - - - - - - - [ Bed 0.00m   ]   │ <-- True Viewport Min / Bed (yMin)
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Visual Design Tokens & Typography

| UI Element | CSS Class | Color / Style | Font & Size | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Center Reference Line** | `.sparkline-center-line` | `stroke="rgba(255, 255, 255, 0.25)"`, `stroke-dasharray="4,4"` | $1\text{px}$ width | Center axis guide for flat stage |
| **Steady Y-Axis Label** | `.sparkline-y-steady` | Fill `#38BDF8` or `#94A3B8` on dark background `#0F172A` | $10\text{px}$ bold tabular | Single right-anchored center label |
| **Stats Range Pill (Steady)**| `.pill-steady` | Text `#94A3B8`, Background `rgba(148, 163, 184, 0.15)`, Border `rgba(148, 163, 184, 0.3)` | $11\text{px}$ medium | Indicates $0\text{cm}$ variation in stats header |
| **Crosshair Hover Dot** | `.sparkline-dot-highlight` | Fill `#38BDF8`, Radius $4.5\text{px}$ | — | Interactive inspection dot |

---

## 6. Code Implementation Guide for `src/js/app.js`

### Implementation Logic in `renderSingleSparkline`

```javascript
// Determine if stage variation is constant/flat (< 1cm)
const isFlatStage = rawRange < 0.01;

// Grid & Y-Label rendering conditional branch:
let gridLinesHTML = '';
let yLabelsHTML = '';

if (isFlatStage) {
  const centerY = marginTop + drawHeight / 2;
  const steadyLabel = `Steady ${rawMax.toFixed(2)}m`;
  
  // Single central reference line
  gridLinesHTML = `
    <line x1="${marginLeft}" y1="${centerY}" x2="${width - marginRight + 5}" y2="${centerY}" 
          stroke="rgba(255, 255, 255, 0.25)" stroke-dasharray="3,3" stroke-width="1" />
  `;

  // Single central Y-axis label badge
  yLabelsHTML = `
    <g class="y-label-group" transform="translate(${width - 4}, ${centerY + 3})">
      <rect x="-64" y="-10" width="64" height="13" rx="2" fill="rgba(15, 23, 42, 0.85)" stroke="rgba(56, 189, 248, 0.3)" stroke-width="0.5" />
      <text x="-2" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-steady" fill="#38bdf8" font-weight="600">${steadyLabel}</text>
    </g>
  `;
} else {
  // Standard dual top & bottom boundary lines for variable stages
  const topLabel = `Max ${rawMax.toFixed(2)}m`;
  const botLabel = `Min ${rawMin.toFixed(2)}m`;

  gridLinesHTML = `
    <line x1="${marginLeft}" y1="${marginTop}" x2="${width - marginRight + 5}" y2="${marginTop}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
    <line x1="${marginLeft}" y1="${height - marginBottom}" x2="${width - marginRight + 5}" y2="${height - marginBottom}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
  `;

  yLabelsHTML = `
    <g class="y-label-group" transform="translate(${width - 4}, ${marginTop + 3})">
      <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
      <text x="0" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-max">${topLabel}</text>
    </g>
    <g class="y-label-group" transform="translate(${width - 4}, ${height - marginBottom + 3})">
      <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
      <text x="0" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-min">${botLabel}</text>
    </g>
  `;
}
```

### Stats Bar Header Rendering
```javascript
const spanText = isFlatStage ? 
  `${currentActiveRange.toUpperCase()} Range: Δ 0cm (Steady)` : 
  `${currentActiveRange.toUpperCase()} Range: ${formatSpanUnit(rawRange)}`;
```

---

## 7. Summary & Hand-off Checklist for Lead Engineer (`fullstack_developer`)

- [ ] Modify `renderSingleSparkline()` in `src/js/app.js` to detect `rawRange < 0.01` (`isFlatStage`).
- [ ] Modify `renderDualSparkline()` in `src/js/app.js` to check flat stage conditions for dual lines.
- [ ] Replace dual top/bottom grid lines and labels with a single central guide line and badge when `isFlatStage` is true.
- [ ] Update `.sparkline-span-pill` styling to support neutral steady state formatting.
- [ ] Add unit tests in `tests/mvp_v120.test.js` verifying that flat stage sparkline rendering produces a single `sparkline-y-steady` label without duplicate boundary labels.
