/**
 * Tests for Environment Agency Flood Alerts & Warnings Engine (Issue #39)
 * 
 * Verifies:
 * - Migration v7 schema DDL, partial unique indexes, and CHECK constraints.
 * - EA warnings polling lifecycle (OPEN, UPDATE, CLOSE) with immutable trigger snapshots.
 * - Zero-Trust Dropout Guard (empty feed preserves active sessions).
 * - SSRF host pinning and narrative sanitization.
 * - Summary metrics and active warning state mapping for road passability.
 * - Data contracts and [RULE-CALC-01] cumecs ban.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/js/db_migrations.js';
import {
  pollAndProcessEAWarnings,
  sanitizeEANarrative,
  mapSeverityLevelToLabel,
  capture12StationSnapshot,
  getEAWarningsSummary,
  getActiveEAWarningStatesMap,
  getEAWarnings,
  resetWarningManagerState,
  SNAPSHOT_STATION_IDS
} from '../src/js/ea_warning_manager.js';
import {
  validateEAWarningsIngestPayload,
  validateApiWarningsPayload
} from '../src/js/contracts/ea_warnings_schema.js';
import { EA_FLOOD_AREA_CATALOG } from '../src/js/hydro_engine.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

test('Migration v7: Provisions ea_warning_events schema and indices', () => {
  const db = createTestDb();
  const version = db.pragma('user_version', { simple: true });
  assert.equal(version, 7, 'user_version must be 7');

  const tableInfo = db.prepare("PRAGMA table_info(ea_warning_events)").all();
  const colNames = tableInfo.map(c => c.name);

  const expectedCols = [
    'id', 'warning_id', 'target_area_notation', 'area_name',
    'severity_level', 'severity_label', 'time_raised',
    'time_severity_changed', 'time_message_changed', 'time_cleared',
    'duration_seconds', 'narrative', 'trigger_snapshot_json',
    'latest_snapshot_json', 'associated_roads_json', 'status'
  ];

  for (const col of expectedCols) {
    assert.ok(colNames.includes(col), `Column ${col} must exist in ea_warning_events`);
  }

  // Partial unique index test: exactly one active warning per target area
  const insertStmt = db.prepare(`
    INSERT INTO ea_warning_events (
      warning_id, target_area_notation, area_name,
      severity_level, severity_label, time_raised,
      narrative, trigger_snapshot_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run('W1', '112FWFCUR10A', 'Curry Moor', 2, 'Flood Warning', '2026-11-08T10:00:00Z', 'Test', '{}', 'ACTIVE');

  // Attempt duplicate active session -> must throw SQLite constraint error
  assert.throws(() => {
    insertStmt.run('W2', '112FWFCUR10A', 'Curry Moor', 2, 'Flood Warning', '2026-11-08T11:00:00Z', 'Test duplicate', '{}', 'ACTIVE');
  }, /UNIQUE constraint failed/);

  // Closed records for the same target area are allowed
  db.prepare(`UPDATE ea_warning_events SET status = 'CLOSED' WHERE warning_id = 'W1'`).run();
  assert.doesNotThrow(() => {
    insertStmt.run('W3', '112FWFCUR10A', 'Curry Moor', 2, 'Flood Warning', '2026-11-08T12:00:00Z', 'Test new active', '{}', 'ACTIVE');
  });

  db.close();
});

test('Sanitization & Labels: sanitizeEANarrative strips control characters and escapes HTML', () => {
  const dirty = 'River Tone <script>alert("xss")</script>\x00\x08 rising fast at Hookbridge.';
  const clean = sanitizeEANarrative(dirty);
  assert.ok(!clean.includes('<script>'), 'Must escape HTML tags');
  assert.ok(clean.includes('&lt;script&gt;'), 'Must encode HTML entities');
  assert.ok(!clean.includes('\x00'), 'Must strip null bytes');
  assert.ok(!clean.includes('\x08'), 'Must strip backspace control char');

  // Clamping test
  const huge = 'A'.repeat(3000);
  assert.equal(sanitizeEANarrative(huge).length, 2048, 'Must clamp narrative to 2048 characters');

  // Labels
  assert.equal(mapSeverityLevelToLabel(1), 'Severe Flood Warning');
  assert.equal(mapSeverityLevelToLabel(2), 'Flood Warning');
  assert.equal(mapSeverityLevelToLabel(3), 'Flood Alert');
  assert.equal(mapSeverityLevelToLabel(4), 'Warning Removed');
});

test('12-Station Snapshot: capture12StationSnapshot extracts mAOD and rates for all 12 strategic stations', () => {
  const dummyMeasures = {
    '52118-level-stage-i-15_min-mAOD': [
      { dateTime: '2026-11-08T12:00:00Z', value: 7.38 },
      { dateTime: '2026-11-08T11:00:00Z', value: 7.30 }
    ],
    '52127-level-stage-i-15_min-mAOD': [
      { dateTime: '2026-11-08T12:00:00Z', value: 6.15 },
      { dateTime: '2026-11-08T11:00:00Z', value: 6.10 }
    ]
  };

  const snapshot = capture12StationSnapshot(dummyMeasures, { timestamp: '2026-11-08T12:00:00Z' });
  assert.equal(snapshot.captured_at, '2026-11-08T12:00:00Z');
  assert.equal(Object.keys(snapshot.stations).length, SNAPSHOT_STATION_IDS.length);

  const hookbridge = snapshot.stations['52118'];
  assert.equal(hookbridge.name, 'Hookbridge Spillway / Currymoor PS');
  assert.equal(hookbridge.stage_mAOD, 7.38);
  assert.equal(hookbridge.clearance_to_crest_m, 0.07); // 7.45 - 7.38 = 0.07m

  const curryMoor = snapshot.stations['52127'];
  assert.equal(curryMoor.name, 'Curry Moor Basin');
  assert.equal(curryMoor.stage_mAOD, 6.15);
});

test('Lifecycle State Machine: Opens, preserves trigger snapshot, updates latest snapshot, and closes cleanly', async () => {
  resetWarningManagerState();
  const db = createTestDb();

  const dummyMeasures = {
    '52118-level-stage-i-15_min-mAOD': [{ dateTime: '2026-11-08T10:00:00Z', value: 7.35 }]
  };

  // Cycle 1: EA issues Flood Alert (severity 3)
  const feedCycle1 = {
    items: [
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/floods/W-100',
        floodAreaID: '112FWFCUR10A',
        severityLevel: 3,
        severity: 'Flood Alert',
        timeRaised: '2026-11-08T10:00:00Z',
        message: 'River Tone rising, Curry Moor alert active.'
      }
    ]
  };

  const mockFetch1 = async () => ({
    ok: true,
    json: async () => feedCycle1
  });

  const res1 = await pollAndProcessEAWarnings(db, mockFetch1, new Date('2026-11-08T10:05:00Z').getTime(), {
    measures: dummyMeasures
  });

  assert.equal(res1.processed, 1);
  assert.equal(res1.active_count, 1);

  const row1 = db.prepare("SELECT * FROM ea_warning_events WHERE target_area_notation = '112FWFCUR10A'").get();
  assert.equal(row1.status, 'ACTIVE');
  assert.equal(row1.severity_level, 3);
  assert.equal(row1.severity_label, 'Flood Alert');
  assert.ok(row1.trigger_snapshot_json.includes('7.35'), 'Trigger snapshot must record initial water level');
  assert.equal(row1.latest_snapshot_json, null, 'latest_snapshot_json must be null on initial creation');

  // Cycle 2: EA updates narrative text only (message changed) -> trigger snapshot must NOT be overwritten!
  const feedCycle2 = {
    items: [
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/floods/W-100',
        floodAreaID: '112FWFCUR10A',
        severityLevel: 3,
        severity: 'Flood Alert',
        timeRaised: '2026-11-08T10:00:00Z',
        timeMessageChanged: '2026-11-08T12:00:00Z',
        message: 'River Tone continues to rise; updated situation report.'
      }
    ]
  };

  const dummyMeasures2 = {
    '52118-level-stage-i-15_min-mAOD': [{ dateTime: '2026-11-08T12:00:00Z', value: 7.42 }]
  };

  const mockFetch2 = async () => ({
    ok: true,
    json: async () => feedCycle2
  });

  await pollAndProcessEAWarnings(db, mockFetch2, new Date('2026-11-08T12:05:00Z').getTime(), {
    measures: dummyMeasures2
  });

  const row2 = db.prepare("SELECT * FROM ea_warning_events WHERE target_area_notation = '112FWFCUR10A'").get();
  assert.equal(row2.narrative, 'River Tone continues to rise; updated situation report.');
  assert.ok(row2.trigger_snapshot_json.includes('7.35'), 'trigger_snapshot_json must NOT be updated on narrative changes');
  assert.equal(row2.latest_snapshot_json, null);

  // Cycle 3: EA escalates to Flood Warning (severity 2) -> latest_snapshot_json is updated, trigger_snapshot stays immutable
  const feedCycle3 = {
    items: [
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/floods/W-100',
        floodAreaID: '112FWFCUR10A',
        severityLevel: 2,
        severity: 'Flood Warning',
        timeRaised: '2026-11-08T10:00:00Z',
        timeSeverityChanged: '2026-11-08T14:00:00Z',
        message: 'Flood Warning issued for Curry Moor.'
      }
    ]
  };

  const dummyMeasures3 = {
    '52118-level-stage-i-15_min-mAOD': [{ dateTime: '2026-11-08T14:00:00Z', value: 7.48 }]
  };

  const mockFetch3 = async () => ({
    ok: true,
    json: async () => feedCycle3
  });

  await pollAndProcessEAWarnings(db, mockFetch3, new Date('2026-11-08T14:05:00Z').getTime(), {
    measures: dummyMeasures3
  });

  const row3 = db.prepare("SELECT * FROM ea_warning_events WHERE target_area_notation = '112FWFCUR10A'").get();
  assert.equal(row3.severity_level, 2);
  assert.equal(row3.severity_label, 'Flood Warning');
  assert.ok(row3.trigger_snapshot_json.includes('7.35'), 'trigger_snapshot_json remains initial trigger');
  assert.ok(row3.latest_snapshot_json.includes('7.48'), 'latest_snapshot_json captures escalation stage');

  // Cycle 4: EA lifts warning (severity 4 in feed) -> transitions to CLOSED, peak severity (2) is preserved
  const feedCycle4 = {
    items: [
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/floods/W-100',
        floodAreaID: '112FWFCUR10A',
        severityLevel: 4,
        severity: 'Warning Removed',
        timeRaised: '2026-11-08T10:00:00Z',
        timeSeverityChanged: '2026-11-08T18:00:00Z'
      }
    ]
  };

  const mockFetch4 = async () => ({
    ok: true,
    json: async () => feedCycle4
  });

  const res4 = await pollAndProcessEAWarnings(db, mockFetch4, new Date('2026-11-08T18:05:00Z').getTime());
  assert.equal(res4.cleared, 1);
  assert.equal(res4.active_count, 0);

  const row4 = db.prepare("SELECT * FROM ea_warning_events WHERE target_area_notation = '112FWFCUR10A'").get();
  assert.equal(row4.status, 'CLOSED');
  assert.equal(row4.severity_level, 2, 'Peak severity must be permanently preserved on closure (NOT overwritten with 4)');
  assert.equal(row4.time_cleared, '2026-11-08T18:00:00Z');
  assert.equal(row4.duration_seconds, 28800); // 8 hours (10:00 to 18:00)

  db.close();
});

test('Zero-Trust Dropout Guard: Empty feed never spuriously clears active warnings', async () => {
  resetWarningManagerState();
  const db = createTestDb();

  // Seed active warning
  db.prepare(`
    INSERT INTO ea_warning_events (
      warning_id, target_area_notation, area_name,
      severity_level, severity_label, time_raised,
      narrative, trigger_snapshot_json, status
    ) VALUES ('W-ACTIVE', '112FWFCUR10A', 'Curry Moor', 2, 'Flood Warning', '2026-11-08T10:00:00Z', 'Test', '{}', 'ACTIVE')
  `).run();

  // EA feed returns HTTP 200 with empty items array (API dropout / transient cache reset)
  const emptyFeed = { items: [] };
  const mockFetch = async () => ({
    ok: true,
    json: async () => emptyFeed
  });

  const res = await pollAndProcessEAWarnings(db, mockFetch, Date.now());
  assert.equal(res.preserved, true, 'Must preserve active sessions on empty feed');
  assert.equal(res.active_count, 1, 'Active warning must remain open');

  const row = db.prepare("SELECT status FROM ea_warning_events WHERE warning_id = 'W-ACTIVE'").get();
  assert.equal(row.status, 'ACTIVE', 'Status must stay ACTIVE');

  db.close();
});

test('SSRF Guard: Rejects non-HTTPS protocol or unapproved domains', async () => {
  resetWarningManagerState();
  const db = createTestDb();

  await assert.rejects(async () => {
    await pollAndProcessEAWarnings(db, globalThis.fetch, Date.now(), {
      url: 'http://environment.data.gov.uk/flood-monitoring/id/floods'
    });
  }, /SSRF Blocked: Unapproved protocol/);

  await assert.rejects(async () => {
    await pollAndProcessEAWarnings(db, globalThis.fetch, Date.now(), {
      url: 'https://evil-attacker.com/flood-monitoring/id/floods'
    });
  }, /SSRF Blocked: Unapproved protocol 'https:' or host 'evil-attacker.com'/);

  db.close();
});

test('Summary & State Maps: getEAWarningsSummary and getActiveEAWarningStatesMap return accurate metrics', () => {
  const db = createTestDb();

  db.prepare(`
    INSERT INTO ea_warning_events (
      warning_id, target_area_notation, area_name,
      severity_level, severity_label, time_raised,
      narrative, trigger_snapshot_json, status
    ) VALUES 
      ('W1', '112FWFCUR10A', 'Curry Moor', 2, 'Flood Warning', '2026-11-08T10:00:00Z', 'Active warning', '{}', 'ACTIVE'),
      ('W2', '112WAFTPM', 'Lower Tone', 3, 'Flood Alert', '2026-11-08T09:00:00Z', 'Active alert', '{}', 'ACTIVE'),
      ('W3', '112FWFEAS10A', 'A361', 2, 'Flood Warning', '2026-11-08T08:00:00Z', 'Closed warning', '{}', 'CLOSED')
  `).run();

  const summary = getEAWarningsSummary(db);
  assert.equal(summary.active_count, 2);
  assert.equal(summary.has_flood_warning, true);
  assert.equal(summary.has_flood_alert, true);
  assert.equal(summary.has_severe_warning, false);
  assert.deepEqual(summary.target_areas_active.sort(), ['112FWFCUR10A', '112WAFTPM'].sort());

  const stateMap = getActiveEAWarningStatesMap(db);
  assert.equal(stateMap['112FWFCUR10A'], 'RED_WARNING');
  assert.equal(stateMap['112WAFTPM'], 'AMBER_ALERT');
  assert.equal(stateMap['112FWFEAS10A'], undefined);

  const warnings = getEAWarnings(db, { status: 'ALL' });
  assert.equal(warnings.length, 3);

  db.close();
});

test('Contract Compliance [RULE-CALC-01]: Data contracts reject forbidden volumetric discharge keys', () => {
  const validIngest = {
    items: [
      {
        '@id': 'item-1',
        floodAreaID: '112FWFCUR10A',
        severityLevel: 2,
        timeRaised: '2026-11-08T10:00:00Z'
      }
    ]
  };
  const v1 = validateEAWarningsIngestPayload(validIngest);
  assert.equal(v1.valid, true);

  // Ingest containing forbidden cumecs key
  const invalidIngest = {
    items: [
      {
        '@id': 'item-1',
        floodAreaID: '112FWFCUR10A',
        severityLevel: 2,
        cumecs: 45.2
      }
    ]
  };
  const v2 = validateEAWarningsIngestPayload(invalidIngest);
  assert.equal(v2.valid, false);
  assert.ok(v2.errors.some(e => e.includes('cumecs')));

  const validApi = {
    status: 'ok',
    count: 1,
    warnings: [
      {
        id: 1,
        warning_id: 'W1',
        target_area_notation: '112FWFCUR10A',
        area_name: 'Curry Moor',
        severity_level: 2,
        severity_label: 'Flood Warning',
        time_raised: '2026-11-08T10:00:00Z',
        narrative: 'Testing',
        status: 'ACTIVE'
      }
    ]
  };
  const v3 = validateApiWarningsPayload(validApi);
  assert.equal(v3.valid, true);

  // API containing forbidden discharge_m3s key
  const invalidApi = {
    ...validApi,
    warnings: [{ ...validApi.warnings[0], discharge_m3s: 12.5 }]
  };
  const v4 = validateApiWarningsPayload(invalidApi);
  assert.equal(v4.valid, false);
  assert.ok(v4.errors.some(e => e.includes('discharge_m3s')));
});
