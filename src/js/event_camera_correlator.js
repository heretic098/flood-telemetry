/**
 * Retroactive Event Keyframe Correlator & Forensic Archival (Phase 2 / Issue #23)
 *
 * Correlates lagged Environment Agency telemetry state transitions (EVENT_START,
 * EVENT_PEAK, EVENT_END) against the 48-hour rolling webcam ring buffer
 * (`CameraBufferWorker`) within a ±20-minute tolerance window, promotes the
 * 3 critical keyframes plus the ±60m transition sequence directly to Fly Tigris S3
 * (`TigrisArchiveStore`), and links the audit record in SQLite (`camera_analysis` <->
 * `telemetry_events.camera_snapshot_id`).
 *
 * Governing Invariants:
 * - [RULE-ENT-01] Canonical tripartite entity alignment (`asset_type -> asset_id -> status`)
 * - [RULE-CAM-01] Optical camera ground-truth field-of-view fidelity
 * - [RULE-SEC-02] Zero hardcoded or leaked S3 bucket names
 * - [RULE-INFRA-01] Zero archival writes to the local `/data` SQLite NVMe volume
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import {
  CAMERA_CATALOG,
  computeBufferHash
} from './api/camera_buffer.js';
import {
  isDaylight,
  computeSolarElevationDeg
} from './api/ai_vision_client.js';
import { TigrisArchiveStore } from './api/tigris_archive.js';
import { updateActiveSessionCameraMeta } from './event_manager.js';

export const DEFAULT_KEYFRAME_TOLERANCE_MS = 20 * 60 * 1000; // ±20 minutes
export const DEFAULT_SEQUENCE_HALF_WINDOW_MS = 60 * 60 * 1000; // ±60 minutes
export const DEFAULT_DARK_LUMINANCE_THRESHOLD = 20; // 0..255 mean scan byte threshold

/**
 * Maps canonical `asset_id` definitions from `ASSET_DEFINITIONS` to an ordered
 * priority list of candidate `cameraId`s in `CAMERA_CATALOG`.
 */
export const ASSET_CAMERA_MAP = Object.freeze({
  // Tidal Gate & Estuarine Outfall
  dunball_outfall: Object.freeze([
    'dunball_northern_flap',
    'dunball_southern_flap',
    'dunball_ksd_approach',
    'dunball_pump_pipework'
  ]),
  '52163': Object.freeze(['dunball_northern_flap', 'dunball_southern_flap']),
  E9094: Object.freeze(['dunball_ksd_approach', 'dunball_northern_flap']),

  // River Tone & Curry Moor System
  hookbridge: Object.freeze(['hookbridge_crest', 'stanmoor_ps']),
  '52118': Object.freeze(['hookbridge_crest', 'stanmoor_ps']),
  curry_moor: Object.freeze(['currymoor_ps', 'stanmoor_ps', 'west_sedgemoor_ps']),
  '52127': Object.freeze(['currymoor_ps', 'stanmoor_ps', 'west_sedgemoor_ps']),
  cuts_road: Object.freeze(['athelney_spillway', 'athelney_gauge', 'east_lyng_cutting']),
  new_road_curry: Object.freeze(['currymoor_ps', 'athelney_spillway']),
  stan_moor_road: Object.freeze(['stanmoor_ps', 'hookbridge_crest']),

  // River Parrett, Baltmoor Wall & Northmoor System
  baltmoor_wall: Object.freeze(['baltmoor_wall', 'saltmoor_river']),
  '52158': Object.freeze(['baltmoor_wall', 'saltmoor_river']),
  a361_burrowbridge: Object.freeze(['baltmoor_wall', 'saltmoor_river', 'athelney_spillway']),
  northmoor: Object.freeze(['northmoor_ps', 'northmoor_drain', 'saltmoor_drain', 'westonzoyland_ps']),
  '52159': Object.freeze(['northmoor_ps', 'northmoor_drain', 'saltmoor_drain', 'westonzoyland_ps']),
  moorland_new_cut_road: Object.freeze(['northmoor_drain', 'northmoor_ps', 'saltmoor_drain']),

  // Sowy Relief Channel & Monk's Leaze / Beer Wall
  monks_leaze_clyse: Object.freeze(['monks_leaze_clyse', 'allermoor_spillway', 'oath_lock_sluice']),
  '52233': Object.freeze(['monks_leaze_clyse', 'allermoor_spillway']),
  '52234': Object.freeze(['monks_leaze_clyse', 'allermoor_spillway']),
  beer_wall: Object.freeze(['beer_wall', 'beer_wall_sluice_gb', 'beazeley_spillway']),
  beer_wall_a372: Object.freeze(['beer_wall', 'beer_wall_sluice_gb', 'beazeley_spillway']),
  '52157': Object.freeze(['beer_wall', 'beer_wall_sluice_gb']),

  // River Yeo & Isle / Muchelney
  muchelney_access: Object.freeze(['huish_episcopi_ps', 'midelney_ps']),
  bicknells_bridge_access: Object.freeze(['huish_episcopi_ps', 'midelney_ps']),
  '52120': Object.freeze(['huish_episcopi_ps', 'midelney_ps']),
  '52153': Object.freeze(['midelney_ps', 'huish_episcopi_ps'])
});

