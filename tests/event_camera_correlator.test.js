/**
 * Hermetic Test Suite: Retroactive Event Keyframe Correlator & Tigris S3 Archival (Issue #23)
 *
 * Verifies:
 * - AWS Signature V4 (`AWS4-HMAC-SHA256`) signing and direct Tigris S3 PUT/GET without local `/data` writes.
 * - Strict path traversal and allowlist enforcement (`validateArchiveCoordinates`, `[RULE-SEC-02]`).
 * - `CameraBufferWorker.getFramesInWindow()` chronological window extraction.
 * - `|t_frame - t_event| <= 20 minutes` temporal matching & out-of-window rejection.
 * - Multi-camera asset fallback (`baltmoor_wall` -> `saltmoor_river`).
 * - Full 3-keyframe (`EVENT_START`, `EVENT_PEAK`, `EVENT_END`) + `±60m` sequence promotion to Tigris S3.
 * - Deferred `+60m` sequence completion via `backfillPendingEventSequences()`.
 * - Civil twilight / darkness detection (`fallback_mode = 'NIGHT_TELEMETRY'`).
 * - SQLite foreign key join (`telemetry_events.camera_snapshot_id = camera_analysis.id`) in `getTelemetryEvents()`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/js/db_migrations.js';
import {
  CameraBufferWorker,
  serializeFrameFilename
} from '../src/js/api/camera_buffer.js';
import {
  TigrisArchiveStore,
  signAwsV4Request,
  validateArchiveCoordinates
} from '../src/js/api/tigris_archive.js';
import {
  correlateEventTransition,
  correlateEventDecisions,
  backfillPendingEventSequences,
  evaluateFrameDarkness,
  resolveCandidateCamerasForAsset
} from '../src/js/event_camera_correlator.js';
import { getTelemetryEvents } from '../src/js/event_ledger.js';

/**
 * Helper to create a valid synthetic JPEG binary buffer with controllable scan byte luminance.
 */
function makeSyntheticJpeg(luminanceByte = 140, size = 256) {
  const buf = Buffer.alloc(size, luminanceByte);
  // JPEG SOI marker: 0xFF 0xD8 0xFF 0xE0
  buf[0] = 0xFF;
  buf[1] = 0xD8;
  buf[2] = 0xFF;
  buf[3] = 0xE0;
  // JPEG EOI marker: 0xFF 0xD9
  buf[size - 2] = 0xFF;
  buf[size - 1] = 0xD9;
  return buf;
}

/**
 * Helper to write a timestamped frame into a temporary CameraBufferWorker directory.
 */
function seedBufferedFrame(baseDir, cameraId, isoTimestamp, luminanceByte = 140) {
  const camDir = path.join(baseDir, cameraId);
  fs.mkdirSync(camDir, { recursive: true });
  const filename = serializeFrameFilename(isoTimestamp);
  const filePath = path.join(camDir, filename);
  const buf = makeSyntheticJpeg(luminanceByte);
  fs.writeFileSync(filePath, buf);
  return { filename, filePath, buffer: buf };
}

