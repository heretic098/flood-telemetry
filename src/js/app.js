import { evaluateSpillway, evaluateGateState, aggregateGlobalStatus, evaluatePumpStatus, evaluateSowyChannel, evaluateAthelneySpillway, evaluateGravityClyse, evaluateBeerWall, evaluateOathLock, evaluateDunballEmergencyPumping, getSeasonalRegime, getActiveCrestHeight, getActiveCatchmentId, loadCatchmentConfig, evaluateHuishEpiscopi, evaluateMidelney, STATION_REGISTRY, RAINGAUGE_REGISTRY, GAUGE_DATUMS, HYDRO_THRESHOLDS, formatClearanceText, computeTrendVector, computeStageRates, disambiguateRiverTrend, evaluateRoadNetwork, evaluateStationFreshness, getValidStageOrFallback, CANONICAL_PUMP_THRESHOLDS, classifyRainfallIntensity } from './hydro_engine.js';
import { initJargonPopovers, renderJargonTerm } from './jargon_popover.js';
import { setCameraEventsCatalog, openVisualEvidence, initCameraGuideTriggers } from './camera_guide.js';
import { createRefreshController } from './modules/refresh_controller.js';
import { setupOfflineBanner as setupResilienceBanner } from './modules/network_resilience.js';
import {
  escapeAttr,
  escapeHTML,
  formatSpanUnit,
  formatHeadDelta,
  applyFreshnessPill
} from './modules/dom_utils.js';
export { escapeAttr, escapeHTML, formatSpanUnit, formatHeadDelta };
import { renderCorridorRow } from './roads.js';
import { renderMicroSparkline, renderSingleSparkline as renderSingleSparklineCore, renderDualSparkline as renderDualSparklineCore, bindSparklineEvents as bindSparklineEventsCore } from './sparkline.js';
import { getStaffGaugeCameraForStation } from './staff_gauge_cameras.js';
import { loadFrame, getStaffGaugePanelCopy, getStaffGaugePanelMode } from './modules/staff_gauge_panel.js';
import { updateEAWarningSummaryBanner, buildCardEAWarningStripHtml, initEAWarningsDialog } from './modules/ea_warnings_panel.js';

export function renderHeroSpillwayBanner(opts) {
  const isAlert = opts.isAlert || opts.isOvertopping;
  const alertClass = isAlert ? ' hero-spillway-alert' : '';
  
  let pct = 0;
  if (typeof opts.currentLevel === 'number' && typeof opts.minLevel === 'number' && typeof opts.maxLevel === 'number' && opts.maxLevel > opts.minLevel) {
    pct = Math.max(0, Math.min(100, ((opts.currentLevel - opts.minLevel) / (opts.maxLevel - opts.minLevel)) * 100));
  }
  
  const fillClass = isAlert ? ' hero-stage-fill fill-alert' : ' hero-stage-fill';

  let badgeClass = opts.statusBadge?.badgeClass || '';
  let badgeSymbol = opts.statusBadge?.symbol || '';
  let badgeLabel = opts.statusBadge?.label || '';

  if (opts.staleInfo && opts.staleInfo.isStale) {
    if (badgeClass === 'badge-secure' || badgeClass === 'badge-passable') {
      badgeClass = opts.staleInfo.badgeClass || 'badge-stale';
      badgeSymbol = opts.staleInfo.isOffline ? '⚠️' : '🕒';
    }
  }

  const badgeHtml = opts.statusBadge ? `
    <div class="status-badge ${badgeClass}" aria-live="polite">
      <span aria-hidden="true">${badgeSymbol}</span>
      <span class="sr-only">Status: </span>
      <span>${badgeLabel}</span>
    </div>
  ` : '';

  const staleBannerHtml = (opts.staleInfo && opts.staleInfo.isStale && opts.staleInfo.badgeText) ? `
    <div class="sensor-offline-banner" role="alert" aria-live="polite">
      <span>${escapeHTML(opts.staleInfo.badgeText)}</span>
    </div>
  ` : '';

  const trackHtml = (opts.minLevel !== undefined && opts.maxLevel !== undefined) ? `
    <div class="hero-stage-track-box">
      <div class="hero-stage-track-labels">
        <span>${escapeHTML(opts.minLabel || '')}</span>
        <span>${escapeHTML(opts.maxLabel || '')}</span>
      </div>
      <div class="hero-stage-track" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttr(opts.title || 'Stage')} Progress">
        <div class="${fillClass}" style="width: ${pct.toFixed(1)}%;"></div>
      </div>
    </div>
  ` : '';

  const statsHtml = Array.isArray(opts.stats) ? opts.stats.map(s => `
    <div class="hero-stat-item">
      <span class="hero-stat-label">${escapeHTML(s.label)}</span>
      <span class="hero-stat-val">${s.htmlValue || escapeHTML(s.value || '')}</span>
    </div>
  `).join('') : '';

  const camBtnHtml = opts.camLink ? `
    <a href="${escapeAttr(opts.camLink.url)}" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn hero-cam-btn" title="${escapeAttr(opts.camLink.title || 'View Camera')}" aria-label="${escapeAttr(opts.camLink.ariaLabel || 'View Camera')}">📷 LIVE CAM ↗</a>
  ` : '';

  return `
    <section class="hero-spillway-banner${alertClass}" aria-label="${escapeAttr(opts.title || 'Hero Banner')} Top Hero Banner">
      <div class="hero-banner-header">
        <div class="hero-banner-title-group">
          <span class="hero-asset-icon" aria-hidden="true">${opts.icon || '🌊'}</span>
          <h3 class="hero-asset-title">${escapeHTML(opts.title)}</h3>
        </div>
        ${badgeHtml}
      </div>
      ${staleBannerHtml}

      <div class="hero-banner-main-metric">
        <div>
          <span class="hero-metric-value">${escapeHTML(opts.mainMetricValue)}</span>
          <span class="hero-metric-unit">${opts.mainMetricUnitHtml || escapeHTML(opts.mainMetricUnit || '')}</span>
        </div>
        ${opts.clearanceText ? `<span class="hero-clearance-pill">${opts.clearanceText}</span>` : ''}
      </div>

      ${trackHtml}

      <div class="hero-banner-stats-row">
        ${statsHtml}
        ${camBtnHtml}
      </div>
    </section>
  `;
}


let hydroConfig = null;
let activeCatchmentId = 'somerset';
let latestRainfallData = null;

// Fetch live readings from the Environment Agency REST API
// Fetch 96 readings = 24 hours of 15-minute telemetry backfill
async function fetchEAReadings(measureId) {
  const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${measureId}/readings?_sorted&_limit=96`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      return data.items;
    }
  } catch (err) {
    console.warn(`Failed to fetch live readings for measure ${measureId}:`, err);
  }
  return null;
}

let currentActiveRange = '24h';

export async function setupCatchmentNav(currentCatchmentId) {
  const navContainer = document.querySelector('.nav-links');
  if (!navContainer) return;

  const pathname = window.location.pathname;
  const isDashboard = pathname.endsWith('index.html') || pathname === '/' || pathname.endsWith('/somerset') || pathname.endsWith('/somerset/');
  const isRoads = pathname.endsWith('roads.html');
  const isTopology = pathname.endsWith('topology.html');
  const isRainfall = pathname.endsWith('rainfall.html');
  const isMethodology = pathname.endsWith('methodology.html');

  // If server-side partial injection already rendered nav links, safely update active state in place without re-creating DOM
  const existingLinks = navContainer.querySelectorAll('a.nav-btn');
  if (existingLinks.length > 0) {
    existingLinks.forEach(link => {
      const href = link.getAttribute('href');
      let isActive = false;
      if (href === 'index.html' && isDashboard) isActive = true;
      else if (href === 'roads.html' && isRoads) isActive = true;
      else if (href === 'topology.html' && isTopology) isActive = true;
      else if (href === 'rainfall.html' && isRainfall) isActive = true;
      else if (href === 'methodology.html' && isMethodology) isActive = true;

      if (isActive) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else if (!link.classList.contains('nav-btn-kofi')) {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });
  }
}

export { getValidStageOrFallback };

let isUserInspecting = false;
let isRefreshing = false;
let currentHoverRatio = null;

export const refreshController = createRefreshController({
  intervalMs: 60000,
  countdownPillId: 'countdown-pill',
  refreshBtnId: 'btn-refresh-now',
  onRefresh: async () => { await refreshLiveDashboard(); },
  isUserInspectingFn: () => isUserInspecting || currentHoverRatio !== null
});

export function updateCountdownDisplay() {
  refreshController.updateDisplay();
}

export function startAutoRefresh(intervalMs = 60000) {
  refreshController.start(intervalMs);
}

export function stopAutoRefresh() {
  refreshController.stop();
}

export async function triggerManualRefresh() {
  await refreshController.triggerManualRefresh();
}

export function getAutoRefreshState() {
  return refreshController.getState();
}

function setupManualRefreshListener() {
  // refresh_controller handles click binding automatically
}

export async function initApp() {
  initJargonPopovers();
  initCameraGuideTriggers();
  initDashboardStaffGaugeTriggers(document.getElementById('cards-container'));
  initEAWarningsDialog(document.getElementById('cards-container'));
  activeCatchmentId = getActiveCatchmentId();
  try {
    hydroConfig = await loadCatchmentConfig(activeCatchmentId);
  } catch (err) {
    console.warn(`Failed to load catchment config for ${activeCatchmentId}:`, err);
  }

  if (hydroConfig && hydroConfig.name) {
    const h1Elem = document.querySelector('h1');
    if (h1Elem) {
      h1Elem.innerText = `${hydroConfig.name} Flood Status`;
    }
    document.title = `${hydroConfig.name} Flood & Infrastructure Status`;
  }

  await setupCatchmentNav(activeCatchmentId);
  setupModalListeners();
  setupPeriodListeners();
  setupManualRefreshListener();
  setupOfflineBanner();
  await refreshLiveDashboard();
  startAutoRefresh(60000);
}

function setupModalListeners() {
  const toggleBtn = document.getElementById('sys-health-toggle');
  const closeBtn = document.getElementById('sys-health-close');
  const backdrop = document.getElementById('sys-health-backdrop');

  if (toggleBtn && backdrop) {
    toggleBtn.addEventListener('click', () => {
      backdrop.classList.add('open');
    });
  }

  if (closeBtn && backdrop) {
    closeBtn.addEventListener('click', () => {
      backdrop.classList.remove('open');
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('open');
      }
    });
  }
}

let lastSuccessfulSyncTime = null;

/**
 * Updates sticky network offline banner ("Network Disconnected" / "Connection Restored").
 * Wires window.addEventListener('offline', ...) and window.addEventListener('online', ...) via shared controller.
 */
export function setupOfflineBanner() {
  return setupResilienceBanner({
    bannerId: 'network-offline-banner',
    onOnline: async () => { await refreshLiveDashboard(); },
    getLastSyncTime: () => lastSuccessfulSyncTime,
    isScrubbingFn: () => isUserInspecting || currentHoverRatio !== null
  });
}

export function updateRoadStatusSummaryBanner(roadData) {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('road-status-summary-banner');
  if (!banner) return;

  const corridorsList = roadData?.corridors_list || [];
  const counts = roadData?.counts || {
    all: corridorsList.length,
    impassable: corridorsList.filter(c => c.status === 'IMPASSABLE').length,
    encroaching: corridorsList.filter(c => c.status === 'ENCROACHING').length,
    passable: corridorsList.filter(c => c.status === 'PASSABLE').length
  };

  const closedCorridors = corridorsList.filter(c => c.status === 'IMPASSABLE');
  const encroachingCorridors = corridorsList.filter(c => c.status === 'ENCROACHING');
  const affectedCount = closedCorridors.length + encroachingCorridors.length;

  if (affectedCount === 0) {
    banner.className = 'road-status-banner banner-passable';
    banner.innerHTML = `
      <a href="roads.html" class="road-banner-inner" id="road-banner-link">
        <span class="road-banner-text">🚗 <strong>Roads &amp; Access:</strong> All 8 Monitored Corridors Passable</span>
        <span class="road-banner-action">View Roads Status ↗</span>
      </a>
    `;
  } else {
    const leadCorridor = closedCorridors[0] || encroachingCorridors[0];
    const leadName = leadCorridor ? leadCorridor.name : 'Highway';
    const leadStatus = closedCorridors.length > 0 ? 'Impassable' : 'Encroaching';
    const warningClass = closedCorridors.length > 0 ? 'banner-critical' : 'banner-alert';
    banner.className = `road-status-banner ${warningClass}`;
    banner.innerHTML = `
      <a href="roads.html" class="road-banner-inner" id="road-banner-link">
        <span class="road-banner-text">⚠️ <strong>Road Warning:</strong> ${affectedCount} Corridor${affectedCount > 1 ? 's' : ''} Affected (${escapeHTML(leadName)} ${leadStatus})</span>
        <span class="road-banner-action">View Roads Dashboard ↗</span>
      </a>
    `;
  }
}

function setupPeriodListeners() {
  const buttons = document.querySelectorAll('.preset-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentActiveRange = btn.getAttribute('data-range') || '24h';
      if (typeof window !== 'undefined' && window.sessionStorage) {
        try {
          sessionStorage.setItem('somerset_time_range', currentActiveRange);
        } catch (e) {}
      }
      await refreshLiveDashboard();
    });
  });

  // Rehydrate saved preset from sessionStorage
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const savedRange = sessionStorage.getItem('somerset_time_range');
      if (savedRange && ['24h', '7d', '30d'].includes(savedRange)) {
        currentActiveRange = savedRange;
        buttons.forEach(b => {
          const isMatch = b.getAttribute('data-range') === currentActiveRange;
          b.classList.toggle('active', isMatch);
        });
      }
    } catch (e) {}
  }
}

async function fetchAllTelemetryFromDB(range = currentActiveRange) {
  try {
    const endpoint = range === '24h' ? '/api/status' : `/api/history?range=${range}`;
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.measures && Object.keys(data.measures).length > 0) {
      return data;
    }
  } catch (err) {
    console.warn(`Failed to fetch from local SQLite endpoint (${range}):`, err);
  }
  return null;
}

export async function fetchRecentEventsFromDB(limit = 15) {
  try {
    const res = await fetch(`/api/events?limit=${limit}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.events)) {
        return data.events;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch recent events from /api/events:', err);
  }
  return [];
}

const EVENT_ASSET_DISPLAY_NAMES = Object.freeze({
  dunball_outfall: 'Dunball Tidal Outfall (52163)',
  hookbridge: 'Hookbridge Spillway (52118)',
  curry_moor: 'Curry Moor Polder Basin (52127)',
  cuts_road: 'Cuts Road • East Lyng ↔ Athelney',
  baltmoor_wall: 'Baltmoor Wall Spillway (52158)',
  northmoor: 'Northmoor & Saltmoor Basin (52159)',
  beer_wall: 'Beer Wall Spillway & Sluices (52157)',
  monks_leaze_clyse: "Monk's Leaze Clyse Sluice (52233)",
  allermoor_spillway: 'Allermoor Spillway',
  muchelney_access: 'Muchelney Spine Road (Langport ↔ Muchelney)',
  a361_burrowbridge: 'A361 East Lyng ↔ Burrowbridge',
  new_road_curry: 'New Road (West Sedgemoor ↔ North Curry)',
  bicknells_bridge_access: "Bicknell's Bridge & Drayton Lane",
  moorland_new_cut_road: 'Moorland / Fordgate (Northmoor Road)',
  stan_moor_road: 'Stan Moor Road (Stoke St Gregory ↔ Burrowbridge)',
  beer_wall_a372: 'A372 Beer Wall Causeway (Othery ↔ Aller)',
  wet_moor: 'Wet Moor Polder Basin (Huish Episcopi • 52120)',
  west_sedgemoor: 'West Sedgemoor Polder Basin (SSSI • 52233)',
  stanmoor: 'Stanmoor Polder Basin (Curry Moor Flank • 52127)',
  westonzoyland: 'Westonzoyland Polder Basin (Engine Rhyne • 52159)'
});

const EVENT_STATE_SYMBOLS = Object.freeze({
  PASSABLE: '🟢',
  ENCROACHING: '🟡',
  IMPASSABLE: '🔴',
  SECURE: '🟢',
  NEAR_CREST: '🟡',
  OVERTOPPING: '🔴',
  STANDBY: '⚪',
  DUTY_PUMPING: '🟢',
  MOBILE_ORDERED: '🟡',
  MOBILE_ACTIVE: '🔴',
  CRITICAL: '🚨',
  DISCHARGING: '🔵',
  TIDE_LOCKED: '🕒',
  CLOSED: '⚪',
  DIVERTING: '🟢',
  THROTTLED: '🟡',
  REVERSE_LOCK: '🟠',
  NORMAL: '🟢',
  ALERT: '🔴'
});

/**
 * Renders the Recent Telemetry State Transitions & Visual Evidence Ledger [Issue #24 / RULE-ENT-01]
 * @param {Array<object>} events
 * @returns {HTMLElement}
 */
