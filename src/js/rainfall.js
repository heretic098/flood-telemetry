/**
 * Dedicated Somerset Levels Catchment Rainfall & Raingauges Controller
 *
 * Manages the standalone rainfall.html view:
 * - Two-Pillar Spatial Model (Upland River Surge Drivers vs. Lowland Basin Saturation)
 * - Basin rolling KPIs (1h / 6h / 24h / 48h), UK-frontal intensity badge, and 24h hyetographs
 * - All 14 UK Environment Agency tipping-bucket raingauges rendered directly inline with
 *   catchment zone filtering and interactive hyetograph scrubbing
 * - 60s auto-refresh controller, manual refresh, and sticky offline resilience banner
 *
 * Invariants:
 * - [RULE-SSOT-01]: Consumes RAINGAUGE_REGISTRY, PRECIPITATION_PALETTE, RAINFALL_CATCHMENT_ZONES,
 *   and classifyRainfallIntensity from hydro_engine.js.
 * - [RULE-HUM-01] / [RULE-PROV-01] / [RULE-CALC-01]: Raw mm liquid depth only; no volumetric
 *   discharge speculation; explicit OGL v3.0 attribution.
 */

import {
  RAINGAUGE_REGISTRY,
  PRECIPITATION_PALETTE,
  RAINFALL_CATCHMENT_ZONES,
  RAINFALL_PERIOD_CONFIG,
  normalizeRainfallPeriod,
  classifyRainfallIntensity
} from './hydro_engine.js';

import { initJargonPopovers, renderJargonTerm } from './jargon_popover.js';
import { createRefreshController } from './modules/refresh_controller.js';
import { setupOfflineBanner as setupResilienceBanner } from './modules/network_resilience.js';
import { escapeHTML, escapeAttr, applyFreshnessPill } from './modules/dom_utils.js';
import { renderHyetographSparkline, bindHyetographEvents } from './sparkline.js';

const RAINFALL_ZONE_ORDER = ['tone_upland', 'parrett_upland', 'isle_upland', 'moors_lowland'];

let currentZoneFilter = 'all';
let currentPeriod = '24h';
let latestRequestSeq = 0;
let latestRainfallData = null;
let lastSuccessfulSyncTime = null;
let isRefreshing = false;
let activeHyetographTeardowns = [];

export function getCurrentPeriod() {
  return currentPeriod;
}

export function resetRainfallPageStateForTests() {
  teardownHyetographs();
  currentZoneFilter = 'all';
  currentPeriod = '24h';
  latestRequestSeq = 0;
  latestRainfallData = null;
  lastSuccessfulSyncTime = null;
  isRefreshing = false;
}

export const refreshController = createRefreshController({
  intervalMs: 60000,
  countdownPillId: 'countdown-pill',
  refreshBtnId: 'btn-refresh-now',
  onRefresh: async () => { await refreshRainfallView(); }
});

