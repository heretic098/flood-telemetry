import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAMERA_FIELD_GUIDES,
  openCameraGuide,
  closeCameraGuide
} from '../src/js/camera_guide.js';

import {
  evaluateRoadNetwork,
  ASSET_DEFINITIONS,
  STATION_REGISTRY
} from '../src/js/hydro_engine.js';

import {
  updateRoadStatusSummaryBanner
} from '../src/js/app.js';

import {
  ROAD_TOPOLOGY_STATION_MAP,
  ROAD_CAMERA_GUIDE_MAP,
  renderCorridorRow,
  updateSummaryCards
} from '../src/js/roads.js';

import {
  getDashboardCardIdForNode
} from '../src/js/topology.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Load source documents
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/index.html'), 'utf8');
const roadsHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/roads.html'), 'utf8');
const topologyHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/topology.html'), 'utf8');
const methodologyHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/methodology.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'src/css/styles.css'), 'utf8');
const captureViewsJs = fs.readFileSync(path.join(ROOT_DIR, 'scripts/capture_views.js'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT_DIR, 'src/js/app.js'), 'utf8');
const topologyJs = fs.readFileSync(path.join(ROOT_DIR, 'src/js/topology.js'), 'utf8');
const roadsJs = fs.readFileSync(path.join(ROOT_DIR, 'src/js/roads.js'), 'utf8');
const cameraGuideJs = fs.readFileSync(path.join(ROOT_DIR, 'src/js/camera_guide.js'), 'utf8');

// ============================================================================
// 1. Roads View Carve-Out & Navigation Audit
// ============================================================================

test('Roads Carve-Out: Consistent 4-tab navigation bar across all pages with active states', () => {
  const pages = [
    { name: 'index.html', html: indexHtml, activeTab: 'index.html' },
    { name: 'roads.html', html: roadsHtml, activeTab: 'roads.html' },
    { name: 'topology.html', html: topologyHtml, activeTab: 'topology.html' },
    { name: 'methodology.html', html: methodologyHtml, activeTab: 'methodology.html' }
  ];

  for (const page of pages) {
    assert.ok(page.html.includes('aria-label="Main Navigation"'), `${page.name} must have Main Navigation header`);
    assert.ok(page.html.includes('href="index.html"'), `${page.name} must link to index.html`);
    assert.ok(page.html.includes('href="roads.html"'), `${page.name} must link to roads.html`);
    assert.ok(page.html.includes('href="topology.html"'), `${page.name} must link to topology.html`);
    assert.ok(page.html.includes('href="methodology.html"'), `${page.name} must link to methodology.html`);

    // Verify nav links use nav-link class
    assert.ok(page.html.includes('class="nav-btn nav-link'), `${page.name} nav buttons must have nav-link class`);

    // Verify active tab highlighting
    const activeRegex = new RegExp(`href="${page.activeTab}"[^>]*class="[^"]*active[^"]*"[^>]*aria-current="page"`);
    assert.match(page.html, activeRegex, `${page.name} must mark ${page.activeTab} as active with aria-current="page"`);
  }
});

