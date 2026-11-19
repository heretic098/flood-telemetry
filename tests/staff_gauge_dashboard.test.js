import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createMoorCard,
  renderSubStationGaugeRow,
  initDashboardStaffGaugeTriggers,
  resetDashboardStaffGaugeState
} from '../src/js/app.js';
import { STAFF_GAUGE_CAMERA_MAP } from '../src/js/staff_gauge_cameras.js';
import { loadFrame, getStaffGaugePanelCopy } from '../src/js/modules/staff_gauge_panel.js';

/**
 * Minimal hermetic DOM shim sufficient to exercise createMoorCard(),
 * delegated click handlers, and loadFrame() without jsdom ([RULE-TEST-02]).
 */
function createMiniDom() {
  class MiniElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map();
      this.dataset = {};
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this._className = '';
      this._textContent = '';
      this._innerHTML = '';
      this.id = '';
      this.type = '';
      this.src = '';
      this.alt = '';
      this.loading = '';
      this.classList = {
        add: (...cls) => {
          const set = new Set(this._className.split(/\s+/).filter(Boolean));
          cls.forEach(c => set.add(c));
          this._className = [...set].join(' ');
        },
        remove: (...cls) => {
          const set = new Set(this._className.split(/\s+/).filter(Boolean));
          cls.forEach(c => set.delete(c));
          this._className = [...set].join(' ');
        },
        contains: (c) => this._className.split(/\s+/).filter(Boolean).includes(c)
      };
    }

    get className() {
      return this._className;
    }
    set className(val) {
      this._className = String(val || '');
    }

    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).join('');
      }
      return this._textContent;
    }
    set textContent(val) {
      this.children = [];
      this._textContent = String(val ?? '');
    }

    get innerHTML() {
      return this._innerHTML;
    }
    set innerHTML(val) {
      this._innerHTML = String(val ?? '');
      this.children = [];
      if (this._innerHTML) {
        parseSlotsFromHtml(this._innerHTML, this);
      }
    }

    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'class') this._className = String(v);
      if (k === 'id') this.id = String(v);
    }
    getAttribute(k) {
      if (k === 'class') return this._className;
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }

    appendChild(child) {
      if (child.parentNode && child.parentNode !== this) {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    replaceChildren(...nodes) {
      this.children.forEach(c => { c.parentNode = null; });
      this.children = [];
      this._textContent = '';
      nodes.forEach(n => this.appendChild(n));
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(event) {
      event.target = event.target || this;
      let cur = this;
      while (cur) {
        const list = cur.listeners.get(event.type) || [];
        for (const fn of list) fn(event);
        cur = cur.parentNode;
      }
    }

    matches(selector) {
      const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/g) || [];
      for (const cm of classMatch) {
        const cls = cm.slice(1);
        if (!this.classList.contains(cls)) return false;
      }
      const tagMatch = selector.match(/^([a-zA-Z0-9]+)/);
      if (tagMatch && this.tagName !== tagMatch[1].toUpperCase()) return false;
      const attrMatch = [...selector.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)];
      for (const [, k, v] of attrMatch) {
        const actual = this.getAttribute(k);
        if (actual === null) return false;
        if (v !== undefined && actual !== v) return false;
      }
      return true;
    }

    closest(selector) {
      let cur = this;
      while (cur) {
        if (cur.matches(selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }

    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (child.matches(selector)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  // Hydrate .staff-gauge-slot and its button from card.innerHTML for DOM tests
  function parseSlotsFromHtml(html, parent) {
    const slotRe = /<div class="staff-gauge-slot" data-camera-id="([^"]*)" data-station-id="([^"]*)">([\s\S]*?)<\/div>/g;
    let match;
    while ((match = slotRe.exec(html)) !== null) {
      const [, cameraId, stationId, inner] = match;
      const slot = new MiniElement('div');
      slot.className = 'staff-gauge-slot';
      slot.setAttribute('data-camera-id', cameraId);
      slot.setAttribute('data-station-id', stationId);

      const btnRe = /<button[^>]*class="([^"]*)"[^>]*data-staff-gauge-camera="([^"]*)"[^>]*data-staff-gauge-station="([^"]*)"[^>]*aria-expanded="([^"]*)"[^>]*>/;
      const bm = inner.match(btnRe);
      if (bm) {
        const btn = new MiniElement('button');
        btn.className = bm[1];
        btn.setAttribute('data-staff-gauge-camera', bm[2]);
        btn.setAttribute('data-staff-gauge-station', bm[3]);
        btn.setAttribute('aria-expanded', bm[4]);
        slot.appendChild(btn);
      }
      parent.appendChild(slot);
    }
  }

  return {
    createElement: (tag) => new MiniElement(tag)
  };
}

function makeCardOpts(cardId, gauges) {
  return {
    title: 'Test Card',
    cardId,
    riverTag: 'Catchment',
    eval: { badgeClass: 'badge-secure', symbol: '✓', label: 'SECURE' },
    sparkline: '<svg></svg>',
    narrative: 'Test narrative',
    pills: [],
    gauges
  };
}

test('Issue #54 Dashboard: mapped non-low-confidence gauge rows get button; unmapped & low-confidence do not', () => {
  const sowyGauges = [
    { name: "Monk's Leaze River Level", id: '52233', value: '6.90m AOD', history: [6.9], color: '#4ade80', link: 'https://example.com/52233' },
    { name: "Monk's Leaze Downstream Sowy", id: '52234', value: '6.72m AOD', history: [6.72], color: '#38bdf8', link: 'https://example.com/52234' },
    { name: 'Beer Wall Upstream (Greylake)', id: '52157', value: '5.10m AOD', history: [5.1], color: '#38bdf8', link: 'https://example.com/52157' }
  ];

  const row52233 = renderSubStationGaugeRow(sowyGauges[0]);
  const row52234 = renderSubStationGaugeRow(sowyGauges[1]);
  const row52157 = renderSubStationGaugeRow(sowyGauges[2]);

  assert.doesNotMatch(row52233, /staff-gauge-load/, 'Unmapped 52233 must not get a camera button');
  assert.match(row52234, /staff-gauge-load/, 'Mapped high-confidence 52234 must get a camera button');
  assert.match(row52234, /data-staff-gauge-camera="monks_leaze_clyse"/);
  assert.match(row52234, /Camera view of the metric board/);
  assert.match(row52157, /staff-gauge-load/, 'Mapped medium-confidence 52157 must get a camera button');
  assert.match(row52157, /data-staff-gauge-camera="beer_wall_sluice_gb"/);

  // Low-confidence 52159 (Westonzoyland) and unmapped 52118 / 52127 / 52158 / 52163 / E9094 must not get a button
  for (const excludedId of ['52159', '52118', '52127', '52158', '52163', 'E9094']) {
    const html = renderSubStationGaugeRow({
      name: `Station ${excludedId}`,
      id: excludedId,
      value: '4.00m AOD',
      history: [4.0],
      color: '#38bdf8',
      link: `https://example.com/${excludedId}`
    });
    assert.doesNotMatch(html, /staff-gauge-load/, `Station ${excludedId} must NOT get a camera button`);
  }

  // Langport card: 52120 and 52153 both get buttons
  for (const [id, camId] of [['52120', 'huish_episcopi_ps'], ['52153', 'midelney_ps']]) {
    const html = renderSubStationGaugeRow({
      name: `Station ${id}`,
      id,
      value: '6.50m AOD',
      history: [6.5],
      color: '#4ade80',
      link: `https://example.com/${id}`
    });
    assert.match(html, new RegExp(`data-staff-gauge-camera="${camId}"`));
  }
});

test('Issue #54 Dashboard: HTML escaping prevents injection in gauge rows', () => {
  const html = renderSubStationGaugeRow({
    name: '<script>alert(1)</script>',
    id: '52120',
    value: '6.50m AOD',
    history: [6.5],
    color: '#4ade80',
    link: 'https://example.com/"onmouseover="alert(1)',
    staleTag: '<img onerror=alert(1)>'
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img onerror/);
});

test('Issue #54 Dashboard: on-demand only (no auto-load), click loads frame via shared loadFrame, Monk\'s Leaze uses neutral wording, and 60s re-render preserves loaded frame', async () => {
  const origDoc = globalThis.document;
  const origFetch = globalThis.fetch;
  const dom = createMiniDom();
  globalThis.document = dom;
  resetDashboardStaffGaugeState();

  const fetchCalls = [];
  const capturedAt = new Date(Date.now() - 95 * 60 * 1000).toISOString(); // same frame on every call
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      json: async () => ({
        status: 'ok',
        camera_id: 'monks_leaze_clyse',
        station_id: '52234',
        captured_at: capturedAt,
        age_minutes: 95,
        image_url: '/api/staff-gauge-cameras/monks_leaze_clyse/latest.jpg'
      })
    };
  };

  try {
    assert.equal(typeof loadFrame, 'function', 'loadFrame must be exported from staff_gauge_panel.js');

    const container = dom.createElement('main');
    initDashboardStaffGaugeTriggers(container);

    const buildSowyCard = () => createMoorCard(makeCardOpts('card-52233', [
      { name: "Monk's Leaze River Level", id: '52233', value: '6.90m AOD', history: [6.9], color: '#4ade80', link: 'https://example.com/52233' },
      {
        name: "Monk's Leaze Downstream Sowy",
        id: '52234',
        value: '6.72m AOD',
        history: [6.72],
        color: '#38bdf8',
        link: 'https://example.com/52234',
        freshness: { isFlatlined: true, isStale: true, isOffline: false }
      },
      { name: 'Beer Wall Upstream (Greylake)', id: '52157', value: '5.10m AOD', history: [5.1], color: '#38bdf8', link: 'https://example.com/52157' }
    ]));

    container.appendChild(buildSowyCard());

    // Zero auto-load on initial render even though 52234 is static
    assert.equal(fetchCalls.length, 0, 'Dashboard must never auto-load camera frames');
    assert.equal(container.querySelectorAll('.staff-gauge-panel').length, 0);

    // Click button for 52234
    const btn52234 = container.querySelector('[data-staff-gauge-station="52234"]');
    assert.ok(btn52234, 'Button for 52234 must exist');
    btn52234.dispatchEvent({ type: 'click', target: btn52234 });

    // Wait a tick for async loadFrame fetch to resolve
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.deepEqual(fetchCalls, ['/api/staff-gauge-cameras/monks_leaze_clyse/latest']);
    const panel = container.querySelector('.staff-gauge-panel');
    assert.ok(panel, 'Panel must open after clicking button');
    assert.equal(btn52234.getAttribute('aria-expanded'), 'true');

    // Reuses getStaffGaugePanelCopy & neutral static wording & old-frame warning
    const panelText = panel.textContent;
    assert.ok(panelText.includes(getStaffGaugePanelCopy(STAFF_GAUGE_CAMERA_MAP.monks_leaze_clyse)));
    assert.match(panelText, /reading is static/i);
    assert.doesNotMatch(panelText, /flatline|fault|mAOD|cumec/i);
    assert.match(panelText, /more than an hour old/i);

    const img = panel.querySelector('img.staff-gauge-frame');
    assert.ok(img, 'Loaded frame image must be rendered');
    assert.match(img.src, /^\/api\/staff-gauge-cameras\/monks_leaze_clyse\/latest\.jpg\?t=/, 'frame URL carries a capture-time cache-buster');

    // Simulate 60s refresh: container.innerHTML = '' and re-render card
    container.innerHTML = '';
    container.appendChild(buildSowyCard());

    // Must re-attach the exact loaded panel & img without flicker, plus one silent re-check
    // so the "captured X ago" caption cannot go stale while the panel stays open.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fetchCalls.length, 2, '60s card rebuild re-checks an open panel once (silent)');
    const reattachedPanel = container.querySelector('.staff-gauge-panel');
    assert.equal(reattachedPanel, panel, 'Re-render must re-attach existing panel DOM node without flicker');
    assert.equal(reattachedPanel.querySelector('img.staff-gauge-frame'), img, 'Unchanged frame keeps the same <img> (no reload)');
    assert.doesNotMatch(reattachedPanel.textContent, /Loading latest camera frame/);
    assert.match(reattachedPanel.textContent, /Captured/);
    const reattachedBtn = container.querySelector('[data-staff-gauge-station="52234"]');
    assert.equal(reattachedBtn.getAttribute('aria-expanded'), 'true');

    // Clicking again collapses the panel
    reattachedBtn.dispatchEvent({ type: 'click', target: reattachedBtn });
    assert.equal(container.querySelector('.staff-gauge-panel'), null);
    assert.equal(reattachedBtn.getAttribute('aria-expanded'), 'false');
  } finally {
    resetDashboardStaffGaugeState();
    globalThis.document = origDoc;
    globalThis.fetch = origFetch;
  }
});

test('Issue #54 Dashboard CSS: .staff-gauge-load reuses palette and enforces >= 44px touch target', () => {
  const css = fs.readFileSync(path.resolve('src/css/styles.css'), 'utf8');
  const match = css.match(/\.staff-gauge-load\s*\{[^}]+\}/);
  assert.ok(match, '.staff-gauge-load CSS rule must exist');
  assert.match(match[0], /min-height:\s*44px/);
  assert.match(match[0], /min-width:\s*44px/);
});

test('Issue #54 loadFrame: silent refresh keeps the frame on transient errors, guards bad age, and ignores out-of-order responses', async () => {
  const origDoc = globalThis.document;
  const origFetch = globalThis.fetch;
  const dom = createMiniDom();
  globalThis.document = dom;
  const entry = STAFF_GAUGE_CAMERA_MAP.monks_leaze_clyse;
  const body = dom.createElement('div');
  const capturedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const okPayload = (extra = {}) => ({
    ok: true,
    json: async () => ({
      status: 'ok',
      captured_at: capturedAt,
      age_minutes: 5,
      image_url: '/api/staff-gauge-cameras/monks_leaze_clyse/latest.jpg',
      ...extra
    })
  });
  try {
    globalThis.fetch = async () => okPayload();
    await loadFrame(entry, body);
    const img = body.querySelector('img.staff-gauge-frame');
    assert.ok(img);
    assert.equal(img.src, `/api/staff-gauge-cameras/monks_leaze_clyse/latest.jpg?t=${encodeURIComponent(capturedAt)}`);

    // Transient network failure on a silent refresh: frame stays
    globalThis.fetch = async () => { throw new Error('network'); };
    await loadFrame(entry, body, { silent: true });
    assert.strictEqual(body.querySelector('img.staff-gauge-frame'), img, 'existing <img> preserved');

    // HTTP 503 on a silent refresh: frame stays
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await loadFrame(entry, body, { silent: true });
    assert.strictEqual(body.querySelector('img.staff-gauge-frame'), img);

    // Non-silent failure still reports the error
    await loadFrame(entry, body);
    assert.match(body.textContent, /No recent camera frame/);

    // Non-finite age_minutes must not render "NaN"
    globalThis.fetch = async () => okPayload({ age_minutes: null });
    await loadFrame(entry, body);
    assert.doesNotMatch(body.textContent, /NaN|null/);
    assert.match(body.textContent, /age of this frame is unknown/i);

    // Out-of-order: slow first response must not overwrite the newer one
    let releaseSlow;
    const slow = new Promise(r => { releaseSlow = r; });
    globalThis.fetch = async () => { await slow; return okPayload({ captured_at: '2020-01-01T00:00:00.000Z', age_minutes: 1 }); };
    const first = loadFrame(entry, body, { silent: true });
    globalThis.fetch = async () => okPayload();
    await loadFrame(entry, body, { silent: true });
    releaseSlow();
    await first;
    assert.equal(body.querySelector('img.staff-gauge-frame').dataset.capturedAt, capturedAt);
  } finally {
    globalThis.document = origDoc;
    globalThis.fetch = origFetch;
  }
});
