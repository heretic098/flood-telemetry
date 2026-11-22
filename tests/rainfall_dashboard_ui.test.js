import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  updateBasinRainHeaderBadge,
  updateRainfallSummaryBanner,
  getRainfallBadgeMeta as getOverviewRainfallMeta
} from '../src/js/app.js';
import {
  renderCatchmentRainfallOverview,
  renderAllRaingaugesInline,
  updateRainfallPageBanner,
  updateArchiveCoverageNotice,
  setRainfallPeriod,
  getCurrentPeriod,
  resetRainfallPageStateForTests,
  buildPillarAggregateSeries,
  getRainfallBadgeMeta,
  refreshController
} from '../src/js/rainfall.js';
import { JARGON_DEFINITIONS } from '../src/js/jargon_popover.js';
import { bindHyetographEvents } from '../src/js/sparkline.js';
import { aggregateCatchmentRainfall, PRECIPITATION_PALETTE } from '../src/js/hydro_engine.js';

const indexHtml = fs.readFileSync(path.resolve('src/index.html'), 'utf8');
const rainfallHtml = fs.readFileSync(path.resolve('src/rainfall.html'), 'utf8');
const topologyHtml = fs.readFileSync(path.resolve('src/topology.html'), 'utf8');
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
  assert.match(rainPill.textContent, /3\.2mm \(1h\) \| 14\.2mm \(24h\) • Steady/);
  // Overview Summary Banner (#rainfall-summary-banner) updates alongside #basin-rain-pill
  const summaryBanner = new MockEl('div', 'rainfall-summary-banner');
  const summaryText = new MockEl('span', 'rainfall-banner-text');
  updateRainfallSummaryBanner(null, {
    basin_1h_mean_mm: 3.2,
    basin_6h_mean_mm: 6.8,
    basin_24h_mean_mm: 14.2,
    basin_48h_mean_mm: 18.0,
    upland_peak_station: 'Maundown (Clatworthy / Brendon Hills)',
    upland_peak_24h_mm: 21.0,
    upland_peak_1h_mm: 3.6,
    rate_category: 'MODERATE'
  });
  assert.ok(summaryBanner.className.includes('precip-moderate'));
  assert.match(summaryText.innerHTML, /Steady • 3\.2mm \(1h\) \| 14\.2mm \(24h\)/);
  assert.equal(getOverviewRainfallMeta(null, { basin_1h_mean_mm: 3.2 }).headerSuffix, 'Steady');
});

