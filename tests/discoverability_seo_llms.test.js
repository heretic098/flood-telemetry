import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { server, renderSummaryMarkdown, MIME_TYPES } from '../server.js';
import { STATION_REGISTRY, ASSET_DEFINITIONS } from '../src/js/hydro_engine.js';

const ROOT_DIR = path.resolve('.');

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

function httpGet(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${pathname}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

test('Discoverability: /robots.txt serves valid directives and links sitemap', async () => {
  const res = await httpGet('/robots.txt');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/plain'), 'Content-Type must be text/plain');
  assert.ok(res.body.includes('User-agent: *'), 'Must include wildcard User-agent');
  assert.ok(res.body.includes('Allow: /'), 'Must allow root indexing');
  assert.ok(res.body.includes('Googlebot'), 'Must list Googlebot');
  assert.ok(res.body.includes('Bingbot'), 'Must list Bingbot');
  assert.ok(res.body.includes('GPTBot'), 'Must list GPTBot');
  assert.ok(res.body.includes('ClaudeBot'), 'Must list ClaudeBot');
  assert.ok(res.body.includes('PerplexityBot'), 'Must list PerplexityBot');
  assert.ok(res.body.includes('Sitemap: https://floodtelemetry.uk/sitemap.xml'), 'Must link to sitemap.xml');
});

test('Discoverability: /sitemap.xml serves valid XML with all 7 primary canonical URLs', async () => {
  const res = await httpGet('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/xml'), 'Content-Type must be application/xml');
  assert.ok(res.body.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'Must contain XML declaration');
  assert.ok(res.body.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'Must contain sitemaps namespace');

  const expectedUrls = [
    'https://floodtelemetry.uk/',
    'https://floodtelemetry.uk/roads.html',
    'https://floodtelemetry.uk/topology.html',
    'https://floodtelemetry.uk/methodology.html',
    'https://floodtelemetry.uk/llms.txt',
    'https://floodtelemetry.uk/llms-full.txt',
    'https://floodtelemetry.uk/api/summary.md'
  ];

  for (const expectedUrl of expectedUrls) {
    assert.ok(res.body.includes(`<loc>${expectedUrl}</loc>`), `sitemap.xml must include loc: ${expectedUrl}`);
  }
});

test('Machine Discovery: /llms.txt serves standard Markdown with provenance and zero cumecs', async () => {
  const res = await httpGet('/llms.txt');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('# Somerset Flood Telemetry'), 'llms.txt must have title');
  assert.ok(res.body.includes('https://floodtelemetry.uk/'), 'llms.txt must link to platform');
  assert.ok(res.body.includes('Open Government Licence v3.0'), 'llms.txt must include OGL v3.0 attribution');
  assert.ok(res.body.includes('Crown copyright'), 'llms.txt must acknowledge Crown copyright');
  assert.ok(res.body.includes('[RULE-HUM-01]'), 'llms.txt must cite epistemic humility rule');
  assert.ok(res.body.includes('/api/status'), 'llms.txt must document /api/status');
  assert.ok(res.body.includes('/api/topology'), 'llms.txt must document /api/topology');
  assert.ok(res.body.includes('/api/events'), 'llms.txt must document /api/events');
  assert.ok(res.body.includes('/api/summary.md'), 'llms.txt must document /api/summary.md');
  assert.ok(res.body.includes('/llms-full.txt'), 'llms.txt must link to llms-full.txt');

  // Strict check on forbidden volumetric speculation [RULE-CALC-01]
  const forbiddenRegex = /cumec|m3\/s|m³\/s|megalitre/i;
  assert.ok(!forbiddenRegex.test(res.body), 'llms.txt must not contain forbidden volumetric terms [RULE-CALC-01]');
});

