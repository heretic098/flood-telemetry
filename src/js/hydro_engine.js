/**
 * Hydraulic & Hydrological Physics Engine
 * Implements Villemonte Submergence Weir Model, Differential Head Gate Inference,
 * and EA Seasonal Penning Regime Rules.
 */

export function getSeasonalRegime(date = new Date()) {
  const month = date.getMonth(); // 0-indexed: 0 = Jan, 3 = Apr, 9 = Oct, 11 = Dec
  const day = date.getDate();

  let isSummer = false;
  if (month > 3 && month < 9) {
    // May, June, July, August, September
    isSummer = true;
  } else if (month === 3 && day >= 15) {
    // April 15 – April 30
    isSummer = true;
  } else if (month === 9 && day <= 15) {
    // October 1 – October 15
    isSummer = true;
  }

  return {
    isSummer,
    name: isSummer ? "Summer Penning Regime" : "Winter Flood Regime",
    icon: isSummer ? "☀️" : "❄️",
    label: isSummer ? "☀️ SUMMER PENNING REGIME (Apr 15 - Oct 15)" : "❄️ WINTER FLOOD REGIME (Oct 16 - Apr 14)"
  };
}

export function evaluateSpillway(h_river, h_moor, Z_crest) {
  const H_u = h_river - Z_crest;
  const H_d = h_moor - Z_crest;
  const freeboardMargin = 0.15; // 15cm threshold

  if (H_u < -freeboardMargin) {
    const margin = Math.abs(H_u).toFixed(2);
    return {
      code: "SECURE",
      label: "SECURE",
      badgeClass: "badge-secure",
      symbol: "✓",
      clearanceText: `+${margin}m Clearance`,
      narrative: `River level is ${margin}m below spillway crest. System is secure.`,
      severity: 5
    };
  } else if (H_u < 0) {
    const margin = Math.abs(H_u).toFixed(2);
    return {
      code: "NEAR_CREST",
      label: "NEAR CREST",
      badgeClass: "badge-near-crest",
      symbol: "▲",
      clearanceText: `${margin}m Clearance Remaining`,
      narrative: `Caution: River level is within ${Math.round(margin * 100)}cm of overtopping spillway.`,
      severity: 4
    };
  } else {
    // River level exceeds spillway crest
    if (H_d >= H_u) {
      return {
        code: "REVERSE_SPILL",
        label: "REVERSE SPILL",
        badgeClass: "badge-reverse-spill",
        symbol: "↺",
        clearanceText: `+${Math.abs(H_d - H_u).toFixed(2)}m Reverse Head`,
        narrative: "Critical Alert: Moor water level is higher than river level, spilling back into channel.",
        severity: 1
      };
    }

    const submergenceRatio = H_u > 0 ? (H_d / H_u) : 0;
    const overtopDepthCm = Math.round(H_u * 100);

    if (submergenceRatio >= 0.70) {
      return {
        code: "SUBMERGED",
        label: "SUBMERGED",
        badgeClass: "badge-submerged",
        symbol: "≈",
        clearanceText: `+${overtopDepthCm}cm over crest (Drowned)`,
        narrative: `Spillway is drowned by tailwater in moor. Overtopping at +${overtopDepthCm}cm depth with reduced discharge capacity.`,
        severity: 3
      };
    } else {
      return {
        code: "OVERTOPPING",
        label: "OVERTOPPING",
        badgeClass: "badge-overtopping",
        symbol: "▼",
        clearanceText: `+${overtopDepthCm}cm over crest`,
        narrative: `Active Spill: Water is flowing over spillway crest at +${overtopDepthCm}cm depth.`,
        severity: 2
      };
    }
  }
}

export function evaluateGateState(h_up, h_down, Z_sill) {
  const deltaH = h_up - h_down;

  if (h_down >= h_up) {
    return {
      code: "TIDE_LOCKED",
      label: "TIDE-LOCKED",
      badgeClass: "badge-tide-locked",
      symbol: "🕒",
      text: "Tide-Locked (Sea doors closed against high tide)"
    };
  } else if (deltaH >= 0.20) {
    return {
      code: "CLOSED",
      label: "CLOSED / PENNING",
      badgeClass: "badge-closed",
      symbol: "🔒",
      text: "Gate closed to stack/retain upstream water level."
    };
  } else if (deltaH >= 0.05) {
    return {
      code: "OPEN",
      label: "OPEN & DIVERTING",
      badgeClass: "badge-open",
      symbol: "➔",
      text: "Gate open, actively discharging flow."
    };
  } else {
    return {
      code: "SLACK_WATER",
      label: "SLACK WATER",
      badgeClass: "badge-open",
      symbol: "⏸️",
      text: "Equalized water level across gate."
    };
  }
}

export function aggregateGlobalStatus(moorEvaluations, isTideLocked = false) {
  const severe = moorEvaluations.filter(m => m.severity <= 2);
  const warnings = moorEvaluations.filter(m => m.severity === 3 || m.severity === 4);
  const secure = moorEvaluations.filter(m => m.severity === 5);

  const counterPill = `[ 🔴 ${severe.length} Overtopping | 🟡 ${warnings.length} Warning | 🟢 ${secure.length} Secure ]`;

  let bannerText = "";
  if (severe.length >= 2) {
    const names = severe.map(m => m.name.split(' ')[0]).join(' & ');
    bannerText = `CRITICAL: ${names.toUpperCase()} BOTH OVERTOPPING`;
  } else if (severe.length === 1) {
    bannerText = `ACTION REQUIRED: ${severe[0].name.toUpperCase()} OVERTOPPING`;
  } else if (warnings.length > 0) {
    bannerText = `WARNING: HIGH WATER IN ${warnings[0].name.toUpperCase()}`;
  } else {
    bannerText = `SYSTEM SECURE — ALL MOORS NORMAL`;
  }

  if (isTideLocked) {
    bannerText += " | DUNBALL TIDE-LOCKED";
  } else {
    bannerText += " | GRAVITY DISCHARGE ACTIVE";
  }

  return {
    counterPill,
    bannerText,
    topSeverity: severe.length > 0 ? (severe.length > 1 ? 1 : 2) : (warnings.length > 0 ? 4 : 5)
  };
}

