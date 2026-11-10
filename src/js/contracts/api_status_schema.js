/**
 * /api/status Response Contract & Domain Invariant Enforcer
 * 
 * Enforces:
 * - [RULE-ENT-01]: Canonical Tripartite Entity Invariant (<asset_type, asset_id, status>)
 *   on active events.
 *   - .status: Lifecycle state strictly in ['ACTIVE', 'CLOSED'].
 *   - .to_state: Evaluated entity state strictly matching the 19 closed canonical dictionary states.
 * - [RULE-CALC-01]: Strict ban on volumetric discharge speculation (no cumecs, discharge_m3s, etc.).
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

import { CANONICAL_ASSET_TYPES, CANONICAL_STATES } from '../db_migrations.js';

export const FORBIDDEN_CALC_KEYS = Object.freeze([
  'cumecs',
  'discharge_m3s',
  'm3s',
  'flow_rate',
  'volumetric_flow',
  'megalitres_per_day'
]);

/**
 * Canonical Tripartite Active Event Schema [RULE-ENT-01]
 */
export const activeEventSchema = object({
  asset_type: enumValues(CANONICAL_ASSET_TYPES),
  asset_id: string({ minLength: 1 }),
  status: enumValues(['ACTIVE', 'CLOSED']),
  to_state: enumValues(CANONICAL_STATES),
  severity_tier: number({ min: 1, max: 4, integer: true }),
  start_time: isoDate({ allowSqlite: true }),
  duration_seconds: number({ min: 0 }),
  from_state: optional(nullable(enumValues(CANONICAL_STATES))),
  end_time: optional(nullable(isoDate({ allowSqlite: true }))),
  peak_stage_mAOD: optional(nullable(number())),
  peak_time: optional(nullable(isoDate({ allowSqlite: true }))),
  trigger_rate_15m_m_per_hr: optional(nullable(number())),
  trigger_rate_1h_m_per_hr: optional(nullable(number())),
  trigger_rate_3h_m_per_hr: optional(nullable(number())),
  max_rate_1h_m_per_hr: optional(nullable(number())),
  narrative: optional(nullable(string())),
  camera_id: optional(nullable(string())),
  camera_snapshot_id: optional(nullable(number({ integer: true }))),
  camera_evidence: optional(nullable(object({
    snapshot_id: optional(nullable(number({ integer: true }))),
    camera_id: optional(nullable(string())),
    camera_name: optional(nullable(string())),
    camera_description: optional(nullable(string())),
    camera_look_for: optional(nullable(string())),
    image_url: optional(nullable(string())),
    image_hash: optional(nullable(string())),
    fetched_at: optional(nullable(isoDate({ allowSqlite: true }))),
    trigger_reason: optional(nullable(string())),
    fallback_mode: optional(nullable(string())),
    keyframes: optional(nullable(object({
      start: optional(nullable(object({}))),
      peak: optional(nullable(object({}))),
      end: optional(nullable(object({})))
    }))),
    sequence_frames: optional(array(object({
      timestamp: optional(nullable(string())),
      image_url: optional(nullable(string()))
    })))
  }))),
  regime_signature: optional(nullable(object({
    anomaly_type: optional(string()),
    confidence: optional(string()),
    rate_1h_mh: optional(number()),
    rate_3h_mh: optional(number()),
    duration_hours: optional(number())
  })))
});

/**
 * Road Network Counts Schema
 */
export const roadCountsSchema = object({
  all: number({ min: 0, integer: true }),
  impassable: number({ min: 0, integer: true }),
  encroaching: number({ min: 0, integer: true }),
  passable: number({ min: 0, integer: true })
});

/**
 * Road Network Summary Schema
 */
export const roadSummarySchema = object({
  total: optional(number({ min: 0, integer: true })),
  all: optional(number({ min: 0, integer: true })),
  passable: number({ min: 0, integer: true }),
  encroaching: number({ min: 0, integer: true }),
  impassable: number({ min: 0, integer: true })
});

/**
 * EA Warnings Summary Schema
 */
export const eaWarningsSummarySchema = object({
  active_count: number({ min: 0, integer: true }),
  has_severe_warning: boolean(),
  has_flood_warning: boolean(),
  has_flood_alert: boolean(),
  target_areas_active: array(string({ minLength: 1 }))
});

/**
 * /api/status Payload Schema
 */
export const apiStatusSchema = object({
  status: string({ pattern: /^ok$/ }),
  system_timestamps: object({
    client_poll_at: isoDate({ allowSqlite: true }),
    db_synced_at: isoDate({ allowSqlite: true }),
    latest_ea_reading_at: isoDate({ allowSqlite: true })
  }),
  global_status: object({
    counter_pill: string({ minLength: 1 }),
    banner_text: string({ minLength: 1 }),
    top_severity: number({ min: 1, max: 5, integer: true }),
    is_tide_locked: boolean()
  }),
  ea_warnings: optional(eaWarningsSummarySchema),
  active_events: array(activeEventSchema),
  roads: object({
    counts: optional(roadCountsSchema),
    summary: optional(roadSummarySchema),
    corridors_list: array(object({
      asset_id: string({ minLength: 1 }),
      name: string({ minLength: 1 }),
      status: enumValues(['PASSABLE', 'ENCROACHING', 'IMPASSABLE']),
      stage_mAOD: nullable(number())
    }))
  })
});

/**
 * Validates an /api/status response payload for schema compliance
 * and deep [RULE-CALC-01] compliance.
 * 
 * @param {any} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateApiStatusPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['/api/status payload must be a non-null object'] };
  }

  // 1. Validate structured schema
  const res = validate(apiStatusSchema, payload, 'api_status');
  const errors = [...res.errors];

  if (payload.roads && !payload.roads.counts && !payload.roads.summary) {
    errors.push('api_status.roads: expected either "counts" or "summary" object');
  }

  // 2. Enforce deep recursive ban on volumetric discharge keys [RULE-CALC-01]
  const forbiddenErrors = assertNoForbiddenKeys(payload, FORBIDDEN_CALC_KEYS, 'api_status');
  errors.push(...forbiddenErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}
