/**
 * Somerset Flood Telemetry Platform - Sparkline Geometry & Scrubbing Module
 *
 * Implements shared mathematical coordinate projection, adaptive scale bounding,
 * flat-line baseline collapsing (UI-DAT-01), dynamic semantic crest styling (UI-COL-03),
 * Cartesian alignment (UI-DAT-02), and interactive timeline scrubbing with WCAG AA
 * accessibility support (UI-INT-01).
 *
 * Single Source of Truth for sparkline geometry across Main Dashboard and Topology Inspector.
 */

import { escapeHTML, escapeAttr, formatRelativeAge, formatSpanUnit } from './modules/dom_utils.js';
import { PRECIPITATION_PALETTE, classifyRainfallIntensity } from './hydro_engine.js';
export { escapeHTML, escapeAttr, formatRelativeAge, formatSpanUnit, PRECIPITATION_PALETTE };

/**
 * Normalizes input telemetry points into numerical values and ISO timestamps.
 * Accepts arrays of numbers or objects ({ value, time | isoTime | dateTime }).
 *
 * @param {Array<number|Object>} pointsInput
 * @returns {{ values: number[], timestamps: string[], count: number, latestVal: number|null }}
 */
export function normalizePoints(pointsInput) {
  if (!Array.isArray(pointsInput) || pointsInput.length === 0) {
    return { values: [], timestamps: [], count: 0, latestVal: null };
  }
  const values = [];
  const timestamps = [];
  for (let i = 0; i < pointsInput.length; i++) {
    const item = pointsInput[i];
    if (typeof item === 'number') {
      if (!isNaN(item)) {
        values.push(item);
        timestamps.push('');
      }
    } else if (item && typeof item === 'object') {
      if (typeof item.value === 'number' && !isNaN(item.value)) {
        values.push(item.value);
        timestamps.push(item.time || item.isoTime || item.dateTime || '');
      }
    }
  }
  const latestVal = values.length > 0 ? values[values.length - 1] : null;
  return { values, timestamps, count: values.length, latestVal };
}

/**
 * Computes min/max bounds, vertical scaling span, and crest relevance.
 * Auto-scales tightly around active 24h readings so water movements are clearly visible (UI-DAT-02).
 * Expands frame to include engineered crest only when water rises within 80cm of crest or is overtopping.
 *
 * @param {number[]} values
 * @param {Object} [options={}]
 * @param {number} [options.minSpan] - Minimum scale window (e.g. 0.50m for station cards, 1.0m for dual sparklines)
 * @param {number|null} [options.crestHeight] - Engineered crest elevation in mAOD (spillways only)
 * @param {number} [options.spanPadding] - Padding to expand small ranges (e.g. 0.20m span for inspector)
 * @returns {{
 *   rawMin: number,
 *   rawMax: number,
 *   rawRange: number,
 *   latestVal: number,
 *   yMin: number,
 *   yMax: number,
 *   effectiveRange: number,
 *   isCrestRelevant: boolean
 * }}
 */
