/**
 * Environment Agency 15-Minute Rainfall Batch Ingest Helpers (OGL v3.0)
 *
 * Handles intermittent outstation burst dumps (24–48+ readings per wake cycle)
 * with idempotent INSERT OR IGNORE persistence into `historical_rainfall`,
 * strict separation from `telemetry_events` ([RULE-ENT-01]), and per-item
 * plausibility sanitization ([0.0, 100.0] mm per 15-min interval).
 */

import * as hydroEngine from '../hydro_engine.js';
import {
  filterCleanRainfallItems,
  sanitizeRainfallValue
} from '../contracts/ea_telemetry_schema.js';

export const DEFAULT_RAINGAUGE_SYNC_LIMIT = 192;

/**
 * Extracts all configured EA rainfall measure IDs from the hydro_engine SSOT
 * (`RAINGAUGE_REGISTRY`) without hardcoding station constants ([RULE-SSOT-01]).
 *
 * @param {Record<string, object>|Array<object>|null|undefined} [registry]
 * @returns {string[]}
 */
export function getRainfallMeasureIds(registry) {
  const sourceRegistry = arguments.length === 0 ? hydroEngine.RAINGAUGE_REGISTRY : registry;
  if (!sourceRegistry || typeof sourceRegistry !== 'object') return [];
  const entries = Array.isArray(sourceRegistry) ? sourceRegistry : Object.values(sourceRegistry);
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const measureId = entry.measure_id || entry.measureId;
    if (typeof measureId === 'string' && measureId.trim().length > 0) {
      ids.add(measureId.trim());
    }
  }
  return Array.from(ids);
}

/**
 * Determines whether a measure ID represents an EA rainfall measure.
 *
 * @param {string} measureId
 * @param {Record<string, object>|Array<object>|null|undefined} [registry]
 * @returns {boolean}
 */
export function isRainfallMeasureId(measureId, registry = hydroEngine.RAINGAUGE_REGISTRY) {
  if (typeof measureId !== 'string' || measureId.trim().length === 0) return false;
  if (measureId.includes('-rainfall-')) return true;
  return getRainfallMeasureIds(registry).includes(measureId);
}

/**
 * Idempotently persists a batch of sanitized rainfall readings into `historical_rainfall`.
 * Safe against duplicate timestamps, overlapping burst dumps, and out-of-order arrivals.
 *
 * @param {import('better-sqlite3').Database} dbInstance
 * @param {string} measureId
 * @param {Array<{ measure_id?: string, dateTime: string, rainfall_mm?: number, value?: number }>} items
 * @returns {{ attempted: number, inserted: number, skipped: number }}
 */
export function ingestRainfallBatch(dbInstance, measureId, items) {
  if (!dbInstance || !Array.isArray(items) || items.length === 0) {
    return { attempted: 0, inserted: 0, skipped: 0 };
  }

  const stmt = dbInstance.prepare(`
    INSERT OR IGNORE INTO historical_rainfall (measure_id, date_time, rainfall_mm)
    VALUES (?, ?, ?)
  `);

  const fallbackMeasureId = typeof measureId === 'string' ? measureId.trim() : '';

  const runBatch = dbInstance.transaction((batch) => {
    let inserted = 0;
    let skipped = 0;
    for (const item of batch) {
      if (!item || typeof item.dateTime !== 'string') {
        skipped++;
        continue;
      }
      const cleanDateTime = item.dateTime.trim();
      if (cleanDateTime.length === 0 || !Number.isFinite(Date.parse(cleanDateTime))) {
        skipped++;
        continue;
      }
      const rawVal = item.rainfall_mm !== undefined ? item.rainfall_mm : item.value;
      const cleanMm = sanitizeRainfallValue(rawVal);
      if (cleanMm === null) {
        skipped++;
        continue;
      }
      const targetMeasureId = (typeof item.measure_id === 'string' && item.measure_id.trim().length > 0)
        ? item.measure_id.trim()
        : fallbackMeasureId;
      if (targetMeasureId.length === 0) {
        skipped++;
        continue;
      }
      const info = stmt.run(targetMeasureId, cleanDateTime, cleanMm);
      if (info.changes > 0) inserted++;
    }
    return { attempted: batch.length, inserted, skipped };
  });

  return runBatch(items);
}

