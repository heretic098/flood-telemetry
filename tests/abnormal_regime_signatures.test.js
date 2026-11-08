import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_DEFINITIONS,
  evaluateAssetTransition,
  disambiguateRiverTrend,
  computeTrendVector
} from '../src/js/hydro_engine.js';

test('HYDRO-20: Curry Moor baseline float sawtooth (4.40m - 4.51m) evaluates strictly as STANDBY (Severity 1) with zero false DUTY_PUMPING sessions', () => {
  const polder = ASSET_DEFINITIONS.curry_moor;
  const winterRegime = { isSummer: false, label: 'Winter' };
  const baseTime = new Date('2026-11-01T00:00:00Z').getTime();

  // Generate 96 hours of dry-weather float cycling: oscillating between 4.40m and 4.51m
  // In previous calibrations (4.30m threshold), this produced 95+ hour false DUTY_PUMPING emergencies.
  let activeSession = null;
  for (let step = 0; step < 384; step++) {
    const timeMs = baseTime + step * 15 * 60 * 1000;
    const timeStr = new Date(timeMs).toISOString();
    // Sine wave oscillation between 4.40 and 4.51
    const stage = Number((4.455 + 0.055 * Math.sin((step * Math.PI) / 12)).toFixed(3));
    assert.ok(stage >= 4.40 && stage <= 4.51, `Generated stage ${stage} must be within float cycling window`);

    const readings = [
      { dateTime: timeStr, value: stage },
      { dateTime: new Date(timeMs - 15 * 60 * 1000).toISOString(), value: stage - 0.01 },
      { dateTime: new Date(timeMs - 60 * 60 * 1000).toISOString(), value: stage - 0.02 },
      { dateTime: new Date(timeMs - 180 * 60 * 1000).toISOString(), value: stage - 0.03 }
    ];

    const evalResult = evaluateAssetTransition(polder, activeSession, readings, winterRegime);

    // Assert zero false-positive DUTY_PUMPING
    assert.equal(evalResult.to_state, 'STANDBY', `Stage ${stage}m AOD must remain STANDBY under 4.55m duty threshold`);
    assert.equal(evalResult.severity_tier, 1, `Severity must remain nominal Tier 1 during normal dry-weather cycling`);
    assert.equal(evalResult.action, 'NONE', `Action must be NONE (no event opened or transitioned)`);
  }
});

test('HYDRO-21: Curry Moor flood rise >= 4.55m triggers DUTY_PUMPING and exits at 4.45m deadband boundary', () => {
  const polder = ASSET_DEFINITIONS.curry_moor;
  const winterRegime = { isSummer: false, label: 'Winter' };
  const baseTime = new Date('2026-11-05T12:00:00Z').getTime();

  // 1. Gradual flood rise to 4.58m (> 4.55m threshold, rate +0.05m/h < inrush threshold 0.10m/h) -> opens DUTY_PUMPING
  const riseReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 4.58 },
    { dateTime: new Date(baseTime - 15 * 60 * 1000).toISOString(), value: 4.57 },
    { dateTime: new Date(baseTime - 60 * 60 * 1000).toISOString(), value: 4.53 },
    { dateTime: new Date(baseTime - 180 * 60 * 1000).toISOString(), value: 4.51 }
  ];
  const step1 = evaluateAssetTransition(polder, null, riseReadings, winterRegime);
  assert.equal(step1.action, 'OPEN');
  assert.equal(step1.to_state, 'DUTY_PUMPING');
  assert.equal(step1.severity_tier, 2);
  assert.equal(step1.trigger_stage_mAOD, 4.58);

  const activeSession = {
    status: 'ACTIVE',
    to_state: 'DUTY_PUMPING',
    severity_tier: 2,
    start_time: new Date(baseTime).toISOString(),
    trigger_stage_mAOD: 4.58,
    peak_stage_mAOD: 4.58
  };

  // 2. Recession to 4.48m (between duty 4.55m and exit boundary 4.45m = 4.55 - 0.10m deadband)
  // Hysteresis deadband MUST maintain DUTY_PUMPING to prevent high-frequency flapping
  const recedeReadings1 = [
    { dateTime: new Date(baseTime + 15 * 60 * 1000).toISOString(), value: 4.48 },
    { dateTime: new Date(baseTime).toISOString(), value: 4.58 }
  ];
  const step2 = evaluateAssetTransition(polder, activeSession, recedeReadings1, winterRegime);
  assert.equal(step2.action, 'UPDATE');
  assert.equal(step2.to_state, 'DUTY_PUMPING', 'Must retain DUTY_PUMPING while stage (4.48m) > exit boundary (4.45m)');
  assert.equal(step2.severity_tier, 2);

  // 3. Recession to 4.42m (< 4.45m exit boundary) -> triggers debounce recovery (1/2)
  const recedeReadings2 = [
    { dateTime: new Date(baseTime + 30 * 60 * 1000).toISOString(), value: 4.42 },
    { dateTime: new Date(baseTime + 15 * 60 * 1000).toISOString(), value: 4.48 }
  ];
  const step3 = evaluateAssetTransition(polder, activeSession, recedeReadings2, winterRegime);
  assert.equal(step3.action, 'UPDATE');
  assert.equal(step3.session_updates.consecutiveNominalCount, 1, 'First nominal reading increments debounce count');

  // 4. Second consecutive reading at 4.41m (< 4.45m) -> closes event back to STANDBY
  const activeDebounced = {
    ...activeSession,
    consecutiveNominalCount: 1,
    firstNominalReading: { dateTime: new Date(baseTime + 30 * 60 * 1000).toISOString(), value: 4.42 }
  };
  const recedeReadings3 = [
    { dateTime: new Date(baseTime + 45 * 60 * 1000).toISOString(), value: 4.41 },
    { dateTime: new Date(baseTime + 30 * 60 * 1000).toISOString(), value: 4.42 }
  ];
  const step4 = evaluateAssetTransition(polder, activeDebounced, recedeReadings3, winterRegime);
  assert.equal(step4.action, 'CLOSE');
  assert.equal(step4.to_state, 'STANDBY', 'Second confirmed reading below 4.45m cleanly concludes event');
  assert.equal(step4.severity_tier, 1);
});

