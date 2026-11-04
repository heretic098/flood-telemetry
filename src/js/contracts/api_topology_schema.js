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
  alert_level_mAOD: optional(nullable(number())),
  alert_mAOD: optional(nullable(number())),
  baseline_mAOD: optional(nullable(number())),
  crest_elevation_mAOD: optional(nullable(number())),
  crest_mAOD: optional(nullable(number())),
  sill_elevation_mAOD: optional(nullable(number())),
  ground_elevation_mAOD: optional(nullable(number())),
  status: optional(string({ minLength: 1 })),
  status_code: optional(string({ minLength: 1 })),
  badge_class: optional(string({ minLength: 1 })),
  badge_label: optional(string({ minLength: 1 })),
  narrative: optional(string({ minLength: 1 })),
  has_live_telemetry: optional(boolean()),
  has_sparkline: optional(boolean()),
  sparkline: optional(array(object({
    dateTime: isoDate({ allowSqlite: true }),
    stage_mAOD: number()
  })))
});

/**
 * /api/topology Payload Schema
 */
export const apiTopologySchema = object({
  status: string({ pattern: /^ok$/ }),
  catchment_id: string({ minLength: 1 }),
  updated_at: isoDate({ allowSqlite: true }),
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

  // If payload contains nodes array, validate each node and check structural taxonomy invariants
  if (Array.isArray(payload.nodes)) {
    for (let i = 0; i < payload.nodes.length; i++) {
      const node = payload.nodes[i];
      const nodeRes = validate(topologyNodeSchema, node, `api_topology.nodes[${i}]`);
      if (!nodeRes.valid) {
        errors.push(...nodeRes.errors);
      }

      // Gauge Invariant [HYDRO-06]: pure gauges have no fixed overflow crest
      if (node.node_type === 'gauge') {
        if (node.crest_elevation_mAOD !== null && node.crest_elevation_mAOD !== undefined) {
          errors.push(`api_topology.nodes[${i}] (${node.id}): node_type "gauge" must have null or undefined crest_elevation_mAOD`);
        }
        if (node.crest_mAOD !== null && node.crest_mAOD !== undefined) {
          errors.push(`api_topology.nodes[${i}] (${node.id}): node_type "gauge" must have null or undefined crest_mAOD`);
        }
        const st = node.status || node.status_code;
        if (['OVERTOPPING', 'SUBMERGED', 'REVERSE_SPILL'].includes(st)) {
          errors.push(`api_topology.nodes[${i}] (${node.id}): node_type "gauge" cannot have overtopping status "${st}"`);
        }
      }

      // Spillway Invariant [HYDRO-07]: must define numerical crest_elevation_mAOD
      if (node.node_type === 'spillway') {
        const crest = (node.crest_elevation_mAOD !== undefined && node.crest_elevation_mAOD !== null)
          ? node.crest_elevation_mAOD
          : node.crest_mAOD;
        if (typeof crest !== 'number' || Number.isNaN(crest) || crest <= 0) {
          errors.push(`api_topology.nodes[${i}] (${node.id}): node_type "spillway" must define a positive numerical crest_elevation_mAOD`);
        }
      }

      // Clyse Gate Invariant [HYDRO-08]: must define numerical sill_elevation_mAOD
      if (node.node_type === 'clyse_gate') {
        if (typeof node.sill_elevation_mAOD !== 'number' || Number.isNaN(node.sill_elevation_mAOD) || node.sill_elevation_mAOD <= 0) {
          errors.push(`api_topology.nodes[${i}] (${node.id}): node_type "clyse_gate" must define a positive numerical sill_elevation_mAOD`);
        }
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