test('Roads Carve-Out: roads.html contains complete standalone structure and invariants', () => {
  assert.ok(roadsHtml.includes('Somerset Levels Road Network &amp; Access Status') || roadsHtml.includes('Somerset Levels Road Network & Access Status'), 'roads.html must have prominent title');
  assert.ok(roadsHtml.includes('id="summary-impassable-count"'), 'roads.html must have impassable summary counter');
  assert.ok(roadsHtml.includes('id="summary-encroaching-count"'), 'roads.html must have encroaching summary counter');
  assert.ok(roadsHtml.includes('id="summary-passable-count"'), 'roads.html must have passable summary counter');

  // Life-safety and epistemic humility banners
  assert.ok(roadsHtml.includes('road-safety-banner'), 'roads.html must have road-safety-banner');
  assert.ok(roadsHtml.includes('Never attempt to drive through floodwater.'), 'roads.html must warn never attempt to drive through floodwater');
  assert.ok(roadsHtml.includes('https://www.travelsomerset.co.uk'), 'roads.html must link to Travel Somerset');
  assert.ok(roadsHtml.includes('road-humility-notice'), 'roads.html must have road-humility-notice');

  // Filter bar
  assert.ok(roadsHtml.includes('class="road-filter-bar"'), 'roads.html must have filter toolbar');
  assert.ok(roadsHtml.includes('data-filter="all"'), 'Filter bar must have all filter');
  assert.ok(roadsHtml.includes('data-filter="impassable"'), 'Filter bar must have impassable filter');
  assert.ok(roadsHtml.includes('data-filter="encroaching"'), 'Filter bar must have encroaching filter');
  assert.ok(roadsHtml.includes('data-filter="passable"'), 'Filter bar must have passable filter');

  // Corridors container
  assert.ok(roadsHtml.includes('id="roads-corridors-container"'), 'roads.html must have container for corridor rows');

  // Historical reference table
  assert.ok(roadsHtml.includes('roads-reference-section'), 'roads.html must have reference section');
  assert.ok(roadsHtml.includes('roads-ref-table'), 'roads.html must have reference table');
  assert.ok(roadsHtml.includes('Cuts Road'), 'Reference table must document Cuts Road');
  assert.ok(roadsHtml.includes('Muchelney Spine Road'), 'Reference table must document Muchelney');
  assert.ok(roadsHtml.includes('A361 Corridor'), 'Reference table must document A361');
  assert.ok(roadsHtml.includes('Beer Wall / A372'), 'Reference table must document Beer Wall');

  // Legal footer
  assert.ok(roadsHtml.includes('Public Safety &amp; Non-Reliance Notice'), 'roads.html must have legal notice');
  assert.ok(roadsHtml.includes('Open Government Licence v3.0'), 'roads.html must attribute OGL v3.0');
  assert.ok(roadsHtml.includes('Apache 2.0 License'), 'roads.html must cite Apache 2.0 License');
});

test('Roads Carve-Out: index.html has compact 1-line road status banner and no massive road card in main grid', () => {
  assert.ok(indexHtml.includes('id="road-status-summary-banner"'), 'index.html must have #road-status-summary-banner');
  assert.ok(indexHtml.includes('href="roads.html"'), 'Road status banner must link to roads.html');

  // Check app.js does not append full road network card to main cards-container
  assert.ok(
    !appJs.includes('container.appendChild(roadCard)'),
    'app.js must NOT append the massive full roadCard to the main cards container on index.html'
  );
  assert.ok(
    appJs.includes('updateRoadStatusSummaryBanner(roadData)'),
    'app.js must call updateRoadStatusSummaryBanner to drive the 1-line bridge banner'
  );
});

test('Roads Carve-Out: updateRoadStatusSummaryBanner reflects passable vs affected warning states', () => {
  // Lightweight mock DOM
  const mockBanner = {
    className: '',
    innerHTML: ''
  };
  const mockDoc = {
    getElementById(id) {
      if (id === 'road-status-summary-banner') return mockBanner;
      return null;
    }
  };

  const origDoc = globalThis.document;
  globalThis.document = mockDoc;

  try {
    // 1. All Passable scenario
    const mockAllPassable = {
      corridors_list: [
        { name: 'Cuts Road', status: 'PASSABLE' },
        { name: 'A361', status: 'PASSABLE' }
      ],
      counts: { all: 2, impassable: 0, encroaching: 0, passable: 2 }
    };

    updateRoadStatusSummaryBanner(mockAllPassable);
    assert.ok(mockBanner.className.includes('banner-passable'), 'Banner must have banner-passable class');
    assert.ok(mockBanner.innerHTML.includes('All 8 Monitored Corridors Passable') || mockBanner.innerHTML.includes('Passable'), 'Banner must indicate passable');
    assert.ok(mockBanner.innerHTML.includes('View Roads Status ↗'), 'Banner must have action link');

    // 2. Affected scenario with Impassable corridor
    const mockAffected = {
      corridors_list: [
        { name: 'Cuts Road', status: 'IMPASSABLE' },
        { name: 'A361', status: 'PASSABLE' }
      ],
      counts: { all: 2, impassable: 1, encroaching: 0, passable: 1 }
    };

    updateRoadStatusSummaryBanner(mockAffected);
    assert.ok(mockBanner.className.includes('banner-critical'), 'Banner must have banner-critical class when closed');
    assert.ok(mockBanner.innerHTML.includes('Road Warning:'), 'Banner must announce Road Warning');
    assert.ok(mockBanner.innerHTML.includes('Cuts Road Impassable'), 'Banner must identify lead closed corridor');
    assert.ok(mockBanner.innerHTML.includes('View Roads Dashboard ↗'), 'Banner must link to roads dashboard');
  } finally {
    globalThis.document = origDoc;
  }
});