const CAMERA_BY_ID = new Map(CAMERA_CATALOG.map(c => [c.id, c]));

/**
 * Returns ordered candidate camera IDs for an assetId.
 * @param {string} assetId
 * @param {string|null} [preferredCameraId=null]
 * @returns {Array<string>}
 */
export function resolveCandidateCamerasForAsset(assetId, preferredCameraId = null) {
  const mapped = ASSET_CAMERA_MAP[assetId] ? [...ASSET_CAMERA_MAP[assetId]] : [];

  // Also include any camera in CAMERA_CATALOG whose chokePoint matches assetId
  for (const cam of CAMERA_CATALOG) {
    if (cam.chokePoint === assetId && !mapped.includes(cam.id)) {
      mapped.push(cam.id);
    }
  }

  if (preferredCameraId && CAMERA_BY_ID.has(preferredCameraId)) {
    return [preferredCameraId, ...mapped.filter(id => id !== preferredCameraId)];
  }

  return mapped;
}

/**
 * Computes a deterministic luminance proxy score (0..255) from a JPEG binary buffer.
 * Inspects entropy-coded scan bytes after the Start-Of-Scan (0xFF 0xDA) marker if present,
 * or payload bytes after the JPEG SOI header (0xFF 0xD8 0xFF).
 *
 * @param {Buffer} buffer
 * @returns {number}
 */
export function computeFrameLuminance(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 4) return 0;

  // Locate Start-Of-Scan (0xFF 0xDA) marker if present
  let startOffset = 3;
  for (let i = 2; i < buffer.length - 4; i++) {
    if (buffer[i] === 0xFF && buffer[i + 1] === 0xDA) {
      const headerLen = (buffer[i + 2] << 8) | buffer[i + 3];
      if (i + 2 + headerLen < buffer.length - 2) {
        startOffset = i + 2 + headerLen;
      }
      break;
    }
  }

  const endOffset = (buffer[buffer.length - 2] === 0xFF && buffer[buffer.length - 1] === 0xD9)
    ? buffer.length - 2
    : buffer.length;

  const span = endOffset - startOffset;
  if (span <= 0) return 0;

  // Sample up to 4096 bytes evenly across the scan data
  const step = Math.max(1, Math.floor(span / 4096));
  let sum = 0;
  let count = 0;
  for (let i = startOffset; i < endOffset; i += step) {
    sum += buffer[i];
    count++;
  }

  return count > 0 ? Number((sum / count).toFixed(1)) : 0;
}

/**
 * Evaluates whether a captured frame occurred in darkness (civil night or pitch-black sensor output).
 * If darkness is detected, returns `fallback_mode: 'NIGHT_TELEMETRY'`.
 *
 * @param {Buffer} buffer
 * @param {string|Date} timestamp
 * @param {object} [options]
 * @returns {{isDark: boolean, isDaylight: boolean, solarElevationDeg: number, luminance: number, fallback_mode: 'NIGHT_TELEMETRY'|null}}
 */
