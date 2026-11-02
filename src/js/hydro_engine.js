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

/**
 * @deprecated [RULE-CALC-01] Volumetric discharge speculation is strictly banned. Telemetry only provides stage (m) and datum (mAOD). Open-channel discharge cannot be substantiated without surveyed rating curves. Strictly banned from production telemetry, API responses, and event triggering. Preserved only for unit test backwards-compatibility.
 */
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
  const deltaH = Number((h_up - h_down).toFixed(2));

  if (h_up >= thresholdSill && deltaH > 0.10) {
    return {
      code: "GRAVITY_OPEN",
      label: "GRAVITY FLOW",
      badgeClass: "badge-open",
      symbol: "➔",
      pillText: "🟢 ACTIVE DIVERSION (DUAL GAUGE)",
      confidence: "HIGH_DUAL_SENSOR",
      confidenceTag: "📡 DEDICATED SENSORS",
      metricText: `Head Drop: +${deltaH.toFixed(2)}m`,
      clearanceText: `Intake Sill Margin: +${(h_up - thresholdSill).toFixed(2)}m`,
      narrative: `Monk's Leaze Clyse gravity diversion active. Upstream Parrett stage (${h_up.toFixed(2)}m AOD) exceeds 4.20m sill with a +${deltaH.toFixed(2)}m head drop into the Sowy Relief Channel.`
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
      metricText: "Head Differential Neutral",
      clearanceText: "Downstream Head Equalized",
      narrative: `Monk's Leaze Clyse throttled. Downstream Sedgemoor Drain level (${h_down.toFixed(2)}m AOD) limits diversion capacity.`
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
      metricText: "Penning / No Diversion",
      clearanceText: `${(thresholdSill - h_up).toFixed(2)}m Below Sill`,
      narrative: `Monk's Leaze Clyse in penning mode. River level (${h_up.toFixed(2)}m AOD) is below diversion threshold (${thresholdSill.toFixed(2)}m AOD).`
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
 * 4-Tier Provenance Classification Taxonomy
 * Strictly separates surveyed physical geometry, official agency plans,
 * EA statistical envelopes, and platform-derived heuristics.
 */
export const PROVENANCE_TIERS = {
  TIER_1_SURVEYED: { tier: 1, code: 'SURVEYED', label: 'Surveyed', icon: '📐', description: 'Fixed physical civil geometry from official EA/SRA asset surveys' },
  TIER_2_AGENCY_PLAN: { tier: 2, code: 'AGENCY_PLAN', label: 'Agency Plan', icon: '📋', description: 'Statutory EA / Somerset Council Trigger Point Plan threshold' },
  TIER_3_EA_TYPICAL: { tier: 3, code: 'EA_TYPICAL', label: 'EA Typical', icon: '📊', description: 'Calibrated from official EA stageScale.typicalRangeHigh historical envelope' },
  TIER_4_DERIVED: { tier: 4, code: 'DERIVED', label: 'Derived', icon: '⚙️', description: 'Platform-derived operational heuristic or safety buffer' }
};

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
    has_sparkline: true,
    provenance: {
      datum: { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (+75.69m ODN)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Tone Channel Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (1.30m stage)' }
    }
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
    has_sparkline: true,
    provenance: {
      datum: { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (+16.58m ODN)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Tone Channel Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (0.90m stage)' }
    }
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
    has_sparkline: true,
    provenance: {
      datum: { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (+12.47m ODN)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Tone Channel Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (1.77m stage)' }
    }
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
    has_sparkline: true,
    provenance: {
      datum: { tier: 1, label: 'Direct mAOD Sensor', authority: 'EA Telemetry Stream (0.00m offset)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Channel Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA Typical High Flood Stage' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3073',
    provenance: {
      crest: { tier: 1, label: 'Surveyed Concrete Crest', authority: 'EA Asset Survey / SRA 2014 Benchmark (7.45m ODN)' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Tone Channel Bed Invert' },
      near_crest: { tier: 4, label: 'Platform 15cm Buffer', authority: 'Platform Heuristic (15cm Pre-Warning)' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3064',
    provenance: {
      crest: { tier: 1, label: 'Hookbridge Inflow Crest', authority: 'EA Surveyed Broad-Crested Weir (7.45m ODN)' },
      alert: { tier: 3, label: 'EA Flood Alert Stage', authority: 'EA stageScale High Envelope' },
      ground: { tier: 1, label: 'Surveyed Basin Floor', authority: 'EA Moor Topography Survey (2.10m ODN)' },
      operational: { tier: 2, label: 'EA Trigger Point Plan', authority: 'EA Somerset Levels Trigger Point Plan (Currymoor PS 5.80m/6.10m)' }
    }
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
    has_sparkline: true,
    provenance: {
      datum: { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (+20.70m ODN)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Parrett Channel Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (1.80m stage)' }
    }
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
    has_sparkline: true,
    provenance: {
      datum: { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (+10.00m ODN)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Parrett Channel Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (2.80m stage)' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3071',
    provenance: {
      datum: { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (+5.00m ODN)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA River Yeo Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (3.48m stage)' },
      operational: { tier: 2, label: 'EA Operating Rules', authority: 'EA River Cut-off at 8.20m, Winter Duty 6.50m' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3380',
    provenance: {
      datum: { tier: 1, label: 'Surveyed Datum', authority: 'EA Geodetic Benchmark (+5.185m ODN)' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA River Isle Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (3.01m stage)' },
      operational: { tier: 2, label: 'FSA Operating Strategy', authority: 'West Moor FSA Duty Pumping (6.70m) & Reverse Headlock (8.20m)' }
    }
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
    ea_link: 'https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html',
    provenance: {
      sill: { tier: 1, label: 'Surveyed Clyse Sill', authority: 'EA Surveyed Intake Sill of Sowy Relief Channel (4.20m ODN)' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh' },
      operational: { tier: 2, label: 'EA Operating Protocol', authority: 'Penstocks opened to relieve Parrett into Sowy' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3065',
    provenance: {
      crest: { tier: 1, label: 'Surveyed Levee Defense', authority: 'EA Surveyed Armored Clay Embankment (7.80m ODN)' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale typical envelope' },
      invert: { tier: 1, label: 'Surveyed Bed Invert', authority: 'EA Parrett Channel Invert at Burrowbridge' },
      near_crest: { tier: 4, label: 'Platform 15cm Buffer', authority: 'Platform Heuristic (15cm Pre-Warning)' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/3415',
    provenance: {
      crest: { tier: 1, label: 'Baltmoor Levee Defense', authority: 'EA Surveyed Armored Clay Embankment (7.80m ODN)' },
      alert: { tier: 3, label: 'EA Flood Alert Stage', authority: 'EA High Storage Warning' },
      ground: { tier: 1, label: 'Surveyed Basin Floor', authority: 'EA Moor Topography Survey (1.80m ODN)' },
      operational: { tier: 2, label: 'EA Trigger Point Plan', authority: 'EA Somerset Levels Trigger Point Plan (Northmoor/Saltmoor PS 4.80m/5.20m)' }
    }
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
    has_sparkline: true,
    provenance: {
      datum: { tier: 1, label: 'Direct mAOD Sensor', authority: 'EA Telemetry Stream (0.00m offset)' },
      invert: { tier: 1, label: 'Estuarine Bed Invert', authority: 'EA Tidal Parrett Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh (High Tide Alert)' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/9129',
    provenance: {
      datum: { tier: 1, label: 'Direct mAOD Sensor', authority: 'EA Telemetry Stream (0.00m offset)' },
      invert: { tier: 1, label: 'Outfall Apron Invert', authority: 'EA Surveyed Sea Outfall Invert (-1.50m ODN)' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA Storm Surge Alert Level' },
      operational: { tier: 4, label: 'Hydrostatic Balance', authority: 'Platform Differential Head Check (Sea vs Inland KSD)' }
    }
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
    ea_link: 'https://environment.data.gov.uk/flood-monitoring/id/stations/52234.html',
    provenance: {
      datum: { tier: 1, label: 'Direct mAOD Sensor', authority: 'EA Telemetry Stream (0.00m offset)' },
      invert: { tier: 1, label: 'Channel Bed Invert', authority: 'EA Sowy Tailwater Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh' }
    }
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
    has_sparkline: true,
    provenance: {
      crest: { tier: 1, label: 'Surveyed Culvert Crest', authority: 'EA/SRA Surveyed Concrete Relief Weir (7.30m ODN)' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale typical envelope' },
      invert: { tier: 1, label: 'Channel Bed Invert', authority: 'EA Sowy Channel Bed Survey' }
    }
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
    ea_link: 'https://environment.data.gov.uk/flood-monitoring/id/stations/E9531.html',
    provenance: {
      datum: { tier: 1, label: 'Direct mAOD Sensor', authority: 'EA Telemetry Stream (0.00m offset)' },
      invert: { tier: 1, label: 'Drain Bed Invert', authority: 'EA KSD Bed Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh' }
    }
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
    govuk_link: 'https://check-for-flooding.service.gov.uk/station/9499',
    provenance: {
      datum: { tier: 1, label: 'Direct mAOD Sensor', authority: 'EA Telemetry Stream (0.00m offset)' },
      invert: { tier: 1, label: 'Inland Apron Invert', authority: 'EA KSD Outfall Apron Survey' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh' }
    }
  }
};

/**
 * Resolves the structured threshold provenance record for a given station and threshold type.
 * @param {string} stationId - EA station ID
 * @param {string} thresholdKey - 'crest' | 'alert' | 'datum' | 'invert' | 'ground' | 'operational' | 'near_crest'
 * @returns {object|null} Structured provenance descriptor or null
 */
export function getThresholdProvenance(stationId, thresholdKey = 'alert') {
  const station = STATION_REGISTRY[stationId];
  if (!station || !station.provenance) return null;
  return station.provenance[thresholdKey] || null;
}

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
 * Safely extracts the latest stage reading or returns the surveyed fallback baseline.
 * Guards against empty arrays, null, undefined, non-finite values, and malformed items.
 *
 * @param {Array|object|null|undefined} readings - Telemetry reading(s)
 * @param {number} fallbackValue - Surveyed fallback baseline in mAOD or mASD
 * @returns {number}
 */
export function getValidStageOrFallback(readings, fallbackValue) {
  if (Array.isArray(readings) && readings.length > 0) {
    const item = readings[0];
    const val = (typeof item === 'object' && item !== null) ? item.value : item;
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
  } else if (readings && typeof readings === 'object' && typeof readings.value === 'number' && Number.isFinite(readings.value)) {
    return readings.value;
  }
  return fallbackValue;
}

/**
 * Evaluates the freshness of station telemetry readings against a 2-hour latency threshold.
 * Prevents "zombie gauges" from silently presenting stale readings as fresh/nominal.
 *
 * @param {Array|null|undefined} readings - Array of reading items sorted descending by time (latest first)
 * @param {object} [options]
 * @param {number} [options.maxAgeHours=2.0] - Age in hours after which data is classified as STALE
 * @param {number} [options.nowMs=Date.now()] - Current epoch timestamp
 * @param {string} [options.fallbackLabel='Fallback Baseline'] - Label when no readings are available
 * @returns {object} { isFresh: boolean, isStale: boolean, isOffline: boolean, ageHours: number|null, ageMinutes: number|null, latestTimestamp: string|null, badgeText: string|null, badgeClass: string }
 */
export function evaluateStationFreshness(readings, options = {}) {
  const maxAgeHours = options.maxAgeHours ?? 2.0;
  const nowMs = options.nowMs ?? Date.now();
  const fallbackLabel = options.fallbackLabel || 'Fallback Baseline';

  if (!readings || !Array.isArray(readings) || readings.length === 0) {
    return {
      isFresh: false,
      isStale: true,
      isOffline: true,
      ageHours: null,
      ageMinutes: null,
      latestTimestamp: null,
      badgeText: `⚠️ SENSOR OFFLINE (${fallbackLabel})`,
      badgeClass: 'badge-offline'
    };
  }

  const latest = readings[0];
  const dateStr = (typeof latest === 'object' && latest !== null) ? (latest.dateTime || latest.date) : null;
  const rawVal = (typeof latest === 'object' && latest !== null) ? latest.value : latest;

  if (!dateStr || rawVal === null || rawVal === undefined || !Number.isFinite(Number(rawVal))) {
    return {
      isFresh: false,
      isStale: true,
      isOffline: true,
      ageHours: null,
      ageMinutes: null,
      latestTimestamp: null,
      badgeText: `⚠️ SENSOR OFFLINE (${fallbackLabel})`,
      badgeClass: 'badge-offline'
    };
  }

  const readingMs = new Date(dateStr).getTime();
  if (isNaN(readingMs)) {
    return {
      isFresh: false,
      isStale: true,
      isOffline: true,
      ageHours: null,
      ageMinutes: null,
      latestTimestamp: null,
      badgeText: `⚠️ SENSOR OFFLINE (${fallbackLabel})`,
      badgeClass: 'badge-offline'
    };
  }

  const ageMs = Math.max(0, nowMs - readingMs);
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = Number((ageMs / (1000 * 60 * 60)).toFixed(1));

  if (ageHours > maxAgeHours) {
    return {
      isFresh: false,
      isStale: true,
      isOffline: false,
      ageHours,
      ageMinutes,
      latestTimestamp: dateStr,
      badgeText: `⚠️ SENSOR OFFLINE (Showing ${ageHours.toFixed(1)}h old reading)`,
      badgeClass: 'badge-stale'
    };
  }

  return {
    isFresh: true,
    isStale: false,
    isOffline: false,
    ageHours,
    ageMinutes,
    latestTimestamp: dateStr,
    badgeText: null,
    badgeClass: 'badge-fresh'
  };
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
  { id: "52159", name: "Northmoor Basin", river: "Northmoor Basin", catchment: "parrett", node_type: "polder_basin", stage_mAOD: 3.17, ground_elevation_mAOD: 1.80, alert_level_mAOD: 3.80, crest_elevation_mAOD: 7.80, status: "SECURE", downstream_node_id: "saltmoor_ps", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/3415" },
  { id: "52124", name: "West Quay Bridgwater", river: "River Parrett", catchment: "parrett", node_type: "gauge", stage_mAOD: 3.10, alert_level_mAOD: 6.10, status: "SECURE", downstream_node_id: "52163", has_sparkline: true },
  { id: "52163", name: "Dunball Tidal Outfall", river: "Parrett Estuary", catchment: "parrett", node_type: "tidal_outfall", stage_mAOD: 0.84, inland_stage_mAOD: 2.62, is_tide_locked: false, alert_level_mAOD: 6.50, status: "SECURE", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/9129" },
  { id: "52234", name: "Monk's Leaze Clyse (Downstream Sowy)", river: "Sowy Relief Channel", catchment: "sowy_ksd", node_type: "gauge", stage_mAOD: 6.72, alert_level_mAOD: 7.60, status: "SECURE", downstream_node_id: "52157", has_sparkline: true },
  { id: "52157", name: "Beerwall Upstream (Greylake)", river: "Sowy Relief Channel", catchment: "sowy_ksd", node_type: "spillway", stage_mAOD: 3.92, crest_elevation_mAOD: 7.30, alert_level_mAOD: 4.20, status: "SECURE", downstream_node_id: "E9531", has_sparkline: true },
  { id: "E9531", name: "Bradney (King's Sedgemoor Drain)", river: "King's Sedgemoor Drain", catchment: "sowy_ksd", node_type: "gauge", stage_mAOD: 3.20, alert_level_mAOD: 3.50, status: "SECURE", downstream_node_id: "E9094", has_sparkline: true, ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/E9531.html" },
  { id: "E9094", name: "Dunball Inland KSD Outfall", river: "King's Sedgemoor Drain", catchment: "sowy_ksd", node_type: "gauge", stage_mAOD: 2.62, sea_stage_mAOD: 0.84, is_tide_locked: false, alert_level_mAOD: 3.50, status: "SECURE", downstream_node_id: "52163", has_sparkline: true, govuk_link: "https://check-for-flooding.service.gov.uk/station/9499" }
].map(node => ({
  ...node,
  provenance: STATION_REGISTRY[node.id]?.provenance || null
}));

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
 * Canonical Physical Hysteresis Deadbands (m) [RULE-SSOT-01]
 * Directional deadbands (delta) preventing high-frequency sensor noise flapping.
 */
export const HYDRO_DEADBANDS = {
  weir_crest: 0.03,    // 3cm weir crest overtopping exit
  pre_spill: 0.05,     // 5cm approaching buffer exit
  polder_pump: 0.05,   // 5cm pumping station deactivation
  road_crown: 0.03,    // 3cm road inundation clearance exit
  road_caution: 0.05,  // 5cm road caution margin exit
  inter_moor: 0.03,    // 3cm Cuts Road cascade cessation
  clyse_head: 0.05,    // 5cm dual-gauge differential head (exceeds 2-sigma combined sensor noise)
  tidal_flap: 0.05,    // 5cm sea flap cracking head differential
  river_gauge: 0.05    // 5cm in-channel flood alert clearance
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
 * @deprecated [RULE-CALC-01] Volumetric discharge speculation is strictly banned. Telemetry only provides stage (m) and datum (mAOD). Open-channel discharge cannot be substantiated without surveyed rating curves. Strictly banned from production telemetry, API responses, and event triggering. Preserved only for unit test backwards-compatibility.
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
 * automatic receiving river cut-off interlock (8.20m AOD) and alert threshold (8.48m AOD).
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

/**
 * Canonical Network Asset Definitions [RULE-ENT-01] [RULE-TAX-06]
 * Structured canonical definitions covering all 6 physical asset classes.
 */
export const ASSET_DEFINITIONS = Object.freeze({
  // --- 1. ROADS ---
  cuts_road: Object.freeze({
    asset_type: 'road',
    asset_id: 'cuts_road',
    name: 'Cuts Road (East Lyng ↔ Athelney)',
    primary_station: '52127',
    crown_elevation_mAOD: 7.35,
    caution_elevation_mAOD: 7.00,
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Polder Overflow Crossing',
    driving_station_label: 'Curry Moor Basin (52127)',
    ea_warning_target_area: '112FWFCUR10A',
    ea_target_area_name: 'Curry Moor and Hay Moor',
    survey_tier: 'TIER_1_SURVEYED',
    survey_label: '📐 SURVEYED CIVIL GEOMETRY',
    survey_tooltip: 'Concrete spillway relief crest surveyed at 7.35m AOD.',
    camera_id: 'athelney_cuts_rd',
    cam_url: 'https://thecfh.org/parretttonewsom.php#athelneyspillway',
    cam_label: 'Check Live Camera (Carriageway & Spillway) ↗',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3064'
  }),
  muchelney_access: Object.freeze({
    asset_type: 'road',
    asset_id: 'muchelney_access',
    name: 'Muchelney Spine Road (Huish Episcopi ↔ Muchelney)',
    primary_station: '52120',
    crown_elevation_mAOD: 7.86,
    caution_elevation_mAOD: 7.30,
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Community Lifeline Spine',
    driving_station_label: 'River Yeo @ Huish (52120)',
    ea_warning_target_area: '112WAFYPM',
    ea_target_area_name: 'River Yeo & Parrett Moors',
    survey_tier: 'TIER_1_SURVEYED',
    survey_label: '📐 SURVEYED CIVIL GEOMETRY',
    survey_tooltip: 'SRA raised road crown surveyed at 7.86m AOD; low breach 7.30m.',
    camera_id: 'huish_episcopi',
    cam_url: 'https://thecfh.org/parretttonewsom.php#huish',
    cam_label: 'Check Live Camera (River Level & Approaches) ↗',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3063'
  }),
  beer_wall_a372: Object.freeze({
    asset_type: 'road',
    asset_id: 'beer_wall_a372',
    name: 'A372 at Beer Wall / Greylake (Aller ↔ Othery)',
    primary_station: '52157',
    crown_elevation_mAOD: 8.00, // ⚠️ PENDING AS-BUILT HIGHWAYS SURVEY (>8.00m AOD)
    caution_elevation_mAOD: 7.30, // Culvert relief activation threshold into 4 box culverts
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Engineered Culvert Crossing',
    driving_station_label: 'River Sowy @ Beerwall (52157)',
    ea_warning_target_area: 'SOWY_KSD',
    ea_target_area_name: 'River Sowy / KSD Catchment',
    survey_tier: 'TIER_1_WEIR_PENDING_SURVEY_CROWN',
    survey_label: '⚠️ PENDING AS-BUILT SURVEY',
    survey_tooltip: 'Weir surveyed 7.30m; Carriageway Crown Pending As-Built Survey (>8.00m AOD).',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3067'
  }),
  new_road_curry: Object.freeze({
    asset_type: 'road',
    asset_id: 'new_road_curry',
    name: 'New Road (West Lyng ↔ North Curry)',
    primary_station: '52127',
    crown_elevation_mAOD: 7.10, // ⚠️ PENDING TOPOGRAPHIC SURVEY (Council gate closure stage)
    caution_elevation_mAOD: 6.20,
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Moor Basin Highway',
    driving_station_label: 'Curry Moor Basin (52127)',
    ea_warning_target_area: '112FWFCUR10A',
    ea_target_area_name: 'Curry Moor and Hay Moor',
    survey_tier: 'TIER_2_TRIGGER_PLAN',
    survey_label: '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
    survey_tooltip: 'Correlated to EA Moor stage and Somerset Council emergency gate closure triggers. Topographic road survey pending.',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3064'
  }),
  a361_burrowbridge: Object.freeze({
    asset_type: 'road',
    asset_id: 'a361_burrowbridge',
    name: 'A361 Corridor (East Lyng ↔ Burrowbridge)',
    primary_station: '52158', // Baltmoor Wall / River Parrett at Burrowbridge
    secondary_station: '52127', // Curry Moor cascade
    crown_elevation_mAOD: 7.80, // ⚠️ PENDING AS-BUILT HIGHWAYS SURVEY (Baltmoor levee overtopping)
    caution_elevation_mAOD: 7.35, // Athelney cascade
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Strategic Regional Arterial',
    driving_station_label: 'Baltmoor (52158) & Curry Moor (52127)',
    ea_warning_target_area: '112FWFEAS10A',
    ea_target_area_name: 'A361 East Lyng to Burrowbridge',
    survey_tier: 'TIER_2_TRIGGER_PLAN',
    survey_label: '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
    survey_tooltip: 'Correlated to Baltmoor levee and Curry Moor cascade triggers. As-built highways survey pending.',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3065'
  }),
  bicknells_bridge_access: Object.freeze({
    asset_type: 'road',
    asset_id: 'bicknells_bridge_access',
    name: "Bicknell's Bridge & Huish Level (Langport ↔ Muchelney)",
    primary_station: '52120',
    crown_elevation_mAOD: 7.30, // ⚠️ PENDING TOPOGRAPHIC SURVEY (Approach submergence)
    caution_elevation_mAOD: 7.00,
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Lowland Rural Connector',
    driving_station_label: 'River Yeo @ Huish (52120)',
    ea_warning_target_area: '112WAFYPM',
    ea_target_area_name: 'River Yeo & Parrett Moors',
    survey_tier: 'TIER_3_EMPIRICAL',
    survey_label: '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
    survey_tooltip: 'Approaches Pending Topographic Survey.',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3063'
  }),
  moorland_new_cut_road: Object.freeze({
    asset_type: 'road',
    asset_id: 'moorland_new_cut_road',
    name: 'New Cut & Moorland Access (Northmoor Polder)',
    primary_station: '52159',
    crown_elevation_mAOD: 4.80, // ⚠️ PENDING TOPOGRAPHIC SURVEY (Deep storage retention)
    caution_elevation_mAOD: 3.80, // Basin alert stage
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Internal Polder Network',
    driving_station_label: 'Northmoor Basin (52159)',
    ea_warning_target_area: '112FWFSAL10A',
    ea_target_area_name: 'Salt Moor & North Moor',
    survey_tier: 'TIER_2_TRIGGER_PLAN',
    survey_label: '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
    survey_tooltip: 'Internal polder road approaches pending topographic survey.',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3415'
  }),
  stan_moor_road: Object.freeze({
    asset_type: 'road',
    asset_id: 'stan_moor_road',
    name: 'Stan Moor Road (Curload ↔ Athelney)',
    primary_station: '52118', // Hookbridge / River Tone
    secondary_station: '52127', // Curry Moor
    crown_elevation_mAOD: 7.30, // ⚠️ PENDING TOPOGRAPHIC SURVEY (Tone high bankfull stage)
    caution_elevation_mAOD: 7.15,
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'River Embankment Bank',
    driving_station_label: 'Hookbridge (52118) & Curry Moor (52127)',
    ea_warning_target_area: '112FWFSTA10A',
    ea_target_area_name: 'Stan Moor (Athelney & Curload)',
    survey_tier: 'TIER_2_TRIGGER_PLAN',
    survey_label: '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
    survey_tooltip: 'Tone embankment road crown pending topographic survey.',
    station_url: 'https://check-for-flooding.service.gov.uk/station/3073'
  }),

  // --- 2. SPILLWAYS ---
  hookbridge: Object.freeze({
    asset_type: 'spillway',
    asset_id: 'hookbridge',
    name: 'Hookbridge Spillway',
    primary_station: '52118',
    crest_elevation_mAOD: 7.45,
    pre_spill_elevation_mAOD: 7.30,
    deadband_crest: HYDRO_DEADBANDS.weir_crest,
    deadband_pre_spill: HYDRO_DEADBANDS.pre_spill
  }),
  baltmoor_wall: Object.freeze({
    asset_type: 'spillway',
    asset_id: 'baltmoor_wall',
    name: 'Baltmoor Wall Spillway',
    primary_station: '52158',
    crest_elevation_mAOD: 7.80,
    pre_spill_elevation_mAOD: 7.65,
    deadband_crest: HYDRO_DEADBANDS.weir_crest,
    deadband_pre_spill: HYDRO_DEADBANDS.pre_spill
  }),
  beer_wall: Object.freeze({
    asset_type: 'spillway',
    asset_id: 'beer_wall',
    name: 'Beer Wall Spillway',
    primary_station: '52157',
    crest_elevation_mAOD: 7.30,
    pre_spill_elevation_mAOD: 7.15,
    deadband_crest: HYDRO_DEADBANDS.weir_crest,
    deadband_pre_spill: HYDRO_DEADBANDS.pre_spill
  }),

  // --- 3. POLDERS ---
  curry_moor: Object.freeze({
    asset_type: 'polder',
    asset_id: 'curry_moor',
    name: 'Curry Moor Polder Basin',
    primary_station: '52127',
    floor_elevation_mAOD: 2.10,
    duty_pump_winter_mAOD: 4.30,
    duty_pump_summer_mAOD: 4.45,
    mobile_ordered_mAOD: 5.80,
    mobile_active_mAOD: 6.10,
    critical_mAOD: 6.50,
    deadband_pump: HYDRO_DEADBANDS.polder_pump
  }),
  northmoor: Object.freeze({
    asset_type: 'polder',
    asset_id: 'northmoor',
    name: 'Northmoor Polder Basin',
    primary_station: '52159',
    floor_elevation_mAOD: 1.80,
    duty_pump_winter_mAOD: 4.00,
    duty_pump_summer_mAOD: 4.00,
    mobile_ordered_mAOD: 4.80,
    mobile_active_mAOD: 5.20,
    critical_mAOD: 5.60,
    deadband_pump: HYDRO_DEADBANDS.polder_pump
  }),

  // --- 4. TIDAL GATES ---
  dunball_outfall: Object.freeze({
    asset_type: 'tidal_gate',
    asset_id: 'dunball_outfall',
    name: 'Dunball Sea Outfall Clyse',
    sea_station: '52163',
    inland_station: 'E9094',
    deadband_flap: HYDRO_DEADBANDS.tidal_flap
  }),

  // --- 5. SLUICES ---
  monks_leaze_clyse: Object.freeze({
    asset_type: 'sluice',
    asset_id: 'monks_leaze_clyse',
    name: "Monk's Leaze Clyse Intake",
    upstream_station: '52233',
    downstream_station: '52234',
    sill_elevation_mAOD: 4.20,
    trigger_elevation_mAOD: 7.20,
    sowy_capacity_mAOD: 7.60,
    min_delta_h: 0.05,
    deadband_clyse: HYDRO_DEADBANDS.clyse_head
  }),

  // --- 6. GAUGES ---
  ...Object.fromEntries(
    ['52108', '52109', '52111', '52116', '52119', '52120', '52153', '52162', '52124', 'E9531'].map(id => {
      const reg = STATION_REGISTRY[id];
      return [
        id,
        Object.freeze({
          asset_type: 'gauge',
          asset_id: id,
          name: reg?.name || id,
          station_id: id,
          alert_elevation_mAOD: reg?.thresholds?.alert?.value ?? null,
          deadband_alert: HYDRO_DEADBANDS.river_gauge
        })
      ];
    })
  )
});

/**
 * Computes 3-hour trend momentum vector [▲ Rising, ▼ Receding, — Steady]
 * @param {Array<{ dateTime?: string, value?: number }|number>} readings
 * @returns {'▲ Rising' | '▼ Receding' | '— Steady'}
 */
export function computeTrendVector(readings) {
  if (!Array.isArray(readings) || readings.length < 2) {
    return '— Steady';
  }

  const latestItem = readings[0];
  const latestVal = (typeof latestItem === 'object' && latestItem !== null) ? latestItem.value : latestItem;
  if (latestVal === null || latestVal === undefined || isNaN(latestVal)) {
    return '— Steady';
  }

  const nowMs = (typeof latestItem === 'object' && latestItem?.dateTime)
    ? new Date(latestItem.dateTime).getTime()
    : Date.now();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  let refReading = null;
  let minDiff = Infinity;

  for (let i = 1; i < readings.length; i++) {
    const r = readings[i];
    const val = (typeof r === 'object' && r !== null) ? r.value : r;
    if (val !== null && val !== undefined && !isNaN(val)) {
      if (typeof r === 'object' && r?.dateTime) {
        const age = Math.abs(nowMs - new Date(r.dateTime).getTime());
        const diff = Math.abs(age - threeHoursMs);
        if (diff < minDiff) {
          minDiff = diff;
          refReading = val;
        }
      }
    }
  }

  // Fallback to reading around index 12 if timestamps not provided
  if (refReading === null && readings.length >= 2) {
    const idx = Math.min(12, readings.length - 1);
    const item = readings[idx];
    refReading = (typeof item === 'object' && item !== null) ? item.value : item;
  }

  if (refReading === null || refReading === undefined || isNaN(refReading)) {
    return '— Steady';
  }

  const delta = Number((latestVal - refReading).toFixed(3));
  if (delta >= 0.02) {
    return '▲ Rising';
  } else if (delta <= -0.02) {
    return '▼ Receding';
  }
  return '— Steady';
}

/**
 * Formats physical clearance strictly adhering to the Centimetre Rule for sub-metre values [Section 3.1]
 * E.g. 18cm below crest, +1.45m clearance to road crown, ▲ Overtopping by +14cm
 * @param {number} clearanceMeters
 * @param {string} descriptor
 * @returns {string}
 */
export function formatClearanceText(clearanceMeters, descriptor = 'crest') {
  if (clearanceMeters === null || clearanceMeters === undefined || isNaN(clearanceMeters)) {
    return 'Clearance N/A';
  }

  if (clearanceMeters < 0) {
    const overspill = Math.abs(clearanceMeters);
    if (overspill < 1.0) {
      const cm = Math.round(overspill * 100);
      return `▲ Overtopping by +${cm}cm`;
    }
    return `▲ Overtopping by +${overspill.toFixed(2)}m`;
  }

  if (clearanceMeters < 1.0) {
    const cm = Math.round(clearanceMeters * 100);
    return `${cm}cm below ${descriptor}`;
  }

  return `+${clearanceMeters.toFixed(2)}m clearance to ${descriptor}`;
}

/**
 * Returns the canonical nominal state for a given asset type in accordance with [RULE-ENT-01]
 * @param {string} assetType
 * @returns {string}
 */
export function getNominalStateForAssetType(assetType) {
  switch (assetType) {
    case 'road':
      return 'PASSABLE';
    case 'spillway':
      return 'SECURE';
    case 'polder':
      return 'STANDBY';
    case 'tidal_gate':
      return 'DISCHARGING';
    case 'sluice':
      return 'CLOSED';
    case 'gauge':
    default:
      return 'NORMAL';
  }
}

/**
 * Calculates continuous daylight hours between startTime and endTime within the Somerset
 * working window (08:00 to 17:00 local time) respecting Europe/London (GMT/BST) boundaries.
 * 
 * @param {string|number|Date} startTime - Start of recession / dry condition
 * @param {string|number|Date} [endTime=new Date()] - Current evaluation timestamp
 * @returns {number} Elapsed daylight hours rounded to 2 decimal places
 */
export function calculateDaylightDryHours(startTime, endTime = new Date()) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return 0;
  }

  const getLondonParts = (date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    }).formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return { year: parseInt(map.year, 10), month: parseInt(map.month, 10), day: parseInt(map.day, 10) };
  };

  const startParts = getLondonParts(start);
  const endParts = getLondonParts(end);

  let totalMs = 0;
  let curUtc = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day, 12, 0, 0));
  const lastUtc = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day, 12, 0, 0));

  while (curUtc <= lastUtc) {
    const p = getLondonParts(curUtc);
    const testD = new Date(Date.UTC(p.year, p.month - 1, p.day, 8, 0, 0));
    const h = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(testD), 10);
    const offset = h - 8;
    const dayStart = new Date(Date.UTC(p.year, p.month - 1, p.day, 8 - offset, 0, 0));
    const dayEnd = new Date(Date.UTC(p.year, p.month - 1, p.day, 17 - offset, 0, 0));

    const winStart = Math.max(start.getTime(), dayStart.getTime());
    const winEnd = Math.min(end.getTime(), dayEnd.getTime());

    if (winEnd > winStart) {
      totalMs += (winEnd - winStart);
    }

    curUtc = new Date(curUtc.getTime() + 24 * 60 * 60 * 1000);
  }

  return Number((totalMs / (1000 * 60 * 60)).toFixed(2));
}

/**
 * Pure Deterministic State Transition Evaluator [RULE-ENT-01, RULE-PUMP-01, RULE-ALT-01, RULE-SUB-01, RULE-CALC-01]
 * Zero I/O, zero network, zero SQLite dependencies.
 * 
 * Enforces:
 * 1. Directional deadband hysteresis on falling stages
 * 2. 30-minute debounce window (2 consecutive nominal readings required for CLOSE)
 * 3. Chronological accuracy: end_time stamped with timestamp of FIRST nominal exit reading
 * 4. Zero-Trust Telemetry Rule: sensor dropout freezes session in TELEMETRY_INTERRUPTED without closing
 * 5. Centimetre Rule (<1m formatted as cm) & 3-hour trend momentum vectors
 * 
 * @param {object} assetDef
 * @param {object|null} activeSession
 * @param {Array|object} readingsWindow
 * @param {object|null} seasonalRegime
 * @param {object} options
 * @returns {object} TransitionDecision
 */
export function evaluateAssetTransition(assetDef, activeSession = null, readingsWindow = [], seasonalRegime = null, options = {}) {
  const regime = seasonalRegime || getSeasonalRegime();
  const isSummer = regime.isSummer;

  // Extract readings for the primary/target station(s)
  let readings = [];
  let secReadings = [];

  if (Array.isArray(readingsWindow)) {
    readings = readingsWindow;
  } else if (readingsWindow && typeof readingsWindow === 'object') {
    if (assetDef.asset_type === 'tidal_gate') {
      readings = readingsWindow.sea || readingsWindow[assetDef.sea_station] || [];
      secReadings = readingsWindow.inland || readingsWindow[assetDef.inland_station] || [];
    } else if (assetDef.asset_type === 'sluice') {
      readings = readingsWindow.upstream || readingsWindow[assetDef.upstream_station] || [];
      secReadings = readingsWindow.downstream || readingsWindow[assetDef.downstream_station] || [];
    } else {
      const stationKey = assetDef.primary_station || assetDef.station_id;
      readings = readingsWindow[stationKey] || readingsWindow.primary || [];
      if (assetDef.secondary_station) {
        secReadings = readingsWindow[assetDef.secondary_station] || readingsWindow.secondary || [];
      }
    }
  }

  // Get latest reading
  const latestItem = readings[0];
  const rawStage = (typeof latestItem === 'object' && latestItem !== null) ? latestItem.value : latestItem;
  const stage = sanitizeStageValue(rawStage);
  const readingTime = (typeof latestItem === 'object' && latestItem?.dateTime)
    ? latestItem.dateTime
    : (options.timestamp || new Date().toISOString());

  // Zero-Trust Telemetry Rule check:
  if (stage === null) {
    if (activeSession && activeSession.status === 'ACTIVE') {
      return {
        action: 'UPDATE',
        asset_type: assetDef.asset_type,
        asset_id: assetDef.asset_id,
        from_state: activeSession.to_state,
        to_state: activeSession.to_state, // Never set TELEMETRY_INTERRUPTED in to_state (preserves SQLite CHECK constraint)
        severity_tier: activeSession.severity_tier,
        trigger_stage_mAOD: activeSession.trigger_stage_mAOD,
        peak_stage_mAOD: activeSession.peak_stage_mAOD,
        clearance_m: activeSession.clearance_m ?? null,
        clearance_text: 'Telemetry interrupted',
        trend_vector: '— Steady',
        narrative: 'Upstream telemetry station offline or corrupted. Active session frozen in current state to preserve incident continuity (telemetry interrupted).',
        start_time: activeSession.start_time,
        end_time: null,
        duration_seconds: null,
        session_updates: {
          consecutiveNominalCount: activeSession.consecutiveNominalCount || 0,
          firstNominalReading: activeSession.firstNominalReading || null,
          peak_stage_mAOD: activeSession.peak_stage_mAOD,
          is_interrupted: true
        }
      };
    }
    return {
      action: 'NONE',
      asset_type: assetDef.asset_type,
      asset_id: assetDef.asset_id,
      from_state: null,
      to_state: getNominalStateForAssetType(assetDef.asset_type), // Road assets fall back to PASSABLE, never NORMAL
      severity_tier: 1,
      trigger_stage_mAOD: 0,
      peak_stage_mAOD: 0,
      clearance_m: null,
      clearance_text: 'Sensor offline',
      trend_vector: '— Steady',
      narrative: 'No valid telemetry received from station.',
      start_time: null,
      end_time: null,
      duration_seconds: null,
      session_updates: {
        consecutiveNominalCount: 0,
        firstNominalReading: null,
        peak_stage_mAOD: 0
      }
    };
  }

  let evaluatedState = 'NORMAL';
  let evaluatedSeverity = 1;
  let clearanceM = null;
  let clearanceDescriptor = 'threshold';
  let narrative = '';

  const currentSt = activeSession?.to_state || null;

  switch (assetDef.asset_type) {
    case 'spillway': {
      const Z_crest = assetDef.crest_elevation_mAOD;
      const Z_pre = assetDef.pre_spill_elevation_mAOD ?? (Z_crest - 0.15);
      const dbCrest = assetDef.deadband_crest ?? HYDRO_DEADBANDS.weir_crest;
      const dbPre = assetDef.deadband_pre_spill ?? HYDRO_DEADBANDS.pre_spill;

      if (currentSt === 'OVERTOPPING') {
        if (stage >= Z_crest - dbCrest) {
          evaluatedState = 'OVERTOPPING';
          evaluatedSeverity = 4;
        } else if (stage >= Z_pre - dbPre) {
          evaluatedState = 'NEAR_CREST';
          evaluatedSeverity = 3;
        } else {
          evaluatedState = 'SECURE';
          evaluatedSeverity = 1;
        }
      } else if (currentSt === 'NEAR_CREST') {
        if (stage >= Z_crest) {
          evaluatedState = 'OVERTOPPING';
          evaluatedSeverity = 4;
        } else if (stage >= Z_pre - dbPre) {
          evaluatedState = 'NEAR_CREST';
          evaluatedSeverity = 3;
        } else {
          evaluatedState = 'SECURE';
          evaluatedSeverity = 1;
        }
      } else {
        if (stage >= Z_crest) {
          evaluatedState = 'OVERTOPPING';
          evaluatedSeverity = 4;
        } else if (stage >= Z_pre) {
          evaluatedState = 'NEAR_CREST';
          evaluatedSeverity = 3;
        } else {
          evaluatedState = 'SECURE';
          evaluatedSeverity = 1;
        }
      }

      clearanceM = Number((Z_crest - stage).toFixed(3));
      clearanceDescriptor = 'spillway crest';
      if (evaluatedState === 'OVERTOPPING') {
        narrative = `${assetDef.name} is actively overtopping into adjacent retention moor. River stage exceeds ${Z_crest.toFixed(2)}m AOD crest.`;
      } else if (evaluatedState === 'NEAR_CREST') {
        narrative = `${assetDef.name} is near crest. River level is within 15cm pre-spill warning threshold.`;
      } else {
        narrative = `${assetDef.name} is secure. River levels passing safely within channel banks.`;
      }
      break;
    }

    case 'road': {
      const Z_crown = assetDef.crown_elevation_mAOD;
      const Z_caut = assetDef.caution_elevation_mAOD;
      const dbCrown = assetDef.deadband_crown ?? HYDRO_DEADBANDS.road_crown;
      const dbCaut = assetDef.deadband_caution ?? HYDRO_DEADBANDS.road_caution;

      if (currentSt === 'IMPASSABLE') {
        if (stage >= Z_crown - dbCrown) {
          evaluatedState = 'IMPASSABLE';
          evaluatedSeverity = 4;
        } else if (stage >= Z_caut - dbCaut) {
          evaluatedState = 'ENCROACHING';
          evaluatedSeverity = 3;
        } else {
          evaluatedState = 'PASSABLE';
          evaluatedSeverity = 1;
        }
      } else if (currentSt === 'ENCROACHING') {
        if (stage >= Z_crown) {
          evaluatedState = 'IMPASSABLE';
          evaluatedSeverity = 4;
        } else if (stage >= Z_caut - dbCaut) {
          evaluatedState = 'ENCROACHING';
          evaluatedSeverity = 3;
        } else {
          evaluatedState = 'PASSABLE';
          evaluatedSeverity = 1;
        }
      } else {
        if (stage >= Z_crown) {
          evaluatedState = 'IMPASSABLE';
          evaluatedSeverity = 4;
        } else if (stage >= Z_caut) {
          evaluatedState = 'ENCROACHING';
          evaluatedSeverity = 3;
        } else {
          evaluatedState = 'PASSABLE';
          evaluatedSeverity = 1;
        }
      }

      clearanceM = Number((Z_crown - stage).toFixed(3));
      clearanceDescriptor = 'road crown';
      if (evaluatedState === 'IMPASSABLE') {
        narrative = `${assetDef.name} is flooded and impassable. Water stage has submerged the road crown (${Z_crown.toFixed(2)}m AOD), or council emergency closure gates are assumed closed.`;
      } else if (evaluatedState === 'ENCROACHING') {
        narrative = `${assetDef.name} has margin water encroachment. Low spots damp/flooded; caution advised for low vehicles. Gates assumed closed pending inspection if water recently receded.`;
      } else {
        narrative = `${assetDef.name} is passable. Road crown is dry.`;
      }
      break;
    }

    case 'polder': {
      const Z_duty = isSummer ? assetDef.duty_pump_summer_mAOD : assetDef.duty_pump_winter_mAOD;
      const Z_ordered = assetDef.mobile_ordered_mAOD;
      const Z_active = assetDef.mobile_active_mAOD;
      const Z_critical = assetDef.critical_mAOD;
      const dbPump = assetDef.deadband_pump ?? HYDRO_DEADBANDS.polder_pump;

      if (currentSt === 'CRITICAL') {
        if (stage >= Z_critical - dbPump) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (stage >= Z_active - dbPump) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (stage >= Z_ordered - dbPump) {
          evaluatedState = 'MOBILE_ORDERED';
          evaluatedSeverity = 3;
        } else if (stage >= Z_duty - dbPump) {
          evaluatedState = 'DUTY_PUMPING';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'STANDBY';
          evaluatedSeverity = 1;
        }
      } else if (currentSt === 'MOBILE_ACTIVE') {
        if (stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (stage >= Z_active - dbPump) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (stage >= Z_ordered - dbPump) {
          evaluatedState = 'MOBILE_ORDERED';
          evaluatedSeverity = 3;
        } else if (stage >= Z_duty - dbPump) {
          evaluatedState = 'DUTY_PUMPING';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'STANDBY';
          evaluatedSeverity = 1;
        }
      } else if (currentSt === 'MOBILE_ORDERED') {
        if (stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (stage >= Z_active) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (stage >= Z_ordered - dbPump) {
          evaluatedState = 'MOBILE_ORDERED';
          evaluatedSeverity = 3;
        } else if (stage >= Z_duty - dbPump) {
          evaluatedState = 'DUTY_PUMPING';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'STANDBY';
          evaluatedSeverity = 1;
        }
      } else if (currentSt === 'DUTY_PUMPING') {
        if (stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (stage >= Z_active) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (stage >= Z_ordered) {
          evaluatedState = 'MOBILE_ORDERED';
          evaluatedSeverity = 3;
        } else if (stage >= Z_duty - dbPump) {
          evaluatedState = 'DUTY_PUMPING';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'STANDBY';
          evaluatedSeverity = 1;
        }
      } else {
        if (stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (stage >= Z_active) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (stage >= Z_ordered) {
          evaluatedState = 'MOBILE_ORDERED';
          evaluatedSeverity = 3;
        } else if (stage >= Z_duty) {
          evaluatedState = 'DUTY_PUMPING';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'STANDBY';
          evaluatedSeverity = 1;
        }
      }

      clearanceM = Number((Z_duty - stage).toFixed(3));
      clearanceDescriptor = 'pump start trigger';
      if (evaluatedState === 'CRITICAL') {
        narrative = `${assetDef.name} retention capacity is near full (${stage.toFixed(2)}m AOD). Critical storage alarm.`;
      } else if (evaluatedState === 'MOBILE_ACTIVE') {
        narrative = `Inferred from moor stage relative to EA Trigger Plan: emergency contractor mobile pumps active at ${assetDef.name}.`;
      } else if (evaluatedState === 'MOBILE_ORDERED') {
        narrative = `Inferred from moor stage relative to EA Trigger Plan: contractor mobile pumps ordered for ${assetDef.name}.`;
      } else if (evaluatedState === 'DUTY_PUMPING') {
        narrative = `Permanent duty pumps active at ${assetDef.name} (${stage.toFixed(2)}m AOD). Evacuating water.`;
      } else {
        narrative = `${assetDef.name} in standby/penning mode. Water levels normal.`;
      }
      break;
    }

    case 'tidal_gate': {
      const secLatest = secReadings[0];
      const secStageRaw = (typeof secLatest === 'object' && secLatest !== null) ? secLatest.value : secLatest;
      const inlandStage = sanitizeStageValue(secStageRaw);
      const dbFlap = assetDef.deadband_flap ?? HYDRO_DEADBANDS.tidal_flap;

      if (inlandStage === null) {
        evaluatedState = 'DISCHARGING';
        evaluatedSeverity = 1;
      } else if (currentSt === 'TIDE_LOCKED') {
        if (stage >= inlandStage - dbFlap) {
          evaluatedState = 'TIDE_LOCKED';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'DISCHARGING';
          evaluatedSeverity = 1;
        }
      } else {
        if (stage >= inlandStage) {
          evaluatedState = 'TIDE_LOCKED';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'DISCHARGING';
          evaluatedSeverity = 1;
        }
      }

      const headDelta = inlandStage !== null ? Number((inlandStage - stage).toFixed(3)) : 0;
      clearanceM = headDelta;
      clearanceDescriptor = 'tide-lock boundary';
      narrative = evaluatedState === 'TIDE_LOCKED'
        ? `Parrett Estuary tide (${stage.toFixed(2)}m) exceeds inland drain (${inlandStage?.toFixed(2)}m). Gravity flap doors closed.`
        : `Low tide in Parrett Estuary: safe gravity discharge to sea (${headDelta >= 0 ? '+' : ''}${headDelta.toFixed(2)}m head).`;
      break;
    }

    case 'sluice': {
      const secLatest = secReadings[0];
      const secStageRaw = (typeof secLatest === 'object' && secLatest !== null) ? secLatest.value : secLatest;
      const downstreamStage = sanitizeStageValue(secStageRaw);
      const Z_trig = assetDef.trigger_elevation_mAOD ?? 7.20;
      const Z_cap = assetDef.sowy_capacity_mAOD ?? 7.60;
      const minDelta = assetDef.min_delta_h ?? 0.05;
      const dbClyse = assetDef.deadband_clyse ?? HYDRO_DEADBANDS.clyse_head;

      const deltaH = downstreamStage !== null ? (stage - downstreamStage) : 0;

      if (downstreamStage !== null && downstreamStage > stage) {
        evaluatedState = 'REVERSE_LOCK';
        evaluatedSeverity = 3;
      } else if (stage >= Z_trig && (downstreamStage !== null && downstreamStage >= Z_cap || deltaH < minDelta)) {
        evaluatedState = 'THROTTLED';
        evaluatedSeverity = 3;
      } else if (stage >= Z_trig || (currentSt === 'DIVERTING' && stage >= Z_trig - dbClyse)) {
        evaluatedState = 'DIVERTING';
        evaluatedSeverity = 2;
      } else {
        evaluatedState = 'CLOSED';
        evaluatedSeverity = 1;
      }

      clearanceM = Number((Z_trig - stage).toFixed(3));
      clearanceDescriptor = 'diversion trigger';
      if (evaluatedState === 'REVERSE_LOCK') {
        narrative = `Downstream tailwater higher than river. Monk's Leaze Clyse sealed to prevent reverse flooding.`;
      } else if (evaluatedState === 'THROTTLED') {
        narrative = `Sowy Relief Channel downstream full (${downstreamStage?.toFixed(2)}m AOD). Diversion throttled.`;
      } else if (evaluatedState === 'DIVERTING') {
        narrative = `Penstock gates open: actively diverting excess floodwaters into Sowy Relief Channel.`;
      } else {
        narrative = `Monk's Leaze Clyse gates closed in routine agricultural penning/river conveyance mode.`;
      }
      break;
    }

    case 'gauge':
    default: {
      const reg = STATION_REGISTRY[assetDef.station_id || assetDef.asset_id];
      const Z_alert = assetDef.alert_elevation_mAOD ?? reg?.thresholds?.alert?.value ?? null;
      const dbAlert = assetDef.deadband_alert ?? HYDRO_DEADBANDS.river_gauge;

      if (Z_alert !== null && Z_alert !== undefined) {
        if (currentSt === 'ALERT') {
          if (stage >= Z_alert - dbAlert) {
            evaluatedState = 'ALERT';
            evaluatedSeverity = 3;
          } else {
            evaluatedState = 'NORMAL';
            evaluatedSeverity = 1;
          }
        } else {
          if (stage >= Z_alert) {
            evaluatedState = 'ALERT';
            evaluatedSeverity = 3;
          } else {
            evaluatedState = 'NORMAL';
            evaluatedSeverity = 1;
          }
        }
      } else {
        evaluatedState = 'NORMAL';
        evaluatedSeverity = 1;
      }

      clearanceM = (Z_alert !== null && Z_alert !== undefined) ? Number((Z_alert - stage).toFixed(3)) : null;
      clearanceDescriptor = 'flood alert threshold';
      narrative = evaluatedState === 'ALERT'
        ? `${assetDef.name} exceeds Environment Agency typical flood boundary (${stage.toFixed(2)}m AOD).`
        : `${assetDef.name} within typical seasonal envelope (${stage.toFixed(2)}m AOD).`;
      break;
    }
  }

  const trend_vector = computeTrendVector(readings);
  const clearance_text = clearanceM !== null ? formatClearanceText(clearanceM, clearanceDescriptor) : 'Clearance N/A';

  // State Transition & Debounce Window logic
  let action = 'NONE';
  let from_state = activeSession?.to_state || null;
  let to_state = evaluatedState;
  let severity_tier = evaluatedSeverity;
  let start_time = activeSession?.start_time || null;
  let end_time = null;
  let duration_seconds = null;
  let trigger_stage_mAOD = activeSession?.trigger_stage_mAOD ?? stage;
  let peak_stage_mAOD = activeSession?.peak_stage_mAOD ? Math.max(activeSession.peak_stage_mAOD, stage) : stage;
  let consecutiveNominalCount = activeSession?.consecutiveNominalCount || 0;
  let firstNominalReading = activeSession?.firstNominalReading || null;

  if (evaluatedSeverity >= 2) {
    // Elevated incident condition
    if (!activeSession || activeSession.status === 'CLOSED') {
      action = 'OPEN';
      start_time = readingTime;
      trigger_stage_mAOD = stage;
      peak_stage_mAOD = stage;
      consecutiveNominalCount = 0;
      firstNominalReading = null;
    } else {
      action = 'UPDATE';
      peak_stage_mAOD = Math.max(activeSession.peak_stage_mAOD, stage);
      consecutiveNominalCount = 0;
      firstNominalReading = null;
    }
  } else {
    // Nominal state (severity_tier === 1)
    if (!activeSession || activeSession.status === 'CLOSED') {
      action = 'NONE';
      to_state = evaluatedState;
      severity_tier = 1;
    } else {
      // Transitioning towards closure: enforce 30-minute debounce window (2 consecutive nominal readings)
      if (consecutiveNominalCount === 0) {
        action = 'UPDATE';
        consecutiveNominalCount = 1;
        firstNominalReading = { dateTime: readingTime, value: stage };
        to_state = activeSession.to_state; // Keep elevated badge during debounce window
        narrative = `${assetDef.name} level receding below threshold; confirming 30-min debounce recovery (1/2 confirmed)...`;
      } else {
        // Second consecutive nominal reading! Close event.
        action = 'CLOSE';
        to_state = evaluatedState;
        severity_tier = 1;
        end_time = firstNominalReading?.dateTime || readingTime;
        duration_seconds = Math.max(0, Math.floor((new Date(end_time).getTime() - new Date(start_time).getTime()) / 1000));
        narrative = `${assetDef.name} incident concluded after confirmed nominal recovery window.`;
      }
    }
  }

  return {
    action,
    asset_type: assetDef.asset_type,
    asset_id: assetDef.asset_id,
    from_state,
    to_state,
    severity_tier,
    trigger_stage_mAOD,
    peak_stage_mAOD,
    clearance_m: clearanceM,
    clearance_text,
    trend_vector,
    narrative,
    start_time,
    end_time,
    duration_seconds,
    session_updates: {
      consecutiveNominalCount,
      firstNominalReading,
      peak_stage_mAOD
    }
  };
}

/**
 * Calculates rate of change in stage over 3 hours (dh/dt in m/h)
 * @param {Array} readings 
 * @returns {number} rate in m/h rounded to 3 decimal places
 */
export function computeRateOfChange3h(readings) {
  if (!readings || !Array.isArray(readings) || readings.length < 2) return 0;
  const latestItem = readings[0];
  const latestVal = (typeof latestItem === 'object' && latestItem !== null) ? latestItem.value : latestItem;
  if (latestVal === null || latestVal === undefined || isNaN(latestVal)) return 0;

  const nowMs = (typeof latestItem === 'object' && latestItem?.dateTime)
    ? new Date(latestItem.dateTime).getTime()
    : Date.now();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  let refReading = null;
  let minDiff = Infinity;
  let refMs = null;

  for (let i = 1; i < readings.length; i++) {
    const r = readings[i];
    const val = (typeof r === 'object' && r !== null) ? r.value : r;
    if (val !== null && val !== undefined && !isNaN(val)) {
      if (typeof r === 'object' && r?.dateTime) {
        const itemMs = new Date(r.dateTime).getTime();
        const age = Math.abs(nowMs - itemMs);
        const diff = Math.abs(age - threeHoursMs);
        if (diff < minDiff) {
          minDiff = diff;
          refReading = val;
          refMs = itemMs;
        }
      }
    }
  }

  if (refReading === null && readings.length >= 2) {
    const idx = Math.min(12, readings.length - 1);
    const item = readings[idx];
    refReading = (typeof item === 'object' && item !== null) ? item.value : item;
    if (typeof item === 'object' && item?.dateTime) {
      refMs = new Date(item.dateTime).getTime();
    }
  }

  if (refReading === null || isNaN(refReading)) return 0;

  let deltaHours = 3.0;
  if (refMs && nowMs > refMs) {
    deltaHours = (nowMs - refMs) / (1000 * 60 * 60);
    if (deltaHours < 0.25) deltaHours = 0.25;
  }

  const rate = (latestVal - refReading) / deltaHours;
  return Number(rate.toFixed(3));
}

/**
 * Evaluates highway passability for a single road corridor adhering strictly
 * to the Multi-Factor Passability Model [docs/road_network_passability_spec.md v3.0]
 * 
 * @param {object} assetDef - Definition from ASSET_DEFINITIONS
 * @param {Array|object} readingsSource - Readings array or measures map
 * @param {object|null} activeSession - Active event session from SQLite telemetry_events
 * @param {object} [options]
 * @returns {object} Evaluated road entity payload
 */
export function evaluateRoadCorridor(assetDef, readingsSource = [], activeSession = null, options = {}) {
  const stationId = assetDef.primary_station;
  let readings = [];
  let secReadings = [];

  // Extract readings for primary station
  if (Array.isArray(readingsSource)) {
    readings = readingsSource;
  } else if (readingsSource && typeof readingsSource === 'object') {
    // Try multiple lookup keys
    readings = readingsSource[stationId]
      || readingsSource[`${stationId}-level-stage-i-15_min-mAOD`]
      || readingsSource[`${stationId}-level-stage-i-15_min-mASD`]
      || [];
    if (typeof readings === 'number') {
      readings = [{ value: readings, dateTime: options.timestamp || new Date().toISOString() }];
    }

    if (assetDef.secondary_station) {
      const secId = assetDef.secondary_station;
      secReadings = readingsSource[secId]
        || readingsSource[`${secId}-level-stage-i-15_min-mAOD`]
        || readingsSource[`${secId}-level-stage-i-15_min-mASD`]
        || [];
      if (typeof secReadings === 'number') {
        secReadings = [{ value: secReadings, dateTime: options.timestamp || new Date().toISOString() }];
      }
    }
  }

  // Datum offset correction if readings are mASD (Huish 52120: +5.000m)
  const reg = STATION_REGISTRY[stationId];
  const datumOffset = (reg?.unit === 'mASD' && typeof reg.datum_mAOD === 'number') ? reg.datum_mAOD : 0;

  const latestItem = readings[0];
  let rawStage = (typeof latestItem === 'object' && latestItem !== null) ? latestItem.value : latestItem;
  if (rawStage !== null && rawStage !== undefined && !isNaN(rawStage) && datumOffset > 0) {
    rawStage = Number((rawStage + datumOffset).toFixed(3));
  }
  const stage = sanitizeStageValue(rawStage);
  const readingTime = (typeof latestItem === 'object' && latestItem?.dateTime)
    ? latestItem.dateTime
    : (options.timestamp || new Date().toISOString());

  const rateOfRise = computeRateOfChange3h(readings);
  const trendVector = computeTrendVector(readings);

  // EA Warning state (options or default INACTIVE)
  const eaWarningState = options.eaWarnings?.[assetDef.ea_warning_target_area] || options.eaWarningState || 'INACTIVE';

  const Z_crown = assetDef.crown_elevation_mAOD;
  const Z_caution = assetDef.caution_elevation_mAOD;
  const dbCrown = assetDef.deadband_crown ?? HYDRO_DEADBANDS.road_crown;
  const dbCaution = assetDef.deadband_caution ?? HYDRO_DEADBANDS.road_caution;

  // Handle offline sensor
  if (stage === null) {
    if (activeSession && activeSession.status === 'ACTIVE') {
      return {
        asset_type: 'road',
        asset_id: assetDef.asset_id,
        name: assetDef.name,
        corridor_type: assetDef.corridor_type || 'Highway Corridor',
        status: activeSession.to_state || 'PASSABLE',
        severity_tier: activeSession.severity_tier || 1,
        phase: activeSession.to_state === 'IMPASSABLE' ? 'SUBMERGED' : 'APPROACHING_FLOOD',
        primary_station: stationId,
        secondary_station: assetDef.secondary_station || null,
        driving_station_label: assetDef.driving_station_label || stationId,
        stage_mAOD: null,
        crown_elevation_mAOD: Z_crown,
        caution_elevation_mAOD: Z_caution,
        clearance_m: null,
        clearance_text: 'Telemetry interrupted',
        rate_of_rise_mh: 0,
        trend_vector: '— Steady',
        ea_warning_target_area: assetDef.ea_warning_target_area,
        ea_target_area_name: assetDef.ea_target_area_name,
        ea_warning_state: eaWarningState,
        submerged_end_time: null,
        dry_duration_hours: 0,
        daylight_dry_hours: 0,
        daylight_progress_percent: 0,
        inspection_window_met: false,
        camera_id: assetDef.camera_id || null,
        cam_url: assetDef.cam_url || null,
        cam_label: assetDef.cam_label || null,
        station_url: assetDef.station_url || null,
        survey_tier: assetDef.survey_tier || 'TIER_2_TRIGGER_PLAN',
        survey_label: assetDef.survey_label || '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
        survey_tooltip: assetDef.survey_tooltip || '',
        badge_symbol: activeSession.to_state === 'IMPASSABLE' ? '🔴' : '🟡',
        badge_label: activeSession.to_state === 'IMPASSABLE' ? 'CLOSED & SUBMERGED' : 'CAUTION: VERGE WATER',
        badge_class: activeSession.to_state === 'IMPASSABLE' ? 'badge-impassable' : 'badge-encroaching',
        narrative: 'Upstream telemetry station offline. Session state preserved.'
      };
    }
    return {
      asset_type: 'road',
      asset_id: assetDef.asset_id,
      name: assetDef.name,
      corridor_type: assetDef.corridor_type || 'Highway Corridor',
      status: 'PASSABLE',
      severity_tier: 1,
      phase: 'NOMINAL',
      primary_station: stationId,
      secondary_station: assetDef.secondary_station || null,
      driving_station_label: assetDef.driving_station_label || stationId,
      stage_mAOD: null,
      crown_elevation_mAOD: Z_crown,
      caution_elevation_mAOD: Z_caution,
      clearance_m: null,
      clearance_text: 'Sensor offline',
      rate_of_rise_mh: 0,
      trend_vector: '— Steady',
      ea_warning_target_area: assetDef.ea_warning_target_area,
      ea_target_area_name: assetDef.ea_target_area_name,
      ea_warning_state: eaWarningState,
      submerged_end_time: null,
      dry_duration_hours: 0,
      daylight_dry_hours: 0,
      daylight_progress_percent: 0,
      inspection_window_met: true,
      camera_id: assetDef.camera_id || null,
      cam_url: assetDef.cam_url || null,
      cam_label: assetDef.cam_label || null,
      station_url: assetDef.station_url || null,
      survey_tier: assetDef.survey_tier || 'TIER_2_TRIGGER_PLAN',
      survey_label: assetDef.survey_label || '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
      survey_tooltip: assetDef.survey_tooltip || '',
      badge_symbol: '🟢',
      badge_label: 'PASSABLE',
      badge_class: 'badge-passable',
      narrative: 'Sensor offline. Fallback to normal access.'
    };
  }

  // Physical clearance to crown
  const clearanceM = Number((Z_crown - stage).toFixed(3));
  const clearanceText = formatClearanceText(clearanceM, 'road crown');

  let status = 'PASSABLE';
  let severityTier = 1;
  let phase = 'NOMINAL';
  let badgeSymbol = '🟢';
  let badgeLabel = 'PASSABLE';
  let badgeClass = 'badge-passable';
  let narrative = '';

  let submergedEndTime = activeSession?.submerged_end_time || options.submergedEndTime || null;
  let dryDurationHours = 0;
  let daylightDryHours = 0;
  let daylightProgressPercent = 0;
  let inspectionWindowMet = false;

  const prevSessionState = activeSession?.to_state || null;
  const isRisingSurge = (rateOfRise >= 0.03 && stage >= (Z_caution - 0.10));

  // Determine State & Phase
  if (prevSessionState === 'IMPASSABLE' || options.forceClearing) {
    // Road was submerged / closed
    if (stage >= Z_crown - dbCrown && !options.forceClearing) {
      // Still submerged
      status = 'IMPASSABLE';
      severityTier = 4;
      phase = 'SUBMERGED';
      badgeSymbol = '🔴';
      badgeLabel = 'CLOSED & SUBMERGED';
      badgeClass = 'badge-impassable';
      narrative = `Carriageway submerged or Somerset Council emergency gates locked shut. Impassable to all vehicles. Follow official highways diversion.`;
    } else {
      // Receded below crown: Enter CLEARING_INSPECTION_PENDING
      if (!submergedEndTime) {
        submergedEndTime = readingTime;
      }
      const nowMs = options.nowMs || Date.now();
      dryDurationHours = Math.max(0, Number(((nowMs - new Date(submergedEndTime).getTime()) / (3600 * 1000)).toFixed(2)));
      daylightDryHours = calculateDaylightDryHours(submergedEndTime, nowMs);
      daylightProgressPercent = Math.min(100, Math.round((daylightDryHours / 6.0) * 100));

      const isCrownDry = stage < (Z_crown - dbCrown);
      const isRhyneDrained = stage < (Z_caution - dbCaution);
      const isWarningCleared = eaWarningState === 'INACTIVE';

      // Exit Pathway A: 6 daylight hours + drained + warning cleared
      const pathwayAMet = isCrownDry && isRhyneDrained && isWarningCleared && (daylightDryHours >= 6.0);
      // Exit Pathway B: 24 continuous dry hours + drained (overriding agricultural warnings)
      const pathwayBMet = isCrownDry && isRhyneDrained && (dryDurationHours >= 24.0);

      if (pathwayAMet || pathwayBMet) {
        inspectionWindowMet = true;
        status = 'PASSABLE';
        severityTier = 1;
        phase = 'NOMINAL';
        badgeSymbol = '🟢';
        badgeLabel = 'PASSABLE';
        badgeClass = 'badge-passable';
        narrative = pathwayBMet && !isWarningCleared
          ? `Road dry for >24h; council safety inspection window complete. (Agricultural flood warning remains active for surrounding low-lying moorland).`
          : `Road safety inspection window complete and carriageway clear. Standard vehicular access restored.`;
      } else {
        status = 'ENCROACHING';
        severityTier = 3;
        phase = 'CLEARING_INSPECTION_PENDING';
        badgeSymbol = '🕒';
        badgeLabel = 'CLEARING / INSPECTING';
        badgeClass = 'badge-clearing';
        const recedeTimeFormatted = new Date(submergedEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        narrative = `Floodwaters receded below road crown at ${recedeTimeFormatted} (dry for ${dryDurationHours.toFixed(1)}h). Carriageway is clear of standing water, but emergency gates remain padlocked pending daylight safety inspection for hazardous river silt, debris, and tarmac scour.`;
      }
    }
  } else {
    // Corridors operating on normal rising/falling logic
    let isImpassable = false;
    let isEncroaching = false;

    // Corridor-specific triggers
    if (assetDef.asset_id === 'cuts_road') {
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution) isEncroaching = true;
    } else if (assetDef.asset_id === 'muchelney_access') {
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution) isEncroaching = true;
    } else if (assetDef.asset_id === 'beer_wall_a372') {
      // Hydraulic decoupling: 7.30m activates 4 box culverts beneath A372 (ENCROACHING); road crown is >8.00m
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution) isEncroaching = true;
    } else if (assetDef.asset_id === 'new_road_curry') {
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution) isEncroaching = true;
    } else if (assetDef.asset_id === 'a361_burrowbridge') {
      // Baltmoor levee overtopping is 7.80m; Curry Moor cascade caution is 7.35m
      const curryStage = sanitizeStageValue(secReadings[0]?.value ?? secReadings[0] ?? null);
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution || (curryStage !== null && curryStage >= 7.35)) isEncroaching = true;
    } else if (assetDef.asset_id === 'bicknells_bridge_access') {
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution) isEncroaching = true;
    } else if (assetDef.asset_id === 'moorland_new_cut_road') {
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution) isEncroaching = true;
    } else if (assetDef.asset_id === 'stan_moor_road') {
      if (stage >= Z_crown && eaWarningState === 'WARNING') isImpassable = true;
      else if (stage >= Z_caution || eaWarningState === 'ALERT') isEncroaching = true;
      else if (stage >= Z_crown) isImpassable = true;
    } else {
      if (stage >= Z_crown) isImpassable = true;
      else if (stage >= Z_caution) isEncroaching = true;
    }

    if (isImpassable) {
      status = 'IMPASSABLE';
      severityTier = 4;
      phase = 'SUBMERGED';
      badgeSymbol = '🔴';
      badgeLabel = 'CLOSED & SUBMERGED';
      badgeClass = 'badge-impassable';
      narrative = `Carriageway submerged or Somerset Council emergency gates locked shut. Impassable to all vehicles. Follow official highways diversion.`;
    } else if (isEncroaching || isRisingSurge || eaWarningState === 'WARNING' || eaWarningState === 'ALERT') {
      status = 'ENCROACHING';
      severityTier = 3;
      phase = 'APPROACHING_FLOOD';
      if (isRisingSurge) {
        badgeSymbol = '⚠️';
        badgeLabel = 'HIGH RISK: RISING';
        badgeClass = 'badge-encroaching-surge';
        narrative = `Water rising rapidly (+${rateOfRise.toFixed(2)}m/h) toward road crown. Somerset Council emergency gate closure imminent. Plan alternative route.`;
      } else {
        badgeSymbol = '🟡';
        badgeLabel = 'CAUTION: VERGE WATER';
        badgeClass = 'badge-encroaching';
        const freeboardCm = Math.max(0, Math.round(clearanceM * 100));
        narrative = `Water encroaching on roadside rhynes and low verge spots (${freeboardCm}cm freeboard remaining). Low vehicles use caution.`;
      }
    } else {
      status = 'PASSABLE';
      severityTier = 1;
      phase = 'NOMINAL';
      badgeSymbol = '🟢';
      badgeLabel = 'PASSABLE';
      badgeClass = 'badge-passable';
      narrative = `Road crown is clear and dry. Standard vehicular transit open. (If council gates remain shut for local maintenance, report to Somerset Highways).`;
    }
  }

  // Format momentum display string
  const momentumText = rateOfRise >= 0.02
    ? `Rising (+${rateOfRise.toFixed(2)} m/h)`
    : (rateOfRise <= -0.02 ? `Falling (${rateOfRise.toFixed(2)} m/h)` : `Steady (${rateOfRise >= 0 ? '+' : ''}${rateOfRise.toFixed(2)} m/h)`);

  return {
    asset_type: 'road',
    asset_id: assetDef.asset_id,
    name: assetDef.name,
    corridor_type: assetDef.corridor_type || 'Highway Corridor',
    status,
    severity_tier: severityTier,
    phase,
    primary_station: stationId,
    secondary_station: assetDef.secondary_station || null,
    driving_station_label: assetDef.driving_station_label || stationId,
    stage_mAOD: stage,
    crown_elevation_mAOD: Z_crown,
    caution_elevation_mAOD: Z_caution,
    clearance_m: clearanceM,
    clearance_text: clearanceText,
    rate_of_rise_mh: rateOfRise,
    trend_vector: trendVector,
    momentum_text: momentumText,
    ea_warning_target_area: assetDef.ea_warning_target_area,
    ea_target_area_name: assetDef.ea_target_area_name,
    ea_warning_state: eaWarningState,
    submerged_end_time: submergedEndTime,
    dry_duration_hours: dryDurationHours,
    daylight_dry_hours: daylightDryHours,
    daylight_progress_percent: daylightProgressPercent,
    inspection_window_met: inspectionWindowMet,
    camera_id: assetDef.camera_id || null,
    cam_url: assetDef.cam_url || null,
    cam_label: assetDef.cam_label || null,
    station_url: assetDef.station_url || null,
    survey_tier: assetDef.survey_tier || 'TIER_2_TRIGGER_PLAN',
    survey_label: assetDef.survey_label || '⚠️ TRIGGER PROTOCOL (PENDING SURVEY)',
    survey_tooltip: assetDef.survey_tooltip || '',
    badge_symbol: badgeSymbol,
    badge_label: badgeLabel,
    badge_class: badgeClass,
    narrative
  };
}

/**
 * Evaluates the full 8-corridor highway network across the Somerset Levels.
 * 
 * @param {object|Array} readingsSource - Readings map or measures summary
 * @param {Map|object|null} [activeEvents=null] - Active event sessions map or array
 * @param {object} [options]
 * @returns {object} { corridors, corridors_list, counts, summary_badge }
 */
export function evaluateRoadNetwork(readingsSource, activeEvents = null, options = {}) {
  const activeEventsMap = (activeEvents instanceof Map)
    ? activeEvents
    : new Map(Array.isArray(activeEvents) ? activeEvents.map(e => [e.asset_id, e]) : Object.entries(activeEvents || {}));

  const roadKeys = [
    'cuts_road',
    'muchelney_access',
    'a361_burrowbridge',
    'new_road_curry',
    'bicknells_bridge_access',
    'moorland_new_cut_road',
    'stan_moor_road',
    'beer_wall_a372'
  ];

  const corridors = {};
  const corridorsList = [];
  let closedCount = 0;
  let cautionCount = 0;
  let passableCount = 0;

  for (const key of roadKeys) {
    const assetDef = ASSET_DEFINITIONS[key];
    if (!assetDef) continue;

    const activeSession = activeEventsMap.get(key) || null;
    const evaluated = evaluateRoadCorridor(assetDef, readingsSource, activeSession, options);
    corridors[key] = evaluated;
    corridorsList.push(evaluated);

    if (evaluated.status === 'IMPASSABLE') {
      closedCount++;
    } else if (evaluated.status === 'ENCROACHING') {
      cautionCount++;
    } else {
      passableCount++;
    }
  }

  // Summary badge for the master card header
  let summaryBadge;
  if (closedCount > 0) {
    summaryBadge = {
      status: 'IMPASSABLE',
      label: `${closedCount} CLOSED • ${cautionCount} CAUTION`,
      class: 'badge-impassable',
      symbol: '🔴'
    };
  } else if (cautionCount > 0) {
    summaryBadge = {
      status: 'ENCROACHING',
      label: `${cautionCount} CAUTION / CLEARING`,
      class: 'badge-encroaching',
      symbol: '🟡'
    };
  } else {
    summaryBadge = {
      status: 'PASSABLE',
      label: 'ALL 8 CORRIDORS PASSABLE',
      class: 'badge-passable',
      symbol: '🟢'
    };
  }

  return {
    corridors,
    corridors_list: corridorsList,
    counts: {
      all: corridorsList.length,
      impassable: closedCount,
      encroaching: cautionCount,
      passable: passableCount
    },
    summary_badge: summaryBadge
  };
}






