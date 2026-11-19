import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DASHBOARD_CARD_EA_AREAS,
  getActiveWarningsForCard,
  getDashboardCardsForTargetArea,
  buildCardEAWarningStripHtml,
  updateEAWarningSummaryBanner,
  openEAWarningsDialog,
  initEAWarningsDialog,
  resetEAWarningsDialogForTests,
  formatEAWarningTimestamp
} from '../src/js/modules/ea_warnings_panel.js';
import { createMoorCard, createMoorFallbackCard } from '../src/js/app.js';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/js/db_migrations.js';
import { getEAWarnings } from '../src/js/ea_warning_manager.js';
import { validateApiWarningsPayload } from '../src/js/contracts/ea_warnings_schema.js';
import { EA_FLOOD_AREA_CATALOG } from '../src/js/hydro_engine.js';

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
      this.open = false;
      this.style = {};
      this.classList = {
        add: (c) => { if (!this.className.split(/\s+/).includes(c)) this.className = `${this.className} ${c}`.trim(); },
        remove: (c) => { this.className = this.className.split(/\s+/).filter(x => x !== c).join(' '); }
      };
      this.isConnected = true;
      this.showModal = () => { this.open = true; };
      this.close = () => { this.open = false; };
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
    addEventListener() {}
  }

  globalThis.document = {
    createElement: (tag) => new MockEl(tag),
    getElementById: (id) => elementsById.get(id) || null,
    activeElement: null
  };

  return { MockEl, elementsById };
}

test('DASHBOARD_CARD_EA_AREAS maps all 6 main dashboard cards to EA target areas', () => {
  const expectedCards = ['card-52118', 'card-52127', 'card-52158', 'card-52233', 'card-52163', 'card-52120'];
  assert.deepEqual(Object.keys(DASHBOARD_CARD_EA_AREAS), expectedCards);
  assert.ok(DASHBOARD_CARD_EA_AREAS['card-52118'].targetAreas.includes('112FWFCUR10A'));
  assert.ok(DASHBOARD_CARD_EA_AREAS['card-52120'].targetAreas.includes('112FWFMTM10A'));
  assert.ok(DASHBOARD_CARD_EA_AREAS['card-52233'].targetAreas.includes('112WAFTESR'));
  assert.ok(DASHBOARD_CARD_EA_AREAS['card-52163'].targetAreas.includes('112WAFBCR'));
});

test('updateEAWarningSummaryBanner enforces [UI-COL-03] calm/amber/crimson states', () => {
  const { MockEl } = setupMinimalDom();
  const banner = new MockEl('div', 'ea-warning-summary-banner');
  const textEl = new MockEl('span', 'ea-warning-banner-text');
  const actionEl = new MockEl('span', 'ea-warning-banner-action');

  updateEAWarningSummaryBanner({ active_count: 0, has_severe_warning: false, has_flood_warning: false, has_flood_alert: false });
  assert.equal(banner.className, 'ea-warning-banner banner-calm');
  assert.match(textEl.innerHTML, /None Active in Somerset Catchment/);

  updateEAWarningSummaryBanner({ active_count: 2, has_severe_warning: false, has_flood_warning: false, has_flood_alert: true });
  assert.equal(banner.className, 'ea-warning-banner banner-alert');
  assert.match(textEl.innerHTML, /Official EA Flood Alert Active.*2 Areas/);

  updateEAWarningSummaryBanner({ active_count: 1, has_severe_warning: false, has_flood_warning: true, has_flood_alert: false });
  assert.equal(banner.className, 'ea-warning-banner banner-critical');
  assert.match(textEl.innerHTML, /Official EA Flood Warning in Force.*1 Area/);

  updateEAWarningSummaryBanner({ active_count: 1, has_severe_warning: true, has_flood_warning: false, has_flood_alert: false });
  assert.equal(banner.className, 'ea-warning-banner banner-critical');
  assert.match(textEl.innerHTML, /SEVERE Flood Warning in Force/);
});

