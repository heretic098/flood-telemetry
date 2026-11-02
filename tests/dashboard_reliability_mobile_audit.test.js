import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateStationFreshness,
  STATION_REGISTRY
} from '../src/js/hydro_engine.js';

import {
  renderHeroSpillwayBanner,
  getValidStageOrFallback,
  startAutoRefresh,
  stopAutoRefresh,
  triggerManualRefresh,
  getAutoRefreshState,
  updateCountdownDisplay
} from '../src/js/app.js';

// Load static assets for inspection
const indexHtml = fs.readFileSync(path.resolve('src/index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.resolve('src/css/styles.css'), 'utf8');
const topologyJs = fs.readFileSync(path.resolve('src/js/topology.js'), 'utf8');
const appJs = fs.readFileSync(path.resolve('src/js/app.js'), 'utf8');

// ---------------------------------------------------------------------------
// 1. Issue #14: evaluateStationFreshness & Ban on Zombie Gauges
// ---------------------------------------------------------------------------

test('Issue #14: evaluateStationFreshness returns offline fallback for empty or missing readings', () => {
  const emptyRes = evaluateStationFreshness([], { fallbackLabel: 'Tone 52118 Baseline' });
  assert.equal(emptyRes.isFresh, false);
  assert.equal(emptyRes.isStale, true);
  assert.equal(emptyRes.isOffline, true);
  assert.equal(emptyRes.badgeText, '⚠️ SENSOR OFFLINE (Tone 52118 Baseline)');
  assert.equal(emptyRes.badgeClass, 'badge-offline');

  const nullRes = evaluateStationFreshness(null, { fallbackLabel: 'Baltmoor Wall Baseline' });
  assert.equal(nullRes.isFresh, false);
  assert.equal(nullRes.isStale, true);
  assert.equal(nullRes.isOffline, true);
  assert.equal(nullRes.badgeText, '⚠️ SENSOR OFFLINE (Baltmoor Wall Baseline)');

  const undefRes = evaluateStationFreshness(undefined);
  assert.equal(undefRes.isFresh, false);
  assert.equal(undefRes.isStale, true);
  assert.equal(undefRes.isOffline, true);
  assert.equal(undefRes.badgeText, '⚠️ SENSOR OFFLINE (Fallback Baseline)');
});

test('Issue #14: evaluateStationFreshness identifies stale readings (> 2 hours) and formats age', () => {
  const nowMs = new Date('2026-11-01T12:00:00Z').getTime();
  const twoAndHalfHoursAgo = new Date('2026-11-01T09:30:00Z').toISOString();

  const staleReadings = [
    { value: 4.52, dateTime: twoAndHalfHoursAgo }
  ];

  const res = evaluateStationFreshness(staleReadings, { nowMs });
  assert.equal(res.isFresh, false);
  assert.equal(res.isStale, true);
  assert.equal(res.isOffline, false);
  assert.equal(res.ageHours, 2.5);
  assert.equal(res.badgeText, '⚠️ SENSOR OFFLINE (Showing 2.5h old reading)');
  assert.equal(res.badgeClass, 'badge-stale');
});

test('Issue #14: evaluateStationFreshness preserves nominal fresh state (<= 2 hours) with zero false alarm', () => {
  const nowMs = new Date('2026-11-01T12:00:00Z').getTime();
  const fifteenMinsAgo = new Date('2026-11-01T11:45:00Z').toISOString();

  const freshReadings = [
    { value: 4.50, dateTime: fifteenMinsAgo }
  ];

  const res = evaluateStationFreshness(freshReadings, { nowMs });
  assert.equal(res.isFresh, true);
  assert.equal(res.isStale, false);
  assert.equal(res.isOffline, false);
  assert.equal(res.badgeText, null);
  assert.equal(res.badgeClass, 'badge-fresh');
});

test('Issue #14: getValidStageOrFallback safely returns fallback value on invalid data', () => {
  assert.equal(getValidStageOrFallback([], 4.50), 4.50);
  assert.equal(getValidStageOrFallback(null, 7.80), 7.80);
  assert.equal(getValidStageOrFallback(undefined, 3.20), 3.20);
  assert.equal(getValidStageOrFallback([{ value: null }], 4.50), 4.50);
  assert.equal(getValidStageOrFallback([{ value: NaN }], 4.50), 4.50);
  assert.equal(getValidStageOrFallback([{ value: 'invalid' }], 4.50), 4.50);
  assert.equal(getValidStageOrFallback([{ value: 5.67 }], 4.50), 5.67);
  assert.equal(getValidStageOrFallback([6.12], 4.50), 6.12);
});

test('Issue #14: renderHeroSpillwayBanner never renders calm green when stale/offline', () => {
  // Stale scenario: badgeClass was badge-secure, but staleInfo is provided
  const staleBannerHtml = renderHeroSpillwayBanner({
    title: 'Hookbridge Spillway',
    statusBadge: { label: 'SECURE', badgeClass: 'badge-secure', symbol: '✓' },
    mainMetricValue: '4.50',
    mainMetricUnit: 'mAOD',
    staleInfo: {
      isStale: true,
      isOffline: false,
      badgeText: '⚠️ SENSOR OFFLINE (Showing 2.5h old reading)',
      badgeClass: 'badge-stale'
    }
  });

  assert.ok(staleBannerHtml.includes('sensor-offline-banner'), 'Must render sensor-offline-banner');
  assert.ok(staleBannerHtml.includes('⚠️ SENSOR OFFLINE (Showing 2.5h old reading)'));
  assert.ok(!staleBannerHtml.includes('class="status-badge badge-secure"'), 'Must NOT render calm green badge-secure when stale');
  assert.ok(staleBannerHtml.includes('badge-stale'), 'Must use warning amber badge-stale');

  // Offline fallback scenario
  const offlineBannerHtml = renderHeroSpillwayBanner({
    title: 'Hookbridge Spillway',
    statusBadge: { label: 'SECURE', badgeClass: 'badge-secure', symbol: '✓' },
    mainMetricValue: '4.50',
    mainMetricUnit: 'mAOD',
    staleInfo: {
      isStale: true,
      isOffline: true,
      badgeText: '⚠️ SENSOR OFFLINE (Fallback Baseline)',
      badgeClass: 'badge-offline'
    }
  });

  assert.ok(offlineBannerHtml.includes('⚠️ SENSOR OFFLINE (Fallback Baseline)'));
  assert.ok(!offlineBannerHtml.includes('class="status-badge badge-secure"'), 'Must NOT render calm green badge-secure when offline');
  assert.ok(offlineBannerHtml.includes('badge-offline'), 'Must use muted slate badge-offline');

  // Fresh scenario: preserves badge-secure and zero offline banner
  const freshBannerHtml = renderHeroSpillwayBanner({
    title: 'Hookbridge Spillway',
    statusBadge: { label: 'SECURE', badgeClass: 'badge-secure', symbol: '✓' },
    mainMetricValue: '4.50',
    mainMetricUnit: 'mAOD',
    staleInfo: null
  });

  assert.ok(!freshBannerHtml.includes('sensor-offline-banner'), 'Fresh banner must not render offline banner');
  assert.ok(freshBannerHtml.includes('badge-secure'), 'Fresh banner must render nominal secure badge');
});

// ---------------------------------------------------------------------------
// 2. Issue #13: Real-Time Auto-Refresh Loop & Countdown Timer
// ---------------------------------------------------------------------------

test('Issue #13: Auto-refresh lifecycle exports start, stop, manual trigger, and state', async () => {
  stopAutoRefresh();
  let state = getAutoRefreshState();
  assert.equal(state.isRunning, false);

  startAutoRefresh(45000);
  state = getAutoRefreshState();
  assert.equal(state.isRunning, true);
  assert.equal(state.intervalMs, 45000);
  assert.equal(state.remainingSec, 45);

  stopAutoRefresh();
  state = getAutoRefreshState();
  assert.equal(state.isRunning, false);
});

test('Issue #13: index.html contains countdown pill, manual refresh button, and updated modal subtext', () => {
  assert.ok(indexHtml.includes('id="countdown-pill"'), 'index.html must contain #countdown-pill');
  assert.ok(indexHtml.includes('role="status"'), 'countdown pill must have role="status"');
  assert.ok(indexHtml.includes('id="btn-refresh-now"'), 'index.html must contain #btn-refresh-now');
  assert.ok(indexHtml.includes('aria-label="Refresh live telemetry now"'), 'manual refresh button must have accessible aria-label');
  assert.ok(indexHtml.includes('60s Auto Refresh'), 'modal must advertise 60s Auto Refresh aligned with server cadence');
  assert.ok(!indexHtml.includes('3-Min Auto Refresh'), 'modal must NOT claim obsolete 3-Min Auto Refresh');
});

test('Issue #13: styles.css contains styles and 44x44px touch targets for refresh controls', () => {
  assert.ok(stylesCss.includes('.auto-refresh-group'), 'styles.css must style .auto-refresh-group');
  assert.ok(stylesCss.includes('.countdown-pill'), 'styles.css must style .countdown-pill');
  assert.ok(stylesCss.includes('.refresh-now-btn'), 'styles.css must style .refresh-now-btn');

  // Verify touch target min dimensions on .refresh-now-btn
  const btnMatch = stylesCss.match(/\.refresh-now-btn\s*\{[\s\S]*?\}/);
  assert.ok(btnMatch, '.refresh-now-btn rule must exist in styles.css');
  assert.ok(btnMatch[0].includes('min-height: 44px;'), 'refresh button must enforce min-height: 44px');
  assert.ok(btnMatch[0].includes('min-width: 44px;'), 'refresh button must enforce min-width: 44px');
});

// ---------------------------------------------------------------------------
// 3. Issue #15: Mobile Ergonomics & 360px-375px Horizontal Overflow Fix
// ---------------------------------------------------------------------------

test('Issue #15: styles.css enforces @media (max-width: 480px) with single column and zero overflow', () => {
  assert.ok(stylesCss.includes('@media (max-width: 480px)'), 'styles.css must include @media (max-width: 480px)');

  const mediaMatch = stylesCss.match(/@media\s*\(max-width:\s*480px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(mediaMatch, '@media (max-width: 480px) block must exist in styles.css');
  const mediaBody = mediaMatch[1];

  // Zero horizontal overflow on html and body
  assert.ok(mediaBody.includes('overflow-x: hidden;'), 'media query must enforce overflow-x: hidden');
  assert.ok(mediaBody.includes('padding: 0.75rem;'), 'media query must reduce body padding to 0.75rem (eliminating 48px horizontal blowout)');

  // Grid container single column
  assert.ok(mediaBody.includes('grid-template-columns: 1fr;'), 'media query must enforce 1fr on .grid-container, removing 340px minmax blowout');

  // Header element stacking
  assert.ok(mediaBody.includes('.header-top'), 'media query must adapt .header-top');
  assert.ok(mediaBody.includes('.nav-links'), 'media query must adapt .nav-links');
  assert.ok(mediaBody.includes('.time-preset-group'), 'media query must adapt .time-preset-group');
  assert.ok(mediaBody.includes('.header-right-group'), 'media query must adapt .header-right-group');
  assert.ok(mediaBody.includes('.auto-refresh-group'), 'media query must adapt .auto-refresh-group');
});

test('Issue #15: topology.js scrolls inspector drawer smoothly to top on mobile (<1024px)', () => {
  assert.ok(
    topologyJs.includes("drawer.scrollIntoView({ behavior: 'smooth', block: 'start' })"),
    'topology.js inspectNode must smoothly scroll drawer into view with block: start on mobile (<1024px)'
  );
});

test('Issue #15: styles.css contains modal backdrop and tooltip overflow constraints', () => {
  assert.ok(
    stylesCss.includes('.sys-health-backdrop:not(.open)'),
    'styles.css must set display: none on .sys-health-backdrop when closed to prevent DOM layout blowout'
  );
  assert.ok(
    stylesCss.includes('max-width: 260px;'),
    'styles.css must constrain max-width on tooltip pseudo elements to prevent horizontal blowout'
  );
});