export function getAutoRefreshState() {
  return refreshController.getState();
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

export function setupOfflineBanner() {
  return setupResilienceBanner({
    bannerId: 'network-offline-banner',
    onOnline: async () => { await refreshRainfallView(); },
    getLastSyncTime: () => lastSuccessfulSyncTime
  });
}

/**
 * Fetches `/api/rainfall?period=<period>` from the local backend cache.
 *
 * @param {string} [period=currentPeriod]
 */
export async function fetchRainfallFromDB(period = currentPeriod) {
  const normalizedPeriod = normalizeRainfallPeriod(period);
  try {
    const res = await fetch(`/api/rainfall?period=${encodeURIComponent(normalizedPeriod)}`);
    if (res.ok) {
      const data = await res.json();
      lastSuccessfulSyncTime = new Date();
      return data;
    }
  } catch (err) {
    console.warn(`[Rainfall View] Failed to fetch /api/rainfall?period=${normalizedPeriod}:`, err);
  }
  return null;
}

function safeRainfallNumber(val) {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0.0;
}

function resolvePeriodDisplayMeta(rainfallData) {
  const period = normalizeRainfallPeriod(rainfallData?.period || currentPeriod);
  const cfg = RAINFALL_PERIOD_CONFIG[period];
  const bucketMinutes = (typeof rainfallData?.bucket_minutes === 'number' && rainfallData.bucket_minutes > 0)
    ? rainfallData.bucket_minutes
    : cfg.bucket_minutes;
  const bucketLabel = (typeof rainfallData?.bucket_label === 'string' && rainfallData.bucket_label.trim())
    ? rainfallData.bucket_label.trim()
    : cfg.bucket_label;
  const barDesc = period === '30d'
    ? 'daily bars'
    : (period === '7d' ? '3h bars' : '15m bars');
  const periodUpper = period.toUpperCase();
  return { period, periodUpper, bucketMinutes, bucketLabel, barDesc, windowHours: cfg.window_hours };
}

/**
 * Aggregates active stations' rainfall series (adaptive `series` or `series_15min`)
 * for a pillar ('upland' or 'lowland') into a unified chronological mean bar +
 * cumulative mass curve series.
 *
 * @param {Array<object>} stations
 * @param {'upland'|'lowland'} pillar
 * @returns {Array<{ timestamp: string, rainfall_mm: number, cumulative_mm: number }>}
 */
export function buildPillarAggregateSeries(stations, pillar) {
  if (!Array.isArray(stations) || stations.length === 0) return [];
  const buckets = new Map();

  for (const st of stations) {
    if (!st || st.pillar !== pillar || st.is_stale) continue;
    const series = Array.isArray(st.series)
      ? st.series
      : (Array.isArray(st.series_15min) ? st.series_15min : []);
    for (const pt of series) {
      if (!pt || typeof pt.timestamp !== 'string' || typeof pt.rainfall_mm !== 'number' || !Number.isFinite(pt.rainfall_mm)) {
        continue;
      }
      const prev = buckets.get(pt.timestamp) || { sum: 0, count: 0 };
      prev.sum += pt.rainfall_mm;
      prev.count += 1;
      buckets.set(pt.timestamp, prev);
    }
  }

  const sortedTimestamps = Array.from(buckets.keys()).sort();
  let runningCum = 0;
  return sortedTimestamps.map((ts) => {
    const bucket = buckets.get(ts);
    const meanMm = Number((bucket.sum / Math.max(1, bucket.count)).toFixed(2));
    runningCum = Number((runningCum + meanMm).toFixed(2));
    return {
      timestamp: ts,
      rainfall_mm: meanMm,
      cumulative_mm: runningCum
    };
  });
}

/**
 * Computes null-safe metadata, active/stale counts, and atmospheric palette tokens
 * for the rainfall status banner and overview KPI strip.
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
 * Updates the honest partial-archive coverage notice (#rainfall-archive-notice) per [RULE-HUM-01].
 */
export function updateArchiveCoverageNotice(rainfallData) {
  if (typeof document === 'undefined') return;
  const noticeEl = document.getElementById('rainfall-archive-notice');
  if (!noticeEl) return;

  const { period, windowHours } = resolvePeriodDisplayMeta(rainfallData);
  const isPartial = Boolean(rainfallData?.is_partial_archive);
  const coverageHours = typeof rainfallData?.archive_coverage_hours === 'number' && Number.isFinite(rainfallData.archive_coverage_hours)
    ? rainfallData.archive_coverage_hours
    : null;

  if (!isPartial || coverageHours === null || (period === '24h' && coverageHours >= windowHours * 0.9)) {
    noticeEl.style.display = 'none';
    noticeEl.textContent = '';
    return;
  }

  const coverageText = coverageHours >= 48
    ? `${(coverageHours / 24).toFixed(1)} days (${coverageHours.toFixed(0)}h)`
    : `${coverageHours.toFixed(1)} hours`;

  noticeEl.style.display = 'block';
  noticeEl.textContent = `ℹ️ Partial Archive Coverage: Stored SQLite rainfall history currently spans ${coverageText} (less than the full ${period} window). Totals reflect available archived readings only — earlier periods before archive start are not assumed dry.`;
}

function renderCatchmentZoneRow(zoneId, zoneData, primaryKeys = ['6h', '24h'], period = '24h') {
  const zoneMeta = RAINFALL_CATCHMENT_ZONES[zoneId] || {};
  const label = zoneData?.short_label || zoneMeta.short_label || zoneId;
  const river = zoneData?.river || zoneMeta.river || '';
  const totalCount = Number(zoneData?.station_count) || 0;
  const activeCount = Number(zoneData?.active_station_count) || 0;
  const allStale = zoneData ? Boolean(zoneData.all_stale) : activeCount === 0;
  const hasFreezingRisk = Boolean(zoneData?.has_freezing_risk);

  const m1h = safeRainfallNumber(zoneData?.mean_1h_mm);
  const m6h = safeRainfallNumber(zoneData?.mean_6h_mm);
  const m24h = safeRainfallNumber(zoneData?.mean_24h_mm);
  const m48h = safeRainfallNumber(zoneData?.mean_48h_mm);
  const mPeriod = safeRainfallNumber(zoneData?.period_total_mm);
  const peakStation = typeof zoneData?.peak_station === 'string' && zoneData.peak_station.trim().length > 0
    ? zoneData.peak_station.trim()
    : null;
  const peak24h = safeRainfallNumber(zoneData?.peak_24h_mm);

  const windows = [
    { key: '1h', val: m1h },
    { key: '6h', val: m6h },
    { key: '24h', val: m24h },
    { key: '48h', val: m48h }
  ];
  if (period !== '24h') {
    windows.push({ key: period, val: mPeriod });
  }

  const focusKeys = period !== '24h' ? [...primaryKeys, period] : primaryKeys;
  const metricsHtml = windows.map((w) => {
    const isFocus = focusKeys.includes(w.key);
    const displayVal = allStale ? '—' : `${w.val.toFixed(1)}mm`;
    return `
      <span class="rainfall-zone-stat${isFocus ? ' is-focus' : ''}">
        <span class="rz-key">${w.key}</span>
        <strong>${displayVal}</strong>
      </span>
    `;
  }).join('');

  const peakText = peakStation
    ? `Peak (24h): ${escapeHTML(peakStation)} (${peak24h.toFixed(1)}mm)`
    : 'Peak (24h): No active gauges';

  const statusTagHtml = allStale
    ? '<span class="rainfall-zone-badge is-stale">🕒 All stale</span>'
    : `<span class="rainfall-zone-badge is-active">${activeCount}/${totalCount} active</span>`;

  const frostHtml = hasFreezingRisk
    ? '<span class="rainfall-zone-badge is-frost" title="Near-freezing conditions may delay tipping-bucket liquid tips">❄️ Frost risk</span>'
    : '';

  return `
    <div class="rainfall-zone-row" data-zone-id="${escapeAttr(zoneId)}">
      <div class="rainfall-zone-head">
        <div>
          <strong class="rainfall-zone-name">${escapeHTML(label)}</strong>
          ${river ? `<span class="rainfall-zone-river">${escapeHTML(river)}</span>` : ''}
        </div>
        <div class="rainfall-zone-badges">
          ${statusTagHtml}
          ${frostHtml}
        </div>
      </div>
      <div class="rainfall-zone-stats">${metricsHtml}</div>
      <div class="rainfall-zone-peak">${peakText}</div>
    </div>
  `;
}

/**
 * Updates the neutral atmospheric status banner at the top of rainfall.html.
 */
export function updateRainfallPageBanner(rainfallData) {
  if (typeof document === 'undefined') return;
  const bannerEl = document.getElementById('rainfall-status-banner');
  if (!bannerEl) return;

  const meta = getRainfallBadgeMeta(rainfallData);
  bannerEl.className = `rainfall-page-banner ${meta.pillClass}`;
  if (meta.isAllStale) {
    bannerEl.textContent = `🕒 CATCHMENT RAINFALL: AWAITING LIVE TELEMETRY (0/${meta.totalStations} RAINGAUGES ACTIVE)`;
    return;
  }
  const activeStr = meta.activeStations != null
    ? `${meta.activeStations}/${meta.totalStations} EA RAINGAUGES LIVE`
    : `${meta.totalStations} EA RAINGAUGES`;
  bannerEl.textContent = `${meta.icon} CATCHMENT RAINFALL: ${meta.headerSuffix.toUpperCase()} — ${meta.basin1h.toFixed(1)}mm (1h) | ${meta.basin24h.toFixed(1)}mm (24h) • ${activeStr}`;
}

/**
 * Renders the Two-Pillar Spatial Model overview HTML (KPI strip, 4 catchment zones,
 * upland/lowland 24h hyetographs, and UK-frontal intensity colour legend).
 *
 * @param {object|null|undefined} rainfallData
 * @returns {string}
 */
export function renderCatchmentRainfallOverview(rainfallData) {
  const summary = (rainfallData && rainfallData.rainfall_summary) || {};
  const catchments = (rainfallData && rainfallData.catchments) || {};
  const stations = Array.isArray(rainfallData?.stations) ? rainfallData.stations : [];
  const meta = getRainfallBadgeMeta(rainfallData);
  const totalRegistered = Object.keys(RAINGAUGE_REGISTRY).length;
  const { period, periodUpper, bucketMinutes, bucketLabel, barDesc } = resolvePeriodDisplayMeta(rainfallData);
  const periodMeanMm = safeRainfallNumber(summary.period_total_mm ?? meta.basin24h);

  const peakName = typeof summary.upland_peak_station === 'string' && summary.upland_peak_station.trim().length > 0
    ? summary.upland_peak_station.trim()
    : null;
  const peak24h = safeRainfallNumber(summary.upland_peak_24h_mm);
  const peak1h = safeRainfallNumber(summary.upland_peak_1h_mm);

  const uplandSeries = buildPillarAggregateSeries(stations, 'upland');
  const lowlandSeries = buildPillarAggregateSeries(stations, 'lowland');

  const uplandEmptyMsg = meta.isAllStale
    ? 'All upland raingauges are currently stale or uncached'
    : `No upland rainfall readings in ${period} window`;
  const lowlandEmptyMsg = meta.isAllStale
    ? 'All lowland raingauges are currently stale or uncached'
    : `No lowland rainfall readings in ${period} window`;

  const periodKpiTile = period !== '24h'
    ? `
        <div class="rainfall-kpi-tile">
          <span class="rainfall-kpi-label">${escapeHTML(periodUpper)} Basin Mean</span>
          <strong class="rainfall-kpi-value">${meta.isAllStale ? '—' : `${periodMeanMm.toFixed(1)} mm`}</strong>
          <span class="rainfall-kpi-sub">${escapeHTML(barDesc)} archive window</span>
        </div>
      `
    : '';

  const legendItems = [
    { label: PRECIPITATION_PALETTE.LIGHT.label, hex: PRECIPITATION_PALETTE.LIGHT.hex },
    { label: PRECIPITATION_PALETTE.MODERATE.label, hex: PRECIPITATION_PALETTE.MODERATE.hex },
    { label: PRECIPITATION_PALETTE.HEAVY.label, hex: PRECIPITATION_PALETTE.HEAVY.hex },
    { label: PRECIPITATION_PALETTE.TORRENTIAL.label, hex: PRECIPITATION_PALETTE.TORRENTIAL.hex },
    { label: 'Σ Mass Curve', hex: PRECIPITATION_PALETTE.CUMULATIVE_LINE.hex, isLine: true }
  ].map(item => `
    <span class="rainfall-legend-item">
      <span class="${item.isLine ? 'rainfall-legend-line' : 'rainfall-legend-swatch'}" style="background:${item.hex};"></span>
      <span>${escapeHTML(item.label)}</span>
    </span>
  `).join('');

  return `
    <article class="moor-card rainfall-catchment-card" id="card-rainfall">
      <div class="card-header rainfall-card-header">
        <div>
          <h2 class="card-title">🌧️ Two-Pillar Catchment Rainfall Model</h2>
          <div class="river-tag">
            ${totalRegistered} EA ${renderJargonTerm('Tipping Bucket Raingauge', 'Tipping-Bucket Raingauges')} • Atmospheric Forcing (mm depth)
          </div>
        </div>
        <div class="status-badge ${escapeAttr(meta.badgeClass)}" aria-live="polite">
          <span aria-hidden="true">${meta.icon}</span>
          <span class="sr-only">Rainfall Intensity: </span>
          <span>${escapeHTML(meta.headerSuffix.toUpperCase())}</span>
        </div>
      </div>

      <div class="rainfall-summary-strip" role="group" aria-label="Basin Rolling Rainfall Totals">
        <div class="rainfall-kpi-tile">
          <span class="rainfall-kpi-label">1h Basin Mean</span>
          <strong class="rainfall-kpi-value">${meta.isAllStale ? '—' : `${meta.basin1h.toFixed(1)} mm`}</strong>
        </div>
        <div class="rainfall-kpi-tile">
          <span class="rainfall-kpi-label">6h Basin Mean</span>
          <strong class="rainfall-kpi-value">${meta.isAllStale ? '—' : `${meta.basin6h.toFixed(1)} mm`}</strong>
        </div>
        <div class="rainfall-kpi-tile">
          <span class="rainfall-kpi-label">24h Basin Mean</span>
          <strong class="rainfall-kpi-value">${meta.isAllStale ? '—' : `${meta.basin24h.toFixed(1)} mm`}</strong>
        </div>
        <div class="rainfall-kpi-tile">
          <span class="rainfall-kpi-label">48h Basin Mean</span>
          <strong class="rainfall-kpi-value">${meta.isAllStale ? '—' : `${meta.basin48h.toFixed(1)} mm`}</strong>
        </div>
        ${periodKpiTile}
        <div class="rainfall-kpi-tile">
          <span class="rainfall-kpi-label">Gauge Network</span>
          <strong class="rainfall-kpi-value">${meta.isSummaryOnly ? 'Summary active' : `${meta.activeStations}/${meta.totalStations} active`}</strong>
          <span class="rainfall-kpi-sub">${meta.isSummaryOnly ? 'Awaiting per-gauge detail' : (meta.staleStations > 0 ? `${meta.staleStations} stale` : 'All reporting fresh')}</span>
        </div>
        <div class="rainfall-kpi-tile rainfall-kpi-peak">
          <span class="rainfall-kpi-label">Upland Peak (24h)</span>
          <strong class="rainfall-kpi-value">${peakName ? escapeHTML(peakName) : 'No active upland gauges'}</strong>
          <span class="rainfall-kpi-sub">${peakName ? `${peak24h.toFixed(1)} mm (24h) • ${peak1h.toFixed(1)} mm (1h)` : 'Awaiting fresh upland tips'}</span>
        </div>
      </div>

      <div class="rainfall-pillars-grid">
        <section class="rainfall-pillar-panel" aria-label="Pillar 1: Upland River Surge Drivers">
          <div class="rainfall-pillar-header">
            <div>
              <h3 class="rainfall-pillar-title">⛰️ Pillar 1: Upland River Surge Drivers</h3>
              <p class="rainfall-pillar-subtitle">Brendon, Blackdown, Quantock &amp; Dorset Hills — Focus: <strong>6h</strong> surge window &amp; <strong>24h</strong> totals</p>
            </div>
          </div>
          <div class="rainfall-zones-list">
            ${renderCatchmentZoneRow('tone_upland', catchments.tone_upland, ['6h', '24h'], period)}
            ${renderCatchmentZoneRow('parrett_upland', catchments.parrett_upland, ['6h', '24h'], period)}
            ${renderCatchmentZoneRow('isle_upland', catchments.isle_upland, ['6h', '24h'], period)}
          </div>
          <div class="rainfall-hyetograph-slot">
            ${renderHyetographSparkline(uplandSeries, {
              title: `Upland Mean ${periodUpper} Hyetograph (${barDesc} + Σ mm)`,
              emptyMessage: uplandEmptyMsg,
              bucketMinutes,
              bucketLabel,
              periodLabel: period
            })}
          </div>
        </section>

        <section class="rainfall-pillar-panel" aria-label="Pillar 2: Lowland Basin Saturation">
          <div class="rainfall-pillar-header">
            <div>
              <h3 class="rainfall-pillar-title">🌾 Pillar 2: Lowland Basin Saturation</h3>
              <p class="rainfall-pillar-subtitle">Curry Moor, Northmoor &amp; KSD — Focus: <strong>48h</strong> ${renderJargonTerm('Antecedent Rainfall', 'antecedent saturation')} &amp; <strong>1h</strong> intensity</p>
            </div>
          </div>
          <div class="rainfall-zones-list">
            ${renderCatchmentZoneRow('moors_lowland', catchments.moors_lowland, ['48h', '1h'], period)}
          </div>
          <div class="rainfall-hyetograph-slot">
            ${renderHyetographSparkline(lowlandSeries, {
              title: `Lowland Moors ${periodUpper} Hyetograph (${barDesc} + Σ mm)`,
              emptyMessage: lowlandEmptyMsg,
              bucketMinutes,
              bucketLabel,
              periodLabel: period
            })}
          </div>
          <div class="rainfall-lag-callout">
            <p>
              <strong>ℹ️ Understanding ${renderJargonTerm('Catchment Lag')}:</strong>
              Rain falling over the Brendon, Blackdown, Quantock, and Dorset hills takes time to travel downstream onto the Levels. How quickly river stages respond depends on storm intensity and ${renderJargonTerm('Antecedent Rainfall', 'antecedent ground wetness')}.
            </p>
            <p class="rainfall-epistemic-note">
              Raingauges report raw liquid rainfall depth (mm) at 0.20 mm/tip only — they do not measure river flow volume or sluice gate positions.
            </p>
          </div>
        </section>
      </div>

      <div class="rainfall-card-footer">
        <div class="rainfall-legend-bar" aria-label="Hyetograph intensity colour legend">${legendItems}</div>
        <div class="rainfall-footer-actions">
          <span class="rainfall-provenance-note">
            UK Environment Agency 15-min TBR Telemetry •
            <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer">Open Government Licence v3.0 ↗</a>
          </span>
        </div>
      </div>
    </article>
  `;
}

/**
 * Renders all 14 EA tipping-bucket raingauge stations directly inline, grouped by catchment zone.
 * Supports optional catchment zone filtering ('all' or a specific zone ID).
 *
 * @param {object|null|undefined} rainfallData
 * @param {string} [zoneFilter='all']
 * @returns {string}
 */
export function renderAllRaingaugesInline(rainfallData, zoneFilter = 'all') {
  const stations = Array.isArray(rainfallData?.stations) ? rainfallData.stations : [];
  const catchments = (rainfallData && rainfallData.catchments) || {};
  const { period, periodUpper, bucketMinutes, bucketLabel, barDesc } = resolvePeriodDisplayMeta(rainfallData);

  if (stations.length === 0) {
    return '<p class="rainfall-inspector-empty">No raingauge telemetry is currently cached. Check back once the Environment Agency ingest cycle completes.</p>';
  }

  const zonesToRender = zoneFilter && zoneFilter !== 'all'
    ? RAINFALL_ZONE_ORDER.filter(z => z === zoneFilter)
    : RAINFALL_ZONE_ORDER;

  return zonesToRender.map((zoneId) => {
    const zoneMeta = RAINFALL_CATCHMENT_ZONES[zoneId] || {};
    const zoneStats = catchments[zoneId] || {};
    const zoneStations = stations.filter(s => s && s.catchment === zoneId);
    if (zoneStations.length === 0) return '';

    const activeCount = Number(zoneStats.active_station_count ?? zoneStations.filter(s => !s.is_stale).length);
    const stationCardsHtml = zoneStations.map((st) => {
      const elevationLabel = (typeof st.elevation_mAOD === 'number' && Number.isFinite(st.elevation_mAOD))
        ? `${st.elevation_mAOD.toFixed(1)}m AOD`
        : 'Collector elevation pending EA survey';
      const freshnessTag = st.is_stale
        ? `<span class="rainfall-zone-badge is-stale">🕒 STALE${typeof st.age_minutes === 'number' ? ` (${Math.round(st.age_minutes / 60)}h)` : ''}</span>`
        : '<span class="rainfall-zone-badge is-active">🟢 FRESH</span>';
      const frostTag = st.freezing_risk
        ? '<span class="rainfall-zone-badge is-frost">❄️ FREEZING RISK</span>'
        : '';
      const rawStationUrl = typeof st.provenance?.station_url === 'string' ? st.provenance.station_url.trim() : '';
      const fallbackStationUrl = `https://environment.data.gov.uk/flood-monitoring/id/stations/${encodeURIComponent(st.id || '')}`;
      const stationUrl = /^https?:\/\//i.test(rawStationUrl) ? rawStationUrl : fallbackStationUrl;

      const hasNoReadings = Boolean(st.is_stale && (st.valid_reading_count ?? 0) === 0);
      const fmtStationMm = (val) => (hasNoReadings ? '—' : `${safeRainfallNumber(val).toFixed(1)}mm`);
      const rateText = hasNoReadings ? 'Awaiting sync' : (st.rate_label || 'Dry (0.0 mm/h)');
      const stationSeries = Array.isArray(st.series) ? st.series : (st.series_15min || []);
      const periodTotalSpan = period !== '24h'
        ? `<span>${escapeHTML(period)}: <strong>${fmtStationMm(st.period_total_mm)}</strong></span>`
        : '';

      return `
        <article class="rainfall-station-inspector-card" data-station-id="${escapeAttr(st.id)}" data-zone="${escapeAttr(zoneId)}">
          <div class="rainfall-station-top">
            <div>
              <h4 class="rainfall-station-name">${escapeHTML(st.name || st.id)}</h4>
              <div class="rainfall-station-meta">ID: <code>${escapeHTML(st.id)}</code> • ${escapeHTML(elevationLabel)}</div>
            </div>
            <div class="rainfall-zone-badges">
              ${freshnessTag}
              ${frostTag}
            </div>
          </div>
          <div class="rainfall-station-totals">
            <span>1h: <strong>${fmtStationMm(st.last_1h_mm)}</strong></span>
            <span>6h: <strong>${fmtStationMm(st.last_6h_mm)}</strong></span>
            <span>24h: <strong>${fmtStationMm(st.last_24h_mm)}</strong></span>
            <span>48h: <strong>${fmtStationMm(st.last_48h_mm)}</strong></span>
            ${periodTotalSpan}
            <span>Rate: <strong>${escapeHTML(rateText)}</strong></span>
          </div>
          <div class="rainfall-station-sparkline">
            ${renderHyetographSparkline(stationSeries, {
              title: `${st.ea_label || st.name || st.id} ${periodUpper} Hyetograph (${barDesc})`,
              emptyMessage: st.is_stale ? 'Gauge batch stale — awaiting EA readings' : `No rainfall tips in ${period} window`,
              bucketMinutes,
              bucketLabel,
              periodLabel: period
            })}
          </div>
          <div class="rainfall-station-links">
            <a href="${escapeAttr(stationUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link-btn">EA Station ${escapeHTML(st.id)} ↗</a>
          </div>
        </article>
      `;
    }).join('');

    return `
      <section class="rainfall-inspector-zone-group" data-zone-group="${escapeAttr(zoneId)}">
        <div class="rainfall-inspector-zone-header">
          <h3>${escapeHTML(zoneStats.label || zoneMeta.label || zoneId)}</h3>
          <span class="rainfall-zone-badge ${activeCount > 0 ? 'is-active' : 'is-stale'}">${activeCount}/${zoneStations.length} active</span>
        </div>
        <div class="rainfall-inspector-stations-grid">
          ${stationCardsHtml}
        </div>
      </section>
    `;
  }).join('');
}

function teardownHyetographs() {
  activeHyetographTeardowns.forEach((fn) => {
    if (typeof fn === 'function') fn();
  });
  activeHyetographTeardowns = [];
  if (refreshController && typeof refreshController.setScrubbing === 'function') {
    refreshController.setScrubbing(false);
  }
}

function renderRainfallPageDom(rainfallData) {
  if (typeof document === 'undefined') return;
  teardownHyetographs();

  updateRainfallPageBanner(rainfallData);
  updateArchiveCoverageNotice(rainfallData);

  const hintEl = document.getElementById('rainfall-period-hint');
  if (hintEl) {
    const { period, barDesc } = resolvePeriodDisplayMeta(rainfallData);
    hintEl.textContent = period === '24h'
      ? '15-minute bars • Live rolling totals'
      : `${period.toUpperCase()} window (${barDesc}) • Live 1h/24h/48h totals preserved`;
  }

  const overviewEl = document.getElementById('rainfall-overview-container');
  if (overviewEl) {
    overviewEl.innerHTML = renderCatchmentRainfallOverview(rainfallData);
    const overviewTeardowns = bindHyetographEvents(overviewEl, { stickyDelay: 1200, refreshController }) || [];
    activeHyetographTeardowns.push(...overviewTeardowns);
  }

  const stationsEl = document.getElementById('rainfall-stations-container');
  if (stationsEl) {
    stationsEl.innerHTML = renderAllRaingaugesInline(rainfallData, currentZoneFilter);
    const stationTeardowns = bindHyetographEvents(stationsEl, { stickyDelay: 1200, refreshController }) || [];
    activeHyetographTeardowns.push(...stationTeardowns);
  }

  // Update freshness pill from newest active raingauge timestamp or API snapshot timestamp
  const eaPill = document.getElementById('ea-freshness-pill');
  const stations = Array.isArray(rainfallData?.stations) ? rainfallData.stations : [];
  let newestTs = null;
  for (const st of stations) {
    if (st && typeof st.latest_timestamp === 'string') {
      if (!newestTs || st.latest_timestamp > newestTs) {
        newestTs = st.latest_timestamp;
      }
    }
  }
  const freshnessTs = newestTs || rainfallData?.latest_rainfall_reading_at || rainfallData?.updated_at || null;
  if (eaPill) {
    if (freshnessTs) {
      applyFreshnessPill(eaPill, freshnessTs);
    } else {
      eaPill.textContent = '📡 Telemetry: Awaiting sync';
    }
  }
  const printStamp = document.getElementById('print-time-stamp');
  if (printStamp) {
    printStamp.textContent = freshnessTs ? new Date(freshnessTs).toLocaleString() : new Date().toLocaleString();
  }
}

function bindFilterControls() {
  if (typeof document === 'undefined') return;
  const buttons = document.querySelectorAll('.rainfall-filter-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const zone = btn.dataset.zone || 'all';
      currentZoneFilter = zone;
      buttons.forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderRainfallPageDom(latestRainfallData);
    });
  });
}