// ============================================================================
// 2. Issue #18: Community Camera Field Guide & FOV Fidelity Audit
// ============================================================================

test('Issue #18: CAMERA_FIELD_GUIDES contains all 6 required sites with complete metadata', () => {
  const expectedSites = ['dunball', 'hookbridge', 'currymoor', 'saltmoor', 'baltmoor', 'monksleaze'];

  for (const site of expectedSites) {
    const guide = CAMERA_FIELD_GUIDES[site];
    assert.ok(guide, `Site ${site} must exist in CAMERA_FIELD_GUIDES`);
    assert.ok(guide.title && guide.title.length > 5, `${site} must have informative title`);
    assert.ok(guide.cfhUrl && guide.cfhUrl.includes('thecfh.org'), `${site} cfhUrl must point to thecfh.org`);
    assert.ok(guide.subtitle && guide.subtitle.length > 10, `${site} must have descriptive subtitle`);
    assert.ok(Array.isArray(guide.questions) && guide.questions.length >= 2, `${site} must have layperson questions`);
    assert.ok(Array.isArray(guide.checklist) && guide.checklist.length >= 2, `${site} must have visual checklist`);
  }
});

test('Issue #18: [RULE-CAM-01] FOV Fidelity: Checklist strictly describes physical lenses and disclaims internal mechanics', () => {
  const forbiddenPhrases = [
    'internal sluice gate position',
    'view underground penstock',
    'measure cumecs optically',
    'verify padlock optically',
    'ai gate aperture detection'
  ];

  for (const [siteKey, guide] of Object.entries(CAMERA_FIELD_GUIDES)) {
    for (const item of guide.checklist) {
      assert.ok(item.cameraName, `${siteKey} item must have cameraName`);
      assert.ok(item.description, `${siteKey} item must have description of lens FOV`);
      assert.ok(item.lookFor, `${siteKey} item must have clear lookFor guidelines`);
      assert.ok(item.physicalLimitation, `${siteKey} item must state physical limitations per [RULE-CAM-01]`);

      const text = `${item.description} ${item.lookFor} ${item.physicalLimitation}`.toLowerCase();
      for (const phrase of forbiddenPhrases) {
        assert.ok(!text.includes(phrase), `${siteKey} must not contain forbidden phrase "${phrase}"`);
      }
    }
  }

  // Cuts Road & Athelney camera must explicitly disclaim council gate padlocks
  const baltmoorGuide = CAMERA_FIELD_GUIDES.baltmoor;
  const cutsRoadItem = baltmoorGuide.checklist.find(i => i.cameraName.includes('Cuts Road'));
  assert.ok(cutsRoadItem, 'Baltmoor guide must include Cuts Road item');
  assert.ok(
    cutsRoadItem.physicalLimitation.includes('padlock') && cutsRoadItem.physicalLimitation.includes('gates'),
    'Cuts Road physical limitation must state that optical cameras cannot verify padlock status on council emergency gates'
  );

  // Monk\'s Leaze Clyse camera must disclaim submerged gate apertures and cumecs
  const monksGuide = CAMERA_FIELD_GUIDES.monksleaze;
  const sowyItem = monksGuide.checklist.find(i => i.cameraName.includes('Sowy Relief'));
  assert.ok(sowyItem, 'Monksleaze guide must include Sowy Relief item');
  assert.ok(
    sowyItem.physicalLimitation.includes('aperture') || sowyItem.physicalLimitation.includes('cumecs'),
    'Monksleaze limitation must disclaim internal gate aperture millimeters and cumecs'
  );
});