export function evaluateFrameDarkness(buffer, timestamp, options = {}) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const lat = options.lat ?? 51.05;
  const lon = options.lon ?? -2.95;
  const darkLuminanceThreshold = options.darkLuminanceThreshold ?? DEFAULT_DARK_LUMINANCE_THRESHOLD;

  const solarElevationDeg = Number(computeSolarElevationDeg(date, lat, lon).toFixed(2));
  const daylight = isDaylight(date, lat, lon);
  const luminance = computeFrameLuminance(buffer);

  const isDark = !daylight || luminance < darkLuminanceThreshold;

  return {
    isDark,
    isDaylight: daylight,
    solarElevationDeg,
    luminance,
    fallback_mode: isDark ? 'NIGHT_TELEMETRY' : null
  };
}

/**
 * Searches candidate cameras for an asset to find the nearest frame within `toleranceMs`.
 *
 * @param {import('./api/camera_buffer.js').CameraBufferWorker} bufferWorker
 * @param {string} assetId
 * @param {string} targetIso
 * @param {object} [options]
 * @returns {{cameraId: string, filename: string, filePath: string, timestamp: string, deltaMs: number}|null}
 */
export function findNearestFrameForAsset(bufferWorker, assetId, targetIso, options = {}) {
  if (!bufferWorker || typeof bufferWorker.getFrameNearestTo !== 'function') return null;

  const toleranceMs = options.toleranceMs ?? DEFAULT_KEYFRAME_TOLERANCE_MS;
  const candidates = resolveCandidateCamerasForAsset(assetId, options.preferredCameraId || null);

  for (const cameraId of candidates) {
    try {
      const match = bufferWorker.getFrameNearestTo(cameraId, targetIso, toleranceMs);
      if (match && match.filePath && fs.existsSync(match.filePath)) {
        return match;
      }
    } catch (err) {
      // Continue to next candidate camera
    }
  }

  return null;
}

/**
 * Parses `analysis_json` safely or returns a fresh manifest scaffold.
 */
function parseOrInitManifest(existingJson, eventRecord, cameraConfig) {
  if (existingJson && typeof existingJson === 'string') {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && typeof parsed === 'object') {
        parsed.keyframes = parsed.keyframes || { start: null, peak: null, end: null };
        parsed.sequence_frames = Array.isArray(parsed.sequence_frames) ? parsed.sequence_frames : [];
        parsed.windows_complete = parsed.windows_complete || { start_plus_60m: false, end_plus_60m: false };
        return parsed;
      }
    } catch (e) {}
  }

  return {
    event_id: Number(eventRecord.id),
    asset_type: eventRecord.asset_type,
    asset_id: eventRecord.asset_id,
    camera_id: cameraConfig.id,
    camera_name: cameraConfig.name,
    camera_description: cameraConfig.description,
    camera_look_for: cameraConfig.lookFor,
    storage_backend: null,
    keyframes: {
      start: null,
      peak: null,
      end: null
    },
    sequence_frames: [],
    windows_complete: {
      start_plus_60m: false,
      end_plus_60m: false
    }
  };
}

/**
 * Uploads any new frames within `[centerMs - halfWindowMs, centerMs + halfWindowMs]`
 * from the rolling buffer to Tigris S3 and merges them into `manifest.sequence_frames`.
 */
async function archiveWindowSequence({
  bufferWorker,
  archiveStore,
  eventId,
  cameraId,
  centerIso,
  halfWindowMs,
  manifest
}) {
  const centerMs = new Date(centerIso).getTime();
  if (isNaN(centerMs)) return { uploadedCount: 0, windowComplete: false };

  const startIso = new Date(centerMs - halfWindowMs).toISOString();
  const endIso = new Date(centerMs + halfWindowMs).toISOString();

  const windowFrames = bufferWorker.getFramesInWindow(cameraId, startIso, endIso);
  const existingFilenames = new Set(manifest.sequence_frames.map(f => f.filename));

  let uploadedCount = 0;
  for (const frame of windowFrames) {
    if (existingFilenames.has(frame.filename)) continue;
    if (!fs.existsSync(frame.filePath)) continue;

    const buf = fs.readFileSync(frame.filePath);
    const uploadRes = await archiveStore.uploadFrame(eventId, cameraId, frame.filename, buf);
    manifest.storage_backend = uploadRes.backend;
    manifest.sequence_frames.push({
      timestamp: frame.timestamp,
      filename: frame.filename,
      image_url: uploadRes.proxyUrl,
      size_bytes: uploadRes.sizeBytes
    });
    existingFilenames.add(frame.filename);
    uploadedCount++;
  }

  manifest.sequence_frames.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const windowComplete = Date.now() >= (centerMs + halfWindowMs);
  return { uploadedCount, windowComplete };
}

