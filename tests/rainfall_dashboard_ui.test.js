import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  updateBasinRainHeaderBadge,
  renderCatchmentRainfallCard,
  renderRainfallInspectorContent,
  openRainfallInspectorDialog,
  closeRainfallInspectorDialog,
  initRainfallInspectorDialog,
  resetRainfallInspectorForTests,
  buildPillarAggregateSeries,
  getRainfallBadgeMeta,
  refreshController
} from '../src/js/app.js';
import { JARGON_DEFINITIONS } from '../src/js/jargon_popover.js';
import { bindHyetographEvents } from '../src/js/sparkline.js';
import { aggregateCatchmentRainfall, PRECIPITATION_PALETTE } from '../src/js/hydro_engine.js';

const indexHtml = fs.readFileSync(path.resolve('src/index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.resolve('src/css/styles.css'), 'utf8');

function setupMinimalDom() {
  const elementsById = new Map();
  class MockEl {
    constructor(tag, id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.className = '';
      this.innerHTML = '';
      this.textContent = '';
      this.attributes = new Map();
      this.dataset = {};
      this.listeners = new Map();
      this.open = false;
      this.style = {};
      this.focused = false;
      this.isConnected = true;
      this.classList = {
        add: (c) => {
          const tokens = this.className.split(/\s+/).filter(Boolean);
          if (!tokens.includes(c)) this.className = [...tokens, c].join(' ');
        },
        remove: (c) => {
          this.className = this.className.split(/\s+/).filter(x => x && x !== c).join(' ');
        },
        toggle: (c, force) => {
          const has = this.className.split(/\s+/).filter(Boolean).includes(c);
          const shouldAdd = force === undefined ? !has : Boolean(force);
          if (shouldAdd && !has) this.classList.add(c);
          if (!shouldAdd && has) this.classList.remove(c);
        },
        contains: (c) => this.className.split(/\s+/).filter(Boolean).includes(c)
      };
      this.showModal = () => { this.open = true; };
      this.close = () => { this.open = false; };
      this.focus = () => { this.focused = true; };
      if (id) elementsById.set(id, this);
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'id') {
        this.id = String(v);
        elementsById.set(this.id, this);
      }
    }
    getAttribute(k) { return this.attributes.get(k) ?? null; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const list = this.listeners.get(type);
      if (list) this.listeners.set(type, list.filter(f => f !== fn));
    }
    dispatchEvent(evt) {
      const list = this.listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
    }
    querySelectorAll() { return []; }
    querySelector() { return null; }
  }

  globalThis.document = {
    createElement: (tag) => new MockEl(tag),
    getElementById: (id) => elementsById.get(id) || null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    activeElement: null
  };

  return { MockEl, elementsById };
}

function makeSampleRainfallPayload() {
  const nowMs = Date.parse('2026-11-19T22:00:00Z');
  const readings = {
    '52100': [
      { dateTime: '2026-11-19T21:45:00Z', value: 1.2 },
      { dateTime: '2026-11-19T21:30:00Z', value: 0.8 },
      { dateTime: '2026-11-19T18:00:00Z', value: 4.0 },
      { dateTime: '2026-11-19T06:00:00Z', value: 6.4 },
      { dateTime: '2026-11-18T10:00:00Z', value: 5.0 }
    ],
    '45168': [
      { dateTime: '2026-11-19T21:45:00Z', value: 0.4 },
      { dateTime: '2026-11-19T12:00:00Z', value: 3.0 }
    ],
    '52105': [
      { dateTime: '2026-11-19T21:45:00Z', value: 0.2 },
      { dateTime: '2026-11-19T19:00:00Z', value: 1.2 },
      { dateTime: '2026-11-18T12:00:00Z', value: 8.4 }
    ],
    '52102': [
      { dateTime: '2026-11-19T21:45:00Z', value: 0.4 },
      { dateTime: '2026-11-18T08:00:00Z', value: 6.2 }
    ]
  };
  const agg = aggregateCatchmentRainfall(readings, { nowMs, ambientTempC: 0.2 });
  return {
    status: 'ok',
    source: 'sqlite',
    updated_at: '2026-11-19T22:00:00Z',
    latest_rainfall_reading_at: '2026-11-19T21:45:00Z',
    rainfall_summary: agg.rainfall_summary,
    catchments: agg.catchments,
    stations: agg.stations
  };
}

test('Issue #66 Level 0: updateBasinRainHeaderBadge updates #basin-rain-pill and never enters #alert-banner', () => {
  const { MockEl } = setupMinimalDom();
  const rainPill = new MockEl('span', 'basin-rain-pill');
  const alertBanner = new MockEl('div', 'alert-banner');
  alertBanner.innerText = 'SYSTEM SECURE — ALL MOORS NORMAL';

  const payload = makeSampleRainfallPayload();
  updateBasinRainHeaderBadge(payload);
  assert.match(rainPill.textContent, /Basin Rain:/);
  assert.match(rainPill.textContent, /\(1h\)/);
  assert.match(rainPill.textContent, /\(24h\)/);
  assert.ok(!rainPill.className.includes('precip-stale'));
  assert.equal(alertBanner.innerText, 'SYSTEM SECURE — ALL MOORS NORMAL');

  // Empty / all-stale DB fallback
  const emptyAgg = aggregateCatchmentRainfall({}, { nowMs: Date.parse('2026-11-19T22:00:00Z') });
  updateBasinRainHeaderBadge({
    status: 'ok',
    rainfall_summary: emptyAgg.rainfall_summary,
    catchments: emptyAgg.catchments,
    stations: emptyAgg.stations
  });
  assert.match(rainPill.textContent, /— \(1h\) \| — \(24h\) • Awaiting Live TBR/);
  assert.ok(!rainPill.textContent.includes('0.0mm'));
  assert.ok(rainPill.className.includes('precip-stale'));

  // Populated /api/status fallback summary when /api/rainfall is null
  updateBasinRainHeaderBadge(null, {
    basin_1h_mean_mm: 3.2,
    basin_6h_mean_mm: 6.8,
    basin_24h_mean_mm: 14.2,
    basin_48h_mean_mm: 18.0,
    upland_peak_station: 'Maundown (Clatworthy / Brendon Hills)',
    upland_peak_24h_mm: 21.0,
    upland_peak_1h_mm: 3.6,
    rate_category: 'MODERATE'
  });
  assert.match(rainPill.textContent, /3\.2mm \(1h\) \| 14\.2mm \(24h\) • Moderate/);
  assert.ok(!rainPill.className.includes('precip-stale'));
});

test('Issue #66 Level 1: renderCatchmentRainfallCard renders rolling totals, Two-Pillar layout, OGL v3.0, and null-safe empty/stale state', () => {
  setupMinimalDom();
  const payload = makeSampleRainfallPayload();
  const card = renderCatchmentRainfallCard(payload);

  assert.equal(card.id, 'card-rainfall');
  assert.ok(card.classList.contains('moor-card'));
  assert.ok(card.classList.contains('rainfall-catchment-card'));

  const html = card.innerHTML;
  // Rolling windows 1h, 6h, 24h, 48h
  assert.match(html, /1h Basin Mean/);
  assert.match(html, /6h Basin Mean/);
  assert.match(html, /24h Basin Mean/);
  assert.match(html, /48h Basin Mean/);
  // Active station count & peak station
  assert.match(html, /4\/12 active/);
  assert.match(html, /8 stale/);
  assert.match(html, /Maundown \(Clatworthy \/ Brendon Hills\)/);
  // Two-pillar structure
  assert.match(html, /Pillar 1: Upland River Surge Drivers/);
  assert.match(html, /Pillar 2: Lowland Basin Saturation/);
  // Discrete bar hyetograph sparklines + orthogonal palette
  assert.ok(html.includes('class="hyetograph-svg"'));
  assert.ok(html.includes('class="hyetograph-bar"'));
  assert.ok(html.includes(PRECIPITATION_PALETTE.CUMULATIVE_LINE.hex));
  // OGL v3.0 provenance & jargon popovers
  assert.match(html, /Open Government Licence v3\.0/);
  assert.ok(html.includes('data-term="Tipping Bucket Raingauge"'));
  assert.ok(html.includes('data-term="Antecedent Rainfall"'));
  assert.ok(html.includes('data-term="Catchment Lag"'));
  // Freezing risk badge surfaced neutrally
  assert.match(html, /Frost risk/);
  // Governance checks: no [RULE-*] leak, no unverified "6-to-14 hour" copy, no volumetric speculation
  assert.ok(!/\[RULE-[A-Z0-9-]+\]/.test(html), 'Must never leak internal [RULE-*] tags');
  assert.ok(!/6-to-14\s*hour/i.test(html), 'Must keep catchment lag qualitative rather than hardcoded 6-to-14h');
  assert.ok(!/(cumecs|m3\/s|megalitres|runoff volume)/i.test(html), 'Must not contain volumetric discharge speculation');

  // Null-safe empty / all-stale state
  const emptyAgg = aggregateCatchmentRainfall({}, { nowMs: Date.parse('2026-11-19T22:00:00Z') });
  const emptyCard = renderCatchmentRainfallCard({
    status: 'ok',
    rainfall_summary: emptyAgg.rainfall_summary,
    catchments: emptyAgg.catchments,
    stations: emptyAgg.stations
  });
  const emptyHtml = emptyCard.innerHTML;
  assert.match(emptyHtml, /0\/12 active/);
  assert.match(emptyHtml, /No active upland gauges/);
  assert.match(emptyHtml, /AWAITING TBR/);
  assert.ok(!emptyHtml.includes('0.0 mm'), 'Empty/all-stale KPI tiles must display — instead of 0.0 mm');
  assert.ok(!emptyHtml.includes('0.0mm'), 'Empty/all-stale zone rows must display — instead of 0.0mm');
  assert.ok(emptyHtml.includes('<strong class="rainfall-kpi-value">—</strong>'));
  assert.ok(!emptyHtml.includes('null'));
  assert.ok(!emptyHtml.includes('undefined'));
  assert.ok(!emptyHtml.includes('NaN'));

  // Populated /api/status fallback summary when /api/rainfall is null
  const fallbackSummary = {
    basin_1h_mean_mm: 1.5,
    basin_6h_mean_mm: 4.0,
    basin_24h_mean_mm: 9.5,
    basin_48h_mean_mm: 12.0,
    upland_peak_station: 'Maundown (Clatworthy / Brendon Hills)',
    upland_peak_24h_mm: 14.0,
    upland_peak_1h_mm: 2.2,
    rate_category: 'LIGHT'
  };
  const fallbackMeta = getRainfallBadgeMeta(null, fallbackSummary);
  assert.equal(fallbackMeta.isAllStale, false);
  assert.equal(fallbackMeta.isSummaryOnly, true);
  assert.equal(fallbackMeta.label, 'LIGHT');
  const fallbackCard = renderCatchmentRainfallCard(null, fallbackSummary);
  assert.match(fallbackCard.innerHTML, /1\.5 mm/);
  assert.match(fallbackCard.innerHTML, /Summary active/);
  assert.ok(!fallbackCard.innerHTML.includes('AWAITING TBR'));

  // XSS escaping on upland_peak_station
  const xssCard = renderCatchmentRainfallCard({
    rainfall_summary: {
      basin_1h_mean_mm: 1.0,
      basin_6h_mean_mm: 2.0,
      basin_24h_mean_mm: 3.0,
      basin_48h_mean_mm: 4.0,
      upland_peak_station: '<script>alert(1)</script>',
      upland_peak_24h_mm: 3.0,
      upland_peak_1h_mm: 1.0,
      rate_category: 'LIGHT'
    },
    catchments: {},
    stations: []
  });
  assert.ok(!xssCard.innerHTML.includes('<script>alert(1)</script>'));
  assert.ok(xssCard.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('Issue #66 Level 2: renderRainfallInspectorContent & dialog lifecycle handle 12 stations and empty DB safely', async () => {
  const { MockEl } = setupMinimalDom();
  resetRainfallInspectorForTests();

  const dialog = new MockEl('dialog', 'rainfall-inspector-dialog');
  const body = new MockEl('div', 'rainfall-inspector-body');
  const closeBtn = new MockEl('button', 'rainfall-inspector-close');
  const triggerBtn = new MockEl('button', 'btn-open-rainfall-inspector');

  const payload = makeSampleRainfallPayload();
  const inspectorHtml = renderRainfallInspectorContent(payload);
  assert.match(inspectorHtml, /Maundown \(Clatworthy \/ Brendon Hills\)/);
  assert.match(inspectorHtml, /Collector elevation pending EA survey/);
  assert.match(inspectorHtml, /FREEZING RISK/);
  assert.ok(!inspectorHtml.includes('check-for-flooding.service.gov.uk/station/52100'));

  // Non-HTTP(S) station_url provenance must be rejected and fall back safely
  const xssUrlPayload = makeSampleRainfallPayload();
  xssUrlPayload.stations[0].provenance = { station_url: 'javascript:alert(1)' };
  const xssUrlHtml = renderRainfallInspectorContent(xssUrlPayload);
  assert.ok(!xssUrlHtml.includes('javascript:alert(1)'), 'Must reject javascript: URI in station_url');
  assert.ok(xssUrlHtml.includes(`https://environment.data.gov.uk/flood-monitoring/id/stations/${encodeURIComponent(xssUrlPayload.stations[0].id)}`));

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => payload
  });

  initRainfallInspectorDialog();
  await openRainfallInspectorDialog(triggerBtn);
  assert.equal(dialog.open, true);
  assert.ok(dialog.classList.contains('open'));
  assert.equal(closeBtn.focused, true);
  assert.match(body.innerHTML, /15-min|Hyetograph/);

  // Simulate user scrubbing inside modal before immediately closing
  refreshController.setScrubbing(true);
  assert.equal(refreshController.isScrubbing, true);

  closeRainfallInspectorDialog();
  assert.equal(dialog.open, false);
  assert.equal(triggerBtn.focused, true);
  assert.equal(refreshController.isScrubbing, false, 'Closing inspector dialog must clear scrubbing pause');
  assert.equal(refreshController.getState().isUserInspecting, false);

  // Empty DB fallback in inspector
  assert.match(renderRainfallInspectorContent(null), /No raingauge telemetry is currently cached/);
});

test('Issue #66 Hyetograph Scrubbing: bindHyetographEvents supports keyboard ArrowLeft/ArrowRight/Escape scrubbing', () => {
  const { MockEl } = setupMinimalDom();
  const wrapper = new MockEl('div');
  wrapper.className = 'sparkline-wrapper hyetograph-wrapper';
  const svg = new MockEl('svg');
  svg.className = 'hyetograph-svg';
  svg.dataset = {
    points: JSON.stringify([0.2, 1.0, 2.6]),
    cumulativePoints: JSON.stringify([0.2, 1.2, 3.8]),
    timestamps: JSON.stringify([
      '2026-11-19T21:00:00Z',
      '2026-11-19T21:15:00Z',
      '2026-11-19T21:30:00Z'
    ]),
    ymin: '0',
    ymax: '4.1'
  };
  const crosshair = new MockEl('line');
  const dotHighlight = new MockEl('circle');
  const dotHalo = new MockEl('circle');
  const overlay = new MockEl('rect');
  const tooltip = new MockEl('div');

  wrapper.querySelector = (sel) => {
    if (sel === 'svg.hyetograph-svg' || sel === 'svg.sparkline, svg.inspector-sparkline-svg') return svg;
    if (sel === '.sparkline-touch-overlay') return overlay;
    if (sel === '.sparkline-tooltip') return tooltip;
    return null;
  };
  svg.querySelector = (sel) => {
    if (sel === '.sparkline-crosshair') return crosshair;
    if (sel === '.sparkline-dot-highlight') return dotHighlight;
    if (sel === '.sparkline-dot-halo') return dotHalo;
    return null;
  };
  const container = {
    querySelectorAll: (sel) => (sel === '.hyetograph-wrapper' ? [wrapper] : [])
  };

  const teardowns = bindHyetographEvents(container, { stickyDelay: 1200 });
  assert.equal(teardowns.length, 1);

  wrapper.dispatchEvent({ type: 'keydown', key: 'Home', preventDefault: () => {} });
  assert.ok(wrapper.classList.contains('crosshair-active'));
  assert.match(tooltip.innerHTML, /0\.2mm\/15m/);
  assert.match(tooltip.innerHTML, /Σ 0\.2mm/);

  wrapper.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault: () => {} });
  assert.match(tooltip.innerHTML, /1\.0mm\/15m/);
  assert.match(tooltip.innerHTML, /Σ 1\.2mm/);

  wrapper.dispatchEvent({ type: 'keydown', key: 'End', preventDefault: () => {} });
  assert.match(tooltip.innerHTML, /2\.6mm\/15m/);
  assert.match(tooltip.innerHTML, /Σ 3\.8mm/);

  wrapper.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault: () => {} });
  assert.ok(!wrapper.classList.contains('crosshair-active'));

  for (const fn of teardowns) fn();
});