test('HYDRO-22: Polder rate diagnostics flag Sump Ceiling Breach and Rapid Spillway Inrush', () => {
  const polder = ASSET_DEFINITIONS.curry_moor;
  const winterRegime = { isSummer: false, label: 'Winter' };
  const baseTime = new Date('2026-11-06T10:00:00Z').getTime();

  // Part A: Sump Ceiling Breach (Curry Moor stage > 4.52m with 3h rate >= +0.02 m/h)
  const breachReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 4.53 }, // Above 4.52m sump ceiling
    { dateTime: new Date(baseTime - 15 * 60 * 1000).toISOString(), value: 4.52 },
    { dateTime: new Date(baseTime - 60 * 60 * 1000).toISOString(), value: 4.49 },
    { dateTime: new Date(baseTime - 180 * 60 * 1000).toISOString(), value: 4.44 } // +0.09m over 3h = +0.03 m/h
  ];
  const breachResult = evaluateAssetTransition(polder, null, breachReadings, winterRegime);
  assert.ok(breachResult.regime_signature, 'Must return regime_signature');
  assert.equal(breachResult.regime_signature.anomaly_type, 'SUMP_CEILING_BREACH');
  assert.ok(breachResult.narrative.includes('Polder Sump Ceiling Breached'), 'Narrative must indicate sump ceiling breach');
  assert.ok(breachResult.narrative.includes('EA Trigger Plan'), 'Must uphold epistemic humility [RULE-HUM-01]');

  // Part B: Rapid Spillway Inrush (1-hour rate >= +0.10 m/h and 15m rate > 0)
  const inrushReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 4.80 },
    { dateTime: new Date(baseTime - 15 * 60 * 1000).toISOString(), value: 4.77 }, // +3cm in 15m > 0
    { dateTime: new Date(baseTime - 60 * 60 * 1000).toISOString(), value: 4.68 }, // +0.12m in 1h = +0.12 m/h >= 0.10
    { dateTime: new Date(baseTime - 180 * 60 * 1000).toISOString(), value: 4.50 }
  ];
  const inrushResult = evaluateAssetTransition(polder, null, inrushReadings, winterRegime);
  assert.ok(inrushResult.regime_signature, 'Must return regime_signature');
  assert.equal(inrushResult.regime_signature.anomaly_type, 'POLDER_INRUSH');
  assert.equal(inrushResult.severity_tier, 3, 'Rapid inrush must escalate severity to Tier 3 Warning');
  assert.ok(inrushResult.narrative.includes('Rapid Inflow Warning'), 'Narrative must indicate rapid inflow warning');
  assert.ok(inrushResult.narrative.includes('EA Trigger Point Plan'), 'Must uphold epistemic humility [RULE-HUM-01]');
});