/**
 * Correlates a specific event transition phase (`EVENT_START`, `EVENT_PEAK`, `EVENT_END`),
 * promotes the matched keyframe and (for daylight transitions) the ±60m frame sequence to
 * Tigris S3, and links `telemetry_events.camera_snapshot_id` to `camera_analysis.id`.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} eventRecord - Row or decision object with `id`, `asset_id`, `asset_type`, `start_time`, `peak_time`, `end_time`
 * @param {'EVENT_START'|'EVENT_PEAK'|'EVENT_END'} phase
 * @param {object} [options]
 * @param {import('./api/camera_buffer.js').CameraBufferWorker} options.bufferWorker
 * @param {TigrisArchiveStore} [options.archiveStore]
 * @param {number} [options.toleranceMs=1200000]
 * @param {number} [options.sequenceHalfWindowMs=3600000]
 * @returns {Promise<object>}
 */
export async function correlateEventTransition(db, eventRecord, phase, options = {}) {
  const bufferWorker = options.bufferWorker;
  if (!db || !eventRecord || !eventRecord.id || !bufferWorker) {
    return { matched: false, reason: 'MISSING_CONTEXT' };
  }

  const archiveStore = options.archiveStore || new TigrisArchiveStore(options);
  const toleranceMs = options.toleranceMs ?? DEFAULT_KEYFRAME_TOLERANCE_MS;
  const sequenceHalfWindowMs = options.sequenceHalfWindowMs ?? DEFAULT_SEQUENCE_HALF_WINDOW_MS;

  const eventId = Number(eventRecord.id);
  const dbEvent = db.prepare('SELECT * FROM telemetry_events WHERE id = ?').get(eventId) || eventRecord;

  const targetIso = phase === 'EVENT_END'
    ? (eventRecord.end_time || dbEvent.end_time)
    : (phase === 'EVENT_PEAK'
      ? (eventRecord.peak_time || dbEvent.peak_time || dbEvent.start_time)
      : (eventRecord.start_time || dbEvent.start_time));

  if (!targetIso) {
    return { matched: false, reason: 'MISSING_TARGET_TIMESTAMP' };
  }

  const match = findNearestFrameForAsset(bufferWorker, dbEvent.asset_id, targetIso, {
    toleranceMs,
    preferredCameraId: dbEvent.camera_id || null
  });

  if (!match) {
    return { matched: false, reason: 'NO_FRAME_IN_WINDOW', asset_id: dbEvent.asset_id, phase, targetIso };
  }

  const cameraConfig = CAMERA_BY_ID.get(match.cameraId);
  const frameBuffer = fs.readFileSync(match.filePath);
  const imageHash = computeBufferHash(frameBuffer);
  const darkness = evaluateFrameDarkness(frameBuffer, match.timestamp, options);

  // 1. Promote keyframe to permanent Tigris S3 storage
  const keyframeUpload = await archiveStore.uploadFrame(eventId, match.cameraId, match.filename, frameBuffer);

  // 2. Load existing camera_analysis record if linked
  let existingAnalysis = null;
  if (dbEvent.camera_snapshot_id) {
    existingAnalysis = db.prepare('SELECT * FROM camera_analysis WHERE id = ?').get(dbEvent.camera_snapshot_id);
  }

  const manifest = parseOrInitManifest(existingAnalysis?.analysis_json, dbEvent, cameraConfig);
  manifest.storage_backend = keyframeUpload.backend;

  const keyframeSlot = phase === 'EVENT_END' ? 'end' : (phase === 'EVENT_PEAK' ? 'peak' : 'start');
  const keyframeEntry = {
    phase,
    timestamp: match.timestamp,
    target_timestamp: targetIso,
    delta_ms: match.deltaMs,
    filename: match.filename,
    image_url: keyframeUpload.proxyUrl,
    image_hash: imageHash,
    size_bytes: keyframeUpload.sizeBytes,
    is_daylight: darkness.isDaylight,
    solar_elevation_deg: darkness.solarElevationDeg,
    luminance: darkness.luminance,
    fallback_mode: darkness.fallback_mode
  };

  manifest.keyframes[keyframeSlot] = keyframeEntry;

  // If EVENT_START and peak is not yet populated (e.g. peak_time === start_time), seed peak keyframe
  if (keyframeSlot === 'start' && !manifest.keyframes.peak) {
    manifest.keyframes.peak = { ...keyframeEntry, phase: 'EVENT_PEAK' };
  }

  // Ensure the promoted keyframe is also included in sequence_frames if daylight
  if (!darkness.isDark) {
    delete manifest.sequence_skipped_reason;
    if (keyframeSlot === 'start' || keyframeSlot === 'end') {
      const seqRes = await archiveWindowSequence({
        bufferWorker,
        archiveStore,
        eventId,
        cameraId: match.cameraId,
        centerIso: targetIso,
        halfWindowMs: sequenceHalfWindowMs,
        manifest
      });
      if (keyframeSlot === 'start') {
        manifest.windows_complete.start_plus_60m = seqRes.windowComplete;
      } else if (keyframeSlot === 'end') {
        manifest.windows_complete.end_plus_60m = seqRes.windowComplete;
      }
    } else {
      // Ensure peak keyframe is present in sequence_frames as well
      const hasPeakInSeq = manifest.sequence_frames.some(f => f.filename === match.filename);
      if (!hasPeakInSeq) {
        manifest.sequence_frames.push({
          timestamp: match.timestamp,
          filename: match.filename,
          image_url: keyframeUpload.proxyUrl,
          size_bytes: keyframeUpload.sizeBytes
        });
        manifest.sequence_frames.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }
    }
  } else {
    // Mark the specific dark window complete so backfill skips only the dark transition window
    if (keyframeSlot === 'start') {
      manifest.windows_complete.start_plus_60m = true;
    } else if (keyframeSlot === 'end') {
      manifest.windows_complete.end_plus_60m = true;
    }
    if (manifest.sequence_frames.length === 0) {
      manifest.sequence_skipped_reason = 'NIGHT_TELEMETRY';
    }
  }

  // 3. Upload updated event manifest to Tigris S3
  await archiveStore.uploadManifest(eventId, manifest);

  // 4. Persist audit record in SQLite (`camera_analysis`) and join to `telemetry_events`
  const serializedManifest = JSON.stringify(manifest);
  let snapshotId = existingAnalysis?.id || null;

  // Determine aggregate fallback_mode: if any keyframe is daylight, clear NIGHT_TELEMETRY override on primary row;
  // if current keyframe is dark and no daylight keyframe exists, set NIGHT_TELEMETRY.
  const anyDaylightKeyframe = Object.values(manifest.keyframes)
    .filter(Boolean)
    .some(kf => kf.fallback_mode === null);
  const resolvedFallbackMode = anyDaylightKeyframe ? null : darkness.fallback_mode;

  const tx = db.transaction(() => {
    if (!snapshotId) {
      const info = db.prepare(`
        INSERT INTO camera_analysis (
          camera_id, image_hash, image_url, fetched_at,
          ai_evaluated, analysis_json, trigger_reason, fallback_mode
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        match.cameraId,
        imageHash,
        keyframeUpload.proxyUrl,
        match.timestamp,
        serializedManifest,
        phase,
        resolvedFallbackMode
      );
      snapshotId = Number(info.lastInsertRowid);
    } else {
      db.prepare(`
        UPDATE camera_analysis
        SET image_hash = ?,
            image_url = ?,
            fetched_at = ?,
            analysis_json = ?,
            trigger_reason = ?,
            fallback_mode = ?
        WHERE id = ?
      `).run(
        imageHash,
        keyframeUpload.proxyUrl,
        match.timestamp,
        serializedManifest,
        phase,
        resolvedFallbackMode,
        snapshotId
      );
    }

    db.prepare(`
      UPDATE telemetry_events
      SET camera_id = ?, image_hash = ?, camera_snapshot_id = ?
      WHERE id = ?
    `).run(match.cameraId, imageHash, snapshotId, eventId);
  });

  tx();

  updateActiveSessionCameraMeta(dbEvent.asset_id, {
    camera_id: match.cameraId,
    image_hash: imageHash,
    camera_snapshot_id: snapshotId
  });

  return {
    matched: true,
    event_id: eventId,
    phase,
    camera_id: match.cameraId,
    camera_snapshot_id: snapshotId,
    filename: match.filename,
    image_url: keyframeUpload.proxyUrl,
    image_hash: imageHash,
    delta_ms: match.deltaMs,
    fallback_mode: resolvedFallbackMode,
    storage_backend: keyframeUpload.backend,
    sequence_count: manifest.sequence_frames.length
  };
}

/**
 * Processes an array of state-transition decisions emitted by `processTelemetryEvents()`
 * and correlates `EVENT_START`, `EVENT_PEAK`, and `EVENT_END` keyframes.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<object>} decisions
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function correlateEventDecisions(db, decisions, options = {}) {
  if (!Array.isArray(decisions) || decisions.length === 0 || !options.bufferWorker) {
    return [];
  }

  const results = [];
  for (const d of decisions) {
    if (!d || d.action === 'NONE' || !d.event_id) continue;

    try {
      if (d.action === 'OPEN') {
        const startRes = await correlateEventTransition(db, {
          id: d.event_id,
          asset_type: d.asset_type,
          asset_id: d.asset_id,
          start_time: d.start_time,
          peak_time: d.peak_time || d.start_time
        }, 'EVENT_START', options);
        results.push(startRes);

        if (d.peak_time && d.peak_time !== d.start_time) {
          const peakRes = await correlateEventTransition(db, {
            id: d.event_id,
            asset_type: d.asset_type,
            asset_id: d.asset_id,
            start_time: d.start_time,
            peak_time: d.peak_time
          }, 'EVENT_PEAK', options);
          results.push(peakRes);
        }
      } else if (d.action === 'UPDATE' && d.peak_time_changed) {
        const peakRes = await correlateEventTransition(db, {
          id: d.event_id,
          asset_type: d.asset_type,
          asset_id: d.asset_id,
          peak_time: d.peak_time
        }, 'EVENT_PEAK', options);
        results.push(peakRes);
      } else if (d.action === 'CLOSE') {
        if (d.peak_time_changed) {
          const peakRes = await correlateEventTransition(db, {
            id: d.event_id,
            asset_type: d.asset_type,
            asset_id: d.asset_id,
            peak_time: d.peak_time
          }, 'EVENT_PEAK', options);
          results.push(peakRes);
        }
        const endRes = await correlateEventTransition(db, {
          id: d.event_id,
          asset_type: d.asset_type,
          asset_id: d.asset_id,
          end_time: d.end_time
        }, 'EVENT_END', options);
        results.push(endRes);
      }
    } catch (err) {
      console.warn(`[Correlator Warning] Failed transition for asset '${d.asset_id}' (event ${d.event_id}):`, err.message);
      results.push({
        matched: false,
        reason: 'ERROR',
        asset_id: d.asset_id,
        event_id: d.event_id,
        error: err.message
      });
    }
  }

  return results;
}

/**
 * Follow-up sweep for events from the last 48 hours whose post-transition `+60m` sequence
 * window was still in progress when the event transition was first detected, or whose
 * initial/closing keyframe arrived on the next camera poll cycle.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @returns {Promise<number>} Number of events updated with additional sequence frames or keyframes
 */
export async function backfillPendingEventSequences(db, options = {}) {
  const bufferWorker = options.bufferWorker;
  if (!db || !bufferWorker) return 0;

  const archiveStore = options.archiveStore || new TigrisArchiveStore(options);
  const sequenceHalfWindowMs = options.sequenceHalfWindowMs ?? DEFAULT_SEQUENCE_HALF_WINDOW_MS;
  const cutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const recentEvents = db.prepare(`
    SELECT te.*, ca.analysis_json
    FROM telemetry_events te
    LEFT JOIN camera_analysis ca ON te.camera_snapshot_id = ca.id
    WHERE te.start_time >= ?
    ORDER BY te.start_time DESC
    LIMIT 25
  `).all(cutoffIso);

  let updatedEvents = 0;

  for (const row of recentEvents) {
    try {
      // Case 1: Event opened before camera buffer finished capturing its first frame
      if (!row.camera_snapshot_id) {
        const res = await correlateEventTransition(db, row, 'EVENT_START', options);
        if (res.matched) updatedEvents++;
        continue;
      }

      if (!row.analysis_json || !row.camera_id) continue;
      let manifest;
      try {
        manifest = JSON.parse(row.analysis_json);
      } catch (e) {
        continue;
      }

      if (!manifest) continue;
      manifest.keyframes = manifest.keyframes || { start: null, peak: null, end: null };
      manifest.windows_complete = manifest.windows_complete || { start_plus_60m: false, end_plus_60m: false };
      manifest.sequence_frames = Array.isArray(manifest.sequence_frames) ? manifest.sequence_frames : [];

      let changed = false;

      // Recover missing EVENT_END keyframe if the event closed before the end frame was buffered
      if (row.status === 'CLOSED' && row.end_time && !manifest.keyframes.end) {
        const endRes = await correlateEventTransition(db, row, 'EVENT_END', options);
        if (endRes.matched) {
          const refreshed = db.prepare('SELECT analysis_json FROM camera_analysis WHERE id = ?').get(row.camera_snapshot_id);
          if (refreshed?.analysis_json) {
            manifest = JSON.parse(refreshed.analysis_json);
            manifest.windows_complete = manifest.windows_complete || { start_plus_60m: false, end_plus_60m: false };
            manifest.sequence_frames = Array.isArray(manifest.sequence_frames) ? manifest.sequence_frames : [];
          }
          updatedEvents++;
        }
      }

      const startIsDaylight = manifest.keyframes.start && manifest.keyframes.start.fallback_mode === null;
      if (!manifest.windows_complete.start_plus_60m && row.start_time && startIsDaylight) {
        const seqRes = await archiveWindowSequence({
          bufferWorker,
          archiveStore,
          eventId: Number(row.id),
          cameraId: row.camera_id,
          centerIso: row.start_time,
          halfWindowMs: sequenceHalfWindowMs,
          manifest
        });
        if (seqRes.uploadedCount > 0 || seqRes.windowComplete !== manifest.windows_complete.start_plus_60m) {
          manifest.windows_complete.start_plus_60m = seqRes.windowComplete;
          delete manifest.sequence_skipped_reason;
          changed = true;
        }
      }

      const endIsDaylight = manifest.keyframes.end && manifest.keyframes.end.fallback_mode === null;
      if (row.status === 'CLOSED' && row.end_time && !manifest.windows_complete.end_plus_60m && endIsDaylight) {
        const seqRes = await archiveWindowSequence({
          bufferWorker,
          archiveStore,
          eventId: Number(row.id),
          cameraId: row.camera_id,
          centerIso: row.end_time,
          halfWindowMs: sequenceHalfWindowMs,
          manifest
        });
        if (seqRes.uploadedCount > 0 || seqRes.windowComplete !== manifest.windows_complete.end_plus_60m) {
          manifest.windows_complete.end_plus_60m = seqRes.windowComplete;
          delete manifest.sequence_skipped_reason;
          changed = true;
        }
      }

      if (changed) {
        await archiveStore.uploadManifest(Number(row.id), manifest);
        db.prepare('UPDATE camera_analysis SET analysis_json = ? WHERE id = ?')
          .run(JSON.stringify(manifest), row.camera_snapshot_id);
        updatedEvents++;
      }
    } catch (err) {
      console.warn(`[Correlator Backfill Warning] Failed sequence backfill for event ${row.id}:`, err.message);
    }
  }

  return updatedEvents;
}