export function renderEventsTimeline(events = []) {
  const section = document.createElement('section');
  section.className = 'moor-card events-timeline-section';
  section.id = 'events-timeline-section';
  section.setAttribute('aria-label', 'Recent Telemetry State Transitions & Visual Evidence Ledger');

  const validEvents = Array.isArray(events) ? events.filter(ev => ev && typeof ev === 'object') : [];

  const rowsHtml = validEvents.length === 0 ? `
    <div class="events-timeline-empty">
      <span>📡 No active or recent state transition events recorded in the local ledger.</span>
    </div>
  ` : validEvents.slice(0, 12).map(ev => {
    const assetTypeUpper = String(ev.asset_type || 'asset').toUpperCase().replace(/_/g, ' ');
    const assetName = EVENT_ASSET_DISPLAY_NAMES[ev.asset_id] || ev.asset_id || 'Monitored Asset';
    const fromState = ev.from_state || 'NORMAL';
    const toState = ev.to_state || 'ALERT';
    const fromSym = EVENT_STATE_SYMBOLS[fromState] || '⚪';
    const toSym = EVENT_STATE_SYMBOLS[toState] || '🔴';
    const isActive = ev.status === 'ACTIVE' || !ev.end_time;

    const peakStageStr = typeof ev.peak_stage_mAOD === 'number' ? `${ev.peak_stage_mAOD.toFixed(2)}m AOD` : 'Verified';
    const startStr = ev.start_time ? new Date(ev.start_time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' GMT' : 'N/A';
    const durStr = ev.duration_formatted || '0h 0m';

    const ce = ev.camera_evidence || null;
    const seqCount = Array.isArray(ce?.sequence_frames) ? ce.sequence_frames.length : 0;
    const isNightOnly = Boolean(ce && ce.fallback_mode === 'NIGHT_TELEMETRY' && seqCount === 0);
    const hasOpticalFrames = Boolean(ce && !isNightOnly && (ce.image_url || seqCount > 0));

    let actionBtnHtml = `<span class="event-sensor-only-tag" title="No optical camera correlated to this transition">📡 Sensor-Only Record</span>`;
    if (hasOpticalFrames) {
      const countBadge = seqCount > 1 ? ` (${seqCount} frames)` : '';
      actionBtnHtml = `
        <button type="button"
                class="visual-evidence-btn visual-evidence-trigger"
                data-visual-evidence-event-id="${escapeAttr(String(ev.id))}"
                data-visual-evidence-asset="${escapeAttr(ev.asset_id)}"
                aria-label="Inspect optical visual evidence for ${escapeAttr(assetName)} (${escapeAttr(fromState)} to ${escapeAttr(toState)})">
          <span aria-hidden="true">📷</span> Visual Evidence${escapeHTML(countBadge)}
        </button>
      `;
    } else if (isNightOnly) {
      actionBtnHtml = `
        <button type="button"
                class="visual-evidence-btn visual-evidence-btn-night visual-evidence-trigger"
                data-visual-evidence-event-id="${escapeAttr(String(ev.id))}"
                data-visual-evidence-asset="${escapeAttr(ev.asset_id)}"
                aria-label="Inspect night telemetry verification for ${escapeAttr(assetName)} (${escapeAttr(fromState)} to ${escapeAttr(toState)})">
          <span aria-hidden="true">🌙</span> Night Telemetry
        </button>
      `;
    }

    return `
      <div class="event-timeline-row ${isActive ? 'event-row-active' : 'event-row-resolved'}" role="listitem" data-event-id="${escapeAttr(String(ev.id))}" data-asset-id="${escapeAttr(ev.asset_id)}">
        <div class="event-row-main">
          <div class="event-tripartite-group">
            <span class="event-asset-type-pill">${escapeHTML(assetTypeUpper)}</span>
            <strong class="event-asset-title">${escapeHTML(assetName)}</strong>
            <span class="event-transition-pill">
              <span aria-hidden="true">${fromSym}</span> ${escapeHTML(fromState)}
              <span aria-hidden="true">➔</span>
              <span aria-hidden="true">${toSym}</span> <strong>${escapeHTML(toState)}</strong>
            </span>
            ${isActive ? '<span class="event-live-tag">● ACTIVE</span>' : '<span class="event-resolved-tag">✓ ARCHIVED</span>'}
          </div>
          <div class="event-meta-strip">
            <span><strong>Started:</strong> ${escapeHTML(startStr)}</span>
            <span>•</span>
            <span><strong>Duration:</strong> ${escapeHTML(durStr)}</span>
            <span>•</span>
            <span><strong>Max Stage:</strong> <code>${escapeHTML(peakStageStr)}</code></span>
          </div>
        </div>
        <div class="event-row-actions">
          ${actionBtnHtml}
        </div>
      </div>
    `;
  }).join('');

  section.innerHTML = `
    <div class="card-header events-timeline-header">
      <div>
        <h2 class="card-title">📸 Telemetry State Transitions &amp; Visual Evidence Ledger</h2>
        <div class="river-tag">Correlated Environment Agency Stage Transitions &amp; Archived ±60m Optical Camera Sequences</div>
      </div>
      <div class="status-badge badge-secure">
        <span aria-hidden="true">🗂️</span>
        <span>${validEvents.length} EVENT${validEvents.length === 1 ? '' : 'S'}</span>
      </div>
    </div>
    <div class="events-timeline-list" role="list">
      ${rowsHtml}
    </div>
  `;

  return section;
}

export async function refreshLiveDashboard() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('cards-container');
  if (!container) return;

  isRefreshing = true;
  refreshController.isRefreshing = true;
  updateCountdownDisplay();
  const refreshBtn = document.getElementById('btn-refresh-now');
  if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'true');

  try {
    const [dbData, fetchedRainfall] = await Promise.all([
      fetchAllTelemetryFromDB(),
      fetchRainfallFromDB()
    ]);
    if (fetchedRainfall) {
      latestRainfallData = fetchedRainfall;
    }
    const effectiveRainfallData = fetchedRainfall || latestRainfallData;
    updateBasinRainHeaderBadge(effectiveRainfallData, dbData?.rainfall_summary || null);
    updateRainfallSummaryBanner(effectiveRainfallData, dbData?.rainfall_summary || null);
    const dbMeasures = dbData ? dbData.measures : null;
    const sysTimestamps = dbData ? dbData.system_timestamps : null;
    const measuresSummary = dbData ? dbData.measures_summary : null;

    // Update telemetry freshness pill & sys health modal drawer
    if (sysTimestamps) {
      const eaReadingTime = sysTimestamps.latest_ea_reading_at ? new Date(sysTimestamps.latest_ea_reading_at) : new Date();
      const diffMs = Date.now() - eaReadingTime.getTime();
      const diffMins = Math.max(0, Math.floor(diffMs / 60000));
      
      let ageStr = `${diffMins} min ago`;
      if (diffMins < 1) ageStr = 'Just now';
      else if (diffMins >= 60) ageStr = `${(diffMins / 60).toFixed(1)} hrs ago`;

      const eaPill = document.getElementById('ea-freshness-pill');
      if (eaPill) {
        applyFreshnessPill(eaPill, sysTimestamps.latest_ea_reading_at);
      }

      const modalEaTime = document.getElementById('modal-ea-time');
      const modalEaAge = document.getElementById('modal-ea-age');
      const modalDbTime = document.getElementById('modal-db-time');
      const modalClientTime = document.getElementById('modal-client-time');

      if (modalEaTime) modalEaTime.innerText = eaReadingTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (modalEaAge) modalEaAge.innerText = `Reading age: ${ageStr}`;
      if (modalDbTime) modalDbTime.innerText = new Date(sysTimestamps.db_synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (modalClientTime) modalClientTime.innerText = new Date(sysTimestamps.client_poll_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // Populate station telemetry matrix in modal
    if (measuresSummary && Object.keys(measuresSummary).length > 0) {
      const matrixBody = document.getElementById('modal-station-matrix');
      if (matrixBody) {
        const STATION_NAMES = {
          "52118-level-stage-i-15_min-mAOD": "Currymoor PS (River Tone)",
          "52127-level-stage-i-15_min-mAOD": "Curry Moor Basin",
          "52158-level-stage-i-15_min-mAOD": "Baltmoor Wall (Saltmoor)",
          "52159-level-stage-i-15_min-mAOD": "Northmoor Main Drain",
          "52233-level-stage-i-15_min-mAOD": "Monk's Leaze Upstream",
          "52234-level-downstage-i-15_min-mAOD": "Monk's Leaze Downstream",
          "52157-level-stage-i-15_min-mAOD": "Beer Wall Upstream (Sowy / Greylake)",
          "E9094-level-stage-i-15_min-mAOD": "Dunball Inland KSD",
          "52163-level-tidal_level-i-15_min-mAOD": "Dunball Tidal Parrett",
          "52120-level-stage-i-15_min-mASD": "Huish Episcopi PS (River Yeo)",
          "52153-level-stage-i-15_min-mASD": "Midelney (River Isle)",
          "52155-level-sump_level-i-15_min-mAOD": "West Sedgemoor PS (Drain sump level)"
        };

        matrixBody.innerHTML = Object.entries(measuresSummary).map(([measureId, timeStr]) => {
          const name = STATION_NAMES[measureId] || measureId;
          const time = timeStr ? new Date(timeStr) : null;
          const timeFormatted = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
          const diffMins = time ? Math.max(0, Math.floor((Date.now() - time.getTime()) / 60000)) : 999;
          const ageFormatted = diffMins < 60 ? `${diffMins}m ago` : `${(diffMins/60).toFixed(1)}h ago`;
          const statusBadge = diffMins <= 120 ? 
            '<span class="badge freshness-fresh">🟢 FRESH</span>' : 
            (diffMins <= 360 ? '<span class="badge freshness-warning">🟡 LAGGING</span>' : '<span class="badge freshness-stale">🔴 STALE</span>');

          return `
            <tr>
              <td><strong>${escapeHTML(name)}</strong><br><small style="color:#64748b;">${escapeHTML(measureId)}</small></td>
              <td><code>${escapeHTML(timeFormatted)}</code></td>
              <td>${escapeHTML(ageFormatted)}</td>
              <td>${statusBadge}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // Populate Infrastructure Baseline & Spillway Crest Matrix in Modal
    const infraBody = document.getElementById('modal-infra-matrix');
    if (infraBody && hydroConfig && hydroConfig.moors) {
      const SPILLWAY_ROWS = [
        { name: "Hookbridge Spillway (River Tone ➔ Curry Moor)", config: hydroConfig.moors.curry_moor?.spillway, fallback: 7.45 },
        { name: "Athelney Spillway (Curry Moor ➔ Northmoor Cascade)", config: hydroConfig.moors.curry_moor?.athelney_spillway, fallback: 7.35 },
        { name: "Baltmoor Wall Defence (River Parrett ➔ Northmoor Overtopping)", config: hydroConfig.moors.northmoor?.spillway, fallback: 7.80 },
        { name: "Beer Wall / Allens Spillway (Greylake ➔ Sowy Relief)", config: hydroConfig.moors.northmoor?.beer_wall, fallback: 7.30 }
      ];
      infraBody.innerHTML = SPILLWAY_ROWS.map(item => {
        const crest = getActiveCrestHeight(item.config, new Date(), item.fallback);
        const history = item.config?.crest_history || [];
        const latestEntry = history.length > 0 ? history[history.length - 1] : null;
        const scheme = latestEntry ? latestEntry.notes : 'EA Hydraulic Baseline';
        const dateWindow = latestEntry ? `${latestEntry.valid_from ? latestEntry.valid_from.substring(0, 4) : '1970'} – Present` : '1970 – Present';
        return `
          <tr>
            <td><strong>${item.name}</strong></td>
            <td><code style="color: #38bdf8; font-weight: 700;">${crest.toFixed(2)}m AOD</code></td>
            <td><span class="scheme-badge">${scheme}</span></td>
            <td><small style="color: #94a3b8;">${dateWindow}</small></td>
          </tr>
        `;
      }).join('');
    }

    // Seasonal Penning Regime Evaluation (Summer: April 15 - Oct 15 | Winter: Oct 16 - April 14)
    const regime = getSeasonalRegime();
    const isSummerRegime = regime.isSummer;

    // 1. Curry Moor Live Data (River Tone 52118 & Curry Moor 52127)
    const cmRiverReadings = (dbMeasures && dbMeasures["52118-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52118-level-stage-i-15_min-mAOD");
    const cmMoorReadings = (dbMeasures && dbMeasures["52127-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52127-level-stage-i-15_min-mAOD");

    const cmRiverLevel = getValidStageOrFallback(cmRiverReadings, STATION_REGISTRY['52118'].fallback_stage_mAOD);
    const cmMoorLevel = getValidStageOrFallback(cmMoorReadings, STATION_REGISTRY['52127'].fallback_stage_mAOD);

    // 2. Northmoor & Saltmoor Live Data (Baltmoor Wall Saltmoor 52158 & Northmoor Drain 52159)
    const nmRiverReadings = (dbMeasures && dbMeasures["52158-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52158-level-stage-i-15_min-mAOD");
    const nmMoorReadings = (dbMeasures && dbMeasures["52159-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52159-level-stage-i-15_min-mAOD");

    const nmRiverLevel = getValidStageOrFallback(nmRiverReadings, STATION_REGISTRY['52158'].fallback_stage_mAOD);
    const nmMoorLevel = getValidStageOrFallback(nmMoorReadings, STATION_REGISTRY['52159'].fallback_stage_mAOD);

    // 3. Monk's Leaze / Sowy Relief Channel Live Data (52233 Upstream, 52234 Downstream Sowy & 52157 Beer Wall Greylake)
    const monksUpReadings = (dbMeasures && dbMeasures["52233-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52233-level-stage-i-15_min-mAOD");
    const monksDownReadings = (dbMeasures && dbMeasures["52234-level-downstage-i-15_min-mAOD"]) || await fetchEAReadings("52234-level-downstage-i-15_min-mAOD");
    const beerWallReadings = (dbMeasures && dbMeasures["52157-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52157-level-stage-i-15_min-mAOD");

    const monksUpLevel = getValidStageOrFallback(monksUpReadings, STATION_REGISTRY['52233'].fallback_stage_mAOD);
    const monksDownLevel = getValidStageOrFallback(monksDownReadings, STATION_REGISTRY['52234'].fallback_stage_mAOD);
    const beerWallLevel = getValidStageOrFallback(beerWallReadings, STATION_REGISTRY['52157'].fallback_stage_mAOD);

    // 4. Dunball Outfall Live Data (E9094 Inland & 52163 Sea Tidal)
    const dunballInlandReadings = (dbMeasures && dbMeasures["E9094-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("E9094-level-stage-i-15_min-mAOD");
    const seaReadings = (dbMeasures && dbMeasures["52163-level-tidal_level-i-15_min-mAOD"]) || await fetchEAReadings("52163-level-tidal_level-i-15_min-mAOD");

    const dunballInland = getValidStageOrFallback(dunballInlandReadings, STATION_REGISTRY['E9094'].fallback_stage_mAOD);
    const dunballSea = getValidStageOrFallback(seaReadings, STATION_REGISTRY['52163'].fallback_stage_mAOD);

    // 5. Langport Confluence Live Data (River Yeo 52120 & River Isle 52153)
    const huishReadings = (dbMeasures && dbMeasures["52120-level-stage-i-15_min-mASD"]) || await fetchEAReadings("52120-level-stage-i-15_min-mASD");
    const midelneyReadings = (dbMeasures && dbMeasures["52153-level-stage-i-15_min-mASD"]) || await fetchEAReadings("52153-level-stage-i-15_min-mASD");

    const huishDatum = STATION_REGISTRY['52120']?.datum_offset_mAOD ?? GAUGE_DATUMS['52120'];
    const midelneyDatum = STATION_REGISTRY['52153']?.datum_offset_mAOD ?? GAUGE_DATUMS['52153'];
    const huishDefaultStage = (STATION_REGISTRY['52120']?.fallback_stage_mAOD ?? 6.68) - huishDatum;
    const midelneyDefaultStage = (STATION_REGISTRY['52153']?.fallback_stage_mAOD ?? 6.60) - midelneyDatum;
    const huishRaw = getValidStageOrFallback(huishReadings, huishDefaultStage);
    const midelneyRaw = getValidStageOrFallback(midelneyReadings, midelneyDefaultStage);
    const huishLevel = Number((huishRaw + huishDatum).toFixed(2));
    const midelneyLevel = Number((midelneyRaw + midelneyDatum).toFixed(2));

    // Station Freshness Evaluations [Issue #14: Ban Zombie Gauges]
    const cmRiverFreshness = evaluateStationFreshness(cmRiverReadings, { fallbackLabel: 'River Tone 52118 Baseline' });
    const cmMoorFreshness = evaluateStationFreshness(cmMoorReadings, { fallbackLabel: 'Curry Moor 52127 Baseline' });
    const cmIsStale = cmRiverFreshness.isStale || cmMoorFreshness.isStale;
    const cmStaleInfo = cmRiverFreshness.isStale ? cmRiverFreshness : (cmMoorFreshness.isStale ? cmMoorFreshness : null);

    const nmRiverFreshness = evaluateStationFreshness(nmRiverReadings, { fallbackLabel: 'Baltmoor Wall 52158 Baseline' });
    const nmMoorFreshness = evaluateStationFreshness(nmMoorReadings, { fallbackLabel: 'Northmoor 52159 Baseline' });
    const nmIsStale = nmRiverFreshness.isStale || nmMoorFreshness.isStale;
    const nmStaleInfo = nmRiverFreshness.isStale ? nmRiverFreshness : (nmMoorFreshness.isStale ? nmMoorFreshness : null);

    const athelneyIsStale = cmMoorFreshness.isStale || nmMoorFreshness.isStale;
    const athelneyStaleInfo = cmMoorFreshness.isStale ? cmMoorFreshness : (nmMoorFreshness.isStale ? nmMoorFreshness : null);

    const monksUpFreshness = evaluateStationFreshness(monksUpReadings, { fallbackLabel: 'Monk\'s Leaze 52233 Baseline' });
    const monksDownFreshness = evaluateStationFreshness(monksDownReadings, { fallbackLabel: 'Monk\'s Leaze 52234 Baseline' });
    const beerWallFreshness = evaluateStationFreshness(beerWallReadings, { fallbackLabel: 'Beer Wall 52157 Baseline' });
    const beerWallRates = computeStageRates(beerWallReadings);
    const sowyIsStale = monksUpFreshness.isStale || monksDownFreshness.isStale;
    const sowyStaleInfo = monksUpFreshness.isStale ? monksUpFreshness : (monksDownFreshness.isStale ? monksDownFreshness : null);

    const dunballInlandFreshness = evaluateStationFreshness(dunballInlandReadings, { fallbackLabel: 'Dunball Inland E9094 Baseline' });
    const dunballSeaFreshness = evaluateStationFreshness(seaReadings, { fallbackLabel: 'Dunball Sea 52163 Baseline' });
    const dunballIsStale = dunballInlandFreshness.isStale || dunballSeaFreshness.isStale;
    const dunballStaleInfo = dunballInlandFreshness.isStale ? dunballInlandFreshness : (dunballSeaFreshness.isStale ? dunballSeaFreshness : null);

    const huishFreshness = evaluateStationFreshness(huishReadings, { fallbackLabel: 'Huish 52120 Baseline' });
    const midelneyFreshness = evaluateStationFreshness(midelneyReadings, { fallbackLabel: 'Midelney 52153 Baseline' });
    const confluenceIsStale = huishFreshness.isStale || midelneyFreshness.isStale;
    const confluenceStaleInfo = huishFreshness.isStale ? huishFreshness : (midelneyFreshness.isStale ? midelneyFreshness : null);

    stationFreshnessById.set('52157', beerWallFreshness);
    stationFreshnessById.set('52234', monksDownFreshness);
    stationFreshnessById.set('52120', huishFreshness);
    stationFreshnessById.set('52153', midelneyFreshness);

    // Build trend histories according to selected lookback period (24h, 7d, 30d)
    const rangeLimitMap = { '24h': 96, '7d': 672, '30d': 2688 };
    const maxLimit = rangeLimitMap[currentActiveRange] || 96;

    const extractHistory = (items, datum = 0) => {
      if (!items || !Array.isArray(items) || items.length === 0) return [];
      const validDatum = Number.isFinite(datum) ? datum : 0;
      let sliced = items
        .filter(i => i && typeof i.value === 'number' && Number.isFinite(i.value))
        .slice(0, maxLimit)
        .map(i => ({ value: Number((i.value + validDatum).toFixed(3)), time: i.dateTime }));
      if ((currentActiveRange === '30d' || currentActiveRange === '7d') && sliced.length > 250) {
        const step = Math.ceil(sliced.length / 180);
        sliced = sliced.filter((_, idx) => idx % step === 0);
      }
      return sliced.reverse();
    };
    const cmRiverHistory = extractHistory(cmRiverReadings);
    const cmMoorHistory = extractHistory(cmMoorReadings);
    const nmRiverHistory = extractHistory(nmRiverReadings);
    const nmMoorHistory = extractHistory(nmMoorReadings);
    const monksUpHistory = extractHistory(monksUpReadings);
    const monksDownHistory = extractHistory(monksDownReadings);
    const beerWallHistory = extractHistory(beerWallReadings);
    const inlandHistory = extractHistory(dunballInlandReadings);
    const seaHistory = extractHistory(seaReadings);
    const huishHistory = extractHistory(huishReadings, huishDatum);
    const midelneyHistory = extractHistory(midelneyReadings, midelneyDatum);

  const openDrawers = new Set(
    Array.from(container.querySelectorAll('.moor-card'))
      .filter(c => c.id && c.querySelector('.drawer-content.open'))
      .map(c => c.id)
  );
  container.innerHTML = '';

  const evals = [];
  let isTideLocked = dunballSea >= dunballInland;

  // Progressive Disclosure: Sourced active event sessions [RULE-ENT-01] & Visual Evidence Catalog [Issue #24]
  const recentEvents = await fetchRecentEventsFromDB(20);
  const activeEventsMap = new Map();
  const evidenceByAsset = new Map();

  for (const ev of recentEvents) {
    if (ev && ev.asset_id && ev.camera_evidence && !evidenceByAsset.has(ev.asset_id)) {
      evidenceByAsset.set(ev.asset_id, ev);
    }
  }
  if (Array.isArray(dbData?.active_events)) {
    for (const ev of dbData.active_events) {
      activeEventsMap.set(ev.asset_id, ev);
      if (ev && ev.asset_id && ev.camera_evidence) {
        evidenceByAsset.set(ev.asset_id, ev);
      }
    }
  }

  const allCatalogEvents = [...recentEvents];
  if (Array.isArray(dbData?.active_events)) {
    for (const activeEv of dbData.active_events) {
      if (activeEv && !allCatalogEvents.some(e => e && e.id === activeEv.id)) {
        allCatalogEvents.unshift(activeEv);
      }
    }
  }
  setCameraEventsCatalog(allCatalogEvents);

  // Dedicated Community Roads & Access Summary Bridge Banner [Issue #12 / Roads Carve-Out]
  const roadData = dbData?.roads || evaluateRoadNetwork(dbMeasures || {}, activeEventsMap);
  updateRoadStatusSummaryBanner(roadData);

  // Official EA Flood Warnings Header Banner & Per-Card Briefing Badges [Issue #55]
  updateEAWarningSummaryBanner(dbData?.ea_warnings);
  if ((dbData?.ea_warnings?.active_count || 0) <= 0) {
    latestActiveEAWarnings = [];
  } else {
    try {
      const warnRes = await fetch('/api/warnings?status=ACTIVE');
      if (warnRes.ok) {
        const warnPayload = await warnRes.json();
        latestActiveEAWarnings = Array.isArray(warnPayload?.warnings) ? warnPayload.warnings : [];
      }
    } catch {
      // Preserve last known active warnings on transient fetch failure
    }
  }

  const athelneyConfig = hydroConfig?.moors?.curry_moor?.athelney_spillway;
  const athelneyCrest = getActiveCrestHeight(athelneyConfig, new Date(), 7.35);
  const athelneySpillway = evaluateAthelneySpillway(cmMoorLevel, athelneyCrest);

  // Card 1: Curry Moor
  try {
    const hookbridgeConfig = hydroConfig?.moors?.curry_moor?.spillway;
    const hookbridgeCrest = getActiveCrestHeight(hookbridgeConfig, new Date(), 7.45);
    const hookbridgeHist = hookbridgeConfig?.crest_history || [];
    const hookbridgeScheme = hookbridgeHist.length ? hookbridgeHist[hookbridgeHist.length - 1].notes : 'EA Survey Baseline';

    const cmEval = evaluateSpillway(cmRiverLevel, cmMoorLevel, hookbridgeCrest);
    cmEval.name = "Curry Moor System";
    if (cmIsStale && (cmEval.badgeClass === 'badge-secure' || cmEval.code === 'SECURE')) {
      cmEval.badgeClass = cmStaleInfo.badgeClass || 'badge-stale';
      cmEval.symbol = cmStaleInfo.isOffline ? '⚠️' : '🕒';
      cmEval.label = `${cmEval.label} (UNCONFIRMED - ${cmStaleInfo.isOffline ? 'OFFLINE' : 'STALE'})`;
    }
    evals.push(cmEval);

    const currymoorPump = getPumpEvaluation('currymoor_ps', cmMoorLevel, 'curry_moor', 'Currymoor PS', 2);
    const stanmoorPump = getPumpEvaluation('stanmoor_ps', cmMoorLevel, 'curry_moor', 'Stanmoor PS', 2);
    const cmGravitySluice = evaluateGravityClyse(cmMoorLevel, cmRiverLevel, "Currymoor Sluice");

    const cmRiverColor = cmEval.code === 'OVERTOPPING' ? '#f87171' : (cmRiverFreshness.isStale ? '#f59e0b' : '#4ade80');
    const cmMoorColor = cmMoorFreshness.isStale ? '#f59e0b' : '#38bdf8';
    const cmTriggerDelta = getPumpTriggerDelta(currymoorPump, cmMoorLevel);
    const stanmoorTriggerDelta = getPumpTriggerDelta(stanmoorPump, cmMoorLevel);

    const currymoorPillMode = currymoorPump.stage === 0 ? '⚪ STANDBY' :
      (currymoorPump.mode === 'PARTIAL_DUTY' ? '🟢 LEAD DUTY' :
      (currymoorPump.mode === 'FULL_CAPACITY' ? '🟢 FULL DUTY' :
      (currymoorPump.mode === 'MOBILE_ORDERED' ? '🟡 MOBILE ORDERED' :
      (currymoorPump.mode === 'EMERGENCY_MOBILE_ACTIVE' ? '🔴 MOBILE ACTIVE' : '🚨 CRITICAL'))));

    const stanmoorPillMode = stanmoorPump.stage === 0 ? '⚪ STANDBY' :
      (stanmoorPump.mode === 'PARTIAL_DUTY' ? '🟢 LEAD DUTY' :
      (stanmoorPump.mode === 'FULL_CAPACITY' ? '🟢 FULL DUTY' :
      (stanmoorPump.mode === 'MOBILE_ORDERED' ? '🟡 MOBILE ORDERED' :
      (stanmoorPump.mode === 'EMERGENCY_MOBILE_ACTIVE' ? '🔴 MOBILE ACTIVE' : '🚨 CRITICAL'))));

    // Progressive Disclosure Level 1: Centimetre Rule + 3h Trend Vector + Active Duration
    const hookbridgeActive = activeEventsMap.get('hookbridge');
    const bpReadings = dbMeasures?.["52162-level-stage-i-15_min-mAOD"];
    const bpStage = bpReadings?.[0]?.value ?? bpReadings?.[0] ?? null;
    const cmTrend = disambiguateRiverTrend(cmRiverReadings, bpStage, dunballSea);
    const cmClearanceFormatted = formatClearanceText(hookbridgeCrest - cmRiverLevel, 'crest');
    const cmClearanceWithTrend = `${cmClearanceFormatted} (${cmTrend})${hookbridgeActive?.duration_formatted ? ` • ⏱️ ${hookbridgeActive.duration_formatted}` : ''}`;

    const cmHeroBanner = renderHeroSpillwayBanner({
    icon: '⚡',
    title: 'Hookbridge Spillway Status',
    statusBadge: cmEval,
    mainMetricValue: cmRiverLevel.toFixed(2),
    mainMetricUnit: 'm AOD (Tone Stage)',
    clearanceText: cmClearanceWithTrend,
    minLevel: 5.50,
    maxLevel: hookbridgeCrest,
    currentLevel: cmRiverLevel,
    minLabel: 'Normal Stage: 5.50m',
    maxLabel: `Crest: ${hookbridgeCrest.toFixed(2)}m AOD`,
    isAlert: cmEval.code === 'OVERTOPPING' || cmEval.code === 'NEAR_CREST',
    staleInfo: cmStaleInfo,
    stats: [
      { label: 'Surveyed Crest', value: `${hookbridgeCrest.toFixed(2)}m AOD` },
      { label: 'Clearance to Crest', value: cmClearanceWithTrend }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#hook',
      title: 'View 3-min EA Snapshot Camera at thecfh.org#hook',
      ariaLabel: 'View 3-min EA Snapshot Camera at thecfh.org for Hookbridge Spillway'
    }
  });

  container.appendChild(createMoorCard({
    title: "Curry Moor System",
    cardId: "card-52118",
    stationId: "52118",
    cameraGuideSite: "hookbridge",
    visualEvidenceEvent: evidenceByAsset.get('hookbridge') || evidenceByAsset.get('curry_moor') || null,
    heroBanner: cmHeroBanner,
    riverTag: `Catchment: River Tone (${regime.label})`,
    eval: cmEval,
    staleInfo: cmStaleInfo,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `${cmRiverLevel.toFixed(2)}m AOD`,
    clearanceText: cmClearanceWithTrend,
    narrative: `Curry Moor Basin level is ${cmMoorLevel.toFixed(2)}m AOD (${isSummerRegime ? 'normal summer target 4.30-4.45m' : 'winter target 3.40-4.50m'}). ${cmEval.narrative}`,
    pills: [
      {
        html: `<strong>Hookbridge Spillway:</strong> ${cmEval.symbol} ${cmEval.label} (${cmClearanceWithTrend})`,
        tooltip: `📍 Hookbridge Crest: ${hookbridgeCrest.toFixed(2)}m AOD (${hookbridgeScheme})`
      },
      {
        html: `<strong>Athelney Spillway (Outflow):</strong> ${athelneySpillway.statusText}`,
        tooltip: `📍 Athelney Crest: ${athelneyCrest.toFixed(2)}m AOD (Standard Profile) | Overspill cascade from Curry Moor into Northmoor when stage ≥ 7.35m AOD`
      },
      `<strong>Currymoor Gravity ${renderJargonTerm('Clyse')}:</strong> ${cmGravitySluice.statusText}`,
      {
        html: `<strong>Currymoor PS:</strong> ${currymoorPillMode} (Curry Moor ${cmMoorLevel.toFixed(2)}m • ${cmTriggerDelta.statusText})`,
        tooltip: `📍 Currymoor Pumping Station: Driven by water stage in Curry Moor Basin (Station 52127), NOT the River Tone. Inferred from EA Trigger Point Plan.`
      },
      {
        html: `<strong>Stanmoor PS:</strong> ${stanmoorPillMode} (Curry Moor ${cmMoorLevel.toFixed(2)}m • ${stanmoorTriggerDelta.statusText})`,
        tooltip: `📍 Stanmoor Pumping Station: Driven by water stage in Curry Moor Basin (Station 52127). Inferred from EA Trigger Point Plan.`
      }
    ],
    camLinks: [
      { label: "Hookbridge Spillway", url: "https://thecfh.org/parretttonewsom.php#hook", title: "View 3-min EA Snapshot Camera at Hookbridge" },
      { label: "Athelney Spillway", url: "https://thecfh.org/parretttonewsom.php#athelneyspillway", title: "View 3-min EA Snapshot Camera at Athelney" },
      { label: "Currymoor PS", url: "https://thecfh.org/parretttonewsom.php#currymoor", title: "View 3-min EA Snapshot Camera at Currymoor PS" }
    ],
    spillwayMeta: { crest: hookbridgeCrest.toFixed(2), scheme: hookbridgeScheme },
    sparkline: renderDualSparkline(cmRiverHistory, cmMoorHistory, false, {
      secondaryName: 'River Tone',
      primaryName: 'Curry Moor',
      secondaryColor: cmRiverColor,
      primaryColor: cmMoorColor,
      showTideLock: false,
      statusPill: `Moor ${cmMoorLevel.toFixed(2)}m • ${cmTriggerDelta.statusText}`,
      streamLabel: `<span class="stream-dot" style="background:${cmRiverColor}; color:${cmRiverColor}"></span><span class="sparkline-title">River Tone (52118) [Receiving River]</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">Moor Drain (52127) [🎯 Drives Pumps]</span>`
    }),
    pumpGauge: renderPumpTriggerGauge(currymoorPump, {
      stationId: '52127',
      stationName: 'Curry Moor Basin',
      riverName: 'River Tone',
      currentLevel: cmMoorLevel,
      color: '#38bdf8',
      isStale: cmMoorFreshness.isStale,
      roleTag: 'Internal Moor Drain'
    }),
    gauges: [
      {
        name: "River Tone (Currymoor PS)",
        id: "52118",
        value: `${cmRiverLevel.toFixed(2)}m AOD`,
        history: cmRiverHistory,
        color: cmRiverFreshness.isStale ? "#f59e0b" : "#4ade80",
        link: "https://check-for-flooding.service.gov.uk/station/3073",
        staleTag: cmRiverFreshness.isStale ? (cmRiverFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${cmRiverFreshness.ageHours}h)`) : null
      },
      {
        name: "Curry Moor Basin",
        id: "52127",
        value: `${cmMoorLevel.toFixed(2)}m AOD`,
        history: cmMoorHistory,
        color: cmMoorFreshness.isStale ? "#f59e0b" : "#38bdf8",
        link: "https://check-for-flooding.service.gov.uk/station/3064",
        staleTag: cmMoorFreshness.isStale ? (cmMoorFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${cmMoorFreshness.ageHours}h)`) : null
      }
    ],
    extLinks: [
      { label: "🗺️ View on River Map ↗", url: "topology.html?station=52118" },
      { label: "📷 Live Curry Moor Webcams (thecfh.org#hook) ↗", url: "https://thecfh.org/parretttonewsom.php#hook" },
      { label: "📊 GOV.UK Tone Stage (3073) ↗", url: "https://check-for-flooding.service.gov.uk/station/3073" },
      { label: "📊 GOV.UK Moor Stage (3064) ↗", url: "https://check-for-flooding.service.gov.uk/station/3064" },
      { label: "EA Data (52118) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52118.html" },
      { label: "📄 EA Trigger Plan ↗", url: "https://www.gov.uk/government/publications/somerset-levels-and-moors-reducing-the-risk-of-flooding" }
    ]
  }));

  // Card: Athelney Spillway (Inter-Moor Relief)
  const athelneyHist = athelneyConfig?.crest_history || [];
  const athelneyScheme = athelneyHist.length ? athelneyHist[athelneyHist.length - 1].notes : 'Standard Hydraulic Profile';
  const athelneyEval = evaluateSpillway(cmMoorLevel, nmMoorLevel, athelneyCrest);
  athelneyEval.name = "Athelney Spillway";
  if (athelneyIsStale && (athelneyEval.badgeClass === 'badge-secure' || athelneyEval.code === 'SECURE')) {
    athelneyEval.badgeClass = athelneyStaleInfo.badgeClass || 'badge-stale';
    athelneyEval.symbol = athelneyStaleInfo.isOffline ? '⚠️' : '🕒';
    athelneyEval.label = `${athelneyEval.label} (UNCONFIRMED - ${athelneyStaleInfo.isOffline ? 'OFFLINE' : 'STALE'})`;
  }
  evals.push(athelneyEval);

  const cutsRoadActive = activeEventsMap.get('cuts_road');
  const athelneyTrend = computeTrendVector(cmMoorReadings);
  const athelneyClearanceDelta = Number(Math.abs(cmMoorLevel - athelneyCrest).toFixed(2));
  const athelneyClearanceFormatted = formatClearanceText(athelneyCrest - cmMoorLevel, 'spillway crest');
  const athelneyClearanceWithTrend = `${athelneyClearanceFormatted} (${athelneyTrend})${cutsRoadActive?.duration_formatted ? ` • ⏱️ ${cutsRoadActive.duration_formatted}` : ''}`;
  const athelneyCurryColor = athelneyEval.code === 'OVERTOPPING' ? '#f87171' : (cmMoorFreshness.isStale ? '#f59e0b' : '#38bdf8');
  const athelneyNorthmoorColor = nmMoorFreshness.isStale ? '#f59e0b' : '#a78bfa';

  const athelneyHeroBanner = renderHeroSpillwayBanner({
    icon: '🌊',
    title: 'Athelney Spillway (Inter-Moor Relief)',
    statusBadge: athelneyEval,
    mainMetricValue: cmMoorLevel.toFixed(2),
    mainMetricUnit: 'm AOD (Curry Moor Level)',
    clearanceText: athelneyClearanceWithTrend,
    minLevel: 3.50,
    maxLevel: athelneyCrest,
    currentLevel: cmMoorLevel,
    minLabel: 'Normal Moor: 3.80m',
    maxLabel: `Spillway Crest: ${athelneyCrest.toFixed(2)}m AOD`,
    isAlert: athelneyEval.code === 'OVERTOPPING' || athelneyEval.code === 'NEAR_CREST',
    staleInfo: athelneyStaleInfo,
    stats: [
      { label: 'Clearance to Spillway', value: athelneyClearanceWithTrend },
      { label: 'Spillway Status', value: athelneyEval.label }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#athelneyspillway',
      title: 'View 3-min EA Snapshot Camera at thecfh.org#athelneyspillway',
      ariaLabel: 'View 3-min EA Snapshot Camera at thecfh.org for Athelney Spillway'
    }
  });

  container.appendChild(createMoorCard({
    title: "Athelney Spillway (Inter-Moor Relief)",
    cardId: "card-52127",
    stationId: "52127",
    cameraGuideSite: "baltmoor",
    visualEvidenceEvent: evidenceByAsset.get('cuts_road') || evidenceByAsset.get('athelney_spillway') || null,
    cardClass: "athelney-cascade-card",
    heroBanner: athelneyHeroBanner,
    riverTag: `Inter-Moor Cascade: Curry Moor ➔ Northmoor`,
    eval: athelneyEval,
    staleInfo: athelneyStaleInfo,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `${cmMoorLevel.toFixed(2)}m AOD`,
    clearanceText: `Athelney Crest: ${athelneyClearanceWithTrend}`,
    narrative: `Curry Moor storage is ${athelneyClearanceDelta.toFixed(2)}m below Athelney Spillway crest (7.35m AOD). Provides overspill relief from Curry Moor into Northmoor retention storage when Curry Moor reaches capacity.`,
    pills: [
      {
        html: `<strong>Athelney Spillway:</strong> ${athelneyEval.symbol} ${athelneyEval.label} (${athelneyClearanceWithTrend})`,
        tooltip: `📍 Athelney Spillway Crest: ${athelneyCrest.toFixed(2)}m AOD (${athelneyScheme}) | Overspill relief cascade from Curry Moor into Northmoor retention storage`
      },
      `<strong>Overland Conduit:</strong> Curry Moor (52127) relieves into Northmoor (52159) retention storage`,
      `<strong>Hydraulic Threshold:</strong> Engineered broad-crested concrete spillway crest at 7.35m AOD`
    ],
    camLinks: [
      { label: "Athelney Spillway", url: "https://thecfh.org/parretttonewsom.php#athelneyspillway", title: "View 3-min EA Snapshot Camera at Athelney" }
    ],
    spillwayMeta: { crest: athelneyCrest.toFixed(2), scheme: athelneyScheme },
    sparkline: renderDualSparkline(cmMoorHistory, nmMoorHistory, false, {
      secondaryName: 'Curry Moor',
      primaryName: 'Northmoor',
      secondaryColor: athelneyCurryColor,
      primaryColor: athelneyNorthmoorColor,
      showTideLock: false,
      statusPill: `Crest: ${athelneyCrest.toFixed(2)}mAOD (${athelneyClearanceDelta.toFixed(2)}m margin)`,
      streamLabel: `<span class="stream-dot" style="background:${athelneyCurryColor}; color:${athelneyCurryColor}"></span><span class="sparkline-title">Curry Moor Basin (52127) [Upstream]</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#a78bfa; color:#a78bfa"></span><span class="sparkline-title">Northmoor Drain (52159) [Cascade Relief]</span>`
    }),
    gauges: [
      {
        name: "Curry Moor Basin",
        id: "52127",
        value: `${cmMoorLevel.toFixed(2)}m AOD`,
        history: cmMoorHistory,
        color: cmMoorFreshness.isStale ? "#f59e0b" : "#38bdf8",
        link: "https://check-for-flooding.service.gov.uk/station/3064",
        staleTag: cmMoorFreshness.isStale ? (cmMoorFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${cmMoorFreshness.ageHours}h)`) : null
      },
      {
        name: "Northmoor Main Drain",
        id: "52159",
        value: `${nmMoorLevel.toFixed(2)}m AOD`,
        history: nmMoorHistory,
        color: nmMoorFreshness.isStale ? "#f59e0b" : "#4ade80",
        link: "https://check-for-flooding.service.gov.uk/station/3415",
        staleTag: nmMoorFreshness.isStale ? (nmMoorFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${nmMoorFreshness.ageHours}h)`) : null
      }
    ],
    extLinks: [
      { label: "🗺️ View on River Map ↗", url: "topology.html?station=52127" },
      { label: "📷 Live Athelney Webcam (thecfh.org) ↗", url: "https://thecfh.org/parretttonewsom.php#athelneyspillway" },
      { label: "📊 GOV.UK Curry Moor Stage (3064) ↗", url: "https://check-for-flooding.service.gov.uk/station/3064" },
      { label: "📊 GOV.UK Northmoor Stage (3415) ↗", url: "https://check-for-flooding.service.gov.uk/station/3415" },
      { label: "EA Data (52127) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52127.html" }
    ]
  }));
  } catch (err) {
    console.error('[Card 1 Error: Curry Moor]', err);
    evals.push({ name: 'Curry Moor System', severity: 4, status: 'OFFLINE', isOffline: true });
    container.appendChild(createMoorFallbackCard({
      title: 'Curry Moor System',
      cardId: 'card-52118',
      stationId: '52118',
      error: err
    }));
  }

  // Card 2: Northmoor & Saltmoor
  try {
    const baltmoorConfig = hydroConfig?.moors?.northmoor?.spillway;
  const baltmoorCrest = getActiveCrestHeight(baltmoorConfig, new Date(), 7.80);
  const baltmoorHist = baltmoorConfig?.crest_history || [];
  const baltmoorScheme = baltmoorHist.length ? baltmoorHist[baltmoorHist.length - 1].notes : 'Post-2014 EA Levee Strengthening';
  const nmEval = evaluateSpillway(nmRiverLevel, nmMoorLevel, baltmoorCrest);
  nmEval.name = "Northmoor & Saltmoor";
  if (nmIsStale && (nmEval.badgeClass === 'badge-secure' || nmEval.code === 'SECURE')) {
    nmEval.badgeClass = nmStaleInfo.badgeClass || 'badge-stale';
    nmEval.symbol = nmStaleInfo.isOffline ? '⚠️' : '🕒';
    nmEval.label = `${nmEval.label} (UNCONFIRMED - ${nmStaleInfo.isOffline ? 'OFFLINE' : 'STALE'})`;
  }
  evals.push(nmEval);

  const saltmoorPump = getPumpEvaluation('saltmoor_ps', nmMoorLevel, 'northmoor', 'Saltmoor PS', 2);
  const northmoorPump = getPumpEvaluation('northmoor_ps', nmMoorLevel, 'northmoor', 'Northmoor PS', 2);

  const nmRiverColor = nmEval.code === 'OVERTOPPING' ? '#f87171' : (nmRiverFreshness.isStale ? '#f59e0b' : '#4ade80');
  const nmMoorColor = nmMoorFreshness.isStale ? '#f59e0b' : '#38bdf8';
  const nmTriggerDelta = getPumpTriggerDelta(saltmoorPump, nmMoorLevel);

  const saltmoorPillMode = saltmoorPump.stage === 0 ? '⚪ STANDBY' :
    (saltmoorPump.mode === 'PARTIAL_DUTY' ? '🟢 LEAD DUTY' :
    (saltmoorPump.mode === 'FULL_CAPACITY' ? '🟢 FULL DUTY' :
    (saltmoorPump.mode === 'MOBILE_ORDERED' ? '🟡 MOBILE ORDERED' :
    (saltmoorPump.mode === 'EMERGENCY_MOBILE_ACTIVE' ? '🔴 MOBILE ACTIVE' : '🚨 CRITICAL'))));
  const northmoorPillMode = northmoorPump.stage === 0 ? '⚪ STANDBY' :
    (northmoorPump.mode === 'PARTIAL_DUTY' ? '🟢 LEAD DUTY' :
    (northmoorPump.mode === 'FULL_CAPACITY' ? '🟢 FULL DUTY' :
    (northmoorPump.mode === 'MOBILE_ORDERED' ? '🟡 MOBILE ORDERED' :
    (northmoorPump.mode === 'EMERGENCY_MOBILE_ACTIVE' ? '🔴 MOBILE ACTIVE' : '🚨 CRITICAL'))));

  const nmGravitySluice = evaluateGravityClyse(nmMoorLevel, nmRiverLevel, "Northmoor Sluice");
  const beerWallConfig = hydroConfig?.moors?.northmoor?.beer_wall;
  const beerWallCrest = getActiveCrestHeight(beerWallConfig, new Date(), 7.30);
  const beerWallHist = beerWallConfig?.crest_history || [];
  const beerWallScheme = beerWallHist.length ? beerWallHist[beerWallHist.length - 1].notes : 'SRA Greylake Scheme';
  const beerWallSpillway = evaluateBeerWall(beerWallLevel, beerWallCrest);

  const baltmoorActive = activeEventsMap.get('baltmoor_wall');
  const nmTrend = computeTrendVector(nmRiverReadings);
  const nmClearanceFormatted = formatClearanceText(baltmoorCrest - nmRiverLevel, 'defence crest');
  const nmClearanceWithTrend = `${nmClearanceFormatted} (${nmTrend})${baltmoorActive?.duration_formatted ? ` • ⏱️ ${baltmoorActive.duration_formatted}` : ''}`;

  const nmHeroBanner = renderHeroSpillwayBanner({
    icon: '🌊',
    title: 'Baltmoor Wall Overtopping Status',
    statusBadge: nmEval,
    mainMetricValue: nmRiverLevel.toFixed(2),
    mainMetricUnit: 'm AOD (River Stage at Wall)',
    clearanceText: nmClearanceWithTrend,
    minLevel: 5.50,
    maxLevel: baltmoorCrest,
    currentLevel: nmRiverLevel,
    minLabel: 'Normal Stage: 5.50m',
    maxLabel: `Defence Crest: ${baltmoorCrest.toFixed(2)}m AOD`,
    isAlert: nmEval.code === 'OVERTOPPING' || nmEval.code === 'NEAR_CREST',
    staleInfo: nmStaleInfo,
    stats: [
      { label: 'Defence Crest', value: `${baltmoorCrest.toFixed(2)}m AOD` },
      { label: 'Defence Clearance', value: nmClearanceWithTrend }
    ]
  });

  container.appendChild(createMoorCard({
    title: "Northmoor & Saltmoor",
    cardId: "card-52158",
    stationId: "52158",
    cameraGuideSite: "saltmoor",
    visualEvidenceEvent: evidenceByAsset.get('baltmoor_wall') || evidenceByAsset.get('northmoor') || evidenceByAsset.get('beer_wall') || null,
    heroBanner: nmHeroBanner,
    riverTag: `Catchment: River Parrett (${regime.label})`,
    eval: nmEval,
    staleInfo: nmStaleInfo,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `${nmRiverLevel.toFixed(2)}m AOD`,
    clearanceText: `Baltmoor Wall: ${nmClearanceWithTrend}`,
    narrative: `Baltmoor Wall Saltmoor Barrier sensor live. River levels monitored relative to 7.80m defence overtopping crest.`,
    pills: [
      {
        html: `<strong>Baltmoor Wall Overtopping:</strong> ${nmEval.symbol} ${nmEval.label} (${nmClearanceWithTrend})`,
        tooltip: `📍 Baltmoor Wall Defence Crest: ${baltmoorCrest.toFixed(2)}m AOD (${baltmoorScheme})`
      },
      {
        html: `<strong>Athelney Spillway Inflow:</strong> ${athelneySpillway.statusText}`,
        tooltip: `📍 Athelney Crest: ${athelneyCrest.toFixed(2)}m AOD | Overspill cascade from Curry Moor into Northmoor retention storage`
      },
      {
        html: `<strong>Beer Wall Culverts &amp; Beazeley Spillway (52157):</strong> ${beerWallSpillway.statusText} (Sowy ${beerWallLevel.toFixed(2)}m AOD)`,
        tooltip: `📍 Driven by Beerwall Upstream (Station 52157). ${HYDRO_THRESHOLDS.BEERWALL.CREST_MAOD.toFixed(2)}m AOD box culverts relief threshold (${beerWallScheme}). Beazeley Spillway crest: pending EA Asset Survey, decoupled from >${HYDRO_THRESHOLDS.BEERWALL.A372_CROWN_MAOD.toFixed(2)}m A372 road crown.`
      },
      `<strong>Northmoor Gravity ${renderJargonTerm('Clyse')}:</strong> ${nmGravitySluice.statusText}`,
      {
        html: `<strong>Saltmoor PS:</strong> ${saltmoorPillMode} (Northmoor ${nmMoorLevel.toFixed(2)}m • ${nmTriggerDelta.statusText})`,
        tooltip: `📍 Saltmoor Pumping Station: Driven by water stage in Northmoor Main Drain (Station 52159), NOT the River Parrett. Inferred from EA Trigger Point Plan.`
      },
      {
        html: `<strong>Northmoor PS:</strong> ${northmoorPillMode} (Northmoor ${nmMoorLevel.toFixed(2)}m • ${nmTriggerDelta.statusText})`,
        tooltip: `📍 Northmoor Pumping Station: Driven by water stage in Northmoor Main Drain (Station 52159), NOT the River Parrett. Inferred from EA Trigger Point Plan.`
      }
    ],
    camLinks: [
      { label: "Athelney Spillway", url: "https://thecfh.org/parretttonewsom.php#athelneyspillway", title: "View 3-min EA Snapshot Camera at Athelney" },
      { label: "Beer Wall", url: "https://thecfh.org/parretttonewsom.php#Beerwall", title: "View 3-min EA Snapshot Camera at Beer Wall" },
      { label: "Saltmoor PS", url: "https://thecfh.org/parretttonewsom.php#saltmoor", title: "View 3-min EA Snapshot Camera at Saltmoor PS" },
      { label: "Northmoor PS", url: "https://thecfh.org/parretttonewsom.php#northmoor", title: "View 3-min EA Snapshot Camera at Northmoor PS" }
    ],
    spillwayMeta: { crest: baltmoorCrest.toFixed(2), scheme: baltmoorScheme },
    sparkline: renderDualSparkline(nmRiverHistory, nmMoorHistory, false, {
      secondaryName: 'Parrett',
      primaryName: 'Northmoor',
      secondaryColor: nmRiverColor,
      primaryColor: nmMoorColor,
      showTideLock: false,
      statusPill: `Moor ${nmMoorLevel.toFixed(2)}m • ${nmTriggerDelta.statusText}`,
      streamLabel: `<span class="stream-dot" style="background:${nmRiverColor}; color:${nmRiverColor}"></span><span class="sparkline-title">Parrett @ Baltmoor (52158) [Barrier]</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">Northmoor Drain (52159) [🎯 Drives Pumps]</span>`
    }),
    pumpGauge: renderPumpTriggerGauge(saltmoorPump, {
      stationId: '52159',
      stationName: 'Northmoor Main Drain',
      riverName: 'River Parrett',
      currentLevel: nmMoorLevel,
      color: '#38bdf8',
      isStale: nmMoorFreshness.isStale,
      roleTag: 'Internal Moor Drain'
    }),
    gauges: [
      {
        name: "Baltmoor Wall Saltmoor Barrier",
        id: "52158",
        value: `${nmRiverLevel.toFixed(2)}m AOD`,
        history: nmRiverHistory,
        color: nmRiverFreshness.isStale ? "#f59e0b" : "#4ade80",
        link: "https://check-for-flooding.service.gov.uk/station/3400",
        staleTag: nmRiverFreshness.isStale ? (nmRiverFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${nmRiverFreshness.ageHours}h)`) : null
      },
      {
        name: "Northmoor Main Drain",
        id: "52159",
        value: `${nmMoorLevel.toFixed(2)}m AOD`,
        history: nmMoorHistory,
        color: nmMoorFreshness.isStale ? "#f59e0b" : "#38bdf8",
        link: "https://check-for-flooding.service.gov.uk/station/3415",
        staleTag: nmMoorFreshness.isStale ? (nmMoorFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${nmMoorFreshness.ageHours}h)`) : null
      }
    ],
    extLinks: [
      { label: "🗺️ View on River Map ↗", url: "topology.html?station=52158" },
      { label: "📷 Live Saltmoor & Northmoor Webcams (thecfh.org#saltmoor) ↗", url: "https://thecfh.org/parretttonewsom.php#saltmoor" },
      { label: "📊 GOV.UK Wall Stage (3400) ↗", url: "https://check-for-flooding.service.gov.uk/station/3400" },
      { label: "📊 GOV.UK Drain Stage (3415) ↗", url: "https://check-for-flooding.service.gov.uk/station/3415" },
      { label: "EA Data (52158) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52158.html" }
    ]
  }));
  } catch (err) {
    console.error('[Card 2 Error: Northmoor & Saltmoor]', err);
    evals.push({ name: 'Northmoor & Saltmoor', severity: 4, status: 'OFFLINE', isOffline: true });
    container.appendChild(createMoorFallbackCard({
      title: 'Northmoor & Saltmoor',
      cardId: 'card-52158',
      stationId: '52158',
      error: err
    }));
  }

  // Card 3: Sowy Relief Channel
  try {
    const sowyTrigger = hydroConfig?.moors?.sowy_channel?.sluices?.[0]?.diversion_threshold_mAOD ?? HYDRO_THRESHOLDS.MONKS_LEAZE.TRIGGER_MAOD;
    const monksSill = hydroConfig?.moors?.sowy_channel?.sluices?.[0]?.sill_elevation_mAOD ?? HYDRO_THRESHOLDS.MONKS_LEAZE.SILL_MAOD;
    const sowyEval = evaluateSowyChannel(monksUpLevel, monksDownLevel, sowyTrigger, {
      sillM: monksSill,
      isDownstreamFlatlined: monksDownFreshness.isFlatlined,
      isDownstreamStale: monksDownFreshness.isStale || monksDownFreshness.isOffline,
      beerwallRate1h: beerWallRates.rate_1h_m_per_hr,
      beerwallStage: beerWallLevel
    });
  if (sowyIsStale && (sowyEval.badgeClass === 'badge-secure' || sowyEval.badgeClass === 'badge-open' || sowyEval.code === 'CLOSED' || sowyEval.code === 'GRAVITY_OPEN')) {
    sowyEval.badgeClass = sowyStaleInfo.badgeClass || 'badge-stale';
    sowyEval.symbol = sowyStaleInfo.isOffline ? '⚠️' : '🕒';
    sowyEval.label = `${sowyEval.label} (UNCONFIRMED - ${sowyStaleInfo.isOffline ? 'OFFLINE' : 'STALE'})`;
  }
  const hasHealthyDownstream = Boolean(sowyEval.isDownstreamHealthy);
  const headDropMeters = hasHealthyDownstream ? Number((monksUpLevel - monksDownLevel).toFixed(2)) : null;
  const headDropFormatted = hasHealthyDownstream
    ? formatHeadDelta(headDropMeters)
    : (monksDownFreshness.isFlatlined ? 'Unavailable (52234 reading static)' : 'Unavailable');
  const oathLock = hasHealthyDownstream
    ? evaluateOathLock(monksUpLevel, monksDownLevel)
    : { statusText: '⚪ UNCONFIRMED (52234 Degraded)', narrative: 'Downstream Sowy sensor (52234) is reading static, stale or offline; Oath Lock differential head cannot be verified.' };
  const beerWallSowyEval = evaluateBeerWall(beerWallLevel, HYDRO_THRESHOLDS.BEERWALL.CREST_MAOD);
  // [RULE-THRESH-01] Allermoor's own crest is unsurveyed: the ~7.50m figure is Beasley's Spillway
  // guidance used as a proxy only, so no OVERTOPPING / NEAR CREST / SECURE status is declared.
  const allermoorProxy = sowyEval.allermoor_spillway?.proxy_trigger_mAOD;
  const allermoorProxyText = Number.isFinite(allermoorProxy) ? allermoorProxy.toFixed(2) : null;
  const allermoorStatusText = allermoorProxyText === null
    ? '⚠️ Crest pending EA Asset Survey'
    : (monksUpLevel >= allermoorProxy
      ? `⚠️ Crest pending EA Asset Survey • Parrett is above the ~${allermoorProxyText}m AOD guidance proxy`
      : `⚠️ Crest pending EA Asset Survey • Parrett is ${Number((allermoorProxy - monksUpLevel).toFixed(2)).toFixed(2)}m below the ~${allermoorProxyText}m AOD guidance proxy`);

  const sowyHeroBanner = renderHeroSpillwayBanner({
    icon: '🚰',
    title: "Monk's Leaze Clyse Intake Control",
    statusBadge: sowyEval,
    mainMetricValue: hasHealthyDownstream ? headDropFormatted : `${monksUpLevel.toFixed(2)}m`,
    mainMetricUnit: hasHealthyDownstream ? 'Head Drop (Parrett ➔ Sowy)' : 'Parrett Stage (52234 Degraded)',
    clearanceText: `Intake Sill: ${monksSill.toFixed(2)}m AOD • Trigger: ${sowyTrigger.toFixed(2)}m AOD`,
    minLevel: monksSill,
    maxLevel: Number((STATION_REGISTRY['52233'].alert_level_mAOD + 0.10).toFixed(2)),
    currentLevel: monksUpLevel,
    minLabel: `Intake Sill: ${monksSill.toFixed(2)}m`,
    maxLabel: `Parrett Stage: ${monksUpLevel.toFixed(2)}m AOD`,
    isAlert: false,
    staleInfo: sowyStaleInfo,
    stats: [
      { label: 'Inferred Clyse State', htmlValue: getSluiceHeroStateText(sowyEval.status) },
      { label: 'Intake Head Drop', value: hasHealthyDownstream ? `${headDropMeters >= 0 ? '+' : ''}${headDropMeters.toFixed(2)}m` : 'Unavailable' }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#monksleaze',
      title: 'View 3-min EA Snapshot Camera at thecfh.org#monksleaze',
      ariaLabel: 'View 3-min EA Snapshot Camera at thecfh.org for Monk\'s Leaze Clyse'
    }
  });

  const sowyPumpGauge = renderSluiceOperationalGauge(sowyEval, {
    upStage: monksUpLevel,
    downStage: monksDownLevel,
    upFreshness: monksUpFreshness,
    downFreshness: monksDownFreshness,
    triggerM: sowyTrigger,
    sillM: monksSill
  });

  container.appendChild(createMoorCard({
    title: "Sowy Relief Channel",
    cardId: "card-52233",
    stationId: "52233",
    cameraGuideSite: "monksleaze",
    visualEvidenceEvent: evidenceByAsset.get('monks_leaze_clyse') || evidenceByAsset.get('allermoor_spillway') || evidenceByAsset.get('beer_wall') || null,
    heroBanner: sowyHeroBanner,
    pumpGauge: sowyPumpGauge,
    riverTag: `Diverts: Parrett ➔ Sedgemoor Drain (${renderJargonTerm('KSD')}) (${regime.label})`,
    eval: sowyEval,
    staleInfo: sowyStaleInfo,
    provenanceTag: hasHealthyDownstream ? "📡 DEDICATED SENSORS" : "⚠️ 52234 DEGRADED",
    provenanceClass: hasHealthyDownstream ? "prov-high" : "prov-med",
    metricText: hasHealthyDownstream ? `Sowy Level: ${monksDownLevel.toFixed(2)}m AOD` : `Parrett Level: ${monksUpLevel.toFixed(2)}m AOD`,
    clearanceText: hasHealthyDownstream
      ? `Head Drop Across ${renderJargonTerm('Clyse')}: ${headDropFormatted} (${monksUpLevel.toFixed(3)}m ➔ ${monksDownLevel.toFixed(3)}m)`
      : `Head Drop Across ${renderJargonTerm('Clyse')}: ${headDropFormatted} (Parrett ${monksUpLevel.toFixed(2)}m)`,
    narrative: sowyEval.narrative,
    pills: [
      {
        html: `<strong>Monk's Leaze ${renderJargonTerm('Clyse')} (52233):</strong> ${sowyEval.pillText}`,
        tooltip: `📍 Concrete Sill: 4.20m AOD • Headwall: 6.70m AOD • EA Diversion Trigger: 7.20m AOD • Sowy Cap: 7.60m AOD`
      },
      {
        html: `<strong>Allermoor Spillway (Parrett ➔ Sowy):</strong> ${allermoorStatusText} <small style="color:#94a3b8;">(Proxy: Beasley's ${allermoorProxyText ?? '7.50'}m)</small>`,
        tooltip: `📍 The ~7.50m AOD figure is Beasley's Spillway guidance, used only as a proxy and not to declare overtopping. Allermoor's own crest level is not published (pending EA Asset Survey). Under EA protocol, when running, EA protocol closes Monk's Leaze Clyse and curtails upstream tributary pumping at Huish Episcopi, Midelney & Long Load.`
      },
      {
        html: `<strong>Oath Lock ${renderJargonTerm('Penning')} Sluice:</strong> ${oathLock.statusText} (Inferred from Δh ${headDropFormatted})`,
        tooltip: `📍 Oath Lock Twin Radial Gates: Inferred from Monk's Leaze differential head (${oathLock.narrative})`
      },
      {
        html: `<strong>Sowy Spur &amp; Lang Acre Tilting Weirs (52157):</strong> ${beerWallLevel >= HYDRO_THRESHOLDS.BEERWALL.KSD_CONVEYANCE_MAOD ? '🔵 ACTIVE CONVEYANCE TO ' + renderJargonTerm('KSD') : '⚪ ' + renderJargonTerm('Penning') + ' LEVEL'} (Greylake ${beerWallLevel.toFixed(2)}m / ${HYDRO_THRESHOLDS.BEERWALL.KSD_CONVEYANCE_MAOD.toFixed(2)}m Trigger)`,
        tooltip: `📍 Driven by Beer Wall Upstream (Station 52157). Sowy Spur & Lang Acre tilting weirs lower above ${HYDRO_THRESHOLDS.BEERWALL.KSD_CONVEYANCE_MAOD.toFixed(2)}m AOD to convey flows into King's Sedgemoor Drain.`
      },
      {
        html: `<strong>Beer Wall Culverts &amp; Beazeley Spillway (52157):</strong> ${beerWallSowyEval.statusText} (Greylake ${beerWallLevel.toFixed(2)}m AOD / ${HYDRO_THRESHOLDS.BEERWALL.CREST_MAOD.toFixed(2)}m Box Culverts)`,
        tooltip: `📍 4-bay A372 concrete box culverts at ${HYDRO_THRESHOLDS.BEERWALL.CREST_MAOD.toFixed(2)}m AOD (decoupled from >${HYDRO_THRESHOLDS.BEERWALL.A372_CROWN_MAOD.toFixed(2)}m A372 road crown). Beazeley Spillway crest: pending EA Asset Survey.`
      },
      `<strong>Upstream Tributary Inflow:</strong> River Yeo: ${huishLevel.toFixed(2)}m AOD | River Isle: ${midelneyLevel.toFixed(2)}m AOD`
    ],
    camLinks: [
      { label: "Monk's Leaze Clyse", url: "https://thecfh.org/parretttonewsom.php#monksleaze", title: "View 3-min EA Snapshot Camera at Monk's Leaze Clyse" },
      { label: "Oath Lock Penning Sluice", url: "https://thecfh.org/parretttonewsom.php#oath", title: "View 3-min EA Snapshot Camera at Oath Lock Penning Sluice" },
      { label: "Beer Wall & Beazeley", url: "https://thecfh.org/parretttonewsom.php#Beerwall", title: "View 3-min EA Snapshot Camera at Beer Wall Culverts & Beazeley Spillway" }
    ],
    sparkline: renderSingleSparkline(monksDownHistory, sowyIsStale ? '#f59e0b' : '#38bdf8', { streamLabel: 'Monk\'s Leaze Downstream Sowy', stationId: '52234', unit: 'mAOD' }),
    gauges: [
      {
        name: "Monk's Leaze River Level",
        id: "52233",
        value: `${monksUpLevel.toFixed(2)}m AOD`,
        history: monksUpHistory,
        color: monksUpFreshness.isStale ? "#f59e0b" : "#4ade80",
        link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html",
        staleTag: monksUpFreshness.isStale ? (monksUpFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${monksUpFreshness.ageHours}h)`) : null
      },
      {
        name: "Monk's Leaze Downstream Sowy",
        id: "52234",
        value: `${monksDownLevel.toFixed(2)}m AOD`,
        history: monksDownHistory,
        color: monksDownFreshness.isStale ? "#f59e0b" : "#38bdf8",
        link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52234.html",
        staleTag: monksDownFreshness.isStale ? (monksDownFreshness.isOffline ? '⚠️ OFFLINE' : (monksDownFreshness.isFlatlined ? '⚠️ READING STATIC' : `⚠️ STALE (${monksDownFreshness.ageHours}h)`)) : null
      },
      {
        name: "Beer Wall Upstream (Greylake)",
        id: "52157",
        value: `${beerWallLevel.toFixed(2)}m AOD`,
        history: beerWallHistory,
        color: beerWallFreshness.isStale ? "#f59e0b" : "#38bdf8",
        link: "https://check-for-flooding.service.gov.uk/station/3067",
        staleTag: beerWallFreshness.isStale ? (beerWallFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${beerWallFreshness.ageHours}h)`) : null
      }
    ],
    extLinks: [
      { label: "🗺️ View on River Map ↗", url: "topology.html?station=52233" },
      { label: "📷 Live Sowy Channel Webcams (thecfh.org#monksleaze) ↗", url: "https://thecfh.org/parretttonewsom.php#monksleaze" },
      { label: "EA Upstream (52233) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html" },
      { label: "EA Downstream (52234) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52234.html" },
      { label: "📊 GOV.UK KSD Stage (9499) ↗", url: "https://check-for-flooding.service.gov.uk/station/9499" }
    ]
  }));
  } catch (err) {
    console.error('[Card 3 Error: Sowy Channel]', err);
    evals.push({ name: 'Sowy Relief Channel', severity: 4, status: 'OFFLINE', isOffline: true });
    container.appendChild(createMoorFallbackCard({
      title: 'Sowy Relief Channel & Sedgemoor Drain',
      cardId: 'card-52233',
      stationId: '52233',
      error: err
    }));
  }

  // Card 4: Dunball Sea Outfall
  try {
    const dunballGate = evaluateGateState(dunballInland, dunballSea, 1.0);
    isTideLocked = dunballSea >= dunballInland;
  const dunballEmergencyThreshold = isSummerRegime ? 3.10 : 2.80;
  const dunballEmergencyPump = evaluateDunballEmergencyPumping(dunballInland, isTideLocked, dunballEmergencyThreshold);
  const dunballPumpGaugeEval = getPumpEvaluation('dunball_mobile_ps', dunballInland, 'dunball_outfall', 'Dunball Emergency Pumps', 4);
  const dunballTriggerDelta = getPumpTriggerDelta(dunballPumpGaugeEval, dunballInland);
  const dunballPumpPillMode = dunballPumpGaugeEval.stage === 0 ? '⚪ STANDBY' :
    (dunballPumpGaugeEval.mode === 'PARTIAL_DUTY' ? '🟢 LEAD DUTY' :
    (dunballPumpGaugeEval.mode === 'FULL_CAPACITY' ? '🟢 FULL DUTY' :
    (dunballPumpGaugeEval.mode === 'MOBILE_ORDERED' ? '🟡 MOBILE ORDERED' :
    (dunballPumpGaugeEval.mode === 'EMERGENCY_MOBILE_ACTIVE' ? '🔴 MOBILE ACTIVE' : '🚨 CRITICAL'))));

  const dunballStatusBadge = isTideLocked ? 
    { label: "TIDE-LOCKED", badgeClass: "badge-tide-locked", symbol: "🕒" } :
    (dunballIsStale ?
      { label: `DISCHARGING (UNCONFIRMED - ${dunballStaleInfo.isOffline ? 'OFFLINE' : 'STALE'})`, badgeClass: dunballStaleInfo.badgeClass || "badge-stale", symbol: dunballStaleInfo.isOffline ? "⚠️" : "🕒" } :
      { label: "DISCHARGING", badgeClass: "badge-secure", symbol: "✓" });

  const tideDiff = dunballInland - dunballSea;
  const dunballHeroBanner = renderHeroSpillwayBanner({
    icon: '🚪',
    title: 'Dunball Sea Outfall Doors',
    statusBadge: dunballStatusBadge,
    mainMetricValue: dunballSea.toFixed(2),
    mainMetricUnit: 'm AOD (Parrett Estuary)',
    clearanceText: `Inland ${renderJargonTerm('KSD')}: ${dunballInland.toFixed(2)}m AOD`,
    minLevel: Math.min(dunballSea, dunballInland) - 0.5,
    maxLevel: Math.max(dunballSea, dunballInland) + 0.5,
    currentLevel: dunballSea,
    minLabel: `Inland: ${dunballInland.toFixed(2)}m`,
    maxLabel: `Tide: ${dunballSea.toFixed(2)}m AOD`,
    isAlert: dunballSea >= 6.50,
    staleInfo: dunballStaleInfo,
    stats: [
      { label: 'Sea Door State', htmlValue: isTideLocked ? '🟡 TIDE-LOCKED' : (dunballIsStale ? '🟡 UNCONFIRMED DISCHARGE' : '🟢 GRAVITY DISCHARGE OPEN') },
      { label: 'Head Differential', value: formatHeadDelta(tideDiff) }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#dunball',
      title: 'View 3-min EA Snapshot Camera at thecfh.org#dunball',
      ariaLabel: 'View 3-min EA Snapshot Camera at thecfh.org for Dunball Outfall'
    }
  });

  container.appendChild(createMoorCard({
    title: "Dunball Sea Outfall",
    cardId: "card-52163",
    stationId: "52163",
    cameraGuideSite: "dunball",
    visualEvidenceEvent: evidenceByAsset.get('dunball_outfall') || null,
    heroBanner: dunballHeroBanner,
    riverTag: `Outfall: Sedgemoor Drain ➔ Parrett Estuary (${regime.label})`,
    eval: dunballStatusBadge,
    staleInfo: dunballStaleInfo,
    provenanceTag: "⚖️ HYDROSTATIC LAW",
    provenanceClass: "prov-high",
    metricText: `Sea Tide: ${dunballSea.toFixed(2)}m AOD`,
    clearanceText: `Inland Drain: ${dunballInland.toFixed(2)}m AOD`,
    narrative: isTideLocked ? 
      `High sea tide in Parrett Estuary (${dunballSea.toFixed(2)}m) exceeds inland drain (${dunballInland.toFixed(2)}m). Passive flap doors shut under reverse hydrostatic pressure.` :
      (dunballIsStale ?
        `Telemetry unconfirmed (${dunballStaleInfo.badgeText}). Flap doors inferred from fallback baseline.` :
        `Seawater level below inland drain. Positive head differential opens flap doors for gravity discharge.`),
    pills: [
      {
        html: `<strong>Dunball Flap Doors:</strong> ${isTideLocked ? '🕒 TIDE-LOCKED (SEA HEAD)' : (dunballIsStale ? '🟡 UNCONFIRMED DISCHARGE' : '🟢 GRAVITY DISCHARGING')}`,
        tooltip: `📍 Dunball Primary ${renderJargonTerm('Clyse')} Outfall`
      },
      `<strong>Dunball ${renderJargonTerm('Penning')} Barrier:</strong> ${isTideLocked ? '🔒 PENNING / SURGE SEALED' : '🟢 OPEN FOR DISCHARGE'}`,
      {
        html: `<strong>Emergency High-Volume Pumps:</strong> ${dunballPumpPillMode} (KSD ${dunballInland.toFixed(2)}m • ${dunballTriggerDelta.statusText})`,
        tooltip: `📍 Dunball Mobile Pumps: Driven by inland King's Sedgemoor Drain stage (E9094) during tide-lock.`
      }
    ],
    camLinks: [
      { label: "Dunball Clyse Outfall", url: "https://thecfh.org/parretttonewsom.php#dunball", title: "View 3-min EA Snapshot Camera at Dunball Outfall" }
    ],
    sparkline: renderDualSparkline(seaHistory, inlandHistory, isTideLocked, {
      secondaryName: 'Sea',
      primaryName: 'Inland',
      secondaryColor: '#0284c7',
      primaryColor: '#38bdf8',
      showTideLock: true,
      statusPill: isTideLocked ? '🔒 Tide-Locked Window' : '✓ Gravity Discharge',
      streamLabel: `<span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">Inland KSD (E9094) [Gravity Drain]</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#0284c7; color:#0284c7"></span><span class="sparkline-title">Sea Tide (52163) [Parrett Estuary]</span>`
    }),
    pumpGauge: renderPumpTriggerGauge(dunballPumpGaugeEval, {
      stationId: 'E9094',
      stationName: "King's Sedgemoor Drain",
      riverName: 'Parrett Estuary',
      currentLevel: dunballInland,
      color: '#38bdf8',
      isStale: dunballInlandFreshness.isStale,
      roleTag: 'Internal Gravity Drain'
    }),
    gauges: [
      {
        name: "Dunball Tidal Parrett",
        id: "52163",
        value: `${dunballSea.toFixed(2)}m AOD`,
        history: seaHistory.map(h => h.value),
        color: "#0284c7",
        link: "https://check-for-flooding.service.gov.uk/station/9129",
        staleTag: dunballSeaFreshness.isStale ? (dunballSeaFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${dunballSeaFreshness.ageHours}h)`) : null
      },
      {
        name: "Dunball Inland KSD",
        id: "E9094",
        value: `${dunballInland.toFixed(2)}m AOD`,
        history: inlandHistory.map(h => h.value),
        color: "#38bdf8",
        link: "https://check-for-flooding.service.gov.uk/station/9499",
        staleTag: dunballInlandFreshness.isStale ? (dunballInlandFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${dunballInlandFreshness.ageHours}h)`) : null
      }
    ],
    extLinks: [
      { label: "🗺️ View on River Map ↗", url: "topology.html?station=52163" },
      { label: "📷 Live Dunball Webcams (thecfh.org#dunball) ↗", url: "https://thecfh.org/parretttonewsom.php#dunball" },
      { label: "📊 GOV.UK KSD Stage (9499) ↗", url: "https://check-for-flooding.service.gov.uk/station/9499" },
      { label: "📊 GOV.UK Tidal Stage (9129) ↗", url: "https://check-for-flooding.service.gov.uk/station/9129" },
      { label: "EA Data (E9094) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/E9094.html" }
    ]
  }));
  } catch (err) {
    console.error('[Card 4 Error: Dunball Sea Outfall]', err);
    evals.push({ name: 'Dunball Sea Outfall', severity: 4, status: 'OFFLINE', isOffline: true });
    container.appendChild(createMoorFallbackCard({
      title: 'Dunball Clyse & Sea Outfall',
      cardId: 'card-52163',
      stationId: 'E9094',
      error: err
    }));
  }

  // Card 5: Langport Confluence & Tributaries
  try {
    const huishEval = evaluateHuishEpiscopi(huishLevel, isSummerRegime);
  const midelneyEval = evaluateMidelney(midelneyLevel, monksUpLevel);
  evals.push({ name: "Langport Confluence", severity: Math.min(huishEval.severity, midelneyEval.severity) });

  const huishPump = getPumpEvaluation('huish_episcopi_ps', huishLevel, 'langport_confluence', 'Huish Episcopi PS', 4);

  const muchelneyActive = activeEventsMap.get('muchelney_access');
  const huishTrend = computeTrendVector(huishReadings);
  const huishClearanceFormatted = formatClearanceText(8.20 - huishLevel, 'cut-off level');
  const huishClearanceWithTrend = `${huishClearanceFormatted} (${huishTrend})${muchelneyActive?.duration_formatted ? ` • ⏱️ ${muchelneyActive.duration_formatted}` : ''}`;

  let confluenceBadge = huishEval.isPumpsCutoff ?
    { label: 'PUMPS CUT-OFF', badgeClass: 'badge-critical', symbol: '🔒' } :
    (huishEval.code === 'ALERT' ?
      { label: 'FLOOD ALERT', badgeClass: 'badge-alert', symbol: '▲' } :
      (confluenceIsStale ?
        { label: `CONFLUENCE CONVEYING (UNCONFIRMED - ${confluenceStaleInfo.isOffline ? 'OFFLINE' : 'STALE'})`, badgeClass: confluenceStaleInfo.badgeClass || 'badge-stale', symbol: confluenceStaleInfo.isOffline ? '⚠️' : '🕒' } :
        { label: 'CONFLUENCE CONVEYING', badgeClass: 'badge-secure', symbol: '✓' }));

  const confluenceHeroBanner = renderHeroSpillwayBanner({
    icon: '🔀',
    title: 'Langport Confluence Gateways',
    statusBadge: confluenceBadge,
    mainMetricValue: huishLevel.toFixed(2),
    mainMetricUnit: 'm AOD (River Yeo @ Huish)',
    clearanceText: huishClearanceWithTrend,
    minLevel: 5.80,
    maxLevel: 8.20,
    currentLevel: huishLevel,
    minLabel: 'Baseflow: 5.80m',
    maxLabel: 'Bankfull Cut-off: 8.20m AOD',
    isAlert: huishEval.isPumpsCutoff || huishEval.code === 'ALERT',
    staleInfo: confluenceStaleInfo,
    stats: [
      { label: 'Cut-off Clearance', value: huishClearanceWithTrend },
      { label: 'Huish PS Status', htmlValue: huishEval.isPumpsCutoff ? '🔒 PUMPS LOCKED OUT (≥8.20m)' : (huishEval.code === 'ALERT' ? '▲ FLOOD ALERT (≥8.48m)' : '⚪ STANDBY (<8.20m Cut-off)') },
      { label: 'River Isle (Midelney)', htmlValue: `${midelneyLevel.toFixed(2)}m AOD (${midelneyEval.isHeadLocked ? '🕒 HEAD-LOCKED' : '🟢 GRAVITY'})` }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#huish',
      title: 'View EA Snapshot Camera at thecfh.org for Huish Episcopi',
      ariaLabel: 'View EA Snapshot Camera at thecfh.org for Huish Episcopi'
    }
  });

  container.appendChild(createMoorCard({
    title: "Langport Confluence & Tributaries",
    cardId: "card-52120",
    stationId: "52120",
    cameraGuideSite: "currymoor",
    visualEvidenceEvent: evidenceByAsset.get('muchelney_access') || null,
    heroBanner: confluenceHeroBanner,
    riverTag: `Catchment: River Yeo & Isle Confluence (${regime.label})`,
    eval: confluenceBadge,
    staleInfo: confluenceStaleInfo,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `Yeo: ${huishLevel.toFixed(2)}m | Isle: ${midelneyLevel.toFixed(2)}m AOD`,
    clearanceText: `Cut-off Margin: ${huishEval.clearanceText}`,
    narrative: `${huishEval.narrative} Midelney (River Isle at ${midelneyLevel.toFixed(2)}m AOD): ${midelneyEval.isHeadLocked ? 'Head-locked by high Parrett stage.' : 'Free gravity discharge to Parrett.'}`,
    pills: [
      {
        html: `<strong>Huish Episcopi Pumping Station:</strong> ${huishEval.isPumpsCutoff ? '🔒 LOCKED OUT (Yeo ≥ 8.20m AOD)' : '⚪ GRAVITY DISCHARGE / STANDBY (< 8.20m Cut-off)'}`,
        tooltip: `📍 Huish Episcopi PS: Receiving River Yeo cut-off interlock at 8.20m AOD (internal Wet Moor drain triggers pending EA survey)`
      },
      {
        html: `<strong>Yeo Bankfull Cut-off:</strong> ${huishEval.clearanceText} (Limit: 8.20m AOD)`,
        tooltip: `📍 8.20m AOD bankfull interlock: Huish permanent pumps lock out to protect Parrett defences`
      },
      {
        html: `<strong>Midelney PS & Sluice (River Isle):</strong> ${midelneyEval.isHeadLocked ? '🕒 HEAD-LOCKED BY PARRETT' : '🟢 GRAVITY DISCHARGE'}`,
        tooltip: `📍 Midelney: Gravity flap doors close when Parrett exceeds Isle stage`
      },
      `<strong>Monk's Leaze Relief Nexus:</strong> Diversion reduces Parrett backwater on Yeo/Isle confluence`
    ],
    camLinks: [
      { label: "Huish Episcopi PS", url: "https://thecfh.org/parretttonewsom.php#huish", title: "View EA Snapshot Camera at Huish Episcopi" }
    ],
    sparkline: renderDualSparkline(midelneyHistory, huishHistory, false, {
      secondaryName: 'Isle',
      primaryName: 'Yeo',
      secondaryColor: midelneyFreshness.isStale ? '#f59e0b' : '#38bdf8',
      primaryColor: huishFreshness.isStale ? '#f59e0b' : '#4ade80',
      streamLabel: '<span class="stream-dot" style="background:#4ade80; color:#4ade80"></span><span class="sparkline-title">River Yeo (52120)</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">River Isle (52153)</span>',
      showTideLock: false,
      statusPill: midelneyEval.isHeadLocked ? '🕒 Head-Locked by Parrett' : (confluenceIsStale ? '⚠️ Unconfirmed Conveyance' : '✓ Confluence Conveying')
    }),
    pumpGauge: renderPumpTriggerGauge(huishPump, {
      stationId: '52120',
      stationName: 'River Yeo @ Huish Episcopi',
      riverName: 'River Parrett',
      currentLevel: huishLevel,
      color: '#4ade80',
      isStale: huishFreshness.isStale,
      roleTag: 'Confluence Tributary'
    }),
    gauges: [
      {
        name: "Huish Episcopi PS (River Yeo)",
        id: "52120",
        value: `${huishLevel.toFixed(2)}m AOD`,
        history: huishHistory.map(h => h.value),
        color: huishFreshness.isStale ? "#f59e0b" : "#4ade80",
        link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52120.html",
        staleTag: huishFreshness.isStale ? (huishFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${huishFreshness.ageHours}h)`) : null
      },
      {
        name: "Midelney (River Isle)",
        id: "52153",
        value: `${midelneyLevel.toFixed(2)}m AOD`,
        history: midelneyHistory.map(h => h.value),
        color: midelneyFreshness.isStale ? "#f59e0b" : "#38bdf8",
        link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52153.html",
        staleTag: midelneyFreshness.isStale ? (midelneyFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${midelneyFreshness.ageHours}h)`) : null
      }
    ],
    extLinks: [
      { label: "🗺️ View on River Map ↗", url: "topology.html?station=52120" },
      { label: "EA Data (52120) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52120.html" },
      { label: "EA Data (52153) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52153.html" },
      { label: "📊 GOV.UK Huish Stage (3071) ↗", url: "https://check-for-flooding.service.gov.uk/station/3071" }
    ]
  }));
  } catch (err) {
    console.error('[Card 5 Error: Langport Confluence]', err);
    evals.push({ name: 'Langport Confluence', severity: 4, status: 'OFFLINE', isOffline: true });
    container.appendChild(createMoorFallbackCard({
      title: 'Langport Confluence & Tributaries',
      cardId: 'card-52120',
      stationId: '52120',
      error: err
    }));
  }

  // Restore any technical telemetry drawers that were open prior to the 60s re-render
  openDrawers.forEach((cardId) => {
    const cardEl = document.getElementById(cardId);
    const drawer = cardEl?.querySelector('.drawer-content');
    if (drawer) drawer.classList.add('open');
  });

  // Render Telemetry State Transitions & Visual Evidence Ledger [Issue #24]
  if (allCatalogEvents.length > 0) {
    container.appendChild(renderEventsTimeline(allCatalogEvents));
  }

  // Global Status Banner Render
  const globalStat = aggregateGlobalStatus(evals, isTideLocked);
  const counterPillElem = document.getElementById('counter-pill');
  if (counterPillElem) counterPillElem.innerText = globalStat.counterPill;

  const alertBannerElem = document.getElementById('alert-banner');
  if (alertBannerElem) {
    alertBannerElem.innerText = globalStat.bannerText;
    const topSev = globalStat.topSeverity ?? 5;
    if (topSev <= 2) {
      alertBannerElem.className = 'alert-banner banner-critical';
    } else if (topSev === 3 || topSev === 4) {
      alertBannerElem.className = 'alert-banner banner-alert';
    } else {
      alertBannerElem.className = 'alert-banner banner-secure';
    }
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const updatedPill = document.getElementById('updated-at-pill');
  if (updatedPill) {
    updatedPill.innerHTML = `⏱️ Synced ${timeStr}`;
  }

  // Update print situation header timestamp
  const printTimeEl = document.getElementById('print-time-stamp');
  if (printTimeEl) {
    printTimeEl.textContent = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  // Bind synchronized crosshair & tooltip event listeners across all cards
  bindSparklineEvents(container);

  // Smooth-scroll and focus target card if URL hash is present (Issue #17 Deep Linking)
  if (typeof window !== 'undefined' && window.location && window.location.hash) {
    try {
      const hashTarget = document.querySelector(window.location.hash);
      if (hashTarget) {
        hashTarget.scrollIntoView({ behavior: 'smooth' });
        hashTarget.focus();
      }
    } catch (e) {
      // Ignore invalid selector in hash
    }
  }
  } finally {
    isRefreshing = false;
    refreshController.isRefreshing = false;
    if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'false');
    updateCountdownDisplay();
  }
}

