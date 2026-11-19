import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { evaluateSowyChannel } from '../src/js/hydro_engine.js';
import { renderSluiceOperationalGauge, getSluiceHeroStateText } from '../src/js/app.js';

test('evaluateSowyChannel enforces min_delta_h=0.05m, sowyCap=7.60m, and reverse_lock=0.10m parity', () => {
  // 0.05m boundary: 7.25 vs 7.20 -> DIVERTING
  const atBoundary = evaluateSowyChannel(7.25, 7.20, 7.20);
  assert.equal(atBoundary.status, 'DIVERTING');
  assert.equal(atBoundary.isDownstreamHealthy, true);
  assert.equal(atBoundary.deltaH, 0.05);

  // Below 0.05m: 7.24 vs 7.20 -> THROTTLED
  const belowMinDelta = evaluateSowyChannel(7.24, 7.20, 7.20);
  assert.equal(belowMinDelta.status, 'THROTTLED');

  // Downstream at Sowy capacity 7.60m -> THROTTLED even with large head drop
  const atSowyCap = evaluateSowyChannel(7.80, 7.60, 7.20);
  assert.equal(atSowyCap.status, 'THROTTLED');

  // True REVERSE_LOCK: upstream elevated (>= 7.15) and downstream >= upstream + 0.10
  const reverseLock = evaluateSowyChannel(7.20, 7.32, 7.20);
  assert.equal(reverseLock.status, 'REVERSE_LOCK');

  // Baseflow tailwater impoundment (6.71 vs 6.73) must NOT trigger REVERSE_LOCK
  const baseflow = evaluateSowyChannel(6.71, 6.73, 7.20);
  assert.equal(baseflow.status, 'CLOSED');
});

test('evaluateSowyChannel suppresses THROTTLED/REVERSE_LOCK and numeric deltaH when 52234 is flatlined, stale, or null', () => {
  const flatlinedHigh = evaluateSowyChannel(7.35, 7.45, 7.20, { isDownstreamFlatlined: true });
  assert.equal(flatlinedHigh.status, 'DIVERTING');
  assert.equal(flatlinedHigh.isDownstreamHealthy, false);
  assert.equal(flatlinedHigh.deltaH, null);
  assert.ok(flatlinedHigh.metricText.includes('Unavailable'));
  assert.ok(!flatlinedHigh.narrative.includes('-0.10m'));

  const staleHigh = evaluateSowyChannel(7.35, 7.65, 7.20, { isDownstreamStale: true });
  assert.equal(staleHigh.status, 'DIVERTING');
  assert.equal(staleHigh.isDownstreamHealthy, false);
  assert.equal(staleHigh.deltaH, null);

  const nullDownstream = evaluateSowyChannel(6.73, null, 7.20);
  assert.equal(nullDownstream.status, 'CLOSED');
  assert.equal(nullDownstream.isDownstreamHealthy, false);
  assert.equal(nullDownstream.deltaH, null);
});

test('renderSluiceOperationalGauge renders verified ticks, canonical data-status, and hides deltaH when 52234 is flatlined', () => {
  const sowyEval = evaluateSowyChannel(6.73, 6.729, 7.20, { isDownstreamFlatlined: true });
  const html = renderSluiceOperationalGauge(sowyEval, {
    upStage: 6.73,
    downStage: 6.729,
    downFreshness: { isFlatlined: true, isStale: true, isOffline: false }
  });

  assert.ok(html.includes('data-status="CLOSED"'));
  assert.ok(html.includes('CLOSED · PENNING'));
  assert.ok(html.includes('Headwall'));
  assert.ok(html.includes('6.70m'));
  assert.ok(!html.includes('Penning (~6.70m)'));
  assert.ok(html.includes('Sill'));
  assert.ok(html.includes('4.20m'));
  assert.ok(html.includes('Diversion Trigger'));
  assert.ok(html.includes('7.20m'));
  assert.ok(html.includes('Parrett Alert'));
  assert.ok(html.includes('7.90m'));
  assert.ok(html.includes('Cap/Alert 7.60m'));
  assert.ok(html.includes('Head Drop: Unavailable'));
  assert.ok(html.includes('Reading static (6.73m)'));
  assert.ok(!html.includes('Δh:'));
  assert.ok(html.includes('live penstock actuator SCADA is not broadcast publicly'));
});

