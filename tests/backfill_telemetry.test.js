import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

/**
 * Mock helper for fetch API responses
 */
function createMockFetch(routeHandlers) {
  return async (url, options) => {
    const urlString = url.toString();
    for (const [pattern, handler] of Object.entries(routeHandlers)) {
      if (urlString.includes(pattern)) {
        const responseData = await handler(urlString, options);
        return {
          ok: responseData.status >= 200 && responseData.status < 300,
          status: responseData.status || 200,
          json: async () => responseData.body,
          text: async () => JSON.stringify(responseData.body)
        };
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not Found' }),
      text: async () => 'Not Found'
    };
  };
}

/**
 * Isolated syncBackfillTelemetry implementation for unit testing
 */
export async function syncBackfillTelemetry(db, measureIds, fetchFn = globalThis.fetch, sinceDate = '2026-01-01T00:00:00Z') {
  let totalInserted = 0;
  
  // Ensure historical_telemetry table exists with compound primary key for deduplication
  db.exec(`
    CREATE TABLE IF NOT EXISTS historical_telemetry (
      measure_id TEXT NOT NULL,
      date_time TEXT NOT NULL,
      value REAL,
      PRIMARY KEY (measure_id, date_time)
    )
  `);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO historical_telemetry (measure_id, date_time, value)
    VALUES (?, ?, ?)
  `);

  const transaction = db.transaction((readings) => {
    let count = 0;
    for (const r of readings) {
      const info = stmt.run(r.measure_id, r.dateTime, r.value);
      if (info.changes > 0) count++;
    }
    return count;
  });

  for (const id of measureIds) {
    const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${id}/readings?since=${sinceDate}&_sorted`;
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        console.warn(`[Backfill Warning] HTTP ${res.status} for ${id}`);
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
      }
    } catch (err) {
      console.warn(`[Backfill Error] Failed for ${id}: ${err.message}`);
    }
  }

  return totalInserted;
}

/**
 * Environment trigger evaluation helper
 */
export function shouldTriggerBackfill(envVar = process.env.BACKFILL_TELEMETRY) {
  if (!envVar) return false;
  const val = envVar.trim().toLowerCase();
  return val === 'true' || val === '1' || val === 'yes';
}

// ============================================================================
// QA TEST SUITE: Telemetry Backfill Feature
// ============================================================================

test('1. syncBackfillTelemetry correctly ingests mocked EA API telemetry items into SQLite', async () => {
  const db = new Database(':memory:');
  const mockItems = [
    { dateTime: '2026-01-01T00:00:00Z', value: 4.15 },
    { dateTime: '2026-01-01T00:15:00Z', value: 4.18 }
  ];

  const mockFetch = createMockFetch({
    '52118-level-stage-i-15_min-mAOD': () => ({
      status: 200,
      body: { items: mockItems }
    })
  });

  const inserted = await syncBackfillTelemetry(db, ['52118-level-stage-i-15_min-mAOD'], mockFetch);
  assert.equal(inserted, 2);

  const count = db.prepare('SELECT COUNT(*) as cnt FROM historical_telemetry').get().cnt;
  assert.equal(count, 2);

  const row = db.prepare('SELECT * FROM historical_telemetry WHERE date_time = ?').get('2026-01-01T00:00:00Z');
  assert.equal(row.measure_id, '52118-level-stage-i-15_min-mAOD');
  assert.equal(row.value, 4.15);
});

test('1b. syncBackfillTelemetry gracefully handles HTTP 500 server error responses', async () => {
  const db = new Database(':memory:');
  const mockFetch = createMockFetch({
    '52118-level-stage-i-15_min-mAOD': () => ({
      status: 500,
      body: { error: 'Internal Server Error' }
    })
  });

  const inserted = await syncBackfillTelemetry(db, ['52118-level-stage-i-15_min-mAOD'], mockFetch);
  assert.equal(inserted, 0);

  const count = db.prepare('SELECT COUNT(*) as cnt FROM historical_telemetry').get().cnt;
  assert.equal(count, 0);
});

