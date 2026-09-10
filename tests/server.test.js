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
  assert.ok(json.catchments.some(c => c.id === 'fens'));
});

test('GET /api/catchments/somerset returns 200 and Somerset configuration JSON', async () => {
  const res = await httpGet('/api/catchments/somerset');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/json'));
  const json = JSON.parse(res.body);
  assert.equal(json.id, 'somerset');
  assert.ok(json.moors);
});

test('GET /api/catchments/fens returns 200 and Fens configuration JSON', async () => {
  const res = await httpGet('/api/catchments/fens');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/json'));
  const json = JSON.parse(res.body);
  assert.equal(json.id, 'fens');
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