export async function setRainfallPeriod(period) {
  const normalized = normalizeRainfallPeriod(period);
  currentPeriod = normalized;

  if (typeof document !== 'undefined') {
    const buttons = document.querySelectorAll('.rainfall-period-btn');
    buttons.forEach((b) => {
      const isActive = (b.dataset.period || '24h') === normalized;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  await refreshRainfallView(normalized, { force: true });
}

function bindPeriodControls() {
  if (typeof document === 'undefined') return;
  const buttons = document.querySelectorAll('.rainfall-period-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period || '24h';
      setRainfallPeriod(period);
    });
  });
}

export async function refreshRainfallView(period = currentPeriod, options = {}) {
  const force = Boolean(options.force);
  if (isRefreshing && !force) return;

  const targetPeriod = normalizeRainfallPeriod(period);
  const seq = ++latestRequestSeq;

  isRefreshing = true;
  refreshController.isRefreshing = true;
  refreshController.updateDisplay();
  const refreshBtn = document.getElementById('btn-refresh-now');
  if (refreshBtn) refreshBtn.setAttribute('aria-busy', 'true');

  try {
    const fetched = await fetchRainfallFromDB(targetPeriod);
    // Discard stale out-of-order responses when a newer period switch has already fired
    if (seq !== latestRequestSeq) return;
    if (fetched) {
      latestRainfallData = fetched;
    }
    renderRainfallPageDom(latestRainfallData);
  } finally {
    if (seq === latestRequestSeq) {
      isRefreshing = false;
      refreshController.isRefreshing = false;
      refreshController.updateDisplay();
      if (refreshBtn) refreshBtn.removeAttribute('aria-busy');
    }
  }
}

export async function initRainfallPage() {
  initJargonPopovers();
  bindPeriodControls();
  bindFilterControls();
  setupOfflineBanner();
  await refreshRainfallView(currentPeriod, { force: true });
  startAutoRefresh(60000);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRainfallPage);
  } else {
    initRainfallPage();
  }
}
