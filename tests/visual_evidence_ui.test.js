/**
 * Issue #24: Visual Evidence UI tests (zero-dependency, no DOM library).
 * Covers keyframe dedup, playable sequence frames, night telemetry, corridor/topology/dashboard wiring,
 * and the status payload contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CameraModalController, isValidEventImageUrl } from '../src/js/modules/camera_modal.js';
import { renderCorridorRow } from '../src/js/roads.js';
import { validateApiStatusPayload } from '../src/js/contracts/api_status_schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Logic-only instance: skips constructor (which builds DOM)
const ctl = Object.create(CameraModalController.prototype);

const U = (id, ts) => `/api/events/${id}/frames/cam/${ts}.jpg`;

test('Issue #24 Visual Evidence UI Suite', async (t) => {
  await t.test('1. Binary tidal_gate transition omits Peak keyframe', () => {
    const ev = {
      id: 101, asset_type: 'tidal_gate', asset_id: 'dunball_outfall', status: 'CLOSED',
      start_time: '2026-11-10T14:24:00.000Z', peak_time: '2026-11-10T14:35:00.000Z', end_time: '2026-11-10T14:45:00.000Z',
      camera_evidence: { keyframes: {
        start: { timestamp: '2026-11-10T14:24:47Z', image_url: U(101, 'a') },
        peak: { timestamp: '2026-11-10T14:34:47Z', image_url: U(101, 'b') },
        end: { timestamp: '2026-11-10T14:44:48Z', image_url: U(101, 'c') } },
        sequence_frames: [{ timestamp: '2026-11-10T14:24:47Z', image_url: U(101, 'a') }, { timestamp: '2026-11-10T14:44:48Z', image_url: U(101, 'c') }] }
    };
    const kf = ctl._normalizeKeyframes(ev);
    assert.ok(kf.start); assert.ok(kf.end); assert.equal(kf.peak, null);
    assert.equal(ctl._getPlayableSequenceFrames(ev).length, 2);
  });

  await t.test('2. Spillway with distinct Peak keeps it; identical Peak is dropped', () => {
    const base = { id: 102, asset_type: 'spillway', asset_id: 'hookbridge', status: 'CLOSED',
      start_time: '2026-11-10T05:15:00Z', peak_time: '2026-11-10T11:30:00Z', end_time: '2026-11-10T14:45:00Z' };
    const mk = (peakUrl, peakTs) => ({ ...base, camera_evidence: { keyframes: {
      start: { timestamp: '2026-11-10T05:15:00Z', image_url: U(102, 's') },
      peak: { timestamp: peakTs, image_url: peakUrl },
      end: { timestamp: '2026-11-10T14:45:00Z', image_url: U(102, 'e') } } } });
    assert.ok(ctl._normalizeKeyframes(mk(U(102, 'p'), '2026-11-10T11:30:00Z')).peak);
    assert.equal(ctl._normalizeKeyframes(mk(U(102, 'e'), '2026-11-10T14:45:00Z')).peak, null);
    assert.equal(ctl._normalizeKeyframes(mk(U(102, 'x'), '2026-11-10T14:42:00Z')).peak, null);
  });

  await t.test('3. NIGHT_TELEMETRY yields no playable frames', () => {
    const ev = { id: 103, asset_type: 'road', asset_id: 'muchelney_access', status: 'CLOSED',
      camera_evidence: { fallback_mode: 'NIGHT_TELEMETRY', image_url: '/x.jpg', sequence_frames: [{ timestamp: 't', image_url: '/y.jpg' }] } };
    assert.deepEqual(ctl._getPlayableSequenceFrames(ev), []);
  });

  await t.test('4. Corridor row renders Visual Evidence / Night Telemetry triggers', () => {
    const corridor = { asset_id: 'cuts_road', name: 'Cuts Road', corridor_type: 'X', status: 'PASSABLE',
      badge_class: 'badge-passable', badge_symbol: '🟢', badge_label: 'PASSABLE', stage_mAOD: 4.4, crown_elevation_mAOD: 7.35, clearance_text: 'ok' };
    const day = renderCorridorRow(corridor, { id: 201, asset_id: 'cuts_road', camera_evidence: { fallback_mode: null,
      sequence_frames: [{ timestamp: 'a', image_url: '/a.jpg' }, { timestamp: 'b', image_url: '/b.jpg' }] } });
    assert.match(day, /data-visual-evidence-event-id="201"/);
    assert.match(day, /Visual Evidence \(2\)/);
    const night = renderCorridorRow(corridor, { id: 202, asset_id: 'cuts_road', camera_evidence: { fallback_mode: 'NIGHT_TELEMETRY', sequence_frames: [] } });
    assert.match(night, /Night Telemetry/);
    assert.doesNotMatch(renderCorridorRow(corridor, null), /visual-evidence-trigger/);
  });

  await t.test('5. Evidence wired into dashboard, roads card, and topology inspector', () => {
    const app = read('src/js/app.js'), topo = read('src/js/topology.js'), roads = read('src/js/roads.js');
    for (const [n, s] of [['app', app], ['topology', topo], ['roads', roads]]) {
      assert.ok(s.includes('visual-evidence-trigger'), n + ' must render visual-evidence-trigger');
    }
    assert.ok(topo.includes('setCameraEventsCatalog') && topo.includes('/api/events'), 'topology must load events catalog');
    assert.ok(topo.includes('initCameraGuideTriggers'), 'topology must init triggers');
    assert.ok(app.includes('renderEventsTimeline'));
  });

  await t.test('6. API Status Schema allows optional camera_evidence', () => {
    const now = new Date().toISOString();
    const res = validateApiStatusPayload({
      status: 'ok', generated_at: now,
      system_timestamps: { latest_ea_reading_at: now, db_synced_at: now, client_poll_at: now },
      global_status: { counter_pill: 'x', banner_text: 'y', top_severity: 3, is_tide_locked: false },
      roads: { counts: { all: 0, impassable: 0, encroaching: 0, passable: 0 }, corridors_list: [] },
      active_events: [{ id: 1, asset_type: 'spillway', asset_id: 'hookbridge', from_state: 'SECURE', to_state: 'NEAR_CREST',
        severity_tier: 2, start_time: now, end_time: null, duration_seconds: 120, duration_formatted: '0h 2m',
        trigger_stage_mAOD: 7.2, peak_stage_mAOD: 7.22, peak_time: now, clearance_m: 0.23, status: 'ACTIVE', narrative: 'n',
        camera_id: 'c', camera_snapshot_id: 5,
        camera_evidence: { snapshot_id: 5, camera_id: 'c', image_url: '/a.jpg', fallback_mode: null, sequence_frames: [] } }]
    });
    assert.equal(res.valid, true, (res.errors || []).join(', '));
  });

  await t.test('7. Same-origin image URL validation, catalog reset, and zero user-facing RULE-IDs', () => {
    assert.equal(isValidEventImageUrl('/api/events/101/frames/dunball_northern_flap/2026-11-10T14-24-47.667Z.jpg'), true);
    assert.equal(isValidEventImageUrl('https://evil.example/x.jpg'), false);
    assert.equal(isValidEventImageUrl('javascript:alert(1)'), false);
    assert.equal(isValidEventImageUrl('/api/events/101/frames/../secret.jpg'), false);

    const mockModal = Object.assign(Object.create(CameraModalController.prototype), {
      eventsById: new Map([['999', { id: 999 }]]),
      eventsByAsset: new Map([['stale_asset', { id: 999 }]])
    });
    mockModal.setEventsCatalog([{ id: 1, asset_id: 'hookbridge', status: 'ACTIVE' }]);
    assert.equal(mockModal.eventsById.has('999'), false);
    assert.equal(mockModal.eventsByAsset.has('stale_asset'), false);
    assert.equal(mockModal.eventsById.has('1'), true);

    const modalSrc = read('src/js/modules/camera_modal.js');
    assert.doesNotMatch(modalSrc, /Optical Ground-Truth \[RULE-/);
    assert.doesNotMatch(modalSrc, /Physical Limitations \[RULE-/);
  });
});
