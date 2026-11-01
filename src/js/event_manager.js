/**
 * Telemetry Event Manager & Active Session Lifecycle Engine
 * 
 * Manages transactional persistence in `telemetry_events` table (SQLite WAL mode).
 * Coordinates in-memory active session tracking, startup rehydration, and
 * shadow execution alongside legacy spillway timers.
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
  evaluateAssetTransition,
  getSeasonalRegime,
  sanitizeStageValue
} from './hydro_engine.js';

// In-memory active session tracker keyed by asset_id
const activeSessions = new Map();

/**
 * Rehydrates in-memory active sessions from the SQLite database on startup.
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, object>} The populated activeSessions map
 */
export function rehydrateActiveSessions(db) {
  activeSessions.clear();
  try {
    const rows = db.prepare(`
      SELECT * FROM telemetry_events 
      WHERE status = 'ACTIVE'
    `).all();

    for (const row of rows) {
      activeSessions.set(row.asset_id, {
        id: row.id,
        asset_type: row.asset_type,
        asset_id: row.asset_id,
        from_state: row.from_state,
        to_state: row.to_state,
        severity_tier: row.severity_tier,
        start_time: row.start_time,
        trigger_stage_mAOD: row.trigger_stage_mAOD,
        peak_stage_mAOD: row.peak_stage_mAOD,
        clearance_m: row.clearance_m,
        camera_id: row.camera_id,
        image_hash: row.image_hash,
        camera_snapshot_id: row.camera_snapshot_id,
        narrative: row.narrative,
        status: 'ACTIVE',
        consecutiveNominalCount: 0,
        firstNominalReading: null
      });
    }

    console.log(`[Event Manager] Rehydrated ${rows.length} active sessions from telemetry_events.`);
  } catch (err) {
    console.warn('[Event Manager] Could not rehydrate active sessions:', err.message);
  }
  return activeSessions;
}

/**
 * Returns a copy of the active in-memory sessions.
 * @returns {Array<object>}
 */
export function getActiveSessions() {
  return Array.from(activeSessions.values());
}

/**
 * Resets the in-memory active sessions tracker (primarily used in test suites).
 */
export function resetActiveSessions() {
  activeSessions.clear();
}

/**
 * Transforms raw measures dictionary into a station-keyed map of stage readings in mAOD.
 * @param {object} measures - Dict of measure_id -> readings array
 * @returns {object} Map of station_id -> Array<{ dateTime, value }> in mAOD
 */
export function buildStationReadingsMap(measures) {
  const map = {};
  if (!measures || typeof measures !== 'object') return map;

  for (const [stationId, reg] of Object.entries(STATION_REGISTRY)) {
    let rawReadings = measures[reg.measure_id];
    if (!rawReadings && Array.isArray(reg.alt_measure_ids)) {
      for (const altId of reg.alt_measure_ids) {
        if (measures[altId]) {
          rawReadings = measures[altId];
          break;
        }
      }
    }

    if (Array.isArray(rawReadings)) {
      const offset = reg.datum_offset_mAOD || 0;
      map[stationId] = rawReadings.map(r => {
        const rawVal = (typeof r === 'object' && r !== null) ? r.value : r;
        const dt = (typeof r === 'object' && r !== null) ? r.dateTime : null;
        const cleanVal = sanitizeStageValue(rawVal);
        return {
          dateTime: dt,
          value: cleanVal !== null ? Number((cleanVal + offset).toFixed(2)) : null
        };
      });
    } else {
      map[stationId] = [];
    }
  }

  return map;
}

/**
 * Processes live telemetry across all canonical assets and updates telemetry_events.
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {object} storedTelemetry - Telemetry object containing .measures
 * @param {object} [options] - Optional overrides (seasonalRegime, timestamp, camera metadata)
 * @returns {Array<object>} Array of asset evaluation decisions
 */
export function processTelemetryEvents(db, storedTelemetry, options = {}) {
  const measures = storedTelemetry?.measures || storedTelemetry || {};
  const readingsMap = buildStationReadingsMap(measures);

  const regime = options.seasonalRegime || getSeasonalRegime(
    options.timestamp ? new Date(options.timestamp) : new Date()
  );

  const decisions = [];

  const insertStmt = db.prepare(`
    INSERT INTO telemetry_events (
      asset_type, asset_id, from_state, to_state, severity_tier,
      start_time, end_time, duration_seconds, trigger_stage_mAOD,
      peak_stage_mAOD, clearance_m, camera_id, image_hash,
      camera_snapshot_id, narrative, status
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, NULL, NULL, ?,
      ?, ?, ?, ?,
      ?, ?, 'ACTIVE'
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE telemetry_events
    SET to_state = ?, severity_tier = ?, peak_stage_mAOD = ?, clearance_m = ?, narrative = ?
    WHERE id = ?
  `);

  const closeStmt = db.prepare(`
    UPDATE telemetry_events
    SET end_time = ?, duration_seconds = ?, status = 'CLOSED', narrative = ?
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const assetDef of Object.values(ASSET_DEFINITIONS)) {
      const activeSession = activeSessions.get(assetDef.asset_id) || null;
      const decision = evaluateAssetTransition(assetDef, activeSession, readingsMap, regime, options);
      decisions.push(decision);

      if (decision.action === 'OPEN') {
        const info = insertStmt.run(
          decision.asset_type,
          decision.asset_id,
          decision.from_state,
          decision.to_state,
          decision.severity_tier,
          decision.start_time,
          decision.trigger_stage_mAOD,
          decision.peak_stage_mAOD,
          decision.clearance_m,
          options.camera_id || null,
          options.image_hash || null,
          options.camera_snapshot_id || null,
          decision.narrative
        );

        activeSessions.set(decision.asset_id, {
          id: info.lastInsertRowid,
          asset_type: decision.asset_type,
          asset_id: decision.asset_id,
          from_state: decision.from_state,
          to_state: decision.to_state,
          severity_tier: decision.severity_tier,
          start_time: decision.start_time,
          trigger_stage_mAOD: decision.trigger_stage_mAOD,
          peak_stage_mAOD: decision.peak_stage_mAOD,
          clearance_m: decision.clearance_m,
          camera_id: options.camera_id || null,
          image_hash: options.image_hash || null,
          camera_snapshot_id: options.camera_snapshot_id || null,
          narrative: decision.narrative,
          status: 'ACTIVE',
          consecutiveNominalCount: decision.session_updates?.consecutiveNominalCount || 0,
          firstNominalReading: decision.session_updates?.firstNominalReading || null
        });
      } else if (decision.action === 'UPDATE' && activeSession) {
        updateStmt.run(
          decision.to_state,
          decision.severity_tier,
          decision.peak_stage_mAOD,
          decision.clearance_m,
          decision.narrative,
          activeSession.id
        );

        activeSession.to_state = decision.to_state;
        activeSession.severity_tier = decision.severity_tier;
        activeSession.peak_stage_mAOD = decision.peak_stage_mAOD;
        activeSession.clearance_m = decision.clearance_m;
        activeSession.narrative = decision.narrative;
        activeSession.consecutiveNominalCount = decision.session_updates?.consecutiveNominalCount || 0;
        activeSession.firstNominalReading = decision.session_updates?.firstNominalReading || null;
      } else if (decision.action === 'CLOSE' && activeSession) {
        closeStmt.run(
          decision.end_time,
          decision.duration_seconds,
          decision.narrative,
          activeSession.id
        );

        activeSessions.delete(assetDef.asset_id);
      }
    }
  });

  tx();
  return decisions;
}
