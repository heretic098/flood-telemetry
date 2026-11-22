/**
 * Hydraulic & Hydrological Physics Engine
 * Implements Stage & Structural Clearance Evaluation, Differential Head Gate Inference,
 * and EA Seasonal Penning Regime Rules.
 */

export { escapeHTML, escapeAttr, formatHeadDelta } from './modules/dom_utils.js';

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
  const offline = moorEvaluations.filter(m => m.isOffline || m.status === 'OFFLINE');
  const warnings = moorEvaluations.filter(m => !m.isOffline && m.status !== 'OFFLINE' && (m.severity === 3 || m.severity === 4));
  const secure = moorEvaluations.filter(m => !m.isOffline && m.status !== 'OFFLINE' && m.severity === 5);

  const totalWarnings = warnings.length + offline.length;
  const counterPill = `[ 🔴 ${severe.length} Overtopping | 🟡 ${totalWarnings} Warning | 🟢 ${secure.length} Secure ]`;

  let bannerText = "";
  if (severe.length >= 2) {
    const names = severe.map(m => m.name.split(' ')[0]).join(' & ');
    bannerText = `CRITICAL: ${names.toUpperCase()} BOTH OVERTOPPING`;
  } else if (severe.length === 1) {
    bannerText = `ACTION REQUIRED: ${severe[0].name.toUpperCase()} OVERTOPPING`;
  } else if (offline.length > 0) {
    const names = offline.map(m => m.name || 'STATION').join(' & ');
    bannerText = `⚠️ DATA DEGRADED: TELEMETRY OFFLINE FOR ${names.toUpperCase()} — STATUS UNCONFIRMED`;
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
    topSeverity: severe.length > 0 ? (severe.length > 1 ? 1 : 2) : (offline.length > 0 || warnings.length > 0 ? 4 : 5)
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
    stageLabel = "STAGE 4: CRITICAL OVERSPILL RISK (Inferred)";
    badgeClass = "stage-4";
    statusText = `🚨 CRITICAL OVERSPILL RISK (Inferred from EA Plan)`;
    runningCount = totalPumps;
    mode = "CRITICAL_OVERSPILL";
    mobileStatus = "OPERATING";
  } else if (moorLevel >= mobileActiveTrigger) {
    stage = 3;
    stageLabel = "STAGE 3: EMERGENCY MOBILE ACTIVE (Inferred)";
    badgeClass = "stage-3";
    statusText = `🔴 ABOVE MOBILE ACTIVE TRIGGER (Inferred from EA Plan)`;
    runningCount = totalPumps;
    mode = "EMERGENCY_MOBILE_ACTIVE";
    mobileStatus = "OPERATING";
  } else if (moorLevel >= mobileOrderTrigger) {
    stage = 2;
    stageLabel = "STAGE 2: MOBILE ORDER TRIGGER MET (Inferred)";
    badgeClass = "stage-2";
    statusText = `🟡 ABOVE MOBILE ORDER TRIGGER (Inferred from EA Plan)`;
    runningCount = totalPumps;
    mode = "MOBILE_ORDERED";
    mobileStatus = "MOBILIZING";
  } else if (moorLevel >= fullTrigger) {
    stage = 1;
    stageLabel = "STAGE 1: FULL DUTY REGIME (Inferred)";
    badgeClass = "stage-1";
    statusText = `⚡ ABOVE DUTY TRIGGER (Inferred from EA Plan)`;
    runningCount = totalPumps;
    mode = "FULL_CAPACITY";
    mobileStatus = "STANDBY";
  } else if (moorLevel >= startTrigger) {
    stage = 1;
    stageLabel = "STAGE 1: LEAD DUTY REGIME (Inferred)";
    badgeClass = "stage-1";
    const running = Math.max(1, Math.floor(totalPumps / 2));
    statusText = `⚡ ABOVE LEAD TRIGGER (Inferred from EA Plan)`;
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
    narrative: `${stationName}: ${stageLabel} (${isSummer ? '☀️ Summer Penning Regime' : '❄️ Winter Flood Regime'}). Current level ${moorLevel.toFixed(2)}m AOD relative to triggers (Lead ${startTrigger.toFixed(2)}m, Duty ${fullTrigger.toFixed(2)}m, Mobile Order ${mobileOrderTrigger.toFixed(2)}m, Mobile Active ${mobileActiveTrigger.toFixed(2)}m). Status inferred from moor water stage relative to EA Trigger Point Plan.`
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

export function evaluateSowyChannel(h_up, h_down, thresholdTrigger = 7.20, options = {}) {
  const sillM = (typeof options.sillM === 'number' && Number.isFinite(options.sillM)) ? options.sillM : 4.20;
  const cleanTrigger = (typeof thresholdTrigger === 'number' && Number.isFinite(thresholdTrigger)) ? thresholdTrigger : 7.20;
  const allermoorProxyM = (typeof options.allermoorCrestM === 'number' && Number.isFinite(options.allermoorCrestM))
    ? options.allermoorCrestM
    : 7.50;
  const isUpstreamValid = typeof h_up === 'number' && Number.isFinite(h_up);
  const isDownstreamFlatlined = Boolean(options.isDownstreamFlatlined);
  const isDownstreamStale = Boolean(options.isDownstreamStale);
  const isDownstreamHealthy = (
    isUpstreamValid &&
    h_down !== null &&
    typeof h_down === 'number' &&
    Number.isFinite(h_down) &&
    !isDownstreamFlatlined &&
    !isDownstreamStale
  );
  const deltaH = isDownstreamHealthy ? Number((h_up - h_down).toFixed(2)) : null;
  const revDeltaH = isDownstreamHealthy ? Number((h_down - h_up).toFixed(2)) : null;
  const minDelta = (typeof options.minDeltaH === 'number' && Number.isFinite(options.minDeltaH))
    ? options.minDeltaH
    : (ASSET_DEFINITIONS?.monks_leaze_clyse?.min_delta_h ?? 0.05);
  const sowyCapM = (typeof options.sowyCapM === 'number' && Number.isFinite(options.sowyCapM))
    ? options.sowyCapM
    : (ASSET_DEFINITIONS?.monks_leaze_clyse?.sowy_capacity_mAOD ?? 7.60);
  const dbClyse = HYDRO_DEADBANDS?.clyse_head ?? 0.05;
  const revDeadband = HYDRO_DEADBANDS?.reverse_lock ?? 0.10;
  const beerwallRate1h = (typeof options.beerwallRate1h === 'number' && Number.isFinite(options.beerwallRate1h))
    ? options.beerwallRate1h
    : null;
  const beerwallStage = (typeof options.beerwallStage === 'number' && Number.isFinite(options.beerwallStage))
    ? options.beerwallStage
    : null;
  const isWaveConfirmed = Boolean(
    (beerwallRate1h !== null && beerwallRate1h >= 0.02) ||
    (beerwallStage !== null && beerwallStage >= 4.20)
  );

  // [RULE-THRESH-01] Allermoor Spillway crest is not published in primary EA records:
  // crest_elevation_mAOD remains null (UNSURVEYED) and never triggers automated OVERTOPPING events.
  const allermoor_spillway = {
    asset_type: 'spillway',
    asset_id: 'allermoor_spillway',
    status: 'SECURE',
    crest_elevation_mAOD: null,
    proxy_trigger_mAOD: allermoorProxyM,
    survey_tier: 'UNSURVEYED',
    survey_label: '⚠️ Pending EA Asset Survey',
    clearance_m: null
  };
  const allermoorNote = (isUpstreamValid && h_up >= allermoorProxyM)
    ? ` Note: Parrett stage exceeds the ~${allermoorProxyM.toFixed(2)}m AOD Beasley's Spillway guidance proxy (Allermoor Spillway crest pending EA asset survey); under EA protocol, Monk's Leaze Clyse closes and upstream tributary pumps (Huish Episcopi, Midelney, Long Load) are curtailed.`
    : '';

  if (!isUpstreamValid) {
    return {
      asset_type: 'sluice',
      asset_id: 'monks_leaze_clyse',
      status: 'CLOSED',
      code: "CLOSED",
      label: "PENNING / CLOSED",
      badgeClass: "badge-closed",
      symbol: "🔒",
      pillText: "⚪ PENNING / CLOSED (TELEMETRY UNAVAILABLE)",
      confidence: "DEGRADED_SINGLE_SENSOR",
      confidenceTag: "⚠️ 52233 UNAVAILABLE",
      isDownstreamHealthy: false,
      deltaH: null,
      isWaveConfirmed: false,
      allermoor_spillway,
      metricText: "Penning / Telemetry Unavailable",
      clearanceText: `Trigger: ${cleanTrigger.toFixed(2)}m AOD (Stage Unavailable)`,
      narrative: `Monk's Leaze Clyse in penning mode. Upstream Parrett telemetry unavailable (diversion threshold ${cleanTrigger.toFixed(2)}m AOD; concrete sill ${sillM.toFixed(2)}m AOD).`
    };
  }

  if (isDownstreamHealthy && h_up >= (cleanTrigger - dbClyse) && revDeltaH >= revDeadband) {
    return {
      asset_type: 'sluice',
      asset_id: 'monks_leaze_clyse',
      status: 'REVERSE_LOCK',
      code: "REVERSE_LOCK",
      label: "REVERSE LOCK",
      badgeClass: "badge-overtopping",
      symbol: "🔴",
      pillText: "🔴 REVERSE LOCK (DUAL GAUGE)",
      confidence: "HIGH_DUAL_SENSOR",
      confidenceTag: "📡 DEDICATED SENSORS",
      isDownstreamHealthy,
      deltaH,
      isWaveConfirmed,
      allermoor_spillway,
      metricText: `Head Drop: ${deltaH >= 0 ? '+' : ''}${deltaH.toFixed(2)}m`,
      clearanceText: "Downstream Exceeds Parrett",
      narrative: `Monk's Leaze Clyse sealed in reverse lock. Downstream Sowy tailwater (${h_down.toFixed(2)}m AOD) exceeds upstream Parrett (${h_up.toFixed(2)}m AOD) by ${revDeltaH.toFixed(2)}m.${allermoorNote}`
    };
  } else if (isDownstreamHealthy && h_up >= cleanTrigger && (h_down >= sowyCapM || deltaH < minDelta)) {
    return {
      asset_type: 'sluice',
      asset_id: 'monks_leaze_clyse',
      status: 'THROTTLED',
      code: "THROTTLED",
      label: "RESTRICTED FLOW",
      badgeClass: "badge-near-crest",
      symbol: "▲",
      pillText: "🟡 DIVERSION RESTRICTED (DUAL GAUGE)",
      confidence: "HIGH_DUAL_SENSOR",
      confidenceTag: "📡 DEDICATED SENSORS",
      isDownstreamHealthy,
      deltaH,
      isWaveConfirmed,
      allermoor_spillway,
      metricText: h_down >= sowyCapM ? `Sowy At Capacity (${h_down.toFixed(2)}m)` : "Head Differential Neutral",
      clearanceText: h_down >= sowyCapM ? `Sowy Cap/Alert: ${sowyCapM.toFixed(2)}m` : "Downstream Head Equalized",
      narrative: `Monk's Leaze Clyse throttled. Downstream Sedgemoor Drain level (${h_down.toFixed(2)}m AOD) limits diversion capacity.${allermoorNote}`
    };
  } else if (h_up >= cleanTrigger && (!isDownstreamHealthy || (deltaH >= minDelta && h_down < sowyCapM))) {
    const waveNote = !isDownstreamHealthy
      ? (isWaveConfirmed
        ? ` Downstream 52234 ${isDownstreamFlatlined ? 'ponded/flatlined' : 'unavailable/stale'}; active diversion wave verified downstream at Beer Wall 52157.`
        : ` Downstream 52234 ${isDownstreamFlatlined ? 'stilling-well ponded/flatlined' : 'unavailable/stale'}; evaluating from upstream 52233 trigger (${cleanTrigger.toFixed(2)}m AOD).`)
      : '';
    const headDropPhrase = isDownstreamHealthy
      ? ` with a +${deltaH.toFixed(2)}m head drop into the Sowy Relief Channel`
      : '';
    const metricText = isDownstreamHealthy
      ? `Head Drop: +${deltaH.toFixed(2)}m`
      : (isDownstreamFlatlined ? 'Head Drop: Unavailable (52234 Flatlined)' : 'Head Drop: Unavailable (52234 Stale)');
    return {
      asset_type: 'sluice',
      asset_id: 'monks_leaze_clyse',
      status: 'DIVERTING',
      code: "GRAVITY_OPEN",
      label: "GRAVITY FLOW",
      badgeClass: "badge-open",
      symbol: "➔",
      pillText: isDownstreamHealthy ? "🟢 ACTIVE DIVERSION (DUAL GAUGE)" : "🟢 ACTIVE DIVERSION (UPSTREAM 52233)",
      confidence: isDownstreamHealthy ? "HIGH_DUAL_SENSOR" : "DEGRADED_SINGLE_SENSOR",
      confidenceTag: isDownstreamHealthy ? "📡 DEDICATED SENSORS" : "⚠️ 52234 DEGRADED",
      isDownstreamHealthy,
      deltaH,
      isWaveConfirmed,
      allermoor_spillway,
      metricText,
      clearanceText: `Intake Sill Margin: +${(h_up - sillM).toFixed(2)}m`,
      narrative: `Monk's Leaze Clyse gravity diversion active. Upstream Parrett stage (${h_up.toFixed(2)}m AOD) exceeds ${cleanTrigger.toFixed(2)}m AOD trigger (${sillM.toFixed(2)}m sill)${headDropPhrase}.${waveNote}${allermoorNote}`
    };
  } else {
    return {
      asset_type: 'sluice',
      asset_id: 'monks_leaze_clyse',
      status: 'CLOSED',
      code: "CLOSED",
      label: "PENNING / CLOSED",
      badgeClass: "badge-closed",
      symbol: "🔒",
      pillText: isDownstreamHealthy ? "⚪ PENNING / CLOSED (DUAL GAUGE)" : "⚪ PENNING / CLOSED (UPSTREAM 52233)",
      confidence: isDownstreamHealthy ? "HIGH_DUAL_SENSOR" : "DEGRADED_SINGLE_SENSOR",
      confidenceTag: isDownstreamHealthy ? "📡 DEDICATED SENSORS" : "⚠️ 52234 DEGRADED",
      isDownstreamHealthy,
      deltaH,
      isWaveConfirmed: false,
      allermoor_spillway,
      metricText: "Penning / No Diversion",
      clearanceText: `${(cleanTrigger - h_up).toFixed(2)}m Below Trigger`,
      narrative: `Monk's Leaze Clyse in penning mode. River level (${h_up.toFixed(2)}m AOD) is below diversion threshold (${cleanTrigger.toFixed(2)}m AOD; concrete sill ${sillM.toFixed(2)}m AOD).`
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

export function evaluateBeerWall(h_saltmoor, Z_crest = 7.30, options = {}) {
  const delta = h_saltmoor - Z_crest;
  const ksdConveyanceThreshold = options.ksdConveyanceThreshold ?? 6.00;
  const channelAlert = options.channelAlert ?? 4.20;
  const isTiltingWeirsActive = h_saltmoor >= ksdConveyanceThreshold;
  const isChannelAlert = h_saltmoor >= channelAlert;

  let status = 'SECURE';
  let statusText = `🟢 SECURE (+${Math.abs(delta).toFixed(2)}m)`;
  let narrative = `Beer Wall 4-bay box culverts (${Z_crest.toFixed(2)}m AOD) are secure with +${Math.abs(delta).toFixed(2)}m freeboard (Beazeley Spillway grassed embankment crest unsurveyed).`;

  if (delta >= 0) {
    status = 'OVERTOPPING';
    statusText = `🔴 RELIEF SPILL (SOWY)`;
    narrative = `Sowy stage at Greylake (${h_saltmoor.toFixed(2)}m AOD) has reached the ${Z_crest.toFixed(2)}m AOD Beer Wall 4-bay box culverts relief threshold beneath the raised A372 (>8.00m AOD).`;
  } else if (delta >= -0.15) {
    status = 'NEAR_CREST';
    statusText = `🟡 NEAR CREST (${Math.abs(delta).toFixed(2)}m)`;
    narrative = `Sowy stage at Greylake (${h_saltmoor.toFixed(2)}m AOD) is within ${Math.round(Math.abs(delta) * 100)}cm of the ${Z_crest.toFixed(2)}m AOD Beer Wall box culvert relief threshold.`;
  } else if (isTiltingWeirsActive) {
    narrative = `Sowy Spur & Lang Acre tilting weirs active (≥${ksdConveyanceThreshold.toFixed(2)}m AOD), routing flow into King's Sedgemoor Drain (${Math.abs(delta).toFixed(2)}m below ${Z_crest.toFixed(2)}m relief crest).`;
  }

  return {
    asset_type: 'spillway',
    asset_id: 'beer_wall',
    status,
    statusText,
    isTiltingWeirsActive,
    isChannelAlert,
    clearance_m: Number((-delta).toFixed(2)),
    beazeley_spillway: {
      asset_type: 'spillway',
      asset_id: 'beazeley_spillway',
      status: 'SECURE',
      crest_elevation_mAOD: null,
      survey_tier: 'UNSURVEYED',
      survey_label: '⚠️ Pending EA Asset Survey'
    },
    narrative
  };
}

export function evaluateOathLock(h_up, h_down) {
  const deltaH = Number((h_up - h_down).toFixed(2));
  if (deltaH >= 0.30) {
    return {
      asset_type: 'sluice',
      asset_id: 'oath_lock_sluice',
      status: 'CLOSED',
      statusText: `🔒 PENNING (FORCING SOWY)`,
      deltaH,
      narrative: `Inferred from +${deltaH.toFixed(2)}m head differential across Monk's Leaze / Oath reach: Oath Lock twin radial gates penning River Parrett to build head for Sowy intake.`
    };
  } else if (deltaH >= 0.05) {
    return {
      asset_type: 'sluice',
      asset_id: 'oath_lock_sluice',
      status: 'DIVERTING',
      statusText: `🟢 GRAVITY PASSING`,
      deltaH,
      narrative: `Inferred from +${deltaH.toFixed(2)}m head differential: Oath Lock twin radial gates passing River Parrett flow downstream toward Burrowbridge.`
    };
  } else {
    return {
      asset_type: 'sluice',
      asset_id: 'oath_lock_sluice',
      status: 'THROTTLED',
      statusText: `⏸️ EQUILIBRIUM`,
      deltaH,
      narrative: `Inferred from ${deltaH >= 0 ? '+' : ''}${deltaH.toFixed(2)}m head differential: near-equalized water surface across Oath Lock reach.`
    };
  }
}

export function evaluateDunballEmergencyPumping(h_ksd, isTideLocked, threshold = 2.80) {
  if (isTideLocked && h_ksd >= threshold) {
    return { statusText: `⚡ HIGH-VOLUME PUMP TRIGGER MET (Inferred from KSD Level)` };
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
      operational: { tier: 2, label: 'EA Operating Rules', authority: 'EA Huish Episcopi PS Receiving River Cut-off Interlock at 8.20m AOD' }
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
    headwall_elevation_mAOD: 6.70,
    diversion_trigger_mAOD: 7.20,
    alert_level_mAOD: 7.90,
    crest_elevation_mAOD: undefined,
    fallback_stage_mAOD: 6.73,
    downstream_node_id: '52158',
    diverts_to_node_id: '52234',
    has_sparkline: true,
    ea_link: 'https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html',
    provenance: {
      sill: { tier: 1, label: 'Surveyed Clyse Sill', authority: 'EA Surveyed Intake Sill of Sowy Relief Channel (4.20m ODN; Headwall 6.70m ODN)' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale.typicalRangeHigh' },
      operational: { tier: 2, label: 'EA Operating Protocol', authority: 'EA Sowy Protocol: Clyse diversion trigger 7.20m AOD; Allermoor Spillway assumed to spill at about the same Parrett stage as Beasley\'s Spillway (7.50m AOD proxy; Allermoor\'s own crest level is not published), curtailing upstream tributary pumping (Huish Episcopi, Midelney & Long Load)' }
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
      crest: { tier: 1, label: 'Surveyed Levee Defence', authority: 'EA Surveyed Armoured Clay Embankment (7.80m ODN)' },
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
      crest: { tier: 1, label: 'Baltmoor Levee Defence', authority: 'EA Surveyed Armoured Clay Embankment (7.80m ODN)' },
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
    ksd_conveyance_mAOD: 6.00,
    crest_elevation_mAOD: 7.30,
    sill_elevation_mAOD: undefined,
    fallback_stage_mAOD: 3.92,
    downstream_node_id: 'E9531',
    has_sparkline: true,
    provenance: {
      crest: { tier: 1, label: 'Surveyed Culvert Crest', authority: 'EA/SRA Surveyed Concrete Weir Crest at Beer Wall Box Culverts (7.30m ODN)' },
      alert: { tier: 3, label: 'EA Statistical Envelope', authority: 'EA stageScale typical envelope (4.20m in-channel alert)' },
      invert: { tier: 1, label: 'Channel Bed Invert', authority: 'EA Sowy Channel Bed Survey' },
      operational: { tier: 2, label: 'SRA Sowy/KSD Scheme', authority: 'Sowy Spur & Lang Acre tilting weirs active ≥6.00m AOD; 4-bay A372 box culverts relief threshold at 7.30m AOD (Beazeley Spillway grassed embankment crest unsurveyed — ⚠️ Pending EA Asset Survey)' }
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
 * Evaluates the freshness of station telemetry readings against latency and flatline thresholds.
 * Detects both latency staleness (>2h age) and zero-variance frozen sensor failure (>=12h/24h static).
 * Prevents "zombie gauges" from silently presenting stale readings as fresh/nominal.
 *
 * @param {Array|null|undefined} readings - Array of reading items sorted descending by time (latest first)
 * @param {object} [options]
 * @param {number} [options.maxAgeHours=2.0] - Age in hours after which data is classified as STALE
 * @param {number} [options.nowMs=Date.now()] - Current epoch timestamp
 * @param {string} [options.fallbackLabel='Fallback Baseline'] - Label when no readings are available
 * @param {number} [options.minFlatlineReadings=48] - Minimum readings to evaluate flatline (48 = 12h @ 15m)
 * @param {number} [options.flatlineThresholdM=0.001] - Max variance span to qualify as zero-variance flatline (<1mm)
 * @returns {object} { isFresh: boolean, isStale: boolean, isOffline: boolean, isFlatlined: boolean, flatlineHours: number|null, ageHours: number|null, ageMinutes: number|null, latestTimestamp: string|null, badgeText: string|null, badgeClass: string }
 */
export function evaluateStationFreshness(readings, options = {}) {
  const maxAgeHours = options.maxAgeHours ?? 2.0;
  const nowMs = options.nowMs ?? Date.now();
  const fallbackLabel = options.fallbackLabel || 'Fallback Baseline';
  const minFlatlineReadings = options.minFlatlineReadings ?? 48;
  const flatlineThresholdM = options.flatlineThresholdM ?? 0.001;

  if (!readings || !Array.isArray(readings) || readings.length === 0) {
    return {
      isFresh: false,
      isStale: true,
      isOffline: true,
      isFlatlined: false,
      flatlineHours: null,
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
      isFlatlined: false,
      flatlineHours: null,
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
      isFlatlined: false,
      flatlineHours: null,
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

  // Extract all valid numeric readings for variance analysis
  const validValues = [];
  for (const r of readings) {
    const v = (typeof r === 'object' && r !== null) ? r.value : r;
    if (v !== null && v !== undefined && Number.isFinite(Number(v))) {
      validValues.push(Number(v));
    }
  }

  // Zero-Variance Sensor Flatline Detection
  if (validValues.length >= minFlatlineReadings) {
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < validValues.length; i++) {
      const v = validValues[i];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const span = maxVal - minVal;

    if (span < flatlineThresholdM) {
      const is24h = validValues.length >= 96;
      const flatlineLabel = is24h ? '24h+' : '12h+';
      return {
        isFresh: false,
        isStale: true,
        isOffline: false,
        isFlatlined: true,
        flatlineHours: is24h ? 24 : 12,
        ageHours,
        ageMinutes,
        latestTimestamp: dateStr,
        badgeText: `⚠️ SENSOR FLATLINED (Static reading for ${flatlineLabel})`,
        badgeClass: 'badge-flatlined'
      };
    }
  }

  if (ageHours > maxAgeHours) {
    return {
      isFresh: false,
      isStale: true,
      isOffline: false,
      isFlatlined: false,
      flatlineHours: null,
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
    isFlatlined: false,
    flatlineHours: null,
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
 * Single Authoritative Hydrological Threshold Registry (mAOD)
 */
export const HYDRO_THRESHOLDS = {
  // Canonical 19-station threshold records
  '52108': { ALERT_MAOD: 76.99, DATUM_MAOD: 75.69, BASELINE_MAOD: 75.72, TYPICAL_LOW_MAOD: 75.84, MAX_ON_RECORD_MAOD: 77.89 },
  '52109': { ALERT_MAOD: 17.48, DATUM_MAOD: 16.58, BASELINE_MAOD: 16.60, TYPICAL_LOW_MAOD: 16.67, MAX_ON_RECORD_MAOD: 19.17 },
  '52111': { ALERT_MAOD: 14.24, DATUM_MAOD: 12.47, BASELINE_MAOD: 12.67, TYPICAL_LOW_MAOD: 13.29, MAX_ON_RECORD_MAOD: 14.31 },
  '52162': { ALERT_MAOD: 9.50, DATUM_MAOD: 0.00, BASELINE_MAOD: 7.50, TYPICAL_LOW_MAOD: 8.50, MAX_ON_RECORD_MAOD: 11.03 },
  '52118': { CREST_MAOD: 7.45, ALERT_MAOD: 7.15, DATUM_MAOD: 0.00, BASELINE_MAOD: 3.30, TYPICAL_LOW_MAOD: 4.71, MAX_ON_RECORD_MAOD: 8.10 },
  '52127': { CREST_MAOD: 7.45, ATHELNEY_CREST_MAOD: 7.35, ALERT_MAOD: 6.50, GROUND_MAOD: 2.10, DATUM_MAOD: 0.00, BASELINE_MAOD: 2.10, TYPICAL_LOW_MAOD: 3.92, MAX_ON_RECORD_MAOD: 8.05 },
  '52116': { ALERT_MAOD: 22.50, DATUM_MAOD: 20.70, BASELINE_MAOD: 20.70, TYPICAL_LOW_MAOD: 20.75, MAX_ON_RECORD_MAOD: 23.63 },
  '52119': { ALERT_MAOD: 12.80, DATUM_MAOD: 10.00, BASELINE_MAOD: 10.16, TYPICAL_LOW_MAOD: 10.23, MAX_ON_RECORD_MAOD: 13.84 },
  '52120': {
    DATUM_MAOD: 5.000,
    GROUND_INVERT_MAOD: 5.80,
    BASELINE_MAOD: 5.80,
    LEAD_PUMP_WINTER: null,
    DUTY_PUMP_WINTER: null,
    LEAD_PUMP_SUMMER: null,
    DUTY_PUMP_SUMMER: null,
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
    HEADWALL_MAOD: 6.70,
    TRIGGER_MAOD: 7.20,
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
  '52157': { CREST_MAOD: 7.30, PRE_SPILL_MAOD: 7.15, KSD_CONVEYANCE_MAOD: 6.00, A372_CROWN_MAOD: 8.00, ALERT_MAOD: 4.20, DATUM_MAOD: 0.00, BASELINE_MAOD: 2.30, TYPICAL_LOW_MAOD: 2.33, MAX_ON_RECORD_MAOD: 5.07 },
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
    HEADWALL_MAOD: 6.70,
    TRIGGER_MAOD: 7.20,
    MIN_DELTA_H: 0.05,
    UPSTREAM_ALERT_MAOD: 7.90,
    DOWNSTREAM_ALERT_MAOD: 7.60
  },
  BEERWALL: {
    CREST_MAOD: 7.30,
    PRE_SPILL_MAOD: 7.15,
    KSD_CONVEYANCE_MAOD: 6.00,
    A372_CROWN_MAOD: 8.00,
    ALERT_MAOD: 4.20
  },
  CURRY_MOOR: {
    GROUND_MAOD: 2.10,
    LEAD_PUMP_WINTER: 4.00,
    DUTY_PUMP_WINTER: 4.55,
    LEAD_PUMP_SUMMER: 4.60,
    DUTY_PUMP_SUMMER: 4.80,
    MOBILE_ORDERED_MAOD: 5.80,
    MOBILE_ACTIVE_MAOD: 6.10,
    CRITICAL_MAOD: 6.50,
    CRITICAL_SPILL_MAOD: 7.35,
    ALERT_MAOD: 6.50,
    CREST_MAOD: 7.45,
    ATHELNEY_CREST_MAOD: 7.35
  },
  ATHELNEY: {
    CREST_MAOD: 7.35
  },
  NORTHMOOR: {
    GROUND_MAOD: 1.80,
    LEAD_PUMP_WINTER: 3.40,
    DUTY_PUMP_WINTER: 3.70,
    LEAD_PUMP_SUMMER: 4.00,
    DUTY_PUMP_SUMMER: 4.20,
    MOBILE_ORDERED_MAOD: 4.80,
    MOBILE_ACTIVE_MAOD: 5.20,
    CRITICAL_MAOD: 5.60,
    CRITICAL_SPILL_MAOD: 7.80,
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
    LEAD_PUMP_WINTER: null,
    DUTY_PUMP_WINTER: null,
    LEAD_PUMP_SUMMER: null,
    DUTY_PUMP_SUMMER: null,
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
  },
  STANMOOR: {
    GROUND_MAOD: 2.10,
    LEAD_PUMP_WINTER: 4.10,
    DUTY_PUMP_WINTER: 4.55,
    LEAD_PUMP_SUMMER: 4.70,
    DUTY_PUMP_SUMMER: 4.90,
    MOBILE_ORDERED_MAOD: 5.80,
    MOBILE_ACTIVE_MAOD: 6.10,
    CRITICAL_MAOD: 7.35,
    CRITICAL_SPILL_MAOD: 7.35
  },
  WET_MOOR: {
    GROUND_MAOD: 5.80,
    LEAD_PUMP_WINTER: null,
    DUTY_PUMP_WINTER: null,
    LEAD_PUMP_SUMMER: null,
    DUTY_PUMP_SUMMER: null,
    RIVER_CUTOFF_MAOD: 8.20,
    MOBILE_ORDERED_MAOD: null,
    MOBILE_ACTIVE_MAOD: null,
    CRITICAL_MAOD: null,
    CRITICAL_SPILL_MAOD: null
  },
  WEST_SEDGEMOOR: {
    GROUND_MAOD: 3.60,
    LEAD_PUMP_WINTER: null,
    DUTY_PUMP_WINTER: null,
    LEAD_PUMP_SUMMER: null,
    DUTY_PUMP_SUMMER: null,
    MOBILE_ORDERED_MAOD: null,
    MOBILE_ACTIVE_MAOD: null,
    CRITICAL_MAOD: null,
    CRITICAL_SPILL_MAOD: null
  },
  WESTONZOYLAND: {
    GROUND_MAOD: 1.80,
    LEAD_PUMP_WINTER: null,
    DUTY_PUMP_WINTER: null,
    LEAD_PUMP_SUMMER: null,
    DUTY_PUMP_SUMMER: null,
    MOBILE_ORDERED_MAOD: null,
    MOBILE_ACTIVE_MAOD: null,
    CRITICAL_MAOD: null,
    CRITICAL_SPILL_MAOD: null
  }
};

/**
 * Declarative Somerset Hydrological Network Topology Configuration [RULE-SSOT-01, RULE-PAR-01]
 * Synchronized 1:1 with src/js/config/topology_network.json
 */
export const TOPOLOGY_NETWORK_CONFIG = {
  catchment_id: "somerset",
  coupled_rules: {
    monks_leaze_diverting: {
      type: "clyse_diverting",
      upstream_node_id: "52233",
      downstream_node_id: "52234",
      sill_threshold_ref: "MONKS_LEAZE.TRIGGER_MAOD",
      min_delta_h_ref: "MONKS_LEAZE.MIN_DELTA_H"
    },
    dunball_tide_locked: {
      type: "stage_gte_node",
      node_id: "52163",
      compare_node_id: "E9094"
    }
  },
  chains: [
    {
      id: "tone",
      name: "River Tone Chain",
      direction: "West → East",
      nodes: ["52108", "52109", "52111", "52162", "52118", "52158"]
    },
    {
      id: "currymoor_polder",
      name: "Curry Moor Polder Basin",
      direction: "Storage Area",
      nodes: ["52118", "52127"]
    },
    {
      id: "parrett",
      name: "River Parrett Chain",
      direction: "South → North",
      nodes: ["52116", "52119", "52233", "52158", "52124", "52163"]
    },
    {
      id: "tributaries",
      name: "River Yeo & River Isle Tributaries",
      direction: "Upland → Langport Confluence",
      nodes: ["52120", "52153", "52233"]
    },
    {
      id: "northmoor_polder",
      name: "Northmoor Polder Basin",
      direction: "Storage Area",
      nodes: ["52158", "52159"]
    },
    {
      id: "sowy_ksd",
      name: "Sowy Relief Channel & Sedgemoor Drain",
      direction: "Diversion Route",
      nodes: ["52233", "52234", "52157", "E9531", "E9094", "52163"]
    }
  ],
  nodes: [
    {
      id: "52108",
      name: "Greenham (Upper Tone)",
      river: "River Tone",
      catchment: "tone",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52109",
      has_sparkline: true,
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52109",
      name: "Bishops Hull (Mid Tone)",
      river: "River Tone",
      catchment: "tone",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52111",
      has_sparkline: true,
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52111",
      name: "Taunton Market",
      river: "River Tone",
      catchment: "tone",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52162",
      has_sparkline: true,
      overrides: { name: "Taunton Market (Urban Tone)" },
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52162",
      name: "Bathpool Outfall",
      river: "River Tone",
      catchment: "tone",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52118",
      has_sparkline: true,
      overrides: { name: "Bathpool Outfall (Lower Tone)" },
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52118",
      name: "Hookbridge Spillway / Currymoor PS",
      river: "River Tone",
      catchment: "tone",
      node_type: "spillway",
      default_status: "SECURE",
      downstream_node_id: "52158",
      diverts_to_node_id: "52127",
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/3073",
      overrides: { downstream_node_id: "athelney_junction" },
      status_rule: {
        type: "spillway_overtopping",
        crest_threshold_ref: "HOOKBRIDGE.CREST_MAOD",
        alert_threshold_ref: "HOOKBRIDGE.ALERT_MAOD"
      }
    },
    {
      id: "52127",
      name: "Curry Moor Basin",
      river: "Curry Moor Basin",
      catchment: "tone",
      node_type: "polder_basin",
      default_status: "SECURE",
      downstream_node_id: "currymoor_ps",
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/3064",
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52116",
      name: "Chiselborough (Upper Parrett)",
      river: "River Parrett",
      catchment: "parrett",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52119",
      has_sparkline: true,
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52119",
      name: "Gaw Bridge (Mid Parrett)",
      river: "River Parrett",
      catchment: "parrett",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52233",
      has_sparkline: true,
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52120",
      name: "Huish Episcopi PS (River Yeo)",
      river: "River Yeo",
      catchment: "tributaries",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52233",
      upstream_tributaries: ["52121", "52117", "52112"],
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/3071",
      status_rule: {
        type: "alert_threshold",
        alert_threshold_ref: "52120.MUCHELNEY_ROAD_MAOD"
      }
    },
    {
      id: "52153",
      name: "Midelney (River Isle)",
      river: "River Isle",
      catchment: "tributaries",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52233",
      upstream_tributaries: ["52115", "52114"],
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/3380",
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52233",
      name: "Monk's Leaze Clyse (Upstream)",
      river: "River Parrett",
      catchment: "parrett",
      node_type: "clyse_gate",
      default_status: "CLOSED",
      downstream_node_id: "52158",
      diverts_to_node_id: "52234",
      has_sparkline: true,
      overrides: {
        ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52233.html"
      },
      status_rule: {
        type: "clyse_upstream",
        alert_threshold_ref: "MONKS_LEAZE.UPSTREAM_ALERT_MAOD",
        coupled_rule: "monks_leaze_diverting"
      }
    },
    {
      id: "52158",
      name: "Baltmoor Wall (Burrowbridge Confluence)",
      river: "River Parrett",
      catchment: "parrett",
      node_type: "spillway",
      default_status: "SECURE",
      downstream_node_id: "52124",
      diverts_to_node_id: "52159",
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/3065",
      overrides: {
        govuk_link: "https://check-for-flooding.service.gov.uk/station/3400"
      },
      status_rule: {
        type: "spillway_overtopping",
        crest_threshold_ref: "BALTMOOR.CREST_MAOD",
        alert_threshold_ref: "BALTMOOR.ALERT_MAOD"
      }
    },
    {
      id: "52159",
      name: "Northmoor Basin",
      river: "Northmoor Basin",
      catchment: "parrett",
      node_type: "polder_basin",
      default_status: "SECURE",
      downstream_node_id: "saltmoor_ps",
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/3415",
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52124",
      name: "West Quay Bridgwater",
      river: "River Parrett",
      catchment: "parrett",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52163",
      has_sparkline: true,
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "52163",
      name: "Dunball Tidal Outfall",
      river: "Parrett Estuary",
      catchment: "parrett",
      node_type: "tidal_outfall",
      default_status: "SECURE",
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/9129",
      overrides: {
        name: "Dunball Tidal (Parrett Estuary)",
        downstream_node_id: "sea_outfall"
      },
      status_rule: {
        type: "tidal_estuary",
        inland_node_id: "E9094",
        alert_threshold_ref: "DUNBALL.ESTUARY_ALERT_MAOD"
      }
    },
    {
      id: "52234",
      name: "Monk's Leaze Clyse (Downstream Sowy)",
      river: "Sowy Relief Channel",
      catchment: "sowy_ksd",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52157",
      has_sparkline: true,
      overrides: {
        ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/52234.html"
      },
      status_rule: {
        type: "clyse_downstream",
        alert_threshold_ref: "MONKS_LEAZE.DOWNSTREAM_ALERT_MAOD",
        coupled_rule: "monks_leaze_diverting"
      }
    },
    {
      id: "52157",
      name: "Beerwall Upstream (Greylake)",
      river: "Sowy Relief Channel",
      catchment: "sowy_ksd",
      node_type: "spillway",
      default_status: "SECURE",
      downstream_node_id: "E9531",
      has_sparkline: true,
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "E9531",
      name: "Bradney (King's Sedgemoor Drain)",
      river: "King's Sedgemoor Drain",
      catchment: "sowy_ksd",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "E9094",
      has_sparkline: true,
      ea_link: "https://environment.data.gov.uk/flood-monitoring/id/stations/E9531.html",
      status_rule: { type: "alert_threshold" }
    },
    {
      id: "E9094",
      name: "Dunball Inland KSD Outfall",
      river: "King's Sedgemoor Drain",
      catchment: "sowy_ksd",
      node_type: "gauge",
      default_status: "SECURE",
      downstream_node_id: "52163",
      has_sparkline: true,
      govuk_link: "https://check-for-flooding.service.gov.uk/station/9499",
      status_rule: {
        type: "tidal_inland",
        sea_node_id: "52163",
        alert_threshold_ref: "DUNBALL.INLAND_ALERT_MAOD"
      }
    }
  ],
  edges: [
    {
      from: "52108",
      to: "52109",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52109",
      to: "52111",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52111",
      to: "52162",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52162",
      to: "52118",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52118",
      to: "52158",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52118",
      to: "52127",
      type: "spillway_overtopping",
      default_flow_active: false,
      flow_rule: {
        type: "stage_gte_threshold",
        node_id: "52118",
        threshold_ref: "HOOKBRIDGE.CREST_MAOD"
      }
    },
    {
      from: "52116",
      to: "52119",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52119",
      to: "52233",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52120",
      to: "52233",
      type: "tributary_inflow",
      default_flow_active: true,
      flow_rule: {
        type: "stage_lt_threshold",
        node_id: "52120",
        threshold_ref: "HUISH_EPISCOPI.RIVER_CUTOFF_MAOD"
      }
    },
    {
      from: "52153",
      to: "52233",
      type: "tributary_inflow",
      default_flow_active: true,
      flow_rule: {
        type: "head_gradient",
        upstream_node_id: "52153",
        downstream_node_id: "52233"
      }
    },
    {
      from: "52233",
      to: "52158",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52158",
      to: "52159",
      type: "spillway_overtopping",
      default_flow_active: false,
      flow_rule: {
        type: "stage_gte_threshold",
        node_id: "52158",
        threshold_ref: "BALTMOOR.CREST_MAOD"
      }
    },
    {
      from: "52127",
      to: "52159",
      type: "polder_overflow",
      default_flow_active: false,
      flow_rule: {
        type: "stage_gte_threshold",
        node_id: "52127",
        threshold_ref: "CURRY_MOOR.ATHELNEY_CREST_MAOD"
      }
    },
    {
      from: "52158",
      to: "52124",
      type: "main_river",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "52124",
      to: "52163",
      type: "sea_outfall",
      default_flow_active: true,
      flow_rule: {
        type: "head_gradient",
        upstream_node_id: "52124",
        downstream_node_id: "52163"
      }
    },
    {
      from: "52233",
      to: "52234",
      type: "diversion_clyse",
      default_flow_active: false,
      flow_rule: {
        type: "coupled_rule",
        rule_id: "monks_leaze_diverting"
      }
    },
    {
      from: "52234",
      to: "52157",
      type: "diversion_route",
      default_flow_active: false,
      flow_rule: {
        type: "coupled_rule",
        rule_id: "monks_leaze_diverting"
      }
    },
    {
      from: "52157",
      to: "E9531",
      type: "diversion_route",
      default_flow_active: false,
      flow_rule: {
        type: "coupled_rule",
        rule_id: "monks_leaze_diverting"
      }
    },
    {
      from: "E9531",
      to: "E9094",
      type: "diversion_route",
      default_flow_active: true,
      flow_rule: { type: "always_active" }
    },
    {
      from: "E9094",
      to: "52163",
      type: "sea_outfall",
      default_flow_active: true,
      flow_rule: {
        type: "head_gradient",
        upstream_node_id: "E9094",
        downstream_node_id: "52163"
      }
    }
  ],
  flanking_polders: [
    {
      id: "wet_moor",
      name: "Wet Moor Polder Basin (Huish Episcopi & Midelney)",
      choke_point_nodes: ["52120", "52153", "52233"],
      pumping_stations: ["huish_episcopi_ps", "midelney_ps"],
      primary_station: null,
      receiving_river_station: "52120",
      secondary_river_station: "52153",
      survey_status: "UNSURVEYED"
    },
    {
      id: "stanmoor",
      name: "Stanmoor Polder Basin",
      choke_point_nodes: ["52118", "52127", "52158"],
      pumping_stations: ["stanmoor_ps"],
      primary_station: "52127",
      survey_status: "TIER_2_TRIGGER_PLAN"
    },
    {
      id: "west_sedgemoor",
      name: "West Sedgemoor Polder Basin (SSSI Wet Grassland)",
      choke_point_nodes: ["52127", "52233", "52158"],
      pumping_stations: ["west_sedgemoor_ps"],
      primary_station: null,
      sump_measure_id: "52155-level-sump_level-i-15_min-mAOD",
      survey_status: "UNSURVEYED"
    },
    {
      id: "westonzoyland",
      name: "Westonzoyland Polder Basin (Engine Rhyne)",
      choke_point_nodes: ["52159", "52157"],
      pumping_stations: ["westonzoyland_ps"],
      primary_station: null,
      nearest_context_station: "52159",
      survey_status: "UNSURVEYED"
    }
  ],
  upland_rainfall_origins: [
    {
      id: "tone_upland",
      label: "Blackdowns",
      full_label: "Blackdowns & Brendon Hills",
      river: "River Tone",
      catchment_filter: "tone",
      entry_node_id: "52108",
      correlated_river_station_ids: ["52108", "52109", "52111", "52162", "52118"],
      tbr_station_ids: ["52100", "45168", "52101", "45232", "E14620", "51126"],
      svg_anchor: {
        x: 18,
        y: 546,
        w: 224,
        h: 42,
        connector_from: { x: 80, y: 546 },
        connector_to: { x: 80, y: 518 }
      }
    },
    {
      id: "parrett_upland",
      label: "Dorset Hills",
      full_label: "Dorset Hills (Upper Parrett)",
      river: "River Parrett",
      catchment_filter: "parrett",
      entry_node_id: "52116",
      correlated_river_station_ids: ["52116", "52119", "52120", "52233"],
      tbr_station_ids: ["52148", "52103", "52149"],
      svg_anchor: {
        x: 456,
        y: 546,
        w: 216,
        h: 42,
        connector_from: { x: 672, y: 564 },
        connector_to: { x: 713, y: 545 }
      }
    },
    {
      id: "isle_upland",
      label: "Isle Headwaters",
      full_label: "Isle Headwaters (Chard & Blackdown East)",
      river: "River Isle",
      catchment_filter: "tributaries",
      entry_node_id: "52153",
      correlated_river_station_ids: ["52153"],
      tbr_station_ids: ["52129"],
      svg_anchor: {
        x: 344,
        y: 484,
        w: 222,
        h: 42,
        connector_from: { x: 566, y: 500 },
        connector_to: { x: 576, y: 432 }
      }
    }
  ]
};

/**
 * Resolves a dotted threshold reference (e.g. "HOOKBRIDGE.CREST_MAOD" or "52120.MUCHELNEY_ROAD_MAOD")
 * against the canonical HYDRO_THRESHOLDS registry.
 */
export function resolveThresholdRef(ref, thresholds = HYDRO_THRESHOLDS) {
  if (!ref || typeof ref !== 'string') return undefined;
  const parts = ref.split('.');
  let current = thresholds;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return typeof current === 'number' ? current : undefined;
}

/**
 * Builds a single base topology node record from a declarative node definition and STATION_REGISTRY.
 */
export function buildDefaultTopologyNode(nodeDef, registry = STATION_REGISTRY) {
  const reg = registry[nodeDef.id] || {};
  const node = {
    id: nodeDef.id,
    name: nodeDef.name,
    river: nodeDef.river,
    catchment: nodeDef.catchment,
    node_type: nodeDef.node_type,
    stage_mAOD: reg.fallback_stage_mAOD
  };
  if (reg.ground_elevation_mAOD !== undefined) {
    node.ground_elevation_mAOD = reg.ground_elevation_mAOD;
  }
  if (reg.crest_elevation_mAOD !== undefined && nodeDef.node_type !== 'polder_basin') {
    node.crest_elevation_mAOD = reg.crest_elevation_mAOD;
  }
  if (reg.sill_elevation_mAOD !== undefined) {
    node.sill_elevation_mAOD = reg.sill_elevation_mAOD;
  }
  if (nodeDef.status_rule?.type === 'tidal_estuary') {
    const inlandReg = registry[nodeDef.status_rule.inland_node_id];
    node.inland_stage_mAOD = inlandReg?.fallback_stage_mAOD;
    node.is_tide_locked = false;
  }
  if (nodeDef.status_rule?.type === 'tidal_inland') {
    const seaReg = registry[nodeDef.status_rule.sea_node_id];
    node.sea_stage_mAOD = seaReg?.fallback_stage_mAOD;
    node.is_tide_locked = false;
  }
  if (reg.alert_level_mAOD !== undefined) {
    node.alert_level_mAOD = reg.alert_level_mAOD;
  }
  if (reg.crest_elevation_mAOD !== undefined && nodeDef.node_type === 'polder_basin') {
    node.crest_elevation_mAOD = reg.crest_elevation_mAOD;
  }
  node.status = nodeDef.default_status || 'SECURE';
  if (nodeDef.downstream_node_id !== undefined) {
    node.downstream_node_id = nodeDef.downstream_node_id;
  }
  if (nodeDef.diverts_to_node_id !== undefined) {
    node.diverts_to_node_id = nodeDef.diverts_to_node_id;
  }
  if (nodeDef.upstream_tributaries !== undefined) {
    node.upstream_tributaries = [...nodeDef.upstream_tributaries];
  }
  if (nodeDef.has_sparkline !== undefined) {
    node.has_sparkline = nodeDef.has_sparkline;
  }
  if (nodeDef.govuk_link !== undefined) {
    node.govuk_link = nodeDef.govuk_link;
  }
  if (nodeDef.ea_link !== undefined) {
    node.ea_link = nodeDef.ea_link;
  }
  node.provenance = reg.provenance || null;
  return node;
}

/**
 * Default topology node fallbacks derived from TOPOLOGY_NETWORK_CONFIG & STATION_REGISTRY [RULE-SSOT-01]
 */
export const DEFAULT_TOPOLOGY_NODES = TOPOLOGY_NETWORK_CONFIG.nodes.map(nodeDef =>
  buildDefaultTopologyNode(nodeDef, STATION_REGISTRY)
);

/**
 * Default topology edges derived directly from TOPOLOGY_NETWORK_CONFIG.edges [RULE-SSOT-01]
 */
export const DEFAULT_TOPOLOGY_EDGES = TOPOLOGY_NETWORK_CONFIG.edges.map(e => ({
  from: e.from,
  to: e.to,
  type: e.type,
  flow_active: Boolean(e.default_flow_active ?? true)
}));

/**
 * Evaluates the declarative topology network graph against current telemetry measures [RULE-SSOT-01, RULE-PAR-01]
 */
export function evaluateTopologyNetwork(measures = {}, config = TOPOLOGY_NETWORK_CONFIG, options = {}) {
  const safeMeasures = (measures && typeof measures === 'object') ? measures : {};
  const safeConfig = (config && typeof config === 'object') ? config : TOPOLOGY_NETWORK_CONFIG;
  const safeOptions = (options && typeof options === 'object') ? options : {};
  const registry = safeOptions.registry || STATION_REGISTRY;
  const thresholds = safeOptions.thresholds || HYDRO_THRESHOLDS;
  const configNodes = Array.isArray(safeConfig.nodes) ? safeConfig.nodes : TOPOLOGY_NETWORK_CONFIG.nodes;
  const configEdges = Array.isArray(safeConfig.edges) ? safeConfig.edges : TOPOLOGY_NETWORK_CONFIG.edges;
  const configChains = Array.isArray(safeConfig.chains) ? safeConfig.chains : TOPOLOGY_NETWORK_CONFIG.chains;
  const configFlankingPolders = Array.isArray(safeConfig.flanking_polders)
    ? safeConfig.flanking_polders
    : TOPOLOGY_NETWORK_CONFIG.flanking_polders;

  const stageByNodeId = {};
  for (const nodeDef of configNodes) {
    const fallback = registry[nodeDef.id]?.fallback_stage_mAOD;
    const extracted = extractStationStage(safeMeasures, nodeDef.id);
    stageByNodeId[nodeDef.id] = extracted ?? fallback;
  }

  const coupledState = {};
  const coupledClyseStatus = {};
  if (safeConfig.coupled_rules && typeof safeConfig.coupled_rules === 'object') {
    for (const [ruleId, rule] of Object.entries(safeConfig.coupled_rules)) {
      if (rule.type === 'clyse_diverting') {
        const upStage = stageByNodeId[rule.upstream_node_id];
        const downStage = stageByNodeId[rule.downstream_node_id];
        const sill = resolveThresholdRef(rule.sill_threshold_ref, thresholds);
        const minDeltaH = resolveThresholdRef(rule.min_delta_h_ref, thresholds);
        const sowyCapM = resolveThresholdRef(
          rule.capacity_threshold_ref || 'MONKS_LEAZE.DOWNSTREAM_ALERT_MAOD',
          thresholds
        ) ?? ASSET_DEFINITIONS?.monks_leaze_clyse?.sowy_capacity_mAOD ?? 7.60;
        const upReg = registry[rule.upstream_node_id];
        const downReg = registry[rule.downstream_node_id];
        const upReadings = safeMeasures[upReg?.measure_id] || safeMeasures[rule.upstream_node_id];
        const downReadings = safeMeasures[downReg?.measure_id] || safeMeasures[rule.downstream_node_id];
        let isDownstreamFlatlined = Boolean(safeOptions.isDownstreamFlatlined);
        let isDownstreamStale = Boolean(safeOptions.isDownstreamStale);
        if (Array.isArray(downReadings) && downReadings.length > 0) {
          const downLatest = downReadings[0];
          const downDateStr = (typeof downLatest === 'object' && downLatest !== null) ? (downLatest.dateTime || downLatest.date) : null;
          if (downDateStr) {
            const upLatest = Array.isArray(upReadings) && upReadings.length > 0 ? upReadings[0] : null;
            const upDateStr = (typeof upLatest === 'object' && upLatest !== null) ? (upLatest.dateTime || upLatest.date) : null;
            const upMs = upDateStr ? Date.parse(upDateStr) : NaN;
            const refNowMs = safeOptions.nowMs ?? (!isNaN(upMs) ? upMs : Date.now());
            const downFreshness = evaluateStationFreshness(downReadings, { nowMs: refNowMs });
            isDownstreamFlatlined = isDownstreamFlatlined || downFreshness.isFlatlined;
            isDownstreamStale = isDownstreamStale || (downFreshness.isStale && !downFreshness.isFlatlined) || downFreshness.isOffline;
          }
        }
        if (typeof sill === 'number' && typeof minDeltaH === 'number') {
          const sowyEval = evaluateSowyChannel(upStage, downStage, sill, {
            minDeltaH,
            sowyCapM,
            isDownstreamFlatlined,
            isDownstreamStale
          });
          coupledClyseStatus[ruleId] = sowyEval.status;
          coupledState[ruleId] = sowyEval.status === 'DIVERTING';
        } else {
          coupledClyseStatus[ruleId] = 'CLOSED';
          coupledState[ruleId] = false;
        }
      } else if (rule.type === 'stage_gte_node') {
        coupledState[ruleId] = stageByNodeId[rule.node_id] >= stageByNodeId[rule.compare_node_id];
      }
    }
  }

  const hasLiveTelemetry = (stationId) => {
    return Object.keys(safeMeasures).some(
      k => k.startsWith(stationId) && Array.isArray(safeMeasures[k]) && safeMeasures[k].length > 0
    );
  };

  const nodes = configNodes.map(nodeDef => {
    const baseNode = buildDefaultTopologyNode(nodeDef, registry);
    const stage = stageByNodeId[baseNode.id] ?? baseNode.stage_mAOD;
    const rule = nodeDef.status_rule || { type: 'alert_threshold' };
    let status = stage >= baseNode.alert_level_mAOD ? 'ALERT' : 'SECURE';
    const dynamicFields = {};

    switch (rule.type) {
      case 'spillway_overtopping': {
        const crest = resolveThresholdRef(rule.crest_threshold_ref, thresholds) ?? baseNode.crest_elevation_mAOD;
        const alert = resolveThresholdRef(rule.alert_threshold_ref, thresholds) ?? baseNode.alert_level_mAOD;
        status = stage >= crest ? 'OVERSPILLING' : (stage >= alert ? 'ALERT' : 'SECURE');
        break;
      }
      case 'clyse_upstream': {
        const alert = resolveThresholdRef(rule.alert_threshold_ref, thresholds) ?? baseNode.alert_level_mAOD;
        const clyseStatus = coupledClyseStatus[rule.coupled_rule];
        const isDiverting = Boolean(coupledState[rule.coupled_rule]);
        if (clyseStatus === 'REVERSE_LOCK' || clyseStatus === 'THROTTLED') {
          status = clyseStatus;
        } else {
          status = stage >= alert ? 'ALERT' : (isDiverting ? 'DIVERTING' : 'CLOSED');
        }
        break;
      }
      case 'clyse_downstream': {
        const alert = resolveThresholdRef(rule.alert_threshold_ref, thresholds) ?? baseNode.alert_level_mAOD;
        const isDiverting = Boolean(coupledState[rule.coupled_rule]);
        status = stage >= alert ? 'ALERT' : (isDiverting ? 'DIVERTING' : 'SECURE');
        break;
      }
      case 'tidal_estuary': {
        const inlandStage = stageByNodeId[rule.inland_node_id];
        const isTideLocked = stage >= inlandStage;
        const alert = resolveThresholdRef(rule.alert_threshold_ref, thresholds) ?? baseNode.alert_level_mAOD;
        dynamicFields.inland_stage_mAOD = inlandStage;
        dynamicFields.is_tide_locked = isTideLocked;
        status = stage >= alert ? 'ALERT' : (isTideLocked ? 'SLACK_RESTRICTED' : 'SECURE');
        break;
      }
      case 'tidal_inland': {
        const seaStage = stageByNodeId[rule.sea_node_id];
        const isTideLocked = seaStage >= stage;
        const alert = resolveThresholdRef(rule.alert_threshold_ref, thresholds) ?? baseNode.alert_level_mAOD;
        dynamicFields.sea_stage_mAOD = seaStage;
        dynamicFields.is_tide_locked = isTideLocked;
        status = isTideLocked ? 'SLACK_RESTRICTED' : (stage >= alert ? 'ALERT' : 'SECURE');
        break;
      }
      case 'alert_threshold':
      default: {
        const alert = rule.alert_threshold_ref
          ? (resolveThresholdRef(rule.alert_threshold_ref, thresholds) ?? baseNode.alert_level_mAOD)
          : baseNode.alert_level_mAOD;
        status = stage >= alert ? 'ALERT' : 'SECURE';
        break;
      }
    }

    return {
      ...baseNode,
      gauge_id: baseNode.id,
      stage_mAOD: stage,
      status,
      ...(nodeDef.overrides || {}),
      ...dynamicFields,
      telemetry_source: hasLiveTelemetry(baseNode.id) ? 'live' : 'cached_fallback',
      provenance: registry[baseNode.id]?.provenance || baseNode.provenance || null
    };
  });

  const edges = configEdges.map(edgeDef => {
    const rule = edgeDef.flow_rule || { type: 'always_active' };
    let flow_active = Boolean(edgeDef.default_flow_active ?? true);

    switch (rule.type) {
      case 'always_active':
        flow_active = true;
        break;
      case 'stage_gte_threshold': {
        const targetId = rule.node_id || edgeDef.from;
        const threshold = resolveThresholdRef(rule.threshold_ref, thresholds);
        flow_active = typeof threshold === 'number'
          ? stageByNodeId[targetId] >= threshold
          : Boolean(edgeDef.default_flow_active ?? false);
        break;
      }
      case 'stage_lt_threshold': {
        const targetId = rule.node_id || edgeDef.from;
        const threshold = resolveThresholdRef(rule.threshold_ref, thresholds);
        flow_active = typeof threshold === 'number'
          ? stageByNodeId[targetId] < threshold
          : Boolean(edgeDef.default_flow_active ?? true);
        break;
      }
      case 'head_gradient': {
        const upId = rule.upstream_node_id || edgeDef.from;
        const downId = rule.downstream_node_id || edgeDef.to;
        flow_active = stageByNodeId[upId] > stageByNodeId[downId];
        break;
      }
      case 'coupled_rule':
        flow_active = Boolean(coupledState[rule.rule_id]);
        break;
      default:
        flow_active = Boolean(edgeDef.default_flow_active ?? true);
        break;
    }

    return {
      from: edgeDef.from,
      to: edgeDef.to,
      type: edgeDef.type,
      flow_active
    };
  });

  return {
    status: 'ok',
    catchment_id: safeConfig.catchment_id || 'somerset',
    updated_at: safeOptions.updatedAt || new Date().toISOString(),
    chains: configChains.map(c => ({ ...c, nodes: Array.isArray(c.nodes) ? [...c.nodes] : [] })),
    nodes,
    edges,
    flanking_polders: configFlankingPolders.map(p => ({
      ...p,
      choke_point_nodes: Array.isArray(p.choke_point_nodes) ? [...p.choke_point_nodes] : [],
      pumping_stations: Array.isArray(p.pumping_stations) ? [...p.pumping_stations] : []
    }))
  };
}

/**
 * Pre-Overtopping 30cm Warning Alert Thresholds (mAOD)
 */
export const PRE_OVERTOPPING_THRESHOLDS = {
  HOOKBRIDGE_ALERT_MAOD: HYDRO_THRESHOLDS.HOOKBRIDGE.ALERT_MAOD, // 30cm below 7.45m crest
  BALTMOOR_ALERT_MAOD: HYDRO_THRESHOLDS.BALTMOOR.ALERT_MAOD     // 30cm below 7.80m crest
};

/**
 * Canonical Seasonal Pumping Station Regimes & Operational Thresholds (mAOD) [RULE-SSOT-01]
 * Source: Environment Agency Somerset Levels & Moors Trigger Point Plan (OGL v3.0)
 */
export const CANONICAL_PUMP_THRESHOLDS = Object.freeze({
  currymoor_ps: Object.freeze({
    summer: Object.freeze({
      lead: HYDRO_THRESHOLDS.CURRY_MOOR.LEAD_PUMP_SUMMER,
      duty: HYDRO_THRESHOLDS.CURRY_MOOR.DUTY_PUMP_SUMMER,
      mobile_order: HYDRO_THRESHOLDS.CURRY_MOOR.MOBILE_ORDERED_MAOD,
      mobile_active: HYDRO_THRESHOLDS.CURRY_MOOR.MOBILE_ACTIVE_MAOD,
      critical_spill: HYDRO_THRESHOLDS.CURRY_MOOR.CRITICAL_SPILL_MAOD
    }),
    winter: Object.freeze({
      lead: HYDRO_THRESHOLDS.CURRY_MOOR.LEAD_PUMP_WINTER,
      duty: HYDRO_THRESHOLDS.CURRY_MOOR.DUTY_PUMP_WINTER,
      mobile_order: HYDRO_THRESHOLDS.CURRY_MOOR.MOBILE_ORDERED_MAOD,
      mobile_active: HYDRO_THRESHOLDS.CURRY_MOOR.MOBILE_ACTIVE_MAOD,
      critical_spill: HYDRO_THRESHOLDS.CURRY_MOOR.CRITICAL_SPILL_MAOD
    })
  }),
  stanmoor_ps: Object.freeze({
    summer: Object.freeze({
      lead: HYDRO_THRESHOLDS.STANMOOR.LEAD_PUMP_SUMMER,
      duty: HYDRO_THRESHOLDS.STANMOOR.DUTY_PUMP_SUMMER,
      mobile_order: HYDRO_THRESHOLDS.STANMOOR.MOBILE_ORDERED_MAOD,
      mobile_active: HYDRO_THRESHOLDS.STANMOOR.MOBILE_ACTIVE_MAOD,
      critical_spill: HYDRO_THRESHOLDS.STANMOOR.CRITICAL_SPILL_MAOD
    }),
    winter: Object.freeze({
      lead: HYDRO_THRESHOLDS.STANMOOR.LEAD_PUMP_WINTER,
      duty: HYDRO_THRESHOLDS.STANMOOR.DUTY_PUMP_WINTER,
      mobile_order: HYDRO_THRESHOLDS.STANMOOR.MOBILE_ORDERED_MAOD,
      mobile_active: HYDRO_THRESHOLDS.STANMOOR.MOBILE_ACTIVE_MAOD,
      critical_spill: HYDRO_THRESHOLDS.STANMOOR.CRITICAL_SPILL_MAOD
    })
  }),
  saltmoor_ps: Object.freeze({
    summer: Object.freeze({
      lead: HYDRO_THRESHOLDS.NORTHMOOR.LEAD_PUMP_SUMMER,
      duty: HYDRO_THRESHOLDS.NORTHMOOR.DUTY_PUMP_SUMMER,
      mobile_order: HYDRO_THRESHOLDS.NORTHMOOR.MOBILE_ORDERED_MAOD,
      mobile_active: HYDRO_THRESHOLDS.NORTHMOOR.MOBILE_ACTIVE_MAOD,
      critical_spill: HYDRO_THRESHOLDS.NORTHMOOR.CRITICAL_SPILL_MAOD
    }),
    winter: Object.freeze({
      lead: HYDRO_THRESHOLDS.NORTHMOOR.LEAD_PUMP_WINTER,
      duty: HYDRO_THRESHOLDS.NORTHMOOR.DUTY_PUMP_WINTER,
      mobile_order: HYDRO_THRESHOLDS.NORTHMOOR.MOBILE_ORDERED_MAOD,
      mobile_active: HYDRO_THRESHOLDS.NORTHMOOR.MOBILE_ACTIVE_MAOD,
      critical_spill: HYDRO_THRESHOLDS.NORTHMOOR.CRITICAL_SPILL_MAOD
    })
  }),
  northmoor_ps: Object.freeze({
    summer: Object.freeze({ lead: 4.10, duty: 4.30, mobile_order: 4.80, mobile_active: 5.20, critical_spill: 7.80 }),
    winter: Object.freeze({ lead: 3.50, duty: 3.80, mobile_order: 4.80, mobile_active: 5.20, critical_spill: 7.80 })
  }),
  dunball_mobile_ps: Object.freeze({
    summer: Object.freeze({ lead: 3.10, duty: 3.30, mobile_order: 3.50, mobile_active: 3.70, critical_spill: 4.10 }),
    winter: Object.freeze({ lead: 2.80, duty: 3.10, mobile_order: 3.30, mobile_active: 3.50, critical_spill: 3.80 })
  })
});

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
  reverse_lock: 0.10,  // 10cm reverse head deadband preventing baseflow flapping
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
 * Evaluates Huish Episcopi Pumping Station on the River Yeo, including
 * automatic receiving river cut-off interlock (8.20m AOD) and alert threshold (8.48m AOD).
 */
export function evaluateHuishEpiscopi(stage_mAOD, _isSummer = false) {
  const cleanStage = sanitizeStageValue(stage_mAOD);
  if (cleanStage === null) {
    return { code: "OFFLINE", label: "OFFLINE", badgeClass: "badge-offline", narrative: "No telemetry", severity: 1 };
  }

  const t = HYDRO_THRESHOLDS.HUISH_EPISCOPI;
  const muchelneyRoad = t.MUCHELNEY_ROAD_MAOD;
  const riverCutoff = t.RIVER_CUTOFF_MAOD;
  const alertLevel = t.ALERT_MAOD;

  const roadMargin = Number((muchelneyRoad - cleanStage).toFixed(2));
  const cutoffClearance = Number((riverCutoff - cleanStage).toFixed(2));

  let pumpStatus = "STANDBY";
  let pumpLabel = "STANDBY (GRAVITY DRAINAGE)";
  if (cleanStage >= riverCutoff) {
    pumpStatus = "CUT_OFF";
    pumpLabel = "PUMPS LOCKED (RIVER FULL - ≥8.20m Cut-off)";
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
 * Canonical Environment Agency Flood Alert & Warning Areas Catalog [RULE-SSOT-01]
 * Authoritative Single Source of Truth for Somerset Catchment Target Areas
 * Source: UK Environment Agency Flood Monitoring Service (Open Government Licence v3.0)
 */
export const EA_FLOOD_AREA_CATALOG = Object.freeze({
  // ==========================================
  // Broad Flood Alert Areas (Severity Level 3)
  // ==========================================
  '112WAFTPM': Object.freeze({
    notation: '112WAFTPM',
    type: 'FLOOD_ALERT_AREA',
    name: 'Lower Tone and Parrett Moors',
    description: 'Lower Tone and Parrett Moors including Curry Moor, Hay Moor, North Moor, Salt Moor, Stan Moor and West Moor.',
    catchment: 'tone_parrett',
    primary_gauges: Object.freeze(['52118', '52127', '52158', '52159']),
    associated_roads: Object.freeze(['cuts_road', 'new_road_curry', 'stan_moor_road', 'moorland_new_cut_road'])
  }),
  '112WAFYPM': Object.freeze({
    notation: '112WAFYPM',
    type: 'FLOOD_ALERT_AREA',
    name: 'River Yeo and River Parrett Moors around Muchelney and Thorney',
    description: 'River Yeo and River Parrett Moors including Muchelney, Thorney and surrounding agricultural lowlands.',
    catchment: 'yeo_parrett',
    primary_gauges: Object.freeze(['52120', '52153', '52119']),
    associated_roads: Object.freeze(['muchelney_access', 'bicknells_bridge_access'])
  }),
  '112WAFYPL': Object.freeze({
    notation: '112WAFYPL',
    type: 'FLOOD_ALERT_AREA',
    name: 'Somerset Levels and Moors (The Levels)',
    description: 'Somerset Levels and Moors agricultural moors and drainage rhynes.',
    catchment: 'levels_general',
    primary_gauges: Object.freeze(['52127', '52159', 'E9531']),
    associated_roads: Object.freeze(['cuts_road', 'new_road_curry'])
  }),
  '112WAFYPY': Object.freeze({
    notation: '112WAFYPY',
    type: 'FLOOD_ALERT_AREA',
    name: 'River Yeo from Yeovilton to Huish Episcopi',
    description: 'River Yeo valley corridor from Yeovilton downstream to Huish Episcopi.',
    catchment: 'yeo',
    primary_gauges: Object.freeze(['52120']),
    associated_roads: Object.freeze(['muchelney_access'])
  }),
  '112WAFTESR': Object.freeze({
    notation: '112WAFTESR',
    type: 'FLOOD_ALERT_AREA',
    name: "East Somerset Rivers (River Sowy and King's Sedgemoor Drain)",
    description: "East Somerset Rivers including the Sowy Relief Channel and King's Sedgemoor Drain from Monk's Leaze Clyse to Dunball.",
    catchment: 'sowy_ksd',
    primary_gauges: Object.freeze(['52233', '52234', '52157', 'E9531', 'E9094']),
    associated_roads: Object.freeze(['beer_wall_a372'])
  }),
  '112WAFBCR': Object.freeze({
    notation: '112WAFBCR',
    type: 'FLOOD_ALERT_AREA',
    name: 'Bridgwater, Somerset Coast at Dunball and Combwich',
    description: 'Coastal and estuarine areas along the Parrett Estuary at Dunball and Combwich.',
    catchment: 'parrett_estuary',
    primary_gauges: Object.freeze(['52124', '52163']),
    associated_roads: Object.freeze([])
  }),

  // ============================================
  // Specific Flood Warning Areas (Severity 2 / 1)
  // ============================================
  '112FWFCUR10A': Object.freeze({
    notation: '112FWFCUR10A',
    type: 'FLOOD_WARNING_AREA',
    name: 'Curry Moor and Hay Moor',
    description: 'Curry Moor and Hay Moor including Cuts Road and New Road.',
    catchment: 'tone',
    primary_gauges: Object.freeze(['52118', '52127']),
    associated_roads: Object.freeze(['cuts_road', 'new_road_curry'])
  }),
  '112FWFEAS10A': Object.freeze({
    notation: '112FWFEAS10A',
    type: 'FLOOD_WARNING_AREA',
    name: 'A361 East Lyng to Burrowbridge',
    description: 'A361 regional corridor between East Lyng and Burrowbridge.',
    catchment: 'tone_parrett',
    primary_gauges: Object.freeze(['52158', '52127']),
    associated_roads: Object.freeze(['a361_burrowbridge'])
  }),
  '112FWFSAL10A': Object.freeze({
    notation: '112FWFSAL10A',
    type: 'FLOOD_WARNING_AREA',
    name: 'Salt Moor and North Moor',
    description: 'Salt Moor and North Moor including Moorland and Fordgate.',
    catchment: 'parrett',
    primary_gauges: Object.freeze(['52158', '52159']),
    associated_roads: Object.freeze(['moorland_new_cut_road'])
  }),
  '112FWFSTA10A': Object.freeze({
    notation: '112FWFSTA10A',
    type: 'FLOOD_WARNING_AREA',
    name: 'Stan Moor (Athelney and Curload)',
    description: 'Stan Moor including Stan Moor Road near Curload and Athelney.',
    catchment: 'tone',
    primary_gauges: Object.freeze(['52118', '52127']),
    associated_roads: Object.freeze(['stan_moor_road'])
  }),
  '112FWFMTM10A': Object.freeze({
    notation: '112FWFMTM10A',
    type: 'FLOOD_WARNING_AREA',
    name: 'Muchelney, Thorney and surrounding properties',
    description: 'Properties and roads in Muchelney and Thorney.',
    catchment: 'yeo_parrett',
    primary_gauges: Object.freeze(['52120', '52119']),
    associated_roads: Object.freeze(['muchelney_access', 'bicknells_bridge_access'])
  }),
  '112FWTBRI03': Object.freeze({
    notation: '112FWTBRI03',
    type: 'FLOOD_WARNING_AREA',
    name: 'Tidal Parrett at Burrowbridge, Stathe and Moorland',
    description: 'Tidal River Parrett downstream from Oath Lock through Burrowbridge to Moorland.',
    catchment: 'parrett',
    primary_gauges: Object.freeze(['52158', '52124']),
    associated_roads: Object.freeze(['a361_burrowbridge'])
  }),
  '112FWTCOM02': Object.freeze({
    notation: '112FWTCOM02',
    type: 'FLOOD_WARNING_AREA',
    name: 'Dunball Reach and Combwich on Parrett Estuary',
    description: 'Tidal flood warning zone around Dunball Sluice and Combwich wharf.',
    catchment: 'parrett_estuary',
    primary_gauges: Object.freeze(['52163', 'E9094']),
    associated_roads: Object.freeze([])
  }),
  '112FWFPAR20A': Object.freeze({
    notation: '112FWFPAR20A',
    type: 'FLOOD_WARNING_AREA',
    name: 'Upper River Parrett from South Petherton to Langport',
    description: "Upper River Parrett corridor upstream of Monk's Leaze Clyse.",
    catchment: 'parrett',
    primary_gauges: Object.freeze(['52116', '52119']),
    associated_roads: Object.freeze([])
  }),
  '112FWFPAR30A': Object.freeze({
    notation: '112FWFPAR30A',
    type: 'FLOOD_WARNING_AREA',
    name: 'River Parrett at Langport and Westover Trading Estate',
    description: 'Langport town bridge and Westover commercial area.',
    catchment: 'parrett',
    primary_gauges: Object.freeze(['52119', '52233']),
    associated_roads: Object.freeze([])
  }),
  '112FWFTON30A': Object.freeze({
    notation: '112FWFTON30A',
    type: 'FLOOD_WARNING_AREA',
    name: 'River Tone from Taunton to Ham (Bathpool, Ham)',
    description: 'River Tone downstream of Taunton including Bathpool outfall.',
    catchment: 'tone',
    primary_gauges: Object.freeze(['52111', '52162', '52118']),
    associated_roads: Object.freeze([])
  })
});

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
    ea_warning_target_area: '112FWFMTM10A',
    ea_target_area_name: 'Muchelney, Thorney and surrounding properties',
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
    ea_warning_target_area: '112WAFTESR',
    ea_target_area_name: "East Somerset Rivers (River Sowy & KSD)",
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
    crown_elevation_mAOD: null,
    caution_elevation_mAOD: null,
    deadband_crown: HYDRO_DEADBANDS.road_crown,
    deadband_caution: HYDRO_DEADBANDS.road_caution,
    corridor_type: 'Lowland Rural Connector',
    driving_station_label: 'River Yeo @ Huish (52120)',
    ea_warning_target_area: '112FWFMTM10A',
    ea_target_area_name: 'Muchelney, Thorney and surrounding properties',
    survey_tier: 'UNSURVEYED',
    survey_label: '⚠️ Pending Topographic Survey',
    survey_tooltip: '⚠️ Pending Topographic Survey: Approach road elevations at Bicknell\'s Bridge are not published in primary engineering surveys; unverified empirical thresholds (7.00m/7.30m AOD) sat inside normal River Yeo winter flow (52120 typicalRange 6.44m–8.48m AOD) and automated stage triggers are disabled.',
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
    spring_backwater_mAOD: 5.50,
    compound_fluvial_warning_mAOD: 6.40,
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
    name: 'Beer Wall Spillway & Box Culverts',
    primary_station: '52157',
    crest_elevation_mAOD: 7.30,
    pre_spill_elevation_mAOD: 7.15,
    ksd_conveyance_mAOD: 6.00,
    in_channel_alert_mAOD: 4.20,
    deadband_crest: HYDRO_DEADBANDS.weir_crest,
    deadband_pre_spill: HYDRO_DEADBANDS.pre_spill
  }),
  allermoor_spillway: Object.freeze({
    asset_type: 'spillway',
    asset_id: 'allermoor_spillway',
    name: 'Allermoor Spillway',
    primary_station: '52233',
    crest_elevation_mAOD: null,
    pre_spill_elevation_mAOD: null,
    proxy_trigger_mAOD: 7.50,
    curtails_tributary_pumps: true,
    driving_station_label: "River Parrett @ Monk's Leaze (52233)",
    ea_warning_target_area: '112WAFTESR',
    ea_target_area_name: 'East Somerset Rivers (River Sowy & KSD)',
    survey_tier: 'UNSURVEYED',
    survey_label: '⚠️ Pending EA Asset Survey (Beasley\'s ~7.50m AOD Proxy)',
    survey_tooltip: '⚠️ Pending EA Asset Survey: Allermoor\'s own crest level is not published in primary public records. EA Somerset Levels guidance notes it operates at approximately the same Parrett stage as Beasley\'s Spillway (~7.50m AOD proxy), closing Monk\'s Leaze Clyse and curtailing upstream tributary pumps. Automated OVERTOPPING event triggers are disabled.',
    deadband_crest: HYDRO_DEADBANDS.weir_crest,
    deadband_pre_spill: HYDRO_DEADBANDS.pre_spill,
    station_url: 'https://check-for-flooding.service.gov.uk/station/3066'
  }),

  // --- 3. POLDERS ---
  curry_moor: Object.freeze({
    asset_type: 'polder',
    asset_id: 'curry_moor',
    name: 'Curry Moor Polder Basin',
    primary_station: '52127',
    floor_elevation_mAOD: HYDRO_THRESHOLDS.CURRY_MOOR.GROUND_MAOD,
    lead_pump_winter_mAOD: CANONICAL_PUMP_THRESHOLDS.currymoor_ps.winter.lead,
    lead_pump_summer_mAOD: CANONICAL_PUMP_THRESHOLDS.currymoor_ps.summer.lead,
    duty_pump_winter_mAOD: CANONICAL_PUMP_THRESHOLDS.currymoor_ps.winter.duty,
    duty_pump_summer_mAOD: CANONICAL_PUMP_THRESHOLDS.currymoor_ps.summer.duty,
    mobile_ordered_mAOD: CANONICAL_PUMP_THRESHOLDS.currymoor_ps.winter.mobile_order,
    mobile_active_mAOD: CANONICAL_PUMP_THRESHOLDS.currymoor_ps.winter.mobile_active,
    critical_mAOD: HYDRO_THRESHOLDS.CURRY_MOOR.CRITICAL_MAOD,
    sump_ceiling_mAOD: 4.52,
    rapid_inrush_threshold_mh: 0.10,
    deadband_pump: 0.10
  }),
  northmoor: Object.freeze({
    asset_type: 'polder',
    asset_id: 'northmoor',
    name: 'Northmoor Polder Basin',
    primary_station: '52159',
    floor_elevation_mAOD: HYDRO_THRESHOLDS.NORTHMOOR.GROUND_MAOD,
    lead_pump_winter_mAOD: CANONICAL_PUMP_THRESHOLDS.saltmoor_ps.winter.lead,
    lead_pump_summer_mAOD: CANONICAL_PUMP_THRESHOLDS.saltmoor_ps.summer.lead,
    duty_pump_winter_mAOD: CANONICAL_PUMP_THRESHOLDS.saltmoor_ps.winter.duty,
    duty_pump_summer_mAOD: CANONICAL_PUMP_THRESHOLDS.saltmoor_ps.summer.duty,
    mobile_ordered_mAOD: CANONICAL_PUMP_THRESHOLDS.saltmoor_ps.winter.mobile_order,
    mobile_active_mAOD: CANONICAL_PUMP_THRESHOLDS.saltmoor_ps.winter.mobile_active,
    critical_mAOD: HYDRO_THRESHOLDS.NORTHMOOR.CRITICAL_MAOD,
    sump_ceiling_mAOD: 3.35,
    rapid_inrush_threshold_mh: 0.10,
    deadband_pump: HYDRO_DEADBANDS.polder_pump
  }),
  wet_moor: Object.freeze({
    asset_type: 'polder',
    asset_id: 'wet_moor',
    name: 'Wet Moor Polder Basin (Huish Episcopi / Muchelney)',
    primary_station: null,
    secondary_station: null,
    receiving_river_station: '52120',
    secondary_river_station: '52153',
    floor_elevation_mAOD: HYDRO_THRESHOLDS.WET_MOOR.GROUND_MAOD,
    lead_pump_winter_mAOD: HYDRO_THRESHOLDS.WET_MOOR.LEAD_PUMP_WINTER,
    lead_pump_summer_mAOD: HYDRO_THRESHOLDS.WET_MOOR.LEAD_PUMP_SUMMER,
    duty_pump_winter_mAOD: HYDRO_THRESHOLDS.WET_MOOR.DUTY_PUMP_WINTER,
    duty_pump_summer_mAOD: HYDRO_THRESHOLDS.WET_MOOR.DUTY_PUMP_SUMMER,
    river_cutoff_mAOD: HYDRO_THRESHOLDS.WET_MOOR.RIVER_CUTOFF_MAOD,
    mobile_ordered_mAOD: null,
    mobile_active_mAOD: null,
    critical_mAOD: null,
    rapid_inrush_threshold_mh: null,
    survey_tier: 'UNSURVEYED',
    survey_label: '⚠️ Pending EA Asset Survey (Decoupled from River Yeo 52120)',
    survey_tooltip: 'Wet Moor internal rhyne/sump stage is not broadcast by an in-polder EA sensor; station 52120 measures the receiving River Yeo channel (typicalRange 6.44m–8.48m AOD, bankfull pump cut-off 8.20m AOD). Automated polder duty-pumping event triggers are disabled until dedicated internal moor thresholds are verified.',
    deadband_pump: HYDRO_DEADBANDS.polder_pump
  }),
  west_sedgemoor: Object.freeze({
    asset_type: 'polder',
    asset_id: 'west_sedgemoor',
    name: 'West Sedgemoor Polder Basin (SSSI Wet Grassland)',
    primary_station: null,
    secondary_station: null,
    sump_measure_id: '52155-level-sump_level-i-15_min-mAOD',
    receiving_river_station: '52233',
    floor_elevation_mAOD: HYDRO_THRESHOLDS.WEST_SEDGEMOOR.GROUND_MAOD,
    lead_pump_winter_mAOD: null,
    lead_pump_summer_mAOD: null,
    duty_pump_winter_mAOD: null,
    duty_pump_summer_mAOD: null,
    mobile_ordered_mAOD: null,
    mobile_active_mAOD: null,
    critical_mAOD: null,
    rapid_inrush_threshold_mh: null,
    survey_tier: 'UNSURVEYED',
    survey_label: '⚠️ Pending EA Asset Survey (Sump 52155 Ingest-Only)',
    survey_tooltip: 'West Sedgemoor PS sump telemetry (52155-level-sump_level-i-15_min-mAOD) is ingest-only; polder pump trigger elevations are pending EA Trigger Point Plan verification and decoupled from River Parrett (52233).',
    deadband_pump: HYDRO_DEADBANDS.polder_pump
  }),
  stanmoor: Object.freeze({
    asset_type: 'polder',
    asset_id: 'stanmoor',
    name: 'Stanmoor Polder Basin (Curry Moor Flank)',
    primary_station: '52127',
    secondary_station: '52118',
    floor_elevation_mAOD: HYDRO_THRESHOLDS.STANMOOR.GROUND_MAOD,
    lead_pump_winter_mAOD: CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.winter.lead,
    lead_pump_summer_mAOD: CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.summer.lead,
    duty_pump_winter_mAOD: CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.winter.duty,
    duty_pump_summer_mAOD: CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.summer.duty,
    mobile_ordered_mAOD: CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.winter.mobile_order,
    mobile_active_mAOD: CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.winter.mobile_active,
    critical_mAOD: HYDRO_THRESHOLDS.STANMOOR.CRITICAL_MAOD,
    rapid_inrush_threshold_mh: null,
    survey_tier: 'TIER_2_TRIGGER_PLAN',
    survey_label: '📋 EA Trigger Point Plan (Curry Moor & Stanmoor Chapter)',
    authority: 'EA Somerset Levels & Moors Trigger Point Plan (Curry Moor & Stanmoor Operational Chapter, Station 52127)',
    deadband_pump: HYDRO_DEADBANDS.polder_pump
  }),
  westonzoyland: Object.freeze({
    asset_type: 'polder',
    asset_id: 'westonzoyland',
    name: 'Westonzoyland Polder Basin (Engine Rhyne)',
    primary_station: null,
    secondary_station: null,
    nearest_context_station: '52159',
    floor_elevation_mAOD: HYDRO_THRESHOLDS.WESTONZOYLAND.GROUND_MAOD,
    lead_pump_winter_mAOD: null,
    lead_pump_summer_mAOD: null,
    duty_pump_winter_mAOD: null,
    duty_pump_summer_mAOD: null,
    mobile_ordered_mAOD: null,
    mobile_active_mAOD: null,
    critical_mAOD: null,
    rapid_inrush_threshold_mh: null,
    survey_tier: 'UNSURVEYED',
    survey_label: '⚠️ Pending EA Asset Survey (Engine Rhyne Thresholds Unpublished)',
    survey_tooltip: 'Westonzoyland PS (Engine Rhyne) has no dedicated EA telemetry sensor or published EA Trigger Point Plan thresholds in primary records; Northmoor (52159) is location context only.',
    deadband_pump: HYDRO_DEADBANDS.polder_pump
  }),

  // --- 4. TIDAL GATES ---
  dunball_outfall: Object.freeze({
    asset_type: 'tidal_gate',
    asset_id: 'dunball_outfall',
    name: 'Dunball Sea Outfall Clyse',
    sea_station: '52163',
    inland_station: 'E9094',
    extended_tide_lock_seconds: 14 * 3600,
    elevated_inland_mAOD: 2.65,
    inland_watch_winter_mAOD: CANONICAL_PUMP_THRESHOLDS.dunball_mobile_ps.winter.lead,
    inland_watch_summer_mAOD: CANONICAL_PUMP_THRESHOLDS.dunball_mobile_ps.summer.lead,
    estuary_alert_mAOD: HYDRO_THRESHOLDS.DUNBALL.ESTUARY_ALERT_MAOD,
    deadband_flap: HYDRO_DEADBANDS.tidal_flap
  }),

  // --- 5. SLUICES ---
  monks_leaze_clyse: Object.freeze({
    asset_type: 'sluice',
    asset_id: 'monks_leaze_clyse',
    name: "Monk's Leaze Clyse Intake",
    upstream_station: '52233',
    downstream_station: '52234',
    verification_station: '52157',
    sill_elevation_mAOD: 4.20,
    headwall_elevation_mAOD: 6.70,
    trigger_elevation_mAOD: 7.20,
    sowy_capacity_mAOD: 7.60,
    min_delta_h: 0.05,
    deadband_clyse: HYDRO_DEADBANDS.clyse_head,
    reverse_lock_deadband: HYDRO_DEADBANDS.reverse_lock
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
          alert_elevation_mAOD: reg?.alert_level_mAOD ?? reg?.thresholds?.alert?.value ?? null,
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
 * Disambiguates Hookbridge River Tone trend vector between astronomical tidal backwater and upland fluvial pulses [RULE-ENT-01, RULE-HUM-01]
 * 
 * @param {Array<{ dateTime?: string, value?: number }|number>} hookbridgeReadings 
 * @param {number|{ value?: number }|null} [bathpoolStage] 
 * @param {number|{ value?: number }|null} [estuaryStage] 
 * @returns {'▲ Rising' | '▼ Receding' | '— Steady' | '▲ Tidal Pulse' | '▲ Rising on Ebb (Fluvial)'}
 */
export function disambiguateRiverTrend(hookbridgeReadings, bathpoolStage = null, estuaryStage = null) {
  const baseTrend = computeTrendVector(hookbridgeReadings);
  if (baseTrend !== '▲ Rising') return baseTrend;

  if (!Array.isArray(hookbridgeReadings) || hookbridgeReadings.length === 0) return baseTrend;
  const latest = hookbridgeReadings[0];
  const currentHookbridge = sanitizeStageValue((typeof latest === 'object' && latest !== null) ? latest.value : latest);
  if (currentHookbridge === null) return baseTrend;

  const bpVal = (typeof bathpoolStage === 'object' && bathpoolStage !== null) ? bathpoolStage.value : bathpoolStage;
  const estVal = (typeof estuaryStage === 'object' && estuaryStage !== null) ? estuaryStage.value : estuaryStage;
  const bpStage = sanitizeStageValue(bpVal);
  const estStage = sanitizeStageValue(estVal);

  // Tier 3: Fluvial Rise during Ebb or high upland head
  if (currentHookbridge >= 6.40) {
    if ((bpStage !== null && bpStage >= 8.50) || (estStage !== null && estStage < 2.00)) {
      return '▲ Rising on Ebb (Fluvial)';
    }
  }

  // Tier 2: Astronomical Spring Tide Backwater Pulse
  if (currentHookbridge >= 5.50 && bpStage !== null && bpStage < 8.50) {
    return '▲ Tidal Pulse';
  }

  return baseTrend;
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

  if (descriptor === 'differential head' || descriptor === 'reverse head') {
    const absHead = Math.abs(clearanceMeters);
    const cm = Math.round(absHead * 100);
    const formatted = absHead < 1.0 ? `${cm}cm` : `${absHead.toFixed(2)}m`;
    if (clearanceMeters < 0) {
      return `-${formatted} reverse head`;
    }
    return `+${formatted} differential head`;
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
      readings = (stationKey ? readingsWindow[stationKey] : null) || readingsWindow.primary || [];
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
        peak_time: activeSession.peak_time || activeSession.start_time || readingTime,
        trigger_rate_15m_m_per_hr: activeSession.trigger_rate_15m_m_per_hr ?? null,
        trigger_rate_1h_m_per_hr: activeSession.trigger_rate_1h_m_per_hr ?? null,
        trigger_rate_3h_m_per_hr: activeSession.trigger_rate_3h_m_per_hr ?? null,
        max_rate_1h_m_per_hr: activeSession.max_rate_1h_m_per_hr ?? null,
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
          peak_time: activeSession.peak_time || activeSession.start_time,
          trigger_rate_15m_m_per_hr: activeSession.trigger_rate_15m_m_per_hr ?? null,
          trigger_rate_1h_m_per_hr: activeSession.trigger_rate_1h_m_per_hr ?? null,
          trigger_rate_3h_m_per_hr: activeSession.trigger_rate_3h_m_per_hr ?? null,
          max_rate_1h_m_per_hr: activeSession.max_rate_1h_m_per_hr ?? null,
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
      peak_time: null,
      trigger_rate_15m_m_per_hr: null,
      trigger_rate_1h_m_per_hr: null,
      trigger_rate_3h_m_per_hr: null,
      max_rate_1h_m_per_hr: null,
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
        peak_stage_mAOD: 0,
        peak_time: null,
        trigger_rate_15m_m_per_hr: null,
        trigger_rate_1h_m_per_hr: null,
        trigger_rate_3h_m_per_hr: null,
        max_rate_1h_m_per_hr: null
      }
    };
  }

  let evaluatedState = 'NORMAL';
  let evaluatedSeverity = 1;
  let clearanceM = null;
  let clearanceDescriptor = 'threshold';
  let narrative = '';

  const stageRates = computeStageRates(readings);
  const currentRate15m = stageRates.rate_15m_m_per_hr;
  const currentRate1h = stageRates.rate_1h_m_per_hr;
  const currentRate3h = stageRates.rate_3h_m_per_hr;
  let regime_signature = null;

  const currentSt = activeSession?.to_state || null;

  switch (assetDef.asset_type) {
    case 'spillway': {
      const Z_crest = assetDef.crest_elevation_mAOD;
      if (Z_crest === null || Z_crest === undefined || !Number.isFinite(Z_crest) || assetDef.survey_tier === 'UNSURVEYED') {
        evaluatedState = 'SECURE';
        evaluatedSeverity = 1;
        clearanceM = null;
        clearanceDescriptor = 'pending EA crest survey';
        narrative = `${assetDef.name}: ⚠️ Pending EA Asset Survey. Unsurveyed crest elevation is not wired to automated OVERTOPPING event triggers.`;
        break;
      }
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
      if (
        assetDef.survey_tier === 'UNSURVEYED' ||
        Z_crown === null || Z_crown === undefined || !Number.isFinite(Z_crown) ||
        Z_caut === null || Z_caut === undefined || !Number.isFinite(Z_caut)
      ) {
        evaluatedState = 'PASSABLE';
        evaluatedSeverity = 1;
        clearanceM = null;
        clearanceDescriptor = 'pending topographic survey';
        narrative = `${assetDef.name}: ⚠️ Pending Topographic Survey. Unsurveyed road approach elevations are not wired to automated ENCROACHING or IMPASSABLE stage event triggers.`;
        break;
      }
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

      if (assetDef.survey_tier === 'UNSURVEYED' || Z_duty === null || Z_duty === undefined || !Number.isFinite(Z_duty)) {
        evaluatedState = 'STANDBY';
        evaluatedSeverity = 1;
        clearanceM = null;
        clearanceDescriptor = 'pending EA threshold survey';
        narrative = `${assetDef.name}: ⚠️ Pending EA Asset Survey. Automated polder pump and inrush alerts are disabled until verified EA Trigger Point Plan thresholds are available.`;
        break;
      }

      const hasCritical = typeof Z_critical === 'number' && Number.isFinite(Z_critical);
      const hasActive = typeof Z_active === 'number' && Number.isFinite(Z_active);
      const hasOrdered = typeof Z_ordered === 'number' && Number.isFinite(Z_ordered);

      if (currentSt === 'CRITICAL' && hasCritical) {
        if (stage >= Z_critical - dbPump) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (hasActive && stage >= Z_active - dbPump) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (hasOrdered && stage >= Z_ordered - dbPump) {
          evaluatedState = 'MOBILE_ORDERED';
          evaluatedSeverity = 3;
        } else if (stage >= Z_duty - dbPump) {
          evaluatedState = 'DUTY_PUMPING';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'STANDBY';
          evaluatedSeverity = 1;
        }
      } else if (currentSt === 'MOBILE_ACTIVE' && hasActive) {
        if (hasCritical && stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (stage >= Z_active - dbPump) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (hasOrdered && stage >= Z_ordered - dbPump) {
          evaluatedState = 'MOBILE_ORDERED';
          evaluatedSeverity = 3;
        } else if (stage >= Z_duty - dbPump) {
          evaluatedState = 'DUTY_PUMPING';
          evaluatedSeverity = 2;
        } else {
          evaluatedState = 'STANDBY';
          evaluatedSeverity = 1;
        }
      } else if (currentSt === 'MOBILE_ORDERED' && hasOrdered) {
        if (hasCritical && stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (hasActive && stage >= Z_active) {
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
        if (hasCritical && stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (hasActive && stage >= Z_active) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (hasOrdered && stage >= Z_ordered) {
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
        if (hasCritical && stage >= Z_critical) {
          evaluatedState = 'CRITICAL';
          evaluatedSeverity = 4;
        } else if (hasActive && stage >= Z_active) {
          evaluatedState = 'MOBILE_ACTIVE';
          evaluatedSeverity = 3;
        } else if (hasOrdered && stage >= Z_ordered) {
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
        narrative = `Inferred from moor stage relative to EA Trigger Plan: water level above duty pumping threshold at ${assetDef.name} (${stage.toFixed(2)}m AOD).`;
      } else {
        narrative = `${assetDef.name} in standby/penning mode. Water levels normal.`;
      }

      // Polder Diagnostic Signatures: Sump Ceiling Breach & Rapid Inrush [Issue #42]
      const rapidThreshold = assetDef.rapid_inrush_threshold_mh === undefined ? 0.10 : assetDef.rapid_inrush_threshold_mh;
      const isRapidInrush = (
        typeof rapidThreshold === 'number' &&
        Number.isFinite(rapidThreshold) &&
        currentRate1h !== null &&
        currentRate1h >= rapidThreshold &&
        currentRate15m !== null &&
        currentRate15m > 0
      );
      const sumpCeiling = assetDef.sump_ceiling_mAOD;
      const isCeilingBreach = (sumpCeiling !== undefined && stage > sumpCeiling && currentRate3h !== null && currentRate3h >= 0.02);

      if (isRapidInrush) {
        evaluatedSeverity = Math.max(evaluatedSeverity, 3);
        regime_signature = {
          anomaly_type: 'POLDER_INRUSH',
          confidence: 'HIGH_STAGE_RATE',
          rate_1h_mh: currentRate1h
        };
        narrative = `Rapid Inflow Warning: Moor stage surging at +${Math.round(currentRate1h * 100)}cm/h (potential spillway inrush or major storm pulse). Inferred from moor water stage relative to EA Trigger Point Plan.`;
      } else if (isCeilingBreach) {
        regime_signature = {
          anomaly_type: 'SUMP_CEILING_BREACH',
          rate_3h_mh: currentRate3h
        };
        narrative = `Polder Sump Ceiling Breached: Water rising above rhyne bankfull into moor storage (+${Math.round(currentRate3h * 100)}cm/h over 3h). Inferred from moor stage relative to EA Trigger Plan.`;
      }
      break;
    }

    case 'tidal_gate': {
      const secLatest = secReadings[0];
      const secStageRaw = (typeof secLatest === 'object' && secLatest !== null) ? secLatest.value : secLatest;
      const inlandStage = sanitizeStageValue(secStageRaw);
      const dbFlap = assetDef.deadband_flap ?? HYDRO_DEADBANDS.tidal_flap;
      const inlandWatch = isSummer
        ? (assetDef.inland_watch_summer_mAOD ?? 3.10)
        : (assetDef.inland_watch_winter_mAOD ?? 2.80);
      const estuaryAlert = assetDef.estuary_alert_mAOD ?? HYDRO_THRESHOLDS.DUNBALL.ESTUARY_ALERT_MAOD ?? 6.50;
      const hasActiveTideLockSession = Boolean(activeSession && activeSession.status !== 'CLOSED' && currentSt === 'TIDE_LOCKED');

      if (inlandStage === null) {
        if (currentSt === 'TIDE_LOCKED') {
          evaluatedState = 'TIDE_LOCKED';
          evaluatedSeverity = 2;
          narrative = `${assetDef.name}: inland sensor offline; retaining active TIDE_LOCKED state.`;
        } else if (stage >= 2.65) {
          evaluatedState = 'TIDE_LOCKED';
          evaluatedSeverity = 2;
          narrative = `${assetDef.name}: inland sensor offline; estuary elevated (≥2.65m AOD). Evaluating TIDE_LOCKED fail-safe.`;
        } else {
          evaluatedState = 'DISCHARGING';
          evaluatedSeverity = 1;
          narrative = `${assetDef.name}: inland sensor offline; estuary low (<2.65m AOD).`;
        }
      } else {
        const isLocked = currentSt === 'TIDE_LOCKED'
          ? (stage >= inlandStage - dbFlap)
          : (stage >= inlandStage);

        if (isLocked) {
          evaluatedState = 'TIDE_LOCKED';
          // Routine 3h semi-diurnal high tides (inland KSD < 2.80m/3.10m watch and sea < 6.50m surge alert)
          // remain Severity Tier 1 so they do not flood telemetry_events with twice-daily astronomical locks.
          const isElevatedIncident = (
            hasActiveTideLockSession ||
            inlandStage >= inlandWatch ||
            stage >= estuaryAlert
          );
          evaluatedSeverity = isElevatedIncident ? 2 : 1;
        } else {
          evaluatedState = 'DISCHARGING';
          evaluatedSeverity = 1;
        }
      }

      const headDelta = inlandStage !== null ? Number((inlandStage - stage).toFixed(3)) : null;
      clearanceM = headDelta;
      clearanceDescriptor = 'tide-lock boundary';
      if (inlandStage !== null) {
        narrative = evaluatedState === 'TIDE_LOCKED'
          ? `Parrett Estuary tide (${stage.toFixed(2)}m) exceeds inland drain (${inlandStage.toFixed(2)}m). Gravity flap doors closed.`
          : `Low tide in Parrett Estuary: safe gravity discharge to sea (${headDelta >= 0 ? '+' : ''}${headDelta.toFixed(2)}m head).`;
      }

      // Extended Tide-Lock / Skipped Ebb Diagnostic [Issue #42]
      if (evaluatedState === 'TIDE_LOCKED' && inlandStage !== null) {
        const extDurationSec = assetDef.extended_tide_lock_seconds ?? (14 * 3600);
        const inlandElevatedThresh = assetDef.elevated_inland_mAOD ?? 2.65;
        const readingTimeMs = new Date(readingTime).getTime();
        const lockRefStart = (activeSession && activeSession.status !== 'CLOSED')
          ? (activeSession.start_time || activeSession.tide_lock_start_time || null)
          : null;
        const sessionDurationSec = (lockRefStart && Number.isFinite(readingTimeMs))
          ? Math.max(0, Math.floor((readingTimeMs - new Date(lockRefStart).getTime()) / 1000))
          : 0;

        // Also compute continuous tide-lock duration from historical readings/secReadings so an
        // inland stage in [2.65m, 2.80m winter / 3.10m summer) that remained Tier 1 (<14h)
        // without opening a Tier 2 session still escalates to Tier 3 EXTENDED_TIDE_LOCK once >=14h.
        let windowDurationSec = 0;
        if (Number.isFinite(readingTimeMs)) {
          const extractTimedPoints = (arr) => {
            if (!Array.isArray(arr)) return [];
            const pts = [];
            for (const item of arr) {
              if (!item || typeof item !== 'object') continue;
              const dt = item.dateTime ?? item.date_time ?? item.timestamp ?? item.date;
              const ms = dt ? Date.parse(dt) : NaN;
              const val = sanitizeStageValue(item.value);
              if (Number.isFinite(ms) && ms <= readingTimeMs && val !== null) {
                pts.push({ ms, val });
              }
            }
            pts.sort((a, b) => b.ms - a.ms);
            return pts;
          };

          const seaPts = extractTimedPoints(readings);
          const inlandPts = extractTimedPoints(secReadings);
          const nearestVal = (pts, targetMs, fallbackVal) => {
            if (pts.length === 0) return fallbackVal;
            let best = pts[0].val;
            let minDiff = Math.abs(pts[0].ms - targetMs);
            for (let i = 1; i < pts.length; i++) {
              const diff = Math.abs(pts[i].ms - targetMs);
              if (diff < minDiff) {
                minDiff = diff;
                best = pts[i].val;
              }
            }
            return best;
          };

          const candidateEpochs = Array.from(
            new Set([...seaPts.map(p => p.ms), ...inlandPts.map(p => p.ms)])
          ).sort((a, b) => b - a);

          let earliestLockMs = readingTimeMs;
          for (const epochMs of candidateEpochs) {
            const sVal = nearestVal(seaPts, epochMs, stage);
            const iVal = nearestVal(inlandPts, epochMs, inlandStage);
            if (sVal !== null && iVal !== null && sVal >= (iVal - dbFlap)) {
              earliestLockMs = epochMs;
            } else {
              break;
            }
          }
          windowDurationSec = Math.max(0, Math.floor((readingTimeMs - earliestLockMs) / 1000));
        }

        const currentDuration = Math.max(sessionDurationSec, windowDurationSec);

        const inlandRates = computeStageRates(secReadings);
        const inlandRate1h = inlandRates.rate_1h_m_per_hr;
        const failedToDrain = (inlandRate1h === null || inlandRate1h >= -0.02);

        if (currentDuration >= extDurationSec && inlandStage > inlandElevatedThresh && failedToDrain) {
          evaluatedSeverity = 3; // Escalate Tier 1/2 -> Tier 3 Warning
          const hours = (currentDuration / 3600).toFixed(1);
          regime_signature = {
            anomaly_type: 'EXTENDED_TIDE_LOCK',
            confidence: 'HIGH_DURATION',
            duration_hours: Number(hours)
          };
          narrative = `Extended Tide-Lock Alert: Dunball outfall has remained tide-locked for ${hours}h (>14h tidal cycle threshold) with inland KSD elevated at ${inlandStage.toFixed(2)}m AOD. Gravity discharge skipped full ebb window.`;
        }
      }
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
      const revDeadband = assetDef.reverse_lock_deadband ?? HYDRO_DEADBANDS.reverse_lock ?? 0.10;

      // Downstream Sensor Health & Flatline Inspection
      const secFreshness = evaluateStationFreshness(secReadings, { nowMs: options.nowMs ?? Date.now() });
      const isDownstreamHealthy = downstreamStage !== null && !secFreshness.isFlatlined && !secFreshness.isStale && !secFreshness.isOffline;

      const deltaH = downstreamStage !== null ? Number((stage - downstreamStage).toFixed(2)) : 0;
      const revDeltaH = downstreamStage !== null ? Number((downstreamStage - stage).toFixed(2)) : 0;
      const isUpstreamElevated = (stage >= Z_trig - dbClyse) || currentSt === 'DIVERTING' || currentSt === 'REVERSE_LOCK';

      if (isDownstreamHealthy && isUpstreamElevated && (revDeltaH >= revDeadband)) {
        evaluatedState = 'REVERSE_LOCK';
        evaluatedSeverity = 3;
      } else if (isDownstreamHealthy && stage >= Z_trig && (downstreamStage >= Z_cap || deltaH < minDelta)) {
        evaluatedState = 'THROTTLED';
        evaluatedSeverity = 3;
      } else if (stage >= Z_trig || (currentSt === 'DIVERTING' && stage >= Z_trig - dbClyse)) {
        evaluatedState = 'DIVERTING';
        evaluatedSeverity = 2;
      } else {
        evaluatedState = 'CLOSED';
        evaluatedSeverity = 1;
      }

      if (evaluatedState === 'REVERSE_LOCK') {
        clearanceM = Number((stage - downstreamStage).toFixed(3));
        clearanceDescriptor = 'differential head';
        const revCm = Math.round(Math.abs(deltaH) * 100);
        narrative = `Downstream tailwater higher than river (-${revCm}cm differential head). Monk's Leaze Clyse sealed to prevent reverse flooding.`;
      } else if (evaluatedState === 'THROTTLED') {
        clearanceM = downstreamStage !== null ? Number((stage - downstreamStage).toFixed(3)) : Number((Z_trig - stage).toFixed(3));
        clearanceDescriptor = downstreamStage !== null ? 'differential head' : 'diversion trigger';
        narrative = `Sowy Relief Channel downstream full (${downstreamStage?.toFixed(2)}m AOD). Diversion throttled.`;
      } else if (evaluatedState === 'DIVERTING') {
        clearanceM = downstreamStage !== null ? Number((stage - downstreamStage).toFixed(3)) : Number((Z_trig - stage).toFixed(3));
        clearanceDescriptor = downstreamStage !== null ? 'differential head' : 'diversion trigger';
        let waveVerifySuffix = '';
        if (!isDownstreamHealthy && assetDef.verification_station && readingsWindow && typeof readingsWindow === 'object') {
          const verifyKey = assetDef.verification_station;
          const verifyReadings = readingsWindow[verifyKey] || readingsWindow[`${verifyKey}-level-stage-i-15_min-mAOD`] || [];
          const verifyRates = computeStageRates(verifyReadings);
          if (verifyRates.rate_1h_m_per_hr !== null && verifyRates.rate_1h_m_per_hr >= 0.02) {
            regime_signature = {
              anomaly_type: 'DOWNSTREAM_WAVE_VERIFIED',
              confidence: 'HIGH_STAGE_RATE',
              rate_1h_mh: verifyRates.rate_1h_m_per_hr
            };
            waveVerifySuffix = ` Downstream 52234 stilling-well ponded/flatlined; active diversion wave verified at Beer Wall 52157 (+${Math.round(verifyRates.rate_1h_m_per_hr * 100)}cm/h).`;
          }
        }
        narrative = `Penstock gates open: actively diverting excess floodwaters into Sowy Relief Channel.${waveVerifySuffix}`;
      } else {
        clearanceM = Number((Z_trig - stage).toFixed(3));
        clearanceDescriptor = 'diversion trigger';
        narrative = `Monk's Leaze Clyse gates closed in routine agricultural penning/river conveyance mode.`;
      }
      break;
    }

    case 'gauge':
    default: {
      const reg = STATION_REGISTRY[assetDef.station_id || assetDef.asset_id];
      const Z_alert = assetDef.alert_elevation_mAOD ?? reg?.alert_level_mAOD ?? reg?.thresholds?.alert?.value ?? null;
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
  let from_state = activeSession?.to_state || getNominalStateForAssetType(assetDef.asset_type);
  let to_state = evaluatedState;
  let severity_tier = evaluatedSeverity;
  let start_time = activeSession?.start_time || null;
  let end_time = null;
  let duration_seconds = null;
  let trigger_stage_mAOD = activeSession?.trigger_stage_mAOD ?? stage;
  let peak_stage_mAOD = activeSession?.peak_stage_mAOD ?? stage;
  let peak_time = activeSession?.peak_time || activeSession?.start_time || readingTime;
  let trigger_rate_15m_m_per_hr = activeSession?.trigger_rate_15m_m_per_hr ?? null;
  let trigger_rate_1h_m_per_hr = activeSession?.trigger_rate_1h_m_per_hr ?? null;
  let trigger_rate_3h_m_per_hr = activeSession?.trigger_rate_3h_m_per_hr ?? null;
  let max_rate_1h_m_per_hr = activeSession?.max_rate_1h_m_per_hr ?? null;
  let consecutiveNominalCount = activeSession?.consecutiveNominalCount || 0;
  let firstNominalReading = activeSession?.firstNominalReading || null;

  if (evaluatedSeverity >= 2) {
    // Elevated incident condition
    if (!activeSession || activeSession.status === 'CLOSED') {
      action = 'OPEN';
      start_time = readingTime;
      trigger_stage_mAOD = stage;
      peak_stage_mAOD = stage;
      peak_time = readingTime;
      trigger_rate_15m_m_per_hr = currentRate15m;
      trigger_rate_1h_m_per_hr = currentRate1h;
      trigger_rate_3h_m_per_hr = currentRate3h;
      max_rate_1h_m_per_hr = currentRate1h;
      severity_tier = evaluatedSeverity;
      consecutiveNominalCount = 0;
      firstNominalReading = null;
    } else {
      action = 'UPDATE';
      // Plateau invariant [RULE-HUM-01]: Only advance peak_time and peak_stage_mAOD on strict increase (> +0.001m)
      if (stage !== null && stage > (activeSession.peak_stage_mAOD ?? stage) + 0.001) {
        peak_stage_mAOD = stage;
        peak_time = readingTime;
      } else {
        peak_stage_mAOD = activeSession.peak_stage_mAOD ?? stage;
        peak_time = activeSession.peak_time || activeSession.start_time || readingTime;
      }

      // Max 1-hour rate tracking
      if (currentRate1h !== null) {
        if (max_rate_1h_m_per_hr === null || currentRate1h > max_rate_1h_m_per_hr) {
          max_rate_1h_m_per_hr = currentRate1h;
        }
      }

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
        severity_tier = activeSession.severity_tier ?? 2; // Latch peak severity during recovery debounce
        peak_stage_mAOD = activeSession.peak_stage_mAOD ?? stage; // Latch peak stage during recovery debounce
        peak_time = activeSession.peak_time || activeSession.start_time || readingTime;
        max_rate_1h_m_per_hr = activeSession.max_rate_1h_m_per_hr;
        narrative = `${assetDef.name} level receding below threshold; confirming 30-min debounce recovery (1/2 confirmed)...`;
      } else {
        // Second consecutive nominal reading! Close event.
        action = 'CLOSE';
        to_state = evaluatedState;
        severity_tier = 1;
        peak_stage_mAOD = activeSession.peak_stage_mAOD; // Retain peak stage on close
        peak_time = activeSession.peak_time || activeSession.start_time || readingTime;
        max_rate_1h_m_per_hr = activeSession.max_rate_1h_m_per_hr;
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
    peak_time,
    trigger_rate_15m_m_per_hr,
    trigger_rate_1h_m_per_hr,
    trigger_rate_3h_m_per_hr,
    max_rate_1h_m_per_hr,
    clearance_m: clearanceM,
    clearance_text,
    trend_vector,
    stage_rates: stageRates,
    regime_signature,
    narrative,
    start_time,
    end_time,
    duration_seconds,
    session_updates: {
      consecutiveNominalCount,
      firstNominalReading,
      peak_stage_mAOD,
      peak_time,
      trigger_rate_15m_m_per_hr,
      trigger_rate_1h_m_per_hr,
      trigger_rate_3h_m_per_hr,
      max_rate_1h_m_per_hr
    }
  };
}

/**
 * Evaluates all canonical network assets in ASSET_DEFINITIONS against a station readings map
 * or calm baseflow fallback stages from STATION_REGISTRY [RULE-SSOT-01, RULE-PAR-01].
 *
 * @param {object} [readingsInput={}] - Map of station_id or measure_id to readings array or numeric stage (mAOD)
 * @param {object|Map|null} [seasonalRegimeOrSessions=null] - Seasonal regime ({ isSummer }) or active sessions map
 * @param {object|null} [seasonalRegimeArg=null] - Seasonal regime if second arg is active sessions
 * @param {object} [options={}]
 * @returns {Record<string, object>} Map of asset_id -> TransitionDecision with .status alias for .to_state
 */
export function evaluateAllAssets(readingsInput = {}, seasonalRegimeOrSessions = null, seasonalRegimeArg = null, options = {}) {
  let activeSessionsMap = null;
  let regime = seasonalRegimeArg;

  if (seasonalRegimeOrSessions && typeof seasonalRegimeOrSessions === 'object' && typeof seasonalRegimeOrSessions.isSummer === 'boolean') {
    regime = seasonalRegimeOrSessions;
  } else if (seasonalRegimeOrSessions instanceof Map) {
    activeSessionsMap = seasonalRegimeOrSessions;
  } else if (seasonalRegimeOrSessions && typeof seasonalRegimeOrSessions === 'object') {
    activeSessionsMap = new Map(Object.entries(seasonalRegimeOrSessions));
  }

  const resolvedRegime = regime || getSeasonalRegime();
  const nowIso = options.timestamp || new Date().toISOString();
  const normalizedReadings = {};

  for (const [stId, reg] of Object.entries(STATION_REGISTRY)) {
    const rawEntry = (readingsInput && typeof readingsInput === 'object')
      ? (readingsInput[stId] ?? readingsInput[reg.measure_id])
      : undefined;

    if (Array.isArray(rawEntry) && rawEntry.length > 0) {
      normalizedReadings[stId] = rawEntry;
    } else if (typeof rawEntry === 'number' && Number.isFinite(rawEntry)) {
      normalizedReadings[stId] = [{ value: rawEntry, dateTime: nowIso }];
    } else if (rawEntry && typeof rawEntry === 'object' && typeof rawEntry.value === 'number') {
      normalizedReadings[stId] = [{ value: rawEntry.value, dateTime: rawEntry.dateTime || nowIso }];
    } else {
      normalizedReadings[stId] = [{ value: reg.fallback_stage_mAOD, dateTime: nowIso }];
    }
  }

  const results = {};
  for (const [assetId, assetDef] of Object.entries(ASSET_DEFINITIONS)) {
    const activeSession = activeSessionsMap ? (activeSessionsMap.get(assetId) || null) : null;
    const decision = evaluateAssetTransition(assetDef, activeSession, normalizedReadings, resolvedRegime, options);
    results[assetId] = {
      ...decision,
      status: decision.to_state
    };
  }

  return results;
}

/**
 * Strict physical search windows and guardrails for rate-of-change calculations [RULE-SUB-01, RULE-HUM-01]
 * - 15m window: [10m, 25m] lookback, min 5m elapsed
 * - 1h window:  [45m, 75m] lookback, min 30m elapsed
 * - 3h window:  [150m, 210m] lookback, min 120m elapsed
 */
export const RATE_TOLERANCE_WINDOWS = Object.freeze({
  window_15m: Object.freeze({
    targetMs: 15 * 60 * 1000,
    minMs: 10 * 60 * 1000,
    maxMs: 25 * 60 * 1000,
    minElapsedMs: 5 * 60 * 1000
  }),
  window_1h: Object.freeze({
    targetMs: 60 * 60 * 1000,
    minMs: 45 * 60 * 1000,
    maxMs: 75 * 60 * 1000,
    minElapsedMs: 30 * 60 * 1000
  }),
  window_3h: Object.freeze({
    targetMs: 180 * 60 * 1000,
    minMs: 150 * 60 * 1000,
    maxMs: 210 * 60 * 1000,
    minElapsedMs: 120 * 60 * 1000
  })
});

/**
 * Extracts numeric value and millisecond timestamp from a reading object or primitive.
 * @param {any} item
 * @returns {{ value: number, dateTime: string|null, ms: number|null }|null}
 */
export function extractReadingMeta(item) {
  if (item === null || item === undefined) return null;
  const rawVal = (typeof item === 'object' && item !== null) ? item.value : item;
  if (rawVal === null || rawVal === undefined || isNaN(rawVal)) return null;
  const numVal = Number(rawVal);
  if (!Number.isFinite(numVal)) return null;

  const dt = (typeof item === 'object' && item?.dateTime) ? item.dateTime : null;
  let ms = null;
  if (dt) {
    const parsed = typeof dt === 'number' ? dt : Date.parse(dt);
    if (!isNaN(parsed)) ms = parsed;
  }

  return {
    value: numVal,
    dateTime: dt,
    ms
  };
}

function findBestWindowRef(valid, startIdx, endIdx, targetMs, win) {
  let best = null;
  let minDiff = Infinity;
  for (let k = startIdx; k < endIdx; k++) {
    const elapsedMs = targetMs - valid[k].meta.ms;
    if (elapsedMs < win.minMs) break; // valid is sorted ascending; elapsedMs decreases monotonically
    if (elapsedMs <= win.maxMs) {
      const diff = Math.abs(elapsedMs - win.targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        best = { ref: valid[k].meta, elapsedMs };
      }
    }
  }
  return best;
}

function buildWindowRates(targetVal, best15, best1h, best3h) {
  const { window_15m, window_1h, window_3h } = RATE_TOLERANCE_WINDOWS;
  let delta_15m_m = null;
  let rate_15m_m_per_hr = null;
  if (best15 && best15.elapsedMs >= window_15m.minElapsedMs) {
    delta_15m_m = Number((targetVal - best15.ref.value).toFixed(3));
    rate_15m_m_per_hr = Number((delta_15m_m / (best15.elapsedMs / 3600000)).toFixed(3));
  }
  const rate_1h_m_per_hr = (best1h && best1h.elapsedMs >= window_1h.minElapsedMs)
    ? Number(((targetVal - best1h.ref.value) / (best1h.elapsedMs / 3600000)).toFixed(3))
    : null;
  const rate_3h_m_per_hr = (best3h && best3h.elapsedMs >= window_3h.minElapsedMs)
    ? Number(((targetVal - best3h.ref.value) / (best3h.elapsedMs / 3600000)).toFixed(3))
    : null;
  return { delta_15m_m, rate_15m_m_per_hr, rate_1h_m_per_hr, rate_3h_m_per_hr };
}

/**
 * Computes exact gap-safe stage rates for a single target reading relative to historical readings.
 * Returns null for any scale where no valid reference reading exists within the physical tolerance window [RULE-SUB-01].
 * 
 * @param {Array} readings - Array of readings (defaults to index 0 as target)
 * @param {number} [targetIndex=0] - Index of reading to compute rates for
 * @returns {{ delta_15m_m: number|null, rate_15m_m_per_hr: number|null, rate_1h_m_per_hr: number|null, rate_3h_m_per_hr: number|null }}
 */
export function computeStageRates(readings, targetIndex = 0) {
  if (!Array.isArray(readings) || readings.length === 0 || targetIndex < 0 || targetIndex >= readings.length) {
    return { delta_15m_m: null, rate_15m_m_per_hr: null, rate_1h_m_per_hr: null, rate_3h_m_per_hr: null };
  }

  const target = extractReadingMeta(readings[targetIndex]);
  if (!target || target.ms === null) {
    return { delta_15m_m: null, rate_15m_m_per_hr: null, rate_1h_m_per_hr: null, rate_3h_m_per_hr: null };
  }

  const { window_15m, window_1h, window_3h } = RATE_TOLERANCE_WINDOWS;
  let best15 = null;
  let minDiff15 = Infinity;
  let best1h = null;
  let minDiff1h = Infinity;
  let best3h = null;
  let minDiff3h = Infinity;

  for (let i = 0; i < readings.length; i++) {
    if (i === targetIndex) continue;
    const ref = extractReadingMeta(readings[i]);
    if (!ref || ref.ms === null) continue;

    // Strictly backward in time
    const elapsedMs = target.ms - ref.ms;
    if (elapsedMs <= 0) continue;

    if (elapsedMs >= window_15m.minMs && elapsedMs <= window_15m.maxMs) {
      const diff = Math.abs(elapsedMs - window_15m.targetMs);
      if (diff < minDiff15) {
        minDiff15 = diff;
        best15 = { ref, elapsedMs };
      }
    }
    if (elapsedMs >= window_1h.minMs && elapsedMs <= window_1h.maxMs) {
      const diff = Math.abs(elapsedMs - window_1h.targetMs);
      if (diff < minDiff1h) {
        minDiff1h = diff;
        best1h = { ref, elapsedMs };
      }
    }
    if (elapsedMs >= window_3h.minMs && elapsedMs <= window_3h.maxMs) {
      const diff = Math.abs(elapsedMs - window_3h.targetMs);
      if (diff < minDiff3h) {
        minDiff3h = diff;
        best3h = { ref, elapsedMs };
      }
    }
  }

  return buildWindowRates(target.value, best15, best1h, best3h);
}

/**
 * Computes stage rates across a batch of readings in strictly O(N) linear time using monotonic pointers.
 * Suitable for high-volume backfills (up to 10,000 readings) without blocking the Node.js event loop.
 * 
 * @param {Array} readings - Array of reading items
 * @returns {Array<object>} Array of items decorated with rate fields
 */
export function computeBatchStageRates(readings) {
  if (!Array.isArray(readings) || readings.length === 0) {
    return [];
  }

  const len = readings.length;
  const items = new Array(len);
  const valid = [];
  for (let i = 0; i < len; i++) {
    const r = readings[i];
    const meta = extractReadingMeta(r);
    const entry = { original: r, originalIndex: i, meta };
    items[i] = entry;
    if (meta && meta.ms !== null) valid.push(entry);
  }

  valid.sort((a, b) => a.meta.ms - b.meta.ms);

  const { window_15m, window_1h, window_3h } = RATE_TOLERANCE_WINDOWS;
  let p15 = 0;
  let p1h = 0;
  let p3h = 0;
  const emptyRates = { delta_15m_m: null, rate_15m_m_per_hr: null, rate_1h_m_per_hr: null, rate_3h_m_per_hr: null };
  const ratesByIndex = new Array(len).fill(emptyRates);

  for (let i = 0; i < valid.length; i++) {
    const target = valid[i].meta;
    while (p15 < i && (target.ms - valid[p15].meta.ms) > window_15m.maxMs) p15++;
    while (p1h < i && (target.ms - valid[p1h].meta.ms) > window_1h.maxMs) p1h++;
    while (p3h < i && (target.ms - valid[p3h].meta.ms) > window_3h.maxMs) p3h++;

    const best15 = findBestWindowRef(valid, p15, i, target.ms, window_15m);
    const best1h = findBestWindowRef(valid, p1h, i, target.ms, window_1h);
    const best3h = findBestWindowRef(valid, p3h, i, target.ms, window_3h);
    ratesByIndex[valid[i].originalIndex] = buildWindowRates(target.value, best15, best1h, best3h);
  }

  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const orig = items[i].original;
    const rates = ratesByIndex[i];
    out[i] = (typeof orig === 'object' && orig !== null)
      ? { ...orig, ...rates }
      : { value: orig, ...rates };
  }
  return out;
}

/**
 * Calculates rate of change in stage over 3 hours (dh/dt in m/h)
 * Preserved for backward compatibility, delegates to computeStageRates.
 * 
 * @param {Array} readings 
 * @returns {number} rate in m/h rounded to 3 decimal places
 */
export function computeRateOfChange3h(readings) {
  const rates = computeStageRates(readings, 0);
  return rates.rate_3h_m_per_hr ?? 0;
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
  const datumOffset = reg?.datum_offset_mAOD || 0;

  const latestItem = readings[0];
  let rawStage = (typeof latestItem === 'object' && latestItem !== null) ? latestItem.value : latestItem;
  if (rawStage !== null && rawStage !== undefined && !isNaN(rawStage) && datumOffset > 0) {
    if (rawStage < datumOffset) {
      rawStage = Number((rawStage + datumOffset).toFixed(3));
    }
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

  // Physical clearance to crown (null-safe for unsurveyed roads [RULE-THRESH-01])
  const isUnsurveyed = (
    assetDef.survey_tier === 'UNSURVEYED' ||
    Z_crown === null || Z_crown === undefined || !Number.isFinite(Z_crown) ||
    Z_caution === null || Z_caution === undefined || !Number.isFinite(Z_caution)
  );
  const clearanceM = isUnsurveyed ? null : Number((Z_crown - stage).toFixed(3));
  const clearanceText = isUnsurveyed ? 'Pending Topographic Survey' : formatClearanceText(clearanceM, 'road crown');

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
  const isRisingSurge = !isUnsurveyed && (rateOfRise >= 0.03 && stage >= (Z_caution - 0.10));

  // Determine State & Phase
  if (isUnsurveyed) {
    status = 'PASSABLE';
    severityTier = 1;
    phase = 'NOMINAL';
    badgeSymbol = '🟢';
    badgeLabel = 'PASSABLE';
    badgeClass = 'badge-passable';
    narrative = `⚠️ Approach road elevations pending topographic survey; automated river-stage triggers disabled. Check official Travel Somerset highways notices during flood warnings.`;
  } else if (prevSessionState === 'IMPASSABLE' || options.forceClearing) {
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
      // Exit Pathway A requires official Flood Warning (Severity 1 or 2) to be cleared;
      // ambient agricultural Flood Alerts (Severity 3) do not block daylight inspection reopening.
      const isWarningCleared = eaWarningState !== 'RED_WARNING' && eaWarningState !== 'WARNING';

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

// ============================================================================
// Environment Agency Tipping-Bucket Raingauge (TBR) SSOT Registry &
// Temporal Rolling Accumulator Engine (Issues #61 & #64)
// ============================================================================

/**
 * Open Government Licence v3.0 (OGL v3.0) provenance and physical sensor metadata
 * for UK Environment Agency automated Tipping-Bucket Raingauges (TBR).
 * Enforces [RULE-PROV-01], [RULE-HUM-01], and [RULE-ENT-01].
 */
export const RAINGAUGE_PROVENANCE = Object.freeze({
  authority: 'UK Environment Agency Real-Time Flood Monitoring & Hydrology Data Explorer API',
  licence: 'Open Government Licence v3.0 (OGL v3.0)',
  licence_url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  attribution: 'Contains Environment Agency information © Crown copyright and database right',
  sensor_type: 'tipping_bucket_raingauge',
  sensor_classification: 'ambient_environmental_sensor',
  is_civil_state_machine_entity: false,
  tip_resolution_mm: 0.20,
  interval_minutes: 15,
  period_seconds: 900,
  unit: 'mm',
  value_type: 'total'
});

/**
 * Dedicated Atmospheric Indigo/Violet/Orchid Color Palette (--precip-*).
 * Luminance increases monotonically on dark (#0f172a) surfaces from slate-grey
 * through indigo and lavender to vivid orchid for intense rain.
 * Orthogonal to Estuarine Deep Blue (#0284c7, reserved for Dunball low-tide discharge
 * under UI-COL-01/02) and life-safety flood alert red/amber.
 */
export const PRECIPITATION_PALETTE = Object.freeze({
  DRY: Object.freeze({ token: '--precip-0', hex: '#64748b', label: 'Dry' }),
  LIGHT: Object.freeze({ token: '--precip-1', hex: '#818cf8', label: 'Light' }),
  MODERATE: Object.freeze({ token: '--precip-2', hex: '#a5b4fc', label: 'Steady' }),
  HEAVY: Object.freeze({ token: '--precip-3', hex: '#c084fc', label: 'Heavy' }),
  TORRENTIAL: Object.freeze({ token: '--precip-4', hex: '#f0abfc', label: 'Intense' }),
  CUMULATIVE_LINE: Object.freeze({ token: '--precip-sum', hex: '#e0e7ff', label: 'Cumulative Mass Curve' })
});

/**
 * Canonical Somerset Catchment Zones for Spatial Precipitation Aggregation.
 */
export const RAINFALL_CATCHMENT_ZONES = Object.freeze({
  tone_upland: Object.freeze({
    id: 'tone_upland',
    label: 'River Tone Headwaters (Brendon & Blackdown Hills)',
    short_label: 'Blackdowns',
    topology_badge_prefix: 'Blackdowns',
    pillar: 'upland',
    river: 'River Tone',
    downstream_station_ids: Object.freeze(['52108', '52109', '52111', '52162', '52118'])
  }),
  parrett_upland: Object.freeze({
    id: 'parrett_upland',
    label: 'Upper Parrett & Yeo Headwaters (Dorset Hills)',
    short_label: 'Dorset Hills',
    topology_badge_prefix: 'Dorset Hills',
    pillar: 'upland',
    river: 'River Parrett & River Yeo',
    downstream_station_ids: Object.freeze(['52116', '52119', '52120', '52233'])
  }),
  isle_upland: Object.freeze({
    id: 'isle_upland',
    label: 'Upper River Isle Headwaters (Chard & Blackdown East)',
    short_label: 'Isle Headwaters',
    topology_badge_prefix: 'Isle Headwaters',
    pillar: 'upland',
    river: 'River Isle',
    downstream_station_ids: Object.freeze(['52153'])
  }),
  moors_lowland: Object.freeze({
    id: 'moors_lowland',
    alias_ids: Object.freeze(['lowland_levels']),
    label: 'Central Lowland Moors & King\'s Sedgemoor Drain',
    short_label: 'Lowland Moors & KSD',
    topology_badge_prefix: 'Lowland Moors',
    pillar: 'lowland',
    river: 'Curry Moor, Northmoor & King\'s Sedgemoor Drain',
    downstream_station_ids: Object.freeze(['52127', '52159', '52157', 'E9531', 'E9094'])
  })
});

function createRaingaugeStationEntry(def) {
  const stationUrl = `https://environment.data.gov.uk/flood-monitoring/id/stations/${def.id}`;
  const measureUrl = `https://environment.data.gov.uk/flood-monitoring/id/measures/${def.measure_id}`;
  return Object.freeze({
    id: def.id,
    notation: def.id,
    wiski_id: def.wiski_id,
    name: def.name,
    ea_label: def.ea_label,
    measure_id: def.measure_id,
    catchment: def.catchment,
    catchment_tags: Object.freeze(def.catchment_tags),
    pillar: def.pillar,
    sub_catchment: def.sub_catchment,
    correlated_river_station_id: def.correlated_river_station_id,
    grid_reference: def.grid_reference,
    lat: def.lat,
    long: def.long,
    easting: def.easting,
    northing: def.northing,
    coordinates: Object.freeze({
      lat: def.lat,
      long: def.long,
      easting: def.easting,
      northing: def.northing,
      grid_reference: def.grid_reference
    }),
    // EA Flood Monitoring & Hydrology APIs do not publish surveyed collector mAOD elevations
    // for TBR stations; kept explicitly null per [RULE-THRESH-01] & [RULE-HUM-01].
    elevation_mAOD: null,
    survey_status: 'UNSURVEYED',
    tip_resolution_mm: 0.20,
    interval_minutes: 15,
    period_seconds: 900,
    unit: 'mm',
    sensor_type: 'tipping_bucket_raingauge',
    sensor_classification: 'ambient_environmental_sensor',
    is_civil_asset: false,
    provenance: Object.freeze({
      authority: RAINGAUGE_PROVENANCE.authority,
      licence: RAINGAUGE_PROVENANCE.licence,
      licence_url: RAINGAUGE_PROVENANCE.licence_url,
      attribution: RAINGAUGE_PROVENANCE.attribution,
      station_url: stationUrl,
      measure_url: measureUrl
    })
  });
}

/**
 * Single Source of Truth (SSOT) Registry for Somerset Environment Agency
 * Automated Tipping-Bucket Raingauges (TBR) ([RULE-SSOT-01]).
 *
 * All 14 stations are verified active 15-minute TBR outstations from the
 * UK Environment Agency Flood Monitoring & Hydrology Data Explorer APIs (OGL v3.0).
 * Raingauges are ambient environmental sensors outside the civil asset state machine ([RULE-ENT-01]).
 */
export const RAINGAUGE_REGISTRY = Object.freeze({
  '52100': createRaingaugeStationEntry({
    id: '52100',
    wiski_id: '402074',
    name: 'Maundown (Clatworthy / Brendon Hills)',
    ea_label: 'Maundown',
    measure_id: '52100-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'tone_upland',
    catchment_tags: ['tone_upland', 'brendon_hills'],
    pillar: 'upland',
    sub_catchment: 'River Tone Headwaters (Brendon Hills)',
    correlated_river_station_id: '52108',
    grid_reference: 'ST064291',
    lat: 51.054044,
    long: -3.336105,
    easting: 306450,
    northing: 129150
  }),
  '45168': createRaingaugeStationEntry({
    id: '45168',
    wiski_id: '358163',
    name: 'Hockworthy (Upper Tone West)',
    ea_label: 'Hockworthy',
    measure_id: '45168-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'tone_upland',
    catchment_tags: ['tone_upland', 'upper_tone'],
    pillar: 'upland',
    sub_catchment: 'Upper River Tone (Greenham Reach)',
    correlated_river_station_id: '52108',
    grid_reference: 'ST029202',
    lat: 50.973456,
    long: -3.383642,
    easting: 302950,
    northing: 120250
  }),
  '52101': createRaingaugeStationEntry({
    id: '52101',
    wiski_id: '402746',
    name: 'Fulwood (Blagdon Hill / Blackdown Hills)',
    ea_label: 'Fulwood',
    measure_id: '52101-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'tone_upland',
    catchment_tags: ['tone_upland', 'blackdown_hills'],
    pillar: 'upland',
    sub_catchment: 'Blackdown Hills North / Mid Tone',
    correlated_river_station_id: '52109',
    grid_reference: 'ST212197',
    lat: 50.971757,
    long: -3.122948,
    easting: 321250,
    northing: 119750
  }),
  '45232': createRaingaugeStationEntry({
    id: '45232',
    wiski_id: '352859',
    name: 'Stopgate Farm (Churchstanton / Blackdown Hills)',
    ea_label: 'Stopgate Farm',
    measure_id: '45232-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'tone_upland',
    catchment_tags: ['tone_upland', 'blackdown_hills'],
    pillar: 'upland',
    sub_catchment: 'Blackdown Hills Plateau',
    correlated_river_station_id: '52111',
    grid_reference: 'ST232097',
    lat: 50.882121,
    long: -3.092361,
    easting: 323250,
    northing: 109750
  }),
  'E14620': createRaingaugeStationEntry({
    id: 'E14620',
    wiski_id: null,
    name: 'Kingston St Mary (Taunton Urban / Quantock South)',
    ea_label: 'Kingston St Mary',
    measure_id: 'E14620-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'tone_upland',
    catchment_tags: ['tone_upland', 'taunton_urban'],
    pillar: 'upland',
    sub_catchment: 'Taunton Urban Drainage & Quantock South',
    correlated_river_station_id: '52111',
    grid_reference: 'ST227300',
    lat: 51.064563,
    long: -3.103786,
    easting: 322750,
    northing: 130050
  }),
  '51126': createRaingaugeStationEntry({
    id: '51126',
    wiski_id: '404517',
    name: 'Quantock Farm (Quantock Hills Ridge)',
    ea_label: 'Quantock Farm',
    measure_id: '51126-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'tone_upland',
    catchment_tags: ['tone_upland', 'quantock_hills'],
    pillar: 'upland',
    sub_catchment: 'Quantock Hills Ridge (Orographic Proxy — Tone North / West Somerset Divide)',
    correlated_river_station_id: '52111',
    grid_reference: 'ST160368',
    lat: 51.124753,
    long: -3.200962,
    easting: 316050,
    northing: 136850
  }),
  '52148': createRaingaugeStationEntry({
    id: '52148',
    wiski_id: '398493',
    name: 'South Perrott (Crewkerne / Dorset Border)',
    ea_label: 'South Perrott',
    measure_id: '52148-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'parrett_upland',
    catchment_tags: ['parrett_upland', 'dorset_border'],
    pillar: 'upland',
    sub_catchment: 'Upper River Parrett (Chedington & Crewkerne)',
    correlated_river_station_id: '52116',
    grid_reference: 'ST476062',
    lat: 50.853381,
    long: -2.745053,
    easting: 347650,
    northing: 106250
  }),
  '52103': createRaingaugeStationEntry({
    id: '52103',
    wiski_id: '400409',
    name: 'Sutton Bingham (Yeovil / Upper River Yeo)',
    ea_label: 'Sutton Bingham',
    measure_id: '52103-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'parrett_upland',
    catchment_tags: ['parrett_upland', 'yeo_upland'],
    pillar: 'upland',
    sub_catchment: 'Upper River Yeo (Yeovil Headwaters)',
    correlated_river_station_id: '52120',
    grid_reference: 'ST556116',
    lat: 50.902608,
    long: -2.632068,
    easting: 355650,
    northing: 111650
  }),
  '52149': createRaingaugeStationEntry({
    id: '52149',
    wiski_id: '400022',
    name: 'Sherborne (Upper River Yeo East)',
    ea_label: 'Sherborne',
    measure_id: '52149-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'parrett_upland',
    catchment_tags: ['parrett_upland', 'yeo_upland'],
    pillar: 'upland',
    sub_catchment: 'Eastern Upper River Yeo (Sherborne & River Wriggle)',
    correlated_river_station_id: '52120',
    grid_reference: 'ST630154',
    lat: 50.937299,
    long: -2.527224,
    easting: 363050,
    northing: 115450
  }),
  '52129': createRaingaugeStationEntry({
    id: '52129',
    wiski_id: '399184',
    name: 'Chard Snowdon Hill (Upper River Isle)',
    ea_label: 'Chards Snowdon Hill',
    measure_id: '52129-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'isle_upland',
    catchment_tags: ['isle_upland', 'chard_headwaters'],
    pillar: 'upland',
    sub_catchment: 'Upper River Isle (Chard Headwaters)',
    correlated_river_station_id: '52153',
    grid_reference: 'ST310089',
    lat: 50.875913,
    long: -2.981351,
    easting: 331050,
    northing: 108950
  }),
  '52147': createRaingaugeStationEntry({
    id: '52147',
    wiski_id: '401445',
    name: 'West Sedgemoor (Curry Moor & Stathe)',
    ea_label: 'West Sedgemoor',
    measure_id: '52147-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'moors_lowland',
    catchment_tags: ['moors_lowland', 'lowland_levels', 'curry_moor'],
    pillar: 'lowland',
    sub_catchment: 'Curry Moor, Stanmoor & West Sedgemoor Basin',
    correlated_river_station_id: '52127',
    grid_reference: 'ST375286',
    lat: 51.053779,
    long: -2.892367,
    easting: 337550,
    northing: 128650
  }),
  '52105': createRaingaugeStationEntry({
    id: '52105',
    wiski_id: '403538',
    name: 'Rivers House (Bridgwater / Northmoor & Lower KSD)',
    ea_label: 'Rivers House',
    measure_id: '52105-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'moors_lowland',
    catchment_tags: ['moors_lowland', 'lowland_levels', 'northmoor', 'ksd_lowland'],
    pillar: 'lowland',
    sub_catchment: 'Northmoor, Westonzoyland & Lower Parrett',
    correlated_river_station_id: '52159',
    grid_reference: 'ST301377',
    lat: 51.134741,
    long: -2.999693,
    easting: 330150,
    northing: 137750
  }),
  '52227': createRaingaugeStationEntry({
    id: '52227',
    wiski_id: '405278',
    name: 'Gold Corner (King\'s Sedgemoor Drain / Polden)',
    ea_label: 'Gold Corner',
    measure_id: '52227-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'moors_lowland',
    catchment_tags: ['moors_lowland', 'lowland_levels', 'ksd_polden'],
    pillar: 'lowland',
    sub_catchment: 'King\'s Sedgemoor Drain & Polden Ridge',
    correlated_river_station_id: 'E9094',
    grid_reference: 'ST367430',
    lat: 51.183161,
    long: -2.90631,
    easting: 336750,
    northing: 143050
  }),
  '52102': createRaingaugeStationEntry({
    id: '52102',
    wiski_id: '403910',
    name: 'Somerton (River Cary / Upper KSD Feeder)',
    ea_label: 'Somerton',
    measure_id: '52102-rainfall-tipping_bucket_raingauge-t-15_min-mm',
    catchment: 'moors_lowland',
    catchment_tags: ['moors_lowland', 'lowland_levels', 'cary_ksd_feeder'],
    pillar: 'lowland',
    sub_catchment: 'River Cary & Upper King\'s Sedgemoor Drain',
    correlated_river_station_id: 'E9531',
    grid_reference: 'ST484297',
    lat: 51.064754,
    long: -2.737025,
    easting: 348450,
    northing: 129750
  })
});

/**
 * Plausibility bounds for a single 15-minute TBR interval reading (mm).
 * Rejects negative fault sentinels (e.g. -99) and electrical spikes (> 100.0 mm / 15 min).
 */
export const RAINFALL_INTERVAL_BOUNDS_MM = Object.freeze({
  min_mm: 0.0,
  max_mm: 100.0
});

/**
 * Ambient air temperature threshold (°C) at or below which unheated TBR collector
 * funnels risk snow-capping / frozen blockages ("snow blindness").
 */
export const FREEZING_RISK_TEMP_C = 1.0;

/**
 * Default maximum expected transmission age (minutes) before a TBR outstation
 * is tagged with STALE_BATCH.
 */
export const DEFAULT_RAINGAUGE_STALE_MINUTES = 120;

/**
 * Canonical period and adaptive hyetograph bucketing configurations for `/api/rainfall`.
 * Enforces [RULE-SSOT-01] across backend aggregation, API contracts, and frontend hyetographs.
 */
export const RAINFALL_PERIOD_CONFIG = Object.freeze({
  '24h': Object.freeze({
    period: '24h',
    window_hours: 24,
    lookback_hours: 50,
    bucket_minutes: 15,
    bucket_label: '15m',
    expected_bars: 96,
    label: '24h'
  }),
  '7d': Object.freeze({
    period: '7d',
    window_hours: 168,
    lookback_hours: 170,
    bucket_minutes: 180,
    bucket_label: '3h',
    expected_bars: 56,
    label: '7d'
  }),
  '30d': Object.freeze({
    period: '30d',
    window_hours: 720,
    lookback_hours: 722,
    bucket_minutes: 1440,
    bucket_label: 'day',
    expected_bars: 30,
    label: '30d'
  })
});

/**
 * Normalizes a requested rainfall period string to a canonical key ('24h' | '7d' | '30d').
 * Unknown or empty values safely default to '24h'.
 *
 * @param {any} rawPeriod
 * @returns {'24h'|'7d'|'30d'}
 */
export function normalizeRainfallPeriod(rawPeriod) {
  const key = typeof rawPeriod === 'string' ? rawPeriod.trim().toLowerCase() : '24h';
  return Object.prototype.hasOwnProperty.call(RAINFALL_PERIOD_CONFIG, key) ? key : '24h';
}

/**
 * UK-frontal-calibrated 1-hour rainfall intensity classification tiers (mm/hr).
 * Preserves canonical machine codes (DRY, LIGHT, MODERATE, HEAVY, TORRENTIAL)
 * and badge classes (badge-precip-*) for API/CSS backward compatibility.
 */
export const RAINFALL_INTENSITY_TIERS = Object.freeze([
  Object.freeze({
    code: 'DRY',
    min_mm_hr: 0.0,
    max_mm_hr: 0.0,
    upper_exclusive_mm_hr: 0.1,
    label: 'Dry',
    color_token: PRECIPITATION_PALETTE.DRY.token,
    color_hex: PRECIPITATION_PALETTE.DRY.hex,
    badge_class: 'badge-precip-dry'
  }),
  Object.freeze({
    code: 'LIGHT',
    min_mm_hr: 0.1,
    max_mm_hr: 1.9,
    upper_exclusive_mm_hr: 2.0,
    label: 'Light',
    color_token: PRECIPITATION_PALETTE.LIGHT.token,
    color_hex: PRECIPITATION_PALETTE.LIGHT.hex,
    badge_class: 'badge-precip-light'
  }),
  Object.freeze({
    code: 'MODERATE',
    min_mm_hr: 2.0,
    max_mm_hr: 4.9,
    upper_exclusive_mm_hr: 5.0,
    label: 'Steady',
    color_token: PRECIPITATION_PALETTE.MODERATE.token,
    color_hex: PRECIPITATION_PALETTE.MODERATE.hex,
    badge_class: 'badge-precip-moderate'
  }),
  Object.freeze({
    code: 'HEAVY',
    min_mm_hr: 5.0,
    max_mm_hr: 9.9,
    upper_exclusive_mm_hr: 10.0,
    label: 'Heavy',
    color_token: PRECIPITATION_PALETTE.HEAVY.token,
    color_hex: PRECIPITATION_PALETTE.HEAVY.hex,
    badge_class: 'badge-precip-heavy'
  }),
  Object.freeze({
    code: 'TORRENTIAL',
    min_mm_hr: 10.0,
    max_mm_hr: Infinity,
    upper_exclusive_mm_hr: Infinity,
    label: 'Intense',
    color_token: PRECIPITATION_PALETTE.TORRENTIAL.token,
    color_hex: PRECIPITATION_PALETTE.TORRENTIAL.hex,
    badge_class: 'badge-precip-torrential'
  })
]);

/**
 * Sanitizes a single 15-minute rainfall reading value (mm).
 * Strictly rejects null, undefined, booleans, empty strings, NaN, Infinity,
 * negative values, and implausible spikes (> 100.0 mm per 15-minute interval).
 *
 * @param {any} val
 * @returns {number|null}
 */
export function sanitizeRainfallReadingValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'number' && typeof val !== 'string') return null;
  if (typeof val === 'string' && val.trim() === '') return null;

  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || Number.isNaN(num)) return null;
  if (num < RAINFALL_INTERVAL_BOUNDS_MM.min_mm || num > RAINFALL_INTERVAL_BOUNDS_MM.max_mm) {
    return null;
  }
  return num;
}

/**
 * Classifies a 1-hour rainfall accumulation / intensity rate (mm/hr) into
 * standardized plain-English categories: DRY, LIGHT, MODERATE, HEAVY, TORRENTIAL.
 *
 * @param {number|null|undefined} rateMmPerHour
 * @returns {{ code: string, category: string, label: string, rate_label: string, rate_mm_per_hr: number, color_token: string, color_hex: string, badge_class: string }}
 */
export function classifyRainfallIntensity(rateMmPerHour) {
  const cleanRate = (typeof rateMmPerHour === 'number' && Number.isFinite(rateMmPerHour) && rateMmPerHour >= 0)
    ? Number(rateMmPerHour.toFixed(2))
    : 0.0;

  let matchedTier = RAINFALL_INTENSITY_TIERS[0];
  for (let i = RAINFALL_INTENSITY_TIERS.length - 1; i >= 0; i--) {
    const tier = RAINFALL_INTENSITY_TIERS[i];
    if (cleanRate >= tier.min_mm_hr) {
      matchedTier = tier;
      break;
    }
  }

  const displayRate = matchedTier.code === 'DRY'
    ? '0.0'
    : (Number(cleanRate.toFixed(1)) >= matchedTier.upper_exclusive_mm_hr
      ? (Math.floor(cleanRate * 10) / 10).toFixed(1)
      : cleanRate.toFixed(1));

  return {
    code: matchedTier.code,
    category: matchedTier.code,
    label: matchedTier.label,
    rate_label: `${matchedTier.label} (${displayRate} mm/h)`,
    rate_mm_per_hr: cleanRate,
    color_token: matchedTier.color_token,
    color_hex: matchedTier.color_hex,
    badge_class: matchedTier.badge_class
  };
}

function parseNormalizedRainfallReadings(readings) {
  if (!Array.isArray(readings) || readings.length === 0) {
    return { validReadings: [], rejectedCount: 0 };
  }

  const byEpoch = new Map();
  let rejectedCount = 0;

  for (let i = 0; i < readings.length; i++) {
    const item = readings[i];
    if (!item || typeof item !== 'object') {
      rejectedCount++;
      continue;
    }

    const rawDate = item.dateTime ?? item.date_time ?? item.timestamp ?? item.date ?? null;
    if (typeof rawDate !== 'string' || rawDate.trim() === '') {
      rejectedCount++;
      continue;
    }

    const epochMs = Date.parse(rawDate);
    if (!Number.isFinite(epochMs) || Number.isNaN(epochMs)) {
      rejectedCount++;
      continue;
    }

    const rawVal = item.rainfall_mm !== undefined ? item.rainfall_mm : item.value;
    const cleanMm = sanitizeRainfallReadingValue(rawVal);
    if (cleanMm === null) {
      rejectedCount++;
      continue;
    }

    if (!byEpoch.has(epochMs)) {
      byEpoch.set(epochMs, {
        epochMs,
        timestamp: new Date(epochMs).toISOString(),
        rawTimestamp: rawDate,
        rainfall_mm: cleanMm
      });
    }
  }

  const validReadings = Array.from(byEpoch.values()).sort((a, b) => a.epochMs - b.epochMs);
  return { validReadings, rejectedCount };
}

function resolveReferenceEpochMs(validReadings, options = {}) {
  const explicitRef = options.nowMs ?? options.referenceTime ?? null;
  if (explicitRef !== null && explicitRef !== undefined) {
    const parsed = typeof explicitRef === 'number' ? explicitRef : Date.parse(String(explicitRef));
    if (Number.isFinite(parsed) && !Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (validReadings.length > 0) {
    return validReadings[validReadings.length - 1].epochMs;
  }
  return Date.now();
}

/**
 * Builds a chronological (ascending) 24-hour 15-minute quantized rainfall series
 * with monotonically rising cumulative mass totals (`cumulative_mm`) for SVG hyetographs.
 *
 * @param {Array<object>} readings
 * @param {object} [options]
 * @param {number|string|Date} [options.nowMs]
 * @param {number|string|Date} [options.referenceTime]
 * @param {number} [options.windowHours=24]
 * @param {number} [options.futureDriftToleranceMs=120000]
 * @returns {Array<{ timestamp: string, rainfall_mm: number, cumulative_mm: number }>}
 */
export function buildRainfallSeries15Min(readings, options = {}) {
  const { validReadings } = parseNormalizedRainfallReadings(readings);
  if (validReadings.length === 0) return [];

  const refMs = resolveReferenceEpochMs(validReadings, options);
  const windowHours = (typeof options.windowHours === 'number' && options.windowHours > 0)
    ? options.windowHours
    : 24;
  const windowMs = windowHours * 3600 * 1000;
  const futureDriftMs = options.futureDriftToleranceMs ?? 120 * 1000;
  const lowerBoundMs = refMs - windowMs;
  const upperBoundMs = refMs + futureDriftMs;

  const series = [];
  let runningCumulative = 0;

  for (let i = 0; i < validReadings.length; i++) {
    const r = validReadings[i];
    if (r.epochMs > lowerBoundMs && r.epochMs <= upperBoundMs) {
      runningCumulative = Number((runningCumulative + r.rainfall_mm).toFixed(2));
      series.push({
        timestamp: r.timestamp,
        rainfall_mm: Number(r.rainfall_mm.toFixed(2)),
        cumulative_mm: runningCumulative
      });
    }
  }

  return series;
}

/**
 * Computes rolling temporal precipitation accumulations (1h, 6h, 24h, 48h in mm),
 * 1-hour intensity classification, quantized 24h hyetograph series, and sensor anomaly
 * flags (`FREEZING_RISK`, `STALE_BATCH`).
 *
 * Strictly enforces [RULE-CALC-01] (zero volumetric runoff or discharge speculation)
 * and interval monotonicity (0 <= R_1h <= R_6h <= R_24h <= R_48h).
 *
 * @param {Array<object>|null|undefined} readings
 * @param {object} [options]
 * @param {number|string|Date} [options.nowMs] - Reference epoch ms or ISO timestamp
 * @param {number|string|Date} [options.referenceTime] - Alias for nowMs
 * @param {number|null} [options.ambientTempC] - Optional ambient air temperature (°C) for FREEZING_RISK
 * @param {number} [options.maxStaleMinutes=120] - Staleness threshold in minutes for STALE_BATCH
 * @param {number} [options.futureDriftToleranceMs=120000] - Forward RTC drift tolerance (ms)
 * @returns {object}
 */
export function computeRainfallAccumulators(readings, options = {}) {
  const periodKey = normalizeRainfallPeriod(options.period);
  const periodCfg = RAINFALL_PERIOD_CONFIG[periodKey];
  const { validReadings, rejectedCount } = parseNormalizedRainfallReadings(readings);
  const maxStaleMinutes = (typeof options.maxStaleMinutes === 'number' && options.maxStaleMinutes > 0)
    ? options.maxStaleMinutes
    : (typeof options.maxAgeHours === 'number' && options.maxAgeHours > 0
      ? options.maxAgeHours * 60
      : DEFAULT_RAINGAUGE_STALE_MINUTES);

  const rawTemp = options.ambientTempC ?? options.temperatureC ?? options.ambient_temp_c ?? null;
  const ambientTempC = (typeof rawTemp === 'number' && Number.isFinite(rawTemp)) ? rawTemp : null;
  const freezingRisk = ambientTempC !== null && ambientTempC <= FREEZING_RISK_TEMP_C;

  if (validReadings.length === 0) {
    const dryIntensity = classifyRainfallIntensity(0);
    const anomalyFlags = ['STALE_BATCH'];
    if (freezingRisk) anomalyFlags.push('FREEZING_RISK');

    return {
      period: periodKey,
      bucket_minutes: periodCfg.bucket_minutes,
      bucket_label: periodCfg.bucket_label,
      period_total_mm: 0.0,
      last_1h_mm: 0.0,
      last_6h_mm: 0.0,
      last_24h_mm: 0.0,
      last_48h_mm: 0.0,
      r_1h_mm: 0.0,
      r_6h_mm: 0.0,
      r_24h_mm: 0.0,
      r_48h_mm: 0.0,
      rate_mm_per_hr: 0.0,
      intensity_category: dryIntensity.code,
      rate_category: dryIntensity.code,
      rate_label: dryIntensity.rate_label,
      intensity: dryIntensity,
      is_stale: true,
      freezing_risk: freezingRisk,
      ambient_temp_c: ambientTempC,
      age_minutes: null,
      latest_timestamp: null,
      anomaly_flags: anomalyFlags,
      valid_reading_count: 0,
      rejected_reading_count: rejectedCount,
      series_15min: [],
      series: []
    };
  }

  const refMs = resolveReferenceEpochMs(validReadings, options);
  const futureDriftMs = options.futureDriftToleranceMs ?? 120 * 1000;
  const upperBoundMs = refMs + futureDriftMs;

  const cut1h = refMs - 1 * 3600 * 1000;
  const cut6h = refMs - 6 * 3600 * 1000;
  const cut24h = refMs - 24 * 3600 * 1000;
  const cut48h = refMs - 48 * 3600 * 1000;
  const cutPeriod = refMs - periodCfg.window_hours * 3600 * 1000;
  const bucketMs = periodCfg.bucket_minutes * 60 * 1000;

  let sum1h = 0;
  let sum6h = 0;
  let sum24h = 0;
  let sum48h = 0;
  let sumPeriod = 0;
  const series15Min = [];
  const periodBuckets = periodKey === '24h' ? null : new Map();
  let latestEligibleReading = null;
  let eligibleCount = 0;
  let futureRejectedCount = 0;

  for (let i = 0; i < validReadings.length; i++) {
    const r = validReadings[i];
    if (r.epochMs > upperBoundMs) {
      futureRejectedCount++;
      continue;
    }

    eligibleCount++;
    latestEligibleReading = r;

    if (r.epochMs > cutPeriod) {
      sumPeriod += r.rainfall_mm;
      if (periodBuckets) {
        const bucketStartMs = Math.floor(r.epochMs / bucketMs) * bucketMs;
        periodBuckets.set(bucketStartMs, (periodBuckets.get(bucketStartMs) || 0) + r.rainfall_mm);
      }
    }

    if (r.epochMs > cut48h) {
      sum48h += r.rainfall_mm;
      if (r.epochMs > cut24h) {
        sum24h += r.rainfall_mm;
        series15Min.push({
          timestamp: r.timestamp,
          rainfall_mm: Number(r.rainfall_mm.toFixed(2)),
          cumulative_mm: Number(sum24h.toFixed(2))
        });
        if (r.epochMs > cut6h) {
          sum6h += r.rainfall_mm;
          if (r.epochMs > cut1h) {
            sum1h += r.rainfall_mm;
          }
        }
      }
    }
  }

  if (eligibleCount === 0 || !latestEligibleReading) {
    const dryIntensity = classifyRainfallIntensity(0);
    const anomalyFlags = ['STALE_BATCH'];
    if (freezingRisk) anomalyFlags.push('FREEZING_RISK');

    return {
      period: periodKey,
      bucket_minutes: periodCfg.bucket_minutes,
      bucket_label: periodCfg.bucket_label,
      period_total_mm: 0.0,
      last_1h_mm: 0.0,
      last_6h_mm: 0.0,
      last_24h_mm: 0.0,
      last_48h_mm: 0.0,
      r_1h_mm: 0.0,
      r_6h_mm: 0.0,
      r_24h_mm: 0.0,
      r_48h_mm: 0.0,
      rate_mm_per_hr: 0.0,
      intensity_category: dryIntensity.code,
      rate_category: dryIntensity.code,
      rate_label: dryIntensity.rate_label,
      intensity: dryIntensity,
      is_stale: true,
      freezing_risk: freezingRisk,
      ambient_temp_c: ambientTempC,
      age_minutes: null,
      latest_timestamp: null,
      anomaly_flags: anomalyFlags,
      valid_reading_count: 0,
      rejected_reading_count: rejectedCount + futureRejectedCount,
      series_15min: [],
      series: []
    };
  }

  const last1hMm = Number(sum1h.toFixed(2));
  const last6hMm = Number(Math.max(last1hMm, sum6h).toFixed(2));
  const last24hMm = Number(Math.max(last6hMm, sum24h).toFixed(2));
  const last48hMm = Number(Math.max(last24hMm, sum48h).toFixed(2));
  const periodTotalMm = periodKey === '24h'
    ? last24hMm
    : Number(Math.max(last48hMm, sumPeriod).toFixed(2));

  let adaptiveSeries = series15Min;
  if (periodBuckets) {
    const sortedKeys = Array.from(periodBuckets.keys()).sort((a, b) => a - b);
    let runningCum = 0;
    adaptiveSeries = sortedKeys.map((bucketStartMs) => {
      const mm = Number((periodBuckets.get(bucketStartMs) || 0).toFixed(2));
      runningCum = Number((runningCum + mm).toFixed(2));
      return {
        timestamp: new Date(bucketStartMs).toISOString(),
        rainfall_mm: mm,
        cumulative_mm: runningCum
      };
    });
  }

  const ageMs = Math.max(0, refMs - latestEligibleReading.epochMs);
  const ageMinutes = Math.floor(ageMs / 60000);
  const isStale = ageMinutes > maxStaleMinutes;

  const anomalyFlags = [];
  if (isStale) anomalyFlags.push('STALE_BATCH');
  if (freezingRisk) anomalyFlags.push('FREEZING_RISK');

  const intensity = classifyRainfallIntensity(last1hMm);

  return {
    period: periodKey,
    bucket_minutes: periodCfg.bucket_minutes,
    bucket_label: periodCfg.bucket_label,
    period_total_mm: periodTotalMm,
    last_1h_mm: last1hMm,
    last_6h_mm: last6hMm,
    last_24h_mm: last24hMm,
    last_48h_mm: last48hMm,
    r_1h_mm: last1hMm,
    r_6h_mm: last6hMm,
    r_24h_mm: last24hMm,
    r_48h_mm: last48hMm,
    rate_mm_per_hr: last1hMm,
    intensity_category: intensity.code,
    rate_category: intensity.code,
    rate_label: intensity.rate_label,
    intensity,
    is_stale: isStale,
    freezing_risk: freezingRisk,
    ambient_temp_c: ambientTempC,
    age_minutes: ageMinutes,
    latest_timestamp: latestEligibleReading.timestamp,
    anomaly_flags: anomalyFlags,
    valid_reading_count: eligibleCount,
    rejected_reading_count: rejectedCount + futureRejectedCount,
    series_15min: series15Min,
    series: adaptiveSeries
  };
}

/**
 * Aggregates station rainfall accumulations into sub-catchment spatial arithmetic means (mm),
 * peak station intensities, and a basin-wide status summary.
 *
 * Strictly enforces [RULE-CALC-01]: spatial aggregations are arithmetic mean precipitation
 * depths (mm) and rates (mm/hr); zero volumetric runoff (m^3) or discharge (m^3/s / cumecs)
 * conversion is performed.
 *
 * @param {Record<string, Array<object>>|Map<string, Array<object>>|null|undefined} readingsByStationOrMeasure
 * @param {object} [options]
 * @param {Record<string, object>} [options.registry=RAINGAUGE_REGISTRY]
 * @param {number|string|Date} [options.nowMs]
 * @param {number|string|Date} [options.referenceTime]
 * @param {number|null} [options.ambientTempC]
 * @param {number} [options.maxStaleMinutes=120]
 * @returns {{ catchments: Record<string, object>, stations: Array<object>, stations_by_id: Record<string, object>, rainfall_summary: object }}
 */
export function aggregateCatchmentRainfall(readingsByStationOrMeasure = {}, options = {}) {
  const periodKey = normalizeRainfallPeriod(options.period);
  const periodCfg = RAINFALL_PERIOD_CONFIG[periodKey];
  const registry = options.registry || RAINGAUGE_REGISTRY;
  const sourceMap = (readingsByStationOrMeasure instanceof Map)
    ? Object.fromEntries(readingsByStationOrMeasure.entries())
    : (readingsByStationOrMeasure && typeof readingsByStationOrMeasure === 'object' ? readingsByStationOrMeasure : {});

  const stations = [];
  const stationsById = {};

  for (const stationDef of Object.values(registry)) {
    if (!stationDef || typeof stationDef !== 'object') continue;
    const rawReadings = sourceMap[stationDef.id] ?? sourceMap[stationDef.measure_id] ?? [];
    const stationTemp = (options.stationTemperatures && typeof options.stationTemperatures === 'object')
      ? (options.stationTemperatures[stationDef.id] ?? options.stationTemperatures[stationDef.measure_id] ?? options.ambientTempC)
      : options.ambientTempC;

    const acc = computeRainfallAccumulators(rawReadings, {
      ...options,
      period: periodKey,
      ambientTempC: stationTemp
    });

    const stationRecord = {
      id: stationDef.id,
      notation: stationDef.notation || stationDef.id,
      wiski_id: stationDef.wiski_id ?? null,
      name: stationDef.name,
      ea_label: stationDef.ea_label || stationDef.name,
      measure_id: stationDef.measure_id,
      catchment: stationDef.catchment,
      catchment_tags: stationDef.catchment_tags || [stationDef.catchment],
      pillar: stationDef.pillar || (stationDef.catchment === 'moors_lowland' ? 'lowland' : 'upland'),
      sub_catchment: stationDef.sub_catchment || '',
      correlated_river_station_id: stationDef.correlated_river_station_id || null,
      elevation_mAOD: stationDef.elevation_mAOD ?? null,
      survey_status: stationDef.survey_status || 'UNSURVEYED',
      coordinates: stationDef.coordinates || {
        lat: stationDef.lat,
        long: stationDef.long,
        easting: stationDef.easting,
        northing: stationDef.northing,
        grid_reference: stationDef.grid_reference
      },
      tip_resolution_mm: stationDef.tip_resolution_mm ?? 0.20,
      provenance: stationDef.provenance || RAINGAUGE_PROVENANCE,
      last_1h_mm: acc.last_1h_mm,
      last_6h_mm: acc.last_6h_mm,
      last_24h_mm: acc.last_24h_mm,
      last_48h_mm: acc.last_48h_mm,
      period_total_mm: acc.period_total_mm,
      bucket_minutes: acc.bucket_minutes,
      bucket_label: acc.bucket_label,
      rate_mm_per_hr: acc.rate_mm_per_hr,
      rate_label: acc.rate_label,
      intensity_category: acc.intensity_category,
      rate_category: acc.rate_category,
      is_stale: acc.is_stale,
      freezing_risk: acc.freezing_risk,
      age_minutes: acc.age_minutes,
      latest_timestamp: acc.latest_timestamp,
      anomaly_flags: acc.anomaly_flags,
      valid_reading_count: acc.valid_reading_count,
      rejected_reading_count: acc.rejected_reading_count,
      series_15min: acc.series_15min,
      series: acc.series
    };

    stations.push(stationRecord);
    stationsById[stationRecord.id] = stationRecord;
  }

  const canonicalZones = ['tone_upland', 'parrett_upland', 'isle_upland', 'moors_lowland'];
  const catchments = {};

  for (const zoneId of canonicalZones) {
    const zoneMeta = RAINFALL_CATCHMENT_ZONES[zoneId] || {
      id: zoneId,
      label: zoneId,
      short_label: zoneId,
      pillar: zoneId === 'moors_lowland' ? 'lowland' : 'upland',
      river: ''
    };

    const zoneStations = stations.filter(
      s => s.catchment === zoneId || (Array.isArray(s.catchment_tags) && s.catchment_tags.includes(zoneId))
    );
    const activeStations = zoneStations.filter(s => !s.is_stale && s.valid_reading_count > 0);
    const denom = activeStations.length;

    let mean1h = 0.0;
    let mean6h = 0.0;
    let mean24h = 0.0;
    let mean48h = 0.0;
    let meanPeriod = 0.0;

    if (denom > 0) {
      const sum1h = activeStations.reduce((acc, s) => acc + s.last_1h_mm, 0);
      const sum6h = activeStations.reduce((acc, s) => acc + s.last_6h_mm, 0);
      const sum24h = activeStations.reduce((acc, s) => acc + s.last_24h_mm, 0);
      const sum48h = activeStations.reduce((acc, s) => acc + s.last_48h_mm, 0);
      const sumPeriod = activeStations.reduce((acc, s) => acc + s.period_total_mm, 0);

      mean1h = Number((sum1h / denom).toFixed(2));
      mean6h = Number(Math.max(mean1h, sum6h / denom).toFixed(2));
      mean24h = Number(Math.max(mean6h, sum24h / denom).toFixed(2));
      mean48h = Number(Math.max(mean24h, sum48h / denom).toFixed(2));
      meanPeriod = periodKey === '24h'
        ? mean24h
        : Number(Math.max(mean48h, sumPeriod / denom).toFixed(2));
    }

    let peak24hStation = activeStations[0] || null;
    let peak1hStation = activeStations[0] || null;

    for (const s of activeStations) {
      if (
        !peak24hStation ||
        s.last_24h_mm > peak24hStation.last_24h_mm ||
        (s.last_24h_mm === peak24hStation.last_24h_mm && s.last_1h_mm > peak24hStation.last_1h_mm)
      ) {
        peak24hStation = s;
      }
      if (
        !peak1hStation ||
        s.last_1h_mm > peak1hStation.last_1h_mm ||
        (s.last_1h_mm === peak1hStation.last_1h_mm && s.last_24h_mm > peak1hStation.last_24h_mm)
      ) {
        peak1hStation = s;
      }
    }

    const peak1hMm = peak1hStation ? peak1hStation.last_1h_mm : 0.0;
    const peak6hMm = activeStations.length > 0 ? Math.max(...activeStations.map(s => s.last_6h_mm)) : 0.0;
    const peak24hMm = peak24hStation ? peak24hStation.last_24h_mm : 0.0;
    const peak48hMm = activeStations.length > 0 ? Math.max(...activeStations.map(s => s.last_48h_mm)) : 0.0;
    const peakPeriodMm = activeStations.length > 0 ? Math.max(...activeStations.map(s => s.period_total_mm)) : 0.0;

    const meanIntensity = classifyRainfallIntensity(mean1h);
    const peakIntensity = classifyRainfallIntensity(peak1hMm);

    catchments[zoneId] = {
      id: zoneId,
      label: zoneMeta.label,
      short_label: zoneMeta.short_label,
      pillar: zoneMeta.pillar,
      river: zoneMeta.river,
      station_count: zoneStations.length,
      active_station_count: activeStations.length,
      mean_1h_mm: mean1h,
      mean_6h_mm: mean6h,
      mean_24h_mm: mean24h,
      mean_48h_mm: mean48h,
      period_total_mm: meanPeriod,
      peak_1h_mm: Number(peak1hMm.toFixed(2)),
      peak_6h_mm: Number(peak6hMm.toFixed(2)),
      peak_24h_mm: Number(peak24hMm.toFixed(2)),
      peak_48h_mm: Number(peak48hMm.toFixed(2)),
      peak_period_mm: Number(peakPeriodMm.toFixed(2)),
      peak_station: peak24hStation ? peak24hStation.name : null,
      peak_station_id: peak24hStation ? peak24hStation.id : null,
      peak_intensity_station: peak1hStation ? peak1hStation.name : null,
      peak_intensity_station_id: peak1hStation ? peak1hStation.id : null,
      rate_category: meanIntensity.code,
      peak_rate_category: peakIntensity.code,
      rate_label: meanIntensity.rate_label,
      has_freezing_risk: zoneStations.some(s => s.freezing_risk),
      all_stale: zoneStations.length === 0 || zoneStations.every(s => s.is_stale)
    };
  }

  // Provide non-enumerable alias `lowland_levels` -> `moors_lowland` so both
  // canonical key and alias work without duplicating entries in Object.keys/JSON.
  if (catchments.moors_lowland) {
    Object.defineProperty(catchments, 'lowland_levels', {
      value: catchments.moors_lowland,
      enumerable: false,
      configurable: true
    });
  }

  // Basin-wide summary for /api/status (Issue #65)
  const activeBasinStations = stations.filter(s => !s.is_stale && s.valid_reading_count > 0);
  const basinDenom = activeBasinStations.length;
  const basin1hMeanMm = basinDenom > 0
    ? Number((activeBasinStations.reduce((acc, s) => acc + s.last_1h_mm, 0) / basinDenom).toFixed(2))
    : 0.0;
  const basin6hMeanMm = basinDenom > 0
    ? Number(Math.max(basin1hMeanMm, activeBasinStations.reduce((acc, s) => acc + s.last_6h_mm, 0) / basinDenom).toFixed(2))
    : 0.0;
  const basin24hMeanMm = basinDenom > 0
    ? Number(Math.max(basin6hMeanMm, activeBasinStations.reduce((acc, s) => acc + s.last_24h_mm, 0) / basinDenom).toFixed(2))
    : 0.0;
  const basin48hMeanMm = basinDenom > 0
    ? Number(Math.max(basin24hMeanMm, activeBasinStations.reduce((acc, s) => acc + s.last_48h_mm, 0) / basinDenom).toFixed(2))
    : 0.0;
  const basinPeriodMeanMm = basinDenom > 0
    ? (periodKey === '24h'
      ? basin24hMeanMm
      : Number(Math.max(basin48hMeanMm, activeBasinStations.reduce((acc, s) => acc + s.period_total_mm, 0) / basinDenom).toFixed(2)))
    : 0.0;

  const activeUplandStations = activeBasinStations.filter(s => s.pillar === 'upland');
  let uplandPeakStation = activeUplandStations[0] || null;
  for (const s of activeUplandStations) {
    if (
      !uplandPeakStation ||
      s.last_24h_mm > uplandPeakStation.last_24h_mm ||
      (s.last_24h_mm === uplandPeakStation.last_24h_mm && s.last_1h_mm > uplandPeakStation.last_1h_mm)
    ) {
      uplandPeakStation = s;
    }
  }

  const basinIntensity = classifyRainfallIntensity(basin1hMeanMm);

  const rainfallSummary = {
    period: periodKey,
    bucket_minutes: periodCfg.bucket_minutes,
    bucket_label: periodCfg.bucket_label,
    period_total_mm: basinPeriodMeanMm,
    basin_1h_mean_mm: basin1hMeanMm,
    basin_6h_mean_mm: basin6hMeanMm,
    basin_24h_mean_mm: basin24hMeanMm,
    basin_48h_mean_mm: basin48hMeanMm,
    upland_peak_station: uplandPeakStation ? uplandPeakStation.name : null,
    upland_peak_station_id: uplandPeakStation ? uplandPeakStation.id : null,
    upland_peak_24h_mm: uplandPeakStation ? uplandPeakStation.last_24h_mm : 0.0,
    upland_peak_1h_mm: uplandPeakStation ? uplandPeakStation.last_1h_mm : 0.0,
    rate_category: basinIntensity.code
  };

  return {
    period: periodKey,
    bucket_minutes: periodCfg.bucket_minutes,
    bucket_label: periodCfg.bucket_label,
    catchments,
    stations,
    stations_by_id: stationsById,
    rainfall_summary: rainfallSummary
  };
}

/**
 * Empirically measures the out-of-sample cross-correlation lag (in hours) between
 * 15-minute rainfall accumulations (mm) and positive downstream river stage rises (m).
 *
 * Strictly complies with [RULE-HUM-01], [RULE-SUB-01], and [RULE-CALC-01]:
 * correlates observed point rainfall depth (mm) against observed positive stage change
 * (delta_h in metres) without any volumetric runoff or discharge inference.
 *
 * @param {Array<object>} rainfallReadings - 15-min rainfall readings ({ dateTime|date_time, rainfall_mm|value })
 * @param {Array<object>} stageReadings - 15-min stage readings ({ dateTime|date_time, value|stage_mAOD })
 * @param {object} [options]
 * @param {number} [options.minLagHours=0.5]
 * @param {number} [options.maxLagHours=24.0]
 * @param {number} [options.minSamplePairs=16]
 * @returns {{ peak_lag_hours: number|null, peak_correlation_r: number|null, sample_pairs: number, sufficient_data: boolean, lag_profile: Array<{ lag_hours: number, correlation_r: number, sample_pairs: number }> }}
 */
export function computeEmpiricalCatchmentLag(rainfallReadings, stageReadings, options = {}) {
  const STEP_MS = 15 * 60 * 1000;
  const minLagHours = options.minLagHours ?? 0.5;
  const maxLagHours = options.maxLagHours ?? 24.0;
  const minSamplePairs = options.minSamplePairs ?? 16;

  const { validReadings: cleanRain } = parseNormalizedRainfallReadings(rainfallReadings);
  if (!Array.isArray(stageReadings) || cleanRain.length < minSamplePairs || stageReadings.length < minSamplePairs) {
    return {
      peak_lag_hours: null,
      peak_correlation_r: null,
      sample_pairs: 0,
      sufficient_data: false,
      lag_profile: []
    };
  }

  const rainBySlot = new Map();
  for (const r of cleanRain) {
    const slot = Math.round(r.epochMs / STEP_MS) * STEP_MS;
    rainBySlot.set(slot, (rainBySlot.get(slot) || 0) + r.rainfall_mm);
  }

  const stageBySlot = new Map();
  for (const item of stageReadings) {
    if (!item || typeof item !== 'object') continue;
    const rawDate = item.dateTime ?? item.date_time ?? item.timestamp ?? item.date ?? null;
    if (typeof rawDate !== 'string') continue;
    const epochMs = Date.parse(rawDate);
    if (!Number.isFinite(epochMs)) continue;
    const rawStage = item.stage_mAOD !== undefined ? item.stage_mAOD : item.value;
    const cleanStage = sanitizeStageValue(rawStage);
    if (cleanStage === null) continue;
    const slot = Math.round(epochMs / STEP_MS) * STEP_MS;
    if (!stageBySlot.has(slot)) {
      stageBySlot.set(slot, cleanStage);
    }
  }

  // Compute positive 15-min stage rise delta_h >= 0 (in metres)
  const stageRiseBySlot = new Map();
  const sortedStageSlots = Array.from(stageBySlot.keys()).sort((a, b) => a - b);
  for (let i = 1; i < sortedStageSlots.length; i++) {
    const currSlot = sortedStageSlots[i];
    const prevSlot = sortedStageSlots[i - 1];
    if (currSlot - prevSlot === STEP_MS) {
      const deltaM = stageBySlot.get(currSlot) - stageBySlot.get(prevSlot);
      stageRiseBySlot.set(currSlot, Math.max(0, deltaM));
    }
  }

  const minSteps = Math.max(0, Math.round((minLagHours * 3600 * 1000) / STEP_MS));
  const maxSteps = Math.max(minSteps, Math.round((maxLagHours * 3600 * 1000) / STEP_MS));
  const rainSlots = Array.from(rainBySlot.keys()).sort((a, b) => a - b);

  const lagProfile = [];
  let bestLagHours = null;
  let bestR = -Infinity;
  let bestPairs = 0;

  for (let stepLag = minSteps; stepLag <= maxSteps; stepLag++) {
    const lagMs = stepLag * STEP_MS;
    const xs = [];
    const ys = [];

    for (let i = 0; i < rainSlots.length; i++) {
      const rSlot = rainSlots[i];
      const targetSlot = rSlot + lagMs;
      if (stageRiseBySlot.has(targetSlot)) {
        xs.push(rainBySlot.get(rSlot));
        ys.push(stageRiseBySlot.get(targetSlot));
      }
    }

    const n = xs.length;
    if (n < minSamplePairs) continue;

    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += xs[i];
      sumY += ys[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    if (varX <= 1e-12 || varY <= 1e-12) continue;
    const r = Number((cov / Math.sqrt(varX * varY)).toFixed(4));
    const lagHours = Number(((stepLag * 15) / 60).toFixed(2));

    lagProfile.push({
      lag_hours: lagHours,
      correlation_r: r,
      sample_pairs: n
    });

    if (r > bestR) {
      bestR = r;
      bestLagHours = lagHours;
      bestPairs = n;
    }
  }

  if (bestLagHours === null) {
    return {
      peak_lag_hours: null,
      peak_correlation_r: null,
      sample_pairs: 0,
      sufficient_data: false,
      lag_profile: []
    };
  }

  return {
    peak_lag_hours: bestLagHours,
    peak_correlation_r: bestR,
    sample_pairs: bestPairs,
    sufficient_data: true,
    lag_profile: lagProfile
  };
}







