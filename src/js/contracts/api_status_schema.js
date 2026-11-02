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
  start_time: isoDate(),
  duration_seconds: number({ min: 0 }),
  from_state: optional(nullable(enumValues(CANONICAL_STATES))),
  end_time: optional(nullable(isoDate())),
  peak_stage_mAOD: optional(nullable(number())),
  narrative: optional(nullable(string()))
});

/**
 * Road Network Summary Schema
 */
export const roadSummarySchema = object({
  total: number({ min: 0, integer: true }),
  passable: number({ min: 0, integer: true }),
  encroaching: number({ min: 0, integer: true }),
  impassable: number({ min: 0, integer: true })
});

/**
 * /api/status Payload Schema
 */
export const apiStatusSchema = object({
  status: string({ pattern: /^ok$/ }),
  system_timestamps: object({
    client_poll_at: isoDate(),
    db_synced_at: isoDate(),
    latest_ea_reading_at: isoDate()
  }),
  global_status: object({
    counter_pill: string({ minLength: 1 }),
    banner_text: string({ minLength: 1 }),
    top_severity: number({ min: 1, max: 4, integer: true }),
    is_tide_locked: boolean()
  }),
  active_events: array(activeEventSchema),
  roads: object({
    summary: roadSummarySchema,
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

  // 2. Enforce deep recursive ban on volumetric discharge keys [RULE-CALC-01]
  const forbiddenErrors = assertNoForbiddenKeys(payload, FORBIDDEN_CALC_KEYS, 'api_status');
  errors.push(...forbiddenErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}
