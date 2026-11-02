import test from 'node:test';
import assert from 'node:assert/strict';

import {
  string,
  number,
  boolean,
  isoDate,
  enumValues,
  array,
  object,
  record,
  nullable,
  optional,
  union,
  assertNoForbiddenKeys,
  validate
} from '../src/js/contracts/schema_validator.js';

import {
  validateEAIngestPayload,
  stageReadingValue
} from '../src/js/contracts/ea_telemetry_schema.js';

import {
  validateApiStatusPayload,
  activeEventSchema,
  FORBIDDEN_CALC_KEYS
} from '../src/js/contracts/api_status_schema.js';

import {
  validateApiTopologyPayload,
  CANONICAL_STRUCTURAL_CLASSES
} from '../src/js/contracts/api_topology_schema.js';

import {
  validateApiHistoryPayload,
  VALID_HISTORY_RANGES
} from '../src/js/contracts/api_history_schema.js';

import { CANONICAL_ASSET_TYPES, CANONICAL_STATES } from '../src/js/db_migrations.js';

// ============================================================================
// 1. Schema Validator Micro-Engine Primitives
// ============================================================================

test('Schema Validator: string primitive validates type, minLength, maxLength, and regex', () => {
  const s = string({ minLength: 3, maxLength: 8, pattern: /^[a-z]+$/ });
  assert.equal(validate(s, 'hello').valid, true);
  assert.equal(validate(s, 'hi').valid, false); // too short
  assert.equal(validate(s, 'toolongstring').valid, false); // too long
  assert.equal(validate(s, 'Hello123').valid, false); // pattern mismatch
  assert.equal(validate(s, 12345).valid, false); // not a string
});

test('Schema Validator: number primitive requires Number.isFinite and rejects NaN and Infinity', () => {
  const n = number({ min: 0, max: 100, integer: true });
  assert.equal(validate(n, 42).valid, true);
  assert.equal(validate(n, -5).valid, false); // below min
  assert.equal(validate(n, 150).valid, false); // above max
  assert.equal(validate(n, 42.5).valid, false); // not integer
  assert.equal(validate(n, NaN).valid, false); // NaN rejected
  assert.equal(validate(n, Infinity).valid, false); // Infinity rejected
  assert.equal(validate(n, -Infinity).valid, false); // -Infinity rejected
  assert.equal(validate(n, '42').valid, false); // string rejected
});

test('Schema Validator: isoDate strictly validates ISO-8601 strings and reject garbage', () => {
  const d = isoDate();
  assert.equal(validate(d, '2026-11-02T12:30:00Z').valid, true);
  assert.equal(validate(d, '2026-11-02T12:30:00.000Z').valid, true);
  assert.equal(validate(d, '2026-11-02T12:30:00+01:00').valid, true);
  assert.equal(validate(d, '2026-11-02').valid, false); // missing time
  assert.equal(validate(d, 'not-a-date').valid, false);
  assert.equal(validate(d, '9999-99-99T99:99:99Z').valid, false); // invalid calendar date
});

test('Schema Validator: enumValues matches allowed values and rejects unknown strings', () => {
  const e = enumValues(['PASSABLE', 'ENCROACHING', 'IMPASSABLE']);
  assert.equal(validate(e, 'PASSABLE').valid, true);
  assert.equal(validate(e, 'IMPASSABLE').valid, true);
  assert.equal(validate(e, 'FLOODED').valid, false); // non-canonical state
});

test('Schema Validator: array validates element schemas and length constraints', () => {
  const arr = array(number({ min: 0 }), { minLength: 1, maxLength: 3 });
  assert.equal(validate(arr, [1, 2, 3]).valid, true);
  assert.equal(validate(arr, []).valid, false); // minLength
  assert.equal(validate(arr, [1, 2, 3, 4]).valid, false); // maxLength
  assert.equal(validate(arr, [1, -5, 3]).valid, false); // invalid element
});

test('Schema Validator: object and disallowKeys enforce strict schemas', () => {
  const obj = object({
    name: string(),
    stage: number()
  }, { disallowKeys: ['cumecs', 'discharge'] });

  assert.equal(validate(obj, { name: 'Hookbridge', stage: 7.45 }).valid, true);
  assert.equal(validate(obj, { name: 'Hookbridge', stage: '7.45' }).valid, false);
  assert.equal(validate(obj, { name: 'Hookbridge', stage: 7.45, cumecs: 12.5 }).valid, false);
});

