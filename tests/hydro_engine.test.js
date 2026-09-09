import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpillway, evaluateGateState, aggregateGlobalStatus, evaluatePumpStatus, evaluateSowyChannel, estimateClyseFlow, evaluateAthelneySpillway, evaluateGravityClyse, evaluateBeerWall, evaluateOathLock, evaluateDunballEmergencyPumping, getSeasonalRegime, getActiveCrestHeight } from '../src/js/hydro_engine.js';

test('getActiveCrestHeight resolves time-bound crest elevations and fallbacks correctly', () => {
  const config = {
    baseline_crest_mAOD: 7.80,
    crest_history: [
      { valid_from: "1970-01-01T00:00:00Z", valid_to: "2014-04-30T23:59:59Z", crest_mAOD: 7.70, notes: "Pre-2014" },
      { valid_from: "2014-05-01T00:00:00Z", valid_to: null, crest_mAOD: 7.80, notes: "Post-2014 Raising" }
    ]
  };

  const crest2013 = getActiveCrestHeight(config, new Date('2013-12-15T00:00:00Z'), 7.80);
  assert.equal(crest2013, 7.70);

  const crest2026 = getActiveCrestHeight(config, new Date('2026-09-09T00:00:00Z'), 7.80);
  assert.equal(crest2026, 7.80);

  const fallback = getActiveCrestHeight(null, new Date(), 7.45);
  assert.equal(fallback, 7.45);
});

test('getSeasonalRegime evaluates Summer (Apr 15 - Oct 15) vs Winter (Oct 16 - Apr 14) correctly', () => {
  // April 14 is Winter
  const apr14 = getSeasonalRegime(new Date('2026-04-14T12:00:00Z'));
  assert.equal(apr14.isSummer, false);
  assert.equal(apr14.name, 'Winter Flood Regime');

  // April 15 is Summer
  const apr15 = getSeasonalRegime(new Date('2026-04-15T12:00:00Z'));
  assert.equal(apr15.isSummer, true);
  assert.equal(apr15.name, 'Summer Penning Regime');

  // July 15 is Summer
  const jul15 = getSeasonalRegime(new Date('2026-07-15T12:00:00Z'));
  assert.equal(jul15.isSummer, true);

  // October 15 is Summer
  const oct15 = getSeasonalRegime(new Date('2026-10-15T12:00:00Z'));
  assert.equal(oct15.isSummer, true);

  // October 16 is Winter
  const oct16 = getSeasonalRegime(new Date('2026-10-16T12:00:00Z'));
  assert.equal(oct16.isSummer, false);
  assert.equal(oct16.name, 'Winter Flood Regime');

  // January 10 is Winter
  const jan10 = getSeasonalRegime(new Date('2026-01-10T12:00:00Z'));
  assert.equal(jan10.isSummer, false);
});

test('estimateClyseFlow calculates volumetric flow in m3s and MLD correctly', () => {
  const flow = estimateClyseFlow(4.50, 2.65, 4.20);
  assert.ok(flow.flowM3s > 4.0 && flow.flowM3s < 6.0);
  assert.ok(flow.flowMLD > 300);

  const zeroFlow = estimateClyseFlow(3.90, 2.65, 4.20);
  assert.equal(zeroFlow.flowM3s, 0);
  assert.equal(zeroFlow.flowMLD, 0);
});

test('evaluateSowyChannel evaluates OPEN, THROTTLED, and CLOSED states correctly', () => {
  const openState = evaluateSowyChannel(4.50, 2.65, 4.20);
  assert.equal(openState.code, 'GRAVITY_OPEN');
  assert.equal(openState.pillText, '🟢 ACTIVE DIVERSION (DUAL GAUGE)');
  assert.equal(openState.metricText.includes('m³/s'), true);

  const throttledState = evaluateSowyChannel(4.30, 4.28, 4.20);
  assert.equal(throttledState.code, 'THROTTLED');
  assert.equal(throttledState.pillText, '🟡 DIVERSION RESTRICTED (DUAL GAUGE)');

  const closedState = evaluateSowyChannel(3.90, 2.65, 4.20);
  assert.equal(closedState.code, 'CLOSED');
  assert.equal(closedState.pillText, '⚪ PENNING / CLOSED (DUAL GAUGE)');
});

test('evaluateSpillway returns SECURE when river level is below crest', () => {
  const result = evaluateSpillway(7.00, 5.00, 7.45);
  assert.equal(result.code, 'SECURE');
  assert.equal(result.severity, 5);
  assert.equal(result.clearanceText, '+0.45m Clearance');
});

test('evaluateSpillway returns NEAR_CREST when river level is within 15cm of crest', () => {
  const result = evaluateSpillway(7.35, 5.00, 7.45);
  assert.equal(result.code, 'NEAR_CREST');
  assert.equal(result.severity, 4);
});

test('evaluateSpillway returns OVERTOPPING when river level exceeds crest', () => {
  const result = evaluateSpillway(7.63, 7.20, 7.45);
  assert.equal(result.code, 'OVERTOPPING');
  assert.equal(result.severity, 2);
  assert.equal(result.clearanceText, '+18cm over crest');
});