export function evaluatePumpStatus(
  moorLevel,
  stationName,
  totalPumps = 2,
  startTrigger = 4.00,
  fullTrigger = 4.30,
  mobileOrderTrigger = 5.80,
  mobileActiveTrigger = 6.10,
  criticalSpillTrigger = 6.50,
  isSummer = false
) {
  let stage = 0;
  let stageLabel = "STANDBY / GRAVITY";
  let badgeClass = "stage-0";
  let statusText = `⚪ STANDBY`;
  let runningCount = 0;
  let mode = "STANDBY";
  let mobileStatus = "OFF";

  const minLevel = startTrigger - 0.40;
  // Focus scale on pump operational envelope (up to mobileActive + 0.40m)
  // Prevents squishing lower thresholds when spillway crest is much higher
  const maxLevel = Math.max(mobileActiveTrigger + 0.40, Math.min(criticalSpillTrigger, mobileActiveTrigger + 0.60));
  const clampedLevel = Math.max(minLevel, Math.min(maxLevel, moorLevel));
  const progressPct = Math.round(((clampedLevel - minLevel) / (maxLevel - minLevel)) * 100);

  if (moorLevel >= criticalSpillTrigger) {
    stage = 4;
    stageLabel = "STAGE 4: CRITICAL OVERSPILL RISK";
    badgeClass = "stage-4";
    statusText = `🚨 CRITICAL OVERSPILL (${totalPumps}/${totalPumps} + MOBILE ACTIVE)`;
    runningCount = totalPumps;
    mode = "CRITICAL_OVERSPILL";
    mobileStatus = "OPERATING";
  } else if (moorLevel >= mobileActiveTrigger) {
    stage = 3;
    stageLabel = "STAGE 3: EMERGENCY MOBILE PUMPS ACTIVE";
    badgeClass = "stage-3";
    statusText = `🔴 EMERGENCY MAX PUMPING (${totalPumps}/${totalPumps} + MOBILE ACTIVE)`;
    runningCount = totalPumps;
    mode = "EMERGENCY_MOBILE_ACTIVE";
    mobileStatus = "OPERATING";
  } else if (moorLevel >= mobileOrderTrigger) {
    stage = 2;
    stageLabel = "STAGE 2: MOBILE PUMPS ORDERED / MOBILIZING";
    badgeClass = "stage-2";
    statusText = `🟡 MOBILE PUMPS MOBILIZING (${totalPumps}/${totalPumps} PERMANENT ACTIVE)`;
    runningCount = totalPumps;
    mode = "MOBILE_ORDERED";
    mobileStatus = "MOBILIZING";
  } else if (moorLevel >= fullTrigger) {
    stage = 1;
    stageLabel = "STAGE 1: FULL PERMANENT DUTY";
    badgeClass = "stage-1";
    statusText = `🟢 ${totalPumps}/${totalPumps} PERMANENT ACTIVE`;
    runningCount = totalPumps;
    mode = "FULL_CAPACITY";
    mobileStatus = "STANDBY";
  } else if (moorLevel >= startTrigger) {
    stage = 1;
    stageLabel = "STAGE 1: LEAD PERMANENT DUTY";
    badgeClass = "stage-1";
    const running = Math.max(1, Math.floor(totalPumps / 2));
    statusText = `🟢 ${running}/${totalPumps} PERMANENT ACTIVE`;
    runningCount = running;
    mode = "PARTIAL_DUTY";
    mobileStatus = "STANDBY";
  }

  const thresholds = [
    { level: startTrigger, label: "Lead ON", pct: Math.round(((startTrigger - minLevel) / (maxLevel - minLevel)) * 100) },
    { level: fullTrigger, label: "Duty ON", pct: Math.round(((fullTrigger - minLevel) / (maxLevel - minLevel)) * 100) },
    { level: mobileOrderTrigger, label: "Mobile Order", pct: Math.round(((mobileOrderTrigger - minLevel) / (maxLevel - minLevel)) * 100) },
    { level: mobileActiveTrigger, label: "Mobile Active", pct: Math.round(((mobileActiveTrigger - minLevel) / (maxLevel - minLevel)) * 100) }
  ];

  return {
    stage,
    stageLabel,
    badgeClass,
    statusText,
    runningCount,
    totalPumps,
    mode,
    mobileStatus,
    progressPct,
    thresholds,
    isSummer,
    regimeTag: isSummer ? "☀️ Summer Triggers" : "❄️ Winter Triggers",
    confidence: "HIGH_SOP_5STAGE",
    confidenceTag: "⚡ 5-STAGE OPERATIONAL SOP",
    narrative: `${stationName}: ${stageLabel} (${isSummer ? '☀️ Summer Penning Regime' : '❄️ Winter Flood Regime'}). Current level ${moorLevel.toFixed(2)}m AOD relative to triggers (Lead ${startTrigger.toFixed(2)}m, Duty ${fullTrigger.toFixed(2)}m, Mobile Order ${mobileOrderTrigger.toFixed(2)}m, Mobile Active ${mobileActiveTrigger.toFixed(2)}m).`
  };
}

export function estimateClyseFlow(h_up, h_down, z_sill = 4.20, B = 4.20, Cd = 0.60) {
  const g = 9.81;
  const H_head = Math.max(0, h_up - z_sill);
  const deltaH = Math.max(0, h_up - h_down);

  if (H_head <= 0 || deltaH <= 0.05) {
    return {
      flowM3s: 0,
      flowMLD: 0,
      formatted: "0.0 m³/s"
    };
  }

  // Hydraulic Submerged Gate Discharge Formula: Q = Cd * B * H_head * sqrt(2g * deltaH)
  const qRaw = Cd * B * H_head * Math.sqrt(2 * g * deltaH);
  const flowM3s = Math.min(17.0, Math.round(qRaw * 10) / 10); // Cap at max structure capacity ~17.0 m³/s
  const flowMLD = Math.round(flowM3s * 86.4); // 1 m³/s = 86.4 Megalitres/day

  return {
    flowM3s,
    flowMLD,
    formatted: `~${flowM3s.toFixed(1)} m³/s (${flowMLD} MLD)`
  };
}

export function evaluateSowyChannel(h_up, h_down, thresholdSill = 4.20) {
  const deltaH = h_up - h_down;
  const flowEst = estimateClyseFlow(h_up, h_down, thresholdSill);

  if (h_up >= thresholdSill && deltaH > 0.10) {
    return {
      code: "GRAVITY_OPEN",
      label: "GRAVITY FLOW",
      badgeClass: "badge-open",
      symbol: "➔",
      pillText: "🟢 ACTIVE DIVERSION (DUAL GAUGE)",
      confidence: "HIGH_DUAL_SENSOR",
      confidenceTag: "📡 DEDICATED SENSORS",
      metricText: `Flow: ~${flowEst.flowM3s.toFixed(1)} m³/s`,
      clearanceText: `Diversion Rate: ~${flowEst.flowMLD} Megalitres/day`,
      narrative: `Monk's Leaze Clyse open. Upstream level (${h_up.toFixed(2)}m) and downstream Sowy channel level (${h_down.toFixed(2)}m) indicate active diversion at ~${flowEst.flowM3s.toFixed(1)} m³/s.`
    };
  } else if (h_up >= thresholdSill && deltaH <= 0.10) {
    return {
      code: "THROTTLED",
      label: "RESTRICTED FLOW",
      badgeClass: "badge-near-crest",
      symbol: "▲",
      pillText: "🟡 DIVERSION RESTRICTED (DUAL GAUGE)",
      confidence: "HIGH_DUAL_SENSOR",
      confidenceTag: "📡 DEDICATED SENSORS",
      metricText: `Flow: Restricted`,
      clearanceText: `Downstream Head Equalized`,
      narrative: `Monk's Leaze Clyse throttled. Downstream Sedgemoor Drain level (${h_down.toFixed(2)}m) limits diversion capacity.`
    };
  } else {
    return {
      code: "CLOSED",
      label: "PENNING / CLOSED",
      badgeClass: "badge-closed",
      symbol: "🔒",
      pillText: "⚪ PENNING / CLOSED (DUAL GAUGE)",
      confidence: "HIGH_DUAL_SENSOR",
      confidenceTag: "📡 DEDICATED SENSORS",
      metricText: `Flow: 0.0 m³/s`,
      clearanceText: `Below Diversion Sill`,
      narrative: `Monk's Leaze Clyse in penning mode. River level (${h_up.toFixed(2)}m) is below diversion threshold (${thresholdSill.toFixed(2)}m).`
    };
  }
}

