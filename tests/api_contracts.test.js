import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hermetic: isolated DB ([RULE-TEST-02]). Must be set before importing server.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-contracts-'));
process.env.DB_PATH = path.join(tmpDir, 'telemetry.db');
process.env.CAMERA_BUFFER_DIR = path.join(tmpDir, 'camera_buffer');

const { renderSummaryMarkdown, db } = await import('../server.js');
const { STATION_REGISTRY, HYDRO_THRESHOLDS } = await import('../src/js/hydro_engine.js');
const { validateStaffGaugeCameraPayload } = await import('../src/js/contracts/staff_gauge_camera_schema.js');

function monksRow(upStage, downStage) {
  const measures = {
    [STATION_REGISTRY['52233'].measure_id]: upStage,
    [STATION_REGISTRY['52234'].measure_id]: downStage
  };
  const md = renderSummaryMarkdown({ measures }, db);
  const row = md.split('\n').find(l => l.startsWith("| Monk's Leaze Clyse Sluice"));
  assert.ok(row, "summary must contain the Monk's Leaze Clyse row");
  return row;
}

test("summary.md: Monk's Leaze Clyse uses the 7.20m diversion trigger, not the 4.20m concrete sill", () => {
  const trigger = HYDRO_THRESHOLDS.MONKS_LEAZE.TRIGGER_MAOD;
  assert.equal(trigger, 7.20);

  // Between sill (4.20) and trigger (7.20): Dashboard/engine say CLOSED, so must the briefing.
  const below = monksRow(5.00, 4.50);
  assert.match(below, /\*\*CLOSED\*\*/);
  assert.doesNotMatch(below, /Sill: 4\.20/);
  assert.match(below, /Diversion Trigger: 7\.20 mAOD/);

  // Above trigger with a real head drop: DIVERTING.
  assert.match(monksRow(7.50, 7.00), /\*\*DIVERTING\*\*/);
});

test('staff-gauge camera contract: accepts ok / unavailable shapes', () => {
  const ok = {
    status: 'ok',
    camera_id: 'huish_episcopi_ps',
    station_id: '52120',
    captured_at: '2026-11-19T10:00:00.000Z',
    age_minutes: 12,
    image_url: '/api/staff-gauge-cameras/huish_episcopi_ps/latest.jpg'
  };
  assert.deepEqual(validateStaffGaugeCameraPayload(ok), { valid: true, errors: [] });
  assert.equal(validateStaffGaugeCameraPayload({ status: 'unavailable', camera_id: 'midelney_ps' }).valid, true);
});

test('staff-gauge camera contract: rejects forbidden keys, unknown fields, bad status and mismatched image_url', () => {
  const ok = {
    status: 'ok',
    camera_id: 'huish_episcopi_ps',
    station_id: '52120',
    captured_at: '2026-11-19T10:00:00.000Z',
    age_minutes: 12,
    image_url: '/api/staff-gauge-cameras/huish_episcopi_ps/latest.jpg'
  };
  assert.equal(validateStaffGaugeCameraPayload({ ...ok, discharge_m3s: 4 }).valid, false);
  assert.equal(validateStaffGaugeCameraPayload({ ...ok, stage_mAOD: 5.1 }).valid, false);
  assert.equal(validateStaffGaugeCameraPayload({ ...ok, age_minutes: -1 }).valid, false);
  assert.equal(validateStaffGaugeCameraPayload({ ...ok, captured_at: 'yesterday' }).valid, false);
  assert.equal(validateStaffGaugeCameraPayload({ ...ok, image_url: '/api/staff-gauge-cameras/other_cam/latest.jpg' }).valid, false);
  assert.equal(validateStaffGaugeCameraPayload({ status: 'error', camera_id: 'x' }).valid, false);
  assert.equal(validateStaffGaugeCameraPayload({ status: 'unavailable' }).valid, false);
  assert.equal(validateStaffGaugeCameraPayload(null).valid, false);
});

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