test('buildCardEAWarningStripHtml & createMoorCard/createMoorFallbackCard render strip only for active matching areas', () => {
  setupMinimalDom();
  const activeWarnings = [
    {
      target_area_notation: '112FWFCUR10A',
      area_name: 'Curry Moor & Hay Moor <script>',
      severity_level: 2,
      message: 'Flooding is expected.'
    }
  ];

  assert.equal(buildCardEAWarningStripHtml('card-52118', []), '');
  assert.equal(buildCardEAWarningStripHtml('card-52163', activeWarnings), '');

  const strip = buildCardEAWarningStripHtml('card-52118', activeWarnings);
  assert.match(strip, /card-ea-warning-btn ea-btn-critical/);
  assert.match(strip, /EA FLOOD WARNING:/);
  assert.ok(!strip.includes('<script>'), 'Area name must be HTML-escaped');

  const card = createMoorCard({
    cardId: 'card-52118',
    stationId: '52118',
    title: 'Curry Moor System',
    riverTag: 'River Tone',
    eval: { badgeClass: 'badge-secure', symbol: '🟢', label: 'SECURE' },
    sparkline: '<svg></svg>',
    narrative: 'Normal.',
    pills: [],
    eaWarnings: activeWarnings
  });
  assert.match(card.innerHTML, /card-ea-warning-btn ea-btn-critical/);

  const fallbackCard = createMoorFallbackCard({
    cardId: 'card-52118',
    stationId: '52118',
    title: 'Curry Moor System',
    eaWarnings: activeWarnings
  });
  assert.match(fallbackCard.innerHTML, /card-ea-warning-btn ea-btn-critical/);
});

test('openEAWarningsDialog renders calm state, verbatim escaped message, Europe/London time & deep-link chips', async () => {
  const { MockEl } = setupMinimalDom();
  const dialog = new MockEl('dialog', 'ea-warnings-dialog');
  const bodyEl = new MockEl('div', 'ea-warnings-modal-body');

  await openEAWarningsDialog({ preloadedWarnings: [] });
  assert.equal(dialog.open, true);
  assert.match(bodyEl.innerHTML, /No Active Environment Agency Flood Warnings/);

  await openEAWarningsDialog({
    filterArea: '112FWFCUR10A',
    preloadedWarnings: [
      {
        target_area_notation: '112FWFCUR10A',
        area_name: 'Curry Moor and Hay Moor',
        description: 'Curry Moor and Hay Moor',
        severity_level: 2,
        time_raised: '2026-02-01T10:15:00Z',
        time_message_changed: '2026-02-01T11:30:00Z',
        message: 'River Tone levels are rising <img src=x onerror=alert(1)>.',
        correlated_roads: [
          { asset_id: 'cuts_road', name: 'Cuts Road', current_status: 'IMPASSABLE' }
        ]
      }
    ]
  });

  assert.match(bodyEl.innerHTML, /FLOOD WARNING/);
  assert.match(bodyEl.innerHTML, /112FWFCUR10A/);
  assert.match(bodyEl.innerHTML, /\(Europe\/London\)/);
  assert.match(bodyEl.innerHTML, /data-jump-card-id="card-52118"/);
  assert.match(bodyEl.innerHTML, /roads\.html#cuts_road/);
  assert.ok(!bodyEl.innerHTML.includes('<img src=x'), 'Verbatim message must be HTML-escaped');
  assert.match(formatEAWarningTimestamp('2026-02-01T10:15:00Z'), /\(Europe\/London\)/);
  assert.ok(getActiveWarningsForCard('card-52118', [{ target_area_notation: '112FWFCUR10A', severity_level: 2 }]).length === 1);
  assert.ok(getDashboardCardsForTargetArea('112FWFCUR10A').some(c => c.cardId === 'card-52118'));
});

test('index.html includes header-summary-row, ea-warning-summary-banner, and OGL v3.0 dialog', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'src/index.html'), 'utf8');
  assert.match(html, /class="header-summary-row"/);
  assert.match(html, /id="ea-warning-summary-banner"/);
  assert.match(html, /id="ea-warnings-dialog"/);
  assert.match(html, /Open Government Licence v3\.0/);
});

