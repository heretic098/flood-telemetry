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
  validate,
  assertNoForbiddenKeys
} from './schema_validator.js';
import { FORBIDDEN_CALC_KEYS } from './api_status_schema.js';

export const VALID_HISTORY_RANGES = Object.freeze(['24h', '7d', '30d']);
export const VALID_HISTORY_DAYS = Object.freeze([1, 7, 30]);

export const historicalReadingSchema = object({
  dateTime: isoDate({ allowSqlite: true }),
  value: nullable(number())
});

export const apiHistorySchema = object({
  status: string({ pattern: /^ok$/ }),
  range: enumValues(VALID_HISTORY_RANGES),
  days: enumValues(VALID_HISTORY_DAYS),
  since: isoDate({ allowSqlite: true }),
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
  const errors = [...res.errors];

  // Deep recursive ban on volumetric discharge keys [RULE-CALC-01]
  const forbiddenErrors = assertNoForbiddenKeys(payload, FORBIDDEN_CALC_KEYS, 'api_history');
  errors.push(...forbiddenErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}
