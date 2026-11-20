import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Hermetic isolated DB & camera buffer ([RULE-TEST-02]). Must be set before importing server.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rainfall-ingest-'));
process.env.DB_PATH = path.join(tmpDir, 'telemetry.db');
process.env.CAMERA_BUFFER_DIR = path.join(tmpDir, 'camera_buffer');

const {
  db,
  syncMeasure,
  syncRainfallMeasure,
  syncBackfillTelemetry,
  ingestRainfallBatch,
  getRainfallMeasureIds
} = await import('../server.js');
const { runMigrations, MIGRATIONS } = await import('../src/js/db_migrations.js');
const {
  rainfallReadingValue,
  sanitizeRainfallValue,
  validateEARainfallIngestPayload,
  filterCleanRainfallItems,
  validate
} = await import('../src/js/contracts/index.js');

const SAMPLE_RAINGAUGE_MEASURE = '52010-rainfall-tipping_bucket_raingauge-t-15_min-mm';

test('Migration v9: provisions historical_rainfall table & index cleanly from v8 and v0 in WAL mode', () => {
  // 1. Fresh DB from v0 -> v9
  const freshPath = path.join(tmpDir, 'fresh.db');
  const freshDb = new Database(freshPath);
  freshDb.pragma('journal_mode = WAL');
  const finalVersion = runMigrations(freshDb);

  assert.equal(finalVersion, 9);
  assert.equal(freshDb.pragma('journal_mode', { simple: true }), 'wal');

  const cols = freshDb.prepare('PRAGMA table_info(historical_rainfall)').all();
  const colNames = cols.map(c => c.name);
  assert.deepEqual(colNames, ['measure_id', 'date_time', 'rainfall_mm', 'ingested_at']);

  const pkCols = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
  assert.deepEqual(pkCols, ['measure_id', 'date_time']);

  const notNullCols = cols.filter(c => c.notnull === 1).map(c => c.name);
  assert.ok(notNullCols.includes('measure_id'));
  assert.ok(notNullCols.includes('date_time'));
  assert.ok(notNullCols.includes('rainfall_mm'));
  assert.ok(notNullCols.includes('ingested_at'));

  const indexes = freshDb.prepare("PRAGMA index_list('historical_rainfall')").all().map(i => i.name);
  assert.ok(indexes.includes('idx_historical_rainfall_measure_dt'));
  freshDb.close();

  // 2. Upgrade DB from v8 -> v9
  const upgradeDb = new Database(':memory:');
  for (let i = 0; i < 8; i++) {
    MIGRATIONS[i].up(upgradeDb);
  }
  upgradeDb.pragma('user_version = 8');
  assert.equal(runMigrations(upgradeDb), 9);
  assert.equal(runMigrations(upgradeDb), 9, 're-running migrations is idempotent');
  const upgradedTables = upgradeDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(upgradedTables.includes('historical_rainfall'));
  upgradeDb.close();
});

test('Contract: rainfallReadingValue enforces [0.0, 100.0] mm bounds and rejects faults', () => {
  for (const validVal of [0, 0.0, 0.2, 4.8, 100, 100.0, '0.4', '12.6']) {
    assert.equal(validate(rainfallReadingValue, validVal).valid, true, `expected ${JSON.stringify(validVal)} to pass`);
    assert.notEqual(sanitizeRainfallValue(validVal), null);
  }

  const invalidValues = [
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    -0.01,
    -99,
    100.01,
    236000,
    '',
    '   ',
    'abc',
    true,
    false,
    {},
    []
  ];

  for (const badVal of invalidValues) {
    assert.equal(validate(rainfallReadingValue, badVal).valid, false, `expected ${JSON.stringify(badVal)} to fail`);
    assert.equal(sanitizeRainfallValue(badVal), null, `expected sanitizeRainfallValue(${JSON.stringify(badVal)}) to return null`);
  }
});

