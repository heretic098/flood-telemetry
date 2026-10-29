import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHTML,
  escapeAttr,
  normalizePoints,
  computeSparklineBounds,
  checkFlatStage,
  getSparklineDimensions,
  projectCoordinates,
  buildSvgPoints,
  buildSvgPath,
  calculatePointY,
  computeTideLockIntervals,
  evaluateCrestVisuals,
  formatTimestampTooltip,
  formatRelativeAge,
  formatSpanUnit,
  calculateRatioFromEvent,
  calculateSparklineScrubIndex,
  renderGridLines,
  renderYAxisLabels,
  renderCrestGuide,
  renderSingleSparkline,
  renderDualSparkline,
  renderInspectorSparkline
} from '../src/js/sparkline.js';

test('Sparkline: normalizePoints normalizes numbers and various object shapes', () => {
  const numInput = [1.2, 1.5, 1.8];
  const normNums = normalizePoints(numInput);
  assert.equal(normNums.count, 3);
  assert.deepEqual(normNums.values, [1.2, 1.5, 1.8]);
  assert.equal(normNums.latestVal, 1.8);

  const objInput = [
    { value: 2.10, time: '2026-10-29T10:00:00Z' },
    { value: 2.35, isoTime: '2026-10-29T10:15:00Z' },
    { value: 2.50, dateTime: '2026-10-29T10:30:00Z' },
    { value: NaN } // should be filtered
  ];
  const normObjs = normalizePoints(objInput);
  assert.equal(normObjs.count, 3);
  assert.deepEqual(normObjs.values, [2.10, 2.35, 2.50]);
  assert.deepEqual(normObjs.timestamps, [
    '2026-10-29T10:00:00Z',
    '2026-10-29T10:15:00Z',
    '2026-10-29T10:30:00Z'
  ]);
  assert.equal(normObjs.latestVal, 2.50);

  // Empty / invalid cases
  assert.deepEqual(normalizePoints([]), { values: [], timestamps: [], count: 0, latestVal: null });
  assert.deepEqual(normalizePoints(null), { values: [], timestamps: [], count: 0, latestVal: null });
});

test('Sparkline: computeSparklineBounds enforces minSpan and handles small variations', () => {
  const tightValues = [5.00, 5.02, 5.01];
  const bounds = computeSparklineBounds(tightValues, { minSpan: 0.50 });
  assert.equal(bounds.rawMin, 5.00);
  assert.equal(bounds.rawMax, 5.02);
  assert.ok(Math.abs(bounds.rawRange - 0.02) < 1e-6);
  // minSpan = 0.50 enforced around midpoint 5.01
  assert.ok(Math.abs(bounds.yMin - (5.01 - 0.25)) < 1e-6);
  assert.ok(Math.abs(bounds.yMax - (5.01 + 0.25)) < 1e-6);
  assert.equal(bounds.effectiveRange, 0.50);
});

test('Sparkline: computeSparklineBounds expands frame only when crest is relevant (UI-DAT-02)', () => {
  const calmValues = [5.10, 5.15, 5.20]; // Hookbridge crest = 7.45m; difference > 2m
  const calmBounds = computeSparklineBounds(calmValues, { crestHeight: 7.45 });
  assert.equal(calmBounds.isCrestRelevant, false);
  // Does NOT blow out axis scale by 300% to fit distant dormant crest
  assert.ok(calmBounds.yMax < 6.00);

  const floodValues = [6.50, 6.70, 6.95]; // Within 0.80m of 7.45m crest
  const floodBounds = computeSparklineBounds(floodValues, { crestHeight: 7.45 });
  assert.equal(floodBounds.isCrestRelevant, true);
  assert.ok(floodBounds.yMax >= 7.45 + 0.05);
  assert.ok(floodBounds.yMin <= 7.45 - 0.80);
});

