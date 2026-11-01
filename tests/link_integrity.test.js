import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATION_REGISTRY, DEFAULT_TOPOLOGY_NODES } from '../src/js/hydro_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('Link Integrity: No file passes 5-digit WISKI station IDs to check-for-flooding.service.gov.uk', () => {
  const filesToScan = [
    'src/index.html',
    'src/topology.html',
    'src/methodology.html',
    'src/js/app.js',
    'src/js/topology.js',
    'src/js/hydro_engine.js',
    'server.js'
  ];

  // Regex matches check-for-flooding station URL with 5-digit ID (which are WISKI IDs that 404)
  const invalidGovUkPattern = /check-for-flooding\.service\.gov\.uk\/station\/([0-9]{5})/g;

  for (const relPath of filesToScan) {
    const fullPath = path.join(ROOT_DIR, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    const matches = [...content.matchAll(invalidGovUkPattern)];
    assert.equal(
      matches.length,
      0,
      `Found invalid 5-digit GOV.UK link in ${relPath}: ${matches.map(m => m[0]).join(', ')}. Use RLOI IDs (3xxx/9xxx) instead of WISKI IDs (52xxx).`
    );
  }
});

test('Link Integrity: Fallback station links in topology.js never use check-for-flooding with dynamic node.id', () => {
  const topologyJs = fs.readFileSync(path.join(ROOT_DIR, 'src/js/topology.js'), 'utf8');
  assert.ok(
    !topologyJs.includes('check-for-flooding.service.gov.uk/station/${node.id}'),
    'topology.js must never fall back to check-for-flooding.service.gov.uk with raw station node.id'
  );
});

test('Link Integrity: All STATION_REGISTRY nodes with govuk_link point to valid RLOI patterns', () => {
  for (const [id, station] of Object.entries(STATION_REGISTRY)) {
    if (station.govuk_link) {
      assert.match(
        station.govuk_link,
        /^https:\/\/check-for-flooding\.service\.gov\.uk\/station\/[0-9]{3,4}$/,
        `Station ${id} (${station.name}) govuk_link must point to a 3-4 digit RLOI ID, got: ${station.govuk_link}`
      );
    }
  }
});

test('Link Integrity: All DEFAULT_TOPOLOGY_NODES with govuk_link point to valid RLOI patterns', () => {
  for (const node of DEFAULT_TOPOLOGY_NODES) {
    if (node.govuk_link) {
      assert.match(
        node.govuk_link,
        /^https:\/\/check-for-flooding\.service\.gov\.uk\/station\/[0-9]{3,4}$/,
        `Topology node ${node.id} (${node.name}) govuk_link must point to a 3-4 digit RLOI ID, got: ${node.govuk_link}`
      );
    }
  }
});

test('Link Integrity: EA Somerset Levels Trigger Point Plan link is current', () => {
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'src/js/app.js'), 'utf8');
  assert.ok(
    !appJs.includes('guidance/somerset-levels-and-moors-reducing-the-risk-of-flooding'),
    'Old 404 guidance URL for Somerset Levels Trigger Point Plan found in app.js'
  );
  assert.ok(
    appJs.includes('government/publications/somerset-levels-and-moors-reducing-the-risk-of-flooding'),
    'Current publication URL for Somerset Levels Trigger Point Plan must be present in app.js'
  );
});
