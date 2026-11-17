import { EA_FLOOD_AREA_CATALOG } from '../hydro_engine.js';
import { escapeHTML, escapeAttr } from './dom_utils.js';

/**
 * Declarative mapping of Main Dashboard card DOM IDs to official Environment Agency
 * Target Area notations in EA_FLOOD_AREA_CATALOG [RULE-SSOT-01, Issue #55].
 */
export const DASHBOARD_CARD_EA_AREAS = Object.freeze({
  'card-52118': Object.freeze({
    title: 'Curry Moor System',
    targetAreas: Object.freeze(['112FWFCUR10A', '112WAFTPM'])
  }),
  'card-52127': Object.freeze({
    title: 'Athelney Spillway (Inter-Moor Relief)',
    targetAreas: Object.freeze(['112FWFEAS10A', '112FWFSTA10A', '112WAFTPM'])
  }),
  'card-52158': Object.freeze({
    title: 'Northmoor & Saltmoor',
    targetAreas: Object.freeze(['112FWFSAL10A', '112WAFTPM'])
  }),
  'card-52233': Object.freeze({
    title: 'Sowy Relief Channel',
    targetAreas: Object.freeze(['112WAFTESR'])
  }),
  'card-52163': Object.freeze({
    title: 'Dunball Sea Outfall',
    targetAreas: Object.freeze(['112WAFBCR'])
  }),
  'card-52120': Object.freeze({
    title: 'Langport Confluence & Tributaries',
    targetAreas: Object.freeze(['112FWFMTM10A', '112WAFYPM', '112WAFYPY'])
  })
});

let lastTriggerElement = null;
let dialogInitialized = false;
let activeFetchController = null;
let openRequestSeq = 0;

/**
 * Formats an ISO-8601 timestamp explicitly in Europe/London timezone.
 *
 * @param {string|null|undefined} isoStr
 * @returns {string}
 */
export function formatEAWarningTimestamp(isoStr) {
  if (!isoStr) return 'Not specified';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return 'Not specified';
  try {
    return `${d.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })} (Europe/London)`;
  } catch {
    return d.toISOString();
  }
}

/**
 * Returns triple-encoded presentation metadata for an EA severity_level (1, 2, or 3).
 *
 * @param {number} severityLevel
 * @returns {{ icon: string, label: string, tierClass: string }}
 */
export function getSeverityPresentation(severityLevel) {
  const level = Number(severityLevel);
  if (level === 1) {
    return { icon: '🚨', label: 'SEVERE FLOOD WARNING', tierClass: 'ea-tier-critical' };
  }
  if (level === 2) {
    return { icon: '🚨', label: 'FLOOD WARNING', tierClass: 'ea-tier-critical' };
  }
  return { icon: '⚠️', label: 'FLOOD ALERT', tierClass: 'ea-tier-alert' };
}

/**
 * Returns active EA warnings matching a dashboard card, sorted most-severe first.
 *
 * @param {string} cardId
 * @param {Array<object>} activeWarnings
 * @returns {Array<object>}
 */
export function getActiveWarningsForCard(cardId, activeWarnings = []) {
  if (!cardId || !Array.isArray(activeWarnings) || activeWarnings.length === 0) return [];
  const mapping = DASHBOARD_CARD_EA_AREAS[cardId];
  if (!mapping) return [];
  const allowed = new Set(mapping.targetAreas);
  return activeWarnings
    .filter(w => w && w.target_area_notation && allowed.has(w.target_area_notation))
    .slice()
    .sort((a, b) => (Number(a.severity_level) || 3) - (Number(b.severity_level) || 3));
}

/**
 * Returns dashboard card entries associated with a given EA target_area_notation.
 *
 * @param {string} notation
 * @returns {Array<{ cardId: string, title: string }>}
 */
export function getDashboardCardsForTargetArea(notation) {
  if (!notation) return [];
  const matches = [];
  for (const [cardId, info] of Object.entries(DASHBOARD_CARD_EA_AREAS)) {
    if (info.targetAreas.includes(notation)) {
      matches.push({ cardId, title: info.title });
    }
  }
  return matches;
}