test('Sparkline: checkFlatStage enforces [UI-DAT-01] Spatial Monotonicity', () => {
  // Delta < 1cm
  const flat = checkFlatStage(3.400, 3.404, 0.004);
  assert.equal(flat.isFlatStage, true);
  assert.equal(flat.topLabel, 'Max 3.40m');
  assert.equal(flat.botLabel, 'Min 3.40m');

  // Delta >= 1cm
  const normal = checkFlatStage(3.40, 3.65, 0.25);
  assert.equal(normal.isFlatStage, false);
  assert.equal(normal.topLabel, 'Max 3.65m');
  assert.equal(normal.botLabel, 'Min 3.40m');
});

test('Sparkline: projectCoordinates projects Cartesian extremes accurately (UI-DAT-02)', () => {
  const values = [2.00, 3.00, 4.00];
  const bounds = { yMin: 2.00, effectiveRange: 2.00 };
  const dims = {
    width: 300,
    height: 75,
    marginTop: 16,
    marginBottom: 16,
    marginLeft: 8,
    marginRight: 68,
    drawWidth: 224,
    drawHeight: 43
  };

  const projected = projectCoordinates(values, bounds, dims);
  assert.equal(projected.length, 3);
  // First point at x = marginLeft, y = height - marginBottom (normalizedY = 0)
  assert.equal(projected[0].x, 8);
  assert.equal(projected[0].y, 75 - 16);

  // Mid point at normalizedY = 0.5
  assert.equal(projected[1].x, 8 + 112);
  assert.equal(projected[1].y, 75 - 16 - 21.5);

  // Last point at x = marginLeft + drawWidth, y = marginTop (normalizedY = 1)
  assert.equal(projected[2].x, 8 + 224);
  assert.equal(projected[2].y, 16);

  const pointsStr = buildSvgPoints(projected);
  assert.equal(pointsStr, '8.0,59.0 120.0,37.5 232.0,16.0');

  const pathStr = buildSvgPath(projected);
  assert.equal(pathStr, 'M 8.0,59.0 120.0,37.5 232.0,16.0');
});

test('Sparkline: computeTideLockIntervals accurately flags sea >= inland windows', () => {
  const sea = [3.0, 3.5, 4.2, 4.5, 3.8, 2.5];
  const inland = [3.2, 3.4, 3.4, 3.5, 3.5, 3.5];
  // i=0: sea 3.0 < inland 3.2 (open)
  // i=1: sea 3.5 >= inland 3.4 (locked)
  // i=2: sea 4.2 >= inland 3.4 (locked)
  // i=3: sea 4.5 >= inland 3.5 (locked)
  // i=4: sea 3.8 >= inland 3.5 (locked)
  // i=5: sea 2.5 < inland 3.5 (open)
  const intervals = computeTideLockIntervals(sea, inland);
  assert.deepEqual(intervals, [{ start: 1, end: 4 }]);
});

test('Sparkline: evaluateCrestVisuals enforces [UI-COL-03] dynamic semantic colors', () => {
  const crest = 7.45;

  // Safe (> 30cm clearance): Muted Slate #64748b
  const safe = evaluateCrestVisuals(6.80, crest);
  assert.equal(safe.crestStroke, '#64748b');
  assert.ok(safe.crestLabelText.includes('Crest 7.45m'));
  assert.ok(!safe.crestLabelText.includes('▲'));
  assert.ok(!safe.crestLabelText.includes('⚠️'));

  // Near crest (<= 30cm clearance): Amber #f59e0b
  const near = evaluateCrestVisuals(7.20, crest);
  assert.equal(near.crestStroke, '#f59e0b');
  assert.ok(near.crestLabelText.includes('⚠️ Crest 7.45m'));

  // Active Overtopping (stage >= crest): Emergency Red #ef4444
  const over = evaluateCrestVisuals(7.55, crest);
  assert.equal(over.crestStroke, '#ef4444');
  assert.ok(over.crestLabelText.includes('▲ Overtopping 7.45m'));
});

