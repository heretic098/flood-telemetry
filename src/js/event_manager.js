/**
 * Telemetry Event Manager & Active Session Lifecycle Engine
 * 
 * Manages transactional persistence in `telemetry_events` table (SQLite WAL mode).
 * Coordinates in-memory active session tracking, startup rehydration, and
 * chronological batch replay with bounded sliding windows.
 * 
 * Governing Invariants:
 * - [RULE-ENT-01] Canonical tripartite schema (asset_type -> asset_id -> status)
 * - [RULE-TAX-06] Closed 19-state normalized dictionary
 * - [RULE-CALC-01] Strict ban on volumetric flow / cumec speculation
 * - [RULE-SSOT-01] Single Source of Truth in STATION_REGISTRY & ASSET_DEFINITIONS
 * - [RULE-TEST-02] Hermetic clean-room test execution
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

// In-memory tracker of last processed reading ISO timestamp per asset_id
const lastProcessedTimestamps = new Map();

// Maximum readings replayed per asset in a single sync batch (8 hours @ 15m)
export const MAX_REPLAY_BATCH_SIZE = 32;

/**
 * Rehydrates in-memory active sessions from the SQLite database on startup.
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, object>} The populated activeSessions map
 */
export function rehydrateActiveSessions(db) {
  activeSessions.clear();
  lastProcessedTimestamps.clear();
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

      if (row.start_time) {
        lastProcessedTimestamps.set(row.asset_id, row.start_time);
      }
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
 * Returns a copy of the last processed timestamps map (for inspection & testing).
 * @returns {Map<string, string>}
 */
export function getLastProcessedTimestamps() {
  return new Map(lastProcessedTimestamps);
}

/**
 * Resets the in-memory active sessions and last-processed timestamps (primarily used in test suites).
 */
export function resetActiveSessions() {
  activeSessions.clear();
  lastProcessedTimestamps.clear();
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
        const dt = (typeof r === 'object' && r !== null) ? (r.dateTime || r.date) : null;
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
 * Implements chronological batch replay with bounded sliding windows across a single SQLite transaction.
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
    SET severity_tier = ?, peak_stage_mAOD = ?, end_time = ?, duration_seconds = ?, status = 'CLOSED', narrative = ?
    WHERE id = ?
  `);

  const defaultTimestamp = options.timestamp || new Date().toISOString();
  const maxFutureMs = Date.now() + 15 * 60 * 1000;

  const tx = db.transaction(() => {
    for (const assetDef of Object.values(ASSET_DEFINITIONS)) {
      const activeSession = activeSessions.get(assetDef.asset_id) || null;

      // Determine primary and secondary station IDs
      let primaryStationId;
      let secondaryStationId = null;

      if (assetDef.asset_type === 'tidal_gate') {
        primaryStationId = assetDef.sea_station;
        secondaryStationId = assetDef.inland_station;
      } else if (assetDef.asset_type === 'sluice') {
        primaryStationId = assetDef.upstream_station;
        secondaryStationId = assetDef.downstream_station;
      } else {
        primaryStationId = assetDef.primary_station || assetDef.station_id;
        secondaryStationId = assetDef.secondary_station || null;
      }

      const allPrimary = readingsMap[primaryStationId] || [];
      const allSecondary = secondaryStationId ? (readingsMap[secondaryStationId] || []) : [];

      // Timestamp sanitization & filtering: reject invalid dates and clock-skew > 15m in future
      const validPrimary = allPrimary.map(r => {
        if (!r) return null;
        const dt = r.dateTime || defaultTimestamp;
        const ms = new Date(dt).getTime();
        if (isNaN(ms) || ms > maxFutureMs) return null;
        return { ...r, dateTime: dt };
      }).filter(Boolean);

      if (validPrimary.length === 0) {
        continue;
      }

      // Sort descending (newest first)
      validPrimary.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

      // Determine candidate unseen readings
      const isColdBoot = !lastProcessedTimestamps.has(assetDef.asset_id);
      let unseenReadings = [];

      if (isColdBoot) {
        if (activeSession) {
          // Rehydrated active session: resume from active session start_time
          const resumeMs = new Date(activeSession.start_time).getTime();
          unseenReadings = validPrimary.filter(r => new Date(r.dateTime).getTime() > resumeMs);
        } else {
          // Cold-boot inactive: only evaluate newest reading without replaying past nominal readings
          unseenReadings = [validPrimary[0]];
        }
      } else {
        const lastProcessedIso = lastProcessedTimestamps.get(assetDef.asset_id);
        const lastProcessedMs = new Date(lastProcessedIso).getTime();
        unseenReadings = validPrimary.filter(r => new Date(r.dateTime).getTime() > lastProcessedMs);
      }

      if (unseenReadings.length === 0) {
        continue;
      }

      // Clamp to MAX_REPLAY_BATCH_SIZE (32) and sort chronological (oldest -> newest)
      const batchToReplay = unseenReadings
        .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
        .slice(0, MAX_REPLAY_BATCH_SIZE)
        .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

      for (const targetReading of batchToReplay) {
        const targetTimeMs = new Date(targetReading.dateTime).getTime();

        // Bounded sliding window of up to 96 readings ending at targetTimeMs (newest first)
        const primaryWindow = validPrimary
          .filter(r => new Date(r.dateTime).getTime() <= targetTimeMs)
          .slice(0, 96);

        let secondaryWindow = [];
        if (secondaryStationId && allSecondary.length > 0) {
          secondaryWindow = allSecondary
            .map(r => {
              if (!r) return null;
              const dt = r.dateTime || defaultTimestamp;
              const ms = new Date(dt).getTime();
              if (isNaN(ms) || ms > maxFutureMs) return null;
              return { ...r, dateTime: dt };
            })
            .filter(Boolean)
            .filter(r => new Date(r.dateTime).getTime() <= (targetTimeMs + 30 * 60 * 1000))
            .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
            .slice(0, 96);
        }

        const windowMap = {
          ...readingsMap,
          [primaryStationId]: primaryWindow,
          primary: primaryWindow
        };

        if (secondaryStationId) {
          windowMap[secondaryStationId] = secondaryWindow;
          windowMap.secondary = secondaryWindow;
          if (assetDef.asset_type === 'tidal_gate') {
            windowMap.sea = primaryWindow;
            windowMap.inland = secondaryWindow;
          } else if (assetDef.asset_type === 'sluice') {
            windowMap.upstream = primaryWindow;
            windowMap.downstream = secondaryWindow;
          }
        }

        const currentActive = activeSessions.get(assetDef.asset_id) || null;
        const evalOptions = {
          ...options,
          timestamp: targetReading.dateTime,
          nowMs: targetTimeMs
        };

        const decision = evaluateAssetTransition(assetDef, currentActive, windowMap, regime, evalOptions);
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
        } else if (decision.action === 'UPDATE' && currentActive) {
          const peakSeverity = Math.max(currentActive.severity_tier || 1, decision.severity_tier);
          updateStmt.run(
            decision.to_state,
            peakSeverity,
            decision.peak_stage_mAOD,
            decision.clearance_m,
            decision.narrative,
            currentActive.id
          );

          currentActive.to_state = decision.to_state;
          currentActive.severity_tier = peakSeverity;
          currentActive.peak_stage_mAOD = decision.peak_stage_mAOD;
          currentActive.clearance_m = decision.clearance_m;
          currentActive.narrative = decision.narrative;
          currentActive.consecutiveNominalCount = decision.session_updates?.consecutiveNominalCount || 0;
          currentActive.firstNominalReading = decision.session_updates?.firstNominalReading || null;
        } else if (decision.action === 'CLOSE' && currentActive) {
          const peakSeverity = Math.max(currentActive.severity_tier || 1, decision.severity_tier);
          closeStmt.run(
            peakSeverity,
            decision.peak_stage_mAOD,
            decision.end_time,
            decision.duration_seconds,
            decision.narrative,
            currentActive.id
          );

          activeSessions.delete(assetDef.asset_id);
        }

        // Advance lastProcessedTimestamp to current replayed reading timestamp
        lastProcessedTimestamps.set(assetDef.asset_id, targetReading.dateTime);
      }
    }
  });

  tx();
  return decisions;
}