/**
 * Builds the dedicated full-width per-card EA warning strip HTML rendered below .card-header.
 * Returns empty string when no active warning/alert matches the card [UI-COL-03].
 *
 * @param {string} cardId
 * @param {Array<object>} activeWarnings
 * @returns {string}
 */
export function buildCardEAWarningStripHtml(cardId, activeWarnings = []) {
  const matched = getActiveWarningsForCard(cardId, activeWarnings);
  if (matched.length === 0) return '';

  const lead = matched[0];
  const pres = getSeverityPresentation(lead.severity_level);
  const catalogEntry = EA_FLOOD_AREA_CATALOG[lead.target_area_notation];
  const areaLabel = lead.area_name || catalogEntry?.name || lead.target_area_notation;
  const extraCount = matched.length > 1 ? ` (+${matched.length - 1} more)` : '';
  const btnTierClass = pres.tierClass === 'ea-tier-critical' ? 'ea-btn-critical' : 'ea-btn-alert';

  return `
    <button type="button"
            class="card-ea-warning-btn ${btnTierClass}"
            data-ea-warning-area="${escapeAttr(lead.target_area_notation)}"
            data-ea-warning-card="${escapeAttr(cardId)}"
            aria-haspopup="dialog"
            aria-controls="ea-warnings-dialog">
      <span class="card-ea-warning-main">
        <span aria-hidden="true">${pres.icon}</span>
        <span><strong>EA ${escapeHTML(pres.label)}:</strong> ${escapeHTML(areaLabel)}${escapeHTML(extraCount)}</span>
      </span>
      <span class="card-ea-warning-cta">View Briefing ↗</span>
    </button>
  `;
}

/**
 * Updates the Main Dashboard header Official EA Flood Warnings banner [UI-COL-03, UI-ACC-01].
 *
 * @param {object|null|undefined} eaWarningsSummary
 */
export function updateEAWarningSummaryBanner(eaWarningsSummary) {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('ea-warning-summary-banner');
  const textEl = document.getElementById('ea-warning-banner-text');
  const actionEl = document.getElementById('ea-warning-banner-action');
  if (!banner || !textEl || !actionEl) return;

  const activeCount = Math.max(0, Number(eaWarningsSummary?.active_count) || 0);
  const hasSevere = Boolean(eaWarningsSummary?.has_severe_warning);
  const hasWarning = Boolean(eaWarningsSummary?.has_flood_warning);
  const hasAlert = Boolean(eaWarningsSummary?.has_flood_alert);

  if (activeCount <= 0) {
    banner.className = 'ea-warning-banner banner-calm';
    textEl.innerHTML = '🏛️ <strong>Official EA Flood Warnings:</strong> None Active in Somerset Catchment';
    actionEl.textContent = 'View Official Briefing';
    return;
  }

  const areaWord = activeCount === 1 ? 'Area' : 'Areas';
  if (hasSevere || hasWarning) {
    banner.className = 'ea-warning-banner banner-critical';
    const titleText = hasSevere ? 'Official EA SEVERE Flood Warning in Force' : 'Official EA Flood Warning in Force';
    textEl.innerHTML = `🚨 <strong>${escapeHTML(titleText)}</strong> (${activeCount} ${areaWord})`;
    actionEl.textContent = 'View Official EA Briefing';
    return;
  }

  if (hasAlert) {
    banner.className = 'ea-warning-banner banner-alert';
    textEl.innerHTML = `⚠️ <strong>Official EA Flood Alert Active</strong> (${activeCount} ${areaWord})`;
    actionEl.textContent = 'View Official EA Briefing';
    return;
  }

  banner.className = 'ea-warning-banner banner-calm';
  textEl.innerHTML = '🏛️ <strong>Official EA Flood Warnings:</strong> None Active in Somerset Catchment';
  actionEl.textContent = 'View Official Briefing';
}

function closeEAWarningsDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  } else {
    dialog.classList.remove('open');
  }
}

