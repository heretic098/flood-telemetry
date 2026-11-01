import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_DEFINITIONS,
  HYDRO_DEADBANDS,
  computeTrendVector,
  formatClearanceText,
  evaluateAssetTransition
} from '../src/js/hydro_engine.js';
import { CANONICAL_ASSET_TYPES, CANONICAL_STATES } from '../src/js/db_migrations.js';

test('Telemetry Events: ASSET_DEFINITIONS covers all 6 canonical asset types', () => {
  const assets = Object.values(ASSET_DEFINITIONS);
  assert.ok(assets.length >= 6);

  const typesFound = new Set(assets.map(a => a.asset_type));
  for (const t of CANONICAL_ASSET_TYPES) {
    assert.ok(typesFound.has(t), `Asset definitions must contain asset_type: ${t}`);
  }

  // Verify key surveyed assets
  assert.equal(ASSET_DEFINITIONS.cuts_road.crown_elevation_mAOD, 7.35);
  assert.equal(ASSET_DEFINITIONS.muchelney_access.crown_elevation_mAOD, 7.86);
  assert.equal(ASSET_DEFINITIONS.hookbridge.crest_elevation_mAOD, 7.45);
  assert.equal(ASSET_DEFINITIONS.baltmoor_wall.crest_elevation_mAOD, 7.80);
  assert.equal(ASSET_DEFINITIONS.beer_wall.crest_elevation_mAOD, 7.30);
  assert.equal(ASSET_DEFINITIONS.curry_moor.floor_elevation_mAOD, 2.10);
  assert.equal(ASSET_DEFINITIONS.northmoor.floor_elevation_mAOD, 1.80);
  assert.equal(ASSET_DEFINITIONS.dunball_outfall.asset_type, 'tidal_gate');
  assert.equal(ASSET_DEFINITIONS.monks_leaze_clyse.asset_type, 'sluice');
});

test('Telemetry Events: formatClearanceText enforces Centimetre Rule (<1m -> whole cm, >=1m -> metres)', () => {
  // Sub-metre clearances MUST be in whole centimetres (Rule 3.1)
  assert.equal(formatClearanceText(0.18, 'spillway crest'), '18cm below spillway crest');
  assert.equal(formatClearanceText(0.08, 'crest'), '8cm below crest');
  assert.equal(formatClearanceText(0.85, 'road crown'), '85cm below road crown');

  // Metre clearances >= 1.00m formatted in metres with 2 decimals
  assert.equal(formatClearanceText(1.45, 'crest'), '+1.45m clearance to crest');
  assert.equal(formatClearanceText(2.50, 'road crown'), '+2.50m clearance to road crown');

  // Overtopping (negative clearance)
  assert.equal(formatClearanceText(-0.14, 'crest'), '▲ Overtopping by +14cm');
  assert.equal(formatClearanceText(-1.20, 'crest'), '▲ Overtopping by +1.20m');
});

test('Telemetry Events: computeTrendVector detects Rising, Receding, and Steady over 3 hours', () => {
  const baseTime = new Date('2026-11-01T12:00:00Z').getTime();

  // 1. Rising (>= +2cm / 3h)
  const risingReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 7.45 },
    { dateTime: new Date(baseTime - 3 * 3600 * 1000).toISOString(), value: 7.40 } // +5cm rise
  ];
  assert.equal(computeTrendVector(risingReadings), '▲ Rising');

  // 2. Receding (<= -2cm / 3h)
  const recedingReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 7.35 },
    { dateTime: new Date(baseTime - 3 * 3600 * 1000).toISOString(), value: 7.40 } // -5cm drop
  ];
  assert.equal(computeTrendVector(recedingReadings), '▼ Receding');

  // 3. Steady (< 2cm change)
  const steadyReadings = [
    { dateTime: new Date(baseTime).toISOString(), value: 7.41 },
    { dateTime: new Date(baseTime - 3 * 3600 * 1000).toISOString(), value: 7.40 } // +1cm change
  ];
  assert.equal(computeTrendVector(steadyReadings), '— Steady');
});

