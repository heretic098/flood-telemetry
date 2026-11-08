import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  getPumpTriggerDelta,
  renderPumpTriggerGauge,
  renderDualSparkline as appRenderDualSparkline
} from '../src/js/app.js';
import { renderDualSparkline } from '../src/js/sparkline.js';

test('Issue #41: getPumpTriggerDelta resolves pump operational regimes and signed deltas', () => {
  const mockPumpEval = {
    thresholds: [
      { label: 'Lead ON', level: 4.00, pct: 20 },
      { label: 'Duty ON', level: 4.55, pct: 45 },
      { label: 'Mobile Order', level: 5.80, pct: 75 },
      { label: 'Mobile Active', level: 6.10, pct: 90 }
    ]
  };

  // Case 1: Below lead trigger -> STANDBY
  const standby = getPumpTriggerDelta(mockPumpEval, 3.85);
  assert.equal(standby.regime, 'STANDBY');
  assert.equal(standby.nextTrigger.label, 'Lead ON');
  assert.equal(standby.nextDelta, 0.15);
  assert.equal(standby.aboveDelta, null);
  assert.ok(standby.deltaText.includes('15cm to Lead ON (@ 4.00m)'));

  // Case 2: Between lead and duty -> LEAD_DUTY
  const leadDuty = getPumpTriggerDelta(mockPumpEval, 4.48);
  assert.equal(leadDuty.regime, 'LEAD_DUTY');
  assert.equal(leadDuty.activeTrigger.label, 'Lead ON');
  assert.equal(leadDuty.nextTrigger.label, 'Duty ON');
  assert.equal(leadDuty.nextDelta, 0.07);
  assert.equal(leadDuty.aboveDelta, 0.48);
  assert.ok(leadDuty.deltaText.includes('Active (+48cm above Lead ON) • 7cm to Duty ON (@ 4.55m)'));
  assert.equal(leadDuty.statusText, '7cm to Duty ON (@ 4.55m)');

  // Case 3: Between duty and mobile order -> FULL_DUTY
  const fullDuty = getPumpTriggerDelta(mockPumpEval, 4.70);
  assert.equal(fullDuty.regime, 'FULL_DUTY');
  assert.equal(fullDuty.activeTrigger.label, 'Duty ON');
  assert.equal(fullDuty.nextTrigger.label, 'Mobile Order');
  assert.equal(fullDuty.nextDelta, 1.10);
  assert.ok(fullDuty.deltaText.includes('Active (+15cm above Duty ON) • 1.10m to Mobile Order (@ 5.80m)'));

  // Case 4: Between mobile order and mobile active -> MOBILE_ORDERED
  const mobileOrder = getPumpTriggerDelta(mockPumpEval, 5.95);
  assert.equal(mobileOrder.regime, 'MOBILE_ORDERED');
  assert.equal(mobileOrder.activeTrigger.label, 'Mobile Order');
  assert.equal(mobileOrder.nextTrigger.label, 'Mobile Active');
  assert.equal(mobileOrder.nextDelta, 0.15);
  assert.ok(mobileOrder.deltaText.includes('Active (+15cm above Mobile Order) • 15cm to Mobile Active (@ 6.10m)'));

  // Case 5: At or above mobile active -> MOBILE_ACTIVE
  const mobileActive = getPumpTriggerDelta(mockPumpEval, 6.25);
  assert.equal(mobileActive.regime, 'MOBILE_ACTIVE');
  assert.equal(mobileActive.activeTrigger.label, 'Mobile Active');
  assert.equal(mobileActive.nextTrigger, null);
  assert.equal(mobileActive.nextDelta, null);
  assert.ok(mobileActive.deltaText.includes('Active (+15cm above Mobile Active) • At/Above Maximum Trigger'));

  // Case 6: Graceful handling of invalid inputs
  const invalid = getPumpTriggerDelta(null, NaN);
  assert.equal(invalid.regime, 'STANDBY');
  assert.equal(invalid.statusText, '--');
});

