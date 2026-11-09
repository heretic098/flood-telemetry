import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActiveCatchmentId, loadCatchmentConfig, CANONICAL_PUMP_THRESHOLDS } from '../src/js/hydro_engine.js';
import { getAvailableCatchments } from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('Catchment configuration files exist and contain valid JSON structure', () => {
  const catchmentsIndexPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'catchments.json');
  assert.equal(fs.existsSync(catchmentsIndexPath), true, 'catchments.json should exist');

  const catchmentsIndex = JSON.parse(fs.readFileSync(catchmentsIndexPath, 'utf8'));
  assert.equal(Array.isArray(catchmentsIndex.catchments), true, 'catchments.json must contain catchments array');
  assert.ok(catchmentsIndex.catchments.length >= 1, 'catchments.json should list somerset catchment');

  const somersetMeta = catchmentsIndex.catchments.find(c => c.id === 'somerset');
  assert.ok(somersetMeta, 'somerset catchment should be listed in catchments.json');

  // Verify somerset.json file
  const somersetPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'catchments', 'somerset.json');
  assert.equal(fs.existsSync(somersetPath), true, 'somerset.json should exist');
  const somersetConfig = JSON.parse(fs.readFileSync(somersetPath, 'utf8'));
  assert.equal(somersetConfig.id, 'somerset');
  assert.ok(somersetConfig.moors, 'somerset.json must contain moors object');
  assert.ok(somersetConfig.moors.curry_moor, 'somerset.json must include curry_moor');

  // Verify backward compatibility fallback file hydro_config.json
  const hydroConfigPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'hydro_config.json');
  assert.equal(fs.existsSync(hydroConfigPath), true, 'hydro_config.json fallback must exist');
});

test('getAvailableCatchments returns configured catchments list from server', () => {
  const catchments = getAvailableCatchments();
  assert.ok(Array.isArray(catchments), 'catchments must be an array');
  assert.ok(catchments.some(c => c.id === 'somerset'), 'somerset catchment should exist');
});

test('getActiveCatchmentId detects active catchment from query strings and pathnames', () => {
  // Query param takes priority
  assert.equal(getActiveCatchmentId('http://localhost:3000/?catchment=somerset'), 'somerset');
  assert.equal(getActiveCatchmentId('http://localhost:3000/somerset?catchment=somerset'), 'somerset');

  // Pathname routing
  assert.equal(getActiveCatchmentId('http://localhost:3000/somerset'), 'somerset');
  assert.equal(getActiveCatchmentId('http://localhost:3000/somerset/'), 'somerset');

  // Fallback default
  assert.equal(getActiveCatchmentId('http://localhost:3000/'), 'somerset');
  assert.equal(getActiveCatchmentId('http://localhost:3000/index.html'), 'somerset');
  assert.equal(getActiveCatchmentId(null), 'somerset');
});

test('loadCatchmentConfig resolves catchment configuration dynamically and handles fallbacks', async () => {
  // Mock fetch returning somerset config
  const mockFetchSuccess = async (url) => {
    if (url === '/api/catchments/somerset') {
      return {
        ok: true,
        json: async () => ({ id: 'somerset', name: 'Somerset Levels & Moors' })
      };
    }
    return { ok: false };
  };

  const config = await loadCatchmentConfig('somerset', mockFetchSuccess);
  assert.equal(config.id, 'somerset');
  assert.equal(config.name, 'Somerset Levels & Moors');

  // Mock fetch falling back to hydro_config.json
  const mockFetchHydroFallback = async (url) => {
    if (url === '/js/config/hydro_config.json') {
      return {
        ok: true,
        json: async () => ({ moors: { curry_moor: {} } })
      };
    }
    return { ok: false };
  };

  const fallbackConfig = await loadCatchmentConfig('unknown', mockFetchHydroFallback);
  assert.ok(fallbackConfig.moors.curry_moor);
});

test('CANONICAL_PUMP_THRESHOLDS preserves 100% parity with somerset.json [RULE-SSOT-01]', () => {
  const somersetPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'catchments', 'somerset.json');
  const somersetConfig = JSON.parse(fs.readFileSync(somersetPath, 'utf8'));

  for (const [stationId, seasonalThresholds] of Object.entries(CANONICAL_PUMP_THRESHOLDS)) {
    let found = null;
    for (const moor of Object.values(somersetConfig.moors)) {
      if (moor.pumping_stations) {
        found = moor.pumping_stations.find(ps => ps.id === stationId);
      }
      if (!found && moor.emergency_pumps && moor.emergency_pumps.id === stationId) {
        found = moor.emergency_pumps;
      }
      if (!found && moor[stationId]) {
        found = moor[stationId];
      }
      if (found) break;
    }

    assert.ok(found, `Station ${stationId} in CANONICAL_PUMP_THRESHOLDS must exist in somerset.json`);
    for (const season of ['summer', 'winter']) {
      const canonicalSeason = seasonalThresholds[season];
      const jsonSeason = found.thresholds[season];
      assert.ok(jsonSeason, `Station ${stationId} must define ${season} thresholds in somerset.json`);
      assert.equal(canonicalSeason.lead, jsonSeason.lead, `${stationId} ${season} lead parity`);
      assert.equal(canonicalSeason.duty, jsonSeason.duty, `${stationId} ${season} duty parity`);
      if (canonicalSeason.mobile_order !== undefined) {
        assert.equal(canonicalSeason.mobile_order, jsonSeason.mobile_order ?? jsonSeason.muchelney_road, `${stationId} ${season} mobile_order parity`);
      }
    }
  }
});

