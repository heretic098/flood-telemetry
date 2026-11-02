import { evaluateSpillway, evaluateGateState, aggregateGlobalStatus, evaluatePumpStatus, evaluateSowyChannel, evaluateAthelneySpillway, evaluateGravityClyse, evaluateBeerWall, evaluateOathLock, evaluateDunballEmergencyPumping, getSeasonalRegime, getActiveCrestHeight, getActiveCatchmentId, loadCatchmentConfig, evaluateHuishEpiscopi, evaluateMidelney, STATION_REGISTRY, GAUGE_DATUMS, formatClearanceText, computeTrendVector, evaluateRoadNetwork, evaluateStationFreshness, getValidStageOrFallback } from './hydro_engine.js';
import { initJargonPopovers, renderJargonTerm } from './jargon_popover.js';
import {
  computeSparklineBounds,
  checkFlatStage,
  projectCoordinates,
  buildSvgPoints,
  computeTideLockIntervals,
  formatTimestampTooltip,
  calculateSparklineScrubIndex,
  calculateRatioFromEvent,
  formatRelativeAge,
  renderGridLines,
  renderYAxisLabels
} from './sparkline.js';

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

export function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatSpanUnit(deltaInMeters) {
  const absDelta = Math.abs(deltaInMeters);
  if (absDelta >= 1.0) {
    return `${deltaInMeters.toFixed(2)}m`;
  } else if (absDelta >= 0.01) {
    const cm = deltaInMeters * 100;
    return `${Number.isInteger(cm) || cm >= 10 ? cm.toFixed(0) : cm.toFixed(1)}cm`;
  } else {
    const mm = deltaInMeters * 1000;
    return `${mm.toFixed(0)}mm`;
  }
}

export function formatHeadDelta(deltaInMeters) {
  const prefix = deltaInMeters > 0 ? '+' : (deltaInMeters < 0 ? '-' : '');
  const absDelta = Math.abs(deltaInMeters);
  if (absDelta >= 1.0) {
    return `${prefix}${absDelta.toFixed(2)}m`;
  } else if (absDelta >= 0.01) {
    const cm = absDelta * 100;
    return `${prefix}${cm < 10 ? cm.toFixed(1) : cm.toFixed(0)}cm`;
  } else if (absDelta > 0) {
    const mm = absDelta * 1000;
    return `${prefix}${mm.toFixed(0)}mm`;
  } else {
    return `0cm`;
  }
}

let currentActiveRange = '24h';

export async function setupCatchmentNav(currentCatchmentId) {
  const navContainer = document.querySelector('.nav-links');
  if (!navContainer) return;

  try {
    const res = await fetch('/api/catchments');
    if (res.ok) {
      const data = await res.json();
      if (data.catchments && Array.isArray(data.catchments)) {
        const isDashboard = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/somerset') || window.location.pathname.endsWith('/somerset/');
        const isRoads = window.location.pathname.endsWith('roads.html');
        const isTopology = window.location.pathname.endsWith('topology.html');
        const isMethodology = window.location.pathname.endsWith('methodology.html');

        navContainer.innerHTML = `
          <a href="index.html" class="nav-btn nav-link ${isDashboard ? 'active' : ''}" ${isDashboard ? 'aria-current="page"' : ''}>📊 Overview</a>
          <a href="roads.html" class="nav-btn nav-link ${isRoads ? 'active' : ''}" ${isRoads ? 'aria-current="page"' : ''}>🚗 Roads &amp; Access</a>
          <a href="topology.html" class="nav-btn nav-link ${isTopology ? 'active' : ''}" ${isTopology ? 'aria-current="page"' : ''}>🗺️ River Topology</a>
          <a href="methodology.html" class="nav-btn nav-link ${isMethodology ? 'active' : ''}" ${isMethodology ? 'aria-current="page"' : ''}>📖 Methodology</a>
        `;
      }
    }
  } catch (err) {
    console.warn("Could not fetch catchments nav:", err);
  }
}

export { getValidStageOrFallback };

let autoRefreshTimer = null;
let autoRefreshIntervalMs = 60000;
let countdownRemainingSec = 60;
let isRefreshing = false;
let isUserInspecting = false;
let refreshDeferred = false;

export function updateCountdownDisplay() {
  if (typeof document === 'undefined') return;
  const pill = document.getElementById('countdown-pill');
  if (!pill) return;
  if (isRefreshing) {
    pill.classList.add('refreshing');
    pill.innerText = '🔄 Refreshing...';
  } else if (isUserInspecting) {
    pill.classList.remove('refreshing');
    pill.innerText = `⏱️ ${countdownRemainingSec}s (Paused)`;
  } else {
    pill.classList.remove('refreshing');
    pill.innerText = `⏱️ ${countdownRemainingSec}s`;
  }
}

export function startAutoRefresh(intervalMs = 60000) {
  stopAutoRefresh();
  autoRefreshIntervalMs = intervalMs;
  countdownRemainingSec = Math.max(1, Math.round(intervalMs / 1000));
  updateCountdownDisplay();

  autoRefreshTimer = setInterval(async () => {
    // If currently scrubbing / inspecting sparklines, pause auto-refresh
    if (isUserInspecting || currentHoverRatio !== null) {
      refreshDeferred = true;
      updateCountdownDisplay();
      return;
    }

    if (countdownRemainingSec > 1) {
      countdownRemainingSec--;
      updateCountdownDisplay();
    } else {
      countdownRemainingSec = Math.max(1, Math.round(autoRefreshIntervalMs / 1000));
      updateCountdownDisplay();
      await triggerManualRefresh();
    }
  }, 1000);
}

export function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

export async function triggerManualRefresh() {
  if (isRefreshing) return;
  countdownRemainingSec = Math.max(1, Math.round(autoRefreshIntervalMs / 1000));
  updateCountdownDisplay();
  await refreshLiveDashboard();
  updateCountdownDisplay();
}

export function getAutoRefreshState() {
  return {
    isRunning: autoRefreshTimer !== null,
    intervalMs: autoRefreshIntervalMs,
    remainingSec: countdownRemainingSec,
    isRefreshing,
    isUserInspecting: isUserInspecting || currentHoverRatio !== null,
    refreshDeferred
  };
}

function setupManualRefreshListener() {
  const refreshBtn = document.getElementById('btn-refresh-now');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await triggerManualRefresh();
    });
  }
}

