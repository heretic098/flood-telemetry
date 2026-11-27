import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hermetic isolated DB & camera buffer ([RULE-TEST-02])
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidal-hygiene-qc-'));
process.env.DB_PATH = path.join(tmpDir, 'telemetry.db');
process.env.CAMERA_BUFFER_DIR = path.join(tmpDir, 'camera_buffer');

const { syncMeasure, syncBackfillTelemetry, db } = await import('../server.js');
const {
  STAGE_PLAUSIBILITY_MIN_M,
  STAGE_PLAUSIBILITY_MAX_M,
  sanitizeStageValue,
  evaluateStationFreshness,
  isTidalStationOrMeasure,
  TIDAL_MIN_FLATLINE_READINGS,
  DEFAULT_MIN_FLATLINE_READINGS,
  ASSET_DEFINITIONS,
  evaluateAssetTransition
} = await import('../src/js/hydro_engine.js');
const {
  validateEAIngestPayload,
  filterCleanStageItems,
  stageReadingValue
} = await import('../src/js/contracts/ea_telemetry_schema.js');

// ============================================================================
// 1. Hinkley Point (52106) & Bridgwater (52124) Low-Tide Bounds [-8.0, 100.0]
// ============================================================================

test('Bug 1: sanitizeStageValue and stageReadingValue accept Bristol Channel spring low tides down to -8.0 mAOD', () => {
  assert.equal(STAGE_PLAUSIBILITY_MIN_M, -8.0);
  assert.equal(STAGE_PLAUSIBILITY_MAX_M, 100.0);

  // Real observed low tides from 369-day EA archive
  assert.equal(sanitizeStageValue(-6.3), -6.3);    // Hinkley Point 52106 spring low tide
  assert.equal(sanitizeStageValue(-2.125), -2.125); // Bridgwater Tidal 52124 low water
  assert.equal(sanitizeStageValue(-8.0), -8.0);     // Inclusive lower bound
  assert.equal(sanitizeStageValue(76.14), 76.14);   // Greenham upper catchment

  // Out-of-bounds sentinels and electrical spikes rejected
  assert.equal(sanitizeStageValue(-8.01), null);
  assert.equal(sanitizeStageValue(-99), null);
  assert.equal(sanitizeStageValue(244514), null);
  assert.equal(sanitizeStageValue(Infinity), null);

  // Schema validator parity
  assert.equal(stageReadingValue.validate(-6.3).valid, true);
  assert.equal(stageReadingValue.validate(-2.125).valid, true);
  assert.equal(stageReadingValue.validate(-99).valid, false);
  assert.equal(stageReadingValue.validate(244514).valid, false);
  assert.equal(stageReadingValue.validate('1.23|1.24').valid, false);
  assert.equal(stageReadingValue.validate('').valid, false);
  assert.equal(stageReadingValue.validate(true).valid, false);
});

// ============================================================================
// 2. Per-Item Sanitization (No All-or-Nothing Batch Drops)
// ============================================================================

test('Bug 2: validateEAIngestPayload filters -99, 244514, and pipe-delimited BST corrupt items without dropping valid siblings', () => {
  const payload = {
    items: [
      { dateTime: '2026-10-25T01:45:00Z', value: -6.30 },
      { dateTime: '2026-10-25T01:30:00Z', value: -99 },             // 52106 sentinel
      { dateTime: '2026-10-25T01:15:00Z', value: 244514 },          // 52124 electrical spike
      { dateTime: '2026-10-25T01:00:00Z', value: '1.23|1.24' },     // BST pipe corruption
      { dateTime: '2026-10-25T00:45:00Z', value: -5.85 }
    ]
  };

  const res = validateEAIngestPayload(payload, '52106-level-tidal_level-i-15_min-mAOD');
  assert.equal(res.valid, true, 'Batch with valid siblings must succeed');
  assert.equal(res.errors.length, 0);
  assert.equal(res.rejectedCount, 3, 'Must quarantine exactly 3 corrupted readings');
  assert.equal(res.warnings.length, 3);
  assert.equal(res.cleanItems.length, 2, 'Must preserve both valid low-tide siblings');
  assert.equal(res.cleanItems[0].value, -6.30);
  assert.equal(res.cleanItems[1].value, -5.85);

  // Structural envelope errors remain fatal
  assert.equal(validateEAIngestPayload(null, '52106').valid, false);
  assert.equal(validateEAIngestPayload({ items: 'not-an-array' }, '52106').valid, false);
  assert.equal(filterCleanStageItems({}, '52106').validEnvelope, false);
});