/**
 * Creates an accessible fallback card when moor telemetry is offline or corrupted [WP 1.4]
 */
export function createMoorFallbackCard(opts) {
  const card = document.createElement('article');
  card.className = 'moor-card card-fallback';
  card.setAttribute('role', 'alert');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${opts.title || 'Moor Station'} Telemetry Offline`);
  if (opts.cardId) card.id = opts.cardId;
  else if (opts.stationId) card.id = `card-${opts.stationId}`;
  card.style.minHeight = '280px';

  const fallbackCardId = opts.cardId || (opts.stationId ? `card-${opts.stationId}` : '');
  const fallbackEaWarningStripHtml = buildCardEAWarningStripHtml(fallbackCardId, opts.eaWarnings || latestActiveEAWarnings);

  card.innerHTML = `
    <div class="moor-card-header">
      <div class="moor-title-group">
        <span class="card-icon" aria-hidden="true">⚠️</span>
        <h3 class="moor-title">${escapeHTML(opts.title || 'Station Telemetry')}</h3>
      </div>
      <div class="status-pill status-alert">⚠️ TELEMETRY OFFLINE</div>
    </div>
    ${fallbackEaWarningStripHtml}
    <div class="card-fallback-body">
      <p class="card-fallback-text"><strong>Data Degraded:</strong> Real-time sensor readings for this station could not be processed safely or telemetry is currently offline.</p>
      <div class="card-fallback-links">
        <p>For verified flood warnings and travel conditions, please consult:</p>
        <div class="fallback-links-group">
          <a href="https://www.travelsomerset.co.uk" target="_blank" rel="noopener noreferrer" class="fallback-link">🚗 Travel Somerset ↗</a>
          <a href="https://check-for-flooding.service.gov.uk" target="_blank" rel="noopener noreferrer" class="fallback-link">🌊 GOV.UK Flood Warnings ↗</a>
        </div>
      </div>
    </div>
  `;
  return card;
}

const dashboardStaffGaugeState = new Map();
const stationFreshnessById = new Map();
const boundStaffGaugeContainers = new WeakSet();
let latestActiveEAWarnings = [];

/** Clears cached dashboard staff-gauge panel state (intended for test isolation). */
export function resetDashboardStaffGaugeState() {
  dashboardStaffGaugeState.clear();
  stationFreshnessById.clear();
}

/**
 * Re-derives the freshness notice for an (possibly cached) dashboard staff-gauge panel so it
 * never shows a notice that was true when the panel was first opened but is stale now.
 */
function syncDashboardStaffGaugeNotice(panel, entry, stationId) {
  const freshness = stationFreshnessById.get(String(stationId)) || { isOffline: false, isStale: false, isFlatlined: false };
  const mode = getStaffGaugePanelMode(entry, freshness);
  let noticeP = panel.querySelector?.('.staff-gauge-notice') || null;
  if (!mode.notice) {
    if (noticeP) noticeP.remove();
    return;
  }
  if (!noticeP) {
    noticeP = document.createElement('p');
    noticeP.className = 'staff-gauge-status staff-gauge-warning staff-gauge-notice';
    const copyP = panel.querySelector?.('.staff-gauge-copy');
    if (copyP && typeof panel.insertBefore === 'function') panel.insertBefore(noticeP, copyP);
    else panel.appendChild(noticeP);
  }
  noticeP.textContent = mode.notice;
}

function createDashboardStaffGaugePanel(entry, stationId) {
  const freshness = stationFreshnessById.get(String(stationId)) || { isOffline: false, isStale: false, isFlatlined: false };
  const mode = getStaffGaugePanelMode(entry, freshness);

  const panel = document.createElement('section');
  panel.className = 'staff-gauge-panel';
  panel.setAttribute('aria-label', 'Staff gauge camera view');

  const copyP = document.createElement('p');
  copyP.className = 'staff-gauge-status staff-gauge-copy';
  copyP.textContent = getStaffGaugePanelCopy(entry);
  panel.appendChild(copyP);
  syncDashboardStaffGaugeNotice(panel, entry, stationId);

  const body = document.createElement('div');
  body.className = 'staff-gauge-body';
  panel.appendChild(body);

  return { panel, body };
}

/**
 * Delegates on-demand staff-gauge camera button clicks on a stable card container
 * so 60s innerHTML card rebuilds never drop click handlers or reload active frames.
 */
export function initDashboardStaffGaugeTriggers(container) {
  if (!container || boundStaffGaugeContainers.has(container)) return;
  boundStaffGaugeContainers.add(container);

  container.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('.staff-gauge-load');
    if (!btn) return;
    const cameraId = btn.getAttribute('data-staff-gauge-camera');
    const stationId = btn.getAttribute('data-staff-gauge-station');
    if (!cameraId || !stationId) return;

    const entry = getStaffGaugeCameraForStation(stationId);
    if (!entry || entry.confidence === 'low' || entry.camera_id !== cameraId) return;

    const slot = btn.closest('.staff-gauge-slot');
    if (!slot) return;

    let state = dashboardStaffGaugeState.get(cameraId);
    if (!state) {
      const { panel, body } = createDashboardStaffGaugePanel(entry, stationId);
      state = { panel, body, isOpen: true };
      dashboardStaffGaugeState.set(cameraId, state);
      slot.appendChild(panel);
      btn.setAttribute('aria-expanded', 'true');
      loadFrame(entry, body);
      return;
    }

    state.isOpen = !state.isOpen;
    if (state.isOpen) {
      if (state.panel.parentNode !== slot) {
        slot.appendChild(state.panel);
      }
      btn.setAttribute('aria-expanded', 'true');
      syncDashboardStaffGaugeNotice(state.panel, entry, stationId);
      if (!state.body.querySelector?.('img.staff-gauge-frame')) {
        loadFrame(entry, state.body);
      } else {
        // Refresh the "captured X ago" caption on re-open without a loading flash
        loadFrame(entry, state.body, { silent: true });
      }
    } else {
      if (state.panel.parentNode === slot) {
        slot.removeChild(state.panel);
      }
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

/**
 * Renders a single sub-station gauge row, attaching an on-demand metric-board
 * camera button only when the gauge has a non-low-confidence camera mapping.
 */
export function renderSubStationGaugeRow(g) {
  const entry = getStaffGaugeCameraForStation(g.id);
  const hasCam = Boolean(entry && entry.confidence !== 'low');
  const camSlotHtml = hasCam ? `
    <div class="staff-gauge-slot" data-camera-id="${escapeAttr(entry.camera_id)}" data-station-id="${escapeAttr(g.id)}">
      <button type="button"
              class="ext-link-btn staff-gauge-load"
              data-staff-gauge-camera="${escapeAttr(entry.camera_id)}"
              data-staff-gauge-station="${escapeAttr(g.id)}"
              aria-expanded="false">
        📷 Camera view of the metric board
      </button>
    </div>
  ` : '';

  return `
    <div class="sub-station-gauge-card" data-station-id="${escapeAttr(g.id)}">
      <div class="sub-station-gauge-row">
        <div class="gauge-info">
          <div class="gauge-name">
            <a href="${escapeAttr(g.link)}" target="_blank" rel="noopener noreferrer" class="gauge-link" title="Verify Station ${escapeAttr(g.id)} on GOV.UK">${escapeHTML(g.name)}</a>
            <span class="gauge-id-badge">ID: ${escapeHTML(g.id)}</span>
            ${g.staleTag ? `<span class="gauge-offline-tag">${escapeHTML(g.staleTag)}</span>` : ''}
          </div>
          <div class="gauge-value">${escapeHTML(g.value)}</div>
        </div>
        <div class="gauge-sparkline-box">
          ${renderMicroSparkline(g.history, g.color)}
        </div>
      </div>
      ${camSlotHtml}
    </div>
  `;
}

export function createMoorCard(opts) {
  if (Array.isArray(opts.gauges)) {
    for (const g of opts.gauges) {
      if (g && g.id && g.freshness) {
        stationFreshnessById.set(String(g.id), g.freshness);
      }
    }
  }
  const card = document.createElement('article');
  card.className = opts.cardClass ? `moor-card ${opts.cardClass}` : 'moor-card';
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${opts.title} Infrastructure Status`);
  if (opts.cardId) {
    card.id = opts.cardId;
  } else if (opts.stationId) {
    card.id = `card-${opts.stationId}`;
  }

  let badgeClass = opts.eval?.badgeClass || '';
  let badgeSymbol = opts.eval?.symbol || '';
  let badgeLabel = opts.eval?.label || '';

  if (opts.staleInfo && opts.staleInfo.isStale) {
    if (badgeClass === 'badge-secure' || badgeClass === 'badge-passable') {
      badgeClass = opts.staleInfo.badgeClass || 'badge-stale';
      badgeSymbol = opts.staleInfo.isOffline ? '⚠️' : '🕒';
    }
  }

  // Consolidate into a single, unified hero block per card (Issue #1 UX Usability)
  // When heroBanner is present, it already renders the complete stage & clearance hero.
  // Rendering .hero-metric / .clearance-text when heroBanner exists causes redundant double-hero display.
  const standaloneHero = (!opts.heroBanner && opts.metricText) ? `
    <div class="hero-metric">${escapeHTML(opts.metricText)}</div>
    ${opts.clearanceText ? `<div class="clearance-text">${escapeHTML(opts.clearanceText)}</div>` : ''}
  ` : '';

  const staleBannerHtml = (opts.staleInfo && opts.staleInfo.isStale && opts.staleInfo.badgeText && !opts.heroBanner) ? `
    <div class="sensor-offline-banner" role="alert" aria-live="polite">
      <span>${escapeHTML(opts.staleInfo.badgeText)}</span>
    </div>
  ` : '';

  const camGuideBtn = opts.cameraGuideSite ? `
    <button type="button" class="cam-bar-btn camera-guide-trigger" data-camera-guide="${escapeAttr(opts.cameraGuideSite)}" title="Open Layperson Camera Guide for ${escapeAttr(opts.title)}">
      🧭 Camera Guide
    </button>
  ` : '';

  const evObj = opts.visualEvidenceEvent || null;
  const evCe = evObj?.camera_evidence || null;
  const evSeqCount = Array.isArray(evCe?.sequence_frames) ? evCe.sequence_frames.length : 0;
  const evIsNight = Boolean(evCe && evCe.fallback_mode === 'NIGHT_TELEMETRY' && evSeqCount === 0);
  const visualEvidenceBtn = (evObj && evCe) ? `
    <button type="button"
            class="cam-bar-btn visual-evidence-btn ${evIsNight ? 'visual-evidence-btn-night' : ''} visual-evidence-trigger"
            data-visual-evidence-event-id="${escapeAttr(String(evObj.id || ''))}"
            data-visual-evidence-asset="${escapeAttr(evObj.asset_id || '')}"
            title="${evIsNight ? 'Inspect Night Telemetry Verification' : 'Inspect Archived Event Keyframes & Transition Sequence'}">
      <span aria-hidden="true">${evIsNight ? '🌙' : '📷'}</span> ${evIsNight ? 'Night Telemetry' : `Visual Evidence${evSeqCount > 1 ? ` (${evSeqCount})` : ''}`}
    </button>
  ` : '';

  const camBarHtml = ((Array.isArray(opts.camLinks) && opts.camLinks.length > 0) || opts.cameraGuideSite || visualEvidenceBtn) ? `
    <div class="card-cam-bar" aria-label="${escapeAttr(opts.title)} Ground-Truth Cameras">
      <span class="cam-bar-label"><span aria-hidden="true">📷</span> Live Cameras:</span>
      <div class="cam-bar-links">
        ${visualEvidenceBtn}
        ${(opts.camLinks || []).map(c => `
          <a href="${escapeAttr(c.url)}" target="_blank" rel="noopener noreferrer" class="cam-bar-btn" title="${escapeAttr(c.title || c.label)}" aria-label="${escapeAttr(c.ariaLabel || c.label)}">
            ${escapeHTML(c.label)} <span class="cam-arrow" aria-hidden="true" style="color: #38bdf8; font-weight: bold; margin-left: 2px;">↗</span>
          </a>
        `).join('')}
        ${camGuideBtn}
      </div>
    </div>
  ` : '';

  const cardEaWarningStripHtml = buildCardEAWarningStripHtml(card.id, opts.eaWarnings || latestActiveEAWarnings);

  card.innerHTML = `
    <div>
      <div class="card-header">
        <div>
          <h2 class="card-title">${opts.title}</h2>
          <div class="river-tag">${opts.riverTag}</div>
        </div>
        <div class="status-badge ${badgeClass}" aria-live="polite">
          <span aria-hidden="true">${badgeSymbol}</span>
          <span class="sr-only">Status: </span>
          <span>${badgeLabel}</span>
        </div>
      </div>
      ${cardEaWarningStripHtml}
      ${staleBannerHtml}

      ${opts.heroBanner || standaloneHero}

      <div class="sparkline-container">${opts.sparkline}</div>
      <div class="narrative-text">${opts.narrative}</div>
    </div>
    <div>
      <div class="infra-footer">
        ${opts.pills.map(p => {
          if (typeof p === 'object' && p !== null) {
            const safeTooltip = escapeAttr(p.tooltip);
            const tooltipAttr = p.tooltip ? ` data-tooltip="${safeTooltip}" title="${safeTooltip}" tabindex="0"` : '';
            return `<div class="infra-pill"${tooltipAttr}>${p.html}</div>`;
          }
          return `<div class="infra-pill">${p}</div>`;
        }).join('')}
      </div>
      ${camBarHtml}
      <button class="drawer-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
        ▼ Technical Telemetry & Sub-Station Gauges
      </button>
      <div class="drawer-content">
        ${opts.pumpGauge || ''}
        <div class="drawer-section-title">Individual Gauge Telemetry & Trends</div>
        ${opts.gauges ? opts.gauges.map(g => renderSubStationGaugeRow(g)).join('') : ''}

        <div class="sub-station-row" style="margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.08);">
          <span>Data Provenance</span>
          <strong class="provenance-tag ${opts.provenanceClass || 'prov-high'}">${opts.provenanceTag || '📡 DIRECT SENSOR'}</strong>
        </div>
        ${opts.spillwayMeta ? `
        <div class="sub-station-row">
          <span>Surveyed Spillway Crest</span>
          <strong style="color: #38bdf8; font-family: monospace;">${opts.spillwayMeta.crest} ${renderJargonTerm('mAOD', 'm AOD')}</strong>
        </div>
        <div class="sub-station-row">
          <span>Survey & Scheme Origin</span>
          <strong><span class="scheme-badge">${opts.spillwayMeta.scheme}</span></strong>
        </div>
        ` : ''}
        <div class="sub-station-row">
          <span>EA Sync Cadence</span>
          <strong>15 min</strong>
        </div>
        ${opts.extLinks ? `
        <div class="ext-validation-links">
          ${opts.extLinks.map(l => `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="ext-link-btn">${l.label}</a>`).join('')}
        </div>
        ` : ''}
      </div>
    </div>
  `;

  const slots = card.querySelectorAll?.('.staff-gauge-slot[data-camera-id]');
  if (slots) {
    slots.forEach((slot) => {
      const cameraId = slot.getAttribute('data-camera-id');
      const state = cameraId ? dashboardStaffGaugeState.get(cameraId) : null;
      if (state && state.isOpen) {
        slot.appendChild(state.panel);
        const btn = slot.querySelector('.staff-gauge-load');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        // Re-check the camera on each 60s refresh so the "captured X ago" caption never goes stale
        const stationId = slot.getAttribute('data-station-id');
        const entry = getStaffGaugeCameraForStation(stationId);
        if (entry) {
          syncDashboardStaffGaugeNotice(state.panel, entry, stationId);
          loadFrame(entry, state.body, { silent: true });
        }
      }
    });
  }

  return card;
}