test('HYDRO-23: Dunball Outfall tide-lock >14h with inland stage >2.65m escalates to Severity Tier 3 (Warning)', () => {
  const gate = ASSET_DEFINITIONS.dunball_outfall;
  const baseTime = new Date('2026-11-06T12:00:00Z').getTime();

  // Active session that started 51,000s ago (> 14.0 hours = 50,400s)
  const startTime = new Date(baseTime - 51000 * 1000).toISOString();
  const activeSession = {
    status: 'ACTIVE',
    to_state: 'TIDE_LOCKED',
    severity_tier: 2,
    start_time: startTime,
    trigger_stage_mAOD: 4.20,
    peak_stage_mAOD: 4.20
  };

  // High tide (sea 4.00m > inland 2.75m), inland elevated > 2.65m and failure to drain (rate 0.00 m/h >= -0.02)
  const readings = {
    sea: [{ dateTime: new Date(baseTime).toISOString(), value: 4.00 }],
    inland: [
      { dateTime: new Date(baseTime).toISOString(), value: 2.75 },
      { dateTime: new Date(baseTime - 15 * 60 * 1000).toISOString(), value: 2.75 },
      { dateTime: new Date(baseTime - 60 * 60 * 1000).toISOString(), value: 2.75 }
    ]
  };

  const result = evaluateAssetTransition(gate, activeSession, readings);
  assert.equal(result.to_state, 'TIDE_LOCKED');
  assert.equal(result.severity_tier, 3, 'Extended tide-lock (>14h with inland >2.65m) must escalate to Tier 3 Warning');
  assert.ok(result.regime_signature, 'Must populate regime_signature');
  assert.equal(result.regime_signature.anomaly_type, 'EXTENDED_TIDE_LOCK');
  assert.ok(result.narrative.includes('Extended Tide-Lock Alert'), 'Narrative must indicate extended tide lock');
  assert.ok(result.narrative.includes('skipped full ebb window'), 'Narrative must cite skipped ebb window');
});

test('HYDRO-23 (Dropout Fail-Safe): Dunball Outfall retains active TIDE_LOCKED when inland sensor is offline', () => {
  const gate = ASSET_DEFINITIONS.dunball_outfall;
  const activeSession = {
    status: 'ACTIVE',
    to_state: 'TIDE_LOCKED',
    severity_tier: 2,
    start_time: '2026-11-06T10:00:00Z',
    trigger_stage_mAOD: 4.50,
    peak_stage_mAOD: 4.50
  };

  // Sea level at 5.00m (high tide), but inland sensor E9094 is offline (null)
  const readings = {
    sea: [{ dateTime: '2026-11-06T12:00:00Z', value: 5.00 }],
    inland: [] // Sensor dropout
  };

  const result = evaluateAssetTransition(gate, activeSession, readings);
  // Zero-trust sensor dropout fail-safe: MUST NOT assume DISCHARGING!
  assert.equal(result.to_state, 'TIDE_LOCKED', 'Must retain active TIDE_LOCKED state during sensor dropout');
  assert.equal(result.severity_tier, 2);
  assert.equal(result.clearance_m, null, 'Must report null clearance when inland sensor is offline');
  assert.equal(result.clearance_text, 'Clearance N/A', 'Must report Clearance N/A instead of false 0cm clearance');
  assert.ok(result.narrative.includes('inland sensor offline'), 'Narrative must flag sensor dropout');
});

