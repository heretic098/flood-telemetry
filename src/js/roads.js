/**
 * Dedicated Somerset Levels Road Network & Access Status Controller
 * 
 * Manages real-time evaluation of all 8 monitored Somerset Levels highway corridors,
 * countdown auto-refresh lifecycle, client-side filtering, camera field guide triggers,
 * network offline/online events, and river topology deep links.
 * 
 * Invariants:
 * - [RULE-ENT-01]: Canonical Tripartite Entity Invariant (asset_type -> asset_name -> status).
 * - [RULE-CAM-01]: Optical Camera Ground-Truth Invariant (Field-of-View Fidelity).
 * - [RULE-SSOT-01]: Single Source of Truth for Stations & Invariants in hydro_engine.js.
 */

import {
  evaluateRoadNetwork,
  ASSET_DEFINITIONS,
  STATION_REGISTRY,
  HYDRO_THRESHOLDS
} from './hydro_engine.js';

import { openCameraGuide, setCameraEventsCatalog, initCameraGuideTriggers } from './camera_guide.js';
import { initJargonPopovers } from './jargon_popover.js';
import { createRefreshController } from './modules/refresh_controller.js';
import { setupOfflineBanner as setupResilienceBanner } from './modules/network_resilience.js';

// Station mappings for deep-linking road corridors to the River Topology Map
export const ROAD_TOPOLOGY_STATION_MAP = {
  cuts_road: '52118',
  muchelney_access: '52120',
  a361_burrowbridge: '52158',
  new_road_curry: '52127',
  bicknells_bridge_access: '52120',
  moorland_new_cut_road: '52159',
  stan_moor_road: '52158',
  beer_wall_a372: '52157'
};

// Camera field guide site mappings per corridor
export const ROAD_CAMERA_GUIDE_MAP = {
  cuts_road: 'baltmoor',
  muchelney_access: 'currymoor',
  a361_burrowbridge: 'baltmoor',
  new_road_curry: 'currymoor',
  bicknells_bridge_access: 'currymoor',
  moorland_new_cut_road: 'saltmoor',
  stan_moor_road: 'baltmoor',
  beer_wall_a372: 'monksleaze'
};

let currentFilter = 'all';
let lastSuccessfulSyncTime = null;
let isRefreshing = false;

export const refreshController = createRefreshController({
  intervalMs: 60000,
  countdownPillId: 'countdown-pill',
  refreshBtnId: 'btn-refresh-now',
  onRefresh: async () => { await refreshRoadsView(); }
});

export function getAutoRefreshState() {
  return refreshController.getState();
}

export async function fetchTelemetryData() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data = await res.json();
      lastSuccessfulSyncTime = new Date();
      return data;
    }
  } catch (err) {
    console.warn('[Roads View] Failed to fetch /api/status:', err);
  }
  return null;
}

