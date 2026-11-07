import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/js/db_migrations.js';
import {
  rehydrateActiveSessions,
  getActiveSessions,
  getLastProcessedTimestamps,
  resetActiveSessions,
  buildStationReadingsMap,
  processTelemetryEvents
} from '../src/js/event_manager.js';
import { ASSET_DEFINITIONS } from '../src/js/hydro_engine.js';

function setupTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  resetActiveSessions();
  return db;
}

test('Event Manager: buildStationReadingsMap correctly applies geodetic datum offsets', () => {
  const measures = {
    '52108-level-stage-i-15_min-mASD': [
      { dateTime: '2026-11-01T12:00:00Z', value: 0.45 }
    ],
    '52118-level-stage-i-15_min-mAOD': [
      { dateTime: '2026-11-01T12:00:00Z', value: 7.42 }
    ]
  };

  const map = buildStationReadingsMap(measures);

  // Greenham (52108) datum is +75.69m AOD
  assert.equal(map['52108'][0].value, Number((0.45 + 75.69).toFixed(2)));
  // Hookbridge (52118) datum offset is 0.00m (already mAOD)
  assert.equal(map['52118'][0].value, 7.42);
});

test('Event Manager: opens active event when stage exceeds threshold', () => {
  const db = setupTestDb();

  // Feed Hookbridge at 7.35m AOD (NEAR_CREST warning threshold)
  const stored = {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 7.35 }
      ]
    }
  };

  const decisions = processTelemetryEvents(db, stored, {
    timestamp: '2026-11-01T12:00:00Z'
  });

  const hookDecision = decisions.find(d => d.asset_id === 'hookbridge');
  assert.ok(hookDecision);
  assert.equal(hookDecision.action, 'OPEN');
  assert.equal(hookDecision.to_state, 'NEAR_CREST');
  assert.equal(hookDecision.severity_tier, 3);

  // Check database
  const activeRow = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge' AND status = 'ACTIVE'").get();
  assert.ok(activeRow);
  assert.equal(activeRow.to_state, 'NEAR_CREST');
  assert.equal(activeRow.severity_tier, 3);
  assert.equal(activeRow.trigger_stage_mAOD, 7.35);
  assert.equal(activeRow.peak_stage_mAOD, 7.35);
  assert.equal(activeRow.end_time, null);

  // Check in-memory session tracking
  const activeSessions = getActiveSessions();
  const session = activeSessions.find(s => s.asset_id === 'hookbridge');
  assert.ok(session);
  assert.equal(session.id, activeRow.id);
});

test('Event Manager: updates peak_stage_mAOD during subsequent elevated polling cycles', () => {
  const db = setupTestDb();

  // Cycle 1: Hookbridge rises to 7.35m AOD (NEAR_CREST)
  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 7.35 }
      ]
    }
  });

  // Cycle 2: Hookbridge rises to 7.50m AOD (OVERTOPPING)
  const decisions = processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:15:00Z', value: 7.50 }
      ]
    }
  });

  const hookDecision = decisions.find(d => d.asset_id === 'hookbridge');
  assert.equal(hookDecision.action, 'UPDATE');
  assert.equal(hookDecision.to_state, 'OVERTOPPING');
  assert.equal(hookDecision.severity_tier, 4);
  assert.equal(hookDecision.peak_stage_mAOD, 7.50);

  // Database must reflect updated state and peak
  const updatedRow = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge' AND status = 'ACTIVE'").get();
  assert.ok(updatedRow);
  assert.equal(updatedRow.to_state, 'OVERTOPPING');
  assert.equal(updatedRow.severity_tier, 4);
  assert.equal(updatedRow.peak_stage_mAOD, 7.50);
});

test('Event Manager: enforces 30-min debounce window and stamps end_time at 1st nominal reading upon 2nd confirmation', () => {
  const db = setupTestDb();

  // Cycle 1: Open event at 7.35m AOD
  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 7.35 }
      ]
    }
  });

  // Cycle 2: First nominal reading at 7.10m AOD (Receding below deadband) -> action UPDATE (debouncing)
  const d2 = processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:15:00Z', value: 7.10 }
      ]
    }
  });
  const hookD2 = d2.find(d => d.asset_id === 'hookbridge');
  assert.equal(hookD2.action, 'UPDATE');
  assert.equal(hookD2.session_updates.consecutiveNominalCount, 1);

  // Verify event remains ACTIVE in DB
  const stillActive = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge' AND status = 'ACTIVE'").get();
  assert.ok(stillActive);

  // Cycle 3: Second consecutive nominal reading at 7.08m AOD -> action CLOSE
  const d3 = processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:30:00Z', value: 7.08 }
      ]
    }
  });
  const hookD3 = d3.find(d => d.asset_id === 'hookbridge');
  assert.equal(hookD3.action, 'CLOSE');
  assert.equal(hookD3.end_time, '2026-11-01T12:15:00Z'); // Stamped at 1st nominal reading!
  assert.equal(hookD3.duration_seconds, 900); // 12:00 to 12:15 = 15 mins = 900s

  // Verify DB reflects CLOSED
  const closedRow = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge'").get();
  assert.equal(closedRow.status, 'CLOSED');
  assert.equal(closedRow.end_time, '2026-11-01T12:15:00Z');
  assert.equal(closedRow.duration_seconds, 900);

  // Verify removed from active in-memory sessions
  assert.equal(getActiveSessions().length, 0);
});

