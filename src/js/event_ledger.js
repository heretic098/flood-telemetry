/**
 * Telemetry Event Ledger & Query Engine
 * 
 * Provides structured query interfaces for `telemetry_events` in SQLite WAL mode.
 * Serves the GET /api/events endpoint and progressive disclosure components.
 * 
 * Governing Invariants:
 * - [RULE-ENT-01] Canonical tripartite schema (asset_type -> asset_id -> status)
 * - [RULE-TAX-06] Closed 19-state normalized dictionary
 * - [RULE-CALC-01] Strict ban on volumetric flow / cumec speculation
 * - [RULE-SSOT-01] Single Source of Truth in STATION_REGISTRY & ASSET_DEFINITIONS
 */

import {
  ASSET_DEFINITIONS,
  STATION_REGISTRY,
  HYDRO_DEADBANDS,
  computeTrendVector,
  formatClearanceText,
  evaluateAssetTransition,
  getSeasonalRegime,
  sanitizeStageValue
} from './hydro_engine.js';

import {
  rehydrateActiveSessions,
  getActiveSessions,
  resetActiveSessions,
  buildStationReadingsMap,
  processTelemetryEvents
} from './event_manager.js';

// Re-export core definitions and lifecycle helpers
export {
  ASSET_DEFINITIONS,
  STATION_REGISTRY,
  HYDRO_DEADBANDS,
  computeTrendVector,
  formatClearanceText,
  evaluateAssetTransition,
  rehydrateActiveSessions,
  getActiveSessions,
  resetActiveSessions,
  buildStationReadingsMap,
  processTelemetryEvents
};

/**
 * Retrieves telemetry events from SQLite with filtering, pagination, and dynamic duration calculation.
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @param {string|null} [options.status] - 'ACTIVE' or 'CLOSED'
 * @param {string|null} [options.asset_id] - specific asset ID
 * @param {number} [options.limit=50] - maximum rows to return
 * @param {number} [options.nowMs=Date.now()] - timestamp for duration calculation
 * @returns {Array<object>}
 */
export function getTelemetryEvents(db, options = {}) {
  const status = options.status ? String(options.status).trim().toUpperCase() : null;
  const assetId = options.asset_id ? String(options.asset_id).trim().toLowerCase() : null;
  let limit = parseInt(options.limit || 50, 10);
  if (isNaN(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  let sql = 'SELECT * FROM telemetry_events WHERE 1=1';
  const params = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (assetId) {
    sql += ' AND asset_id = ?';
    params.push(assetId);
  }

  sql += ' ORDER BY start_time DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();

  return rows.map(r => {
    let durationSec = r.duration_seconds;
    if (r.status === 'ACTIVE' && r.start_time) {
      durationSec = Math.max(0, Math.floor((nowMs - new Date(r.start_time).getTime()) / 1000));
    }

    let durationFormatted = null;
    if (typeof durationSec === 'number') {
      const h = Math.floor(durationSec / 3600);
      const m = Math.floor((durationSec % 3600) / 60);
      durationFormatted = `${h}h ${m}m`;
    }

    return {
      ...r,
      duration_seconds: durationSec,
      duration_formatted: durationFormatted
    };
  });
}

/**
 * Retrieves all currently active telemetry event sessions.
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {number} [nowMs=Date.now()]
 * @returns {Array<object>}
 */
export function getActiveTelemetryEvents(db, nowMs = Date.now()) {
  return getTelemetryEvents(db, { status: 'ACTIVE', limit: 50, nowMs });
}
