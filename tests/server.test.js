import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.js';

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

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

test('GET /api/catchments returns 200 and available catchments list', async () => {
  const res = await httpGet('/api/catchments');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/json'));
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(Array.isArray(json.catchments));
  assert.ok(json.catchments.some(c => c.id === 'somerset'));
});

test('GET /api/catchments/somerset returns 200 and Somerset configuration JSON', async () => {
  const res = await httpGet('/api/catchments/somerset');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/json'));
  const json = JSON.parse(res.body);
  assert.equal(json.id, 'somerset');
  assert.ok(json.moors);
});

test('GET /api/catchments/nonexistent returns 404', async () => {
  const res = await httpGet('/api/catchments/nonexistent');
  assert.equal(res.status, 404);
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'error');
});

test('GET / returns 200 and serves index.html', async () => {
  const res = await httpGet('/');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/html'));
  assert.ok(res.body.includes('Somerset Levels Flood Status'));
});

test('GET /somerset and /somerset/ return 200 and serve index.html', async () => {
  const res1 = await httpGet('/somerset');
  assert.equal(res1.status, 200);
  assert.ok(res1.headers['content-type'].includes('text/html'));

  const res2 = await httpGet('/somerset/');
  assert.equal(res2.status, 200);
  assert.ok(res2.headers['content-type'].includes('text/html'));
});

test('GET /somerset/css/styles.css serves static CSS asset correctly', async () => {
  const res = await httpGet('/somerset/css/styles.css');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/css'));
});

test('GET /somerset/js/app.js serves static JS asset correctly', async () => {
  const res = await httpGet('/somerset/js/app.js');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/javascript'));
});

test('GET /topology.html serves static topology HTML asset correctly', async () => {
  const res = await httpGet('/topology.html');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/html'));
  assert.ok(res.body.includes('River Network Topology Map'));
  assert.ok(res.body.includes('aria-current="page"'));
});

test('GET /js/topology.js serves static topology JS script correctly', async () => {
  const res = await httpGet('/js/topology.js');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/javascript'));
});

test('GET /js/sparkline.js serves static sparkline JS module correctly', async () => {
  const res = await httpGet('/js/sparkline.js');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/javascript'));
  assert.ok(res.body.includes('computeSparklineBounds'));
});

test('GET /somerset/js/sparkline.js serves static sparkline JS module under catchment route correctly', async () => {
  const res = await httpGet('/somerset/js/sparkline.js');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/javascript'));
  assert.ok(res.body.includes('computeSparklineBounds'));
});

test('GET /api/events returns 200 and structured events payload', async () => {
  const res = await httpGet('/api/events');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/json'));
  assert.ok(res.headers['cache-control'].includes('no-cache'));
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.equal(typeof json.count, 'number');
  assert.ok(Array.isArray(json.events));
});

test('GET /api/events?status=ACTIVE returns no-cache headers', async () => {
  const res = await httpGet('/api/events?status=ACTIVE');
  assert.equal(res.status, 200);
  assert.ok(res.headers['cache-control'].includes('no-cache'));
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(Array.isArray(json.events));
  for (const ev of json.events) {
    assert.equal(ev.status, 'ACTIVE');
  }
});

test('GET /api/events?status=CLOSED returns public, max-age=300 cache header', async () => {
  const res = await httpGet('/api/events?status=CLOSED');
  assert.equal(res.status, 200);
  assert.ok(res.headers['cache-control'].includes('public'));
  assert.ok(res.headers['cache-control'].includes('max-age=300'));
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(Array.isArray(json.events));
  for (const ev of json.events) {
    assert.equal(ev.status, 'CLOSED');
  }
});

test('GET /api/events?asset_id=hookbridge filters events by asset_id', async () => {
  const res = await httpGet('/api/events?asset_id=hookbridge');
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(Array.isArray(json.events));
  for (const ev of json.events) {
    assert.equal(ev.asset_id, 'hookbridge');
  }
});

test('GET /api/status includes active_events list and preserves backward-compatible cards', async () => {
  const res = await httpGet('/api/status');
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(Array.isArray(json.active_events));
  assert.ok(json.cards.hookbridge_spillway);
  assert.ok(json.cards.baltmoor_wall);
  assert.ok(typeof json.cards.hookbridge_spillway.spill_duration_seconds === 'number');
  assert.ok(typeof json.cards.baltmoor_wall.spill_duration_seconds === 'number');
});