test('multi-warning sorting, (+N more) badge, NaN active_count guard, and null correlated_roads handling', async () => {
  const { MockEl } = setupMinimalDom();
  const banner = new MockEl('div', 'ea-warning-summary-banner');
  new MockEl('span', 'ea-warning-banner-text');
  new MockEl('span', 'ea-warning-banner-action');
  new MockEl('dialog', 'ea-warnings-dialog');
  const bodyEl = new MockEl('div', 'ea-warnings-modal-body');

  updateEAWarningSummaryBanner({ active_count: 'invalid', has_flood_alert: true });
  assert.equal(banner.className, 'ea-warning-banner banner-calm');

  const multiWarnings = [
    { target_area_notation: '112WAFTPM', area_name: 'Lower Tone and Parrett Moors', severity_level: 3 },
    { target_area_notation: '112FWFCUR10A', area_name: 'Curry Moor and Hay Moor', severity_level: 2 }
  ];
  const sorted = getActiveWarningsForCard('card-52118', multiWarnings);
  assert.equal(sorted[0].target_area_notation, '112FWFCUR10A');
  const strip = buildCardEAWarningStripHtml('card-52118', multiWarnings);
  assert.match(strip, /\(\+1 more\)/);
  assert.match(strip, /ea-btn-critical/);

  await openEAWarningsDialog({
    preloadedWarnings: [
      {
        target_area_notation: '112FWFCUR10A',
        severity_level: 2,
        message: 'Test',
        correlated_roads: [null, { asset_id: 'cuts_road', name: 'Cuts Road', current_status: 'PASSABLE' }]
      }
    ]
  });
  assert.match(bodyEl.innerHTML, /roads\.html#cuts_road/);
});

test('initEAWarningsDialog clears trigger focus on card jump and openEAWarningsDialog handles live fetch errors', async () => {
  resetEAWarningsDialogForTests();
  const { MockEl } = setupMinimalDom();
  const listenersByEl = new Map();
  const attach = (el) => {
    el.addEventListener = (type, fn) => {
      if (!listenersByEl.has(el)) listenersByEl.set(el, new Map());
      listenersByEl.get(el).set(type, fn);
    };
    return el;
  };

  const dialog = attach(new MockEl('dialog', 'ea-warnings-dialog'));
  dialog.close = () => {
    dialog.open = false;
    // Simulate async native <dialog> close event firing after synchronous handler
    queueMicrotask(() => {
      const fn = listenersByEl.get(dialog)?.get('close');
      if (fn) fn();
    });
  };
  const bodyEl = new MockEl('div', 'ea-warnings-modal-body');
  attach(new MockEl('button', 'ea-warnings-close'));
  const bannerBtn = attach(new MockEl('button', 'ea-warning-banner-btn'));
  let focusedEl = null;
  bannerBtn.focus = () => { focusedEl = bannerBtn; };
  const targetCard = new MockEl('article', 'card-52118');
  targetCard.scrollIntoView = () => {};
  targetCard.focus = () => { focusedEl = targetCard; };
  const cardsContainer = attach(new MockEl('main', 'cards-container'));

  initEAWarningsDialog(cardsContainer);

  // Test live fetch 200 + 500 error handling
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ warnings: [{ target_area_notation: '112FWFCUR10A', severity_level: 2, message: 'Live fetch ok' }] })
    });
    await openEAWarningsDialog({ triggerEl: bannerBtn });
    assert.match(bodyEl.innerHTML, /Live fetch ok/);

    // Card jump must focus targetCard and NOT let async dialog 'close' steal focus back to bannerBtn
    const jumpBtn = { getAttribute: (k) => (k === 'data-jump-card-id' ? 'card-52118' : null) };
    const clickHandler = listenersByEl.get(dialog).get('click');
    clickHandler({ target: { closest: (sel) => (sel === '.ea-card-jump-btn' ? jumpBtn : null) } });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(focusedEl, targetCard);

    // Normal close restores focus to bannerBtn
    await openEAWarningsDialog({ triggerEl: bannerBtn, preloadedWarnings: [] });
    dialog.close();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(focusedEl, bannerBtn);

    // HTTP 500 error path
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    await openEAWarningsDialog({ triggerEl: bannerBtn });
    assert.match(bodyEl.innerHTML, /Unable to load official EA briefing right now \(HTTP 500\)/);
  } finally {
    globalThis.fetch = originalFetch;
    resetEAWarningsDialogForTests();
  }
});

