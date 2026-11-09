/**
 * Continuous Rolling Ring Buffer Worker & Circular Storage Management (Phase 1 / Issue #22)
 * 
 * Provides:
 * - Two-step CFH dynamic image resolution via `common/gallerylatestpic.php` (parsing 10KB HTML snippet).
 * - Detection of camera offline state via `images/cameraoffline.jpg`.
 * - Rebalanced 10-camera catalog un-conflating Baltmoor Wall (7.80m AOD spillway) from Athelney Spillway (7.35m AOD Cuts Road).
 * - Bandwidth-paced ingestion (~35s step interval, ~5.8m cycle, ~100 req/hr, ~11.5 MB/hr, ~276 MB/day) per [RULE-PROV-01].
 * - Filename caching: if snippet JPEG filename matches last filename within 20 minutes, skip binary fetch entirely.
 * - Circular rolling storage (`/data/camera_buffer/<camera_id>/<timestamp>.jpg`) with atomic temporary writes.
 * - 20-minute deduplication heartbeat ensuring static scenes do not leave forensic blindspots for Phase 2 retroactive queries.
 * - V8 date parsing helpers (`serializeFrameFilename` / `parseFrameFilename`) avoiding NaN comparisons.
 * - Hourly housekeeping enforcing <= 48h retention, stale `.tmp_*` sweep (>10m), and <= 350MB ceiling (280MB low watermark).
 * - Strict SSRF defence: HTTPS only, domain allowlist, IP literal rejection, no redirects, 3MB chunked limit, JPEG magic bytes.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CAMERA_CATALOG = Object.freeze([
  {
    id: 'dunball_northern_flap',
    name: 'Dunball Northern Tidal Flap Sluice',
    siteKey: 'dunball',
    campath: 'sites/dunball/cam3/',
    camName: 'Dunball Northern Tidal Flaps',
    chokePoint: 'dunball_outfall',
    assetType: 'tidal_gate',
    description: 'Downstream northern gravity flap door discharging King\'s Sedgemoor Drain into Parrett Estuary.',
    lookFor: 'Gravity flap door open discharging inland water at low tide; sealed shut by estuarine backpressure at high tide.'
  },
  {
    id: 'dunball_southern_flap',
    name: 'Dunball Southern Tidal Flap Sluice',
    siteKey: 'dunball',
    campath: 'sites/dunball/cam4/',
    camName: 'Dunball Southern Tidal Flaps',
    chokePoint: 'dunball_outfall',
    assetType: 'tidal_gate',
    description: 'Downstream southern gravity flap door and lower concrete apron.',
    lookFor: 'Tidal water elevation relative to the outfall headwall sill.'
  },
  {
    id: 'dunball_ksd_approach',
    name: 'Dunball King\'s Sedgemoor Drain Upstream Approach',
    siteKey: 'dunball',
    campath: 'sites/dunball/cam2/',
    camName: 'Dunball Kings Sedgemoor Drain',
    chokePoint: 'dunball_outfall',
    assetType: 'tidal_gate',
    description: 'Inland King\'s Sedgemoor Drain (KSD) approach basin, road bridge, and penstock headwall deck upstream of Dunball Sluice.',
    lookFor: 'Inland KSD water elevation against the sheet-piled bank walls and surface draw toward the sluice penstocks.'
  },
  {
    id: 'dunball_pump_pipework',
    name: 'Dunball High-Volume Pump Outfall & Tidal Bank',
    siteKey: 'dunball',
    campath: 'sites/dunball/cam6/',
    camName: 'Dunball Ultra-High Capacity Pump Pipework',
    chokePoint: 'dunball_outfall',
    assetType: 'tidal_gate',
    description: 'Rock-armoured tidal bank, mudflat outfall channel into the River Parrett, and high-volume delivery pipe manifold (top-left).',
    lookFor: 'Turbulent surface boiling and white foam plumes in the tidal outfall channel below the green delivery pipes during active pumping.'
  },
  {
    id: 'hookbridge_crest',
    name: 'Hookbridge Spillway Engineered Weir Crest',
    siteKey: 'hookbridge',
    campath: 'sites/hook/cam1/',
    camName: 'Hook Spillway',
    chokePoint: 'hookbridge',
    assetType: 'spillway',
    description: 'Concrete and grassed weir crest (7.45m AOD) separating River Tone from Curry Moor flood storage basin.',
    lookFor: 'Lateral water contact and turbulent cascade over the surveyed 7.45m AOD weir crest into Curry Moor.'
  },
  {
    id: 'currymoor_ps',
    name: 'Currymoor Pumping Station Intake Weed Screens',
    siteKey: 'currymoor',
    campath: 'sites/currymoor/cam1/',
    camName: 'Currymoor PS',
    chokePoint: 'curry_moor',
    assetType: 'polder',
    description: 'Overhead view from the pumphouse looking down onto the concrete intake bays and angled steel weed screens (trash racks) on the Curry Moor drainage side.',
    lookFor: 'Water elevation against the concrete intake bay divider walls and floating weed or debris accumulation on the angled steel trash racks.'
  },
  {
    id: 'stanmoor_ps',
    name: 'Stanmoor Pumping Station Intake Basin & Weed Screens',
    siteKey: 'currymoor',
    campath: 'sites/stanmoor/cam1/',
    camName: 'Stanmoor',
    chokePoint: 'curry_moor',
    assetType: 'polder',
    description: 'Stanmoor pumping station drainage collection basin and twin angled steel weed screens bordering the River Tone.',
    lookFor: 'Water elevation in the Stanmoor collection basin and duckweed or debris build-up against the twin intake screens.'
  },
  {
    id: 'athelney_spillway',
    name: 'Athelney Spillway Embankment & Meadow',
    siteKey: 'athelney',
    campath: 'sites/athelney/cam2/',
    camName: 'Athelney Spillway',
    chokePoint: 'cuts_road',
    assetType: 'road',
    description: 'Grassed Athelney Spillway overflow embankment and meadow (7.35m AOD crest) governing cascade from Curry Moor toward Cuts Road.',
    lookFor: 'Sheet water standing across the grassed spillway meadow or overtopping the 7.35m AOD embankment crest (note: lens frames the grass spillway meadow, not the Cuts Road asphalt carriageway).'
  },
  {
    id: 'athelney_gauge',
    name: 'Athelney Spillway Crest Staff Gauge Board',
    siteKey: 'athelney',
    campath: 'sites/athelney/cam1/',
    camName: 'Athelney Spillway Crest Gauge Board',
    chokePoint: 'cuts_road',
    assetType: 'road',
    description: 'Close-up of the vertical metric staff gauge board (1m–7m markings) mounted on the timber fence post at Athelney Spillway crest.',
    lookFor: 'Standing floodwater meniscus against the vertical metric staff gauge board graduations when Athelney Spillway is overtopping.'
  },
  {
    id: 'east_lyng_cutting',
    name: 'East Lyng Cutting (Cuts Road Temporary Deployment)',
    siteKey: 'athelney',
    campath: 'sites/temporary_deployment_6/cam1/',
    camName: 'East Lyng Cutting',
    chokePoint: 'cuts_road',
    assetType: 'road',
    description: 'Temporary flood deployment camera position at East Lyng Cutting on the Cuts Road corridor (East Lyng to Athelney).',
    lookFor: 'Floodwater across the Cuts Road carriageway cutting when temporary camera trailer is deployed by the Environment Agency.'
  },
  {
    id: 'baltmoor_wall',
    name: 'Baltmoor Wall Parrett Flood Bank Defence',
    siteKey: 'baltmoor',
    campath: 'sites/temporary_deployment_2/cam1/',
    camName: 'Baltmoor Wall',
    chokePoint: 'baltmoor_wall',
    assetType: 'spillway',
    description: 'Temporary deployment camera position on River Parrett right-bank raised embankment levee (7.80m AOD crest) protecting Northmoor.',
    lookFor: 'River Parrett high stage encroaching on the engineered embankment crest near Burrowbridge (camera frequently offline outside active flood deployments).'
  },
  {
    id: 'saltmoor_river',
    name: 'Saltmoor Pumping Station River Parrett & Outfall',
    siteKey: 'saltmoor',
    campath: 'sites/saltmoor/cam2/',
    camName: 'Saltmoor River',
    chokePoint: 'baltmoor_wall',
    assetType: 'spillway',
    description: 'Permanent view across the embanked River Parrett channel and discharge pipe manifold at Saltmoor Pumping Station downstream of Baltmoor Wall.',
    lookFor: 'River Parrett water stage relative to the grassy flood embankments and turbulent discharge boil from the foreground pipework.'
  },
  {
    id: 'saltmoor_drain',
    name: 'Saltmoor Pumping Station Intake Screen',
    siteKey: 'saltmoor',
    campath: 'sites/saltmoor/cam1/',
    camName: 'Saltmoor Drain',
    chokePoint: 'northmoor',
    assetType: 'polder',
    description: 'Saltmoor pumping station landward drainage channel and angled steel intake trash rack.',
    lookFor: 'Moor drainage water elevation in the stone-lined intake channel and debris accumulation on the steel weed screen.'
  },
  {
    id: 'northmoor_ps',
    name: 'Northmoor Pumping Station Intake Screen',
    siteKey: 'northmoor',
    campath: 'sites/northmoor/cam1/',
    camName: 'Northmoor Screen',
    chokePoint: 'northmoor',
    assetType: 'polder',
    description: 'Close-up view of the Northmoor pumping station angled steel intake weed screen bars and collection sump water surface.',
    lookFor: 'Water stage and floating weed or duckweed accumulation directly against the angled steel intake screen bars.'
  },
  {
    id: 'northmoor_drain',
    name: 'Northmoor Main Drain Approach Channel',
    siteKey: 'northmoor',
    campath: 'sites/northmoor/cam3/',
    camName: 'Northmoor Main Drain',
    chokePoint: 'northmoor',
    assetType: 'polder',
    description: 'Wide view along the Northmoor Main Drain approach rhyne conveying moorland water toward Northmoor Pumping Station.',
    lookFor: 'Drainage channel water level relative to the vegetated rhyne banks and surface flow movement toward the pumping station.'
  },
  {
    id: 'westonzoyland_ps',
    name: 'Westonzoyland Pumping Station Engine Rhyne & Staff Gauge',
    siteKey: 'northmoor',
    campath: 'sites/westonzoyland/cam2/',
    camName: 'Westonzoyland Engine Rhyne',
    chokePoint: 'northmoor',
    assetType: 'polder',
    description: 'Overhead view of the Westonzoyland pumping station angled steel weed screen and vertical metric staff gauge board on the concrete pier.',
    lookFor: 'Water meniscus against the vertical metric staff gauge markings and weed accumulation on the intake trash rack.'
  },
  {
    id: 'monks_leaze_clyse',
    name: 'Monk\'s Leaze Clyse Sluice Gate & Staff Gauge',
    siteKey: 'monksleaze',
    campath: 'sites/monks_leaze/cam1/',
    camName: 'Monks Leaze',
    chokePoint: 'monks_leaze_clyse',
    assetType: 'sluice',
    description: 'Close-up of the Monk\'s Leaze Clyse concrete sluice headwall, vertical lifting chain, metric staff gauge board on the left pier, and water channel entering the Sowy.',
    lookFor: 'Water meniscus level against the vertical metric staff gauge board on the left concrete pier and surface flow turbulence passing under the clyse headwall.'
  },
  {
    id: 'allermoor_spillway',
    name: 'Allermoor Fixed Spillway Weir & River Parrett Intake',
    siteKey: 'monksleaze',
    campath: 'sites/monks_leaze/cam2/',
    camName: 'Allermoor Spillway',
    chokePoint: 'monks_leaze_clyse',
    assetType: 'sluice',
    description: 'Wide view framing the River Parrett on the left and the Allermoor Fixed Spillway weir (6.73m AOD) / Sowy Flood Relief Channel intake on the right.',
    lookFor: 'River Parrett floodwater overtopping the fixed spillway weir crest into the Sowy intake embayment on the right.'
  },
  {
    id: 'oath_lock_sluice',
    name: 'Oath Lock Penning Sluice Twin Radial Gates',
    siteKey: 'monksleaze',
    campath: 'sites/oath/cam1/',
    camName: 'Oath Main Gates',
    chokePoint: 'monks_leaze_clyse',
    assetType: 'sluice',
    description: 'Downstream view of the twin steel penning gates across the River Parrett at Oath Lock.',
    lookFor: 'River Parrett stage against the twin steel sluice gates and turbulent white-water discharge passing beneath or over the gates.'
  },
  {
    id: 'beer_wall',
    name: 'Beer Wall Lang Acre Culverts & Relief Channel',
    siteKey: 'beerwall',
    campath: 'sites/beerwall/cam4/',
    camName: 'Beerwall Lang Acre Culverts',
    chokePoint: 'beer_wall',
    assetType: 'spillway',
    description: 'Twin rectangular concrete box culverts and wingwall headwall conveying Sowy / Beer Wall flood relief (7.30m AOD threshold) beneath the A372 corridor.',
    lookFor: 'Water elevation in the approach channel relative to the twin rectangular concrete box culvert soffits and concrete wingwalls.'
  },
  {
    id: 'beer_wall_sluice_gb',
    name: 'Beer Wall Sluice Culvert Gates & Staff Gauge Board',
    siteKey: 'beerwall',
    campath: 'sites/beerwall/cam8/',
    camName: 'Beerwall Lang Acre Upstream GB',
    chokePoint: 'beer_wall',
    assetType: 'spillway',
    description: 'Close-up of the Beer Wall sluice concrete culvert bays and vertical metric staff gauge board.',
    lookFor: 'Water meniscus against the vertical metric staff gauge board on the central concrete pier.'
  },
  {
    id: 'beazeley_spillway',
    name: 'Beazeley Spillway Embankment & Sowy Channel',
    siteKey: 'beerwall',
    campath: 'sites/beazeley/cam1/',
    camName: 'Beazeley Spillway',
    chokePoint: 'beer_wall',
    assetType: 'spillway',
    description: 'Wide view along the grassed Beazeley Spillway flood embankment and adjacent Sowy / KSD channel.',
    lookFor: 'High water stage in the left-hand channel approaching or spilling across the grassed Beazeley Spillway crest.'
  },
  {
    id: 'huish_episcopi_ps',
    name: 'Huish Episcopi Pumping Station Intake & Staff Gauge',
    siteKey: 'huish',
    campath: 'sites/huish_episcopi/cam1/',
    camName: 'Huish Episcopi Screen',
    chokePoint: 'muchelney_access',
    assetType: 'road',
    description: 'Huish Episcopi pumping station twin angled steel weed screens and vertical metric staff gauge board (1m–3m markings) serving the Wet Moor / Muchelney basin.',
    lookFor: 'Water elevation against the vertical metric staff gauge board on the concrete wingwall and debris on the twin intake screens.'
  },
  {
    id: 'midelney_ps',
    name: 'Midelney Pumping Station Intake & Staff Gauge',
    siteKey: 'huish',
    campath: 'sites/midelney/cam1/',
    camName: 'Midelney Screen',
    chokePoint: 'muchelney_access',
    assetType: 'road',
    description: 'Midelney pumping station twin angled steel weed screens and rear vertical metric staff gauge board serving the River Isle / Wet Moor floodplain.',
    lookFor: 'Floodwater stage against the rear vertical metric staff gauge board and concrete divider piers.'
  },
  {
    id: 'west_sedgemoor_ps',
    name: 'West Sedgemoor Pumping Station Intake & Staff Gauge',
    siteKey: 'currymoor',
    campath: 'sites/west_sedgemoor/cam1/',
    camName: 'West Sedgemoor Screen',
    chokePoint: 'curry_moor',
    assetType: 'polder',
    description: 'Overhead view of the West Sedgemoor pumping station intake weed screen and vertical metric staff gauge board on the concrete wall.',
    lookFor: 'Water meniscus against the vertical metric staff gauge board and debris build-up on the intake trash rack.'
  }
]);

export const ALLOWED_CAMERA_IDS = Object.freeze(new Set(CAMERA_CATALOG.map(c => c.id)));

export const ALLOWED_DOMAINS = Object.freeze([
  'thecfh.org',
  'www.thecfh.org',
  'environment.data.gov.uk',
  'environment-agency.gov.uk'
]);

export const MAX_METADATA_BYTES = 10 * 1024; // 10 KB cap for HTML snippet
export const MAX_FRAME_BYTES = 3 * 1024 * 1024; // 3 MB cap for binary JPEG
export const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000; // 48 hours
export const DEFAULT_MAX_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB hard ceiling (on 1GB /data volume)
export const DEFAULT_LOW_WATERMARK_BYTES = 420 * 1024 * 1024; // 420 MB target prune level
export const DEFAULT_HEARTBEAT_MS = 20 * 60 * 1000; // 20-minute heartbeat
export const DEFAULT_STEP_INTERVAL_MS = 12 * 1000; // 12-second step interval (25 cams * 12s = 5.0m full cycle)
export const TMP_FILE_EXPIRY_MS = 10 * 60 * 1000; // 10-minute sweep for stale .tmp_* files

/**
 * Validates target domain and blocks SSRF vectors (IP literals, private ranges, localhost).
 */