/**
 * Renders the Dedicated Community Roads & Access Master Card (Top-tier Strategic Anchor Card)
 * Supports all 8 monitored Somerset Levels corridors with interactive client-side filtering,
 * elapsed dry timer, daylight inspection progress bar, and ground-truth optical webcam links.
 * 
 * @param {object|null} roadEvaluations - Evaluated road network data or raw readings
 * @param {Map|object|null} [activeEventsMap=null] - Active event sessions map
 * @returns {HTMLElement} Article element containing the master road card
 */
export function renderRoadNetworkCard(roadEvaluations, activeEventsMap = null) {
  let roadData = roadEvaluations;
  if (!roadData || !roadData.corridors_list) {
    roadData = evaluateRoadNetwork(roadEvaluations || {}, activeEventsMap);
  }

  const corridors_list = Array.isArray(roadData.corridors_list) ? roadData.corridors_list : [];
  const counts = roadData.counts || {
    all: corridors_list.length,
    impassable: corridors_list.filter(c => c.status === 'IMPASSABLE').length,
    encroaching: corridors_list.filter(c => c.status === 'ENCROACHING').length,
    passable: corridors_list.filter(c => c.status === 'PASSABLE').length
  };
  const summary_badge = roadData.summary_badge || {
    status: 'PASSABLE',
    label: 'ALL 8 CORRIDORS PASSABLE',
    class: 'badge-passable',
    symbol: '🟢'
  };

  const card = document.createElement('article');
  card.className = 'moor-card road-network-card';
  card.id = 'card-road-network';
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', 'Community Roads & Access Highway Passability');

  const summaryBadgeHtml = `
    <div class="road-network-summary-badge" id="road-network-global-badge" aria-live="polite">
      <span class="status-badge ${escapeAttr(summary_badge.class || 'badge-passable')}">
        <span aria-hidden="true">${escapeHTML(summary_badge.symbol || '🟢')}</span>
        <span>${escapeHTML(summary_badge.label || 'ALL 8 CORRIDORS PASSABLE')}</span>
      </span>
    </div>
  `;

  const corridorsHtml = corridors_list.map(corridor => {
    const correlatedEvent = (activeEventsMap instanceof Map)
      ? activeEventsMap.get(corridor.asset_id)
      : (activeEventsMap && typeof activeEventsMap === 'object' ? activeEventsMap[corridor.asset_id] : null);
    return renderCorridorRow(corridor, correlatedEvent);
  }).join('');

  card.innerHTML = `
    <div class="card-header road-card-header">
      <div class="road-title-group">
        <div class="road-icon-title">
          <span class="road-header-icon" aria-hidden="true">🚗</span>
          <div>
            <h2 class="card-title">Community Roads &amp; Access</h2>
            <div class="river-tag">Somerset Levels Highway Passability &amp; Council Emergency Gates</div>
          </div>
        </div>
        ${summaryBadgeHtml}
      </div>
    </div>

    <div class="road-safety-banner" role="alert">
      <span aria-hidden="true">⚠️</span>
      <span><strong>Life-Safety Warning:</strong> Water stage estimates are theoretical inferences and do not detect physical council gate padlocks, localized silt, or ditch ponding. <strong>Never attempt to drive through floodwater.</strong> Check <a href="https://www.travelsomerset.co.uk" target="_blank" rel="noopener noreferrer">Travel Somerset ↗</a> for official highway orders.</span>
    </div>

    <div class="road-humility-notice" role="note">
      <span class="humility-icon" aria-hidden="true">ℹ️</span>
      <p>
        <strong>How Passability is Evaluated:</strong> Status combines live EA river telemetry, rate-of-rise momentum, 
        statutory flood warnings, and Somerset Council emergency gate procedures. Emergency gates are locked manually by council crews 
        and remain locked until daylight safety inspections for silt and structural scour are completed.
      </p>
    </div>

    <div class="road-filter-bar" role="toolbar" aria-label="Filter road corridors by status">
      <span class="filter-label">Filter:</span>
      <button type="button" class="road-filter-btn active" data-filter="all" aria-pressed="true">All (${counts.all || corridors_list.length})</button>
      <button type="button" class="road-filter-btn" data-filter="impassable" aria-pressed="false">🔴 Closed (${counts.impassable || 0})</button>
      <button type="button" class="road-filter-btn" data-filter="encroaching" aria-pressed="false">🟡 Caution / Clearing (${counts.encroaching || 0})</button>
      <button type="button" class="road-filter-btn" data-filter="passable" aria-pressed="false">🟢 Passable (${counts.passable || 0})</button>
    </div>

    <div class="road-corridors-list" id="road-corridors-container" role="list">
      ${corridorsHtml}
    </div>
  `;

  // Attach interactive filter event handlers
  const filterButtons = card.querySelectorAll('.road-filter-btn');
  const corridorRows = card.querySelectorAll('.road-corridor-row');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter');

      filterButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');

      corridorRows.forEach(row => {
        const rowStatus = row.getAttribute('data-status');
        if (filter === 'all' || rowStatus === filter) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    });
  });

  return card;
}

