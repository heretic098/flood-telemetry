/**
 * Database Migration Engine & Versioned Schema Definitions
 * 
 * Expand and Contract Architecture:
 * Phase 1: Provisions the canonical `telemetry_events` table alongside legacy tables.
 * Phase 5: Contract & cleanup - drops legacy `spill_events` table ([RULE-CALC-01], [RULE-ENT-01]).
 * Safe migration execution controlled via SQLite `PRAGMA user_version`.
 */

export const CANONICAL_ASSET_TYPES = Object.freeze([
  'road',
  'polder',
  'spillway',
  'tidal_gate',
  'sluice',
  'gauge'
]);

export const CANONICAL_STATES = Object.freeze([
  'PASSABLE',
  'ENCROACHING',
  'IMPASSABLE',
  'STANDBY',
  'DUTY_PUMPING',
  'MOBILE_ORDERED',
  'MOBILE_ACTIVE',
  'CRITICAL',
  'SECURE',
  'NEAR_CREST',
  'OVERTOPPING',
  'DISCHARGING',
  'TIDE_LOCKED',
  'CLOSED',
  'DIVERTING',
  'THROTTLED',
  'REVERSE_LOCK',
  'NORMAL',
  'ALERT'
]);

export const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline_legacy_tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS telemetry (
          measure_id TEXT PRIMARY KEY,
          readings_json TEXT NOT NULL,
          updated_at DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS historical_telemetry (
          measure_id TEXT NOT NULL,
          date_time TEXT NOT NULL,
          value REAL,
          PRIMARY KEY (measure_id, date_time)
        );

        CREATE INDEX IF NOT EXISTS idx_historical_telemetry_measure_dt 
          ON historical_telemetry(measure_id, date_time DESC);

        CREATE TABLE IF NOT EXISTS spill_events (
          event_id INTEGER PRIMARY KEY AUTOINCREMENT,
          spillway_id TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT,
          peak_overtop_depth_m REAL NOT NULL,
          peak_discharge_m3s REAL NOT NULL,
          total_volume_m3 REAL DEFAULT 0,
          status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CLOSED'))
        );

        CREATE INDEX IF NOT EXISTS idx_spill_events_spillway_status 
          ON spill_events(spillway_id, status);

        CREATE TABLE IF NOT EXISTS camera_analysis (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          camera_id TEXT NOT NULL,
          image_hash TEXT NOT NULL,
          image_url TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          ai_evaluated INTEGER NOT NULL CHECK(ai_evaluated IN (0, 1)),
          analysis_json TEXT,
          trigger_reason TEXT NOT NULL,
          fallback_mode TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_camera_analysis_cam_fetched 
          ON camera_analysis(camera_id, fetched_at DESC);
      `);
    }
  },
  {
    version: 2,
    name: 'provision_telemetry_events_ledger',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS telemetry_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_type TEXT NOT NULL CHECK(asset_type IN ('road', 'polder', 'spillway', 'tidal_gate', 'sluice', 'gauge')),
          asset_id TEXT NOT NULL,
          from_state TEXT CHECK(from_state IS NULL OR from_state IN (
            'PASSABLE', 'ENCROACHING', 'IMPASSABLE',
            'STANDBY', 'DUTY_PUMPING', 'MOBILE_ORDERED', 'MOBILE_ACTIVE', 'CRITICAL',
            'SECURE', 'NEAR_CREST', 'OVERTOPPING',
            'DISCHARGING', 'TIDE_LOCKED',
            'CLOSED', 'DIVERTING', 'THROTTLED', 'REVERSE_LOCK',
            'NORMAL', 'ALERT'
          )),
          to_state TEXT NOT NULL CHECK(to_state IN (
            'PASSABLE', 'ENCROACHING', 'IMPASSABLE',
            'STANDBY', 'DUTY_PUMPING', 'MOBILE_ORDERED', 'MOBILE_ACTIVE', 'CRITICAL',
            'SECURE', 'NEAR_CREST', 'OVERTOPPING',
            'DISCHARGING', 'TIDE_LOCKED',
            'CLOSED', 'DIVERTING', 'THROTTLED', 'REVERSE_LOCK',
            'NORMAL', 'ALERT'
          )),
          severity_tier INTEGER NOT NULL CHECK(severity_tier BETWEEN 1 AND 4),
          start_time TEXT NOT NULL,
          end_time TEXT,
          duration_seconds INTEGER,
          trigger_stage_mAOD REAL NOT NULL,
          peak_stage_mAOD REAL NOT NULL,
          clearance_m REAL,
          camera_id TEXT,
          image_hash TEXT,
          camera_snapshot_id INTEGER,
          narrative TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CLOSED'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_asset 
          ON telemetry_events(asset_id) WHERE status = 'ACTIVE';

        CREATE INDEX IF NOT EXISTS idx_telemetry_events_asset 
          ON telemetry_events(asset_id, status);

        CREATE INDEX IF NOT EXISTS idx_telemetry_events_start 
          ON telemetry_events(start_time DESC);

        CREATE INDEX IF NOT EXISTS idx_telemetry_events_severity 
          ON telemetry_events(severity_tier, status);
      `);
    }
  },
  {
    version: 3,
    name: 'contract_drop_spill_events',
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS spill_events;
      `);
    }
  }
];

/**
 * Executes all pending database migrations in sequential order.
 * Wraps each migration in an atomic transaction and updates PRAGMA user_version.
 * 
 * @param {import('better-sqlite3').Database} db
 * @returns {number} The current user_version after running migrations
 */
export function runMigrations(db) {
  const currentVersion = db.pragma('user_version', { simple: true });

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
  }

  return db.pragma('user_version', { simple: true });
}
