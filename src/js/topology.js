/**
 * River Network Topology Map Client Script
 * Handles real-time telemetry fetching, SVG rendering, catchment filtering,
 * status token ring rendering, animated flow paths, and side-by-side node inspection drawer.
 */

import {
  evaluateSpillway,
  evaluateSowyChannel,
  evaluateOathLock,
  evaluateBeerWall,
  formatHeadDelta,
  escapeHTML,
  escapeAttr,
  evaluateHuishEpiscopi,
  evaluateMidelney,
  evaluatePumpStatus,
  getSeasonalRegime,
  DEFAULT_TOPOLOGY_NODES,
  DEFAULT_TOPOLOGY_EDGES,
  STATION_REGISTRY,
  HYDRO_THRESHOLDS,
  GAUGE_DATUMS,
  STATION_BASELINES,
  computeTrendVector,
  computeStageRates,
  disambiguateRiverTrend,
  formatClearanceText,
  ASSET_DEFINITIONS,
  evaluateStationFreshness,
  TOPOLOGY_NETWORK_CONFIG,
  PRECIPITATION_PALETTE,
  classifyRainfallIntensity,
  RAINGAUGE_REGISTRY,
  RAINGAUGE_PROVENANCE
} from './hydro_engine.js';

import { initJargonPopovers, renderJargonTerm } from './jargon_popover.js';
import { setCameraEventsCatalog, initCameraGuideTriggers } from './camera_guide.js';
import { createRefreshController } from './modules/refresh_controller.js';
import { setupOfflineBanner as setupResilienceBanner } from './modules/network_resilience.js';
import { applyFreshnessPill } from './modules/dom_utils.js';
import { buildStaffGaugePanel, loadFrame } from './modules/staff_gauge_panel.js';

import {
  renderInspectorSparkline,
  bindInspectorSparklineEvents
} from './sparkline.js';

// Threshold labels derived from the single source of truth [RULE-SSOT-01]
const T_MONKS = HYDRO_THRESHOLDS['52233'] || {};
const T_BEER = HYDRO_THRESHOLDS['52157'] || {};
const fmtM = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

let topologyData = null;
let statusData = null;
let historyData = null;
let rainfallData = null;
let rainfallLayerActive = true;
let eventsData = [];
let activeFilter = 'all';
let activeStatusFilter = null;
let selectedNodeId = '52118'; // Default selection: Hookbridge Spillway
export let refreshController = null;

// Village & Area Focus Mappings (Issue #5)
export const AREA_MAPPINGS = {
  taunton: {
    name: 'Taunton',
    primaryNodeId: '52111',
    catchment: 'tone',
    stations: ['52108', '52109', '52111', '52162']
  },
  langport: {
    name: 'Langport',
    primaryNodeId: '52233',
    catchment: 'parrett',
    stations: ['52233', '52234', '52120', '52153']
  },
  burrowbridge: {
    name: 'Burrowbridge',
    primaryNodeId: '52158',
    catchment: 'all',
    stations: ['52158', '52118', '52159', '52127']
  },
  muchelney: {
    name: 'Muchelney',
    primaryNodeId: '52120',
    catchment: 'tributaries',
    stations: ['52120', '52153', '52119']
  },
  curry_moor: {
    name: 'Curry Moor',
    primaryNodeId: '52118',
    catchment: 'tone',
    stations: ['52118', '52127']
  },
  bridgwater: {
    name: 'Bridgwater',
    primaryNodeId: '52124',
    catchment: 'parrett',
    stations: ['52124', '52163', 'E9094']
  }
};

let activeAreaFilter = null;

// Node layout mapping for 960x620 SVG viewBox (Geographically Calibrated Somerset Topology)
const NODE_COORDINATES = {
  // Northern Terminus: Dunball Estuary & King's Sedgemoor Drain (Tier 1: y = 70 to 110)
  '52163': { x: 300, y: 70,  labelPos: 'left' },   // Dunball Tidal Outfall (Parrett Estuary terminus)
  'E9094': { x: 440, y: 70,  labelPos: 'top' },    // Dunball Inland KSD Outfall (Discharges into Estuary)
  'E9531': { x: 640, y: 110, labelPos: 'top' },    // Bradney (King's Sedgemoor Drain)
  '52157': { x: 770, y: 200, labelPos: 'right' },  // Beerwall Upstream (Greylake / Mid-Sowy Relief)

  // Lower Parrett, Bridgwater & Burrowbridge Confluence (Tier 2: y = 170 to 230)
  '52124': { x: 340, y: 170, labelPos: 'left' },   // West Quay Bridgwater (Tidal Parrett)
  '52158': { x: 490, y: 230, labelPos: 'top' },    // Baltmoor Wall (Burrowbridge Tone + Parrett Confluence)
  '52159': { x: 590, y: 200, labelPos: 'right' },  // Northmoor Basin (Embanked Lowland Polder)

  // River Tone Catchment (Tier 3: South-West Upland to North-East Lowland Confluence)
  '52108': { x: 80,  y: 500, labelPos: 'top' },    // Greenham (Upper Tone, Blackdown Hills)
  '52109': { x: 170, y: 440, labelPos: 'top' },    // Bishops Hull (Mid Tone, West of Taunton)
  '52111': { x: 260, y: 390, labelPos: 'top' },    // Taunton Market (Urban Tone)
  '52162': { x: 350, y: 340, labelPos: 'top' },    // Bathpool Outfall (Lower Tone, East of Taunton)
  '52118': { x: 440, y: 300, labelPos: 'top' },    // Hookbridge Spillway / Currymoor PS (Tone Relief)
  '52127': { x: 440, y: 415, labelPos: 'bottom' }, // Curry Moor Basin (Lowland Embanked Polder)

  // Upper Parrett Catchment & Confluence Gateways (Tier 4: South to North-West)
  '52116': { x: 730, y: 540, labelPos: 'bottom' }, // Chiselborough (Upper Parrett Upland)
  '52119': { x: 690, y: 460, labelPos: 'left' },   // Gaw Bridge (Mid Parrett)
  '52153': { x: 580, y: 415, labelPos: 'left' },   // Midelney (River Isle Gateway, South-West of Langport)
  '52120': { x: 800, y: 420, labelPos: 'right' },  // Huish Episcopi PS (River Yeo Gateway, East of Langport)
  '52233': { x: 680, y: 345, labelPos: 'top' },    // Monk's Leaze Clyse Upstream (Parrett at Langport)
  '52234': { x: 780, y: 310, labelPos: 'right' }   // Monk's Leaze Clyse Downstream (Sowy Relief Intake)
};

let currentViewBox = { x: 0, y: 0, w: 960, h: 620 };
const DEFAULT_VIEWBOX = { x: 0, y: 0, w: 960, h: 620 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let isDragMoved = false;


let currentActiveRange = '24h';
let lastSuccessfulSyncTime = null;

export function setupOfflineBanner() {
  return setupResilienceBanner({
    bannerId: 'network-offline-banner',
    onOnline: async () => { await loadTopologyData(false); },
    getLastSyncTime: () => lastSuccessfulSyncTime
  });
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
      await loadTopologyData(false);
    });
  });

  // Rehydrate from sessionStorage
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

