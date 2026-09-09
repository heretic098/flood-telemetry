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
  mobileOrderTrigger = 4.40,
  mobileActiveTrigger = 4.60,
  criticalSpillTrigger = 4.85,
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




