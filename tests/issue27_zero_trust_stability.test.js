import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

import { aggregateGlobalStatus } from '../src/js/hydro_engine.js';
import {
  validateApiStatusPayload,
  validateApiTopologyPayload,
  validateApiHistoryPayload
} from '../src/js/contracts/index.js';
import { server } from '../server.js';
import { renderCorridorFallbackRow, renderCorridorRow } from '../src/js/roads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to make mock requests to server instance
async function queryServerEndpoint(endpointUrl) {
  return new Promise((resolve) => {
    const req = {
      url: endpointUrl,
      method: 'GET',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    let data = '';
    const res = {
      setHeader: () => {},
      writeHead: () => {},
      end: (chunk) => {
        if (chunk) data += chunk;
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      }
    };
    server.emit('request', req, res);
  });
}

// --------------------------------------------------------------------------
// WP 1.1 Tests: Topology Auto-Refresh & Counter Pill Preservation
// --------------------------------------------------------------------------
test('WP 1.1: src/topology.html contains dedicated #auto-refresh-group, #countdown-pill, and #btn-refresh-now', () => {
  const topologyHtml = fs.readFileSync(path.join(ROOT_DIR, 'src', 'topology.html'), 'utf8');

  assert.ok(topologyHtml.includes('id="auto-refresh-group"'), 'topology.html must contain #auto-refresh-group');
  assert.ok(topologyHtml.includes('id="countdown-pill"'), 'topology.html must contain #countdown-pill');
  assert.ok(topologyHtml.includes('id="btn-refresh-now"'), 'topology.html must contain #btn-refresh-now');
  assert.ok(topologyHtml.includes('id="counter-pill"'), 'topology.html must retain #counter-pill');

  // Ensure countdown-pill is inside auto-refresh-group
  const groupStart = topologyHtml.indexOf('id="auto-refresh-group"');
  assert.ok(groupStart !== -1, 'auto-refresh-group element must be present in topology.html');
  const groupBlock = topologyHtml.slice(groupStart, groupStart + 400);
  assert.ok(groupBlock.includes('id="countdown-pill"'), '#countdown-pill must be inside #auto-refresh-group');
  assert.ok(groupBlock.includes('id="btn-refresh-now"'), '#btn-refresh-now must be inside #auto-refresh-group');
});

test('WP 1.1: src/js/topology.js targets #countdown-pill for timer and preserves #counter-pill', () => {
  const topologyJs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'js', 'topology.js'), 'utf8');

  // Must configure countdownPillId as 'countdown-pill'
  assert.ok(
    topologyJs.includes("countdownPillId: 'countdown-pill'"),
    'topology.js must configure countdownPillId: "countdown-pill"'
  );
  assert.ok(
    !topologyJs.includes("countdownPillId: 'counter-pill'"),
    'topology.js must NOT hijack counter-pill for countdown timer'
  );

  // Must populate #counter-pill with catchment status counters
  assert.ok(
    topologyJs.includes('counterPill.innerText = statusData.global_status.counter_pill'),
    'topology.js must set counter-pill to statusData.global_status.counter_pill'
  );
});

// --------------------------------------------------------------------------
// WP 1.2 Tests: Epistemic Honesty for Roads Telemetry Freshness & Print
// --------------------------------------------------------------------------
test('WP 1.2: roads.js derives telemetry freshness from latest_ea_reading_at (no client wall-clock spoofing)', () => {
  const roadsJs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'js', 'roads.js'), 'utf8');

  assert.ok(
    roadsJs.includes('latest_ea_reading_at'),
    'roads.js must derive freshness from statusData.system_timestamps.latest_ea_reading_at'
  );
  assert.ok(
    !roadsJs.includes('new Date().toISOString()') && !roadsJs.includes('new Date().toLocaleTimeString([], { hour: \'2-digit\', minute: \'2-digit\' })'),
    'roads.js must not spoof client wall-clock as telemetry timestamp'
  );
});

test('WP 1.2: styles.css enforces subtle slate for .freshness-stale (no panic red per [UI-COL-03])', () => {
  const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'src', 'css', 'styles.css'), 'utf8');

  const staleBlockMatch = stylesCss.match(/\.freshness-stale\s*\{([^}]+)\}/);
  assert.ok(staleBlockMatch, 'styles.css must define .freshness-stale');
  const staleRules = staleBlockMatch[1];

  // Must not contain red tokens like #ef4444, rgba(239, 68, 68), or #f87171
  assert.ok(!staleRules.includes('#ef4444'), '.freshness-stale must not use panic red #ef4444');
  assert.ok(!staleRules.includes('239, 68, 68'), '.freshness-stale must not use panic red rgba(239, 68, 68)');
  assert.ok(!staleRules.includes('#f87171'), '.freshness-stale must not use panic red #f87171');

  // Must use subtle slate tokens (e.g., 148, 163, 184 or #cbd5e1 / #94a3b8)
  assert.ok(staleRules.includes('148, 163, 184') || staleRules.includes('#cbd5e1') || staleRules.includes('#94a3b8'),
    '.freshness-stale must use subtle slate color tokens'
  );
});

