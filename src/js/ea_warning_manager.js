/**
 * Environment Agency (EA) Flood Alerts & Warnings Lifecycle Manager
 * 
 * Invariants:
 * - [RULE-HUM-01]: Epistemic humility copy (no predictive simulated authority).
 * - [RULE-PROV-01]: Third-party data stewardship (EA OGL v3.0).
 * - [RULE-SUB-01]: Empirical substantiation gate (only logged timestamps and stages).
 * - [RULE-CALC-01]: Absolute ban on volumetric speculation (zero cumecs).
 * - [RULE-ENT-01]: Canonical Tripartite Entity Model for flood warning areas.
 * - [RULE-SSOT-01]: Single Source of Truth in EA_FLOOD_AREA_CATALOG & STATION_REGISTRY.
 * - [RULE-INFRA-01]: Litestream single-writer WAL replication compatibility.
 */

import {
  EA_FLOOD_AREA_CATALOG,
  STATION_REGISTRY,
  sanitizeStageValue,
  computeStageRates,
  computeTrendVector,
  escapeHTML
} from './hydro_engine.js';
import { buildStationReadingsMap } from './event_manager.js';
import { validateEAWarningsIngestPayload } from './contracts/ea_warnings_schema.js';

export const SNAPSHOT_STATION_IDS = Object.freeze([
  '52116', // Chiselborough (Upper Parrett)
  '52119', // Gaw Bridge (Mid Parrett)
  '52120', // Huish Episcopi PS (Yeo)
  '52153', // Midelney (Isle)
  '52233', // Monk's Leaze Clyse Upstream (Parrett)
  '52111', // Taunton Market (Tone)
  '52118', // Hookbridge Spillway (Tone)
  '52127', // Curry Moor Basin
  '52158', // Baltmoor Wall Levee & A361
  '52159', // Northmoor Basin
  '52157', // Beer Wall / Greylake (Sowy)
  '52163'  // Dunball Tidal Outfall (Tidal Parrett)
]);

let isWarningSyncRunning = false;
export const consecutiveAbsenceCounts = new Map();

/**
 * Returns true if the background EA warnings sync is currently executing.
 */
export function isWarningSyncActive() {
  return isWarningSyncRunning;
}

/**
 * Resets memory state (primarily for hermetic test execution).
 */
export function resetWarningManagerState() {
  isWarningSyncRunning = false;
  consecutiveAbsenceCounts.clear();
}

/**
 * Sanitizes upstream EA narrative text:
 * 1. Strips non-printable ASCII control characters.
 * 2. Escapes HTML entities to prevent stored XSS.
 * 3. Enforces a 2,048-character length limit.
 * 
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeEANarrative(raw) {
  if (typeof raw !== 'string') return '';
  const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim().slice(0, 2048);
  return escapeHTML(clean);
}

/**
 * Maps EA severityLevel (1-4) to canonical label.
 * 
 * @param {number} level
 * @returns {string}
 */
export function mapSeverityLevelToLabel(level) {
  switch (level) {
    case 1:
      return 'Severe Flood Warning';
    case 2:
      return 'Flood Warning';
    case 3:
      return 'Flood Alert';
    case 4:
      return 'Warning Removed';
    default:
      return 'Flood Alert';
  }
}

/**
 * Captures a concurrent 12-station snapshot of water elevations (mAOD) and momentum trends.
 * 
 * @param {object} measures - Dict of measure_id -> readings array, or stored object
 * @param {object} [options] - Options e.g. { timestamp }
 * @returns {object} Structured snapshot object
 */