async function initTopology() {
  initJargonPopovers();
  initCameraGuideTriggers();
  setupOfflineBanner();
  setupPeriodListeners();
  if (typeof window !== 'undefined' && window.location) {
    const urlParams = new URLSearchParams(window.location.search);
    const stationParam = urlParams.get('station') || urlParams.get('node');
    const catchmentParam = urlParams.get('catchment');
    const areaParam = urlParams.get('area');

    if (catchmentParam && ['all', 'tone', 'parrett', 'sowy_ksd', 'tributaries'].includes(catchmentParam)) {
      activeFilter = catchmentParam;
    }
    if (areaParam && AREA_MAPPINGS[areaParam]) {
      activeAreaFilter = areaParam;
      if (!stationParam && AREA_MAPPINGS[areaParam].primaryNodeId) {
        selectedNodeId = AREA_MAPPINGS[areaParam].primaryNodeId;
      }
    }
    if (stationParam) {
      selectedNodeId = stationParam;
    }
  }

  setupFilterListeners();
  setupRainfallLayerToggle();
  setupAreaFocusListeners();
  setupLegendListeners();
  setupSVGDelegation();
  setupZoomPanControls();
  setupKeyboardNavigation();

  // Re-sync active state on area focus buttons
  if (activeAreaFilter) {
    const activeBtn = document.querySelector(`.area-pill-btn[data-area="${activeAreaFilter}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-pressed', 'true');
    }
  }
  
  const btnClose = document.getElementById('btn-inspector-close');
  if (btnClose) {
    btnClose.addEventListener('click', deselectNode);
  }

  await loadTopologyData();
  
  // Set up 60-second auto-refresh via shared controller
  refreshController = createRefreshController({
    intervalMs: 60000,
    countdownPillId: 'countdown-pill',
    refreshBtnId: 'btn-refresh-now',
    onRefresh: async () => { await loadTopologyData(true); }
  });
  refreshController.start();
}

export function setupAreaFocusListeners() {
  const areaButtons = document.querySelectorAll('.area-pill-btn');
  areaButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const areaKey = btn.getAttribute('data-area');
      const area = AREA_MAPPINGS[areaKey];
      if (!area) return;

      if (activeAreaFilter === areaKey) {
        // Toggle off area filter
        activeAreaFilter = null;
        areaButtons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        syncUrlState();
        renderSVGNetwork();
        return;
      }

      activeAreaFilter = areaKey;
      areaButtons.forEach(b => {
        const isMatch = b.getAttribute('data-area') === areaKey;
        b.classList.toggle('active', isMatch);
        b.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
      });

      // Switch catchment button if area is associated with specific catchment
      if (area.catchment && area.catchment !== activeFilter) {
        activeFilter = area.catchment;
        const filterBtns = document.querySelectorAll('.filter-buttons .filter-btn[data-catchment]');
        filterBtns.forEach(fb => {
          const match = fb.getAttribute('data-catchment') === activeFilter;
          fb.classList.toggle('active', match);
          fb.setAttribute('aria-pressed', match ? 'true' : 'false');
        });
      }

      inspectNode(area.primaryNodeId);
      syncUrlState();
    });
  });
}

function deselectNode() {
  selectedNodeId = null;
  syncUrlState();
  renderSVGNetwork();
  const placeholder = document.getElementById('inspector-placeholder');
  const content = document.getElementById('inspector-content');
  if (placeholder) placeholder.classList.remove('hidden');
  if (content) content.classList.add('hidden');
}

function syncUrlState() {
  if (typeof window === 'undefined' || !window.location) return;
  const params = new URLSearchParams();
  if (selectedNodeId) params.set('station', selectedNodeId);
  if (activeFilter && activeFilter !== 'all') params.set('catchment', activeFilter);
  if (activeAreaFilter) params.set('area', activeAreaFilter);
  const newQuery = params.toString() ? `?${params.toString()}` : window.location.pathname;
  window.history.replaceState(null, '', newQuery);
}

function setupKeyboardNavigation() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      if (selectedNodeId) {
        deselectNode();
      }
    }
  });
}

function setupLegendListeners() {
  const legendItems = document.querySelectorAll('.topology-legend .legend-item');
  legendItems.forEach(item => {
    item.addEventListener('click', () => {
      const status = item.getAttribute('data-status');
      if (activeStatusFilter === status) {
        activeStatusFilter = null;
        legendItems.forEach(li => li.classList.remove('active-filter'));
      } else {
        activeStatusFilter = status;
        legendItems.forEach(li => li.classList.remove('active-filter'));
        item.classList.add('active-filter');
      }
      renderSVGNetwork();
    });
  });
}

function setupZoomPanControls() {
  const svg = document.getElementById('topology-svg');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  if (btnZoomIn) btnZoomIn.addEventListener('click', () => zoomView(0.8));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => zoomView(1.25));
  if (btnZoomReset) btnZoomReset.addEventListener('click', () => resetView());

  if (!svg) return;

  const wrapper = document.getElementById('svg-wrapper');
  if (wrapper) {
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const svgX = currentViewBox.x + (mouseX / rect.width) * currentViewBox.w;
      const svgY = currentViewBox.y + (mouseY / rect.height) * currentViewBox.h;
      zoomViewAt(zoomFactor, svgX, svgY);
    }, { passive: false });
  }

  svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isPanning = true;
    isDragMoved = false;
    panStart = { x: e.clientX, y: e.clientY };
    svg.classList.add('panning');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      isDragMoved = true;
    }
    const svgRect = svg.getBoundingClientRect();
    const scaleX = currentViewBox.w / svgRect.width;
    const scaleY = currentViewBox.h / svgRect.height;

    currentViewBox.x -= dx * scaleX;
    currentViewBox.y -= dy * scaleY;
    panStart = { x: e.clientX, y: e.clientY };
    applyViewBox();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      svg.classList.remove('panning');
    }
  });

  let touchStartDist = 0;
  svg.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isPanning = true;
      isDragMoved = false;
      panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      isPanning = false;
      touchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  svg.addEventListener('touchmove', (e) => {
    if (isPanning && e.touches.length === 1) {
      const dx = e.touches[0].clientX - panStart.x;
      const dy = e.touches[0].clientY - panStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragMoved = true;
      const svgRect = svg.getBoundingClientRect();
      currentViewBox.x -= dx * (currentViewBox.w / svgRect.width);
      currentViewBox.y -= dy * (currentViewBox.h / svgRect.height);
      panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      applyViewBox();
    } else if (e.touches.length === 2 && touchStartDist > 0) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = touchStartDist / currentDist;
      zoomView(factor);
      touchStartDist = currentDist;
    }
  }, { passive: true });

  svg.addEventListener('touchend', () => {
    isPanning = false;
  }, { passive: true });
}

function zoomView(factor) {
  const centerX = currentViewBox.x + currentViewBox.w / 2;
  const centerY = currentViewBox.y + currentViewBox.h / 2;
  zoomViewAt(factor, centerX, centerY);
}

function zoomViewAt(factor, focusX, focusY) {
  const minW = 240;
  const maxW = 1920;
  const newW = Math.max(minW, Math.min(maxW, currentViewBox.w * factor));
  const newH = Math.max(155, Math.min(1240, currentViewBox.h * factor));

  currentViewBox.x = focusX - (focusX - currentViewBox.x) * (newW / currentViewBox.w);
  currentViewBox.y = focusY - (focusY - currentViewBox.y) * (newH / currentViewBox.h);
  currentViewBox.w = newW;
  currentViewBox.h = newH;

  applyViewBox();
}

function resetView() {
  currentViewBox = { ...DEFAULT_VIEWBOX };
  applyViewBox();
}

function applyViewBox() {
  const svg = document.getElementById('topology-svg');
  const zoomDisplay = document.getElementById('zoom-level-display');

  if (svg) {
    svg.setAttribute('viewBox', `${currentViewBox.x.toFixed(1)} ${currentViewBox.y.toFixed(1)} ${currentViewBox.w.toFixed(1)} ${currentViewBox.h.toFixed(1)}`);
  }

  if (zoomDisplay) {
    const scalePct = Math.round((DEFAULT_VIEWBOX.w / currentViewBox.w) * 100);
    zoomDisplay.innerText = `${scalePct}%`;
  }
}

function setupSVGDelegation() {
  const svg = document.getElementById('topology-svg');
  if (!svg) return;

  svg.addEventListener('click', (e) => {
    if (isDragMoved) return; // Prevent selection when dragging to pan
    const group = e.target.closest('.topology-node-group');
    if (group) {
      const id = group.getAttribute('data-id');
      inspectNode(id, false);
      return;
    }
    const badge = e.target.closest('.topology-edge-badge');
    if (badge) {
      const targetId = badge.getAttribute('data-target-node');
      if (targetId) {
        inspectNode(targetId, false);
      }
      return;
    }
    const rainBadge = e.target.closest('.upland-rainfall-badge');
    if (rainBadge) {
      const targetId = rainBadge.getAttribute('data-target-node');
      if (targetId) {
        inspectNode(targetId, false);
      }
    }
  });

  svg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const group = e.target.closest('.topology-node-group');
      if (group) {
        e.preventDefault();
        const id = group.getAttribute('data-id');
        inspectNode(id, true);
        return;
      }
      const badge = e.target.closest('.topology-edge-badge');
      if (badge) {
        e.preventDefault();
        const targetId = badge.getAttribute('data-target-node');
        if (targetId) {
          inspectNode(targetId, true);
        }
        return;
      }
      const rainBadge = e.target.closest('.upland-rainfall-badge');
      if (rainBadge) {
        e.preventDefault();
        const targetId = rainBadge.getAttribute('data-target-node');
        if (targetId) {
          inspectNode(targetId, true);
        }
      }
    }
  });
}

export function setupRainfallLayerToggle() {
  const btn = document.getElementById('btn-rainfall-layer');
  if (!btn) return;
  btn.classList.toggle('active', rainfallLayerActive);
  btn.setAttribute('aria-pressed', String(rainfallLayerActive));
  btn.addEventListener('click', () => {
    rainfallLayerActive = !rainfallLayerActive;
    btn.classList.toggle('active', rainfallLayerActive);
    btn.setAttribute('aria-pressed', String(rainfallLayerActive));
    renderSVGNetwork();
  });
}

export function setupFilterListeners() {
  const filterBtns = document.querySelectorAll('.filter-btn[data-catchment]');
  filterBtns.forEach(btn => {
    if (btn.getAttribute('data-catchment') === activeFilter) {
      filterBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }

    btn.addEventListener('click', () => {
      filterBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      activeFilter = btn.getAttribute('data-catchment') || 'all';

      // Auto-synchronize drawer selection if currently selected node is outside active catchment
      if (selectedNodeId && activeFilter !== 'all') {
        const currentNode = topologyData?.nodes?.find(n => n.id === selectedNodeId);
        if (currentNode && !isNodeMatchingFilter(currentNode)) {
          const PRIMARY_HERO_NODES = {
            'tone': '52118',       // Hookbridge Spillway
            'parrett': '52158',    // Baltmoor Wall Spillway
            'tributaries': '52120',// Huish Episcopi PS
            'sowy_ksd': '52233'    // Monk's Leaze Clyse
          };
          const heroId = PRIMARY_HERO_NODES[activeFilter];
          if (heroId) {
            inspectNode(heroId);
          } else {
            deselectNode();
          }
        }
      }

      syncUrlState();
      renderSVGNetwork();
    });
  });
}





async function loadTopologyData(isSilentRefresh = false) {
  try {
    const results = await Promise.allSettled([
      fetch('/api/topology'),
      fetch('/api/status'),
      fetch(`/api/history?range=${currentActiveRange}`),
      fetch('/api/events?limit=30'),
      fetch('/api/rainfall')
    ]);

    if (results[0].status === 'fulfilled' && results[0].value.ok) {
      topologyData = await results[0].value.json();
      lastSuccessfulSyncTime = new Date();
    } else if (!topologyData) {
      topologyData = { nodes: DEFAULT_TOPOLOGY_NODES, edges: DEFAULT_TOPOLOGY_EDGES };
    }

    if (results[1].status === 'fulfilled' && results[1].value.ok) {
      statusData = await results[1].value.json();
      lastSuccessfulSyncTime = new Date();
    }

    if (results[2].status === 'fulfilled' && results[2].value.ok) {
      historyData = await results[2].value.json();
    }

    if (results[3]?.status === 'fulfilled' && results[3].value.ok) {
      const evJson = await results[3].value.json();
      if (Array.isArray(evJson?.events)) {
        eventsData = evJson.events;
      }
    }

    if (results[4]?.status === 'fulfilled' && results[4].value.ok) {
      rainfallData = await results[4].value.json();
    }

    const activeEvents = Array.isArray(statusData?.active_events) ? statusData.active_events : [];
    const seenEventIds = new Set();
    const mergedCatalog = [];
    for (const ev of [...activeEvents, ...eventsData]) {
      if (!ev) continue;
      const key = ev.id !== undefined ? `id:${ev.id}` : `${ev.asset_id}:${ev.start_time}`;
      if (!seenEventIds.has(key)) {
        seenEventIds.add(key);
        mergedCatalog.push(ev);
      }
    }
    setCameraEventsCatalog(mergedCatalog);

    updateHeaderBanner();
    renderSVGNetwork();

    if (selectedNodeId) {
      inspectNode(selectedNodeId);
    }
  } catch (err) {
    console.error('[Topology Error] Failed to fetch data:', err);
    if (!topologyData) {
      topologyData = { nodes: DEFAULT_TOPOLOGY_NODES, edges: DEFAULT_TOPOLOGY_EDGES };
    }
    updateHeaderBanner();
    renderSVGNetwork();
  }
}

function updateHeaderBanner() {
  const counterPill = document.getElementById('counter-pill');
  const alertBanner = document.getElementById('alert-banner');
  const freshnessPill = document.getElementById('ea-freshness-pill');

  if (statusData && statusData.global_status) {
    if (counterPill) counterPill.innerText = statusData.global_status.counter_pill;
    if (alertBanner) {
      alertBanner.innerText = statusData.global_status.banner_text;
      const topSev = statusData.global_status.top_severity ?? 5;
      if (topSev <= 2) {
        alertBanner.className = 'alert-banner banner-critical';
      } else if (topSev === 3 || topSev === 4) {
        alertBanner.className = 'alert-banner banner-alert';
      } else {
        alertBanner.className = 'alert-banner banner-secure';
      }
    }
  } else if (topologyData) {
    if (counterPill) counterPill.innerText = `[ ${topologyData.nodes?.length || 17} Network Nodes Active ]`;
    if (alertBanner) {
      alertBanner.innerText = 'RIVER NETWORK TOPOLOGY STREAM — REAL-TIME NODE SYSTEM OPERATIONAL';
      alertBanner.className = 'alert-banner banner-secure';
    }
  } else {
    if (counterPill) counterPill.innerText = '[ Syncing Topology... ]';
    if (alertBanner) {
      alertBanner.innerText = 'RIVER NETWORK TOPOLOGY STREAM — INITIALIZING SENSOR DATA...';
      alertBanner.className = 'alert-banner banner-secure';
    }
  }

  if (freshnessPill) {
    applyFreshnessPill(freshnessPill, statusData?.system_timestamps?.latest_ea_reading_at || null);
  }
}

function renderSVGNetwork() {
  const svg = document.getElementById('topology-svg');
  if (!svg || !topologyData || !topologyData.nodes) return;

  const nodes = topologyData.nodes;
  const edges = topologyData.edges || [];

  // Build SVG Content
  let svgContent = `
    <defs>
      <!-- Arrow Markers for Flow Direction (100% Color Aligned to Path Strokes) -->
      <marker id="arrow-nominal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
      </marker>
      <marker id="arrow-alert" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#fbbf24" />
      </marker>
      <marker id="arrow-overspill" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
      </marker>
      <marker id="arrow-divert" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#0284c7" />
      </marker>
      <marker id="arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
      </marker>
      <marker id="arrow-rainfall" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(129, 140, 248, 0.75)" />
      </marker>
      
      <!-- Linear Gradients for Rivers -->
      <linearGradient id="tone-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#0284c7" />
        <stop offset="100%" stop-color="#38bdf8" />
      </linearGradient>
      <linearGradient id="parrett-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#0369a1" />
        <stop offset="100%" stop-color="#38bdf8" />
      </linearGradient>

      <!-- Linear Gradients for Lowland Polder Retention Basins (Issue #5) -->
      <linearGradient id="polder-curry-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0284c7" stop-opacity="0.14" />
        <stop offset="100%" stop-color="#0369a1" stop-opacity="0.04" />
      </linearGradient>
      <linearGradient id="polder-northmoor-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0284c7" stop-opacity="0.14" />
        <stop offset="100%" stop-color="#0369a1" stop-opacity="0.04" />
      </linearGradient>
    </defs>

    <!-- Background Grid Lines (Decorative - aria-hidden) -->
    <g class="topology-bg-grid" opacity="0.15" aria-hidden="true">
      <path d="M 0 100 L 960 100 M 0 200 L 960 200 M 0 300 L 960 300 M 0 400 L 960 400 M 0 500 L 960 500" stroke="#334155" stroke-width="1" stroke-dasharray="4 4"/>
    </g>

    <!-- Polder Storage Basins Shaded Containers (Decorative Canvas Guides - aria-hidden) [Issue #5] -->
    <g class="polder-containers" aria-hidden="true">
      <!-- Curry Moor Basin Polder -->
      <rect x="360" y="375" width="160" height="95" rx="14" 
            class="polder-rect ${isFiltered('tone') ? '' : 'dimmed'}" 
            fill="url(#polder-curry-gradient)" stroke="rgba(56, 189, 248, 0.45)" stroke-width="2" />
      <rect x="364" y="379" width="152" height="87" rx="10" 
            fill="none" stroke="rgba(148, 163, 184, 0.25)" stroke-width="1" stroke-dasharray="4 2" />
      <text x="370" y="392" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.05em">CURRY MOOR POLDER (Storage Basin)</text>
      <text x="370" y="405" fill="#64748b" font-size="8" font-weight="500">Tone Inflow: 7.45m | Outflow: Athelney 7.35m</text>
      
      <!-- Northmoor Basin Polder -->
      <rect x="520" y="155" width="205" height="95" rx="14" 
            class="polder-rect ${isFiltered('parrett') ? '' : 'dimmed'}" 
            fill="url(#polder-northmoor-gradient)" stroke="rgba(56, 189, 248, 0.45)" stroke-width="2" />
      <rect x="524" y="159" width="197" height="87" rx="10" 
            fill="none" stroke="rgba(148, 163, 184, 0.25)" stroke-width="1" stroke-dasharray="4 2" />
      <text x="530" y="172" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.05em">NORTHMOOR POLDER (Storage Basin)</text>
      <text x="530" y="185" fill="#64748b" font-size="8" font-weight="500">Curry Moor Cascade (7.35m) &amp; Parrett Wall (7.80m)</text>
    </g>

    <!-- Geographic Reference Anchors & Landmarks Layer (aria-hidden) [Issue #5] -->
    <g class="geographic-anchors" aria-hidden="true">
      <!-- Bridgwater Bay / Bristol Channel (Sea Outfall) -->
      <g class="geographic-anchor">
        <text x="130" y="48" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.05em">🌊 BRIDGWATER BAY / BRISTOL CHANNEL</text>
        <text x="130" y="60" fill="#64748b" font-size="8" font-weight="500">Tidal Estuary Outfall (Dunball Macro-Tidal Gates)</text>
      </g>
      <!-- Bridgwater Corridor -->
      <g class="geographic-anchor">
        <text x="215" y="155" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.05em">📍 BRIDGWATER</text>
        <text x="215" y="167" fill="#64748b" font-size="8" font-weight="500">Tidal River Parrett Corridor</text>
      </g>
      <!-- Burrow Mump Landmark at Burrowbridge Confluence -->
      <g class="geographic-anchor">
        <text x="460" y="268" fill="#94a3b8" font-size="9.5" font-weight="700" letter-spacing="0.05em">⛰️ BURROW MUMP</text>
        <text x="460" y="279" fill="#64748b" font-size="7.5" font-weight="500">Burrowbridge Confluence (Tone + Parrett)</text>
      </g>
      <!-- Taunton Corridor -->
      <g class="geographic-anchor">
        <text x="195" y="465" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.05em">📍 TAUNTON</text>
        <text x="195" y="477" fill="#64748b" font-size="8" font-weight="500">River Tone Urban Corridor</text>
      </g>
      <!-- Langport Hub -->
      <g class="geographic-anchor">
        <text x="705" y="395" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.05em">📍 LANGPORT</text>
        <text x="705" y="407" fill="#64748b" font-size="8" font-weight="500">Parrett &amp; Sowy Relief Hub</text>
      </g>
      <!-- A361 Moor Corridor -->
      <g class="geographic-anchor">
        <text x="365" y="345" fill="#94a3b8" font-size="9" font-weight="700" letter-spacing="0.05em">🛣️ A361 CORRIDOR</text>
        <text x="365" y="356" fill="#64748b" font-size="7.5" font-weight="500">East Lyng ↔ Burrowbridge (Cuts Rd)</text>
      </g>
      <!-- Muchelney Island Village -->
      <g class="geographic-anchor">
        <text x="745" y="480" fill="#94a3b8" font-size="9.5" font-weight="700" letter-spacing="0.05em">📍 MUCHELNEY</text>
        <text x="745" y="491" fill="#64748b" font-size="7.5" font-weight="500">Spine Road Access Island</text>
      </g>
    </g>

    <!-- Downstream Fluvial Flow Indicators Layer (aria-hidden) [Issue #5] -->
    <g class="downstream-flow-indicators" aria-hidden="true">
      <text x="200" y="415" fill="#0284c7" font-size="8" font-weight="700" letter-spacing="0.04em">Tone Flow ➔</text>
      <text x="390" y="322" fill="#0284c7" font-size="8" font-weight="700" letter-spacing="0.04em">Tone Flow ➔</text>
      <text x="390" y="175" fill="#0284c7" font-size="8" font-weight="700" letter-spacing="0.04em">▲ Seaward Flow</text>
      <text x="320" y="115" fill="#0284c7" font-size="8" font-weight="700" letter-spacing="0.04em">▲ To Estuary</text>
      <text x="695" y="415" fill="#0284c7" font-size="8" font-weight="700" letter-spacing="0.04em">▲ Parrett Flow</text>
      <text x="785" y="255" fill="#0284c7" font-size="8" font-weight="700" letter-spacing="0.04em">▲ Sowy Relief</text>
    </g>

    <!-- Flow Lines & Edges Layer (Structural Layout - aria-hidden) -->
    <g class="topology-edges" aria-hidden="true">
  `;

  let edgeBadgesHTML = '';

  // Draw Edges
  edges.forEach(edge => {
    const fromCoord = getNodeCoordinates(edge.from, nodes, edges);
    const toCoord = getNodeCoordinates(edge.to, nodes, edges);
    if (!fromCoord || !toCoord) return;

    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);

    const isTone = fromNode?.catchment === 'tone' || toNode?.catchment === 'tone';
    const isParrett = fromNode?.catchment === 'parrett' || toNode?.catchment === 'parrett';
    const isSowy = edge.type === 'diversion_clyse' || edge.type === 'diversion_route';

    // Defensive consistency: If control structure is CLOSED/SECURE, outbound relief diversion/spill cannot be active
    let isFlowActive = !!edge.flow_active;
    if (edge.type === 'diversion_clyse' && (fromNode?.status === 'CLOSED' || fromNode?.status === 'SECURE')) {
      isFlowActive = false;
    }
    if (edge.type === 'spillway_overtopping' && (fromNode?.status === 'SECURE' || fromNode?.status === 'ALERT')) {
      isFlowActive = false;
    }
    if (edge.type === 'polder_overflow' && (typeof fromNode?.stage_mAOD === 'number' && fromNode.stage_mAOD < 7.35)) {
      isFlowActive = false;
    }

    let edgeClass = 'topology-flow-line';
    if (isFlowActive) edgeClass += ' flow-active';
    if (edge.type === 'spillway_overtopping' || edge.type === 'polder_overflow') edgeClass += ' flow-overtop';
    if (edge.type === 'diversion_clyse') edgeClass += ' flow-divert';

    let strokeColor = '#38bdf8';
    let markerType = 'nominal';

    if (edge.type === 'spillway_overtopping' || edge.type === 'polder_overflow') {
      strokeColor = isFlowActive ? '#ef4444' : '#64748b';
      markerType = isFlowActive ? 'overspill' : 'muted';
    } else if (edge.type === 'diversion_clyse' || edge.type === 'diversion_route') {
      strokeColor = isFlowActive ? '#0284c7' : '#64748b';
      markerType = isFlowActive ? 'divert' : 'muted';
    } else if (edge.type === 'sea_outfall') {
      // Nominal active discharge into estuary when tide is OUT: deep estuarine blue (#0284c7)
      // Inactive when tide is IN (tide-locked): muted slate (#64748b)
      strokeColor = isFlowActive ? '#0284c7' : '#64748b';
      markerType = isFlowActive ? 'divert' : 'muted';
    } else {
      strokeColor = isFlowActive ? '#38bdf8' : '#64748b';
      markerType = isFlowActive ? 'nominal' : 'muted';
    }

    const strokeWidth = (edge.type === 'spillway_overtopping' || edge.type === 'polder_overflow') ? (isFlowActive ? '3.5' : '2') : '2.5';
    const dashStyle = !isFlowActive ? 'stroke-dasharray="4, 4"' : '';
    const dimmed = !isEdgeMatchingFilter(edge, fromNode, toNode);

    // Path calculation: adaptively select dominant curvature axis for natural river flow
    let pathD = `M ${fromCoord.x} ${fromCoord.y} L ${toCoord.x} ${toCoord.y}`;
    if (fromCoord.x !== toCoord.x && fromCoord.y !== toCoord.y) {
      const dx = Math.abs(toCoord.x - fromCoord.x);
      const dy = Math.abs(toCoord.y - fromCoord.y);
      if (dy > dx * 1.2) {
        const midY = (fromCoord.y + toCoord.y) / 2;
        pathD = `M ${fromCoord.x} ${fromCoord.y} C ${fromCoord.x} ${midY}, ${toCoord.x} ${midY}, ${toCoord.x} ${toCoord.y}`;
      } else {
        const midX = (fromCoord.x + toCoord.x) / 2;
        pathD = `M ${fromCoord.x} ${fromCoord.y} C ${midX} ${fromCoord.y}, ${midX} ${toCoord.y}, ${toCoord.x} ${toCoord.y}`;
      }
    }

    let edgeTitle = `${fromNode?.name || edge.from} → ${toNode?.name || edge.to}`;
    if (edge.from === '52118' && edge.to === '52127') {
      edgeTitle = `Hookbridge Spillway: Controlled relief overflow from River Tone into Curry Moor when stage ≥ 7.45m AOD (Status: ${isFlowActive ? 'ACTIVE OVERFLOW' : 'STANDBY / DRY'})`;
    } else if (edge.from === '52158' && edge.to === '52159') {
      edgeTitle = `Baltmoor Wall Levee Defence: Overtopping from River Parrett/Tone Confluence into Northmoor when stage ≥ 7.80m AOD (Status: ${isFlowActive ? 'ACTIVE OVERTOPPING' : 'SECURE'})`;
    } else if (edge.type === 'polder_overflow' || (edge.from === '52127' && edge.to === '52159')) {
      edgeTitle = `Athelney Spillway (Curry Moor ➔ Northmoor Cascade): Overtopping from Curry Moor into Northmoor when stage ≥ 7.35m AOD (Status: ${isFlowActive ? 'ACTIVE OVERFLOW' : 'STANDBY / DRY'})`;
    } else if (edge.from === '52233' && edge.to === '52234') {
      edgeTitle = `Monk's Leaze Clyse: Controlled gravity diversion from River Parrett into Sowy Relief Channel (Sill: ${fmtM(T_MONKS.SILL_MAOD)}m AOD • Trigger: ${fmtM(T_MONKS.TRIGGER_MAOD)}m AOD, Status: ${isFlowActive ? 'DIVERTING' : 'CLOSED'})`;
    } else if (edge.from === '52157' && edge.to === 'E9531') {
      edgeTitle = `Beer Wall Culverts & Sowy Spur Tilting Weirs: Sowy Relief Channel into King's Sedgemoor Drain (Tilting Weirs: ${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m AOD • Box Culverts: ${fmtM(T_BEER.CREST_MAOD)}m AOD • Beazeley Spillway crest: Pending EA Asset Survey)`;
    }

    svgContent += `
      <path d="${pathD}" 
            class="${edgeClass} ${dimmed ? 'dimmed' : ''}" 
            stroke="${strokeColor}" 
            stroke-width="${strokeWidth}"
            ${dashStyle}
            fill="none" 
            marker-end="url(#arrow-${markerType})">
        <title>${escapeHTML(edgeTitle)}</title>
      </path>
    `;

    // Generate On-Canvas Infrastructure Badges for Relief & Cascade Conduits
    if (edge.from === '52118' && edge.to === '52127') {
      const bX = 440, bY = 355, bW = 120;
      const bLabel = isFlowActive ? '▲ Hookbridge Spilling 7.45m' : 'Hookbridge Spillway 7.45m';
      const bBg = isFlowActive ? 'rgba(127, 29, 29, 0.95)' : 'rgba(15, 23, 42, 0.92)';
      const bStroke = isFlowActive ? '#ef4444' : '#475569';
      const bTextFill = isFlowActive ? '#fca5a5' : '#cbd5e1';
      edgeBadgesHTML += `
        <g class="topology-edge-badge ${dimmed ? 'dimmed' : ''}" data-target-node="52118" tabindex="0" role="button" aria-label="Hookbridge Spillway at 7.45m AOD">
          <rect x="${bX - bW/2}" y="${bY - 9}" width="${bW}" height="18" rx="4" fill="${bBg}" stroke="${bStroke}" stroke-width="1.2" />
          <text x="${bX}" y="${bY}" fill="${bTextFill}" font-size="8.5" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="0.02em">${bLabel}</text>
          <rect x="${bX - bW/2 - 8}" y="${bY - 18}" width="${bW + 16}" height="36" fill="transparent" pointer-events="all" />
          <title>${escapeHTML(edgeTitle)} (Click to inspect Hookbridge Spillway)</title>
        </g>
      `;
    } else if (edge.type === 'polder_overflow' || (edge.from === '52127' && edge.to === '52159')) {
      const bX = 538, bY = 308, bW = 148;
      const bLabel = isFlowActive ? '▲ Athelney Cascade Active 7.35m' : 'Athelney Spillway 7.35m (Cuts Rd)';
      const bBg = isFlowActive ? 'rgba(127, 29, 29, 0.95)' : 'rgba(15, 23, 42, 0.92)';
      const bStroke = isFlowActive ? '#ef4444' : '#475569';
      const bTextFill = isFlowActive ? '#fca5a5' : '#cbd5e1';
      edgeBadgesHTML += `
        <g class="topology-edge-badge ${dimmed ? 'dimmed' : ''}" data-target-node="52127" tabindex="0" role="button" aria-label="Athelney Spillway (Curry Moor ➔ Northmoor Cascade) at 7.35m AOD">
          <rect x="${bX - bW/2}" y="${bY - 9}" width="${bW}" height="18" rx="4" fill="${bBg}" stroke="${bStroke}" stroke-width="1.2" />
          <text x="${bX}" y="${bY}" fill="${bTextFill}" font-size="8.2" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="0.02em">${bLabel}</text>
          <rect x="${bX - bW/2 - 8}" y="${bY - 18}" width="${bW + 16}" height="36" fill="transparent" pointer-events="all" />
          <title>${escapeHTML(edgeTitle)} (Click to inspect Curry Moor Basin)</title>
        </g>
      `;
    } else if (edge.from === '52158' && edge.to === '52159') {
      const bX = 562, bY = 240, bW = 104;
      const bLabel = isFlowActive ? '▲ Baltmoor Overtopping 7.80m' : 'Baltmoor Wall 7.80m';
      const bBg = isFlowActive ? 'rgba(127, 29, 29, 0.95)' : 'rgba(15, 23, 42, 0.92)';
      const bStroke = isFlowActive ? '#ef4444' : '#475569';
      const bTextFill = isFlowActive ? '#fca5a5' : '#cbd5e1';
      edgeBadgesHTML += `
        <g class="topology-edge-badge ${dimmed ? 'dimmed' : ''}" data-target-node="52158" tabindex="0" role="button" aria-label="Baltmoor Wall Levee Defence at 7.80m AOD">
          <rect x="${bX - bW/2}" y="${bY - 9}" width="${bW}" height="18" rx="4" fill="${bBg}" stroke="${bStroke}" stroke-width="1.2" />
          <text x="${bX}" y="${bY}" fill="${bTextFill}" font-size="8.2" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="0.02em">${bLabel}</text>
          <rect x="${bX - bW/2 - 8}" y="${bY - 18}" width="${bW + 16}" height="36" fill="transparent" pointer-events="all" />
          <title>${escapeHTML(edgeTitle)} (Click to inspect Baltmoor Wall)</title>
        </g>
      `;
    } else if (edge.from === '52233' && edge.to === '52234') {
      const bX = 760, bY = 356, bW = 124;
      const bLabel = isFlowActive ? `🔵 Monk's Leaze Diverting ${fmtM(T_MONKS.TRIGGER_MAOD)}m` : `Monk's Leaze Clyse ${fmtM(T_MONKS.SILL_MAOD)}m`;
      const bBg = isFlowActive ? 'rgba(12, 74, 110, 0.95)' : 'rgba(15, 23, 42, 0.92)';
      const bStroke = isFlowActive ? '#0284c7' : '#475569';
      const bTextFill = isFlowActive ? '#38bdf8' : '#cbd5e1';
      edgeBadgesHTML += `
        <g class="topology-edge-badge ${dimmed ? 'dimmed' : ''}" data-target-node="52233" tabindex="0" role="button" aria-label="Monk's Leaze Clyse Sluice Gate at ${fmtM(T_MONKS.SILL_MAOD)}m AOD">
          <rect x="${bX - bW/2}" y="${bY - 9}" width="${bW}" height="18" rx="4" fill="${bBg}" stroke="${bStroke}" stroke-width="1.2" />
          <text x="${bX}" y="${bY}" fill="${bTextFill}" font-size="8.2" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="0.02em">${bLabel}</text>
          <rect x="${bX - bW/2 - 8}" y="${bY - 18}" width="${bW + 16}" height="36" fill="transparent" pointer-events="all" />
          <title>${escapeHTML(edgeTitle)} (Click to inspect Monk's Leaze Clyse)</title>
        </g>
      `;
    } else if (edge.from === '52157' && edge.to === 'E9531') {
      const bX = 748, bY = 142, bW = 142;
      const stage52157 = typeof fromNode?.stage_mAOD === 'number' ? fromNode.stage_mAOD : STATION_REGISTRY['52157']?.fallback_stage_mAOD;
      let bLabel = `Beer Wall ${fmtM(T_BEER.CREST_MAOD)}m / Weirs ${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m`;
      let bBg = 'rgba(15, 23, 42, 0.92)';
      let bStroke = '#475569';
      let bTextFill = '#cbd5e1';
      if (stage52157 >= T_BEER.CREST_MAOD) {
        bLabel = `▲ Beer Wall Relief ${fmtM(T_BEER.CREST_MAOD)}m`;
        bBg = 'rgba(127, 29, 29, 0.95)';
        bStroke = '#ef4444';
        bTextFill = '#fca5a5';
      } else if (stage52157 >= 7.15) {
        bLabel = `⚠️ Beer Wall Near Crest ${fmtM(T_BEER.CREST_MAOD)}m`;
        bBg = 'rgba(120, 53, 15, 0.95)';
        bStroke = '#f59e0b';
        bTextFill = '#fde68a';
      } else if (stage52157 >= T_BEER.KSD_CONVEYANCE_MAOD) {
        bLabel = `🔵 Tilting Weirs Active ${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m`;
        bBg = 'rgba(12, 74, 110, 0.95)';
        bStroke = '#0284c7';
        bTextFill = '#38bdf8';
      }
      edgeBadgesHTML += `
        <g class="topology-edge-badge ${dimmed ? 'dimmed' : ''}" data-target-node="52157" tabindex="0" role="button" aria-label="Beer Wall Box Culverts at ${fmtM(T_BEER.CREST_MAOD)}m AOD (Beazeley Spillway crest pending EA Asset Survey) and Sowy Spur Tilting Weirs at ${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m AOD">
          <rect x="${bX - bW/2}" y="${bY - 9}" width="${bW}" height="18" rx="4" fill="${bBg}" stroke="${bStroke}" stroke-width="1.2" />
          <text x="${bX}" y="${bY}" fill="${bTextFill}" font-size="8.0" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="0.02em">${bLabel}</text>
          <rect x="${bX - bW/2 - 8}" y="${bY - 18}" width="${bW + 16}" height="36" fill="transparent" pointer-events="all" />
          <title>${escapeHTML(edgeTitle)} (Click to inspect Beer Wall Upstream)</title>
        </g>
      `;
    }
  });

  svgContent += `</g>`; // close topology-edges
  svgContent += `<g class="topology-edge-badges">${edgeBadgesHTML}</g>`;
  svgContent += `<g class="topology-nodes">`;

  const uplandOrigins = Array.isArray(topologyData?.upland_rainfall_origins)
    ? topologyData.upland_rainfall_origins
    : (TOPOLOGY_NETWORK_CONFIG.upland_rainfall_origins || []);

  const placedLabelBoxes = [
    { x: 130, y: 38, w: 180, h: 26 },
    { x: 215, y: 145, w: 90, h: 26 },
    { x: 460, y: 258, w: 95, h: 26 },
    { x: 195, y: 455, w: 80, h: 26 },
    { x: 705, y: 385, w: 80, h: 26 },
    { x: 745, y: 470, w: 80, h: 26 },
    { x: 365, y: 335, w: 75, h: 24 },
    { x: 677, y: 133, w: 142, h: 18 },
    ...uplandOrigins
      .filter(o => o && o.svg_anchor)
      .map(o => ({ x: o.svg_anchor.x, y: o.svg_anchor.y, w: o.svg_anchor.w, h: o.svg_anchor.h }))
  ];

  // Draw Nodes
  nodes.forEach(node => {
    const coord = getNodeCoordinates(node.id, nodes, edges);
    if (!coord) return;

    const isSelected = selectedNodeId === node.id;
    const dimmed = !isNodeMatchingFilter(node);
    const statusObj = getNodeStatusVisual(node);

    // Pulse animation ring for overspilling or diverting nodes
    let pulseRing = '';
    if (node.status === 'OVERSPILLING') {
      pulseRing = `<circle cx="${coord.x}" cy="${coord.y}" r="22" class="node-pulse-ring overspilling" />`;
    } else if (node.status === 'DIVERTING') {
      pulseRing = `<circle cx="${coord.x}" cy="${coord.y}" r="22" class="node-pulse-ring diverting" />`;
    }

    let nodeShape = `
      <circle cx="${coord.x}" cy="${coord.y}" r="14" 
              class="node-circle ${isSelected ? 'selected' : ''}" 
              stroke="${statusObj.stroke}" stroke-width="3" fill="${statusObj.fill}" />
    `;

    if (node.node_type === 'polder_basin') {
      nodeShape = `
        <rect x="${coord.x - 12}" y="${coord.y - 12}" width="24" height="24" rx="5" 
              class="node-rect ${isSelected ? 'selected' : ''}" 
              stroke="${statusObj.stroke}" stroke-width="3" fill="${statusObj.fill}" />
      `;
    }

    const stageDisplay = typeof node.stage_mAOD === 'number' ? `${node.stage_mAOD.toFixed(2)}m` : '--';
    const { line1X, line1Y, line2X, line2Y, stageX, stageY, textAnchor, labelParts } = computeSmartLabelLayout(node, coord, placedLabelBoxes, nodes);

    svgContent += `
      <g class="topology-node topology-node-group ${dimmed ? 'dimmed' : ''}" 
         data-id="${escapeAttr(node.id)}" 
         tabindex="0" 
         role="button" 
         aria-label="Station ${escapeAttr(node.name)}, ID ${escapeAttr(node.id)}, Stage ${stageDisplay}, Status: ${escapeAttr(node.status)}"
         aria-expanded="${isSelected ? 'true' : 'false'}">
        <title>${escapeHTML(node.name)} (${escapeHTML(node.river)})&#10;Stage: ${stageDisplay} | Status: ${escapeHTML(node.status)}&#10;Click to inspect 24h hydrograph</title>
        <!-- Invisible Touch Hit Target Ring (48x48px) -->
        <circle cx="${coord.x}" cy="${coord.y}" r="24" fill="transparent" pointer-events="all" />
        ${pulseRing}
        ${nodeShape}
        <text x="${coord.x}" y="${coord.y + 4}" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="800" pointer-events="none">
          ${statusObj.symbol}
        </text>
        <text x="${line1X}" y="${line1Y}" text-anchor="${textAnchor}" class="node-label-title">
          ${escapeHTML(labelParts.line1)}
        </text>
        ${labelParts.line2 ? `
        <text x="${line2X}" y="${line2Y}" text-anchor="${textAnchor}" class="node-label-subtitle" fill="#94a3b8" font-size="10">
          ${escapeHTML(labelParts.line2)}
        </text>` : ''}
        <text x="${stageX}" y="${stageY}" text-anchor="${textAnchor}" class="node-label-stage">
          ${stageDisplay}
        </text>
      </g>
    `;
  });

  svgContent += `</g>`;
  if (rainfallLayerActive) {
    svgContent += renderUplandRainfallLayer(uplandOrigins);
  }
  svg.innerHTML = svgContent;
}

function formatNodeLabelLines(name) {
  if (!name) return { line1: '', line2: '' };
  
  if (name.includes('(') && name.includes(')')) {
    const parts = name.split('(');
    const line1 = parts[0].trim();
    const line2 = parts[1].replace(')', '').trim();
    return { line1, line2 };
  }
  
  if (name.includes('/')) {
    const parts = name.split('/');
    return { line1: parts[0].trim(), line2: parts[1].trim() };
  }

  const words = name.split(' ');
  if (words.length >= 3 && name.length > 14) {
    const mid = Math.ceil(words.length / 2);
    return {
      line1: words.slice(0, mid).join(' '),
      line2: words.slice(mid).join(' ')
    };
  }

  return { line1: name, line2: '' };
}

function computeSmartLabelLayout(node, coord, placedBoxes = [], nodes = []) {
  const preferred = coord.labelPos || 'bottom';
  const labelParts = formatNodeLabelLines(node.name);
  const maxLen = Math.max(labelParts.line1.length, labelParts.line2.length);
  const estWidth = Math.max(50, maxLen * 7.0);
  const estHeight = labelParts.line2 ? 38 : 26;

  const candidatePositions = [preferred, 'top', 'bottom', 'right', 'left'].filter((v, i, a) => a.indexOf(v) === i);

  for (const pos of candidatePositions) {
    let line1X = coord.x;
    let line1Y = coord.y + 26;
    let line2X = coord.x;
    let line2Y = coord.y + 38;
    let stageX = coord.x;
    let stageY = coord.y + (labelParts.line2 ? 51 : 39);
    let textAnchor = 'middle';
    let boxX = coord.x - estWidth / 2;
    let boxY = coord.y + 16;

    if (pos === 'top') {
      line1Y = coord.y - (labelParts.line2 ? 36 : 24);
      line2Y = coord.y - 24;
      stageY = coord.y - 11;
      boxY = coord.y - (labelParts.line2 ? 46 : 34);
    } else if (pos === 'left') {
      line1X = coord.x - 22;
      line2X = coord.x - 22;
      stageX = coord.x - 22;
      line1Y = coord.y - (labelParts.line2 ? 8 : 4);
      line2Y = coord.y + 5;
      stageY = coord.y + (labelParts.line2 ? 18 : 10);
      textAnchor = 'end';
      boxX = coord.x - 22 - estWidth;
      boxY = coord.y - 14;
    } else if (pos === 'right') {
      line1X = coord.x + 22;
      line2X = coord.x + 22;
      stageX = coord.x + 22;
      line1Y = coord.y - (labelParts.line2 ? 8 : 4);
      line2Y = coord.y + 5;
      stageY = coord.y + (labelParts.line2 ? 18 : 10);
      textAnchor = 'start';
      boxX = coord.x + 22;
      boxY = coord.y - 14;
    }

    // Canvas boundary check
    if (boxX < 10 || boxX + estWidth > 950 || boxY < 10 || boxY + estHeight > 610) {
      continue;
    }

    // Node circle collision check
    let nodeCollision = false;
    for (const otherNode of nodes) {
      if (otherNode.id === node.id) continue;
      const otherCoord = getNodeCoordinates(otherNode.id, nodes, []);
      if (!otherCoord) continue;
      if (
        otherCoord.x >= boxX - 16 &&
        otherCoord.x <= boxX + estWidth + 16 &&
        otherCoord.y >= boxY - 16 &&
        otherCoord.y <= boxY + estHeight + 16
      ) {
        nodeCollision = true;
        break;
      }
    }
    if (nodeCollision) continue;

    // Label-label collision check
    let labelCollision = false;
    for (const box of placedBoxes) {
      if (
        boxX < box.x + box.w &&
        boxX + estWidth > box.x &&
        boxY < box.y + box.h &&
        boxY + estHeight > box.y
      ) {
        labelCollision = true;
        break;
      }
    }
    if (labelCollision) continue;

    // Valid collision-free position found!
    placedBoxes.push({ x: boxX, y: boxY, w: estWidth, h: estHeight });
    return { line1X, line1Y, line2X, line2Y, stageX, stageY, textAnchor, labelParts, pos };
  }

  // Fallback if tight space
  let line1X = coord.x;
  let line1Y = coord.y + 26;
  let line2X = coord.x;
  let line2Y = coord.y + 38;
  let stageX = coord.x;
  let stageY = coord.y + (labelParts.line2 ? 51 : 39);
  let textAnchor = 'middle';
  if (preferred === 'top') {
    line1Y = coord.y - (labelParts.line2 ? 36 : 24);
    line2Y = coord.y - 24;
    stageY = coord.y - 11;
  } else if (preferred === 'left') {
    line1X = coord.x - 22;
    line2X = coord.x - 22;
    stageX = coord.x - 22;
    line1Y = coord.y - (labelParts.line2 ? 8 : 4);
    line2Y = coord.y + 5;
    stageY = coord.y + (labelParts.line2 ? 18 : 10);
    textAnchor = 'end';
  } else if (preferred === 'right') {
    line1X = coord.x + 22;
    line2X = coord.x + 22;
    stageX = coord.x + 22;
    line1Y = coord.y - (labelParts.line2 ? 8 : 4);
    line2Y = coord.y + 5;
    stageY = coord.y + (labelParts.line2 ? 18 : 10);
    textAnchor = 'start';
  }
  return { line1X, line1Y, line2X, line2Y, stageX, stageY, textAnchor, labelParts, pos: preferred };
}

function getNodeCoordinates(nodeId, nodes, edges, visited = new Set()) {
  if (NODE_COORDINATES[nodeId]) {
    return NODE_COORDINATES[nodeId];
  }

  // Dynamic Topological Rank Fallback Calculation for unmapped stations
  visited.add(nodeId);
  const incoming = (edges || []).filter(e => e.to === nodeId);
  for (const edge of incoming) {
    if (!visited.has(edge.from)) {
      const parentCoord = getNodeCoordinates(edge.from, nodes, edges, visited);
      if (parentCoord) {
        return {
          x: Math.min(900, Math.max(60, parentCoord.x + 80)),
          y: Math.min(560, Math.max(60, parentCoord.y + 40)),
          labelPos: 'bottom'
        };
      }
    }
  }

  return { x: 480, y: 300, labelPos: 'top' };
}

export function getNodeStatusVisual(node) {
  if (node.node_type === 'tidal_outfall') {
    if (node.status === 'ALERT') {
      return { stroke: '#f59e0b', fill: '#78350f', symbol: '⚠️', label: 'STORM SURGE ALERT', badgeClass: 'badge-near-crest', sparklineColor: '#f59e0b' };
    }
    if (node.status === 'SLACK_RESTRICTED' || node.status === 'TIDE_LOCKED' || node.is_tide_locked) {
      return { stroke: '#64748b', fill: '#1e293b', symbol: '🕒', label: 'TIDE-LOCKED', badgeClass: 'badge-tide-locked', sparklineColor: '#0284c7' };
    }
    return { stroke: '#0284c7', fill: '#0c4a6e', symbol: '🟢', label: 'DISCHARGING', badgeClass: 'badge-secure', sparklineColor: '#0284c7' };
  }
  switch (node.status) {
    case 'OVERSPILLING':
    case 'OVERTOPPING':
      return { stroke: '#ef4444', fill: '#7f1d1d', symbol: '🔴', label: node.status === 'OVERTOPPING' ? 'OVERTOPPING' : 'OVERSPILLING', badgeClass: 'badge-overtopping' };
    case 'ALERT':
    case 'NEAR_CREST':
      return { stroke: '#f59e0b', fill: '#78350f', symbol: '⚠️', label: node.node_type === 'spillway' ? 'NEAR CREST' : 'ALERT', badgeClass: 'badge-near-crest' };
    case 'PASSABLE':
      return { stroke: '#10b981', fill: '#064e3b', symbol: '🟢', label: 'PASSABLE', badgeClass: 'badge-secure' };
    case 'ENCROACHING':
      return { stroke: '#f59e0b', fill: '#78350f', symbol: '⚠️', label: 'ENCROACHING', badgeClass: 'badge-near-crest' };
    case 'IMPASSABLE':
      return { stroke: '#ef4444', fill: '#7f1d1d', symbol: '🔴', label: 'IMPASSABLE', badgeClass: 'badge-overtopping' };
    case 'DUTY_PUMPING':
      return { stroke: '#38bdf8', fill: '#0c4a6e', symbol: '💧', label: 'DUTY PUMPING', badgeClass: 'badge-open' };
    case 'MOBILE_ORDERED':
      return { stroke: '#f59e0b', fill: '#78350f', symbol: '⚠️', label: 'MOBILE ORDERED', badgeClass: 'badge-near-crest' };
    case 'MOBILE_ACTIVE':
      return { stroke: '#f59e0b', fill: '#78350f', symbol: '⚠️', label: 'MOBILE ACTIVE', badgeClass: 'badge-near-crest' };
    case 'CRITICAL':
      return { stroke: '#ef4444', fill: '#7f1d1d', symbol: '🔴', label: 'CRITICAL', badgeClass: 'badge-overtopping' };
    case 'DIVERTING':
      return { stroke: '#0284c7', fill: '#0c4a6e', symbol: '🔵', label: 'DIVERTING', badgeClass: 'badge-open' };
    case 'THROTTLED':
      return { stroke: '#f59e0b', fill: '#78350f', symbol: '⚠️', label: 'THROTTLED', badgeClass: 'badge-near-crest' };
    case 'REVERSE_LOCK':
      return { stroke: '#ef4444', fill: '#7f1d1d', symbol: '🔴', label: 'REVERSE LOCK', badgeClass: 'badge-overtopping' };
    case 'SLACK_RESTRICTED':
    case 'TIDE_LOCKED':
      return { stroke: '#64748b', fill: '#1e293b', symbol: '🕒', label: 'TIDE-LOCKED', badgeClass: 'badge-tide-locked', sparklineColor: node.id === 'E9094' ? '#38bdf8' : '#0284c7' };
    case 'CLOSED':
      return { stroke: '#64748b', fill: '#1e293b', symbol: '⛔', label: 'CLOSED', badgeClass: 'badge-tide-locked' };
    case 'SECURE':
    case 'NORMAL':
    default:
      return { stroke: '#10b981', fill: '#064e3b', symbol: '🟢', label: 'SECURE', badgeClass: 'badge-secure', sparklineColor: node.id === 'E9094' ? '#38bdf8' : '#10b981' };
  }
}

function isFiltered(catchmentId) {
  if (activeFilter === 'all') return true;
  return activeFilter === catchmentId;
}

function isNodeMatchingFilter(node) {
  if (activeStatusFilter) {
    if (activeStatusFilter === 'CLOSED') {
      if (node.status !== 'CLOSED' && node.status !== 'SLACK_RESTRICTED' && node.status !== 'TIDE_LOCKED') return false;
    } else if (activeStatusFilter === 'ALERT') {
      // Throttled / reverse-lock clyse states are amber / red conditions, so surface them under Alert
      if (!['ALERT', 'THROTTLED', 'REVERSE_LOCK'].includes(node.status)) return false;
    } else if (node.status !== activeStatusFilter) {
      return false;
    }
  }
  if (activeAreaFilter && AREA_MAPPINGS[activeAreaFilter]) {
    if (!AREA_MAPPINGS[activeAreaFilter].stations.includes(node.id)) {
      return false;
    }
  }
  if (activeFilter === 'all') return true;
  if (activeFilter === 'tone') return node.catchment === 'tone';
  if (activeFilter === 'parrett') return node.catchment === 'parrett';
  if (activeFilter === 'tributaries') return node.catchment === 'tributaries' || node.id === '52233';
  if (activeFilter === 'sowy_ksd') return node.catchment === 'sowy_ksd';
  return true;
}

function isEdgeMatchingFilter(edge, fromNode, toNode) {
  if (activeAreaFilter && AREA_MAPPINGS[activeAreaFilter]) {
    const areaStations = AREA_MAPPINGS[activeAreaFilter].stations;
    if (!areaStations.includes(edge.from) && !areaStations.includes(edge.to)) {
      return false;
    }
  }
  if (activeFilter === 'all') return true;
  if (activeFilter === 'tone') return fromNode?.catchment === 'tone' || toNode?.catchment === 'tone';
  if (activeFilter === 'parrett') return fromNode?.catchment === 'parrett' || toNode?.catchment === 'parrett';
  if (activeFilter === 'tributaries') return fromNode?.catchment === 'tributaries' || toNode?.catchment === 'tributaries';
  if (activeFilter === 'sowy_ksd') return edge.type === 'diversion_clyse' || edge.type === 'diversion_route' || fromNode?.catchment === 'sowy_ksd';
  return true;
}

export function getDashboardCardIdForNode(nodeId) {
  const NODE_TO_CARD_MAP = {
    '52108': '52118',
    '52109': '52118',
    '52111': '52118',
    '52162': '52118',
    '52118': '52118',
    '52127': '52118',
    'currymoor_ps': '52118',
    '52116': '52158',
    '52119': '52158',
    '52158': '52158',
    '52159': '52158',
    'saltmoor_ps': '52158',
    '52124': '52158',
    '52233': '52233',
    '52234': '52233',
    '52157': '52233',
    'E9531': '52233',
    '52163': '52163',
    'E9094': '52163',
    '52120': '52120',
    '52121': '52120',
    '52117': '52120',
    '52112': '52120',
    '52153': '52120',
    '52115': '52120',
    '52114': '52120'
  };
  return NODE_TO_CARD_MAP[nodeId] || nodeId;
}

function inspectNode(nodeId, restoreFocus = false) {
  selectedNodeId = nodeId;
  syncUrlState();
  renderSVGNetwork(); // re-render to update selected highlight ring

  if (restoreFocus) {
    const svg = document.getElementById('topology-svg');
    const targetEl = svg?.querySelector(`.topology-node-group[data-id="${nodeId}"]`);
    if (targetEl) {
      targetEl.focus();
    }
  }

  const node = topologyData?.nodes?.find(n => n.id === nodeId);
  const placeholder = document.getElementById('inspector-placeholder');
  const content = document.getElementById('inspector-content');

  if (!node) {
    if (placeholder) placeholder.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    return;
  }

  if (placeholder) placeholder.classList.add('hidden');
  if (content) content.classList.remove('hidden');

  // Populate drawer fields
  const typeBadge = document.getElementById('node-type-badge');
  const title = document.getElementById('node-title');
  const subtitle = document.getElementById('node-subtitle');
  const statusPill = document.getElementById('node-status-pill');
  const stageNum = document.getElementById('node-stage-num');
  const crestLabel = document.getElementById('node-crest-label');
  const crestVal = document.getElementById('node-crest-val');
  const clearancePill = document.getElementById('node-clearance-pill');
  const trackMin = document.getElementById('node-track-min');
  const trackMax = document.getElementById('node-track-max');
  const progressbar = document.getElementById('node-progressbar');
  const trackFill = document.getElementById('node-track-fill');
  const durationVal = document.getElementById('node-duration-val');
  const sparklineBadge = document.getElementById('node-sparkline-badge');
  const sparklineBox = document.getElementById('node-sparkline-box');
  const narrative = document.getElementById('node-narrative');
  const govukLink = document.getElementById('node-govuk-link');

  const vis = getNodeStatusVisual(node);

  // Progressive Disclosure Level 2: Seasonal Regime & Active Session [RULE-ENT-01]
  const regime = getSeasonalRegime();
  if (typeBadge) typeBadge.innerText = node.node_type ? node.node_type.toUpperCase().replace('_', ' ') : 'GAUGE NODE';
  if (title) title.innerText = node.name;
  if (subtitle) subtitle.innerHTML = `EA Station ID: ${escapeHTML(node.id)} (${escapeHTML(node.river)}) • <span style="color:#38bdf8;">${regime.isSummer ? '☀️ Summer Penning' : '❄️ Winter Flood'}</span>`;

  if (statusPill) {
    statusPill.className = `status-pill status-${vis.badgeClass.replace('badge-', '')}`;
    statusPill.innerText = `${vis.symbol} ${vis.label}`;
  }

  const stage = typeof node.stage_mAOD === 'number' ? node.stage_mAOD : null;
  const stageUnit = document.querySelector('.inspector-hero-metric .stage-unit');
  const crest = node.crest_elevation_mAOD || node.alert_level_mAOD || null;

  const isRelativeGauge = GAUGE_DATUMS[node.id] !== undefined;
  const datum = GAUGE_DATUMS[node.id];
  const isPolder = node.node_type === 'polder_basin';

  // Extract readings for 3h trend calculation [Progressive Disclosure Level 1]
  const historyMeasures = historyData?.measures || {};
  const statusMeasures = statusData?.measures || {};
  const measureKey = Object.keys(historyMeasures).find(k => k.startsWith(`${node.id}-`)) ||
                     Object.keys(statusMeasures).find(k => k.startsWith(`${node.id}-`)) ||
                     `${node.id}-level-stage-i-15_min-mAOD`;
  const readings = historyMeasures[measureKey] || statusMeasures[measureKey] || [];
  let trendVector = computeTrendVector(readings);
  if (node.id === '52118') {
    const bpKey = Object.keys(historyMeasures).find(k => k.startsWith('52162-')) ||
                  Object.keys(statusMeasures).find(k => k.startsWith('52162-')) ||
                  '52162-level-stage-i-15_min-mAOD';
    const bpReadings = historyMeasures[bpKey] || statusMeasures[bpKey] || [];
    const estKey = Object.keys(historyMeasures).find(k => k.startsWith('52163-')) ||
                   Object.keys(statusMeasures).find(k => k.startsWith('52163-')) ||
                   '52163-level-tidal_level-i-15_min-mAOD';
    const estReadings = historyMeasures[estKey] || statusMeasures[estKey] || [];
    trendVector = disambiguateRiverTrend(readings, bpReadings?.[0], estReadings?.[0]);
  }

  // Active event session lookup [Progressive Disclosure Level 1 & 2]
  const activeEvents = statusData?.active_events || [];
  // Priority-ordered asset lists for nodes that can match several events, so a more
  // specific structure (e.g. Monk's Leaze Clyse) is never shadowed by a catch-all one.
  const ACTIVE_EVENT_PRIORITY = {
    '52233': ['monks_leaze_clyse', 'allermoor_spillway', 'west_sedgemoor']
  };
  const prioritisedAssets = ACTIVE_EVENT_PRIORITY[node.id];
  const prioritisedEvent = prioritisedAssets
    ? prioritisedAssets.map(id => activeEvents.find(e => e.asset_id === id)).find(Boolean)
    : null;
  const activeEvent = prioritisedEvent || activeEvents.find(e => {
    if (prioritisedAssets) return false;
    if (node.id === '52118') return e.asset_id === 'hookbridge' || e.asset_id === 'stanmoor';
    if (node.id === '52158') return e.asset_id === 'baltmoor_wall';
    if (node.id === '52157') return e.asset_id === 'beer_wall' || e.asset_id === 'westonzoyland';
    if (node.id === '52127') return e.asset_id === 'curry_moor' || e.asset_id === 'stanmoor' || e.asset_id === 'cuts_road';
    if (node.id === '52159') return e.asset_id === 'northmoor' || e.asset_id === 'westonzoyland';
    if (node.id === '52163') return e.asset_id === 'dunball_outfall';
    if (node.id === '52120') return e.asset_id === 'muchelney_access' || e.asset_id === 'wet_moor';
    if (node.id === '52153') return e.asset_id === 'wet_moor';
    return false;
  });
  const durTimer = activeEvent?.duration_formatted ? ` • ⏱️ ${activeEvent.duration_formatted}` : '';

  if (isRelativeGauge && stage !== null && datum !== undefined) {
    const channelDepth = Math.max(0, stage - datum);
    if (stageNum) stageNum.innerText = channelDepth.toFixed(2);
    if (stageUnit) stageUnit.innerText = 'm depth';

    if (crestLabel) crestLabel.innerText = 'Surface Elevation:';
    if (crestVal) crestVal.innerText = `${stage.toFixed(2)}mAOD`;
    
    if (clearancePill) {
      clearancePill.className = 'clearance-pill pill-secure';
      clearancePill.innerText = `Gauge Zero: ${datum.toFixed(2)}mAOD (${trendVector})${durTimer}`;
    }

    if (trackMin) trackMin.innerText = `Channel Bed: 0.00m`;
    if (trackMax) trackMax.innerText = `Elevation: ${stage.toFixed(2)}mAOD`;
    if (progressbar) progressbar.setAttribute('aria-valuenow', '100');
    if (trackFill) {
      trackFill.style.width = '100%';
      trackFill.className = 'track-bar-fill';
    }
  } else {
    if (stageNum) stageNum.innerText = stage !== null ? stage.toFixed(2) : '--';
    if (stageUnit) stageUnit.innerHTML = renderJargonTerm('mAOD');

    // Compute Crest / Alert Clearance
    const hasCrest = !!node.crest_elevation_mAOD && !isPolder;
    const effectiveCrest = node.crest_elevation_mAOD || node.alert_level_mAOD || 7.45;
    let minLevel = node.ground_elevation_mAOD || STATION_BASELINES[node.id] || (effectiveCrest > 3.0 ? effectiveCrest - 3.0 : 0.0);

    if (crestLabel) {
      if (isPolder) crestLabel.innerText = 'Spillway Capacity Crest:';
      else if (node.node_type === 'tidal_outfall') crestLabel.innerText = 'Storm Surge Alert:';
      else crestLabel.innerText = hasCrest ? 'Engineered Crest:' : 'Alert Level:';
    }
    if (crestVal) crestVal.innerText = `${effectiveCrest.toFixed(2)}mAOD`;
    
    let clearanceText = '';
    if (stage !== null) {
      const delta = stage - effectiveCrest;
      if (node.node_type === 'tidal_outfall' && delta < 0) {
        const inlandNode = topologyData?.nodes?.find(n => n.id === 'E9094');
        const inlandStage = typeof node.inland_stage_mAOD === 'number' ? node.inland_stage_mAOD : (typeof inlandNode?.stage_mAOD === 'number' ? inlandNode.stage_mAOD : 2.38);
        const isTideLocked = stage >= inlandStage;
        if (isTideLocked) {
          clearanceText = `🕒 Tide-Locked (Inland ${renderJargonTerm('KSD')}: ${inlandStage.toFixed(2)}mAOD) (${trendVector})${durTimer}`;
          if (clearancePill) clearancePill.className = 'clearance-pill pill-tide-locked';
        } else {
          clearanceText = `✓ Discharging (Inland ${renderJargonTerm('KSD')}: ${inlandStage.toFixed(2)}mAOD) (${trendVector})${durTimer}`;
          if (clearancePill) clearancePill.className = 'clearance-pill pill-secure';
        }
      } else if (delta >= 0) {
        const deltaFormatted = delta < 1.0 ? `${Math.round(delta * 100)}cm` : `${delta.toFixed(2)}m`;
        clearanceText = hasCrest ? `▲ Overtopping by +${deltaFormatted} over crest (${trendVector})${durTimer}` : (isPolder ? `▲ Overtopping Inflow Active (${trendVector})${durTimer}` : `▲ Above Alert by +${deltaFormatted} (${trendVector})${durTimer}`);
        if (clearancePill) clearancePill.className = 'clearance-pill pill-overspill';
      } else {
        const clearanceM = Math.abs(delta);
        const clearanceFormatted = clearanceM < 1.0 ? `${Math.round(clearanceM * 100)}cm` : `${clearanceM.toFixed(2)}m`;
        clearanceText = hasCrest ? `${clearanceFormatted} below crest (${trendVector})${durTimer}` : (isPolder ? `${clearanceFormatted} retention head below crest (${trendVector})${durTimer}` : `${clearanceFormatted} below alert (${trendVector})${durTimer}`);
        if (clearancePill) clearancePill.className = 'clearance-pill pill-secure';
      }
    }
    if (clearancePill) clearancePill.innerHTML = clearanceText;

    // Track progress fill calculation
    let pct = 0;
    if (stage !== null && effectiveCrest > minLevel) {
      pct = Math.max(0, Math.min(100, ((stage - minLevel) / (effectiveCrest - minLevel)) * 100));
    }
    if (trackMin) {
      trackMin.innerText = isPolder ? `Moor Bed: ${minLevel.toFixed(2)}mAOD` : `Baseline: ${minLevel.toFixed(2)}m`;
    }
    if (trackMax) {
      trackMax.innerText = isPolder ? `Capacity: ${effectiveCrest.toFixed(2)}mAOD` : (hasCrest ? `Crest: ${effectiveCrest.toFixed(2)}mAOD` : `Alert: ${effectiveCrest.toFixed(2)}mAOD`);
    }
    if (progressbar) progressbar.setAttribute('aria-valuenow', pct.toFixed(0));
    if (trackFill) {
      trackFill.style.width = `${pct}%`;
      trackFill.className = `track-bar-fill ${node.status === 'OVERSPILLING' || node.status === 'ALERT' ? 'fill-alert' : ''}`;
    }
  }

  // Stats Grid: Displays duration for spillways/clyses, pumping station status for polders, and surveyed datums for gauges
  const statsGrid = document.getElementById('node-stats-grid');
  const isControlStructure = ['spillway', 'clyse_gate', 'clyse_tailwater', 'spillway_channel', 'outfall_estuary', 'outfall_inland'].includes(node.node_type) || node.status === 'OVERSPILLING' || node.status === 'DIVERTING';
  // 52234 has its own ponding / Beer Wall wave-check card; it must not fall into the generic
  // control-structure branch when its status is DIVERTING.
  const useControlStructureCard = isControlStructure && node.id !== '52234';

  let activeEventCardHTML = '';
  if (activeEvent) {
    activeEventCardHTML = `
      <div class="stat-card" style="grid-column: span 2; background: rgba(30, 41, 59, 0.85); border: 1px solid #38bdf8;">
        <span class="stat-title">⚡ ACTIVE TELEMETRY EVENT SESSION (${escapeHTML(activeEvent.asset_id)})</span>
        <strong class="stat-val" style="font-size: 0.85rem; color: #f8fafc;">
          State: <code style="color: #38bdf8;">${escapeHTML(activeEvent.to_state)}</code> (Tier ${activeEvent.severity_tier}) • ⏱️ ${escapeHTML(activeEvent.duration_formatted)}
        </strong>
        <p style="font-size: 0.78rem; color: #cbd5e1; margin-top: 0.35rem; line-height: 1.4;">${escapeHTML(activeEvent.narrative)}</p>
      </div>
    `;
  }

  if (statsGrid) {
    statsGrid.style.display = 'grid';
    if (node.id === '52120') {
      const huishEval = evaluateHuishEpiscopi(stage, regime.isSummer);
      const isCutoff = huishEval.isPumpsCutoff;
      const isAlert = huishEval.code === 'ALERT';
      const pumpText = isCutoff
        ? '🔒 PUMPS LOCKED (RIVER FULL - ≥8.20m Cut-off)'
        : (isAlert ? '▲ FLOOD ALERT (≥8.48m AOD)' : '🟢 STANDBY (GRAVITY DRAIN - <8.20m Cut-off)');
      statsGrid.innerHTML = `
        ${activeEventCardHTML}
        <div class="stat-card">
          <span class="stat-title">8.20m River Cut-off Margin</span>
          <strong class="stat-val" style="color: ${isCutoff ? '#ef4444' : '#38bdf8'}">${stage !== null ? (8.20 - stage >= 0 ? `+${(8.20 - stage).toFixed(2)}m clearance` : `${Math.abs(8.20 - stage).toFixed(2)}m above cutoff`) : '--'}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-title">8.48m Flood Alert Margin</span>
          <strong class="stat-val" style="color: ${isAlert ? '#ef4444' : '#10b981'}">${stage !== null ? (8.48 - stage >= 0 ? `+${(8.48 - stage).toFixed(2)}m margin` : `▲ FLOOD ALERT`) : '--'}</strong>
        </div>
        <div class="stat-card" style="grid-column: span 2;">
          <span class="stat-title">Huish Episcopi Pumping Station (8.20m River Cut-off Interlock)</span>
          <strong class="stat-val" style="font-size:0.8rem; font-family:monospace;">${pumpText}</strong>
        </div>
      `;
    } else if (node.id === '52153') {
      const parrettNode = topologyData?.nodes?.find(n => n.id === '52233' || n.id === '52158');
      const parrettStage = typeof parrettNode?.stage_mAOD === 'number' ? parrettNode.stage_mAOD : null;
      const midelneyEval = evaluateMidelney(stage, parrettStage);
      statsGrid.innerHTML = `
        ${activeEventCardHTML}
        <div class="stat-card">
          <span class="stat-title">Midelney Sluice State</span>
          <strong class="stat-val" style="color:${midelneyEval.isAlert ? '#ef4444' : (midelneyEval.isHeadLocked ? '#f59e0b' : '#10b981')}">${midelneyEval.isAlert ? '🚨 FSA Overflow / Alert' : (midelneyEval.isHeadLocked ? '🔒 Head-Locked (Pumping)' : '🟢 Gravity Flap Sluice')}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-title">West Moor FSA Pumping (Inferred)</span>
          <strong class="stat-val" style="font-size:0.8rem; font-family:monospace;">${midelneyEval.isPumping ? '⚡ PUMP TRIGGER MET (≥6.40m, Inferred)' : 'Lead: 6.40m | Duty: 6.70m'}</strong>
        </div>
      `;
    } else if (node.id === '52163' || node.id === 'E9094') {
      const seaNode = topologyData?.nodes?.find(n => n.id === '52163');
      const inlandNode = topologyData?.nodes?.find(n => n.id === 'E9094');
      const seaVal = node.id === '52163' ? stage : (typeof node.sea_stage_mAOD === 'number' ? node.sea_stage_mAOD : (seaNode?.stage_mAOD ?? 2.95));
      const inlandVal = node.id === 'E9094' ? stage : (typeof node.inland_stage_mAOD === 'number' ? node.inland_stage_mAOD : (inlandNode?.stage_mAOD ?? 2.38));
      const isTideLocked = (typeof seaVal === 'number' && typeof inlandVal === 'number') ? (seaVal >= inlandVal) : (node.status === 'SLACK_RESTRICTED');
      const headDiff = (typeof inlandVal === 'number' && typeof seaVal === 'number') ? (inlandVal - seaVal) : 0;
      const doorStateText = isTideLocked ? '🕒 TIDE-LOCKED (SEA HEAD)' : '🟢 GRAVITY DISCHARGE OPEN';
      const doorStateColor = isTideLocked ? '#64748b' : '#0284c7';
      statsGrid.innerHTML = `
        ${activeEventCardHTML}
        <div class="stat-card">
          <span class="stat-title">Dunball Sea Door State</span>
          <strong class="stat-val" style="color: ${doorStateColor}; font-size:0.82rem;">${doorStateText}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-title">Head Differential (${renderJargonTerm('KSD')} ➔ Sea)</span>
          <strong class="stat-val" style="font-size:0.82rem; font-family:monospace; color:${isTideLocked ? '#fbbf24' : '#38bdf8'};">${formatHeadDelta(headDiff)} (${inlandVal?.toFixed(2) ?? '--'}m ➔ ${seaVal?.toFixed(2) ?? '--'}m)</strong>
        </div>
        <div class="stat-card" style="grid-column: span 2;">
          <span class="stat-title">Tidal Outfall Hydrostatics</span>
          <strong class="stat-val" style="font-size:0.8rem; font-weight:normal; color:#cbd5e1;">
            ${isTideLocked
              ? `High tide in Parrett Estuary (${seaVal?.toFixed(2)}mAOD) exceeds inland King's Sedgemoor Drain (${renderJargonTerm('KSD')}) (${inlandVal?.toFixed(2)}mAOD). Passive flap doors shut under reverse hydrostatic head.`
              : `Estuary tide (${seaVal?.toFixed(2)}mAOD) is below inland ${renderJargonTerm('KSD')} (${inlandVal?.toFixed(2)}mAOD). Positive head opens Dunball flap ${renderJargonTerm('Clyse')} for gravity evacuation.`}
          </strong>
        </div>
      `;
    } else if (isPolder) {
      const regime = getSeasonalRegime();
      if (node.id === '52127') {
        const pumpText = formatPolderPumpSummary(stage, ASSET_DEFINITIONS.curry_moor, 'Currymoor PS', 2, regime.isSummer);

        const athelneyDelta = stage !== null ? (7.35 - stage) : null;
        let athelneyText = '🟢 DRY: >0.30m below crest';
        if (stage !== null) {
          if (stage >= 7.35) athelneyText = '🔴 OVERTOPPING CASCADE (7.35m crest)';
          else if (stage >= 7.05) athelneyText = `⚠️ NEAR CREST: ${athelneyDelta.toFixed(2)}m margin`;
          else athelneyText = `🟢 DRY: ${athelneyDelta.toFixed(2)}m below crest`;
        }

        statsGrid.innerHTML = `
          ${activeEventCardHTML}
          <div class="stat-card">
            <span class="stat-title">Currymoor Pumping Station (Inferred)</span>
            <strong class="stat-val" style="font-size:0.8rem; font-family:monospace;">${pumpText}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-title">Athelney Spillway &amp; Cuts Rd</span>
            <strong class="stat-val" style="font-size:0.8rem; font-family:monospace;">${athelneyText}</strong>
          </div>
          <div class="stat-card" style="grid-column: span 2;">
            <span class="stat-title">Hydraulic Flow Pathways</span>
            <strong class="stat-val" style="font-size:0.8rem; font-weight:normal; color:#cbd5e1;">
              Inflow from River Tone via Hookbridge Spillway (7.45m). Overspill cascade to Northmoor Basin via Athelney Spillway (7.35m AOD crest).
            </strong>
          </div>
        `;
      } else {
        const pumpText = formatPolderPumpSummary(stage, ASSET_DEFINITIONS.northmoor, 'Saltmoor & Northmoor PS', 4, regime.isSummer);

        statsGrid.innerHTML = `
          ${activeEventCardHTML}
          <div class="stat-card">
            <span class="stat-title">Saltmoor &amp; Northmoor PS (Inferred)</span>
            <strong class="stat-val" style="font-size:0.8rem; font-family:monospace;">${pumpText}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-title">Baltmoor Wall Defence</span>
            <strong class="stat-val" style="font-size:0.8rem; font-family:monospace;">Crest: 7.80mAOD (Levee Defence)</strong>
          </div>
          <div class="stat-card" style="grid-column: span 2;">
            <span class="stat-title">Dual Inflow Pathways</span>
            <strong class="stat-val" style="font-size:0.8rem; font-weight:normal; color:#cbd5e1;">
              1. Inter-moor cascade from Curry Moor via Athelney Spillway (7.35m AOD crest).<br/>
              2. Extreme Parrett river overtopping via Baltmoor Wall (7.80m levee crest at Burrowbridge).
            </strong>
          </div>
        `;
      }
    } else if (useControlStructureCard) {
      let durText = '⏱️ Inactive';
      if (node.status === 'OVERSPILLING') {
        const cardData = statusData?.spillways?.[node.id];
        durText = cardData?.spill_duration_formatted ? `⏱️ ${cardData.spill_duration_formatted}` : '⏱️ Active Spill';
      } else if (node.status === 'DIVERTING') {
        durText = '⏱️ Active Diversion';
      }

      if (node.id === '52118') {
        statsGrid.innerHTML = `
          ${activeEventCardHTML}
          <div class="stat-card">
            <span class="stat-title">Spill Duration</span>
            <strong class="stat-val" id="node-duration-val">${durText}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-title">Relief Overflow Pathway</span>
            <strong class="stat-val" style="font-size:0.8rem; color:#38bdf8;">River Tone ➔ Curry Moor Basin</strong>
          </div>
          <div class="stat-card" style="grid-column: span 2;">
            <span class="stat-title">Fluvial Conveyance</span>
            <strong class="stat-val" style="font-size:0.8rem; font-weight:normal; color:#cbd5e1;">
              Crest 7.45mAOD. When river &lt; 7.45m, Tone channel flows uninterrupted downstream to Baltmoor Wall / Burrowbridge confluence.
            </strong>
          </div>
        `;
      } else if (node.id === '52158') {
        statsGrid.innerHTML = `
          ${activeEventCardHTML}
          <div class="stat-card">
            <span class="stat-title">Overtopping Status</span>
            <strong class="stat-val" id="node-duration-val">${durText}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-title">Confluence Location</span>
            <strong class="stat-val" style="font-size:0.8rem; color:#38bdf8;">Tone + Parrett at Burrowbridge</strong>
          </div>
          <div class="stat-card" style="grid-column: span 2;">
            <span class="stat-title">Levee Defence Function</span>
            <strong class="stat-val" style="font-size:0.8rem; font-weight:normal; color:#cbd5e1;">
              Protects Northmoor against river overtopping up to 7.80mAOD. Inter-moor floodwaters from Curry Moor enter Northmoor via Athelney Spillway (7.35m).
            </strong>
          </div>
        `;
      } else if (node.id === '52233') {
        const downNode = topologyData?.nodes?.find(n => n.id === '52234');
        const downStage = typeof downNode?.stage_mAOD === 'number' ? downNode.stage_mAOD : STATION_REGISTRY['52234']?.fallback_stage_mAOD;
        const upStageForOath = stage ?? STATION_REGISTRY['52233']?.fallback_stage_mAOD;
        // Oath Lock is inferred from the 52233 - 52234 head difference. Suppress the inference
        // when either reading is a cached fallback or the downstream sensor is offline / stale.
        const downMeasureKey = Object.keys(statusData?.measures || {}).find(k => k.startsWith('52234-'));
        const downReadings = (downMeasureKey && (statusData?.measures?.[downMeasureKey] || historyData?.measures?.[downMeasureKey])) || [];
        const downFreshness = evaluateStationFreshness(downReadings);
        const oathDegraded = node.telemetry_source === 'cached_fallback' ||
          downNode?.telemetry_source === 'cached_fallback' ||
          !Number.isFinite(downStage) || !Number.isFinite(upStageForOath) ||
          Boolean(downFreshness.isOffline || downFreshness.isStale || downFreshness.isFlatlined);
        const oathEval = oathDegraded
          ? {
              statusText: '⚠️ NOT ASSESSED (52234 reading unavailable)',
              narrative: 'Not assessed: the downstream Monk\'s Leaze reading (52234) is offline, stale or a cached fallback, so no head difference can be inferred.'
            }
          : evaluateOathLock(upStageForOath, downStage);
        statsGrid.innerHTML = `
          ${activeEventCardHTML}
          <div class="stat-card">
            <span class="stat-title">Monk's Leaze ${renderJargonTerm('Clyse')} Sluice</span>
            <strong class="stat-val" style="font-size:0.78rem; font-family:monospace; color:#38bdf8;">Sill: ${fmtM(T_MONKS.SILL_MAOD)}m • Trigger: ${fmtM(T_MONKS.TRIGGER_MAOD)}m AOD</strong>
          </div>
          <div class="stat-card">
            <span class="stat-title">Oath Lock ${renderJargonTerm('Penning')} (Inferred)</span>
            <strong class="stat-val" style="font-size:0.78rem; font-family:monospace;">${oathEval.statusText}</strong>
          </div>
          <div class="stat-card" style="grid-column: span 2;">
            <span class="stat-title">3-Structure Control Complex (Monk's Leaze, Allermoor &amp; Oath Lock)</span>
            <strong class="stat-val" style="font-size:0.78rem; font-weight:normal; color:#cbd5e1; line-height:1.45;">
              1. <strong>Monk's Leaze ${renderJargonTerm('Clyse')} Sluice:</strong> Concrete Sill ${fmtM(T_MONKS.SILL_MAOD)}m AOD • Headwall ${fmtM(T_MONKS.HEADWALL_MAOD)}m AOD • EA Diversion Trigger ${fmtM(T_MONKS.TRIGGER_MAOD)}m AOD • Sowy Cap ${fmtM(T_MONKS.DOWNSTREAM_ALERT_MAOD)}m AOD.<br/>
              2. <strong>Allermoor Spillway:</strong> ⚠️ Crest pending EA Asset Survey. Allermoor's own crest level is not published; ~7.50m AOD is Beasley's Spillway guidance used only as a proxy and is not used to declare overtopping. When running, EA protocol closes Monk's Leaze ${renderJargonTerm('Clyse')} and curtails upstream tributary pumping at Huish Episcopi, Midelney &amp; Long Load.<br/>
              3. <strong>Oath Lock Twin Radial Gates:</strong> ${oathEval.narrative}
            </strong>
          </div>
        `;
      } else if (node.id === '52157') {
        const bwReg = STATION_REGISTRY['52157'] || {};
        const bwEval = evaluateBeerWall(stage ?? bwReg.fallback_stage_mAOD, bwReg.crest_elevation_mAOD, {
          ksdConveyanceThreshold: bwReg.ksd_conveyance_mAOD,
          channelAlert: bwReg.alert_level_mAOD
        });
        statsGrid.innerHTML = `
          ${activeEventCardHTML}
          <div class="stat-card">
            <span class="stat-title">Sowy Spur &amp; Lang Acre Tilting Weirs</span>
            <strong class="stat-val" style="font-size:0.78rem; font-family:monospace; color:${bwEval.isTiltingWeirsActive ? '#38bdf8' : '#cbd5e1'};">${bwEval.isTiltingWeirsActive ? `🔵 ACTIVE CONVEYANCE (≥${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m)` : `⚪ PENNING (<${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m AOD)`}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-title">Beer Wall Culverts &amp; Beazeley Spillway</span>
            <strong class="stat-val" style="font-size:0.78rem; font-family:monospace;">${bwEval.statusText} (${fmtM(T_BEER.CREST_MAOD)}m AOD)</strong>
          </div>
          <div class="stat-card" style="grid-column: span 2;">
            <span class="stat-title">4-Tier Hydraulic Elevation Profile (Greylake / A372)</span>
            <strong class="stat-val" style="font-size:0.78rem; font-weight:normal; color:#cbd5e1; line-height:1.45;">
              • <strong>${fmtM(T_BEER.ALERT_MAOD)}m AOD:</strong> In-channel Sowy high-water alert envelope.<br/>
              • <strong>${fmtM(T_BEER.KSD_CONVEYANCE_MAOD)}m AOD:</strong> Sowy Spur &amp; Lang Acre tilting weirs lower into ${renderJargonTerm('KSD')} conveyance.<br/>
              • <strong>${fmtM(T_BEER.CREST_MAOD)}m AOD:</strong> 4-bay A372 concrete box culverts relief threshold (Beazeley Spillway crest: ⚠️ Pending EA Asset Survey).<br/>
              • <strong>&gt;${fmtM(T_BEER.A372_CROWN_MAOD)}m AOD:</strong> Raised A372 highway carriageway crown (⚠️ Pending As-Built Highways Survey).
            </strong>
          </div>
        `;
      } else {
        statsGrid.innerHTML = `
          ${activeEventCardHTML}
          <div class="stat-card">
            <span class="stat-title">Spill / Flow Duration</span>
            <strong class="stat-val" id="node-duration-val">${durText}</strong>
          </div>
        `;
      }
    } else if (node.id === '52234') {
      const bwNode = topologyData?.nodes?.find(n => n.id === '52157');
      const bwStage = typeof bwNode?.stage_mAOD === 'number' ? bwNode.stage_mAOD : STATION_REGISTRY['52157']?.fallback_stage_mAOD;
      const bwReadings = historyData?.measures?.['52157-level-stage-i-15_min-mAOD'] || statusData?.measures?.['52157-level-stage-i-15_min-mAOD'] || [];
      const bwRates = computeStageRates(bwReadings);
      const waveDetected = (bwRates.rate_1h_m_per_hr !== null && bwRates.rate_1h_m_per_hr >= 0.02) || bwStage >= T_BEER.ALERT_MAOD;
      statsGrid.innerHTML = `
        ${activeEventCardHTML}
        <div class="stat-card">
          <span class="stat-title">Sowy Intake Channel Envelope</span>
          <strong class="stat-val" style="font-size:0.78rem; font-family:monospace;">Bed: ${fmtM(T_MONKS.SILL_MAOD)}m • Cap: ${fmtM(T_MONKS.DOWNSTREAM_ALERT_MAOD)}m AOD</strong>
        </div>
        <div class="stat-card">
          <span class="stat-title">Beer Wall (52157) Wave Check</span>
          <strong class="stat-val" style="font-size:0.78rem; font-family:monospace; color:${waveDetected ? '#38bdf8' : '#cbd5e1'};">${waveDetected ? `🔵 Wave Active (${bwStage.toFixed(2)}m)` : `⚪ Baseflow (${bwStage.toFixed(2)}m)`}</strong>
        </div>
        <div class="stat-card" style="grid-column: span 2;">
          <span class="stat-title">Stilling-Well Ponding &amp; Downstream Wave Verification</span>
          <strong class="stat-val" style="font-size:0.78rem; font-weight:normal; color:#cbd5e1; line-height:1.45;">
            When Monk's Leaze ${renderJargonTerm('Clyse')} is shut, the downstream Sowy intake stilling well (52234) frequently ponds at a static flatline (~${fmtM(STATION_REGISTRY['52234']?.fallback_stage_mAOD)}m AOD). Active Sowy conveyance is cross-verified against downstream wave arrival (dh/dt &ge; +0.02m/h) at Beer Wall Upstream (Station 52157).
          </strong>
        </div>
      `;
    } else {
      const datumSubtext = datum !== undefined ? `Gauge Zero: ${datum.toFixed(2)}mAOD` : `River Corridor`;
      statsGrid.innerHTML = `
        ${activeEventCardHTML}
        <div class="stat-card">
          <span class="stat-title">Hydraulic Asset Type</span>
          <strong class="stat-val">In-Channel River Gauging</strong>
        </div>
        <div class="stat-card">
          <span class="stat-title">Surveyed Datum</span>
          <strong class="stat-val" style="font-size:0.8rem; font-family:monospace;">${datumSubtext}</strong>
        </div>
      `;
    }
  }

  // Upstream Tributary Feeder Chain Accordion Rendering
  const tribChainEl = document.getElementById('node-tributary-chain');
  const tribStepperEl = document.getElementById('tributary-chain-stepper');
  const UPSTREAM_STATIONS_META = {
    '52121': { name: 'Sherborne Lake', role: 'Headwater Attenuation Reservoir', loc: 'Sherborne, Dorset' },
    '52117': { name: 'Pen Mill (Yeovil)', role: 'Urban Yeo Early Warning', loc: 'Yeovil, Somerset' },
    '52112': { name: 'Ilchester', role: 'Mid-Yeo Floodplain Reach', loc: 'Ilchester, Somerset' },
    '52115': { name: 'Donyatt', role: 'Upper Isle Runoff Gauge', loc: 'Ilminster, Somerset' },
    '52114': { name: 'Ashford Mill', role: 'Mid-Isle Conveyance Reach', loc: 'Ilton, Somerset' }
  };

  if (tribChainEl && tribStepperEl) {
    if (node.upstream_tributaries && node.upstream_tributaries.length > 0) {
      tribChainEl.classList.remove('hidden');
      tribStepperEl.innerHTML = node.upstream_tributaries.map(stId => {
        const meta = UPSTREAM_STATIONS_META[stId] || { name: `Station ${stId}`, role: 'Feeder Reach', loc: 'Somerset' };
        return `
          <div class="tributary-step-card">
            <div class="tributary-step-info">
              <span class="tributary-step-name">${meta.name} <code style="color:#64748b; font-size:0.75rem;">(${stId})</code></span>
              <span class="tributary-step-role">${meta.role} • ${meta.loc}</span>
            </div>
            <a href="https://environment.data.gov.uk/flood-monitoring/id/stations/${stId}.html" target="_blank" rel="noopener noreferrer" class="tributary-step-link" title="View EA official telemetry for ${meta.name}">
              EA Telemetry ↗
            </a>
          </div>
        `;
      }).join('');
    } else {
      tribChainEl.classList.add('hidden');
    }
  }

  // Correlated Upland TBR Hyetograph (Stacked Above River Stage Hydrograph) [Issue #67]
  const hyetoSection = document.getElementById('node-hyetograph-section');
  const hyetoBadge = document.getElementById('node-hyetograph-badge');
  const hyetoSummary = document.getElementById('node-hyetograph-summary');
  const hyetoBox = document.getElementById('node-hyetograph-box');
  const hyetoProv = document.getElementById('node-hyetograph-provenance');
  if (hyetoSection && hyetoBox) {
    const correlated = resolveCorrelatedUplandTbr(node.id, rainfallData);
    if (correlated && correlated.station) {
      const tbr = correlated.station;
      const peerSuffix = correlated.peerCount > 0 ? ` (+${correlated.peerCount} gauge)` : '';
      hyetoSection.classList.remove('hidden');
      if (hyetoBadge) {
        const shortName = tbr.ea_label || tbr.name || tbr.id;
        hyetoBadge.innerText = `TBR ${tbr.id} • ${shortName}${peerSuffix}`;
      }
      if (hyetoSummary) {
        const isStaleOrEmpty = Boolean(tbr.is_stale) || (tbr.valid_reading_count ?? 0) === 0;
        if (isStaleOrEmpty) {
          hyetoSummary.innerHTML = `
            <span class="hyetograph-stat-pill stale">Awaiting live TBR sync</span>
            <span class="hyetograph-stat-pill stale">24h: —</span>
          `;
        } else {
          const r1h = typeof tbr.last_1h_mm === 'number' ? tbr.last_1h_mm.toFixed(1) : '0.0';
          const r6h = typeof tbr.last_6h_mm === 'number' ? tbr.last_6h_mm.toFixed(1) : '0.0';
          const r24h = typeof tbr.last_24h_mm === 'number' ? tbr.last_24h_mm.toFixed(1) : '0.0';
          hyetoSummary.innerHTML = `
            <span class="hyetograph-stat-pill">1h: ${escapeHTML(r1h)} mm</span>
            <span class="hyetograph-stat-pill">6h: ${escapeHTML(r6h)} mm</span>
            <span class="hyetograph-stat-pill">24h: ${escapeHTML(r24h)} mm</span>
            <span class="hyetograph-stat-pill">${escapeHTML(tbr.rate_label || 'Dry (0.0 mm/h)')}</span>
          `;
        }
      }
      hyetoBox.innerHTML = renderInspectorHyetograph(tbr);
      bindInspectorHyetographEvents(hyetoBox, { refreshController });
      if (hyetoProv) {
        const attrText = rainfallData?.provenance?.attribution || RAINGAUGE_PROVENANCE.attribution;
        hyetoProv.innerText = `${attrText} • 15-min TBR depth (mm). Collector elevation unsurveyed.`;
      }
    } else {
      hyetoSection.classList.add('hidden');
      hyetoBox.innerHTML = '';
    }
  }

  if (sparklineBadge) sparklineBadge.innerText = `Gauge ${node.id}`;

  // Render Sparkline
  if (sparklineBox) {
    const isSpillway = node.node_type === 'spillway';
    const crestForSparkline = isSpillway ? (node.crest_elevation_mAOD || null) : null;

    const historyMeasures = historyData?.measures || {};
    const statusMeasures = statusData?.measures || {};
    const measureKey = Object.keys(historyMeasures).find(k => k.startsWith(`${node.id}-`)) ||
                       Object.keys(statusMeasures).find(k => k.startsWith(`${node.id}-`)) ||
                       `${node.id}-level-stage-i-15_min-mAOD`;
    const readings = historyMeasures[measureKey] || statusMeasures[measureKey] || [];

    const sparklineColor = vis.sparklineColor || vis.stroke;
    if (readings.length > 0) {
      sparklineBox.innerHTML = renderInspectorSparkline(readings, sparklineColor, crestForSparkline, isRelativeGauge);
      bindInspectorSparklineEvents(sparklineBox, { refreshController });
    } else {
      sparklineBox.innerHTML = `<div style="padding:1rem; text-align:center; color:#38bdf8; font-size:0.8rem;">📡 Fetching live 24h EA telemetry hydrograph...</div>`;
      const candidateKeys = [
        `${node.id}-level-stage-i-15_min-mASD`,
        `${node.id}-level-stage-i-15_min-mAOD`,
        `${node.id}-level-stage-i-15_min-m`,
        `${node.id}-level-tidal_level-i-15_min-mAOD`,
        `${node.id}-level-downstage-i-15_min-mAOD`
      ];
      (async () => {
        let fetchedReadings = null;
        for (const candKey of candidateKeys) {
          try {
            const res = await fetch(`https://environment.data.gov.uk/flood-monitoring/id/measures/${candKey}/readings?_sorted&_limit=96`);
            if (res.ok) {
              const data = await res.json();
              if (data.items && data.items.length > 0) {
                fetchedReadings = data.items;
                if (!historyData) historyData = { measures: {} };
                if (!historyData.measures) historyData.measures = {};
                historyData.measures[candKey] = data.items;
                break;
              }
            }
          } catch (_) {}
        }
        if (selectedNodeId === node.id) {
          sparklineBox.innerHTML = renderInspectorSparkline(fetchedReadings || [], sparklineColor, crestForSparkline, isRelativeGauge);
          bindInspectorSparklineEvents(sparklineBox, { refreshController });
        }
      })();
    }
  }

  if (typeof window !== 'undefined' && window.innerWidth < 1024) {
    const drawer = document.getElementById('node-inspector-drawer');
    if (drawer) drawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (narrative) {
    narrative.innerHTML = getInspectorNarrative(node, stage, crest);
    narrative.className = `inspector-narrative status-border-${node.status.toLowerCase().replace('_', '-')}`;
  }

  // Populate Hydraulic Thresholds & Provenance Breakdown
  const provList = document.getElementById('node-provenance-list');
  if (provList) {
    const provItems = [];
    const prov = node.provenance || STATION_REGISTRY[node.id]?.provenance || {};

    if (node.crest_elevation_mAOD !== undefined && node.crest_elevation_mAOD !== null) {
      const crestProv = prov.crest || { tier: 1, label: 'Surveyed Crest', authority: 'EA Asset Survey (ODN)' };
      provItems.push({
        label: isPolder ? 'Spillway Capacity Crest' : 'Engineered Crest',
        value: `${Number(node.crest_elevation_mAOD).toFixed(2)}m AOD`,
        tier: crestProv.tier,
        tierLabel: crestProv.label,
        authority: crestProv.authority,
        icon: '📐'
      });
    }

    if (node.sill_elevation_mAOD !== undefined && node.sill_elevation_mAOD !== null) {
      const sillProv = prov.sill || { tier: 1, label: 'Surveyed Sill', authority: 'EA Intake Sill Survey' };
      provItems.push({
        label: 'Concrete Intake Sill',
        value: `${Number(node.sill_elevation_mAOD).toFixed(2)}m AOD`,
        tier: sillProv.tier,
        tierLabel: sillProv.label,
        authority: sillProv.authority,
        icon: '📐'
      });
    }

    if (node.alert_level_mAOD !== undefined && node.alert_level_mAOD !== null) {
      const alertProv = prov.alert || { tier: 3, label: 'EA Typical High', authority: 'EA stageScale.typicalRangeHigh' };
      provItems.push({
        label: 'Flood Alert Threshold',
        value: `${Number(node.alert_level_mAOD).toFixed(2)}m AOD`,
        tier: alertProv.tier,
        tierLabel: alertProv.label,
        authority: alertProv.authority,
        icon: alertProv.tier === 2 ? '📋' : (alertProv.tier === 1 ? '📐' : '📊')
      });
    }

    if (datum !== undefined && datum !== null) {
      const datumProv = prov.datum || { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (ODN)' };
      provItems.push({
        label: 'Surveyed Datum (ODN)',
        value: `+${Number(datum).toFixed(2)}m AOD`,
        tier: datumProv.tier,
        tierLabel: datumProv.label,
        authority: datumProv.authority,
        icon: '📐'
      });
    }

    if (prov.operational) {
      provItems.push({
        label: 'Operational Trigger Plan',
        value: isPolder ? 'Mobile Pumps Trigger' : 'Operating Rules',
        tier: prov.operational.tier,
        tierLabel: prov.operational.label,
        authority: prov.operational.authority,
        icon: '📋'
      });
    }

    if (prov.near_crest) {
      provItems.push({
        label: 'Near-Crest Pre-Warning',
        value: '15cm Buffer',
        tier: prov.near_crest.tier,
        tierLabel: prov.near_crest.label,
        authority: prov.near_crest.authority,
        icon: '⚙️'
      });
    }

    provList.innerHTML = provItems.map(item => `
      <div class="provenance-item">
        <div class="provenance-item-meta">
          <span class="provenance-item-label">${escapeHTML(item.label)}:</span>
          <code class="provenance-item-val">${escapeHTML(item.value)}</code>
        </div>
        <span class="prov-pill prov-tier-${item.tier}" 
              title="Tier ${item.tier} (${escapeAttr(item.tierLabel)}): ${escapeAttr(item.authority)}"
              tabindex="0"
              role="note"
              aria-label="Provenance: Tier ${item.tier} ${escapeAttr(item.tierLabel)} - ${escapeAttr(item.authority)}">
          ${item.icon} ${escapeHTML(item.tierLabel)}
        </span>
      </div>
    `).join('');
  }

  const footerLinks = document.getElementById('node-footer-links');
  if (footerLinks) {
    const mainGovUkUrl = node.govuk_link || node.ea_link || `https://environment.data.gov.uk/flood-monitoring/id/stations/${node.id}.html`;
    const mainGovUkText = node.govuk_link ? '📊 View GOV.UK Gauge Page ↗' : '📡 View EA Open Telemetry API ↗';
    
    const cardTargetId = getDashboardCardIdForNode(node.id);
    const dashboardCardBtn = `
      <a href="index.html#card-${cardTargetId}" class="ext-link-btn" id="btn-view-dashboard-card" title="View Full Dashboard Card for ${escapeAttr(node.name)}">
        📊 View Full Dashboard Card ↗
      </a>
    `;

    const NODE_CAM_MAP = {
      '52118': 'hookbridge',
      '52127': 'currymoor',
      'currymoor_ps': 'currymoor',
      '52159': 'saltmoor',
      'saltmoor_ps': 'saltmoor',
      '52233': 'monksleaze',
      '52234': 'monksleaze',
      '52157': 'beerwall',
      '52163': 'dunball',
      'E9094': 'dunball'
    };
    const camSite = NODE_CAM_MAP[node.id];
    const camGuideHtml = camSite ? `
      <button type="button" class="ext-link-btn camera-guide-trigger" data-camera-guide="${camSite}" title="Open Layperson Camera Guide">🧭 Camera Guide</button>
    ` : '';

    const NODE_ASSET_CANDIDATES = {
      '52118': ['hookbridge', 'curry_moor', 'stanmoor'],
      '52127': ['curry_moor', 'stanmoor', 'cuts_road', 'new_road_curry'],
      '52158': ['baltmoor_wall', 'a361_burrowbridge', 'stan_moor_road', 'west_sedgemoor'],
      '52159': ['northmoor', 'westonzoyland', 'moorland_new_cut_road'],
      '52157': ['beer_wall', 'beer_wall_a372', 'westonzoyland'],
      '52163': ['dunball_outfall'],
      'E9094': ['dunball_outfall'],
      '52233': ['monks_leaze_clyse', 'allermoor_spillway', 'west_sedgemoor'],
      '52234': ['monks_leaze_clyse', 'allermoor_spillway'],
      '52120': ['wet_moor', 'muchelney_access', 'bicknells_bridge_access'],
      '52153': ['wet_moor']
    };
    const candidateAssets = NODE_ASSET_CANDIDATES[node.id] || [];
    const allKnownEvents = [...(statusData?.active_events || []), ...(eventsData || [])];
    const correlatedEvidenceEvent = allKnownEvents.find(ev => ev && ev.camera_evidence && candidateAssets.includes(ev.asset_id)) || null;
    const evCe = correlatedEvidenceEvent?.camera_evidence || null;
    const evSeqCount = Array.isArray(evCe?.sequence_frames) ? evCe.sequence_frames.length : 0;
    const evIsNight = Boolean(evCe && evCe.fallback_mode === 'NIGHT_TELEMETRY' && evSeqCount === 0);
    const visualEvidenceBtnHtml = (correlatedEvidenceEvent && evCe) ? `
      <button type="button"
              class="ext-link-btn visual-evidence-btn ${evIsNight ? 'visual-evidence-btn-night' : ''} visual-evidence-trigger"
              data-visual-evidence-event-id="${escapeAttr(String(correlatedEvidenceEvent.id || ''))}"
              data-visual-evidence-asset="${escapeAttr(correlatedEvidenceEvent.asset_id || '')}"
              title="${evIsNight ? 'Inspect Night Telemetry Verification' : 'Inspect Archived Event Keyframes & Transition Sequence'}">
        <span aria-hidden="true">${evIsNight ? '🌙' : '📷'}</span> ${evIsNight ? 'Night Telemetry' : `Visual Evidence${evSeqCount > 1 ? ` (${evSeqCount})` : ''}`}
      </button>
    ` : '';

    const cameraHtml = node.id === '52233' ? `
      <a href="https://thecfh.org/parretttonewsom.php#monksleaze" target="_blank" rel="noopener noreferrer" class="ext-link-btn" style="border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;" title="View Monk's Leaze Clyse Spillway Crest &amp; Intake Camera at thecfh.org">📷 Spillway Crest &amp; Intake Camera ↗</a>
    ` : (node.id === '52157' ? `
      <a href="https://thecfh.org/parretttonewsom.php#Beerwall" target="_blank" rel="noopener noreferrer" class="ext-link-btn" style="border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;" title="View Beer Wall Box Culverts &amp; Beazeley Spillway Camera at thecfh.org">📷 Beer Wall Culverts &amp; Beazeley Camera ↗</a>
    ` : '');

    footerLinks.innerHTML = `
      ${visualEvidenceBtnHtml}
      ${dashboardCardBtn}
      ${cameraHtml}
      ${camGuideHtml}
      <a href="${escapeAttr(mainGovUkUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link-btn" id="node-govuk-link">${escapeHTML(mainGovUkText)}</a>
    `;

    // Staff gauge camera cross-check (Issue #54)
    // An already-opened panel for the same node (frame loaded or loading) is kept across
    // refreshes so it is not torn down and re-fetched; only its age caption is refreshed.
    const existingPanel = document.getElementById('node-staff-gauge-camera');
    const keepOpenPanel = Boolean(
      existingPanel &&
      existingPanel.dataset?.nodeId === String(node.id) &&
      existingPanel._staffGaugeEntry &&
      !existingPanel.querySelector('.staff-gauge-load')
    );
    if (keepOpenPanel) {
      const body = existingPanel.querySelector('.staff-gauge-body');
      if (body && body.querySelector('img.staff-gauge-frame')) {
        loadFrame(existingPanel._staffGaugeEntry, body, { silent: true });
      }
    } else {
      existingPanel?.remove();
      const staffGaugePanel = buildStaffGaugePanel(node, readings);
      if (staffGaugePanel) footerLinks.insertAdjacentElement('beforebegin', staffGaugePanel);
    }
  }
}

function getCatchmentLabel(c) {
  if (c === 'tone') return 'River Tone Catchment';
  if (c === 'parrett') return 'River Parrett Catchment';
  if (c === 'sowy_ksd') return 'Sowy / Sedgemoor Diversion Corridor';
  return 'Somerset Catchment';
}

export function getInspectorNarrative(node, stage, crest) {
  const isPolder = node.node_type === 'polder_basin';
  const hasCrest = !!node.crest_elevation_mAOD && !isPolder;
  const crestStr = typeof crest === 'number' ? `${crest.toFixed(2)} ${renderJargonTerm('mAOD', 'm AOD')}` : 'threshold';
  const stageStr = stage !== null && stage !== undefined ? `${stage.toFixed(2)} ${renderJargonTerm('mAOD', 'm AOD')}` : '--';
  const groundStr = node.ground_elevation_mAOD !== undefined ? `${node.ground_elevation_mAOD.toFixed(2)} ${renderJargonTerm('mAOD', 'm AOD')}` : '--';

  if (isPolder) {
    if (node.status === 'ALERT') {
      return `POLDER STORAGE ALERT: Moor stage height (${stageStr}) has reached the high flood storage alert threshold (${crestStr}). IDB/EA evacuation pumps are on high alert.`;
    }
    return `POLDER STORAGE SECURE: Moor water level (${stageStr}) is resting safely on moor bed (${groundStr}), securely below evacuation triggers.`;
  }
  if (node.status === 'OVERSPILLING') {
    return `CRITICAL: Stage height (${stageStr}) exceeds the engineered crest height (${crestStr}). Floodwaters are overtopping into adjacent storage basins.`;
  }
  if (node.status === 'ALERT') {
    return hasCrest
      ? `ALERT: Water elevation (${stageStr}) is within pre-warning threshold (<30cm) of engineered spillway crest (${crestStr}).`
      : `ALERT: Water elevation (${stageStr}) has reached the high water alert threshold (${crestStr}).`;
  }
  if (node.status === 'DIVERTING') {
    return `ACTIVE DIVERSION (inferred): River Parrett stage (${stageStr}) is above the EA diversion trigger with a positive head difference into the Sowy Relief Channel, so flow is expected to pass through Monk's Leaze Clyse. Gate position is not broadcast.`;
  }
  if (node.status === 'THROTTLED') {
    return `THROTTLED (inferred): River Parrett stage (${stageStr}) is above the diversion trigger, but the Sowy level is at its capacity threshold or the head difference is below the minimum, so diversion is expected to be restricted. Gate position is not broadcast.`;
  }
  if (node.status === 'REVERSE_LOCK') {
    return `REVERSE LOCK (inferred): the Sowy level (52234) is above the River Parrett level (52233) at Monk's Leaze Clyse, so the clyse is expected to be shut against back-flow. Stage now ${stageStr}. Gate position is not broadcast.`;
  }
  if (node.status === 'SLACK_RESTRICTED') {
    return `TIDE-LOCKED: High estuarine sea tide in Parrett Estuary exceeds inland drain level. Flap sluices shut tightly under hydrostatic backpressure.`;
  }
  return `NOMINAL / SECURE: Telemetry is live & active (96 readings synced today). River stage (${stageStr}) is in steady summer baseflow, securely below the alert threshold (${crestStr}).`;
}

function formatPolderPumpSummary(stage, def, stationName, pumpCount, isSummer) {
  const leadThresh = isSummer ? def.lead_pump_summer_mAOD : def.lead_pump_winter_mAOD;
  const dutyThresh = isSummer ? def.duty_pump_summer_mAOD : def.duty_pump_winter_mAOD;
  const pumpEval = evaluatePumpStatus(
    stage ?? 0,
    stationName,
    pumpCount,
    leadThresh,
    dutyThresh,
    def.mobile_ordered_mAOD,
    def.mobile_active_mAOD,
    def.critical_mAOD,
    isSummer
  );
  if (stage !== null) {
    if (pumpEval.mode === 'CRITICAL_OVERSPILL' || pumpEval.mode === 'EMERGENCY_MOBILE_ACTIVE') {
      return `⚡ EA MOBILE TRIGGER MET (≥${def.mobile_active_mAOD.toFixed(2)}m, Inferred)`;
    }
    if (pumpEval.mode === 'MOBILE_ORDERED') {
      return `⚠️ EA MOBILE ORDER TRIGGER MET (≥${def.mobile_ordered_mAOD.toFixed(2)}m, Inferred)`;
    }
    if (pumpEval.mode === 'FULL_CAPACITY') {
      return `⚡ ABOVE DUTY TRIGGER (≥${dutyThresh.toFixed(2)}m, Inferred)`;
    }
    if (pumpEval.mode === 'PARTIAL_DUTY') {
      return `⚡ ABOVE LEAD TRIGGER (≥${leadThresh.toFixed(2)}m, Inferred)`;
    }
  }
  return `🟢 Standby (Lead ${leadThresh.toFixed(2)}m, Duty ${dutyThresh.toFixed(2)}m)`;
}

/**
 * Evaluates whether an upland watershed origin badge matches the active catchment/area filter.
 *
 * @param {object} origin
 * @returns {boolean}
 */
function isUplandOriginMatchingFilter(origin) {
  if (!origin) return false;
  if (activeAreaFilter && AREA_MAPPINGS[activeAreaFilter]) {
    const areaStations = AREA_MAPPINGS[activeAreaFilter].stations || [];
    const correlated = Array.isArray(origin.correlated_river_station_ids) ? origin.correlated_river_station_ids : [];
    const matchesArea = areaStations.includes(origin.entry_node_id) || correlated.some(id => areaStations.includes(id));
    if (!matchesArea) return false;
  }
  if (activeFilter === 'all') return true;
  return origin.catchment_filter === activeFilter;
}

/**
 * Builds null-safe display data for a decoupled upland headwater rainfall badge.
 * Never fabricates live mm totals when the DB is empty or all upland gauges are stale.
 *
 * @param {object} origin
 * @param {object|null|undefined} rainfallPayload
 * @returns {{ hasLive: boolean, primaryText: string, subText: string, ariaLabel: string, tooltip: string }}
 */
export function buildUplandRainfallBadgeModel(origin, rainfallPayload) {
  const label = origin?.label || origin?.id || 'Upland';
  const fullLabel = origin?.full_label || label;
  const river = origin?.river || 'Catchment';
  const catchment = rainfallPayload?.catchments?.[origin?.id] || null;
  const stationCount = catchment?.station_count ?? (Array.isArray(origin?.tbr_station_ids) ? origin.tbr_station_ids.length : 0);

  if (!rainfallPayload) {
    const primaryText = `🌧️ ${label}: — (24h)`;
    const subText = 'Rainfall feed unavailable';
    return {
      hasLive: false,
      primaryText,
      subText,
      ariaLabel: `${fullLabel} (${river}) upland rainfall origin: ${subText}. Click to inspect headwater river gauge.`,
      tooltip: `${fullLabel} (${river})\nRainfall feed unavailable (awaiting /api/rainfall)`
    };
  }

  if (!catchment || catchment.all_stale || catchment.active_station_count === 0) {
    const primaryText = `🌧️ ${label}: — (24h)`;
    const subText = `Awaiting live gauge sync (0/${stationCount})`;
    return {
      hasLive: false,
      primaryText,
      subText,
      ariaLabel: `${fullLabel} (${river}) upland rainfall origin: awaiting live gauge sync. Click to inspect headwater river gauge.`,
      tooltip: `${fullLabel} (${river})\n0 of ${stationCount} TBR gauges currently live (stale or empty).`
    };
  }

  const mean24 = (typeof catchment.mean_24h_mm === 'number' && Number.isFinite(catchment.mean_24h_mm))
    ? catchment.mean_24h_mm
    : 0;
  const mean1 = (typeof catchment.mean_1h_mm === 'number' && Number.isFinite(catchment.mean_1h_mm))
    ? catchment.mean_1h_mm
    : 0;
  const mean6 = (typeof catchment.mean_6h_mm === 'number' && Number.isFinite(catchment.mean_6h_mm))
    ? catchment.mean_6h_mm
    : 0;
  const primaryText = `🌧️ ${label}: ${mean24.toFixed(1)} mm (24h)`;
  const rateLabel = catchment.rate_label || 'Dry (0.0 mm/h)';
  const subText = `${rateLabel} • ${catchment.active_station_count}/${stationCount} live`;
  const peakNote = catchment.peak_station
    ? `\nPeak 24h: ${Number(catchment.peak_24h_mm ?? 0).toFixed(1)} mm at ${catchment.peak_station}`
    : '';

  return {
    hasLive: true,
    primaryText,
    subText,
    ariaLabel: `${fullLabel} (${river}) upland rainfall: ${mean24.toFixed(1)} mm in 24 hours, ${rateLabel}. Click to inspect headwater river gauge.`,
    tooltip: `${fullLabel} (${river})\nMeans — 1h: ${mean1.toFixed(1)} mm | 6h: ${mean6.toFixed(1)} mm | 24h: ${mean24.toFixed(1)} mm${peakNote}\nEA 15-min TBR (OGL v3.0)`
  };
}

function renderUplandRainfallLayer(uplandOrigins) {
  if (!Array.isArray(uplandOrigins) || uplandOrigins.length === 0) return '';
  let layerHTML = '<g class="upland-rainfall-layer">';

  for (const origin of uplandOrigins) {
    const anchor = origin?.svg_anchor;
    if (!anchor) continue;
    const dimmed = !isUplandOriginMatchingFilter(origin);
    const model = buildUplandRainfallBadgeModel(origin, rainfallData);
    const { x, y, w, h, connector_from: cFrom, connector_to: cTo } = anchor;

    if (cFrom && cTo) {
      layerHTML += `
        <path d="M ${cFrom.x} ${cFrom.y} L ${cTo.x} ${cTo.y}"
              class="upland-rainfall-connector ${dimmed ? 'dimmed' : ''}"
              stroke="rgba(99, 102, 241, 0.45)"
              stroke-width="1.5"
              stroke-dasharray="3, 3"
              fill="none"
              marker-end="url(#arrow-rainfall)"
              aria-hidden="true"
              pointer-events="none" />
      `;
    }

    const hitY = Math.min(y, y - (44 - h) / 2);
    const hitH = Math.max(44, h + 6);
    layerHTML += `
      <g class="upland-rainfall-badge ${dimmed ? 'dimmed' : ''}"
         data-origin-id="${escapeAttr(origin.id)}"
         data-target-node="${escapeAttr(origin.entry_node_id)}"
         tabindex="0"
         role="button"
         aria-label="${escapeAttr(model.ariaLabel)}">
        <title>${escapeHTML(model.tooltip)}</title>
        <rect x="${x - 4}" y="${hitY}" width="${w + 8}" height="${hitH}" fill="transparent" pointer-events="all" />
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"
              class="upland-badge-rect"
              fill="rgba(30, 27, 75, 0.7)"
              stroke="rgba(99, 102, 241, 0.4)"
              stroke-width="1.4" />
        <text x="${x + w / 2}" y="${y + 16}"
              text-anchor="middle"
              fill="#f8fafc"
              font-size="9.5"
              font-weight="700"
              letter-spacing="0.01em"
              pointer-events="none">${escapeHTML(model.primaryText)}</text>
        <text x="${x + w / 2}" y="${y + 31}"
              text-anchor="middle"
              fill="#c7d2fe"
              font-size="7.8"
              font-weight="500"
              pointer-events="none">${escapeHTML(model.subText)}</text>
      </g>
    `;
  }

  layerHTML += '</g>';
  return layerHTML;
}

/**
 * Resolves the primary correlated upland tipping-bucket raingauge (TBR) for a river station node.
 *
 * @param {string} nodeId
 * @param {object|null|undefined} rainfallPayload
 * @param {Record<string, object>} [registry=RAINGAUGE_REGISTRY]
 * @returns {{ station: object, peerCount: number, peers: Array<object> }|null}
 */
export function resolveCorrelatedUplandTbr(nodeId, rainfallPayload, registry = RAINGAUGE_REGISTRY) {
  if (!nodeId) return null;
  const sourceStations = Array.isArray(rainfallPayload?.stations) && rainfallPayload.stations.length > 0
    ? rainfallPayload.stations
    : Object.values(registry || {});

  const candidates = sourceStations.filter(
    st => st && st.correlated_river_station_id === nodeId && st.pillar === 'upland'
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const aLive = !a.is_stale && (a.valid_reading_count ?? 0) > 0 ? 1 : 0;
    const bLive = !b.is_stale && (b.valid_reading_count ?? 0) > 0 ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const a24 = typeof a.last_24h_mm === 'number' ? a.last_24h_mm : 0;
    const b24 = typeof b.last_24h_mm === 'number' ? b.last_24h_mm : 0;
    if (a24 !== b24) return b24 - a24;
    return 0;
  });

  return {
    station: sorted[0],
    peerCount: sorted.length - 1,
    peers: sorted.slice(1)
  };
}