test('WP 1.2: roads.js print header output includes both telemetry timestamp and printed timestamp with disclaimer', () => {
  const roadsJs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'js', 'roads.js'), 'utf8');

  assert.ok(roadsJs.includes('Telemetry timestamp:'), 'roads.js print situation header must include "Telemetry timestamp:"');
  assert.ok(roadsJs.includes('Printed:'), 'roads.js print situation header must include "Printed:"');
  assert.ok(
    roadsJs.includes('Passability inferred from EA stage telemetry relative to surveyed road crown. Not visual confirmation.'),
    'roads.js print header must include statutory non-reliance disclaimer'
  );
});

// --------------------------------------------------------------------------
// WP 1.3 Tests: Contracts Reconciled & Wired into Live Endpoints
// --------------------------------------------------------------------------
test('WP 1.3: apiStatusSchema accepts top_severity bounds { min: 1, max: 5 }', () => {
  const validNominal = {
    status: 'ok',
    system_timestamps: {
      client_poll_at: '2026-11-04T22:00:00Z',
      db_synced_at: '2026-11-04 22:00:00', // SQLite space-separated format accepted
      latest_ea_reading_at: '2026-11-04T21:45:00Z'
    },
    global_status: {
      counter_pill: '[ 🔴 0 Overtopping | 🟡 0 Warning | 🟢 4 Secure ]',
      banner_text: 'SYSTEM SECURE — ALL MOORS NORMAL',
      top_severity: 5, // severity 5 is now accepted
      is_tide_locked: false
    },
    active_events: [],
    roads: {
      counts: { all: 8, impassable: 0, encroaching: 0, passable: 8 },
      corridors_list: [
        { asset_id: 'cuts_road', name: 'Cuts Road', status: 'PASSABLE', stage_mAOD: 4.52 }
      ]
    }
  };

  const validation = validateApiStatusPayload(validNominal);
  assert.equal(validation.valid, true, `Expected valid payload, got: ${validation.errors.join('; ')}`);
});

test('WP 1.3: apiTopologySchema enforces physical structural keys (crest_elevation_mAOD, sill_elevation_mAOD, null on gauge)', () => {
  // 1. Spillway without crest_elevation_mAOD fails
  const invalidSpillway = {
    status: 'ok',
    catchment_id: 'somerset',
    updated_at: '2026-11-04T22:00:00Z',
    chains: [{ id: 'tone', name: 'Tone', direction: 'W-E', nodes: ['52118'] }],
    nodes: [
      { id: '52118', name: 'Hookbridge', river: 'River Tone', node_type: 'spillway', stage_mAOD: 4.52 }
    ]
  };
  const spillwayRes = validateApiTopologyPayload(invalidSpillway);
  assert.equal(spillwayRes.valid, false);
  assert.ok(spillwayRes.errors.some(e => e.includes('must define a positive numerical crest_elevation_mAOD')));

  // 2. Clyse gate without sill_elevation_mAOD fails
  const invalidClyse = {
    status: 'ok',
    catchment_id: 'somerset',
    updated_at: '2026-11-04T22:00:00Z',
    chains: [{ id: 'parrett', name: 'Parrett', direction: 'S-N', nodes: ['52233'] }],
    nodes: [
      { id: '52233', name: 'Monks Leaze', river: 'River Parrett', node_type: 'clyse_gate', stage_mAOD: 6.70 }
    ]
  };
  const clyseRes = validateApiTopologyPayload(invalidClyse);
  assert.equal(clyseRes.valid, false);
  assert.ok(clyseRes.errors.some(e => e.includes('must define a positive numerical sill_elevation_mAOD')));

  // 3. Gauge with crest elevation fails per HYDRO-06
  const invalidGauge = {
    status: 'ok',
    catchment_id: 'somerset',
    updated_at: '2026-11-04T22:00:00Z',
    chains: [{ id: 'tone', name: 'Tone', direction: 'W-E', nodes: ['52108'] }],
    nodes: [
      { id: '52108', name: 'Greenham', river: 'River Tone', node_type: 'gauge', stage_mAOD: 75.8, crest_elevation_mAOD: 77.5 }
    ]
  };
  const gaugeRes = validateApiTopologyPayload(invalidGauge);
  assert.equal(gaugeRes.valid, false);
  assert.ok(gaugeRes.errors.some(e => e.includes('must have null or undefined crest_elevation_mAOD')));
});

