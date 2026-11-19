/**
 * /api/staff-gauge-cameras/<camera_id>/latest Response Contract [ARCH-DATA-01]
 *
 * The endpoint only describes a camera frame (when it was captured, how old it is,
 * where to fetch the JPEG). It must never carry stage, discharge or other derived
 * hydrology values [RULE-CALC-01] [RULE-CAM-01].
 *
 * Two response shapes (both HTTP 200):
 *   { status: 'ok', camera_id, station_id, captured_at, age_minutes, image_url }
 *   { status: 'unavailable', camera_id }
 */

import {
  string,
  number,
  isoDate,
  object,
  validate,
  assertNoForbiddenKeys
} from './schema_validator.js';
import { FORBIDDEN_CALC_KEYS } from './api_status_schema.js';

const CAMERA_ID_PATTERN = /^[a-z0-9_]+$/;

export const staffGaugeCameraOkSchema = object({
  status: string({ pattern: /^ok$/ }),
  camera_id: string({ pattern: CAMERA_ID_PATTERN }),
  station_id: string({ minLength: 1 }),
  captured_at: isoDate(),
  age_minutes: number({ min: 0, integer: true }),
  image_url: string({ pattern: /^\/api\/staff-gauge-cameras\/[a-z0-9_]+\/latest\.jpg$/ })
});

export const staffGaugeCameraUnavailableSchema = object({
  status: string({ pattern: /^unavailable$/ }),
  camera_id: string({ pattern: CAMERA_ID_PATTERN })
});

/**
 * Validates a /api/staff-gauge-cameras/<id>/latest JSON payload.
 *
 * @param {any} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStaffGaugeCameraPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['/api/staff-gauge-cameras payload must be a non-null object'] };
  }

  const errors = [];
  if (payload.status === 'ok') {
    errors.push(...validate(staffGaugeCameraOkSchema, payload, 'staff_gauge_camera').errors);
    // The image URL must point back at this camera's own frame.
    if (typeof payload.camera_id === 'string' && typeof payload.image_url === 'string' &&
        payload.image_url !== `/api/staff-gauge-cameras/${payload.camera_id}/latest.jpg`) {
      errors.push('staff_gauge_camera.image_url: must reference the same camera_id');
    }
  } else if (payload.status === 'unavailable') {
    errors.push(...validate(staffGaugeCameraUnavailableSchema, payload, 'staff_gauge_camera').errors);
  } else {
    errors.push(`staff_gauge_camera.status: expected 'ok' or 'unavailable', got ${JSON.stringify(payload.status)}`);
  }

  errors.push(...assertNoForbiddenKeys(payload, FORBIDDEN_CALC_KEYS, 'staff_gauge_camera'));

  // Closed key set: this endpoint describes a frame only, so any extra field
  // (e.g. a stage value) is a contract violation.
  const allowed = payload.status === 'ok' ? Object.keys(staffGaugeCameraOkSchema.shape)
    : Object.keys(staffGaugeCameraUnavailableSchema.shape);
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) errors.push(`staff_gauge_camera.${key}: unexpected property`);
  }

  return { valid: errors.length === 0, errors };
}