export function getPumpEvaluation(stationId, moorLevel, moorConfigId, stationFallbackName, defaultPumps = 2, configOverride = undefined) {
  const regime = getSeasonalRegime();
  const isSummer = regime.isSummer;
  const seasonKey = isSummer ? 'summer' : 'winter';
  const activeConfig = configOverride !== undefined ? configOverride : hydroConfig;

  let psConfig = null;
  if (activeConfig && activeConfig.moors && activeConfig.moors[moorConfigId]) {
    const moor = activeConfig.moors[moorConfigId];
    if (moor.pumping_stations) {
      psConfig = moor.pumping_stations.find(ps => ps.id === stationId);
    }
    if (!psConfig && moor[stationId]) {
      psConfig = moor[stationId];
    }
    if (!psConfig && moor.emergency_pumps && moor.emergency_pumps.id === stationId) {
      psConfig = moor.emergency_pumps;
    }
  }

  if (psConfig && psConfig.thresholds && psConfig.thresholds[seasonKey]) {
    const t = psConfig.thresholds[seasonKey];
    if (typeof t.lead === 'number' && typeof t.duty === 'number') {
      return evaluatePumpStatus(
        moorLevel,
        psConfig.name || stationFallbackName,
        psConfig.total_pumps || defaultPumps,
        t.lead,
        t.duty,
        t.mobile_order,
        t.mobile_active,
        t.critical_spill,
        isSummer
      );
    }
  }

  // Fallback to canonical seasonal thresholds if hydroConfig not loaded yet [RULE-SSOT-01].
  // Never fall back to currymoor_ps for unsurveyed or receiving-river stations (e.g. huish_episcopi_ps).
  const fb = CANONICAL_PUMP_THRESHOLDS[stationId] && CANONICAL_PUMP_THRESHOLDS[stationId][seasonKey];
  if (fb && typeof fb.lead === 'number' && typeof fb.duty === 'number') {
    return evaluatePumpStatus(
      moorLevel,
      stationFallbackName,
      defaultPumps,
      fb.lead,
      fb.duty,
      fb.mobile_order,
      fb.mobile_active,
      fb.critical_spill,
      isSummer
    );
  }

  const stationName = psConfig?.name || stationFallbackName || stationId;
  const totalPumps = psConfig?.total_pumps || defaultPumps;

  if (stationId === 'huish_episcopi_ps') {
    const huishEval = evaluateHuishEpiscopi(moorLevel, isSummer);
    const isCutoff = Boolean(huishEval.isPumpsCutoff);
    const isAlert = huishEval.code === 'ALERT';
    return {
      stationName,
      stage: 0,
      stageLabel: isAlert
        ? 'FLOOD ALERT / PUMPS LOCKED (≥8.48m AOD)'
        : (isCutoff ? 'PUMPS LOCKED OUT (RIVER ≥8.20m CUT-OFF)' : 'STANDBY (<8.20m RIVER CUT-OFF)'),
      badgeClass: isAlert ? 'stage-4' : (isCutoff ? 'stage-3' : 'stage-0'),
      statusText: isCutoff
        ? '🔒 PUMPS LOCKED OUT (≥8.20m Cut-off)'
        : '⚪ STANDBY (<8.20m River Cut-off)',
      runningCount: 0,
      totalPumps,
      mode: isCutoff ? 'CUT_OFF' : 'STANDBY',
      mobileStatus: 'OFF',
      isPumpsCutoff: isCutoff,
      isAlert,
      progressPct: 0,
      thresholds: null,
      isSummer,
      regimeTag: '🔒 8.20m River Cut-off Interlock',
      confidence: 'TIER_2_CUTOFF_ONLY',
      confidenceTag: '⚠️ INTERNAL MOOR TRIGGERS PENDING EA SURVEY',
      narrative: huishEval.narrative
    };
  }

  return {
    stationName,
    stage: 0,
    stageLabel: 'STANDBY (PENDING EA ASSET SURVEY)',
    badgeClass: 'stage-0',
    statusText: '⚪ STANDBY (Pending EA Survey)',
    runningCount: 0,
    totalPumps,
    mode: 'STANDBY',
    mobileStatus: 'OFF',
    progressPct: 0,
    thresholds: null,
    isSummer,
    regimeTag: '⚠️ Pending EA Asset Survey',
    confidence: 'UNSURVEYED',
    confidenceTag: '⚠️ PENDING EA ASSET SURVEY',
    narrative: `${stationName}: Internal moor pump triggers pending EA Trigger Point Plan verification.`
  };
}