test('HYDRO-24: Hookbridge trend badge disambiguates ▲ Tidal Pulse from ▲ Rising on Ebb (Fluvial)', () => {
  const baseTime = new Date('2026-11-06T12:00:00Z').getTime();

  // Create rising readings for Hookbridge (>= +2cm over 3 hours)
  const makeRisingReadings = (latestVal) => [
    { dateTime: new Date(baseTime).toISOString(), value: latestVal },
    { dateTime: new Date(baseTime - 3 * 3600 * 1000).toISOString(), value: latestVal - 0.05 }
  ];

  // 1. Tier 2: Spring Tide Backwater Pulse (Hookbridge 5.80m, Bathpool 7.80m < 8.50m nominal baseflow)
  const tidalPulse = disambiguateRiverTrend(makeRisingReadings(5.80), 7.80, 5.00);
  assert.equal(tidalPulse, '▲ Tidal Pulse', 'Hookbridge rising >= 5.50m with normal upstream Bathpool must evaluate to ▲ Tidal Pulse');

  // 2. Tier 3: Fluvial Rise during Estuary Ebb (Hookbridge 6.45m, Dunball Sea 1.20m low tide)
  const fluvialEbb = disambiguateRiverTrend(makeRisingReadings(6.45), 7.80, 1.20);
  assert.equal(fluvialEbb, '▲ Rising on Ebb (Fluvial)', 'Hookbridge rising >= 6.40m during low tide ebb (< 2.0m) must evaluate to ▲ Rising on Ebb (Fluvial)');

  // 3. Tier 3: High Upland Head Pulse (Hookbridge 6.45m, Bathpool 8.60m >= 8.50m flood pulse)
  const uplandPulse = disambiguateRiverTrend(makeRisingReadings(6.45), 8.60, 4.50);
  assert.equal(uplandPulse, '▲ Rising on Ebb (Fluvial)', 'Hookbridge rising >= 6.40m with high upstream Bathpool head must evaluate to ▲ Rising on Ebb (Fluvial)');

  // 4. Low stage rise (Hookbridge 5.20m < 5.50m threshold) -> returns base trend
  const normalRise = disambiguateRiverTrend(makeRisingReadings(5.20), 7.50, 2.50);
  assert.equal(normalRise, '▲ Rising', 'Hookbridge rising below 5.50m must return canonical ▲ Rising');

  // 5. Steady base trend -> returns — Steady untouched
  const steadyReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 5.80 },
    { dateTime: new Date(baseTime - 3 * 3600 * 1000).toISOString(), value: 5.80 }
  ];
  assert.equal(disambiguateRiverTrend(steadyReadings, 7.50, 4.00), '— Steady');

  // 6. Receding base trend -> returns ▼ Receding untouched
  const recedingReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 5.75 },
    { dateTime: new Date(baseTime - 3 * 3600 * 1000).toISOString(), value: 5.80 }
  ];
  assert.equal(disambiguateRiverTrend(recedingReadings, 7.50, 4.00), '▼ Receding');
});

test('HYDRO-25: Polder Seasonal Regime and Lead/Duty Pump Threshold Parity', () => {
  const cm = ASSET_DEFINITIONS.curry_moor;
  const nm = ASSET_DEFINITIONS.northmoor;

  // Invariant assertions: Seasonal monotonic order
  assert.ok(cm.lead_pump_winter_mAOD < cm.duty_pump_winter_mAOD, 'Curry Moor winter lead < duty');
  assert.ok(cm.lead_pump_summer_mAOD < cm.duty_pump_summer_mAOD, 'Curry Moor summer lead < duty');
  assert.ok(cm.lead_pump_winter_mAOD < cm.lead_pump_summer_mAOD, 'Curry Moor winter lead < summer lead (penning retention)');
  assert.ok(cm.duty_pump_winter_mAOD < cm.duty_pump_summer_mAOD, 'Curry Moor winter duty < summer duty');

  assert.ok(nm.floor_elevation_mAOD < nm.lead_pump_winter_mAOD, 'Northmoor floor < winter lead');
  assert.ok(nm.lead_pump_winter_mAOD < nm.duty_pump_winter_mAOD, 'Northmoor winter lead < duty');
  assert.ok(nm.duty_pump_winter_mAOD <= 3.80, 'Northmoor winter duty <= station alert level 3.80m');

  // Operational transition: 4.65m in winter is DUTY_PUMPING (>= 4.55m), but in summer is STANDBY (< 4.80m)
  const readings = [
    { dateTime: '2026-11-05T12:00:00Z', value: 4.65 },
    { dateTime: '2026-11-05T11:45:00Z', value: 4.64 },
    { dateTime: '2026-11-05T11:00:00Z', value: 4.60 },
    { dateTime: '2026-11-05T09:00:00Z', value: 4.58 }
  ];

  const winterEval = evaluateAssetTransition(cm, null, readings, { isSummer: false });
  assert.equal(winterEval.to_state, 'DUTY_PUMPING', '4.65m must trigger DUTY_PUMPING under winter regime');

  const summerEval = evaluateAssetTransition(cm, null, readings, { isSummer: true });
  assert.equal(summerEval.to_state, 'STANDBY', '4.65m must remain STANDBY under summer penning regime (< 4.80m)');
});