export function capture12StationSnapshot(measures, options = {}) {
  const readingsMap = buildStationReadingsMap(measures);
  const capturedAt = options.timestamp || new Date().toISOString();
  const capturedMs = new Date(capturedAt).getTime();
  const stations = {};

  for (const stationId of SNAPSHOT_STATION_IDS) {
    const reg = STATION_REGISTRY[stationId];
    if (!reg) continue;

    const allReadings = readingsMap[stationId] || [];
    const latest = allReadings[0] || null;

    let stage = null;
    let freshness = 'STALE';

    if (latest && latest.value !== null && !isNaN(latest.value)) {
      stage = sanitizeStageValue(latest.value);
      if (latest.dateTime) {
        const ageMs = Math.max(0, capturedMs - new Date(latest.dateTime).getTime());
        const ageHours = ageMs / (1000 * 60 * 60);
        if (ageHours <= 2.0) freshness = 'FRESH';
        else if (ageHours <= 6.0) freshness = 'LAGGING';
      }
    }

    const rates = computeStageRates(allReadings, 0);
    const trendVector = computeTrendVector(allReadings);

    let alertMarginM = null;
    if (stage !== null && typeof reg.alert_level_mAOD === 'number') {
      alertMarginM = Number((reg.alert_level_mAOD - stage).toFixed(2));
    }

    let clearanceToCrestM = null;
    const crest = reg.crest_elevation_mAOD ?? reg.spillway_crest_mAOD;
    if (stage !== null && typeof crest === 'number') {
      clearanceToCrestM = Number((crest - stage).toFixed(2));
    }

    stations[stationId] = {
      name: reg.name,
      stage_mAOD: stage,
      datum_offset_mAOD: reg.datum_offset_mAOD || 0,
      rate_1h_mh: rates.rate_1h_m_per_hr,
      rate_3h_mh: rates.rate_3h_m_per_hr,
      trend_vector: trendVector,
      alert_margin_m: alertMarginM,
      clearance_to_crest_m: clearanceToCrestM,
      freshness
    };
  }

  return {
    captured_at: capturedAt,
    stations
  };
}

/**
 * Polls the Environment Agency Flood Monitoring API and manages warning lifecycles in SQLite.
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {typeof fetch} [fetchFn]
 * @param {number} [nowMs]
 * @param {object} [options]
 * @returns {Promise<{ processed: number, active_count: number, cleared: number }>}
 */
