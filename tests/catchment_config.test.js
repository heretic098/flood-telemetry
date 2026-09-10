import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActiveCatchmentId, loadCatchmentConfig } from '../src/js/hydro_engine.js';
import { getAvailableCatchments } from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('Catchment configuration files exist and contain valid JSON structure', () => {
  const catchmentsIndexPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'catchments.json');
  assert.equal(fs.existsSync(catchmentsIndexPath), true, 'catchments.json should exist');

  const catchmentsIndex = JSON.parse(fs.readFileSync(catchmentsIndexPath, 'utf8'));
  assert.equal(Array.isArray(catchmentsIndex.catchments), true, 'catchments.json must contain catchments array');
  assert.ok(catchmentsIndex.catchments.length >= 2, 'catchments.json should list at least somerset and fens');

  const somersetMeta = catchmentsIndex.catchments.find(c => c.id === 'somerset');
  assert.ok(somersetMeta, 'somerset catchment should be listed in catchments.json');

  const fensMeta = catchmentsIndex.catchments.find(c => c.id === 'fens');
  assert.ok(fensMeta, 'fens catchment should be listed in catchments.json');

  // Verify somerset.json file
  const somersetPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'catchments', 'somerset.json');
  assert.equal(fs.existsSync(somersetPath), true, 'somerset.json should exist');
  const somersetConfig = JSON.parse(fs.readFileSync(somersetPath, 'utf8'));
  assert.equal(somersetConfig.id, 'somerset');
  assert.ok(somersetConfig.moors, 'somerset.json must contain moors object');
  assert.ok(somersetConfig.moors.curry_moor, 'somerset.json must include curry_moor');

  // Verify fens.json file
  const fensPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'catchments', 'fens.json');
  assert.equal(fs.existsSync(fensPath), true, 'fens.json should exist');
  const fensConfig = JSON.parse(fs.readFileSync(fensPath, 'utf8'));
  assert.equal(fensConfig.id, 'fens');
  assert.ok(fensConfig.moors, 'fens.json must contain moors object');

  // Verify backward compatibility fallback file hydro_config.json
  const hydroConfigPath = path.join(ROOT_DIR, 'src', 'js', 'config', 'hydro_config.json');
  assert.equal(fs.existsSync(hydroConfigPath), true, 'hydro_config.json fallback must exist');
});

test('getAvailableCatchments returns configured catchments list from server', () => {
  const catchments = getAvailableCatchments();
  assert.ok(Array.isArray(catchments), 'catchments must be an array');
  assert.ok(catchments.some(c => c.id === 'somerset'), 'somerset catchment should exist');
  assert.ok(catchments.some(c => c.id === 'fens'), 'fens catchment should exist');
});

test('getActiveCatchmentId detects active catchment from query strings and pathnames', () => {
  // Query param takes priority
  assert.equal(getActiveCatchmentId('http://localhost:3000/?catchment=fens'), 'fens');
  assert.equal(getActiveCatchmentId('http://localhost:3000/somerset?catchment=fens'), 'fens');

  // Pathname routing
  assert.equal(getActiveCatchmentId('http://localhost:3000/somerset'), 'somerset');
  assert.equal(getActiveCatchmentId('http://localhost:3000/somerset/'), 'somerset');
  assert.equal(getActiveCatchmentId('http://localhost:3000/fens'), 'fens');
  assert.equal(getActiveCatchmentId('http://localhost:3000/fens/'), 'fens');

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

  // Mock fetch failing API endpoint but resolving static file
  const mockFetchStaticFallback = async (url) => {
    if (url === '/js/config/catchments/fens.json') {
      return {
        ok: true,
        json: async () => ({ id: 'fens', name: 'The Fens & South Level' })
      };
    }
    return { ok: false };
  };

  const fensConfig = await loadCatchmentConfig('fens', mockFetchStaticFallback);
  assert.equal(fensConfig.id, 'fens');

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