test('Issue #18: Camera Guide modal markup complies with dialog, aria-modal, and focus accessibility', () => {
  assert.ok(cameraGuideJs.includes('role="dialog"'), 'Camera guide must set role="dialog"');
  assert.ok(cameraGuideJs.includes('aria-modal="true"'), 'Camera guide must set aria-modal="true"');
  assert.ok(cameraGuideJs.includes('aria-labelledby="camera-guide-title"'), 'Camera guide must link aria-labelledby to title');
  assert.ok(cameraGuideJs.includes('closeCameraGuide'), 'Camera guide must export closeCameraGuide');
  assert.ok(cameraGuideJs.includes('openCameraGuide'), 'Camera guide must export openCameraGuide');

  // Verify Escape key and Tab focus trapping handling in camera_guide.js
  assert.ok(cameraGuideJs.includes("e.key === 'Escape'"), 'Camera guide must close on Escape key');
  assert.ok(cameraGuideJs.includes("e.key === 'Tab'"), 'Camera guide must implement Tab key focus trapping');
});

test('Issue #18: Camera Guide triggers integrated across Asset Cards, Roads View, and Topology Inspector', () => {
  assert.ok(appJs.includes('camera-guide-trigger') || appJs.includes('data-camera-guide'), 'app.js must render camera guide trigger buttons');
  assert.ok(roadsJs.includes('data-camera-guide'), 'roads.js must wire camera guide triggers on corridor rows');
  assert.ok(topologyJs.includes('data-camera-guide'), 'topology.js must wire camera guide trigger in inspector drawer');
});

// ============================================================================
// 3. Issue #17: Bidirectional Deep Linking & Time Preset Preservation
// ============================================================================

test('Issue #17: Dashboard cards provide direct links to River Topology Map with station parameter', () => {
  assert.ok(appJs.includes('topology.html?station=52118'), 'Curry Moor card must deep-link to topology.html?station=52118');
  assert.ok(appJs.includes('topology.html?station=52158'), 'Baltmoor Wall card must deep-link to topology.html?station=52158');
  assert.ok(appJs.includes('topology.html?station=52233'), 'Sowy Relief card must deep-link to topology.html?station=52233');
  assert.ok(appJs.includes('topology.html?station=52163'), 'Dunball Sea card must deep-link to topology.html?station=52163');
  assert.ok(appJs.includes('topology.html?station=52120'), 'Langport Confluence card must deep-link to topology.html?station=52120');

  // Road corridors map to primary topology stations
  for (const [corridorId, stationId] of Object.entries(ROAD_TOPOLOGY_STATION_MAP)) {
    assert.ok(stationId, `Corridor ${corridorId} must map to a topology station ID`);
  }
});