test('Schema Validator: assertNoForbiddenKeys recursively catches banned volumetric fields [RULE-CALC-01]', () => {
  const payloadWithCumecs = {
    station: 'Hookbridge',
    metrics: {
      readings: [
        { time: '2026-11-02T12:00:00Z', stage_mAOD: 7.45, cumecs: 15.2 }
      ]
    }
  };

  const errors = assertNoForbiddenKeys(payloadWithCumecs, FORBIDDEN_CALC_KEYS);
  assert.ok(errors.length > 0);
  assert.ok(errors.some(e => e.includes('cumecs')));
  assert.ok(errors.some(e => e.includes('[RULE-CALC-01]')));
});

// ============================================================================
// 2. Upstream EA Telemetry Ingest Contract
// ============================================================================

test('EA Ingest Contract: accepts valid EA reading items within plausibility bounds', () => {
  const payload = {
    items: [
      { dateTime: '2026-11-02T12:00:00Z', value: 4.52 },
      { dateTime: '2026-11-02T11:45:00Z', value: 4.50 }
    ]
  };

  const res = validateEAIngestPayload(payload, '52118-level-stage-i-15_min-mAOD');
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.cleanItems.length, 2);
  assert.equal(res.cleanItems[0].measure_id, '52118-level-stage-i-15_min-mAOD');
  assert.equal(res.cleanItems[0].value, 4.52);
});

test('EA Ingest Contract: rejects NaN, unparseable dates, and out-of-bounds readings (> 100m / < -5m)', () => {
  // NaN reading
  const nanPayload = {
    items: [{ dateTime: '2026-11-02T12:00:00Z', value: NaN }]
  };
  assert.equal(validateEAIngestPayload(nanPayload, '52118').valid, false);

  // Electrical fault spike (999.9)
  const spikePayload = {
    items: [{ dateTime: '2026-11-02T12:00:00Z', value: 999.9 }]
  };
  assert.equal(validateEAIngestPayload(spikePayload, '52118').valid, false);

  // Unparseable timestamp
  const badDatePayload = {
    items: [{ dateTime: 'invalid-time', value: 4.52 }]
  };
  assert.equal(validateEAIngestPayload(badDatePayload, '52118').valid, false);

  // Missing items
  assert.equal(validateEAIngestPayload({}, '52118').valid, false);
  assert.equal(validateEAIngestPayload(null, '52118').valid, false);
});

// ============================================================================
// 3. /api/status Contract & Tripartite Invariant [RULE-ENT-01]
// ============================================================================

test('API Status Contract: validates nominal /api/status payload with tripartite active events', () => {
  const validStatus = {
    status: 'ok',
    system_timestamps: {
      client_poll_at: '2026-11-02T12:00:00Z',
      db_synced_at: '2026-11-02T11:58:00Z',
      latest_ea_reading_at: '2026-11-02T11:45:00Z'
    },
    global_status: {
      counter_pill: 'SECURE',
      banner_text: 'ALL 19 CHANNELS & SPILLWAYS OPERATING WITHIN NORMAL CLEARANCES',
      top_severity: 1,
      is_tide_locked: false
    },
    active_events: [
      {
        asset_type: 'spillway',
        asset_id: 'hookbridge',
        status: 'ACTIVE',
        to_state: 'SECURE',
        severity_tier: 1,
        start_time: '2026-11-02T10:00:00Z',
        duration_seconds: 7200,
        peak_stage_mAOD: 6.80
      }
    ],
    roads: {
      summary: { total: 8, passable: 8, encroaching: 0, impassable: 0 },
      corridors_list: [
        { asset_id: 'cuts_road', name: 'Cuts Road', status: 'PASSABLE', stage_mAOD: 5.40 }
      ]
    }
  };

  const res = validateApiStatusPayload(validStatus);
  assert.equal(res.valid, true, `Validation errors: ${res.errors.join('; ')}`);
});

