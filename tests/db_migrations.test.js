import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations, CANONICAL_ASSET_TYPES, CANONICAL_STATES, MIGRATIONS } from '../src/js/db_migrations.js';

test('Database Migrations: runMigrations cleanly upgrades fresh database from 0 to 3', () => {
  const db = new Database(':memory:');
  assert.equal(db.pragma('user_version', { simple: true }), 0);

  const finalVersion = runMigrations(db);
  assert.equal(finalVersion, 3);
  assert.equal(db.pragma('user_version', { simple: true }), 3);

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
  assert.equal(secondRun, 3);
});

test('Database Migrations: upgrades cleanly from version 1 to version 3', () => {
  const db = new Database(':memory:');
  
  // Apply only migration 1
  MIGRATIONS[0].up(db);
  db.pragma('user_version = 1');
  assert.equal(db.pragma('user_version', { simple: true }), 1);

  // Verify spill_events exists and telemetry_events does NOT exist yet at v1
  const tablesV1 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tablesV1.includes('spill_events'));
  assert.ok(!tablesV1.includes('telemetry_events'));

  // Now runMigrations - should upgrade to 3
  const upgradedVersion = runMigrations(db);
  assert.equal(upgradedVersion, 3);
  assert.equal(db.pragma('user_version', { simple: true }), 3);

  const tablesV3 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tablesV3.includes('telemetry_events'));
  assert.ok(!tablesV3.includes('spill_events'), 'spill_events must be dropped after migration 3');
});

test('Database Migrations: upgrades cleanly from version 2 to version 3', () => {
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

  // Now runMigrations - should upgrade to 3 and drop spill_events
  const upgradedVersion = runMigrations(db);
  assert.equal(upgradedVersion, 3);
  assert.equal(db.pragma('user_version', { simple: true }), 3);

  const tablesV3 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tablesV3.includes('telemetry_events'));
  assert.ok(!tablesV3.includes('spill_events'), 'spill_events must be dropped after migration 3');
});

test('Database Migrations: migration 3 drop table is idempotent', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), 3);

  // Directly running migration 3 up function again must not throw
  assert.doesNotThrow(() => {
    MIGRATIONS[2].up(db);
  });

  // Calling runMigrations again on v3 must remain 3
  const rerun = runMigrations(db);
  assert.equal(rerun, 3);
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
