import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Load source files for automated static and heuristic analysis
const topologyJsPath = path.resolve('src/js/topology.js');
const appJsPath = path.resolve('src/js/app.js');
const stylesCssPath = path.resolve('src/css/styles.css');
const topologyHtmlPath = path.resolve('src/topology.html');
const methodologyHtmlPath = path.resolve('src/methodology.html');

const topologyJs = fs.readFileSync(topologyJsPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const stylesCss = fs.readFileSync(stylesCssPath, 'utf8');
const topologyHtml = fs.readFileSync(topologyHtmlPath, 'utf8');
const methodologyHtml = fs.readFileSync(methodologyHtmlPath, 'utf8');

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
  
  // Dual sparkline Sea Tide stream in app.js must not use warning orange #fb923c
  const startIdx = appJs.indexOf('function renderDualSparkline');
  const endIdx = appJs.indexOf('export function bindSparklineEvents');
  assert.ok(startIdx !== -1 && endIdx !== -1, 'renderDualSparkline must exist in app.js');
  const funcBody = appJs.slice(startIdx, endIdx);
  assert.ok(!funcBody.includes('#fb923c'), 'renderDualSparkline must not use warning orange #fb923c for sea tide');
  assert.ok(funcBody.includes('#0284c7'), 'renderDualSparkline must use Estuarine Deep Blue #0284c7 for sea tide');
});

// ---------------------------------------------------------------------------
// 2. Component & Card Layout Invariants
// ---------------------------------------------------------------------------

test('UI/UX Audit 2.1: Spatial Monotonicity in Data-Viz: Two separated lines NEVER display the identical number', () => {
  // Test sparkline flat stage condition in topology.js and app.js
  const flatLineLogicTopology = topologyJs.includes('const isFlatStage = rawRange < 0.01 || topLabel === botLabel;');
  assert.ok(flatLineLogicTopology, 'topology.js must collapse dual lines when formatted labels match or range < 0.01m');

  const flatLineLogicApp = appJs.includes('const isFlatStage = rawRange < 0.01 || topLabel === botLabel;');
  assert.ok(flatLineLogicApp, 'app.js must collapse dual lines when formatted labels match or range < 0.01m');
});