test('evaluateGateState detects TIDE_LOCKED condition', () => {
  const result = evaluateGateState(4.10, 4.85, 1.0);
  assert.equal(result.code, 'TIDE_LOCKED');
});

test('aggregateGlobalStatus ranks worst-case priority correctly', () => {
  const evals = [
    { name: 'Curry Moor System', severity: 2 },
    { name: 'Northmoor & Saltmoor', severity: 2 },
    { name: 'Sowy Relief Channel', severity: 5 },
    { name: 'Dunball Sea Outfall', severity: 5 }
  ];
  const globalStat = aggregateGlobalStatus(evals, true);
  assert.equal(globalStat.bannerText.includes('CRITICAL: CURRY & NORTHMOOR BOTH OVERTOPPING'), true);
  assert.equal(globalStat.counterPill, '[ 🔴 2 Overtopping | 🟡 0 Warning | 🟢 2 Secure ]');
});

test('evaluatePumpStatus infers STANDBY, PARTIAL, FULL, and MOBILE stages correctly', () => {
  const standby = evaluatePumpStatus(3.80, 'Currymoor PS', 2, 4.00, 4.30, 4.40, 4.60, 4.85);
  assert.equal(standby.stage, 0);
  assert.equal(standby.mode, 'STANDBY');
  assert.equal(standby.statusText, '⚪ STANDBY');

  const lead = evaluatePumpStatus(4.15, 'Currymoor PS', 2, 4.00, 4.30, 4.40, 4.60, 4.85);
  assert.equal(lead.stage, 1);
  assert.equal(lead.mode, 'PARTIAL_DUTY');
  assert.equal(lead.statusText, '🟢 1/2 PERMANENT ACTIVE');

  const full = evaluatePumpStatus(4.35, 'Currymoor PS', 2, 4.00, 4.30, 4.40, 4.60, 4.85);
  assert.equal(full.stage, 1);
  assert.equal(full.mode, 'FULL_CAPACITY');
  assert.equal(full.statusText, '🟢 2/2 PERMANENT ACTIVE');

  const mobileOrdered = evaluatePumpStatus(4.46, 'Currymoor PS', 2, 4.00, 4.30, 4.40, 4.60, 4.85);
  assert.equal(mobileOrdered.stage, 2);
  assert.equal(mobileOrdered.mode, 'MOBILE_ORDERED');
  assert.equal(mobileOrdered.mobileStatus, 'MOBILIZING');

  const mobileActive = evaluatePumpStatus(4.65, 'Currymoor PS', 2, 4.00, 4.30, 4.40, 4.60, 4.85);
  assert.equal(mobileActive.stage, 3);
  assert.equal(mobileActive.mode, 'EMERGENCY_MOBILE_ACTIVE');
  assert.equal(mobileActive.mobileStatus, 'OPERATING');
});

test('Saltmoor and Northmoor summer vs winter pump thresholds evaluate correctly', () => {
  // Saltmoor Summer Lead is 4.00m, Winter Lead is 3.40m
  const saltmoorSummerStandby = evaluatePumpStatus(3.90, 'Saltmoor PS', 2, 4.00, 4.20, 4.40, 4.60, 7.80);
  assert.equal(saltmoorSummerStandby.mode, 'STANDBY');

  const saltmoorWinterActive = evaluatePumpStatus(3.50, 'Saltmoor PS', 2, 3.40, 3.70, 3.80, 4.00, 4.25);
  assert.equal(saltmoorWinterActive.mode, 'PARTIAL_DUTY');

  // Northmoor Summer Lead is 4.10m, Winter Lead is 3.50m
  const northmoorSummerStandby = evaluatePumpStatus(4.00, 'Northmoor PS', 2, 4.10, 4.30, 4.50, 4.70, 7.80);
  assert.equal(northmoorSummerStandby.mode, 'STANDBY');

  const northmoorWinterActive = evaluatePumpStatus(3.60, 'Northmoor PS', 2, 3.50, 3.80, 3.90, 4.10, 4.35);
  assert.equal(northmoorWinterActive.mode, 'PARTIAL_DUTY');
});

test('new infrastructure pill evaluation functions return expected status strings', () => {
  assert.ok(evaluateAthelneySpillway(7.00, 7.35).statusText.includes('SECURE'));
  assert.ok(evaluateAthelneySpillway(7.40, 7.35).statusText.includes('OVERTOPPING'));

  assert.ok(evaluateGravityClyse(4.40, 4.20).statusText.includes('GRAVITY DISCHARGING'));
  assert.ok(evaluateGravityClyse(4.10, 4.20).statusText.includes('PENNING'));

  assert.ok(evaluateBeerWall(7.00, 7.30).statusText.includes('SECURE'));
  assert.ok(evaluateBeerWall(7.35, 7.30).statusText.includes('RELIEF SPILL'));

  assert.ok(evaluateOathLock(6.80, 6.40).statusText.includes('PENNING'));
  assert.ok(evaluateOathLock(6.80, 6.70).statusText.includes('GRAVITY PASSING'));

  assert.ok(evaluateDunballEmergencyPumping(2.90, true, 2.80).statusText.includes('HIGH-VOLUME PUMPING ACTIVE'));
  assert.ok(evaluateDunballEmergencyPumping(2.40, false, 2.80).statusText.includes('GRAVITY OK'));
});
