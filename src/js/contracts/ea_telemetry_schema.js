/**
 * Upstream Environment Agency (EA) Telemetry Ingest Contract
 * 
 * Validates raw payload structure from:
 * https://environment.data.gov.uk/flood-monitoring/id/measures/{id}/readings
 * 
 * Invariants:
 * - Rejects unparseable ISO-8601 dates.
 * - Enforces plausibility bounds (-5.0m to 100.0m stage) aligned with sanitizeStageValue().
 * - Rejects NaN, Infinity, electrical fault spikes (e.g. 999.9), or missing values.
 * - Handles both mASD (metres Above Station Datum) and mAOD (metres Above Ordnance Datum).
 */

import {
  isoDate,
  object,
  array,
  optional,
  string,
  validate
} from './schema_validator.js';

/**
 * Custom finite stage value validator
 */
export const stageReadingValue = {
  type: 'stageReadingValue',
  validate(val, path = '') {
    if (val === null || val === undefined) {
      return {
        valid: false,
        errors: [`${path || 'value'}: stage reading value cannot be null or undefined`]
      };
    }

    const num = (typeof val === 'number') ? val : Number(val);
    if (!Number.isFinite(num) || Number.isNaN(num)) {
      return {
        valid: false,
        errors: [`${path || 'value'}: expected finite numeric reading, received ${JSON.stringify(val)}`]
      };
    }

    // Somerset Levels stage bounds (-5.0m to 100.0m AOD / ASD)
    if (num < -5.0 || num > 100.0) {
      return {
        valid: false,
        errors: [`${path || 'value'}: stage reading ${num} is out of plausible bounds (-5.0 to 100.0)`]
      };
    }

    return { valid: true, errors: [] };
  }
};

/**
 * Single reading item contract
 */
export const eaReadingItemSchema = object({
  dateTime: isoDate(),
  value: stageReadingValue,
  '@id': optional(string()),
  measure: optional(string())
});

/**
 * Raw upstream EA payload contract
 */
export const eaPayloadSchema = object({
  items: array(eaReadingItemSchema)
});

/**
 * Validates an upstream EA readings response and extracts sanitized items.
 * 
 * @param {any} payload - Parsed JSON payload from EA API
 * @param {string} measureId - Target measure identifier
 * @returns {{ valid: boolean, errors: string[], cleanItems: Array<{ measure_id: string, dateTime: string, value: number }> }}
 */
export function validateEAIngestPayload(payload, measureId = 'unknown') {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      errors: [`[${measureId}] Payload must be a non-null JSON object`],
      cleanItems: []
    };
  }

  // Handle case where items array is missing or empty
  if (!Array.isArray(payload.items)) {
    return {
      valid: false,
      errors: [`[${measureId}] Expected "items" property to be an Array`],
      cleanItems: []
    };
  }

  const result = validate(eaPayloadSchema, payload, measureId);
  if (!result.valid) {
    return {
      valid: false,
      errors: result.errors,
      cleanItems: []
    };
  }

  const cleanItems = payload.items.map(item => ({
    measure_id: measureId,
    dateTime: item.dateTime,
    value: Number(typeof item.value === 'number' ? item.value : Number(item.value))
  }));

  return {
    valid: true,
    errors: [],
    cleanItems
  };
}

export const RAINFALL_PLAUSIBILITY_MIN_MM = 0.0;
export const RAINFALL_PLAUSIBILITY_MAX_MM = 100.0;

/**
 * Parses and validates a single EA 15-minute rainfall reading value (mm).
 * Enforces finite numeric value in [0.0, 100.0] mm; rejects null, undefined,
 * booleans, empty strings, NaN, Infinity, negative sentinels, and fault spikes.
 *
 * @param {any} val
 * @returns {number|null}
 */
export function sanitizeRainfallValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'number' && typeof val !== 'string') return null;
  if (typeof val === 'string' && val.trim() === '') return null;

  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || Number.isNaN(num)) return null;
  if (num < RAINFALL_PLAUSIBILITY_MIN_MM || num > RAINFALL_PLAUSIBILITY_MAX_MM) return null;
  return num;
}

/**
 * Custom finite rainfall reading validator (mm per 15-min interval)
 */
