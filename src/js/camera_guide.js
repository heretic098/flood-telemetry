/**
 * Community Camera Field Guide & Disambiguation Drawer
 * 
 * Provides layperson guidance and optical ground-truth field-of-view fidelity (per [RULE-CAM-01])
 * for third-party community webcams hosted by thecfh.org and the Environment Agency.
 * 
 * Invariants:
 * - [RULE-CAM-01]: Optical Camera Ground-Truth Invariant (Field-of-View Fidelity).
 *   Strictly describe what camera lenses physically capture (weir crests, carriageways,
 *   staff gauges, pump discharge plumes). Never claim optical verification of internal
 *   submerged sluice gates, penstocks, pump impellers, or council gate padlocks.
 */

export const CAMERA_FIELD_GUIDES = {
  dunball: {
    siteKey: 'dunball',
    title: 'Dunball Sluice & Tidal Outfall Feeds',
    cfhUrl: 'https://thecfh.org/parretttonewsom.php#dunball',
    subtitle: 'Parrett Estuary Gravity Flap Doors, KSD Approach & High-Volume Pumping Station',
    questions: [
      'Are the tidal flap doors discharging gravity flow into the River Parrett or held shut by high tide (tide-locked)?',
      'Are temporary high-volume pumps running (turbulent white plumes discharging from green pipes into the tidal river)?',
      'Is high water in the tidal estuary backing up against the sea outfall apron?'
    ],
    checklist: [
      {
        cameraName: 'Downstream Tidal Flap Gates & Estuary Mudbanks',
        description: 'Frames the massive gravity outfall flap doors and the tidal mudbanks of the River Parrett at Dunball.',
        lookFor: 'During low tide in the Bristol Channel, the flap doors swing open as water drains from King\'s Sedgemoor Drain (KSD). At high tide, estuarine water presses the doors securely shut against the headwall.',
        physicalLimitation: 'Optical cameras cannot measure tidal head differential or gate opening millimeters. Discharging vs tide-locked status is verified computationally by comparing West Quay and sea stage sensors.'
      },
      {
        cameraName: 'Dunball Pumping Station Platform & Delivery Pipe Manifold',
        description: 'Frames the discharge platform, high-volume delivery pipes, and the tidal river confluence.',
        lookFor: 'Active pumping creates violent surface boiling, white churning foam, and a distinct outward plume below the discharge pipe collars into the tidal river.',
        physicalLimitation: 'Submerged pump impellers, underground suction chambers, and diesel motor rotations are completely concealed underwater. Never interpret pump operational status solely from a static image.'
      },
      {
        cameraName: 'King\'s Sedgemoor Drain (KSD) Upstream Approach',
        description: 'Frames the inland canal approach, trash screens, and penstock structure upstream of Dunball Sluice.',
        lookFor: 'Debris accumulation on trash screens or high water stage approaching the top of the approach culverts.',
        physicalLimitation: 'Internal penstock aperture settings cannot be seen from surface camera feeds.'
      }
    ]
  },

  hookbridge: {
    siteKey: 'hookbridge',
    title: 'Hookbridge Spillway Feeds',
    cfhUrl: 'https://thecfh.org/parretttonewsom.php#hook',
    subtitle: 'River Tone Engineered Overflow Spillway into Curry Moor Flood Storage Basin',
    questions: [
      'Is the River Tone actively overtopping the Hookbridge spillway crest into Curry Moor?',
      'Is the concrete weir crest dry, near-crest, or submerged beneath an active lateral cascade?',
      'What stage is visible on the vertical black-and-yellow physical staff gauge board?'
    ],
    checklist: [
      {
        cameraName: 'Spillway Engineered Weir Crest',
        description: 'Direct line of sight along the concrete weir crest separating the River Tone embankments from Curry Moor basin.',
        lookFor: 'When River Tone stage reaches the surveyed crest (7.45m AOD), water spills laterally across the full weir length into Curry Moor. Overtopping appears as a turbulent white-water cascade tumbling down the riprap embankment.',
        physicalLimitation: 'Submerged stilling well gauge electronics (Station 52118) are enclosed in steel housings. Camera provides optical confirmation of water contact with the concrete crest.'
      },
      {
        cameraName: 'Tone Approach Channel & Staff Gauge',
        description: 'Frames the River Tone approach channel and the vertical staff gauge board mounted near the spillway approach.',
        lookFor: 'Water meniscus line against physical decimetre markings on the staff gauge board.',
        physicalLimitation: 'Lens resolution and night infrared lighting may obscure centimetre staff graduations; use calibrated EA telemetry for quantitative stage measurements.'
      }
    ]
  },

  currymoor: {
    siteKey: 'currymoor',
    title: 'Currymoor Pumping Station Feeds',
    cfhUrl: 'https://thecfh.org/parretttonewsom.php#currymoor',
    subtitle: 'Curry Moor Flood Basin Intake, Duty Pumps & Emergency Mobile Hardstanding',
    questions: [
      'Are the permanent duty pumps operating (turbulent water boiling at the discharge headwall into the River Tone)?',
      'Are EA emergency high-capacity tractor/diesel pumps deployed along the flood embankment?',
      'What is the water elevation in the Curry Moor intake ditch relative to the automated weed screens?'
    ],
    checklist: [
      {
        cameraName: 'Curry Moor Intake Channel & Automated Weed Screen',
        description: 'Frames the drainage rhyne collection basin, automated trash rake, and station intake bay.',
        lookFor: 'Water level in the drainage channel, weed rake sweep cycles, and debris accumulation against intake screens.',
        physicalLimitation: 'Submerged pump intake suction bells cannot be seen beneath the water surface.'
      },
      {
        cameraName: 'Discharge Headwall (River Tone Embankment)',
        description: 'Frames the concrete discharge headwall where pumped drainage water re-enters the elevated River Tone.',
        lookFor: 'Vigorous surface water boil and white churning foam emerging from discharge pipe collars at the Tone bank.',
        physicalLimitation: 'Submerged electric impellers inside the brick pumphouse cannot be optically observed. Water agitation confirms active discharge.'
      },
      {
        cameraName: 'Mobile Emergency Pump Hardstanding',
        description: 'Frames the raised concrete apron where EA temporary high-capacity tractor pumps and flexible delivery hoses are deployed during flood emergencies.',
        lookFor: 'Presence of green 24-inch tractor pumps, temporary pipe manifolds, and emergency support vehicles.',
        physicalLimitation: 'Optical presence of mobile pumps does not guarantee they are running; look for water discharge plumes at the river outfall.'
      }
    ]
  },

  saltmoor: {
    siteKey: 'saltmoor',
    title: 'Saltmoor Pumping Station Feeds',
    cfhUrl: 'https://thecfh.org/parretttonewsom.php#saltmoor',
    subtitle: 'Salt Moor Lowland Drainage Basin & River Parrett Flood Embankment Outfall',
    questions: [
      'Is Saltmoor pumping station discharging Moor floodwaters over the embankment into the River Parrett?',
      'Are temporary tractor-driven emergency pumps stationed on the raised bund?'
    ],
    checklist: [
      {
        cameraName: 'Salt Moor Intake Rhyne & Screen',
        description: 'Frames the drainage ditch collection sump on the landward side of the flood bank.',
        lookFor: 'Water height against the intake structure and trash rack.',
        physicalLimitation: 'Internal pump impeller rotation is sealed inside the pump well.'
      },
      {
        cameraName: 'Parrett Embankment Discharge Pipe Manifold',
        description: 'Frames the high-level discharge pipes where water enters the embanked River Parrett.',
        lookFor: 'Discharge jetting and turbulent surface flow cascading down the riverward embankment.',
        physicalLimitation: 'Station electrical run-state is not broadcast optically; optical turbulence verifies hydraulic delivery.'
      }
    ]
  },

  baltmoor: {
    siteKey: 'baltmoor',
    title: 'Baltmoor Wall & Athelney Spillway Feeds',
    cfhUrl: 'https://thecfh.org/parretttonewsom.php#athelneyspillway',
    subtitle: 'Athelney Overflow Spillway, Cuts Road Carriageway & Baltmoor Flood Embankment',
    questions: [
      'Is water cascading across Athelney Spillway or flowing over Cuts Road?',
      'Is the road carriageway dry, flooded, or showing emergency gate closures?'
    ],
    checklist: [
      {
        cameraName: 'Athelney Spillway Weir',
        description: 'Frames the reinforced concrete spillway crest connecting Curry Moor storage to the River Tone / Stan Moor.',
        lookFor: 'Overtopping cascade when Curry Moor water elevation rises above the 7.35m AOD weir crest.',
        physicalLimitation: 'Camera does not record flow rate (cumecs); it confirms physical overtopping contact.'
      },
      {
        cameraName: 'Cuts Road (East Lyng ↔ Athelney) Carriageway Dip',
        description: 'Frames the asphalt carriageway where Cuts Road passes through the lowest topographical dip over the spillway.',
        lookFor: 'Standing water across the asphalt carriageway crown, water reflections, or vehicle presence.',
        physicalLimitation: 'Optical cameras cannot verify padlock status on Somerset Council emergency flood gates. Gates remain padlocked until formal daylight structural scour inspections conclude.'
      }
    ]
  },

  monksleaze: {
    siteKey: 'monksleaze',
    title: 'Monk\'s Leaze Clyse Sluice Feeds',
    cfhUrl: 'https://thecfh.org/parretttonewsom.php#monksleaze',
    subtitle: 'River Parrett Intake Sluice, Fixed High-Level Spillway & Sowy Flood Relief Channel',
    questions: [
      'Is floodwater being diverted from the River Parrett into the Sowy Flood Relief Channel?',
      'Is water cascading across the fixed high-level spillway weir?'
    ],
    checklist: [
      {
        cameraName: 'River Parrett Intake & Fixed Spillway Weir',
        description: 'Frames the intake embayment from the River Parrett and the fixed concrete overflow spillway weir.',
        lookFor: 'Flow cascading over the fixed weir crest (6.73m AOD) or rushing past the upstream clyse intake.',
        physicalLimitation: 'Submerged sluice gate apertures, underground penstocks, and mechanical lift gear cannot be seen optically.'
      },
      {
        cameraName: 'Downstream Sowy Relief Channel & Clyse Headwall',
        description: 'Frames the downstream open channel of the Sowy flood relief waterway.',
        lookFor: 'Downstream surface water velocity, standing waves, and chop indicating active flood diversion away from the Parrett.',
        physicalLimitation: 'Gate aperture millimeters and diversion cumecs cannot be derived from surface photos.'
      }
    ]
  }
};