test('TigrisArchiveStore: signs AWS SigV4 requests and uploads directly to Tigris S3 with zero local disk writes', async () => {
  const tmpSqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-sqlite-dir-'));
  const s3Objects = new Map();
  const capturedRequests = [];

  const mockFetch = async (url, init) => {
    capturedRequests.push({ url, method: init.method, headers: init.headers });
    if (init.method === 'PUT') {
      s3Objects.set(url, Buffer.from(init.body));
      return { ok: true, status: 200 };
    }
    if (init.method === 'GET') {
      if (!s3Objects.has(url)) {
        return { ok: false, status: 404 };
      }
      const stored = s3Objects.get(url);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength)
      };
    }
    return { ok: false, status: 405 };
  };

  try {
    const store = new TigrisArchiveStore({
      bucketName: 'mock-ephemeral-test-bucket',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'auto',
      endpoint: 'https://fly.storage.tigris.dev',
      fetchFn: mockFetch,
      fallbackDir: path.join(tmpSqliteDir, 'should_never_be_created')
    });

    assert.equal(store.isCloudConfigured(), true);

    const filename = serializeFrameFilename('2026-11-10T12:00:00.000Z');
    const jpegBuf = makeSyntheticJpeg(150);

    const res = await store.uploadFrame(42, 'hookbridge_crest', filename, jpegBuf);
    assert.equal(res.stored, true);
    assert.equal(res.backend, 'tigris_s3');
    assert.equal(res.proxyUrl, `/api/events/42/frames/hookbridge_crest/${filename}`);
    assert.ok(!res.proxyUrl.includes('mock-ephemeral-test-bucket'), 'Proxy URL must never leak bucket name [RULE-SEC-02]');

    // Verify AWS SigV4 headers on PUT request
    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0].method, 'PUT');
    assert.ok(capturedRequests[0].headers.Authorization.startsWith('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/'));
    assert.ok(capturedRequests[0].headers['x-amz-content-sha256']);
    assert.ok(capturedRequests[0].headers['x-amz-date']);

    // Verify ZERO files written to local fallbackDir
    assert.equal(fs.existsSync(path.join(tmpSqliteDir, 'should_never_be_created')), false);

    // Verify round-trip fetchFrame from Tigris S3
    const fetched = await store.fetchFrame(42, 'hookbridge_crest', filename);
    assert.ok(Buffer.isBuffer(fetched));
    assert.equal(Buffer.compare(fetched, jpegBuf), 0);

    // Verify 404 returns null
    const missing = await store.fetchFrame(42, 'hookbridge_crest', '2026-11-10T99-99-99.000Z.jpg');
    assert.equal(missing, null);
  } finally {
    fs.rmSync(tmpSqliteDir, { recursive: true, force: true });
  }
});

test('validateArchiveCoordinates: enforces strict allowlist and blocks path traversal', () => {
  assert.equal(validateArchiveCoordinates(15, 'hookbridge_crest', '2026-11-10T12-00-00.000Z.jpg'), 15);
  assert.throws(() => validateArchiveCoordinates(-1, 'hookbridge_crest', '2026-11-10T12-00-00.000Z.jpg'), /Invalid archive eventId/);
  assert.throws(() => validateArchiveCoordinates(15, 'evil_camera', '2026-11-10T12-00-00.000Z.jpg'), /Security Violation/);
  assert.throws(() => validateArchiveCoordinates(15, 'hookbridge_crest', '../etc/passwd.jpg'), /Security Violation/);
  assert.throws(() => validateArchiveCoordinates(15, 'hookbridge_crest', 'shell.sh'), /Security Violation/);
});

test('CameraBufferWorker.getFramesInWindow: returns chronologically sorted frames within [startIso, endIso]', () => {
  const tmpBufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cam-window-'));
  try {
    const worker = new CameraBufferWorker({ baseDir: tmpBufDir });
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T10:30:00.000Z');
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T11:15:00.000Z');
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T11:45:00.000Z');
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T12:30:00.000Z');
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T13:30:00.000Z');

    const frames = worker.getFramesInWindow(
      'dunball_northern_flap',
      '2026-11-10T11:00:00.000Z',
      '2026-11-10T13:00:00.000Z'
    );

    assert.equal(frames.length, 3);
    assert.equal(frames[0].timestamp, '2026-11-10T11:15:00.000Z');
    assert.equal(frames[1].timestamp, '2026-11-10T11:45:00.000Z');
    assert.equal(frames[2].timestamp, '2026-11-10T12:30:00.000Z');
  } finally {
    fs.rmSync(tmpBufDir, { recursive: true, force: true });
  }
});