test('Issue #66: buildPillarAggregateSeries averages active stations per timestamp cleanly', () => {
  const agg = buildPillarAggregateSeries([
    {
      id: 'A',
      pillar: 'upland',
      is_stale: false,
      series_15min: [
        { timestamp: '2026-11-19T10:00:00Z', rainfall_mm: 1.0, cumulative_mm: 1.0 },
        { timestamp: '2026-11-19T10:15:00Z', rainfall_mm: 2.0, cumulative_mm: 3.0 }
      ]
    },
    {
      id: 'B',
      pillar: 'upland',
      is_stale: false,
      series_15min: [
        { timestamp: '2026-11-19T10:00:00Z', rainfall_mm: 3.0, cumulative_mm: 3.0 },
        { timestamp: '2026-11-19T10:15:00Z', rainfall_mm: 4.0, cumulative_mm: 7.0 }
      ]
    },
    {
      id: 'C',
      pillar: 'upland',
      is_stale: true,
      series_15min: [
        { timestamp: '2026-11-19T10:00:00Z', rainfall_mm: 50.0, cumulative_mm: 50.0 }
      ]
    }
  ], 'upland');

  assert.equal(agg.length, 2);
  assert.equal(agg[0].rainfall_mm, 2.0);
  assert.equal(agg[0].cumulative_mm, 2.0);
  assert.equal(agg[1].rainfall_mm, 3.0);
  assert.equal(agg[1].cumulative_mm, 5.0);
});