test('Issue #17: River Topology Inspector Drawer provides direct link back to Dashboard Card with anchor', () => {
  assert.ok(
    topologyJs.includes('index.html#card-') || topologyJs.includes('btn-view-dashboard-card'),
    'topology.js must render View Full Dashboard Card button pointing to index.html#card-{id}'
  );

  // Test getDashboardCardIdForNode mapping function
  assert.equal(getDashboardCardIdForNode('52118'), '52118');
  assert.equal(getDashboardCardIdForNode('52127'), '52118');
  assert.equal(getDashboardCardIdForNode('52158'), '52158');
  assert.equal(getDashboardCardIdForNode('52159'), '52158');
  assert.equal(getDashboardCardIdForNode('52233'), '52233');
  assert.equal(getDashboardCardIdForNode('52234'), '52233');
  assert.equal(getDashboardCardIdForNode('52163'), '52163');
  assert.equal(getDashboardCardIdForNode('E9094'), '52163');
  assert.equal(getDashboardCardIdForNode('52120'), '52120');
  assert.equal(getDashboardCardIdForNode('52153'), '52120');
});

test('Issue #17: Shared time-preset preservation using sessionStorage across Dashboard and Topology', () => {
  assert.ok(
    appJs.includes("sessionStorage.setItem('somerset_time_range'") || appJs.includes("sessionStorage.setItem('somerset_time_range'"),
    'app.js must persist selected time range to sessionStorage key somerset_time_range'
  );
  assert.ok(
    appJs.includes("sessionStorage.getItem('somerset_time_range')"),
    'app.js must rehydrate selected time range from sessionStorage on load'
  );
  assert.ok(
    topologyJs.includes("sessionStorage.setItem('somerset_time_range'"),
    'topology.js must persist selected time range to sessionStorage'
  );
  assert.ok(
    topologyJs.includes("sessionStorage.getItem('somerset_time_range')"),
    'topology.js must rehydrate selected time range from sessionStorage'
  );
});

// ============================================================================
// 4. Issue #16: Printable Situation Report & Network Offline Banner Audit
// ============================================================================

test('Issue #16: styles.css contains comprehensive ink-friendly @media print rules', () => {
  assert.ok(stylesCss.includes('@media print'), 'styles.css must contain @media print');

  const printMatch = stylesCss.match(/@media print\s*\{([\s\S]*?)\n\}/);
  assert.ok(printMatch, '@media print block must exist in styles.css');
  const printBody = printMatch[1];

  // Inks and backgrounds
  assert.ok(printBody.includes('background: #ffffff !important;'), 'Print stylesheet must force pure white background to save ink');
  assert.ok(printBody.includes('color: #0f172a !important;'), 'Print stylesheet must force high-contrast dark text');

  // Hides non-essential controls
  assert.ok(printBody.includes('.nav-links') || printBody.includes('header nav'), 'Print stylesheet must hide navigation links');
  assert.ok(printBody.includes('button') || printBody.includes('.refresh-now-btn'), 'Print stylesheet must hide interactive buttons');
  assert.ok(printBody.includes('display: none !important;'), 'Print stylesheet must use display: none !important for interactive UI');

  // Situation report header
  assert.ok(printBody.includes('.print-situation-header'), 'Print stylesheet must style .print-situation-header');
  assert.ok(printBody.includes('display: block !important;'), 'Print header must be displayed in print mode');

  // Page break avoidance
  assert.ok(printBody.includes('break-inside: avoid !important;'), 'Print stylesheet must enforce break-inside: avoid on cards');
  assert.ok(printBody.includes('.moor-card'), 'Print stylesheet must include .moor-card');
  assert.ok(printBody.includes('.road-corridor-row') || printBody.includes('.road-network-card'), 'Print stylesheet must include road corridors');
});

test('Issue #16: Network offline banner is present and wired to browser online/offline events', () => {
  assert.ok(indexHtml.includes('id="network-offline-banner"'), 'index.html must include #network-offline-banner');
  assert.ok(roadsHtml.includes('id="network-offline-banner"'), 'roads.html must include #network-offline-banner');
  assert.ok(topologyHtml.includes('id="network-offline-banner"'), 'topology.html must include #network-offline-banner');

  // Event wiring in JavaScript
  assert.ok(appJs.includes("window.addEventListener('offline'"), 'app.js must listen for offline event');
  assert.ok(appJs.includes("window.addEventListener('online'"), 'app.js must listen for online event');
  assert.ok(roadsJs.includes("window.addEventListener('offline'"), 'roads.js must listen for offline event');
  assert.ok(roadsJs.includes("window.addEventListener('online'"), 'roads.js must listen for online event');

  // Banner text specifications
  assert.ok(appJs.includes('Network Disconnected') || roadsJs.includes('Network Disconnected'), 'Offline banner must state Network Disconnected');
  assert.ok(appJs.includes('Connection Restored') || roadsJs.includes('Connection Restored'), 'Online transition must state Connection Restored');
});

