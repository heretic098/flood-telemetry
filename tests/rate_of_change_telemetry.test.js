import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  computeStageRates,
  computeBatchStageRates,
  computeRateOfChange3h,
  RATE_TOLERANCE_WINDOWS,
  evaluateAssetTransition,
  ASSET_DEFINITIONS
} from '../src/js/hydro_engine.js';

import { runMigrations } from '../src/js/db_migrations.js';
import {
  rehydrateActiveSessions,
  processTelemetryEvents,
  resetActiveSessions,
  getActiveSessions
} from '../src/js/event_manager.js';

test('Rate of Change Engine: computeStageRates calculates 15m delta, 1h rate, and 3h rate accurately', () => {
  const baseTimeMs = new Date('2026-11-08T12:00:00Z').getTime();

  // Create standard 15-minute series: stage rising from 5.00m to 5.48m over 3 hours
  // 12 intervals of 15m. Each 15m step rises +0.04m (+0.16 m/hr)
  const readings = [];
  for (let i = 0; i <= 12; i++) {
    readings.push({
      dateTime: new Date(baseTimeMs - i * 15 * 60 * 1000).toISOString(),
      value: Number((5.48 - i * 0.04).toFixed(2))
    });
  }

  // Target is index 0 (5.48m at 12:00:00Z)
  const rates = computeStageRates(readings, 0);

  // 15m lookback: reading 1 is 5.44m at 11:45:00Z. delta = 5.48 - 5.44 = +0.04m. rate = 0.04 / 0.25h = 0.160 m/h
  assert.equal(rates.delta_15m_m, 0.04);
  assert.equal(rates.rate_15m_m_per_hr, 0.160);

  // 1h lookback: reading 4 is 5.32m at 11:00:00Z. delta = 5.48 - 5.32 = +0.16m. rate = 0.16 / 1.0h = 0.160 m/h
  assert.equal(rates.rate_1h_m_per_hr, 0.160);

  // 3h lookback: reading 12 is 5.00m at 09:00:00Z. delta = 5.48 - 5.00 = +0.48m. rate = 0.48 / 3.0h = 0.160 m/h
  assert.equal(rates.rate_3h_m_per_hr, 0.160);
});

test('Rate of Change Engine: gap safety returns null when readings fall outside tolerance windows [RULE-SUB-01]', () => {
  const targetTime = new Date('2026-11-08T12:00:00Z').getTime();

  // Scenario: Sensor had an outage from 09:00 to 12:00 (a 3-hour dropout!)
  // Only readings available are target (12:00) and an old reading from 08:30 (210m ago)
  const readings = [
    { dateTime: new Date(targetTime).toISOString(), value: 6.20 },
    { dateTime: new Date(targetTime - 220 * 60 * 1000).toISOString(), value: 5.50 } // 220 mins ago (outside 3h window [150, 210])
  ];

  const rates = computeStageRates(readings, 0);

  // All must be null: no reading exists within 15m [10, 25], 1h [45, 75], or 3h [150, 210] windows
  assert.equal(rates.delta_15m_m, null, '15m delta must be null during outage');
  assert.equal(rates.rate_15m_m_per_hr, null, '15m rate must be null during outage');
  assert.equal(rates.rate_1h_m_per_hr, null, '1h rate must be null during outage');
  assert.equal(rates.rate_3h_m_per_hr, null, '3h rate must be null during outage');
});

test('Rate of Change Engine: flatline behavior returns 0.000 for steady levels within tolerance', () => {
  const baseTimeMs = new Date('2026-11-08T12:00:00Z').getTime();

  // Create flatline series: constant 4.50m
  const readings = [];
  for (let i = 0; i <= 12; i++) {
    readings.push({
      dateTime: new Date(baseTimeMs - i * 15 * 60 * 1000).toISOString(),
      value: 4.50
    });
  }

  const rates = computeStageRates(readings, 0);
  assert.equal(rates.delta_15m_m, 0.000);
  assert.equal(rates.rate_15m_m_per_hr, 0.000);
  assert.equal(rates.rate_1h_m_per_hr, 0.000);
  assert.equal(rates.rate_3h_m_per_hr, 0.000);
});

test('Rate of Change Engine: computeBatchStageRates executes O(N) linear time on large series', () => {
  const baseTimeMs = new Date('2026-11-08T12:00:00Z').getTime();
  const N = 2000; // 2000 readings (~20 days of 15-min readings)

  const rawReadings = [];
  for (let i = 0; i < N; i++) {
    rawReadings.push({
      dateTime: new Date(baseTimeMs - i * 15 * 60 * 1000).toISOString(),
      value: 3.0 + Math.sin(i / 10) * 0.5
    });
  }

  const startMs = performance.now();
  const enriched = computeBatchStageRates(rawReadings);
  const elapsedMs = performance.now() - startMs;

  assert.equal(enriched.length, N);
  assert.ok(elapsedMs < 100, `Batch computation must complete in <100ms (took ${elapsedMs.toFixed(2)}ms)`);

  // Target item at index 0 should have populated rates
  assert.ok(typeof enriched[0].delta_15m_m === 'number');
  assert.ok(typeof enriched[0].rate_1h_m_per_hr === 'number');
  assert.ok(typeof enriched[0].rate_3h_m_per_hr === 'number');
});