test('Bug 2: syncMeasure and syncBackfillTelemetry persist only cleanItems into telemetry and historical_telemetry', async () => {
  const hinkleyId = '52106-level-tidal_level-i-15_min-mAOD';
  const bridgwaterId = '52124-level-tidal_level-i-15_min-mAOD';

  const mockFetch = async (url) => {
    if (url.includes(hinkleyId)) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { dateTime: '2026-11-20T06:00:00Z', value: -6.30 },
            { dateTime: '2026-11-20T05:45:00Z', value: -99 },
            { dateTime: '2026-11-20T05:30:00Z', value: -5.42 }
          ]
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        items: [
          { dateTime: '2026-11-20T06:00:00Z', value: -2.125 },
          { dateTime: '2026-11-20T05:45:00Z', value: 244514 },
          { dateTime: '2026-11-20T05:30:00Z', value: '1.15|1.18' },
          { dateTime: '2026-11-20T05:15:00Z', value: 0.45 }
        ]
      })
    };
  };

  // Test syncMeasure (live polling)
  const cleanLive = await syncMeasure(hinkleyId, 96, mockFetch, db);
  assert.equal(cleanLive.length, 2, 'syncMeasure must return only valid readings');
  const liveTelemetryRow = db.prepare('SELECT readings_json FROM telemetry WHERE measure_id = ?').get(hinkleyId);
  const parsedLive = JSON.parse(liveTelemetryRow.readings_json);
  assert.equal(parsedLive.length, 2, 'telemetry.readings_json must not contain quarantined -99 sentinel');
  assert.equal(parsedLive[0].value, -6.3);
  const liveHistRows = db.prepare('SELECT value FROM historical_telemetry WHERE measure_id = ? ORDER BY date_time DESC').all(hinkleyId);
  assert.deepEqual(liveHistRows.map(r => r.value), [-6.3, -5.42], 'historical_telemetry must store clean low-tide readings without NULL truncation');

  // Test syncBackfillTelemetry (28d backfill)
  const inserted = await syncBackfillTelemetry(db, [bridgwaterId], mockFetch, '2026-11-01T00:00:00Z');
  assert.equal(inserted, 2, 'syncBackfillTelemetry must insert only the 2 valid readings');
  const backfillRow = db.prepare('SELECT readings_json FROM telemetry WHERE measure_id = ?').get(bridgwaterId);
  const parsedBackfill = JSON.parse(backfillRow.readings_json);
  assert.equal(parsedBackfill.length, 2);
  const backfillHist = db.prepare('SELECT value FROM historical_telemetry WHERE measure_id = ? ORDER BY date_time DESC').all(bridgwaterId);
  assert.deepEqual(backfillHist.map(r => r.value), [-2.125, 0.45]);
});

// ============================================================================
// 3. Tidal-Specific Flatline & Stuck-High Fault Detection
// ============================================================================

test('Bug 3: isTidalStationOrMeasure identifies 52106, 52163, 52124 and tidal_level measures without matching inland gauges', () => {
  assert.equal(isTidalStationOrMeasure('52106'), true);
  assert.equal(isTidalStationOrMeasure('52163'), true);
  assert.equal(isTidalStationOrMeasure('52124'), true);
  assert.equal(isTidalStationOrMeasure('52106-level-tidal_level-i-15_min-mAOD'), true);
  assert.equal(isTidalStationOrMeasure('52163-level-tidal_level-i-15_min-mAOD'), true);
  assert.equal(isTidalStationOrMeasure('52124-level-tidal_level-i-15_min-mAOD'), true);

  // Inland gauges remain non-tidal
  assert.equal(isTidalStationOrMeasure('52118'), false);
  assert.equal(isTidalStationOrMeasure('52127'), false);
  assert.equal(isTidalStationOrMeasure('E9094'), false);
  assert.equal(TIDAL_MIN_FLATLINE_READINGS, 12);
  assert.equal(DEFAULT_MIN_FLATLINE_READINGS, 48);
});