test('Telemetry Events: evaluateAssetTransition opens, tracks peak, and updates spillway event', () => {
  const asset = ASSET_DEFINITIONS.hookbridge; // Crest 7.45m, Pre-spill 7.30m

  // Step 1: Nominal baseflow (7.10m AOD) -> action NONE
  const step1 = evaluateAssetTransition(asset, null, [
    { dateTime: '2026-11-01T10:00:00Z', value: 7.10 }
  ]);
  assert.equal(step1.action, 'NONE');
  assert.equal(step1.to_state, 'SECURE');
  assert.equal(step1.severity_tier, 1);
  assert.equal(step1.clearance_text, '35cm below spillway crest');

  // Step 2: Rises into pre-spill warning (7.35m AOD) -> action OPEN (Tier 3)
  const step2 = evaluateAssetTransition(asset, null, [
    { dateTime: '2026-11-01T10:15:00Z', value: 7.35 }
  ]);
  assert.equal(step2.action, 'OPEN');
  assert.equal(step2.to_state, 'NEAR_CREST');
  assert.equal(step2.severity_tier, 3);
  assert.equal(step2.trigger_stage_mAOD, 7.35);
  assert.equal(step2.peak_stage_mAOD, 7.35);
  assert.equal(step2.start_time, '2026-11-01T10:15:00Z');

  // Step 3: Rises into active overtopping (7.52m AOD) -> action UPDATE (Tier 4)
  const activeSessionStep2 = {
    status: 'ACTIVE',
    to_state: 'NEAR_CREST',
    severity_tier: 3,
    start_time: '2026-11-01T10:15:00Z',
    trigger_stage_mAOD: 7.35,
    peak_stage_mAOD: 7.35,
    consecutiveNominalCount: 0
  };

  const step3 = evaluateAssetTransition(asset, activeSessionStep2, [
    { dateTime: '2026-11-01T10:30:00Z', value: 7.52 }
  ]);
  assert.equal(step3.action, 'UPDATE');
  assert.equal(step3.to_state, 'OVERTOPPING');
  assert.equal(step3.severity_tier, 4);
  assert.equal(step3.peak_stage_mAOD, 7.52);
  assert.equal(step3.clearance_text, '▲ Overtopping by +7cm');
});

test('Telemetry Events: deadband hysteresis prevents flapping on falling stages', () => {
  const asset = ASSET_DEFINITIONS.hookbridge; // Crest 7.45m, Deadband weir_crest: 0.03m -> Exit at 7.42m

  const activeOvertoppingSession = {
    status: 'ACTIVE',
    to_state: 'OVERTOPPING',
    severity_tier: 4,
    start_time: '2026-11-01T10:00:00Z',
    trigger_stage_mAOD: 7.50,
    peak_stage_mAOD: 7.55,
    consecutiveNominalCount: 0
  };

  // Stage drops slightly to 7.44m (1cm below crest, but inside the 3cm deadband [7.42m])
  const stepFlap = evaluateAssetTransition(asset, activeOvertoppingSession, [
    { dateTime: '2026-11-01T10:15:00Z', value: 7.44 }
  ]);

  // MUST remain in OVERTOPPING due to deadband hysteresis
  assert.equal(stepFlap.to_state, 'OVERTOPPING');
  assert.equal(stepFlap.severity_tier, 4);

  // Stage drops further to 7.40m (below 7.42m exit) -> falls back to NEAR_CREST (Tier 3)
  const stepExit = evaluateAssetTransition(asset, activeOvertoppingSession, [
    { dateTime: '2026-11-01T10:30:00Z', value: 7.40 }
  ]);
  assert.equal(stepExit.to_state, 'NEAR_CREST');
  assert.equal(stepExit.severity_tier, 3);
});

