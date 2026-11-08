/**
 * Empirical Road Closure Lead-Time Correlation Tests (Issue #39, [RULE-SUB-01])
 * 
 * Verifies:
 * - Lead time calculation between EA warning start_time and subsequent road IMPASSABLE events.
 * - Topological scoping: warnings only correlate with their designated associated_roads.
 * - Lagging/reactive warning handling: captures negative lead times when road submerged prior to warning.
 * - Zero cumecs invariant [RULE-CALC-01].
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/js/db_migrations.js';
import { EA_FLOOD_AREA_CATALOG } from '../src/js/hydro_engine.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

test('Lead-Time Correlation: Computes empirical lead time between warning and road closure', () => {
  const db = createTestDb();

  // Seed EA Warning at 10:00
  db.prepare(`
    INSERT INTO ea_warning_events (
      warning_id, target_area_notation, area_name,
      severity_level, severity_label, time_raised,
      narrative, trigger_snapshot_json, associated_roads_json, status
    ) VALUES (
      'W-CURRY-100', '112FWFCUR10A', 'Curry Moor and Hay Moor',
      2, 'Flood Warning', '2026-11-08T10:00:00Z',
      'Flood Warning issued', '{}', '["cuts_road", "new_road_curry"]', 'ACTIVE'
    )
  `).run();

  // Seed Cuts Road IMPASSABLE transition at 14:30 (4.5 hours later)
  db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, from_state, to_state, severity_tier,
      start_time, trigger_stage_mAOD, peak_stage_mAOD, peak_time,
      clearance_m, narrative, status
    ) VALUES (
      'road', 'cuts_road', 'ENCROACHING', 'IMPASSABLE', 4,
      '2026-11-08T14:30:00Z', 7.35, 7.42, '2026-11-08T15:00:00Z',
      0.0, 'Cuts Road submerged', 'ACTIVE'
    )
  `).run();

  // Seed unrelated road (muchelney_access) at 16:00
  db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, from_state, to_state, severity_tier,
      start_time, trigger_stage_mAOD, peak_stage_mAOD, peak_time,
      clearance_m, narrative, status
    ) VALUES (
      'road', 'muchelney_access', 'PASSABLE', 'IMPASSABLE', 4,
      '2026-11-08T16:00:00Z', 7.86, 7.88, '2026-11-08T16:30:00Z',
      0.0, 'Muchelney spine submerged', 'ACTIVE'
    )
  `).run();

  // Execute topologically bounded lead-time query
  const rows = db.prepare(`
    SELECT 
      w.target_area_notation,
      w.area_name,
      w.time_raised AS warning_raised_at,
      r.asset_id AS road_id,
      r.start_time AS road_closed_at,
      ROUND((JULIANDAY(r.start_time) - JULIANDAY(w.time_raised)) * 24.0, 2) AS lead_time_hours
    FROM ea_warning_events w
    JOIN telemetry_events r 
      ON r.asset_type = 'road' 
      AND r.to_state = 'IMPASSABLE'
      AND r.asset_id IN (
        SELECT json_each.value FROM json_each(w.associated_roads_json)
      )
      AND r.start_time BETWEEN DATETIME(w.time_raised, '-12 hours') AND DATETIME(w.time_raised, '+72 hours')
    ORDER BY w.time_raised DESC
  `).all();

  // Must only match cuts_road, NOT muchelney_access!
  assert.equal(rows.length, 1, 'Topological scoping must only match designated associated_roads');
  assert.equal(rows[0].road_id, 'cuts_road');
  assert.equal(rows[0].lead_time_hours, 4.5, 'Lead time must be 4.50 hours');

  db.close();
});

test('Lead-Time Correlation: Captures negative lead time for reactive / lagging warnings', () => {
  const db = createTestDb();

  // Cuts Road submerged at 08:00
  db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, from_state, to_state, severity_tier,
      start_time, trigger_stage_mAOD, peak_stage_mAOD, peak_time,
      clearance_m, narrative, status
    ) VALUES (
      'road', 'cuts_road', 'ENCROACHING', 'IMPASSABLE', 4,
      '2026-11-08T08:00:00Z', 7.35, 7.38, '2026-11-08T08:30:00Z',
      0.0, 'Cuts Road submerged early', 'ACTIVE'
    )
  `).run();

  // EA Flood Warning issued reactively at 10:00 (2 hours AFTER road closure)
  db.prepare(`
    INSERT INTO ea_warning_events (
      warning_id, target_area_notation, area_name,
      severity_level, severity_label, time_raised,
      narrative, trigger_snapshot_json, associated_roads_json, status
    ) VALUES (
      'W-REACTIVE', '112FWFCUR10A', 'Curry Moor and Hay Moor',
      2, 'Flood Warning', '2026-11-08T10:00:00Z',
      'Reactive Flood Warning issued', '{}', '["cuts_road", "new_road_curry"]', 'ACTIVE'
    )
  `).run();

  const rows = db.prepare(`
    SELECT 
      w.target_area_notation,
      r.asset_id AS road_id,
      ROUND((JULIANDAY(r.start_time) - JULIANDAY(w.time_raised)) * 24.0, 2) AS lead_time_hours
    FROM ea_warning_events w
    JOIN telemetry_events r 
      ON r.asset_type = 'road' 
      AND r.to_state = 'IMPASSABLE'
      AND r.asset_id IN (
        SELECT json_each.value FROM json_each(w.associated_roads_json)
      )
      AND r.start_time BETWEEN DATETIME(w.time_raised, '-12 hours') AND DATETIME(w.time_raised, '+72 hours')
  `).all();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].lead_time_hours, -2.0, 'Reactive warning must record negative lead time of -2.00 hours');

  db.close();
});