test('Full Lifecycle Correlation: promotes EVENT_START, EVENT_PEAK, and EVENT_END keyframes + ±60m sequence to Tigris S3 and joins SQLite', async () => {
  const tmpBufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-correlator-buf-'));
  const db = new Database(':memory:');
  runMigrations(db);

  const s3BucketStore = new Map();
  const mockFetch = async (url, init) => {
    if (init.method === 'PUT') {
      s3BucketStore.set(url, Buffer.from(init.body));
      return { ok: true, status: 200 };
    }
    if (init.method === 'GET') {
      const item = s3BucketStore.get(url);
      if (!item) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => item.buffer.slice(item.byteOffset, item.byteOffset + item.byteLength)
      };
    }
    return { ok: false, status: 405 };
  };

  try {
    const bufferWorker = new CameraBufferWorker({ baseDir: tmpBufDir });
    const archiveStore = new TigrisArchiveStore({
      bucketName: 'mock-tigris-bucket',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      fetchFn: mockFetch
    });

    // Seed daylight frames around start (11:00Z), peak (12:30Z), and end (14:00Z)
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T10:15:00.000Z', 145);
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T10:45:00.000Z', 148);
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T11:03:00.000Z', 152); // +3m from EVENT_START (11:00Z)
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T11:30:00.000Z', 155);
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T12:28:00.000Z', 160); // -2m from EVENT_PEAK (12:30Z)
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T13:30:00.000Z', 150);
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T14:05:00.000Z', 142); // +5m from EVENT_END (14:00Z)

    // Insert ACTIVE event row in telemetry_events
    const info = db.prepare(`
      INSERT INTO telemetry_events (
        asset_type, asset_id, from_state, to_state, severity_tier,
        start_time, peak_time, trigger_stage_mAOD, peak_stage_mAOD,
        clearance_m, narrative, status
      ) VALUES (
        'spillway', 'hookbridge', 'NEAR_CREST', 'OVERTOPPING', 4,
        '2026-11-10T11:00:00.000Z', '2026-11-10T11:00:00.000Z', 7.46, 7.46,
        -0.01, 'Hookbridge overtopping.', 'ACTIVE'
      )
    `).run();
    const eventId = Number(info.lastInsertRowid);

    // 1. Correlate OPEN decision (EVENT_START)
    const openResults = await correlateEventDecisions(db, [{
      action: 'OPEN',
      event_id: eventId,
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      start_time: '2026-11-10T11:00:00.000Z',
      peak_time: '2026-11-10T11:00:00.000Z'
    }], { bufferWorker, archiveStore });

    assert.equal(openResults.length, 1);
    assert.equal(openResults[0].matched, true);
    assert.equal(openResults[0].phase, 'EVENT_START');
    assert.equal(openResults[0].camera_id, 'hookbridge_crest');
    assert.equal(openResults[0].fallback_mode, null);
    assert.equal(openResults[0].storage_backend, 'tigris_s3');

    // 2. Correlate UPDATE decision with new peak_time (EVENT_PEAK at 12:30Z)
    db.prepare(`
      UPDATE telemetry_events
      SET peak_stage_mAOD = 7.62, peak_time = '2026-11-10T12:30:00.000Z'
      WHERE id = ?
    `).run(eventId);

    const peakResults = await correlateEventDecisions(db, [{
      action: 'UPDATE',
      event_id: eventId,
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      peak_time: '2026-11-10T12:30:00.000Z',
      peak_time_changed: true
    }], { bufferWorker, archiveStore });

    assert.equal(peakResults.length, 1);
    assert.equal(peakResults[0].matched, true);
    assert.equal(peakResults[0].phase, 'EVENT_PEAK');

    // 3. Correlate CLOSE decision (EVENT_END at 14:00Z)
    db.prepare(`
      UPDATE telemetry_events
      SET end_time = '2026-11-10T14:00:00.000Z', duration_seconds = 10800, status = 'CLOSED'
      WHERE id = ?
    `).run(eventId);

    const closeResults = await correlateEventDecisions(db, [{
      action: 'CLOSE',
      event_id: eventId,
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      end_time: '2026-11-10T14:00:00.000Z',
      peak_time_changed: false
    }], { bufferWorker, archiveStore });

    assert.equal(closeResults.length, 1);
    assert.equal(closeResults[0].matched, true);
    assert.equal(closeResults[0].phase, 'EVENT_END');

    // Verify SQLite join in getTelemetryEvents()
    const events = getTelemetryEvents(db, { asset_id: 'hookbridge' });
    assert.equal(events.length, 1);
    const ev = events[0];
    assert.ok(ev.camera_snapshot_id > 0, 'telemetry_events.camera_snapshot_id must be populated');
    assert.ok(ev.camera_evidence, 'camera_evidence must be joined from camera_analysis');
    assert.equal(ev.camera_evidence.camera_id, 'hookbridge_crest');
    assert.equal(ev.camera_evidence.keyframes.start.timestamp, '2026-11-10T11:03:00.000Z');
    assert.equal(ev.camera_evidence.keyframes.peak.timestamp, '2026-11-10T12:28:00.000Z');
    assert.equal(ev.camera_evidence.keyframes.end.timestamp, '2026-11-10T14:05:00.000Z');
    assert.ok(ev.camera_evidence.sequence_frames.length >= 6, '±60m transition sequence frames must be archived');

    // Verify manifest.json and frames exist in Tigris S3 bucket store
    const manifestUrl = 'https://fly.storage.tigris.dev/mock-tigris-bucket/archived_events/1/manifest.json';
    assert.equal(s3BucketStore.has(manifestUrl), true, 'manifest.json must be stored in Tigris S3');
  } finally {
    db.close();
    fs.rmSync(tmpBufDir, { recursive: true, force: true });
  }
});