// Aliases for convenient matching
const SITE_ALIASES = {
  hook: 'hookbridge',
  curry_moor: 'currymoor',
  athelney: 'baltmoor',
  athelneyspillway: 'baltmoor',
  beerwall: 'baltmoor',
  monks_leaze: 'monksleaze',
  sowy: 'monksleaze',
  northmoor: 'saltmoor'
};

function normalizeSiteKey(rawKey) {
  if (!rawKey) return null;
  const key = String(rawKey).toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (CAMERA_FIELD_GUIDES[key]) return key;
  if (SITE_ALIASES[key] && CAMERA_FIELD_GUIDES[SITE_ALIASES[key]]) {
    return SITE_ALIASES[key];
  }
  for (const [canonicalKey, guide] of Object.entries(CAMERA_FIELD_GUIDES)) {
    if (key.includes(canonicalKey) || canonicalKey.includes(key)) {
      return canonicalKey;
    }
  }
  return null;
}

let activeTriggerElement = null;

/**
 * Opens the Community Camera Field Guide Modal / Bottom Sheet
 * 
 * @param {string} siteKey - Site identifier ('dunball', 'hookbridge', 'currymoor', etc.)
 * @param {HTMLElement} [triggerEl=null] - Element that triggered the dialog, for focus return
 */