// ============================================================================
// 5. Automated Snapshot Suite Audit (6 Targets)
// ============================================================================

test('Automated Snapshot Suite: capture_views.js configures all 6 desktop and mobile targets', () => {
  assert.ok(captureViewsJs.includes('dashboard_main.png'), 'capture_views.js must capture dashboard_main.png (Desktop)');
  assert.ok(captureViewsJs.includes('topology_'), 'capture_views.js must capture topology desktop');
  assert.ok(captureViewsJs.includes('dashboard_mobile_375.png'), 'capture_views.js must capture dashboard_mobile_375.png (Mobile)');
  assert.ok(captureViewsJs.includes('topology_mobile_375.png'), 'capture_views.js must capture topology_mobile_375.png (Mobile)');
  assert.ok(captureViewsJs.includes('roads_main.png'), 'capture_views.js must capture roads_main.png (Desktop)');
  assert.ok(captureViewsJs.includes('roads_mobile_375.png'), 'capture_views.js must capture roads_mobile_375.png (Mobile)');

  // Verify URL routes
  assert.ok(captureViewsJs.includes('roads.html'), 'capture_views.js must visit roads.html');
  assert.ok(captureViewsJs.includes('index.html'), 'capture_views.js must visit index.html');
  assert.ok(captureViewsJs.includes('topology.html'), 'capture_views.js must visit topology.html');
  assert.ok(captureViewsJs.includes('--incognito'), 'capture_views.js must run with --incognito to prevent stale cache contamination');
});

// ============================================================================
// 6. Cynical Auditor Rigorous Regressions & Edge Cases
// ============================================================================

test('Cynical Auditor Check: setupCatchmentNav dynamic navigation parity across 4 tabs', () => {
  // Must render all 4 tabs dynamically, not just legacy 3
  assert.ok(appJs.includes('roads.html'), 'setupCatchmentNav must include roads.html');
  assert.ok(appJs.includes('🚗 Roads &amp; Access'), 'setupCatchmentNav must include Roads link label');
  assert.ok(appJs.includes('📊 Overview'), 'setupCatchmentNav must use Overview label');
  assert.ok(appJs.includes('🗺️ River Topology'), 'setupCatchmentNav must use River Topology label');
  assert.ok(appJs.includes('📖 Methodology'), 'setupCatchmentNav must use Methodology label');
});

test('Cynical Auditor Check: No unhandled reference to undefined roadCard in app.js', () => {
  assert.ok(!appJs.includes('if (roadCard'), 'app.js must not reference undefined roadCard identifier');
});

test('Cynical Auditor Check: Print timestamp populated dynamically in app.js and roads.js', () => {
  assert.ok(appJs.includes('print-time-stamp'), 'app.js must populate print-time-stamp');
  assert.ok(roadsJs.includes('print-time-stamp'), 'roads.js must populate print-time-stamp');
});

test('Cynical Auditor Check: Jargon popover initialization invoked in roads view', () => {
  assert.ok(roadsJs.includes('initJargonPopovers'), 'roads.js must import and call initJargonPopovers');
});

test('Cynical Auditor Check: Post-render URL hash scrolling support in app.js for deep links', () => {
  assert.ok(appJs.includes('window.location.hash'), 'app.js must inspect window.location.hash after card render');
  assert.ok(appJs.includes('scrollIntoView'), 'app.js must scroll target card into view on hash match');
});
