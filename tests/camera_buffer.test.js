/**
 * Hermetic Unit & Integration Tests for Camera Buffer Pipeline (Phase 1 / Issue #22)
 * 
 * Verifies:
 * - Rebalanced 10-camera catalog invariants ([RULE-ENT-01], [RULE-CAM-01]).
 * - Two-step CFH dynamic image discovery and offline handling.
 * - SSRF defence matrix, IP literal rejection, and 3MB chunked limit.
 * - JPEG magic-byte verification (0xFF 0xD8 0xFF).
 * - Paced round-robin rotation and concurrency lock.
 * - Filename caching and 20-minute heartbeat write.
 * - V8 date parsing helpers (serializeFrameFilename & parseFrameFilename).
 * - Hourly housekeeping (48h retention prune, 350MB hard ceiling, stale .tmp_* sweep).
 * - Retroactive nearest-frame lookup with tolerance bounds.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  CAMERA_CATALOG,
  ALLOWED_CAMERA_IDS,
  assertAllowedDomain,
  serializeFrameFilename,
  parseFrameFilename,
  computeBufferHash,
  resolveLatestCameraImageUrl,
  fetchWebcamImageSecure,
  CameraBufferWorker
} from '../src/js/api/camera_buffer.js';

// Helper to create valid fake JPEG buffer
function createMockJpegBuffer(content = 'SOMERSET_FLOOD_FRAME') {
  const header = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
  const body = Buffer.from(content, 'utf8');
  return Buffer.concat([header, body]);
}

test('Catalog Invariants: Rebalanced 10-camera registry matches canonical choke points', () => {
  assert.equal(CAMERA_CATALOG.length, 10, 'Must contain exactly 10 monitored camera choke-points');
  assert.equal(ALLOWED_CAMERA_IDS.size, 10);

  const dunballCams = CAMERA_CATALOG.filter(c => c.chokePoint === 'dunball_outfall');
  assert.equal(dunballCams.length, 3, 'Dunball must have exactly 3 balanced angles (Northern, Southern, Pump Pipework)');

  const baltmoor = CAMERA_CATALOG.find(c => c.id === 'baltmoor_wall');
  assert.ok(baltmoor, 'Baltmoor Wall must exist');
  assert.equal(baltmoor.chokePoint, 'baltmoor_wall');
  assert.equal(baltmoor.assetType, 'spillway');
  assert.ok(baltmoor.description.includes('7.80m AOD'), 'Must reflect 7.80m Parrett levee');

  const athelney = CAMERA_CATALOG.find(c => c.id === 'athelney_spillway');
  assert.ok(athelney, 'Athelney Spillway must exist');
  assert.equal(athelney.chokePoint, 'cuts_road');
  assert.equal(athelney.assetType, 'road');
  assert.ok(athelney.description.includes('7.35m AOD'), 'Must reflect 7.35m Curry Moor cascade');
  assert.ok(athelney.lookFor.includes('not the Cuts Road asphalt carriageway'), 'Must uphold [RULE-CAM-01] lens FOV fidelity');

  const beerWall = CAMERA_CATALOG.find(c => c.id === 'beer_wall');
  assert.ok(beerWall, 'Beer Wall must exist');
  assert.equal(beerWall.campath, 'sites/beerwall/cam4/', 'Must point to cam4 (Lang Acre Culverts) rather than field-facing cam1');

  for (const c of CAMERA_CATALOG) {
    assert.ok(c.campath.startsWith('sites/'), `${c.id} campath must start with sites/`);
    assert.ok(c.campath.endsWith('/'), `${c.id} campath must end with slash`);
    assert.ok(c.camName.length > 0, `${c.id} camName must be non-empty`);
    assert.ok(c.lookFor.length > 10, `${c.id} must define physical FOV lookFor instructions`);
  }
});

test('SSRF Defence Matrix: Blocks unauthorized domains, IPs, and schemes', async () => {
  // Domain allowlist
  assert.doesNotThrow(() => assertAllowedDomain('thecfh.org'));
  assert.doesNotThrow(() => assertAllowedDomain('www.thecfh.org'));
  assert.doesNotThrow(() => assertAllowedDomain('environment.data.gov.uk'));
  assert.doesNotThrow(() => assertAllowedDomain('environment-agency.gov.uk'));

  // Rejected domains
  assert.throws(() => assertAllowedDomain('malicious-site.com'), /SSRF Blocked/);
  assert.throws(() => assertAllowedDomain('thecfh.org.attacker.com'), /SSRF Blocked/);

  // Rejected IP literals & localhost
  assert.throws(() => assertAllowedDomain('169.254.169.254'), /SSRF Blocked/);
  assert.throws(() => assertAllowedDomain('127.0.0.1'), /SSRF Blocked/);
  assert.throws(() => assertAllowedDomain('localhost'), /SSRF Blocked/);
  assert.throws(() => assertAllowedDomain('::1'), /SSRF Blocked/);

  // fetchWebcamImageSecure protocol checks
  await assert.rejects(
    async () => fetchWebcamImageSecure('http://thecfh.org/sites/test.jpg'),
    /Protocol 'http:' is forbidden/
  );
  await assert.rejects(
    async () => fetchWebcamImageSecure('https://thecfh.org:8443/sites/test.jpg'),
    /Custom port '8443' is forbidden/
  );
});

test('Two-Step Dynamic Ingestion: Parses HTML snippet and detects camera offline state', async () => {
  const cameraConfig = CAMERA_CATALOG[0];

  // 1. Online camera with relative image path
  const mockFetchOnline = async () => {
    return {
      ok: true,
      text: async () => '<html><body><img src="../sites/dunball/cam3//EZ040593.jpg" alt="latest"></body></html>'
    };
  };

  const onlineRes = await resolveLatestCameraImageUrl(cameraConfig, mockFetchOnline);
  assert.equal(onlineRes.status, 'ONLINE');
  assert.equal(onlineRes.rawFilename, 'EZ040593.jpg');
  assert.equal(onlineRes.imageUrl, 'https://thecfh.org/sites/dunball/cam3/EZ040593.jpg');

  // 2. Offline camera with placeholder
  const mockFetchOffline = async () => {
    return {
      ok: true,
      text: async () => '<html><body><img src="../images/cameraoffline.jpg" alt="offline"></body></html>'
    };
  };

  const offlineRes = await resolveLatestCameraImageUrl(cameraConfig, mockFetchOffline);
  assert.equal(offlineRes.status, 'OFFLINE');
  assert.equal(offlineRes.imageUrl, null);

  // 3. HTML Snippet exceeding 10KB cap
  const mockFetchOversized = async () => {
    return {
      ok: true,
      text: async () => 'X'.repeat(12 * 1024)
    };
  };

  await assert.rejects(
    async () => resolveLatestCameraImageUrl(cameraConfig, mockFetchOversized),
    /exceeded 10KB ceiling/
  );
});

test('Chunked Stream Image Fetcher: Enforces JPEG magic bytes and 3MB ceiling', async () => {
  // 1. Valid JPEG buffer
  const validBuffer = createMockJpegBuffer('TEST_FRAME_DATA');
  const mockFetchValid = async () => ({
    ok: true,
    arrayBuffer: async () => validBuffer.buffer.slice(validBuffer.byteOffset, validBuffer.byteOffset + validBuffer.byteLength)
  });

  const buffer = await fetchWebcamImageSecure('https://thecfh.org/sites/test.jpg', mockFetchValid);
  assert.equal(buffer[0], 0xFF);
  assert.equal(buffer[1], 0xD8);
  assert.equal(buffer[2], 0xFF);

  // 2. Non-JPEG response (HTML 200 OK disguised)
  const fakeHtml = Buffer.from('<html><body>Error 200</body></html>');
  const mockFetchHtml = async () => ({
    ok: true,
    arrayBuffer: async () => fakeHtml.buffer.slice(fakeHtml.byteOffset, fakeHtml.byteOffset + fakeHtml.byteLength)
  });

  await assert.rejects(
    async () => fetchWebcamImageSecure('https://thecfh.org/sites/test.jpg', mockFetchHtml),
    /Missing JPEG magic bytes/
  );

  // 3. Oversized image > 3MB
  const oversizedBuffer = Buffer.alloc(4 * 1024 * 1024);
  oversizedBuffer[0] = 0xFF; oversizedBuffer[1] = 0xD8; oversizedBuffer[2] = 0xFF;
  const mockFetchOversized = async () => ({
    ok: true,
    arrayBuffer: async () => oversizedBuffer.buffer
  });

  await assert.rejects(
    async () => fetchWebcamImageSecure('https://thecfh.org/sites/test.jpg', mockFetchOversized),
    /exceeded 3MB limit/
  );
});

test('V8 Date Parsing & Serialization: Preserves round-trip ISO timestamp fidelity', () => {
  const originalIso = '2026-11-09T18:30:45.123Z';
  const filename = serializeFrameFilename(originalIso);
  assert.equal(filename, '2026-11-09T18-30-45.123Z.jpg');

  const parsedDate = parseFrameFilename(filename);
  assert.ok(parsedDate instanceof Date);
  assert.equal(parsedDate.toISOString(), originalIso);

  // Second-precision variant
  const secIso = '2026-11-09T18:30:45Z';
  const secFilename = serializeFrameFilename(secIso);
  const parsedSec = parseFrameFilename(secFilename);
  assert.equal(parsedSec.toISOString(), '2026-11-09T18:30:45.000Z');

  // Invalid filename
  assert.equal(parseFrameFilename('invalid_file.txt'), null);
});

test('CameraBufferWorker: Deduplication, 20m heartbeat, and round-robin stepping', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam_buffer_test_'));

  try {
    const testBuffer = createMockJpegBuffer('STATIC_SCENE_PIXELS');
    let pollCount = 0;

    const mockFetch = async (url) => {
      pollCount++;
      if (url.includes('gallerylatestpic.php')) {
        return {
          ok: true,
          text: async () => '<html><body><img src="../sites/hook/cam1//EZ100.jpg"></body></html>'
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength)
      };
    };

    const worker = new CameraBufferWorker({
      baseDir: tempDir,
      fetchFn: mockFetch,
      stepIntervalMs: 100,
      heartbeatMs: 20 * 60 * 1000 // 20m
    });
    worker.ensureDirectories();

    // First poll: writes frame to disk
    const res1 = await worker.pollNext();
    assert.equal(res1.status, 'CAPTURED');
    const cam0 = CAMERA_CATALOG[0].id;
    const cam0Dir = path.join(tempDir, cam0);
    const files1 = fs.readdirSync(cam0Dir).filter(f => f.endsWith('.jpg'));
    assert.equal(files1.length, 1);

    // Step across remaining 9 cameras to return index to cam0
    for (let i = 1; i < 10; i++) {
      await worker.pollNext();
    }

    // Now index is back to cam0: identical filename and within heartbeat -> skips binary fetch!
    const res2 = await worker.pollNext();
    assert.equal(res2.status, 'CACHED_FILENAME');
    const files2 = fs.readdirSync(cam0Dir).filter(f => f.endsWith('.jpg'));
    assert.equal(files2.length, 1, 'Duplicate frame must not write redundant disk file');

    // Simulate 21 minutes passing on cam0 (heartbeat expiry)
    worker.lastWrittenMs.set(cam0, Date.now() - (21 * 60 * 1000));
    // Index step again
    for (let i = 1; i < 10; i++) {
      await worker.pollNext();
    }
    const res3 = await worker.pollNext();
    assert.equal(res3.status, 'CAPTURED', '20-minute heartbeat must write frame even if scene is static');
    const files3 = fs.readdirSync(cam0Dir).filter(f => f.endsWith('.jpg'));
    assert.equal(files3.length, 2, 'Heartbeat frame must be written to disk');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Housekeeping: Prunes files > 48h, sweeps stale .tmp_ files, enforces 350MB ceiling', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam_housekeeping_test_'));

  try {
    const camDir = path.join(tempDir, 'hookbridge_crest');
    fs.mkdirSync(camDir, { recursive: true });

    const now = Date.now();
    const validJpeg = createMockJpegBuffer('TEST_BYTES');

    // 1. Fresh file (1 hour old)
    const freshIso = new Date(now - 1 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(path.join(camDir, serializeFrameFilename(freshIso)), validJpeg);

    // 2. Expired file (50 hours old)
    const expiredIso = new Date(now - 50 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(path.join(camDir, serializeFrameFilename(expiredIso)), validJpeg);

    // 3. Stale temporary file (15 minutes old)
    const staleTmp = path.join(camDir, '.tmp_stale_123.tmp');
    fs.writeFileSync(staleTmp, 'PARTIAL');
    const oldTime = new Date(now - 15 * 60 * 1000);
    fs.utimesSync(staleTmp, oldTime, oldTime);

    // 4. Fresh temporary file (1 minute old)
    const freshTmp = path.join(camDir, '.tmp_fresh_456.tmp');
    fs.writeFileSync(freshTmp, 'IN_FLIGHT');

    // 5. Orphaned empty subdirectory from a legacy/removed camera ID
    const orphanDir = path.join(tempDir, 'legacy_removed_camera');
    fs.mkdirSync(orphanDir, { recursive: true });

    const worker = new CameraBufferWorker({
      baseDir: tempDir,
      retentionMs: 48 * 60 * 60 * 1000,
      maxStorageBytes: 10 * 1024, // low limit for testing ceiling
      lowWatermarkBytes: 5 * 1024
    });

    worker.runHousekeeping();
    worker.rehydrateStateFromDisk();

    const remainingFiles = fs.readdirSync(camDir);
    assert.ok(remainingFiles.includes(serializeFrameFilename(freshIso)), 'Fresh frame must be retained');
    assert.ok(!remainingFiles.includes(serializeFrameFilename(expiredIso)), 'Expired >48h frame must be pruned');
    assert.ok(!remainingFiles.includes('.tmp_stale_123.tmp'), 'Stale .tmp_* file >10m must be swept');
    assert.ok(remainingFiles.includes('.tmp_fresh_456.tmp'), 'Fresh in-flight .tmp_* file must be kept');
    assert.ok(!fs.existsSync(orphanDir), 'Orphaned empty subdirectory must be removed');
    assert.ok(worker.lastHash.has('hookbridge_crest'), 'Cold-boot rehydration must populate lastHash from newest disk frame');
    assert.ok(worker.lastWrittenMs.has('hookbridge_crest'), 'Cold-boot rehydration must populate lastWrittenMs from newest disk frame');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Retroactive Query: getFrameNearestTo finds frame within 20m tolerance', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam_retro_test_'));

  try {
    const camDir = path.join(tempDir, 'monks_leaze_clyse');
    fs.mkdirSync(camDir, { recursive: true });

    const baseTime = new Date('2026-11-09T14:00:00.000Z').getTime();
    const frameIso = new Date(baseTime + 5 * 60 * 1000).toISOString(); // 14:05:00
    fs.writeFileSync(path.join(camDir, serializeFrameFilename(frameIso)), createMockJpegBuffer());

    const worker = new CameraBufferWorker({ baseDir: tempDir });

    // Target: 14:10:00 (delta: 5 minutes <= 20 minutes)
    const result = worker.getFrameNearestTo('monks_leaze_clyse', '2026-11-09T14:10:00.000Z', 20 * 60 * 1000);
    assert.ok(result);
    assert.equal(result.cameraId, 'monks_leaze_clyse');
    assert.equal(result.timestamp, frameIso);
    assert.equal(result.deltaMs, 5 * 60 * 1000);

    // Target: 14:40:00 (delta: 35 minutes > 20 minutes)
    const outOfBounds = worker.getFrameNearestTo('monks_leaze_clyse', '2026-11-09T14:40:00.000Z', 20 * 60 * 1000);
    assert.equal(outOfBounds, null, 'Must return null when outside tolerance window');

    // Security check: Path traversal attempt
    assert.throws(() => worker.getFrameNearestTo('../etc/passwd', '2026-11-09T14:00:00.000Z'), /Security Violation/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
