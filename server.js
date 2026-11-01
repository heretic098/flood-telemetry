import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import {
  evaluateSpillway,
  evaluateSowyChannel,
  evaluateHuishEpiscopi,
  evaluateMidelney,
  aggregateGlobalStatus,
  getSeasonalRegime,
  sanitizeStageValue,
  HYDRO_THRESHOLDS,
  STATION_REGISTRY,
  extractStationStage
} from './src/js/hydro_engine.js';

import {
  fetchWebcamImageSecure,
  computeImageHash,
  isDaylight,
  callGeminiVision,
  generateLocalFallback,
  escapeHTML
} from './src/js/api/ai_vision_client.js';

import { runMigrations } from './src/js/db_migrations.js';
import { rehydrateActiveSessions, processTelemetryEvents } from './src/js/event_manager.js';
import { getTelemetryEvents, getActiveTelemetryEvents } from './src/js/event_ledger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'src');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'telemetry.db');

// Ensure target directory exists for SQLite database
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Initialize SQLite database in WAL mode
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Ensure database tables exist via versioned migrations
runMigrations(db);

// Rehydrate active telemetry event sessions on server boot
rehydrateActiveSessions(db);

const MEASURE_IDS = [
  '52108-level-stage-i-15_min-mASD',
  '52109-level-stage-i-15_min-mASD',
  '52111-level-stage-i-15_min-mASD',
  '52162-level-stage-i-15_min-mAOD',
  '52118-level-stage-i-15_min-mAOD',
  '52127-level-stage-i-15_min-mAOD',
  '52116-level-stage-i-15_min-m',
  '52119-level-stage-i-15_min-mASD',
  '52233-level-stage-i-15_min-mAOD',
  '52234-level-downstage-i-15_min-mAOD',
  '52158-level-stage-i-15_min-mAOD',
  '52159-level-stage-i-15_min-mAOD',
  '52124-level-tidal_level-i-15_min-mAOD',
  '52163-level-tidal_level-i-15_min-mAOD',
  '52157-level-stage-i-15_min-mAOD',
  'E9531-level-stage-i-15_min-mAOD',
  'E9094-level-stage-i-15_min-mAOD',
  '52120-level-stage-i-15_min-mASD',
  '52153-level-stage-i-15_min-mASD'
];

/**
 * Environment variable trigger helper
 */
export function shouldTriggerBackfill(envVar = process.env.BACKFILL_TELEMETRY || process.env.TRIGGER_BACKFILL) {
  if (!envVar) return false;
  const val = envVar.trim().toLowerCase();
  return val === 'true' || val === '1' || val === 'yes';
}

/**
 * Asynchronous background telemetry backfill worker
 */
export async function syncBackfillTelemetry(dbInstance = db, measures = MEASURE_IDS, fetchFn = globalThis.fetch, sinceDate = null) {
  if (!sinceDate) {
    const d = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    sinceDate = d.toISOString();
  }

  console.log(`[Backfill Worker] Starting 28-day telemetry backfill for ${measures.length} measures (since ${sinceDate})...`);

  const stmt = dbInstance.prepare(`
    INSERT OR IGNORE INTO historical_telemetry (measure_id, date_time, value)
    VALUES (?, ?, ?)
  `);

  const transaction = dbInstance.transaction((readings) => {
    let count = 0;
    for (const r of readings) {
      const cleanVal = sanitizeStageValue(r.value);
      const info = stmt.run(r.measure_id, r.dateTime, cleanVal);
      if (info.changes > 0) count++;
    }
    return count;
  });

  let totalInserted = 0;

  for (const id of measures) {
    const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${id}/readings?since=${sinceDate}&_sorted&_limit=10000`;
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        console.warn(`[Backfill Worker Warning] HTTP ${res.status} for measure ${id}`);
        continue;
      }

      const data = await res.json();
      if (data.items && Array.isArray(data.items)) {
        const items = data.items.map(item => ({
          measure_id: id,
          dateTime: item.dateTime,
          value: item.value
        }));

        const inserted = transaction(items);
        totalInserted += inserted;

        if (items.length > 0) {
          const telemetryStmt = dbInstance.prepare("INSERT OR REPLACE INTO telemetry (measure_id, readings_json, updated_at) VALUES (?, ?, datetime('now'))");
          telemetryStmt.run(id, JSON.stringify(items.slice(0, 2688)));
        }
      }
    } catch (err) {
      console.warn(`[Backfill Worker Error] Partial backfill failure for ${id}:`, err.message);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`[Backfill Worker] Telemetry backfill complete. Total new records inserted: ${totalInserted}`);
  return totalInserted;
}

async function syncMeasure(measureId, limit = 96, fetchFn = globalThis.fetch) {
  const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${measureId}/readings?_sorted&_limit=${limit}`;
  try {
    const res = await fetchFn(url);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const stmt = db.prepare("INSERT OR REPLACE INTO telemetry (measure_id, readings_json, updated_at) VALUES (?, ?, datetime('now'))");
      stmt.run(measureId, JSON.stringify(data.items));

      const histStmt = db.prepare("INSERT OR IGNORE INTO historical_telemetry (measure_id, date_time, value) VALUES (?, ?, ?)");
      const histTx = db.transaction((items) => {
        for (const item of items) {
          const cleanVal = sanitizeStageValue(item.value);
          histStmt.run(measureId, item.dateTime, cleanVal);
        }
      });
      histTx(data.items);

      return data.items;
    }
  } catch (err) {
    console.warn(`[SQLite Ingest Warning] Failed to sync ${measureId}:`, err.message);
  }
  return null;
}