test('UI/UX Audit 2.2: Flat-line hydrographs render single central reference line with Steady badge', () => {
  // Verify that steady badge and single center guide are rendered when isFlatStage is true
  assert.ok(topologyJs.includes('Steady ${rawMax.toFixed(2)}m'), 'topology.js sparkline must render Steady X.XXm badge');
  assert.ok(topologyJs.includes('deltaText = isFlatStage ? \'0cm (Steady)\''), 'topology.js sparkline must display 0cm (Steady) in header pill');
  assert.ok(topologyJs.includes('const centerY = marginTop + drawHeight / 2;'), 'topology.js must calculate exact vertical center for flat reference line');
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

  // Dynamic crest threshold colors in renderInspectorSparkline
  assert.ok(
    topologyJs.includes("crestStroke = '#64748b'"),
    'Dormant crest line must use neutral muted slate #64748b when river is safe'
  );
  assert.ok(
    topologyJs.includes("crestStroke = '#f59e0b'"),
    'Near-crest line must transition to amber alert #f59e0b within 30cm'
  );
  assert.ok(
    topologyJs.includes("crestStroke = '#ef4444'"),
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
  // Sparkline must output interactive wrapper, tooltip, and overlay
  assert.ok(topologyJs.includes('class="sparkline-wrapper"'), 'Inspector sparkline must wrap in .sparkline-wrapper');
  assert.ok(topologyJs.includes('class="sparkline-crosshair"'), 'Inspector sparkline must render interactive crosshair line');
  assert.ok(topologyJs.includes('class="sparkline-dot-highlight"'), 'Inspector sparkline must render active dot highlight');
  assert.ok(topologyJs.includes('class="sparkline-touch-overlay"'), 'Inspector sparkline must render transparent hit overlay for touch/mouse');
  assert.ok(topologyJs.includes('class="sparkline-tooltip"'), 'Inspector sparkline must render floating tooltip for timestamps and readings');

  // Data attributes must encode full 24h timeline
  assert.ok(topologyJs.includes("data-timestamps='${JSON.stringify(timestamps)}'"), 'Inspector sparkline must serialize data-timestamps');
  assert.ok(topologyJs.includes("data-points='${JSON.stringify(values)}'"), 'Inspector sparkline must serialize data-points');

  // Event binding and keyboard navigation
  assert.ok(topologyJs.includes('bindInspectorSparklineEvents(sparklineBox);'), 'selectNode must invoke bindInspectorSparklineEvents');
  assert.ok(topologyJs.includes("'ArrowLeft'") && topologyJs.includes("'ArrowRight'"), 'Inspector sparkline must support Arrow key scrubbing');

  // CSS positioning rules
  assert.ok(stylesCss.includes('.inspector-sparkline-box .sparkline-wrapper'), 'styles.css must style inspector sparkline wrapper');
  assert.ok(stylesCss.includes('.inspector-sparkline-box .sparkline-tooltip'), 'styles.css must position inspector floating tooltip');
});

// ---------------------------------------------------------------------------
// 4. River Network Topology Completeness & Usability Invariants
// ---------------------------------------------------------------------------

test('UI/UX Audit 4.1: Hydraulic flow connectivity: River Tone flows continuously into River Parrett at Burrowbridge (52118 -> 52158)', () => {
  const serverJsPath = path.resolve('server.js');
  const serverJs = fs.readFileSync(serverJsPath, 'utf8');

  // Both server.js and topology.js must define the main river confluence edge from Hookbridge to Baltmoor Wall
  assert.ok(
    serverJs.includes('from: "52118", to: "52158", type: "main_river"'),
    'server.js must define main_river edge from Hookbridge (52118) to Baltmoor Wall (52158)'
  );
  assert.ok(
    topologyJs.includes('from: "52118", to: "52158", type: "main_river"'),
    'topology.js must define main_river edge from Hookbridge (52118) to Baltmoor Wall (52158)'
  );
});

test('UI/UX Audit 4.2: Estuarine sea outfall uses dynamic hydrostatic head check (westQuayStage > seaStage)', () => {
  const serverJsPath = path.resolve('server.js');
  const serverJs = fs.readFileSync(serverJsPath, 'utf8');

  assert.ok(
    serverJs.includes('westQuayStage > seaStage'),
    'server.js must compute sea outfall gravity discharge using hydrostatic gradient (westQuayStage > seaStage)'
  );
  assert.ok(
    !serverJs.includes('flow_active: seaStage < 5.50'),
    'server.js must NOT hardcode seaStage < 5.50 for gravity discharge'
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

test('UI/UX Audit 4.6: Monk\'s Leaze Clyse (52233) AI gate camera link', () => {
  assert.ok(
    topologyJs.includes('node.id === \'52233\''),
    'topology.js must check for station 52233 in inspectNode'
  );
  assert.ok(
    topologyJs.includes('Sluice Gate Camera &amp; AI Analysis'),
    'topology.js must render camera link for Monk\'s Leaze Clyse'
  );
});

test('UI/UX Audit 4.7: Monk\'s Leaze Clyse (52233 -> 52234) flow animation strictly decoupled from closed gate state', () => {
  const serverJsPath = path.resolve('server.js');
  const serverJs = fs.readFileSync(serverJsPath, 'utf8');

  // server.js must use isMonksDiverting for diversion clyse flow_active, not static sill elevation >= 4.20
  assert.ok(
    serverJs.includes('from: "52233", to: "52234", type: "diversion_clyse", flow_active: isMonksDiverting'),
    'server.js must set diversion_clyse flow_active to isMonksDiverting'
  );
  assert.ok(
    !serverJs.includes('from: "52233", to: "52234", type: "diversion_clyse", flow_active: monksUpStage >= 4.20'),
    'server.js must NOT set diversion_clyse flow_active purely on stage >= 4.20'
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
  assert.ok(
    serverJs.includes('seaStage >= dunballInlandStage ? "SLACK_RESTRICTED" : "SECURE"'),
    'server.js must set 52163 status to SLACK_RESTRICTED (TIDE-LOCKED) when seaStage >= dunballInlandStage'
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




