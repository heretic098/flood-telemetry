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
  getLastProcessedTimestamps,
  resetActiveSessions,
  buildStationReadingsMap,
  processTelemetryEvents,
  MAX_REPLAY_BATCH_SIZE
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
  getLastProcessedTimestamps,
  resetActiveSessions,
  buildStationReadingsMap,
  processTelemetryEvents,
  MAX_REPLAY_BATCH_SIZE
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

  let sql = `
    SELECT te.*,
           ca.image_url AS snapshot_image_url,
           ca.fetched_at AS snapshot_fetched_at,
           ca.trigger_reason AS snapshot_trigger_reason,
           ca.fallback_mode AS snapshot_fallback_mode,
           ca.analysis_json AS snapshot_analysis_json
    FROM telemetry_events te
    LEFT JOIN camera_analysis ca ON te.camera_snapshot_id = ca.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND te.status = ?';
    params.push(status);
  }

  if (assetId) {
    sql += ' AND te.asset_id = ?';
    params.push(assetId);
  }

  sql += ' ORDER BY te.start_time DESC LIMIT ?';
  params.push(limit);

  let rows;
  try {
    rows = db.prepare(sql).all(...params);
  } catch (joinErr) {
    // Fallback if a minimal test fixture created telemetry_events without camera_analysis
    let fallbackSql = 'SELECT * FROM telemetry_events WHERE 1=1';
    const fbParams = [];
    if (status) {
      fallbackSql += ' AND status = ?';
      fbParams.push(status);
    }
    if (assetId) {
      fallbackSql += ' AND asset_id = ?';
      fbParams.push(assetId);
    }
    fallbackSql += ' ORDER BY start_time DESC LIMIT ?';
    fbParams.push(limit);
    rows = db.prepare(fallbackSql).all(...fbParams);
  }

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

    let cameraEvidence = null;
    if (r.camera_snapshot_id) {
      let parsedAnalysis = null;
      if (r.snapshot_analysis_json) {
        try {
          parsedAnalysis = JSON.parse(r.snapshot_analysis_json);
        } catch (e) {}
      }
      cameraEvidence = {
        snapshot_id: r.camera_snapshot_id,
        camera_id: r.camera_id,
        camera_name: parsedAnalysis?.camera_name || null,
        camera_description: parsedAnalysis?.camera_description || null,
        camera_look_for: parsedAnalysis?.camera_look_for || null,
        image_url: r.snapshot_image_url || null,
        image_hash: r.image_hash || null,
        fetched_at: r.snapshot_fetched_at || null,
        trigger_reason: r.snapshot_trigger_reason || null,
        fallback_mode: r.snapshot_fallback_mode ?? null,
        keyframes: parsedAnalysis?.keyframes || null,
        sequence_frames: Array.isArray(parsedAnalysis?.sequence_frames) ? parsedAnalysis.sequence_frames : []
      };
    }

    const {
      snapshot_image_url,
      snapshot_fetched_at,
      snapshot_trigger_reason,
      snapshot_fallback_mode,
      snapshot_analysis_json,
      ...cleanRow
    } = r;

    return {
      ...cleanRow,
      duration_seconds: durationSec,
      duration_formatted: durationFormatted,
      camera_evidence: cameraEvidence
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