test('Issue #66 Governance: Jargon popovers, HTML, and CSS tokens satisfy domain & accessibility invariants', () => {
  for (const key of ['Tipping Bucket Raingauge', 'Antecedent Rainfall', 'Catchment Lag']) {
    const def = JARGON_DEFINITIONS[key];
    assert.ok(def, `Missing jargon definition for ${key}`);
    assert.ok(def.definition.length > 20);
    assert.ok(!/(cumec|m3\/s|megalitre)/i.test(def.definition));
    assert.ok(!/6-to-14\s*hour/i.test(def.definition));
  }

  assert.ok(indexHtml.includes('id="basin-rain-pill"'));
  assert.ok(indexHtml.includes('id="rainfall-inspector-dialog"'));
  assert.ok(stylesCss.includes('--precip-1: #a5b4fc'));
  assert.ok(stylesCss.includes('--precip-2: #818cf8'));
  assert.ok(stylesCss.includes('--precip-3: #6366f1'));
  assert.ok(stylesCss.includes('--precip-4: #c084fc'));
  assert.ok(stylesCss.includes('--precip-sum: #e0e7ff'));
  assert.match(stylesCss, /\.rainfall-inspector-trigger\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(stylesCss, /\.rainfall-inspector-dialog\s*\{[\s\S]*?border:\s*none[\s\S]*?padding:\s*0[\s\S]*?margin:\s*0[\s\S]*?max-width:\s*100vw[\s\S]*?max-height:\s*100vh/);
  assert.match(stylesCss, /\.rainfall-inspector-dialog\s+\.close-drawer-btn\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px[\s\S]*?flex-shrink:\s*0/);
  assert.match(stylesCss, /\.rainfall-inspector-stations-grid\s*\{[\s\S]*?minmax\(min\(260px,\s*100%\),\s*1fr\)/);
});
