import { evaluateSpillway, evaluateGateState, aggregateGlobalStatus, evaluatePumpStatus, evaluateSowyChannel, estimateClyseFlow, evaluateAthelneySpillway, evaluateGravityClyse, evaluateBeerWall, evaluateOathLock, evaluateDunballEmergencyPumping, getSeasonalRegime, getActiveCrestHeight } from './hydro_engine.js';

let hydroConfig = null;

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

export async function initApp() {
  try {
    const res = await fetch('./js/config/hydro_config.json');
    hydroConfig = await res.json();
  } catch (err) {
    console.warn("Using default hydro_config", err);
  }

  setupModalListeners();
  setupPeriodListeners();
  await refreshLiveDashboard();
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

function setupPeriodListeners() {
  const buttons = document.querySelectorAll('.preset-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentActiveRange = btn.getAttribute('data-range') || '24h';
      await refreshLiveDashboard();
    });
  });
}

async function fetchAllTelemetryFromDB(range = currentActiveRange) {
  try {
    const endpoint = range === '24h' ? './api/status' : `./api/history?range=${range}`;
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
  const container = document.getElementById('cards-container');
  if (!container) return;

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
      eaPill.innerText = `📡 Telemetry: ${ageStr}`;
      eaPill.classList.remove('freshness-fresh', 'freshness-warning', 'freshness-stale');
      if (diffMins <= 45) {
        eaPill.classList.add('freshness-fresh');
      } else if (diffMins <= 90) {
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
        "52163-level-tidal_level-i-15_min-mAOD": "Dunball Tidal Parrett"
      };

      matrixBody.innerHTML = Object.entries(measuresSummary).map(([measureId, timeStr]) => {
        const name = STATION_NAMES[measureId] || measureId;
        const time = timeStr ? new Date(timeStr) : null;
        const timeFormatted = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const diffMins = time ? Math.max(0, Math.floor((Date.now() - time.getTime()) / 60000)) : 999;
        const ageFormatted = diffMins < 60 ? `${diffMins}m ago` : `${(diffMins/60).toFixed(1)}h ago`;
        const statusBadge = diffMins <= 45 ? 
          '<span class="badge badge-secure">🟢 FRESH</span>' : 
          (diffMins <= 90 ? '<span class="badge badge-warning">🟡 LAGGING</span>' : '<span class="badge badge-danger">🔴 STALE</span>');

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
      { name: "Hookbridge Spillway (Curry Moor)", config: hydroConfig.moors.curry_moor?.spillway, fallback: 7.45 },
      { name: "Athelney Spillway (Tone/Curry Moor)", config: hydroConfig.moors.curry_moor?.athelney_spillway, fallback: 7.35 },
      { name: "Baltmoor Wall Crest (Northmoor)", config: hydroConfig.moors.northmoor?.spillway, fallback: 7.80 },
      { name: "Beer Wall / Allens Spillway", config: hydroConfig.moors.northmoor?.beer_wall, fallback: 7.30 }
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

  const cmRiverLevel = cmRiverReadings && cmRiverReadings.length ? cmRiverReadings[0].value : 4.50;
  const cmMoorLevel = cmMoorReadings && cmMoorReadings.length ? cmMoorReadings[0].value : 4.46;

  // 2. Northmoor & Saltmoor Live Data (Baltmoor Wall Saltmoor 52158 & Northmoor Drain 52159)
  const nmRiverReadings = (dbMeasures && dbMeasures["52158-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52158-level-stage-i-15_min-mAOD");
  const nmMoorReadings = (dbMeasures && dbMeasures["52159-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52159-level-stage-i-15_min-mAOD");

  const nmRiverLevel = nmRiverReadings && nmRiverReadings.length ? nmRiverReadings[0].value : 3.78;
  const nmMoorLevel = nmMoorReadings && nmMoorReadings.length ? nmMoorReadings[0].value : 3.10;

  // 3. Monk's Leaze / Sowy Relief Channel Live Data (52233 Upstream & 52234 Downstream Sowy)
  const monksUpReadings = (dbMeasures && dbMeasures["52233-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("52233-level-stage-i-15_min-mAOD");
  const monksDownReadings = (dbMeasures && dbMeasures["52234-level-downstage-i-15_min-mAOD"]) || await fetchEAReadings("52234-level-downstage-i-15_min-mAOD");

  const monksUpLevel = monksUpReadings && monksUpReadings.length ? monksUpReadings[0].value : 6.757;
  const monksDownLevel = monksDownReadings && monksDownReadings.length ? monksDownReadings[0].value : 6.729;

  // 4. Dunball Outfall Live Data (E9094 Inland & 52163 Sea Tidal)
  const dunballInlandReadings = (dbMeasures && dbMeasures["E9094-level-stage-i-15_min-mAOD"]) || await fetchEAReadings("E9094-level-stage-i-15_min-mAOD");
  const seaReadings = (dbMeasures && dbMeasures["52163-level-tidal_level-i-15_min-mAOD"]) || await fetchEAReadings("52163-level-tidal_level-i-15_min-mAOD");

  const dunballInland = dunballInlandReadings && dunballInlandReadings.length ? dunballInlandReadings[0].value : 2.64;
  const dunballSea = seaReadings && seaReadings.length ? seaReadings[0].value : 1.09;

  // Build trend histories according to selected lookback period (24h, 7d, 30d)
  const rangeLimitMap = { '24h': 96, '7d': 672, '30d': 2688 };
  const maxLimit = rangeLimitMap[currentActiveRange] || 96;

  const extractHistory = (items) => {
    if (!items || items.length === 0) return [];
    let sliced = items.slice(0, maxLimit).map(i => ({ value: i.value, time: i.dateTime }));
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

  container.innerHTML = '';

  const evals = [];

  // Card 1: Curry Moor
  const hookbridgeConfig = hydroConfig?.moors?.curry_moor?.spillway;
  const hookbridgeCrest = getActiveCrestHeight(hookbridgeConfig, new Date(), 7.45);
  const hookbridgeHist = hookbridgeConfig?.crest_history || [];
  const hookbridgeScheme = hookbridgeHist.length ? hookbridgeHist[hookbridgeHist.length - 1].notes : 'EA Survey Baseline';

  const cmEval = evaluateSpillway(cmRiverLevel, cmMoorLevel, hookbridgeCrest);
  cmEval.name = "Curry Moor System";
  evals.push(cmEval);

  const currymoorPump = getPumpEvaluation('currymoor_ps', cmMoorLevel, 'curry_moor', 'Currymoor PS', 2);
  const stanmoorPump = getPumpEvaluation('stanmoor_ps', cmMoorLevel, 'curry_moor', 'Stanmoor PS', 2);

  const athelneyConfig = hydroConfig?.moors?.curry_moor?.athelney_spillway;
  const athelneyCrest = getActiveCrestHeight(athelneyConfig, new Date(), 7.35);
  const athelneySpillway = evaluateAthelneySpillway(cmRiverLevel, athelneyCrest);
  const cmGravitySluice = evaluateGravityClyse(cmMoorLevel, cmRiverLevel, "Currymoor Sluice");

  container.appendChild(createMoorCard({
    title: "Curry Moor System",
    riverTag: `Catchment: River Tone (${regime.label})`,
    eval: cmEval,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `${cmRiverLevel.toFixed(2)}m AOD`,
    clearanceText: cmEval.clearanceText,
    narrative: `Curry Moor Basin level is ${cmMoorLevel.toFixed(2)}m AOD (${isSummerRegime ? 'normal summer target 4.30-4.45m' : 'winter target 3.40-3.80m'}). ${cmEval.narrative}`,
    pills: [
      {
        html: `<strong>Curry Moor Spillway:</strong> ${cmEval.symbol} ${cmEval.label} (${cmEval.clearanceText}) <a href="https://thecfh.org/parretttonewsom.php#hook" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#hook" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Hookbridge Spillway">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Hookbridge Crest: ${hookbridgeCrest.toFixed(2)}m AOD (${hookbridgeScheme}) | View 3-min EA Snapshot Camera at thecfh.org#hook`
      },
      {
        html: `<strong>Athelney Spillway:</strong> ${athelneySpillway.statusText} <a href="https://thecfh.org/parretttonewsom.php#athelneyspillway" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#athelneyspillway" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Athelney Spillway">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Athelney Crest: ${athelneyCrest.toFixed(2)}m AOD (Standard Profile) | View 3-min EA Snapshot Camera at thecfh.org#athelneyspillway`
      },
      `<strong>Currymoor Gravity Sluice:</strong> ${cmGravitySluice.statusText}`,
      {
        html: `<strong>Currymoor PS:</strong> ${currymoorPump.statusText} <a href="https://thecfh.org/parretttonewsom.php#currymoor" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#currymoor" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Currymoor PS">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Currymoor Pumping Station | View 3-min EA Snapshot Camera at thecfh.org#currymoor`
      },
      `<strong>Stanmoor PS:</strong> ${stanmoorPump.statusText}`
    ],
    spillwayMeta: { crest: hookbridgeCrest.toFixed(2), scheme: hookbridgeScheme },
    sparkline: renderSingleSparkline(cmRiverHistory, cmEval.code === 'OVERTOPPING' ? '#f87171' : '#4ade80', { streamLabel: 'River Tone @ Currymoor PS', stationId: '52118', unit: 'mAOD' }),
    pumpGauge: renderPumpTriggerGauge(currymoorPump),
    gauges: [
      { name: "River Tone (Currymoor PS)", id: "52118", value: `${cmRiverLevel.toFixed(2)}m AOD`, history: cmRiverHistory, color: "#4ade80", link: "https://check-for-flooding.service.gov.uk/station/3073" },
      { name: "Curry Moor Basin", id: "52127", value: `${cmMoorLevel.toFixed(2)}m AOD`, history: cmMoorHistory, color: "#38bdf8", link: "https://check-for-flooding.service.gov.uk/station/3064" }
    ],
    extLinks: [
      { label: "📷 Live Curry Moor Webcams (thecfh.org#hook) ↗", url: "https://thecfh.org/parretttonewsom.php#hook" },
      { label: "📊 GOV.UK Tone Stage (3073) ↗", url: "https://check-for-flooding.service.gov.uk/station/3073" },
      { label: "📊 GOV.UK Moor Stage (3064) ↗", url: "https://check-for-flooding.service.gov.uk/station/3064" },
      { label: "EA Data (52118) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52118.html" },
      { label: "📄 EA Trigger Plan ↗", url: "https://www.gov.uk/guidance/somerset-levels-and-moors-reducing-the-risk-of-flooding#trigger-point-plan" }
    ]
  }));

  // Card 2: Northmoor & Saltmoor
  const baltmoorConfig = hydroConfig?.moors?.northmoor?.spillway;
  const baltmoorCrest = getActiveCrestHeight(baltmoorConfig, new Date(), 7.80);
  const baltmoorHist = baltmoorConfig?.crest_history || [];
  const baltmoorScheme = baltmoorHist.length ? baltmoorHist[baltmoorHist.length - 1].notes : 'Post-2014 EA Levee Strengthening';
  const nmEval = evaluateSpillway(nmRiverLevel, nmMoorLevel, baltmoorCrest);
  nmEval.name = "Northmoor & Saltmoor";
  evals.push(nmEval);

  const saltmoorPump = getPumpEvaluation('saltmoor_ps', nmMoorLevel, 'northmoor', 'Saltmoor PS', 2);
  const northmoorPump = getPumpEvaluation('northmoor_ps', nmMoorLevel, 'northmoor', 'Northmoor PS', 2);

  const nmGravitySluice = evaluateGravityClyse(nmMoorLevel, nmRiverLevel, "Northmoor Sluice");
  const beerWallConfig = hydroConfig?.moors?.northmoor?.beer_wall;
  const beerWallCrest = getActiveCrestHeight(beerWallConfig, new Date(), 7.30);
  const beerWallHist = beerWallConfig?.crest_history || [];
  const beerWallScheme = beerWallHist.length ? beerWallHist[beerWallHist.length - 1].notes : 'SRA Greylake Scheme';
  const beerWallSpillway = evaluateBeerWall(nmRiverLevel, beerWallCrest);

  container.appendChild(createMoorCard({
    title: "Northmoor & Saltmoor",
    riverTag: `Catchment: River Parrett (${regime.label})`,
    eval: nmEval,
    provenanceTag: "⚡ LEVEL SOP MODEL",
    provenanceClass: "prov-medium",
    metricText: `${nmRiverLevel.toFixed(2)}m AOD`,
    clearanceText: `Baltmoor Wall: ${nmEval.clearanceText}`,
    narrative: `Baltmoor Wall Saltmoor Barrier sensor live. Levels monitored relative to 7.80m crest.`,
    pills: [
      {
        html: `<strong>Baltmoor Wall Spillway:</strong> ${nmEval.symbol} ${nmEval.label} (${nmEval.clearanceText}) <a href="https://thecfh.org/parretttonewsom.php#saltmoor" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#saltmoor" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Baltmoor Wall">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Baltmoor Wall Crest: ${baltmoorCrest.toFixed(2)}m AOD (${baltmoorScheme}) | View 3-min EA Snapshot Camera at thecfh.org#saltmoor`
      },
      {
        html: `<strong>Beer Wall / Allens Spillway:</strong> ${beerWallSpillway.statusText} <a href="https://thecfh.org/parretttonewsom.php#Beerwall" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#Beerwall" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Beer Wall Spillway">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Beer Wall Crest: ${beerWallCrest.toFixed(2)}m AOD (${beerWallScheme}) | View 3-min EA Snapshot Camera at thecfh.org#Beerwall`
      },
      `<strong>Northmoor Gravity Clyse:</strong> ${nmGravitySluice.statusText}`,
      {
        html: `<strong>Saltmoor PS:</strong> ${saltmoorPump.statusText} <a href="https://thecfh.org/parretttonewsom.php#saltmoor" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#saltmoor" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Saltmoor PS">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Saltmoor Pumping Station | View 3-min EA Snapshot Camera at thecfh.org#saltmoor`
      },
      {
        html: `<strong>Northmoor PS:</strong> ${northmoorPump.statusText} <a href="https://thecfh.org/parretttonewsom.php#northmoor" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#northmoor" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Northmoor PS">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Northmoor Pumping Station | View 3-min EA Snapshot Camera at thecfh.org#northmoor`
      }
    ],
    spillwayMeta: { crest: baltmoorCrest.toFixed(2), scheme: baltmoorScheme },
    sparkline: renderSingleSparkline(nmRiverHistory, nmEval.code === 'OVERTOPPING' ? '#f87171' : '#4ade80', { streamLabel: 'Baltmoor Wall Barrier', stationId: '52158', unit: 'mAOD' }),
    pumpGauge: renderPumpTriggerGauge(saltmoorPump),
    gauges: [
      { name: "Baltmoor Wall Saltmoor Barrier", id: "52158", value: `${nmRiverLevel.toFixed(2)}m AOD`, history: nmRiverHistory, color: "#4ade80", link: "https://check-for-flooding.service.gov.uk/station/3400" },
      { name: "Northmoor Main Drain", id: "52159", value: `${nmMoorLevel.toFixed(2)}m AOD`, history: nmMoorHistory, color: "#38bdf8", link: "https://check-for-flooding.service.gov.uk/station/3415" }
    ],
    extLinks: [
      { label: "📷 Live Saltmoor & Northmoor Webcams (thecfh.org#saltmoor) ↗", url: "https://thecfh.org/parretttonewsom.php#saltmoor" },
      { label: "📊 GOV.UK Wall Stage (3400) ↗", url: "https://check-for-flooding.service.gov.uk/station/3400" },
      { label: "📊 GOV.UK Drain Stage (3415) ↗", url: "https://check-for-flooding.service.gov.uk/station/3415" },
      { label: "EA Data (52158) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/52158.html" }
    ]
  }));

  // Card 3: Sowy Relief Channel
  const sowyEval = evaluateSowyChannel(monksUpLevel, dunballInland, 4.20);
  const headDropMeters = monksUpLevel - monksDownLevel;
  const headDropFormatted = formatHeadDelta(headDropMeters);
  const oathLock = evaluateOathLock(monksUpLevel, monksDownLevel);

  container.appendChild(createMoorCard({
    title: "Sowy Relief Channel",
    riverTag: `Diverts: Parrett ➔ Sedgemoor Drain (${regime.label})`,
    eval: sowyEval,
    provenanceTag: "📡 DEDICATED SENSORS",
    provenanceClass: "prov-high",
    metricText: `Sowy Level: ${monksDownLevel.toFixed(2)}m AOD`,
    clearanceText: `Head Drop Across Clyse: ${headDropFormatted} (${monksUpLevel.toFixed(3)}m ➔ ${monksDownLevel.toFixed(3)}m)`,
    narrative: `Monk's Leaze Clyse open. Upstream level (${monksUpLevel.toFixed(2)}m) and downstream Sowy level (${monksDownLevel.toFixed(2)}m) indicate active diversion at ~${estimateClyseFlow(monksUpLevel, monksDownLevel).flowM3s.toFixed(1)} m³/s.`,
    pills: [
      {
        html: `<strong>Monk's Leaze Clyse:</strong> ${sowyEval.pillText} <a href="https://thecfh.org/parretttonewsom.php#monksleaze" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#monksleaze" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Monk's Leaze Clyse">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Monk's Leaze Sill: 4.20m AOD | View 3-min EA Snapshot Camera at thecfh.org#monksleaze`
      },
      `<strong>Monk's Leaze Intake Differential:</strong> 🟢 ${headDropFormatted} Head Drop (Parrett ➔ Sowy)`,
      {
        html: `<strong>Oath Lock Penning Sluice:</strong> ${oathLock.statusText} <a href="https://thecfh.org/parretttonewsom.php#oath" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#oath" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Oath Lock Penning Sluice">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Oath Lock Penning Structure | View 3-min EA Snapshot Camera at thecfh.org#oath`
      },
      `<strong>Beer Wall Intake (Greylake):</strong> ${monksDownLevel >= 6.00 ? '🟢 CONVEYANCE TO KSD' : '⚪ PENNING LEVEL'}`
    ],
    sparkline: renderSingleSparkline(monksDownHistory, '#38bdf8', { streamLabel: 'Monk\'s Leaze Downstream Sowy', stationId: '52234', unit: 'mAOD' }),
    gauges: [
      { name: "Monk's Leaze River Level", id: "52233", value: `${monksUpLevel.toFixed(2)}m AOD`, history: monksUpHistory, color: "#4ade80", link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html" },
      { name: "Monk's Leaze Downstream Sowy", id: "52234", value: `${monksDownLevel.toFixed(2)}m AOD`, history: monksDownHistory, color: "#38bdf8", link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52234.html" }
    ],
    extLinks: [
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

  container.appendChild(createMoorCard({
    title: "Dunball Sea Outfall",
    riverTag: `Outfall: Sedgemoor Drain ➔ Parrett Estuary (${regime.label})`,
    eval: isTideLocked ? 
      { label: "TIDE-LOCKED", badgeClass: "badge-tide-locked", symbol: "🕒" } :
      { label: "DISCHARGING", badgeClass: "badge-secure", symbol: "✓" },
    provenanceTag: "⚖️ HYDROSTATIC LAW",
    provenanceClass: "prov-high",
    metricText: `Sea Tide: ${dunballSea.toFixed(2)}m AOD`,
    clearanceText: `Inland Drain: ${dunballInland.toFixed(2)}m AOD`,
    narrative: isTideLocked ? 
      `High sea tide in Parrett Estuary (${dunballSea.toFixed(2)}m) exceeds inland drain (${dunballInland.toFixed(2)}m). Passive flap doors shut under reverse hydrostatic pressure.` :
      `Seawater level below inland drain. Positive head differential opens flap doors for gravity discharge.`,
    pills: [
      {
        html: `<strong>Dunball Flap Doors:</strong> ${isTideLocked ? '🔴 TIDE-LOCKED (SEA HEAD)' : '🟢 GRAVITY DISCHARGING'} <a href="https://thecfh.org/parretttonewsom.php#dunball" target="_blank" rel="noopener noreferrer" class="cctv-badge-btn" title="View 3-min EA Snapshot Camera at thecfh.org#dunball" aria-label="View 3-min EA Snapshot Camera at thecfh.org for Dunball Outfall">📷 LIVE CAM ↗</a>`,
        tooltip: `📍 Dunball Primary Clyse Outfall | View 3-min EA Snapshot Camera at thecfh.org#dunball`
      },
      `<strong>Dunball Penstock Barrier:</strong> ${isTideLocked ? '🔒 PENNING / SURGE SEALED' : '🟢 OPEN FOR DISCHARGE'}`,
      `<strong>Emergency High-Volume Pumps:</strong> ${dunballEmergencyPump.statusText}`
    ],
    sparkline: renderDualSparkline(seaHistory, inlandHistory, isTideLocked),
    pumpGauge: renderPumpTriggerGauge(dunballPumpGaugeEval),
    gauges: [
      { name: "Dunball Tidal Parrett", id: "52163", value: `${dunballSea.toFixed(2)}m AOD`, history: seaHistory.map(h => h.value), color: "#fb923c", link: "https://check-for-flooding.service.gov.uk/station/9129" },
      { name: "Dunball Inland KSD", id: "E9094", value: `${dunballInland.toFixed(2)}m AOD`, history: inlandHistory.map(h => h.value), color: "#38bdf8", link: "https://check-for-flooding.service.gov.uk/station/9499" }
    ],
    extLinks: [
      { label: "📷 Live Dunball Webcams (thecfh.org#dunball) ↗", url: "https://thecfh.org/parretttonewsom.php#dunball" },
      { label: "📊 GOV.UK KSD Stage (9499) ↗", url: "https://check-for-flooding.service.gov.uk/station/9499" },
      { label: "📊 GOV.UK Tidal Stage (9129) ↗", url: "https://check-for-flooding.service.gov.uk/station/9129" },
      { label: "EA Data (E9094) ↗", url: "https://environment.data.gov.uk/flood-monitoring/id/stations/E9094.html" }
    ]
  }));

  // Global Status Banner Render
  const globalStat = aggregateGlobalStatus(evals, isTideLocked);
  const counterPillElem = document.getElementById('counter-pill');
  if (counterPillElem) counterPillElem.innerText = globalStat.counterPill;

  const alertBannerElem = document.getElementById('alert-banner');
  if (alertBannerElem) alertBannerElem.innerText = globalStat.bannerText;

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const updatedPill = document.getElementById('updated-at-pill');
  if (updatedPill) {
    updatedPill.innerHTML = `⏱️ Synced ${timeStr}`;
  }

  // Bind synchronized crosshair & tooltip event listeners across all cards
  bindSparklineEvents(container);
}

function createMoorCard(opts) {
  const card = document.createElement('div');
  card.className = 'moor-card';
  card.innerHTML = `
    <div>
      <div class="card-header">
        <div>
          <div class="card-title">${opts.title}</div>
          <div class="river-tag">${opts.riverTag}</div>
        </div>
        <div class="status-badge ${opts.eval.badgeClass}">
          <span>${opts.eval.symbol}</span>
          <span>${opts.eval.label}</span>
        </div>
      </div>
      <div class="hero-metric">${opts.metricText}</div>
      <div class="clearance-text">${opts.clearanceText}</div>
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
          <strong style="color: #38bdf8; font-family: monospace;">${opts.spillwayMeta.crest}m AOD</strong>
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
      t.mobile_order,
      t.mobile_active,
      t.critical_spill,
      isSummer
    );
  }

  // Fallback to hardcoded seasonal thresholds if hydroConfig not loaded yet
  const fallbacks = {
    currymoor_ps: {
      summer: { lead: 4.60, duty: 4.80, mobile_order: 5.10, mobile_active: 5.40, critical_spill: 7.45 },
      winter: { lead: 4.00, duty: 4.30, mobile_order: 4.40, mobile_active: 4.60, critical_spill: 4.85 }
    },
    stanmoor_ps: {
      summer: { lead: 4.70, duty: 4.90, mobile_order: 5.20, mobile_active: 5.50, critical_spill: 7.45 },
      winter: { lead: 4.10, duty: 4.40, mobile_order: 4.50, mobile_active: 4.70, critical_spill: 4.85 }
    },
    saltmoor_ps: {
      summer: { lead: 4.00, duty: 4.20, mobile_order: 4.40, mobile_active: 4.60, critical_spill: 7.80 },
      winter: { lead: 3.40, duty: 3.70, mobile_order: 3.80, mobile_active: 4.00, critical_spill: 4.25 }
    },
    northmoor_ps: {
      summer: { lead: 4.10, duty: 4.30, mobile_order: 4.50, mobile_active: 4.70, critical_spill: 7.80 },
      winter: { lead: 3.50, duty: 3.80, mobile_order: 3.90, mobile_active: 4.10, critical_spill: 4.35 }
    },
    dunball_mobile_ps: {
      summer: { lead: 3.10, duty: 3.30, mobile_order: 3.50, mobile_active: 3.70, critical_spill: 4.10 },
      winter: { lead: 2.80, duty: 3.10, mobile_order: 3.30, mobile_active: 3.50, critical_spill: 3.80 }
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

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin;

  let yMin = rawMin;
  let yMax = rawMax;

  if (rawRange < minSpan) {
    const midpoint = (rawMin + rawMax) / 2;
    yMin = midpoint - (minSpan / 2);
    yMax = midpoint + (minSpan / 2);
  }

  const effectiveRange = yMax - yMin || 1;

  const marginTop = 16;
  const marginBottom = 16;
  const marginLeft = 8;
  const marginRight = 65;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;

  const pts = values.map((p, i) => {
    const x = marginLeft + (i / (values.length - 1)) * drawWidth;
    const normalizedY = (p - yMin) / effectiveRange;
    const y = height - marginBottom - (normalizedY * drawHeight);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const topLabel = `${yMax.toFixed(2)}m`;
  const botLabel = `${yMin.toFixed(2)}m`;
  const spanText = `${currentActiveRange.toUpperCase()} Range: ${formatSpanUnit(rawRange)}`;

  const streamHeader = options.streamLabel ? 
    `<span class="stream-dot" style="background:${strokeColor}; color:${strokeColor}"></span><span class="sparkline-title">${options.streamLabel}</span> <span class="gauge-id-badge">ID: ${options.stationId}</span>` :
    `<span class="sparkline-title">${currentActiveRange.toUpperCase()} Telemetry</span>`;

  return `
    <div class="sparkline-wrapper">
      <div class="sparkline-header">
        <div class="sparkline-title-group">${streamHeader}</div>
        <span class="sparkline-span-pill" title="Actual variation range">${spanText}</span>
      </div>
      <svg class="sparkline" 
           viewBox="0 0 ${width} ${height}" 
           preserveAspectRatio="none"
           data-points='${JSON.stringify(values)}'
           data-timestamps='${JSON.stringify(timestamps)}'
           data-ymin="${yMin}"
           data-ymax="${yMax}"
           data-unit="${options.unit || 'mAOD'}">
        <line x1="${marginLeft}" y1="${marginTop}" x2="${width - marginRight + 5}" y2="${marginTop}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
        <line x1="${marginLeft}" y1="${height - marginBottom}" x2="${width - marginRight + 5}" y2="${height - marginBottom}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
        <polyline fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
        <line class="sparkline-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />
        <rect class="sparkline-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${height}" fill="transparent" />
        <g class="y-label-group" transform="translate(${width - 4}, ${marginTop + 3})">
          <rect x="-56" y="-10" width="56" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-max">${topLabel}</text>
        </g>
        <g class="y-label-group" transform="translate(${width - 4}, ${height - marginBottom + 3})">
          <rect x="-56" y="-10" width="56" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label sparkline-y-min">${botLabel}</text>
        </g>
      </svg>
      <div class="sparkline-tooltip"></div>
    </div>
  `;
}

export function renderDualSparkline(seaInput, inlandInput, isTideLocked, options = {}) {
  const seaValues = seaInput.map(p => typeof p === 'object' ? p.value : p);
  const inlandValues = inlandInput.map(p => typeof p === 'object' ? p.value : p);
  const timestamps = inlandInput.map(p => typeof p === 'object' ? p.time : '');

  const width = options.width || 300;
  const height = options.height || 75;

  const allPoints = [...seaValues, ...inlandValues];
  const rawMin = Math.min(...allPoints);
  const rawMax = Math.max(...allPoints);
  const minSpan = options.minSpan !== undefined ? options.minSpan : 1.0;

  let yMin = rawMin;
  let yMax = rawMax;
  if ((rawMax - rawMin) < minSpan) {
    const mid = (rawMin + rawMax) / 2;
    yMin = mid - (minSpan / 2);
    yMax = mid + (minSpan / 2);
  }
  const effectiveRange = yMax - yMin || 1;

  const marginTop = 16;
  const marginBottom = 16;
  const marginLeft = 8;
  const marginRight = 65;
  const drawWidth = width - marginLeft - marginRight;
  const drawHeight = height - marginTop - marginBottom;

  const mapPoints = (pts) => pts.map((p, i) => {
    const x = marginLeft + (i / (pts.length - 1)) * drawWidth;
    const normalizedY = (p - yMin) / effectiveRange;
    const y = height - marginBottom - (normalizedY * drawHeight);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const seaPts = mapPoints(seaValues);
  const inlandPts = mapPoints(inlandValues);

  // Calculate exact historical tide-lock intervals (sea level >= inland level)
  const getTideLockIntervals = (sPts, iPts) => {
    const intervals = [];
    let inLock = false;
    let startIdx = 0;
    const len = Math.min(sPts.length, iPts.length);
    for (let i = 0; i < len; i++) {
      const isLocked = sPts[i] >= iPts[i];
      if (isLocked && !inLock) {
        inLock = true;
        startIdx = i;
      } else if (!isLocked && inLock) {
        inLock = false;
        intervals.push({ start: startIdx, end: i - 1 });
      }
    }
    if (inLock) {
      intervals.push({ start: startIdx, end: len - 1 });
    }
    return intervals;
  };

  const intervals = getTideLockIntervals(seaValues, inlandValues);
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

  const streamHeader = options.streamLabel || 
    `<span class="stream-dot" style="background:#38bdf8; color:#38bdf8"></span><span class="sparkline-title">Inland KSD (E9094)</span> <span style="color:#64748b; font-size:0.65rem;">vs</span> <span class="stream-dot" style="background:#fb923c; color:#fb923c"></span><span class="sparkline-title">Sea Tide (52163)</span>`;

  return `
    <div class="sparkline-wrapper">
      <div class="sparkline-header">
        <div class="sparkline-title-group">${streamHeader}</div>
        <span class="sparkline-span-pill ${isTideLocked ? 'pill-warning' : ''}">
          ${isTideLocked ? '🔒 Tide-Locked Window' : '✓ Gravity Discharge'}
        </span>
      </div>
      <svg class="sparkline" 
           viewBox="0 0 ${width} ${height}" 
           preserveAspectRatio="none"
           data-points='${JSON.stringify(inlandValues)}'
           data-secondary-points='${JSON.stringify(seaValues)}'
           data-timestamps='${JSON.stringify(timestamps)}'
           data-ymin="${yMin}"
           data-ymax="${yMax}">
        ${tideLockHighlights}
        <line x1="${marginLeft}" y1="${marginTop}" x2="${width - marginRight + 5}" y2="${marginTop}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" />
        <line x1="${marginLeft}" y1="${height - marginBottom}" x2="${width - marginRight + 5}" y2="${height - marginBottom}" stroke="rgba(255, 255, 255, 0.15)" stroke-dasharray="3,3" />
        <polyline fill="none" stroke="#38bdf8" stroke-width="2.2" points="${inlandPts}" />
        <polyline fill="none" stroke="#fb923c" stroke-width="2.2" stroke-dasharray="4,4" points="${seaPts}" />
        <line class="sparkline-crosshair" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" />
        <circle class="sparkline-dot-halo" cx="0" cy="0" r="7" />
        <circle class="sparkline-dot-highlight" cx="0" cy="0" r="4.5" />
        <circle class="sparkline-dot-highlight-secondary" cx="0" cy="0" r="4.5" />
        <rect class="sparkline-touch-overlay" x="${marginLeft}" y="0" width="${drawWidth}" height="${height}" fill="transparent" />
        <g transform="translate(${width - 4}, ${marginTop + 3})">
          <rect x="-56" y="-10" width="56" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label">${yMax.toFixed(2)}m</text>
        </g>
        <g transform="translate(${width - 4}, ${height - marginBottom + 3})">
          <rect x="-56" y="-10" width="56" height="13" rx="2" fill="rgba(15, 23, 42, 0.75)" />
          <text x="0" y="0" text-anchor="end" class="sparkline-y-label">${yMin.toFixed(2)}m</text>
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
    const index = Math.min(
      pointsData.length - 1,
      Math.max(0, Math.round(ratio * (pointsData.length - 1)))
    );

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
      const rawTime = timestamps[index];
      const timeObj = rawTime ? new Date(rawTime) : null;
      const isValid = timeObj && !isNaN(timeObj.getTime());
      const timeStr = isValid ? timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const dateStr = isValid ? `${timeObj.getDate()} ${timeObj.toLocaleString('en-US', { month: 'short' })}` : '';
      
      let valText = '';
      if (secondaryData.length > 0 && index < secondaryData.length) {
        valText = `Inland: ${primaryVal.toFixed(2)}m | Sea: ${secondaryData[index].toFixed(2)}m`;
      } else if (svg.dataset.unit === 'm3s') {
        valText = `${primaryVal.toFixed(1)} m³/s`;
      } else {
        valText = `${primaryVal.toFixed(2)} mAOD`;
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
    const index = Math.min(timestamps.length - 1, Math.max(0, Math.round(ratio * (timestamps.length - 1))));
    const rawTime = timestamps[index];
    const timeObj = rawTime ? new Date(rawTime) : null;
    const isValid = timeObj && !isNaN(timeObj.getTime());

    banner.classList.add('active-inspection');
    if (badge) badge.innerText = '🎯 SYNCHRONIZED INSPECTION';
    if (timeDisplay && isValid) {
      const dateFormatted = timeObj.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
      const timeFormatted = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      timeDisplay.innerText = `📅 ${dateFormatted}, ${timeFormatted} GMT`;
    }
    if (ageDisplay && isValid) {
      const diffMs = Date.now() - timeObj.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      let ageStr = '';
      if (diffMins < 1) ageStr = '(Just now)';
      else if (diffMins < 60) ageStr = `(${diffMins}m ago)`;
      else {
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;
        if (h < 24) ageStr = `(${h}h ${m}m ago)`;
        else {
          const d = Math.floor(h / 24);
          const remH = h % 24;
          ageStr = `(${d}d ${remH}h ago)`;
        }
      }
      ageDisplay.innerText = ageStr;
    }
    if (syncStatus) syncStatus.innerText = '[ 4/4 MOORS SYNCED ]';
  };

  const setGlobalSparklineHover = (ratio) => {
    currentHoverRatio = ratio;
    updateGlobalTimestampBanner(ratio);
    wrappers.forEach(w => {
      if (ratio === null) {
        w.classList.remove('crosshair-active');
      } else {
        w.classList.add('crosshair-active');
        updateWrapperCrosshair(w, ratio);
      }
    });
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
      const rect = svg.getBoundingClientRect();
      const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
      const xPx = clientX - rect.left;
      const widthPx = rect.width;

      const marginLeftPx = (8 / 300) * widthPx;
      const marginRightPx = (65 / 300) * widthPx;
      const drawWidthPx = widthPx - marginLeftPx - marginRightPx;

      const relX = xPx - marginLeftPx;
      return Math.max(0, Math.min(1, relX / drawWidthPx));
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
