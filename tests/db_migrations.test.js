import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations, CANONICAL_ASSET_TYPES, CANONICAL_STATES, MIGRATIONS } from '../src/js/db_migrations.js';

test('Database Migrations: runMigrations cleanly upgrades fresh database from 0 to 5', () => {
  const db = new Database(':memory:');
  assert.equal(db.pragma('user_version', { simple: true }), 0);

  const finalVersion = runMigrations(db);
  assert.equal(finalVersion, 5);
  assert.equal(db.pragma('user_version', { simple: true }), 5);

  // Verify all expected tables exist
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tables.includes('telemetry'));
  assert.ok(tables.includes('historical_telemetry'));
  assert.ok(tables.includes('camera_analysis'));
  assert.ok(tables.includes('telemetry_events'));

  // Verify legacy spill_events has been dropped [RULE-CALC-01, RULE-ENT-01]
  assert.ok(!tables.includes('spill_events'), 'spill_events must be dropped in migration 3');

  // Calling runMigrations again is idempotent
  const secondRun = runMigrations(db);
  assert.equal(secondRun, 5);
});

test('Database Migrations: upgrades cleanly from version 1 to version 5', () => {
  const db = new Database(':memory:');
  
  // Apply only migration 1
  MIGRATIONS[0].up(db);
  db.pragma('user_version = 1');
  assert.equal(db.pragma('user_version', { simple: true }), 1);

  // Verify spill_events exists and telemetry_events does NOT exist yet at v1
  const tablesV1 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tablesV1.includes('spill_events'));
  assert.ok(!tablesV1.includes('telemetry_events'));

  // Now runMigrations - should upgrade to 5
  const upgradedVersion = runMigrations(db);
  assert.equal(upgradedVersion, 5);
  assert.equal(db.pragma('user_version', { simple: true }), 5);

  const tablesV3 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tablesV3.includes('telemetry_events'));
  assert.ok(!tablesV3.includes('spill_events'), 'spill_events must be dropped after migration 3');
});

test('Database Migrations: upgrades cleanly from version 2 to version 5', () => {
  const db = new Database(':memory:');
  
  // Apply migrations 1 and 2
  MIGRATIONS[0].up(db);
  MIGRATIONS[1].up(db);
  db.pragma('user_version = 2');
  assert.equal(db.pragma('user_version', { simple: true }), 2);

  // Verify both spill_events and telemetry_events exist at v2
  const tablesV2 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tablesV2.includes('spill_events'));
  assert.ok(tablesV2.includes('telemetry_events'));

  // Now runMigrations - should upgrade to 5 and drop spill_events
  const upgradedVersion = runMigrations(db);
  assert.equal(upgradedVersion, 5);
  assert.equal(db.pragma('user_version', { simple: true }), 5);

  const tablesV3 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tablesV3.includes('telemetry_events'));
  assert.ok(!tablesV3.includes('spill_events'), 'spill_events must be dropped after migration 3');
});

test('Database Migrations: migration 3 drop table is idempotent', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), 5);

  // Directly running migration 3 up function again must not throw
  assert.doesNotThrow(() => {
    MIGRATIONS[2].up(db);
  });

  // Calling runMigrations again on v5 must remain 5
  const rerun = runMigrations(db);
  assert.equal(rerun, 5);
});

test('Database Migrations: migration 4 purges spurious monks_leaze_clyse baseflow REVERSE_LOCK events', () => {
  const db = new Database(':memory:');
  // Run up to version 3
  MIGRATIONS[0].up(db);
  MIGRATIONS[1].up(db);
  MIGRATIONS[2].up(db);
  db.pragma('user_version = 3');

  // Insert seed events:
  // 1. Spurious monks_leaze_clyse reverse lock during baseflow (6.72m)
  // 2. Legitimate monks_leaze_clyse reverse lock during flood (7.30m)
  // 3. Other asset event (dunball_outfall tide locked)
  const insertStmt = db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, to_state, severity_tier, start_time,
      trigger_stage_mAOD, peak_stage_mAOD, narrative, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run('sluice', 'monks_leaze_clyse', 'REVERSE_LOCK', 3, '2026-11-05T12:00:00Z', 6.72, 6.73, 'Spurious baseflow', 'ACTIVE');
  insertStmt.run('sluice', 'monks_leaze_clyse', 'REVERSE_LOCK', 3, '2026-11-05T18:00:00Z', 7.30, 7.45, 'Real flood reverse lock', 'CLOSED');
  insertStmt.run('tidal_gate', 'dunball_outfall', 'TIDE_LOCKED', 2, '2026-11-05T14:00:00Z', 6.50, 6.80, 'High tide', 'CLOSED');

  assert.equal(db.prepare("SELECT count(*) as c FROM telemetry_events").get().c, 3);

  // Run migration 4 & 5
  const finalVersion = runMigrations(db);
  assert.equal(finalVersion, 5);
  assert.equal(db.pragma('user_version', { simple: true }), 5);

  const remaining = db.prepare("SELECT * FROM telemetry_events ORDER BY id ASC").all();
  assert.equal(remaining.length, 2, 'Spurious baseflow event must be deleted; valid flood & other events preserved');
  assert.equal(remaining[0].trigger_stage_mAOD, 7.30, 'Real flood event preserved');
  assert.equal(remaining[1].asset_id, 'dunball_outfall', 'Other asset event preserved');
});

