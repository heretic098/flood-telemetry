import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRoadNetwork, ASSET_DEFINITIONS } from '../src/js/hydro_engine.js';
import { renderRoadNetworkCard } from '../src/js/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Lightweight Mock DOM setup for Node.js environment
function setupMockDom() {
  class MockElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map();
      this.style = {};
      this.listeners = new Map();
      this._innerHTML = '';
      this.className = '';
      this.id = '';
    }

    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    }

    getAttribute(key) {
      return this.attributes.has(key) ? this.attributes.get(key) : null;
    }

    addEventListener(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    }

    dispatchEvent(event) {
      const fns = this.listeners.get(event) || [];
      fns.forEach(fn => fn.call(this, { type: event, target: this }));
    }

    click() {
      this.dispatchEvent('click');
    }

    get classList() {
      const self = this;
      return {
        add(cls) {
          const parts = self.className.split(/\s+/).filter(Boolean);
          if (!parts.includes(cls)) parts.push(cls);
          self.className = parts.join(' ');
        },
        remove(cls) {
          const parts = self.className.split(/\s+/).filter(c => c && c !== cls);
          self.className = parts.join(' ');
        },
        contains(cls) {
          return self.className.split(/\s+/).includes(cls);
        }
      };
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(html) {
      this._innerHTML = html;
      this._children = [];

      // Parse buttons
      const btnRegex = /<button\s+([^>]+)>([\s\S]*?)<\/button>/gi;
      let btnMatch;
      while ((btnMatch = btnRegex.exec(html)) !== null) {
        const btn = new MockElement('button');
        const attrStr = btnMatch[1];
        btn.innerHTML = btnMatch[2];

        // Parse attributes
        const attrRegex = /([a-z0-9_-]+)="([^"]*)"/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          if (attrMatch[1] === 'class') {
            btn.className = attrMatch[2];
          } else if (attrMatch[1] === 'id') {
            btn.id = attrMatch[2];
          } else {
            btn.setAttribute(attrMatch[1], attrMatch[2]);
          }
        }
        this._children.push(btn);
      }

      // Parse sections (.road-corridor-row)
      const secRegex = /<section\s+([^>]+)>([\s\S]*?)<\/section>/gi;
      let secMatch;
      while ((secMatch = secRegex.exec(html)) !== null) {
        const sec = new MockElement('section');
        const attrStr = secMatch[1];
        sec.innerHTML = secMatch[2];

        const attrRegex = /([a-z0-9_-]+)="([^"]*)"/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          if (attrMatch[1] === 'class') {
            sec.className = attrMatch[2];
          } else if (attrMatch[1] === 'id') {
            sec.id = attrMatch[2];
          } else {
            sec.setAttribute(attrMatch[1], attrMatch[2]);
          }
        }
        this._children.push(sec);
      }
    }

    querySelectorAll(selector) {
      if (!this._children) return [];
      if (selector === '.road-filter-btn') {
        return this._children.filter(c => c.tagName === 'BUTTON' && c.classList.contains('road-filter-btn'));
      }
      if (selector === '.road-corridor-row') {
        return this._children.filter(c => c.tagName === 'SECTION' && c.classList.contains('road-corridor-row'));
      }
      return [];
    }
  }

  const mockDoc = {
    createElement(tagName) {
      return new MockElement(tagName);
    }
  };

  const originalDoc = globalThis.document;
  globalThis.document = mockDoc;

  return {
    restore() {
      globalThis.document = originalDoc;
    }
  };
}

test('Community Roads Card: renderRoadNetworkCard creates compliant article scaffold and header', () => {
  const dom = setupMockDom();
  try {
    const card = renderRoadNetworkCard();
    assert.equal(card.tagName, 'ARTICLE');
    assert.ok(card.classList.contains('moor-card'));
    assert.ok(card.classList.contains('road-network-card'));
    assert.equal(card.id, 'card-road-network');
    assert.equal(card.getAttribute('tabindex'), '0');
    assert.equal(card.getAttribute('aria-label'), 'Community Roads & Access Highway Passability');

    const html = card.innerHTML;
    assert.ok(html.includes('Community Roads &amp; Access'));
    assert.ok(html.includes('Somerset Levels Highway Passability &amp; Council Emergency Gates'));
    assert.ok(html.includes('road-network-global-badge'));
  } finally {
    dom.restore();
  }
});