test('Contract: validateEARainfallIngestPayload validates clean batches and rejects spikes/negatives/malformed dates', () => {
  const validPayload = {
    items: [
      { dateTime: '2026-11-18T10:00:00Z', value: 0.0 },
      { dateTime: '2026-11-18T10:15:00Z', value: 1.6 }
    ]
  };
  const validRes = validateEARainfallIngestPayload(validPayload, SAMPLE_RAINGAUGE_MEASURE);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.cleanItems.length, 2);
  assert.equal(validRes.cleanItems[1].rainfall_mm, 1.6);

  assert.equal(
    validateEARainfallIngestPayload({ items: [{ dateTime: '2026-11-18T10:00:00Z', value: -99 }] }, SAMPLE_RAINGAUGE_MEASURE).valid,
    false
  );
  assert.equal(
    validateEARainfallIngestPayload({ items: [{ dateTime: '2026-11-18T10:00:00Z', value: 150.5 }] }, SAMPLE_RAINGAUGE_MEASURE).valid,
    false
  );
  assert.equal(
    validateEARainfallIngestPayload({ items: [{ dateTime: 'not-a-date', value: 0.4 }] }, SAMPLE_RAINGAUGE_MEASURE).valid,
    false
  );
  assert.equal(validateEARainfallIngestPayload({}, SAMPLE_RAINGAUGE_MEASURE).valid, false);
  assert.equal(validateEARainfallIngestPayload(null, SAMPLE_RAINGAUGE_MEASURE).valid, false);
});

test('Resilient Batch Ingest: ingests 48-reading burst dump, filters individual sentinels, and stays isolated from telemetry_events [RULE-ENT-01]', async () => {
  // Build a 48-reading burst (12 hours of 15-min intervals) + 2 injected upstream sentinel faults
  const startMs = Date.parse('2026-11-18T00:00:00Z');
  const burstItems = [];
  for (let i = 0; i < 48; i++) {
    burstItems.push({
      dateTime: new Date(startMs + i * 15 * 60 * 1000).toISOString(),
      value: Number(((i % 5) * 0.2).toFixed(1))
    });
  }
  // Inject real-world EA sentinel/fault items inside the same burst
  burstItems.push({ dateTime: '2026-11-18T12:00:00Z', value: -99 });
  burstItems.push({ dateTime: '2026-11-18T12:15:00Z', value: null });
  burstItems.push({ dateTime: '2026-11-18T12:30:00Z', value: 236000 });

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ items: burstItems })
  });

  const clean = await syncMeasure(SAMPLE_RAINGAUGE_MEASURE, 192, mockFetch, db);
  assert.ok(Array.isArray(clean));
  assert.equal(clean.length, 48, 'all 48 valid burst readings must be ingested while 3 fault sentinels are filtered');

  const count = db.prepare('SELECT COUNT(*) AS n FROM historical_rainfall WHERE measure_id = ?').get(SAMPLE_RAINGAUGE_MEASURE).n;
  assert.equal(count, 48);

  // [RULE-ENT-01] Strict separation from telemetry_events and stage telemetry tables
  const eventsCount = db.prepare('SELECT COUNT(*) AS n FROM telemetry_events').get().n;
  assert.equal(eventsCount, 0, 'raingauge ingest must never create rows in telemetry_events');
  const stageRow = db.prepare('SELECT 1 FROM telemetry WHERE measure_id = ?').get(SAMPLE_RAINGAUGE_MEASURE);
  assert.equal(stageRow, undefined, 'raingauge ingest must not write into stage telemetry cache');

  // Idempotency: re-ingesting overlapping burst inserts 0 duplicates
  const duplicateBatchRes = ingestRainfallBatch(db, SAMPLE_RAINGAUGE_MEASURE, clean);
  assert.equal(duplicateBatchRes.inserted, 0);
  const countAfterDup = db.prepare('SELECT COUNT(*) AS n FROM historical_rainfall WHERE measure_id = ?').get(SAMPLE_RAINGAUGE_MEASURE).n;
  assert.equal(countAfterDup, 48);
});

