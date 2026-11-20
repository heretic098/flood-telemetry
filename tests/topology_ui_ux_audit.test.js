import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JARGON_DEFINITIONS, renderJargonTerm } from '../src/js/jargon_popover.js';
import { DEFAULT_TOPOLOGY_EDGES, TOPOLOGY_NETWORK_CONFIG, HYDRO_THRESHOLDS } from '../src/js/hydro_engine.js';
import { resolveCandidateCamerasForAsset } from '../src/js/event_camera_correlator.js';
import { CAMERA_CATALOG } from '../src/js/api/camera_buffer.js';

// Load source files for automated static and heuristic analysis
const topologyJsPath = path.resolve('src/js/topology.js');
const appJsPath = path.resolve('src/js/app.js');
const sparklineJsPath = path.resolve('src/js/sparkline.js');
const stylesCssPath = path.resolve('src/css/styles.css');
const topologyHtmlPath = path.resolve('src/topology.html');
const indexHtmlPath = path.resolve('src/index.html');
const methodologyHtmlPath = path.resolve('src/methodology.html');
const jargonPopoverJsPath = path.resolve('src/js/jargon_popover.js');

const topologyJs = fs.readFileSync(topologyJsPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const sparklineJs = fs.readFileSync(sparklineJsPath, 'utf8');
const stylesCss = fs.readFileSync(stylesCssPath, 'utf8');
const topologyHtml = fs.readFileSync(topologyHtmlPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const methodologyHtml = fs.readFileSync(methodologyHtmlPath, 'utf8');
const jargonPopoverJs = fs.readFileSync(jargonPopoverJsPath, 'utf8');

// Helper: WCAG relative luminance and contrast calculation
function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  const num = parseInt(hex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function getContrastRatio(hex1, hex2) {
  const lum1 = getLuminance(...hexToRgb(hex1));
  const lum2 = getLuminance(...hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// Helper: APCA (Accessible Perceptual Contrast Algorithm - W3C SAPC)
function getApcaY(r, g, b) {
  const rLin = Math.pow(r / 255.0, 2.4);
  const gLin = Math.pow(g / 255.0, 2.4);
  const bLin = Math.pow(b / 255.0, 2.4);
  let y = 0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin;
  if (y < 0.022) {
    y += Math.pow(0.022 - y, 1.414);
  }
  return y;
}

function getApcaContrast(txtHex, bgHex) {
  const yTxt = getApcaY(...hexToRgb(txtHex));
  const yBg = getApcaY(...hexToRgb(bgHex));
  // Dark mode (light text on dark background):
  if (yTxt >= yBg) {
    return (Math.pow(yTxt, 0.57) - Math.pow(yBg, 0.56)) * 1.14 * 100;
  }
  // Light mode (dark text on light background):
  return (Math.pow(yTxt, 0.62) - Math.pow(yBg, 0.65)) * 1.14 * 100;
}

// ---------------------------------------------------------------------------
// 1. Semantic Color & Token Invariants
// ---------------------------------------------------------------------------

test('UI/UX Audit 1.1: Color tokens enforce strict trichromatic separation (Zero Collisions)', () => {
  const nominalColors = ['#10b981', '#064e3b', '#38bdf8', '#0284c7', '#0c4a6e'];
  const alertColors = ['#f59e0b', '#fbbf24', '#78350f', '#d97706'];
  const overspillColors = ['#ef4444', '#7f1d1d', '#dc2626'];

  // Check that sets have empty intersection
  for (const c of nominalColors) {
    assert.ok(!alertColors.includes(c), `Nominal color ${c} must not collide with Alert colors`);
    assert.ok(!overspillColors.includes(c), `Nominal color ${c} must not collide with Overspill colors`);
  }
  for (const c of alertColors) {
    assert.ok(!overspillColors.includes(c), `Alert color ${c} must not collide with Overspill colors`);
  }
});

test('UI/UX Audit 1.2: Sea outfall nominal gravity discharge never uses warning colors (#fb923c or #f59e0b)', () => {
  // Extract sea_outfall logic from topology.js
  const seaOutfallMatch = topologyJs.match(/edge\.type\s*===\s*['"]sea_outfall['"][\s\S]*?\}/);
  assert.ok(seaOutfallMatch, 'sea_outfall edge handler must exist');
  
  const block = seaOutfallMatch[0];
  assert.ok(!block.includes('#fb923c'), 'sea_outfall discharge must NEVER use orange warning #fb923c');
  assert.ok(!block.includes('#f59e0b'), 'sea_outfall discharge must NEVER use amber warning #f59e0b');
  assert.ok(block.includes('#0284c7'), 'sea_outfall active discharge must use estuarine deep blue #0284c7');
});

test('UI/UX Audit 1.3: Arrowhead markers and line strokes are 100% color-aligned', () => {
  // Verify marker definition fills in topology.js
  assert.ok(topologyJs.includes('<path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />'), 'arrow-nominal marker fill must match stroke #38bdf8');
  assert.ok(topologyJs.includes('<path d="M 0 1 L 10 5 L 0 9 z" fill="#0284c7" />'), 'arrow-divert marker fill must match stroke #0284c7');
  assert.ok(topologyJs.includes('<path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />'), 'arrow-overspill marker fill must match stroke #ef4444');
  assert.ok(topologyJs.includes('<path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />'), 'arrow-muted marker fill must match stroke #64748b');

  // Verify that active spillway stroke matches arrow-overspill fill
  assert.ok(
    topologyJs.includes("strokeColor = isFlowActive ? '#ef4444' : '#64748b'"),
    'Active spillway stroke must be #ef4444 and inactive #64748b'
  );
});

test('UI/UX Audit 1.4: Main dashboard dual sparkline and card use #0284c7 for sea tide stream, preventing warning orange collisions', () => {
  // Dunball Tidal Parrett in app.js must use #0284c7
  assert.ok(appJs.includes('color: "#0284c7"'), 'Dunball Tidal Parrett gauge config in app.js must use #0284c7');
  
  // Dual sparkline Sea Tide stream in app.js and sparkline.js must not use warning orange #fb923c
  const startIdx = appJs.indexOf('export function renderDualSparkline');
  const endIdx = appJs.indexOf('export function bindSparklineEvents');
  assert.ok(startIdx !== -1 && endIdx !== -1, 'renderDualSparkline must exist in app.js');
  const funcBody = appJs.slice(startIdx, endIdx);
  assert.ok(!funcBody.includes('#fb923c'), 'renderDualSparkline must not use warning orange #fb923c for sea tide');
  assert.ok(funcBody.includes('#0284c7'), 'renderDualSparkline must use Estuarine Deep Blue #0284c7 for sea tide');

  const coreStartIdx = sparklineJs.indexOf('export function renderDualSparkline');
  const coreEndIdx = sparklineJs.indexOf('export function renderInspectorSparkline');
  assert.ok(coreStartIdx !== -1 && coreEndIdx !== -1, 'renderDualSparkline must exist in sparkline.js');
  const coreBody = sparklineJs.slice(coreStartIdx, coreEndIdx);
  assert.ok(!coreBody.includes('#fb923c'), 'Canonical sparkline.js renderDualSparkline must not use warning orange #fb923c');
  assert.ok(coreBody.includes('#0284c7'), 'Canonical sparkline.js renderDualSparkline must enforce #0284c7');
});

// ---------------------------------------------------------------------------
// 2. Component & Card Layout Invariants
// ---------------------------------------------------------------------------

test('UI/UX Audit 2.1: Spatial Monotonicity in Data-Viz: Two separated lines NEVER display the identical number', () => {
  // Verify canonical flat-stage threshold collapse in sparkline.js (SSOT for dashboard & topology)
  const flatLineLogic = sparklineJs.includes('const isFlatStage = rawRange < 0.01 || topLabel === botLabel;');
  assert.ok(flatLineLogic, 'sparkline.js must collapse dual lines when formatted labels match or range < 0.01m');
});

test('UI/UX Audit 2.2: Flat-line hydrographs render single central reference line with Steady badge', () => {
  // Verify that steady badge and single center guide are rendered in canonical sparkline.js when isFlatStage is true
  assert.ok(sparklineJs.includes('Steady ${bounds.rawMax.toFixed(2)}m'), 'sparkline.js must render Steady X.XXm badge');
  assert.ok(sparklineJs.includes('deltaText = isFlatStage ? \'0cm (Steady)\''), 'sparkline.js must display 0cm (Steady) in header pill');
  assert.ok(sparklineJs.includes('const centerY = dimensions.marginTop + dimensions.drawHeight / 2;'), 'sparkline.js must calculate exact vertical center for flat reference line');
});

test('UI/UX Audit 2.3: Hero metric & clearance badge consistency (Spills vs Gauges)', () => {
  // Spills must show engineered crest elevation + clearance delta
  assert.ok(topologyJs.includes('Engineered Crest:'), 'Spillways must display Engineered Crest: header');
  assert.ok(topologyJs.includes('over crest'), 'Spillways overtopping must indicate delta over crest');
  assert.ok(topologyJs.includes('below crest'), 'Spillways below crest must indicate clearance below crest');

  // Gauges must show channel depth + elevation subtext or alert clearance
  assert.ok(topologyJs.includes('m depth'), 'Gauges with datums must display m depth hero metric');
  assert.ok(topologyJs.includes('Surface Elevation:'), 'Gauges must display Surface Elevation subtext');
  assert.ok(topologyJs.includes('Gauge Zero:'), 'Gauges must display Gauge Zero datum subtext');
});

test('UI/UX Audit 2.4: Sparkline crest thresholds are strictly scoped to spillways and use dynamic semantic colors', () => {
  // Sparkline crest passed only for spillways
  assert.ok(
    topologyJs.includes("const isSpillway = node.node_type === 'spillway';"),
    'Sparkline must check node_type === spillway before attaching crest'
  );
  assert.ok(
    topologyJs.includes("const crestForSparkline = isSpillway ? (node.crest_elevation_mAOD || null) : null;"),
    'crestForSparkline must be null for non-spillway nodes'
  );

  // Dynamic crest threshold colors in canonical sparkline.js evaluateCrestVisuals / renderInspectorSparkline
  assert.ok(
    sparklineJs.includes("let crestStroke = '#64748b'"),
    'Dormant crest line must use neutral muted slate #64748b when river is safe'
  );
  assert.ok(
    sparklineJs.includes("crestStroke = '#f59e0b'"),
    'Near-crest line must transition to amber alert #f59e0b within 30cm'
  );
  assert.ok(
    sparklineJs.includes("crestStroke = '#ef4444'"),
    'Emergency overtopping line turns red #ef4444 only when river level >= crest'
  );
});

test('UI/UX Audit 2.5: Documentation consistency: methodology.html lists all 19 topological network stations', () => {
  const stationIds = [
    '52108', '52109', '52111', '52162', '52118', '52127',
    '52116', '52119', '52233', '52158', '52124', '52159',
    '52234', '52157', 'E9531', 'E9094', '52163', '52120', '52153'
  ];
  for (const id of stationIds) {
    assert.ok(methodologyHtml.includes(`<code>${id}</code>`), `methodology.html must document station ${id}`);
  }
  assert.ok(methodologyHtml.includes('Full listing of the 19 telemetry stations'), 'methodology.html must reference 19 telemetry stations');
});

// ---------------------------------------------------------------------------
// 3. WCAG 2.1 AA & Accessibility Invariants
// ---------------------------------------------------------------------------

test('UI/UX Audit 3.1: Triple-encoded status (Color + Icon/Shape + Text)', () => {
  // In topology.js, getNodeStatusVisual must supply symbol, label, and distinct color tokens
  const statuses = ['OVERSPILLING', 'ALERT', 'DIVERTING', 'CLOSED', 'SECURE'];
  for (const s of statuses) {
    assert.ok(topologyJs.includes(`case '${s}':`) || s === 'SECURE', `Status ${s} must have visual token branch`);
  }
  // Verify symbols exist
  assert.ok(topologyJs.includes("symbol: '🔴'"), 'OVERSPILLING must have 🔴 symbol');
  assert.ok(topologyJs.includes("symbol: '⚠️'"), 'ALERT must have ⚠️ symbol');
  assert.ok(topologyJs.includes("symbol: '🔵'"), 'DIVERTING must have 🔵 symbol');
  assert.ok(topologyJs.includes("symbol: '⛔'"), 'CLOSED must have ⛔ symbol');
  assert.ok(topologyJs.includes("symbol: '🟢'"), 'SECURE must have 🟢 symbol');

  // Node shapes: rect for polder basins, circle for river gauges
  assert.ok(topologyJs.includes("node.node_type === 'polder_basin'"), 'Polder basins must render as distinct rect shape');
});

test('UI/UX Audit 3.2: Minimum 4.5:1 text contrast and 3:1 graphical non-text contrast against #0f172a', () => {
  const bgCanvas = '#0f172a'; // Topology dark canvas background
  
  // Text colors
  const sky400 = '#38bdf8';
  const amber500 = '#f59e0b';
  const red500 = '#ef4444';
  const slate400 = '#94a3b8';
  const white = '#ffffff';

  const skyContrast = getContrastRatio(sky400, bgCanvas);
  const amberContrast = getContrastRatio(amber500, bgCanvas);
  const redContrast = getContrastRatio(red500, bgCanvas);
  const slateContrast = getContrastRatio(slate400, bgCanvas);
  const whiteContrast = getContrastRatio(white, bgCanvas);

  assert.ok(skyContrast >= 4.5, `Sky 400 contrast (${skyContrast.toFixed(2)}:1) must meet 4.5:1`);
  assert.ok(amberContrast >= 4.5, `Amber 500 contrast (${amberContrast.toFixed(2)}:1) must meet 4.5:1`);
  assert.ok(redContrast >= 4.5, `Red 500 contrast (${redContrast.toFixed(2)}:1) must meet 4.5:1`);
  assert.ok(slateContrast >= 4.5, `Slate 400 contrast (${slateContrast.toFixed(2)}:1) must meet 4.5:1`);
  assert.ok(whiteContrast >= 7.0, `White contrast (${whiteContrast.toFixed(2)}:1) must meet 7:1 AAA`);

  // Graphical 3:1 non-text contrast
  const slate500 = '#64748b';
  const slate500Contrast = getContrastRatio(slate500, bgCanvas);
  assert.ok(slate500Contrast >= 3.0, `Slate 500 graphical contrast (${slate500Contrast.toFixed(2)}:1) must meet 3:1`);
});

test('UI/UX Audit 3.2b: APCA perceptual readability (Lc >= 75 for buttons/controls, Lc >= 90 for small text)', () => {
  const bgCanvas = '#0f172a'; // Dark background
  const slate50 = '#f8fafc';  // Primary high-contrast button/link text
  const white = '#ffffff';

  const apcaSlate50 = getApcaContrast(slate50, bgCanvas);
  const apcaWhite = getApcaContrast(white, bgCanvas);

  // Both should exceed Lc 90 (fluent readability for small text)
  assert.ok(apcaSlate50 >= 90, `Slate 50 APCA contrast (${apcaSlate50.toFixed(1)}) must meet Lc >= 90 for small text`);
  assert.ok(apcaWhite >= 90, `White APCA contrast (${apcaWhite.toFixed(1)}) must meet Lc >= 90 for small text`);

  // Verify that camera buttons (.cam-bar-btn) in styles.css enforce high APCA text color (#f8fafc)
  const camBtnMatch = stylesCss.match(/\.cam-bar-btn\s*\{[\s\S]*?\}/);
  assert.ok(camBtnMatch, '.cam-bar-btn rule must exist in styles.css');
  assert.ok(camBtnMatch[0].includes('color: #f8fafc;'), '.cam-bar-btn must use #f8fafc to guarantee APCA Lc >= 90');
  assert.ok(camBtnMatch[0].includes('min-height: 44px;'), '.cam-bar-btn must satisfy 44px touch target');
});

test('UI/UX Audit 3.3: Touch hit targets >= 44x44px across all interactive controls', () => {
  // SVG node invisible hit target diameter must be >= 44px (radius >= 22px)
  assert.ok(topologyJs.includes('<circle cx="${coord.x}" cy="${coord.y}" r="24" fill="transparent" pointer-events="all" />'), 'SVG nodes must have r=24px (48px diameter) proxy hit target');

  // Zoom buttons in styles.css must have min-width: 44px and min-height: 44px
  assert.ok(stylesCss.includes('min-width: 44px;'), 'Interactive buttons must enforce min-width 44px');
  assert.ok(stylesCss.includes('min-height: 44px;'), 'Interactive buttons must enforce min-height 44px');

  // Inspector close button must be >= 44x44px
  const closeBtnMatch = stylesCss.match(/\.inspector-close-btn\s*\{[\s\S]*?\}/);
  assert.ok(closeBtnMatch, 'inspector-close-btn rule must exist');
  assert.ok(closeBtnMatch[0].includes('width: 44px;') && closeBtnMatch[0].includes('height: 44px;'), 'inspector-close-btn must be 44x44px');
});

test('UI/UX Audit 3.4: Screen-reader accessible names on all SVG interactive groups & decorative aria-hidden', () => {
  // Node group must have role="button", tabindex="0", aria-label, aria-expanded
  assert.ok(topologyJs.includes('role="button"'), 'SVG node groups must have role="button"');
  assert.ok(topologyJs.includes('tabindex="0"'), 'SVG node groups must have tabindex="0"');
  assert.ok(topologyJs.includes('aria-label='), 'SVG node groups must have descriptive aria-label');
  assert.ok(topologyJs.includes('aria-expanded='), 'SVG node groups must convey selection state via aria-expanded');

  // Decorative SVG layers must have aria-hidden="true"
  assert.ok(topologyJs.includes('<g class="topology-bg-grid" opacity="0.15" aria-hidden="true">'), 'Background grid must be aria-hidden="true"');
  assert.ok(topologyJs.includes('<g class="polder-containers" aria-hidden="true">'), 'Polder container outlines must be aria-hidden="true"');
  assert.ok(topologyJs.includes('<g class="topology-edges" aria-hidden="true">'), 'Flow edges must be aria-hidden="true"');
});

test('UI/UX Audit 3.5: Topology inspector sparkline provides interactive timestamp scrubbing & crosshairs', () => {
  // Sparkline must output interactive wrapper, tooltip, and overlay in canonical sparkline.js
  assert.ok(sparklineJs.includes('class="sparkline-wrapper"'), 'Inspector sparkline must wrap in .sparkline-wrapper');
  assert.ok(sparklineJs.includes('class="sparkline-crosshair"'), 'Inspector sparkline must render interactive crosshair line');
  assert.ok(sparklineJs.includes('class="sparkline-dot-highlight"'), 'Inspector sparkline must render active dot highlight');
  assert.ok(sparklineJs.includes('class="sparkline-touch-overlay"'), 'Inspector sparkline must render transparent hit overlay for touch/mouse');
  assert.ok(sparklineJs.includes('class="sparkline-tooltip"'), 'Inspector sparkline must render floating tooltip for timestamps and readings');

  // Data attributes must encode full 24h timeline
  assert.ok(sparklineJs.includes("data-timestamps='${JSON.stringify(timestamps)}'"), 'Inspector sparkline must serialize data-timestamps');
  assert.ok(sparklineJs.includes("data-points='${JSON.stringify(values)}'"), 'Inspector sparkline must serialize data-points');

  // Event binding and keyboard navigation
  assert.ok(topologyJs.includes('bindInspectorSparklineEvents(sparklineBox'), 'inspectNode must invoke bindInspectorSparklineEvents');
  assert.ok(sparklineJs.includes("'ArrowLeft'") && sparklineJs.includes("'ArrowRight'"), 'Inspector sparkline must support Arrow key scrubbing');

  // CSS positioning rules
  assert.ok(stylesCss.includes('.inspector-sparkline-box .sparkline-wrapper'), 'styles.css must style inspector sparkline wrapper');
  assert.ok(stylesCss.includes('.inspector-sparkline-box .sparkline-tooltip'), 'styles.css must position inspector floating tooltip');
});

// ---------------------------------------------------------------------------
// 4. River Network Topology Completeness & Usability Invariants
// ---------------------------------------------------------------------------

test('UI/UX Audit 4.1: Hydraulic flow connectivity: River Tone flows continuously into River Parrett at Burrowbridge (52118 -> 52158)', () => {
  const topologyConfig = JSON.parse(fs.readFileSync(path.resolve('src/js/config/topology_network.json'), 'utf8'));
  const confluenceEdge = topologyConfig.edges.find(e => e.from === '52118' && e.to === '52158');

  // Both topology_network.json and hydro_engine.js DEFAULT_TOPOLOGY_EDGES must define the main river confluence edge from Hookbridge to Baltmoor Wall
  assert.ok(
    confluenceEdge && confluenceEdge.type === 'main_river',
    'topology_network.json must define main_river edge from Hookbridge (52118) to Baltmoor Wall (52158)'
  );
  assert.ok(
    DEFAULT_TOPOLOGY_EDGES.some(e => e.from === '52118' && e.to === '52158' && e.type === 'main_river'),
    'DEFAULT_TOPOLOGY_EDGES must define main_river edge from Hookbridge (52118) to Baltmoor Wall (52158)'
  );
  assert.ok(
    topologyJs.includes('DEFAULT_TOPOLOGY_EDGES'),
    'topology.js must import and use DEFAULT_TOPOLOGY_EDGES from hydro_engine.js'
  );
});

test('UI/UX Audit 4.2: Estuarine sea outfall uses dynamic hydrostatic head check (westQuayStage > seaStage)', () => {
  const topologyConfig = JSON.parse(fs.readFileSync(path.resolve('src/js/config/topology_network.json'), 'utf8'));
  const seaOutfallEdge = topologyConfig.edges.find(e => e.from === '52124' && e.to === '52163');

  assert.ok(
    seaOutfallEdge &&
      seaOutfallEdge.flow_rule?.type === 'head_gradient' &&
      seaOutfallEdge.flow_rule?.upstream_node_id === '52124' &&
      seaOutfallEdge.flow_rule?.downstream_node_id === '52163',
    'topology_network.json must compute sea outfall gravity discharge using hydrostatic gradient (52124 > 52163)'
  );
});

test('UI/UX Audit 4.3: Dynamic global alert banner adheres to UI-COL-03 (No panic red during nominal security)', () => {
  // Check CSS definitions for banner states
  assert.ok(stylesCss.includes('.alert-banner.banner-secure'), 'styles.css must define .banner-secure');
  assert.ok(stylesCss.includes('.alert-banner.banner-alert'), 'styles.css must define .banner-alert');
  assert.ok(stylesCss.includes('.alert-banner.banner-critical'), 'styles.css must define .banner-critical');

  // Verify that topology.js and app.js apply banner-secure, banner-alert, banner-critical
  assert.ok(topologyJs.includes("'alert-banner banner-secure'"), 'topology.js must apply banner-secure for severity >= 5');
  assert.ok(topologyJs.includes("'alert-banner banner-critical'"), 'topology.js must apply banner-critical for severity <= 2');
  assert.ok(appJs.includes("'alert-banner banner-secure'"), 'app.js must apply banner-secure for severity >= 5');
  assert.ok(appJs.includes("'alert-banner banner-critical'"), 'app.js must apply banner-critical for severity <= 2');
});

test('UI/UX Audit 4.4: Lowland storage polders display Spillway Capacity Crest and Moor Ground Bed', () => {
  assert.ok(
    topologyJs.includes("if (isPolder) crestLabel.innerText = 'Spillway Capacity Crest:';"),
    'topology.js must display Spillway Capacity Crest: for polder basin nodes'
  );
  assert.ok(
    topologyJs.includes("Moor Bed: ${minLevel.toFixed(2)}mAOD"),
    'topology.js must display Moor Ground Bed elevation in trackMin baseline label'
  );
});

test('UI/UX Audit 4.5: Usability & Deep Linking: URL state sync, escape dismissal, and interactive status legend', () => {
  // Legend items in topology.html must be interactive buttons with data-status
  assert.ok(
    topologyHtml.includes('<button type="button" class="legend-item" data-status="OVERSPILLING"'),
    'topology.html must render button elements with data-status for legend filtering'
  );

  // topology.js must implement syncUrlState and setupKeyboardNavigation with Escape
  assert.ok(topologyJs.includes('function syncUrlState()'), 'topology.js must implement syncUrlState');
  assert.ok(topologyJs.includes('window.history.replaceState'), 'topology.js must use replaceState for deep linking');
  assert.ok(topologyJs.includes("e.key === 'Escape'"), 'topology.js must listen for Escape key to close inspector');
  assert.ok(topologyJs.includes('function setupLegendListeners()'), 'topology.js must implement setupLegendListeners');
});

test('UI/UX Audit 4.6: Monk\'s Leaze Clyse (52233) spillway and intake camera link ([RULE-CAM-01])', () => {
  assert.ok(
    topologyJs.includes('node.id === \'52233\''),
    'topology.js must check for station 52233 in inspectNode'
  );
  assert.ok(
    topologyJs.includes('Spillway Crest &amp; Intake Camera'),
    'topology.js must render camera link for Monk\'s Leaze Clyse pointing to optical intake crest ([RULE-CAM-01])'
  );
  assert.ok(
    !topologyJs.includes('AI Analysis'),
    'topology.js must never invent speculative AI Gate Analysis ([RULE-CAM-01], [RULE-HUM-01])'
  );
});

test('UI/UX Audit 4.7: Monk\'s Leaze Clyse (52233 -> 52234) flow animation strictly decoupled from closed gate state', () => {
  const topologyConfig = JSON.parse(fs.readFileSync(path.resolve('src/js/config/topology_network.json'), 'utf8'));
  const clyseEdge = topologyConfig.edges.find(e => e.from === '52233' && e.to === '52234' && e.type === 'diversion_clyse');

  // topology_network.json must use coupled_rule monks_leaze_diverting for diversion clyse flow_active, not static sill elevation >= 4.20
  assert.ok(
    clyseEdge &&
      clyseEdge.flow_rule?.type === 'coupled_rule' &&
      clyseEdge.flow_rule?.rule_id === 'monks_leaze_diverting',
    'topology_network.json must set diversion_clyse flow_active via coupled_rule monks_leaze_diverting'
  );
  assert.equal(
    topologyConfig.coupled_rules?.monks_leaze_diverting?.type,
    'clyse_diverting',
    'monks_leaze_diverting coupled_rule must use clyse_diverting (sill + differential head check)'
  );

  // topology.js must guard against animating edges when gate node is CLOSED
  assert.ok(
    topologyJs.includes("edge.type === 'diversion_clyse' && (fromNode?.status === 'CLOSED' || fromNode?.status === 'SECURE')"),
    'topology.js must enforce isFlowActive = false when diversion clyse intake is CLOSED'
  );
});

test('UI/UX Audit 4.8: Topology view clearly differentiates and visually labels Hookbridge, Athelney Spillway, and Baltmoor Wall flow pathways', () => {
  // Visible badges layer must exist and render in topology.js
  assert.ok(
    topologyJs.includes('<g class="topology-edge-badges">'),
    'topology.js must render <g class="topology-edge-badges"> layer for on-canvas flow badges'
  );

  // Hookbridge Spillway badge
  assert.ok(
    topologyJs.includes('Hookbridge Spillway 7.45m'),
    'topology.js must label Hookbridge Spillway with its 7.45m crest elevation'
  );

  // Athelney Spillway & Cuts Road cascade badge
  assert.ok(
    topologyJs.includes('Athelney Spillway 7.35m (Cuts Rd)'),
    'topology.js must label Athelney Spillway with 7.35m crest and Cuts Rd identifier'
  );

  // Baltmoor Wall Levee Overtopping badge
  assert.ok(
    topologyJs.includes('Baltmoor Wall 7.80m'),
    'topology.js must label Baltmoor Wall defense with its 7.80m overtopping crest'
  );

  // Interactive delegation to inspect target nodes on click
  assert.ok(
    topologyJs.includes('e.target.closest(\'.topology-edge-badge\')'),
    'topology.js setupSVGDelegation must handle clicks on edge badges'
  );

  // Inspector drawer differentiates cascade and overtopping
  assert.ok(
    topologyJs.includes('Athelney Spillway &amp; Cuts Rd'),
    'topology.js inspector drawer must show Athelney Spillway & Cuts Rd section'
  );
  assert.ok(
    topologyJs.includes('Dual Inflow Pathways'),
    'topology.js Northmoor inspector drawer must explain Dual Inflow Pathways (Athelney cascade vs Baltmoor Wall overtopping)'
  );

  // CSS styling for edge badges
  assert.ok(
    stylesCss.includes('.topology-edge-badge'),
    'styles.css must define styling rules for .topology-edge-badge'
  );
});

test('UI/UX Audit 4.9: Cross-view parity between Main Dashboard and Topology View (Global Status & Tidal Station 52163)', () => {
  const serverJsPath = path.resolve('server.js');
  const serverJs = fs.readFileSync(serverJsPath, 'utf8');

  // 1. Single Source of Truth for Global Status Banner
  assert.ok(
    serverJs.includes('const globalStat = aggregateGlobalStatus('),
    'server.js /api/status must compute global_status using aggregateGlobalStatus from hydro_engine.js'
  );
  assert.ok(
    !serverJs.includes('"SYSTEM SECURE — ALL MOORS NORMAL | GRAVITY DISCHARGE ACTIVE"'),
    'server.js must NOT hardcode GRAVITY DISCHARGE ACTIVE in /api/status'
  );

  // 2. Station 52163 (Dunball Tidal Outfall) tidal status & coloration parity
  const topologyConfig = JSON.parse(fs.readFileSync(path.resolve('src/js/config/topology_network.json'), 'utf8'));
  const dunballNode = topologyConfig.nodes.find(n => n.id === '52163');
  assert.ok(
    dunballNode &&
      dunballNode.status_rule?.type === 'tidal_estuary' &&
      dunballNode.status_rule?.inland_node_id === 'E9094',
    'topology_network.json must configure 52163 with tidal_estuary rule comparing against E9094'
  );
  assert.ok(
    serverJs.includes('evaluateTopologyNetwork('),
    'server.js /api/topology must evaluate topology via evaluateTopologyNetwork'
  );
  assert.ok(
    topologyJs.includes("if (node.node_type === 'tidal_outfall')"),
    'topology.js getNodeStatusVisual must provide dedicated tidal_outfall visual mapping'
  );
  assert.ok(
    topologyJs.includes("sparklineColor: '#0284c7'"),
    'topology.js must render 52163 tidal hydrograph in Estuarine Deep Blue (#0284c7) matching Main Dashboard'
  );
  assert.ok(
    topologyJs.includes('Dunball Sea Door State'),
    'topology.js inspector drawer must display Dunball Sea Door State for station 52163'
  );

  // 3. Inspector status pill CSS parity
  assert.ok(
    stylesCss.includes('.status-pill.status-tide-locked'),
    'styles.css must style .status-pill.status-tide-locked to match Main Dashboard badge-tide-locked'
  );
});

test('UI/UX Audit 4.10: 4-Tier Threshold Provenance UX & Zero Semantic Collision', () => {
  const methodologyHtml = fs.readFileSync(path.resolve('src/methodology.html'), 'utf8');

  // 1. Container presence in topology.html
  assert.ok(
    topologyHtml.includes('id="node-provenance-section"'),
    'topology.html must include #node-provenance-section in the inspector drawer'
  );
  assert.ok(
    topologyHtml.includes('id="node-provenance-list"'),
    'topology.html must include #node-provenance-list'
  );

  // 2. Methodology page anchors
  assert.ok(
    methodologyHtml.includes('id="threshold-provenance"'),
    'methodology.html must define #threshold-provenance section anchor'
  );
  assert.ok(
    topologyHtml.includes('href="methodology.html#threshold-provenance"'),
    'topology.html must provide deep link to methodology.html#threshold-provenance'
  );

  // 3. Provenance badge CSS tokens in styles.css
  assert.ok(stylesCss.includes('.prov-pill'), 'styles.css must define .prov-pill');
  assert.ok(stylesCss.includes('.prov-tier-1'), 'styles.css must define .prov-tier-1');
  assert.ok(stylesCss.includes('.prov-tier-2'), 'styles.css must define .prov-tier-2');
  assert.ok(stylesCss.includes('.prov-tier-3'), 'styles.css must define .prov-tier-3');
  assert.ok(stylesCss.includes('.prov-tier-4'), 'styles.css must define .prov-tier-4');

  // 4. [UI-COL-01] Zero Semantic Collision: Provenance pills must NOT use high-risk Red/Amber fills
  const provPillCss = stylesCss.substring(stylesCss.indexOf('.prov-pill'), stylesCss.indexOf('.prov-tier-4') + 200);
  assert.ok(
    !provPillCss.includes('background: #ef4444') && !provPillCss.includes('background: #f59e0b') && !provPillCss.includes('background: #10b981'),
    'Provenance pills must NEVER use solid red, amber, or green background fills (must use neutral slate to avoid false flood alarms)'
  );

  // 5. topology.js populates provenance list with XSS sanitization
  assert.ok(
    topologyJs.includes("document.getElementById('node-provenance-list')"),
    'topology.js must populate #node-provenance-list'
  );
  assert.ok(
    topologyJs.includes('escapeHTML(item.label)') && topologyJs.includes('escapeAttr(item.authority)'),
    'topology.js must sanitize dynamic provenance text and attributes with escapeHTML and escapeAttr'
  );
});

test('UI/UX Audit 5.1: Contextual Jargon Popovers - Plain-English Definitions & Domain Invariant Compliance', () => {
  // 1. Mandatory 4 plain-English jargon definitions exist
  assert.ok(JARGON_DEFINITIONS.mAOD, 'mAOD definition must be registered');
  assert.ok(JARGON_DEFINITIONS.KSD, 'KSD definition must be registered');
  assert.ok(JARGON_DEFINITIONS.Clyse, 'Clyse definition must be registered');
  assert.ok(JARGON_DEFINITIONS.Penning, 'Penning definition must be registered');

  // 2. [RULE-HUM-01] Epistemic Humility & Plain Language verification
  // mAOD: Clarifies height relative to sea level, not depth over ground
  assert.ok(
    JARGON_DEFINITIONS.mAOD.definition.includes('Metres Above Ordnance Datum') &&
    JARGON_DEFINITIONS.mAOD.definition.includes('Not depth over the ground') &&
    JARGON_DEFINITIONS.mAOD.definition.includes('~2m to 4m AOD'),
    'mAOD definition must explain datum vs depth over ground in plain English'
  );

  // KSD: Explains King\'s Sedgemoor Drain relief channel
  assert.ok(
    JARGON_DEFINITIONS.KSD.definition.includes("King's Sedgemoor Drain") &&
    JARGON_DEFINITIONS.KSD.definition.includes('18km relief channel') &&
    JARGON_DEFINITIONS.KSD.definition.includes('Monk\'s Leaze Clyse') &&
    JARGON_DEFINITIONS.KSD.definition.includes('Dunball'),
    'KSD definition must explain channel function from Monk\'s Leaze Clyse to Dunball'
  );

  // Clyse: Explains local Somerset terminology for sluice / gravity outfall
  assert.ok(
    JARGON_DEFINITIONS.Clyse.definition.includes('Somerset term for a sluice gate') &&
    JARGON_DEFINITIONS.Clyse.definition.includes('gravity outfall structure') &&
    JARGON_DEFINITIONS.Clyse.definition.includes('penstocks or tidal flap doors'),
    'Clyse definition must explain local Somerset sluice / flap door meaning'
  );

  // Penning: Clarifies routine seasonal retention vs winter flood evacuation
  assert.ok(
    JARGON_DEFINITIONS.Penning.definition.includes('Routine seasonal water retention') &&
    JARGON_DEFINITIONS.Penning.definition.includes('rhynes') &&
    JARGON_DEFINITIONS.Penning.definition.includes('livestock drinking') &&
    JARGON_DEFINITIONS.Penning.definition.includes('distinct from winter flood evacuation'),
    'Penning definition must distinguish seasonal agricultural retention from flood states'
  );

  // 3. [RULE-CALC-01] Strict ban on volumetric flow / cumec speculation in jargon definitions
  for (const [key, def] of Object.entries(JARGON_DEFINITIONS)) {
    assert.ok(
      !def.definition.toLowerCase().includes('cumec') &&
      !def.definition.toLowerCase().includes('m3/s') &&
      !def.definition.toLowerCase().includes('megalitre'),
      `Jargon definition for ${key} must not speculate on volumetric flow rates [RULE-CALC-01]`
    );
  }
});

test('UI/UX Audit 5.2: Contextual Jargon Popovers - Accessibility & WCAG/APCA Contrast Compliance', () => {
  // 1. renderJargonTerm generates compliant accessible markup
  const rendered = renderJargonTerm('mAOD');
  assert.ok(rendered.includes('class="jargon-term"'), 'Must include .jargon-term class');
  assert.ok(rendered.includes('tabindex="0"'), 'Must be keyboard focusable (tabindex="0")');
  assert.ok(rendered.includes('role="button"'), 'Must have role="button"');
  assert.ok(rendered.includes('aria-haspopup="dialog"'), 'Must declare aria-haspopup="dialog"');
  assert.ok(rendered.includes('aria-expanded="false"'), 'Must initialize with aria-expanded="false"');
  assert.ok(rendered.includes('data-term="mAOD"'), 'Must declare data-term attribute');
  assert.ok(rendered.includes('class="jargon-help-icon"'), 'Must include help icon');
  assert.ok(rendered.includes('aria-hidden="true"'), 'Help icon must be aria-hidden="true"');

  // 2. APCA contrast compliance: Popover background #0f172a, body text #f8fafc (Lc >= 90)
  const apcaScore = getApcaContrast('#f8fafc', '#0f172a');
  assert.ok(
    apcaScore >= 90,
    `Popover text (#f8fafc) against dark background (#0f172a) must achieve APCA Lc >= 90 (got ${apcaScore.toFixed(1)})`
  );

  // Standard WCAG 2.1 AA text contrast floor >= 4.5:1
  const wcagRatio = getContrastRatio('#f8fafc', '#0f172a');
  assert.ok(
    wcagRatio >= 4.5,
    `Popover text against background must exceed WCAG 4.5:1 ratio (got ${wcagRatio.toFixed(1)}:1)`
  );

  // 3. Touch hit target expansion in CSS
  assert.ok(
    stylesCss.includes('.jargon-term::after'),
    'styles.css must declare .jargon-term::after for touch hit expansion'
  );
  assert.ok(
    stylesCss.includes('min-width: 44px') && stylesCss.includes('min-height: 44px'),
    'styles.css must guarantee >= 44x44px touch targets for interactive controls [UI-ACC-01]'
  );

  // 4. Popover styling in CSS
  assert.ok(stylesCss.includes('.jargon-popover'), 'styles.css must style .jargon-popover');
  assert.ok(stylesCss.includes('background: #0f172a'), 'Popover must use #0f172a background');
  assert.ok(stylesCss.includes('border: 1px solid rgba(56, 189, 248, 0.4)'), 'Popover border must use sky blue accent');
  assert.ok(stylesCss.includes('.jargon-popover-close'), 'styles.css must style .jargon-popover-close button');
});

test('UI/UX Audit 5.3: Contextual Jargon Popovers - Cross-View Integration, Keyboard & Viewport Bounds Handling', () => {
  // 1. Template integration: index.html & topology.html include jargon triggers
  assert.ok(indexHtml.includes('class="jargon-term"'), 'index.html must include jargon term triggers');
  assert.ok(topologyHtml.includes('class="jargon-term"'), 'topology.html must include jargon term triggers');
  assert.ok(topologyHtml.includes('data-term="mAOD"'), 'topology.html must include mAOD jargon trigger');
  assert.ok(topologyHtml.includes('data-term="KSD"'), 'topology.html must include KSD jargon trigger');
  assert.ok(topologyHtml.includes('data-term="Clyse"'), 'topology.html must include Clyse jargon trigger');
  assert.ok(topologyHtml.includes('data-term="Penning"'), 'topology.html must include Penning jargon trigger');

  // 2. Script integration: app.js and topology.js initialize popovers
  assert.ok(appJs.includes('initJargonPopovers'), 'app.js must import and call initJargonPopovers()');
  assert.ok(topologyJs.includes('initJargonPopovers'), 'topology.js must import and call initJargonPopovers()');
  assert.ok(appJs.includes("renderJargonTerm('Clyse')"), 'app.js must render Clyse jargon triggers in cards');
  assert.ok(appJs.includes("renderJargonTerm('KSD')"), 'app.js must render KSD jargon triggers in cards');
  assert.ok(appJs.includes("renderJargonTerm('Penning')"), 'app.js must render Penning jargon triggers in cards');
  assert.ok(topologyJs.includes("renderJargonTerm('mAOD')"), 'topology.js must render mAOD jargon trigger');

  // 3. Interactive keyboard support in jargon_popover.js
  assert.ok(jargonPopoverJs.includes("'Escape'"), 'jargon_popover.js must handle Escape key dismissal');
  assert.ok(
    jargonPopoverJs.includes("'Enter'") && jargonPopoverJs.includes("' '"),
    'jargon_popover.js must handle Enter and Space keyboard activation'
  );
  assert.ok(jargonPopoverJs.includes('positionPopover'), 'jargon_popover.js must calculate popover positioning');
  assert.ok(
    jargonPopoverJs.includes('Math.min') && jargonPopoverJs.includes('Math.max'),
    'jargon_popover.js must clamp popover within viewport bounds'
  );
});

test('UI/UX Audit 5.4: Contextual Jargon Popovers - Interactive Lifecycle & Popover Positioning', async () => {
  const { positionPopover } = await import('../src/js/jargon_popover.js');

  const mockTrigger = {
    getAttribute: (attr) => (attr === 'data-term' ? 'mAOD' : null),
    setAttribute: (attr, val) => { mockTrigger[attr] = val; },
    focus: () => { mockTrigger.focused = true; },
    getBoundingClientRect: () => ({ left: 200, right: 260, top: 300, bottom: 324, width: 60, height: 24 })
  };

  const mockPopover = {
    style: {},
    classList: {
      classes: new Set(['hidden']),
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      contains(cls) { return this.classes.has(cls); }
    },
    offsetHeight: 120
  };

  // Mock window dimensions
  const originalWindow = globalThis.window;
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800
  };

  try {
    positionPopover(mockTrigger, mockPopover);

    assert.equal(mockPopover.style.position, 'fixed');
    assert.equal(mockPopover.style.width, '320px');
    const leftVal = parseInt(mockPopover.style.left, 10);
    const topVal = parseInt(mockPopover.style.top, 10);

    // Left should center on trigger (200 + 30 - 160 = 70px)
    assert.equal(leftVal, 70);
    // Top should place below trigger (324 + 8 = 332px)
    assert.equal(topVal, 332);

    // Test viewport clamp near right edge
    const edgeTrigger = {
      ...mockTrigger,
      getBoundingClientRect: () => ({ left: 1250, right: 1270, top: 300, bottom: 324, width: 20, height: 24 })
    };
    positionPopover(edgeTrigger, mockPopover);
    const clampLeft = parseInt(mockPopover.style.left, 10);
    // Must clamp to window.innerWidth - popoverWidth - 12 = 1280 - 320 - 12 = 948px
    assert.equal(clampLeft, 948, 'Popover must clamp inside right viewport margin');
  } finally {
    globalThis.window = originalWindow;
  }
});

// ---------------------------------------------------------------------------
// 6. Geographic Anchors, Flow Direction & Progressive Disclosure (Issues #5 & #9)
// ---------------------------------------------------------------------------

test('UI/UX Audit 6.1 (Issue #5): Geographic Reference Anchors rendered with zero collision', () => {
  // 1. Anchors group in SVG network rendering
  assert.ok(topologyJs.includes('class="geographic-anchors"'), 'topology.js must render <g class="geographic-anchors">');
  
  // 2. Key geographic landmarks present
  assert.ok(topologyJs.includes('BRIDGWATER BAY / BRISTOL CHANNEL'), 'Must include Bridgwater Bay / Bristol Channel anchor');
  assert.ok(topologyJs.includes('TAUNTON'), 'Must include Taunton anchor');
  assert.ok(topologyJs.includes('LANGPORT'), 'Must include Langport anchor');
  assert.ok(topologyJs.includes('BURROW MUMP'), 'Must include Burrow Mump anchor');
  assert.ok(topologyJs.includes('A361 CORRIDOR'), 'Must include A361 Corridor anchor');

  // 3. Anchors pre-seeded into collision detector
  assert.ok(
    topologyJs.includes('placedLabelBoxes = [') && topologyJs.includes('{ x: 130, y: 38,'),
    'Geographic anchors must be registered in placedLabelBoxes to guarantee zero label collisions'
  );
});

test('UI/UX Audit 6.2 (Issue #5): Downstream Flow Indicators along major river reaches', () => {
  assert.ok(topologyJs.includes('class="downstream-flow-indicators"'), 'topology.js must render <g class="downstream-flow-indicators">');
  assert.ok(topologyJs.includes('Tone Flow'), 'Must include Tone downstream flow marker');
  assert.ok(topologyJs.includes('Parrett Flow'), 'Must include Parrett downstream flow marker');
  assert.ok(topologyJs.includes('Seaward Flow'), 'Must include seaward flow marker');
  assert.ok(topologyJs.includes('To Estuary'), 'Must include sea discharge flow marker');
  assert.ok(topologyJs.includes('Sowy Relief'), 'Must include Sowy relief flow marker');
});

test('UI/UX Audit 6.3 (Issue #5): Enhanced Lowland Polder Visual Containers & Storage Basin Gradients', () => {
  // 1. Defs linear gradients
  assert.ok(topologyJs.includes('polder-curry-gradient'), 'SVG defs must include polder-curry-gradient');
  assert.ok(topologyJs.includes('polder-northmoor-gradient'), 'SVG defs must include polder-northmoor-gradient');

  // 2. Translucent storage basin boundary styling
  assert.ok(topologyJs.includes('polder-containers'), 'topology.js must render polder-containers group');
  assert.ok(topologyJs.includes('CURRY MOOR POLDER'), 'Must identify Curry Moor retention basin');
  assert.ok(topologyJs.includes('NORTHMOOR POLDER'), 'Must identify Northmoor retention basin');
});

test('UI/UX Audit 6.4 (Issue #5): Find My Area / Village Focus Filter Group & Accessibility Targets', () => {
  // 1. HTML markup for area focus pills
  assert.ok(topologyHtml.includes('class="area-focus-group"'), 'topology.html must include .area-focus-group container');
  assert.ok(topologyHtml.includes('data-area="taunton"'), 'Must have Taunton area pill');
  assert.ok(topologyHtml.includes('data-area="langport"'), 'Must have Langport area pill');
  assert.ok(topologyHtml.includes('data-area="burrowbridge"'), 'Must have Burrowbridge area pill');
  assert.ok(topologyHtml.includes('data-area="muchelney"'), 'Must have Muchelney area pill');
  assert.ok(topologyHtml.includes('data-area="curry_moor"'), 'Must have Curry Moor area pill');
  assert.ok(topologyHtml.includes('data-area="bridgwater"'), 'Must have Bridgwater area pill');

  // 2. CSS touch target compliance (>= 44x44px per UI-ACC-01)
  assert.ok(stylesCss.includes('.area-pill-btn'), 'styles.css must style .area-pill-btn');
  const btnMinHeightMatch = stylesCss.match(/\.area-pill-btn[\s\S]*?min-height:\s*(\d+)px/);
  assert.ok(btnMinHeightMatch, 'area-pill-btn must have min-height in CSS');
  assert.ok(parseInt(btnMinHeightMatch[1], 10) >= 44, 'area-pill-btn min-height must be >= 44px');

  // 3. JS area mappings & URL sync
  assert.ok(topologyJs.includes('AREA_MAPPINGS'), 'topology.js must define AREA_MAPPINGS');
  assert.ok(topologyJs.includes('setupAreaFocusListeners'), 'topology.js must wire area focus click listeners');
  assert.ok(topologyJs.includes("urlParams.get('area')"), 'topology.js must read area parameter from URL');
  assert.ok(topologyJs.includes("params.set('area'"), 'topology.js must serialize area parameter to URL');
});

test('UI/UX Audit 6.5 (Issue #9): Frontend Progressive Disclosure Wiring (Levels 0, 1, 2)', () => {
  // Level 0: Consequence Badges
  assert.ok(topologyJs.includes('PASSABLE') && topologyJs.includes('IMPASSABLE'), 'topology.js must handle road consequence states');
  assert.ok(topologyJs.includes('DUTY PUMPING') && topologyJs.includes('MOBILE ORDERED'), 'topology.js must handle polder consequence states');
  assert.ok(topologyJs.includes('TIDE-LOCKED') && topologyJs.includes('DISCHARGING'), 'topology.js must handle tidal outfall consequence states');

  // Level 1: Centimetre Rule Clearance, Trend Vectors, and Duration Timers
  assert.ok(topologyJs.includes('computeTrendVector'), 'topology.js must use computeTrendVector');
  assert.ok(appJs.includes('computeTrendVector'), 'app.js must use computeTrendVector');
  assert.ok(appJs.includes('formatClearanceText'), 'app.js must use formatClearanceText');
  assert.ok(topologyJs.includes('⏱️'), 'topology.js must display session duration timer');
  assert.ok(appJs.includes('⏱️'), 'app.js must display session duration timer');

  // Level 2: Drawer full details, geodetic elevation mAOD, seasonal regime & active event card
  assert.ok(topologyJs.includes('getSeasonalRegime'), 'topology.js must evaluate getSeasonalRegime');
  assert.ok(topologyJs.includes('Summer Penning') && topologyJs.includes('Winter Flood'), 'topology.js must display seasonal regime badge');
  assert.ok(topologyJs.includes('ACTIVE TELEMETRY EVENT SESSION'), 'topology.js must render active event session card');
});

test('UI/UX Audit 2.6: methodology.html enforces [RULE-CALC-01] with zero volumetric discharge equations', () => {
  const methodologyHtml = fs.readFileSync(path.resolve('src/methodology.html'), 'utf8');
  assert.ok(
    !methodologyHtml.includes('Submerged Gate Volumetric Discharge Equation'),
    'methodology.html must not contain legacy Submerged Gate Volumetric Discharge Equation'
  );
  assert.ok(
    !methodologyHtml.includes('C_d \\cdot B'),
    'methodology.html must not contain volumetric discharge formula Q = C_d * B * H * sqrt(2g * dh)'
  );
  assert.ok(
    /volumetric discharge speculation[^<]*is strictly prohibited/.test(methodologyHtml),
    'methodology.html must state the ban on volumetric discharge speculation'
  );
  assert.ok(
    !methodologyHtml.includes('[RULE-'),
    'methodology.html must not expose internal rule IDs to readers'
  );
});

test('UI/UX Audit 6.6 (Issue #52): Southern & Flanking Polder Basin Topology Integration & Camera Correlations', () => {
  const topologyConfig = JSON.parse(fs.readFileSync(path.resolve('src/js/config/topology_network.json'), 'utf8'));

  // 1. Both topology_network.json and TOPOLOGY_NETWORK_CONFIG define flanking polder basins
  assert.ok(Array.isArray(topologyConfig.flanking_polders), 'topology_network.json must define flanking_polders array');
  assert.ok(Array.isArray(TOPOLOGY_NETWORK_CONFIG.flanking_polders), 'TOPOLOGY_NETWORK_CONFIG must define flanking_polders array');
  assert.deepEqual(
    topologyConfig.flanking_polders,
    TOPOLOGY_NETWORK_CONFIG.flanking_polders,
    'flanking_polders must maintain 100% SSOT parity between JSON and JS engine'
  );

  const expectedPolders = ['wet_moor', 'stanmoor', 'west_sedgemoor', 'westonzoyland'];
  for (const pId of expectedPolders) {
    const pEntry = topologyConfig.flanking_polders.find(p => p.id === pId);
    assert.ok(pEntry, `flanking_polders must define ${pId}`);
    assert.ok(Array.isArray(pEntry.choke_point_nodes) && pEntry.choke_point_nodes.length > 0);
    assert.ok(Array.isArray(pEntry.pumping_stations) && pEntry.pumping_stations.length > 0);
  }

  // 2. Camera correlations for each polder asset
  const catalogIds = new Set(CAMERA_CATALOG.map(c => c.id));

  const wetMoorCams = resolveCandidateCamerasForAsset('wet_moor');
  assert.ok(wetMoorCams.includes('huish_episcopi_ps'), 'wet_moor must resolve huish_episcopi_ps camera');
  assert.ok(wetMoorCams.includes('midelney_ps'), 'wet_moor must resolve midelney_ps camera');
  assert.ok(catalogIds.has('huish_episcopi_ps') && catalogIds.has('midelney_ps'));

  const stanmoorCams = resolveCandidateCamerasForAsset('stanmoor');
  assert.ok(stanmoorCams.includes('stanmoor_ps'), 'stanmoor must resolve stanmoor_ps camera');
  assert.ok(catalogIds.has('stanmoor_ps'));

  const westSedgeCams = resolveCandidateCamerasForAsset('west_sedgemoor');
  assert.ok(westSedgeCams.includes('west_sedgemoor_ps'), 'west_sedgemoor must resolve west_sedgemoor_ps camera');
  assert.ok(catalogIds.has('west_sedgemoor_ps'));

  const westonCams = resolveCandidateCamerasForAsset('westonzoyland');
  assert.ok(westonCams.includes('westonzoyland_ps'), 'westonzoyland must resolve westonzoyland_ps camera');
  assert.ok(catalogIds.has('westonzoyland_ps'));
});

test('UI/UX Audit 6.7 (Issue #53): Sowy / KSD Control Chain Disambiguation, Beer Wall 52157 Edge Badge & Inspector Progressive Disclosure', async () => {
  const { CAMERA_FIELD_GUIDES, openCameraGuide } = await import('../src/js/camera_guide.js');

  // 1. Card 2 in app.js evaluates Beer Wall from 52157 (beerWallLevel), NOT 52158 (nmRiverLevel)
  assert.ok(
    appJs.includes('evaluateBeerWall(beerWallLevel, beerWallCrest)'),
    'Card 2 in app.js must evaluate Beer Wall from beerWallLevel (Station 52157), not nmRiverLevel (Station 52158)'
  );
  assert.ok(
    !appJs.includes('evaluateBeerWall(nmRiverLevel'),
    'app.js must not evaluate Beer Wall from nmRiverLevel (52158)'
  );

  // 2. Card 3 in app.js disambiguates Monk\'s Leaze Clyse, Allermoor Spillway, Oath Lock, Sowy Spur Tilting Weirs, and Beer Wall / Beazeley
  assert.ok(appJs.includes('Allermoor Spillway (Parrett ➔ Sowy)'), 'Card 3 must disambiguate Allermoor Spillway');
  assert.ok(!appJs.includes('OVERTOPPING (7.50m AOD'), '[RULE-THRESH-01] Card 3 must NOT declare Allermoor OVERTOPPING from the unsurveyed 7.50m proxy');
  assert.ok(appJs.includes('Crest pending EA Asset Survey'), 'Card 3 must mark Allermoor crest as pending EA Asset Survey');
  assert.ok(appJs.includes("(Proxy: Beasley's ${allermoorProxyText ?? '7.50'}m)"), 'Card 3 must denote (Proxy: Beasley\'s <proxy>m) badge');
  assert.ok(appJs.includes("Allermoor's own crest level is not published"), 'Card 3 tooltip must state Allermoor\'s own crest level is not published');
  assert.ok(appJs.includes('Sowy Spur &amp; Lang Acre Tilting Weirs (52157)'), 'Card 3 must disambiguate Sowy Spur & Lang Acre Tilting Weirs driven by 52157');
  assert.ok(appJs.includes('Beer Wall Culverts &amp; Beazeley Spillway (52157)'), 'Card 3 must include Beer Wall Culverts & Beazeley Spillway driven by 52157');
  assert.ok(appJs.includes('Beer Wall Upstream (Greylake)'), 'Card 3 gauges must include Station 52157');

  // 3. Topology SVG edge badge for 52157 -> E9531 with dynamic semantic colors [UI-COL-03]
  assert.ok(
    topologyJs.includes("edge.from === '52157' && edge.to === 'E9531'"),
    'topology.js must render on-canvas edge badge for 52157 -> E9531'
  );
  assert.ok(
    topologyJs.includes('Beer Wall ${fmtM(T_BEER.CREST_MAOD)}m / Weirs ${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m'),
    'Dormant 52157 edge badge must display Beer Wall <crest>m / Weirs <conveyance>m from HYDRO_THRESHOLDS [RULE-SSOT-01]'
  );
  assert.equal(HYDRO_THRESHOLDS['52157'].CREST_MAOD.toFixed(2), '7.30');
  assert.equal(HYDRO_THRESHOLDS['52157'].KSD_CONVEYANCE_MAOD.toFixed(2), '6.00');
  assert.ok(
    topologyJs.includes('🔵 Tilting Weirs Active ${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m'),
    'Active tilting weirs state (>=6.00m) must display 🔵 Tilting Weirs Active 6.00m'
  );
  assert.ok(
    topologyJs.includes('{ x: 677, y: 133, w: 142, h: 18 }'),
    'placedLabelBoxes must pre-seed 52157 -> E9531 edge badge bounding box to prevent node label collisions'
  );

  // 4. Topology Inspector Drawer progressive disclosure for 52233, 52234, and 52157
  assert.ok(
    topologyJs.includes("3-Structure Control Complex (Monk's Leaze, Allermoor &amp; Oath Lock)"),
    'Station 52233 inspector drawer must disambiguate Monk\'s Leaze Clyse, Allermoor Spillway, and Oath Lock'
  );
  assert.ok(
    topologyJs.includes('Stilling-Well Ponding &amp; Downstream Wave Verification'),
    'Station 52234 inspector drawer must explain stilling-well ponding and Beer Wall 52157 wave verification'
  );
  assert.ok(
    topologyJs.includes('4-Tier Hydraulic Elevation Profile (Greylake / A372)'),
    'Station 52157 inspector drawer must display the 4-tier hydraulic elevation profile (4.20m / 6.00m / 7.30m / >8.00m)'
  );
  assert.ok(
    topologyJs.includes("'52157': 'beerwall'"),
    'NODE_CAM_MAP in topology.js must map 52157 to beerwall camera guide'
  );

  // 5. Camera Field Guides [RULE-CAM-01]
  assert.ok(CAMERA_FIELD_GUIDES.beerwall, 'CAMERA_FIELD_GUIDES.beerwall must exist as a first-class guide');
  const beerwallGuideStr = JSON.stringify(CAMERA_FIELD_GUIDES.beerwall);
  assert.ok(
    beerwallGuideStr.includes('NOT the raised A372 highway asphalt carriageway crown'),
    '[RULE-CAM-01] Beer Wall camera guide must explicitly distinguish low-level culvert headwalls from the >8.00m A372 road crown'
  );
});






test('UI/UX Audit (Issue #53 review): 52234 card is reachable while DIVERTING, Oath Lock is suppressed when 52234 is degraded, and 52233 events are priority-ordered', () => {
  const topologyJs = fs.readFileSync(path.join(process.cwd(), 'src/js/topology.js'), 'utf8');
  assert.match(topologyJs, /useControlStructureCard = isControlStructure && node\.id !== '52234'/);
  assert.match(topologyJs, /else if \(useControlStructureCard\)/);
  assert.match(topologyJs, /oathDegraded/);
  assert.match(topologyJs, /'52233': \['monks_leaze_clyse', 'allermoor_spillway', 'west_sedgemoor'\]/);
  assert.ok(!topologyJs.includes('hydro_engine.js?v='), 'topology.js must not import hydro_engine.js with a ?v= query (duplicate module load)');
  const panelJs = fs.readFileSync(path.join(process.cwd(), 'src/js/modules/staff_gauge_panel.js'), 'utf8');
  assert.ok(!panelJs.includes('?v=1.2.0'));
});


test('UI/UX Audit (Issue #59 review): THROTTLED / REVERSE_LOCK clyse nodes never render as SECURE; narratives avoid gate-position claims', async () => {
  const { getNodeStatusVisual, getInspectorNarrative } = await import('../src/js/topology.js');
  const throttled = getNodeStatusVisual({ id: '52233', node_type: 'clyse_gate', status: 'THROTTLED' });
  assert.equal(throttled.label, 'THROTTLED');
  assert.equal(throttled.badgeClass, 'badge-near-crest');
  assert.equal(throttled.stroke, '#f59e0b');
  assert.notEqual(throttled.symbol, '🟢');
  const reverse = getNodeStatusVisual({ id: '52233', node_type: 'clyse_gate', status: 'REVERSE_LOCK' });
  assert.equal(reverse.label, 'REVERSE LOCK');
  assert.equal(reverse.badgeClass, 'badge-overtopping');
  assert.equal(reverse.stroke, '#ef4444');
  assert.equal(reverse.symbol, '🔴');

  for (const status of ['THROTTLED', 'REVERSE_LOCK', 'DIVERTING']) {
    const text = getInspectorNarrative({ id: '52233', node_type: 'clyse_gate', status }, 7.4, 7.9);
    assert.ok(!text.startsWith('NOMINAL / SECURE'), `${status} must not use the SECURE narrative`);
    assert.match(text, /inferred/i);
    assert.doesNotMatch(text, /gates are raised/i);
  }

  const topologyJs = fs.readFileSync(path.join(process.cwd(), 'src/js/topology.js'), 'utf8');
  assert.match(topologyJs, /downFreshness\.isOffline \|\| downFreshness\.isStale \|\| downFreshness\.isFlatlined/);
  assert.ok(!topologyJs.includes("Assumed to spill at about the same Parrett stage"), 'Allermoor copy must not assume a crest');

  const { ASSET_DEFINITIONS } = await import('../src/js/hydro_engine.js');
  for (const [assetKey, asset] of Object.entries(ASSET_DEFINITIONS)) {
    if (asset.survey_tooltip) {
      assert.ok(
        !asset.survey_tooltip.includes('[RULE-'),
        `ASSET_DEFINITIONS.${assetKey}.survey_tooltip must not leak internal [RULE-*] tokens into HTML attributes`
      );
    }
    if (asset.survey_label) {
      assert.ok(
        !asset.survey_label.includes('[RULE-'),
        `ASSET_DEFINITIONS.${assetKey}.survey_label must not leak internal [RULE-*] tokens into HTML`
      );
    }
  }
});

test('UI/UX Audit 7.1 (Issue #67): Decoupled upland headwater rainfall badges, toolbar toggle & inspector hyetograph', async () => {
  const topologyConfig = JSON.parse(fs.readFileSync(path.resolve('src/js/config/topology_network.json'), 'utf8'));

  // 1. Declarative upland_rainfall_origins SSOT & non-overlapping SVG coordinates
  assert.ok(Array.isArray(topologyConfig.upland_rainfall_origins), 'topology_network.json must define upland_rainfall_origins');
  assert.deepEqual(
    topologyConfig.upland_rainfall_origins,
    TOPOLOGY_NETWORK_CONFIG.upland_rainfall_origins,
    'upland_rainfall_origins must stay 100% synced with TOPOLOGY_NETWORK_CONFIG'
  );
  const originIds = topologyConfig.upland_rainfall_origins.map(o => o.id);
  assert.deepEqual(originIds, ['tone_upland', 'parrett_upland', 'isle_upland']);

  const boxes = topologyConfig.upland_rainfall_origins.map(o => o.svg_anchor);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    assert.ok(b.x >= 10 && b.x + b.w <= 950 && b.y >= 10 && b.y + b.h <= 610, `Origin badge ${i} must fit inside 960x620 viewBox`);
    for (let j = i + 1; j < boxes.length; j++) {
      const o = boxes[j];
      const overlaps = b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y;
      assert.equal(overlaps, false, `Origin badges ${i} and ${j} must not overlap`);
    }
  }

  // 2. HTML toolbar toggle & stacked inspector hyetograph container
  assert.ok(topologyHtml.includes('id="btn-rainfall-layer"'), 'topology.html must include Rainfall Layer toggle button');
  assert.ok(topologyHtml.includes('id="node-hyetograph-section"'), 'topology.html must include #node-hyetograph-section');
  const hyetoIdx = topologyHtml.indexOf('id="node-hyetograph-section"');
  const sparkIdx = topologyHtml.indexOf('class="inspector-sparkline-section"');
  assert.ok(hyetoIdx > 0 && sparkIdx > hyetoIdx, 'Upland TBR hyetograph must stack directly above river stage hydrograph');

  // 3. Topology JS atmospheric styling, /api/rainfall fetch, PRECIPITATION_PALETTE, and [RULE-CALC-01] compliance
  assert.ok(topologyJs.includes("fetch('/api/rainfall')"), 'topology.js must fetch /api/rainfall');
  assert.ok(topologyJs.includes('rgba(30, 27, 75, 0.7)'), 'Upland rainfall badge must use rgba(30, 27, 75, 0.7) background');
  assert.ok(topologyJs.includes('rgba(99, 102, 241, 0.4)'), 'Upland rainfall badge must use rgba(99, 102, 241, 0.4) border');
  assert.ok(topologyJs.includes('PRECIPITATION_PALETTE'), 'topology.js must use PRECIPITATION_PALETTE from hydro_engine.js');
  assert.ok(!/cumec|discharge_m3s|volumetric_flow/i.test(topologyJs), 'topology.js must never speculate on volumetric runoff/discharge [RULE-CALC-01]');

  // 4. Null-safe behavioral verification of exported helpers
  const {
    buildUplandRainfallBadgeModel,
    resolveCorrelatedUplandTbr,
    renderInspectorHyetograph
  } = await import('../src/js/topology.js');

  const toneOrigin = topologyConfig.upland_rainfall_origins[0];
  const nullModel = buildUplandRainfallBadgeModel(toneOrigin, null);
  assert.equal(nullModel.hasLive, false);
  assert.equal(nullModel.primaryText, '🌧️ Blackdowns: — (24h)');
  assert.ok(!nullModel.primaryText.includes('NaN'));

  const staleModel = buildUplandRainfallBadgeModel(toneOrigin, {
    catchments: {
      tone_upland: { station_count: 5, active_station_count: 0, all_stale: true, mean_24h_mm: 0, rate_label: 'Dry (0.0 mm/h)' }
    }
  });
  assert.equal(staleModel.hasLive, false);
  assert.match(staleModel.subText, /Awaiting live gauge sync/);

  const liveModel = buildUplandRainfallBadgeModel(toneOrigin, {
    catchments: {
      tone_upland: {
        station_count: 5,
        active_station_count: 5,
        all_stale: false,
        mean_1h_mm: 1.4,
        mean_6h_mm: 8.2,
        mean_24h_mm: 22.4,
        peak_24h_mm: 25.0,
        peak_station: 'Maundown',
        rate_label: 'Light (1.4 mm/h)'
      }
    }
  });
  assert.equal(liveModel.hasLive, true);
  assert.equal(liveModel.primaryText, '🌧️ Blackdowns: 22.4 mm (24h)');

  // Correlated TBR resolution for 52108 (Greenham) & 52116 (Chiselborough) vs 52163 (Dunball)
  const payloadWithLive = {
    stations: [
      { id: '52100', ea_label: 'Maundown', correlated_river_station_id: '52108', pillar: 'upland', is_stale: true, valid_reading_count: 0, last_24h_mm: 0 },
      { id: '45168', ea_label: 'Hockworthy', correlated_river_station_id: '52108', pillar: 'upland', is_stale: false, valid_reading_count: 10, last_24h_mm: 18.6 },
      { id: '52148', ea_label: 'South Perrott', correlated_river_station_id: '52116', pillar: 'upland', is_stale: false, valid_reading_count: 10, last_24h_mm: 16.8 }
    ]
  };
  const greenhamTbr = resolveCorrelatedUplandTbr('52108', payloadWithLive);
  assert.equal(greenhamTbr.station.id, '45168', 'Must prefer active live upland TBR over stale peer');
  assert.equal(greenhamTbr.peerCount, 1);

  const chiselTbr = resolveCorrelatedUplandTbr('52116', payloadWithLive);
  assert.equal(chiselTbr.station.id, '52148');

  assert.equal(resolveCorrelatedUplandTbr('52163', payloadWithLive), null);

  // Hyetograph rendering (empty & active)
  const emptyHyeto = renderInspectorHyetograph({ id: '52100', is_stale: true, series_15min: [] });
  assert.match(emptyHyeto, /Awaiting live 15-min TBR/);

  const activeHyeto = renderInspectorHyetograph({
    id: '52148',
    ea_label: 'South Perrott <script>',
    is_stale: false,
    series_15min: [
      { timestamp: '2026-11-19T12:00:00.000Z', rainfall_mm: 0.4, cumulative_mm: 0.4 },
      { timestamp: '2026-11-19T12:15:00.000Z', rainfall_mm: 1.8, cumulative_mm: 2.2 }
    ]
  });
  assert.ok(activeHyeto.includes('inspector-hyetograph-svg'));
  assert.ok(activeHyeto.includes('hyetograph-tooltip'));
  assert.ok(!activeHyeto.includes('<script>'), 'Must escape station labels in hyetograph HTML attributes');
  assert.ok(!activeHyeto.includes('NaN'));
});

test('UI/UX Audit 7.2 (Issue #67 Fixes): Catchment/rainfall filter isolation, hyetograph tooltip bounds clamping & NaN/null safety', async () => {
  const {
    setupFilterListeners,
    setupRainfallLayerToggle,
    setupAreaFocusListeners,
    renderInspectorHyetograph,
    bindInspectorHyetographEvents
  } = await import('../src/js/topology.js');

  // 1. P1 #5: renderInspectorHyetograph must survive null, undefined, NaN, Infinity, and negative values
  const dirtyHyeto = renderInspectorHyetograph({
    id: '52148',
    ea_label: 'South Perrott',
    is_stale: false,
    series_15min: [
      null,
      undefined,
      { timestamp: '2026-11-19T12:00:00.000Z', rainfall_mm: NaN, cumulative_mm: NaN },
      { timestamp: '2026-11-19T12:15:00.000Z', rainfall_mm: -2.5, cumulative_mm: -1.0 },
      { timestamp: '2026-11-19T12:30:00.000Z', rainfall_mm: Infinity, cumulative_mm: Infinity },
      { timestamp: '2026-11-19T12:45:00.000Z', rainfall_mm: 1.2, cumulative_mm: 1.2 }
    ]
  });
  assert.ok(!dirtyHyeto.includes('NaN'), 'Dirty hyetograph must never emit NaN SVG coordinates');
  assert.ok(!dirtyHyeto.includes('Infinity'), 'Dirty hyetograph must never emit Infinity SVG coordinates');
  assert.ok(!dirtyHyeto.includes('-2.5'), 'Dirty hyetograph must never emit negative rainfall_mm');
  assert.ok(!dirtyHyeto.includes('-1.0'), 'Dirty hyetograph must never emit negative cumulative_mm');
  const seriesMatch = dirtyHyeto.match(/data-series="([^"]+)"/);
  assert.ok(seriesMatch, 'Hyetograph SVG must serialize data-series');
  const parsedSeries = JSON.parse(seriesMatch[1].replace(/&quot;/g, '"'));
  assert.equal(parsedSeries.length, 6);
  assert.deepEqual(parsedSeries.map(p => p.mm), [0, 0, 0, 0, 0, 1.2]);
  assert.deepEqual(parsedSeries.map(p => p.cum), [0, 0, 0, 0, 0, 1.2]);

  // Helper to create a minimal mock DOM element
  function makeMockEl(opts = {}) {
    const classes = new Set(opts.classes || []);
    const attrs = { ...(opts.attrs || {}) };
    const listeners = {};
    return {
      id: opts.id || '',
      style: {},
      dataset: { ...(opts.dataset || {}) },
      clientWidth: opts.clientWidth ?? 0,
      offsetWidth: opts.offsetWidth ?? 0,
      innerText: '',
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, force) => {
          const next = force !== undefined ? Boolean(force) : !classes.has(c);
          if (next) classes.add(c);
          else classes.delete(c);
          return next;
        },
        contains: (c) => classes.has(c)
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = String(v); },
      addEventListener: (ev, fn) => {
        if (!listeners[ev]) listeners[ev] = [];
        listeners[ev].push(fn);
      },
      trigger: (ev, eventObj = {}) => {
        for (const fn of (listeners[ev] || [])) fn({ preventDefault: () => {}, ...eventObj });
      },
      querySelector: opts.querySelector || (() => null),
      querySelectorAll: opts.querySelectorAll || (() => [])
    };
  }

  const prevDocument = globalThis.document;
  try {
    // 2. P0 #1: Catchment filter buttons & area focus pills must never clear #btn-rainfall-layer,
    // and #btn-rainfall-layer must never clear catchment filter buttons.
    const filterAll = makeMockEl({ id: 'filter-all', classes: ['filter-btn', 'active'], attrs: { 'data-catchment': 'all', 'aria-pressed': 'true' } });
    const filterTone = makeMockEl({ id: 'filter-tone', classes: ['filter-btn'], attrs: { 'data-catchment': 'tone', 'aria-pressed': 'false' } });
    const filterParrett = makeMockEl({ id: 'filter-parrett', classes: ['filter-btn'], attrs: { 'data-catchment': 'parrett', 'aria-pressed': 'false' } });
    const rainBtn = makeMockEl({ id: 'btn-rainfall-layer', classes: ['filter-btn', 'rainfall-layer-toggle', 'active'], attrs: { 'aria-pressed': 'true' } });
    const areaLangport = makeMockEl({ classes: ['area-pill-btn'], attrs: { 'data-area': 'langport', 'aria-pressed': 'false' } });

    const catchmentBtns = [filterAll, filterTone, filterParrett];
    globalThis.document = {
      getElementById: (id) => (id === 'btn-rainfall-layer' ? rainBtn : null),
      querySelectorAll: (sel) => {
        if (sel === '.filter-btn[data-catchment]' || sel === '.filter-buttons .filter-btn[data-catchment]') {
          return catchmentBtns;
        }
        if (sel === '.area-pill-btn') {
          return [areaLangport];
        }
        if (sel === '.filter-btn' || sel === '.filter-buttons .filter-btn') {
          return [...catchmentBtns, rainBtn];
        }
        return [];
      }
    };

    setupFilterListeners();
    setupRainfallLayerToggle();
    setupAreaFocusListeners();

    // Click River Tone catchment filter -> #btn-rainfall-layer stays active
    filterTone.trigger('click');
    assert.equal(filterTone.classList.contains('active'), true);
    assert.equal(filterTone.getAttribute('aria-pressed'), 'true');
    assert.equal(filterAll.classList.contains('active'), false);
    assert.equal(rainBtn.classList.contains('active'), true, 'Catchment click must NOT clear .active from #btn-rainfall-layer');
    assert.equal(rainBtn.getAttribute('aria-pressed'), 'true', 'Catchment click must NOT reset aria-pressed on #btn-rainfall-layer');

    // Click #btn-rainfall-layer -> toggles itself only; #filter-tone stays active
    rainBtn.trigger('click');
    assert.equal(rainBtn.classList.contains('active'), false);
    assert.equal(rainBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(filterTone.classList.contains('active'), true, 'Rainfall toggle must NOT clear active catchment filter');
    assert.equal(filterTone.getAttribute('aria-pressed'), 'true');

    // Re-enable #btn-rainfall-layer and click Langport area pill (switches catchment to parrett)
    rainBtn.trigger('click');
    assert.equal(rainBtn.classList.contains('active'), true);
    areaLangport.trigger('click');
    assert.equal(filterParrett.classList.contains('active'), true);
    assert.equal(filterTone.classList.contains('active'), false);
    assert.equal(rainBtn.classList.contains('active'), true, 'Area focus switch must NOT clear .active from #btn-rainfall-layer');
    assert.equal(rainBtn.getAttribute('aria-pressed'), 'true');

    // 3. P1 #4: Tooltip bounds clamping in bindInspectorHyetographEvents()
    const series24 = Array.from({ length: 12 }, (_, idx) => ({
      t: `2026-11-19T${String(12 + idx).padStart(2, '0')}:00:00.000Z`,
      mm: 0.8,
      cum: (idx + 1) * 0.8
    }));

    // 3a. Measured wrapper & tooltip widths (300px wrapper, 220px tooltip)
    const crosshairA = makeMockEl();
    const dotA = makeMockEl();
    const overlayA = makeMockEl();
    const tooltipA = makeMockEl({ offsetWidth: 220 });
    const svgA = makeMockEl({
      dataset: { series: JSON.stringify(series24), maxMm: '1.0' },
      querySelector: (s) => {
        if (s === '.hyetograph-crosshair') return crosshairA;
        if (s === '.hyetograph-dot-highlight') return dotA;
        return null;
      }
    });
    const wrapperA = makeMockEl({
      clientWidth: 300,
      querySelector: (s) => {
        if (s === 'svg.inspector-hyetograph-svg') return svgA;
        if (s === '.hyetograph-touch-overlay') return overlayA;
        if (s === '.hyetograph-tooltip') return tooltipA;
        return null;
      }
    });
    const containerA = makeMockEl({ querySelector: (s) => (s === '.hyetograph-wrapper' ? wrapperA : null) });
    bindInspectorHyetographEvents(containerA);

    wrapperA.trigger('keydown', { key: 'Home' });
    assert.equal(tooltipA.style.transform, 'none');
    assert.equal(parseFloat(tooltipA.style.left), 0, 'Left-edge scrub must clamp tooltip left to 0px');

    wrapperA.trigger('keydown', { key: 'End' });
    assert.equal(tooltipA.style.transform, 'none');
    assert.equal(parseFloat(tooltipA.style.left), 80, 'Right-edge scrub must clamp tooltip left to wrapperW - tipW (80px)');
    assert.ok(parseFloat(tooltipA.style.left) + 220 <= 300, 'Right-edge tooltip must stay strictly within wrapper bounds');

    // 3b. Unmeasured layout fallback (clientWidth=0 / offsetWidth=0) anchors to left/right edge
    const tooltipB = makeMockEl({ offsetWidth: 0 });
    const overlayB = makeMockEl();
    const svgB = makeMockEl({ dataset: { series: JSON.stringify(series24), maxMm: '1.0' } });
    const wrapperB = makeMockEl({
      clientWidth: 0,
      querySelector: (s) => {
        if (s === 'svg.inspector-hyetograph-svg') return svgB;
        if (s === '.hyetograph-touch-overlay') return overlayB;
        if (s === '.hyetograph-tooltip') return tooltipB;
        return null;
      }
    });
    const containerB = makeMockEl({ querySelector: (s) => (s === '.hyetograph-wrapper' ? wrapperB : null) });
    bindInspectorHyetographEvents(containerB);

    wrapperB.trigger('keydown', { key: 'Home' });
    assert.equal(tooltipB.style.left, '0');
    assert.equal(tooltipB.style.transform, 'none');

    wrapperB.trigger('keydown', { key: 'End' });
    assert.equal(tooltipB.style.right, '0');
    assert.equal(tooltipB.style.left, 'auto');
    assert.equal(tooltipB.style.transform, 'none');
  } finally {
    globalThis.document = prevDocument;
  }
});
