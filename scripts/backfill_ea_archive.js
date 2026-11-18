#!/usr/bin/env node
/**
 * Resumable day-by-day streaming backfill from the Environment Agency Flood Monitoring
 * daily CSV archive (OGL v3.0):
 *   https://environment.data.gov.uk/flood-monitoring/archive/readings-YYYY-MM-DD.csv
 *
 * Streams each ~60 MB national CSV line-by-line over HTTP, keeps only our Somerset
 * MEASURE_IDS (~250 KB/day), and writes into a separate SQLite database
 * (default: ./ea_somerset_archive.db, gitignored via *.db) without touching telemetry.db.
 *
 * Usage:
 *   node scripts/backfill_ea_archive.js --start=2025-12-01 --end=2026-02-28
 *   node scripts/backfill_ea_archive.js --start=2025-12-01 --days=3
 *   node scripts/backfill_ea_archive.js --db=ea_somerset_archive.db --start=2025-11-18 --days=365
 */

import readline from 'node:readline';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';

// Keep in sync with MEASURE_IDS in server.js (all 21 Somerset measures)
const MEASURE_IDS = new Set([
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
  '52153-level-stage-i-15_min-mASD',
  '52155-level-sump_level-i-15_min-mAOD',
  '52106-level-tidal_level-i-15_min-mAOD'
]);

function parseArgs(argv) {
  const opts = {
    dbPath: process.env.ARCHIVE_DB_PATH || new URL('../ea_somerset_archive.db', import.meta.url).pathname,
    start: '2025-12-01',
    end: null,
    days: null,
    delayMs: 250
  };
  for (const arg of argv) {
    if (arg.startsWith('--db=')) opts.dbPath = arg.slice(5);
    else if (arg.startsWith('--start=')) opts.start = arg.slice(8);
    else if (arg.startsWith('--end=')) opts.end = arg.slice(6);
    else if (arg.startsWith('--days=')) opts.days = Number(arg.slice(7));
    else if (arg.startsWith('--delay-ms=')) opts.delayMs = Number(arg.slice(11));
  }
  return opts;
}

function buildDateList(startStr, endStr, days) {
  const startMs = Date.parse(`${startStr}T00:00:00Z`);
  if (!Number.isFinite(startMs)) throw new Error(`Invalid --start date: ${startStr}`);

  let endMs;
  if (Number.isFinite(days) && days > 0) {
    endMs = startMs + (days - 1) * 86400000;
  } else if (endStr) {
    endMs = Date.parse(`${endStr}T00:00:00Z`);
    if (!Number.isFinite(endMs)) throw new Error(`Invalid --end date: ${endStr}`);
  } else {
    endMs = startMs + 89 * 86400000; // default 90-day winter block
  }

  const dates = [];
  for (let ms = startMs; ms <= endMs; ms += 86400000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS historical_telemetry (
      measure_id TEXT NOT NULL,
      date_time TEXT NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (measure_id, date_time)
    );
    CREATE INDEX IF NOT EXISTS idx_hist_measure_dt
      ON historical_telemetry (measure_id, date_time);
    CREATE TABLE IF NOT EXISTS archive_days (
      day TEXT PRIMARY KEY,
      row_count INTEGER NOT NULL,
      total_lines INTEGER NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
  return db;
}

async function fetchAndFilterDay(day) {
  const url = `https://environment.data.gov.uk/flood-monitoring/archive/readings-${day}.csv`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  if (!res.body) {
    throw new Error(`Empty body for ${url}`);
  }

  const rows = [];
  let totalLines = 0;
  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    totalLines++;
    if (totalLines === 1 && line.startsWith('dateTime,')) continue;
    const c1 = line.indexOf(',');
    if (c1 === -1) continue;
    const c2 = line.indexOf(',', c1 + 1);
    if (c2 === -1) continue;

    const dateTime = line.slice(0, c1);
    const measureUri = line.slice(c1 + 1, c2);
    const slash = measureUri.lastIndexOf('/');
    const measureId = slash >= 0 ? measureUri.slice(slash + 1) : measureUri;
    if (!MEASURE_IDS.has(measureId)) continue;

    const value = Number(line.slice(c2 + 1));
    if (!Number.isFinite(value)) continue;
    rows.push({ measureId, dateTime, value });
  }

  return { rows, totalLines };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dates = buildDateList(opts.start, opts.end, opts.days);
  const db = initDb(opts.dbPath);

  const hasDayStmt = db.prepare('SELECT row_count FROM archive_days WHERE day = ?');
  const insertRowStmt = db.prepare(
    'INSERT OR IGNORE INTO historical_telemetry (measure_id, date_time, value) VALUES (?, ?, ?)'
  );
  const markDayStmt = db.prepare(
    'INSERT OR REPLACE INTO archive_days (day, row_count, total_lines, fetched_at) VALUES (?, ?, ?, ?)'
  );
  const commitDayTx = db.transaction((day, rows, totalLines) => {
    for (const r of rows) {
      insertRowStmt.run(r.measureId, r.dateTime, r.value);
    }
    markDayStmt.run(day, rows.length, totalLines, new Date().toISOString());
  });

  let skipped = 0;
  let fetched = 0;
  let insertedTotal = 0;

  console.log(`Archive DB: ${opts.dbPath}`);
  console.log(`Date range: ${dates[0]} .. ${dates[dates.length - 1]} (${dates.length} days, ${MEASURE_IDS.size} target measures)`);

  for (let i = 0; i < dates.length; i++) {
    const day = dates[i];
    const existing = hasDayStmt.get(day);
    if (existing) {
      skipped++;
      continue;
    }

    const t0 = Date.now();
    const { rows, totalLines } = await fetchAndFilterDay(day);
    commitDayTx(day, rows, totalLines);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    fetched++;
    insertedTotal += rows.length;
    console.log(`[${i + 1}/${dates.length}] ${day}: kept ${rows.length} / ${totalLines} rows (${elapsedSec}s)`);

    if (opts.delayMs > 0 && i + 1 < dates.length) {
      await new Promise(r => setTimeout(r, opts.delayMs));
    }
  }

  const totalDbRows = db.prepare('SELECT COUNT(*) AS n FROM historical_telemetry').get().n;
  console.log(`Done. Fetched ${fetched} days (${insertedTotal} rows), skipped ${skipped} already-archived days. Total DB rows: ${totalDbRows}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