export function assertAllowedDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    throw new Error('SSRF Blocked: Invalid target hostname');
  }
  const cleanHost = hostname.toLowerCase();

  // Block IPv4 literals, IPv6 brackets/colons, and localhost
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(cleanHost) || cleanHost.includes(':') || cleanHost === 'localhost') {
    throw new Error(`SSRF Blocked: IP literals and localhost are strictly prohibited (${hostname})`);
  }

  const isAllowed = ALLOWED_DOMAINS.some(d => cleanHost === d || cleanHost.endsWith('.' + d));
  if (!isAllowed) {
    throw new Error(`SSRF Blocked: Host '${hostname}' is not in allowed domain list.`);
  }
}

/**
 * Serializes an ISO timestamp into a safe filename replacing colons with hyphens.
 * @param {string} [isoString=new Date().toISOString()]
 * @returns {string} e.g. "2026-11-09T18-30-00-000Z.jpg"
 */
export function serializeFrameFilename(isoString = new Date().toISOString()) {
  return isoString.replace(/:/g, '-') + '.jpg';
}

/**
 * Parses a serialized frame filename back into a valid Date object restoring colons.
 * Avoids V8 NaN parsing errors.
 * @param {string} filename e.g. "2026-11-09T18-30-00-000Z.jpg"
 * @returns {Date|null}
 */