test('every EA_FLOOD_AREA_CATALOG area is mapped to at least one dashboard card [Issue #55]', () => {
  const mapped = new Set(Object.values(DASHBOARD_CARD_EA_AREAS).flatMap(c => c.targetAreas));
  for (const notation of Object.keys(EA_FLOOD_AREA_CATALOG)) {
    assert.ok(mapped.has(notation), `${notation} must map to a dashboard card`);
  }
});

test('openEAWarningsDialog shows .open, renders real API narrative once-escaped, and close removes .open', async () => {
  resetEAWarningsDialogForTests();
  const db = new Database(':memory:');
  runMigrations(db);
  const rawNarrative = `Levels at Burrowbridge & "Stathe" are rising <img src=x onerror=alert(1)> don't drive.`;
  db.prepare(`
    INSERT INTO ea_warning_events (
      warning_id, target_area_notation, area_name, severity_level, severity_label,
      time_raised, narrative, trigger_snapshot_json, status
    ) VALUES ('W-UI-1', '112FWFCUR10A', 'Curry Moor and Hay Moor', 2, 'Flood Warning',
      '2026-11-08T10:00:00Z', ?, '{}', 'ACTIVE')
  `).run(rawNarrative);
  const warnings = getEAWarnings(db, { status: 'ACTIVE' });
  db.close();
  const payload = { status: 'ok', count: warnings.length, warnings };
  assert.equal(validateApiWarningsPayload(payload).valid, true);
  assert.equal(warnings[0].narrative, rawNarrative, 'API narrative must be raw text');

  const { MockEl } = setupMinimalDom();
  const listeners = new Map();
  const dialog = new MockEl('dialog', 'ea-warnings-dialog');
  dialog.addEventListener = (type, fn) => listeners.set(type, fn);
  const bodyEl = new MockEl('div', 'ea-warnings-modal-body');
  new MockEl('button', 'ea-warnings-close');
  const trigger = new MockEl('button', 'ea-warning-banner-btn');
  let focused = 0;
  trigger.focus = () => { focused++; };
  initEAWarningsDialog(new MockEl('main', 'cards-container'));

  await openEAWarningsDialog({ triggerEl: trigger, preloadedWarnings: payload.warnings });
  assert.equal(dialog.open, true);
  assert.ok(dialog.className.split(/\s+/).includes('open'), 'dialog must carry .open (CSS hides .sys-health-backdrop:not(.open))');
  assert.ok(bodyEl.innerHTML.includes('Burrowbridge &amp; &quot;Stathe&quot; are rising &lt;img'), 'narrative escaped exactly once');
  assert.ok(!bodyEl.innerHTML.includes('&amp;amp;'), 'no double-escaping');
  assert.ok(!bodyEl.innerHTML.includes('<img src=x'));
  assert.ok(!bodyEl.innerHTML.includes('No additional briefing text'));

  // Native close (Esc key path) removes .open and restores focus to a connected trigger
  dialog.open = false;
  listeners.get('close')();
  assert.ok(!dialog.className.split(/\s+/).includes('open'));
  assert.equal(focused, 1);

  // Detached trigger must not be focused
  await openEAWarningsDialog({ triggerEl: trigger, preloadedWarnings: [] });
  trigger.isConnected = false;
  dialog.open = false;
  listeners.get('close')();
  assert.equal(focused, 1);
  resetEAWarningsDialogForTests();
});