export function openCameraGuide(siteKey, triggerEl = null) {
  if (typeof document === 'undefined') return;

  const normalizedKey = normalizeSiteKey(siteKey) || 'dunball';
  const guide = CAMERA_FIELD_GUIDES[normalizedKey] || CAMERA_FIELD_GUIDES.dunball;
  activeTriggerElement = triggerEl || (typeof document.activeElement !== 'undefined' ? document.activeElement : null);

  let backdrop = document.getElementById('camera-guide-modal');
  if (!backdrop) {
    backdrop = createCameraGuideDOM();
    document.body.appendChild(backdrop);
  }

  // Populate dialog content
  const titleEl = backdrop.querySelector('#camera-guide-title');
  const subtitleEl = backdrop.querySelector('#camera-guide-subtitle');
  const questionsListEl = backdrop.querySelector('#camera-guide-questions');
  const checklistEl = backdrop.querySelector('#camera-guide-checklist');
  const ctaBtn = backdrop.querySelector('#camera-guide-cta-btn');

  if (titleEl) titleEl.textContent = guide.title;
  if (subtitleEl) subtitleEl.textContent = guide.subtitle;

  if (questionsListEl) {
    questionsListEl.innerHTML = guide.questions.map(q => `
      <li class="guide-question-item">
        <span class="guide-q-icon" aria-hidden="true">❓</span>
        <span>${escapeHTML(q)}</span>
      </li>
    `).join('');
  }

  if (checklistEl) {
    checklistEl.innerHTML = guide.checklist.map(item => `
      <div class="guide-camera-card">
        <div class="guide-camera-header">
          <span class="guide-cam-badge" aria-hidden="true">📷</span>
          <h4 class="guide-camera-name">${escapeHTML(item.cameraName)}</h4>
        </div>
        <p class="guide-camera-desc"><strong>Lens View:</strong> ${escapeHTML(item.description)}</p>
        <div class="guide-lookfor-box">
          <span class="guide-box-label">🔍 What to Look For:</span>
          <p>${escapeHTML(item.lookFor)}</p>
        </div>
        <div class="guide-limitation-box" role="note">
          <span class="guide-box-label">⚠️ Physical Limitations [RULE-CAM-01]:</span>
          <p>${escapeHTML(item.physicalLimitation)}</p>
        </div>
      </div>
    `).join('');
  }

  if (ctaBtn) {
    ctaBtn.href = guide.cfhUrl;
    ctaBtn.innerHTML = `Open Live Feeds on thecfh.org ↗ <span class="sr-only">(opens external link to ${guide.title})</span>`;
  }

  // Show dialog
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');

  // Focus management: focus the close button or dialog
  const closeBtn = backdrop.querySelector('#camera-guide-close');
  if (closeBtn) {
    closeBtn.focus();
  }
}