function renderEAWarningsBody(bodyEl, warnings = [], filterArea = null) {
  if (!bodyEl) return;

  if (!Array.isArray(warnings) || warnings.length === 0) {
    bodyEl.innerHTML = `
      <div class="ea-warnings-empty">
        <p><strong>🏛️ No Active Environment Agency Flood Warnings or Alerts</strong></p>
        <p>There are currently 0 active official Flood Alerts, Flood Warnings, or Severe Flood Warnings for the monitored Somerset Levels &amp; Moors target areas.</p>
        <div class="ea-warning-links-row">
          <a href="https://check-for-flooding.service.gov.uk/alerts-and-warnings" target="_blank" rel="noopener noreferrer" class="ea-deeplink-chip">🌊 Check GOV.UK Flood Service ↗</a>
        </div>
      </div>
    `;
    return;
  }

  const sorted = warnings.slice().sort((a, b) => {
    const aMatch = filterArea && a.target_area_notation === filterArea ? 0 : 1;
    const bMatch = filterArea && b.target_area_notation === filterArea ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return (Number(a.severity_level) || 3) - (Number(b.severity_level) || 3);
  });

  bodyEl.innerHTML = sorted.map((w) => {
    const pres = getSeverityPresentation(w.severity_level);
    const notation = w.target_area_notation || '';
    const isFocused = Boolean(filterArea && notation === filterArea);
    const areaTitle = w.description || w.area_name || notation || 'Somerset Target Area';
    const cards = getDashboardCardsForTargetArea(notation);
    const roads = Array.isArray(w.correlated_roads) ? w.correlated_roads : [];

    const cardChipsHtml = cards.map(c => `
      <button type="button"
              class="ea-deeplink-chip ea-card-jump-btn"
              data-jump-card-id="${escapeAttr(c.cardId)}">
        📊 ${escapeHTML(c.title)}
      </button>
    `).join('');

    const roadChipsHtml = roads.filter(r => r && r.asset_id).map(r => `
      <a href="roads.html#${escapeAttr(r.asset_id)}" class="ea-deeplink-chip">
        🚗 ${escapeHTML(r.name)} (${escapeHTML(r.current_status || 'MONITORED')}) ↗
      </a>
    `).join('');

    return `
      <article class="ea-warning-item ${pres.tierClass}${isFocused ? ' ea-warning-focused' : ''}">
        <div class="ea-warning-item-header">
          <span class="ea-severity-pill ${pres.tierClass}">
            <span aria-hidden="true">${pres.icon}</span>
            <span>${escapeHTML(pres.label)}</span>
          </span>
          <code class="ea-area-code">${escapeHTML(notation)}</code>
        </div>
        <h4 class="ea-warning-area-title">${escapeHTML(areaTitle)}</h4>
        <dl class="ea-warning-meta">
          <div>
            <dt>Raised</dt>
            <dd>${escapeHTML(formatEAWarningTimestamp(w.time_raised))}</dd>
          </div>
          <div>
            <dt>Message Updated</dt>
            <dd>${escapeHTML(formatEAWarningTimestamp(w.time_message_changed))}</dd>
          </div>
        </dl>
        <div class="ea-warning-verbatim-wrap">
          <span class="ea-verbatim-label">Verbatim EA Briefing Message</span>
          <p class="ea-warning-verbatim">${escapeHTML(w.message || 'No additional briefing text issued by the Environment Agency.')}</p>
        </div>
        ${(cardChipsHtml || roadChipsHtml) ? `
          <div class="ea-warning-links-row" aria-label="Affected Catchment Cards and Road Corridors">
            ${cardChipsHtml}
            ${roadChipsHtml}
          </div>
        ` : ''}
      </article>
    `;
  }).join('');
}

/**
 * Opens the Official EA Flood Warnings Briefing <dialog> and loads active warnings.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.filterArea]
 * @param {HTMLElement|null} [opts.triggerEl]
 * @param {Array<object>|null} [opts.preloadedWarnings]
 */