export function evaluateAthelneySpillway(h_tone, Z_crest = 7.35) {
  const delta = h_tone - Z_crest;
  if (delta < -0.15) {
    return { statusText: `🟢 SECURE (+${Math.abs(delta).toFixed(2)}m)` };
  } else if (delta < 0) {
    return { statusText: `🟡 NEAR CREST (${Math.abs(delta).toFixed(2)}m)` };
  } else {
    return { statusText: `🔴 OVERTOPPING (+${(delta * 100).toFixed(0)}cm)` };
  }
}

export function evaluateGravityClyse(h_moor, h_river, structureName = "Gravity Sluice") {
  const deltaH = h_moor - h_river;
  if (deltaH >= 0.05) {
    return { statusText: `🟢 GRAVITY DISCHARGING (${(deltaH * 100).toFixed(0)}cm head)` };
  } else {
    return { statusText: `🔒 PENNING / RIVER HEAD` };
  }
}

export function evaluateBeerWall(h_saltmoor, Z_crest = 7.30) {
  const delta = h_saltmoor - Z_crest;
  if (delta < -0.15) {
    return { statusText: `🟢 SECURE (+${Math.abs(delta).toFixed(2)}m)` };
  } else if (delta < 0) {
    return { statusText: `🟡 NEAR CREST (${Math.abs(delta).toFixed(2)}m)` };
  } else {
    return { statusText: `🔴 RELIEF SPILL (SOWY)` };
  }
}

export function evaluateOathLock(h_up, h_down) {
  const deltaH = h_up - h_down;
  if (deltaH >= 0.30) {
    return { statusText: `🔒 PENNING (FORCING SOWY)` };
  } else if (deltaH >= 0.05) {
    return { statusText: `🟢 GRAVITY PASSING` };
  } else {
    return { statusText: `⏸️ EQUILIBRIUM` };
  }
}

export function evaluateDunballEmergencyPumping(h_ksd, isTideLocked, threshold = 2.80) {
  if (isTideLocked && h_ksd >= threshold) {
    return { statusText: `⚡ HIGH-VOLUME PUMPING ACTIVE` };
  } else if (isTideLocked) {
    return { statusText: `⚪ PUMPS STANDBY (MONITORING KSD)` };
  } else {
    return { statusText: `⚪ PUMPS STANDBY (GRAVITY OK)` };
  }
}

/**
 * Resolves the effective spillway crest height (mAOD) for a given date/timestamp.
 * Falls back to baseline_crest_mAOD or default value if no historical match is found.
 */
export function getActiveCrestHeight(spillwayConfig, timestamp = new Date(), fallbackCrest = 7.45) {
  if (!spillwayConfig) return fallbackCrest;
  
  const timeMs = new Date(timestamp).getTime();
  if (isNaN(timeMs)) return spillwayConfig.baseline_crest_mAOD || fallbackCrest;
  
  if (Array.isArray(spillwayConfig.crest_history) && spillwayConfig.crest_history.length > 0) {
    const match = spillwayConfig.crest_history.find(entry => {
      const fromMs = new Date(entry.valid_from).getTime();
      if (isNaN(fromMs)) return false;
      
      let toMs = Infinity;
      if (entry.valid_to) {
        const parsedTo = new Date(entry.valid_to).getTime();
        toMs = isNaN(parsedTo) ? Infinity : parsedTo;
      }
      
      return timeMs >= fromMs && timeMs <= toMs;
    });
    
    if (match && typeof match.crest_mAOD === 'number' && !isNaN(match.crest_mAOD)) {
      return match.crest_mAOD;
    }
  }
  
  return spillwayConfig.baseline_crest_mAOD || fallbackCrest;
}

/**
 * Detects the active catchment ID from a location object, URL string, or pathname.
 * Precedence:
 * 1. Query parameter ?catchment=<id>
 * 2. URL path /<id> (e.g. /somerset or /fens)
 * 3. Default fallback: 'somerset'
 */
export function getActiveCatchmentId(inputLocation) {
  let searchStr = '';
  let pathStr = '';

  if (typeof inputLocation === 'string') {
    try {
      const parsed = new URL(inputLocation, 'http://localhost');
      searchStr = parsed.search;
      pathStr = parsed.pathname;
    } catch {
      pathStr = inputLocation;
    }
  } else if (inputLocation && typeof inputLocation === 'object') {
    searchStr = inputLocation.search || '';
    pathStr = inputLocation.pathname || '';
  } else if (typeof window !== 'undefined' && window.location) {
    searchStr = window.location.search;
    pathStr = window.location.pathname;
  }

  if (searchStr) {
    const params = new URLSearchParams(searchStr);
    const paramCatchment = params.get('catchment');
    if (paramCatchment && paramCatchment.trim()) {
      return paramCatchment.trim().toLowerCase();
    }
  }

  if (pathStr) {
    const segments = pathStr.split('/').filter(Boolean);
    if (segments.length > 0) {
      const first = segments[0].toLowerCase();
      const nonCatchments = ['api', 'css', 'js', 'index.html', 'methodology.html'];
      if (!nonCatchments.includes(first) && !first.endsWith('.html')) {
        return first;
      }
    }
  }

  return 'somerset';
}

/**
 * Dynamically loads catchment configuration by ID via API endpoint with file fallback.
 */