test('Out-of-window rejection & multi-camera fallback: rejects frames > 20m away, keeps baltmoor_wall isolated from saltmoor_river, and falls back across northmoor cameras', async () => {
  const tmpBufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-fallback-cam-'));
  const tmpFallbackStore = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ephemeral-store-'));
  const db = new Database(':memory:');
  runMigrations(db);

  try {
    const bufferWorker = new CameraBufferWorker({ baseDir: tmpBufDir });
    const archiveStore = new TigrisArchiveStore({ fallbackDir: tmpFallbackStore });

    // 1. Frame on hookbridge_crest is 35 minutes away (> 20m tolerance) -> must NOT match
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T11:35:00.000Z', 140);

    const info1 = db.prepare(`
      INSERT INTO telemetry_events (
        asset_type, asset_id, from_state, to_state, severity_tier,
        start_time, peak_time, trigger_stage_mAOD, peak_stage_mAOD,
        narrative, status
      ) VALUES (
        'spillway', 'hookbridge', 'NEAR_CREST', 'OVERTOPPING', 4,
        '2026-11-10T11:00:00.000Z', '2026-11-10T11:00:00.000Z', 7.46, 7.46,
        'Hookbridge overtopping.', 'ACTIVE'
      )
    `).run();

    const missRes = await correlateEventTransition(db, {
      id: Number(info1.lastInsertRowid),
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      start_time: '2026-11-10T11:00:00.000Z'
    }, 'EVENT_START', { bufferWorker, archiveStore });

    assert.equal(missRes.matched, false);
    assert.equal(missRes.reason, 'NO_FRAME_IN_WINDOW');

    // 2. baltmoor_wall strictly maps to ['baltmoor_wall'] (does NOT attach Saltmoor PS photos when temporary cam is offline)
    const baltmoorCandidates = resolveCandidateCamerasForAsset('baltmoor_wall');
    assert.deepEqual(baltmoorCandidates, ['baltmoor_wall']);

    // 3. northmoor falls back across its permanent pumping station cameras to 'saltmoor_river'
    const northmoorCandidates = resolveCandidateCamerasForAsset('northmoor');
    assert.ok(northmoorCandidates.includes('saltmoor_river'));

    seedBufferedFrame(tmpBufDir, 'saltmoor_river', '2026-11-10T11:04:00.000Z', 145);

    const info2 = db.prepare(`
      INSERT INTO telemetry_events (
        asset_type, asset_id, from_state, to_state, severity_tier,
        start_time, peak_time, trigger_stage_mAOD, peak_stage_mAOD,
        narrative, status
      ) VALUES (
        'polder', 'northmoor', 'STANDBY', 'DUTY_PUMPING', 2,
        '2026-11-10T11:00:00.000Z', '2026-11-10T11:00:00.000Z', 4.82, 4.82,
        'Northmoor & Saltmoor PS duty pumping.', 'ACTIVE'
      )
    `).run();

    const fallbackRes = await correlateEventTransition(db, {
      id: Number(info2.lastInsertRowid),
      asset_type: 'polder',
      asset_id: 'northmoor',
      start_time: '2026-11-10T11:00:00.000Z'
    }, 'EVENT_START', { bufferWorker, archiveStore });

    assert.equal(fallbackRes.matched, true);
    assert.equal(fallbackRes.camera_id, 'saltmoor_river');
  } finally {
    db.close();
    fs.rmSync(tmpBufDir, { recursive: true, force: true });
    fs.rmSync(tmpFallbackStore, { recursive: true, force: true });
  }
});