export async function pollAndProcessEAWarnings(
  db,
  fetchFn = globalThis.fetch,
  nowMs = Date.now(),
  options = {}
) {
  if (isWarningSyncRunning) {
    return { processed: 0, active_count: 0, cleared: 0, skipped: true };
  }
  isWarningSyncRunning = true;

  try {
    const url = options.url || 'https://environment.data.gov.uk/flood-monitoring/id/floods?county=Somerset';
    const parsed = new URL(url);

    // SSRF & Protocol Hardening [COND-SEC-01]
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'environment.data.gov.uk') {
      throw new Error(`SSRF Blocked: Unapproved protocol '${parsed.protocol}' or host '${parsed.hostname}'`);
    }

    const res = await fetchFn(url, {
      headers: { 'Accept': 'application/json' },
      redirect: 'error',
      signal: globalThis.AbortSignal?.timeout ? globalThis.AbortSignal.timeout(options.timeoutMs || 10000) : undefined
    });

    if (!res.ok) {
      throw new Error(`EA Flood Warnings API returned HTTP ${res.status}`);
    }

    const payload = await res.json();
    const contractResult = validateEAWarningsIngestPayload(payload);
    if (!contractResult.valid) {
      console.warn('[EA Ingest Contract Warning]', contractResult.errors.slice(0, 2).join('; '));
    }

    const rawItems = Array.isArray(payload.items) ? payload.items : [];

    // Query active warning sessions from database
    const activeDbRows = db.prepare(`SELECT * FROM ea_warning_events WHERE status = 'ACTIVE'`).all();
    const activeDbMap = new Map(activeDbRows.map(r => [r.target_area_notation, r]));

    // Zero-Trust Dropout Guard: Empty feed never spuriously clears active warnings
    if (rawItems.length === 0 && activeDbMap.size > 0) {
      console.warn('[EA Warning Manager Warning] Received empty feed while active warnings exist. Preserving active sessions.');
      return { processed: 0, active_count: activeDbMap.size, cleared: 0, preserved: true };
    }

    const activeInFeedMap = new Map();
    for (const item of rawItems) {
      const notation = item.floodAreaID || item.floodArea?.notation;
      if (notation && EA_FLOOD_AREA_CATALOG[notation]) {
        activeInFeedMap.set(notation, item);
      }
    }

    // Extract current telemetry measures for concurrent 12-station snapshot
    let measures = options.measures;
    if (!measures) {
      const rows = db.prepare('SELECT measure_id, readings_json FROM telemetry').all();
      measures = {};
      for (const r of rows) {
        try {
          measures[r.measure_id] = JSON.parse(r.readings_json);
        } catch {
          measures[r.measure_id] = [];
        }
      }
    }

    const currentSnapshot = capture12StationSnapshot(measures, {
      timestamp: new Date(nowMs).toISOString()
    });

    let processedCount = 0;
    let clearedCount = 0;

    db.transaction(() => {
      // 1. Process active warnings from EA feed
      for (const [notation, eaItem] of activeInFeedMap.entries()) {
        const severityLevel = Number(eaItem.severityLevel);

        // Guard: Severity 4 in feed must NEVER open new active events
        if (severityLevel === 4 || severityLevel < 1 || severityLevel > 3) {
          continue;
        }

        consecutiveAbsenceCounts.delete(notation);
        const activeDb = activeDbMap.get(notation);
        const severityLabel = mapSeverityLevelToLabel(severityLevel);
        const narrative = sanitizeEANarrative(eaItem.message || eaItem.description || '');
        const eaRaised = eaItem.timeRaised || eaItem.timeSeverityChanged || new Date(nowMs).toISOString();
        const eaSeverityChanged = eaItem.timeSeverityChanged || null;
        const eaMessageChanged = eaItem.timeMessageChanged || null;
        const associatedRoads = JSON.stringify(EA_FLOOD_AREA_CATALOG[notation].associated_roads || []);

        if (!activeDb) {
          // OPEN new warning event: trigger_snapshot_json is permanently set
          db.prepare(`
            INSERT INTO ea_warning_events (
              warning_id, target_area_notation, area_name,
              severity_level, severity_label, time_raised,
              time_severity_changed, time_message_changed, time_cleared,
              duration_seconds, narrative, trigger_snapshot_json,
              latest_snapshot_json, associated_roads_json, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, 'ACTIVE')
          `).run(
            eaItem['@id'] || `${notation}-${eaRaised}`,
            notation,
            EA_FLOOD_AREA_CATALOG[notation].name,
            severityLevel,
            severityLabel,
            eaRaised,
            eaSeverityChanged,
            eaMessageChanged,
            narrative,
            JSON.stringify(currentSnapshot),
            associatedRoads
          );
          processedCount++;
        } else {
          // UPDATE existing active event: trigger_snapshot_json remains untouched!
          const isSeverityChanged = activeDb.severity_level !== severityLevel;
          const isNarrativeChanged = activeDb.narrative !== narrative;

          if (isSeverityChanged || isNarrativeChanged) {
            db.prepare(`
              UPDATE ea_warning_events
              SET severity_level = ?,
                  severity_label = ?,
                  time_severity_changed = COALESCE(?, time_severity_changed),
                  time_message_changed = COALESCE(?, time_message_changed),
                  narrative = ?,
                  latest_snapshot_json = CASE WHEN ? THEN ? ELSE latest_snapshot_json END
              WHERE id = ?
            `).run(
              severityLevel,
              severityLabel,
              eaSeverityChanged,
              eaMessageChanged,
              narrative,
              isSeverityChanged ? 1 : 0,
              isSeverityChanged ? JSON.stringify(currentSnapshot) : null,
              activeDb.id
            );
            processedCount++;
          }
        }
      }

      // 2. Detect cleared warnings with 2-cycle hysteresis
      for (const [notation, activeDb] of activeDbMap.entries()) {
        const feedItem = activeInFeedMap.get(notation);
        const isExplicitlyCleared = feedItem && Number(feedItem.severityLevel) === 4;

        let shouldClose = isExplicitlyCleared;
        if (!feedItem) {
          const count = (consecutiveAbsenceCounts.get(notation) || 0) + 1;
          consecutiveAbsenceCounts.set(notation, count);
          if (count >= 2) {
            shouldClose = true;
          }
        }

        if (shouldClose) {
          consecutiveAbsenceCounts.delete(notation);
          const timeCleared = feedItem?.timeSeverityChanged || new Date(nowMs).toISOString();
          const clearedMs = new Date(timeCleared).getTime();
          const raisedMs = new Date(activeDb.time_raised).getTime();
          const diffSec = Math.floor((clearedMs - raisedMs) / 1000);
          const durationSec = Number.isFinite(diffSec) ? Math.max(0, diffSec) : null;

          // CLOSE active warning: active severity_level is permanently preserved
          db.prepare(`
            UPDATE ea_warning_events
            SET status = 'CLOSED',
                time_cleared = ?,
                duration_seconds = ?
            WHERE id = ?
          `).run(timeCleared, durationSec, activeDb.id);
          clearedCount++;
        }
      }
    })();

    const finalActiveRows = db.prepare(`SELECT count(*) as c FROM ea_warning_events WHERE status = 'ACTIVE'`).get();

    return {
      processed: processedCount,
      active_count: finalActiveRows?.c || 0,
      cleared: clearedCount
    };
  } finally {
    isWarningSyncRunning = false;
  }
}