/**
 * Fetches an EA rainfall measure endpoint, validates envelope & per-item plausibility,
 * and persists valid readings via `ingestRainfallBatch`.
 *
 * @param {import('better-sqlite3').Database} dbInstance
 * @param {string} measureId
 * @param {string} url
 * @param {typeof globalThis.fetch} [fetchFn]
 * @param {string} [logPrefix]
 * @returns {Promise<{ ok: boolean, cleanItems: Array<object>, inserted: number, rejectedCount: number }>}
 */
export async function fetchAndIngestRainfallMeasure(
  dbInstance,
  measureId,
  url,
  fetchFn = globalThis.fetch,
  logPrefix = '[Rainfall Ingest]'
) {
  try {
    const res = await fetchFn(url);
    if (!res || !res.ok) {
      console.warn(`${logPrefix} HTTP ${res ? res.status : 'unknown'} for rainfall measure ${measureId}`);
      return { ok: false, cleanItems: [], inserted: 0, rejectedCount: 0 };
    }

    const data = await res.json();
    const filtered = filterCleanRainfallItems(data, measureId);
    if (!filtered.validEnvelope) {
      console.warn(`${logPrefix} Invalid payload for ${measureId}:`, filtered.errors.slice(0, 2).join('; '));
      return { ok: false, cleanItems: [], inserted: 0, rejectedCount: 0 };
    }

    if (filtered.rejectedCount > 0) {
      console.warn(
        `${logPrefix} Filtered ${filtered.rejectedCount} invalid reading(s) for ${measureId}:`,
        filtered.errors.slice(0, 2).join('; ')
      );
    }

    const { inserted } = ingestRainfallBatch(dbInstance, measureId, filtered.cleanItems);
    return {
      ok: true,
      cleanItems: filtered.cleanItems,
      inserted,
      rejectedCount: filtered.rejectedCount
    };
  } catch (err) {
    console.warn(`${logPrefix} Failed to ingest rainfall measure ${measureId}:`, err.message);
    return { ok: false, cleanItems: [], inserted: 0, rejectedCount: 0 };
  }
}

/**
 * Polls recent EA 15-minute rainfall readings for a single rainfall measure.
 *
 * @param {string} measureId
 * @param {number} [limit=192]
 * @param {typeof globalThis.fetch} [fetchFn]
 * @param {import('better-sqlite3').Database} dbInstance
 * @returns {Promise<Array<{ measure_id: string, dateTime: string, rainfall_mm: number }>|null>}
 */