test('Darkness & Civil Twilight Detection: flags nighttime events as NIGHT_TELEMETRY and skips pitch-black sequence uploads', async () => {
  const tmpBufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-night-buf-'));
  const tmpFallbackStore = fs.mkdtempSync(path.join(os.tmpdir(), 'test-night-store-'));
  const db = new Database(':memory:');
  runMigrations(db);

  try {
    const bufferWorker = new CameraBufferWorker({ baseDir: tmpBufDir });
    const archiveStore = new TigrisArchiveStore({ fallbackDir: tmpFallbackStore });

    // Seed frames around 02:00 UTC in November (deep civil night in Somerset, solar elevation ~ -55 deg)
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T01:45:00.000Z', 10);
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T02:02:00.000Z', 10);
    seedBufferedFrame(tmpBufDir, 'dunball_northern_flap', '2026-11-10T02:15:00.000Z', 10);

    const darknessCheck = evaluateFrameDarkness(makeSyntheticJpeg(10), '2026-11-10T02:02:00.000Z');
    assert.equal(darknessCheck.isDark, true);
    assert.equal(darknessCheck.isDaylight, false);
    assert.equal(darknessCheck.fallback_mode, 'NIGHT_TELEMETRY');

    const info = db.prepare(`
      INSERT INTO telemetry_events (
        asset_type, asset_id, from_state, to_state, severity_tier,
        start_time, peak_time, trigger_stage_mAOD, peak_stage_mAOD,
        narrative, status
      ) VALUES (
        'tidal_gate', 'dunball_outfall', 'DISCHARGING', 'TIDE_LOCKED', 2,
        '2026-11-10T02:00:00.000Z', '2026-11-10T02:00:00.000Z', 4.95, 5.80,
        'Dunball tide locked.', 'ACTIVE'
      )
    `).run();
    const eventId = Number(info.lastInsertRowid);

    const res = await correlateEventTransition(db, {
      id: eventId,
      asset_type: 'tidal_gate',
      asset_id: 'dunball_outfall',
      start_time: '2026-11-10T02:00:00.000Z'
    }, 'EVENT_START', { bufferWorker, archiveStore });

    assert.equal(res.matched, true);
    assert.equal(res.fallback_mode, 'NIGHT_TELEMETRY');
    assert.equal(res.sequence_count, 0, 'Pitch-black night transitions must skip redundant sequence uploads');

    const events = getTelemetryEvents(db, { asset_id: 'dunball_outfall' });
    assert.equal(events[0].camera_evidence.fallback_mode, 'NIGHT_TELEMETRY');
  } finally {
    db.close();
    fs.rmSync(tmpBufDir, { recursive: true, force: true });
    fs.rmSync(tmpFallbackStore, { recursive: true, force: true });
  }
});