test('Bug 3: tidal flatline detector catches 3h–4h freeze inside a 24h buffer without false-flagging normal 1.75h low-tide sill plateaus', () => {
  const nowMs = Date.parse('2026-10-09T07:15:00Z');

  // Case A: Hinkley 52106 frozen for 4.25h (17 readings @ 1.277m) preceded by normal dynamic tide
  const hinkleyFrozen = Array.from({ length: 96 }, (_, i) => ({
    measure_id: '52106-level-tidal_level-i-15_min-mAOD',
    dateTime: new Date(nowMs - i * 15 * 60 * 1000).toISOString(),
    value: i < 17 ? 1.277 : Number((3.5 * Math.sin(i / 4)).toFixed(3))
  }));
  const hinkleyRes = evaluateStationFreshness(hinkleyFrozen, { nowMs });
  assert.equal(hinkleyRes.isFlatlined, true, 'Must auto-detect tidal freeze from measure_id even inside a 96-reading buffer');
  assert.equal(hinkleyRes.isFresh, false);
  assert.equal(hinkleyRes.badgeClass, 'badge-flatlined');
  assert.ok(hinkleyRes.flatlineHours >= 4.0);

  // Case B: Dunball 52163 normal low-tide sill floor (7 identical readings = 1.75h @ 0.235m, then rising tide)
  const dunballLowTideSill = Array.from({ length: 48 }, (_, i) => ({
    dateTime: new Date(nowMs - i * 15 * 60 * 1000).toISOString(),
    value: i < 7 ? 0.235 : Number((0.235 + (i - 6) * 0.45).toFixed(3))
  }));
  const sillRes = evaluateStationFreshness(dunballLowTideSill, { nowMs, stationId: '52163' });
  assert.equal(sillRes.isFlatlined, false, 'Normal 1.75h Dunball low-tide sill floor must NOT false-trigger flatline');
  assert.equal(sillRes.isFresh, true);

  // Case C: Inland gauge with 17 static readings (4.25h) must NOT false-trigger (requires 48 readings = 12h)
  const inlandStatic4h = Array.from({ length: 96 }, (_, i) => ({
    dateTime: new Date(nowMs - i * 15 * 60 * 1000).toISOString(),
    value: i < 17 ? 4.50 : Number((4.50 + (i - 16) * 0.01).toFixed(3))
  }));
  const inlandRes = evaluateStationFreshness(inlandStatic4h, { nowMs, stationId: '52118' });
  assert.equal(inlandRes.isFlatlined, false, 'Inland river gauge must keep 12h (48-reading) flatline threshold');
  assert.equal(inlandRes.isFresh, true);
});

test('Bug 3: Dunball 52163 stuck-high plateau (>=3h @ 7.916m) suppresses false TIDE_LOCKED / surge alert in evaluateAssetTransition', () => {
  const nowMs = Date.parse('2026-07-10T04:45:00Z');
  const stuckHighSea = Array.from({ length: 24 }, (_, i) => ({
    dateTime: new Date(nowMs - i * 15 * 60 * 1000).toISOString(),
    value: i < 12 ? 7.916 : Number((5.5 - (i - 12) * 0.4).toFixed(3))
  }));
  const inlandNominal = [
    { dateTime: new Date(nowMs).toISOString(), value: 2.20 },
    { dateTime: new Date(nowMs - 15 * 60 * 1000).toISOString(), value: 2.21 }
  ];

  const transition = evaluateAssetTransition(
    ASSET_DEFINITIONS.dunball_outfall,
    null,
    { sea: stuckHighSea, inland: inlandNominal },
    null,
    { nowMs }
  );

  assert.equal(transition.action, 'NONE', 'Stuck-high flatlined sea sensor must NOT open a false TIDE_LOCKED/surge event');
  assert.equal(transition.to_state, 'DISCHARGING');
  assert.equal(transition.severity_tier, 1);
  assert.ok(transition.narrative.includes('flatlined'), 'Narrative must explain flatlined sea sensor suppression');
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