test('Community Roads Card: Life-safety warning banner includes mandatory text and official travel link', () => {
  const dom = setupMockDom();
  try {
    const card = renderRoadNetworkCard();
    const html = card.innerHTML;

    assert.ok(html.includes('road-safety-banner'));
    assert.ok(html.includes('Water stage estimates are theoretical inferences and do not detect physical council gate padlocks, localized silt, or ditch ponding.'));
    assert.ok(html.includes('Never attempt to drive through floodwater.'));
    assert.ok(html.includes('https://www.travelsomerset.co.uk'));
  } finally {
    dom.restore();
  }
});

test('Community Roads Card: Epistemic humility banner is prominent and informative', () => {
  const dom = setupMockDom();
  try {
    const card = renderRoadNetworkCard();
    const html = card.innerHTML;

    assert.ok(html.includes('road-humility-notice'));
    assert.ok(html.includes('How Passability is Evaluated:'));
    assert.ok(html.includes('Somerset Council emergency gate procedures'));
  } finally {
    dom.restore();
  }
});

test('Community Roads Card: Renders all 8 monitored Somerset Levels highway corridors', () => {
  const dom = setupMockDom();
  try {
    const card = renderRoadNetworkCard();
    const html = card.innerHTML;

    const expectedCorridorIds = [
      'cuts_road',
      'muchelney_access',
      'a361_burrowbridge',
      'new_road_curry',
      'bicknells_bridge_access',
      'moorland_new_cut_road',
      'stan_moor_road',
      'beer_wall_a372'
    ];

    for (const id of expectedCorridorIds) {
      assert.ok(html.includes(`data-asset-id="${id}"`), `Corridor ${id} must be present in HTML`);
      assert.ok(html.includes(`id="road-title-${id}"`), `Title anchor for ${id} must exist`);
    }

    const corridorRows = card.querySelectorAll('.road-corridor-row');
    assert.equal(corridorRows.length, 8, 'Must render exactly 8 corridor sections');
  } finally {
    dom.restore();
  }
});

test('Community Roads Card: Webcam links for Cuts Road and Muchelney point to authoritative anchors', () => {
  const dom = setupMockDom();
  try {
    const card = renderRoadNetworkCard();
    const html = card.innerHTML;

    // Cuts Road webcam -> https://thecfh.org/parretttonewsom.php#athelneyspillway
    assert.ok(
      html.includes('https://thecfh.org/parretttonewsom.php#athelneyspillway'),
      'Cuts Road must link to thecfh.org#athelneyspillway'
    );

    // Muchelney webcam -> https://thecfh.org/parretttonewsom.php#huish
    assert.ok(
      html.includes('https://thecfh.org/parretttonewsom.php#huish'),
      'Muchelney must link to thecfh.org#huish'
    );

    assert.ok(html.includes('road-cam-btn'), 'Webcam button must have road-cam-btn class');
  } finally {
    dom.restore();
  }
});