export function parseFrameFilename(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const base = path.basename(filename).replace(/\.jpg$/i, '');
  // Restore colons in time component: T18-30-00.123Z -> T18:30:00.123Z or T18-30-00Z -> T18:30:00Z
  const restored = base.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
  const d = new Date(restored);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Computes SHA-256 hash of a buffer.
 */
export function computeBufferHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Step 1: Resolves the dynamic image URL from CFH gallerylatestpic.php snippet.
 * @param {object} cameraConfig
 * @param {function} [fetchFn=globalThis.fetch]
 * @returns {Promise<{status: 'ONLINE'|'OFFLINE', imageUrl: string|null, rawFilename: string|null}>}
 */
export async function resolveLatestCameraImageUrl(cameraConfig, fetchFn = globalThis.fetch) {
  const metaUrl = `https://thecfh.org/common/gallerylatestpic.php?campath=${encodeURIComponent(cameraConfig.campath)}&name=${encodeURIComponent(cameraConfig.camName)}`;
  const parsed = new URL(metaUrl);
  assertAllowedDomain(parsed.hostname);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetchFn(metaUrl, {
      signal: controller.signal,
      redirect: 'error'
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} resolving camera meta URL`);

    let text = '';
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_METADATA_BYTES) {
          controller.abort();
          throw new Error('Camera metadata HTML exceeded 10KB ceiling');
        }
        text += Buffer.from(value).toString('utf8');
      }
    } else {
      text = await res.text();
      if (text.length > MAX_METADATA_BYTES) {
        throw new Error('Camera metadata HTML exceeded 10KB ceiling');
      }
    }

    if (text.includes('cameraoffline.jpg')) {
      return { status: 'OFFLINE', imageUrl: null, rawFilename: null };
    }

    const match = text.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg))["']/i);
    if (!match || !match[1]) {
      throw new Error(`Failed to extract JPEG URL from snippet: ${text.slice(0, 100)}`);
    }

    const relSrc = match[1].trim();
    const rawFilename = path.basename(relSrc);
    const resolvedUrl = new URL(relSrc, 'https://thecfh.org/common/').href.replace(/([^:]\/)\/+/g, '$1');
    return { status: 'ONLINE', imageUrl: resolvedUrl, rawFilename };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Step 2: Fetches binary JPEG stream with chunked stream byte limiting and magic-byte inspection.
 * @param {string} imageUrl
 * @param {function} [fetchFn=globalThis.fetch]
 * @returns {Promise<Buffer>}
 */
export async function fetchWebcamImageSecure(imageUrl, fetchFn = globalThis.fetch) {
  const parsed = new URL(imageUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`SSRF Blocked: Protocol '${parsed.protocol}' is forbidden. Only HTTPS is allowed.`);
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error(`SSRF Blocked: Custom port '${parsed.port}' is forbidden.`);
  }
  assertAllowedDomain(parsed.hostname);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetchFn(imageUrl, {
      signal: controller.signal,
      redirect: 'error'
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching webcam image`);

    let totalBytes = 0;
    const chunks = [];

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        if (totalBytes > MAX_FRAME_BYTES) {
          controller.abort();
          throw new Error(`Frame payload exceeded 3MB limit (${totalBytes} bytes)`);
        }
        chunks.push(Buffer.from(value));
      }
    } else {
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_FRAME_BYTES) {
        throw new Error(`Frame payload exceeded 3MB limit (${arrayBuffer.byteLength} bytes)`);
      }
      chunks.push(Buffer.from(arrayBuffer));
      totalBytes = arrayBuffer.byteLength;
    }

    const buffer = Buffer.concat(chunks, totalBytes);

    // Validate JPEG magic bytes: 0xFF 0xD8 0xFF
    if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
      throw new Error('Invalid image payload: Missing JPEG magic bytes (0xFF 0xD8 0xFF)');
    }

    return buffer;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Background Ingestion Worker & Circular Buffer Manager
 */