/**
 * Closes the Camera Field Guide Dialog
 */
export function closeCameraGuide() {
  if (typeof document === 'undefined') return;
  const backdrop = document.getElementById('camera-guide-modal');
  if (backdrop && backdrop.classList.contains('open')) {
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    if (activeTriggerElement && typeof activeTriggerElement.focus === 'function') {
      try {
        activeTriggerElement.focus();
      } catch (e) {
        // Ignore focus error
      }
    }
  }
}

function createCameraGuideDOM() {
  const backdrop = document.createElement('div');
  backdrop.id = 'camera-guide-modal';
  backdrop.className = 'camera-guide-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'camera-guide-title');
  backdrop.setAttribute('aria-hidden', 'true');

  backdrop.innerHTML = `
    <div class="camera-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-guide-title">
      <div class="camera-guide-handle" aria-hidden="true"></div>
      <div class="camera-guide-header">
        <div class="camera-guide-title-wrap">
          <span class="guide-header-icon" aria-hidden="true">🧭</span>
          <div>
            <h3 id="camera-guide-title" class="camera-guide-title">Community Camera Field Guide</h3>
            <p id="camera-guide-subtitle" class="camera-guide-subtitle">Optical Ground-Truth Fidelity &amp; Disambiguation</p>
          </div>
        </div>
        <button type="button" class="camera-guide-close" id="camera-guide-close" aria-label="Close camera field guide">✕</button>
      </div>

      <div class="camera-guide-body">
        <div class="guide-section">
          <h4 class="guide-section-heading">What are you looking for?</h4>
          <ul class="guide-questions-list" id="camera-guide-questions"></ul>
        </div>

        <div class="guide-section">
          <h4 class="guide-section-heading">Visual Identification Checklist</h4>
          <div class="guide-checklist-container" id="camera-guide-checklist"></div>
        </div>

        <div class="guide-footer-action">
          <a href="https://thecfh.org" target="_blank" rel="noopener noreferrer" class="camera-guide-cta" id="camera-guide-cta-btn">
            Open Live Feeds on thecfh.org ↗
          </a>
          <p class="guide-attribution-note">
            Camera streams hosted by <a href="https://thecfh.org" target="_blank" rel="noopener noreferrer">thecfh.org ↗</a>. Camera lens perspectives subject to weather, daylight, and physical positioning.
          </p>
        </div>
      </div>
    </div>
  `;

  // Close handlers
  const closeBtn = backdrop.querySelector('#camera-guide-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCameraGuide);
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeCameraGuide();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!backdrop.classList.contains('open')) return;

    if (e.key === 'Escape') {
      closeCameraGuide();
      return;
    }

    if (e.key === 'Tab') {
      const focusableEls = backdrop.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focusableEls.length === 0) return;
      const firstEl = focusableEls[0];
      const lastEl = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl || !backdrop.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl || !backdrop.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  });

  return backdrop;
}

/**
 * Initializes click delegation for camera guide buttons across the DOM
 */
export function initCameraGuideTriggers() {
  if (typeof document === 'undefined') return;

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-camera-guide], .camera-guide-trigger');
    if (trigger) {
      e.preventDefault();
      const siteKey = trigger.getAttribute('data-camera-guide') || trigger.dataset.cameraGuide;
      openCameraGuide(siteKey, trigger);
    }
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Auto-bind triggers if running in browser
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCameraGuideTriggers);
  } else {
    initCameraGuideTriggers();
  }
}