/**
 * Resolves the operational pump regime and calculates signed delta to the next trigger.
 *
 * @param {Object} pumpEval - Output of evaluatePumpStatus
 * @param {number} currentLevel - Active driving sensor water level in mAOD
 * @returns {Object}
 */
export function getPumpTriggerDelta(pumpEval, currentLevel) {
  if (!pumpEval || !pumpEval.thresholds || pumpEval.thresholds.length === 0 || typeof currentLevel !== 'number' || isNaN(currentLevel)) {
    return {
      regime: 'STANDBY',
      statusText: '--',
      deltaText: '--',
      activeTrigger: null,
      nextTrigger: null,
      nextDelta: null,
      aboveDelta: null
    };
  }

  const thresholds = pumpEval.thresholds;
  const leadTrigger = thresholds[0];
  const dutyTrigger = thresholds[1] || thresholds[0];
  const mobileOrderTrigger = thresholds[2];
  const mobileActiveTrigger = thresholds[3];

  let regime = 'STANDBY';
  let activeTrigger = null;
  let nextTrigger = thresholds[0];

  if (mobileActiveTrigger && currentLevel >= mobileActiveTrigger.level) {
    regime = 'MOBILE_ACTIVE';
    activeTrigger = mobileActiveTrigger;
    nextTrigger = null;
  } else if (mobileOrderTrigger && currentLevel >= mobileOrderTrigger.level) {
    regime = 'MOBILE_ORDERED';
    activeTrigger = mobileOrderTrigger;
    nextTrigger = mobileActiveTrigger || null;
  } else if (dutyTrigger && currentLevel >= dutyTrigger.level) {
    regime = 'FULL_DUTY';
    activeTrigger = dutyTrigger;
    nextTrigger = mobileOrderTrigger || mobileActiveTrigger || null;
  } else if (leadTrigger && currentLevel >= leadTrigger.level) {
    regime = 'LEAD_DUTY';
    activeTrigger = leadTrigger;
    nextTrigger = dutyTrigger || mobileOrderTrigger || null;
  } else {
    regime = 'STANDBY';
    activeTrigger = null;
    nextTrigger = leadTrigger;
  }

  let deltaText = '';
  let statusText = '';
  let nextDelta = null;
  let aboveDelta = null;

  if (nextTrigger) {
    nextDelta = Number((nextTrigger.level - currentLevel).toFixed(2));
  }
  if (activeTrigger) {
    aboveDelta = Number((currentLevel - activeTrigger.level).toFixed(2));
  }

  if (!activeTrigger) {
    const formattedNext = nextDelta !== null ? formatSpanUnit(Math.abs(nextDelta)) : '--';
    deltaText = `${formattedNext} to ${nextTrigger.label} (@ ${nextTrigger.level.toFixed(2)}m)`;
    statusText = deltaText;
  } else if (nextTrigger) {
    const formattedAbove = aboveDelta !== null ? formatSpanUnit(Math.abs(aboveDelta)) : '0cm';
    const formattedNext = nextDelta !== null ? formatSpanUnit(Math.abs(nextDelta)) : '--';
    deltaText = `Active (+${formattedAbove} above ${activeTrigger.label}) • ${formattedNext} to ${nextTrigger.label} (@ ${nextTrigger.level.toFixed(2)}m)`;
    statusText = `${formattedNext} to ${nextTrigger.label} (@ ${nextTrigger.level.toFixed(2)}m)`;
  } else {
    const formattedAbove = aboveDelta !== null ? formatSpanUnit(Math.abs(aboveDelta)) : '0cm';
    deltaText = `Active (+${formattedAbove} above ${activeTrigger.label}) • At/Above Maximum Trigger (@ ${activeTrigger.level.toFixed(2)}m)`;
    statusText = `Active (+${formattedAbove} above ${activeTrigger.label})`;
  }

  return {
    regime,
    statusText,
    deltaText,
    activeTrigger,
    nextTrigger,
    nextDelta,
    aboveDelta
  };
}