test('Event Crest Plateau Invariant: peak_time latches first arrival and does not drift during plateau [RULE-HUM-01]', () => {
  const cutsRoadDef = ASSET_DEFINITIONS.cuts_road;
  const t0 = '2026-11-08T04:00:00Z';
  const t1 = '2026-11-08T04:15:00Z';
  const t2 = '2026-11-08T04:30:00Z';
  const t3 = '2026-11-08T04:45:00Z';

  // Step 1: Road becomes impassable at t0, stage 7.40m (> crown 7.35m)
  const window0 = {
    primary: [{ dateTime: t0, value: 7.40 }]
  };
  const decision0 = evaluateAssetTransition(cutsRoadDef, null, window0, 'WINTER', { timestamp: t0 });
  assert.equal(decision0.action, 'OPEN');
  assert.equal(decision0.peak_stage_mAOD, 7.40);
  assert.equal(decision0.peak_time, t0);

  const session = {
    id: 1,
    asset_type: 'road',
    asset_id: 'cuts_road',
    to_state: 'IMPASSABLE',
    severity_tier: 4,
    start_time: t0,
    trigger_stage_mAOD: 7.40,
    peak_stage_mAOD: 7.40,
    peak_time: t0,
    status: 'ACTIVE'
  };

  // Step 2: Rises to peak crest 7.55m at t1
  const window1 = {
    primary: [
      { dateTime: t1, value: 7.55 },
      { dateTime: t0, value: 7.40 }
    ]
  };
  const decision1 = evaluateAssetTransition(cutsRoadDef, session, window1, 'WINTER', { timestamp: t1 });
  assert.equal(decision1.action, 'UPDATE');
  assert.equal(decision1.peak_stage_mAOD, 7.55);
  assert.equal(decision1.peak_time, t1, 'peak_time updates to t1 when new peak is reached');

  // Update session in-memory state
  session.peak_stage_mAOD = 7.55;
  session.peak_time = t1;

  // Step 3: Plateau! Stage remains at 7.55m at t2 (15 mins later)
  const window2 = {
    primary: [
      { dateTime: t2, value: 7.55 },
      { dateTime: t1, value: 7.55 },
      { dateTime: t0, value: 7.40 }
    ]
  };
  const decision2 = evaluateAssetTransition(cutsRoadDef, session, window2, 'WINTER', { timestamp: t2 });
  assert.equal(decision2.action, 'UPDATE');
  assert.equal(decision2.peak_stage_mAOD, 7.55);
  assert.equal(decision2.peak_time, t1, 'peak_time MUST remain t1 (first arrival) during plateau [RULE-HUM-01]');

  // Step 4: Plateau continues! Stage remains at 7.55m at t3 (30 mins later)
  const window3 = {
    primary: [
      { dateTime: t3, value: 7.55 },
      { dateTime: t2, value: 7.55 },
      { dateTime: t1, value: 7.55 },
      { dateTime: t0, value: 7.40 }
    ]
  };
  const decision3 = evaluateAssetTransition(cutsRoadDef, session, window3, 'WINTER', { timestamp: t3 });
  assert.equal(decision3.action, 'UPDATE');
  assert.equal(decision3.peak_stage_mAOD, 7.55);
  assert.equal(decision3.peak_time, t1, 'peak_time MUST NOT drift to t3 during plateau');
});

test('Event Manager Lifecycle & Rehydration: persists rates and peak_time and survives crash rehydration', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  resetActiveSessions();

  const baseMs = new Date('2026-11-01T08:00:00Z').getTime();

  // Create readings simulating a rapid flood wave on Cuts Road (station 52127)
  const stationReadings = [];
  for (let i = 12; i >= 0; i--) {
    const time = new Date(baseMs + (12 - i) * 15 * 60 * 1000).toISOString();
    // Stage rises from 6.80m to 7.70m (triggering IMPASSABLE at 7.35m crown)
    const val = Number((6.80 + (12 - i) * 0.075).toFixed(3));
    stationReadings.push({ dateTime: time, value: val });
  }

  const storedTelemetry = {
    measures: {
      '52127-level-stage-i-15_min-mAOD': stationReadings
    }
  };

  // Process batch through event manager
  processTelemetryEvents(db, storedTelemetry);

  const activeSessions = getActiveSessions();
  const cutsRoadSession = activeSessions.find(s => s.asset_id === 'cuts_road');
  assert.ok(cutsRoadSession, 'cuts_road event must be ACTIVE');
  assert.equal(cutsRoadSession.to_state, 'IMPASSABLE');
  assert.ok(cutsRoadSession.peak_time, 'cuts_road event must have peak_time');
  assert.ok(typeof cutsRoadSession.max_rate_1h_m_per_hr === 'number');

  // Verify DB record has all rate and peak columns populated
  const row = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'cuts_road' AND status = 'ACTIVE'").get();
  assert.ok(row.peak_time, 'DB row must have peak_time');
  assert.ok(row.trigger_rate_1h_m_per_hr !== null, 'trigger_rate_1h_m_per_hr must be recorded');
  assert.ok(row.max_rate_1h_m_per_hr !== null, 'max_rate_1h_m_per_hr must be recorded');

  // Simulate server crash & reboot: reset memory and call rehydrateActiveSessions
  resetActiveSessions();
  assert.equal(getActiveSessions().length, 0);

  rehydrateActiveSessions(db);
  const rehydrated = getActiveSessions().find(s => s.asset_id === 'cuts_road');
  assert.ok(rehydrated, 'Session must rehydrate from DB');
  assert.equal(rehydrated.peak_time, row.peak_time, 'Rehydrated peak_time must match DB');
  assert.equal(rehydrated.trigger_rate_1h_m_per_hr, row.trigger_rate_1h_m_per_hr);
  assert.equal(rehydrated.max_rate_1h_m_per_hr, row.max_rate_1h_m_per_hr);
});