export async function syncRainfallMeasure(
  measureId,
  limit = DEFAULT_RAINGAUGE_SYNC_LIMIT,
  fetchFn = globalThis.fetch,
  dbInstance
) {
  const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${measureId}/readings?_sorted&_limit=${limit}`;
  const result = await fetchAndIngestRainfallMeasure(dbInstance, measureId, url, fetchFn, '[Rainfall Ingest]');
  return result.ok ? result.cleanItems : null;
}

/**
 * Reads recent 15-minute rainfall readings from `historical_rainfall` for all configured
 * stations in `RAINGAUGE_REGISTRY` and aggregates rolling accumulators, catchment means,
 * quantized 24h hyetograph series, and basin-wide summary metrics ([RULE-SSOT-01], [RULE-CALC-01]).
 *
 * Null-safe when `historical_rainfall` is empty or contains stale/future-drifted rows.
 *
 * @param {import('better-sqlite3').Database|null|undefined} dbInstance
 * @param {object} [options]
 * @param {number|string|Date} [options.nowMs]
 * @param {number|string|Date} [options.referenceTime]
 * @param {Record<string, object>} [options.registry]
 * @param {number} [options.maxStaleMinutes]
 * @param {number} [options.futureDriftToleranceMs=120000]
 * @param {number|null} [options.ambientTempC]
 * @returns {{ catchments: Record<string, object>, stations: Array<object>, stations_by_id: Record<string, object>, rainfall_summary: object, latest_rainfall_reading_at: string|null, updated_at: string }}
 */
export function getRainfallTelemetrySnapshot(dbInstance, options = {}) {
  const period = hydroEngine.normalizeRainfallPeriod(options.period);
  const periodCfg = hydroEngine.RAINFALL_PERIOD_CONFIG[period];
  const rawRef = options.nowMs ?? options.referenceTime ?? Date.now();
  const parsedRef = typeof rawRef === 'number' ? rawRef : Date.parse(String(rawRef));
  const nowMs = (Number.isFinite(parsedRef) && !Number.isNaN(parsedRef)) ? parsedRef : Date.now();
  const futureDriftMs = options.futureDriftToleranceMs ?? 120 * 1000;
  const upperBoundMs = nowMs + futureDriftMs;
  const lookbackMs = periodCfg.lookback_hours * 3600 * 1000;
  const sinceIso = new Date(nowMs - lookbackMs).toISOString();

  const registry = options.registry || hydroEngine.RAINGAUGE_REGISTRY;
  const readingsByMeasure = {};
  let earliestRainfallReadingAt = null;

  if (dbInstance && typeof dbInstance.prepare === 'function') {
    const earliestRow = dbInstance.prepare(`
      SELECT MIN(date_time) AS earliest_ts
      FROM historical_rainfall
    `).get();
    if (earliestRow && typeof earliestRow.earliest_ts === 'string') {
      earliestRainfallReadingAt = earliestRow.earliest_ts;
    }

    const recentStmt = dbInstance.prepare(`
      SELECT date_time, rainfall_mm
      FROM historical_rainfall
      WHERE measure_id = ? AND date_time >= ?
      ORDER BY date_time ASC
    `);
    const latestFallbackStmt = dbInstance.prepare(`
      SELECT date_time, rainfall_mm
      FROM historical_rainfall
      WHERE measure_id = ? AND date_time < ?
      ORDER BY date_time DESC
      LIMIT 5
    `);

    for (const stationDef of Object.values(registry)) {
      if (!stationDef || typeof stationDef.measure_id !== 'string') continue;
      const measureId = stationDef.measure_id;
      const recentRows = recentStmt.all(measureId, sinceIso);
      const hasEligibleRecent = recentRows.some((r) => {
        const ms = Date.parse(r.date_time);
        return Number.isFinite(ms) && ms <= upperBoundMs;
      });

      if (hasEligibleRecent) {
        readingsByMeasure[measureId] = recentRows;
      } else {
        const fallbackRows = latestFallbackStmt.all(measureId, sinceIso);
        const eligibleFallback = fallbackRows.find((r) => {
          const ms = Date.parse(r.date_time);
          return Number.isFinite(ms) && ms <= upperBoundMs;
        });
        readingsByMeasure[measureId] = eligibleFallback
          ? [...recentRows, eligibleFallback]
          : recentRows;
      }
    }
  }

  const aggregated = hydroEngine.aggregateCatchmentRainfall(readingsByMeasure, {
    ...options,
    period,
    registry,
    nowMs
  });

  let latestTimestampMs = -Infinity;
  let latestRainfallReadingAt = null;
  for (const st of aggregated.stations) {
    if (typeof st.latest_timestamp === 'string') {
      const ms = Date.parse(st.latest_timestamp);
      if (Number.isFinite(ms) && ms > latestTimestampMs) {
        latestTimestampMs = ms;
        latestRainfallReadingAt = st.latest_timestamp;
      }
    }
  }

  const earliestMs = earliestRainfallReadingAt ? Date.parse(earliestRainfallReadingAt) : NaN;
  const archiveCoverageHours = Number.isFinite(earliestMs)
    ? Number(Math.max(0, (nowMs - earliestMs) / 3600000).toFixed(1))
    : 0.0;
  const isPartialArchive = archiveCoverageHours < (periodCfg.window_hours * 0.9);

  return {
    ...aggregated,
    period,
    bucket_minutes: periodCfg.bucket_minutes,
    bucket_label: periodCfg.bucket_label,
    archive_coverage_hours: archiveCoverageHours,
    is_partial_archive: isPartialArchive,
    earliest_rainfall_reading_at: earliestRainfallReadingAt,
    latest_rainfall_reading_at: latestRainfallReadingAt,
    updated_at: new Date(nowMs).toISOString()
  };
}