test('Telemetry Events: 30-minute debounce window stamps end_time at 1st nominal reading on 2nd confirmation', () => {
  const asset = ASSET_DEFINITIONS.hookbridge; // Pre-spill exit is (7.30 - 0.05) = 7.25m AOD

  const activeNearCrestSession = {
    status: 'ACTIVE',
    to_state: 'NEAR_CREST',
    severity_tier: 3,
    start_time: '2026-11-01T10:00:00Z',
    trigger_stage_mAOD: 7.35,
    peak_stage_mAOD: 7.40,
    consecutiveNominalCount: 0,
    firstNominalReading: null
  };

  // Step 1: First nominal reading below 7.25m (e.g. 7.20m AOD at 10:30)
  const stepNominal1 = evaluateAssetTransition(asset, activeNearCrestSession, [
    { dateTime: '2026-11-01T10:30:00Z', value: 7.20 }
  ]);

  // Must NOT close yet; maintains active cooldown with consecutiveNominalCount = 1
  assert.equal(stepNominal1.action, 'UPDATE');
  assert.equal(stepNominal1.session_updates.consecutiveNominalCount, 1);
  assert.equal(stepNominal1.session_updates.firstNominalReading.dateTime, '2026-11-01T10:30:00Z');

  // Step 2: Second consecutive nominal reading (7.18m AOD at 10:45)
  const sessionAfterNominal1 = {
    ...activeNearCrestSession,
    consecutiveNominalCount: 1,
    firstNominalReading: { dateTime: '2026-11-01T10:30:00Z', value: 7.20 }
  };

  const stepNominal2 = evaluateAssetTransition(asset, sessionAfterNominal1, [
    { dateTime: '2026-11-01T10:45:00Z', value: 7.18 }
  ]);

  // Must CLOSE on the 2nd confirmed reading!
  assert.equal(stepNominal2.action, 'CLOSE');
  assert.equal(stepNominal2.to_state, 'SECURE');
  assert.equal(stepNominal2.severity_tier, 1);

  // Chronological Accuracy: end_time MUST be stamped with 1st nominal reading (10:30), not 2nd (10:45)!
  assert.equal(stepNominal2.end_time, '2026-11-01T10:30:00Z');

  // Duration: 10:00 to 10:30 = 30 minutes = 1800 seconds
  assert.equal(stepNominal2.duration_seconds, 1800);
});

test('Telemetry Events: Zero-Trust sensor dropout freezes active session in TELEMETRY_INTERRUPTED without closing', () => {
  const asset = ASSET_DEFINITIONS.cuts_road; // Crown 7.35m

  const activeFloodSession = {
    status: 'ACTIVE',
    to_state: 'IMPASSABLE',
    severity_tier: 4,
    start_time: '2026-11-01T10:00:00Z',
    trigger_stage_mAOD: 7.38,
    peak_stage_mAOD: 7.42,
    consecutiveNominalCount: 0
  };

  // Sensor returns null/offline reading
  const stepDropout = evaluateAssetTransition(asset, activeFloodSession, [
    { dateTime: '2026-11-01T10:15:00Z', value: null }
  ]);

  // Action MUST be UPDATE (not CLOSE), preserving active duration and peak
  assert.equal(stepDropout.action, 'UPDATE');
  assert.equal(stepDropout.to_state, 'TELEMETRY_INTERRUPTED');
  assert.equal(stepDropout.severity_tier, 4);
  assert.equal(stepDropout.peak_stage_mAOD, 7.42);
  assert.equal(stepDropout.start_time, '2026-11-01T10:00:00Z');
  assert.equal(stepDropout.end_time, null);
  assert.ok(stepDropout.narrative.includes('TELEMETRY_INTERRUPTED'));
});

test('Telemetry Events: Road transitions evaluate PASSABLE, ENCROACHING, IMPASSABLE accurately', () => {
  const road = ASSET_DEFINITIONS.cuts_road; // Crown 7.35m, Caution 7.00m

  // 1. Dry road (6.80m)
  const t1 = evaluateAssetTransition(road, null, [{ dateTime: '2026-11-01T12:00:00Z', value: 6.80 }]);
  assert.equal(t1.to_state, 'PASSABLE');
  assert.equal(t1.severity_tier, 1);
  assert.equal(t1.clearance_text, '55cm below road crown');

  // 2. Margin encroachment (7.15m)
  const t2 = evaluateAssetTransition(road, null, [{ dateTime: '2026-11-01T12:15:00Z', value: 7.15 }]);
  assert.equal(t2.action, 'OPEN');
  assert.equal(t2.to_state, 'ENCROACHING');
  assert.equal(t2.severity_tier, 3);

  // 3. Road crown submerged (7.40m)
  const activeEncroaching = {
    status: 'ACTIVE',
    to_state: 'ENCROACHING',
    severity_tier: 3,
    start_time: '2026-11-01T12:15:00Z',
    trigger_stage_mAOD: 7.15,
    peak_stage_mAOD: 7.15
  };
  const t3 = evaluateAssetTransition(road, activeEncroaching, [{ dateTime: '2026-11-01T12:30:00Z', value: 7.40 }]);
  assert.equal(t3.action, 'UPDATE');
  assert.equal(t3.to_state, 'IMPASSABLE');
  assert.equal(t3.severity_tier, 4);
  assert.equal(t3.peak_stage_mAOD, 7.40);
  assert.equal(t3.clearance_text, '▲ Overtopping by +5cm');
});

