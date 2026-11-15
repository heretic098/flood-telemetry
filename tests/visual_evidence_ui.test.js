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

  await t.test('3. Night vision sequence frames are playable; NIGHT_TELEMETRY with zero images yields empty', () => {
    const evNight = { id: 103, asset_type: 'road', asset_id: 'muchelney_access', status: 'CLOSED',
      camera_evidence: { fallback_mode: null, sequence_frames: [{ timestamp: '2026-11-12T06:14:59Z', image_url: '/api/events/103/frames/cam/2026-11-12T06-14-59Z.jpg', is_night_vision: true }] } };
    assert.equal(ctl._getPlayableSequenceFrames(evNight).length, 1);

    const evNoImage = { id: 104, asset_type: 'road', asset_id: 'muchelney_access', status: 'CLOSED',
      camera_evidence: { fallback_mode: 'NIGHT_TELEMETRY', image_url: null, sequence_frames: [] } };
    assert.deepEqual(ctl._getPlayableSequenceFrames(evNoImage), []);
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

  await t.test('8. _normalizeKeyframes(ev) preserves is_night_vision: true and is_daylight: false across start, peak, and end', () => {
    const ev = {
      id: 301,
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      status: 'CLOSED',
      start_time: '2026-11-10T01:00:00Z',
      peak_time: '2026-11-10T03:30:00Z',
      end_time: '2026-11-10T06:00:00Z',
      camera_evidence: {
        keyframes: {
          start: { timestamp: '2026-11-10T01:02:00Z', image_url: U(301, 's'), is_daylight: false, is_night_vision: true, fallback_mode: null },
          peak: { timestamp: '2026-11-10T03:28:00Z', image_url: U(301, 'p'), is_daylight: false, is_night_vision: true, fallback_mode: null },
          end: { timestamp: '2026-11-10T06:03:00Z', image_url: U(301, 'e'), is_daylight: false, is_night_vision: true, fallback_mode: null }
        }
      }
    };
    const kf = ctl._normalizeKeyframes(ev);
    for (const slot of ['start', 'peak', 'end']) {
      assert.ok(kf[slot], `${slot} keyframe must exist`);
      assert.equal(kf[slot].is_night_vision, true, `${slot}.is_night_vision must be preserved as true`);
      assert.equal(kf[slot].is_daylight, false, `${slot}.is_daylight must be preserved as false`);
    }

    // Also verify single-snapshot fallback preserves is_night_vision & is_daylight
    const singleEv = {
      id: 302,
      asset_type: 'road',
      asset_id: 'cuts_road',
      status: 'ACTIVE',
      start_time: '2026-11-10T02:00:00Z',
      camera_evidence: {
        trigger_reason: 'EVENT_START',
        fetched_at: '2026-11-10T02:01:00Z',
        image_url: U(302, 'single'),
        is_daylight: false,
        is_night_vision: true,
        fallback_mode: null
      }
    };
    const singleKf = ctl._normalizeKeyframes(singleEv);
    assert.equal(singleKf.start.is_night_vision, true);
    assert.equal(singleKf.start.is_daylight, false);
  });

  await t.test('9. renderVisualEvidencePanel, _renderSingleKeyframeHtml, and _renderCompareModeHtml emit .badge-night-vision, Night Vision phase pills, and Dawn Fallback toggle', () => {
    const ev = {
      id: 303,
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      from_state: 'NEAR_CREST',
      to_state: 'OVERTOPPING',
      status: 'CLOSED',
      peak_stage_mAOD: 7.55,
      start_time: '2026-11-10T02:00:00Z',
      peak_time: '2026-11-10T05:00:00Z',
      end_time: '2026-11-10T10:00:00Z',
      camera_evidence: {
        camera_id: 'hookbridge_crest',
        fallback_mode: null,
        keyframes: {
          start: { timestamp: '2026-11-10T02:00:00Z', image_url: U(303, 'night_start'), is_daylight: false, is_night_vision: true, delta_ms: 60000 },
          peak: { timestamp: '2026-11-10T05:00:00Z', image_url: U(303, 'night_peak'), is_daylight: false, is_night_vision: true, delta_ms: 30000 },
          end: { timestamp: '2026-11-10T10:00:00Z', image_url: U(303, 'day_end'), is_daylight: true, is_night_vision: false, delta_ms: 45000 }
        },
        sequence_frames: [
          { timestamp: '2026-11-10T02:00:00Z', image_url: U(303, 'night_start'), is_daylight: false, is_night_vision: true },
          { timestamp: '2026-11-10T08:15:00Z', image_url: U(303, 'dawn_seq'), is_daylight: true, is_night_vision: false },
          { timestamp: '2026-11-10T10:00:00Z', image_url: U(303, 'day_end'), is_daylight: true, is_night_vision: false }
        ]
      }
    };

    const keyframes = ctl._normalizeKeyframes(ev);
    const frames = ctl._getPlayableSequenceFrames(ev);

    // Single keyframe HTML for night-vision start
    const modalInstance = Object.assign(Object.create(CameraModalController.prototype), {
      activeEvent: ev,
      selectedPhase: 'start',
      evidenceViewMode: 'keyframes',
      sequenceIndex: 0,
      isPlaying: false,
      playbackSpeed: 1,
      compareSwapped: false,
      useDawnFallbackInCompare: false,
      fieldGuides: {},
      defaultSiteKey: 'hookbridge',
      activeSiteKey: 'hookbridge'
    });

    const singleHtml = modalInstance._renderSingleKeyframeHtml(ev, keyframes);
    assert.match(singleHtml, /badge-night-vision/);
    assert.match(singleHtml, /🌙 NIGHT VISION/);

    // Compare mode HTML with night-vision start and daylight sequence frame -> offers Dawn Fallback toggle
    const compareHtml = modalInstance._renderCompareModeHtml(ev, frames, keyframes);
    assert.match(compareHtml, /badge-night-vision/);
    assert.match(compareHtml, /🌙 NIGHT VISION/);
    assert.match(compareHtml, /id="btn-use-dawn-compare"/);
    assert.match(compareHtml, /Compare Earliest Daylight Frame/);

    // Activate Dawn Fallback toggle -> replaces night start with earliest daylight sequence frame
    modalInstance.useDawnFallbackInCompare = true;
    const compareDawnHtml = modalInstance._renderCompareModeHtml(ev, frames, keyframes);
    assert.match(compareDawnHtml, /dawn_seq\.jpg/);
    assert.doesNotMatch(compareDawnHtml, /id="btn-use-dawn-compare"/);

    // Full renderVisualEvidencePanel emits "• Night Vision" phase pills and .badge-night-vision
    const containerEl = {
      innerHTML: '',
      querySelectorAll: () => [],
      querySelector: () => null
    };
    modalInstance.backdrop = {
      querySelector: (sel) => (sel === '#visual-evidence-container' ? containerEl : null)
    };
    modalInstance.renderVisualEvidencePanel();
    assert.match(containerEl.innerHTML, /• Night Vision/);
    assert.match(containerEl.innerHTML, /badge-night-vision/);
  });

  await t.test('10. jumpToSequenceIndex() dynamically updates .badge-night-vision and .badge-seq-* badges in the DOM', () => {
    const ev = {
      id: 304,
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      status: 'CLOSED',
      peak_stage_mAOD: 7.60,
      start_time: '2026-11-10T02:00:00Z',
      peak_time: '2026-11-10T09:00:00Z',
      end_time: '2026-11-10T11:00:00Z',
      camera_evidence: {
        keyframes: {
          start: { timestamp: '2026-11-10T02:00:00Z', image_url: U(304, 'f0_night_start'), is_daylight: false, is_night_vision: true },
          peak: { timestamp: '2026-11-10T09:00:00Z', image_url: U(304, 'f2_day_peak'), is_daylight: true, is_night_vision: false },
          end: { timestamp: '2026-11-10T11:00:00Z', image_url: U(304, 'f3_day_end'), is_daylight: true, is_night_vision: false }
        },
        sequence_frames: [
          { timestamp: '2026-11-10T02:00:00Z', image_url: U(304, 'f0_night_start'), is_daylight: false, is_night_vision: true },
          { timestamp: '2026-11-10T08:00:00Z', image_url: U(304, 'f1_day_step'), is_daylight: true, is_night_vision: false },
          { timestamp: '2026-11-10T09:00:00Z', image_url: U(304, 'f2_day_peak'), is_daylight: true, is_night_vision: false },
          { timestamp: '2026-11-10T11:00:00Z', image_url: U(304, 'f3_day_end'), is_daylight: true, is_night_vision: false }
        ]
      }
    };

    const imgEl = { src: '', alt: '' };
    const counterEl = { textContent: '' };
    const badgesEl = { innerHTML: '' };
    const sliderEl = { value: '0' };

    const modalInstance = Object.assign(Object.create(CameraModalController.prototype), {
      activeEvent: ev,
      sequenceIndex: 0,
      backdrop: {
        querySelector: (sel) => {
          if (sel === '#evidence-sequence-img') return imgEl;
          if (sel === '#evidence-live-counter') return counterEl;
          if (sel === '#evidence-live-badges') return badgesEl;
          if (sel === '#evidence-scrubber-slider') return sliderEl;
          return null;
        }
      }
    });

    // Step 0: Night-vision Start frame
    modalInstance.jumpToSequenceIndex(0);
    assert.match(badgesEl.innerHTML, /badge-night-vision/);
    assert.match(badgesEl.innerHTML, /badge-seq-start/);
    assert.match(badgesEl.innerHTML, /🟢 TRANSITION START/);

    // Step 1: Daylight intermediate sequence frame -> removes .badge-night-vision, switches to .badge-seq-step
    modalInstance.jumpToSequenceIndex(1);
    assert.doesNotMatch(badgesEl.innerHTML, /badge-night-vision/);
    assert.match(badgesEl.innerHTML, /badge-seq-step/);
    assert.match(badgesEl.innerHTML, /🎞️ TRANSITION SEQUENCE/);
    assert.equal(sliderEl.value, '1');

    // Step 2: Daylight Peak frame -> switches to .badge-seq-peak
    modalInstance.jumpToSequenceIndex(2);
    assert.doesNotMatch(badgesEl.innerHTML, /badge-night-vision/);
    assert.match(badgesEl.innerHTML, /badge-seq-peak/);
    assert.match(badgesEl.innerHTML, /⭐ PEAK STAGE • 7\.60m AOD/);

    // Step 3: Daylight End frame -> switches to .badge-seq-end
    modalInstance.jumpToSequenceIndex(3);
    assert.doesNotMatch(badgesEl.innerHTML, /badge-night-vision/);
    assert.match(badgesEl.innerHTML, /badge-seq-end/);
    assert.match(badgesEl.innerHTML, /🔵 TRANSITION END/);
  });
});
