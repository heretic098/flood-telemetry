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