test('Telemetry Events: Polder transitions evaluate DUTY_PUMPING, MOBILE_ORDERED, MOBILE_ACTIVE, CRITICAL', () => {
  const polder = ASSET_DEFINITIONS.curry_moor; // Winter duty 4.30m, Ordered 5.80m, Active 6.10m, Critical 6.50m
  const winterRegime = { isSummer: false, label: 'Winter' };

  // 1. Standby
  const p1 = evaluateAssetTransition(polder, null, [{ dateTime: '2026-11-01T12:00:00Z', value: 3.50 }], winterRegime);
  assert.equal(p1.to_state, 'STANDBY');
  assert.equal(p1.severity_tier, 1);

  // 2. Duty Pumping (4.35m)
  const p2 = evaluateAssetTransition(polder, null, [{ dateTime: '2026-11-01T12:15:00Z', value: 4.35 }], winterRegime);
  assert.equal(p2.action, 'OPEN');
  assert.equal(p2.to_state, 'DUTY_PUMPING');
  assert.equal(p2.severity_tier, 2);

  // 3. Mobile Ordered (5.85m)
  const activeDuty = { status: 'ACTIVE', to_state: 'DUTY_PUMPING', severity_tier: 2, start_time: '2026-11-01T12:15:00Z', trigger_stage_mAOD: 4.35, peak_stage_mAOD: 4.35 };
  const p3 = evaluateAssetTransition(polder, activeDuty, [{ dateTime: '2026-11-01T12:30:00Z', value: 5.85 }], winterRegime);
  assert.equal(p3.action, 'UPDATE');
  assert.equal(p3.to_state, 'MOBILE_ORDERED');
  assert.equal(p3.severity_tier, 3);

  // 4. Mobile Active (6.15m)
  const activeOrdered = { ...activeDuty, to_state: 'MOBILE_ORDERED', severity_tier: 3, peak_stage_mAOD: 5.85 };
  const p4 = evaluateAssetTransition(polder, activeOrdered, [{ dateTime: '2026-11-01T12:45:00Z', value: 6.15 }], winterRegime);
  assert.equal(p4.action, 'UPDATE');
  assert.equal(p4.to_state, 'MOBILE_ACTIVE');
  assert.equal(p4.severity_tier, 3);

  // 5. Critical (6.55m)
  const activeMobile = { ...activeOrdered, to_state: 'MOBILE_ACTIVE', peak_stage_mAOD: 6.15 };
  const p5 = evaluateAssetTransition(polder, activeMobile, [{ dateTime: '2026-11-01T13:00:00Z', value: 6.55 }], winterRegime);
  assert.equal(p5.action, 'UPDATE');
  assert.equal(p5.to_state, 'CRITICAL');
  assert.equal(p5.severity_tier, 4);
  assert.equal(p5.peak_stage_mAOD, 6.55);
});

test('Telemetry Events: Tidal Gate evaluates DISCHARGING vs TIDE_LOCKED with head differential', () => {
  const gate = ASSET_DEFINITIONS.dunball_outfall;

  // 1. Low tide in estuary: safe gravity discharge (Sea: 1.20m, Inland: 2.50m)
  const t1 = evaluateAssetTransition(gate, null, {
    sea: [{ dateTime: '2026-11-01T12:00:00Z', value: 1.20 }],
    inland: [{ dateTime: '2026-11-01T12:00:00Z', value: 2.50 }]
  });
  assert.equal(t1.action, 'NONE');
  assert.equal(t1.to_state, 'DISCHARGING');
  assert.equal(t1.severity_tier, 1);
  assert.equal(t1.clearance_m, 1.30); // 1.30m positive head

  // 2. High spring tide: seals tide-locked (Sea: 3.50m, Inland: 2.50m)
  const t2 = evaluateAssetTransition(gate, null, {
    sea: [{ dateTime: '2026-11-01T12:15:00Z', value: 3.50 }],
    inland: [{ dateTime: '2026-11-01T12:15:00Z', value: 2.50 }]
  });
  assert.equal(t2.action, 'OPEN');
  assert.equal(t2.to_state, 'TIDE_LOCKED');
  assert.equal(t2.severity_tier, 2);
});