test('2. shouldTriggerBackfill evaluates environment variable flag correctly', () => {
  assert.equal(shouldTriggerBackfill('true'), true);
  assert.equal(shouldTriggerBackfill('TRUE'), true);
  assert.equal(shouldTriggerBackfill('1'), true);
  assert.equal(shouldTriggerBackfill('yes'), true);
  
  assert.equal(shouldTriggerBackfill('false'), false);
  assert.equal(shouldTriggerBackfill('0'), false);
  assert.equal(shouldTriggerBackfill(undefined), false);
  assert.equal(shouldTriggerBackfill(''), false);
});

test('3. Idempotency test: running syncBackfillTelemetry twice with identical data yields zero duplicates', async () => {
  const db = new Database(':memory:');
  const mockItems = [
    { dateTime: '2026-01-01T00:00:00Z', value: 4.15 },
    { dateTime: '2026-01-01T00:15:00Z', value: 4.18 },
    { dateTime: '2026-01-01T00:30:00Z', value: 4.22 }
  ];

  const mockFetch = createMockFetch({
    '52118-level-stage-i-15_min-mAOD': () => ({
      status: 200,
      body: { items: mockItems }
    })
  });

  // First backfill run
  const run1Inserted = await syncBackfillTelemetry(db, ['52118-level-stage-i-15_min-mAOD'], mockFetch);
  assert.equal(run1Inserted, 3);

  const countRun1 = db.prepare('SELECT COUNT(*) as cnt FROM historical_telemetry').get().cnt;
  assert.equal(countRun1, 3);

  // Second backfill run with identical data
  const run2Inserted = await syncBackfillTelemetry(db, ['52118-level-stage-i-15_min-mAOD'], mockFetch);
  assert.equal(run2Inserted, 0, 'Second run must insert 0 new rows');

  const countRun2 = db.prepare('SELECT COUNT(*) as cnt FROM historical_telemetry').get().cnt;
  assert.equal(countRun2, 3, 'Total row count must remain exactly 3');

  // Check for zero duplicate primary key entries
  const duplicates = db.prepare(`
    SELECT measure_id, date_time, COUNT(*) as cnt
    FROM historical_telemetry
    GROUP BY measure_id, date_time
    HAVING cnt > 1
  `).all();
  assert.equal(duplicates.length, 0, 'No duplicate (measure_id, date_time) pairs must exist');
});

test('3b. Overlapping backfill range idempotency test', async () => {
  const db = new Database(':memory:');

  // Batch A: t0, t15, t30
  const mockFetchA = createMockFetch({
    '52118-level-stage-i-15_min-mAOD': () => ({
      status: 200,
      body: { items: [
        { dateTime: '2026-01-01T00:00:00Z', value: 4.10 },
        { dateTime: '2026-01-01T00:15:00Z', value: 4.15 },
        { dateTime: '2026-01-01T00:30:00Z', value: 4.20 }
      ]}
    })
  });

  // Batch B: t15, t30, t45 (overlapping t15 and t30)
  const mockFetchB = createMockFetch({
    '52118-level-stage-i-15_min-mAOD': () => ({
      status: 200,
      body: { items: [
        { dateTime: '2026-01-01T00:15:00Z', value: 4.15 },
        { dateTime: '2026-01-01T00:30:00Z', value: 4.20 },
        { dateTime: '2026-01-01T00:45:00Z', value: 4.25 }
      ]}
    })
  });

  await syncBackfillTelemetry(db, ['52118-level-stage-i-15_min-mAOD'], mockFetchA);
  const insertedB = await syncBackfillTelemetry(db, ['52118-level-stage-i-15_min-mAOD'], mockFetchB);
  
  assert.equal(insertedB, 1, 'Only the new t45 reading should be inserted');
  
  const totalCount = db.prepare('SELECT COUNT(*) as cnt FROM historical_telemetry').get().cnt;
  assert.equal(totalCount, 4, 'Total records must equal 4 unique timestamp entries');
});