test('Machine Discovery: /llms-full.txt includes full station registry and road corridor definitions', async () => {
  const res = await httpGet('/llms-full.txt');
  assert.equal(res.status, 200);

  // All 19 stations from STATION_REGISTRY must be documented
  const stationIds = Object.keys(STATION_REGISTRY);
  assert.equal(stationIds.length, 19, 'STATION_REGISTRY must contain 19 stations');
  for (const stId of stationIds) {
    assert.ok(res.body.includes(stId), `llms-full.txt must reference station ${stId}`);
  }

  // All 8 road corridors from ASSET_DEFINITIONS must be documented
  const roadKeys = [
    'cuts_road',
    'muchelney_access',
    'a361_burrowbridge',
    'new_road_curry',
    'bicknells_bridge_access',
    'moorland_new_cut_road',
    'stan_moor_road',
    'beer_wall_a372'
  ];
  for (const rKey of roadKeys) {
    const def = ASSET_DEFINITIONS[rKey];
    assert.ok(def, `ASSET_DEFINITIONS must define ${rKey}`);
    assert.ok(res.body.includes(rKey) || res.body.includes(def.name), `llms-full.txt must document road ${rKey}`);
  }

  // Spillway crests
  assert.ok(res.body.includes('7.45m AOD') || res.body.includes('7.45'), 'Must state Hookbridge crest 7.45m AOD');
  assert.ok(res.body.includes('7.80m AOD') || res.body.includes('7.80'), 'Must state Baltmoor Wall crest 7.80m AOD');
  assert.ok(res.body.includes('7.30m AOD') || res.body.includes('7.30'), 'Must state Beer Wall crest 7.30m AOD');

  // Operational trigger rules
  assert.ok(res.body.includes('Curry Moor Polder Basin'), 'Must document Curry Moor');
  assert.ok(res.body.includes('Northmoor Polder Basin'), 'Must document Northmoor');
  assert.ok(res.body.includes("Monk's Leaze Clyse"), "Must document Monk's Leaze Clyse");
  assert.ok(res.body.includes('Dunball Sea Outfall'), 'Must document Dunball outfall');
  assert.ok(res.body.includes('TIDE_LOCKED'), 'Must explain tidal locking');

  // Invariants & Legal
  assert.ok(res.body.includes('RULE-HUM-01'), 'Must document RULE-HUM-01');
  assert.ok(res.body.includes('RULE-CALC-01'), 'Must document RULE-CALC-01');
  assert.ok(res.body.includes('RULE-ENT-01'), 'Must document RULE-ENT-01');
  assert.ok(res.body.includes('Hedley Byrne'), 'Must reference Hedley Byrne non-reliance doctrine');

  // Strict check on forbidden volumetric speculation [RULE-CALC-01]
  const forbiddenRegex = /cumec|m3\/s|m³\/s|megalitre/i;
  assert.ok(!forbiddenRegex.test(res.body), 'llms-full.txt must not contain forbidden volumetric terms [RULE-CALC-01]');
});

test('Live Briefing Endpoint: /api/summary.md and /status.txt return compliant markdown briefing', async () => {
  for (const endpoint of ['/api/summary.md', '/status.txt']) {
    const res = await httpGet(endpoint);
    assert.equal(res.status, 200, `${endpoint} must return 200`);
    assert.equal(res.headers['content-type'], 'text/markdown; charset=utf-8', `${endpoint} Content-Type must be text/markdown; charset=utf-8`);
    assert.equal(res.headers['access-control-allow-origin'], '*', `${endpoint} must have CORS wildcard`);
    assert.ok(res.headers['cache-control'].includes('max-age=60'), `${endpoint} Cache-Control must have max-age=60`);

    // Title and timestamp
    assert.ok(res.body.includes('# Somerset Levels & Moors Flood Telemetry — Live Situation Report'), `${endpoint} must have canonical title`);
    assert.ok(res.body.includes('Generated:'), `${endpoint} must contain generation timestamp`);

    // Non-reliance disclaimer [RULE-HUM-01]
    assert.ok(res.body.includes('Non-Reliance & Epistemic Humility Notice'), `${endpoint} must contain humility disclaimer`);
    assert.ok(res.body.includes('Never drive through floodwater'), `${endpoint} must contain life safety warning`);

    // Road corridors
    assert.ok(res.body.includes('Cuts Road'), `${endpoint} must report Cuts Road`);
    assert.ok(res.body.includes('Muchelney Spine Road') || res.body.includes('Muchelney Access'), `${endpoint} must report Muchelney`);
    assert.ok(res.body.includes('New Road'), `${endpoint} must report New Road`);
    assert.ok(res.body.includes('A361'), `${endpoint} must report A361`);

    // Spillways & polders
    assert.ok(res.body.includes('Hookbridge Spillway'), `${endpoint} must report Hookbridge`);
    assert.ok(res.body.includes('Baltmoor Wall Spillway'), `${endpoint} must report Baltmoor Wall`);
    assert.ok(res.body.includes('Beer Wall Spillway'), `${endpoint} must report Beer Wall`);
    assert.ok(res.body.includes("Monk's Leaze Clyse"), `${endpoint} must report Monk's Leaze Clyse`);
    assert.ok(res.body.includes('Curry Moor Basin'), `${endpoint} must report Curry Moor Basin`);
    assert.ok(res.body.includes('Northmoor Basin'), `${endpoint} must report Northmoor Basin`);

    // Official contacts
    assert.ok(res.body.includes('https://www.travelsomerset.co.uk'), `${endpoint} must link Travel Somerset`);
    assert.ok(res.body.includes('0345 988 1188'), `${endpoint} must include EA Floodline number`);

    // Prohibited keys check [RULE-CALC-01]
    const forbiddenRegexEndpoint = /cumec|m3\/s|m³\/s|megalitre/i;
    assert.ok(!forbiddenRegexEndpoint.test(res.body), `${endpoint} must not contain forbidden volumetric terms`);
  }
});

test('Server: MIME_TYPES maps .txt, .xml, and .md to correct charset-enabled mime types', () => {
  assert.equal(MIME_TYPES['.txt'], 'text/plain; charset=utf-8');
  assert.equal(MIME_TYPES['.xml'], 'application/xml; charset=utf-8');
  assert.equal(MIME_TYPES['.md'], 'text/markdown; charset=utf-8');
});

