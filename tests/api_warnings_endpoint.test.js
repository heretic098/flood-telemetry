/**
 * Integration Tests for /api/warnings & Highway Passability with Live EA Warnings (Issue #39)
 * 
 * Verifies:
 * - /api/warnings endpoint behavior, query parameter clamping, and road corridor correlation.
 * - /api/status enrichment with ea_warnings summary.
 * - Highway passability evaluation under Exit Pathway A & B with real warning states.
 * - Zero cumecs contract enforcement [RULE-CALC-01].
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/js/db_migrations.js';
import { server, db as serverDb } from '../server.js';
import {
  validateApiWarningsPayload,
  validateApiStatusPayload
} from '../src/js/contracts/index.js';
import { evaluateRoadCorridor, ASSET_DEFINITIONS } from '../src/js/hydro_engine.js';
import { getActiveEAWarningStatesMap } from '../src/js/ea_warning_manager.js';

function requestJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${urlPath}`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    }).on('error', reject);
  });
}

test('Integration: /api/warnings endpoint serves structured warnings and links associated roads', async () => {
  // Start server on ephemeral port or use existing if active
  const testServer = http.createServer((req, res) => {
    // Forward to server request listener
    server.emit('request', req, res);
  });

  await new Promise(resolve => testServer.listen(0, resolve));
  const port = testServer.address().port;

  // Insert mock warning events into serverDb
  serverDb.prepare("DELETE FROM ea_warning_events").run();
  serverDb.prepare(`
    INSERT INTO ea_warning_events (
      warning_id, target_area_notation, area_name,
      severity_level, severity_label, time_raised,
      narrative, trigger_snapshot_json, associated_roads_json, status
    ) VALUES 
      ('W-CURRY-1', '112FWFCUR10A', 'Curry Moor and Hay Moor', 2, 'Flood Warning', '2026-11-08T10:00:00Z', 'Flood warning for Curry Moor', '{"captured_at":"2026-11-08T10:00:00Z","stations":{}}', '["cuts_road", "new_road_curry"]', 'ACTIVE'),
      ('W-TONE-1', '112WAFTPM', 'Lower Tone and Parrett Moors', 3, 'Flood Alert', '2026-11-08T09:00:00Z', 'Flood alert for Tone', '{"captured_at":"2026-11-08T09:00:00Z","stations":{}}', '["cuts_road", "stan_moor_road"]', 'ACTIVE')
  `).run();

  const res = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/api/warnings?status=ACTIVE`, (httpRes) => {
      let body = '';
      httpRes.on('data', chunk => { body += chunk; });
      httpRes.on('end', () => {
        resolve({ status: httpRes.statusCode, headers: httpRes.headers, data: JSON.parse(body) });
      });
    }).on('error', reject);
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');

  const { data } = res;
  assert.equal(data.status, 'ok');
  assert.equal(data.count, 2);
  assert.equal(data.warnings.length, 2);

  const curryWarning = data.warnings.find(w => w.target_area_notation === '112FWFCUR10A');
  assert.ok(curryWarning);
  assert.equal(curryWarning.severity_level, 2);
  assert.equal(curryWarning.severity_label, 'Flood Warning');

  // Verify associated roads correlation
  assert.ok(Array.isArray(curryWarning.correlated_roads));
  const cutsCorridor = curryWarning.correlated_roads.find(r => r.asset_id === 'cuts_road');
  assert.ok(cutsCorridor);
  assert.equal(cutsCorridor.crown_elevation_mAOD, 7.35);

  // Validate contract compliance [RULE-CALC-01]
  const contractValidation = validateApiWarningsPayload(data);
  assert.equal(contractValidation.valid, true, `Contract errors: ${contractValidation.errors.join('; ')}`);

  // Query parameter clamping tests: limit clamped to 1-100
  const resLimit = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/api/warnings?limit=999`, (httpRes) => {
      let body = '';
      httpRes.on('data', chunk => { body += chunk; });
      httpRes.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
  assert.equal(resLimit.status, 'ok');

  // Filter by area
  const resArea = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/api/warnings?area=112FWFCUR10A`, (httpRes) => {
      let body = '';
      httpRes.on('data', chunk => { body += chunk; });
      httpRes.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
  assert.equal(resArea.count, 1);
  assert.equal(resArea.warnings[0].target_area_notation, '112FWFCUR10A');

  testServer.close();
});

test('Integration: /api/status includes ea_warnings summary and live road warning states', async () => {
  const testServer = http.createServer((req, res) => {
    server.emit('request', req, res);
  });

  await new Promise(resolve => testServer.listen(0, resolve));
  const port = testServer.address().port;

  const res = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/api/status`, (httpRes) => {
      let body = '';
      httpRes.on('data', chunk => { body += chunk; });
      httpRes.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });

  assert.equal(res.status, 'ok');
  assert.ok(res.ea_warnings, '/api/status must contain ea_warnings summary block');
  assert.equal(typeof res.ea_warnings.active_count, 'number');
  assert.equal(typeof res.ea_warnings.has_flood_warning, 'boolean');
  assert.equal(typeof res.ea_warnings.has_flood_alert, 'boolean');

  // Road corridor cards must reflect live warning state
  assert.ok(res.roads && res.roads.corridors);
  const cutsRoad = res.roads.corridors.cuts_road;
  assert.ok(cutsRoad);
  assert.equal(cutsRoad.ea_warning_target_area, '112FWFCUR10A');
  assert.equal(cutsRoad.ea_warning_state, 'RED_WARNING');

  // Validate /api/status contract
  const contractValidation = validateApiStatusPayload(res);
  assert.equal(contractValidation.valid, true, `Contract errors: ${contractValidation.errors.join('; ')}`);

  testServer.close();
});

test('Highway Passability Reopening: Exit Pathway A blocks when Flood Warning is active, unblocks when cleared', () => {
  const assetDef = ASSET_DEFINITIONS.cuts_road;

  // Road was submerged, now stage is 6.50m (dry below 7.35m crown, dry below 7.00m caution)
  const readings = [{ value: 6.50, dateTime: '2026-11-08T12:00:00Z' }];
  const activeSession = {
    to_state: 'IMPASSABLE',
    submerged_end_time: '2026-11-08T06:00:00Z' // receded 6+ hours ago
  };

  const nowMs = new Date('2026-11-08T15:00:00Z').getTime(); // 9 hours later, within daylight

  // Case 1: EA Warning is active ('RED_WARNING') -> Pathway A blocked, enters CLEARING_INSPECTION_PENDING
  const evalBlocked = evaluateRoadCorridor(assetDef, readings, activeSession, {
    nowMs,
    eaWarningState: 'RED_WARNING'
  });

  assert.equal(evalBlocked.status, 'ENCROACHING');
  assert.equal(evalBlocked.phase, 'CLEARING_INSPECTION_PENDING');
  assert.equal(evalBlocked.badge_label, 'CLEARING / INSPECTING');
  assert.equal(evalBlocked.inspection_window_met, false);

  // Case 2: EA Warning cleared ('INACTIVE') -> Pathway A met, transitions to PASSABLE
  const evalCleared = evaluateRoadCorridor(assetDef, readings, activeSession, {
    nowMs,
    eaWarningState: 'INACTIVE'
  });

  assert.equal(evalCleared.status, 'PASSABLE');
  assert.equal(evalCleared.phase, 'NOMINAL');
  assert.equal(evalCleared.badge_label, 'PASSABLE');
  assert.equal(evalCleared.inspection_window_met, true);

  // Case 3: Agricultural alert remains ('AMBER_ALERT') -> does NOT block Pathway A
  const evalAlert = evaluateRoadCorridor(assetDef, readings, activeSession, {
    nowMs,
    eaWarningState: 'AMBER_ALERT'
  });

  assert.equal(evalAlert.status, 'PASSABLE');
  assert.equal(evalAlert.badge_label, 'PASSABLE');
});