export function renderPumpTriggerGauge(pumpEval, drivingInfo) {
  if (!pumpEval || !Array.isArray(pumpEval.thresholds) || pumpEval.thresholds.length === 0) return '';

  const info = drivingInfo || {
    stationId: '52127',
    stationName: 'Curry Moor Basin',
    riverName: 'River Tone',
    currentLevel: 4.00,
    color: '#38bdf8',
    isStale: false,
    roleTag: 'Internal Moor Drain'
  };

  const currentLevel = (typeof info.currentLevel === 'number' && !isNaN(info.currentLevel)) ? info.currentLevel : 0;
  const deltaResult = getPumpTriggerDelta(pumpEval, currentLevel);

  const STAGE_FILL_COLORS = {
    0: '#38bdf8', // Standby / Calm Hydro Blue
    1: '#4ade80', // Permanent Duty Green
    2: '#facc15', // Mobile Ordered Yellow
    3: '#f87171', // Mobile Active Red
    4: '#ef4444'  // Critical Overspill Red
  };

  const fillColor = STAGE_FILL_COLORS[pumpEval.stage] || '#38bdf8';
  const regimeBadge = pumpEval.regimeTag || (pumpEval.isSummer ? '☀️ Summer Triggers' : '❄️ Winter Triggers');
  const progressPct = pumpEval.progressPct !== undefined ? pumpEval.progressPct : 0;

  const thresholdsHTML = pumpEval.thresholds.map((t, idx) => {
    const isTop = idx % 2 === 0;
    const isNext = deltaResult.nextTrigger && deltaResult.nextTrigger.label === t.label;
    const nextTargetClass = isNext ? ' tick-next-target' : '';
    return `
      <div class="gauge-tick ${isTop ? 'tick-top' : 'tick-bottom'}${nextTargetClass}" style="left: ${t.pct}%" title="${escapeAttr(t.label)}: ${t.level.toFixed(2)}m AOD">
        <span class="tick-line"></span>
        <span class="tick-label">${escapeHTML(t.label)}<br><strong>${t.level.toFixed(2)}m</strong></span>
      </div>
    `;
  }).join('');

  const drivingStageMarkup = info.isStale
    ? `<span class="stage-stale-tag" style="color: #f59e0b; font-weight: 600;">⚠️ Telemetry Offline (Baseline Fallback)</span>`
    : `<code style="color: #38bdf8; font-weight: 700; font-size: 0.82rem;">${currentLevel.toFixed(2)}m AOD</code>`;

  return `
    <div class="pump-trigger-gauge-box">
      <div class="gauge-header">
        <div>
          <span class="gauge-title">⚙️ ${escapeHTML(pumpEval.stationName || 'Pumping Operational Scale')}</span>
          <span class="gauge-subtitle-pill">${regimeBadge}</span>
          <span class="next-pill" title="Next operational trigger delta">${escapeHTML(deltaResult.deltaText)}</span>
        </div>
        <span class="stage-badge ${pumpEval.badgeClass}">${pumpEval.stageLabel}</span>
      </div>

      <div class="gauge-driving-attribution">
        <span>📡 Driven by: <strong>${escapeHTML(info.stationName)} (Station ${escapeHTML(info.stationId)})</strong> [${escapeHTML(info.roleTag || 'Internal Moor Drain')}]</span>
        <span class="driving-stage-display">${drivingStageMarkup}</span>
      </div>

      <div class="gauge-explainer-callout">
        <p>ℹ️ <strong>How this works:</strong> Pumping is triggered by water levels inside the moor drain (${escapeHTML(info.stationName)} – Station ${escapeHTML(info.stationId)}), not the river. When water rises in the moor, the pumps lift it over the bank into the ${escapeHTML(info.riverName || 'river')}.</p>
        <p class="gauge-explainer-sub">Operational triggers are inferred from the EA Somerset Levels Trigger Point Plan; live mechanical pump motor run-states are not broadcast.</p>
      </div>

      <div class="gauge-track-container">
        <div class="gauge-track-fill" style="width: ${progressPct}%; background: ${fillColor};"></div>
        <div class="gauge-pin" style="left: ${progressPct}%" title="Current Water Level: ${currentLevel.toFixed(2)}m AOD (${progressPct}% of scale window)">
          <span class="pin-bubble">${currentLevel.toFixed(2)}m</span>
          <span class="pin-head">▼</span>
        </div>
        ${thresholdsHTML}
      </div>

      <div class="gauge-legend">
        <span>⚪ Standby</span>
        <span>🟢 Lead Duty</span>
        <span>🟢 Full Duty</span>
        <span>🟡 Mobile Order</span>
        <span>🔴 Mobile Active</span>
      </div>
    </div>
  `;
}

