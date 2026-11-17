import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hermetic: isolated DB and camera buffer ([RULE-TEST-02]). Must be set before importing server.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hinkley-point-'));
process.env.DB_PATH = path.join(tmpDir, 'telemetry.db');
process.env.CAMERA_BUFFER_DIR = path.join(tmpDir, 'camera_buffer');

const { syncAllTelemetry, syncBackfillTelemetry, db } = await import('../server.js');
const { STATION_REGISTRY, extractStationStage } = await import('../src/js/hydro_engine.js');

const TIDE_MEASURE = '52106-level-tidal_level-i-15_min-mAOD';

test('Hinkley Point Tide Gauge (52106) is ingested and stored in telemetry and historical_telemetry', async () => {
  const requested = [];
  const mockFetch = async (url) => {
    requested.push(url);
    const isHinkley = url.includes(TIDE_MEASURE);
    return {
      ok: true,
      json: async () => ({
        items: isHinkley
          ? [
              { dateTime: '2026-11-17T21:30:00Z', measure: `https://environment.data.gov.uk/flood-monitoring/id/measures/${TIDE_MEASURE}`, value: 3.842 },
              { dateTime: '2026-11-17T21:15:00Z', measure: `https://environment.data.gov.uk/flood-monitoring/id/measures/${TIDE_MEASURE}`, value: 3.510 }
            ]
          : []
      })
    };
  };

  await syncAllTelemetry(2, mockFetch);

  assert.ok(
    requested.some(u => u === `https://environment.data.gov.uk/flood-monitoring/id/measures/${TIDE_MEASURE}/readings?_sorted&_limit=2`),
    'Hinkley Point tidal measure must be requested from the EA readings endpoint'
  );

  const row = db.prepare('SELECT readings_json FROM telemetry WHERE measure_id = ?').get(TIDE_MEASURE);
  assert.ok(row, 'latest readings must be stored in telemetry');
  assert.equal(JSON.parse(row.readings_json)[0].value, 3.842);

  const hist = db.prepare('SELECT COUNT(*) AS n FROM historical_telemetry WHERE measure_id = ?').get(TIDE_MEASURE);
  assert.equal(hist.n, 2, 'readings must be written to historical_telemetry');
});

test('Hinkley Point Tide Gauge (52106) is included in default backfill measures', async () => {
  const requested = [];
  const mockFetch = async (url) => {
    requested.push(url);
    return {
      ok: true,
      json: async () => ({
        items: url.includes(TIDE_MEASURE)
          ? [{ dateTime: '2026-11-10T12:00:00Z', value: 4.12 }]
          : []
      })
    };
  };

  await syncBackfillTelemetry(db, undefined, mockFetch, '2026-11-01T00:00:00Z');

  assert.ok(
    requested.some(u => u.includes(`/measures/${TIDE_MEASURE}/readings?`)),
    'Hinkley Point tidal measure must be requested during default backfill'
  );
});

test('52106 is ingest-only: not yet in STATION_REGISTRY, so no stage is derived from it', () => {
  assert.equal(STATION_REGISTRY['52106'], undefined);
  assert.equal(extractStationStage({ [TIDE_MEASURE]: [{ value: 3.842 }] }, '52106'), null);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
