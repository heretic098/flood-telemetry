/**
 * Somerset Flood Telemetry Platform - Zero-Dependency Micro-Validator Engine
 * 
 * Provides fast, composable, zero-dependency schema validation for runtime contracts
 * across Node.js server endpoints, upstream data ingestion, and client ES modules.
 * 
 * Invariants:
 * - Zero production dependencies.
 * - Sub-millisecond execution with comprehensive error path reporting.
 * - Enforces [RULE-ENT-01] and [RULE-CALC-01] domain rules.
 */

export class ValidationError extends Error {
  constructor(errors) {
    super(`Schema validation failed:\n${errors.join('\n')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Creates a string validator
 */
export function string(options = {}) {
  return {
    type: 'string',
    validate(val, path = '') {
      const errors = [];
      if (typeof val !== 'string') {
        errors.push(`${path || 'value'}: expected string, received ${typeof val} (${JSON.stringify(val)})`);
        return { valid: false, errors };
      }
      if (typeof options.minLength === 'number' && val.length < options.minLength) {
        errors.push(`${path || 'value'}: string length ${val.length} is less than minLength ${options.minLength}`);
      }
      if (typeof options.maxLength === 'number' && val.length > options.maxLength) {
        errors.push(`${path || 'value'}: string length ${val.length} is greater than maxLength ${options.maxLength}`);
      }
      if (options.pattern instanceof RegExp && !options.pattern.test(val)) {
        errors.push(`${path || 'value'}: string "${val}" does not match pattern ${options.pattern}`);
      }
      return { valid: errors.length === 0, errors };
    }
  };
}

/**
 * Creates a finite number validator
 */
export function number(options = {}) {
  return {
    type: 'number',
    validate(val, path = '') {
      const errors = [];
      if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
        errors.push(`${path || 'value'}: expected finite number, received ${typeof val} (${JSON.stringify(val)})`);
        return { valid: false, errors };
      }
      if (options.integer && !Number.isInteger(val)) {
        errors.push(`${path || 'value'}: expected integer, received ${val}`);
      }
      if (typeof options.min === 'number' && val < options.min) {
        errors.push(`${path || 'value'}: value ${val} is less than min ${options.min}`);
      }
      if (typeof options.max === 'number' && val > options.max) {
        errors.push(`${path || 'value'}: value ${val} is greater than max ${options.max}`);
      }
      return { valid: errors.length === 0, errors };
    }
  };
}

/**
 * Creates a boolean validator
 */
export function boolean() {
  return {
    type: 'boolean',
    validate(val, path = '') {
      if (typeof val !== 'boolean') {
        return {
          valid: false,
          errors: [`${path || 'value'}: expected boolean, received ${typeof val} (${JSON.stringify(val)})`]
        };
      }
      return { valid: true, errors: [] };
    }
  };
}

// Strict ISO-8601 calendar date/time regex
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
// SQLite timestamp regex (e.g., '2026-11-04 23:20:35' or '2026-11-04 23:20:35.123')
const SQLITE_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/**
 * Creates an ISO-8601 or SQLite date/time validator
 * @param {object} [options]
 * @param {boolean} [options.allowSqlite=false] - Whether to accept space-separated SQLite dates
 */
export function isoDate(options = {}) {
  const allowSqlite = Boolean(options.allowSqlite);
  return {
    type: 'isoDate',
    validate(val, path = '') {
      if (typeof val !== 'string') {
        return {
          valid: false,
          errors: [`${path || 'value'}: expected string timestamp, received ${typeof val} (${JSON.stringify(val)})`]
        };
      }
      const isIso = ISO_8601_REGEX.test(val);
      const isSqlite = allowSqlite && SQLITE_TIMESTAMP_REGEX.test(val);
      if (!isIso && !isSqlite) {
        return {
          valid: false,
          errors: [`${path || 'value'}: expected ${allowSqlite ? 'ISO-8601 or SQLite' : 'ISO-8601'} date string, received ${JSON.stringify(val)}`]
        };
      }
      const parseStr = (isSqlite && !val.includes('T')) ? val.replace(' ', 'T') + 'Z' : val;
      const parsed = Date.parse(parseStr);
      if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
        return {
          valid: false,
          errors: [`${path || 'value'}: unparseable date timestamp: ${val}`]
        };
      }
      return { valid: true, errors: [] };
    }
  };
}

/**
 * Creates an enum validator matching an array of allowed primitive values
 */
export function enumValues(allowed) {
  const allowedSet = new Set(allowed);
  return {
    type: 'enum',
    allowed,
    validate(val, path = '') {
      if (!allowedSet.has(val)) {
        return {
          valid: false,
          errors: [`${path || 'value'}: expected one of ${JSON.stringify(allowed)}, received ${JSON.stringify(val)}`]
        };
      }
      return { valid: true, errors: [] };
    }
  };
}

/**
 * Creates an array validator
 */
export function array(itemSchema, options = {}) {
  return {
    type: 'array',
    validate(val, path = '') {
      const errors = [];
      if (!Array.isArray(val)) {
        errors.push(`${path || 'value'}: expected array, received ${typeof val} (${JSON.stringify(val)})`);
        return { valid: false, errors };
      }
      if (typeof options.minLength === 'number' && val.length < options.minLength) {
        errors.push(`${path || 'value'}: array length ${val.length} is less than minLength ${options.minLength}`);
      }
      if (typeof options.maxLength === 'number' && val.length > options.maxLength) {
        errors.push(`${path || 'value'}: array length ${val.length} is greater than maxLength ${options.maxLength}`);
      }

      for (let i = 0; i < val.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`;
        const res = itemSchema.validate(val[i], itemPath);
        if (!res.valid) {
          errors.push(...res.errors);
        }
      }

      return { valid: errors.length === 0, errors };
    }
  };
}