export async function openEAWarningsDialog(opts = {}) {
  if (typeof document === 'undefined') return;
  const dialog = document.getElementById('ea-warnings-dialog');
  const bodyEl = document.getElementById('ea-warnings-modal-body');
  if (!dialog || !bodyEl) return;

  lastTriggerElement = opts.triggerEl || document.activeElement || null;
  const requestSeq = ++openRequestSeq;
  if (activeFetchController) {
    activeFetchController.abort();
    activeFetchController = null;
  }

  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.classList.add('open');
  }

  if (Array.isArray(opts.preloadedWarnings)) {
    renderEAWarningsBody(bodyEl, opts.preloadedWarnings, opts.filterArea || null);
    return;
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  activeFetchController = controller;
  bodyEl.innerHTML = '<p class="ea-warnings-loading">Loading official Environment Agency warnings...</p>';
  try {
    const fetchOpts = controller ? { signal: controller.signal } : undefined;
    const res = await fetch('/api/warnings?status=ACTIVE', fetchOpts);
    if (requestSeq !== openRequestSeq) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (requestSeq !== openRequestSeq) return;
    renderEAWarningsBody(bodyEl, payload?.warnings || [], opts.filterArea || null);
  } catch (err) {
    if (err?.name === 'AbortError' || requestSeq !== openRequestSeq) return;
    bodyEl.innerHTML = `<p class="ea-warnings-error" role="alert">Unable to load official EA briefing right now (${escapeHTML(err?.message || 'network error')}).</p>`;
  } finally {
    if (activeFetchController === controller) {
      activeFetchController = null;
    }
  }
}

export function resetEAWarningsDialogForTests() {
  dialogInitialized = false;
  lastTriggerElement = null;
  if (activeFetchController) {
    activeFetchController.abort();
    activeFetchController = null;
  }
}

/**
 * Wires click, close, backdrop, and deep-link card navigation listeners for #ea-warnings-dialog.
 *
 * @param {HTMLElement|null} [cardsContainer]
 */
export function initEAWarningsDialog(cardsContainer = null) {
  if (typeof document === 'undefined' || dialogInitialized) return;
  dialogInitialized = true;

  const dialog = document.getElementById('ea-warnings-dialog');
  const closeBtn = document.getElementById('ea-warnings-close');
  const bannerBtn = document.getElementById('ea-warning-banner-btn');

  if (bannerBtn) {
    bannerBtn.addEventListener('click', () => {
      openEAWarningsDialog({ triggerEl: bannerBtn });
    });
  }

  if (closeBtn && dialog) {
    closeBtn.addEventListener('click', () => closeEAWarningsDialog(dialog));
  }

  if (dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeEAWarningsDialog(dialog);
        return;
      }
      const jumpBtn = e.target.closest('.ea-card-jump-btn');
      if (jumpBtn) {
        const cardId = jumpBtn.getAttribute('data-jump-card-id');
        // Clear trigger restoration before close() so native async 'close' event
        // does not steal focus back from the target catchment card.
        lastTriggerElement = null;
        closeEAWarningsDialog(dialog);
        if (cardId) {
          const cardEl = document.getElementById(cardId);
          if (cardEl) {
            if (typeof cardEl.scrollIntoView === 'function') {
              cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (typeof cardEl.focus === 'function') {
              cardEl.focus({ preventScroll: true });
            }
          }
        }
      }
    });

    dialog.addEventListener('close', () => {
      if (lastTriggerElement && typeof lastTriggerElement.focus === 'function') {
        lastTriggerElement.focus();
      }
    });
  }

  const targetContainer = cardsContainer || document.getElementById('cards-container');
  if (targetContainer) {
    targetContainer.addEventListener('click', (e) => {
      const stripBtn = e.target.closest('.card-ea-warning-btn');
      if (!stripBtn) return;
      const area = stripBtn.getAttribute('data-ea-warning-area');
      openEAWarningsDialog({ filterArea: area, triggerEl: stripBtn });
    });
  }
}