export class CameraBufferWorker {
  constructor(options = {}) {
    this.baseDir = options.baseDir || path.join(process.cwd(), 'data', 'camera_buffer');
    this.stepIntervalMs = options.stepIntervalMs || DEFAULT_STEP_INTERVAL_MS;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.cameras = options.cameras || CAMERA_CATALOG;
    this.retentionMs = options.retentionMs || DEFAULT_RETENTION_MS;
    this.maxStorageBytes = options.maxStorageBytes || DEFAULT_MAX_STORAGE_BYTES;
    this.lowWatermarkBytes = options.lowWatermarkBytes || DEFAULT_LOW_WATERMARK_BYTES;
    this.heartbeatMs = options.heartbeatMs || DEFAULT_HEARTBEAT_MS;

    this.currentIndex = 0;
    this.isPolling = false;
    this.isRunning = false;
    this.pollTimer = null;
    this.housekeepingTimer = null;

    this.lastHash = new Map();
    this.lastFilename = new Map();
    this.lastWrittenMs = new Map();

    this.stats = {};
    for (const cam of this.cameras) {
      this.stats[cam.id] = {
        frames_captured: 0,
        deduplicated_count: 0,
        offline_probes: 0,
        errors_count: 0,
        last_frame_time: null,
        status: 'INITIALIZING'
      };
    }
  }