let isSyncRunning = false;

export async function syncAllTelemetry(overrideLimit = null, fetchFn = globalThis.fetch) {
  if (isSyncRunning) {
    console.log('[SQLite Ingest] Sync already in progress, skipping concurrent run.');
    return;
  }
  isSyncRunning = true;
  try {
    const isBackfill = shouldTriggerBackfill();
    const limit = overrideLimit || (isBackfill ? 2688 : 96);
    await Promise.all(MEASURE_IDS.map(id => syncMeasure(id, limit, fetchFn)));

    // Process canonical telemetry events in shadow mode
    try {
      const stored = getStoredTelemetry();
      processTelemetryEvents(db, stored);
    } catch (evtErr) {
      console.warn('[Event Manager Warning] Failed to process telemetry events:', evtErr.message);
    }
  } finally {
    isSyncRunning = false;
  }
}

function getStoredTelemetry() {
  const rows = db.prepare('SELECT measure_id, readings_json, updated_at FROM telemetry').all();
  const measures = {};
  const measures_summary = {};
  let latestDbUpdate = null;
  let latestEaReadingAt = null;

  for (const r of rows) {
    try {
      const readings = JSON.parse(r.readings_json);
      measures[r.measure_id] = readings;
      if (!latestDbUpdate || r.updated_at > latestDbUpdate) {
        latestDbUpdate = r.updated_at;
      }
      if (readings && readings.length > 0 && readings[0].dateTime) {
        const itemTime = readings[0].dateTime;
        measures_summary[r.measure_id] = itemTime;
        if (!latestEaReadingAt || new Date(itemTime) > new Date(latestEaReadingAt)) {
          latestEaReadingAt = itemTime;
        }
      }
    } catch (e) {
      console.warn("JSON parse error for measure:", r.measure_id);
    }
  }
  return { 
    measures, 
    db_synced_at: latestDbUpdate,
    latest_ea_reading_at: latestEaReadingAt,
    measures_summary
  };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  syncAllTelemetry();
  const syncTimer = setInterval(syncAllTelemetry, 15 * 60 * 1000); // 15-minute sync loop
  if (syncTimer && syncTimer.unref) syncTimer.unref();

  if (shouldTriggerBackfill()) {
    console.log('[SQLite Ingest] BACKFILL_TELEMETRY flag active. Triggering non-blocking background worker...');
    setImmediate(() => {
      syncBackfillTelemetry().catch(err => {
        console.error('[Backfill Worker Exception]', err);
      });
    });
  }
}

const CATCHMENTS_DIR = path.join(PUBLIC_DIR, 'js', 'config', 'catchments');