test('WP 1.3: Live server endpoints (/api/status, /api/topology, /api/history) strictly pass contract validation', async () => {
  const statusPayload = await queryServerEndpoint('/api/status');
  const statusRes = validateApiStatusPayload(statusPayload);
  assert.equal(statusRes.valid, true, `/api/status contract violation: ${statusRes.errors.join('; ')}`);

  const topPayload = await queryServerEndpoint('/api/topology');
  const topRes = validateApiTopologyPayload(topPayload);
  assert.equal(topRes.valid, true, `/api/topology contract violation: ${topRes.errors.join('; ')}`);

  const histPayload = await queryServerEndpoint('/api/history?range=24h');
  const histRes = validateApiHistoryPayload(histPayload);
  assert.equal(histRes.valid, true, `/api/history contract violation: ${histRes.errors.join('; ')}`);
});

test('WP 1.3: validateApiHistoryPayload recursively rejects prohibited volumetric keys [RULE-CALC-01]', () => {
  const contaminatedHistory = {
    status: 'ok',
    range: '24h',
    days: 1,
    since: '2026-11-04T00:00:00Z',
    total_records: 1,
    measures: {
      '52118-level-stage-i-15_min-mAOD': [
        { dateTime: '2026-11-04T00:00:00Z', value: 4.52 }
      ]
    },
    cumecs: 14.5
  };
  const res = validateApiHistoryPayload(contaminatedHistory);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('strictly prohibited') && e.includes('cumecs')));
});

// --------------------------------------------------------------------------
// WP 1.4 Tests: Hydrologically Sound Error Boundaries & Degradation Banner
// --------------------------------------------------------------------------
test('WP 1.4: aggregateGlobalStatus displays DATA DEGRADED when station telemetry is offline', () => {
  const nominalWithOffline = [
    { name: 'Curry Moor System', severity: 4, status: 'OFFLINE', isOffline: true },
    { name: 'Northmoor & Saltmoor', severity: 5, status: 'SECURE' },
    { name: 'Langport Confluence', severity: 5, status: 'SECURE' }
  ];

  const stat = aggregateGlobalStatus(nominalWithOffline, false);
  assert.ok(
    stat.bannerText.includes('⚠️ DATA DEGRADED: TELEMETRY OFFLINE FOR CURRY MOOR SYSTEM — STATUS UNCONFIRMED'),
    `Banner must show degraded state for offline station, received: "${stat.bannerText}"`
  );
  assert.ok(
    !stat.bannerText.includes('SYSTEM SECURE — ALL MOORS NORMAL'),
    'Degraded telemetry must never fall back to "SYSTEM SECURE — ALL MOORS NORMAL"'
  );
  assert.equal(stat.topSeverity, 4, 'Top severity must be 4 (alert level) when data is degraded');
  assert.ok(stat.counterPill.includes('🟡 1 Warning'), 'Offline station must be counted in warning category');
});

test('WP 1.4: renderCorridorFallbackRow returns accessible fallback with role="alert" and min-height 280px', () => {
  const html = renderCorridorFallbackRow({ name: 'Cuts Road (East Lyng to Athelney)' });

  assert.ok(html.includes('role="alert"'), 'Corridor fallback row must have role="alert"');
  assert.ok(html.includes('min-height: 280px'), 'Corridor fallback row must enforce min-height: 280px to prevent CLS');
  assert.ok(html.includes('⚠️ UNKNOWN / TELEMETRY OFFLINE'), 'Corridor fallback row must report UNKNOWN / TELEMETRY OFFLINE');
  assert.ok(html.includes('https://www.travelsomerset.co.uk'), 'Corridor fallback row must link to Travel Somerset');
  assert.ok(html.includes('https://check-for-flooding.service.gov.uk'), 'Corridor fallback row must link to GOV.UK Flood Warnings');
});

test('WP 1.4: renderCorridorRow gracefully handles throwing errors or offline status', () => {
  // 1. Offline status corridor
  const offlineHtml = renderCorridorRow({ name: 'A361 Burrowbridge', status: 'OFFLINE', isOffline: true });
  assert.ok(offlineHtml.includes('⚠️ UNKNOWN / TELEMETRY OFFLINE'), 'renderCorridorRow must render fallback when status is OFFLINE');

  // 2. Corrupted corridor triggering throw
  const corruptedCorridor = {
    get status() {
      throw new Error('Corrupted sensor memory reading');
    }
  };
  const fallbackHtml = renderCorridorRow(corruptedCorridor);
  assert.ok(fallbackHtml.includes('corridor-fallback'), 'renderCorridorRow must catch exception and return corridor-fallback');
  assert.ok(fallbackHtml.includes('⚠️ UNKNOWN / TELEMETRY OFFLINE'), 'renderCorridorRow must report UNKNOWN / TELEMETRY OFFLINE on throw');
});
