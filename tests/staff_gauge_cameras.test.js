import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_CATALOG } from '../src/js/api/camera_buffer.js';
import { STATION_REGISTRY } from '../src/js/hydro_engine.js';
import {
  STAFF_GAUGE_CAMERA_MAP,
  UNMAPPED_STAFF_GAUGE_CAMERAS,
  getStaffGaugeCameraForStation
} from '../src/js/staff_gauge_cameras.js';

const catalogIds = new Set(CAMERA_CATALOG.map(c => c.id));

test('every mapped camera exists in CAMERA_CATALOG and its station in STATION_REGISTRY', () => {
  for (const [cameraId, m] of Object.entries(STAFF_GAUGE_CAMERA_MAP)) {
    assert.ok(catalogIds.has(cameraId), `${cameraId} missing from CAMERA_CATALOG`);
    assert.ok(STATION_REGISTRY[m.station_id], `${m.station_id} missing from STATION_REGISTRY`);
    assert.ok(['water_stage', 'gate_lift_indicator'].includes(m.board_type));
  }
});

test('mapped and unmapped sets are disjoint and cover all 7 issue #54 cameras', () => {
  const mapped = Object.keys(STAFF_GAUGE_CAMERA_MAP);
  const unmapped = Object.keys(UNMAPPED_STAFF_GAUGE_CAMERAS);
  for (const id of unmapped) {
    assert.ok(catalogIds.has(id), `${id} missing from CAMERA_CATALOG`);
    assert.ok(!mapped.includes(id), `${id} cannot be both mapped and unmapped`);
  }
  assert.deepEqual([...mapped, ...unmapped].sort(), [
    'athelney_gauge', 'beer_wall_sluice_gb', 'huish_episcopi_ps', 'midelney_ps',
    'monks_leaze_clyse', 'west_sedgemoor_ps', 'westonzoyland_ps'
  ]);
});

test('Monk\'s Leaze maps to downstream 52234 via its right water-level board; left board is gate height', () => {
  const m = STAFF_GAUGE_CAMERA_MAP.monks_leaze_clyse;
  assert.equal(m.station_id, '52234');
  assert.equal(m.board_type, 'water_stage');
  assert.equal(m.boards.left, 'gate_lift_indicator');
  assert.equal(m.boards.right, 'water_stage');
  assert.ok(!('monks_leaze_clyse' in UNMAPPED_STAFF_GAUGE_CAMERAS));
  const cam = CAMERA_CATALOG.find(c => c.id === 'monks_leaze_clyse');
  const text = `${cam.description} ${cam.lookFor}`;
  assert.match(text, /left board[^.]*gate/i);
  assert.match(text, /right board[^.]*water level/i);
});

test('station lookup', () => {
  assert.equal(getStaffGaugeCameraForStation('52120').camera_id, 'huish_episcopi_ps');
  assert.equal(getStaffGaugeCameraForStation('99999'), null);
});