test('Structured Data: index.html contains valid Schema.org JSON-LD Dataset & SpecialAnnouncement', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/index.html'), 'utf8');
  assert.ok(indexHtml.includes('<script type="application/ld+json">'), 'index.html must contain ld+json script tag');

  const match = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Must match ld+json script content in index.html');

  const parsed = JSON.parse(match[1]);
  assert.equal(parsed['@context'], 'https://schema.org');
  assert.ok(Array.isArray(parsed['@graph']), 'Schema must use @graph array');

  const website = parsed['@graph'].find(item => item['@type'] === 'WebSite');
  assert.ok(website, 'Must define WebSite');
  assert.equal(website.url, 'https://floodtelemetry.uk/');

  const dataset = parsed['@graph'].find(item => item['@type'] === 'Dataset');
  assert.ok(dataset, 'Must define Dataset');
  assert.ok(dataset.name.includes('Somerset Levels & Moors Flood Telemetry'));
  assert.ok(dataset.license.includes('open-government-licence'));
  assert.ok(dataset.spatialCoverage);
  assert.ok(Array.isArray(dataset.distribution) && dataset.distribution.length >= 3);

  const announcement = parsed['@graph'].find(item => item['@type'] === 'SpecialAnnouncement');
  assert.ok(announcement, 'Must define SpecialAnnouncement');
  assert.ok(announcement.text.includes('Epistemic humility'));
});

test('Structured Data: roads.html contains valid Schema.org JSON-LD SpecialAnnouncement & Dataset', () => {
  const roadsHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/roads.html'), 'utf8');
  assert.ok(roadsHtml.includes('<script type="application/ld+json">'), 'roads.html must contain ld+json script tag');

  const match = roadsHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Must match ld+json script content in roads.html');

  const parsed = JSON.parse(match[1]);
  assert.equal(parsed['@context'], 'https://schema.org');
  assert.ok(Array.isArray(parsed['@graph']), 'Schema must use @graph array');

  const webPage = parsed['@graph'].find(item => item['@type'] === 'WebPage');
  assert.ok(webPage, 'Must define WebPage');

  const announcement = parsed['@graph'].find(item => item['@type'] === 'SpecialAnnouncement');
  assert.ok(announcement, 'Must define SpecialAnnouncement');
  assert.ok(announcement.text.includes('Cuts Road'));
  assert.ok(announcement.text.includes('Muchelney'));
  assert.ok(announcement.text.includes('Travel Somerset'));

  const dataset = parsed['@graph'].find(item => item['@type'] === 'Dataset');
  assert.ok(dataset, 'Must define Dataset');
  assert.ok(dataset.name.includes('Highway Crown Elevation & Passability Dataset'));
});

test('Static Semantic HTML Fallback: index.html and roads.html contain informative noscript blocks', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/index.html'), 'utf8');
  assert.ok(indexHtml.includes('<noscript>'), 'index.html must contain <noscript>');
  assert.ok(indexHtml.includes('Hookbridge Spillway (52118, Crest 7.45m AOD)'), 'index.html noscript must list Hookbridge');
  assert.ok(indexHtml.includes('/api/summary.md'), 'index.html noscript must link to summary.md');

  const roadsHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/roads.html'), 'utf8');
  assert.ok(roadsHtml.includes('<noscript>'), 'roads.html must contain <noscript>');
  assert.ok(roadsHtml.includes('Cuts Road (East Lyng ↔ Athelney)'), 'roads.html noscript must list Cuts Road');
  assert.ok(roadsHtml.includes('Muchelney Spine Road'), 'roads.html noscript must list Muchelney');
  assert.ok(roadsHtml.includes('Never attempt to drive through floodwater'), 'roads.html noscript must contain life safety warning');
  assert.ok(roadsHtml.includes('https://www.travelsomerset.co.uk'), 'roads.html noscript must link Travel Somerset');
});

test('Live Briefing Null-Safety: renderSummaryMarkdown handles null, empty, or throwing db gracefully', () => {
  // Test with null stored telemetry
  const mdFromNull = renderSummaryMarkdown(null);
  assert.ok(typeof mdFromNull === 'string' && mdFromNull.length > 500, 'Must generate valid markdown when stored is null');
  assert.ok(mdFromNull.includes('# Somerset Levels & Moors Flood Telemetry — Live Situation Report'));

  // Test with empty object stored telemetry
  const mdFromEmpty = renderSummaryMarkdown({});
  assert.ok(typeof mdFromEmpty === 'string' && mdFromEmpty.length > 500, 'Must generate valid markdown when stored is empty');

  // Test with throwing / locked SQLite DB instance
  const lockedDb = { prepare: () => { throw new Error('database is locked (SQLITE_BUSY)'); } };
  const mdFromLockedDb = renderSummaryMarkdown(undefined, lockedDb);
  assert.ok(typeof mdFromLockedDb === 'string' && mdFromLockedDb.length > 500, 'Must handle locked database without throwing');
});
