/**
 * /api/rainfall Response Contract & Rainfall Summary Schema
 *
 * Enforces:
 * - [RULE-CALC-01]: Strict ban on volumetric runoff / discharge speculation
 *   (cumecs, discharge_m3s, volumetric_flow, megalitres_per_day, etc.).
 * - [RULE-PROV-01]: OGL v3.0 attribution and provenance metadata.
 * - [RULE-THRESH-01]: Unsurveyed TBR collector elevation remains null/UNSURVEYED.
 * - Rolling accumulation monotonicity (1h <= 6h <= 24h <= 48h) and
 *   chronological monotonic cumulative hyetograph series_15min.
 */

import {
  string,
  number,
  boolean,
  isoDate,
  enumValues,
  array,
  object,
  optional,
  nullable,
  FORBIDDEN_CALC_KEYS,
  assertNoForbiddenKeys,
  validate
} from './schema_validator.js';

export const RAINFALL_RATE_CATEGORIES = Object.freeze([
  'DRY',
  'LIGHT',
  'MODERATE',
  'HEAVY',
  'TORRENTIAL'
]);

export const CANONICAL_RAINFALL_CATCHMENT_IDS = Object.freeze([
  'tone_upland',
  'parrett_upland',
  'isle_upland',
  'moors_lowland'
]);

export const RAINFALL_ANOMALY_FLAGS = Object.freeze([
  'STALE_BATCH',
  'FREEZING_RISK'
]);

export const RAINFALL_FORBIDDEN_CALC_KEYS = Object.freeze([
  ...FORBIDDEN_CALC_KEYS,
  'discharge',
  'm3_s',
  'runoff_m3'
]);

export const rainfallSeriesPointSchema = object({
  timestamp: isoDate(),
  rainfall_mm: number({ min: 0, max: 100 }),
  cumulative_mm: number({ min: 0 })
});

