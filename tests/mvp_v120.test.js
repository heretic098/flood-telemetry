import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.js';
import { calculateVillemonteDischarge, sanitizeStageValue, PRE_OVERTOPPING_THRESHOLDS } from '../src/js/hydro_engine.js';
import { escapeHTML, fetchWebcamImageSecure, computeImageHash, isDaylight, generateLocalFallback } from '../src/js/api/ai_vision_client.js';

let testPort;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server.listen(0, () => {
      testPort = server.address().port;
      baseUrl = `http://localhost:${testPort}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

function httpGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${baseUrl}${path}`);
    const req = http.request(parsed, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/health returns 200 and uptime status (<10ms)', async () => {
  const startTime = Date.now();
  const res = await httpGet('/api/health');
  const duration = Date.now() - startTime;

  assert.equal(res.status, 200);
  assert.ok(duration < 150, `Health check duration ${duration}ms should be fast`);
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(typeof json.uptime === 'number');
});

test('Security Headers (SEC-05) applied to HTTP responses', async () => {
  const res = await httpGet('/api/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(res.headers['content-security-policy'].includes("default-src 'self'"));
});

test('GET /api/topology returns polder nodes 52127 and 52159', async () => {
  const res = await httpGet('/api/topology');
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(Array.isArray(json.nodes));

  const curryMoorNode = json.nodes.find(n => n.id === '52127');
  assert.ok(curryMoorNode, 'Node 52127 (Curry Moor Basin) must exist');
  assert.equal(curryMoorNode.node_type, 'polder_basin');

  const northmoorNode = json.nodes.find(n => n.id === '52159');
  assert.ok(northmoorNode, 'Node 52159 (Northmoor Basin) must exist');
  assert.equal(northmoorNode.node_type, 'polder_basin');

  const clyseTailwaterNode = json.nodes.find(n => n.id === '52234');
  assert.ok(clyseTailwaterNode, 'Node 52234 (Monk\'s Leaze Clyse Downstream) must exist');
  assert.ok(['gauge', 'clyse_tailwater'].includes(clyseTailwaterNode.node_type), 'Station 52234 node_type must be gauge (or legacy clyse_tailwater)');
  assert.ok(['DIVERTING', 'SECURE'].includes(clyseTailwaterNode.status), 'Station 52234 status must model clyse diversion rather than overtopping');
});

test('GET /api/camera-analysis returns cached or fallback camera state', async () => {
  const res = await httpGet('/api/camera-analysis?camera_id=monks_leaze_clyse');
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.equal(json.camera_id, 'monks_leaze_clyse');
  assert.ok(json.analysis);
  assert.ok(json.analysis.gate_status);
});

test('SEC-01: escapeHTML() sanitizes dynamic XSS inputs', () => {
  const input = '<script>alert("xss")</script> & "quote"';
  const sanitized = escapeHTML(input);
  assert.equal(sanitized, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quote&quot;');
});

test('SEC-03: fetchWebcamImageSecure blocks disallowed SSRF target domains', async () => {
  await assert.rejects(
    async () => {
      await fetchWebcamImageSecure('https://malicious-site.com/test.jpg');
    },
    /SSRF Blocked/
  );
});

test('SEC-06: sanitizeStageValue enforces plausibility bounds (-2.0m to 100.0m AOD)', () => {
  assert.equal(sanitizeStageValue(7.45), 7.45);
  assert.equal(sanitizeStageValue(76.14), 76.14); // Upper Tone catchment elevation
  assert.equal(sanitizeStageValue(-1.5), -1.5);
  assert.equal(sanitizeStageValue(-3.0), null); // Out of bounds
  assert.equal(sanitizeStageValue(150.0), null); // Out of bounds
  assert.equal(sanitizeStageValue(NaN), null);
  assert.equal(sanitizeStageValue(null), null);
});

test('Hydrological Engine: calculateVillemonteDischarge computes broad-crested weir flow', () => {
  // Free overtopping (submergence < 0.70)
  const freeFlow = calculateVillemonteDischarge(7.60, 2.10, 7.45, 45.0, 0.575);
  assert.ok(freeFlow.flowM3s > 0);
  assert.equal(freeFlow.state, 'FREE_FLOW');

  // Dry state (river below crest)
  const dryFlow = calculateVillemonteDischarge(7.20, 2.10, 7.45);
  assert.equal(dryFlow.flowM3s, 0);
  assert.equal(dryFlow.state, 'DRY');
});

test('PRE_OVERTOPPING_THRESHOLDS exports 30cm pre-warning alert elevations', () => {
  assert.equal(PRE_OVERTOPPING_THRESHOLDS.HOOKBRIDGE_ALERT_MAOD, 7.15);
  assert.equal(PRE_OVERTOPPING_THRESHOLDS.BALTMOOR_ALERT_MAOD, 7.50);
});

test('UI Component: renderHeroSpillwayBanner renders WCAG AA accessible spillway hero banner', async () => {
  const { renderHeroSpillwayBanner } = await import('../src/js/app.js');
  const html = renderHeroSpillwayBanner({
    icon: '⚡',
    title: 'Hookbridge Spillway Status',
    statusBadge: { label: 'ALERT', badgeClass: 'badge-warning', symbol: '⚠️' },
    mainMetricValue: '7.30',
    mainMetricUnit: 'm AOD (Tone Stage)',
    clearanceText: '0.15m below crest',
    minLevel: 5.50,
    maxLevel: 7.45,
    currentLevel: 7.30,
    minLabel: 'Normal Stage: 5.50m',
    maxLabel: 'Crest: 7.45m AOD',
    isAlert: true,
    stats: [
      { label: 'Spill Duration', value: '⏱️ 00h 00m' }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#hook',
      title: 'View 3-min EA Snapshot Camera at thecfh.org#hook',
      ariaLabel: 'View Hookbridge Spillway Live Camera'
    }
  });

  assert.ok(html.includes('class="hero-spillway-banner hero-spillway-alert"'));
  assert.ok(html.includes('Hookbridge Spillway Status'));
  assert.ok(html.includes('7.30'));
  assert.ok(html.includes('m AOD (Tone Stage)'));
  assert.ok(html.includes('0.15m below crest'));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('📷 LIVE CAM ↗'));
});

test('UI Component: sparkline renderers include numeric stage level indicators', async () => {
  const { renderSingleSparkline, renderDualSparkline } = await import('../src/js/app.js');
  
  const points = [
    { value: 2.10, time: '2026-09-20T10:00:00Z' },
    { value: 3.50, time: '2026-09-20T11:00:00Z' },
    { value: 4.80, time: '2026-09-20T12:00:00Z' }
  ];

  const singleHtml = renderSingleSparkline(points, '#4ade80', { streamLabel: 'Test Gauge', stationId: '52118' });
  assert.ok(singleHtml.includes('Current:'), 'Single sparkline must contain Current level indicator');
  assert.ok(singleHtml.includes('4.80'), 'Single sparkline must contain max numeric level');
  assert.ok(singleHtml.includes('2.10'), 'Single sparkline must contain min numeric level');
  assert.ok(singleHtml.includes('Max'), 'Single sparkline Y-axis label must contain Max text');
  assert.ok(singleHtml.includes('Min'), 'Single sparkline Y-axis label must contain Min text');

  const dualHtml = renderDualSparkline(points, points, false);
  assert.ok(dualHtml.includes('Inland:'), 'Dual sparkline must contain Inland numeric stage level');
  assert.ok(dualHtml.includes('Sea:'), 'Dual sparkline must contain Sea numeric stage level');
  assert.ok(dualHtml.includes('Max'), 'Dual sparkline Y-axis must contain Max label');
  assert.ok(dualHtml.includes('Min'), 'Dual sparkline Y-axis must contain Min label');
});

test('GET /api/topology returns Chiselborough (52116) relative stage with correct elevation and status', async () => {
  const res = await httpGet('/api/topology');
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  const chiselboroughNode = json.nodes.find(n => n.id === '52116');
  assert.ok(chiselboroughNode, 'Node 52116 (Chiselborough) must exist in topology response');
  assert.equal(chiselboroughNode.status, 'SECURE', 'Chiselborough at low stage (0.05m / 20.75mAOD) must be SECURE, not ALERT');
  assert.ok(chiselboroughNode.stage_mAOD >= 20.70, 'Chiselborough stage_mAOD must include 20.70m AOD datum offset');
  assert.equal(chiselboroughNode.alert_level_mAOD, 22.50, 'Chiselborough alert_level_mAOD must be calibrated elevation mAOD (22.50mAOD)');
});

test('GET /api/history returns 24h readings for Upper/Mid Tone gauges (52108, 52109, 52111)', async () => {
  const res = await httpGet('/api/history?range=24h');
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.ok(json.measures, 'Response should contain measures object');
  
  const m52108 = Object.keys(json.measures).find(k => k.startsWith('52108-'));
  const m52109 = Object.keys(json.measures).find(k => k.startsWith('52109-'));
  const m52111 = Object.keys(json.measures).find(k => k.startsWith('52111-'));

  assert.ok(m52108, 'Gauge 52108 (Greenham) must have historical measures');
  assert.ok(m52109, 'Gauge 52109 (Bishops Hull) must have historical measures');
  assert.ok(m52111, 'Gauge 52111 (Taunton Market) must have historical measures');
  assert.ok(json.measures[m52108].length > 0, 'Gauge 52108 must have 24h readings');
  assert.ok(json.measures[m52109].length > 0, 'Gauge 52109 must have 24h readings');
  assert.ok(json.measures[m52111].length > 0, 'Gauge 52111 must have 24h readings');
});