test('Database Migrations: migration 5 adds rate columns to historical_telemetry and telemetry_events and backfills peak_time', () => {
  const db = new Database(':memory:');
  // Run up to version 4
  for (let i = 0; i < 4; i++) {
    MIGRATIONS[i].up(db);
  }
  db.pragma('user_version = 4');

  // Insert seed events into telemetry_events at v4
  db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, to_state, severity_tier, start_time,
      trigger_stage_mAOD, peak_stage_mAOD, narrative, status
    ) VALUES ('road', 'cuts_road', 'IMPASSABLE', 4, '2026-11-06T08:30:00Z', 6.20, 6.45, 'Inundated', 'ACTIVE')
  `).run();

  // Run migration 5
  const finalVersion = runMigrations(db);
  assert.equal(finalVersion, 5);

  // Verify historical_telemetry columns
  const histCols = db.prepare("PRAGMA table_info(historical_telemetry)").all().map(c => c.name);
  assert.ok(histCols.includes('delta_15m_m'), 'historical_telemetry must have delta_15m_m');
  assert.ok(histCols.includes('rate_1h_m_per_hr'), 'historical_telemetry must have rate_1h_m_per_hr');
  assert.ok(histCols.includes('rate_3h_m_per_hr'), 'historical_telemetry must have rate_3h_m_per_hr');

  // Verify telemetry_events columns
  const eventCols = db.prepare("PRAGMA table_info(telemetry_events)").all().map(c => c.name);
  assert.ok(eventCols.includes('peak_time'), 'telemetry_events must have peak_time');
  assert.ok(eventCols.includes('trigger_rate_15m_m_per_hr'), 'telemetry_events must have trigger_rate_15m_m_per_hr');
  assert.ok(eventCols.includes('trigger_rate_1h_m_per_hr'), 'telemetry_events must have trigger_rate_1h_m_per_hr');
  assert.ok(eventCols.includes('trigger_rate_3h_m_per_hr'), 'telemetry_events must have trigger_rate_3h_m_per_hr');
  assert.ok(eventCols.includes('max_rate_1h_m_per_hr'), 'telemetry_events must have max_rate_1h_m_per_hr');

  // Verify peak_time was backfilled with start_time
  const event = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'cuts_road'").get();
  assert.equal(event.peak_time, '2026-11-06T08:30:00Z');
});

test('Database Migrations: telemetry_events enforces asset_type CHECK constraint', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const insertStmt = db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, to_state, severity_tier, start_time,
      trigger_stage_mAOD, peak_stage_mAOD, narrative, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Valid asset types should succeed
  for (const assetType of CANONICAL_ASSET_TYPES) {
    const info = insertStmt.run(
      assetType,
      `test_${assetType}`,
      'SECURE',
      1,
      '2026-11-01T12:00:00Z',
      7.00,
      7.00,
      'Nominal test',
      'CLOSED'
    );
    assert.ok(info.changes > 0);
  }

  // Invalid asset type should throw SQLite constraint error
  assert.throws(() => {
    insertStmt.run(
      'invalid_bridge',
      'test_fail',
      'SECURE',
      1,
      '2026-11-01T12:00:00Z',
      7.00,
      7.00,
      'Should fail',
      'CLOSED'
    );
  }, /CHECK constraint failed/);
});

test('Database Migrations: telemetry_events enforces state closed-dictionary CHECK constraint', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const insertStmt = db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, from_state, to_state, severity_tier, start_time,
      trigger_stage_mAOD, peak_stage_mAOD, narrative, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Valid from_state and to_state
  const info = insertStmt.run(
    'spillway',
    'hookbridge_spillway',
    'SECURE',
    'NEAR_CREST',
    3,
    '2026-11-01T12:00:00Z',
    7.32,
    7.32,
    'Approaching crest test',
    'CLOSED'
  );
  assert.ok(info.changes > 0);

  // from_state can be NULL (initial event opening)
  const initialOpen = insertStmt.run(
    'spillway',
    'baltmoor_wall',
    null,
    'OVERTOPPING',
    4,
    '2026-11-01T12:15:00Z',
    7.82,
    7.82,
    'Overtopping test',
    'CLOSED'
  );
  assert.ok(initialOpen.changes > 0);

  // Invalid to_state must fail
  assert.throws(() => {
    insertStmt.run(
      'spillway',
      'hookbridge_spillway',
      'SECURE',
      'SUPER_FLOODED', // Invalid enum value
      4,
      '2026-11-01T12:30:00Z',
      7.90,
      7.90,
      'Invalid state test',
      'CLOSED'
    );
  }, /CHECK constraint failed/);

  // Invalid from_state must fail
  assert.throws(() => {
    insertStmt.run(
      'spillway',
      'hookbridge_spillway',
      'ALMOST_FULL', // Invalid enum value
      'OVERTOPPING',
      4,
      '2026-11-01T12:30:00Z',
      7.90,
      7.90,
      'Invalid from_state test',
      'CLOSED'
    );
  }, /CHECK constraint failed/);
});

test('Database Migrations: telemetry_events enforces severity_tier between 1 and 4', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const insertStmt = db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, to_state, severity_tier, start_time,
      trigger_stage_mAOD, peak_stage_mAOD, narrative, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Tiers 1, 2, 3, 4 must succeed
  for (const tier of [1, 2, 3, 4]) {
    const info = insertStmt.run(
      'road',
      `road_tier_${tier}`,
      'PASSABLE',
      tier,
      '2026-11-01T12:00:00Z',
      5.00,
      5.00,
      `Tier ${tier} test`,
      'CLOSED'
    );
    assert.ok(info.changes > 0);
  }

  // Tier 0 must fail
  assert.throws(() => {
    insertStmt.run(
      'road',
      'road_tier_0',
      'PASSABLE',
      0,
      '2026-11-01T12:00:00Z',
      5.00,
      5.00,
      'Tier 0 fail',
      'CLOSED'
    );
  }, /CHECK constraint failed/);

  // Tier 5 must fail
  assert.throws(() => {
    insertStmt.run(
      'road',
      'road_tier_5',
      'PASSABLE',
      5,
      '2026-11-01T12:00:00Z',
      5.00,
      5.00,
      'Tier 5 fail',
      'CLOSED'
    );
  }, /CHECK constraint failed/);
});

test('Database Migrations: partial unique index permits multiple CLOSED events but rejects duplicate ACTIVE events for same asset', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const insertStmt = db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, to_state, severity_tier, start_time, end_time,
      trigger_stage_mAOD, peak_stage_mAOD, narrative, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // First CLOSED event
  insertStmt.run(
    'spillway',
    'hookbridge_spillway',
    'OVERTOPPING',
    4,
    '2026-11-01T10:00:00Z',
    '2026-11-01T11:00:00Z',
    7.50,
    7.60,
    'Historic spill 1',
    'CLOSED'
  );

  // Second CLOSED event for the SAME asset_id (must succeed)
  insertStmt.run(
    'spillway',
    'hookbridge_spillway',
    'OVERTOPPING',
    4,
    '2026-11-01T12:00:00Z',
    '2026-11-01T13:00:00Z',
    7.48,
    7.55,
    'Historic spill 2',
    'CLOSED'
  );

  // First ACTIVE event for hookbridge_spillway (must succeed)
  insertStmt.run(
    'spillway',
    'hookbridge_spillway',
    'OVERTOPPING',
    4,
    '2026-11-01T14:00:00Z',
    null,
    7.52,
    7.52,
    'Current active spill',
    'ACTIVE'
  );

  // Second concurrent ACTIVE event for the SAME asset_id (must throw UNIQUE constraint violation)
  assert.throws(() => {
    insertStmt.run(
      'spillway',
      'hookbridge_spillway',
      'OVERTOPPING',
      4,
      '2026-11-01T14:15:00Z',
      null,
      7.55,
      7.55,
      'Duplicate active spill',
      'ACTIVE'
    );
  }, /UNIQUE constraint failed/);

  // A different asset CAN have an ACTIVE event simultaneously
  const secondAssetInfo = insertStmt.run(
    'spillway',
    'baltmoor_wall',
    'OVERTOPPING',
    4,
    '2026-11-01T14:15:00Z',
    null,
    7.82,
    7.82,
    'Baltmoor active spill',
    'ACTIVE'
  );
  assert.ok(secondAssetInfo.changes > 0);
});