export function computeSparklineBounds(values, options = {}) {
  if (!values || values.length === 0) {
    return {
      rawMin: 0,
      rawMax: 1,
      rawRange: 1,
      latestVal: 0,
      yMin: 0,
      yMax: 1,
      effectiveRange: 1,
      isCrestRelevant: false
    };
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin;
  const latestVal = values[values.length - 1];

  let yMin = rawMin;
  let yMax = rawMax;
  let isCrestRelevant = false;

  const crestHeight = typeof options.crestHeight === 'number' && !isNaN(options.crestHeight)
    ? options.crestHeight
    : null;

  // Crest scaling rule: if within 80cm of crest or active overtopping, expand frame to include crest
  if (crestHeight !== null && (latestVal >= crestHeight - 0.80 || rawMax >= crestHeight - 0.80)) {
    isCrestRelevant = true;
    yMax = Math.max(rawMax, crestHeight + 0.05);
    yMin = Math.min(rawMin, crestHeight - 0.80);
  } else if (options.minSpan !== undefined && options.minSpan > 0) {
    if (rawRange < options.minSpan) {
      const midpoint = (rawMin + rawMax) / 2;
      yMin = midpoint - (options.minSpan / 2);
      yMax = midpoint + (options.minSpan / 2);
    }
  } else if (options.spanPadding !== undefined && options.spanPadding > 0) {
    if (rawRange < options.spanPadding) {
      const midpoint = (rawMin + rawMax) / 2;
      yMin = midpoint - (options.spanPadding / 2);
      yMax = midpoint + (options.spanPadding / 2);
    }
  }

  const effectiveRange = (yMax - yMin) || 1;

  return {
    rawMin,
    rawMax,
    rawRange,
    latestVal,
    yMin,
    yMax,
    effectiveRange,
    isCrestRelevant
  };
}

/**
 * Detects flat stage conditions (range < 1cm or identical formatted labels)
 * to enforce [UI-DAT-01] Spatial Monotonicity.
 *
 * @param {number} rawMin
 * @param {number} rawMax
 * @param {number} rawRange
 * @returns {{ isFlatStage: boolean, topLabel: string, botLabel: string }}
 */
export function checkFlatStage(rawMin, rawMax, rawRange) {
  const topLabel = `Max ${rawMax.toFixed(2)}m`;
  const botLabel = `Min ${rawMin.toFixed(2)}m`;
  const isFlatStage = rawRange < 0.01 || topLabel === botLabel;
  return { isFlatStage, topLabel, botLabel };
}

/**
 * Returns dimensions configuration with margins and computed drawing box.
 *
 * @param {Object} [custom={}]
 * @returns {{
 *   width: number,
 *   height: number,
 *   marginTop: number,
 *   marginBottom: number,
 *   marginLeft: number,
 *   marginRight: number,
 *   drawWidth: number,
 *   drawHeight: number
 * }}
 */
export function getSparklineDimensions(custom = {}) {
  const width = custom.width || 300;
  const height = custom.height || 75;
  const marginTop = custom.marginTop !== undefined ? custom.marginTop : 16;
  const marginBottom = custom.marginBottom !== undefined ? custom.marginBottom : 16;
  const marginLeft = custom.marginLeft !== undefined ? custom.marginLeft : 8;
  const marginRight = custom.marginRight !== undefined ? custom.marginRight : 68;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;

  return {
    width,
    height,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    drawWidth,
    drawHeight
  };
}

/**
 * Projects a sequence of telemetry values into SVG 2D coordinates.
 *
 * @param {number[]} values
 * @param {{ yMin: number, effectiveRange: number }} bounds
 * @param {{ width: number, height: number, marginTop: number, marginBottom: number, marginLeft: number, drawWidth: number, drawHeight: number }} dimensions
 * @returns {Array<{ x: number, y: number, value: number }>}
 */
export function projectCoordinates(values, bounds, dimensions) {
  if (!values || values.length === 0) return [];
  const len = Math.max(1, values.length - 1);
  return values.map((val, idx) => {
    const x = dimensions.marginLeft + (idx / len) * dimensions.drawWidth;
    const normalizedY = (val - bounds.yMin) / bounds.effectiveRange;
    const y = dimensions.height - dimensions.marginBottom - (normalizedY * dimensions.drawHeight);
    return { x, y, value: val };
  });
}

/**
 * Builds SVG polyline points string ("x1,y1 x2,y2 ...").
 *
 * @param {Array<{ x: number, y: number }>} projectedCoords
 * @returns {string}
 */
export function buildSvgPoints(projectedCoords) {
  return projectedCoords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/**
 * Builds SVG path definition ("M x1,y1 L x2,y2 ...").
 *
 * @param {Array<{ x: number, y: number }>} projectedCoords
 * @returns {string}
 */
export function buildSvgPath(projectedCoords) {
  if (!projectedCoords || projectedCoords.length === 0) return '';
  return 'M ' + projectedCoords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/**
 * Calculates projected Y coordinate for a given value.
 *
 * @param {number} value
 * @param {{ yMin: number, effectiveRange: number }} bounds
 * @param {{ height: number, marginBottom: number, drawHeight: number }} dimensions
 * @returns {number}
 */
export function calculatePointY(value, bounds, dimensions) {
  const normalizedY = (value - bounds.yMin) / bounds.effectiveRange;
  return dimensions.height - dimensions.marginBottom - (normalizedY * dimensions.drawHeight);
}

/**
 * Identifies tide-locked intervals where sea stage >= inland stage.
 *
 * @param {number[]} seaValues
 * @param {number[]} inlandValues
 * @returns {Array<{ start: number, end: number }>}
 */
export function computeTideLockIntervals(seaValues, inlandValues) {
  const intervals = [];
  let inLock = false;
  let startIdx = 0;
  const len = Math.min(seaValues.length, inlandValues.length);
  for (let i = 0; i < len; i++) {
    const isLocked = seaValues[i] >= inlandValues[i];
    if (isLocked && !inLock) {
      inLock = true;
      startIdx = i;
    } else if (!isLocked && inLock) {
      inLock = false;
      intervals.push({ start: startIdx, end: i - 1 });
    }
  }
  if (inLock) {
    intervals.push({ start: startIdx, end: len - 1 });
  }
  return intervals;
}

/**
 * Evaluates dynamic threshold semantic styling for crest elevation lines.
 * Strictly enforces [UI-COL-03]:
 * - Clearance > 30cm: Muted Neutral Slate (#64748b)
 * - Clearance <= 30cm: Warning Amber (#f59e0b)
 * - Overtopping (stage >= crest): Emergency Red (#ef4444)
 *
 * @param {number} stage - Current or latest water stage in mAOD
 * @param {number} crestHeight - Engineered crest elevation in mAOD
 * @returns {{
 *   crestStroke: string,
 *   crestFill: string,
 *   crestText: string,
 *   crestLabelText: string,
 *   clearance: number
 * }}
 */
export function evaluateCrestVisuals(stage, crestHeight) {
  const clearance = crestHeight - stage;

  let crestStroke = '#64748b'; // Muted Slate (Zone 2 - Dormant / Nominal)
  let crestFill = 'rgba(30, 41, 59, 0.9)';
  let crestText = '#94a3b8';
  let crestLabelText = `Crest ${crestHeight.toFixed(2)}m`;

  if (stage >= crestHeight) {
    crestStroke = '#ef4444'; // Zone 3 - Emergency Overtopping
    crestFill = 'rgba(127, 29, 29, 0.9)';
    crestText = '#fca5a5';
    crestLabelText = `▲ Overtopping ${crestHeight.toFixed(2)}m`;
  } else if (stage >= crestHeight - 0.30) {
    crestStroke = '#f59e0b'; // Zone 2 - Pre-warning Alert (<30cm)
    crestFill = 'rgba(120, 53, 15, 0.9)';
    crestText = '#fde68a';
    crestLabelText = `⚠️ Crest ${crestHeight.toFixed(2)}m`;
  }

  return {
    crestStroke,
    crestFill,
    crestText,
    crestLabelText,
    clearance
  };
}

/**
 * Formats ISO timestamp string into human-friendly dates and times.
 *
 * @param {string|Date} rawTime
 * @returns {{
 *   dateStr: string,
 *   timeStr: string,
 *   fullGmt: string,
 *   dateFormatted: string,
 *   isValid: boolean,
 *   timeObj: Date|null
 * }}
 */
export function formatTimestampTooltip(rawTime) {
  const timeObj = rawTime ? new Date(rawTime) : null;
  const isValid = !!(timeObj && !isNaN(timeObj.getTime()));

  if (!isValid) {
    return {
      dateStr: '',
      timeStr: '',
      fullGmt: '',
      dateFormatted: '',
      isValid: false,
      timeObj: null
    };
  }

  const timeStr = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = `${timeObj.getDate()} ${timeObj.toLocaleString('en-US', { month: 'short' })}`;
  const dateFormatted = timeObj.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const fullGmt = `${dateStr} ${timeStr} GMT`;

  return {
    dateStr,
    timeStr,
    fullGmt,
    dateFormatted,
    isValid: true,
    timeObj
  };
}

/**
 * Calculates scrub ratio [0, 1] from a pointer or touch event relative to the sparkline drawing width.
 *
 * @param {PointerEvent|TouchEvent|MouseEvent} e
 * @param {SVGElement} svg
 * @param {{ width: number, marginLeft: number, marginRight: number }} dimensions
 * @returns {number}
 */
export function calculateRatioFromEvent(e, svg, dimensions) {
  if (!svg) return 0;
  const rect = svg.getBoundingClientRect();
  const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
  const xPx = clientX - rect.left;
  const widthPx = rect.width;

  const marginLeftPx = (dimensions.marginLeft / dimensions.width) * widthPx;
  const marginRightPx = (dimensions.marginRight / dimensions.width) * widthPx;
  const drawWidthPx = widthPx - marginLeftPx - marginRightPx;

  const relX = xPx - marginLeftPx;
  return Math.max(0, Math.min(1, relX / drawWidthPx));
}

/**
 * Calculates array index corresponding to a scrub ratio [0, 1].
 *
 * @param {number} ratio
 * @param {number} totalPoints
 * @returns {number}
 */
export function calculateSparklineScrubIndex(ratio, totalPoints) {
  if (totalPoints <= 1) return 0;
  return Math.min(totalPoints - 1, Math.max(0, Math.round(ratio * (totalPoints - 1))));
}

/**
 * Generates horizontal dashed gridline SVG markup.
 * Collapses to a single central line when isFlatStage is true (UI-DAT-01).
 *
 * @param {{ width: number, height: number, marginTop: number, marginBottom: number, marginLeft: number, marginRight: number, drawHeight: number }} dimensions
 * @param {boolean} isFlatStage
 * @returns {string}
 */
export function renderGridLines(dimensions, isFlatStage) {
  const centerY = dimensions.marginTop + dimensions.drawHeight / 2;
  const x2 = dimensions.width - dimensions.marginRight + 5;

  if (isFlatStage) {
    return `<line x1="${dimensions.marginLeft}" y1="${centerY}" x2="${x2}" y2="${centerY}" stroke="rgba(255, 255, 255, 0.25)" stroke-dasharray="3,3" stroke-width="1" />`;
  }
  return `
    <line x1="${dimensions.marginLeft}" y1="${dimensions.marginTop}" x2="${x2}" y2="${dimensions.marginTop}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
    <line x1="${dimensions.marginLeft}" y1="${dimensions.height - dimensions.marginBottom}" x2="${x2}" y2="${dimensions.height - dimensions.marginBottom}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
  `;
}

/**
 * Generates Y-axis label SVG markup.
 * Collapses to single Steady X.XXm badge when isFlatStage is true (UI-DAT-01).
 *
 * @param {{ width: number, height: number, marginTop: number, marginBottom: number, drawHeight: number }} dimensions
 * @param {{ rawMin: number, rawMax: number }} bounds
 * @param {boolean} isFlatStage
 * @param {Object} [options={}]
 * @param {string} [options.topDisplayLabel]
 * @returns {string}
 */
export function renderYAxisLabels(dimensions, bounds, isFlatStage, options = {}) {
  const centerY = dimensions.marginTop + dimensions.drawHeight / 2;
  const topDisplayLabel = options.topDisplayLabel || `Max ${bounds.rawMax.toFixed(2)}m`;
  const botLabel = `Min ${bounds.rawMin.toFixed(2)}m`;

  if (isFlatStage) {
    return `
      <g class="y-label-group" transform="translate(${dimensions.width - 4}, ${centerY + 3})">
        <rect x="-64" y="-10" width="64" height="13" rx="2" fill="rgba(15, 23, 42, 0.85)" stroke="rgba(56, 189, 248, 0.3)" stroke-width="0.5" />
        <text x="-2" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-steady" fill="#38bdf8" font-weight="600">Steady ${bounds.rawMax.toFixed(2)}m</text>
      </g>
    `;
  }

  return `
    <g class="y-label-group" transform="translate(${dimensions.width - 4}, ${dimensions.marginTop + 3})">
      <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
      <text x="0" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-max">${topDisplayLabel}</text>
    </g>
    <g class="y-label-group" transform="translate(${dimensions.width - 4}, ${dimensions.height - dimensions.marginBottom + 3})">
      <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
      <text x="0" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-min">${botLabel}</text>
    </g>
  `;
}

/**
 * Generates dynamic crest threshold line and badge markup (UI-COL-03).
 *
 * @param {{ width: number, height: number, marginTop: number, marginBottom: number, marginLeft: number, marginRight: number, drawHeight: number }} dimensions
 * @param {{ yMin: number, effectiveRange: number }} bounds
 * @param {number} crestHeight
 * @param {number} latestVal
 * @returns {string}
 */
export function renderCrestGuide(dimensions, bounds, crestHeight, latestVal) {
  const crestY = calculatePointY(crestHeight, bounds, dimensions);
  const visuals = evaluateCrestVisuals(latestVal, crestHeight);
  const x2 = dimensions.width - dimensions.marginRight + 5;

  return `
    <line x1="${dimensions.marginLeft}" y1="${crestY.toFixed(1)}" x2="${x2}" y2="${crestY.toFixed(1)}" stroke="${visuals.crestStroke}" stroke-width="1.2" stroke-dasharray="4 3" />
    <g transform="translate(${dimensions.width - 4}, ${crestY.toFixed(1)})">
      <rect x="-68" y="-9" width="68" height="13" rx="2" fill="${visuals.crestFill}" stroke="${visuals.crestStroke}" stroke-width="0.5" />
      <text x="-4" y="1" text-anchor="end" fill="${visuals.crestText}" font-size="9" font-weight="700" font-family="monospace">${visuals.crestLabelText}</text>
    </g>
  `;
}

/** Updates primary (and optional secondary) crosshair SVG attributes at target coordinates. */
function updateCrosshairSvgElements(svg, targetX, targetY, secTargetY = null) {
  const xStr = targetX.toFixed(1);
  const yStr = targetY.toFixed(1);
  const crosshairLine = svg.querySelector('.sparkline-crosshair');
  const dotHighlight = svg.querySelector('.sparkline-dot-highlight');
  const dotHalo = svg.querySelector('.sparkline-dot-halo');
  if (crosshairLine) {
    crosshairLine.setAttribute('x1', xStr);
    crosshairLine.setAttribute('x2', xStr);
  }
  if (dotHighlight) {
    dotHighlight.setAttribute('cx', xStr);
    dotHighlight.setAttribute('cy', yStr);
  }
  if (dotHalo) {
    dotHalo.setAttribute('cx', xStr);
    dotHalo.setAttribute('cy', yStr);
  }
  if (secTargetY !== null) {
    const secDot = svg.querySelector('.sparkline-dot-highlight-secondary');
    if (secDot) {
      secDot.setAttribute('cx', xStr);
      secDot.setAttribute('cy', secTargetY.toFixed(1));
    }
  }
}

/**
 * Attaches pointer, touch, and keyboard accessibility listeners for interactive scrubbing.
 * @returns {Function} Teardown function to unbind listeners
 */
export function bindInteractiveScrubbing(wrapper, options = {}) {
  const svg = options.svg || wrapper.querySelector('svg.sparkline, svg.inspector-sparkline-svg');
  const overlay = wrapper.querySelector('.sparkline-touch-overlay');
  if (!svg || !overlay) return () => {};

  const dimensions = options.dimensions || getSparklineDimensions();
  const stickyDelay = options.stickyDelay !== undefined ? options.stickyDelay : 1500;
  const timerRef = options.timerRef || { id: null };
  let currentRatio = options.initialRatio !== undefined ? options.initialRatio : null;

  const setRatio = (ratio) => {
    currentRatio = ratio;
    if (options.onUpdate) options.onUpdate(ratio);
  };

  const handleMove = (e) => {
    if (timerRef.id) clearTimeout(timerRef.id);
    const ratio = options.getRatio ? options.getRatio(e) : calculateRatioFromEvent(e, svg, dimensions);
    setRatio(ratio);
  };

  const handleLeave = () => {
    if (timerRef.id) clearTimeout(timerRef.id);
    timerRef.id = setTimeout(() => setRatio(null), stickyDelay);
  };

  overlay.addEventListener('pointermove', handleMove);
  overlay.addEventListener('touchmove', handleMove, { passive: true });
  overlay.addEventListener('pointerleave', handleLeave);

  const handleKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    const active = options.getActiveRatio ? options.getActiveRatio() : currentRatio;
    let ratio = active !== null && active !== undefined ? active : 1.0;
    const rawCount = typeof options.stepCount === 'function' ? options.stepCount() : options.stepCount;
    const step = 1 / Math.max(1, rawCount !== undefined ? rawCount : 95);

    if (e.key === 'ArrowLeft') ratio = Math.max(0, ratio - (e.shiftKey ? step * 4 : step));
    if (e.key === 'ArrowRight') ratio = Math.min(1, ratio + (e.shiftKey ? step * 4 : step));
    if (e.key === 'Home') ratio = 0;
    if (e.key === 'End') ratio = 1;
    if (e.key === 'Escape') {
      setRatio(null);
      return;
    }
    setRatio(ratio);
  };

  wrapper.addEventListener('keydown', handleKeyDown);

  return () => {
    if (timerRef.id) clearTimeout(timerRef.id);
    overlay.removeEventListener('pointermove', handleMove);
    overlay.removeEventListener('touchmove', handleMove);
    overlay.removeEventListener('pointerleave', handleLeave);
    wrapper.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Renders a compact inline micro-sparkline SVG for summary rows and corridor tiles.
 *
 * @param {Array<number|Object>} points
 * @param {string} [strokeColor='#38bdf8']
 * @param {number} [minSpan=0.50]
 * @returns {string}
 */
export function renderMicroSparkline(points, strokeColor = '#38bdf8', minSpan = 0.50) {
  if (!points || points.length < 2) return `<span class="micro-empty">--</span>`;
  const rawValues = points.map(p => typeof p === 'object' ? p.value : p);
  const width = 110;
  const height = 24;

  const rawMin = Math.min(...rawValues);
  const rawMax = Math.max(...rawValues);
  const rawRange = rawMax - rawMin;

  let yMin = rawMin;
  let yMax = rawMax;

  if (rawRange < minSpan) {
    const midpoint = (rawMin + rawMax) / 2;
    yMin = midpoint - (minSpan / 2);
    yMax = midpoint + (minSpan / 2);
  }

  const effectiveRange = yMax - yMin || 1;

  const pts = rawValues.map((p, i) => {
    const x = (i / (rawValues.length - 1)) * (width - 6) + 3;
    const y = height - 3 - (((p - yMin) / effectiveRange) * (height - 6));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `
    <svg class="micro-sparkline" viewBox="0 0 ${width} ${height}" title="24h variation: ${(rawRange * 100).toFixed(1)}cm">
      <polyline fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
    </svg>
  `;
}

/**
 * Renders a single stage sparkline SVG with dynamic statistics and accessible DOM scaffold.
 *
 * @param {Array<number|Object>} pointsInput
 * @param {string} [strokeColor='#4ade80']
 * @param {Object} [options={}]
 * @returns {string}
 */
export function renderSingleSparkline(pointsInput, strokeColor = '#4ade80', options = {}) {
  if (!pointsInput || pointsInput.length === 0) return `<div class="sparkline-empty">No telemetry data</div>`;

  const { values, timestamps } = normalizePoints(pointsInput);
  if (values.length === 0) return `<div class="sparkline-empty">No telemetry data</div>`;

  const width = options.width || 300;
  const height = options.height || 75;
  const minSpan = options.minSpan !== undefined ? options.minSpan : 0.50; // Enforce minimum 50cm scale window

  const bounds = computeSparklineBounds(values, { minSpan });
  const { rawMin, rawMax, rawRange, latestVal, yMin, yMax } = bounds;

  const marginTop = 16;
  const marginBottom = 16;
  const marginLeft = 8;
  const marginRight = 68;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;
  const dims = { width, height, marginTop, marginBottom, marginLeft, marginRight, drawWidth, drawHeight };

  const projected = projectCoordinates(values, bounds, dims);
  const pts = buildSvgPoints(projected);

  const topLabel = `Max ${rawMax.toFixed(2)}m`;
  const botLabel = `Min ${rawMin.toFixed(2)}m`;
  const isFlatStage = rawRange < 0.01 || topLabel === botLabel;
  const rangePrefix = (options.rangeLabel || '24h').toUpperCase();
  const spanText = isFlatStage ? `${rangePrefix} Range: Steady (0cm)` : `${rangePrefix} Range: ${formatSpanUnit(rawRange)}`;

  const streamHeader = options.streamLabel ? 
    `<span class="stream-dot" style="background:${strokeColor}; color:${strokeColor}"></span><span class="sparkline-title">${options.streamLabel}</span> <span class="gauge-id-badge">ID: ${options.stationId}</span>` :
    `<span class="sparkline-title">${rangePrefix} Telemetry</span>`;

  const gridLinesHTML = renderGridLines(dims, isFlatStage);
  const yLabelsHTML = renderYAxisLabels(dims, bounds, isFlatStage);

  return `
    <div class="sparkline-wrapper">
      <div class="sparkline-header">
        <div class="sparkline-title-group">${streamHeader}</div>
        <div class="sparkline-stats-bar">
          <span class="sparkline-stat-pill pill-current" title="Latest stage reading">Current: <strong>${typeof latestVal === 'number' ? latestVal.toFixed(2) : '--'}${options.unit || 'mAOD'}</strong></span>
          <span class="sparkline-stat-pill" title="Minimum stage reading in active window">Min: <strong>${rawMin.toFixed(2)}m</strong></span>
          <span class="sparkline-stat-pill" title="Maximum stage reading in active window">Max: <strong>${rawMax.toFixed(2)}m</strong></span>
          <span class="sparkline-span-pill" title="Actual variation range">${spanText}</span>
        </div>
      </div>
      <svg class="sparkline" 
           viewBox="0 0 ${width} ${height}" 
           preserveAspectRatio="none"
           data-points='${JSON.stringify(values)}'
           data-timestamps='${JSON.stringify(timestamps)}'
           data-ymin="${yMin}"
           data-ymax="${yMax}"
           data-unit="${options.unit || 'mAOD'}">
        ${gridLinesHTML}
        <polyline fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
        <line class="sparkline-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />
        <rect class="sparkline-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${height}" fill="transparent" />
        ${yLabelsHTML}
      </svg>
      <div class="sparkline-tooltip"></div>
    </div>
  `;
}

/**
 * Renders dual sparkline SVG (Inland vs Sea Tide) with tide-locked window highlighting.
 * Strictly uses #0284c7 for sea tide stream, preventing warning orange semantic collisions (UI-COL-02).
 *
 * @param {Array<number|Object>} seaInput
 * @param {Array<number|Object>} inlandInput
 * @param {boolean} isTideLocked
 * @param {Object} [options={}]
 * @returns {string}
 */
export function renderDualSparkline(seaInput, inlandInput, isTideLocked, options = {}) {
  const { values: rawSeaValues } = normalizePoints(seaInput);
  const { values: rawInlandValues, timestamps: rawTimestamps } = normalizePoints(inlandInput);

  // Synchronize arrays: clamp to Math.min(rawSeaValues.length, rawInlandValues.length) from latest point backwards
  const n = Math.min(rawSeaValues.length, rawInlandValues.length);
  const seaValues = n > 0 ? rawSeaValues.slice(-n) : [];
  const inlandValues = n > 0 ? rawInlandValues.slice(-n) : [];
  const timestamps = (rawTimestamps && rawTimestamps.length > 0) ? rawTimestamps.slice(-n) : [];

  const latestSea = seaValues[seaValues.length - 1];
  const latestInland = inlandValues[inlandValues.length - 1];

  const width = options.width || 300;
  const height = options.height || 75;

  if (n === 0) {
    const streamHeader = options.streamLabel || 
      `<span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">Inland KSD (E9094)</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#0284c7; color:#0284c7"></span><span class="sparkline-title">Sea Tide (52163)</span>`;
    return `
      <div class="sparkline-wrapper">
        <div class="sparkline-header">
          <div class="sparkline-title-group">${streamHeader}</div>
        </div>
        <div class="sparkline-empty" style="height:${height}px; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:0.75rem;">
          No Telemetry Data
        </div>
      </div>
    `;
  }

  const allPoints = [...seaValues, ...inlandValues];
  const minSpan = options.minSpan !== undefined ? options.minSpan : 1.0;
  const bounds = computeSparklineBounds(allPoints, { minSpan });
  const { rawMin, rawMax, yMin, yMax } = bounds;

  const marginTop = 16;
  const marginBottom = 16;
  const marginLeft = 8;
  const marginRight = 68;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;
  const dims = { width, height, marginTop, marginBottom, marginLeft, marginRight, drawWidth, drawHeight };

  const seaProjected = projectCoordinates(seaValues, bounds, dims);
  const inlandProjected = projectCoordinates(inlandValues, bounds, dims);
  const seaPts = buildSvgPoints(seaProjected);
  const inlandPts = buildSvgPoints(inlandProjected);

  // Calculate exact historical tide-lock intervals (sea level >= inland level)
  const intervals = computeTideLockIntervals(seaValues, inlandValues);
  const denom = Math.max(1, n - 1);

  const currentRange = options.currentRange || '24h';
  const tideLockHighlights = intervals.map(inv => {
    const x1 = marginLeft + (inv.start / denom) * drawWidth;
    const x2 = marginLeft + (inv.end / denom) * drawWidth;
    const w = Math.max(x2 - x1, 2);

    if (currentRange === '7d' || currentRange === '30d') {
      return `<rect x="${x1.toFixed(1)}" y="${marginTop}" width="${w.toFixed(1)}" height="4" fill="rgba(230, 97, 1, 0.85)" rx="1"><title>Tide-Locked Period (Estuary Sea Level >= Inland Drain)</title></rect>`;
    } else {
      return `<rect x="${x1.toFixed(1)}" y="${marginTop}" width="${w.toFixed(1)}" height="${height - marginTop - marginBottom}" fill="rgba(230, 97, 1, 0.25)" stroke="rgba(230, 97, 1, 0.4)" stroke-width="0.5"><title>Tide-Locked Window: Sea Head Seals Passive Flap Gates</title></rect>`;
    }
  }).join('');

  const primaryName = options.primaryName || 'Inland';
  const secondaryName = options.secondaryName || 'Sea';
  const primaryColor = options.primaryColor || '#38bdf8';
  const secondaryColor = options.secondaryColor || '#0284c7';
  const statusPillText = options.statusPill !== undefined ? options.statusPill : (isTideLocked ? '🔒 Tide-Locked Window' : '✓ Gravity Discharge');
  const showTideLock = options.showTideLock !== undefined ? options.showTideLock : true;

  const streamHeader = options.streamLabel || 
    `<span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">Inland KSD (E9094)</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#0284c7; color:#0284c7"></span><span class="sparkline-title">Sea Tide (52163)</span>`;

  return `
    <div class="sparkline-wrapper">
      <div class="sparkline-header">
        <div class="sparkline-title-group">${streamHeader}</div>
        <div class="sparkline-stats-bar">
          <span class="sparkline-stat-pill" style="color:${primaryColor}" title="${primaryName} stage">${primaryName}: <strong>${typeof latestInland === 'number' ? latestInland.toFixed(2) : '--'}mAOD</strong></span>
          <span class="sparkline-stat-pill" style="color:${secondaryColor}" title="${secondaryName} stage">${secondaryName}: <strong>${typeof latestSea === 'number' ? latestSea.toFixed(2) : '--'}mAOD</strong></span>
          <span class="sparkline-span-pill ${isTideLocked ? 'pill-warning' : ''}">
            ${statusPillText}
          </span>
        </div>
      </div>
      <svg class="sparkline" 
           viewBox="0 0 ${width} ${height}" 
           preserveAspectRatio="none"
           data-points='${JSON.stringify(inlandValues)}'
           data-secondary-points='${JSON.stringify(seaValues)}'
           data-timestamps='${JSON.stringify(timestamps)}'
           data-primary-name="${escapeAttr(primaryName)}"
           data-secondary-name="${escapeAttr(secondaryName)}"
           data-ymin="${yMin}"
           data-ymax="${yMax}">
        ${showTideLock ? tideLockHighlights : ''}
        <line x1="${marginLeft}" y1="${marginTop}" x2="${width - marginRight + 5}" y2="${marginTop}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" />
        <line x1="${marginLeft}" y1="${height - marginBottom}" x2="${width - marginRight + 5}" y2="${height - marginBottom}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" />
        <polyline fill="none" stroke="${primaryColor}" stroke-width="2.2" points="${inlandPts}" />
        <polyline fill="none" stroke="${secondaryColor}" stroke-width="2.2" points="${seaPts}" />
        <line class="sparkline-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />
        <circle class="sparkline-dot-highlight-secondary" cx="0" cy="0" r="4.5" />
        <rect class="sparkline-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${height}" fill="transparent" />
        <g transform="translate(${width - 4}, ${marginTop + 3})">
          <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label">Max ${rawMax.toFixed(2)}m</text>
        </g>
        <g transform="translate(${width - 4}, ${height - marginBottom + 3})">
          <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label">Min ${rawMin.toFixed(2)}m</text>
        </g>
      </svg>
      <div class="sparkline-tooltip"></div>
    </div>
  `;
}

/**
 * Renders the Topology View inspector drawer sparkline with dynamic crest threshold lines (UI-COL-03).
 *
 * @param {Array<Object>} readings - Historical readings array
 * @param {string} [strokeColor='#38bdf8']
 * @param {number|null} [crestHeight=null] - Crest height for spillways (strictly null for gauges)
 * @param {boolean} [isRelative=false] - Whether reporting in relative m depth vs mAOD
 * @returns {string}
 */
export function renderInspectorSparkline(readings, strokeColor = '#38bdf8', crestHeight = null, isRelative = false) {
  if (!readings || readings.length === 0) {
    return `<div style="padding:1rem; text-align:center; color:#64748b; font-size:0.8rem;">No 24h hydrograph historical telemetry available for this gauge.</div>`;
  }

  const rawItems = readings.slice(0, 96).map(r => ({
    value: r.value,
    time: r.dateTime ? new Date(r.dateTime) : null,
    isoTime: r.dateTime || ''
  })).reverse();
  const items = rawItems.filter(i => typeof i.value === 'number' && !isNaN(i.value));

  if (items.length < 2) {
    return `<div style="padding:1rem; text-align:center; color:#64748b; font-size:0.8rem;">Insufficient telemetry points to draw sparkline.</div>`;
  }

  const values = items.map(i => i.value);
  const timestamps = items.map(i => i.isoTime);

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const latestV = values[values.length - 1];
  const rawRange = rawMax - rawMin;

  const bounds = computeSparklineBounds(values, { crestHeight, spanPadding: 0.20 });
  const { yMin: minV, yMax: maxV, isCrestRelevant, effectiveRange: range } = bounds;

  const w = 340;
  const h = 100;
  const marginTop = 18;
  const marginBottom = 18;
  const marginLeft = 10;
  const marginRight = 68;
  const drawWidth = w - marginLeft - marginRight;
  const drawHeight = h - marginTop - marginBottom;
  const dims = { width: w, height: h, marginTop, marginBottom, marginLeft, marginRight, drawWidth, drawHeight };

  const pointsArr = projectCoordinates(values, bounds, dims);
  const points = pointsArr.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const latestPt = pointsArr[pointsArr.length - 1];

  let crestLine = '';
  if (isCrestRelevant && crestHeight >= minV && crestHeight <= maxV) {
    crestLine = renderCrestGuide(dims, bounds, crestHeight, latestV);
  }

  const topLabel = `Max ${rawMax.toFixed(2)}m`;
  const botLabel = `Min ${rawMin.toFixed(2)}m`;

  const unitLabel = isRelative ? 'm depth' : 'mAOD';
  const isFlatStage = rawRange < 0.01 || topLabel === botLabel;
  const deltaText = isFlatStage ? '0cm (Steady)' : `${(rawRange * 100).toFixed(0)}cm`;

  const gridLinesHTML = renderGridLines(dims, isFlatStage);
  const topDisplayLabel = isCrestRelevant && (maxV - rawMax > 0.05) ? `Top ${maxV.toFixed(2)}m` : topLabel;
  const yLabelsHTML = renderYAxisLabels(dims, bounds, isFlatStage, { topDisplayLabel });

  return `
    <div class="sparkline-stats-bar">
      <span class="sparkline-stat-pill pill-current">Current: <strong>${latestV.toFixed(2)}${unitLabel}</strong></span>
      <span class="sparkline-stat-pill">Min: <strong>${rawMin.toFixed(2)}m</strong></span>
      <span class="sparkline-stat-pill">Max: <strong>${rawMax.toFixed(2)}m</strong></span>
      <span class="sparkline-stat-pill">Δ <strong>${deltaText}</strong></span>
    </div>
    <div class="sparkline-wrapper" tabindex="0" role="region" aria-label="24h hydrograph stage sparkline. Use Left and Right Arrow keys to scrub timeline.">
      <svg class="inspector-sparkline-svg sparkline" 
           viewBox="0 0 ${w} ${h}" 
           preserveAspectRatio="none"
           data-points='${JSON.stringify(values)}'
           data-timestamps='${JSON.stringify(timestamps)}'
           data-ymin="${minV}"
           data-ymax="${maxV}"
           data-unit="${unitLabel}"
           aria-label="24h hydrograph stage sparkline. Min ${rawMin.toFixed(2)}m, Max ${rawMax.toFixed(2)}m, Latest ${latestV.toFixed(2)}${unitLabel}.">
        ${gridLinesHTML}
        
        <path d="M ${points}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        
        ${crestLine}

        <!-- Interactive Crosshair & Scrub Highlight Elements -->
        <line class="sparkline-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${h - marginBottom}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />

        <!-- Latest telemetry point marker -->
        <circle cx="${latestPt.x.toFixed(1)}" cy="${latestPt.y.toFixed(1)}" r="6" fill="${strokeColor}" fill-opacity="0.35" />
        <circle cx="${latestPt.x.toFixed(1)}" cy="${latestPt.y.toFixed(1)}" r="3.5" fill="${strokeColor}" stroke="#0f172a" stroke-width="1.5" />

        ${yLabelsHTML}

        <!-- Transparent Touch / Mouse Scrubbing Overlay -->
        <rect class="sparkline-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${h}" fill="transparent" style="cursor: crosshair; touch-action: none;" />
      </svg>
      <div class="sparkline-tooltip" role="status" aria-live="polite"></div>
    </div>
  `;
}

const inspectorHoverTimerRef = { id: null };

/**
 * Binds interactive mouse, touch, and keyboard crosshair scrubbing to the Topology Inspector sparkline.
 *
 * @param {HTMLElement} container - The sparkline container element
 * @param {Object} [options={}] - Optional callbacks (`refreshController`, `onScrubStateChange`, `stickyDelay`)
 */
export function bindInspectorSparklineEvents(container, options = {}) {
  const wrapper = container?.querySelector('.sparkline-wrapper');
  const svg = wrapper?.querySelector('svg.inspector-sparkline-svg');
  if (!wrapper || !svg) return;

  let pointsData = [];
  let timestamps = [];
  try {
    pointsData = JSON.parse(svg.dataset.points || '[]');
    timestamps = JSON.parse(svg.dataset.timestamps || '[]');
  } catch (_) {}

  if (pointsData.length === 0) return;

  const dims = getSparklineDimensions({
    width: 340, height: 100, marginTop: 18, marginBottom: 18, marginLeft: 10, marginRight: 68
  });
  const yMin = parseFloat(svg.dataset.ymin) || 0;
  const yMax = parseFloat(svg.dataset.ymax) || 1;
  const effectiveRange = yMax - yMin || 1;
  const unit = svg.dataset.unit || 'mAOD';
  const tooltip = wrapper.querySelector('.sparkline-tooltip');

  const updateCrosshair = (ratio) => {
    const active = ratio !== null;
    wrapper.classList.toggle('crosshair-active', active);
    if (options.refreshController) options.refreshController.setScrubbing(active);
    if (options.onScrubStateChange) options.onScrubStateChange(active);
    if (!active) return;

    const index = calculateSparklineScrubIndex(ratio, pointsData.length);
    const primaryVal = pointsData[index];
    const targetX = dims.marginLeft + ratio * dims.drawWidth;
    const targetY = dims.height - dims.marginBottom - (((primaryVal - yMin) / effectiveRange) * dims.drawHeight);

    updateCrosshairSvgElements(svg, targetX, targetY);

    if (tooltip) {
      const leftPct = Math.max(16, Math.min(84, (targetX / dims.width) * 100));
      tooltip.style.left = `${leftPct.toFixed(1)}%`;
      const formatted = formatTimestampTooltip(timestamps[index]);
      tooltip.innerHTML = `<span class="tooltip-time">${formatted.fullGmt}</span><span class="tooltip-val">${primaryVal.toFixed(2)} ${unit}</span>`;
    }
  };

  bindInteractiveScrubbing(wrapper, {
    svg,
    dimensions: dims,
    stickyDelay: options.stickyDelay ?? 1200,
    timerRef: inspectorHoverTimerRef,
    stepCount: Math.max(1, pointsData.length - 1),
    onUpdate: updateCrosshair
  });
}

const globalHoverTimerRef = { id: null };

/**
 * Binds synchronized mouse, touch, and keyboard crosshair scrubbing across all dashboard sparklines.
 *
 * @param {HTMLElement|Document} [container=document] - Container holding `.sparkline-wrapper` cards
 * @param {Object} [options={}] - Optional callbacks (`stickyDelay`, `refreshController`, `onHoverChange`)
 */
export function bindSparklineEvents(container = document, options = {}) {
  const wrappers = Array.from(container.querySelectorAll('.sparkline-wrapper'))
    .filter(w => !w.classList.contains('hyetograph-wrapper'));
  const stickyDelay = options.stickyDelay ?? 1200;
  const dims = getSparklineDimensions({
    width: 300, height: 75, marginLeft: 8, marginRight: 65, marginTop: 16, marginBottom: 16
  });
  let activeRatio = null;

  const updateWrapperCrosshair = (wrapper, ratio) => {
    const svg = wrapper.querySelector('svg.sparkline');
    if (!svg) return;

    const pointsData = JSON.parse(svg.dataset.points || '[]');
    const secondaryData = JSON.parse(svg.dataset.secondaryPoints || '[]');
    const timestamps = JSON.parse(svg.dataset.timestamps || '[]');
    if (!pointsData || pointsData.length === 0) return;

    const targetX = dims.marginLeft + ratio * dims.drawWidth;
    const index = calculateSparklineScrubIndex(ratio, pointsData.length);
    const primaryVal = pointsData[index];
    const yMin = parseFloat(svg.dataset.ymin);
    const yMax = parseFloat(svg.dataset.ymax);
    const effectiveRange = yMax - yMin || 1;
    const targetY = dims.height - dims.marginBottom - (((primaryVal - yMin) / effectiveRange) * dims.drawHeight);
    const hasSec = secondaryData.length > 0 && index < secondaryData.length;
    const secTargetY = hasSec
      ? dims.height - dims.marginBottom - (((secondaryData[index] - yMin) / effectiveRange) * dims.drawHeight)
      : null;

    updateCrosshairSvgElements(svg, targetX, targetY, secTargetY);

    const tooltip = wrapper.querySelector('.sparkline-tooltip');
    if (tooltip) {
      tooltip.style.left = `${(targetX / dims.width) * 100}%`;
      const formatted = formatTimestampTooltip(timestamps[index]);
      const valText = hasSec
        ? `${svg.dataset.primaryName || 'Inland'}: ${primaryVal.toFixed(2)}m | ${svg.dataset.secondaryName || 'Sea'}: ${secondaryData[index].toFixed(2)}m`
        : `${primaryVal.toFixed(2)} ${svg.dataset.unit || 'mAOD'}`;
      tooltip.innerHTML = `<span class="tooltip-time">${formatted.dateStr} ${formatted.timeStr}</span><span class="tooltip-val">${valText}</span>`;
    }
  };

  const updateGlobalTimestampBanner = (ratio) => {
    const banner = document.getElementById('global-timestamp-banner');
    const badge = document.getElementById('gt-mode-badge');
    const timeDisplay = document.getElementById('gt-time-display');
    const ageDisplay = document.getElementById('gt-age-display');
    const syncStatus = document.getElementById('gt-sync-status');
    if (!banner) return;

    if (ratio === null) {
      banner.classList.remove('active-inspection');
      if (badge) badge.innerText = '📡 REAL-TIME STREAM';
      if (timeDisplay) timeDisplay.innerText = 'Showing latest live telemetry across all catchments';
      if (ageDisplay) ageDisplay.innerText = '';
      if (syncStatus) syncStatus.innerText = '💡 Hover over or scrub any sparkline to inspect synchronized crosshair';
      return;
    }

    const firstSvg = container.querySelector('svg.sparkline');
    const timestamps = firstSvg ? JSON.parse(firstSvg.dataset.timestamps || '[]') : [];
    const index = calculateSparklineScrubIndex(ratio, timestamps.length);
    const formatted = formatTimestampTooltip(timestamps[index]);

    banner.classList.add('active-inspection');
    if (badge) badge.innerText = '🎯 SYNCHRONIZED INSPECTION';
    if (timeDisplay && formatted.isValid) {
      timeDisplay.innerText = `📅 ${formatted.dateFormatted}, ${formatted.timeStr} GMT`;
    }
    if (ageDisplay && formatted.isValid) {
      ageDisplay.innerText = formatRelativeAge(formatted.timeObj);
    }
    if (syncStatus) syncStatus.innerText = '[ 4/4 MOORS SYNCED ]';
  };

  const setGlobalSparklineHover = (ratio) => {
    activeRatio = ratio;
    if (options.refreshController) options.refreshController.setScrubbing(ratio !== null);
    if (options.onHoverChange) options.onHoverChange(ratio);
    updateGlobalTimestampBanner(ratio);
    wrappers.forEach(w => {
      if (ratio === null) {
        w.classList.remove('crosshair-active');
      } else {
        w.classList.add('crosshair-active');
        updateWrapperCrosshair(w, ratio);
      }
    });
  };

  wrappers.forEach(wrapper => {
    const svg = wrapper.querySelector('svg.sparkline');
    const overlay = wrapper.querySelector('.sparkline-touch-overlay');
    if (!svg || !overlay) return;

    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'region');
    const titleText = wrapper.querySelector('.sparkline-title')?.textContent || 'Hydrological trend';
    wrapper.setAttribute('aria-label', `${titleText} interactive sparkline. Use Left and Right Arrow keys to scrub timeline.`);

    bindInteractiveScrubbing(wrapper, {
      svg,
      dimensions: dims,
      stickyDelay,
      timerRef: globalHoverTimerRef,
      getActiveRatio: () => activeRatio,
      stepCount: () => {
        try {
          return Math.max(1, (JSON.parse(svg.dataset.points || '[]').length || 96) - 1);
        } catch (_) {
          return 95;
        }
      },
      onUpdate: setGlobalSparklineHover
    });
  });
}

/**
 * Normalizes a 15-minute rainfall series into discrete interval depths (mm),
 * monotonic cumulative totals (mm), and ISO timestamps.
 *
 * @param {Array<object>} seriesInput
 * @returns {{
 *   bars: number[],
 *   cumulative: number[],
 *   timestamps: string[],
 *   totalCumulativeMm: number,
 *   maxBarMm: number,
 *   count: number
 * }}
 */
export function normalizeRainfallSeries(seriesInput) {
  if (!Array.isArray(seriesInput) || seriesInput.length === 0) {
    return { bars: [], cumulative: [], timestamps: [], totalCumulativeMm: 0, maxBarMm: 0, count: 0 };
  }

  const bars = [];
  const cumulative = [];
  const timestamps = [];
  let runningSum = 0;

  for (let i = 0; i < seriesInput.length; i++) {
    const item = seriesInput[i];
    if (!item || typeof item !== 'object') continue;
    const rawRain = item.rainfall_mm !== undefined ? item.rainfall_mm : item.value;
    if (typeof rawRain !== 'number' || !Number.isFinite(rawRain) || rawRain < 0) continue;

    const cleanBar = Number(rawRain.toFixed(2));
    runningSum = Number((runningSum + cleanBar).toFixed(2));
    const rawCum = typeof item.cumulative_mm === 'number' && Number.isFinite(item.cumulative_mm) && item.cumulative_mm >= runningSum
      ? Number(item.cumulative_mm.toFixed(2))
      : runningSum;
    runningSum = rawCum;

    bars.push(cleanBar);
    cumulative.push(rawCum);
    timestamps.push(item.timestamp || item.dateTime || item.isoTime || item.time || '');
  }

  const maxBarMm = bars.length > 0 ? Math.max(...bars) : 0;
  const totalCumulativeMm = cumulative.length > 0 ? cumulative[cumulative.length - 1] : 0;

  return {
    bars,
    cumulative,
    timestamps,
    totalCumulativeMm,
    maxBarMm,
    count: bars.length
  };
}

/**
 * Renders a discrete upward-rising bar hyetograph SVG with a superimposed cumulative
 * mass curve using the orthogonal indigo/violet PRECIPITATION_PALETTE (UI-COL-01).
 * Supports interactive pointer, touch, and keyboard crosshair scrubbing (UI-INT-01).
 *
 * @param {Array<object>} seriesInput - Array of { timestamp, rainfall_mm, cumulative_mm }
 * @param {Object} [options={}]
 * @returns {string}
 */
export function renderHyetographSparkline(seriesInput, options = {}) {
  const width = options.width || 320;
  const height = options.height || 84;
  const marginTop = options.marginTop !== undefined ? options.marginTop : 14;
  const marginBottom = options.marginBottom !== undefined ? options.marginBottom : 14;
  const marginLeft = options.marginLeft !== undefined ? options.marginLeft : 8;
  const marginRight = options.marginRight !== undefined ? options.marginRight : 68;
  const dims = getSparklineDimensions({ width, height, marginTop, marginBottom, marginLeft, marginRight });

  const { bars, cumulative, timestamps, totalCumulativeMm, maxBarMm, count } = normalizeRainfallSeries(seriesInput);
  const bucketMinutes = (typeof options.bucketMinutes === 'number' && Number.isFinite(options.bucketMinutes) && options.bucketMinutes > 0)
    ? options.bucketMinutes
    : 15;
  const bucketLabel = (typeof options.bucketLabel === 'string' && options.bucketLabel.trim().length > 0)
    ? options.bucketLabel.trim()
    : (bucketMinutes >= 1440 ? 'day' : (bucketMinutes >= 60 ? `${Math.round(bucketMinutes / 60)}h` : `${bucketMinutes}m`));
  const periodLabel = (typeof options.periodLabel === 'string' && options.periodLabel.trim().length > 0)
    ? options.periodLabel.trim()
    : '24h';
  const titleText = options.title || `${periodLabel} ${bucketLabel} Rainfall Hyetograph`;
  const emptyMessage = options.emptyMessage || `Awaiting ${bucketLabel} rainfall readings`;

  if (count === 0) {
    return `
      <div class="sparkline-wrapper hyetograph-wrapper hyetograph-empty-state" role="region" aria-label="${escapeAttr(titleText)}">
        <div class="sparkline-header">
          <div class="sparkline-title-group">
            <span class="stream-dot" style="background:${PRECIPITATION_PALETTE.LIGHT.hex}; color:${PRECIPITATION_PALETTE.LIGHT.hex}"></span>
            <span class="sparkline-title">${escapeHTML(titleText)}</span>
          </div>
          <div class="sparkline-stats-bar">
            <span class="sparkline-stat-pill precip-stat-pill">No recent tips</span>
          </div>
        </div>
        <div class="hyetograph-empty-box">${escapeHTML(emptyMessage)}</div>
      </div>
    `;
  }

  const isDryWindow = maxBarMm === 0 && totalCumulativeMm === 0;
  const barMax = Math.max(2.0, maxBarMm * 1.15);
  const cumMax = Math.max(1.0, totalCumulativeMm * 1.08);
  const baselineY = dims.height - dims.marginBottom;
  const n = bars.length;
  const slotW = dims.drawWidth / Math.max(1, n);
  const barW = Math.max(1.4, Math.min(8, slotW * 0.72));

  const barRects = bars.map((mm, idx) => {
    if (mm <= 0) return '';
    const centerX = n === 1
      ? dims.marginLeft + dims.drawWidth / 2
      : dims.marginLeft + (idx / Math.max(1, n - 1)) * dims.drawWidth;
    const x = Math.max(dims.marginLeft, Math.min(dims.marginLeft + dims.drawWidth - barW, centerX - barW / 2));
    const barH = Math.max(2, (mm / barMax) * dims.drawHeight);
    const y = baselineY - barH;
    const tier = classifyRainfallIntensity(mm * (60 / bucketMinutes));
    return `<rect class="hyetograph-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="0.8" fill="${tier.color_hex}" fill-opacity="0.9" />`;
  }).join('');

  const cumCoords = cumulative.map((cumVal, idx) => {
    const x = n === 1
      ? dims.marginLeft + dims.drawWidth / 2
      : dims.marginLeft + (idx / Math.max(1, n - 1)) * dims.drawWidth;
    const y = baselineY - ((cumVal / cumMax) * dims.drawHeight);
    return { x, y, value: cumVal };
  });
  const cumPoints = buildSvgPoints(cumCoords);

  const gridMarkup = isDryWindow
    ? `<line x1="${dims.marginLeft}" y1="${baselineY}" x2="${dims.width - dims.marginRight + 4}" y2="${baselineY}" stroke="rgba(165, 180, 252, 0.3)" stroke-dasharray="3,3" stroke-width="1" />`
    : `
      <line x1="${dims.marginLeft}" y1="${dims.marginTop}" x2="${dims.width - dims.marginRight + 4}" y2="${dims.marginTop}" stroke="rgba(165, 180, 252, 0.16)" stroke-dasharray="3,3" stroke-width="1" />
      <line x1="${dims.marginLeft}" y1="${baselineY}" x2="${dims.width - dims.marginRight + 4}" y2="${baselineY}" stroke="rgba(165, 180, 252, 0.28)" stroke-width="1" />
    `;

  const yLabelsMarkup = isDryWindow
    ? `
      <g class="y-label-group" transform="translate(${dims.width - 4}, ${baselineY - 2})">
        <rect x="-64" y="-10" width="64" height="13" rx="2" fill="rgba(15, 23, 42, 0.88)" stroke="rgba(129, 140, 248, 0.35)" stroke-width="0.5" />
        <text x="-2" y="0" text-anchor="end" class="sparkline-y-label" fill="${PRECIPITATION_PALETTE.LIGHT.hex}" font-weight="600">Dry 0.0mm</text>
      </g>
    `
    : `
      <g class="y-label-group" transform="translate(${dims.width - 4}, ${dims.marginTop + 3})">
        <rect x="-64" y="-10" width="64" height="13" rx="2" fill="rgba(15, 23, 42, 0.88)" />
        <text x="-2" y="0" text-anchor="end" class="sparkline-y-label" fill="${PRECIPITATION_PALETTE.CUMULATIVE_LINE.hex}" font-weight="600">Σ ${totalCumulativeMm.toFixed(1)}mm</text>
      </g>
      <g class="y-label-group" transform="translate(${dims.width - 4}, ${baselineY + 3})">
        <rect x="-64" y="-10" width="64" height="13" rx="2" fill="rgba(15, 23, 42, 0.88)" />
        <text x="-2" y="0" text-anchor="end" class="sparkline-y-label" fill="${PRECIPITATION_PALETTE.LIGHT.hex}">Pk ${maxBarMm.toFixed(1)}mm</text>
      </g>
    `;

  return `
    <div class="sparkline-wrapper hyetograph-wrapper" tabindex="0" role="region" aria-label="${escapeAttr(titleText)}. Use Left and Right Arrow keys to inspect ${escapeAttr(bucketLabel)} rainfall bars and cumulative total.">
      <div class="sparkline-header">
        <div class="sparkline-title-group">
          <span class="stream-dot" style="background:${PRECIPITATION_PALETTE.HEAVY.hex}; color:${PRECIPITATION_PALETTE.HEAVY.hex}"></span>
          <span class="sparkline-title">${escapeHTML(titleText)}</span>
        </div>
        <div class="sparkline-stats-bar">
          <span class="sparkline-stat-pill precip-stat-pill" title="${escapeAttr(periodLabel)} cumulative rainfall">Σ <strong>${totalCumulativeMm.toFixed(1)} mm</strong></span>
          <span class="sparkline-stat-pill precip-stat-pill" title="Peak ${escapeAttr(bucketLabel)} interval">Peak: <strong>${maxBarMm.toFixed(1)} mm/${escapeHTML(bucketLabel)}</strong></span>
        </div>
      </div>
      <svg class="hyetograph-svg"
           viewBox="0 0 ${dims.width} ${dims.height}"
           preserveAspectRatio="none"
           data-points="${escapeAttr(JSON.stringify(bars))}"
           data-cumulative-points="${escapeAttr(JSON.stringify(cumulative))}"
           data-timestamps="${escapeAttr(JSON.stringify(timestamps))}"
           data-bucket-minutes="${bucketMinutes}"
           data-bucket-label="${escapeAttr(bucketLabel)}"
           data-ymin="0"
           data-ymax="${cumMax}"
           data-bar-max="${barMax}"
           data-unit="mm"
           aria-label="${escapeAttr(titleText)}. ${escapeAttr(periodLabel)} total ${totalCumulativeMm.toFixed(1)}mm, peak ${escapeAttr(bucketLabel)} interval ${maxBarMm.toFixed(1)}mm.">
        ${gridMarkup}
        ${barRects}
        ${!isDryWindow ? `<polyline class="hyetograph-cumulative-line" fill="none" stroke="${PRECIPITATION_PALETTE.CUMULATIVE_LINE.hex}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${cumPoints}" />` : ''}
        <line class="sparkline-crosshair" x1="${dims.marginLeft}" y1="${dims.marginTop}" x2="${dims.marginLeft}" y2="${baselineY}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />
        ${yLabelsMarkup}
        <rect class="sparkline-touch-overlay" x="${dims.marginLeft}" y="0" width="${dims.drawWidth}" height="${dims.height}" fill="transparent" style="cursor: crosshair; touch-action: none;" />
      </svg>
      <div class="sparkline-tooltip" role="status" aria-live="polite"></div>
    </div>
  `;
}

const hyetographHoverTimerRef = { id: null };

/**
 * Binds interactive pointer, touch, and keyboard crosshair scrubbing for all
 * `.hyetograph-wrapper` elements within `container`, keeping synchronized crosshairs
 * across hyetographs inside that container (UI-INT-01).
 *
 * @param {HTMLElement|Document} [container=document]
 * @param {Object} [options={}]
 * @returns {Function[]} Array of teardown functions
 */
export function bindHyetographEvents(container = document, options = {}) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  const wrappers = Array.from(container.querySelectorAll('.hyetograph-wrapper'));
  if (wrappers.length === 0) return [];

  const stickyDelay = options.stickyDelay ?? 1200;
  const dims = getSparklineDimensions({
    width: 320, height: 84, marginLeft: 8, marginRight: 68, marginTop: 14, marginBottom: 14
  });
  let activeRatio = null;

  const updateWrapper = (wrapper, ratio) => {
    const svg = wrapper.querySelector('svg.hyetograph-svg');
    if (!svg) return;

    let bars = [];
    let cumulative = [];
    let timestamps = [];
    try {
      bars = JSON.parse(svg.dataset.points || '[]');
      cumulative = JSON.parse(svg.dataset.cumulativePoints || '[]');
      timestamps = JSON.parse(svg.dataset.timestamps || '[]');
    } catch {
      return;
    }
    if (!Array.isArray(bars) || bars.length === 0) return;

    const index = calculateSparklineScrubIndex(ratio, bars.length);
    const barVal = bars[index] ?? 0;
    const cumVal = cumulative[index] ?? 0;
    const cumMax = parseFloat(svg.dataset.ymax) || 1;
    const targetX = dims.marginLeft + ratio * dims.drawWidth;
    const targetY = (dims.height - dims.marginBottom) - ((cumVal / cumMax) * dims.drawHeight);

    updateCrosshairSvgElements(svg, targetX, targetY);

    const tooltip = wrapper.querySelector('.sparkline-tooltip');
    if (tooltip) {
      const leftPct = Math.max(18, Math.min(82, (targetX / dims.width) * 100));
      tooltip.style.left = `${leftPct.toFixed(1)}%`;
      const bucketMinutes = Number(svg.dataset.bucketMinutes) || 15;
      const bucketLabel = svg.dataset.bucketLabel || '15m';
      const formatted = formatTimestampTooltip(timestamps[index]);
      const timeLabel = formatted.isValid
        ? (bucketMinutes >= 1440 ? formatted.dateStr : `${formatted.dateStr} ${formatted.timeStr}`)
        : `Step ${index + 1}`;
      const intensity = classifyRainfallIntensity(barVal * (60 / bucketMinutes));
      tooltip.innerHTML = `<span class="tooltip-time">${escapeHTML(timeLabel)}</span><span class="tooltip-val">${barVal.toFixed(1)}mm/${escapeHTML(bucketLabel)} (${escapeHTML(intensity.label)}) · Σ ${cumVal.toFixed(1)}mm</span>`;
    }
  };

  const syncAll = (ratio) => {
    activeRatio = ratio;
    if (options.refreshController) options.refreshController.setScrubbing(ratio !== null);
    if (options.onHoverChange) options.onHoverChange(ratio);
    wrappers.forEach((w) => {
      if (ratio === null) {
        w.classList.remove('crosshair-active');
      } else {
        w.classList.add('crosshair-active');
        updateWrapper(w, ratio);
      }
    });
  };

  return wrappers.map((wrapper) => {
    const svg = wrapper.querySelector('svg.hyetograph-svg');
    const overlay = wrapper.querySelector('.sparkline-touch-overlay');
    if (!svg || !overlay) return () => {};

    return bindInteractiveScrubbing(wrapper, {
      svg,
      dimensions: dims,
      stickyDelay,
      timerRef: hyetographHoverTimerRef,
      getActiveRatio: () => activeRatio,
      stepCount: () => {
        try {
          return Math.max(1, (JSON.parse(svg.dataset.points || '[]').length || 96) - 1);
        } catch {
          return 95;
        }
      },
      onUpdate: syncAll
    });
  });
}