/**
 * Returns summary metrics of active EA warnings for /api/status.
 * 
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
export function getEAWarningsSummary(db) {
  try {
    const rows = db.prepare(`
      SELECT target_area_notation, severity_level
      FROM ea_warning_events
      WHERE status = 'ACTIVE'
    `).all();

    let hasSevere = false;
    let hasWarning = false;
    let hasAlert = false;
    const targetAreas = [];

    for (const r of rows) {
      targetAreas.push(r.target_area_notation);
      if (r.severity_level === 1) hasSevere = true;
      else if (r.severity_level === 2) hasWarning = true;
      else if (r.severity_level === 3) hasAlert = true;
    }

    return {
      active_count: rows.length,
      has_severe_warning: hasSevere,
      has_flood_warning: hasWarning,
      has_flood_alert: hasAlert,
      target_areas_active: targetAreas
    };
  } catch (err) {
    return {
      active_count: 0,
      has_severe_warning: false,
      has_flood_warning: false,
      has_flood_alert: false,
      target_areas_active: [],
      error: err.message
    };
  }
}

/**
 * Returns a dictionary of active warning states by target area notation:
 * 'RED_WARNING' (severity 1 or 2) or 'AMBER_ALERT' (severity 3).
 * Used directly by evaluateRoadCorridor.
 * 
 * @param {import('better-sqlite3').Database} db
 * @returns {object} Dict of notation -> 'RED_WARNING' | 'AMBER_ALERT' | 'INACTIVE'
 */
export function getActiveEAWarningStatesMap(db) {
  const map = {};
  try {
    const rows = db.prepare(`
      SELECT target_area_notation, severity_level
      FROM ea_warning_events
      WHERE status = 'ACTIVE'
    `).all();

    for (const r of rows) {
      if (r.severity_level === 1 || r.severity_level === 2) {
        map[r.target_area_notation] = 'RED_WARNING';
      } else if (r.severity_level === 3) {
        map[r.target_area_notation] = 'AMBER_ALERT';
      }
    }
  } catch {
    // Return empty map on error
  }
  return map;
}

/**
 * Queries warnings from database with optional filters.
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function getEAWarnings(db, options = {}) {
  const status = (options.status || 'ACTIVE').toUpperCase();
  const area = options.area || null;
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));

  let sql = 'SELECT * FROM ea_warning_events WHERE 1=1';
  const params = [];

  if (status === 'ACTIVE' || status === 'CLOSED') {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (area) {
    sql += ' AND target_area_notation = ?';
    params.push(area);
  }

  sql += ' ORDER BY time_raised DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);

  return rows.map(r => {
    let triggerSnapshot = null;
    let latestSnapshot = null;
    let associatedRoads = [];

    try {
      if (r.trigger_snapshot_json) triggerSnapshot = JSON.parse(r.trigger_snapshot_json);
    } catch { /* ignore */ }

    try {
      if (r.latest_snapshot_json) latestSnapshot = JSON.parse(r.latest_snapshot_json);
    } catch { /* ignore */ }

    try {
      if (r.associated_roads_json) associatedRoads = JSON.parse(r.associated_roads_json);
    } catch { /* ignore */ }

    let durationFormatted = '—';
    if (r.duration_seconds && r.duration_seconds > 0) {
      const hrs = Math.floor(r.duration_seconds / 3600);
      const mins = Math.floor((r.duration_seconds % 3600) / 60);
      durationFormatted = `${hrs}h ${mins}m`;
    }

    return {
      id: r.id,
      warning_id: r.warning_id,
      target_area_notation: r.target_area_notation,
      area_name: r.area_name,
      severity_level: r.severity_level,
      severity_label: r.severity_label,
      time_raised: r.time_raised,
      time_severity_changed: r.time_severity_changed,
      time_message_changed: r.time_message_changed,
      time_cleared: r.time_cleared,
      duration_seconds: r.duration_seconds,
      duration_formatted: durationFormatted,
      narrative: r.narrative,
      trigger_snapshot: triggerSnapshot,
      latest_snapshot: latestSnapshot,
      associated_roads: associatedRoads,
      status: r.status
    };
  });
}