test('Issue #41: renderPumpTriggerGauge renders attribution, plain-English explainer, and pin bubble', () => {
  const mockPumpEval = {
    stationName: 'Currymoor PS',
    stage: 1,
    stageLabel: 'LEAD DUTY',
    badgeClass: 'stage-1',
    regimeTag: '❄️ Winter Triggers',
    progressPct: 42,
    thresholds: [
      { label: 'Lead ON', level: 4.00, pct: 20 },
      { label: 'Duty ON', level: 4.55, pct: 45 },
      { label: 'Mobile Order', level: 5.80, pct: 75 },
      { label: 'Mobile Active', level: 6.10, pct: 90 }
    ]
  };

  const drivingInfo = {
    stationId: '52127',
    stationName: 'Curry Moor Basin',
    riverName: 'River Tone',
    currentLevel: 4.48,
    color: '#38bdf8',
    isStale: false,
    roleTag: 'Internal Moor Drain'
  };

  const html = renderPumpTriggerGauge(mockPumpEval, drivingInfo);

  // 1. Driving sensor attribution row
  assert.ok(html.includes('Curry Moor Basin (Station 52127)'), 'Must attribute driving station');
  assert.ok(html.includes('[Internal Moor Drain]'), 'Must include role tag');
  assert.ok(html.includes('4.48m AOD'), 'Must display monospace live stage');

  // 2. Plain-English explainer callout
  assert.ok(html.includes('gauge-explainer-callout'), 'Must contain explainer callout container');
  assert.ok(html.includes('How this works:'), 'Must include clear explanation heading');
  assert.ok(html.includes('Pumping is triggered by water levels inside the moor drain'), 'Must explain drain vs river physics');
  assert.ok(html.includes('pumps lift it over the bank into the River Tone'), 'Must explain lift mechanics');
  assert.ok(html.includes('EA Somerset Levels Trigger Point Plan'), 'Must attribute EA plan provenance');

  // 3. Floating pin bubble
  assert.ok(html.includes('pin-bubble'), 'Must include pin bubble');
  assert.ok(html.includes('pin-head'), 'Must include pin head');
  assert.ok(html.includes('▼'), 'Pin head must point down');

  // 4. Next trigger highlighted tick
  assert.ok(html.includes('tick-next-target'), 'Next sequential target tick must be highlighted');

  // 5. Offline handling
  const staleInfo = { ...drivingInfo, isStale: true };
  const staleHtml = renderPumpTriggerGauge(mockPumpEval, staleInfo);
  assert.ok(staleHtml.includes('Telemetry Offline (Baseline Fallback)'), 'Must indicate offline fallback when stale');
});

