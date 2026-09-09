import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.argv[2] || process.env.DB_PATH || path.join(__dirname, '..', 'telemetry.db');

console.log(`================================================================`);
console.log(` Somerset Levels Flood Dashboard - Telemetry Backfill Verification`);
console.log(` DB Path: ${dbPath}`);
console.log(` Timestamp: ${new Date().toISOString()}`);
console.log(`================================================================\n`);

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (err) {
  console.error(`[Error] Failed to open SQLite database at ${dbPath}: ${err.message}`);
  process.exit(1);
}

// 1. Table existence check
const tableExists = db.prepare(`
  SELECT count(*) as cnt FROM sqlite_master 
  WHERE type='table' AND (name='historical_telemetry' OR name='telemetry')
`).get().cnt;

if (!tableExists) {
  console.error(`[FAIL] Neither 'historical_telemetry' nor 'telemetry' table found in database.`);
  process.exit(1);
}

const targetTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='historical_telemetry'`).get() 
  ? 'historical_telemetry' 
  : 'telemetry';

console.log(`[Info] Validating telemetry records in table: '${targetTable}'\n`);

let overallSuccess = true;

if (targetTable === 'historical_telemetry') {
  // 2. Count and Range per Measure
  const summaryStmt = db.prepare(`
    SELECT 
      measure_id, 
      COUNT(*) as total_records,
      MIN(date_time) as min_dateTime,
      MAX(date_time) as max_dateTime
    FROM historical_telemetry
    GROUP BY measure_id
    ORDER BY measure_id
  `);

  const summary = summaryStmt.all();

  console.log(`--- [1/3] Measure Statistics & Coverage ---`);
  if (summary.length === 0) {
    console.warn(`[WARNING] No telemetry rows found in table '${targetTable}'.`);
    overallSuccess = false;
  } else {
    for (const row of summary) {
      console.log(`Station/Measure: ${row.measure_id}`);
      console.log(`  └ Total Readings : ${row.total_records.toLocaleString()}`);
      console.log(`  └ Date Range     : ${row.min_dateTime}  --->  ${row.max_dateTime}`);
    }
  }

  // 3. Duplicate Detection Query
  console.log(`\n--- [2/3] Duplicate Telemetry Detection ---`);
  const dupsStmt = db.prepare(`
    SELECT measure_id, date_time, COUNT(*) as cnt
    FROM historical_telemetry
    GROUP BY measure_id, date_time
    HAVING cnt > 1
  `);
  const duplicates = dupsStmt.all();
  if (duplicates.length === 0) {
    console.log(`[PASS] 0 Duplicate (measure_id, date_time) records found.`);
  } else {
    console.error(`[FAIL] ${duplicates.length} duplicate timestamp records detected!`);
    console.error(duplicates.slice(0, 5));
    overallSuccess = false;
  }

  // 4. Data Gap Analysis (gaps > 30 minutes)
  console.log(`\n--- [3/3] Telemetry Data Gap Analysis (> 30 min intervals) ---`);
  const rowsStmt = db.prepare(`
    SELECT measure_id, date_time 
    FROM historical_telemetry 
    ORDER BY measure_id, date_time ASC
  `);
  const allRows = rowsStmt.all();

  let gapCount = 0;
  let lastTimeByMeasure = {};

  for (const row of allRows) {
    const currentTime = new Date(row.date_time).getTime();
    if (lastTimeByMeasure[row.measure_id]) {
      const diffMs = currentTime - lastTimeByMeasure[row.measure_id];
      const diffMinutes = diffMs / (1000 * 60);
      if (diffMinutes > 30) {
        gapCount++;
        if (gapCount <= 5) {
          console.warn(`  [Gap] ${row.measure_id}: Gap of ${diffMinutes.toFixed(0)} mins detected between ${new Date(lastTimeByMeasure[row.measure_id]).toISOString()} and ${row.date_time}`);
        }
      }
    }
    lastTimeByMeasure[row.measure_id] = currentTime;
  }

  console.log(`[Summary] Total telemetry gaps (>30m) detected across all stations: ${gapCount}`);

} else {
  // Operational telemetry table summary
  const rows = db.prepare(`SELECT measure_id, readings_json, updated_at FROM telemetry`).all();
  console.log(`--- Operational Telemetry Table Summary ---`);
  console.log(`Total active measures stored: ${rows.length}`);
  for (const r of rows) {
    const items = JSON.parse(r.readings_json);
    const minTime = items[items.length - 1]?.dateTime || 'N/A';
    const maxTime = items[0]?.dateTime || 'N/A';
    console.log(`Measure ${r.measure_id}: ${items.length} readings (${minTime} to ${maxTime})`);
  }
}

console.log(`\n================================================================`);
if (overallSuccess) {
  console.log(` VERIFICATION RESULT: PASS (Telemetry integrity verified)`);
  console.log(`================================================================\n`);
  process.exit(0);
} else {
  console.error(` VERIFICATION RESULT: FAIL (Integrity violations detected)`);
  console.error(`================================================================\n`);
  process.exit(1);
}
