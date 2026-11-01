#!/usr/bin/env node

/**
 * audit_external_links.js
 * Scans the codebase for external HTTP/HTTPS links and verifies their health via live network requests.
 * Usage: node scripts/audit_external_links.js [--fail-fast]
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const filesToScan = [
  'src/index.html',
  'src/topology.html',
  'src/methodology.html',
  'src/js/app.js',
  'src/js/topology.js',
  'src/js/hydro_engine.js',
  'server.js'
];

const urlRegex = /https?:\/\/[^\s"'`<>]+/g;
const urls = new Set();

for (const rel of filesToScan) {
  const full = path.join(ROOT_DIR, rel);
  if (fs.existsSync(full)) {
    const content = fs.readFileSync(full, 'utf8');
    const matches = content.match(urlRegex) || [];
    for (const m of matches) {
      const clean = m.replace(/[),;.]+$/, '');
      if (!clean.includes('${') && !clean.includes('localhost') && !clean.includes('127.0.0.1') && !clean.includes('{id}')) {
        urls.add(clean);
      }
    }
  }
}

console.log(`[Link Auditor] Extracted ${urls.size} unique candidate URLs across codebase.`);

function checkUrl(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(parsed, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SomersetFloodTelemetryLinkChecker/1.0'
        },
        timeout: 10000
      }, (res) => {
        // Some services return 405 Method Not Allowed or 403 on HEAD, fallback to GET
        if (res.statusCode === 405 || res.statusCode === 403) {
          const getReq = client.request(parsed, {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SomersetFloodTelemetryLinkChecker/1.0'
            },
            timeout: 10000
          }, (getRes) => {
            getRes.resume();
            resolve({ url, status: getRes.statusCode });
          });
          getReq.on('timeout', () => { getReq.destroy(); resolve({ url, status: 'TIMEOUT' }); });
          getReq.on('error', (err) => resolve({ url, status: `ERR: ${err.message}` }));
          getReq.end();
          return;
        }
        res.resume();
        resolve({ url, status: res.statusCode });
      });

      req.on('timeout', () => { req.destroy(); resolve({ url, status: 'TIMEOUT' }); });
      req.on('error', (err) => resolve({ url, status: `ERR: ${err.message}` }));
      req.end();
    } catch (e) {
      resolve({ url, status: `INVALID: ${e.message}` });
    }
  });
}

async function checkUrlWithRetry(url, retries = 1) {
  let result = await checkUrl(url);
  if (result.status === 'TIMEOUT' && retries > 0) {
    // Wait 500ms before retrying once
    await new Promise(r => setTimeout(r, 500));
    result = await checkUrl(url);
  }
  return result;
}

async function run() {
  const list = Array.from(urls).sort();
  let failures = 0;

  for (const u of list) {
    const res = await checkUrlWithRetry(u);
    const ok = (typeof res.status === 'number' && res.status >= 200 && res.status < 400);
    const icon = ok ? '✅' : '❌';
    console.log(`${icon} [${res.status}] ${res.url}`);
    if (!ok) failures++;
    // Small inter-request pacing to avoid triggering upstream rate limits
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n[Link Auditor] Completed scan of ${list.length} URLs. Failures: ${failures}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

run();
