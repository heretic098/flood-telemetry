import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Hermetic isolated DB & camera buffer ([RULE-TEST-02]). Must be set before importing server.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-rainfall-schema-'));
process.env.DB_PATH = path.join(tmpDir, 'telemetry.db');
process.env.CAMERA_BUFFER_DIR = path.join(tmpDir, 'camera_buffer');

const { server, db, ingestRainfallBatch } = await import('../server.js');
const { RAINGAUGE_REGISTRY } = await import('../src/js/hydro_engine.js');
const {
  FORBIDDEN_CALC_KEYS,
  RAINFALL_FORBIDDEN_CALC_KEYS,
  validateApiRainfallPayload,
  validateApiStatusPayload
} = await import('../src/js/contracts/index.js');

const originalFetch = globalThis.fetch;
let testPort;
let baseUrl;

function httpGet(reqPath) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${reqPath}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

test.before(async () => {
  // Stub globalThis.fetch so /api/status syncAllTelemetry() never makes outbound EA HTTP calls ([RULE-TEST-02])
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({})
  });

  await new Promise((resolve) => {
    server.listen(0, () => {
      testPort = server.address().port;
      baseUrl = `http://localhost:${testPort}`;
      resolve();
    });
  });
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => {
    server.close(resolve);
  });
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /api/rainfall & /api/status handle empty historical_rainfall DB cleanly with null peak stations and full parity', async () => {
  db.prepare('DELETE FROM historical_rainfall').run();

  const res = await httpGet('/api/rainfall');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/json'));
  assert.ok(res.headers['cache-control'].includes('max-age=60'));

  const payload = JSON.parse(res.body);
  const validation = validateApiRainfallPayload(payload);
  assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join('; ')}`);

  assert.equal(payload.status, 'ok');
  assert.equal(payload.latest_rainfall_reading_at, null);
  assert.match(payload.provenance.licence, /Open Government Licence v3\.0/);
  assert.equal(payload.provenance.is_civil_state_machine_entity, false);

  assert.deepEqual(
    Object.keys(payload.catchments).sort(),
    ['isle_upland', 'moors_lowland', 'parrett_upland', 'tone_upland']
  );
  for (const c of Object.values(payload.catchments)) {
    assert.equal(c.active_station_count, 0);
    assert.equal(c.all_stale, true);
    assert.equal(c.mean_24h_mm, 0);
    assert.equal(c.peak_24h_mm, 0);
    assert.equal(c.peak_station, null, 'Empty DB catchment must not fabricate a peak_station');
    assert.equal(c.peak_station_id, null);
    assert.equal(c.peak_intensity_station, null);
    assert.equal(c.peak_intensity_station_id, null);
    assert.equal(c.rate_category, 'DRY');
  }

  assert.equal(payload.rainfall_summary.upland_peak_station, null);
  assert.equal(payload.rainfall_summary.upland_peak_station_id, null);
  assert.equal(payload.rainfall_summary.upland_peak_24h_mm, 0);
  assert.equal(payload.rainfall_summary.basin_24h_mean_mm, 0);
  assert.equal(payload.rainfall_summary.rate_category, 'DRY');

  assert.equal(payload.stations.length, Object.keys(RAINGAUGE_REGISTRY).length);
  for (const st of payload.stations) {
    assert.equal(st.elevation_mAOD, null);
    assert.equal(st.is_stale, true);
    assert.equal(st.age_minutes, null);
    assert.equal(st.latest_timestamp, null);
    assert.deepEqual(st.series_15min, []);
    assert.equal(st.last_1h_mm, 0);
    assert.equal(st.last_24h_mm, 0);
    assert.equal(st.intensity_category, 'DRY');
  }

  // Empty DB /api/status integration & parity
  const statusRes = await httpGet('/api/status');
  assert.equal(statusRes.status, 200);
  const statusPayload = JSON.parse(statusRes.body);
  const statusValidation = validateApiStatusPayload(statusPayload);
  assert.equal(statusValidation.valid, true, `Status errors: ${statusValidation.errors.join('; ')}`);
  assert.deepEqual(statusPayload.rainfall_summary, payload.rainfall_summary);
});

test('GET /api/rainfall & /api/status recover >50h fallback behind >10 future-drifted rows and return null peaks when all gauges are stale', async () => {
  db.prepare('DELETE FROM historical_rainfall').run();

  const nowMs = Date.now();
  const isoAgo = (minutes) => new Date(nowMs - minutes * 60 * 1000).toISOString();
  const stale72hIso = isoAgo(72 * 60);

  // 45168: 1 valid historical reading at -72h + 15 future-drifted readings (+15m..+225m)
  const futureBurst = Array.from({ length: 15 }, (_, idx) => ({
    dateTime: new Date(nowMs + (idx + 1) * 15 * 60 * 1000).toISOString(),
    rainfall_mm: 2.0
  }));
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['45168'].measure_id, [
    { dateTime: stale72hIso, rainfall_mm: 1.4 },
    ...futureBurst
  ]);

  // 52100: stale 6h-old reading with 35.0mm -> must remain stale and must NOT appear as active catchment/upland peak
  const stale6hIso = isoAgo(6 * 60);
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['52100'].measure_id, [
    { dateTime: stale6hIso, rainfall_mm: 35.0 }
  ]);

  const res = await httpGet('/api/rainfall');
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  const validation = validateApiRainfallPayload(payload);
  assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join('; ')}`);

  const hockworthy = payload.stations.find(s => s.id === '45168');
  assert.ok(hockworthy);
  assert.equal(hockworthy.is_stale, true);
  assert.equal(hockworthy.latest_timestamp, stale72hIso, 'Historical fallback must survive >10 future-drifted rows');
  assert.ok(hockworthy.age_minutes >= 4319);
  assert.equal(hockworthy.rejected_reading_count, 15);
  assert.equal(hockworthy.last_24h_mm, 0);

  const maundown = payload.stations.find(s => s.id === '52100');
  assert.ok(maundown);
  assert.equal(maundown.is_stale, true);
  assert.equal(maundown.last_24h_mm, 35.0);

  const tone = payload.catchments.tone_upland;
  assert.equal(tone.active_station_count, 0);
  assert.equal(tone.all_stale, true);
  assert.equal(tone.mean_24h_mm, 0);
  assert.equal(tone.peak_24h_mm, 0);
  assert.equal(tone.peak_station, null, 'All-stale catchment must not promote stale gauge as peak_station');
  assert.equal(tone.peak_station_id, null);

  assert.equal(payload.rainfall_summary.basin_24h_mean_mm, 0);
  assert.equal(payload.rainfall_summary.upland_peak_station, null);
  assert.equal(payload.rainfall_summary.upland_peak_station_id, null);
  assert.equal(payload.rainfall_summary.upland_peak_24h_mm, 0);

  const statusRes = await httpGet('/api/status');
  assert.equal(statusRes.status, 200);
  const statusPayload = JSON.parse(statusRes.body);
  assert.equal(validateApiStatusPayload(statusPayload).valid, true);
  assert.deepEqual(statusPayload.rainfall_summary, payload.rainfall_summary);
});

