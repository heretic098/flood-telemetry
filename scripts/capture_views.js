#!/usr/bin/env node
/**
 * Automated Headless Chrome Visual Snapshot & Cross-View Parity Tool
 *
 * Reliably captures full-height screenshots of the Main Dashboard (index.html)
 * and River Network Topology View (topology.html) in parallel using pre-calibrated
 * viewport dimensions so no cards or inspector drawers are clipped.
 *
 * Usage:
 *   npm run snapshot
 *   node scripts/capture_views.js [--station=52163] [--out-dir=/tmp/flood-snapshots]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const execFileAsync = promisify(execFile);

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

function findChromeBinary() {
  for (const bin of CHROME_CANDIDATES) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error(`No Chrome/Chromium binary found in ${CHROME_CANDIDATES.join(', ')}`);
}

function checkServerAlive(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function run() {
  const args = process.argv.slice(2);
  const stationArg = args.find(a => a.startsWith('--station='))?.split('=')[1] || '52163';
  const outDirArg = args.find(a => a.startsWith('--out-dir='))?.split('=')[1] || '/tmp/flood-snapshots';

  fs.mkdirSync(outDirArg, { recursive: true });
  const chromeBin = findChromeBinary();

  let baseUrl = 'http://localhost:3000';
  let ephemeralServer = null;

  const isRunning = await checkServerAlive(`${baseUrl}/api/health`);
  if (!isRunning) {
    const { server } = await import('../server.js');
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        ephemeralServer = server;
        resolve();
      });
    });
  }

  const dashboardPath = path.join(outDirArg, 'dashboard_main.png');
  const topologyPath = path.join(outDirArg, `topology_${stationArg}.png`);

  const commonFlags = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--virtual-time-budget=2500'
  ];

  const t0 = Date.now();
  try {
    await Promise.all([
      execFileAsync(chromeBin, [
        ...commonFlags,
        '--window-size=1440,1850',
        `--screenshot=${dashboardPath}`,
        `${baseUrl}/index.html`
      ]),
      execFileAsync(chromeBin, [
        ...commonFlags,
        '--window-size=1440,1250',
        `--screenshot=${topologyPath}`,
        `${baseUrl}/topology.html?station=${encodeURIComponent(stationArg)}`
      ])
    ]);

    const elapsedMs = Date.now() - t0;
    console.log(`[Snapshot Complete in ${elapsedMs}ms]`);
    console.log(`  1. Main Dashboard (1440x1850): ${dashboardPath}`);
    console.log(`  2. Topology View  (1440x1250): ${topologyPath}`);
  } finally {
    if (ephemeralServer) {
      await new Promise(resolve => ephemeralServer.close(resolve));
    }
  }
}

run().catch((err) => {
  console.error('[Snapshot Error]', err.message);
  process.exit(1);
});