test('Dedicated Rainfall Tab (rainfall.html): renderCatchmentRainfallOverview renders rolling totals, Two-Pillar layout, OGL v3.0, and null-safe empty/stale state', () => {
  setupMinimalDom();
  const payload = makeSampleRainfallPayload();
  const html = renderCatchmentRainfallOverview(payload);

  // Rolling windows 1h, 6h, 24h, 48h
  assert.match(html, /1h Basin Mean/);
  assert.match(html, /6h Basin Mean/);
  assert.match(html, /24h Basin Mean/);
  assert.match(html, /48h Basin Mean/);
  // Active station count & peak station
  assert.match(html, /4\/14 active/);
  assert.match(html, /10 stale/);
  assert.match(html, /14 EA /);
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
  const emptyHtml = renderCatchmentRainfallOverview({
    status: 'ok',
    rainfall_summary: emptyAgg.rainfall_summary,
    catchments: emptyAgg.catchments,
    stations: emptyAgg.stations
  });
  assert.match(emptyHtml, /0\/14 active/);
  assert.match(emptyHtml, /No active upland gauges/);
  assert.match(emptyHtml, /AWAITING LIVE TBR/);
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

  // XSS escaping on upland_peak_station
  const xssHtml = renderCatchmentRainfallOverview({
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
  assert.ok(!xssHtml.includes('<script>alert(1)</script>'));
  assert.ok(xssHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('Dedicated Rainfall Tab: renderAllRaingaugesInline renders all 14 stations inline, supports zone filtering, and rejects unsafe URLs', () => {
  const { MockEl } = setupMinimalDom();
  const pageBanner = new MockEl('div', 'rainfall-status-banner');

  const payload = makeSampleRainfallPayload();
  updateRainfallPageBanner(payload);
  assert.match(pageBanner.textContent, /CATCHMENT RAINFALL:/);
  assert.match(pageBanner.textContent, /4\/14 EA RAINGAUGES LIVE/);

  const allHtml = renderAllRaingaugesInline(payload, 'all');
  const cardMatches = allHtml.match(/class="rainfall-station-inspector-card"/g) || [];
  assert.equal(cardMatches.length, 14, 'All 14 EA tipping-bucket raingauges must render inline');
  assert.match(allHtml, /Maundown \(Clatworthy \/ Brendon Hills\)/);
  assert.match(allHtml, /Quantock Farm \(Quantock Hills Ridge\)/);
  assert.match(allHtml, /Sherborne \(Upper River Yeo East\)/);
  assert.match(allHtml, /Collector elevation pending EA survey/);
  assert.match(allHtml, /FREEZING RISK/);
  assert.ok(!allHtml.includes('check-for-flooding.service.gov.uk/station/52100'));

  // Zone filtering
  const toneOnlyHtml = renderAllRaingaugesInline(payload, 'tone_upland');
  const toneCardMatches = toneOnlyHtml.match(/class="rainfall-station-inspector-card"/g) || [];
  assert.equal(toneCardMatches.length, 6, 'tone_upland filter must show all 6 Tone upland stations');

  // Non-HTTP(S) station_url provenance must be rejected and fall back safely
  const xssUrlPayload = makeSampleRainfallPayload();
  xssUrlPayload.stations[0].provenance = { station_url: 'javascript:alert(1)' };
  const xssUrlHtml = renderAllRaingaugesInline(xssUrlPayload);
  assert.ok(!xssUrlHtml.includes('javascript:alert(1)'), 'Must reject javascript: URI in station_url');
  assert.ok(xssUrlHtml.includes(`https://environment.data.gov.uk/flood-monitoring/id/stations/${encodeURIComponent(xssUrlPayload.stations[0].id)}`));

  // Empty DB fallback
  assert.match(renderAllRaingaugesInline(null), /No raingauge telemetry is currently cached/);
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

  // Overview has clickable #basin-rain-pill + compact #rainfall-summary-banner linking to rainfall.html, and no modal dialog
  assert.ok(indexHtml.includes('href="rainfall.html" class="basin-rain-pill precip-dry" id="basin-rain-pill"'));
  assert.ok(indexHtml.includes('id="rainfall-summary-banner"'));
  assert.ok(!indexHtml.includes('id="rainfall-inspector-dialog"'), 'Cramped rainfall modal dialog must be retired from index.html');

  // Dedicated rainfall.html structure & Topology deep link
  assert.ok(rainfallHtml.includes('id="rainfall-status-banner"'));
  assert.ok(rainfallHtml.includes('id="rainfall-overview-container"'));
  assert.ok(rainfallHtml.includes('id="rainfall-stations-container"'));
  assert.ok(rainfallHtml.includes('id="rainfall-archive-notice"'));
  assert.ok(rainfallHtml.includes('class="rainfall-period-bar"'));
  assert.ok(rainfallHtml.includes('data-period="24h"'));
  assert.ok(rainfallHtml.includes('data-period="7d"'));
  assert.ok(rainfallHtml.includes('data-period="30d"'));
  assert.ok(rainfallHtml.includes('class="rainfall-filter-bar"'));
  assert.ok(rainfallHtml.includes('<noscript>'));
  assert.ok(topologyHtml.includes('href="rainfall.html"'), 'Topology node inspector must link to rainfall.html');

  assert.ok(stylesCss.includes('--precip-0: #64748b'));
  assert.ok(stylesCss.includes('--precip-1: #818cf8'));
  assert.ok(stylesCss.includes('--precip-2: #a5b4fc'));
  assert.ok(stylesCss.includes('--precip-3: #c084fc'));
  assert.ok(stylesCss.includes('--precip-4: #f0abfc'));
  assert.ok(stylesCss.includes('--precip-sum: #e0e7ff'));
  assert.match(stylesCss, /\.rainfall-period-btn\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(stylesCss, /\.rainfall-inspector-stations-grid\s*\{[\s\S]*?minmax\(min\(260px,\s*100%\),\s*1fr\)/);
});

test('Dedicated Rainfall Tab: adaptive period switcher (24h/7d/30d), request-sequence guard, and honest partial archive notice', async () => {
  const { MockEl } = setupMinimalDom();
  resetRainfallPageStateForTests();

  const noticeEl = new MockEl('div', 'rainfall-archive-notice');
  const overviewEl = new MockEl('section', 'rainfall-overview-container');
  const stationsEl = new MockEl('div', 'rainfall-stations-container');
  const hintEl = new MockEl('span', 'rainfall-period-hint');
  new MockEl('div', 'rainfall-status-banner');

  const payload7d = {
    ...makeSampleRainfallPayload(),
    period: '7d',
    bucket_minutes: 180,
    bucket_label: '3h',
    archive_coverage_hours: 48.0,
    is_partial_archive: true
  };
  const payload30d = {
    ...makeSampleRainfallPayload(),
    period: '30d',
    bucket_minutes: 1440,
    bucket_label: 'day',
    archive_coverage_hours: 720.0,
    is_partial_archive: false
  };

  // Partial archive notice renders honestly when is_partial_archive is true and hides when complete
  updateArchiveCoverageNotice(payload7d);
  assert.equal(noticeEl.style.display, 'block');
  assert.match(noticeEl.textContent, /Partial Archive Coverage/);
  assert.match(noticeEl.textContent, /not assumed dry/);

  updateArchiveCoverageNotice(payload30d);
  assert.equal(noticeEl.style.display, 'none');

  // Request-sequence guard: slow 7d fetch resolving AFTER fast 30d fetch must NOT overwrite 30d DOM
  let resolveSlow7d;
  const slow7dPromise = new Promise((resolve) => { resolveSlow7d = resolve; });
  globalThis.fetch = (url) => {
    if (String(url).includes('period=7d')) {
      return slow7dPromise.then(() => ({ ok: true, json: async () => payload7d }));
    }
    return Promise.resolve({ ok: true, json: async () => payload30d });
  };

  const p7d = setRainfallPeriod('7d');
  const p30d = setRainfallPeriod('30d');
  await p30d;
  assert.equal(getCurrentPeriod(), '30d');
  assert.match(overviewEl.innerHTML, /30D Basin Mean/);
  assert.match(overviewEl.innerHTML, /daily bars/);
  assert.match(stationsEl.innerHTML, /mm\/day/);
  assert.match(hintEl.textContent, /30D window/);

  // Now resolve stale 7d request — DOM must stay on 30d
  resolveSlow7d();
  await p7d;
  assert.equal(getCurrentPeriod(), '30d');
  assert.match(overviewEl.innerHTML, /30D Basin Mean/);
  assert.ok(!overviewEl.innerHTML.includes('7D Basin Mean'), 'Stale 7d response must not overwrite newer 30d view');
  resetRainfallPageStateForTests();
});