export async function loadCatchmentConfig(catchmentId = 'somerset', fetchFn = globalThis.fetch) {
  const activeId = catchmentId || 'somerset';

  if (!fetchFn) return null;

  try {
    const res = await fetchFn(`/api/catchments/${activeId}`);
    if (res && res.ok) {
      return await res.json();
    }
  } catch (err) {
    // API endpoint unavailable, try direct static config file
  }

  try {
    const res = await fetchFn(`/js/config/catchments/${activeId}.json`);
    if (res && res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Direct file unavailable
  }

  try {
    const res = await fetchFn('/js/config/hydro_config.json');
    if (res && res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Fallback unavailable
  }

  return null;
}

/**
 * Canonical 19-Station Hydrological Network Registry
 * Authoritative single source of truth for all network assets, geodetic datums,
 * structural taxonomy classes, alert thresholds, and calm baseflow fallbacks.
 */
export const STATION_REGISTRY = {
  '52108': {
    id: '52108',
    name: 'Greenham (Upper Tone)',
    river: 'River Tone',
    catchment: 'tone',
    node_type: 'gauge',
    measure_id: '52108-level-stage-i-15_min-mASD',
    alt_measure_ids: ['52108-level-stage-i-15_min-m'],
    datum_offset_mAOD: 75.69,
    baseline_invert_mAOD: 75.72,
    alert_level_mAOD: 76.99,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 76.14,
    downstream_node_id: '52109',
    has_sparkline: true
  },
  '52109': {
    id: '52109',
    name: 'Bishops Hull (Mid Tone)',
    river: 'River Tone',
    catchment: 'tone',
    node_type: 'gauge',
    measure_id: '52109-level-stage-i-15_min-mASD',
    alt_measure_ids: ['52109-level-stage-i-15_min-m'],
    datum_offset_mAOD: 16.58,
    baseline_invert_mAOD: 16.60,
    alert_level_mAOD: 17.48,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 16.93,
    downstream_node_id: '52111',
    has_sparkline: true
  },
  '52111': {
    id: '52111',
    name: 'Taunton Market',
    river: 'River Tone',
    catchment: 'tone',
    node_type: 'gauge',
    measure_id: '52111-level-stage-i-15_min-mASD',
    alt_measure_ids: ['52111-level-stage-i-15_min-m'],
    datum_offset_mAOD: 12.47,
    baseline_invert_mAOD: 12.67,
    alert_level_mAOD: 14.24,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 13.12,
    downstream_node_id: '52162',
    has_sparkline: true
  },
  '52162': {
    id: '52162',
    name: 'Bathpool Outfall',
    river: 'River Tone',
    catchment: 'tone',
    node_type: 'gauge',
    measure_id: '52162-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 7.50,
    ground_elevation_mAOD: 7.50,
    alert_level_mAOD: 9.50,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 7.54,
    downstream_node_id: '52118',
    has_sparkline: true
  },
  '52118': {
    id: '52118',
    name: 'Hookbridge Spillway / Currymoor PS',
    river: 'River Tone',
    catchment: 'tone',
    node_type: 'spillway',
    measure_id: '52118-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 3.30,
    alert_level_mAOD: 7.15,
    crest_elevation_mAOD: 7.45,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 4.50,
    downstream_node_id: '52158',
    diverts_to_node_id: '52127',
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3073'
  },
  '52127': {
    id: '52127',
    name: 'Curry Moor Basin',
    river: 'Curry Moor Basin',
    catchment: 'tone',
    node_type: 'polder_basin',
    measure_id: '52127-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 2.10,
    ground_elevation_mAOD: 2.10,
    alert_level_mAOD: 6.50,
    crest_elevation_mAOD: 7.45,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 4.47,
    downstream_node_id: 'currymoor_ps',
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3064'
  },
  '52116': {
    id: '52116',
    name: 'Chiselborough (Upper Parrett)',
    river: 'River Parrett',
    catchment: 'parrett',
    node_type: 'gauge',
    measure_id: '52116-level-stage-i-15_min-m',
    alt_measure_ids: ['52116-level-stage-i-15_min-mASD'],
    datum_offset_mAOD: 20.70,
    baseline_invert_mAOD: 20.70,
    alert_level_mAOD: 22.50,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 20.75,
    downstream_node_id: '52119',
    has_sparkline: true
  },
  '52119': {
    id: '52119',
    name: 'Gaw Bridge (Mid Parrett)',
    river: 'River Parrett',
    catchment: 'parrett',
    node_type: 'gauge',
    measure_id: '52119-level-stage-i-15_min-mASD',
    alt_measure_ids: ['52119-level-stage-i-15_min-m'],
    datum_offset_mAOD: 10.00,
    baseline_invert_mAOD: 10.16,
    alert_level_mAOD: 12.80,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 10.42,
    downstream_node_id: '52233',
    has_sparkline: true
  },
  '52120': {
    id: '52120',
    name: 'Huish Episcopi PS (River Yeo)',
    river: 'River Yeo',
    catchment: 'tributaries',
    node_type: 'gauge',
    measure_id: '52120-level-stage-i-15_min-mASD',
    alt_measure_ids: ['52120-level-stage-i-15_min-m'],
    datum_offset_mAOD: 5.000,
    baseline_invert_mAOD: 5.80,
    alert_level_mAOD: 8.48,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 6.68,
    downstream_node_id: '52233',
    upstream_tributaries: ['52121', '52117', '52112'],
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3071'
  },
  '52153': {
    id: '52153',
    name: 'Midelney (River Isle)',
    river: 'River Isle',
    catchment: 'tributaries',
    node_type: 'gauge',
    measure_id: '52153-level-stage-i-15_min-mASD',
    alt_measure_ids: ['52153-level-stage-i-15_min-m'],
    datum_offset_mAOD: 5.185,
    baseline_invert_mAOD: 5.50,
    alert_level_mAOD: 8.20,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 6.63,
    downstream_node_id: '52233',
    upstream_tributaries: ['52115', '52114'],
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3380'
  },
  '52233': {
    id: '52233',
    name: "Monk's Leaze Clyse (Upstream)",
    river: 'River Parrett',
    catchment: 'parrett',
    node_type: 'clyse_gate',
    measure_id: '52233-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 4.20,
    sill_elevation_mAOD: 4.20,
    alert_level_mAOD: 7.90,
    crest_elevation_mAOD: undefined,
    fallback_stage_mAOD: 6.73,
    downstream_node_id: '52158',
    diverts_to_node_id: '52234',
    has_sparkline: true,
    ea_link: 'https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html'
  },
  '52158': {
    id: '52158',
    name: 'Baltmoor Wall (Burrowbridge Confluence)',
    river: 'River Parrett',
    catchment: 'parrett',
    node_type: 'spillway',
    measure_id: '52158-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 3.50,
    alert_level_mAOD: 7.50,
    crest_elevation_mAOD: 7.80,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 3.78,
    downstream_node_id: '52124',
    diverts_to_node_id: '52159',
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3065'
  },
  '52159': {
    id: '52159',
    name: 'Northmoor Basin',
    river: 'Northmoor Basin',
    catchment: 'parrett',
    node_type: 'polder_basin',
    measure_id: '52159-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 1.80,
    ground_elevation_mAOD: 1.80,
    alert_level_mAOD: 3.80,
    crest_elevation_mAOD: 7.80,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 3.17,
    downstream_node_id: 'saltmoor_ps',
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3068'
  },
  '52124': {
    id: '52124',
    name: 'West Quay Bridgwater',
    river: 'River Parrett',
    catchment: 'parrett',
    node_type: 'gauge',
    measure_id: '52124-level-tidal_level-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 0.50,
    alert_level_mAOD: 6.10,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 3.10,
    downstream_node_id: '52163',
    has_sparkline: true
  },
  '52163': {
    id: '52163',
    name: 'Dunball Tidal Outfall',
    river: 'Parrett Estuary',
    catchment: 'parrett',
    node_type: 'tidal_outfall',
    measure_id: '52163-level-tidal_level-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: -1.50,
    alert_level_mAOD: 6.50,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 0.84,
    downstream_node_id: 'sea_outfall',
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/9129'
  },
  '52234': {
    id: '52234',
    name: "Monk's Leaze Clyse (Downstream Sowy)",
    river: 'Sowy Relief Channel',
    catchment: 'sowy_ksd',
    node_type: 'gauge',
    measure_id: '52234-level-downstage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 4.20,
    alert_level_mAOD: 7.60,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 6.72,
    downstream_node_id: '52157',
    has_sparkline: true,
    ea_link: 'https://environment.data.gov.uk/flood-monitoring/id/stations/52234.html'
  },
  '52157': {
    id: '52157',
    name: 'Beerwall Upstream (Greylake)',
    river: 'Sowy Relief Channel',
    catchment: 'sowy_ksd',
    node_type: 'spillway',
    measure_id: '52157-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 2.30,
    alert_level_mAOD: 4.20,
    crest_elevation_mAOD: 7.30,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 3.92,
    downstream_node_id: 'E9531',
    has_sparkline: true
  },
  'E9531': {
    id: 'E9531',
    name: "Bradney (King's Sedgemoor Drain)",
    river: "King's Sedgemoor Drain",
    catchment: 'sowy_ksd',
    node_type: 'gauge',
    measure_id: 'E9531-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 1.00,
    alert_level_mAOD: 3.50,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 3.20,
    downstream_node_id: 'E9094',
    has_sparkline: true,
    ea_link: 'https://environment.data.gov.uk/flood-monitoring/id/stations/E9531.html'
  },
  'E9094': {
    id: 'E9094',
    name: 'Dunball Inland KSD Outfall',
    river: "King's Sedgemoor Drain",
    catchment: 'sowy_ksd',
    node_type: 'gauge',
    measure_id: 'E9094-level-stage-i-15_min-mAOD',
    datum_offset_mAOD: 0.00,
    baseline_invert_mAOD: 0.50,
    alert_level_mAOD: 3.50,
    crest_elevation_mAOD: undefined,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 2.62,
    downstream_node_id: '52163',
    has_sparkline: true,
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/9499'
  }
};

/**
 * Extracts and calculates water elevation in mAOD for a given station.
 * Applies surveyed datum offsets, plausibility sanitization, and fallback values.
 */
export function extractStationStage(measures, stationId) {
  const station = STATION_REGISTRY[stationId];
  if (!station) {
    return null;
  }

  if (measures && typeof measures === 'object') {
    let measureEntry = measures[station.measure_id];
    
    if (!measureEntry && Array.isArray(station.alt_measure_ids)) {
      for (const altId of station.alt_measure_ids) {
        if (measures[altId]) {
          measureEntry = measures[altId];
          break;
        }
      }
    }

    if (measureEntry !== undefined && measureEntry !== null) {
      let rawVal = null;
      if (typeof measureEntry === 'number' && Number.isFinite(measureEntry)) {
        rawVal = measureEntry;
      } else if (Array.isArray(measureEntry) && measureEntry.length > 0) {
        const item = measureEntry[0];
        if (typeof item === 'number' && Number.isFinite(item)) {
          rawVal = item;
        } else if (item && typeof item.value === 'number' && Number.isFinite(item.value)) {
          rawVal = item.value;
        }
      } else if (typeof measureEntry.value === 'number' && Number.isFinite(measureEntry.value)) {
        rawVal = measureEntry.value;
      }

      if (rawVal !== null) {
        const stageAOD = Number((rawVal + (station.datum_offset_mAOD || 0)).toFixed(2));
        const sanitized = sanitizeStageValue(stageAOD);
        if (sanitized !== null) {
          return sanitized;
        }
      }
    }
  }

  return station.fallback_stage_mAOD;
}

/**
 * Surveyed relative gauge vertical datum transformations (+mAOD)
 */
export const GAUGE_DATUMS = {
  '52108': 75.69,
  '52109': 16.58,
  '52111': 12.47,
  '52116': 20.70,
  '52119': 10.00,
  '52120': 5.000,
  '52153': 5.185
};

/**
 * Channel bed invert and moor basin ground elevations (+mAOD)
 */
export const STATION_BASELINES = {
  '52162': 7.50,
  '52118': 3.30,
  '52127': 2.10,
  '52158': 3.50,
  '52159': 1.80,
  '52233': 4.20,
  '52234': 4.20,
  '52157': 2.30,
  'E9531': 1.00,
  'E9094': 0.50,
  '52124': 0.50,
  '52163': -1.50,
  '52120': 5.80,
  '52153': 5.50
};

/**
 * Default topology node fallbacks
 */
export const DEFAULT_TOPOLOGY_NODES = [
  { id: "52108", name: "Greenham (Upper Tone)", river: "River Tone", catchment: "tone", node_type: "gauge", stage_mAOD: 76.14, alert_level_mAOD: 76.99, status: "SECURE", downstream_node_id: "52109", has_sparkline: true },
  { id: "52109", name: "Bishops Hull (Mid Tone)", river: "River Tone", catchment: "tone", node_type: "gauge", stage_mAOD: 16.93, alert_level_mAOD: 17.48, status: "SECURE", downstream_node_id: "52111", has_sparkline: true },
  { id: "52111", name: "Taunton Market", river: "River Tone", catchment: "tone", node_type: "gauge", stage_mAOD: 13.12, alert_level_mAOD: 14.24, status: "SECURE", downstream_node_id: "52162", has_sparkline: true },
  { id: "52162", name: "Bathpool Outfall", river: "River Tone", catchment: "tone", node_type: "gauge", stage_mAOD: 7.54, ground_elevation_mAOD: 7.50, alert_level_mAOD: 9.50, status: "SECURE", downstream_node_id: "52118", has_sparkline: true },
  { id: "52118", name: "Hookbridge Spillway / Currymoor PS", river: "River Tone", catchment: "tone", node_type: "spillway", stage_mAOD: 4.50, crest_elevation_mAOD: 7.45, alert_level_mAOD: 7.15, status: "SECURE", downstream_node_id: "52158", diverts_to_node_id: "52127", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/3073" },
  { id: "52127", name: "Curry Moor Basin", river: "Curry Moor Basin", catchment: "tone", node_type: "polder_basin", stage_mAOD: 4.47, ground_elevation_mAOD: 2.10, alert_level_mAOD: 6.50, crest_elevation_mAOD: 7.45, status: "SECURE", downstream_node_id: "currymoor_ps", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/3064" },
  { id: "52116", name: "Chiselborough (Upper Parrett)", river: "River Parrett", catchment: "parrett", node_type: "gauge", stage_mAOD: 20.75, alert_level_mAOD: 22.50, status: "SECURE", downstream_node_id: "52119", has_sparkline: true },
  { id: "52119", name: "Gaw Bridge (Mid Parrett)", river: "River Parrett", catchment: "parrett", node_type: "gauge", stage_mAOD: 10.42, alert_level_mAOD: 12.80, status: "SECURE", downstream_node_id: "52233", has_sparkline: true },
  { id: "52120", name: "Huish Episcopi PS (River Yeo)", river: "River Yeo", catchment: "tributaries", node_type: "gauge", stage_mAOD: 6.68, alert_level_mAOD: 8.48, status: "SECURE", downstream_node_id: "52233", upstream_tributaries: ["52121", "52117", "52112"], has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/3071" },
  { id: "52153", name: "Midelney (River Isle)", river: "River Isle", catchment: "tributaries", node_type: "gauge", stage_mAOD: 6.63, alert_level_mAOD: 8.20, status: "SECURE", downstream_node_id: "52233", upstream_tributaries: ["52115", "52114"], has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/3380" },
  { id: "52233", name: "Monk's Leaze Clyse (Upstream)", river: "River Parrett", catchment: "parrett", node_type: "clyse_gate", stage_mAOD: 6.73, sill_elevation_mAOD: 4.20, alert_level_mAOD: 7.90, status: "CLOSED", downstream_node_id: "52158", diverts_to_node_id: "52234", has_sparkline: true },
  { id: "52158", name: "Baltmoor Wall (Burrowbridge Confluence)", river: "River Parrett", catchment: "parrett", node_type: "spillway", stage_mAOD: 3.78, crest_elevation_mAOD: 7.80, alert_level_mAOD: 7.50, status: "SECURE", downstream_node_id: "52124", diverts_to_node_id: "52159", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/3065" },
  { id: "52159", name: "Northmoor Basin", river: "Northmoor Basin", catchment: "parrett", node_type: "polder_basin", stage_mAOD: 3.17, ground_elevation_mAOD: 1.80, alert_level_mAOD: 3.80, crest_elevation_mAOD: 7.80, status: "SECURE", downstream_node_id: "saltmoor_ps", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/3068" },
  { id: "52124", name: "West Quay Bridgwater", river: "River Parrett", catchment: "parrett", node_type: "gauge", stage_mAOD: 3.10, alert_level_mAOD: 6.10, status: "SECURE", downstream_node_id: "52163", has_sparkline: true },
  { id: "52163", name: "Dunball Tidal Outfall", river: "Parrett Estuary", catchment: "parrett", node_type: "tidal_outfall", stage_mAOD: 0.84, inland_stage_mAOD: 2.62, is_tide_locked: false, alert_level_mAOD: 6.50, status: "SECURE", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/9129" },
  { id: "52234", name: "Monk's Leaze Clyse (Downstream Sowy)", river: "Sowy Relief Channel", catchment: "sowy_ksd", node_type: "gauge", stage_mAOD: 6.72, alert_level_mAOD: 7.60, status: "SECURE", downstream_node_id: "52157", has_sparkline: true },
  { id: "52157", name: "Beerwall Upstream (Greylake)", river: "Sowy Relief Channel", catchment: "sowy_ksd", node_type: "spillway", stage_mAOD: 3.92, crest_elevation_mAOD: 7.30, alert_level_mAOD: 4.20, status: "SECURE", downstream_node_id: "E9531", has_sparkline: true },
  { id: "E9531", name: "Bradney (King's Sedgemoor Drain)", river: "King's Sedgemoor Drain", catchment: "sowy_ksd", node_type: "gauge", stage_mAOD: 3.20, alert_level_mAOD: 3.50, status: "SECURE", downstream_node_id: "E9094", has_sparkline: true, ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/E9531.html" },
  { id: "E9094", name: "Dunball Inland KSD Outfall", river: "King's Sedgemoor Drain", catchment: "sowy_ksd", node_type: "gauge", stage_mAOD: 2.62, sea_stage_mAOD: 0.84, is_tide_locked: false, alert_level_mAOD: 3.50, status: "SECURE", downstream_node_id: "52163", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/9499" }
];

/**
 * Single Authoritative Hydrological Threshold Registry (mAOD)
 */
export const HYDRO_THRESHOLDS = {
  // Canonical 19-station threshold records
  '52108': { ALERT_MAOD: 76.99, DATUM_MAOD: 75.69, BASELINE_MAOD: 75.72, TYPICAL_LOW_MAOD: 75.84, MAX_ON_RECORD_MAOD: 77.89 },
  '52109': { ALERT_MAOD: 17.48, DATUM_MAOD: 16.58, BASELINE_MAOD: 16.60, TYPICAL_LOW_MAOD: 16.67, MAX_ON_RECORD_MAOD: 19.17 },
  '52111': { ALERT_MAOD: 14.24, DATUM_MAOD: 12.47, BASELINE_MAOD: 12.67, TYPICAL_LOW_MAOD: 13.29, MAX_ON_RECORD_MAOD: 14.31 },
  '52162': { ALERT_MAOD: 9.50, DATUM_MAOD: 0.00, BASELINE_MAOD: 7.50, TYPICAL_LOW_MAOD: 8.50, MAX_ON_RECORD_MAOD: 11.03 },
  '52118': { CREST_MAOD: 7.45, ALERT_MAOD: 7.15, DATUM_MAOD: 0.00, BASELINE_MAOD: 3.30, TYPICAL_LOW_MAOD: 4.71, MAX_ON_RECORD_MAOD: 8.10 },
  '52127': { CREST_MAOD: 7.45, ALERT_MAOD: 6.50, GROUND_MAOD: 2.10, DATUM_MAOD: 0.00, BASELINE_MAOD: 2.10, TYPICAL_LOW_MAOD: 3.92, MAX_ON_RECORD_MAOD: 8.05 },
  '52116': { ALERT_MAOD: 22.50, DATUM_MAOD: 20.70, BASELINE_MAOD: 20.70, TYPICAL_LOW_MAOD: 20.75, MAX_ON_RECORD_MAOD: 23.63 },
  '52119': { ALERT_MAOD: 12.80, DATUM_MAOD: 10.00, BASELINE_MAOD: 10.16, TYPICAL_LOW_MAOD: 10.23, MAX_ON_RECORD_MAOD: 13.84 },
  '52120': {
    DATUM_MAOD: 5.000,
    GROUND_INVERT_MAOD: 5.80,
    BASELINE_MAOD: 5.80,
    LEAD_PUMP_WINTER: 6.30,
    DUTY_PUMP_WINTER: 6.50,
    LEAD_PUMP_SUMMER: 6.70,
    DUTY_PUMP_SUMMER: 6.90,
    MUCHELNEY_ROAD_MAOD: 7.30,
    RIVER_CUTOFF_MAOD: 8.20,
    ALERT_MAOD: 8.48,
    EMBANKMENT_CREST_MAOD: 8.80,
    TYPICAL_LOW_MAOD: 6.44,
    MAX_ON_RECORD_MAOD: 9.92
  },
  '52153': {
    DATUM_MAOD: 5.185,
    GROUND_INVERT_MAOD: 5.50,
    BASELINE_MAOD: 5.50,
    LEAD_PUMP: 6.40,
    DUTY_PUMP: 6.70,
    HEADLOCK_OVERFLOW_MAOD: 8.20,
    ALERT_MAOD: 8.20,
    TYPICAL_LOW_MAOD: 6.10,
    MAX_ON_RECORD_MAOD: 9.12
  },
  '52233': {
    SILL_MAOD: 4.20,
    MIN_DELTA_H: 0.05,
    UPSTREAM_ALERT_MAOD: 7.90,
    DOWNSTREAM_ALERT_MAOD: 7.60,
    ALERT_MAOD: 7.90,
    DATUM_MAOD: 0.00,
    BASELINE_MAOD: 4.20,
    TYPICAL_LOW_MAOD: 6.01,
    MAX_ON_RECORD_MAOD: 8.50
  },
  '52158': { CREST_MAOD: 7.80, ALERT_MAOD: 7.50, DATUM_MAOD: 0.00, BASELINE_MAOD: 3.50, TYPICAL_LOW_MAOD: 3.55, MAX_ON_RECORD_MAOD: 7.80 },
  '52159': { CREST_MAOD: 7.80, ALERT_MAOD: 3.80, GROUND_MAOD: 1.80, DATUM_MAOD: 0.00, BASELINE_MAOD: 1.80, TYPICAL_LOW_MAOD: 2.50, MAX_ON_RECORD_MAOD: 5.89 },
  '52124': { ALERT_MAOD: 6.10, DATUM_MAOD: 0.00, BASELINE_MAOD: 0.50, TYPICAL_LOW_MAOD: 1.20, MAX_ON_RECORD_MAOD: 8.09 },
  '52163': { ESTUARY_ALERT_MAOD: 6.50, ALERT_MAOD: 6.50, DATUM_MAOD: 0.00, BASELINE_MAOD: -1.50, TYPICAL_LOW_MAOD: -1.50, MAX_ON_RECORD_MAOD: 7.09 },
  '52234': { ALERT_MAOD: 7.60, DATUM_MAOD: 0.00, BASELINE_MAOD: 4.20, TYPICAL_LOW_MAOD: 6.01, MAX_ON_RECORD_MAOD: 7.90 },
  '52157': { CREST_MAOD: 7.30, ALERT_MAOD: 4.20, DATUM_MAOD: 0.00, BASELINE_MAOD: 2.30, TYPICAL_LOW_MAOD: 2.33, MAX_ON_RECORD_MAOD: 5.07 },
  'E9531': { ALERT_MAOD: 3.50, DATUM_MAOD: 0.00, BASELINE_MAOD: 1.00, TYPICAL_LOW_MAOD: 1.00, MAX_ON_RECORD_MAOD: 4.44 },
  'E9094': { INLAND_ALERT_MAOD: 3.50, ALERT_MAOD: 3.50, DATUM_MAOD: 0.00, BASELINE_MAOD: 0.50, TYPICAL_LOW_MAOD: 1.00, MAX_ON_RECORD_MAOD: 4.07 },

  // Named aliases for backward compatibility
  HOOKBRIDGE: {
    CREST_MAOD: 7.45,
    ALERT_MAOD: 7.15
  },
  BALTMOOR: {
    CREST_MAOD: 7.80,
    ALERT_MAOD: 7.50
  },
  MONKS_LEAZE: {
    SILL_MAOD: 4.20,
    MIN_DELTA_H: 0.05,
    UPSTREAM_ALERT_MAOD: 7.90,
    DOWNSTREAM_ALERT_MAOD: 7.60
  },
  BEERWALL: {
    CREST_MAOD: 7.30,
    ALERT_MAOD: 4.20
  },
  CURRY_MOOR: {
    GROUND_MAOD: 2.10,
    ALERT_MAOD: 6.50,
    CREST_MAOD: 7.45
  },
  NORTHMOOR: {
    GROUND_MAOD: 1.80,
    ALERT_MAOD: 3.80,
    CREST_MAOD: 7.80
  },
  DUNBALL: {
    ESTUARY_ALERT_MAOD: 6.50,
    INLAND_ALERT_MAOD: 3.50
  },
  HUISH_EPISCOPI: {
    DATUM_MAOD: 5.000,
    GROUND_INVERT_MAOD: 5.80,
    LEAD_PUMP_WINTER: 6.30,
    DUTY_PUMP_WINTER: 6.50,
    LEAD_PUMP_SUMMER: 6.70,
    DUTY_PUMP_SUMMER: 6.90,
    MUCHELNEY_ROAD_MAOD: 7.30,
    RIVER_CUTOFF_MAOD: 8.20,
    ALERT_MAOD: 8.48,
    EMBANKMENT_CREST_MAOD: 8.80
  },
  MIDELNEY: {
    DATUM_MAOD: 5.185,
    GROUND_INVERT_MAOD: 5.50,
    LEAD_PUMP: 6.40,
    DUTY_PUMP: 6.70,
    HEADLOCK_OVERFLOW_MAOD: 8.20,
    ALERT_MAOD: 8.20
  }
};

/**
 * Pre-Overtopping 30cm Warning Alert Thresholds (mAOD)
 */
export const PRE_OVERTOPPING_THRESHOLDS = {
  HOOKBRIDGE_ALERT_MAOD: HYDRO_THRESHOLDS.HOOKBRIDGE.ALERT_MAOD, // 30cm below 7.45m crest
  BALTMOOR_ALERT_MAOD: HYDRO_THRESHOLDS.BALTMOOR.ALERT_MAOD     // 30cm below 7.80m crest
};

/**
 * Sanitizes and validates stage values against plausibility bounds (-2.0m to 15.0m AOD) (SEC-06).
 */
export function sanitizeStageValue(val) {
  if (val === null || val === undefined || typeof val !== 'number' || isNaN(val)) {
    return null;
  }
  if (val < -2.0 || val > 100.0) {
    return null; // Out of bounds telemetry outlier
  }
  return val;
}

/**
 * Calculates estimated overtopping discharge flow (m³/s & Megalitres/day)
 * using the Villemonte broad-crested submerged weir formulation.
 */
export function calculateVillemonteDischarge(h_river, h_moor, Z_crest, B = 45.0, Cd = 0.575) {
  const cleanRiver = sanitizeStageValue(h_river);
  const cleanMoor = sanitizeStageValue(h_moor);

  if (cleanRiver === null) {
    return { flowM3s: 0, flowMLD: 0, submergenceRatio: 0, state: "INVALID_TELEMETRY" };
  }

  const H_u = cleanRiver - Z_crest;
  const H_d = cleanMoor !== null ? cleanMoor - Z_crest : 0;

  if (H_u <= 0) {
    return { flowM3s: 0, flowMLD: 0, submergenceRatio: 0, state: "DRY" };
  }

  const g = 9.81;
  const submergenceRatio = H_u > 0 && H_d > 0 ? Math.min(1.0, H_d / H_u) : 0;
  const freeFlow = (2 / 3) * Cd * B * Math.pow(H_u, 1.5) * Math.sqrt(2 * g);

  let flowM3s = freeFlow;
  if (submergenceRatio > 0 && submergenceRatio < 1.0) {
    const submergenceFactor = Math.pow(1.0 - Math.pow(submergenceRatio, 1.5), 0.385);
    flowM3s = freeFlow * submergenceFactor;
  } else if (submergenceRatio >= 1.0) {
    flowM3s = 0; // Equalized tailwater head
  }

  flowM3s = Math.round(flowM3s * 10) / 10;
  const flowMLD = Math.round(flowM3s * 86.4);

  return {
    flowM3s,
    flowMLD,
    submergenceRatio,
    state: submergenceRatio >= 0.70 ? "SUBMERGED" : "FREE_FLOW"
  };
}

/**
 * Sanitizes HTML string inputs to prevent XSS (SEC-01).
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitizes HTML attribute values (SEC-01).
 */
export function escapeAttr(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats head differential values in centimeters.
 */
export function formatHeadDelta(deltaInMeters) {
  if (typeof deltaInMeters !== 'number' || isNaN(deltaInMeters)) return '--';
  const cm = Math.round(deltaInMeters * 100);
  if (cm > 0) return `+${cm} cm`;
  return `${cm} cm`;
}

/**
 * Evaluates Huish Episcopi Pumping Station on the River Yeo, including
 * automatic receiving river cut-off interlock (8.20m AOD) and Muchelney road inundation (7.30m AOD).
 */
export function evaluateHuishEpiscopi(stage_mAOD, isSummer = false) {
  const cleanStage = sanitizeStageValue(stage_mAOD);
  if (cleanStage === null) {
    return { code: "OFFLINE", label: "OFFLINE", badgeClass: "badge-offline", narrative: "No telemetry", severity: 1 };
  }

  const t = HYDRO_THRESHOLDS.HUISH_EPISCOPI;
  const leadPump = isSummer ? t.LEAD_PUMP_SUMMER : t.LEAD_PUMP_WINTER;
  const dutyPump = isSummer ? t.DUTY_PUMP_SUMMER : t.DUTY_PUMP_WINTER;
  const muchelneyRoad = t.MUCHELNEY_ROAD_MAOD;
  const riverCutoff = t.RIVER_CUTOFF_MAOD;
  const alertLevel = t.ALERT_MAOD;

  const roadMargin = Number((muchelneyRoad - cleanStage).toFixed(2));
  const cutoffClearance = Number((riverCutoff - cleanStage).toFixed(2));

  let pumpStatus = "STANDBY";
  let pumpLabel = "STANDBY (GRAVITY DRAINAGE)";
  if (cleanStage >= riverCutoff) {
    pumpStatus = "CUT_OFF";
    pumpLabel = "PUMPS LOCKED (RIVER FULL)";
  } else if (cleanStage >= dutyPump) {
    pumpStatus = "DUTY_PUMPING";
    pumpLabel = "DUTY PUMPS ACTIVE";
  } else if (cleanStage >= leadPump) {
    pumpStatus = "LEAD_PUMPING";
    pumpLabel = "LEAD PUMP ACTIVE";
  }

  let code = "SECURE";
  let label = "SECURE (CONVEYING)";
  let badgeClass = "badge-secure";
  let symbol = "✓";
  let severity = 5;
  let narrative = `River Yeo level is ${cleanStage.toFixed(2)}m AOD. ${cutoffClearance > 0 ? `+${cutoffClearance.toFixed(2)}m clearance to 8.20m river cut-off.` : 'Receiving river is bankfull.'}`;

  if (cleanStage >= alertLevel) {
    code = "ALERT";
    label = "FLOOD ALERT";
    badgeClass = "badge-alert";
    symbol = "▲";
    severity = 3;
    narrative = `Flood Alert: River Yeo level (${cleanStage.toFixed(2)}m AOD) exceeds typical high (${alertLevel}m AOD).`;
  } else if (cleanStage >= riverCutoff) {
    code = "CUT_OFF";
    label = "RIVER FULL / PUMPS LOCKED";
    badgeClass = "badge-restricted";
    symbol = "🔒";
    severity = 3;
    narrative = `River Yeo stage has reached ${cleanStage.toFixed(2)}m AOD (≥ 8.20m bankfull limit). Huish Episcopi permanent pumps are automatically locked out to prevent levee breach.`;
  } else if (cleanStage >= muchelneyRoad) {
    code = "ROAD_INUNDATED";
    label = "MUCHELNEY ROAD FLOODED";
    badgeClass = "badge-warning";
    symbol = "⚠️";
    severity = 4;
    narrative = `Warning: River Yeo stage (${cleanStage.toFixed(2)}m AOD) exceeds 7.30m road threshold. Muchelney-Langport road is inundated.`;
  }

  return {
    code,
    label,
    badgeClass,
    symbol,
    severity,
    stage_mAOD: cleanStage,
    pumpStatus,
    pumpLabel,
    muchelneyRoadMargin: roadMargin,
    cutoffClearance: cutoffClearance,
    clearanceText: cutoffClearance >= 0 ? `+${cutoffClearance.toFixed(2)}m to Cut-off` : `${Math.abs(cutoffClearance).toFixed(2)}m above Cut-off`,
    isRoadFlooded: cleanStage >= muchelneyRoad,
    isPumpsCutoff: cleanStage >= riverCutoff,
    narrative
  };
}

/**
 * Evaluates Midelney on the River Isle, including gravity sluice vs headlocked pumping
 * and flood storage area (FSA) overflow status.
 */
export function evaluateMidelney(stage_mAOD, parrettStage_mAOD = null) {
  const cleanStage = sanitizeStageValue(stage_mAOD);
  const cleanParrett = sanitizeStageValue(parrettStage_mAOD);
  if (cleanStage === null) {
    return { code: "OFFLINE", label: "OFFLINE", badgeClass: "badge-offline", narrative: "No telemetry", severity: 1 };
  }

  const t = HYDRO_THRESHOLDS.MIDELNEY;
  const isHeadLocked = cleanParrett !== null && cleanParrett >= cleanStage;
  const isPumping = cleanStage >= t.LEAD_PUMP;
  const isAlert = cleanStage >= t.ALERT_MAOD;

  let code = "SECURE";
  let label = "GRAVITY DISCHARGE";
  let badgeClass = "badge-secure";
  let symbol = "✓";
  let severity = 5;

  if (isAlert) {
    code = "ALERT";
    label = "FLOOD ALERT / FSA OVERFLOW";
    badgeClass = "badge-alert";
    symbol = "▲";
    severity = 3;
  } else if (isHeadLocked) {
    code = "HEAD_LOCKED";
    label = isPumping ? "HEAD-LOCKED (PUMPING)" : "HEAD-LOCKED";
    badgeClass = "badge-restricted";
    symbol = "🕒";
    // Routine penning head-lock during low baseflow (<7.30m AOD) is a normal operational state (severity 5);
    // only escalate to global flood warning (severity 4) when high water backs up (>= 7.30m AOD).
    severity = cleanStage >= 7.30 ? 4 : 5;
  }

  return {
    code,
    label,
    badgeClass,
    symbol,
    severity,
    stage_mAOD: cleanStage,
    isHeadLocked,
    isPumping,
    isAlert,
    clearanceText: (t.ALERT_MAOD - cleanStage).toFixed(2) + 'm to Alert',
    narrative: `River Isle stage is ${cleanStage.toFixed(2)}m AOD. ${isHeadLocked ? 'Parrett head backpressure forces Midelney gravity flaps shut; West Moor pumping required.' : 'Free gravity discharge into River Parrett active.'}`
  };
}






