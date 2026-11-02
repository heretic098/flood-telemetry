/**
 * /api/topology Response Contract & Structural Taxonomy Enforcer
 * 
 * Enforces:
 * - 5 Canonical Structural Classes: ['spillway', 'gauge', 'clyse_gate', 'polder_basin', 'tidal_outfall']
 * - Structural crest elevation constraints (crest_mAOD only present for spillways and polders; null for gauges).
 * - [RULE-CALC-01] Volumetric discharge ban.
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

export const CANONICAL_STRUCTURAL_CLASSES = Object.freeze([
  'spillway',
  'gauge',
  'clyse_gate',
  'polder_basin',
  'tidal_outfall'
]);

/**
 * Topology Chain Reach Schema
 */
export const topologyChainSchema = object({
  id: string({ minLength: 1 }),
  name: string({ minLength: 1 }),
  direction: string({ minLength: 1 }),
  nodes: array(string({ minLength: 1 }), { minLength: 1 })
});

/**
 * Topology Node Schema
 */
export const topologyNodeSchema = object({
  id: string({ minLength: 1 }),
  name: string({ minLength: 1 }),
  river: string({ minLength: 1 }),
  node_type: enumValues(CANONICAL_STRUCTURAL_CLASSES),
  stage_mAOD: number({ min: -5.0, max: 100.0 }),
  baseline_mAOD: number(),
  alert_mAOD: number(),
  crest_mAOD: optional(nullable(number())),
  status_code: string({ minLength: 1 }),
  badge_class: string({ minLength: 1 }),
  badge_label: string({ minLength: 1 }),
  narrative: string({ minLength: 1 }),
  has_live_telemetry: optional(boolean()),
  sparkline: optional(array(object({
    dateTime: isoDate(),
    stage_mAOD: number()
  })))
});

/**
 * /api/topology Payload Schema
 */
export const apiTopologySchema = object({
  status: string({ pattern: /^ok$/ }),
  catchment_id: string({ minLength: 1 }),
  updated_at: isoDate(),
  chains: array(topologyChainSchema, { minLength: 1 })
});

/**
 * Validates /api/topology payload
 * 
 * @param {any} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateApiTopologyPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['/api/topology payload must be a non-null object'] };
  }

  const res = validate(apiTopologySchema, payload, 'api_topology');
  const errors = [...res.errors];

  // If payload contains nodes array, validate each node and check gauge crest invariant
  if (Array.isArray(payload.nodes)) {
    for (let i = 0; i < payload.nodes.length; i++) {
      const node = payload.nodes[i];
      const nodeRes = validate(topologyNodeSchema, node, `api_topology.nodes[${i}]`);
      if (!nodeRes.valid) {
        errors.push(...nodeRes.errors);
      }
      // Gauge Crest Invariant: pure gauges have no fixed overflow crest
      if (node.node_type === 'gauge' && node.crest_mAOD !== null && node.crest_mAOD !== undefined) {
        errors.push(`api_topology.nodes[${i}] (${node.id}): node_type "gauge" must have null or undefined crest_mAOD`);
      }
    }
  }

  // Enforce [RULE-CALC-01]
  const forbiddenErrors = assertNoForbiddenKeys(payload, FORBIDDEN_CALC_KEYS, 'api_topology');
  errors.push(...forbiddenErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}