test('Issue #41: renderDualSparkline enforces solid lines without dasharray and clamps series lengths', () => {
  const inland = [
    { value: 4.1, time: '2026-11-08T10:00:00Z' },
    { value: 4.2, time: '2026-11-08T10:15:00Z' },
    { value: 4.3, time: '2026-11-08T10:30:00Z' },
    { value: 4.48, time: '2026-11-08T10:45:00Z' }
  ];
  const sea = [
    { value: 5.5, time: '2026-11-08T10:15:00Z' },
    { value: 5.6, time: '2026-11-08T10:30:00Z' },
    { value: 5.75, time: '2026-11-08T10:45:00Z' }
  ]; // Notice: sea has 3 points, inland has 4 points

  const sparklineHtml = renderDualSparkline(sea, inland, false, {
    primaryName: 'Curry Moor',
    secondaryName: 'River Tone',
    primaryColor: '#38bdf8',
    secondaryColor: '#4ade80'
  });

  // Solid lines: must NOT contain stroke-dasharray="4,4"
  assert.ok(!sparklineHtml.includes('stroke-dasharray="4,4"'), 'Secondary sparkline line must NOT be dashed');

  // Must have stroke-width 2.2 on both polylines
  const polylineMatches = sparklineHtml.match(/<polyline fill="none" stroke="[^"]+" stroke-width="2.2" points="([^"]+)" \/>/g);
  assert.ok(polylineMatches && polylineMatches.length === 2, 'Must render two polylines with stroke-width 2.2');

  // Clamped length parity
  const dataPointsMatch = sparklineHtml.match(/data-points='(\[[^\]]+\])'/);
  const dataSecPointsMatch = sparklineHtml.match(/data-secondary-points='(\[[^\]]+\])'/);
  assert.ok(dataPointsMatch && dataSecPointsMatch);
  const parsedInland = JSON.parse(dataPointsMatch[1]);
  const parsedSea = JSON.parse(dataSecPointsMatch[1]);
  assert.equal(parsedInland.length, 3, 'Inland points must be clamped to sea length (3)');
  assert.equal(parsedSea.length, 3, 'Sea points must match clamped length (3)');

  // Also check parity with app.js implementation
  const appSparkHtml = appRenderDualSparkline(sea, inland, false, {
    primaryName: 'Curry Moor',
    secondaryName: 'River Tone'
  });
  assert.ok(!appSparkHtml.includes('stroke-dasharray="4,4"'), 'app.js dual sparkline must NOT be dashed');
});

test('Issue #41: Card 5 (Langport Confluence) series orientation ensures zero data inversion', () => {
  const huishYeo = [{ value: 6.68, time: '2026-11-08T12:00:00Z' }];
  const midelneyIsle = [{ value: 6.63, time: '2026-11-08T12:00:00Z' }];

  const html = appRenderDualSparkline(midelneyIsle, huishYeo, false, {
    primaryName: 'Yeo',
    secondaryName: 'Isle',
    primaryColor: '#4ade80',
    secondaryColor: '#38bdf8'
  });

  // Verify Yeo is mapped to primary stage (6.68m) and Isle to secondary stage (6.63m)
  assert.ok(html.includes('Yeo: <strong>6.68mAOD</strong>'), 'Primary stream must correctly display Yeo stage');
  assert.ok(html.includes('Isle: <strong>6.63mAOD</strong>'), 'Secondary stream must correctly display Isle stage');
});

test('Issue #41: renderDualSparkline defensive null-safety and boundary conditions (n=0, n=1)', () => {
  // Test n=0 (empty inputs)
  const emptyHtml = renderDualSparkline([], [], false, { primaryName: 'Drain', secondaryName: 'River' });
  assert.ok(emptyHtml.includes('No Telemetry Data'), 'Empty series must render graceful placeholder');
  assert.ok(!emptyHtml.includes('NaN'), 'Empty series must never emit NaN');

  // Test n=1 (single reading: potential division by zero on (n-1))
  const singleInland = [{ value: 4.50, time: '2026-11-08T12:00:00Z' }];
  const singleSea = [{ value: 5.20, time: '2026-11-08T12:00:00Z' }]; // sea >= inland (triggers tide lock highlight)
  const singleHtml = renderDualSparkline(singleSea, singleInland, true, {
    primaryName: 'Drain',
    secondaryName: 'Sea'
  });
  assert.ok(!singleHtml.includes('NaN'), 'Single-reading series must never produce NaN coordinates in tide-lock highlights');
  assert.ok(singleHtml.includes('Drain: <strong>4.50mAOD</strong>'), 'Single-reading must display stage');
  assert.ok(singleHtml.includes('Sea: <strong>5.20mAOD</strong>'), 'Single-reading must display stage');
});

test('Issue #41: British English spelling pass enforces zero Americanized defence / armoured occurrences in src/', () => {
  function scanDir(dir) {
    let files = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files = files.concat(scanDir(fullPath));
      } else if (/\.(js|html|json|css|txt)$/.test(entry)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const srcFiles = scanDir('src');
  const violations = [];

  for (const file of srcFiles) {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(/\b(defense|defenses|armored)\b/gi);
    if (matches) {
      violations.push({ file, matches });
    }
  }

  assert.equal(violations.length, 0, `Found Americanized spelling violations: ${JSON.stringify(violations)}`);
});
