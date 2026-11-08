/**
 * Environment Agency (EA) Flood Alerts & Warnings Contracts [RULE-CALC-01] [RULE-ENT-01]
 * 
 * Validates:
 * 1. Raw EA /flood-monitoring/id/floods ingest payload.
 * 2. /api/warnings response payload.
 * Enforces deep ban on volumetric calculations (cumecs, discharge_m3s, etc.).
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
  assertNoForbiddenKeys,
  validate
} from './schema_validator.js';

import { FORBIDDEN_CALC_KEYS } from './api_status_schema.js';

/**
 * Raw EA /flood-monitoring/id/floods single item schema
 */
export const eaFloodItemSchema = object({
  '@id': optional(string({ minLength: 1 })),
  floodAreaID: optional(string({ minLength: 1 })),
  floodArea: optional(object({
    notation: optional(string({ minLength: 1 })),
    label: optional(string())
  })),
  severityLevel: number({ min: 1, max: 4, integer: true }),
  severity: optional(string()),
  timeRaised: optional(nullable(isoDate({ allowSqlite: true }))),
  timeSeverityChanged: optional(nullable(isoDate({ allowSqlite: true }))),
  timeMessageChanged: optional(nullable(isoDate({ allowSqlite: true }))),
  message: optional(nullable(string())),
  description: optional(nullable(string()))
});

/**
 * Raw EA /flood-monitoring/id/floods payload schema
 */
export const eaFloodsIngestSchema = object({
  items: array(eaFloodItemSchema)
});

/**
 * Station reading in concurrent gauge snapshot
 */
export const gaugeSnapshotStationSchema = object({
  name: string({ minLength: 1 }),
  stage_mAOD: nullable(number()),
  datum_offset_mAOD: optional(number()),
  rate_1h_mh: optional(nullable(number())),
  rate_3h_mh: optional(nullable(number())),
  trend_vector: optional(string()),
  alert_margin_m: optional(nullable(number())),
  clearance_to_crest_m: optional(nullable(number())),
  freshness: optional(string())
});

/**
 * Complete concurrent 12-station snapshot schema
 */
export const gaugeSnapshotSchema = object({
  captured_at: optional(nullable(isoDate({ allowSqlite: true }))),
  stations: optional(nullable(object({}, { allowUnknown: true })))
});

/**
 * Stored or API single warning event schema
 */
export const warningEventSchema = object({
  id: number({ min: 1, integer: true }),
  warning_id: string({ minLength: 1 }),
  target_area_notation: string({ minLength: 1 }),
  area_name: string({ minLength: 1 }),
  severity_level: number({ min: 1, max: 3, integer: true }),
  severity_label: enumValues([
    'Severe Flood Warning',
    'Flood Warning',
    'Flood Alert'
  ]),
  time_raised: isoDate({ allowSqlite: true }),
  time_severity_changed: optional(nullable(isoDate({ allowSqlite: true }))),
  time_message_changed: optional(nullable(isoDate({ allowSqlite: true }))),
  time_cleared: optional(nullable(isoDate({ allowSqlite: true }))),
  duration_seconds: optional(nullable(number({ min: 0 }))),
  duration_formatted: optional(string()),
  narrative: string(),
  trigger_snapshot: optional(nullable(gaugeSnapshotSchema)),
  latest_snapshot: optional(nullable(gaugeSnapshotSchema)),
  associated_roads: optional(array(string({ minLength: 1 }))),
  correlated_roads: optional(array(object({
    asset_id: string({ minLength: 1 }),
    name: string({ minLength: 1 }),
    current_status: enumValues(['PASSABLE', 'ENCROACHING', 'IMPASSABLE']),
    crown_elevation_mAOD: number(),
    clearance_m: nullable(number()),
    historical_median_lead_time_hours: optional(nullable(number()))
  }))),
  status: enumValues(['ACTIVE', 'CLOSED'])
});

/**
 * /api/warnings response payload schema
 */
export const apiWarningsResponseSchema = object({
  status: string({ pattern: /^ok$/ }),
  count: number({ min: 0, integer: true }),
  warnings: array(warningEventSchema)
});

/**
 * Validates raw Environment Agency /flood-monitoring/id/floods ingest payload.
 * 
 * @param {any} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEAWarningsIngestPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['EA floods ingest payload must be a non-null object'] };
  }

  const res = validate(eaFloodsIngestSchema, payload, 'ea_floods_ingest');
  const errors = [...res.errors];

  // Deep ban on forbidden volumetric keys [RULE-CALC-01]
  const forbiddenErrors = assertNoForbiddenKeys(payload, FORBIDDEN_CALC_KEYS, 'ea_floods_ingest');
  errors.push(...forbiddenErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates /api/warnings endpoint response payload.
 * 
 * @param {any} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateApiWarningsPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['/api/warnings payload must be a non-null object'] };
  }

  const res = validate(apiWarningsResponseSchema, payload, 'api_warnings');
  const errors = [...res.errors];

  // Deep ban on forbidden volumetric keys [RULE-CALC-01]
  const forbiddenErrors = assertNoForbiddenKeys(payload, FORBIDDEN_CALC_KEYS, 'api_warnings');
  errors.push(...forbiddenErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}
