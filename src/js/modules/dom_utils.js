/**
 * Shared DOM & Formatting Utilities (SSOT for XSS escaping, age/duration formatting, freshness pills).
 */

/** Escapes HTML characters in dynamic strings to prevent XSS (SEC-01). */
export function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes characters for HTML attribute values (SEC-01). */
export function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Formats relative age for telemetry inspection banners. */
export function formatRelativeAge(dateOrMs) {
  const timeMs = dateOrMs instanceof Date
    ? dateOrMs.getTime()
    : (typeof dateOrMs === 'string' ? new Date(dateOrMs).getTime() : dateOrMs);
  if (!timeMs || isNaN(timeMs)) return '';

  const diffMins = Math.floor((Date.now() - timeMs) / 60000);
  if (diffMins < 1) return '(Just now)';
  if (diffMins < 60) return `(${diffMins}m ago)`;

  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  if (h < 24) return `(${h}h ${m}m ago)`;

  const d = Math.floor(h / 24);
  return `(${d}d ${h % 24}h ago)`;
}

/** Formats a duration in seconds into `Xh Ym` representation. */
export function formatTimeSpan(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/** Formats stage span delta into human units (m, cm, mm). */
export function formatSpanUnit(deltaInMeters) {
  const absDelta = Math.abs(deltaInMeters);
  if (absDelta >= 1.0) return `${deltaInMeters.toFixed(2)}m`;
  if (absDelta >= 0.01) {
    const cm = Number((deltaInMeters * 100).toFixed(1));
    return `${Number.isInteger(cm) || cm >= 10 ? cm.toFixed(0) : cm.toFixed(1)}cm`;
  }
  return `${Math.round(deltaInMeters * 1000).toFixed(0)}mm`;
}

/** Formats signed head differential values into human units (m, cm, mm). */
export function formatHeadDelta(deltaInMeters) {
  if (typeof deltaInMeters !== 'number' || isNaN(deltaInMeters)) return '--';
  const prefix = deltaInMeters > 0 ? '+' : (deltaInMeters < 0 ? '-' : '');
  const absDelta = Math.abs(deltaInMeters);
  if (absDelta >= 1.0) return `${prefix}${absDelta.toFixed(2)}m`;
  if (absDelta >= 0.01) {
    const cm = absDelta * 100;
    return `${prefix}${cm < 10 ? cm.toFixed(1) : cm.toFixed(0)}cm`;
  }
  return absDelta > 0 ? `${prefix}${(absDelta * 1000).toFixed(0)}mm` : '0cm';
}

/** Evaluates telemetry timestamp age and computes triple-encoded freshness pill metadata ([UI-COL-03]). */
export function formatFreshnessPill(timestampInput, nowMs = Date.now()) {
  const staleFallback = {
    text: '⏱️ Telemetry: Offline / Unknown',
    className: 'telemetry-freshness-pill freshness-stale',
    modifierClass: 'freshness-stale',
    diffMins: null,
    ageText: 'Offline / Unknown',
    state: 'STALE'
  };
  if (!timestampInput) return staleFallback;

  const eaTime = timestampInput instanceof Date ? timestampInput : new Date(timestampInput);
  if (isNaN(eaTime.getTime())) return staleFallback;

  const diffMins = Math.floor(Math.max(0, nowMs - eaTime.getTime()) / 60000);
  if (diffMins <= 120) {
    const ageText = diffMins < 1 ? 'Just now' : (diffMins < 60 ? `${diffMins}m ago` : `${(diffMins / 60).toFixed(1)}h ago`);
    return { text: `📡 Telemetry: ${ageText}`, className: 'telemetry-freshness-pill freshness-fresh', modifierClass: 'freshness-fresh', diffMins, ageText, state: 'FRESH' };
  }
  const ageText = `${(diffMins / 60).toFixed(1)}h ago`;
  if (diffMins <= 360) {
    return { text: `⚠️ Telemetry: ${ageText} (Lagging)`, className: 'telemetry-freshness-pill freshness-warning', modifierClass: 'freshness-warning', diffMins, ageText, state: 'WARNING' };
  }
  return { text: `⏱️ Telemetry: ${ageText} (Stale)`, className: 'telemetry-freshness-pill freshness-stale', modifierClass: 'freshness-stale', diffMins, ageText, state: 'STALE' };
}

/** Updates a DOM freshness pill element in place with canonical text and class state. */
export function applyFreshnessPill(el, timestampInput, nowMs = Date.now()) {
  if (!el) return null;
  const pill = formatFreshnessPill(timestampInput, nowMs);
  el.textContent = pill.text;
  el.innerText = pill.text;
  if (el.classList && typeof el.classList.remove === 'function' && typeof el.classList.add === 'function') {
    el.classList.remove('freshness-fresh', 'freshness-warning', 'freshness-stale');
    el.classList.add(pill.modifierClass);
  } else {
    el.className = pill.className;
  }
  return pill;
}