export const rainfallReadingValue = {
  type: 'rainfallReadingValue',
  validate(val, path = '') {
    const label = path || 'value';
    if (val === null || val === undefined) {
      return {
        valid: false,
        errors: [`${label}: rainfall reading value cannot be null or undefined`]
      };
    }

    if (typeof val !== 'number' && typeof val !== 'string') {
      return {
        valid: false,
        errors: [`${label}: expected finite numeric rainfall reading, received ${typeof val}`]
      };
    }

    if (typeof val === 'string' && val.trim() === '') {
      return {
        valid: false,
        errors: [`${label}: rainfall reading cannot be empty string`]
      };
    }

    const num = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(num) || Number.isNaN(num)) {
      return {
        valid: false,
        errors: [`${label}: expected finite numeric rainfall reading, received ${JSON.stringify(val)}`]
      };
    }

    if (num < RAINFALL_PLAUSIBILITY_MIN_MM || num > RAINFALL_PLAUSIBILITY_MAX_MM) {
      return {
        valid: false,
        errors: [
          `${label}: rainfall reading ${num} mm is out of plausible bounds (${RAINFALL_PLAUSIBILITY_MIN_MM} to ${RAINFALL_PLAUSIBILITY_MAX_MM} mm)`
        ]
      };
    }

    return { valid: true, errors: [] };
  }
};

/**
 * Single EA rainfall reading item contract
 */
export const eaRainfallReadingItemSchema = object({
  dateTime: isoDate(),
  value: rainfallReadingValue,
  '@id': optional(string()),
  measure: optional(string())
});

/**
 * Raw upstream EA rainfall readings payload contract
 */
export const eaRainfallPayloadSchema = object({
  items: array(eaRainfallReadingItemSchema)
});

/**
 * Strictly validates an upstream EA rainfall readings response.
 * Rejects the payload if any reading violates schema or plausibility bounds.
 *
 * @param {any} payload - Parsed JSON payload from EA API
 * @param {string} [measureId='unknown'] - Target measure identifier
 * @returns {{ valid: boolean, errors: string[], cleanItems: Array<{ measure_id: string, dateTime: string, rainfall_mm: number }> }}
 */
export function validateEARainfallIngestPayload(payload, measureId = 'unknown') {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      errors: [`[${measureId}] Payload must be a non-null JSON object`],
      cleanItems: []
    };
  }

  if (!Array.isArray(payload.items)) {
    return {
      valid: false,
      errors: [`[${measureId}] Expected "items" property to be an Array`],
      cleanItems: []
    };
  }

  const result = validate(eaRainfallPayloadSchema, payload, measureId);
  if (!result.valid) {
    return {
      valid: false,
      errors: result.errors,
      cleanItems: []
    };
  }

  const cleanItems = payload.items.map(item => ({
    measure_id: measureId,
    dateTime: item.dateTime,
    rainfall_mm: sanitizeRainfallValue(item.value)
  }));

  return {
    valid: true,
    errors: [],
    cleanItems
  };
}

/**
 * Resilient item-level sanitizer for EA rainfall batch bursts (24–48+ readings).
 * Preserves valid readings within a batch while filtering out individual sensor fault
 * sentinels (e.g., -99, >100 mm, null, NaN) or malformed timestamps.
 *
 * @param {any} payload - Parsed JSON payload from EA API
 * @param {string} [measureId='unknown'] - Target measure identifier
 * @returns {{ validEnvelope: boolean, errors: string[], cleanItems: Array<{ measure_id: string, dateTime: string, rainfall_mm: number }>, rejectedCount: number }}
 */
export function filterCleanRainfallItems(payload, measureId = 'unknown') {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    return {
      validEnvelope: false,
      errors: [`[${measureId}] Payload must be a non-null JSON object with an "items" Array`],
      cleanItems: [],
      rejectedCount: 0
    };
  }

  const cleanItems = [];
  const errors = [];
  let rejectedCount = 0;

  for (let i = 0; i < payload.items.length; i++) {
    const item = payload.items[i];
    const check = validate(eaRainfallReadingItemSchema, item, `${measureId}.items[${i}]`);
    if (!check.valid) {
      rejectedCount++;
      errors.push(...check.errors);
      continue;
    }

    const rainfallMm = sanitizeRainfallValue(item.value);
    if (rainfallMm === null) {
      rejectedCount++;
      errors.push(`${measureId}.items[${i}].value: failed rainfall sanitization`);
      continue;
    }

    cleanItems.push({
      measure_id: measureId,
      dateTime: item.dateTime,
      rainfall_mm: rainfallMm
    });
  }

  return {
    validEnvelope: true,
    errors,
    cleanItems,
    rejectedCount
  };
}