function getHyetographBarColor(rainfallMm) {
  if (typeof rainfallMm !== 'number' || !Number.isFinite(rainfallMm) || rainfallMm <= 0) {
    return PRECIPITATION_PALETTE.DRY.hex;
  }
  return classifyRainfallIntensity(rainfallMm * 4).color_hex;
}

/**
 * Renders an interactive discrete-bar TBR hyetograph SVG (with cumulative mass curve)
 * using the orthogonal indigo/violet PRECIPITATION_PALETTE.
 *
 * @param {object|null|undefined} tbrStation
 * @returns {string}
 */
export function renderInspectorHyetograph(tbrStation) {
  const series = Array.isArray(tbrStation?.series_15min) ? tbrStation.series_15min : [];
  if (series.length === 0) {
    const msg = tbrStation?.is_stale
      ? 'Awaiting live 15-min TBR readings (stale or empty)'
      : 'No 24h precipitation tips recorded';
    return `<div style="padding:0.75rem; text-align:center; color:#c7d2fe; font-size:0.76rem;">${escapeHTML(msg)}</div>`;
  }

  const width = 300;
  const height = 88;
  const marginTop = 10;
  const marginBottom = 14;
  const marginLeft = 6;
  const marginRight = 44;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;

  const safeMm = (pt) => (pt && typeof pt.rainfall_mm === 'number' && Number.isFinite(pt.rainfall_mm) && pt.rainfall_mm > 0 ? pt.rainfall_mm : 0);
  const safeCum = (pt) => (pt && typeof pt.cumulative_mm === 'number' && Number.isFinite(pt.cumulative_mm) && pt.cumulative_mm >= 0 ? pt.cumulative_mm : 0);

  const maxIntervalMm = series.reduce((m, pt) => Math.max(m, safeMm(pt)), 0.4);
  const maxCumMm = series.reduce((m, pt) => Math.max(m, safeCum(pt)), 0.4);
  const count = series.length;
  const stepW = drawWidth / Math.max(1, count);
  const barW = Math.max(1.5, stepW - 0.6);

  let barsHTML = '';
  const cumPts = [];
  const compactSeries = [];

  for (let i = 0; i < count; i++) {
    const pt = series[i];
    const mm = safeMm(pt);
    const cum = safeCum(pt);
    const barX = marginLeft + i * stepW;
    const barH = mm > 0 ? Math.max(2, (mm / maxIntervalMm) * drawHeight) : 1;
    const barY = height - marginBottom - barH;
    const fill = getHyetographBarColor(mm);

    barsHTML += `<rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${fill}" rx="0.6" />`;

    const centerX = barX + barW / 2;
    const cumY = height - marginBottom - ((cum / maxCumMm) * drawHeight);
    cumPts.push(`${centerX.toFixed(1)},${cumY.toFixed(1)}`);
    compactSeries.push({
      t: pt?.timestamp || '',
      mm: Number(mm.toFixed(2)),
      cum: Number(cum.toFixed(2))
    });
  }

  const serialized = escapeAttr(JSON.stringify(compactSeries));
  const stationLabel = escapeAttr(tbrStation.ea_label || tbrStation.name || tbrStation.id || 'Upland TBR');

  return `
    <div class="hyetograph-wrapper"
         tabindex="0"
         role="region"
         aria-label="${stationLabel} 24h hyetograph. Use Left and Right Arrow keys to inspect 15-minute rainfall intervals.">
      <svg class="inspector-hyetograph-svg"
           viewBox="0 0 ${width} ${height}"
           preserveAspectRatio="none"
           data-series="${serialized}"
           data-max-mm="${maxIntervalMm}">
        <line x1="${marginLeft}" y1="${marginTop}" x2="${width - marginRight}" y2="${marginTop}" stroke="rgba(129, 140, 248, 0.25)" stroke-dasharray="3 3" />
        <line x1="${marginLeft}" y1="${height - marginBottom}" x2="${width - marginRight}" y2="${height - marginBottom}" stroke="rgba(129, 140, 248, 0.35)" />
        ${barsHTML}
        <polyline fill="none" stroke="${PRECIPITATION_PALETTE.CUMULATIVE_LINE.hex}" stroke-width="1.4" stroke-opacity="0.75" points="${cumPts.join(' ')}" />
        <text x="${width - marginRight + 4}" y="${marginTop + 4}" fill="#c7d2fe" font-size="8" font-family="monospace">${maxIntervalMm.toFixed(1)}mm</text>
        <text x="${width - marginRight + 4}" y="${height - marginBottom}" fill="#94a3b8" font-size="8" font-family="monospace">0.0mm</text>
        <line class="hyetograph-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" />
        <circle class="hyetograph-dot-highlight" cx="0" cy="0" r="3.5" />
        <rect class="hyetograph-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${height}" fill="transparent" style="touch-action:none; cursor:crosshair;" />
      </svg>
      <div class="hyetograph-tooltip"></div>
    </div>
  `;
}

