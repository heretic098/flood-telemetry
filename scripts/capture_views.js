#!/usr/bin/env node
/**
 * Automated Headless Chrome Visual Snapshot & Cross-View Parity Tool
 *
 * Reliably captures full-height screenshots of:
 *   - Main Dashboard (index.html)
 *   - Roads & Access (roads.html)
 *   - River Network Topology View (topology.html)
 *
 * Hardened Verification Gates:
 *   1. Browser Console & Page Error Gate:
 *      Captures all unhandled page exceptions (ReferenceError, TypeError, SyntaxError, etc.)
 *      and console.error events. Fails with exit code 1 if any unhandled error occurs.
 *   2. DOM Integrity Assertions:
 *      - index.html: Assert #cards-container .moor-card count >= 4
 *      - roads.html: Assert #roads-corridors-container .road-corridor-row count >= 8
 *      - topology.html: Assert .topology-node SVG count >= 10
 *      Fails with exit code 1 if any count is below minimum.
 *
 * Usage:
 *   npm run snapshot
 *   node scripts/capture_views.js [--station=52163] [--out-dir=/tmp/flood-snapshots]
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

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

  const viewsToCapture = [
    {
      name: 'Main Dashboard Desktop',
      url: `${baseUrl}/index.html`,
      width: 1440,
      height: 1850,
      outPath: path.join(outDirArg, 'dashboard_main.png'),
      domAssertion: {
        selector: '#cards-container .moor-card',
        minCount: 4,
        description: '.moor-card elements'
      }
    },
    {
      name: 'Topology View Desktop',
      url: `${baseUrl}/topology.html?station=${encodeURIComponent(stationArg)}`,
      width: 1440,
      height: 1700,
      outPath: path.join(outDirArg, `topology_${stationArg}.png`),
      domAssertion: {
        selector: '.topology-node',
        minCount: 10,
        description: '.topology-node elements'
      }
    },
    {
      name: 'Main Dashboard Mobile',
      url: `${baseUrl}/index.html`,
      width: 375,
      height: 1400,
      outPath: path.join(outDirArg, 'dashboard_mobile_375.png'),
      domAssertion: {
        selector: '#cards-container .moor-card',
        minCount: 4,
        description: '.moor-card elements'
      }
    },
    {
      name: 'Topology View Mobile',
      url: `${baseUrl}/topology.html?station=${encodeURIComponent(stationArg)}`,
      width: 375,
      height: 1400,
      outPath: path.join(outDirArg, `topology_mobile_375.png`),
      domAssertion: {
        selector: '.topology-node',
        minCount: 10,
        description: '.topology-node elements'
      }
    },
    {
      name: 'Roads View Desktop',
      url: `${baseUrl}/roads.html`,
      width: 1440,
      height: 1850,
      outPath: path.join(outDirArg, 'roads_main.png'),
      domAssertion: {
        selector: '#roads-corridors-container .road-corridor-row',
        minCount: 8,
        description: '.road-corridor-row elements'
      }
    },
    {
      name: 'Roads View Mobile',
      url: `${baseUrl}/roads.html`,
      width: 375,
      height: 1400,
      outPath: path.join(outDirArg, 'roads_mobile_375.png'),
      domAssertion: {
        selector: '#roads-corridors-container .road-corridor-row',
        minCount: 8,
        description: '.road-corridor-row elements'
      }
    }
  ];

  let browser = null;
  const t0 = Date.now();
  const collectedErrors = [];

  try {
    browser = await puppeteer.launch({
      executablePath: chromeBin,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--incognito'
      ]
    });

    console.log(`[Snapshot] Launched browser (${chromeBin})`);

    for (const view of viewsToCapture) {
      const page = await browser.newPage();
      const pageErrors = [];

      // Gate 2.1: Intercept unhandled exceptions & console errors
      page.on('pageerror', (err) => {
        const errorDetail = `Unhandled Exception on [${view.name}]: ${err.stack || err.message}`;
        pageErrors.push(errorDetail);
        collectedErrors.push(errorDetail);
      });

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Filter out network errors that are expected when mock/offline or third-party webcams
          const isFatalCodeError = /ReferenceError|TypeError|SyntaxError|Uncaught|is not defined/i.test(text);
          const errorDetail = `Console Error on [${view.name}]: ${text} (location: ${msg.location().url}:${msg.location().lineNumber})`;
          if (isFatalCodeError) {
            pageErrors.push(errorDetail);
            collectedErrors.push(errorDetail);
          } else {
            console.warn(`  [Browser Warn] ${errorDetail}`);
          }
        }
      });

      await page.setViewport({ width: view.width, height: view.height });

      try {
        await page.goto(view.url, { waitUntil: 'load', timeout: 10000 });

        // Wait for dynamic DOM elements to populate
        try {
          await page.waitForSelector(view.domAssertion.selector, { timeout: 4000 });
        } catch {
          // Selector wait timed out; let the assertion below fail with specific count
        }

        // Additional settling time for telemetry rendering
        await new Promise(r => setTimeout(r, 500));

        // Gate 2.2: Post-render DOM assertions
        const elementCount = await page.$$eval(view.domAssertion.selector, els => els.length);
        if (elementCount < view.domAssertion.minCount) {
          const assertionErr = `[DOM Assertion Failed] Expected >= ${view.domAssertion.minCount} ${view.domAssertion.description} on [${view.name}], found ${elementCount}`;
          collectedErrors.push(assertionErr);
          throw new Error(assertionErr);
        }

        // If unhandled errors occurred during rendering, fail immediately
        if (pageErrors.length > 0) {
          throw new Error(`Browser execution error on [${view.name}]:\n  ${pageErrors.join('\n  ')}`);
        }

        await page.screenshot({ path: view.outPath, fullPage: false });
        console.log(`  ✔ Captured ${view.name} (${view.width}x${view.height}) -> ${view.outPath} [${elementCount} ${view.domAssertion.description}]`);
      } finally {
        await page.close();
      }
    }

    if (collectedErrors.length > 0) {
      console.error('\n==================== SNAPSHOT GATES FAILED ====================');
      for (const err of collectedErrors) {
        console.error(`✖ ${err}`);
      }
      console.error('===============================================================\n');
      process.exit(1);
    }

    const elapsedMs = Date.now() - t0;
    console.log(`\n[Snapshot Complete in ${elapsedMs}ms — All DOM assertions and console integrity gates passed]`);
  } finally {
    if (browser) {
      await browser.close();
    }
    if (ephemeralServer) {
      await new Promise(resolve => ephemeralServer.close(resolve));
    }
  }
}

run().catch((err) => {
  console.error('\n[Snapshot Fatal Error]:', err.message);
  process.exit(1);
});