test('Telemetry Events: Sluice evaluates CLOSED, DIVERTING, THROTTLED, REVERSE_LOCK', () => {
  const sluice = ASSET_DEFINITIONS.monks_leaze_clyse; // Trigger 7.20m, Capacity 7.60m

  // 1. Normal penning / closed (Parrett: 6.50m, Sowy: 4.80m)
  const s1 = evaluateAssetTransition(sluice, null, {
    upstream: [{ dateTime: '2026-11-01T12:00:00Z', value: 6.50 }],
    downstream: [{ dateTime: '2026-11-01T12:00:00Z', value: 4.80 }]
  });
  assert.equal(s1.action, 'NONE');
  assert.equal(s1.to_state, 'CLOSED');
  assert.equal(s1.severity_tier, 1);

  // 2. Active flood diversion (Parrett: 7.40m, Sowy: 5.50m)
  const s2 = evaluateAssetTransition(sluice, null, {
    upstream: [{ dateTime: '2026-11-01T12:15:00Z', value: 7.40 }],
    downstream: [{ dateTime: '2026-11-01T12:15:00Z', value: 5.50 }]
  });
  assert.equal(s2.action, 'OPEN');
  assert.equal(s2.to_state, 'DIVERTING');
  assert.equal(s2.severity_tier, 2);

  // 3. Throttled by high tailwater (Parrett: 7.63m, Sowy: 7.61m capacity full, delta < 0.05m)
  const s3 = evaluateAssetTransition(sluice, { status: 'ACTIVE', to_state: 'DIVERTING', severity_tier: 2, start_time: '2026-11-01T12:15:00Z', trigger_stage_mAOD: 7.40, peak_stage_mAOD: 7.40 }, {
    upstream: [{ dateTime: '2026-11-01T12:30:00Z', value: 7.63 }],
    downstream: [{ dateTime: '2026-11-01T12:30:00Z', value: 7.61 }]
  });
  assert.equal(s3.to_state, 'THROTTLED');
  assert.equal(s3.severity_tier, 3);

  // 4. Reverse Lock (downstream higher than upstream: Sowy 7.65m > Parrett 7.50m)
  const s4 = evaluateAssetTransition(sluice, null, {
    upstream: [{ dateTime: '2026-11-01T12:45:00Z', value: 7.50 }],
    downstream: [{ dateTime: '2026-11-01T12:45:00Z', value: 7.65 }]
  });
  assert.equal(s4.to_state, 'REVERSE_LOCK');
  assert.equal(s4.severity_tier, 3);
});

test('Telemetry Events: all evaluated states belong strictly to the 19 closed canonical dictionary states', () => {
  const dictionary = new Set(CANONICAL_STATES);

  const testCases = [
    { asset: ASSET_DEFINITIONS.hookbridge, readings: [{ value: 7.55 }] },
    { asset: ASSET_DEFINITIONS.hookbridge, readings: [{ value: 7.35 }] },
    { asset: ASSET_DEFINITIONS.hookbridge, readings: [{ value: 6.90 }] },
    { asset: ASSET_DEFINITIONS.cuts_road, readings: [{ value: 7.40 }] },
    { asset: ASSET_DEFINITIONS.cuts_road, readings: [{ value: 7.10 }] },
    { asset: ASSET_DEFINITIONS.cuts_road, readings: [{ value: 6.50 }] },
    { asset: ASSET_DEFINITIONS.curry_moor, readings: [{ value: 6.60 }] },
    { asset: ASSET_DEFINITIONS.curry_moor, readings: [{ value: 6.20 }] },
    { asset: ASSET_DEFINITIONS.curry_moor, readings: [{ value: 5.90 }] },
    { asset: ASSET_DEFINITIONS.curry_moor, readings: [{ value: 4.40 }] },
    { asset: ASSET_DEFINITIONS.curry_moor, readings: [{ value: 3.50 }] },
    { asset: ASSET_DEFINITIONS.dunball_outfall, readings: { sea: [{ value: 4.0 }], inland: [{ value: 2.0 }] } },
    { asset: ASSET_DEFINITIONS.dunball_outfall, readings: { sea: [{ value: 1.0 }], inland: [{ value: 2.0 }] } },
    { asset: ASSET_DEFINITIONS.monks_leaze_clyse, readings: { upstream: [{ value: 7.4 }], downstream: [{ value: 5.0 }] } },
    { asset: ASSET_DEFINITIONS['52108'], readings: [{ value: 77.0 }] },
    { asset: ASSET_DEFINITIONS['52108'], readings: [{ value: 75.9 }] }
  ];

  for (const tc of testCases) {
    const res = evaluateAssetTransition(tc.asset, null, tc.readings);
    assert.ok(
      dictionary.has(res.to_state),
      `Evaluated state '${res.to_state}' for asset '${tc.asset.asset_id}' must belong to the closed canonical dictionary`
    );
  }
});
