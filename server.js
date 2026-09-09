import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'src');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'telemetry.db');

// Ensure target directory exists for SQLite database
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Initialize SQLite database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure database tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetry (
    measure_id TEXT PRIMARY KEY,
    readings_json TEXT NOT NULL,
    updated_at DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS historical_telemetry (
    measure_id TEXT NOT NULL,
    date_time TEXT NOT NULL,
    value REAL,
    PRIMARY KEY (measure_id, date_time)
  );

  CREATE INDEX IF NOT EXISTS idx_historical_telemetry_measure_dt 
    ON historical_telemetry(measure_id, date_time DESC);
`);

const MEASURE_IDS = [
  '52118-level-stage-i-15_min-mAOD',
  '52127-level-stage-i-15_min-mAOD',
  '52158-level-stage-i-15_min-mAOD',
  '52159-level-stage-i-15_min-mAOD',
  '52233-level-stage-i-15_min-mAOD',
  '52234-level-downstage-i-15_min-mAOD',
  'E9094-level-stage-i-15_min-mAOD',
  '52163-level-tidal_level-i-15_min-mAOD'
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

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS historical_telemetry (
      measure_id TEXT NOT NULL,
      date_time TEXT NOT NULL,
      value REAL,
      PRIMARY KEY (measure_id, date_time)
    )
  `);

  const stmt = dbInstance.prepare(`
    INSERT OR IGNORE INTO historical_telemetry (measure_id, date_time, value)
    VALUES (?, ?, ?)
  `);

  const transaction = dbInstance.transaction((readings) => {
    let count = 0;
    for (const r of readings) {
      const info = stmt.run(r.measure_id, r.dateTime, r.value);
      if (info.changes > 0) count++;
    }
    return count;
  });

  let totalInserted = 0;

  for (const id of measures) {
    const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${id}/readings?since=${sinceDate}&_sorted&_limit=10000`;
    try {
      console.log(`[Backfill Worker] Querying EA API for ${id}...`);
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
        console.log(`[Backfill Worker] ${id}: Fetched ${items.length} items, inserted ${inserted} new readings.`);

        // Mirror recent readings to telemetry table for backwards compatibility
        if (items.length > 0) {
          const telemetryStmt = dbInstance.prepare("INSERT OR REPLACE INTO telemetry (measure_id, readings_json, updated_at) VALUES (?, ?, datetime('now'))");
          telemetryStmt.run(id, JSON.stringify(items.slice(0, 2688)));
        }
      }
    } catch (err) {
      console.warn(`[Backfill Worker Error] Partial backfill failure for ${id}:`, err.message);
    }
    // Small inter-request delay to respect EA API rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`[Backfill Worker] Telemetry backfill complete. Total new records inserted: ${totalInserted}`);
  return totalInserted;
}

async function syncMeasure(measureId, limit = 96) {
  const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${measureId}/readings?_sorted&_limit=${limit}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const stmt = db.prepare("INSERT OR REPLACE INTO telemetry (measure_id, readings_json, updated_at) VALUES (?, ?, datetime('now'))");
      stmt.run(measureId, JSON.stringify(data.items));

      // Sync into historical_telemetry for retention & deduplication
      const histStmt = db.prepare("INSERT OR IGNORE INTO historical_telemetry (measure_id, date_time, value) VALUES (?, ?, ?)");
      const histTx = db.transaction((items) => {
        for (const item of items) {
          histStmt.run(measureId, item.dateTime, item.value);
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

export async function syncAllTelemetry(overrideLimit = null) {
  const isBackfill = shouldTriggerBackfill();
  const limit = overrideLimit || (isBackfill ? 2688 : 96);
  const modeLabel = isBackfill ? 'FULL 28-DAY BACKFILL' : 'Standard 24h Sync';
  console.log(`[SQLite Ingest] Running ${modeLabel} (limit=${limit}) for ${MEASURE_IDS.length} EA measures (${new Date().toLocaleTimeString()})...`);
  await Promise.all(MEASURE_IDS.map(id => syncMeasure(id, limit)));
  console.log(`[SQLite Ingest] Sync complete. SQLite DB updated!`);
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

// Initial 24h sync on boot & set 5-minute background polling interval
syncAllTelemetry();
setInterval(syncAllTelemetry, 5 * 60 * 1000);

// Check for BACKFILL_TELEMETRY flag to trigger non-blocking 28-day backfill worker
if (shouldTriggerBackfill()) {
  console.log('[SQLite Ingest] BACKFILL_TELEMETRY flag active. Triggering non-blocking background worker...');
  setImmediate(() => {
    syncBackfillTelemetry().catch(err => {
      console.error('[Backfill Worker Exception]', err);
    });
  });
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

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/history')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*'
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

  if (req.url.startsWith('/api/status')) {
    let stored = getStoredTelemetry();

    // If SQLite has missing measures or caller asks for refresh, trigger sync
    if (Object.keys(stored.measures).length < MEASURE_IDS.length || req.url.includes('refresh=true')) {
      await syncAllTelemetry();
      stored = getStoredTelemetry();
    }

    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      status: "ok",
      source: "sqlite",
      system_timestamps: {
        client_poll_at: new Date().toISOString(),
        db_synced_at: stored.db_synced_at || new Date().toISOString(),
        latest_ea_reading_at: stored.latest_ea_reading_at || new Date().toISOString()
      },
      measures_summary: stored.measures_summary,
      measures: stored.measures
    }));
    return;
  }

  const reqFile = req.url.split('?')[0];
  const safePath = path.resolve(path.join(PUBLIC_DIR, reqFile === '/' ? 'index.html' : reqFile));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

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
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`Somerset Flood Dashboard Server (SQLite Embedded WAL)`);
  console.log(`Running locally at: http://localhost:${PORT}`);
  console.log(`===================================================`);
});