test('Event Manager: rehydrateActiveSessions reloads in-memory state cleanly across server reboot', () => {
  const db = setupTestDb();

  // Create an active event in the database
  db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, from_state, to_state, severity_tier,
      start_time, end_time, duration_seconds, trigger_stage_mAOD,
      peak_stage_mAOD, clearance_m, narrative, status
    ) VALUES (
      'spillway', 'hookbridge', 'SECURE', 'OVERTOPPING', 4,
      '2026-11-01T11:00:00Z', NULL, NULL, 7.46,
      7.55, -0.10, 'Hookbridge is overtopping', 'ACTIVE'
    )
  `).run();

  // Simulate server reboot: clear in-memory sessions
  resetActiveSessions();
  assert.equal(getActiveSessions().length, 0);

  // Run rehydration
  const rehydrated = rehydrateActiveSessions(db);
  assert.equal(rehydrated.size, 1);
  const session = rehydrated.get('hookbridge');
  assert.ok(session);
  assert.equal(session.to_state, 'OVERTOPPING');
  assert.equal(session.peak_stage_mAOD, 7.55);

  // Next polling cycle: receives 7.60m AOD -> should UPDATE existing session, NOT OPEN new one
  const decisions = processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T11:15:00Z', value: 7.60 }
      ]
    }
  });

  const hookD = decisions.find(d => d.asset_id === 'hookbridge');
  assert.equal(hookD.action, 'UPDATE');
  assert.equal(hookD.peak_stage_mAOD, 7.60);

  // Ensure still only 1 record in telemetry_events (no duplicate opened)
  const rows = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].peak_stage_mAOD, 7.60);
});

test('Event Manager (Issue #37): multi-reading batch replay processes chronologically and captures mid-batch peak', () => {
  const db = setupTestDb();

  // Initial cycle: establish baseline at 7.00m AOD
  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 7.00 }
      ]
    }
  });

  // Batch cycle: 3 unseen readings delivered in a single poll representing a fast-moving flood:
  // 1. 12:15: rises to 7.35m (NEAR_CREST, Tier 3)
  // 2. 12:30: crests to 7.52m (OVERTOPPING, Tier 4)
  // 3. 12:45: drops to 7.20m (Receding, starts recovery debounce)
  // Feed them out-of-order / newest first as EA API delivers:
  const batchStored = {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:45:00Z', value: 7.20 },
        { dateTime: '2026-11-01T12:30:00Z', value: 7.52 },
        { dateTime: '2026-11-01T12:15:00Z', value: 7.35 },
        { dateTime: '2026-11-01T12:00:00Z', value: 7.00 }
      ]
    }
  };

  const decisions = processTelemetryEvents(db, batchStored);
  const hookDecisions = decisions.filter(d => d.asset_id === 'hookbridge');
  assert.equal(hookDecisions.length, 3, 'Must evaluate all 3 unseen chronological readings');

  // Decision 1 (12:15) opened incident
  assert.equal(hookDecisions[0].action, 'OPEN');
  assert.equal(hookDecisions[0].to_state, 'NEAR_CREST');
  assert.equal(hookDecisions[0].severity_tier, 3);
  assert.equal(hookDecisions[0].start_time, '2026-11-01T12:15:00Z');

  // Decision 2 (12:30) crested to OVERTOPPING
  assert.equal(hookDecisions[1].action, 'UPDATE');
  assert.equal(hookDecisions[1].to_state, 'OVERTOPPING');
  assert.equal(hookDecisions[1].severity_tier, 4);
  assert.equal(hookDecisions[1].peak_stage_mAOD, 7.52);

  // Decision 3 (12:45) dropped below crest, entered debounce, but retained peak stage 7.52m and peak severity 4
  assert.equal(hookDecisions[2].action, 'UPDATE');
  assert.equal(hookDecisions[2].peak_stage_mAOD, 7.52, 'Must retain mid-batch peak stage');
  assert.equal(hookDecisions[2].severity_tier, 4, 'Must retain mid-batch peak severity tier');
  assert.equal(hookDecisions[2].session_updates.consecutiveNominalCount, 1);

  // Database verification
  const row = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge' AND status = 'ACTIVE'").get();
  assert.ok(row);
  assert.equal(row.peak_stage_mAOD, 7.52);
  assert.equal(row.severity_tier, 4);
  assert.equal(row.start_time, '2026-11-01T12:15:00Z');
});

test('Event Manager (Issue #37 Bug 2): river gauges resolve alert threshold via reg.alert_level_mAOD and trigger ALERT', () => {
  const db = setupTestDb();

  // Gaw Bridge (52119) alert_level_mAOD = 12.80m AOD
  assert.equal(ASSET_DEFINITIONS['52119'].alert_elevation_mAOD, 12.80, 'Asset definition must resolve 12.80m AOD alert elevation');

  const stored = {
    measures: {
      '52119-level-stage-i-15_min-mASD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 2.85 } // 2.85m + 10.00m datum = 12.85m AOD (> 12.80m alert)
      ]
    }
  };

  const decisions = processTelemetryEvents(db, stored);
  const gaugeDecision = decisions.find(d => d.asset_id === '52119');
  assert.ok(gaugeDecision);
  assert.equal(gaugeDecision.action, 'OPEN');
  assert.equal(gaugeDecision.to_state, 'ALERT');
  assert.equal(gaugeDecision.severity_tier, 3);
  assert.equal(gaugeDecision.from_state, 'NORMAL');

  const row = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = '52119' AND status = 'ACTIVE'").get();
  assert.ok(row);
  assert.equal(row.to_state, 'ALERT');
  assert.equal(row.severity_tier, 3);
  assert.equal(row.from_state, 'NORMAL');
});

test('Event Manager (Issue #37 Bug 3): newly opened events have canonical from_state matching asset_type', () => {
  const db = setupTestDb();

  // Test road opening (from_state must be PASSABLE, never null)
  const roadStored = {
    measures: {
      '52127-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 7.40 } // Cuts road crown 7.35m
      ]
    }
  };
  const roadDecisions = processTelemetryEvents(db, roadStored);
  const roadD = roadDecisions.find(d => d.asset_id === 'cuts_road');
  assert.ok(roadD);
  assert.equal(roadD.action, 'OPEN');
  assert.equal(roadD.from_state, 'PASSABLE');

  const roadRow = db.prepare("SELECT from_state FROM telemetry_events WHERE asset_id = 'cuts_road'").get();
  assert.equal(roadRow.from_state, 'PASSABLE');
});

test('Event Manager (Issue #37 Bug 4): peak severity is latched and retained upon event closure', () => {
  const db = setupTestDb();

  // Cycle 1: Open Hookbridge directly at Severity 4 (7.52m AOD OVERTOPPING)
  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 7.52 }
      ]
    }
  });

  // Cycle 2: Drops to nominal 7.10m AOD (Debounce 1/2)
  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:15:00Z', value: 7.10 }
      ]
    }
  });

  // Cycle 3: Drops to nominal 7.08m AOD (Debounce 2/2 -> CLOSE)
  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:30:00Z', value: 7.08 }
      ]
    }
  });

  // Closed database row must preserve peak severity 4 and peak stage 7.52m
  const closedRow = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge'").get();
  assert.equal(closedRow.status, 'CLOSED');
  assert.equal(closedRow.severity_tier, 4, 'Closed event must preserve peak severity tier 4 (not overwritten to 1)');
  assert.equal(closedRow.peak_stage_mAOD, 7.52, 'Closed event must preserve peak stage');
  assert.equal(closedRow.duration_seconds, 900);
});

test('Event Manager (Issue #37 Bug 1): backfill guard clamps replay to MAX_REPLAY_BATCH_SIZE (32)', () => {
  const db = setupTestDb();

  // Establish initial baseline
  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T00:00:00Z', value: 7.00 }
      ]
    }
  });

  // Now feed 50 unseen readings (e.g. from telemetry backfill)
  const baseMs = new Date('2026-11-01T01:00:00Z').getTime();
  const fiftyReadings = Array.from({ length: 50 }, (_, i) => ({
    dateTime: new Date(baseMs + i * 15 * 60 * 1000).toISOString(),
    value: 7.00
  })).reverse(); // Newest first

  const decisions = processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': fiftyReadings
    }
  });

  const hookDecisions = decisions.filter(d => d.asset_id === 'hookbridge');
  assert.equal(hookDecisions.length, 32, 'Must clamp batch replay to exactly MAX_REPLAY_BATCH_SIZE (32) readings');
});

test('Event Manager (Issue #37): hermetic test isolation resets both activeSessions and lastProcessedTimestamps', () => {
  const db = setupTestDb();

  processTelemetryEvents(db, {
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-01T12:00:00Z', value: 7.35 }
      ]
    }
  });

  assert.ok(getLastProcessedTimestamps().size > 0, 'Last processed timestamps must track evaluated assets');

  resetActiveSessions();

  assert.equal(getActiveSessions().length, 0, 'Active sessions must be cleared');
  assert.equal(getLastProcessedTimestamps().size, 0, 'Last processed timestamps must be hermetically cleared');
});
