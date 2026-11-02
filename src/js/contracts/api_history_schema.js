/**
 * /api/history Response Contract
 * 
 * Validates historical lookback ranges, temporal bounds, and measure series.
 */

import {
  string,
  number,
  isoDate,
  enumValues,
  array,
  object,
  record,
  nullable,
  validate
} from './schema_validator.js';

export const VALID_HISTORY_RANGES = Object.freeze(['24h', '7d', '30d']);
export const VALID_HISTORY_DAYS = Object.freeze([1, 7, 30]);

export const historicalReadingSchema = object({
  dateTime: isoDate(),
  value: nullable(number())
});

export const apiHistorySchema = object({
  status: string({ pattern: /^ok$/ }),
  range: enumValues(VALID_HISTORY_RANGES),
  days: enumValues(VALID_HISTORY_DAYS),
  since: isoDate(),
  total_records: number({ min: 0, integer: true }),
  measures: record(array(historicalReadingSchema))
});

/**
 * Validates an /api/history payload
 * 
 * @param {any} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateApiHistoryPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['/api/history payload must be a non-null object'] };
  }

  const res = validate(apiHistorySchema, payload, 'api_history');
  return {
    valid: res.valid,
    errors: res.errors
  };
}
