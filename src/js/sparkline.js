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

/**
 * Escapes HTML characters in dynamic strings to prevent XSS.
 * @param {string|number} str
 * @returns {string}
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes characters for HTML attribute values.
 * @param {string|number} str
 * @returns {string}
 */
export function escapeAttr(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
 * Formats relative age for telemetry inspection banners.
 *
 * @param {Date|number|string} dateOrMs
 * @returns {string}
 */
export function formatRelativeAge(dateOrMs) {
  const timeMs = dateOrMs instanceof Date ? dateOrMs.getTime() : (typeof dateOrMs === 'string' ? new Date(dateOrMs).getTime() : dateOrMs);
  if (!timeMs || isNaN(timeMs)) return '';

  const diffMs = Date.now() - timeMs;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return '(Just now)';
  if (diffMins < 60) return `(${diffMins}m ago)`;

  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  if (h < 24) return `(${h}h ${m}m ago)`;

  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `(${d}d ${remH}h ago)`;
}

/**
 * Formats stage span delta into human units (m, cm, mm).
 *
 * @param {number} deltaInMeters
 * @returns {string}
 */
export function formatSpanUnit(deltaInMeters) {
  const absDelta = Math.abs(deltaInMeters);
  if (absDelta >= 1.0) {
    return `${deltaInMeters.toFixed(2)}m`;
  } else if (absDelta >= 0.01) {
    const cm = deltaInMeters * 100;
    return `${Number.isInteger(cm) || cm >= 10 ? cm.toFixed(0) : cm.toFixed(1)}cm`;
  } else {
    const mm = deltaInMeters * 1000;
    return `${mm.toFixed(0)}mm`;
  }
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

/**
 * Attaches pointer, touch, and keyboard accessibility listeners for interactive scrubbing.
 *
 * @param {HTMLElement} wrapper - Container element (.sparkline-wrapper)
 * @param {Object} options
 * @param {Function} options.onUpdate - Callback invoked with ratio (number|null)
 * @param {number} [options.stickyDelay=1500] - Milliseconds before clearing crosshair on pointerleave
 * @param {number} [options.stepCount=95] - Step count for arrow key navigation
 * @param {Function} [options.getRatio] - Optional custom ratio getter
 * @param {Object} [options.dimensions] - Optional dimensions
 * @returns {Function} Teardown function to unbind listeners
 */
export function bindInteractiveScrubbing(wrapper, options = {}) {
  const svg = wrapper.querySelector('svg.sparkline');
  const overlay = wrapper.querySelector('.sparkline-touch-overlay');
  if (!svg || !overlay) return () => {};

  const dimensions = options.dimensions || getSparklineDimensions();
  const stickyDelay = options.stickyDelay !== undefined ? options.stickyDelay : 1500;
  const stepCount = options.stepCount || 95;
  const step = 1 / Math.max(1, stepCount);

  let hoverTimer = null;
  let currentRatio = options.initialRatio !== undefined ? options.initialRatio : null;

  const handleMove = (e) => {
    if (hoverTimer) clearTimeout(hoverTimer);
    const ratio = options.getRatio ? options.getRatio(e) : calculateRatioFromEvent(e, svg, dimensions);
    currentRatio = ratio;
    if (options.onUpdate) options.onUpdate(ratio);
  };

  const handleLeave = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      currentRatio = null;
      if (options.onUpdate) options.onUpdate(null);
    }, stickyDelay);
  };

  overlay.addEventListener('pointermove', handleMove);
  overlay.addEventListener('touchmove', handleMove, { passive: true });
  overlay.addEventListener('pointerleave', handleLeave);

  const handleKeyDown = (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) {
      e.preventDefault();
      let ratio = currentRatio !== null ? currentRatio : 1.0;

      if (e.key === 'ArrowLeft') ratio = Math.max(0, ratio - (e.shiftKey ? step * 4 : step));
      if (e.key === 'ArrowRight') ratio = Math.min(1, ratio + (e.shiftKey ? step * 4 : step));
      if (e.key === 'Home') ratio = 0;
      if (e.key === 'End') ratio = 1;
      if (e.key === 'Escape') {
        currentRatio = null;
        if (options.onUpdate) options.onUpdate(null);
        return;
      }

      currentRatio = ratio;
      if (options.onUpdate) options.onUpdate(ratio);
    }
  };

  wrapper.addEventListener('keydown', handleKeyDown);

  return () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    overlay.removeEventListener('pointermove', handleMove);
    overlay.removeEventListener('touchmove', handleMove);
    overlay.removeEventListener('pointerleave', handleLeave);
    wrapper.removeEventListener('keydown', handleKeyDown);
  };
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
  const { values: seaValues } = normalizePoints(seaInput);
  const { values: inlandValues, timestamps } = normalizePoints(inlandInput);

  const latestSea = seaValues[seaValues.length - 1];
  const latestInland = inlandValues[inlandValues.length - 1];

  const width = options.width || 300;
  const height = options.height || 75;

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
  const n = Math.min(seaValues.length, inlandValues.length);

  const currentRange = options.currentRange || '24h';
  const tideLockHighlights = intervals.map(inv => {
    const x1 = marginLeft + (inv.start / (n - 1)) * drawWidth;
    const x2 = marginLeft + (inv.end / (n - 1)) * drawWidth;
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
        <polyline fill="none" stroke="${secondaryColor}" stroke-width="2.2" stroke-dasharray="4,4" points="${seaPts}" />
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

let inspectorHoverStickyTimer = null;

/**
 * Binds interactive mouse, touch, and keyboard crosshair scrubbing to the Topology Inspector sparkline.
 *
 * @param {HTMLElement} container - The sparkline container element
 */
export function bindInspectorSparklineEvents(container) {
  if (!container) return;
  const wrapper = container.querySelector('.sparkline-wrapper');
  if (!wrapper) return;

  const svg = wrapper.querySelector('svg.inspector-sparkline-svg');
  const overlay = wrapper.querySelector('.sparkline-touch-overlay');
  if (!svg || !overlay) return;

  let pointsData = [];
  let timestamps = [];
  try {
    pointsData = JSON.parse(svg.dataset.points || '[]');
    timestamps = JSON.parse(svg.dataset.timestamps || '[]');
  } catch (_) {}

  if (pointsData.length === 0) return;

  const w = 340;
  const h = 100;
  const marginTop = 18;
  const marginBottom = 18;
  const marginLeft = 10;
  const marginRight = 68;
  const drawWidth = w - marginLeft - marginRight;
  const drawHeight = h - marginTop - marginBottom;
  const dims = { width: w, height: h, marginTop, marginBottom, marginLeft, marginRight, drawWidth, drawHeight };

  const yMin = parseFloat(svg.dataset.ymin) || 0;
  const yMax = parseFloat(svg.dataset.ymax) || 1;
  const effectiveRange = yMax - yMin || 1;
  const unit = svg.dataset.unit || 'mAOD';

  const crosshairLine = svg.querySelector('.sparkline-crosshair');
  const dotHighlight = svg.querySelector('.sparkline-dot-highlight');
  const dotHalo = svg.querySelector('.sparkline-dot-halo');
  const tooltip = wrapper.querySelector('.sparkline-tooltip');

  let currentRatio = null;

  const updateCrosshair = (ratio) => {
    if (ratio === null) {
      wrapper.classList.remove('crosshair-active');
      return;
    }
    wrapper.classList.add('crosshair-active');

    const index = calculateSparklineScrubIndex(ratio, pointsData.length);
    const primaryVal = pointsData[index];
    const targetX = marginLeft + ratio * drawWidth;
    const normalizedY = (primaryVal - yMin) / effectiveRange;
    const targetY = h - marginBottom - (normalizedY * drawHeight);

    if (crosshairLine) {
      crosshairLine.setAttribute('x1', targetX.toFixed(1));
      crosshairLine.setAttribute('x2', targetX.toFixed(1));
    }
    if (dotHighlight) {
      dotHighlight.setAttribute('cx', targetX.toFixed(1));
      dotHighlight.setAttribute('cy', targetY.toFixed(1));
    }
    if (dotHalo) {
      dotHalo.setAttribute('cx', targetX.toFixed(1));
      dotHalo.setAttribute('cy', targetY.toFixed(1));
    }

    if (tooltip) {
      const leftPct = Math.max(16, Math.min(84, (targetX / w) * 100));
      tooltip.style.left = `${leftPct.toFixed(1)}%`;
      
      const formatted = formatTimestampTooltip(timestamps[index]);
      tooltip.innerHTML = `<span class="tooltip-time">${formatted.fullGmt}</span><span class="tooltip-val">${primaryVal.toFixed(2)} ${unit}</span>`;
    }
  };

  const handleMove = (e) => {
    if (inspectorHoverStickyTimer) clearTimeout(inspectorHoverStickyTimer);
    const ratio = calculateRatioFromEvent(e, svg, dims);
    currentRatio = ratio;
    updateCrosshair(ratio);
  };

  const handleLeave = () => {
    if (inspectorHoverStickyTimer) clearTimeout(inspectorHoverStickyTimer);
    inspectorHoverStickyTimer = setTimeout(() => {
      currentRatio = null;
      updateCrosshair(null);
    }, 1200);
  };

  overlay.addEventListener('pointermove', handleMove);
  overlay.addEventListener('touchmove', handleMove, { passive: true });
  overlay.addEventListener('pointerleave', handleLeave);

  wrapper.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) {
      e.preventDefault();
      let ratio = currentRatio !== null ? currentRatio : 1.0;
      const step = 1 / Math.max(1, pointsData.length - 1);

      if (e.key === 'ArrowLeft') ratio = Math.max(0, ratio - (e.shiftKey ? step * 4 : step));
      if (e.key === 'ArrowRight') ratio = Math.min(1, ratio + (e.shiftKey ? step * 4 : step));
      if (e.key === 'Home') ratio = 0;
      if (e.key === 'End') ratio = 1;
      if (e.key === 'Escape') {
        currentRatio = null;
        updateCrosshair(null);
        return;
      }

      currentRatio = ratio;
      updateCrosshair(ratio);
    }
  });
}