test('renderSluiceOperationalGauge renders Approaching Trigger, Diverting, Throttled, and Reverse Lock states cleanly', () => {
  const approachingEval = evaluateSowyChannel(7.08, 6.60, 7.20);
  const approachingHtml = renderSluiceOperationalGauge(approachingEval, {
    upStage: 7.08,
    downStage: 6.60,
    downFreshness: { isFlatlined: false, isStale: false, isOffline: false }
  });
  assert.ok(approachingHtml.includes('data-status="CLOSED"'));
  assert.ok(approachingHtml.includes('CLOSED · APPROACHING TRIGGER'));
  assert.ok(approachingHtml.includes('Δh: +0.48m'));

  const divertingEval = evaluateSowyChannel(7.45, 6.95, 7.20);
  const divertingHtml = renderSluiceOperationalGauge(divertingEval, {
    upStage: 7.45,
    downStage: 6.95,
    downFreshness: { isFlatlined: false, isStale: false, isOffline: false }
  });
  assert.ok(divertingHtml.includes('data-status="DIVERTING"'));
  assert.ok(divertingHtml.includes('🔵 DIVERTING'));

  const throttledEval = evaluateSowyChannel(7.70, 7.65, 7.20);
  const throttledHtml = renderSluiceOperationalGauge(throttledEval, {
    upStage: 7.70,
    downStage: 7.65,
    downFreshness: { isFlatlined: false, isStale: false, isOffline: false }
  });
  assert.ok(throttledHtml.includes('data-status="THROTTLED"'));
  assert.ok(throttledHtml.includes('🟡 THROTTLED'));

  const reverseEval = evaluateSowyChannel(7.25, 7.40, 7.20);
  const reverseHtml = renderSluiceOperationalGauge(reverseEval, {
    upStage: 7.25,
    downStage: 7.40,
    downFreshness: { isFlatlined: false, isStale: false, isOffline: false }
  });
  assert.ok(reverseHtml.includes('data-status="REVERSE_LOCK"'));
  assert.ok(reverseHtml.includes('🔴 REVERSE LOCK'));
});

test('renderSluiceOperationalGauge surfaces degraded upstream 52233 state via opts.upFreshness', () => {
  const sowyEval = evaluateSowyChannel(7.30, 6.90, 7.20);
  const html = renderSluiceOperationalGauge(sowyEval, {
    upStage: 7.30,
    downStage: 6.90,
    upFreshness: { isFlatlined: false, isStale: true, isOffline: false, ageHours: 3.5 },
    downFreshness: { isFlatlined: false, isStale: false, isOffline: false },
    triggerM: 7.20,
    sillM: 4.20
  });
  assert.ok(html.includes('Stale (3.5h)'));
  assert.ok(html.includes('Upstream Parrett gauge (52233) is currently stale'));
  assert.ok(!/flatlined/i.test(html), 'neutral wording: never "Flatlined"');

  const healthy = renderSluiceOperationalGauge(sowyEval, {
    upStage: 7.30,
    downStage: 6.90,
    upFreshness: { isFlatlined: false, isStale: false, isOffline: false },
    downFreshness: { isFlatlined: false, isStale: false, isOffline: false },
    triggerM: 7.20,
    sillM: 4.20
  });
  assert.ok(!healthy.includes('Upstream Parrett gauge (52233)'));
});

test('getSluiceHeroStateText covers all four canonical sluice states without claiming gate position', () => {
  assert.equal(getSluiceHeroStateText('DIVERTING'), '🔵 DIVERTING');
  assert.equal(getSluiceHeroStateText('THROTTLED'), '🟡 THROTTLED');
  assert.equal(getSluiceHeroStateText('REVERSE_LOCK'), '🔴 REVERSE LOCK');
  assert.equal(getSluiceHeroStateText('CLOSED'), '🔒 CLOSED · PENNING');
  const appJs = fs.readFileSync(path.join(process.cwd(), 'src/js/app.js'), 'utf8');
  assert.ok(!appJs.includes("'Gate Position'"));
});
