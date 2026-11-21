/**
 * Hermetic Test Suite: EA Raingauge SSOT Registry & Temporal Rolling Accumulators
 * (Issues #61 & #64)
 *
 * Verifies:
 * 1. RAINGAUGE_REGISTRY SSOT structure, OGL v3.0 provenance, 0.20mm tip resolution,
 *    catchment zone coverage, non-civil-entity separation ([RULE-ENT-01]), and
 *    null unsurveyed elevation handling ([RULE-THRESH-01]).
 * 2. Rolling window accumulator monotonicity (0 <= R_1h <= R_6h <= R_24h <= R_48h),
 *    exact window cutoffs, duplicate deduplication, out-of-order burst sorting,
 *    and missing interval resilience.
 * 3. Defensive sanitization against null, undefined, booleans, empty strings, NaN,
 *    negative EA fault sentinels (-99), and >100mm electrical spikes.
 * 4. Standardized intensity classification (DRY, LIGHT, MODERATE, HEAVY, TORRENTIAL)
 *    and orthogonal indigo/violet color tokens (--precip-*).
 * 5. British Summer Time (BST +01:00) / UTC DST transition invariance and clock drift.
 * 6. Anomaly flags: FREEZING_RISK (<= 1.0°C) and STALE_BATCH (> maxStaleMinutes).
 * 7. Catchment spatial arithmetic mean aggregation across tone_upland, parrett_upland,
 *    isle_upland, and moors_lowland (plus lowland_levels alias), excluding offline
 *    gauges while including active dry (0.0mm) gauges.
 * 8. Strict ban on volumetric runoff / discharge keys ([RULE-CALC-01]).
 * 9. Empirical rainfall-to-stage cross-correlation lag measurement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATION_REGISTRY,
  RAINGAUGE_PROVENANCE,
  PRECIPITATION_PALETTE,
  RAINFALL_CATCHMENT_ZONES,
  RAINGAUGE_REGISTRY,
  RAINFALL_INTERVAL_BOUNDS_MM,
  RAINFALL_INTENSITY_TIERS,
  FREEZING_RISK_TEMP_C,
  DEFAULT_RAINGAUGE_STALE_MINUTES,
  sanitizeRainfallReadingValue,
  classifyRainfallIntensity,
  buildRainfallSeries15Min,
  computeRainfallAccumulators,
  aggregateCatchmentRainfall,
  computeEmpiricalCatchmentLag
} from '../src/js/hydro_engine.js';
import { getRainfallMeasureIds } from '../src/js/api/rainfall_ingest.js';

const FORBIDDEN_VOLUMETRIC_KEY_REGEX = /cumec|m3_s|m3s|discharge|volumetric|runoff_m3|megalitre/i;

function assertNoForbiddenVolumetricKeys(obj, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    assert.ok(
      !FORBIDDEN_VOLUMETRIC_KEY_REGEX.test(k),
      `[RULE-CALC-01] Forbidden volumetric key '${k}' found at ${path}.${k}`
    );
    if (v && typeof v === 'object') {
      assertNoForbiddenVolumetricKeys(v, `${path}.${k}`);
    }
  }
}

test('Issue #61: RAINGAUGE_REGISTRY codifies 14 verified EA TBR stations across all catchment zones with OGL v3.0 provenance', () => {
  const entries = Object.values(RAINGAUGE_REGISTRY);
  assert.equal(
    entries.length,
    14,
    `Expected 14 curated TBR stations in RAINGAUGE_REGISTRY, found ${entries.length}`
  );
  assert.equal(Object.isFrozen(RAINGAUGE_REGISTRY), true, 'RAINGAUGE_REGISTRY must be frozen');

  const measureIds = getRainfallMeasureIds();
  assert.equal(measureIds.length, entries.length, 'getRainfallMeasureIds() must extract all unique measure_ids');

  const catchmentsSeen = new Set();
  for (const [key, station] of Object.entries(RAINGAUGE_REGISTRY)) {
    assert.equal(station.id, key, `Registry key ${key} must match station.id`);
    assert.equal(station.notation, key, `Station ${key} notation must match id`);
    assert.ok(
      /^[A-Za-z0-9]+-rainfall-tipping_bucket_raingauge-t-15_min-mm$/.test(station.measure_id),
      `Station ${key} measure_id '${station.measure_id}' must follow canonical EA 15-min TBR notation`
    );
    assert.equal(station.tip_resolution_mm, 0.20, `Station ${key} must specify 0.20mm tip resolution`);
    assert.equal(station.interval_minutes, 15, `Station ${key} must specify 15-minute cadence`);
    assert.equal(station.period_seconds, 900, `Station ${key} must specify 900s period`);
    assert.equal(station.unit, 'mm', `Station ${key} must report in mm`);
    assert.equal(station.is_civil_asset, false, `[RULE-ENT-01] Station ${key} must not be a civil state-machine entity`);
    assert.equal(station.sensor_classification, 'ambient_environmental_sensor');

    // [RULE-THRESH-01] EA API does not publish surveyed collector mAOD elevation for TBR stations
    assert.equal(
      station.elevation_mAOD,
      null,
      `[RULE-THRESH-01] Station ${key} elevation_mAOD must remain null (UNSURVEYED) without primary EA survey`
    );
    assert.equal(station.survey_status, 'UNSURVEYED');

    // Coordinates & correlated river station
    assert.ok(station.lat > 50.7 && station.lat < 51.3, `Station ${key} latitude ${station.lat} must be in Somerset region`);
    assert.ok(station.long > -3.5 && station.long < -2.4, `Station ${key} longitude ${station.long} must be in Somerset region`);
    assert.ok(/^(ST|SY|SS)\d{6}$/.test(station.grid_reference), `Station ${key} must have valid OS grid reference`);
    assert.ok(
      STATION_REGISTRY[station.correlated_river_station_id],
      `Station ${key} correlated_river_station_id '${station.correlated_river_station_id}' must exist in STATION_REGISTRY`
    );

    // OGL v3.0 provenance
    assert.ok(station.provenance.licence.includes('Open Government Licence v3.0'));
    assert.ok(station.provenance.attribution.includes('Crown copyright'));

    catchmentsSeen.add(station.catchment);
    assertNoForbiddenVolumetricKeys(station, `RAINGAUGE_REGISTRY.${key}`);
  }

  assert.ok(catchmentsSeen.has('tone_upland'), 'Must include tone_upland stations');
  assert.ok(catchmentsSeen.has('parrett_upland'), 'Must include parrett_upland stations');
  assert.ok(catchmentsSeen.has('isle_upland'), 'Must include isle_upland stations');
  assert.ok(catchmentsSeen.has('moors_lowland'), 'Must include moors_lowland stations');
  assert.ok(RAINGAUGE_PROVENANCE.licence.includes('Open Government Licence v3.0'));
});

test('Issue #61 & #64: PRECIPITATION_PALETTE and classifyRainfallIntensity enforce orthogonal indigo/violet tokens and tier boundaries', () => {
  // Never collide with Estuarine Deep Blue (#0284c7) or life-safety red/amber
  const bannedColors = new Set(['#0284c7', '#ef4444', '#dc2626', '#f59e0b', '#d97706']);
  for (const entry of Object.values(PRECIPITATION_PALETTE)) {
    assert.ok(!bannedColors.has(entry.hex.toLowerCase()), `Palette color ${entry.hex} must not collide with estuarine blue or alert red/amber`);
  }
  assert.equal(RAINFALL_INTENSITY_TIERS.length, 5);

  assert.equal(classifyRainfallIntensity(0.0).code, 'DRY');
  assert.equal(classifyRainfallIntensity(null).code, 'DRY');
  assert.equal(classifyRainfallIntensity(-1.5).code, 'DRY');
  assert.equal(classifyRainfallIntensity(0.04).code, 'DRY');
  assert.equal(classifyRainfallIntensity(0.05).code, 'DRY');
  assert.equal(classifyRainfallIntensity(0.05).rate_label, 'Dry (0.0 mm/h)');

  assert.equal(classifyRainfallIntensity(0.1).code, 'LIGHT');
  assert.equal(classifyRainfallIntensity(0.2).code, 'LIGHT');
  assert.equal(classifyRainfallIntensity(2.4).code, 'LIGHT');
  assert.equal(classifyRainfallIntensity(2.45).code, 'LIGHT');
  assert.equal(classifyRainfallIntensity(2.45).rate_label, 'Light (2.4 mm/h)');

  assert.equal(classifyRainfallIntensity(2.5).code, 'MODERATE');
  assert.equal(classifyRainfallIntensity(6.0).code, 'MODERATE');
  assert.equal(classifyRainfallIntensity(9.9).code, 'MODERATE');

  assert.equal(classifyRainfallIntensity(10.0).code, 'HEAVY');
  assert.equal(classifyRainfallIntensity(18.4).code, 'HEAVY');
  assert.equal(classifyRainfallIntensity(24.9).code, 'HEAVY');

  assert.equal(classifyRainfallIntensity(25.0).code, 'TORRENTIAL');
  assert.equal(classifyRainfallIntensity(42.6).code, 'TORRENTIAL');
  assert.equal(classifyRainfallIntensity(42.6).color_hex, '#c084fc');
});

test('Issue #64: sanitizeRainfallReadingValue rejects nulls, booleans, negatives, NaNs, and fault spikes > 100mm', () => {
  assert.equal(RAINFALL_INTERVAL_BOUNDS_MM.min_mm, 0.0);
  assert.equal(RAINFALL_INTERVAL_BOUNDS_MM.max_mm, 100.0);

  assert.equal(sanitizeRainfallReadingValue(0), 0);
  assert.equal(sanitizeRainfallReadingValue(0.2), 0.2);
  assert.equal(sanitizeRainfallReadingValue('1.4'), 1.4);
  assert.equal(sanitizeRainfallReadingValue(100.0), 100.0);

  assert.equal(sanitizeRainfallReadingValue(null), null);
  assert.equal(sanitizeRainfallReadingValue(undefined), null);
  assert.equal(sanitizeRainfallReadingValue(false), null);
  assert.equal(sanitizeRainfallReadingValue(true), null);
  assert.equal(sanitizeRainfallReadingValue(''), null);
  assert.equal(sanitizeRainfallReadingValue('   '), null);
  assert.equal(sanitizeRainfallReadingValue(NaN), null);
  assert.equal(sanitizeRainfallReadingValue(Infinity), null);
  assert.equal(sanitizeRainfallReadingValue(-0.2), null);
  assert.equal(sanitizeRainfallReadingValue(-99), null);
  assert.equal(sanitizeRainfallReadingValue(100.1), null);
  assert.equal(sanitizeRainfallReadingValue(236000), null);
});

test('Issue #64: computeRainfallAccumulators enforces window boundaries, interval monotonicity, deduplication, and fault filtering', () => {
  const refIso = '2026-11-19T12:00:00Z';
  const refMs = Date.parse(refIso);
  const minMs = 60 * 1000;
  const hrMs = 3600 * 1000;

  const readings = [
    // Inside 1h window: (11:00, 12:00] -> 4 intervals at 12:00, 11:45, 11:30, 11:15
    { dateTime: new Date(refMs).toISOString(), value: 1.2 },
    { dateTime: new Date(refMs - 15 * minMs).toISOString(), value: 0.8 },
    { dateTime: new Date(refMs - 30 * minMs).toISOString(), value: 0.4 },
    { dateTime: new Date(refMs - 45 * minMs).toISOString(), value: 0.6 },
    // Duplicate timestamp at -15m (must be deduplicated, not double-counted)
    { dateTime: new Date(refMs - 15 * minMs).toISOString(), value: 0.8 },
    // Exactly at -60m (11:00:00Z) -> outside 1h window, inside 6h window
    { dateTime: new Date(refMs - 60 * minMs).toISOString(), value: 2.0 },
    // Inside 6h window (-3h)
    { dateTime: new Date(refMs - 3 * hrMs).toISOString(), value: 3.4 },
    // Inside 24h window (-12h)
    { dateTime: new Date(refMs - 12 * hrMs).toISOString(), value: 10.0 },
    // Inside 48h window (-36h)
    { dateTime: new Date(refMs - 36 * hrMs).toISOString(), value: 15.0 },
    // Outside 48h window (-50h)
    { dateTime: new Date(refMs - 50 * hrMs).toISOString(), value: 25.0 },
    // Corrupted / sentinel / spike records that must be ignored
    { dateTime: new Date(refMs - 10 * minMs).toISOString(), value: null },
    { dateTime: new Date(refMs - 20 * minMs).toISOString(), value: -99 },
    { dateTime: new Date(refMs - 25 * minMs).toISOString(), value: 999.9 },
    { dateTime: 'invalid-date', value: 5.0 },
    null
  ];

  const acc = computeRainfallAccumulators(readings, { nowMs: refMs });

  // 1h = 1.2 + 0.8 + 0.4 + 0.6 = 3.0 mm
  assert.equal(acc.last_1h_mm, 3.0);
  // 6h = 3.0 + 2.0 + 3.4 = 8.4 mm
  assert.equal(acc.last_6h_mm, 8.4);
  // 24h = 8.4 + 10.0 = 18.4 mm
  assert.equal(acc.last_24h_mm, 18.4);
  // 48h = 18.4 + 15.0 = 33.4 mm
  assert.equal(acc.last_48h_mm, 33.4);

  // Strict interval monotonicity: 0 <= R_1h <= R_6h <= R_24h <= R_48h
  assert.ok(acc.last_1h_mm >= 0);
  assert.ok(acc.last_1h_mm <= acc.last_6h_mm);
  assert.ok(acc.last_6h_mm <= acc.last_24h_mm);
  assert.ok(acc.last_24h_mm <= acc.last_48h_mm);

  assert.equal(acc.intensity_category, 'MODERATE');
  assert.equal(acc.rate_category, 'MODERATE');
  assert.equal(acc.is_stale, false);
  assert.equal(acc.freezing_risk, false);
  assert.equal(acc.age_minutes, 0);
  assert.equal(acc.rejected_reading_count, 5);

  // 24h series_15min must be sorted chronologically with rising cumulative_mm ending at last_24h_mm
  assert.equal(acc.series_15min.length, 7);
  for (let i = 1; i < acc.series_15min.length; i++) {
    assert.ok(
      Date.parse(acc.series_15min[i].timestamp) > Date.parse(acc.series_15min[i - 1].timestamp),
      'series_15min must be strictly ascending in time'
    );
    assert.ok(
      acc.series_15min[i].cumulative_mm >= acc.series_15min[i - 1].cumulative_mm,
      'series_15min cumulative_mm must be monotonically non-decreasing'
    );
  }
  assert.equal(acc.series_15min[acc.series_15min.length - 1].cumulative_mm, acc.last_24h_mm);
  assertNoForbiddenVolumetricKeys(acc);
});

test('Issue #64: computeRainfallAccumulators handles BST/GMT DST transitions and outstation clock drift accurately', () => {
  // UK Autumn DST fallback: 2026-10-25 01:00 BST (+01:00) -> 01:00 GMT (Z)
  const dstReadings = [
    { date_time: '2026-10-25T01:15:00+01:00', rainfall_mm: 1.0 }, // 00:15:00Z
    { date_time: '2026-10-25T01:45:00+01:00', rainfall_mm: 1.4 }, // 00:45:00Z
    { date_time: '2026-10-25T01:15:00Z', rainfall_mm: 2.0 },      // 01:15:00Z
    // Slight forward RTC clock drift (+45s ahead of reference 01:30:00Z)
    { date_time: '2026-10-25T01:30:45Z', rainfall_mm: 0.6 }
  ];

  const refMs = Date.parse('2026-10-25T01:30:00Z');
  const acc = computeRainfallAccumulators(dstReadings, { nowMs: refMs });

  // Within 1h of 01:30:00Z -> (00:30:00Z, 01:32:00Z] includes 00:45Z (1.4), 01:15Z (2.0), 01:30:45Z (0.6) = 4.0mm
  assert.equal(acc.last_1h_mm, 4.0);
  // Within 6h includes 00:15Z (1.0) as well -> 5.0mm
  assert.equal(acc.last_6h_mm, 5.0);
  assert.equal(acc.last_24h_mm, 5.0);
  assert.equal(acc.last_48h_mm, 5.0);
});

test('Issue #64: FREEZING_RISK and STALE_BATCH anomaly detection flags trigger at boundaries', () => {
  assert.equal(FREEZING_RISK_TEMP_C, 1.0);
  assert.equal(DEFAULT_RAINGAUGE_STALE_MINUTES, 120);

  const refMs = Date.parse('2026-11-19T18:00:00Z');
  const staleReading = [
    { dateTime: '2026-11-19T14:30:00Z', value: 0.4 } // 210 mins old (> 120m)
  ];

  const frozenStale = computeRainfallAccumulators(staleReading, {
    nowMs: refMs,
    ambientTempC: 1.0
  });
  assert.equal(frozenStale.is_stale, true);
  assert.equal(frozenStale.freezing_risk, true);
  assert.equal(frozenStale.age_minutes, 210);
  assert.ok(frozenStale.anomaly_flags.includes('STALE_BATCH'));
  assert.ok(frozenStale.anomaly_flags.includes('FREEZING_RISK'));

  const mildFresh = computeRainfallAccumulators(
    [{ dateTime: '2026-11-19T17:45:00Z', value: 0.2 }],
    { nowMs: refMs, ambientTempC: 1.1 }
  );
  assert.equal(mildFresh.is_stale, false);
  assert.equal(mildFresh.freezing_risk, false);
  assert.deepEqual(mildFresh.anomaly_flags, []);
});

test('Issue #64: aggregateCatchmentRainfall computes spatial arithmetic means, excludes offline gauges, and enforces [RULE-CALC-01]', () => {
  const refMs = Date.parse('2026-11-19T12:00:00Z');
  const t0 = new Date(refMs).toISOString();
  const t2h = new Date(refMs - 2 * 3600 * 1000).toISOString();
  const t12h = new Date(refMs - 12 * 3600 * 1000).toISOString();

  // Provide readings for 2 of 5 tone_upland stations (1 wet, 1 genuinely dry 0.0mm; 3 offline),
  // 1 parrett_upland station, 1 isle_upland station, and 2 moors_lowland stations.
  const readingsByStation = {
    '52100': [
      { dateTime: t0, value: 4.0 },
      { dateTime: t2h, value: 6.0 },
      { dateTime: t12h, value: 20.0 }
    ], // 1h=4.0, 6h=10.0, 24h=30.0
    '52101': [
      { dateTime: t0, value: 0.0 },
      { dateTime: t12h, value: 10.0 }
    ], // 1h=0.0, 6h=0.0, 24h=10.0
    // 45168, 45232, E14620 omitted (offline -> excluded from spatial mean denominator)
    '52148': [
      { dateTime: t0, value: 2.6 },
      { dateTime: t12h, value: 14.2 }
    ], // 1h=2.6, 24h=16.8
    '52129': [
      { dateTime: t0, value: 1.2 },
      { dateTime: t12h, value: 13.0 }
    ], // 1h=1.2, 24h=14.2
    '52147': [
      { dateTime: t0, value: 0.8 },
      { dateTime: t12h, value: 7.2 }
    ], // 1h=0.8, 24h=8.0
    '52227': [
      { dateTime: t0, value: 1.6 },
      { dateTime: t12h, value: 10.4 }
    ] // 1h=1.6, 24h=12.0
  };

  const result = aggregateCatchmentRainfall(readingsByStation, { nowMs: refMs });

  assert.deepEqual(
    Object.keys(result.catchments),
    ['tone_upland', 'parrett_upland', 'isle_upland', 'moors_lowland']
  );
  // Alias check: lowland_levels resolves to moors_lowland
  assert.equal(result.catchments.lowland_levels, result.catchments.moors_lowland);
  assert.ok(RAINFALL_CATCHMENT_ZONES.moors_lowland.alias_ids.includes('lowland_levels'));

  // tone_upland: 2 active stations (52100 with 30.0mm 24h, 52101 with 10.0mm 24h) -> mean 24h = 20.0mm, mean 1h = 2.0mm
  const tone = result.catchments.tone_upland;
  assert.equal(tone.station_count, 6);
  assert.equal(tone.active_station_count, 2);
  assert.equal(tone.mean_1h_mm, 2.0);
  assert.equal(tone.mean_6h_mm, 5.0);
  assert.equal(tone.mean_24h_mm, 20.0);
  assert.equal(tone.peak_24h_mm, 30.0);
  assert.equal(tone.peak_station_id, '52100');
  assert.equal(tone.rate_category, 'LIGHT');

  // parrett_upland: 3 registered stations (52148, 52103, 52149)
  assert.equal(result.catchments.parrett_upland.station_count, 3);

  // moors_lowland: 2 active stations (52147 with 8.0mm, 52227 with 12.0mm) -> mean 24h = 10.0mm, mean 1h = 1.2mm
  const moors = result.catchments.moors_lowland;
  assert.equal(moors.station_count, 4);
  assert.equal(moors.active_station_count, 2);
  assert.equal(moors.mean_1h_mm, 1.2);
  assert.equal(moors.mean_24h_mm, 10.0);
  assert.equal(moors.peak_station_id, '52227');

  // Basin summary block
  assert.equal(result.rainfall_summary.upland_peak_station_id, '52100');
  assert.equal(result.rainfall_summary.upland_peak_24h_mm, 30.0);
  assert.ok(result.rainfall_summary.basin_24h_mean_mm > 0);

  // Strict [RULE-CALC-01] check across entire aggregation payload
  assertNoForbiddenVolumetricKeys(result);
});

test('Issue #64: computeRainfallAccumulators rejects future-drifted timestamps from latest_timestamp, age_minutes, and valid_reading_count', () => {
  const refMs = Date.parse('2026-11-19T18:00:00Z');
  const sixHoursOldIso = '2026-11-19T12:00:00.000Z';
  const farFutureIso = '2027-01-01T00:00:00.000Z';

  // 1. Stale 6h-old reading + far-future reading must remain stale (age_minutes: 360)
  const mixed = computeRainfallAccumulators(
    [
      { dateTime: sixHoursOldIso, value: 0.4 },
      { dateTime: farFutureIso, value: 5.0 }
    ],
    { nowMs: refMs }
  );
  assert.equal(mixed.valid_reading_count, 1);
  assert.equal(mixed.rejected_reading_count, 1);
  assert.equal(mixed.latest_timestamp, sixHoursOldIso);
  assert.equal(mixed.age_minutes, 360);
  assert.equal(mixed.is_stale, true);
  assert.ok(mixed.anomaly_flags.includes('STALE_BATCH'));

  // 2. Only far-future readings -> returns stale empty shape
  const futureOnly = computeRainfallAccumulators(
    [{ dateTime: farFutureIso, value: 5.0 }],
    { nowMs: refMs, ambientTempC: 0.5 }
  );
  assert.equal(futureOnly.valid_reading_count, 0);
  assert.equal(futureOnly.rejected_reading_count, 1);
  assert.equal(futureOnly.latest_timestamp, null);
  assert.equal(futureOnly.age_minutes, null);
  assert.equal(futureOnly.is_stale, true);
  assert.ok(futureOnly.anomaly_flags.includes('STALE_BATCH'));
  assert.ok(futureOnly.anomaly_flags.includes('FREEZING_RISK'));
});

test('Issue #64: aggregateCatchmentRainfall excludes stale gauges (> maxStaleMinutes) from spatial-mean active denominators', () => {
  const refMs = Date.parse('2026-11-19T12:00:00Z');
  const liveIso = new Date(refMs).toISOString();
  const dead84hIso = new Date(refMs - 84 * 3600 * 1000).toISOString();

  // 1 live tone_upland gauge at 20.0 mm/h (HEAVY) + 5 dead 84h-old tone_upland gauges
  const readingsByStation = {
    '52100': [{ dateTime: liveIso, value: 20.0 }],
    '45168': [{ dateTime: dead84hIso, value: 0.4 }],
    '52101': [{ dateTime: dead84hIso, value: 0.2 }],
    '45232': [{ dateTime: dead84hIso, value: 0.6 }],
    'E14620': [{ dateTime: dead84hIso, value: 0.8 }],
    '51126': [{ dateTime: dead84hIso, value: 0.4 }]
  };

  const result = aggregateCatchmentRainfall(readingsByStation, { nowMs: refMs });
  const tone = result.catchments.tone_upland;

  assert.equal(tone.station_count, 6);
  assert.equal(tone.active_station_count, 1, 'Stale 84h-old gauges must be excluded from active_station_count');
  assert.equal(tone.mean_1h_mm, 20.0, 'Spatial mean must not be diluted by stale offline gauges');
  assert.equal(tone.rate_category, 'HEAVY');
  assert.equal(result.rainfall_summary.basin_1h_mean_mm, 20.0);
  assert.equal(result.rainfall_summary.rate_category, 'HEAVY');

  // Catchments with zero active gauges must report null peak_station and 0.0 peak totals
  const parrett = result.catchments.parrett_upland;
  assert.equal(parrett.active_station_count, 0);
  assert.equal(parrett.all_stale, true);
  assert.equal(parrett.peak_station, null);
  assert.equal(parrett.peak_station_id, null);
  assert.equal(parrett.peak_24h_mm, 0);

  // When all upland gauges are stale (6h old), upland_peak_station must be null
  const allStaleRes = aggregateCatchmentRainfall(
    { '52100': [{ dateTime: new Date(refMs - 6 * 3600 * 1000).toISOString(), value: 35.0 }] },
    { nowMs: refMs }
  );
  assert.equal(allStaleRes.catchments.tone_upland.active_station_count, 0);
  assert.equal(allStaleRes.catchments.tone_upland.peak_station, null);
  assert.equal(allStaleRes.catchments.tone_upland.peak_24h_mm, 0);
  assert.equal(allStaleRes.rainfall_summary.upland_peak_station, null);
  assert.equal(allStaleRes.rainfall_summary.upland_peak_station_id, null);
  assert.equal(allStaleRes.rainfall_summary.upland_peak_24h_mm, 0);
});

test('Issue #64: buildRainfallSeries15Min and computeEmpiricalCatchmentLag recover known synthetic lag without volumetric inference', () => {
  const startMs = Date.parse('2026-01-10T00:00:00Z');
  const stepMs = 15 * 60 * 1000;
  const trueLagSteps = 16; // 16 * 15m = 4.0 hours lag

  const rainSeries = [];
  const stageSeries = [];
  let currentStage = 5.20;

  // Generate 48 steps (12 hours) with a convective rainfall pulse at steps 4..10
  for (let i = 0; i < 48; i++) {
    const tIso = new Date(startMs + i * stepMs).toISOString();
    const rainMm = (i >= 4 && i <= 10) ? (4 - Math.abs(i - 7)) * 1.6 : 0.0;
    rainSeries.push({ dateTime: tIso, rainfall_mm: Number(rainMm.toFixed(2)) });
  }

  for (let i = 0; i < 48; i++) {
    const tIso = new Date(startMs + i * stepMs).toISOString();
    const laggedRainIdx = i - trueLagSteps;
    const laggedRain = (laggedRainIdx >= 0 && laggedRainIdx < rainSeries.length)
      ? rainSeries[laggedRainIdx].rainfall_mm
      : 0.0;
    // Stage rises proportionally to lagged rain (in metres)
    currentStage = Number((currentStage + laggedRain * 0.05).toFixed(4));
    stageSeries.push({ dateTime: tIso, value: currentStage });
  }

  const series24 = buildRainfallSeries15Min(rainSeries, {
    nowMs: startMs + 47 * stepMs
  });
  assert.equal(series24.length, 48);

  const lagResult = computeEmpiricalCatchmentLag(rainSeries, stageSeries, {
    minLagHours: 1.0,
    maxLagHours: 8.0,
    minSamplePairs: 16
  });

  assert.equal(lagResult.sufficient_data, true);
  assert.equal(lagResult.peak_lag_hours, 4.0);
  assert.ok(lagResult.peak_correlation_r > 0.95, `Expected high correlation r > 0.95, got ${lagResult.peak_correlation_r}`);
  assertNoForbiddenVolumetricKeys(lagResult);
});
