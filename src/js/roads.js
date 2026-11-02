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

import { openCameraGuide } from './camera_guide.js';
import { initJargonPopovers } from './jargon_popover.js';

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

let autoRefreshTimer = null;
let countdownTimer = null;
let remainingSeconds = 60;
let refreshIntervalMs = 60000;
let isRefreshing = false;
let currentFilter = 'all';
let lastSuccessfulSyncTime = null;

export function getAutoRefreshState() {
  return {
    isRunning: autoRefreshTimer !== null,
    remainingSec: remainingSeconds,
    intervalMs: refreshIntervalMs,
    isRefreshing
  };
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

export function updateCountdownDisplay() {
  if (typeof document === 'undefined') return;
  const pill = document.getElementById('countdown-pill');
  if (pill) {
    if (isRefreshing) {
      pill.textContent = '⏱️ Syncing...';
      pill.classList.add('syncing');
    } else {
      pill.textContent = `⏱️ ${remainingSeconds}s`;
      pill.classList.remove('syncing');
    }
  }
}

export function startAutoRefresh(intervalMs = 60000) {
  stopAutoRefresh();
  refreshIntervalMs = intervalMs;
  remainingSeconds = Math.round(intervalMs / 1000);
  updateCountdownDisplay();

  countdownTimer = setInterval(() => {
    remainingSeconds = Math.max(0, remainingSeconds - 1);
    updateCountdownDisplay();
  }, 1000);

  autoRefreshTimer = setInterval(async () => {
    remainingSeconds = Math.round(refreshIntervalMs / 1000);
    await refreshRoadsView();
  }, refreshIntervalMs);
}

export function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

export async function triggerManualRefresh() {
  remainingSeconds = Math.round(refreshIntervalMs / 1000);
  await refreshRoadsView();
}

/**
 * Updates the sticky network offline banner
 */
export function setupOfflineBanner() {
  if (typeof window === 'undefined') return;

  const banner = document.getElementById('network-offline-banner');
  if (!banner) return;

  function handleOffline() {
    const timeStr = lastSuccessfulSyncTime
      ? lastSuccessfulSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '--:--';
    banner.textContent = `⚠️ Network Disconnected — Displaying cached data from ${timeStr}`;
    banner.className = 'network-offline-banner offline';
    banner.style.display = 'block';
  }

  async function handleOnline() {
    banner.textContent = '✅ Connection Restored — Refreshing data...';
    banner.className = 'network-offline-banner online';
    banner.style.display = 'block';
    await refreshRoadsView();
    setTimeout(() => {
      banner.style.display = 'none';
    }, 2500);
  }

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);

  if (!navigator.onLine) {
    handleOffline();
  }
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
 * Renders individual corridor HTML row
 */
export function renderCorridorRow(corridor) {
  if (!corridor) return '';
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
        ${camBtnHtml}
        ${camGuideBtnHtml}
        ${topologyBtnHtml}
        ${stationBtnHtml}
      </div>
    </section>
  `;
}

/**
 * Refreshes the dedicated roads view data and updates DOM
 */
export async function refreshRoadsView() {
  if (typeof document === 'undefined') return;

  isRefreshing = true;
  updateCountdownDisplay();
  const refreshBtn = document.getElementById('btn-refresh-now');
  if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'true');

  try {
    const statusData = await fetchTelemetryData();
    const activeEventsMap = new Map();
    if (Array.isArray(statusData?.active_events)) {
      for (const ev of statusData.active_events) {
        activeEventsMap.set(ev.asset_id, ev);
      }
    }

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

    // Render corridor rows
    const container = document.getElementById('roads-corridors-container');
    if (container) {
      container.innerHTML = corridorsList.map(renderCorridorRow).join('');
      applyFilterToCorridors(currentFilter);
    }

    // Update freshness pill
    const freshnessPill = document.getElementById('ea-freshness-pill');
    if (freshnessPill) {
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      freshnessPill.textContent = `📡 Telemetry: ${nowStr}`;
      freshnessPill.className = 'telemetry-freshness-pill prov-high';
    }

    // Update print situation header timestamp
    const printTimeEl = document.getElementById('print-time-stamp');
    if (printTimeEl) {
      printTimeEl.textContent = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    }
  } catch (err) {
    console.error('[Roads View Error]', err);
  } finally {
    isRefreshing = false;
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