/**
 * Creates an object validator with specified shape
 */
export function object(shape, options = {}) {
  return {
    type: 'object',
    shape,
    validate(val, path = '') {
      const errors = [];
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        errors.push(`${path || 'value'}: expected object, received ${val === null ? 'null' : typeof val}`);
        return { valid: false, errors };
      }

      for (const [key, schema] of Object.entries(shape)) {
        const propPath = path ? `${path}.${key}` : key;
        const propVal = val[key];
        const res = schema.validate(propVal, propPath);
        if (!res.valid) {
          errors.push(...res.errors);
        }
      }

      // Check for forbidden keys if configured
      if (Array.isArray(options.disallowKeys)) {
        for (const k of options.disallowKeys) {
          if (Object.prototype.hasOwnProperty.call(val, k)) {
            errors.push(`${path ? `${path}.${k}` : k}: property "${k}" is strictly prohibited by domain policy`);
          }
        }
      }

      return { valid: errors.length === 0, errors };
    }
  };
}

/**
 * Creates a record (dictionary) validator where all values match a schema
 */
export function record(valueSchema) {
  return {
    type: 'record',
    validate(val, path = '') {
      const errors = [];
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        errors.push(`${path || 'value'}: expected dictionary object, received ${val === null ? 'null' : typeof val}`);
        return { valid: false, errors };
      }

      for (const [key, propVal] of Object.entries(val)) {
        const propPath = path ? `${path}["${key}"]` : `["${key}"]`;
        const res = valueSchema.validate(propVal, propPath);
        if (!res.valid) {
          errors.push(...res.errors);
        }
      }

      return { valid: errors.length === 0, errors };
    }
  };
}

/**
 * Wraps a schema to allow null
 */
export function nullable(innerSchema) {
  return {
    type: 'nullable',
    validate(val, path = '') {
      if (val === null) return { valid: true, errors: [] };
      return innerSchema.validate(val, path);
    }
  };
}

/**
 * Wraps a schema to allow undefined or null
 */
export function optional(innerSchema) {
  return {
    type: 'optional',
    validate(val, path = '') {
      if (val === undefined || val === null) return { valid: true, errors: [] };
      return innerSchema.validate(val, path);
    }
  };
}

/**
 * Union of schemas: matches if ANY inner schema succeeds
 */
export function union(...schemas) {
  return {
    type: 'union',
    validate(val, path = '') {
      const allErrors = [];
      for (const s of schemas) {
        const res = s.validate(val, path);
        if (res.valid) {
          return { valid: true, errors: [] };
        }
        allErrors.push(...res.errors);
      }
      return {
        valid: false,
        errors: [`${path || 'value'}: failed all union candidates:\n  ${allErrors.join('\n  ')}`]
      };
    }
  };
}

/**
 * Deep recursive scanner that asserts forbidden keys are absent across any nested object or array.
 * Enforces [RULE-CALC-01] ban on volumetric speculation (cumecs, discharge_m3s, etc.).
 */
export function assertNoForbiddenKeys(obj, forbiddenKeys, path = '') {
  const errors = [];
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return errors;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      errors.push(...assertNoForbiddenKeys(obj[i], forbiddenKeys, `${path}[${i}]`));
    }
    return errors;
  }

  for (const [key, val] of Object.entries(obj)) {
    const propPath = path ? `${path}.${key}` : key;
    if (forbiddenKeys.includes(key.toLowerCase())) {
      errors.push(`${propPath}: property "${key}" violates [RULE-CALC-01] (volumetric/discharge fields strictly prohibited)`);
    }
    if (typeof val === 'object' && val !== null) {
      errors.push(...assertNoForbiddenKeys(val, forbiddenKeys, propPath));
    }
  }

  return errors;
}

/**
 * Primary validator entry point
 */
export function validate(schema, data, context = '') {
  const res = schema.validate(data, context);
  return {
    valid: res.valid,
    errors: res.errors,
    data: res.valid ? data : undefined
  };
}