test('Community Roads Card: Quick filter toolbar updates aria-pressed and filters corridor rows', () => {
  const dom = setupMockDom();
  try {
    // Mock data with mixed statuses
    const mockEvaluations = {
      corridors_list: [
        {
          asset_type: 'road',
          asset_id: 'cuts_road',
          name: 'Cuts Road',
          status: 'IMPASSABLE',
          phase: 'SUBMERGED',
          stage_mAOD: 7.40,
          crown_elevation_mAOD: 7.35,
          badge_symbol: '🔴',
          badge_label: 'CLOSED & SUBMERGED',
          badge_class: 'badge-impassable'
        },
        {
          asset_type: 'road',
          asset_id: 'muchelney_access',
          name: 'Muchelney Spine Road',
          status: 'ENCROACHING',
          phase: 'CLEARING_INSPECTION_PENDING',
          stage_mAOD: 7.20,
          crown_elevation_mAOD: 7.86,
          badge_symbol: '🕒',
          badge_label: 'CLEARING / INSPECTING',
          badge_class: 'badge-clearing',
          submerged_end_time: '2026-11-01T12:00:00Z',
          dry_duration_hours: 3.5,
          daylight_dry_hours: 3.0,
          daylight_progress_percent: 50.0
        },
        {
          asset_type: 'road',
          asset_id: 'a361_burrowbridge',
          name: 'A361 Corridor',
          status: 'PASSABLE',
          phase: 'NOMINAL',
          stage_mAOD: 6.50,
          crown_elevation_mAOD: 7.80,
          badge_symbol: '🟢',
          badge_label: 'PASSABLE',
          badge_class: 'badge-passable'
        }
      ],
      counts: { all: 3, impassable: 1, encroaching: 1, passable: 1 },
      summary_badge: { status: 'IMPASSABLE', label: '1 CLOSED', class: 'badge-impassable', symbol: '🔴' }
    };

    const card = renderRoadNetworkCard(mockEvaluations);

    const filterBtns = card.querySelectorAll('.road-filter-btn');
    const rows = card.querySelectorAll('.road-corridor-row');

    assert.equal(filterBtns.length, 4, 'Must have 4 filter buttons (All, Closed, Caution/Clearing, Passable)');
    assert.equal(rows.length, 3);

    const allBtn = filterBtns.find(b => b.getAttribute('data-filter') === 'all');
    const closedBtn = filterBtns.find(b => b.getAttribute('data-filter') === 'impassable');
    const cautionBtn = filterBtns.find(b => b.getAttribute('data-filter') === 'encroaching');
    const passableBtn = filterBtns.find(b => b.getAttribute('data-filter') === 'passable');

    assert.equal(allBtn.getAttribute('aria-pressed'), 'true');
    assert.ok(allBtn.classList.contains('active'));
    assert.equal(closedBtn.getAttribute('aria-pressed'), 'false');

    // Click 'Closed'
    closedBtn.click();
    assert.equal(closedBtn.getAttribute('aria-pressed'), 'true');
    assert.ok(closedBtn.classList.contains('active'));
    assert.equal(allBtn.getAttribute('aria-pressed'), 'false');
    assert.ok(!allBtn.classList.contains('active'));

    // Verify row filtering
    const cutsRow = rows.find(r => r.getAttribute('data-asset-id') === 'cuts_road');
    const muchelneyRow = rows.find(r => r.getAttribute('data-asset-id') === 'muchelney_access');
    const a361Row = rows.find(r => r.getAttribute('data-asset-id') === 'a361_burrowbridge');

    assert.equal(cutsRow.style.display, '');
    assert.equal(muchelneyRow.style.display, 'none');
    assert.equal(a361Row.style.display, 'none');

    // Click 'Caution / Clearing'
    cautionBtn.click();
    assert.equal(cutsRow.style.display, 'none');
    assert.equal(muchelneyRow.style.display, '');
    assert.equal(a361Row.style.display, 'none');

    // Click 'Passable'
    passableBtn.click();
    assert.equal(cutsRow.style.display, 'none');
    assert.equal(muchelneyRow.style.display, 'none');
    assert.equal(a361Row.style.display, '');

    // Click 'All'
    allBtn.click();
    assert.equal(cutsRow.style.display, '');
    assert.equal(muchelneyRow.style.display, '');
    assert.equal(a361Row.style.display, '');
  } finally {
    dom.restore();
  }
});