export function getAvailableCatchments() {
  try {
    const indexPath = path.join(PUBLIC_DIR, 'js', 'config', 'catchments.json');
    if (fs.existsSync(indexPath)) {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (data && Array.isArray(data.catchments)) {
        return data.catchments;
      }
    }
  } catch (err) {
    console.warn('[Server Warning] Could not read catchments.json:', err.message);
  }
  return [
    { id: 'somerset', name: 'Somerset Levels & Moors', region: 'South West', path: '/somerset', configFile: 'somerset.json' }
  ];
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Simple In-Memory Rate Limiting (SEC-04)
const requestCounts = new Map();

// Periodically purge stale IP records every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  for (const [ip, record] of requestCounts.entries()) {
    if (now - record.startTime > windowMs) {
      requestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

function checkRateLimit(req, res) {
  const ip = req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxReqs = 60;

  let record = requestCounts.get(ip);
  if (!record || now - record.startTime > windowMs) {
    if (requestCounts.size > 10000) {
      requestCounts.clear(); // Emergency safeguard against unbounded memory ballooning
    }
    record = { startTime: now, count: 1 };
    requestCounts.set(ip, record);
  } else {
    record.count++;
  }

  if (record.count > maxReqs) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': '60'
    });
    res.end(JSON.stringify({ status: "error", message: "Rate limit exceeded. Maximum 60 requests per minute." }));
    return false;
  }
  return true;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://environment.data.gov.uk; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key');
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: "error", message: "Method Not Allowed. Only GET and HEAD requests are permitted." }));
    return;
  }

  if (req.url.startsWith('/api/') && !checkRateLimit(req, res)) {
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = urlObj.pathname;

  const availableCatchments = getAvailableCatchments();
  const knownCatchmentIds = availableCatchments.map(c => c.id.toLowerCase());

  let activeCatchmentPrefix = null;
  for (const cId of knownCatchmentIds) {
    if (pathname.toLowerCase() === `/${cId}` || pathname.toLowerCase() === `/${cId}/`) {
      activeCatchmentPrefix = cId;
      pathname = '/index.html';
      break;
    } else if (pathname.toLowerCase().startsWith(`/${cId}/`)) {
      activeCatchmentPrefix = cId;
      pathname = pathname.substring(cId.length + 1);
      break;
    }
  }

  // API Route: Health Check (<10ms)
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // API Route: Topology schematic payload
  if (pathname === '/api/topology' || pathname === '/api/topology/') {
    const stored = getStoredTelemetry();
    const measures = stored.measures;

    const greenhamStage = extractStationStage(measures, '52108');
    const bishopsHullStage = extractStationStage(measures, '52109');
    const tauntonStage = extractStationStage(measures, '52111');
    const bathpoolStage = extractStationStage(measures, '52162');
    const toneStage = extractStationStage(measures, '52118');
    const curryMoorStage = extractStationStage(measures, '52127');
    const chiselboroughStage = extractStationStage(measures, '52116');
    const gawBridgeStage = extractStationStage(measures, '52119');
    const huishStage = extractStationStage(measures, '52120');
    const midelneyStage = extractStationStage(measures, '52153');
    const monksUpStage = extractStationStage(measures, '52233');
    const monksDownStage = extractStationStage(measures, '52234');
    const parrettStage = extractStationStage(measures, '52158');
    const northmoorStage = extractStationStage(measures, '52159');
    const westQuayStage = extractStationStage(measures, '52124');
    const seaStage = extractStationStage(measures, '52163');
    const beerwallStage = extractStationStage(measures, '52157');
    const dunballInlandStage = extractStationStage(measures, 'E9094');
    const bradneyStage = extractStationStage(measures, 'E9531');

    const isMonksDiverting = monksUpStage >= HYDRO_THRESHOLDS.MONKS_LEAZE.SILL_MAOD &&
      (monksUpStage - monksDownStage) > HYDRO_THRESHOLDS.MONKS_LEAZE.MIN_DELTA_H;

    const hasLiveTelemetry = (stationId) => {
      return Object.keys(measures).some(k => k.startsWith(stationId) && Array.isArray(measures[k]) && measures[k].length > 0);
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    });
    res.end(JSON.stringify({
      status: "ok",
      catchment_id: "somerset",
      updated_at: new Date().toISOString(),
      chains: [
        {
          id: "tone",
          name: "River Tone Chain",
          direction: "West → East",
          nodes: ["52108", "52109", "52111", "52162", "52118", "52158"]
        },
        {
          id: "currymoor_polder",
          name: "Curry Moor Polder Basin",
          direction: "Storage Area",
          nodes: ["52118", "52127"]
        },
        {
          id: "parrett",
          name: "River Parrett Chain",
          direction: "South → North",
          nodes: ["52116", "52119", "52233", "52158", "52124", "52163"]
        },
        {
          id: "tributaries",
          name: "River Yeo & River Isle Tributaries",
          direction: "Upland → Langport Confluence",
          nodes: ["52120", "52153", "52233"]
        },
        {
          id: "northmoor_polder",
          name: "Northmoor Polder Basin",
          direction: "Storage Area",
          nodes: ["52158", "52159"]
        },
        {
          id: "sowy_ksd",
          name: "Sowy Relief Channel & Sedgemoor Drain",
          direction: "Diversion Route",
          nodes: ["52233", "52234", "52157", "E9531", "E9094", "52163"]
        }
      ],
      nodes: [
        {
          id: "52108",
          name: "Greenham (Upper Tone)",
          river: "River Tone",
          catchment: "tone",
          gauge_id: "52108",
          node_type: "gauge",
          stage_mAOD: greenhamStage,
          alert_level_mAOD: 76.99,
          status: greenhamStage >= 76.99 ? "ALERT" : "SECURE",
          downstream_node_id: "52109",
          has_sparkline: true
        },
        {
          id: "52109",
          name: "Bishops Hull (Mid Tone)",
          river: "River Tone",
          catchment: "tone",
          gauge_id: "52109",
          node_type: "gauge",
          stage_mAOD: bishopsHullStage,
          alert_level_mAOD: 17.48,
          status: bishopsHullStage >= 17.48 ? "ALERT" : "SECURE",
          downstream_node_id: "52111",
          has_sparkline: true
        },
        {
          id: "52111",
          name: "Taunton Market (Urban Tone)",
          river: "River Tone",
          catchment: "tone",
          gauge_id: "52111",
          node_type: "gauge",
          stage_mAOD: tauntonStage,
          alert_level_mAOD: 14.24,
          status: tauntonStage >= 14.24 ? "ALERT" : "SECURE",
          downstream_node_id: "52162",
          has_sparkline: true
        },
        {
          id: "52162",
          name: "Bathpool Outfall (Lower Tone)",
          river: "River Tone",
          catchment: "tone",
          gauge_id: "52162",
          node_type: "gauge",
          stage_mAOD: bathpoolStage,
          ground_elevation_mAOD: 7.50,
          alert_level_mAOD: 9.50,
          status: bathpoolStage >= 9.50 ? "ALERT" : "SECURE",
          downstream_node_id: "52118",
          has_sparkline: true
        },
        {
          id: "52118",
          name: "Hookbridge Spillway / Currymoor PS",
          river: "River Tone",
          catchment: "tone",
          gauge_id: "52118",
          node_type: "spillway",
          stage_mAOD: toneStage,
          crest_elevation_mAOD: HYDRO_THRESHOLDS.HOOKBRIDGE.CREST_MAOD,
          alert_level_mAOD: HYDRO_THRESHOLDS.HOOKBRIDGE.ALERT_MAOD,
          status: toneStage >= HYDRO_THRESHOLDS.HOOKBRIDGE.CREST_MAOD ? "OVERSPILLING" : (toneStage >= HYDRO_THRESHOLDS.HOOKBRIDGE.ALERT_MAOD ? "ALERT" : "SECURE"),
          downstream_node_id: "athelney_junction",
          diverts_to_node_id: "52127",
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/3073"
        },
        {
          id: "52127",
          name: "Curry Moor Basin",
          river: "Curry Moor Basin",
          catchment: "tone",
          gauge_id: "52127",
          node_type: "polder_basin",
          stage_mAOD: curryMoorStage,
          ground_elevation_mAOD: HYDRO_THRESHOLDS.CURRY_MOOR.GROUND_MAOD,
          alert_level_mAOD: HYDRO_THRESHOLDS.CURRY_MOOR.ALERT_MAOD,
          crest_elevation_mAOD: HYDRO_THRESHOLDS.CURRY_MOOR.CREST_MAOD,
          status: curryMoorStage >= HYDRO_THRESHOLDS.CURRY_MOOR.ALERT_MAOD ? "ALERT" : "SECURE",
          downstream_node_id: "currymoor_ps",
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/3064"
        },
        {
          id: "52116",
          name: "Chiselborough (Upper Parrett)",
          river: "River Parrett",
          catchment: "parrett",
          gauge_id: "52116",
          node_type: "gauge",
          stage_mAOD: chiselboroughStage,
          alert_level_mAOD: 22.50,
          status: chiselboroughStage >= 22.50 ? "ALERT" : "SECURE",
          downstream_node_id: "52119",
          has_sparkline: true
        },
        {
          id: "52119",
          name: "Gaw Bridge (Mid Parrett)",
          river: "River Parrett",
          catchment: "parrett",
          gauge_id: "52119",
          node_type: "gauge",
          stage_mAOD: gawBridgeStage,
          alert_level_mAOD: 12.80,
          status: gawBridgeStage >= 12.80 ? "ALERT" : "SECURE",
          downstream_node_id: "52233",
          has_sparkline: true
        },
        {
          id: "52120",
          name: "Huish Episcopi PS (River Yeo)",
          river: "River Yeo",
          catchment: "tributaries",
          gauge_id: "52120",
          node_type: "gauge",
          stage_mAOD: huishStage,
          alert_level_mAOD: 8.48,
          status: huishStage >= 8.48 ? "ALERT" : (huishStage >= 8.20 ? "ALERT" : (huishStage >= 7.30 ? "ALERT" : "SECURE")),
          downstream_node_id: "52233",
          upstream_tributaries: ["52121", "52117", "52112"],
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/3071"
        },
        {
          id: "52153",
          name: "Midelney (River Isle)",
          river: "River Isle",
          catchment: "tributaries",
          gauge_id: "52153",
          node_type: "gauge",
          stage_mAOD: midelneyStage,
          alert_level_mAOD: 8.20,
          status: midelneyStage >= 8.20 ? "ALERT" : "SECURE",
          downstream_node_id: "52233",
          upstream_tributaries: ["52115", "52114"],
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/3380"
        },
        {
          id: "52233",
          name: "Monk's Leaze Clyse (Upstream)",
          river: "River Parrett",
          catchment: "parrett",
          gauge_id: "52233",
          node_type: "clyse_gate",
          stage_mAOD: monksUpStage,
          sill_elevation_mAOD: HYDRO_THRESHOLDS.MONKS_LEAZE.SILL_MAOD,
          alert_level_mAOD: HYDRO_THRESHOLDS.MONKS_LEAZE.UPSTREAM_ALERT_MAOD,
          status: monksUpStage >= HYDRO_THRESHOLDS.MONKS_LEAZE.UPSTREAM_ALERT_MAOD ? "ALERT" : (isMonksDiverting ? "DIVERTING" : "CLOSED"),
          downstream_node_id: "52158",
          diverts_to_node_id: "52234",
          has_sparkline: true,
          ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html"
        },
        {
          id: "52158",
          name: "Baltmoor Wall (Burrowbridge Confluence)",
          river: "River Parrett",
          catchment: "parrett",
          gauge_id: "52158",
          node_type: "spillway",
          stage_mAOD: parrettStage,
          crest_elevation_mAOD: HYDRO_THRESHOLDS.BALTMOOR.CREST_MAOD,
          alert_level_mAOD: HYDRO_THRESHOLDS.BALTMOOR.ALERT_MAOD,
          status: parrettStage >= HYDRO_THRESHOLDS.BALTMOOR.CREST_MAOD ? "OVERSPILLING" : (parrettStage >= HYDRO_THRESHOLDS.BALTMOOR.ALERT_MAOD ? "ALERT" : "SECURE"),
          downstream_node_id: "52124",
          diverts_to_node_id: "52159",
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/3400"
        },
        {
          id: "52159",
          name: "Northmoor Basin",
          river: "Northmoor Basin",
          catchment: "parrett",
          gauge_id: "52159",
          node_type: "polder_basin",
          stage_mAOD: northmoorStage,
          ground_elevation_mAOD: HYDRO_THRESHOLDS.NORTHMOOR.GROUND_MAOD,
          alert_level_mAOD: HYDRO_THRESHOLDS.NORTHMOOR.ALERT_MAOD,
          crest_elevation_mAOD: HYDRO_THRESHOLDS.NORTHMOOR.CREST_MAOD,
          status: northmoorStage >= HYDRO_THRESHOLDS.NORTHMOOR.ALERT_MAOD ? "ALERT" : "SECURE",
          downstream_node_id: "saltmoor_ps",
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/3415"
        },
        {
          id: "52124",
          name: "West Quay Bridgwater",
          river: "River Parrett",
          catchment: "parrett",
          gauge_id: "52124",
          node_type: "gauge",
          stage_mAOD: westQuayStage,
          alert_level_mAOD: 6.10,
          status: westQuayStage >= 6.10 ? "ALERT" : "SECURE",
          downstream_node_id: "52163",
          has_sparkline: true
        },
        {
          id: "52163",
          name: "Dunball Tidal (Parrett Estuary)",
          river: "Parrett Estuary",
          catchment: "parrett",
          gauge_id: "52163",
          node_type: "tidal_outfall",
          stage_mAOD: seaStage,
          inland_stage_mAOD: dunballInlandStage,
          is_tide_locked: seaStage >= dunballInlandStage,
          alert_level_mAOD: HYDRO_THRESHOLDS.DUNBALL.ESTUARY_ALERT_MAOD,
          status: seaStage >= HYDRO_THRESHOLDS.DUNBALL.ESTUARY_ALERT_MAOD ? "ALERT" : (seaStage >= dunballInlandStage ? "SLACK_RESTRICTED" : "SECURE"),
          downstream_node_id: "sea_outfall",
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/9129"
        },
        {
          id: "52234",
          name: "Monk's Leaze Clyse (Downstream Sowy)",
          river: "Sowy Relief Channel",
          catchment: "sowy_ksd",
          gauge_id: "52234",
          node_type: "gauge",
          stage_mAOD: monksDownStage,
          alert_level_mAOD: HYDRO_THRESHOLDS.MONKS_LEAZE.DOWNSTREAM_ALERT_MAOD,
          status: monksDownStage >= HYDRO_THRESHOLDS.MONKS_LEAZE.DOWNSTREAM_ALERT_MAOD ? "ALERT" : (isMonksDiverting ? "DIVERTING" : "SECURE"),
          downstream_node_id: "52157",
          has_sparkline: true,
          ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52234.html"
        },
        {
          id: "52157",
          name: "Beerwall Upstream (Greylake)",
          river: "Sowy Relief Channel",
          catchment: "sowy_ksd",
          gauge_id: "52157",
          node_type: "spillway",
          stage_mAOD: beerwallStage,
          crest_elevation_mAOD: HYDRO_THRESHOLDS.BEERWALL.CREST_MAOD,
          alert_level_mAOD: HYDRO_THRESHOLDS.BEERWALL.ALERT_MAOD,
          status: beerwallStage >= HYDRO_THRESHOLDS.BEERWALL.ALERT_MAOD ? "ALERT" : "SECURE",
          downstream_node_id: "E9531",
          has_sparkline: true
        },
        {
          id: "E9531",
          name: "Bradney (King's Sedgemoor Drain)",
          river: "King's Sedgemoor Drain",
          catchment: "sowy_ksd",
          gauge_id: "E9531",
          node_type: "gauge",
          stage_mAOD: bradneyStage,
          alert_level_mAOD: 3.50,
          status: bradneyStage >= 3.50 ? "ALERT" : "SECURE",
          downstream_node_id: "E9094",
          has_sparkline: true,
          ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/E9531.html"
        },
        {
          id: "E9094",
          name: "Dunball Inland KSD Outfall",
          river: "King's Sedgemoor Drain",
          catchment: "sowy_ksd",
          gauge_id: "E9094",
          node_type: "gauge",
          stage_mAOD: dunballInlandStage,
          sea_stage_mAOD: seaStage,
          is_tide_locked: seaStage >= dunballInlandStage,
          alert_level_mAOD: HYDRO_THRESHOLDS.DUNBALL.INLAND_ALERT_MAOD,
          status: (seaStage >= dunballInlandStage) ? "SLACK_RESTRICTED" : (dunballInlandStage >= HYDRO_THRESHOLDS.DUNBALL.INLAND_ALERT_MAOD ? "ALERT" : "SECURE"),
          downstream_node_id: "52163",
          has_sparkline: true,
          govuk_link: "https://check-for-flooding.service.gov.uk/station/9499"
        }
      ].map(node => ({
        ...node,
        telemetry_source: hasLiveTelemetry(node.id) ? "live" : "cached_fallback",
        provenance: STATION_REGISTRY[node.id]?.provenance || null
      })),
      edges: [
        { from: "52108", to: "52109", type: "main_river", flow_active: true },
        { from: "52109", to: "52111", type: "main_river", flow_active: true },
        { from: "52111", to: "52162", type: "main_river", flow_active: true },
        { from: "52162", to: "52118", type: "main_river", flow_active: true },
        { from: "52118", to: "52158", type: "main_river", flow_active: true },
        { from: "52118", to: "52127", type: "spillway_overtopping", flow_active: toneStage >= 7.45 },
        { from: "52116", to: "52119", type: "main_river", flow_active: true },
        { from: "52119", to: "52233", type: "main_river", flow_active: true },
        { from: "52120", to: "52233", type: "tributary_inflow", flow_active: huishStage < 8.20 },
        { from: "52153", to: "52233", type: "tributary_inflow", flow_active: midelneyStage > monksUpStage },
        { from: "52233", to: "52158", type: "main_river", flow_active: true },
        { from: "52158", to: "52159", type: "spillway_overtopping", flow_active: parrettStage >= 7.80 },
        { from: "52127", to: "52159", type: "polder_overflow", flow_active: curryMoorStage >= 7.35 },
        { from: "52158", to: "52124", type: "main_river", flow_active: true },
        { from: "52124", to: "52163", type: "sea_outfall", flow_active: westQuayStage > seaStage },
        { from: "52233", to: "52234", type: "diversion_clyse", flow_active: isMonksDiverting },
        { from: "52234", to: "52157", type: "diversion_route", flow_active: isMonksDiverting },
        { from: "52157", to: "E9531", type: "diversion_route", flow_active: isMonksDiverting },
        { from: "E9531", to: "E9094", type: "diversion_route", flow_active: true },
        { from: "E9094", to: "52163", type: "sea_outfall", flow_active: dunballInlandStage > seaStage }
      ]
    }));
    return;
  }

  // API Route: Camera Analysis
  if (pathname.startsWith('/api/camera-analysis')) {
    const cameraId = urlObj.searchParams.get('camera_id') || 'monks_leaze_clyse';
    const imageUrl = 'https://thecfh.org/parretttonewsom.php#monksleaze';

    let cached = db.prepare('SELECT * FROM camera_analysis WHERE camera_id = ? ORDER BY id DESC LIMIT 1').get(cameraId);

    if (!cached || req.url.includes('refresh=true')) {
      const stored = getStoredTelemetry();
      const monksUp = stored.measures['52233-level-stage-i-15_min-mAOD']?.[0]?.value ?? 6.85;
      const monksDown = stored.measures['52234-level-downstage-i-15_min-mAOD']?.[0]?.value ?? 6.30;
      const deltaH = monksUp - monksDown;

      const telemetryState = { deltaH, isOvertopping: false };
      const cameraConfig = { name: "Monk's Leaze Clyse Gate Cam" };

      let analysisJson = null;
      let aiEvaluated = 0;
      let fallbackMode = null;
      let imageHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

      if (!isDaylight()) {
        fallbackMode = 'NIGHT_TELEMETRY';
        analysisJson = JSON.stringify({
          gate_status: deltaH >= 0.05 ? "OPEN" : "CLOSED",
          debris_detected: false,
          flow_character: deltaH > 0.15 ? "TURBULENT" : "SLACK",
          overtopping_detected: false,
          confidence: 0.80,
          summary: escapeHTML("Night mode fallback: AI vision skipped during darkness. Telemetry active.")
        });
      } else if (!process.env.GEMINI_API_KEY) {
        fallbackMode = 'NO_API_KEY';
        analysisJson = JSON.stringify(generateLocalFallback(cameraConfig, telemetryState));
      } else {
        try {
          const buffer = await fetchWebcamImageSecure(imageUrl);
          imageHash = computeImageHash(buffer);
          const result = await callGeminiVision(buffer, 'image/jpeg', process.env.GEMINI_API_KEY);
          analysisJson = JSON.stringify(result);
          aiEvaluated = 1;
        } catch (err) {
          fallbackMode = 'FETCH_ERROR';
          analysisJson = JSON.stringify(generateLocalFallback(cameraConfig, telemetryState));
        }
      }

      db.prepare(`
        INSERT INTO camera_analysis (camera_id, image_hash, image_url, fetched_at, ai_evaluated, analysis_json, trigger_reason, fallback_mode)
        VALUES (?, ?, ?, datetime('now'), ?, ?, 'SCHEDULED_SYNC', ?)
      `).run(cameraId, imageHash, imageUrl, aiEvaluated, analysisJson, fallbackMode);

      cached = db.prepare('SELECT * FROM camera_analysis WHERE camera_id = ? ORDER BY id DESC LIMIT 1').get(cameraId);
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    });
    res.end(JSON.stringify({
      status: "ok",
      camera_id: cameraId,
      camera_name: "Monk's Leaze Clyse Gate Cam",
      fetched_at: cached.fetched_at,
      image_url: cached.image_url,
      image_hash: cached.image_hash,
      ai_evaluated: cached.ai_evaluated === 1,
      trigger_reason: cached.trigger_reason,
      fallback_mode: cached.fallback_mode,
      analysis: JSON.parse(cached.analysis_json)
    }));
    return;
  }

  // API Route: List catchments
  if (pathname === '/api/catchments' || pathname === '/api/catchments/') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({ status: "ok", catchments: availableCatchments }));
    return;
  }

  // API Route: Return specific catchment config
  if (pathname.startsWith('/api/catchments/')) {
    const rawId = pathname.substring('/api/catchments/'.length).split('/')[0];
    const catchmentId = rawId.toLowerCase();

    const configFile = path.join(CATCHMENTS_DIR, `${catchmentId}.json`);
    let configData = null;

    if (fs.existsSync(configFile)) {
      try {
        configData = fs.readFileSync(configFile, 'utf8');
      } catch (err) {
        console.error(`[API Error] Failed to read config for ${catchmentId}:`, err);
      }
    } else if (catchmentId === 'somerset') {
      const fallbackFile = path.join(PUBLIC_DIR, 'js', 'config', 'hydro_config.json');
      if (fs.existsSync(fallbackFile)) {
        try {
          configData = fs.readFileSync(fallbackFile, 'utf8');
        } catch (err) {
          console.error(`[API Error] Failed to read fallback hydro_config.json:`, err);
        }
      }
    }

    if (configData) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      });
      res.end(configData);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: "error", message: `Catchment config '${catchmentId}' not found` }));
    }
    return;
  }

  // API Route: Historical telemetry
  if (pathname.startsWith('/api/history')) {
    try {
      const rawRange = urlObj.searchParams.get('range') || '30d';
      const validRanges = { '24h': 1, '7d': 7, '30d': 30 };
      const range = validRanges[rawRange] ? rawRange : '30d';
      const days = validRanges[range];

      const sinceTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const rows = db.prepare(`
        SELECT measure_id, date_time, value 
        FROM historical_telemetry 
        WHERE date_time >= ? 
        ORDER BY date_time DESC
      `).all(sinceTime);

      const measures = {};
      for (const r of rows) {
        if (!measures[r.measure_id]) {
          measures[r.measure_id] = [];
        }
        measures[r.measure_id].push({ dateTime: r.date_time, value: r.value });
      }

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300'
      });
      res.end(JSON.stringify({
        status: "ok",
        range,
        days,
        since: sinceTime,
        total_records: rows.length,
        measures
      }));
    } catch (err) {
      console.error("[API History Error]", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: "error", message: "Failed to retrieve historical telemetry" }));
    }
    return;
  }

  // API Route: Canonical Telemetry Events Ledger (Phase 4)
  if (pathname === '/api/events' || pathname === '/api/events/') {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const statusParam = urlObj.searchParams.get('status')?.trim()?.toUpperCase() || null;
      const assetIdParam = urlObj.searchParams.get('asset_id')?.trim()?.toLowerCase() || null;
      const limitParam = urlObj.searchParams.get('limit');

      const events = getTelemetryEvents(db, {
        status: statusParam,
        asset_id: assetIdParam,
        limit: limitParam
      });

      const cacheHeader = (statusParam === 'CLOSED')
        ? 'public, max-age=300'
        : 'no-cache, no-store, must-revalidate';

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': cacheHeader
      });
      res.end(JSON.stringify({
        status: 'ok',
        count: events.length,
        events
      }));
    } catch (err) {
      console.error('[API Events Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Failed to retrieve telemetry events' }));
    }
    return;
  }

  // API Route: Status with all 7 UI/UX Status Tokens & Weir Math
  if (pathname.startsWith('/api/status')) {
    let stored = getStoredTelemetry();

    if (Object.keys(stored.measures).length < MEASURE_IDS.length || req.url.includes('refresh=true')) {
      await syncAllTelemetry();
      stored = getStoredTelemetry();
    }

    const measures = stored.measures;
    const hookbridgeStage = extractStationStage(measures, '52118');
    const curryMoorStage = extractStationStage(measures, '52127');
    const baltmoorStage = extractStationStage(measures, '52158');
    const northMoorStage = extractStationStage(measures, '52159');
    const monksUpStage = extractStationStage(measures, '52233');
    const monksDownStage = extractStationStage(measures, '52234');
    const huishStage = extractStationStage(measures, '52120');
    const midelneyStage = extractStationStage(measures, '52153');
    const gawStage = extractStationStage(measures, '52119');
    const dunballInlandStage = extractStationStage(measures, 'E9094');
    const seaStage = extractStationStage(measures, '52163');
    const isTideLocked = seaStage >= dunballInlandStage;
    const regime = getSeasonalRegime(new Date());

    const hookbridgeOverspill = { ...evaluateSpillway(hookbridgeStage, curryMoorStage, HYDRO_THRESHOLDS.HOOKBRIDGE.CREST_MAOD), name: "Curry Moor System" };
    const athelneyOverspill = { ...evaluateSpillway(curryMoorStage, northMoorStage, 7.35), name: "Athelney Spillway & Cuts Road" };
    const baltmoorOverspill = { ...evaluateSpillway(baltmoorStage, northMoorStage, HYDRO_THRESHOLDS.BALTMOOR.CREST_MAOD), name: "Northmoor & Saltmoor" };
    const sowyEval = evaluateSowyChannel(monksUpStage, monksDownStage, HYDRO_THRESHOLDS.MONKS_LEAZE.SILL_MAOD);
    const huishEval = evaluateHuishEpiscopi(huishStage, regime.isSummer);
    const midelneyEval = evaluateMidelney(midelneyStage, monksUpStage);
    const confluenceEval = { name: "Langport Confluence", severity: Math.min(huishEval.severity, midelneyEval.severity) };

    const globalStat = aggregateGlobalStatus(
      [hookbridgeOverspill, athelneyOverspill, baltmoorOverspill, confluenceEval],
      isTideLocked
    );

    // Source active sessions directly from canonical telemetry_events ledger [RULE-ENT-01]
    const nowMs = Date.now();
    const activeEvents = getActiveTelemetryEvents(db, nowMs);

    const hookbridgeEvent = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'hookbridge' AND status = 'ACTIVE'").get();
    const baltmoorEvent = db.prepare("SELECT * FROM telemetry_events WHERE asset_id = 'baltmoor_wall' AND status = 'ACTIVE'").get();

    const hookbridgeDuration = hookbridgeEvent ? Math.max(0, Math.floor((nowMs - new Date(hookbridgeEvent.start_time).getTime()) / 1000)) : 0;
    const baltmoorDuration = baltmoorEvent ? Math.max(0, Math.floor((nowMs - new Date(baltmoorEvent.start_time).getTime()) / 1000)) : 0;

    const mapStatusCode = (evalResult) => {
      if (evalResult.code === 'OVERTOPPING' || evalResult.code === 'SUBMERGED') return 'OVERSPILLING';
      if (evalResult.code === 'NEAR_CREST') return 'ALERT';
      if (evalResult.code === 'SECURE') return 'SECURE';
      if (evalResult.code === 'GRAVITY_OPEN' || evalResult.code === 'OPEN') return 'DIVERTING';
      if (evalResult.code === 'CLOSED') return 'CLOSED';
      if (evalResult.code === 'THROTTLED' || evalResult.code === 'SLACK_WATER') return 'SLACK_RESTRICTED';
      return 'SECURE';
    };

    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120'
    });
    res.end(JSON.stringify({
      status: "ok",
      source: "sqlite",
      system_timestamps: {
        client_poll_at: new Date().toISOString(),
        db_synced_at: stored.db_synced_at || new Date().toISOString(),
        latest_ea_reading_at: stored.latest_ea_reading_at || new Date().toISOString()
      },
      global_status: {
        counter_pill: globalStat.counterPill,
        banner_text: globalStat.bannerText,
        top_severity: globalStat.topSeverity,
        is_tide_locked: isTideLocked
      },
      active_events: activeEvents,
      cards: {
        hookbridge_spillway: {
          id: "hookbridge_spillway",
          name: "Hookbridge Spillway",
          river: "River Tone → Curry Moor",
          stage_mAOD: hookbridgeStage,
          crest_mAOD: 7.45,
          moor_stage_mAOD: curryMoorStage,
          status_code: hookbridgeEvent?.to_state === 'OVERTOPPING' ? 'OVERSPILLING' : (hookbridgeEvent?.to_state === 'NEAR_CREST' ? 'ALERT' : mapStatusCode(hookbridgeOverspill)),
          badge_label: hookbridgeOverspill.label,
          badge_class: hookbridgeOverspill.badgeClass,
          clearance_text: hookbridgeOverspill.clearanceText,
          is_spilling: hookbridgeEvent?.to_state === 'OVERTOPPING' || hookbridgeOverspill.code === 'OVERTOPPING',
          spill_duration_seconds: hookbridgeDuration,
          spill_duration_formatted: `${Math.floor(hookbridgeDuration / 3600)}h ${Math.floor((hookbridgeDuration % 3600) / 60)}m`,
          narrative: hookbridgeEvent?.narrative || hookbridgeOverspill.narrative
        },
        baltmoor_wall: {
          id: "baltmoor_wall",
          name: "Baltmoor Wall Spillway",
          river: "River Parrett → Northmoor",
          stage_mAOD: baltmoorStage,
          crest_mAOD: 7.80,
          moor_stage_mAOD: northMoorStage,
          status_code: baltmoorEvent?.to_state === 'OVERTOPPING' ? 'OVERSPILLING' : (baltmoorEvent?.to_state === 'NEAR_CREST' ? 'ALERT' : mapStatusCode(baltmoorOverspill)),
          badge_label: baltmoorOverspill.label,
          badge_class: baltmoorOverspill.badgeClass,
          clearance_text: baltmoorOverspill.clearanceText,
          is_spilling: baltmoorEvent?.to_state === 'OVERTOPPING' || baltmoorOverspill.code === 'OVERTOPPING',
          spill_duration_seconds: baltmoorDuration,
          spill_duration_formatted: `${Math.floor(baltmoorDuration / 3600)}h ${Math.floor((baltmoorDuration % 3600) / 60)}m`,
          narrative: baltmoorEvent?.narrative || baltmoorOverspill.narrative
        },
        monks_leaze_clyse: {
          id: "monks_leaze_clyse",
          name: "Monk's Leaze Clyse",
          river: "River Parrett → Sowy Relief Channel",
          upstream_mAOD: monksUpStage,
          downstream_mAOD: monksDownStage,
          sill_mAOD: 4.20,
          delta_h_m: Math.round((monksUpStage - monksDownStage) * 100) / 100,
          status_code: mapStatusCode(sowyEval),
          badge_label: sowyEval.label,
          badge_class: sowyEval.badgeClass,
          tributary_inflows: {
            yeo_mAOD: huishStage,
            isle_mAOD: midelneyStage,
            parrett_mAOD: gawStage
          },
          narrative: sowyEval.narrative
        },
        langport_confluence: {
          id: "langport_confluence",
          name: "Langport Confluence & Tributaries",
          river: "River Yeo & River Isle → Parrett Confluence",
          yeo_stage_mAOD: huishStage,
          isle_stage_mAOD: midelneyStage,
          status_code: huishEval.code === 'ALERT' || midelneyEval.code === 'ALERT' ? 'ALERT' : (huishEval.code === 'CUT_OFF' ? 'SLACK_RESTRICTED' : 'SECURE'),
          badge_label: huishEval.label,
          badge_class: huishEval.badgeClass,
          clearance_text: huishEval.clearanceText,
          huish_episcopi: huishEval,
          midelney: midelneyEval,
          narrative: `${huishEval.narrative} ${midelneyEval.narrative}`
        }
      },
      measures_summary: stored.measures_summary,
      measures: stored.measures
    }));
    return;
  }

  let reqFile = pathname === '/' ? 'index.html' : pathname;
  let safePath = (pathname === '/js/config/hydro_config.json')
    ? path.resolve(path.join(CATCHMENTS_DIR, 'somerset.json'))
    : path.resolve(path.join(PUBLIC_DIR, reqFile));

  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  if (!fs.existsSync(safePath) && !path.extname(safePath)) {
    safePath = path.resolve(path.join(PUBLIC_DIR, 'index.html'));
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const cacheControl = (ext === '.html') ? 'public, max-age=300' : ((ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=86400');

  fs.readFile(safePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    } else {
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': cacheControl
      });
      res.end(content, 'utf-8');
    }
  });
});

if (isMainModule) {
  server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`Flood Telemetry Dashboard Server (SQLite Embedded WAL)`);
    console.log(`Running locally at: http://localhost:${PORT}`);
    console.log(`===================================================`);
  });
}

export { server };
