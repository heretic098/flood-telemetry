import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/js/db_migrations.js';
import {
  rehydrateActiveSessions,
  getActiveSessions,
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