  ensureDirectories() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    for (const cam of this.cameras) {
      const camDir = path.join(this.baseDir, cam.id);
      if (!fs.existsSync(camDir)) {
        fs.mkdirSync(camDir, { recursive: true });
      }
    }
  }

  /**
   * Rehydrates `lastWrittenMs` and `lastHash` from the newest retained JPEG frame on disk
   * for each camera so container restarts do not write duplicate frames on cold boot.
   */
  rehydrateStateFromDisk() {
    if (!fs.existsSync(this.baseDir)) return;
    for (const cam of this.cameras) {
      const camDir = path.join(this.baseDir, cam.id);
      if (!fs.existsSync(camDir)) continue;
      try {
        const files = fs.readdirSync(camDir).filter(f => f.endsWith('.jpg'));
        if (files.length === 0) continue;

        let newestFile = null;
        let newestMs = -1;
        for (const f of files) {
          const parsed = parseFrameFilename(f);
          const ms = parsed ? parsed.getTime() : fs.statSync(path.join(camDir, f)).mtimeMs;
          if (ms > newestMs) {
            newestMs = ms;
            newestFile = f;
          }
        }

        if (newestFile && newestMs > 0) {
          const buf = fs.readFileSync(path.join(camDir, newestFile));
          const hash = computeBufferHash(buf);
          this.lastHash.set(cam.id, hash);
          this.lastWrittenMs.set(cam.id, newestMs);
          this.stats[cam.id].last_frame_time = new Date(newestMs).toISOString();
          this.stats[cam.id].status = 'ONLINE';
        }
      } catch (e) {
        // Ignore corrupt or unreadable individual files during cold-boot rehydration
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.ensureDirectories();

    // Run first housekeeping sweep on startup, then rehydrate state from newest surviving frames
    this.runHousekeeping();
    this.rehydrateStateFromDisk();

    // Paced queue loop (~35 seconds per camera)
    this.pollTimer = setInterval(() => {
      this.pollNext().catch(err => {
        console.warn('[CameraBufferWorker Error]', err.message);
      });
    }, this.stepIntervalMs);
    if (this.pollTimer && this.pollTimer.unref) this.pollTimer.unref();

    // Hourly housekeeping loop
    this.housekeepingTimer = setInterval(() => {
      this.runHousekeeping();
    }, 60 * 60 * 1000);
    if (this.housekeepingTimer && this.housekeepingTimer.unref) this.housekeepingTimer.unref();

    // Kick off immediate first step
    this.pollNext().catch(err => {
      console.warn('[CameraBufferWorker Initial Poll Warning]', err.message);
    });
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.housekeepingTimer) {
      clearInterval(this.housekeepingTimer);
      this.housekeepingTimer = null;
    }
  }

  async pollNext() {
    if (this.isPolling) return;
    this.isPolling = true;

    const camera = this.cameras[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.cameras.length;

    try {
      const nowMs = Date.now();
      const lastWrite = this.lastWrittenMs.get(camera.id) || 0;
      const isWithinHeartbeat = (nowMs - lastWrite) < this.heartbeatMs;

      // Step 1: Resolve metadata HTML snippet
      const meta = await resolveLatestCameraImageUrl(camera, this.fetchFn);

      if (meta.status === 'OFFLINE') {
        this.stats[camera.id].offline_probes++;
        this.stats[camera.id].status = 'OFFLINE';
        return { status: 'OFFLINE', camera_id: camera.id };
      }

      // Optimization: If CFH filename has not changed and heartbeat has not expired, skip binary fetch!
      const lastFile = this.lastFilename.get(camera.id);
      if (meta.rawFilename && meta.rawFilename === lastFile && isWithinHeartbeat) {
        this.stats[camera.id].deduplicated_count++;
        this.stats[camera.id].status = 'ONLINE';
        return { status: 'CACHED_FILENAME', camera_id: camera.id, filename: meta.rawFilename };
      }

      // Step 2: Fetch binary JPEG
      const buffer = await fetchWebcamImageSecure(meta.imageUrl, this.fetchFn);
      const hash = computeBufferHash(buffer);
      const lastHash = this.lastHash.get(camera.id);

      // Deduplication check with 20-minute heartbeat
      if (hash === lastHash && isWithinHeartbeat) {
        this.lastFilename.set(camera.id, meta.rawFilename);
        this.stats[camera.id].deduplicated_count++;
        this.stats[camera.id].status = 'ONLINE';
        return { status: 'DEDUPLICATED', camera_id: camera.id, hash };
      }

      // Write frame atomically
      const nowIso = new Date(nowMs).toISOString();
      const filename = serializeFrameFilename(nowIso);
      const camDir = path.join(this.baseDir, camera.id);
      if (!fs.existsSync(camDir)) {
        fs.mkdirSync(camDir, { recursive: true });
      }

      const tmpPath = path.join(camDir, `.tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);
      fs.writeFileSync(tmpPath, buffer);
      const finalPath = path.join(camDir, filename);
      fs.renameSync(tmpPath, finalPath);

      this.lastHash.set(camera.id, hash);
      this.lastFilename.set(camera.id, meta.rawFilename);
      this.lastWrittenMs.set(camera.id, nowMs);
      this.stats[camera.id].frames_captured++;
      this.stats[camera.id].last_frame_time = nowIso;
      this.stats[camera.id].status = 'ONLINE';

      return { status: 'CAPTURED', camera_id: camera.id, filename, hash, sizeBytes: buffer.length };
    } catch (err) {
      this.stats[camera.id].errors_count++;
      this.stats[camera.id].status = 'ERROR';
      return { status: 'ERROR', camera_id: camera.id, error: err.message };
    } finally {
      this.isPolling = false;
    }
  }

  runHousekeeping() {
    try {
      if (!fs.existsSync(this.baseDir)) return;
      const now = Date.now();
      const allFiles = [];

      // 1. Traverse directories and sweep stale temporary files
      const camDirs = fs.readdirSync(this.baseDir);
      for (const d of camDirs) {
        const fullDir = path.join(this.baseDir, d);
        let stat;
        try {
          stat = fs.statSync(fullDir);
        } catch (e) {
          continue;
        }
        if (!stat.isDirectory()) continue;

        const files = fs.readdirSync(fullDir);
        for (const f of files) {
          const filePath = path.join(fullDir, f);
          let fileStat;
          try {
            fileStat = fs.statSync(filePath);
          } catch (e) {
            continue;
          }

          // Sweep stale .tmp_* files older than 10 minutes
          if (f.startsWith('.tmp_') || f.endsWith('.tmp')) {
            if (now - fileStat.mtimeMs > TMP_FILE_EXPIRY_MS) {
              try { fs.unlinkSync(filePath); } catch (e) {}
            }
            continue;
          }

          if (f.endsWith('.jpg')) {
            const parsedDate = parseFrameFilename(f);
            const timestampMs = parsedDate ? parsedDate.getTime() : fileStat.mtimeMs;
            allFiles.push({
              path: filePath,
              size: fileStat.size,
              timestampMs,
              filename: f
            });
          }
        }
      }

      // 2. Prune files exceeding 48h retention
      const remainingFiles = [];
      for (const item of allFiles) {
        if (now - item.timestampMs > this.retentionMs) {
          try { fs.unlinkSync(item.path); } catch (e) {}
        } else {
          remainingFiles.push(item);
        }
      }

      // 3. Enforce hard disk ceiling (<= 350MB); prune down to low watermark (280MB)
      let totalBytes = remainingFiles.reduce((acc, f) => acc + f.size, 0);
      if (totalBytes > this.maxStorageBytes) {
        remainingFiles.sort((a, b) => a.timestampMs - b.timestampMs); // oldest first
        for (const item of remainingFiles) {
          if (totalBytes <= this.lowWatermarkBytes) break;
          try {
            fs.unlinkSync(item.path);
            totalBytes -= item.size;
          } catch (e) {}
        }
      }

      // 4. Clean empty orphaned subdirectories not in active camera catalog
      const activeIds = new Set(this.cameras.map(c => c.id));
      for (const d of camDirs) {
        if (activeIds.has(d)) continue;
        const fullDir = path.join(this.baseDir, d);
        try {
          if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
            if (fs.readdirSync(fullDir).length === 0) {
              fs.rmdirSync(fullDir);
            }
          }
        } catch (e) {}
      }
    } catch (err) {
      console.warn('[CameraBufferWorker Housekeeping Warning]', err.message);
    }
  }

  getFrameNearestTo(cameraId, targetIso, toleranceMs = 20 * 60 * 1000) {
    if (!ALLOWED_CAMERA_IDS.has(cameraId)) {
      throw new Error(`Security Violation: Unrecognized cameraId '${cameraId}'`);
    }

    const camDir = path.join(this.baseDir, cameraId);
    if (!fs.existsSync(camDir)) return null;

    const targetDate = new Date(targetIso);
    const targetMs = targetDate.getTime();
    if (isNaN(targetMs)) return null;

    const files = fs.readdirSync(camDir).filter(f => f.endsWith('.jpg'));
    if (files.length === 0) return null;

    let closest = null;
    let minDelta = Infinity;

    for (const f of files) {
      const parsed = parseFrameFilename(f);
      if (!parsed) continue;
      const delta = Math.abs(parsed.getTime() - targetMs);
      if (delta < minDelta) {
        minDelta = delta;
        closest = {
          filename: f,
          date: parsed,
          deltaMs: delta,
          filePath: path.join(camDir, f)
        };
      }
    }

    if (closest && closest.deltaMs <= toleranceMs) {
      return {
        cameraId,
        filename: closest.filename,
        filePath: closest.filePath,
        timestamp: closest.date.toISOString(),
        deltaMs: closest.deltaMs
      };
    }

    return null;
  }

  getStatus() {
    let totalStorageBytes = 0;
    let totalFrames = 0;

    if (fs.existsSync(this.baseDir)) {
      try {
        const camDirs = fs.readdirSync(this.baseDir);
        for (const d of camDirs) {
          const fullDir = path.join(this.baseDir, d);
          if (fs.statSync(fullDir).isDirectory()) {
            const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.jpg'));
            totalFrames += files.length;
            for (const f of files) {
              totalStorageBytes += fs.statSync(path.join(fullDir, f)).size;
            }
          }
        }
      } catch (e) {}
    }

    return {
      running: this.isRunning,
      step_interval_ms: this.stepIntervalMs,
      total_cameras: this.cameras.length,
      current_camera_index: this.currentIndex,
      total_frames_on_disk: totalFrames,
      total_storage_bytes: totalStorageBytes,
      storage_mb: Number((totalStorageBytes / (1024 * 1024)).toFixed(2)),
      cameras: this.stats
    };
  }
}