test('GET /api/rainfall & /api/status aggregate real historical_rainfall batches, isolate stale/future gauges, and preserve raw text', async () => {
  db.prepare('DELETE FROM historical_rainfall').run();

  const nowMs = Date.now();
  const isoAgo = (minutes) => new Date(nowMs - minutes * 60 * 1000).toISOString();
  const isoFuture = new Date(nowMs + 2 * 3600 * 1000).toISOString();

  // 52100 Maundown (tone_upland): 3.6mm in last 1h (MODERATE), 32.2mm total in 24h
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['52100'].measure_id, [
    { dateTime: isoAgo(15), rainfall_mm: 1.2 },
    { dateTime: isoAgo(30), rainfall_mm: 1.4 },
    { dateTime: isoAgo(45), rainfall_mm: 1.0 },
    { dateTime: isoAgo(180), rainfall_mm: 14.0 },
    { dateTime: isoAgo(600), rainfall_mm: 14.6 },
    // Future-drifted row (+2h): must be rejected by accumulator window
    { dateTime: isoFuture, rainfall_mm: 99.0 }
  ]);

  // 52101 Fulwood (tone_upland): 0.2mm in last 1h (LIGHT), 4.6mm total in 24h
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['52101'].measure_id, [
    { dateTime: isoAgo(20), rainfall_mm: 0.2 },
    { dateTime: isoAgo(240), rainfall_mm: 4.4 }
  ]);

  // 45168 Hockworthy (tone_upland): stale 72h-old gauge (outside 48h window) -> must NOT dilute tone_upland mean
  const stale72hIso = isoAgo(72 * 60);
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['45168'].measure_id, [
    { dateTime: stale72hIso, rainfall_mm: 1.8 }
  ]);

  // 52148 South Perrott (parrett_upland): stale 6h-old gauge -> excluded from active_station_count & peak
  const stale6hIso = isoAgo(6 * 60);
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['52148'].measure_id, [
    { dateTime: stale6hIso, rainfall_mm: 5.0 }
  ]);

  // 52129 Chard Snowdon Hill (isle_upland): 11.2mm in last 1h (HEAVY), 18.0mm total in 24h
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['52129'].measure_id, [
    { dateTime: isoAgo(10), rainfall_mm: 6.0 },
    { dateTime: isoAgo(25), rainfall_mm: 5.2 },
    { dateTime: isoAgo(300), rainfall_mm: 6.8 }
  ]);

  // 52147 West Sedgemoor (moors_lowland): 0.0mm in last 1h (DRY), 12.0mm total in 24h
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['52147'].measure_id, [
    { dateTime: isoAgo(15), rainfall_mm: 0.0 },
    { dateTime: isoAgo(360), rainfall_mm: 12.0 }
  ]);

  const res = await httpGet('/api/rainfall/');
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);

  const validation = validateApiRainfallPayload(payload);
  assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join('; ')}`);

  // 52100 Maundown assertions
  const maundown = payload.stations.find(s => s.id === '52100');
  assert.ok(maundown);
  assert.equal(maundown.is_stale, false);
  assert.equal(maundown.elevation_mAOD, null);
  assert.equal(maundown.last_1h_mm, 3.6);
  assert.equal(maundown.last_24h_mm, 32.2);
  assert.equal(maundown.intensity_category, 'MODERATE');
  assert.equal(maundown.rate_label, 'Steady (3.6 mm/h)');
  assert.equal(maundown.rejected_reading_count, 1, 'Future-drifted reading must be counted as rejected');
  assert.equal(maundown.series_15min.length, 5);
  assert.equal(maundown.series_15min[maundown.series_15min.length - 1].cumulative_mm, 32.2);
  assert.ok(typeof maundown.coordinates.lat === 'number' && typeof maundown.coordinates.long === 'number');

  // 45168 stale 72h gauge retains historical latest_timestamp & age_minutes while staying stale
  const hockworthy = payload.stations.find(s => s.id === '45168');
  assert.ok(hockworthy);
  assert.equal(hockworthy.is_stale, true);
  assert.equal(hockworthy.latest_timestamp, stale72hIso);
  assert.ok(hockworthy.age_minutes >= 4319);
  assert.equal(hockworthy.last_24h_mm, 0);
  assert.deepEqual(hockworthy.series_15min, []);
  assert.ok(hockworthy.anomaly_flags.includes('STALE_BATCH'));

  // Tone Upland spatial mean: only active 52100 (32.2) & 52101 (4.6) -> mean 24h = 18.4mm
  const tone = payload.catchments.tone_upland;
  assert.equal(tone.active_station_count, 2);
  assert.equal(tone.mean_24h_mm, 18.4);
  assert.equal(tone.peak_station_id, '52100');
  assert.equal(tone.all_stale, false);

  // Parrett Upland has only stale 6h gauge -> 0 active stations, all_stale = true, peak_station = null
  const parrett = payload.catchments.parrett_upland;
  assert.equal(parrett.active_station_count, 0);
  assert.equal(parrett.all_stale, true);
  assert.equal(parrett.peak_station, null);
  assert.equal(parrett.peak_24h_mm, 0);

  // Isle Upland heavy intensity
  const isle = payload.catchments.isle_upland;
  assert.equal(isle.active_station_count, 1);
  assert.equal(isle.rate_category, 'TORRENTIAL');

  // Raw unescaped text contract (no HTML entity double-escaping in JSON API)
  assert.ok(parrett.river.includes('&'), 'Raw "&" must not be HTML-escaped in API JSON');
  assert.ok(!parrett.river.includes('&amp;'));
  assert.ok(payload.catchments.moors_lowland.river.includes("'"), 'Raw apostrophe must not be escaped');
  assert.ok(!payload.catchments.moors_lowland.river.includes('&#39;'));
  assert.ok(payload.provenance.attribution.includes('©'));

  // /api/status full parity with /api/rainfall
  const statusRes = await httpGet('/api/status');
  assert.equal(statusRes.status, 200);
  const statusPayload = JSON.parse(statusRes.body);
  const statusValidation = validateApiStatusPayload(statusPayload);
  assert.equal(statusValidation.valid, true, `Status errors: ${statusValidation.errors.join('; ')}`);
  assert.deepEqual(statusPayload.rainfall_summary, payload.rainfall_summary);
});

test('Contract validation strictly rejects malformed /api/rainfall payloads and forbidden [RULE-CALC-01] keys', async () => {
  const res = await httpGet('/api/rainfall');
  const validBase = JSON.parse(res.body);
  assert.equal(validateApiRainfallPayload(validBase).valid, true);

  assert.equal(validateApiRainfallPayload(null).valid, false);
  assert.equal(validateApiRainfallPayload([]).valid, false);

  // 1. Forbidden volumetric keys anywhere in /api/rainfall [RULE-CALC-01]
  for (const key of new Set([...FORBIDDEN_CALC_KEYS, ...RAINFALL_FORBIDDEN_CALC_KEYS])) {
    const poisonedTop = structuredClone(validBase);
    poisonedTop[key] = 4.2;
    const topRes = validateApiRainfallPayload(poisonedTop);
    assert.equal(topRes.valid, false, `Must reject top-level forbidden key "${key}"`);
    assert.ok(topRes.errors.some(e => e.includes('[RULE-CALC-01]')));

    const poisonedStation = structuredClone(validBase);
    poisonedStation.stations[0][key] = 1.5;
    const stRes = validateApiRainfallPayload(poisonedStation);
    assert.equal(stRes.valid, false, `Must reject station forbidden key "${key}"`);

    const poisonedCatchment = structuredClone(validBase);
    poisonedCatchment.catchments.tone_upland[key] = 9.9;
    const catRes = validateApiRainfallPayload(poisonedCatchment);
    assert.equal(catRes.valid, false, `Must reject catchment forbidden key "${key}"`);
  }

  // 2. Forbidden key and non-monotonic means in /api/status rainfall_summary
  const statusWithForbidden = {
    status: 'ok',
    system_timestamps: {
      client_poll_at: '2026-11-19T12:00:00Z',
      db_synced_at: '2026-11-19T12:00:00Z',
      latest_ea_reading_at: '2026-11-19T12:00:00Z'
    },
    global_status: {
      counter_pill: 'SECURE',
      banner_text: 'ALL CLEAR',
      top_severity: 1,
      is_tide_locked: false
    },
    rainfall_summary: {
      basin_24h_mean_mm: 18.4,
      upland_peak_station: 'Maundown (Clatworthy / Brendon Hills)',
      upland_peak_24h_mm: 32.2,
      rate_category: 'MODERATE',
      discharge_m3s: 12.1
    },
    active_events: [],
    roads: {
      summary: { total: 8, passable: 8, encroaching: 0, impassable: 0 },
      corridors_list: []
    }
  };
  const statusRes = validateApiStatusPayload(statusWithForbidden);
  assert.equal(statusRes.valid, false);
  assert.ok(statusRes.errors.some(e => e.includes('discharge_m3s')));

  const nonMonotonicSummaryStatus = structuredClone(statusWithForbidden);
  delete nonMonotonicSummaryStatus.rainfall_summary.discharge_m3s;
  nonMonotonicSummaryStatus.rainfall_summary.basin_1h_mean_mm = 20.0;
  assert.equal(validateApiStatusPayload(nonMonotonicSummaryStatus).valid, false);

  // 3. Invalid rate_category enum
  const badCategory = structuredClone(validBase);
  badCategory.rainfall_summary.rate_category = 'MONSOON';
  assert.equal(validateApiRainfallPayload(badCategory).valid, false);

  // 4. Rolling window monotonicity violation
  const nonMonotonicStation = structuredClone(validBase);
  nonMonotonicStation.stations[0].last_1h_mm = 10.0;
  nonMonotonicStation.stations[0].last_6h_mm = 5.0;
  assert.equal(validateApiRainfallPayload(nonMonotonicStation).valid, false);

  // 5. Non-monotonic series_15min cumulative_mm and duplicate timestamps
  const badSeries = structuredClone(validBase);
  badSeries.stations[0].series_15min = [
    { timestamp: '2026-11-19T10:00:00.000Z', rainfall_mm: 2.0, cumulative_mm: 2.0 },
    { timestamp: '2026-11-19T10:15:00.000Z', rainfall_mm: 1.0, cumulative_mm: 1.5 }
  ];
  assert.equal(validateApiRainfallPayload(badSeries).valid, false);

  const dupSeries = structuredClone(validBase);
  dupSeries.stations[0].series_15min = [
    { timestamp: '2026-11-19T10:00:00.000Z', rainfall_mm: 1.0, cumulative_mm: 1.0 },
    { timestamp: '2026-11-19T10:00:00.000Z', rainfall_mm: 1.0, cumulative_mm: 2.0 }
  ];
  assert.equal(validateApiRainfallPayload(dupSeries).valid, false);

  // 6. Non-stale station with null age_minutes, and UNSURVEYED station with non-null elevation_mAOD
  const badFreshness = structuredClone(validBase);
  badFreshness.stations[0].is_stale = false;
  badFreshness.stations[0].age_minutes = null;
  assert.equal(validateApiRainfallPayload(badFreshness).valid, false);

  const badElevation = structuredClone(validBase);
  badElevation.stations[0].survey_status = 'UNSURVEYED';
  badElevation.stations[0].elevation_mAOD = 45.2;
  assert.equal(validateApiRainfallPayload(badElevation).valid, false);

  // 7. Missing canonical catchment zone
  const missingCatchment = structuredClone(validBase);
  delete missingCatchment.catchments.isle_upland;
  assert.equal(validateApiRainfallPayload(missingCatchment).valid, false);
});

test('GET /api/rainfall?period=7d|30d|invalid returns adaptive bucketed series and honest archive coverage metadata', async () => {
  db.exec('DELETE FROM historical_rainfall');
  const nowMs = Date.now();
  const isoAgoHours = (h) => new Date(nowMs - h * 3600 * 1000).toISOString();

  // Seed 5 days of history for 52100 (so 7d & 30d are partial archives, 24h is full)
  ingestRainfallBatch(db, RAINGAUGE_REGISTRY['52100'].measure_id, [
    { dateTime: isoAgoHours(120), rainfall_mm: 8.0 },
    { dateTime: isoAgoHours(40), rainfall_mm: 4.0 },
    { dateTime: isoAgoHours(1), rainfall_mm: 1.6 }
  ]);

  const res7d = await httpGet('/api/rainfall?period=7d');
  assert.equal(res7d.status, 200);
  const json7d = JSON.parse(res7d.body);
  assert.equal(validateApiRainfallPayload(json7d).valid, true);
  assert.equal(json7d.period, '7d');
  assert.equal(json7d.bucket_minutes, 180);
  assert.equal(json7d.bucket_label, '3h');
  assert.equal(json7d.is_partial_archive, true);
  assert.ok(json7d.archive_coverage_hours >= 119 && json7d.archive_coverage_hours <= 121);
  const st7d = json7d.stations.find(s => s.id === '52100');
  assert.equal(st7d.period_total_mm, 13.6);
  assert.equal(st7d.last_24h_mm, 1.6);

  const res30d = await httpGet('/api/rainfall?period=30d');
  assert.equal(res30d.status, 200);
  const json30d = JSON.parse(res30d.body);
  assert.equal(validateApiRainfallPayload(json30d).valid, true);
  assert.equal(json30d.period, '30d');
  assert.equal(json30d.bucket_minutes, 1440);
  assert.equal(json30d.bucket_label, 'day');
  assert.equal(json30d.is_partial_archive, true);

  // Unknown period safely defaults to 24h
  const resInvalid = await httpGet('/api/rainfall?period=999y');
  assert.equal(resInvalid.status, 200);
  const jsonInvalid = JSON.parse(resInvalid.body);
  assert.equal(validateApiRainfallPayload(jsonInvalid).valid, true);
  assert.equal(jsonInvalid.period, '24h');
  assert.equal(jsonInvalid.bucket_minutes, 15);
  assert.equal(jsonInvalid.bucket_label, '15m');
});