export const rainfallProvenanceSchema = object({
  authority: string({ minLength: 1 }),
  licence: string({ pattern: /Open Government Licence v3\.0|OGL v3\.0/ }),
  licence_url: string({ pattern: /^https:\/\// }),
  attribution: string({ minLength: 1 }),
  sensor_type: optional(string({ pattern: /^tipping_bucket_raingauge$/ })),
  sensor_classification: optional(string({ pattern: /^ambient_environmental_sensor$/ })),
  is_civil_state_machine_entity: optional(boolean()),
  tip_resolution_mm: optional(number({ min: 0 })),
  interval_minutes: optional(number({ min: 1, integer: true })),
  period_seconds: optional(number({ min: 1, integer: true })),
  unit: optional(string({ pattern: /^mm$/ })),
  value_type: optional(string({ pattern: /^total$/ })),
  station_url: optional(string({ pattern: /^https:\/\// })),
  measure_url: optional(string({ pattern: /^https:\/\// }))
});

export const rainfallCoordinatesSchema = object({
  lat: number({ min: -90, max: 90 }),
  long: number({ min: -180, max: 180 }),
  easting: optional(number({ min: 0 })),
  northing: optional(number({ min: 0 })),
  grid_reference: optional(string({ minLength: 1 }))
});

export const rainfallStationSchema = object({
  id: string({ minLength: 1 }),
  notation: optional(string({ minLength: 1 })),
  wiski_id: optional(nullable(string({ minLength: 1 }))),
  name: string({ minLength: 1 }),
  ea_label: optional(string({ minLength: 1 })),
  measure_id: string({ minLength: 1 }),
  catchment: enumValues(CANONICAL_RAINFALL_CATCHMENT_IDS),
  catchment_tags: optional(array(string({ minLength: 1 }))),
  pillar: enumValues(['upland', 'lowland']),
  sub_catchment: optional(string()),
  correlated_river_station_id: optional(nullable(string({ minLength: 1 }))),
  elevation_mAOD: nullable(number()),
  survey_status: optional(enumValues(['UNSURVEYED', 'TIER_1_SURVEYED', 'TIER_2_TRIGGER_PLAN'])),
  coordinates: rainfallCoordinatesSchema,
  tip_resolution_mm: optional(number({ min: 0 })),
  provenance: optional(rainfallProvenanceSchema),
  last_1h_mm: number({ min: 0 }),
  last_6h_mm: number({ min: 0 }),
  last_24h_mm: number({ min: 0 }),
  last_48h_mm: number({ min: 0 }),
  rate_mm_per_hr: number({ min: 0 }),
  rate_label: string({ minLength: 1 }),
  intensity_category: enumValues(RAINFALL_RATE_CATEGORIES),
  rate_category: optional(enumValues(RAINFALL_RATE_CATEGORIES)),
  is_stale: boolean(),
  freezing_risk: boolean(),
  age_minutes: nullable(number({ min: 0, integer: true })),
  latest_timestamp: nullable(isoDate({ allowSqlite: true })),
  anomaly_flags: optional(array(enumValues(RAINFALL_ANOMALY_FLAGS))),
  valid_reading_count: optional(number({ min: 0, integer: true })),
  rejected_reading_count: optional(number({ min: 0, integer: true })),
  series_15min: array(rainfallSeriesPointSchema)
});

export const rainfallCatchmentSchema = object({
  id: enumValues(CANONICAL_RAINFALL_CATCHMENT_IDS),
  label: string({ minLength: 1 }),
  short_label: string({ minLength: 1 }),
  pillar: enumValues(['upland', 'lowland']),
  river: optional(string()),
  station_count: number({ min: 0, integer: true }),
  active_station_count: number({ min: 0, integer: true }),
  mean_1h_mm: number({ min: 0 }),
  mean_6h_mm: number({ min: 0 }),
  mean_24h_mm: number({ min: 0 }),
  mean_48h_mm: number({ min: 0 }),
  peak_1h_mm: number({ min: 0 }),
  peak_6h_mm: number({ min: 0 }),
  peak_24h_mm: number({ min: 0 }),
  peak_48h_mm: number({ min: 0 }),
  peak_station: nullable(string({ minLength: 1 })),
  peak_station_id: optional(nullable(string({ minLength: 1 }))),
  peak_intensity_station: optional(nullable(string({ minLength: 1 }))),
  peak_intensity_station_id: optional(nullable(string({ minLength: 1 }))),
  rate_category: enumValues(RAINFALL_RATE_CATEGORIES),
  peak_rate_category: optional(enumValues(RAINFALL_RATE_CATEGORIES)),
  rate_label: string({ minLength: 1 }),
  has_freezing_risk: optional(boolean()),
  all_stale: boolean()
});

export const rainfallSummarySchema = object({
  basin_1h_mean_mm: optional(number({ min: 0 })),
  basin_6h_mean_mm: optional(number({ min: 0 })),
  basin_24h_mean_mm: number({ min: 0 }),
  basin_48h_mean_mm: optional(number({ min: 0 })),
  upland_peak_station: nullable(string({ minLength: 1 })),
  upland_peak_station_id: optional(nullable(string({ minLength: 1 }))),
  upland_peak_24h_mm: number({ min: 0 }),
  upland_peak_1h_mm: optional(number({ min: 0 })),
  rate_category: enumValues(RAINFALL_RATE_CATEGORIES)
});

export const apiRainfallSchema = object({
  status: string({ pattern: /^ok$/ }),
  source: optional(string({ minLength: 1 })),
  updated_at: isoDate({ allowSqlite: true }),
  latest_rainfall_reading_at: nullable(isoDate({ allowSqlite: true })),
  provenance: rainfallProvenanceSchema,
  rainfall_summary: rainfallSummarySchema,
  catchments: object({
    tone_upland: rainfallCatchmentSchema,
    parrett_upland: rainfallCatchmentSchema,
    isle_upland: rainfallCatchmentSchema,
    moors_lowland: rainfallCatchmentSchema
  }),
  stations: array(rainfallStationSchema)
});

/**
 * Checks rolling-window monotonicity invariants on a `rainfall_summary` object.
 *
 * @param {any} summary
 * @param {string} [path='rainfall_summary']
 * @returns {string[]}
 */
export function validateRainfallSummaryInvariants(summary, path = 'rainfall_summary') {
  const errors = [];
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return errors;
  }

  const orderedMeans = [
    ['basin_1h_mean_mm', summary.basin_1h_mean_mm],
    ['basin_6h_mean_mm', summary.basin_6h_mean_mm],
    ['basin_24h_mean_mm', summary.basin_24h_mean_mm],
    ['basin_48h_mean_mm', summary.basin_48h_mean_mm]
  ].filter(([, val]) => typeof val === 'number' && Number.isFinite(val));

  for (let i = 1; i < orderedMeans.length; i++) {
    const [prevKey, prevVal] = orderedMeans[i - 1];
    const [currKey, currVal] = orderedMeans[i];
    if (prevVal > currVal) {
      errors.push(`${path}: rolling basin means violate monotonicity (${prevKey}=${prevVal} > ${currKey}=${currVal})`);
      break;
    }
  }

  if (typeof summary.upland_peak_1h_mm === 'number' && Number.isFinite(summary.upland_peak_1h_mm) &&
      typeof summary.upland_peak_24h_mm === 'number' && Number.isFinite(summary.upland_peak_24h_mm) &&
      summary.upland_peak_1h_mm > summary.upland_peak_24h_mm) {
    errors.push(`${path}: upland_peak_1h_mm (${summary.upland_peak_1h_mm}) exceeds upland_peak_24h_mm (${summary.upland_peak_24h_mm})`);
  }

  return errors;
}

/**
 * Validates an /api/rainfall response payload for schema conformance,
 * rolling-window monotonicity, chronological series ordering, and
 * deep [RULE-CALC-01] volumetric key prohibition.
 *
 * @param {any} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateApiRainfallPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['/api/rainfall payload must be a non-null object'] };
  }

  const res = validate(apiRainfallSchema, payload, 'api_rainfall');
  const errors = [...res.errors];

  errors.push(...validateRainfallSummaryInvariants(payload.rainfall_summary, 'api_rainfall.rainfall_summary'));

  // Cross-field catchment invariants
  if (payload.catchments && typeof payload.catchments === 'object') {
    for (const zoneId of CANONICAL_RAINFALL_CATCHMENT_IDS) {
      const c = payload.catchments[zoneId];
      if (!c || typeof c !== 'object') continue;
      if (typeof c.active_station_count === 'number' && typeof c.station_count === 'number' &&
          c.active_station_count > c.station_count) {
        errors.push(`api_rainfall.catchments.${zoneId}: active_station_count (${c.active_station_count}) exceeds station_count (${c.station_count})`);
      }
      if (typeof c.mean_1h_mm === 'number' && typeof c.mean_6h_mm === 'number' &&
          typeof c.mean_24h_mm === 'number' && typeof c.mean_48h_mm === 'number') {
        if (c.mean_1h_mm > c.mean_6h_mm || c.mean_6h_mm > c.mean_24h_mm || c.mean_24h_mm > c.mean_48h_mm) {
          errors.push(`api_rainfall.catchments.${zoneId}: rolling mean accumulations violate monotonicity`);
        }
      }
      if (typeof c.peak_1h_mm === 'number' && typeof c.peak_6h_mm === 'number' &&
          typeof c.peak_24h_mm === 'number' && typeof c.peak_48h_mm === 'number') {
        if (c.peak_1h_mm > c.peak_6h_mm || c.peak_6h_mm > c.peak_24h_mm || c.peak_24h_mm > c.peak_48h_mm) {
          errors.push(`api_rainfall.catchments.${zoneId}: rolling peak accumulations violate monotonicity`);
        }
      }
    }
  }

  // Cross-field station invariants
  if (Array.isArray(payload.stations)) {
    for (let i = 0; i < payload.stations.length; i++) {
      const st = payload.stations[i];
      if (!st || typeof st !== 'object') continue;
      const prefix = `api_rainfall.stations[${i}]`;

      if (typeof st.last_1h_mm === 'number' && typeof st.last_6h_mm === 'number' &&
          typeof st.last_24h_mm === 'number' && typeof st.last_48h_mm === 'number') {
        if (st.last_1h_mm > st.last_6h_mm || st.last_6h_mm > st.last_24h_mm || st.last_24h_mm > st.last_48h_mm) {
          errors.push(`${prefix}: rolling totals violate monotonicity (1h <= 6h <= 24h <= 48h)`);
        }
      }

      if (st.survey_status === 'UNSURVEYED' && st.elevation_mAOD !== null) {
        errors.push(`${prefix}: UNSURVEYED station must have elevation_mAOD === null ([RULE-THRESH-01])`);
      }

      if (st.is_stale === false && (st.age_minutes === null || st.latest_timestamp === null)) {
        errors.push(`${prefix}: non-stale station must have non-null age_minutes and latest_timestamp`);
      }

      if (Array.isArray(st.series_15min)) {
        let prevEpoch = -Infinity;
        let prevCum = -Infinity;
        for (let j = 0; j < st.series_15min.length; j++) {
          const pt = st.series_15min[j];
          if (!pt || typeof pt !== 'object') continue;
          const epoch = Date.parse(pt.timestamp);
          if (Number.isFinite(epoch)) {
            if (epoch <= prevEpoch) {
              errors.push(`${prefix}.series_15min[${j}]: timestamps must be strictly chronologically ascending`);
              break;
            }
            prevEpoch = epoch;
          }
          if (typeof pt.cumulative_mm === 'number') {
            if (pt.cumulative_mm < prevCum) {
              errors.push(`${prefix}.series_15min[${j}]: cumulative_mm must be monotonically non-decreasing`);
              break;
            }
            prevCum = pt.cumulative_mm;
          }
        }
      }
    }
  }

  // Deep recursive ban on volumetric discharge keys [RULE-CALC-01]
  const forbiddenErrors = assertNoForbiddenKeys(payload, RAINFALL_FORBIDDEN_CALC_KEYS, 'api_rainfall');
  errors.push(...forbiddenErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}