test('Community Roads Card: CLEARING_INSPECTION_PENDING displays elapsed dry timer and daylight progress bar', () => {
  const dom = setupMockDom();
  try {
    const mockEvaluations = {
      corridors_list: [
        {
          asset_type: 'road',
          asset_id: 'cuts_road',
          name: 'Cuts Road (East Lyng ↔ Athelney)',
          status: 'ENCROACHING',
          phase: 'CLEARING_INSPECTION_PENDING',
          stage_mAOD: 7.28,
          crown_elevation_mAOD: 7.35,
          badge_symbol: '🕒',
          badge_label: 'CLEARING / INSPECTING',
          badge_class: 'badge-clearing',
          submerged_end_time: '2026-11-01T14:15:00Z',
          dry_duration_hours: 4.5,
          daylight_dry_hours: 3.0,
          daylight_progress_percent: 50.0,
          narrative: 'Floodwaters receded below road crown at 14:15.'
        }
      ],
      counts: { all: 1, impassable: 0, encroaching: 1, passable: 0 },
      summary_badge: { status: 'ENCROACHING', label: '1 CAUTION / CLEARING', class: 'badge-encroaching', symbol: '🟡' }
    };

    const card = renderRoadNetworkCard(mockEvaluations);
    const html = card.innerHTML;

    assert.ok(html.includes('corridor-lifecycle-box lifecycle-clearing'), 'Must render clearing lifecycle box');
    assert.ok(html.includes('Council Gate Safety Inspection Pending'), 'Must display inspection pending header');
    assert.ok(html.includes('Dry for 4.5h'), 'Must display dry duration');
    assert.ok(html.includes('3.0 / 6.0 daylight hrs'), 'Must display daylight hours count');
    assert.ok(html.includes('role="progressbar"'), 'Must have progressbar role');
    assert.ok(html.includes('aria-valuenow="50"'), 'Must set aria-valuenow to 50');
    assert.ok(html.includes('style="width: 50.0%;"'), 'Fill bar must reflect progress');
  } finally {
    dom.restore();
  }
});

test('Global Footers: index.html and topology.html contain legal insulation and OGL v3.0 notice', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/index.html'), 'utf8');
  const topologyHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/topology.html'), 'utf8');

  for (const [name, content] of [['index.html', indexHtml], ['topology.html', topologyHtml]]) {
    assert.ok(content.includes('Public Safety &amp; Non-Reliance Notice'), `${name} footer must include Public Safety notice`);
    assert.ok(content.includes('does not constitute official flood warnings, emergency evacuation orders, or road navigation advice'), `${name} must include non-reliance clause`);
    assert.ok(content.includes('Never drive into floodwater'), `${name} must warn against driving into floodwater`);
    assert.ok(content.includes('Open Government Licence v3.0'), `${name} must attribute OGL v3.0`);
    assert.ok(content.includes('Crown copyright and database right 2026'), `${name} must include Crown copyright`);
    assert.ok(content.includes('Apache 2.0 License'), `${name} must reference Apache 2.0 License`);
    assert.ok(content.includes('https://thecfh.org'), `${name} must acknowledge thecfh.org`);
  }
});

test('Methodology: Section 6 and Section 7 contain authoritative passability and licensing provenance', () => {
  const methodologyHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/methodology.html'), 'utf8');

  assert.ok(methodologyHtml.includes('id="community-roads-methodology"'), 'Section 6 must exist with id="community-roads-methodology"');
  assert.ok(methodologyHtml.includes('6. Community Roads &amp; Highways Passability Methodology'), 'Section 6 heading must be present');
  assert.ok(methodologyHtml.includes('id="open-source-licensing"'), 'Section 7 must exist with id="open-source-licensing"');
  assert.ok(methodologyHtml.includes('7. Public Safety, Highways &amp; Open Source Licensing'), 'Section 7 heading must be present');
  assert.ok(methodologyHtml.includes('Apache License<br>Version 2.0, January 2004') || methodologyHtml.includes('Apache License\nVersion 2.0, January 2004') || methodologyHtml.includes('Apache License'), 'Verbatim Apache 2.0 text must be present');
});