test('API Status Contract: rejects invalid event asset_type or non-canonical state', () => {
  const invalidTypeEvent = {
    asset_type: 'unknown_infrastructure', // invalid
    asset_id: 'hookbridge',
    status: 'ACTIVE',
    to_state: 'SECURE',
    severity_tier: 1,
    start_time: '2026-11-02T10:00:00Z',
    duration_seconds: 7200
  };

  assert.equal(validate(activeEventSchema, invalidTypeEvent).valid, false);

  const invalidStateEvent = {
    asset_type: 'spillway',
    asset_id: 'hookbridge',
    status: 'ACTIVE',
    to_state: 'CATASTROPHIC_FLOOD', // non-canonical state
    severity_tier: 1,
    start_time: '2026-11-02T10:00:00Z',
    duration_seconds: 7200
  };

  assert.equal(validate(activeEventSchema, invalidStateEvent).valid, false);
});

test('API Status Contract: strictly rejects any payload containing cumecs or discharge_m3s [RULE-CALC-01]', () => {
  const statusWithCumecs = {
    status: 'ok',
    system_timestamps: {
      client_poll_at: '2026-11-02T12:00:00Z',
      db_synced_at: '2026-11-02T11:58:00Z',
      latest_ea_reading_at: '2026-11-02T11:45:00Z'
    },
    global_status: {
      counter_pill: 'SECURE',
      banner_text: 'ALL CLEAR',
      top_severity: 1,
      is_tide_locked: false
    },
    active_events: [],
    roads: {
      summary: { total: 8, passable: 8, encroaching: 0, impassable: 0 },
      corridors_list: []
    },
    cards: {
      hookbridge: {
        cumecs: 14.5 // strictly prohibited!
      }
    }
  };

  const res = validateApiStatusPayload(statusWithCumecs);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('cumecs')));
});

// ============================================================================
// 4. /api/topology & /api/history Contracts
// ============================================================================

test('API Topology Contract: enforces 5 canonical structural classes and null gauge crest', () => {
  const validTopology = {
    status: 'ok',
    catchment_id: 'somerset',
    updated_at: '2026-11-02T12:00:00Z',
    chains: [
      { id: 'tone', name: 'River Tone Chain', direction: 'West → East', nodes: ['52108', '52118'] }
    ],
    nodes: [
      {
        id: '52108',
        name: 'Greenham',
        river: 'River Tone',
        node_type: 'gauge',
        stage_mAOD: 75.80,
        baseline_mAOD: 75.69,
        alert_mAOD: 77.00,
        crest_mAOD: null, // must be null for gauge
        status_code: 'SECURE',
        badge_class: 'badge-secure',
        badge_label: 'SECURE',
        narrative: 'Nominal baseflow'
      },
      {
        id: '52118',
        name: 'Hookbridge Spillway',
        river: 'River Tone',
        node_type: 'spillway',
        stage_mAOD: 6.80,
        baseline_mAOD: 5.18,
        alert_mAOD: 7.30,
        crest_mAOD: 7.45,
        status_code: 'SECURE',
        badge_class: 'badge-secure',
        badge_label: 'SECURE',
        narrative: 'Clearance 0.65m'
      }
    ]
  };

  assert.equal(validateApiTopologyPayload(validTopology).valid, true);

  // If a pure gauge has a crest_mAOD assigned, it violates the structural taxonomy
  const invalidGaugeCrest = JSON.parse(JSON.stringify(validTopology));
  invalidGaugeCrest.nodes[0].crest_mAOD = 78.50; // illegal on gauge!
  const invalidRes = validateApiTopologyPayload(invalidGaugeCrest);
  assert.equal(invalidRes.valid, false);
  assert.ok(invalidRes.errors.some(e => e.includes('must have null or undefined crest_mAOD')));
});

test('API History Contract: validates ranges 24h, 7d, 30d and rejects invalid ranges', () => {
  const validHistory = {
    status: 'ok',
    range: '24h',
    days: 1,
    since: '2026-11-01T12:00:00Z',
    total_records: 2,
    measures: {
      '52118': [
        { dateTime: '2026-11-02T12:00:00Z', value: 4.52 },
        { dateTime: '2026-11-02T11:45:00Z', value: null }
      ]
    }
  };

  assert.equal(validateApiHistoryPayload(validHistory).valid, true);

  const invalidRange = { ...validHistory, range: '90d', days: 90 };
  assert.equal(validateApiHistoryPayload(invalidRange).valid, false);
});