test('Resilient Batch Ingest: handles HTTP 404/500 and invalid JSON envelopes cleanly', async () => {
  const measure2 = '52020-rainfall-tipping_bucket_raingauge-t-15_min-mm';

  const err404Fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.equal(await syncRainfallMeasure(measure2, 96, err404Fetch, db), null);

  const networkErrFetch = async () => { throw new Error('ECONNRESET'); };
  assert.equal(await syncRainfallMeasure(measure2, 96, networkErrFetch, db), null);

  const badEnvelope = filterCleanRainfallItems({ invalid: true }, measure2);
  assert.equal(badEnvelope.validEnvelope, false);
  assert.equal(badEnvelope.cleanItems.length, 0);
});

test('Backfill Worker: syncBackfillTelemetry backfills rainfall measures idempotently into historical_rainfall', async () => {
  const backfillMeasure = '52030-rainfall-tipping_bucket_raingauge-t-15_min-mm';
  const requestedUrls = [];

  const mockFetch = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { dateTime: '2026-11-10T00:00:00Z', value: 0.4 },
          { dateTime: '2026-11-10T00:15:00Z', value: 1.2 },
          { dateTime: '2026-11-10T00:30:00Z', value: -99 } // sentinel filtered
        ]
      })
    };
  };

  const insertedRun1 = await syncBackfillTelemetry(db, [backfillMeasure], mockFetch, '2026-11-10T00:00:00Z');
  assert.equal(insertedRun1, 2);
  assert.ok(requestedUrls[0].includes(`/measures/${backfillMeasure}/readings?since=2026-11-10T00:00:00Z`));

  const insertedRun2 = await syncBackfillTelemetry(db, [backfillMeasure], mockFetch, '2026-11-10T00:00:00Z');
  assert.equal(insertedRun2, 0, 'second backfill run must be idempotent with 0 duplicate inserts');

  const histStageCount = db.prepare('SELECT COUNT(*) AS n FROM historical_telemetry WHERE measure_id = ?').get(backfillMeasure).n;
  assert.equal(histStageCount, 0, 'rainfall backfill must not write to historical_telemetry');
});

test('SSOT helper: getRainfallMeasureIds extracts unique measure IDs defensively', () => {
  assert.deepEqual(getRainfallMeasureIds(null), []);
  assert.deepEqual(getRainfallMeasureIds(undefined), []);
  assert.deepEqual(
    getRainfallMeasureIds({
      a: { measure_id: '52010-rainfall-tipping_bucket_raingauge-t-15_min-mm' },
      b: { measureId: '52020-rainfall-tipping_bucket_raingauge-t-15_min-mm' },
      c: { measure_id: '52010-rainfall-tipping_bucket_raingauge-t-15_min-mm' },
      d: null
    }),
    [
      '52010-rainfall-tipping_bucket_raingauge-t-15_min-mm',
      '52020-rainfall-tipping_bucket_raingauge-t-15_min-mm'
    ]
  );
});

test('Direct ingestRainfallBatch: skips invalid dateTime and empty targetMeasureId cleanly', () => {
  const validMeasure = '52040-rainfall-tipping_bucket_raingauge-t-15_min-mm';
  const res = ingestRainfallBatch(db, '   ', [
    { dateTime: 'not-a-date', value: 0.4, measure_id: validMeasure },
    { dateTime: '2026-11-18T14:00:00Z', value: 0.6 }, // empty fallback measureId and missing item.measure_id
    { dateTime: '2026-11-18T14:15:00Z', value: 0.8, measure_id: '   ' }, // whitespace item.measure_id + empty fallback
    { dateTime: ' 2026-11-18T14:30:00Z ', value: 1.0, measure_id: ` ${validMeasure} ` }
  ]);

  assert.deepEqual(res, { attempted: 4, inserted: 1, skipped: 3 });

  const rows = db.prepare('SELECT measure_id, date_time, rainfall_mm FROM historical_rainfall WHERE measure_id = ?').all(validMeasure);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date_time, '2026-11-18T14:30:00Z');
  assert.equal(rows[0].rainfall_mm, 1.0);
});

test.after(() => {
  if (db && db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