test('Deferred +60m Sequence Completion: backfillPendingEventSequences uploads newly arrived post-event frames', async () => {
  const tmpBufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-backfill-seq-'));
  const tmpFallbackStore = fs.mkdtempSync(path.join(os.tmpdir(), 'test-backfill-store-'));
  const db = new Database(':memory:');
  runMigrations(db);

  try {
    const bufferWorker = new CameraBufferWorker({ baseDir: tmpBufDir });
    const archiveStore = new TigrisArchiveStore({ fallbackDir: tmpFallbackStore });

    // Use a recent daytime timestamp (within the 48h backfill query window)
    const eventStart = new Date();
    eventStart.setUTCHours(12, 0, 0, 0);
    // Ensure eventStart is within the past 24 hours
    if (eventStart.getTime() > Date.now()) {
      eventStart.setUTCDate(eventStart.getUTCDate() - 1);
    }
    const startIso = eventStart.toISOString();
    const minus15Iso = new Date(eventStart.getTime() - 15 * 60 * 1000).toISOString();
    const plus20Iso = new Date(eventStart.getTime() + 20 * 60 * 1000).toISOString();
    const plus40Iso = new Date(eventStart.getTime() + 40 * 60 * 1000).toISOString();

    // Initially only T-15m and T+0m are in the ring buffer
    seedBufferedFrame(tmpBufDir, 'athelney_spillway', minus15Iso, 150);
    seedBufferedFrame(tmpBufDir, 'athelney_spillway', startIso, 150);

    const info = db.prepare(`
      INSERT INTO telemetry_events (
        asset_type, asset_id, from_state, to_state, severity_tier,
        start_time, peak_time, trigger_stage_mAOD, peak_stage_mAOD,
        narrative, status
      ) VALUES (
        'road', 'cuts_road', 'ENCROACHING', 'IMPASSABLE', 4,
        ?, ?, 7.36, 7.36,
        'Cuts Road submerged.', 'ACTIVE'
      )
    `).run(startIso, startIso);
    const eventId = Number(info.lastInsertRowid);

    const initialRes = await correlateEventTransition(db, {
      id: eventId,
      asset_type: 'road',
      asset_id: 'cuts_road',
      start_time: startIso
    }, 'EVENT_START', { bufferWorker, archiveStore });

    assert.equal(initialRes.matched, true);
    assert.equal(initialRes.sequence_count, 2);

    // Force windows_complete.start_plus_60m = false to simulate event detected before T+60m elapsed
    const caRow = db.prepare('SELECT * FROM camera_analysis WHERE id = ?').get(initialRes.camera_snapshot_id);
    const parsedManifest = JSON.parse(caRow.analysis_json);
    parsedManifest.windows_complete.start_plus_60m = false;
    db.prepare('UPDATE camera_analysis SET analysis_json = ? WHERE id = ?')
      .run(JSON.stringify(parsedManifest), initialRes.camera_snapshot_id);

    // Now T+20m and T+40m frames arrive in the local ring buffer
    seedBufferedFrame(tmpBufDir, 'athelney_spillway', plus20Iso, 155);
    seedBufferedFrame(tmpBufDir, 'athelney_spillway', plus40Iso, 155);

    const updatedCount = await backfillPendingEventSequences(db, { bufferWorker, archiveStore });
    assert.equal(updatedCount, 1);

    const events = getTelemetryEvents(db, { asset_id: 'cuts_road' });
    assert.equal(events[0].camera_evidence.sequence_frames.length, 4);
  } finally {
    db.close();
    fs.rmSync(tmpBufDir, { recursive: true, force: true });
    fs.rmSync(tmpFallbackStore, { recursive: true, force: true });
  }
});

test('Mixed Night-to-Day Event & Lagged EVENT_END Recovery: night start does not block daylight end sequence backfill', async () => {
  const tmpBufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-night-day-buf-'));
  const tmpFallbackStore = fs.mkdtempSync(path.join(os.tmpdir(), 'test-night-day-store-'));
  const db = new Database(':memory:');
  runMigrations(db);

  try {
    const bufferWorker = new CameraBufferWorker({ baseDir: tmpBufDir });
    const archiveStore = new TigrisArchiveStore({ fallbackDir: tmpFallbackStore });

    // Construct a recent night start (02:00 UTC) and daylight close (11:00 UTC) on the same day within past 48h
    const baseDay = new Date(Date.now() - 20 * 60 * 60 * 1000);
    baseDay.setUTCHours(2, 0, 0, 0);
    const nightStartIso = baseDay.toISOString();

    const dayEnd = new Date(baseDay.getTime() + 9 * 60 * 60 * 1000); // 11:00 UTC (daylight)
    const dayEndIso = dayEnd.toISOString();
    const dayEndPlus25Iso = new Date(dayEnd.getTime() + 25 * 60 * 1000).toISOString();

    // Seed night start frame
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', nightStartIso, 12);

    const info = db.prepare(`
      INSERT INTO telemetry_events (
        asset_type, asset_id, from_state, to_state, severity_tier,
        start_time, peak_time, end_time, duration_seconds,
        trigger_stage_mAOD, peak_stage_mAOD, narrative, status
      ) VALUES (
        'spillway', 'hookbridge', 'NEAR_CREST', 'OVERTOPPING', 4,
        ?, ?, ?, 32400,
        7.46, 7.55, 'Hookbridge overtopping overnight into morning.', 'CLOSED'
      )
    `).run(nightStartIso, nightStartIso, dayEndIso);
    const eventId = Number(info.lastInsertRowid);

    // Correlate EVENT_START at night (when EVENT_END frame has not arrived yet)
    const startRes = await correlateEventTransition(db, {
      id: eventId,
      asset_type: 'spillway',
      asset_id: 'hookbridge',
      start_time: nightStartIso
    }, 'EVENT_START', { bufferWorker, archiveStore });
    assert.equal(startRes.matched, true);
    assert.equal(startRes.fallback_mode, 'NIGHT_TELEMETRY');

    // Now daylight EVENT_END frame and +25m frame arrive in the ring buffer
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', dayEndIso, 155);
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', dayEndPlus25Iso, 160);

    // Run backfillPendingEventSequences -> must recover missing EVENT_END keyframe AND archive daylight sequence
    const updated = await backfillPendingEventSequences(db, { bufferWorker, archiveStore });
    assert.ok(updated >= 1);

    const events = getTelemetryEvents(db, { asset_id: 'hookbridge' });
    assert.ok(events[0].camera_evidence.keyframes.end, 'Missing EVENT_END keyframe must be recovered by backfill');
    assert.equal(events[0].camera_evidence.keyframes.end.fallback_mode, null);
    assert.equal(events[0].camera_evidence.fallback_mode, null, 'Daylight end keyframe clears aggregate NIGHT_TELEMETRY');
    assert.ok(events[0].camera_evidence.sequence_frames.length >= 2, 'Daylight end sequence must be archived despite night start');
  } finally {
    db.close();
    fs.rmSync(tmpBufDir, { recursive: true, force: true });
    fs.rmSync(tmpFallbackStore, { recursive: true, force: true });
  }
});