test('Sparkline: formatTimestampTooltip and formatRelativeAge handle time formatting', () => {
  const iso = '2026-10-29T14:30:00Z';
  const formatted = formatTimestampTooltip(iso);
  assert.equal(formatted.isValid, true);
  assert.ok(formatted.dateStr.includes('29'));
  assert.ok(formatted.dateStr.includes('Oct'));
  assert.ok(formatted.fullGmt.includes('29 Oct'));
  assert.ok(formatted.fullGmt.includes('GMT'));

  // Relative age tests
  const now = Date.now();
  assert.equal(formatRelativeAge(now - 10000), '(Just now)');
  assert.equal(formatRelativeAge(now - 5 * 60 * 1000), '(5m ago)');
  assert.equal(formatRelativeAge(now - 150 * 60 * 1000), '(2h 30m ago)');
  assert.equal(formatRelativeAge(now - 28 * 3600 * 1000), '(1d 4h ago)');
});

test('Sparkline: calculateSparklineScrubIndex and calculateRatioFromEvent bounds checking', () => {
  assert.equal(calculateSparklineScrubIndex(0, 96), 0);
  assert.equal(calculateSparklineScrubIndex(1.0, 96), 95);
  assert.equal(calculateSparklineScrubIndex(0.5, 96), 48);
  assert.equal(calculateSparklineScrubIndex(-0.1, 96), 0);
  assert.equal(calculateSparklineScrubIndex(1.5, 96), 95);
});

test('Sparkline: renderSingleSparkline and renderDualSparkline render WCAG accessible SVG', () => {
  const points = [
    { value: 2.10, time: '2026-10-29T10:00:00Z' },
    { value: 3.50, time: '2026-10-29T11:00:00Z' },
    { value: 4.80, time: '2026-10-29T12:00:00Z' }
  ];

  const singleHtml = renderSingleSparkline(points, '#4ade80', { streamLabel: 'Currymoor PS', stationId: '52118' });
  assert.ok(singleHtml.includes('class="sparkline-wrapper"'));
  assert.ok(singleHtml.includes('class="sparkline-crosshair"'));
  assert.ok(singleHtml.includes('class="sparkline-dot-highlight"'));
  assert.ok(singleHtml.includes('class="sparkline-touch-overlay"'));
  assert.ok(singleHtml.includes('class="sparkline-tooltip"'));
  assert.ok(singleHtml.includes('Current:'));
  assert.ok(singleHtml.includes('4.80'));
  assert.ok(singleHtml.includes('2.10'));

  const dualHtml = renderDualSparkline(points, points, false);
  assert.ok(dualHtml.includes('class="sparkline-wrapper"'));
  assert.ok(dualHtml.includes('#0284c7'), 'Dual sparkline must use estuarine deep blue #0284c7');
  assert.ok(!dualHtml.includes('#fb923c'), 'Dual sparkline must never use warning orange');
  assert.ok(dualHtml.includes('Inland:'));
  assert.ok(dualHtml.includes('Sea:'));
});

test('Sparkline: renderInspectorSparkline includes dynamic crest guide and accessibility attributes', () => {
  const readings = [
    { value: 7.20, dateTime: '2026-10-29T10:00:00Z' },
    { value: 7.30, dateTime: '2026-10-29T11:00:00Z' },
    { value: 7.40, dateTime: '2026-10-29T12:00:00Z' }
  ];

  // Near-crest (7.40m vs 7.45m crest): should display amber crest line
  const nearHtml = renderInspectorSparkline(readings, '#4ade80', 7.45);
  assert.ok(nearHtml.includes('class="sparkline-wrapper"'));
  assert.ok(nearHtml.includes('role="region"'));
  assert.ok(nearHtml.includes('tabindex="0"'));
  assert.ok(nearHtml.includes('#f59e0b'), 'Near crest must render warning amber guide');
  assert.ok(nearHtml.includes('⚠️ Crest 7.45m'));
});
