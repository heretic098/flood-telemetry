import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hermetic: isolated DB and camera buffer ([RULE-TEST-02]). Must be set before importing server.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'west-sedgemoor-'));
process.env.DB_PATH = path.join(tmpDir, 'telemetry.db');
process.env.CAMERA_BUFFER_DIR = path.join(tmpDir, 'camera_buffer');

const { syncAllTelemetry, db } = await import('../server.js');
const { STATION_REGISTRY, extractStationStage } = await import('../src/js/hydro_engine.js');

const SUMP_MEASURE = '52155-level-sump_level-i-15_min-mAOD';

test('West Sedgemoor PS sump level (52155) is ingested and stored like other measures', async () => {
  const requested = [];
  const mockFetch = async (url) => {
    requested.push(url);
    const isSump = url.includes(SUMP_MEASURE);
    return {
      ok: true,
      json: async () => ({
        items: isSump
          ? [
              { dateTime: '2026-11-17T21:30:00Z', measure: `https://environment.data.gov.uk/flood-monitoring/id/measures/${SUMP_MEASURE}`, value: 4.631 },
              { dateTime: '2026-11-17T21:15:00Z', measure: `https://environment.data.gov.uk/flood-monitoring/id/measures/${SUMP_MEASURE}`, value: 4.62 }
            ]
          : []
      })
    };
  };

  await syncAllTelemetry(2, mockFetch);

  assert.ok(
    requested.some(u => u === `https://environment.data.gov.uk/flood-monitoring/id/measures/${SUMP_MEASURE}/readings?_sorted&_limit=2`),
    'sump level measure must be requested from the EA readings endpoint'
  );

  const row = db.prepare('SELECT readings_json FROM telemetry WHERE measure_id = ?').get(SUMP_MEASURE);
  assert.ok(row, 'latest readings must be stored in telemetry');
  assert.equal(JSON.parse(row.readings_json)[0].value, 4.631);

  const hist = db.prepare('SELECT COUNT(*) AS n FROM historical_telemetry WHERE measure_id = ?').get(SUMP_MEASURE);
  assert.equal(hist.n, 2, 'readings must be written to historical_telemetry for later fallback/threshold work');
});

test('52155 is ingest-only: not yet a registry station, so no stage is derived from it', () => {
  assert.equal(STATION_REGISTRY['52155'], undefined);
  assert.equal(extractStationStage({ [SUMP_MEASURE]: [{ value: 4.631 }] }, '52155'), null);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