function formatHyetographTime(isoStr) {
  if (!isoStr) return 'Unknown';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return String(isoStr);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${day} ${mon} ${hh}:${mm} UTC`;
}

/**
 * Binds pointer, touch, and keyboard scrubbing on an inspector hyetograph wrapper.
 *
 * @param {HTMLElement} container
 * @param {object} [options={}]
 */
export function bindInspectorHyetographEvents(container, options = {}) {
  const wrapper = container?.querySelector?.('.hyetograph-wrapper');
  const svg = wrapper?.querySelector?.('svg.inspector-hyetograph-svg');
  const overlay = wrapper?.querySelector?.('.hyetograph-touch-overlay');
  if (!wrapper || !svg || !overlay) return;

  let series = [];
  try {
    series = JSON.parse(svg.dataset.series || '[]');
  } catch (_) {
    series = [];
  }
  if (!Array.isArray(series) || series.length === 0) return;

  const maxMm = parseFloat(svg.dataset.maxMm || '1') || 1;
  const width = 300;
  const height = 88;
  const marginTop = 10;
  const marginBottom = 14;
  const marginLeft = 6;
  const marginRight = 44;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;

  const crosshair = svg.querySelector('.hyetograph-crosshair');
  const dot = svg.querySelector('.hyetograph-dot-highlight');
  const tooltip = wrapper.querySelector('.hyetograph-tooltip');
  let activeIdx = null;
  let clearTimer = null;

  const setActive = (idx) => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    if (idx === null || idx < 0 || idx >= series.length) {
      activeIdx = null;
      wrapper.classList.remove('crosshair-active');
      if (options.refreshController) options.refreshController.setScrubbing(false);
      return;
    }
    activeIdx = idx;
    wrapper.classList.add('crosshair-active');
    if (options.refreshController) options.refreshController.setScrubbing(true);

    const pt = series[idx];
    const ptMm = pt && typeof pt.mm === 'number' && Number.isFinite(pt.mm) && pt.mm > 0 ? pt.mm : 0;
    const ptCum = pt && typeof pt.cum === 'number' && Number.isFinite(pt.cum) && pt.cum >= 0 ? pt.cum : 0;
    const stepW = drawWidth / Math.max(1, series.length);
    const targetX = marginLeft + idx * stepW + stepW / 2;
    const barH = ptMm > 0 ? Math.max(2, (ptMm / maxMm) * drawHeight) : 0;
    const targetY = height - marginBottom - barH;

    if (crosshair) {
      crosshair.setAttribute('x1', targetX.toFixed(1));
      crosshair.setAttribute('x2', targetX.toFixed(1));
    }
    if (dot) {
      dot.setAttribute('cx', targetX.toFixed(1));
      dot.setAttribute('cy', targetY.toFixed(1));
    }
    if (tooltip) {
      tooltip.innerText = `${formatHyetographTime(pt?.t)} • ${ptMm.toFixed(1)}mm (Sum ${ptCum.toFixed(1)}mm)`;
      const rawPct = (targetX / width) * 100;
      const wrapperW = wrapper.clientWidth || 0;
      const tipW = tooltip.offsetWidth || 0;
      if (wrapperW > 0 && tipW > 0) {
        const centerPx = (targetX / width) * wrapperW;
        const maxLeft = Math.max(0, wrapperW - tipW);
        const clampedPx = Math.max(0, Math.min(maxLeft, centerPx - tipW / 2));
        tooltip.style.left = `${clampedPx.toFixed(1)}px`;
        tooltip.style.right = 'auto';
        tooltip.style.transform = 'none';
      } else if (rawPct <= 25) {
        tooltip.style.left = '0';
        tooltip.style.right = 'auto';
        tooltip.style.transform = 'none';
      } else if (rawPct >= 75) {
        tooltip.style.left = 'auto';
        tooltip.style.right = '0';
        tooltip.style.transform = 'none';
      } else {
        tooltip.style.left = `${rawPct.toFixed(1)}%`;
        tooltip.style.right = 'auto';
        tooltip.style.transform = 'translateX(-50%)';
      }
    }
  };

  const handlePointer = (e) => {
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    if (typeof clientX !== 'number') return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relX = ((clientX - rect.left) / rect.width) * width;
    const ratio = Math.max(0, Math.min(1, (relX - marginLeft) / drawWidth));
    const idx = Math.min(series.length - 1, Math.max(0, Math.floor(ratio * series.length)));
    setActive(idx);
  };

  overlay.addEventListener('pointermove', handlePointer);
  overlay.addEventListener('touchmove', handlePointer, { passive: true });
  overlay.addEventListener('pointerleave', () => {
    clearTimer = setTimeout(() => setActive(null), 1200);
  });
  wrapper.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive(activeIdx === null ? series.length - 1 : Math.max(0, activeIdx - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActive(activeIdx === null ? 0 : Math.min(series.length - 1, activeIdx + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(series.length - 1);
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  });
}

// Auto-boot if in browser context
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initTopology();
    });
  } else {
    initTopology();
  }
}