/**
 * Hero-stat text for the four canonical sluice states. The state is inferred from the
 * Parrett / Sowy gauge levels; gate position is not broadcast, so it is never claimed.
 */
export function getSluiceHeroStateText(status) {
  switch (status) {
    case 'DIVERTING': return '🔵 DIVERTING';
    case 'THROTTLED': return '🟡 THROTTLED';
    case 'REVERSE_LOCK': return '🔴 REVERSE LOCK';
    case 'CLOSED': return '🔒 CLOSED · PENNING';
    default: return '⚪ UNCONFIRMED';
  }
}

/**
 * Describes a degraded station freshness for the sluice gauge, or null when healthy.
 * Wording is neutral: a static reading is not called a sensor fault.
 */
function describeSluiceStationDegradation(freshness, stage) {
  const f = freshness || {};
  if (f.isOffline) return { tag: '⚠️ Offline', reason: 'offline' };
  if (f.isFlatlined) {
    const staticVal = Number.isFinite(stage) ? `${stage.toFixed(2)}m` : null;
    return { tag: `⚠️ Reading static${staticVal ? ` (${staticVal})` : ''}`, reason: 'reading static' };
  }
  if (f.isStale) {
    const ageLabel = f.ageHours !== undefined && f.ageHours !== null ? `${f.ageHours}h` : 'stale';
    return { tag: `🕒 Stale (${ageLabel})`, reason: 'stale' };
  }
  return null;
}

export function renderSluiceOperationalGauge(sowyEval, opts = {}) {
  if (!sowyEval) return '';

  const regUp = STATION_REGISTRY['52233'];
  const regDown = STATION_REGISTRY['52234'];
  const minLevel = opts.sillM ?? regUp.sill_elevation_mAOD;
  const upAlert = regUp.alert_level_mAOD;
  const maxLevel = Number((upAlert + 0.10).toFixed(2));
  const headwall = regUp.headwall_elevation_mAOD;
  const trigger = opts.triggerM ?? regUp.diversion_trigger_mAOD;
  const downAlert = regDown.alert_level_mAOD;
  const approachingMargin = 0.20;

  const upStage = Number.isFinite(opts.upStage) ? opts.upStage : regUp.fallback_stage_mAOD;
  const downStage = Number.isFinite(opts.downStage) ? opts.downStage : null;
  const downFreshness = opts.downFreshness || {};
  const upFreshness = opts.upFreshness || {};
  const upDegradation = describeSluiceStationDegradation(upFreshness, upStage);
  const isDownstreamHealthy = Boolean(
    sowyEval.isDownstreamHealthy &&
    downStage !== null &&
    !downFreshness.isFlatlined &&
    !downFreshness.isStale &&
    !downFreshness.isOffline
  );

  const canonicalStatus = sowyEval.status || 'CLOSED';
  const isApproaching = canonicalStatus === 'CLOSED' && upStage >= (trigger - approachingMargin);

  const statusPresentation = {
    REVERSE_LOCK: { pill: '🔴 REVERSE LOCK', cls: 'sluice-status-reverse', fill: '#ef4444' },
    THROTTLED: { pill: '🟡 THROTTLED', cls: 'sluice-status-throttled', fill: '#f59e0b' },
    DIVERTING: { pill: '🔵 DIVERTING', cls: 'sluice-status-diverting', fill: '#0284c7' },
    CLOSED: isApproaching
      ? { pill: '🟡 CLOSED · APPROACHING TRIGGER', cls: 'sluice-status-approaching', fill: '#f59e0b' }
      : { pill: '🔒 CLOSED · PENNING', cls: 'sluice-status-closed', fill: '#38bdf8' }
  }[canonicalStatus] || { pill: '🔒 CLOSED · PENNING', cls: 'sluice-status-closed', fill: '#38bdf8' };

  const span = maxLevel - minLevel;
  const toPct = (val) => {
    if (!Number.isFinite(val) || span <= 0) return 0;
    return Math.max(0, Math.min(100, Number((((val - minLevel) / span) * 100).toFixed(1))));
  };

  const progressPct = toPct(upStage);
  const deltaToTrigger = Number((trigger - upStage).toFixed(2));
  const nextPillText = upStage >= trigger
    ? `+${Math.abs(deltaToTrigger).toFixed(2)}m above Diversion Trigger (@ ${trigger.toFixed(2)}m)`
    : `${deltaToTrigger.toFixed(2)}m to Diversion Trigger (@ ${trigger.toFixed(2)}m)`;

  const alertTickStateClass = upStage >= upAlert
    ? 'tick-alert-active'
    : (upStage >= (upAlert - 0.30) ? 'tick-alert-approaching' : 'tick-alert-dormant');

  const ticks = [
    { label: 'Sill', level: minLevel, side: 'tick-bottom tick-edge-start', extraClass: '' },
    { label: 'Headwall', level: headwall, side: 'tick-top', extraClass: '' },
    { label: 'Diversion Trigger', level: trigger, side: 'tick-bottom', extraClass: upStage < trigger ? 'tick-next-target' : '' },
    { label: 'Parrett Alert', level: upAlert, side: 'tick-top tick-edge-end', extraClass: alertTickStateClass }
  ];

  const ticksHTML = ticks.map((t) => {
    const pct = toPct(t.level);
    const cls = ['gauge-tick', t.side, t.extraClass].filter(Boolean).join(' ');
    return `
      <div class="${cls}" style="left: ${pct}%" title="${escapeAttr(t.label)}: ${t.level.toFixed(2)}m AOD">
        <span class="tick-line"></span>
        <span class="tick-label">${escapeHTML(t.label)}<br><strong>${t.level.toFixed(2)}m</strong></span>
      </div>
    `;
  }).join('');

  let deltaHtml;
  let downstreamValHtml;
  let degradedNoteHtml = '';

  if (isDownstreamHealthy) {
    const deltaH = Number((upStage - downStage).toFixed(2));
    const deltaSign = deltaH >= 0 ? '+' : '';
    deltaHtml = `<span class="sluice-delta-pill">➔ Δh: ${deltaSign}${deltaH.toFixed(2)}m</span>`;
    downstreamValHtml = `<code class="sluice-attr-val">${downStage.toFixed(2)}m AOD</code> <span class="sluice-cap-tag">(Cap/Alert ${downAlert.toFixed(2)}m)</span>`;
  } else {
    const downDegradation = describeSluiceStationDegradation(downFreshness, downStage);
    const downStatusTag = downDegradation?.tag || '⚠️ Unavailable';
    const downReason = downDegradation?.reason || 'unavailable';
    deltaHtml = `<span class="sluice-delta-pill sluice-delta-unavailable" role="status">➔ Head Drop: Unavailable</span>`;
    downstreamValHtml = `<span class="stage-stale-tag">${escapeHTML(downStatusTag)}</span> <span class="sluice-cap-tag">(Cap/Alert ${downAlert.toFixed(2)}m)</span>`;
    degradedNoteHtml = `<p class="gauge-explainer-sub sluice-degraded-note">⚠️ Downstream Sowy gauge (52234) is currently ${escapeHTML(downReason)}; head drop cannot be verified and status is inferred from upstream Parrett (52233) only.</p>`;
  }

  return `
    <section class="pump-trigger-gauge-box sluice-operational-gauge-box" data-status="${escapeAttr(canonicalStatus)}" aria-label="Monk's Leaze Clyse Sluice Operational Scale">
      <div class="gauge-header">
        <div>
          <span class="gauge-title">🚰 Monk's Leaze Clyse Intake Scale</span>
          <span class="gauge-subtitle-pill">Parrett (52233) ➔ Sowy (52234)</span>
          <span class="next-pill" title="Distance to EA Diversion Trigger">${escapeHTML(nextPillText)}</span>
        </div>
        <span class="stage-badge ${statusPresentation.cls}">${statusPresentation.pill}</span>
      </div>

      <div class="sluice-dual-attribution" role="group" aria-label="Upstream and downstream sensor comparison">
        <div class="sluice-attr-node">
          <span class="sluice-attr-role">Upstream · Parrett (52233)</span>
          <span class="sluice-attr-val-wrap">
            <code class="sluice-attr-val">${upStage.toFixed(2)}m AOD</code>
            ${upDegradation ? `<span class="stage-stale-tag">${escapeHTML(upDegradation.tag)}</span>` : ''}
          </span>
        </div>
        <div class="sluice-attr-delta">
          ${deltaHtml}
        </div>
        <div class="sluice-attr-node sluice-attr-right">
          <span class="sluice-attr-role">Downstream · Sowy (52234)</span>
          <span class="sluice-attr-val-wrap">${downstreamValHtml}</span>
        </div>
      </div>

      <div class="gauge-explainer-callout">
        <p>ℹ️ <strong>How this works:</strong> Operational status is inferred from River Parrett stage (52233) relative to the EA Somerset Levels Trigger Point Plan, as live penstock actuator SCADA is not broadcast publicly.</p>
        ${degradedNoteHtml}
        ${upDegradation ? `<p class="gauge-explainer-sub sluice-degraded-note">⚠️ Upstream Parrett gauge (52233) is currently ${escapeHTML(upDegradation.reason)}; the stage shown may not be current, so the inferred clyse state is unconfirmed.</p>` : ''}
      </div>

      <div class="gauge-track-container sluice-track">
        <div class="gauge-track-fill" style="width: ${progressPct}%; background: ${statusPresentation.fill};"></div>
        <div class="gauge-pin sluice-gauge-pin" style="left: ${progressPct}%" title="Current Parrett Level: ${upStage.toFixed(2)}m AOD (${progressPct}% of scale window)">
          <span class="pin-bubble">${upStage.toFixed(2)}m</span>
          <span class="pin-stem" aria-hidden="true"></span>
          <span class="pin-head" aria-hidden="true">▼</span>
        </div>
        ${ticksHTML}
      </div>

      <div class="gauge-legend">
        <span>🔒 Closed · Penning</span>
        <span>🟡 Approaching / Throttled</span>
        <span>🔵 Diverting (≥${trigger.toFixed(2)}m)</span>
        <span>🔴 Reverse Lock</span>
      </div>
    </section>
  `;
}

export { renderMicroSparkline };

export function renderSingleSparkline(pointsInput, strokeColor = '#4ade80', options = {}) {
  return renderSingleSparklineCore(pointsInput, strokeColor, {
    rangeLabel: options.rangeLabel || (typeof currentActiveRange !== 'undefined' ? currentActiveRange : '24h'),
    ...options
  });
}

export function renderDualSparkline(seaInput, inlandInput, isTideLocked, options = {}) {
  // Uses Estuarine Deep Blue #0284c7 for sea tide stream, preventing warning orange collisions (UI-COL-02)
  return renderDualSparklineCore(seaInput, inlandInput, isTideLocked, {
    secondaryColor: options.secondaryColor || '#0284c7',
    currentRange: options.currentRange || (typeof currentActiveRange !== 'undefined' ? currentActiveRange : '24h'),
    ...options
  });
}

export function bindSparklineEvents(container = document) {
  return bindSparklineEventsCore(container, {
    stickyDelay: 1200,
    refreshController,
    onHoverChange: (ratio) => {
      currentHoverRatio = ratio;
      isUserInspecting = ratio !== null;
      updateCountdownDisplay();
    }
  });
}

// ============================================================================
// Catchment Rainfall Summary Helpers (Overview Header Pill & Summary Banner)
// Full Two-Pillar model & 14-gauge inline view live on rainfall.html / rainfall.js
// ============================================================================

/**
 * Fetches `/api/rainfall` from the local backend cache.
 * Returns null gracefully on network or parse error.
 */
export async function fetchRainfallFromDB() {
  try {
    const res = await fetch('/api/rainfall');
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (data && data.status === 'ok') {
      return data;
    }
  } catch (err) {
    console.warn('Failed to fetch from /api/rainfall:', err);
  }
  return null;
}

function safeRainfallNumber(val) {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0.0;
}

/**
 * Computes null-safe metadata, active/stale counts, and atmospheric palette tokens
 * for Level 0 header badge and Level 1 rainfall card.
 *
 * @param {object|null|undefined} rainfallData
 * @param {object|null|undefined} [fallbackSummary=null]
 */
export function getRainfallBadgeMeta(rainfallData, fallbackSummary = null) {
  const summary = (rainfallData && rainfallData.rainfall_summary) || fallbackSummary || {};
  const catchments = (rainfallData && rainfallData.catchments) || {};
  const stations = Array.isArray(rainfallData?.stations) ? rainfallData.stations : [];

  let totalStations = 0;
  let activeStations = 0;
  let hasStationCounts = false;

  const zoneValues = Object.values(catchments);
  if (zoneValues.length > 0) {
    hasStationCounts = true;
    for (const z of zoneValues) {
      if (!z || typeof z !== 'object') continue;
      totalStations += Number(z.station_count) || 0;
      activeStations += Number(z.active_station_count) || 0;
    }
  } else if (stations.length > 0) {
    hasStationCounts = true;
    totalStations = stations.length;
    activeStations = stations.filter(s => s && !s.is_stale && (s.valid_reading_count ?? 1) > 0).length;
  } else {
    totalStations = Object.keys(RAINGAUGE_REGISTRY).length;
    activeStations = 0;
  }

  const staleStations = Math.max(0, totalStations - activeStations);
  const basin1h = safeRainfallNumber(summary.basin_1h_mean_mm);
  const basin6h = Math.max(basin1h, safeRainfallNumber(summary.basin_6h_mean_mm));
  const basin24h = Math.max(basin6h, safeRainfallNumber(summary.basin_24h_mean_mm));
  const basin48h = Math.max(basin24h, safeRainfallNumber(summary.basin_48h_mean_mm));

  const hasSummaryData = Boolean(
    summary &&
    typeof summary === 'object' &&
    (
      (typeof summary.upland_peak_station === 'string' && summary.upland_peak_station.trim().length > 0) ||
      (typeof summary.upland_peak_station_id === 'string' && summary.upland_peak_station_id.trim().length > 0) ||
      basin1h > 0 ||
      basin6h > 0 ||
      basin24h > 0 ||
      basin48h > 0 ||
      (typeof summary.rate_category === 'string' && ['LIGHT', 'MODERATE', 'HEAVY', 'TORRENTIAL'].includes(summary.rate_category.toUpperCase()))
    )
  );

  const isAllStale = hasStationCounts ? activeStations === 0 : !hasSummaryData;
  const isSummaryOnly = !hasStationCounts && hasSummaryData;

  if (isAllStale) {
    return {
      isAllStale: true,
      isSummaryOnly: false,
      totalStations,
      activeStations: 0,
      staleStations,
      basin1h,
      basin6h,
      basin24h,
      basin48h,
      badgeClass: 'badge-precip-stale',
      pillClass: 'precip-stale',
      icon: '🕒',
      label: 'AWAITING TBR',
      headerSuffix: 'Awaiting Live TBR'
    };
  }

  const tier = classifyRainfallIntensity(basin1h);
  const icon = tier.code === 'TORRENTIAL'
    ? '⛈️'
    : (tier.code === 'HEAVY' || tier.code === 'MODERATE' ? '🌦️' : '🌧️');

  return {
    isAllStale: false,
    isSummaryOnly,
    totalStations,
    activeStations: isSummaryOnly ? null : activeStations,
    staleStations: isSummaryOnly ? null : staleStations,
    basin1h,
    basin6h,
    basin24h,
    basin48h,
    badgeClass: tier.badge_class,
    pillClass: `precip-${tier.code.toLowerCase()}`,
    icon,
    label: tier.code,
    headerSuffix: tier.label
  };
}

/**
 * Updates the Level 0 neutral meteorological badge in the secondary header bar (#basin-rain-pill).
 * Rainfall never enters the primary life-safety #alert-banner.
 *
 * @param {object|null|undefined} rainfallData
 * @param {object|null|undefined} [fallbackSummary=null]
 */
export function updateBasinRainHeaderBadge(rainfallData, fallbackSummary = null) {
  if (typeof document === 'undefined') return;
  const pill = document.getElementById('basin-rain-pill');
  if (!pill) return;

  const meta = getRainfallBadgeMeta(rainfallData, fallbackSummary);
  pill.className = `basin-rain-pill ${meta.pillClass}`;
  const val1h = meta.isAllStale ? '—' : `${meta.basin1h.toFixed(1)}mm`;
  const val24h = meta.isAllStale ? '—' : `${meta.basin24h.toFixed(1)}mm`;
  pill.textContent = `🌧️ Basin Rain: ${val1h} (1h) | ${val24h} (24h) • ${meta.headerSuffix}`;
}

/**
 * Updates the compact 1-row Catchment Rainfall Summary Banner on Overview (#rainfall-summary-banner).
 *
 * @param {object|null|undefined} rainfallData
 * @param {object|null|undefined} [fallbackSummary=null]
 */
export function updateRainfallSummaryBanner(rainfallData, fallbackSummary = null) {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('rainfall-summary-banner');
  const textEl = document.getElementById('rainfall-banner-text');
  if (!banner || !textEl) return;

  const meta = getRainfallBadgeMeta(rainfallData, fallbackSummary);
  banner.className = `rainfall-summary-banner ${meta.pillClass}`;
  if (meta.isAllStale) {
    textEl.innerHTML = `${escapeHTML(meta.icon)} <strong>Catchment Rainfall:</strong> Awaiting Live TBR`;
    return;
  }
  textEl.innerHTML = `${escapeHTML(meta.icon)} <strong>Catchment Rainfall:</strong> ${escapeHTML(meta.headerSuffix)} • ${meta.basin1h.toFixed(1)}mm (1h) | ${meta.basin24h.toFixed(1)}mm (24h)`;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
