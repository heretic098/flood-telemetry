import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serializeFrameFilename } from '../src/js/api/camera_buffer.js';

// Hermetic: isolated DB and camera buffer ([RULE-TEST-02]). Must be set before importing server.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-gauge-'));
process.env.DB_PATH = path.join(tmpDir, 'telemetry.db');
process.env.CAMERA_BUFFER_DIR = path.join(tmpDir, 'camera_buffer');

const { server } = await import('../server.js');
const { getStaffGaugePanelCopy } = await import('../src/js/modules/staff_gauge_panel.js');
const { STAFF_GAUGE_CAMERA_MAP } = await import('../src/js/staff_gauge_cameras.js');

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

function seedFrame(cameraId, ageMs) {
  const dir = path.join(process.env.CAMERA_BUFFER_DIR, cameraId);
  fs.mkdirSync(dir, { recursive: true });
  const iso = new Date(Date.now() - ageMs).toISOString();
  fs.writeFileSync(path.join(dir, serializeFrameFilename(iso)), JPEG_BYTES);
}

async function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${urlPath}`, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('/api/staff-gauge-cameras: serves latest frame for mapped cameras only', async () => {
  seedFrame('huish_episcopi_ps', 10 * 60 * 1000);
  seedFrame('athelney_gauge', 10 * 60 * 1000);

  const testServer = http.createServer((req, res) => server.emit('request', req, res));
  await new Promise(resolve => testServer.listen(0, resolve));
  const port = testServer.address().port;

  try {
    const meta = await get(port, '/api/staff-gauge-cameras/huish_episcopi_ps/latest');
    assert.equal(meta.status, 200);
    const json = JSON.parse(meta.body.toString());
    assert.equal(json.camera_id, 'huish_episcopi_ps');
    assert.equal(json.station_id, '52120');
    assert.ok(json.age_minutes >= 9 && json.age_minutes <= 12, `age ${json.age_minutes}`);
    assert.equal(json.image_url, '/api/staff-gauge-cameras/huish_episcopi_ps/latest.jpg');

    const img = await get(port, json.image_url);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/jpeg');
    assert.deepEqual(img.body, JPEG_BYTES);

    // Unmapped camera has frames on disk but must not be served here
    assert.equal((await get(port, '/api/staff-gauge-cameras/athelney_gauge/latest')).status, 404);
    // Not in the staff gauge map at all
    assert.equal((await get(port, '/api/staff-gauge-cameras/dunball_northern_flap/latest')).status, 404);
    // Mapped but no frames on disk: metadata says unavailable (200), image route is 404
    const none = await get(port, '/api/staff-gauge-cameras/midelney_ps/latest');
    assert.equal(none.status, 200);
    assert.equal(JSON.parse(none.body.toString()).status, 'unavailable');
    assert.equal((await get(port, '/api/staff-gauge-cameras/midelney_ps/latest.jpg')).status, 404);
    // Traversal-style ids never match the route
    assert.notEqual((await get(port, '/api/staff-gauge-cameras/..%2F..%2Fetc/latest.jpg')).status, 200);
  } finally {
    await new Promise(resolve => testServer.close(resolve));
  }
});

test('/api/staff-gauge-cameras: frames older than 3h are not served', async () => {
  seedFrame('beer_wall_sluice_gb', 4 * 60 * 60 * 1000);
  const testServer = http.createServer((req, res) => server.emit('request', req, res));
  await new Promise(resolve => testServer.listen(0, resolve));
  try {
    const res = await get(testServer.address().port, '/api/staff-gauge-cameras/beer_wall_sluice_gb/latest');
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body.toString()).status, 'unavailable');
  } finally {
    await new Promise(resolve => testServer.close(resolve));
  }
});

test('panel copy never implies a stage reading or board-vs-sensor comparison', () => {
  for (const entry of Object.values(STAFF_GAUGE_CAMERA_MAP)) {
    const copy = getStaffGaugePanelCopy(entry);
    assert.doesNotMatch(copy, /mAOD|m AOD|cumec|discharge|matches the sensor/i);
  }
  const monks = getStaffGaugePanelCopy(STAFF_GAUGE_CAMERA_MAP.monks_leaze_clyse);
  assert.match(monks, /right-hand board is the water level/i);
  assert.match(monks, /left-hand board shows the sluice gate height, not water level/i);
});

test('panel mode: Monk\'s Leaze static reading stays on-demand with neutral wording; offline/stale auto-load', async () => {
  const { getStaffGaugePanelMode } = await import('../src/js/modules/staff_gauge_panel.js');
  const monks = STAFF_GAUGE_CAMERA_MAP.monks_leaze_clyse;
  const huish = STAFF_GAUGE_CAMERA_MAP.huish_episcopi_ps;
  const flat = { isFlatlined: true, isStale: true, isOffline: false };
  const offline = { isFlatlined: false, isStale: true, isOffline: true };
  const stale = { isFlatlined: false, isStale: true, isOffline: false };
  const fresh = { isFlatlined: false, isStale: false, isOffline: false };

  const monksFlat = getStaffGaugePanelMode(monks, flat);
  assert.equal(monksFlat.autoLoad, false);
  assert.match(monksFlat.notice, /reading is static/i);
  assert.doesNotMatch(monksFlat.notice, /flatline|fault|fail/i);

  assert.equal(getStaffGaugePanelMode(monks, offline).autoLoad, true);
  assert.equal(getStaffGaugePanelMode(monks, stale).autoLoad, true);
  assert.equal(getStaffGaugePanelMode(huish, flat).autoLoad, true);
  assert.match(getStaffGaugePanelMode(huish, flat).notice, /reading is static/i);
  assert.deepEqual(getStaffGaugePanelMode(monks, fresh), { autoLoad: false, notice: null });
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