export async function fetchRecentRoadEvents(limit = 30) {
  try {
    const res = await fetch(`/api/events?limit=${limit}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.events)) {
        return data.events;
      }
    }
  } catch (err) {
    console.warn('[Roads View] Failed to fetch /api/events:', err);
  }
  return [];
}

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

/**
 * Updates sticky network offline banner ("Network Disconnected" / "Connection Restored").
 * Wires window.addEventListener('offline', ...) and window.addEventListener('online', ...) via shared controller.
 */
export function setupOfflineBanner() {
  return setupResilienceBanner({
    bannerId: 'network-offline-banner',
    onOnline: async () => { await refreshRoadsView(); },
    getLastSyncTime: () => lastSuccessfulSyncTime
  });
}

/**
 * Updates the summary cards at top of roads.html
 */
export function updateSummaryCards(counts = { impassable: 0, encroaching: 0, passable: 8, all: 8 }) {
  if (typeof document === 'undefined') return;

  const impEl = document.getElementById('summary-impassable-count');
  const encEl = document.getElementById('summary-encroaching-count');
  const passEl = document.getElementById('summary-passable-count');

  if (impEl) impEl.textContent = String(counts.impassable || 0);
  if (encEl) encEl.textContent = String(counts.encroaching || 0);
  if (passEl) passEl.textContent = String(counts.passable || 0);

  const bannerEl = document.getElementById('alert-banner');
  if (bannerEl) {
    if (counts.impassable > 0) {
      bannerEl.className = 'alert-banner banner-critical';
      bannerEl.textContent = `⚠️ HIGHWAY WARNING: ${counts.impassable} CORRIDOR(S) SUBMERGED / CLOSED • DO NOT DRIVE INTO FLOODWATER`;
    } else if (counts.encroaching > 0) {
      bannerEl.className = 'alert-banner banner-alert';
      bannerEl.textContent = `⚠️ HIGHWAY ADVISORY: ${counts.encroaching} CORRIDOR(S) ENCROACHING / INSPECTION PENDING • PROCEED WITH CAUTION`;
    } else {
      bannerEl.className = 'alert-banner banner-secure';
      bannerEl.textContent = 'ROAD NETWORK NOMINAL: ALL 8 MONITORED HIGHWAY CORRIDORS PASSABLE';
    }
  }
}

/**
 * Renders fallback row for corrupted or offline corridor telemetry [WP 1.4]
 */
export function renderCorridorFallbackRow(corridor, err = null) {
  const name = corridor?.name || 'Highway Corridor';
  return `
    <article class="road-corridor-row corridor-fallback" data-status="impassable" role="alert" tabindex="0" style="min-height: 280px; padding: 1.25rem;">
      <div class="corridor-main-info">
        <div class="corridor-title-group">
          <span class="road-status-badge badge-impassable">⚠️ UNKNOWN / TELEMETRY OFFLINE</span>
          <h3 class="corridor-name">${escapeHTML(name)}</h3>
        </div>
        <p class="corridor-desc" style="color: #cbd5e1; margin-top: 0.5rem;">
          Telemetry for this highway corridor is currently unavailable or corrupted. Passability unconfirmed. Drive with extreme caution.
        </p>
      </div>
      <div class="card-fallback-links" style="margin-top: 1rem;">
        <p style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.5rem;">Verify road conditions with authoritative services:</p>
        <div class="fallback-links-group" style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <a href="https://www.travelsomerset.co.uk" target="_blank" rel="noopener noreferrer" class="fallback-link" style="min-height: 44px;">🚗 Travel Somerset ↗</a>
          <a href="https://check-for-flooding.service.gov.uk" target="_blank" rel="noopener noreferrer" class="fallback-link" style="min-height: 44px;">🌊 GOV.UK Flood Warnings ↗</a>
        </div>
      </div>
    </article>
  `;
}

/**
 * Renders individual corridor HTML row
 */
export function renderCorridorRow(corridor, correlatedEvent = null) {
  try {
    if (!corridor) return '';
    if (corridor.isOffline || corridor.status === 'OFFLINE') {
      return renderCorridorFallbackRow(corridor);
    }
    const statusLower = (corridor.status || 'passable').toLowerCase();
  const isClearing = corridor.phase === 'CLEARING_INSPECTION_PENDING';

  const provClass = (corridor.survey_tier === 'TIER_1_SURVEYED' || corridor.survey_tier === 'TIER_1_WEIR_PENDING_SURVEY_CROWN')
    ? 'prov-high' : 'prov-medium';

  const momentumClass = (typeof corridor.rate_of_rise_mh === 'number' && corridor.rate_of_rise_mh >= 0.02)
    ? 'trending-rising'
    : ((typeof corridor.rate_of_rise_mh === 'number' && corridor.rate_of_rise_mh <= -0.02) ? 'trending-falling' : 'trending-steady');

  let crownLabel = 'Road Crown:';
  if (corridor.asset_id === 'cuts_road') crownLabel = 'Spillway Crown:';
  else if (corridor.asset_id === 'beer_wall_a372') crownLabel = 'Culvert Relief:';

  let eaStateText = 'Inactive';
  if (corridor.ea_warning_state === 'RED_WARNING') eaStateText = '⚠️ Active Warning';
  else if (corridor.ea_warning_state === 'AMBER_ALERT') eaStateText = '⚠️ Active Alert';

  let lifecycleHtml = '';
  if (isClearing) {
    const timeFormatted = corridor.submerged_end_time 
      ? new Date(corridor.submerged_end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const dryHours = (typeof corridor.dry_duration_hours === 'number' && Number.isFinite(corridor.dry_duration_hours))
      ? `${corridor.dry_duration_hours.toFixed(1)}h`
      : '0.0h';
    const daylightHours = (typeof corridor.daylight_dry_hours === 'number' && Number.isFinite(corridor.daylight_dry_hours))
      ? `${corridor.daylight_dry_hours.toFixed(1)} / 6.0 daylight hrs`
      : '0.0 / 6.0 daylight hrs';
    const progressPct = Math.min(100, Math.max(0, corridor.daylight_progress_percent || 0));

    lifecycleHtml = `
      <div class="corridor-lifecycle-box lifecycle-clearing" role="region" aria-label="Inspection Progress">
        <div class="lifecycle-header">
          <span class="lifecycle-title"><strong>Council Gate Safety Inspection Pending</strong></span>
          <span class="lifecycle-timer">⏱️ ${timeFormatted ? `Water receded ${timeFormatted} • ` : ''}Dry for ${dryHours}</span>
        </div>
        <div class="daylight-progress-wrap">
          <div class="daylight-labels">
            <span>Daylight Inspection Window (08:00–17:00):</span>
            <strong>${daylightHours}</strong>
          </div>
          <div class="daylight-progress-track" role="progressbar" aria-valuenow="${progressPct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="Daylight inspection window progress">
            <div class="daylight-progress-fill" style="width: ${progressPct.toFixed(1)}%;"></div>
          </div>
        </div>
        <p class="lifecycle-narrative">
          ${escapeHTML(corridor.narrative || '')}
        </p>
      </div>
    `;
  } else if (corridor.narrative) {
    lifecycleHtml = `
      <p class="lifecycle-narrative" style="margin-bottom: 0.5rem; font-size: 0.8rem; color: #cbd5e1;">
        ${escapeHTML(corridor.narrative)}
      </p>
    `;
  }

  const camSiteKey = ROAD_CAMERA_GUIDE_MAP[corridor.asset_id] || 'dunball';
  const camBtnHtml = corridor.cam_url ? `
    <a href="${escapeAttr(corridor.cam_url)}" target="_blank" rel="noopener noreferrer" class="road-cam-btn" title="View live camera for ${escapeAttr(corridor.name)}" aria-label="View live camera for ${escapeAttr(corridor.name)}">
      <span aria-hidden="true">📷</span> ${escapeHTML(corridor.cam_label || 'Check Live Camera ↗')}
    </a>
  ` : '';

  const camGuideBtnHtml = `
    <button type="button" class="road-cam-guide-btn camera-guide-trigger" data-camera-guide="${camSiteKey}" title="Open Layperson Camera Guide for ${escapeAttr(corridor.name)}">
      🧭 Camera Guide
    </button>
  `;

  const evCe = correlatedEvent?.camera_evidence || null;
  const evSeqCount = Array.isArray(evCe?.sequence_frames) ? evCe.sequence_frames.length : 0;
  const evIsNight = Boolean(evCe && evCe.fallback_mode === 'NIGHT_TELEMETRY' && evSeqCount === 0);
  const visualEvidenceBtnHtml = (correlatedEvent && evCe) ? `
    <button type="button"
            class="road-evidence-btn visual-evidence-btn ${evIsNight ? 'visual-evidence-btn-night' : ''} visual-evidence-trigger"
            data-visual-evidence-event-id="${escapeAttr(String(correlatedEvent.id || ''))}"
            data-visual-evidence-asset="${escapeAttr(correlatedEvent.asset_id || corridor.asset_id)}"
            title="${evIsNight ? 'Inspect Night Telemetry Verification' : 'Inspect Archived Event Keyframes & Transition Sequence'}">
      <span aria-hidden="true">${evIsNight ? '🌙' : '📷'}</span> ${evIsNight ? 'Night Telemetry' : `Visual Evidence${evSeqCount > 1 ? ` (${evSeqCount})` : ''}`}
    </button>
  ` : '';

  const topologyStationId = ROAD_TOPOLOGY_STATION_MAP[corridor.asset_id] || '52118';
  const topologyBtnHtml = `
    <a href="topology.html?station=${topologyStationId}" class="road-topology-link ext-link-btn" title="View controlling station ${topologyStationId} on River Topology Map">
      🗺️ View on River Map ↗
    </a>
  `;

  const stationBtnHtml = corridor.station_url ? `
    <a href="${escapeAttr(corridor.station_url)}" target="_blank" rel="noopener noreferrer" class="road-station-link" title="Verify raw EA telemetry for ${escapeAttr(corridor.driving_station_label)}">
      📊 Raw Station Telemetry ↗
    </a>
  ` : '';

  const stageValText = (typeof corridor.stage_mAOD === 'number') ? `${corridor.stage_mAOD.toFixed(2)}m AOD` : 'N/A';
  const crownValText = (typeof corridor.crown_elevation_mAOD === 'number') ? `${corridor.crown_elevation_mAOD.toFixed(2)}m AOD` : 'N/A';

  return `
    <section class="road-corridor-row status-${statusLower}" data-asset-id="${escapeAttr(corridor.asset_id)}" data-status="${statusLower}" role="listitem" aria-labelledby="road-title-${escapeAttr(corridor.asset_id)}">
      <div class="corridor-main-header">
        <div class="corridor-title-col">
          <div class="corridor-heading-wrap">
            <h3 class="corridor-title" id="road-title-${escapeAttr(corridor.asset_id)}">${escapeHTML(corridor.name)}</h3>
            <span class="corridor-type-badge">${escapeHTML(corridor.corridor_type)}</span>
          </div>
          <div class="corridor-provenance-wrap">
            <span class="provenance-tag ${provClass}" title="${escapeAttr(corridor.survey_tooltip || '')}">${escapeHTML(corridor.survey_label || '')}</span>
            <span class="corridor-station-label">Driving Station: ${escapeHTML(corridor.driving_station_label)}</span>
          </div>
        </div>

        <div class="corridor-status-col">
          <div class="status-badge ${escapeAttr(corridor.badge_class)}" aria-live="polite">
            <span aria-hidden="true">${escapeHTML(corridor.badge_symbol)}</span>
            <span class="sr-only">Status: </span>
            <span>${escapeHTML(corridor.badge_label)}</span>
          </div>
        </div>
      </div>

      <div class="corridor-metrics-strip">
        <div class="corridor-metric-item">
          <span class="metric-label">Water Stage:</span>
          <span class="metric-val">${stageValText}</span>
        </div>
        <div class="corridor-metric-item">
          <span class="metric-label">${crownLabel}</span>
          <span class="metric-val">${crownValText} <small>(${escapeHTML(corridor.clearance_text || '')})</small></span>
        </div>
        <div class="corridor-metric-item">
          <span class="metric-label">3h Momentum:</span>
          <span class="metric-val ${momentumClass}">${escapeHTML(corridor.momentum_text || 'Steady')}</span>
        </div>
        <div class="corridor-metric-item">
          <span class="metric-label">EA Warning Area:</span>
          <span class="metric-val">${escapeHTML(corridor.ea_warning_target_area || 'None')} <small>(${eaStateText})</small></span>
        </div>
      </div>

      ${lifecycleHtml}

      <div class="corridor-actions-bar">
        ${visualEvidenceBtnHtml}
        ${camBtnHtml}
        ${camGuideBtnHtml}
        ${topologyBtnHtml}
        ${stationBtnHtml}
      </div>
    </section>
  `;
  } catch (err) {
    console.error(`[Roads Corridor Error] Failed to render corridor ${corridor?.asset_id || 'unknown'}:`, err);
    return renderCorridorFallbackRow(corridor, err);
  }
}

/**
 * Refreshes the dedicated roads view data and updates DOM
 */
export async function refreshRoadsView() {
  if (typeof document === 'undefined') return;

  isRefreshing = true;
  refreshController.isRefreshing = true;
  updateCountdownDisplay();
  const refreshBtn = document.getElementById('btn-refresh-now');
  if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'true');

  try {
    const [statusData, recentEvents] = await Promise.all([
      fetchTelemetryData(),
      fetchRecentRoadEvents(30)
    ]);
    const activeEventsMap = new Map();
    const evidenceByAsset = new Map();

    for (const ev of recentEvents) {
      if (ev && ev.asset_id && ev.camera_evidence && !evidenceByAsset.has(ev.asset_id)) {
        evidenceByAsset.set(ev.asset_id, ev);
      }
    }
    if (Array.isArray(statusData?.active_events)) {
      for (const ev of statusData.active_events) {
        activeEventsMap.set(ev.asset_id, ev);
        if (ev && ev.asset_id && ev.camera_evidence) {
          evidenceByAsset.set(ev.asset_id, ev);
        }
      }
    }

    const allCatalogEvents = [...recentEvents];
    if (Array.isArray(statusData?.active_events)) {
      for (const activeEv of statusData.active_events) {
        if (activeEv && !allCatalogEvents.some(e => e && e.id === activeEv.id)) {
          allCatalogEvents.unshift(activeEv);
        }
      }
    }
    setCameraEventsCatalog(allCatalogEvents);

    const roadData = statusData?.roads || evaluateRoadNetwork(statusData?.measures || {}, activeEventsMap);
    const corridorsList = roadData?.corridors_list || [];
    const counts = roadData?.counts || {
      all: corridorsList.length,
      impassable: corridorsList.filter(c => c.status === 'IMPASSABLE').length,
      encroaching: corridorsList.filter(c => c.status === 'ENCROACHING').length,
      passable: corridorsList.filter(c => c.status === 'PASSABLE').length
    };

    updateSummaryCards(counts);

    // Update filter button labels with fresh counts
    const btnAll = document.querySelector('.road-filter-btn[data-filter="all"]');
    const btnImp = document.querySelector('.road-filter-btn[data-filter="impassable"]');
    const btnEnc = document.querySelector('.road-filter-btn[data-filter="encroaching"]');
    const btnPass = document.querySelector('.road-filter-btn[data-filter="passable"]');

    if (btnAll) btnAll.textContent = `All (${counts.all || corridorsList.length})`;
    if (btnImp) btnImp.textContent = `🔴 Closed (${counts.impassable || 0})`;
    if (btnEnc) btnEnc.textContent = `🟡 Caution / Clearing (${counts.encroaching || 0})`;
    if (btnPass) btnPass.textContent = `🟢 Passable (${counts.passable || 0})`;

    // Render corridor rows with individual error boundary
    const container = document.getElementById('roads-corridors-container');
    if (container) {
      container.innerHTML = corridorsList.map(c => {
        try {
          const correlatedEv = evidenceByAsset.get(c.asset_id) || activeEventsMap.get(c.asset_id) || null;
          return renderCorridorRow(c, correlatedEv);
        } catch (rowErr) {
          console.error('[Corridor Render Error]', rowErr);
          return renderCorridorFallbackRow(c, rowErr);
        }
      }).join('');
      applyFilterToCorridors(currentFilter);
    }

    // Update freshness pill with Triple Encoding [WP 1.2]
    const freshnessPill = document.getElementById('ea-freshness-pill');
    const rawTelemetryTimestamp = statusData?.system_timestamps?.latest_ea_reading_at 
      || statusData?.generated_at 
      || null;

    if (freshnessPill) {
      if (rawTelemetryTimestamp) {
        const eaTime = new Date(rawTelemetryTimestamp);
        const diffMs = Math.max(0, Date.now() - eaTime.getTime());
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins <= 120) {
          // <= 2h: subtle green/slate pill
          const ageText = diffMins < 1 ? 'Just now' : (diffMins < 60 ? `${diffMins}m ago` : `${(diffMins / 60).toFixed(1)}h ago`);
          freshnessPill.textContent = `📡 Telemetry: ${ageText}`;
          freshnessPill.className = 'telemetry-freshness-pill freshness-fresh';
        } else if (diffMins <= 360) {
          // <= 6h: subtle amber pill
          freshnessPill.textContent = `⚠️ Telemetry: ${(diffMins / 60).toFixed(1)}h ago (Lagging)`;
          freshnessPill.className = 'telemetry-freshness-pill freshness-warning';
        } else {
          // > 6h: subtle slate pill with clock icon (DO NOT use panic red per [UI-COL-03])
          freshnessPill.textContent = `⏱️ Telemetry: ${(diffMins / 60).toFixed(1)}h ago (Stale)`;
          freshnessPill.className = 'telemetry-freshness-pill freshness-stale';
        }
      } else {
        freshnessPill.textContent = '⏱️ Telemetry: Offline / Unknown';
        freshnessPill.className = 'telemetry-freshness-pill freshness-stale';
      }
    }

    // Update print situation header timestamp
    const printTimeEl = document.getElementById('print-time-stamp');
    if (printTimeEl) {
      const printedStr = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      const telemetryStr = rawTelemetryTimestamp
        ? new Date(rawTelemetryTimestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        : 'Unknown / Stale';
      printTimeEl.textContent = `Telemetry timestamp: ${telemetryStr} | Printed: ${printedStr}. Caution: Passability inferred from EA stage telemetry relative to surveyed road crown. Not visual confirmation.`;
    }
  } catch (err) {
    console.error('[Roads View Error]', err);
  } finally {
    isRefreshing = false;
    refreshController.isRefreshing = false;
    if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'false');
    updateCountdownDisplay();
  }
}

function applyFilterToCorridors(filterKey) {
  currentFilter = filterKey;
  const rows = document.querySelectorAll('.road-corridor-row');
  rows.forEach(row => {
    const status = row.getAttribute('data-status');
    if (filterKey === 'all' || status === filterKey) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

export function setupFilterToolbar() {
  const filterBtns = document.querySelectorAll('.road-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter') || 'all';
      filterBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      applyFilterToCorridors(filter);
    });
  });
}

export function initRoadsPage() {
  initJargonPopovers();
  initCameraGuideTriggers();
  setupFilterToolbar();
  setupOfflineBanner();

  const refreshBtn = document.getElementById('btn-refresh-now');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', triggerManualRefresh);
  }

  // Initial load
  refreshRoadsView();

  // Start 60s auto refresh loop
  startAutoRefresh(60000);
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Auto-boot if in browser context
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRoadsPage);
  } else {
    initRoadsPage();
  }
}
