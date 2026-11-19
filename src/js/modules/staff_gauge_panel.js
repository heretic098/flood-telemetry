/**
 * Staff-gauge camera panel for the topology inspector drawer (Issue #54).
 *
 * Shows the latest frame from a camera that frames a physical metric board at/near a
 * station. Surfaced automatically when the electronic sensor is FLATLINED / OFFLINE / STALE,
 * and on demand (button) otherwise.
 *
 * Invariants ([RULE-CAM-01] / [RULE-PROV-01] / [RULE-SUB-01]):
 * - No stage is read or inferred from the image, and no board-vs-sensor delta is shown.
 *   Board zero levels are unsurveyed; the resident reads the board themselves.
 * - Only high / medium confidence mappings are shown. Low confidence mappings are omitted.
 * - Frame capture time is always shown, with a warning when the frame is old.
 * - All text is set with textContent (no HTML injection).
 */

import { getStaffGaugeCameraForStation } from '../staff_gauge_cameras.js';
import { evaluateStationFreshness } from '../hydro_engine.js';

const OLD_FRAME_MINUTES = 60;

export function getStaffGaugePanelCopy(entry) {
  if (entry.boards) {
    return 'This camera shows two metric boards. The right-hand board is the water level. The left-hand board shows the sluice gate height, not water level.';
  }
  return 'This camera shows a metric staff gauge board near this station. Read the water level against the board yourself. Board zero levels are not surveyed, so the board cannot be compared directly with the sensor value.';
}

/**
 * Decides whether the frame auto-loads and what notice (if any) to show.
 * - offline / stale: always auto-load.
 * - flatline: auto-load, unless the station's static reading is expected (e.g. Monk's Leaze
 *   downstream ponding when the clyse is shut), in which case it stays on-demand.
 * Wording is neutral: a static reading is not called a sensor fault.
 */
export function getStaffGaugePanelMode(entry, freshness) {
  const offlineOrStale = Boolean(freshness.isOffline || (freshness.isStale && !freshness.isFlatlined));
  if (offlineOrStale) {
    return { autoLoad: true, notice: 'Sensor not reporting. Showing the camera at the metric board so you can check the water level by eye.' };
  }
  if (freshness.isFlatlined) {
    if (entry.flatline_is_expected) {
      return { autoLoad: false, notice: 'Sensor reading is static. This can be normal here (for example when the clyse is shut). You can check the metric board on camera.' };
    }
    return { autoLoad: true, notice: 'Sensor reading is static. Showing the camera at the metric board so you can check the water level by eye.' };
  }
  return { autoLoad: false, notice: null };
}

function formatAge(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return 'at an unknown time';
  const total = Math.round(minutes);
  if (total < 60) return `${total} min ago`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m ago`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Appends a cache-busting capture-time query to a frame URL (keeps any existing query). */
function frameUrl(imageUrl, capturedAt) {
  const sep = String(imageUrl).includes('?') ? '&' : '?';
  return `${imageUrl}${sep}t=${encodeURIComponent(capturedAt)}`;
}

/**
 * Loads the latest frame into `body`.
 * @param {object} entry - staff gauge camera entry (needs camera_id)
 * @param {HTMLElement} body
 * @param {{silent?: boolean}} [options] - silent: refresh an already-open panel without a
 *   "Loading…" flash. If the frame is unchanged only the age caption is updated, so the
 *   "captured X ago" text never goes stale while a panel stays open. On a transient error
 *   a silent refresh keeps whatever is already displayed.
 */
export async function loadFrame(entry, body, options = {}) {
  const silent = Boolean(options.silent);
  // Responses can arrive out of order (manual click vs silent refresh); only the latest wins.
  const seq = (body._staffGaugeSeq = (body._staffGaugeSeq || 0) + 1);
  const isCurrent = () => body._staffGaugeSeq === seq;
  const hasFrame = () => Boolean(body.querySelector && body.querySelector('img.staff-gauge-frame'));

  if (!silent) {
    body.replaceChildren(el('p', 'staff-gauge-status', 'Loading latest camera frame…'));
  }
  try {
    const res = await fetch(`/api/staff-gauge-cameras/${encodeURIComponent(entry.camera_id)}/latest`);
    const data = res.ok ? await res.json() : null;
    if (!isCurrent()) return;
    if (!data || data.status !== 'ok' || !data.image_url || !data.captured_at) {
      if (silent && hasFrame()) return;
      body.replaceChildren(el('p', 'staff-gauge-status', 'No recent camera frame is available. Camera may be offline or dark.'));
      return;
    }

    const ageKnown = Number.isFinite(data.age_minutes);
    const capturedDate = new Date(data.captured_at);
    const capturedText = Number.isNaN(capturedDate.getTime()) ? data.captured_at : capturedDate.toLocaleString('en-GB');
    const caption = el('p', 'staff-gauge-status', `Captured ${formatAge(data.age_minutes)} (${capturedText}).`);
    const notes = [caption];
    if (!ageKnown || data.age_minutes > OLD_FRAME_MINUTES) {
      notes.push(el('p', 'staff-gauge-status staff-gauge-warning', ageKnown
        ? '⚠️ This frame is more than an hour old and may not show current conditions.'
        : '⚠️ The age of this frame is unknown. It may not show current conditions.'));
    }

    const existing = silent ? body.querySelector('img.staff-gauge-frame') : null;
    if (existing && existing.dataset.capturedAt === data.captured_at) {
      body.replaceChildren(existing, ...notes);
      return;
    }

    const img = el('img', 'staff-gauge-frame');
    img.alt = `Latest frame from the staff gauge camera near this station, captured ${formatAge(data.age_minutes)}`;
    img.loading = 'lazy';
    img.dataset.capturedAt = data.captured_at;
    img.src = frameUrl(data.image_url, data.captured_at);
    body.replaceChildren(img, ...notes);
  } catch (err) {
    if (!isCurrent()) return;
    if (silent && hasFrame()) return;
    body.replaceChildren(el('p', 'staff-gauge-status', 'Could not load the camera frame.'));
  }
}

/**
 * Builds the panel element for a node, or null when the node has no usable camera.
 * @param {{id:string}} node
 * @param {Array} readings - newest-first sensor readings for the node
 * @returns {HTMLElement|null}
 */
export function buildStaffGaugePanel(node, readings) {
  const entry = getStaffGaugeCameraForStation(node.id);
  if (!entry || entry.confidence === 'low') return null;

  const freshness = evaluateStationFreshness(readings || []);
  const mode = getStaffGaugePanelMode(entry, freshness);

  const panel = el('section', 'staff-gauge-panel');
  panel.id = 'node-staff-gauge-camera';
  panel.dataset.nodeId = String(node.id);
  panel._staffGaugeEntry = entry;
  panel.setAttribute('aria-label', 'Staff gauge camera view');
  panel.appendChild(el('h4', 'staff-gauge-title', '📷 Camera view of the metric board'));
  if (mode.notice) {
    panel.appendChild(el('p', 'staff-gauge-status staff-gauge-warning', mode.notice));
  }
  panel.appendChild(el('p', 'staff-gauge-status', getStaffGaugePanelCopy(entry)));

  const body = el('div', 'staff-gauge-body');
  panel.appendChild(body);

  if (mode.autoLoad) {
    loadFrame(entry, body);
  } else {
    const btn = el('button', 'ext-link-btn staff-gauge-load', 'Show latest camera frame');
    btn.type = 'button';
    btn.addEventListener('click', () => loadFrame(entry, body), { once: true });
    body.appendChild(btn);
  }
  return panel;
}