test('Fault Isolation: S3 network error on first decision does not abort remaining asset correlations', async () => {
  const tmpBufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-fault-buf-'));
  const db = new Database(':memory:');
  runMigrations(db);

  try {
    const bufferWorker = new CameraBufferWorker({ baseDir: tmpBufDir });
    seedBufferedFrame(tmpBufDir, 'hookbridge_crest', '2026-11-10T12:00:00.000Z', 150);
    seedBufferedFrame(tmpBufDir, 'currymoor_ps', '2026-11-10T12:00:00.000Z', 150);

    // Mock S3 fetch that fails on event 1 but succeeds on event 2
    const archiveStore = new TigrisArchiveStore({
      bucketName: 'mock-fault-bucket',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      fetchFn: async (url) => {
        if (url.includes('/archived_events/1/')) {
          return { ok: false, status: 500 };
        }
        return { ok: true, status: 200 };
      }
    });

    db.prepare(`
      INSERT INTO telemetry_events (
        id, asset_type, asset_id, from_state, to_state, severity_tier,
        start_time, peak_time, trigger_stage_mAOD, peak_stage_mAOD, narrative, status
      ) VALUES
        (1, 'spillway', 'hookbridge', 'NEAR_CREST', 'OVERTOPPING', 4, '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z', 7.46, 7.46, 'Hookbridge.', 'ACTIVE'),
        (2, 'polder', 'curry_moor', 'STANDBY', 'DUTY_PUMPING', 2, '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z', 4.60, 4.60, 'Curry Moor.', 'ACTIVE')
    `).run();

    const results = await correlateEventDecisions(db, [
      {
        action: 'OPEN',
        event_id: 1,
        asset_type: 'spillway',
        asset_id: 'hookbridge',
        start_time: '2026-11-10T12:00:00.000Z',
        peak_time: '2026-11-10T12:00:00.000Z'
      },
      {
        action: 'OPEN',
        event_id: 2,
        asset_type: 'polder',
        asset_id: 'curry_moor',
        start_time: '2026-11-10T12:00:00.000Z',
        peak_time: '2026-11-10T12:00:00.000Z'
      }
    ], { bufferWorker, archiveStore });

    assert.equal(results.length, 2);
    assert.equal(results[0].matched, false);
    assert.equal(results[0].reason, 'ERROR');
    assert.equal(results[1].matched, true);
    assert.equal(results[1].event_id, 2);
    assert.equal(results[1].camera_id, 'currymoor_ps');
  } finally {
    db.close();
    fs.rmSync(tmpBufDir, { recursive: true, force: true });
  }
});