export async function initApp() {
  initJargonPopovers();
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
    await refreshLiveDashboard();
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

export async function refreshLiveDashboard() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('cards-container');
  if (!container) return;

  isRefreshing = true;
  updateCountdownDisplay();
  const refreshBtn = document.getElementById('btn-refresh-now');
  if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'true');

  try {
    const dbData = await fetchAllTelemetryFromDB();
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
        let pillText = '';
        if (diffMins < 1) {
          pillText = 'Just now';
        } else if (diffMins <= 120) {
          pillText = diffMins < 60 ? `${diffMins}m ago` : `${(diffMins / 60).toFixed(1)}h ago`;
        } else if (diffMins <= 360) {
          pillText = `${(diffMins / 60).toFixed(1)}h ago (Lagging)`;
        } else {
          pillText = `${(diffMins / 60).toFixed(1)}h ago (Stale)`;
        }

        eaPill.innerText = `📡 Telemetry: ${pillText}`;
        eaPill.classList.remove('freshness-fresh', 'freshness-warning', 'freshness-stale');
        if (diffMins <= 120) {
          eaPill.classList.add('freshness-fresh');
        } else if (diffMins <= 360) {
          eaPill.classList.add('freshness-warning');
        } else {
          eaPill.classList.add('freshness-stale');
        }
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
          "E9094-level-stage-i-15_min-mAOD": "Dunball Inland KSD",
          "52163-level-tidal_level-i-15_min-mAOD": "Dunball Tidal Parrett",
          "52120-level-stage-i-15_min-mASD": "Huish Episcopi PS (River Yeo)",
          "52153-level-stage-i-15_min-mASD": "Midelney (River Isle)"
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
        { name: "Baltmoor Wall Defense (River Parrett ➔ Northmoor Overtopping)", config: hydroConfig.moors.northmoor?.spillway, fallback: 7.80 },
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

    // 3. Monk's Leaze / Sowy Relief Channel Live Data (52233 Upstream & 52234 Downstream Sowy)
    const monksUpReadings = (dbMeasures && dbMeasures["52233-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52233-level-stage-i-15_min-mAOD");
    const monksDownReadings = (dbMeasures && dbMeasures["52234-level-downstage-i-15_min-mAOD"]) || await fetchEAReadings("52234-level-downstage-i-15_min-mAOD");

    const monksUpLevel = getValidStageOrFallback(monksUpReadings, STATION_REGISTRY['52233'].fallback_stage_mAOD);
    const monksDownLevel = getValidStageOrFallback(monksDownReadings, STATION_REGISTRY['52234'].fallback_stage_mAOD);

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
    const inlandHistory = extractHistory(dunballInlandReadings);
    const seaHistory = extractHistory(seaReadings);
    const huishHistory = extractHistory(huishReadings, huishDatum);
    const midelneyHistory = extractHistory(midelneyReadings, midelneyDatum);

  container.innerHTML = '';

  const evals = [];

  // Progressive Disclosure: Sourced active event sessions [RULE-ENT-01]
  const activeEventsMap = new Map();
  if (Array.isArray(dbData?.active_events)) {
    for (const ev of dbData.active_events) {
      activeEventsMap.set(ev.asset_id, ev);
    }
  }

  // Dedicated Community Roads & Access Summary Bridge Banner [Issue #12 / Roads Carve-Out]
  const roadData = dbData?.roads || evaluateRoadNetwork(dbMeasures || {}, activeEventsMap);
  updateRoadStatusSummaryBanner(roadData);

  // Card 1: Curry Moor
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

  const athelneyConfig = hydroConfig?.moors?.curry_moor?.athelney_spillway;
  const athelneyCrest = getActiveCrestHeight(athelneyConfig, new Date(), 7.35);
  const athelneySpillway = evaluateAthelneySpillway(cmMoorLevel, athelneyCrest);
  const cmGravitySluice = evaluateGravityClyse(cmMoorLevel, cmRiverLevel, "Currymoor Sluice");

  // Progressive Disclosure Level 1: Centimetre Rule + 3h Trend Vector + Active Duration
  const hookbridgeActive = activeEventsMap.get('hookbridge');
  const cmTrend = computeTrendVector(cmRiverReadings);
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
    heroBanner: cmHeroBanner,
    riverTag: `Catchment: River Tone (${regime.label})`,
    eval: cmEval,
    staleInfo: cmStaleInfo,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `${cmRiverLevel.toFixed(2)}m AOD`,
    clearanceText: cmClearanceWithTrend,
    narrative: `Curry Moor Basin level is ${cmMoorLevel.toFixed(2)}m AOD (${isSummerRegime ? 'normal summer target 4.30-4.45m' : 'winter target 3.40-3.80m'}). ${cmEval.narrative}`,
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
        html: `<strong>Currymoor PS:</strong> ${currymoorPump.statusText}`,
        tooltip: `📍 Currymoor Pumping Station`
      },
      `<strong>Stanmoor PS:</strong> ${stanmoorPump.statusText}`
    ],
    camLinks: [
      { label: "Hookbridge Spillway", url: "https://thecfh.org/parretttonewsom.php#hook", title: "View 3-min EA Snapshot Camera at Hookbridge" },
      { label: "Athelney Spillway", url: "https://thecfh.org/parretttonewsom.php#athelneyspillway", title: "View 3-min EA Snapshot Camera at Athelney" },
      { label: "Currymoor PS", url: "https://thecfh.org/parretttonewsom.php#currymoor", title: "View 3-min EA Snapshot Camera at Currymoor PS" }
    ],
    spillwayMeta: { crest: hookbridgeCrest.toFixed(2), scheme: hookbridgeScheme },
    sparkline: renderSingleSparkline(cmRiverHistory, cmEval.code === 'OVERTOPPING' ? '#f87171' : (cmIsStale ? '#f59e0b' : '#4ade80'), { streamLabel: 'River Tone @ Currymoor PS', stationId: '52118', unit: 'mAOD' }),
    pumpGauge: renderPumpTriggerGauge(currymoorPump),
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
    sparkline: renderSingleSparkline(cmMoorHistory, athelneyEval.code === 'OVERTOPPING' ? '#f87171' : (athelneyIsStale ? '#f59e0b' : '#38bdf8'), { streamLabel: 'Curry Moor Basin @ Athelney', stationId: '52127', unit: 'mAOD' }),
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

  // Card 2: Northmoor & Saltmoor
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

  const nmGravitySluice = evaluateGravityClyse(nmMoorLevel, nmRiverLevel, "Northmoor Sluice");
  const beerWallConfig = hydroConfig?.moors?.northmoor?.beer_wall;
  const beerWallCrest = getActiveCrestHeight(beerWallConfig, new Date(), 7.30);
  const beerWallHist = beerWallConfig?.crest_history || [];
  const beerWallScheme = beerWallHist.length ? beerWallHist[beerWallHist.length - 1].notes : 'SRA Greylake Scheme';
  const beerWallSpillway = evaluateBeerWall(nmRiverLevel, beerWallCrest);

  const baltmoorActive = activeEventsMap.get('baltmoor_wall');
  const nmTrend = computeTrendVector(nmRiverReadings);
  const nmClearanceFormatted = formatClearanceText(baltmoorCrest - nmRiverLevel, 'defense crest');
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
    maxLabel: `Defense Crest: ${baltmoorCrest.toFixed(2)}m AOD`,
    isAlert: nmEval.code === 'OVERTOPPING' || nmEval.code === 'NEAR_CREST',
    staleInfo: nmStaleInfo,
    stats: [
      { label: 'Defense Crest', value: `${baltmoorCrest.toFixed(2)}m AOD` },
      { label: 'Defense Clearance', value: nmClearanceWithTrend }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#saltmoor',
      title: 'View 3-min EA Snapshot Camera at thecfh.org#saltmoor',
      ariaLabel: 'View 3-min EA Snapshot Camera at thecfh.org for Baltmoor Wall'
    }
  });

  container.appendChild(createMoorCard({
    title: "Northmoor & Saltmoor",
    cardId: "card-52158",
    stationId: "52158",
    cameraGuideSite: "baltmoor",
    heroBanner: nmHeroBanner,
    riverTag: `Catchment: River Parrett (${regime.label})`,
    eval: nmEval,
    staleInfo: nmStaleInfo,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `${nmRiverLevel.toFixed(2)}m AOD`,
    clearanceText: `Baltmoor Wall: ${nmClearanceWithTrend}`,
    narrative: `Baltmoor Wall Saltmoor Barrier sensor live. River levels monitored relative to 7.80m defense overtopping crest.`,
    pills: [
      {
        html: `<strong>Baltmoor Wall Overtopping:</strong> ${nmEval.symbol} ${nmEval.label} (${nmClearanceWithTrend})`,
        tooltip: `📍 Baltmoor Wall Defense Crest: ${baltmoorCrest.toFixed(2)}m AOD (${baltmoorScheme})`
      },
      {
        html: `<strong>Athelney Spillway Inflow:</strong> ${athelneySpillway.statusText}`,
        tooltip: `📍 Athelney Crest: ${athelneyCrest.toFixed(2)}m AOD | Overspill cascade from Curry Moor into Northmoor retention storage`
      },
      {
        html: `<strong>Beer Wall / Allens Spillway:</strong> ${beerWallSpillway.statusText}`,
        tooltip: `📍 Beer Wall Crest: ${beerWallCrest.toFixed(2)}m AOD (${beerWallScheme})`
      },
      `<strong>Northmoor Gravity ${renderJargonTerm('Clyse')}:</strong> ${nmGravitySluice.statusText}`,
      {
        html: `<strong>Saltmoor PS:</strong> ${saltmoorPump.statusText}`,
        tooltip: `📍 Saltmoor Pumping Station`
      },
      {
        html: `<strong>Northmoor PS:</strong> ${northmoorPump.statusText}`,
        tooltip: `📍 Northmoor Pumping Station`
      }
    ],
    camLinks: [
      { label: "Baltmoor Wall", url: "https://thecfh.org/parretttonewsom.php#saltmoor", title: "View 3-min EA Snapshot Camera at Baltmoor Wall" },
      { label: "Athelney Spillway", url: "https://thecfh.org/parretttonewsom.php#athelneyspillway", title: "View 3-min EA Snapshot Camera at Athelney" },
      { label: "Beer Wall", url: "https://thecfh.org/parretttonewsom.php#Beerwall", title: "View 3-min EA Snapshot Camera at Beer Wall" },
      { label: "Saltmoor PS", url: "https://thecfh.org/parretttonewsom.php#saltmoor", title: "View 3-min EA Snapshot Camera at Saltmoor PS" },
      { label: "Northmoor PS", url: "https://thecfh.org/parretttonewsom.php#northmoor", title: "View 3-min EA Snapshot Camera at Northmoor PS" }
    ],
    spillwayMeta: { crest: baltmoorCrest.toFixed(2), scheme: baltmoorScheme },
    sparkline: renderSingleSparkline(nmRiverHistory, nmEval.code === 'OVERTOPPING' ? '#f87171' : (nmIsStale ? '#f59e0b' : '#4ade80'), { streamLabel: 'Baltmoor Wall Barrier', stationId: '52158', unit: 'mAOD' }),
    pumpGauge: renderPumpTriggerGauge(saltmoorPump),
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

  // Card 3: Sowy Relief Channel
  const sowyEval = evaluateSowyChannel(monksUpLevel, monksDownLevel, 4.20);
  if (sowyIsStale && (sowyEval.badgeClass === 'badge-secure' || sowyEval.badgeClass === 'badge-open' || sowyEval.code === 'CLOSED' || sowyEval.code === 'GRAVITY_OPEN')) {
    sowyEval.badgeClass = sowyStaleInfo.badgeClass || 'badge-stale';
    sowyEval.symbol = sowyStaleInfo.isOffline ? '⚠️' : '🕒';
    sowyEval.label = `${sowyEval.label} (UNCONFIRMED - ${sowyStaleInfo.isOffline ? 'OFFLINE' : 'STALE'})`;
  }
  const headDropMeters = Number((monksUpLevel - monksDownLevel).toFixed(2));
  const headDropFormatted = formatHeadDelta(headDropMeters);
  const oathLock = evaluateOathLock(monksUpLevel, monksDownLevel);

  const sowyHeroBanner = renderHeroSpillwayBanner({
    icon: '🚰',
    title: "Monk's Leaze Clyse Intake Control",
    statusBadge: sowyEval,
    mainMetricValue: headDropFormatted,
    mainMetricUnit: 'Head Drop (Parrett ➔ Sowy)',
    clearanceText: `Intake Sill: 4.20m AOD`,
    minLevel: 4.20,
    maxLevel: 8.00,
    currentLevel: monksUpLevel,
    minLabel: 'Intake Sill: 4.20m',
    maxLabel: `Parrett Stage: ${monksUpLevel.toFixed(2)}m AOD`,
    isAlert: false,
    staleInfo: sowyStaleInfo,
    stats: [
      { label: 'Gate Position', htmlValue: sowyEval.code === 'GRAVITY_OPEN' ? '🔵 DIVERTING' : '🔒 PENNING / CLOSED' },
      { label: 'Intake Head Drop', value: `${headDropMeters >= 0 ? '+' : ''}${headDropMeters.toFixed(2)}m` }
    ],
    camLink: {
      url: 'https://thecfh.org/parretttonewsom.php#monksleaze',
      title: 'View 3-min EA Snapshot Camera at thecfh.org#monksleaze',
      ariaLabel: 'View 3-min EA Snapshot Camera at thecfh.org for Monk\'s Leaze Clyse'
    }
  });

  container.appendChild(createMoorCard({
    title: "Sowy Relief Channel",
    cardId: "card-52233",
    stationId: "52233",
    cameraGuideSite: "monksleaze",
    heroBanner: sowyHeroBanner,
    riverTag: `Diverts: Parrett ➔ Sedgemoor Drain (${renderJargonTerm('KSD')}) (${regime.label})`,
    eval: sowyEval,
    staleInfo: sowyStaleInfo,
    provenanceTag: "📡 DEDICATED SENSORS",
    provenanceClass: "prov-high",
    metricText: `Sowy Level: ${monksDownLevel.toFixed(2)}m AOD`,
    clearanceText: `Head Drop Across ${renderJargonTerm('Clyse')}: ${headDropFormatted} (${monksUpLevel.toFixed(3)}m ➔ ${monksDownLevel.toFixed(3)}m)`,
    narrative: sowyEval.narrative,
    pills: [
      {
        html: `<strong>Monk's Leaze ${renderJargonTerm('Clyse')}:</strong> ${sowyEval.pillText}`,
        tooltip: `📍 Monk's Leaze Sill: 4.20m AOD`
      },
      `<strong>Monk's Leaze Intake Differential:</strong> 🟢 ${headDropFormatted} Head Drop (Parrett ➔ Sowy)`,
      {
        html: `<strong>Oath Lock ${renderJargonTerm('Penning')} Sluice:</strong> ${oathLock.statusText}`,
        tooltip: `📍 Oath Lock Penning Structure`
      },
      `<strong>Upstream Tributary Inflow:</strong> River Yeo: ${huishLevel.toFixed(2)}m AOD | River Isle: ${midelneyLevel.toFixed(2)}m AOD`,
      `<strong>Beer Wall Intake (Greylake):</strong> ${monksDownLevel >= 6.00 ? '🟢 CONVEYANCE TO ' + renderJargonTerm('KSD') : '⚪ ' + renderJargonTerm('Penning') + ' LEVEL'}`
    ],
    camLinks: [
      { label: "Monk's Leaze Clyse", url: "https://thecfh.org/parretttonewsom.php#monksleaze", title: "View 3-min EA Snapshot Camera at Monk's Leaze Clyse" },
      { label: "Oath Lock Penning Sluice", url: "https://thecfh.org/parretttonewsom.php#oath", title: "View 3-min EA Snapshot Camera at Oath Lock Penning Sluice" }
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
        staleTag: monksDownFreshness.isStale ? (monksDownFreshness.isOffline ? '⚠️ OFFLINE' : `⚠️ STALE (${monksDownFreshness.ageHours}h)`) : null
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

  // Card 4: Dunball Sea Outfall
  const dunballGate = evaluateGateState(dunballInland, dunballSea, 1.0);
  const isTideLocked = dunballSea >= dunballInland;
  const dunballEmergencyThreshold = isSummerRegime ? 3.10 : 2.80;
  const dunballEmergencyPump = evaluateDunballEmergencyPumping(dunballInland, isTideLocked, dunballEmergencyThreshold);
  const dunballPumpGaugeEval = getPumpEvaluation('dunball_mobile_ps', dunballInland, 'dunball_outfall', 'Dunball Emergency Pumps', 4);

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
      `<strong>Emergency High-Volume Pumps:</strong> ${dunballEmergencyPump.statusText}`
    ],
    camLinks: [
      { label: "Dunball Clyse Outfall", url: "https://thecfh.org/parretttonewsom.php#dunball", title: "View 3-min EA Snapshot Camera at Dunball Outfall" }
    ],
    sparkline: renderDualSparkline(seaHistory, inlandHistory, isTideLocked),
    pumpGauge: renderPumpTriggerGauge(dunballPumpGaugeEval),
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

  // Card 5: Langport Confluence & Tributaries
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
      { label: 'Huish PS Status', htmlValue: huishEval.isPumpsCutoff ? '🔒 PUMPS LOCKED OUT' : (huishPump.stage >= 1 ? '🟢 PUMPS ACTIVE' : '⚪ GRAVITY DISCHARGE') },
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
        html: `<strong>Huish Episcopi Pumping Station:</strong> ${huishEval.isPumpsCutoff ? '🔒 LOCKED OUT (Yeo ≥ 8.20m AOD)' : (huishPump.stage >= 1 ? '🟢 PUMPING TO PARRETT' : '⚪ GRAVITY DISCHARGE / STANDBY')}`,
        tooltip: `📍 Huish Episcopi PS: Cut-off at 8.20m AOD to prevent Parrett levee breach`
      },
      {
        html: `<strong>Yeo Bankfull Cut-off:</strong> ${huishEval.clearanceText} (Limit: 8.20m AOD)`,
        tooltip: `📍 8.20m AOD bankfull interlock: Huish permanent pumps lock out to protect Parrett defenses`
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
    sparkline: renderDualSparkline(huishHistory, midelneyHistory, false, {
      primaryName: 'Yeo',
      secondaryName: 'Isle',
      primaryColor: huishFreshness.isStale ? '#f59e0b' : '#4ade80',
      secondaryColor: midelneyFreshness.isStale ? '#f59e0b' : '#38bdf8',
      streamLabel: '<span class="stream-dot" style="background:#4ade80; color:#4ade80"></span><span class="sparkline-title">River Yeo (52120)</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">River Isle (52153)</span>',
      showTideLock: false,
      statusPill: midelneyEval.isHeadLocked ? '🕒 Head-Locked by Parrett' : (confluenceIsStale ? '⚠️ Unconfirmed Conveyance' : '✓ Confluence Conveying')
    }),
    pumpGauge: renderPumpTriggerGauge(huishPump),
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
    if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'false');
    updateCountdownDisplay();
  }
}

function createMoorCard(opts) {
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

  const camBarHtml = ((Array.isArray(opts.camLinks) && opts.camLinks.length > 0) || opts.cameraGuideSite) ? `
    <div class="card-cam-bar" aria-label="${escapeAttr(opts.title)} Ground-Truth Cameras">
      <span class="cam-bar-label"><span aria-hidden="true">📷</span> Live Cameras:</span>
      <div class="cam-bar-links">
        ${(opts.camLinks || []).map(c => `
          <a href="${escapeAttr(c.url)}" target="_blank" rel="noopener noreferrer" class="cam-bar-btn" title="${escapeAttr(c.title || c.label)}" aria-label="${escapeAttr(c.ariaLabel || c.label)}">
            ${escapeHTML(c.label)} <span class="cam-arrow" aria-hidden="true" style="color: #38bdf8; font-weight: bold; margin-left: 2px;">↗</span>
          </a>
        `).join('')}
        ${camGuideBtn}
      </div>
    </div>
  ` : '';

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
        ${opts.gauges ? opts.gauges.map(g => `
          <div class="sub-station-gauge-card">
            <div class="gauge-info">
              <div class="gauge-name">
                <a href="${g.link}" target="_blank" rel="noopener noreferrer" class="gauge-link" title="Verify Station ${g.id} on GOV.UK">${g.name}</a>
                <span class="gauge-id-badge">ID: ${g.id}</span>
                ${g.staleTag ? `<span class="gauge-offline-tag">${escapeHTML(g.staleTag)}</span>` : ''}
              </div>
              <div class="gauge-value">${g.value}</div>
            </div>
            <div class="gauge-sparkline-box">
              ${renderMicroSparkline(g.history, g.color)}
            </div>
          </div>
        `).join('') : ''}

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

    const camBtnHtml = corridor.cam_url ? `
      <a href="${escapeAttr(corridor.cam_url)}" target="_blank" rel="noopener noreferrer" class="road-cam-btn" title="View live camera for ${escapeAttr(corridor.name)}" aria-label="View live camera for ${escapeAttr(corridor.name)}">
        <span aria-hidden="true">📷</span> ${escapeHTML(corridor.cam_label || 'Check Live Camera ↗')}
      </a>
    ` : '';

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
          ${stationBtnHtml}
        </div>
      </section>
    `;
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

function getPumpEvaluation(stationId, moorLevel, moorConfigId, stationFallbackName, defaultPumps = 2) {
  const regime = getSeasonalRegime();
  const isSummer = regime.isSummer;
  const seasonKey = isSummer ? 'summer' : 'winter';

  let psConfig = null;
  if (hydroConfig && hydroConfig.moors && hydroConfig.moors[moorConfigId]) {
    const moor = hydroConfig.moors[moorConfigId];
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
    return evaluatePumpStatus(
      moorLevel,
      psConfig.name || stationFallbackName,
      psConfig.total_pumps || defaultPumps,
      t.lead,
      t.duty,
      t.mobile_order || t.muchelney_road,
      t.mobile_active || t.secondary_road || t.river_cutoff,
      t.critical_spill || t.river_cutoff,
      isSummer
    );
  }

  // Fallback to hardcoded seasonal thresholds if hydroConfig not loaded yet
  const fallbacks = {
    currymoor_ps: {
      summer: { lead: 4.60, duty: 4.80, mobile_order: 5.80, mobile_active: 6.10, critical_spill: 7.35 },
      winter: { lead: 4.00, duty: 4.30, mobile_order: 5.80, mobile_active: 6.10, critical_spill: 7.35 }
    },
    stanmoor_ps: {
      summer: { lead: 4.70, duty: 4.90, mobile_order: 5.80, mobile_active: 6.10, critical_spill: 7.35 },
      winter: { lead: 4.10, duty: 4.40, mobile_order: 5.80, mobile_active: 6.10, critical_spill: 7.35 }
    },
    saltmoor_ps: {
      summer: { lead: 4.00, duty: 4.20, mobile_order: 4.80, mobile_active: 5.20, critical_spill: 7.80 },
      winter: { lead: 3.40, duty: 3.70, mobile_order: 4.80, mobile_active: 5.20, critical_spill: 7.80 }
    },
    northmoor_ps: {
      summer: { lead: 4.10, duty: 4.30, mobile_order: 4.80, mobile_active: 5.20, critical_spill: 7.80 },
      winter: { lead: 3.50, duty: 3.80, mobile_order: 4.80, mobile_active: 5.20, critical_spill: 7.80 }
    },
    dunball_mobile_ps: {
      summer: { lead: 3.10, duty: 3.30, mobile_order: 3.50, mobile_active: 3.70, critical_spill: 4.10 },
      winter: { lead: 2.80, duty: 3.10, mobile_order: 3.30, mobile_active: 3.50, critical_spill: 3.80 }
    },
    huish_episcopi_ps: {
      summer: { lead: 6.70, duty: 6.90, mobile_order: 7.30, mobile_active: 7.86, critical_spill: 8.20 },
      winter: { lead: 6.30, duty: 6.50, mobile_order: 7.30, mobile_active: 7.86, critical_spill: 8.20 }
    }
  };

  const fb = (fallbacks[stationId] && fallbacks[stationId][seasonKey]) || fallbacks.currymoor_ps[seasonKey];
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

export function renderPumpTriggerGauge(pumpEval) {
  if (!pumpEval || !pumpEval.thresholds) return '';

  const STAGE_FILL_COLORS = {
    0: '#38bdf8', // Standby / Calm Hydro Blue
    1: '#4ade80', // Permanent Duty Green
    2: '#facc15', // Mobile Ordered Yellow
    3: '#f87171', // Mobile Active Red
    4: '#ef4444'  // Critical Overspill Red
  };

  const fillColor = STAGE_FILL_COLORS[pumpEval.stage] || '#38bdf8';
  const regimeBadge = pumpEval.regimeTag || (pumpEval.isSummer ? '☀️ Summer Triggers' : '❄️ Winter Triggers');

  const thresholdsHTML = pumpEval.thresholds.map((t, idx) => {
    const isTop = idx % 2 === 0;
    return `
      <div class="gauge-tick ${isTop ? 'tick-top' : 'tick-bottom'}" style="left: ${t.pct}%" title="${t.label}: ${t.level.toFixed(2)}m AOD">
        <span class="tick-line"></span>
        <span class="tick-label">${t.label}<br><strong>${t.level.toFixed(2)}m</strong></span>
      </div>
    `;
  }).join('');

  return `
    <div class="pump-trigger-gauge-box">
      <div class="gauge-header">
        <div>
          <span class="gauge-title">⚙️ Pumping Operational Scale Bar</span>
          <span class="gauge-subtitle-pill">${regimeBadge}</span>
        </div>
        <span class="stage-badge ${pumpEval.badgeClass}">${pumpEval.stageLabel}</span>
      </div>
      <div class="gauge-track-container">
        <div class="gauge-track-fill" style="width: ${pumpEval.progressPct}%; background: ${fillColor};"></div>
        <div class="gauge-pin" style="left: ${pumpEval.progressPct}%" title="Current Water Level: ${pumpEval.progressPct}% of scale window">
          <span class="pin-head">▲</span>
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

export function renderMicroSparkline(points, strokeColor = '#38bdf8', minSpan = 0.50) {
  if (!points || points.length < 2) return `<span class="micro-empty">--</span>`;
  const rawValues = points.map(p => typeof p === 'object' ? p.value : p);
  const width = 110;
  const height = 24;
  
  const rawMin = Math.min(...rawValues);
  const rawMax = Math.max(...rawValues);
  const rawRange = rawMax - rawMin;

  let yMin = rawMin;
  let yMax = rawMax;

  if (rawRange < minSpan) {
    const midpoint = (rawMin + rawMax) / 2;
    yMin = midpoint - (minSpan / 2);
    yMax = midpoint + (minSpan / 2);
  }

  const effectiveRange = yMax - yMin || 1;

  const pts = rawValues.map((p, i) => {
    const x = (i / (rawValues.length - 1)) * (width - 6) + 3;
    const y = height - 3 - (((p - yMin) / effectiveRange) * (height - 6));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `
    <svg class="micro-sparkline" viewBox="0 0 ${width} ${height}" title="24h variation: ${(rawRange * 100).toFixed(1)}cm">
      <polyline fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
    </svg>
  `;
}


export function renderSingleSparkline(pointsInput, strokeColor = '#4ade80', options = {}) {
  if (!pointsInput || pointsInput.length === 0) return `<div class="sparkline-empty">No telemetry data</div>`;

  const values = pointsInput.map(p => typeof p === 'object' ? p.value : p);
  const timestamps = pointsInput.map(p => typeof p === 'object' ? p.time : '');

  const width = options.width || 300;
  const height = options.height || 75;
  const minSpan = options.minSpan !== undefined ? options.minSpan : 0.50; // Enforce minimum 50cm scale window

  const bounds = computeSparklineBounds(values, { minSpan });
  const { rawMin, rawMax, rawRange, latestVal, yMin, yMax, effectiveRange } = bounds;

  const marginTop = 16;
  const marginBottom = 16;
  const marginLeft = 8;
  const marginRight = 68;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;
  const dims = { width, height, marginTop, marginBottom, marginLeft, marginRight, drawWidth, drawHeight };

  const projected = projectCoordinates(values, bounds, dims);
  const pts = buildSvgPoints(projected);

  const topLabel = `Max ${rawMax.toFixed(2)}m`;
  const botLabel = `Min ${rawMin.toFixed(2)}m`;
  const isFlatStage = rawRange < 0.01 || topLabel === botLabel;
  const spanText = isFlatStage ? `${currentActiveRange.toUpperCase()} Range: Steady (0cm)` : `${currentActiveRange.toUpperCase()} Range: ${formatSpanUnit(rawRange)}`;

  const streamHeader = options.streamLabel ? 
    `<span class="stream-dot" style="background:${strokeColor}; color:${strokeColor}"></span><span class="sparkline-title">${options.streamLabel}</span> <span class="gauge-id-badge">ID: ${options.stationId}</span>` :
    `<span class="sparkline-title">${currentActiveRange.toUpperCase()} Telemetry</span>`;

  const centerY = marginTop + drawHeight / 2;
  const gridLinesHTML = renderGridLines(dims, isFlatStage);
  const yLabelsHTML = renderYAxisLabels(dims, bounds, isFlatStage);

  return `
    <div class="sparkline-wrapper">
      <div class="sparkline-header">
        <div class="sparkline-title-group">${streamHeader}</div>
        <div class="sparkline-stats-bar">
          <span class="sparkline-stat-pill pill-current" title="Latest stage reading">Current: <strong>${typeof latestVal === 'number' ? latestVal.toFixed(2) : '--'}${options.unit || 'mAOD'}</strong></span>
          <span class="sparkline-stat-pill" title="Minimum stage reading in active window">Min: <strong>${rawMin.toFixed(2)}m</strong></span>
          <span class="sparkline-stat-pill" title="Maximum stage reading in active window">Max: <strong>${rawMax.toFixed(2)}m</strong></span>
          <span class="sparkline-span-pill" title="Actual variation range">${spanText}</span>
        </div>
      </div>
      <svg class="sparkline" 
           viewBox="0 0 ${width} ${height}" 
           preserveAspectRatio="none"
           data-points='${JSON.stringify(values)}'
           data-timestamps='${JSON.stringify(timestamps)}'
           data-ymin="${yMin}"
           data-ymax="${yMax}"
           data-unit="${options.unit || 'mAOD'}">
        ${gridLinesHTML}
        <polyline fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
        <line class="sparkline-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />
        <rect class="sparkline-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${height}" fill="transparent" />
        ${yLabelsHTML}
      </svg>
      <div class="sparkline-tooltip"></div>
    </div>
  `;
}

export function renderDualSparkline(seaInput, inlandInput, isTideLocked, options = {}) {
  const seaValues = seaInput.map(p => typeof p === 'object' ? p.value : p);
  const inlandValues = inlandInput.map(p => typeof p === 'object' ? p.value : p);
  const timestamps = inlandInput.map(p => typeof p === 'object' ? p.time : '');

  const latestSea = seaValues[seaValues.length - 1];
  const latestInland = inlandValues[inlandValues.length - 1];

  const width = options.width || 300;
  const height = options.height || 75;

  const allPoints = [...seaValues, ...inlandValues];
  const minSpan = options.minSpan !== undefined ? options.minSpan : 1.0;
  const bounds = computeSparklineBounds(allPoints, { minSpan });
  const { rawMin, rawMax, yMin, yMax, effectiveRange } = bounds;

  const marginTop = 16;
  const marginBottom = 16;
  const marginLeft = 8;
  const marginRight = 68;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;
  const dims = { width, height, marginTop, marginBottom, marginLeft, marginRight, drawWidth, drawHeight };

  const seaProjected = projectCoordinates(seaValues, bounds, dims);
  const inlandProjected = projectCoordinates(inlandValues, bounds, dims);
  const seaPts = buildSvgPoints(seaProjected);
  const inlandPts = buildSvgPoints(inlandProjected);

  // Calculate exact historical tide-lock intervals (sea level >= inland level)
  const intervals = computeTideLockIntervals(seaValues, inlandValues);
  const n = Math.min(seaValues.length, inlandValues.length);

  const tideLockHighlights = intervals.map(inv => {
    const x1 = marginLeft + (inv.start / (n - 1)) * drawWidth;
    const x2 = marginLeft + (inv.end / (n - 1)) * drawWidth;
    const w = Math.max(x2 - x1, 2);

    if (currentActiveRange === '7d' || currentActiveRange === '30d') {
      return `<rect x="${x1.toFixed(1)}" y="${marginTop}" width="${w.toFixed(1)}" height="4" fill="rgba(230, 97, 1, 0.85)" rx="1"><title>Tide-Locked Period (Estuary Sea Level >= Inland Drain)</title></rect>`;
    } else {
      return `<rect x="${x1.toFixed(1)}" y="${marginTop}" width="${w.toFixed(1)}" height="${height - marginTop - marginBottom}" fill="rgba(230, 97, 1, 0.25)" stroke="rgba(230, 97, 1, 0.4)" stroke-width="0.5"><title>Tide-Locked Window: Sea Head Seals Passive Flap Gates</title></rect>`;
    }
  }).join('');

  const primaryName = options.primaryName || 'Inland';
  const secondaryName = options.secondaryName || 'Sea';
  const primaryColor = options.primaryColor || '#38bdf8';
  const secondaryColor = options.secondaryColor || '#0284c7';
  const statusPillText = options.statusPill !== undefined ? options.statusPill : (isTideLocked ? '🔒 Tide-Locked Window' : '✓ Gravity Discharge');
  const showTideLock = options.showTideLock !== undefined ? options.showTideLock : true;

  const streamHeader = options.streamLabel || 
    `<span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">Inland KSD (E9094)</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#0284c7; color:#0284c7"></span><span class="sparkline-title">Sea Tide (52163)</span>`;

  return `
    <div class="sparkline-wrapper">
      <div class="sparkline-header">
        <div class="sparkline-title-group">${streamHeader}</div>
        <div class="sparkline-stats-bar">
          <span class="sparkline-stat-pill" style="color:${primaryColor}" title="${primaryName} stage">${primaryName}: <strong>${typeof latestInland === 'number' ? latestInland.toFixed(2) : '--'}mAOD</strong></span>
          <span class="sparkline-stat-pill" style="color:${secondaryColor}" title="${secondaryName} stage">${secondaryName}: <strong>${typeof latestSea === 'number' ? latestSea.toFixed(2) : '--'}mAOD</strong></span>
          <span class="sparkline-span-pill ${isTideLocked ? 'pill-warning' : ''}">
            ${statusPillText}
          </span>
        </div>
      </div>
      <svg class="sparkline" 
           viewBox="0 0 ${width} ${height}" 
           preserveAspectRatio="none"
           data-points='${JSON.stringify(inlandValues)}'
           data-secondary-points='${JSON.stringify(seaValues)}'
           data-timestamps='${JSON.stringify(timestamps)}'
           data-primary-name="${escapeAttr(primaryName)}"
           data-secondary-name="${escapeAttr(secondaryName)}"
           data-ymin="${yMin}"
           data-ymax="${yMax}">
        ${showTideLock ? tideLockHighlights : ''}
        <line x1="${marginLeft}" y1="${marginTop}" x2="${width - marginRight + 5}" y2="${marginTop}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" />
        <line x1="${marginLeft}" y1="${height - marginBottom}" x2="${width - marginRight + 5}" y2="${height - marginBottom}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" />
        <polyline fill="none" stroke="${primaryColor}" stroke-width="2.2" points="${inlandPts}" />
        <polyline fill="none" stroke="${secondaryColor}" stroke-width="2.2" stroke-dasharray="4,4" points="${seaPts}" />
        <line class="sparkline-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />
        <circle class="sparkline-dot-highlight-secondary" cx="0" cy="0" r="4.5" />
        <rect class="sparkline-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${height}" fill="transparent" />
        <g transform="translate(${width - 4}, ${marginTop + 3})">
          <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label">Max ${rawMax.toFixed(2)}m</text>
        </g>
        <g transform="translate(${width - 4}, ${height - marginBottom + 3})">
          <rect x="-60" y="-10" width="60" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label">Min ${rawMin.toFixed(2)}m</text>
        </g>
      </svg>
      <div class="sparkline-tooltip"></div>
    </div>
  `;
}

let currentHoverRatio = null;
let hoverStickyTimer = null;

export function bindSparklineEvents(container = document) {
  const wrappers = container.querySelectorAll('.sparkline-wrapper');

  const updateWrapperCrosshair = (wrapper, ratio) => {
    const svg = wrapper.querySelector('svg.sparkline');
    if (!svg) return;

    const pointsData = JSON.parse(svg.dataset.points || '[]');
    const secondaryData = JSON.parse(svg.dataset.secondaryPoints || '[]');
    const timestamps = JSON.parse(svg.dataset.timestamps || '[]');
    if (!pointsData || pointsData.length === 0) return;

    const width = 300;
    const height = 75;
    const marginLeft = 8;
    const marginRight = 65;
    const marginTop = 16;
    const marginBottom = 16;
    const drawWidth = width - marginLeft - marginRight;
    const drawHeight = height - marginTop - marginBottom;

    const targetX = marginLeft + ratio * drawWidth;
    const index = calculateSparklineScrubIndex(ratio, pointsData.length);

    const primaryVal = pointsData[index];
    const yMin = parseFloat(svg.dataset.ymin);
    const yMax = parseFloat(svg.dataset.ymax);
    const effectiveRange = yMax - yMin || 1;

    const normalizedY = (primaryVal - yMin) / effectiveRange;
    const targetY = height - marginBottom - (normalizedY * drawHeight);

    const crosshairLine = svg.querySelector('.sparkline-crosshair');
    const dotHighlight = svg.querySelector('.sparkline-dot-highlight');
    const dotHalo = svg.querySelector('.sparkline-dot-halo');

    if (crosshairLine) {
      crosshairLine.setAttribute('x1', targetX.toFixed(1));
      crosshairLine.setAttribute('x2', targetX.toFixed(1));
    }
    if (dotHighlight) {
      dotHighlight.setAttribute('cx', targetX.toFixed(1));
      dotHighlight.setAttribute('cy', targetY.toFixed(1));
    }
    if (dotHalo) {
      dotHalo.setAttribute('cx', targetX.toFixed(1));
      dotHalo.setAttribute('cy', targetY.toFixed(1));
    }

    if (secondaryData.length > 0 && index < secondaryData.length) {
      const secVal = secondaryData[index];
      const secNormY = (secVal - yMin) / effectiveRange;
      const secTargetY = height - marginBottom - (secNormY * drawHeight);
      const secDot = svg.querySelector('.sparkline-dot-highlight-secondary');
      if (secDot) {
        secDot.setAttribute('cx', targetX.toFixed(1));
        secDot.setAttribute('cy', secTargetY.toFixed(1));
      }
    }

    const tooltip = wrapper.querySelector('.sparkline-tooltip');
    if (tooltip) {
      tooltip.style.left = `${(targetX / width) * 100}%`;
      const formatted = formatTimestampTooltip(timestamps[index]);
      const timeStr = formatted.timeStr;
      const dateStr = formatted.dateStr;
      
      let valText = '';
      if (secondaryData.length > 0 && index < secondaryData.length) {
        const pName = svg.dataset.primaryName || 'Inland';
        const sName = svg.dataset.secondaryName || 'Sea';
        valText = `${pName}: ${primaryVal.toFixed(2)}m | ${sName}: ${secondaryData[index].toFixed(2)}m`;
      } else {
        valText = `${primaryVal.toFixed(2)} ${svg.dataset.unit || 'mAOD'}`;
      }

      tooltip.innerHTML = `<span class="tooltip-time">${dateStr} ${timeStr}</span><span class="tooltip-val">${valText}</span>`;
    }
  };

  const updateGlobalTimestampBanner = (ratio) => {
    const banner = document.getElementById('global-timestamp-banner');
    const badge = document.getElementById('gt-mode-badge');
    const timeDisplay = document.getElementById('gt-time-display');
    const ageDisplay = document.getElementById('gt-age-display');
    const syncStatus = document.getElementById('gt-sync-status');
    if (!banner) return;

    if (ratio === null) {
      banner.classList.remove('active-inspection');
      if (badge) badge.innerText = '📡 REAL-TIME STREAM';
      if (timeDisplay) timeDisplay.innerText = 'Showing latest live telemetry across all catchments';
      if (ageDisplay) ageDisplay.innerText = '';
      if (syncStatus) syncStatus.innerText = '💡 Hover over or scrub any sparkline to inspect synchronized crosshair';
      return;
    }

    const firstSvg = container.querySelector('svg.sparkline');
    const timestamps = firstSvg ? JSON.parse(firstSvg.dataset.timestamps || '[]') : [];
    const index = calculateSparklineScrubIndex(ratio, timestamps.length);
    const formatted = formatTimestampTooltip(timestamps[index]);

    banner.classList.add('active-inspection');
    if (badge) badge.innerText = '🎯 SYNCHRONIZED INSPECTION';
    if (timeDisplay && formatted.isValid) {
      timeDisplay.innerText = `📅 ${formatted.dateFormatted}, ${formatted.timeStr} GMT`;
    }
    if (ageDisplay && formatted.isValid) {
      ageDisplay.innerText = formatRelativeAge(formatted.timeObj);
    }
    if (syncStatus) syncStatus.innerText = '[ 4/4 MOORS SYNCED ]';
  };

  const setGlobalSparklineHover = (ratio) => {
    currentHoverRatio = ratio;
    isUserInspecting = ratio !== null;
    updateGlobalTimestampBanner(ratio);
    wrappers.forEach(w => {
      if (ratio === null) {
        w.classList.remove('crosshair-active');
      } else {
        w.classList.add('crosshair-active');
        updateWrapperCrosshair(w, ratio);
      }
    });

    if (ratio === null && refreshDeferred) {
      refreshDeferred = false;
      triggerManualRefresh();
    } else {
      updateCountdownDisplay();
    }
  };

  wrappers.forEach(wrapper => {
    const svg = wrapper.querySelector('svg.sparkline');
    const overlay = wrapper.querySelector('.sparkline-touch-overlay');
    if (!svg || !overlay) return;

    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'region');
    const titleText = wrapper.querySelector('.sparkline-title')?.textContent || 'Hydrological trend';
    wrapper.setAttribute('aria-label', `${titleText} interactive sparkline. Use Left and Right Arrow keys to scrub timeline.`);

    const getRatioFromEvent = (e) => {
      return calculateRatioFromEvent(e, svg, { width: 300, marginLeft: 8, marginRight: 65 });
    };

    const handleMove = (e) => {
      if (hoverStickyTimer) clearTimeout(hoverStickyTimer);
      const ratio = getRatioFromEvent(e);
      setGlobalSparklineHover(ratio);
    };

    const handleLeave = () => {
      if (hoverStickyTimer) clearTimeout(hoverStickyTimer);
      hoverStickyTimer = setTimeout(() => {
        setGlobalSparklineHover(null);
      }, 1500);
    };

    overlay.addEventListener('pointermove', handleMove);
    overlay.addEventListener('touchmove', handleMove, { passive: true });
    overlay.addEventListener('pointerleave', handleLeave);

    wrapper.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) {
        e.preventDefault();
        let ratio = currentHoverRatio !== null ? currentHoverRatio : 1.0;
        const step = 1 / 95;

        if (e.key === 'ArrowLeft') ratio = Math.max(0, ratio - (e.shiftKey ? step * 4 : step));
        if (e.key === 'ArrowRight') ratio = Math.min(1, ratio + (e.shiftKey ? step * 4 : step));
        if (e.key === 'Home') ratio = 0;
        if (e.key === 'End') ratio = 1;
        if (e.key === 'Escape') {
          setGlobalSparklineHover(null);
          return;
        }

        setGlobalSparklineHover(ratio);
      }
    });
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
