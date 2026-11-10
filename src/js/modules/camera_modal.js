/**
 * Shared Accessible Camera Modal, Event Visual Evidence Inspector & Disambiguation Drawer Controller
 *
 * Provides:
 * 1. Event Visual Evidence Inspector (Issue #24 / Phase 3):
 *    - Interactive ±60m Transition Sequence Player ("Little Video" flipbook scrubber with Play/Pause,
 *      ◀/▶ frame step, 1x/2x speed, and Start/Peak/End phase pins).
 *    - Keyframe Inspector (EVENT_START, EVENT_PEAK, EVENT_END) with temporal correlation Δt audit.
 *    - Side-by-Side / Stacked Before & After Transition Comparison.
 *    - Nighttime & Mixed Day/Night Resilience (`NIGHT_TELEMETRY` high-contrast sensor verification card).
 * 2. Community Camera Field Guide & Disambiguation Drawer (Issue #18):
 *    - Layperson guidance and optical ground-truth field-of-view fidelity for third-party community
 *      webcams hosted by thecfh.org and the Environment Agency.
 *
 * Invariants:
 * - [RULE-CAM-01]: Optical Camera Ground-Truth Invariant (Field-of-View Fidelity).
 *   Strictly describe what camera lenses physically capture (weir crests, carriageways,
 *   staff gauges, pump discharge plumes). Never claim optical verification of internal
 *   submerged sluice gates, penstocks, pump impellers, or council gate padlocks.
 * - [RULE-ENT-01]: Canonical Tripartite Entity Invariant (asset_type -> asset_name -> status).
 * - [RULE-SUB-01] & [RULE-CALC-01]: Empirical substantiation; zero volumetric/cumec speculation.
 * - [UI-ACC-01] WCAG 2.1 AA Accessibility: role="dialog", aria-modal="true", keyboard focus trapping,
 *   Escape dismissal, ArrowLeft/ArrowRight frame stepping, Space play/pause, >= 44x44px touch targets.
 */

const ASSET_TO_GUIDE_SITE = Object.freeze({
  dunball_outfall: 'dunball',
  dunball_ksd: 'dunball',
  hookbridge: 'hookbridge',
  curry_moor: 'currymoor',
  cuts_road: 'baltmoor',
  athelney_spillway: 'baltmoor',
  baltmoor_wall: 'baltmoor',
  stan_moor_road: 'baltmoor',
  a361_burrowbridge: 'baltmoor',
  northmoor: 'saltmoor',
  moorland_new_cut_road: 'saltmoor',
  beer_wall: 'monksleaze',
  beer_wall_a372: 'monksleaze',
  monks_leaze_clyse: 'monksleaze',
  muchelney_access: 'currymoor',
  new_road_curry: 'currymoor',
  bicknells_bridge_access: 'currymoor'
});

const ASSET_DISPLAY_NAMES = Object.freeze({
  dunball_outfall: 'Dunball Tidal Outfall (52163)',
  hookbridge: 'Hookbridge Spillway (52118)',
  curry_moor: 'Curry Moor Polder Basin (52127)',
  cuts_road: 'Cuts Road • East Lyng ↔ Athelney',
  baltmoor_wall: 'Baltmoor Wall Spillway (52158)',
  northmoor: 'Northmoor & Saltmoor Basin (52159)',
  beer_wall: 'Beer Wall Spillway & Sluices (52157)',
  monks_leaze_clyse: "Monk's Leaze Clyse Sluice (52233)",
  muchelney_access: 'Muchelney Spine Road (Langport ↔ Muchelney)',
  a361_burrowbridge: 'A361 East Lyng ↔ Burrowbridge',
  new_road_curry: 'New Road (West Sedgemoor ↔ North Curry)',
  bicknells_bridge_access: "Bicknell's Bridge & Drayton Lane",
  moorland_new_cut_road: 'Moorland / Fordgate (Northmoor Road)',
  stan_moor_road: 'Stan Moor Road (Stoke St Gregory ↔ Burrowbridge)',
  beer_wall_a372: 'A372 Beer Wall Causeway (Othery ↔ Aller)'
});

const STATE_SYMBOLS = Object.freeze({
  PASSABLE: '🟢',
  ENCROACHING: '🟡',
  IMPASSABLE: '🔴',
  SECURE: '🟢',
  NEAR_CREST: '🟡',
  OVERTOPPING: '🔴',
  STANDBY: '⚪',
  DUTY_PUMPING: '🟢',
  MOBILE_ORDERED: '🟡',
  MOBILE_ACTIVE: '🔴',
  CRITICAL: '🚨',
  DISCHARGING: '🔵',
  TIDE_LOCKED: '🕒',
  CLOSED: '⚪',
  DIVERTING: '🟢',
  THROTTLED: '🟡',
  REVERSE_LOCK: '🟠',
  NORMAL: '🟢',
  ALERT: '🔴'
});

export class CameraModalController {
  /**
   * @param {object} options
   * @param {string} [options.modalId='camera-guide-modal']
   * @param {Record<string, object>} [options.fieldGuides={}]
   * @param {string} [options.defaultSiteKey='dunball']
   */
  constructor(options = {}) {
    this.modalId = options.modalId || 'camera-guide-modal';
    this.fieldGuides = options.fieldGuides || {};
    this.defaultSiteKey = options.defaultSiteKey || 'dunball';

    this.activeTriggerElement = null;
    this.backdrop = null;

    // Event Visual Evidence State (Issue #24)
    this.eventsById = new Map();
    this.eventsByAsset = new Map();
    this.activeTab = 'guide'; // 'evidence' | 'guide'
    this.activeSiteKey = this.defaultSiteKey;
    this.activeEvent = null;
    this.evidenceViewMode = 'sequence'; // 'sequence' | 'keyframes' | 'compare'
    this.selectedPhase = 'peak'; // 'start' | 'peak' | 'end'
    this.sequenceIndex = 0;
    this.isPlaying = false;
    this.playbackSpeed = 1; // 1 (650ms) | 2 (325ms)
    this.playbackTimer = null;
    this.compareSwapped = false;
    this.useDawnFallbackInCompare = false;

    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleBackdropClick = this._handleBackdropClick.bind(this);
    this.close = this.close.bind(this);
  }

  /**
   * Registers correlated telemetry events so delegated triggers (`[data-visual-evidence-event-id]`
   * and `[data-visual-evidence-asset]`) can open the Visual Evidence inspector directly.
   *
   * @param {Array<object>} events
   */
  setEventsCatalog(events = []) {
    if (!Array.isArray(events)) return;
    this.eventsById.clear();
    this.eventsByAsset.clear();
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      if (ev.id !== undefined && ev.id !== null) {
        this.eventsById.set(String(ev.id), ev);
      }
      if (ev.asset_id) {
        const existing = this.eventsByAsset.get(ev.asset_id);
        // Prefer events that have camera_evidence or are ACTIVE
        if (!existing || (ev.camera_evidence && !existing.camera_evidence) || ev.status === 'ACTIVE') {
          this.eventsByAsset.set(ev.asset_id, ev);
        }
      }
    }
  }

  /**
   * Normalizes arbitrary site strings to canonical guide keys
   */
  normalizeSiteKey(siteKey) {
    if (!siteKey || typeof siteKey !== 'string') return this.defaultSiteKey;
    if (ASSET_TO_GUIDE_SITE[siteKey]) return ASSET_TO_GUIDE_SITE[siteKey];
    const key = siteKey.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (this.fieldGuides[key]) return key;

    for (const canonicalKey of Object.keys(this.fieldGuides)) {
      if (key.includes(canonicalKey) || canonicalKey.includes(key)) {
        return canonicalKey;
      }
    }
    return this.defaultSiteKey;
  }

  /**
   * Generates or retrieves the modal DOM container
   */
  getOrCreateModalDOM() {
    if (typeof document === 'undefined') return null;

    let backdrop = document.getElementById(this.modalId);
    if (backdrop) {
      this.backdrop = backdrop;
      return backdrop;
    }

    backdrop = document.createElement('div');
    backdrop.id = this.modalId;
    backdrop.className = 'camera-guide-backdrop';
    backdrop.setAttribute('role', 'presentation');
    backdrop.setAttribute('aria-hidden', 'true');

    backdrop.innerHTML = `
      <div class="camera-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-guide-title">
        <div class="camera-guide-handle" aria-hidden="true"></div>
        <div class="camera-guide-header">
          <div class="camera-guide-title-wrap">
            <span class="guide-header-icon" id="camera-modal-header-icon" aria-hidden="true">🧭</span>
            <div>
              <h3 id="camera-guide-title" class="camera-guide-title">Community Camera Field Guide</h3>
              <p id="camera-guide-subtitle" class="camera-guide-subtitle">Optical Ground-Truth Fidelity &amp; Disambiguation</p>
            </div>
          </div>
          <button type="button" class="camera-guide-close" id="camera-guide-close" aria-label="Close camera modal">✕</button>
        </div>

        <div class="camera-modal-top-tabs" id="camera-modal-top-tabs" role="tablist" aria-label="Camera Inspector Mode" style="display: none;">
          <button type="button" role="tab" id="tab-btn-evidence" class="camera-modal-top-tab active" aria-selected="true" aria-controls="panel-visual-evidence" data-modal-tab="evidence">
            <span aria-hidden="true">📸</span> Event Visual Evidence
          </button>
          <button type="button" role="tab" id="tab-btn-guide" class="camera-modal-top-tab" aria-selected="false" aria-controls="panel-field-guide" data-modal-tab="guide">
            <span aria-hidden="true">🧭</span> Community Camera Field Guide
          </button>
        </div>

        <div class="camera-guide-body" id="panel-visual-evidence" role="tabpanel" aria-labelledby="tab-btn-evidence" style="display: none;">
          <div id="visual-evidence-container"></div>
        </div>

        <div class="camera-guide-body" id="panel-field-guide" role="tabpanel" aria-labelledby="tab-btn-guide">
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

    const closeBtn = backdrop.querySelector('#camera-guide-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', this.close);
    }

    const tabBtns = backdrop.querySelectorAll('[data-modal-tab]');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-modal-tab');
        this.switchTopTab(targetTab);
      });
    });

    backdrop.addEventListener('click', this._handleBackdropClick);
    document.addEventListener('keydown', this._handleKeyDown);

    document.body.appendChild(backdrop);
    this.backdrop = backdrop;
    return backdrop;
  }

  /**
   * Switches between the top-level 'evidence' and 'guide' tabs inside the modal
   * @param {'evidence'|'guide'} tabName
   */
  switchTopTab(tabName) {
    if (!this.backdrop) return;
    this.activeTab = tabName === 'evidence' ? 'evidence' : 'guide';
    if (this.activeTab !== 'evidence') {
      this.stopSequencePlayback();
    }

    const dialogEl = this.backdrop.querySelector('.camera-guide-dialog');
    const tabEvidence = this.backdrop.querySelector('#tab-btn-evidence');
    const tabGuide = this.backdrop.querySelector('#tab-btn-guide');
    const panelEvidence = this.backdrop.querySelector('#panel-visual-evidence');
    const panelGuide = this.backdrop.querySelector('#panel-field-guide');
    const iconEl = this.backdrop.querySelector('#camera-modal-header-icon');
    const titleEl = this.backdrop.querySelector('#camera-guide-title');
    const subtitleEl = this.backdrop.querySelector('#camera-guide-subtitle');

    if (dialogEl) {
      dialogEl.classList.toggle('dialog-visual-evidence', this.activeTab === 'evidence');
    }

    if (tabEvidence && tabGuide) {
      const isEv = this.activeTab === 'evidence';
      tabEvidence.classList.toggle('active', isEv);
      tabEvidence.setAttribute('aria-selected', isEv ? 'true' : 'false');
      tabGuide.classList.toggle('active', !isEv);
      tabGuide.setAttribute('aria-selected', !isEv ? 'true' : 'false');
    }

    if (panelEvidence && panelGuide) {
      panelEvidence.style.display = this.activeTab === 'evidence' ? '' : 'none';
      panelGuide.style.display = this.activeTab === 'guide' ? '' : 'none';
    }

    if (this.activeTab === 'evidence' && this.activeEvent) {
      const assetTitle = ASSET_DISPLAY_NAMES[this.activeEvent.asset_id] || this.activeEvent.asset_id || 'Telemetry Event';
      const camName = this.activeEvent.camera_evidence?.camera_name || 'Optical Transition Keyframe Inspector';
      if (iconEl) iconEl.textContent = '📸';
      if (titleEl) titleEl.textContent = `Visual Evidence: ${assetTitle}`;
      if (subtitleEl) subtitleEl.textContent = `${camName} • Optical Ground-Truth`;
    } else {
      const guide = this.fieldGuides[this.activeSiteKey] || this.fieldGuides[this.defaultSiteKey] || {
        title: 'Camera Field Guide',
        subtitle: 'Optical Ground-Truth Verification'
      };
      if (iconEl) iconEl.textContent = '🧭';
      if (titleEl) titleEl.textContent = guide.title;
      if (subtitleEl) subtitleEl.textContent = guide.subtitle;
    }
  }

  _handleBackdropClick(e) {
    if (e.target === this.backdrop) {
      this.close();
    }
  }

  _handleKeyDown(e) {
    if (!this.backdrop || !this.backdrop.classList.contains('open')) return;

    if (e.key === 'Escape') {
      this.close();
      return;
    }

    // Keyboard shortcuts when inside Visual Evidence tab [UI-ACC-01]
    if (this.activeTab === 'evidence' && this.activeEvent) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const isRangeInput = tag === 'input' && document.activeElement?.type === 'range';

      if (e.key === 'ArrowLeft' && !isRangeInput) {
        e.preventDefault();
        this.stepFrame(-1);
        return;
      }
      if (e.key === 'ArrowRight' && !isRangeInput) {
        e.preventDefault();
        this.stepFrame(1);
        return;
      }
      if (e.key === 'Home' && !isRangeInput) {
        e.preventDefault();
        this.jumpToSequenceIndex(0);
        return;
      }
      if (e.key === 'End' && !isRangeInput) {
        e.preventDefault();
        const frames = this._getPlayableSequenceFrames(this.activeEvent);
        if (frames.length > 0) this.jumpToSequenceIndex(frames.length - 1);
        return;
      }
      if (e.key === ' ' && tag !== 'button' && tag !== 'a' && !isRangeInput) {
        e.preventDefault();
        this.toggleSequencePlayback();
        return;
      }
    }

    if (e.key === 'Tab') {
      const focusableEls = Array.from(
        this.backdrop.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null && !el.closest('[style*="display: none"]'));

      if (focusableEls.length === 0) return;
      const firstEl = focusableEls[0];
      const lastEl = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl || !this.backdrop.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl || !this.backdrop.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  }

  /**
   * Populates the Field Guide tab content for a normalized siteKey
   */
  _populateFieldGuideDOM(normalizedKey) {
    const backdrop = this.getOrCreateModalDOM();
    if (!backdrop) return;

    const guide = this.fieldGuides[normalizedKey] || this.fieldGuides[this.defaultSiteKey] || {
      title: 'Camera Field Guide',
      subtitle: 'Optical Ground-Truth Verification',
      cfhUrl: 'https://thecfh.org',
      questions: [],
      checklist: []
    };

    const questionsListEl = backdrop.querySelector('#camera-guide-questions');
    const checklistEl = backdrop.querySelector('#camera-guide-checklist');
    const ctaBtn = backdrop.querySelector('#camera-guide-cta-btn');

    if (questionsListEl) {
      questionsListEl.innerHTML = (guide.questions || []).map(q => `
        <li class="guide-question-item">
          <span class="guide-q-icon" aria-hidden="true">❓</span>
          <span>${escapeHTML(q)}</span>
        </li>
      `).join('');
    }

    if (checklistEl) {
      checklistEl.innerHTML = (guide.checklist || []).map(item => `
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
            <span class="guide-box-label">⚠️ Physical Limitations:</span>
            <p>${escapeHTML(item.physicalLimitation)}</p>
          </div>
        </div>
      `).join('');
    }

    if (ctaBtn) {
      ctaBtn.href = guide.cfhUrl || 'https://thecfh.org';
      ctaBtn.innerHTML = `Open Live Feeds on thecfh.org ↗ <span class="sr-only">(opens external link to ${escapeHTML(guide.title)})</span>`;
    }
  }

  /**
   * Opens modal for a designated camera site (Field Guide tab)
   * @param {string} siteKey
   * @param {HTMLElement} [triggerEl=null]
   */
  open(siteKey, triggerEl = null) {
    if (typeof document === 'undefined') return;

    this.stopSequencePlayback();
    const normalizedKey = this.normalizeSiteKey(siteKey);
    this.activeSiteKey = normalizedKey;
    this.activeTriggerElement = triggerEl || (typeof document.activeElement !== 'undefined' ? document.activeElement : null);

    const backdrop = this.getOrCreateModalDOM();
    if (!backdrop) return;

    this._populateFieldGuideDOM(normalizedKey);

    // Check if there is an active event matching this siteKey
    const topTabs = backdrop.querySelector('#camera-modal-top-tabs');
    if (topTabs) {
      topTabs.style.display = this.activeEvent ? 'flex' : 'none';
    }

    this.switchTopTab('guide');

    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');

    const closeBtn = backdrop.querySelector('#camera-guide-close');
    if (closeBtn) closeBtn.focus();
  }

  /**
   * Opens modal in Event Visual Evidence Inspector mode (Issue #24)
   *
   * @param {object|string|number} eventOrId - Full event row object, event ID, or asset_id
   * @param {HTMLElement} [triggerEl=null]
   */
  openVisualEvidence(eventOrId, triggerEl = null) {
    if (typeof document === 'undefined') return;

    this.stopSequencePlayback();

    let ev = null;
    if (eventOrId && typeof eventOrId === 'object') {
      ev = eventOrId;
    } else if (eventOrId !== undefined && eventOrId !== null) {
      const key = String(eventOrId);
      ev = this.eventsById.get(key) || this.eventsByAsset.get(key) || null;
    }

    if (!ev) return;

    this.activeEvent = ev;
    this.activeSiteKey = this.normalizeSiteKey(ev.asset_id || ev.camera_evidence?.camera_id || this.defaultSiteKey);
    this.activeTriggerElement = triggerEl || (typeof document.activeElement !== 'undefined' ? document.activeElement : null);
    this.compareSwapped = false;
    this.useDawnFallbackInCompare = false;

    const frames = this._getPlayableSequenceFrames(ev);
    const keyframes = this._normalizeKeyframes(ev);

    // Smart default selection for mixed day/night events:
    // Select first daylight keyframe ('start' -> 'end' -> 'peak'), or 'start' if all night
    if (keyframes.start && keyframes.start.image_url && keyframes.start.fallback_mode !== 'NIGHT_TELEMETRY') {
      this.selectedPhase = 'start';
    } else if (keyframes.end && keyframes.end.image_url && keyframes.end.fallback_mode !== 'NIGHT_TELEMETRY') {
      this.selectedPhase = 'end';
    } else if (keyframes.peak && keyframes.peak.image_url && keyframes.peak.fallback_mode !== 'NIGHT_TELEMETRY') {
      this.selectedPhase = 'peak';
    } else {
      this.selectedPhase = keyframes.start ? 'start' : (keyframes.end ? 'end' : 'peak');
    }

    if (frames.length > 1) {
      this.evidenceViewMode = 'sequence';
      // Start scrubber at Start transition frame (or first frame) for immediate context
      const startIdx = this._findNearestSequenceIndex(frames, keyframes.start?.timestamp || ev.start_time);
      this.sequenceIndex = startIdx >= 0 ? startIdx : 0;
    } else {
      this.evidenceViewMode = 'keyframes';
      this.sequenceIndex = 0;
    }

    const backdrop = this.getOrCreateModalDOM();
    if (!backdrop) return;

    this._populateFieldGuideDOM(this.activeSiteKey);

    const topTabs = backdrop.querySelector('#camera-modal-top-tabs');
    if (topTabs) {
      topTabs.style.display = 'flex';
    }

    this.renderVisualEvidencePanel();
    this.switchTopTab('evidence');

    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');

    const closeBtn = backdrop.querySelector('#camera-guide-close');
    if (closeBtn) closeBtn.focus();
  }

  /**
   * Normalizes keyframes from `event.camera_evidence` into `{ start, peak, end }`
   */
  _normalizeKeyframes(ev) {
    const ce = ev?.camera_evidence || {};
    const rawKf = ce.keyframes || {};

    const buildEntry = (phaseKey, label, rawEntry, fallbackTimestamp) => {
      if (rawEntry && typeof rawEntry === 'object') {
        return {
          key: phaseKey,
          label,
          phase: rawEntry.phase || `EVENT_${phaseKey.toUpperCase()}`,
          timestamp: rawEntry.timestamp || fallbackTimestamp || ce.fetched_at || null,
          image_url: safeImageUrl(rawEntry.image_url),
          delta_ms: typeof rawEntry.delta_ms === 'number' ? rawEntry.delta_ms : null,
          fallback_mode: rawEntry.fallback_mode || null
        };
      }
      // If no explicit keyframes map exists on single-snapshot record, map main snapshot to matching trigger_reason
      const reasonMatch = (ce.trigger_reason === `EVENT_${phaseKey.toUpperCase()}`) || (phaseKey === 'start' && !rawKf.start && !rawKf.peak && !rawKf.end);
      if (reasonMatch && (safeImageUrl(ce.image_url) || ce.fallback_mode)) {
        return {
          key: phaseKey,
          label,
          phase: ce.trigger_reason || `EVENT_${phaseKey.toUpperCase()}`,
          timestamp: ce.fetched_at || fallbackTimestamp || null,
          image_url: safeImageUrl(ce.image_url),
          delta_ms: null,
          fallback_mode: ce.fallback_mode || null
        };
      }
      return null;
    };

    const startEntry = buildEntry('start', 'Transition Start', rawKf.start, ev?.start_time);
    const endEntry = ev?.end_time ? buildEntry('end', 'Transition End', rawKf.end, ev?.end_time) : null;

    // Only surface a separate 'peak' keyframe if it is genuinely distinct from both Start and End
    // and not a binary mechanical gate/sluice transition.
    const isBinaryGateType = ev?.asset_type === 'tidal_gate' || ev?.asset_type === 'sluice';
    const rawPeakEntry = !isBinaryGateType
      ? buildEntry('peak', ev?.status === 'ACTIVE' ? 'High Stage So Far' : 'Peak Stage', rawKf.peak, ev?.peak_time)
      : null;

    const isSameFrame = (a, b) => {
      if (!a || !b) return false;
      if (a.image_url && b.image_url && a.image_url === b.image_url) return true;
      const tA = new Date(a.timestamp).getTime();
      const tB = new Date(b.timestamp).getTime();
      if (Number.isFinite(tA) && Number.isFinite(tB) && Math.abs(tA - tB) < 5 * 60 * 1000 && a.fallback_mode === b.fallback_mode) {
        return true;
      }
      return false;
    };

    const peakEntry = (rawPeakEntry && !isSameFrame(rawPeakEntry, startEntry) && !isSameFrame(rawPeakEntry, endEntry))
      ? rawPeakEntry
      : null;

    return {
      start: startEntry,
      peak: peakEntry,
      end: endEntry
    };
  }

  /**
   * Extracts ordered playable daylight frames from `camera_evidence.sequence_frames`
   * (falling back to deduplicated daylight keyframes if `sequence_frames` is empty).
   */
  _getPlayableSequenceFrames(ev) {
    const ce = ev?.camera_evidence || {};
    if (ce.fallback_mode === 'NIGHT_TELEMETRY') {
      return [];
    }
    const seq = Array.isArray(ce.sequence_frames) ? ce.sequence_frames : [];
    const validSeq = seq.filter(f => f && isValidEventImageUrl(f.image_url) && f.fallback_mode !== 'NIGHT_TELEMETRY');
    if (validSeq.length > 0) {
      return validSeq;
    }

    const kf = this._normalizeKeyframes(ev);
    const fallbackFrames = [];
    const seenUrls = new Set();
    for (const entry of [kf.start, kf.peak, kf.end]) {
      if (entry && entry.image_url && entry.fallback_mode !== 'NIGHT_TELEMETRY' && !seenUrls.has(entry.image_url)) {
        seenUrls.add(entry.image_url);
        fallbackFrames.push({
          timestamp: entry.timestamp,
          image_url: entry.image_url,
          phase: entry.phase
        });
      }
    }
    return fallbackFrames;
  }

  _findNearestSequenceIndex(frames, targetIso) {
    if (!Array.isArray(frames) || frames.length === 0 || !targetIso) return -1;
    const targetMs = new Date(targetIso).getTime();
    if (!Number.isFinite(targetMs)) return 0;

    let bestIdx = 0;
    let bestDiff = Infinity;
    frames.forEach((f, idx) => {
      const ms = new Date(f.timestamp).getTime();
      if (Number.isFinite(ms)) {
        const diff = Math.abs(ms - targetMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = idx;
        }
      }
    });
    return bestIdx;
  }

  /**
   * Renders the full Visual Evidence Inspector panel DOM inside `#visual-evidence-container`
   */
  renderVisualEvidencePanel() {
    if (!this.backdrop || !this.activeEvent) return;
    const container = this.backdrop.querySelector('#visual-evidence-container');
    if (!container) return;

    const ev = this.activeEvent;
    const ce = ev.camera_evidence || {};
    const keyframes = this._normalizeKeyframes(ev);
    const frames = this._getPlayableSequenceFrames(ev);
    const isAllNight = ce.fallback_mode === 'NIGHT_TELEMETRY' && frames.length === 0;

    const assetTypeUpper = String(ev.asset_type || 'asset').toUpperCase().replace(/_/g, ' ');
    const assetName = ASSET_DISPLAY_NAMES[ev.asset_id] || ev.asset_id || 'Monitored Asset';
    const fromState = ev.from_state || 'NORMAL';
    const toState = ev.to_state || 'ALERT';
    const fromSym = STATE_SYMBOLS[fromState] || '⚪';
    const toSym = STATE_SYMBOLS[toState] || '🔴';

    const startTimeStr = formatShortGmt(ev.start_time);
    const peakTimeStr = formatShortGmt(ev.peak_time || ev.start_time);
    const endTimeStr = ev.end_time ? formatShortGmt(ev.end_time) : 'Active (Ongoing)';
    const peakStageStr = typeof ev.peak_stage_mAOD === 'number' ? `${ev.peak_stage_mAOD.toFixed(2)}m AOD` : 'Sensor Verified';
    const durationStr = ev.duration_formatted || '0h 0m';

    // Phase Jump / Selector Pills (Start & End transitions; Peak only when distinct)
    const phaseEntries = [
      { key: 'start', label: 'Start', data: keyframes.start, icon: '🟢', pillClass: 'phase-start' },
      { key: 'peak', label: ev.status === 'ACTIVE' ? 'High So Far' : 'Peak Stage', data: keyframes.peak, icon: '⭐', pillClass: 'phase-peak' },
      { key: 'end', label: 'End', data: keyframes.end, icon: '🔵', pillClass: 'phase-end' }
    ].filter(p => p.data !== null);

    const phasePillsHtml = phaseEntries.map(p => {
      const isNight = p.data.fallback_mode === 'NIGHT_TELEMETRY' || !p.data.image_url;
      const isActive = this.selectedPhase === p.key;
      const timeLabel = formatTimeOnlyGmt(p.data.timestamp);
      const badgeIcon = isNight ? '🌙' : p.icon;
      const suffix = isNight ? ' • Night' : '';
      return `
        <button type="button"
                class="evidence-phase-pill ${p.pillClass}${isActive ? ' active' : ''}"
                data-evidence-phase="${p.key}"
                aria-pressed="${isActive ? 'true' : 'false'}"
                title="${escapeAttr(isNight ? `${p.label} occurred in darkness (Night Telemetry)` : `Inspect ${p.label} keyframe (${timeLabel})`)}">
          <span aria-hidden="true">${badgeIcon}</span>
          <span>${escapeHTML(p.label)} (${escapeHTML(timeLabel)}${escapeHTML(suffix)})</span>
        </button>
      `;
    }).join('');

    // Viewport Body according to mode
    let viewportHtml = '';
    if (isAllNight) {
      viewportHtml = this._renderNightTelemetryCard(ev, keyframes[this.selectedPhase] || keyframes.peak || keyframes.start);
    } else if (this.evidenceViewMode === 'sequence' && frames.length > 0) {
      viewportHtml = this._renderSequencePlayerHtml(ev, frames, keyframes);
    } else if (this.evidenceViewMode === 'compare') {
      viewportHtml = this._renderCompareModeHtml(ev, frames, keyframes);
    } else {
      viewportHtml = this._renderSingleKeyframeHtml(ev, keyframes);
    }

    // Provenance & [RULE-CAM-01] Optical Ground-Truth Footer
    const activeKf = keyframes[this.selectedPhase] || keyframes.start || keyframes.end || keyframes.peak || {};
    const deltaMins = typeof activeKf.delta_ms === 'number'
      ? `±${(activeKf.delta_ms / 60000).toFixed(1)} min`
      : 'Not recorded';
    const camName = ce.camera_name || ce.camera_id || 'Community Flood Hub Camera';
    const camDesc = ce.camera_description || 'Frames physical flood defence structure and water surface level.';
    const camLookFor = ce.camera_look_for || 'Surface water contact, overtopping cascade, or carriageway submergence.';
    const guideObj = this.fieldGuides[this.activeSiteKey] || this.fieldGuides[this.defaultSiteKey];
    const cfhUrl = guideObj?.cfhUrl || 'https://thecfh.org';

    container.innerHTML = `
      <div class="evidence-event-summary-strip" role="region" aria-label="Tripartite Event Summary">
        <div class="evidence-tripartite-row">
          <span class="evidence-asset-type-pill">${escapeHTML(assetTypeUpper)}</span>
          <strong class="evidence-asset-name">${escapeHTML(assetName)}</strong>
          <span class="evidence-transition-badge">
            <span aria-hidden="true">${fromSym}</span> ${escapeHTML(fromState)}
            <span aria-hidden="true">➔</span>
            <span aria-hidden="true">${toSym}</span> <strong>${escapeHTML(toState)}</strong>
          </span>
        </div>
        <div class="evidence-metrics-row">
          <span><strong>Started:</strong> ${escapeHTML(startTimeStr)}</span>
          <span>•</span>
          <span><strong>Ended:</strong> ${escapeHTML(endTimeStr)}</span>
          <span>•</span>
          <span><strong>Duration:</strong> ${escapeHTML(durationStr)}</span>
          <span>•</span>
          <span><strong>Max Stage:</strong> <code>${escapeHTML(peakStageStr)}</code>${keyframes.peak ? ` (${escapeHTML(peakTimeStr)})` : ''}</span>
        </div>
      </div>

      ${!isAllNight ? `
      <div class="evidence-controls-header">
        <div class="evidence-mode-tabs" role="group" aria-label="Visual Evidence View Mode">
          <button type="button" class="evidence-mode-tab${this.evidenceViewMode === 'sequence' ? ' active' : ''}" data-evidence-mode="sequence" aria-pressed="${this.evidenceViewMode === 'sequence'}" ${frames.length === 0 ? 'disabled' : ''}>
            🎬 Sequence Player (${frames.length})
          </button>
          <button type="button" class="evidence-mode-tab${this.evidenceViewMode === 'keyframes' ? ' active' : ''}" data-evidence-mode="keyframes" aria-pressed="${this.evidenceViewMode === 'keyframes'}">
            🖼️ Keyframes (${phaseEntries.length})
          </button>
          <button type="button" class="evidence-mode-tab${this.evidenceViewMode === 'compare' ? ' active' : ''}" data-evidence-mode="compare" aria-pressed="${this.evidenceViewMode === 'compare'}">
            ⚖️ Before / After Compare
          </button>
        </div>

        ${phasePillsHtml ? `
        <div class="evidence-phase-bar" role="group" aria-label="Jump to Event Phase">
          <span class="evidence-phase-label">Phase:</span>
          ${phasePillsHtml}
        </div>
        ` : ''}
      </div>
      ` : ''}

      <div class="evidence-stage-wrapper" id="evidence-stage-wrapper">
        ${viewportHtml}
      </div>

      <div class="evidence-provenance-card" role="region" aria-label="Optical Camera Field-of-View Provenance">
        <div class="evidence-prov-header">
          <span aria-hidden="true">📷</span>
          <strong>Camera: ${escapeHTML(camName)}</strong>
          <code class="evidence-cam-id-tag">${escapeHTML(ce.camera_id || 'cfh_cam')}</code>
        </div>
        <p class="evidence-prov-line">
          <strong>🔭 Physical Lens View:</strong> ${escapeHTML(camDesc)}
        </p>
        <p class="evidence-prov-line">
          <strong>🔍 What to Look For:</strong> ${escapeHTML(camLookFor)}
        </p>
        <div class="evidence-audit-strip">
          <span>⏱️ <strong>Correlation Audit:</strong> Phase <code>${escapeHTML(activeKf.phase || ce.trigger_reason || 'EVENT_START')}</code></span>
          <span>•</span>
          <span>Frame Captured: <code>${escapeHTML(formatShortGmt(activeKf.timestamp || ce.fetched_at))}</code></span>
          <span>•</span>
          <span>Offset (Δt): <code>${escapeHTML(deltaMins)}</code></span>
          <span>•</span>
          <a href="${escapeAttr(cfhUrl)}" target="_blank" rel="noopener noreferrer" class="evidence-cfh-link">Source: thecfh.org ↗</a>
        </div>
      </div>
    `;

    this._bindEvidencePanelEvents(container, frames, keyframes);
  }

  _renderFrameUnavailableCard(ev, phaseEntry = null) {
    const phaseTime = formatShortGmt(phaseEntry?.timestamp || ev.peak_time || ev.start_time);
    const peakStageStr = typeof ev.peak_stage_mAOD === 'number' ? `${ev.peak_stage_mAOD.toFixed(2)}m AOD` : 'Not recorded';
    return `
      <div class="evidence-night-card evidence-unavailable-card" role="status" aria-live="polite">
        <div class="night-card-icon" aria-hidden="true">📷</div>
        <h4 class="night-card-title">Optical frame unavailable for this moment.</h4>
        <p class="night-card-subtitle">
          No archived camera frame was captured for ${escapeHTML(phaseTime)} (the camera may have been offline or its image unreadable).
        </p>
        <div class="night-sensor-box">
          <div class="night-sensor-heading">📡 ENVIRONMENT AGENCY STAGE TELEMETRY</div>
          <ul class="night-sensor-list">
            <li><strong>State Transition:</strong> <code>${escapeHTML(ev.from_state || 'NORMAL')} ➔ ${escapeHTML(ev.to_state || 'ALERT')}</code></li>
            <li><strong>Peak Water Stage:</strong> <code>${escapeHTML(peakStageStr)}</code></li>
          </ul>
        </div>
      </div>
    `;
  }

  _renderNightTelemetryCard(ev, phaseEntry = null) {
    const peakStageStr = typeof ev.peak_stage_mAOD === 'number' ? `${ev.peak_stage_mAOD.toFixed(2)}m AOD` : 'Verified';
    const phaseTime = formatShortGmt(phaseEntry?.timestamp || ev.peak_time || ev.start_time);
    const assetName = ASSET_DISPLAY_NAMES[ev.asset_id] || ev.asset_id || 'Monitored Asset';
    const phaseLabel = phaseEntry?.label ? ` (${phaseEntry.label} Phase @ ${phaseTime})` : '';

    return `
      <div class="evidence-night-card" role="status" aria-live="polite">
        <div class="night-card-icon" aria-hidden="true">🌙</div>
        <h4 class="night-card-title">🌙 Night Telemetry Active — Visual frame obscured by darkness. Sensor stage verified.</h4>
        <p class="night-card-subtitle">
          Transition phase${escapeHTML(phaseLabel)} occurred below civil twilight (solar elevation &le; &minus;6.0&deg;).
        </p>
        <div class="night-sensor-box">
          <div class="night-sensor-heading">📡 VERIFIED ENVIRONMENT AGENCY STAGE TELEMETRY</div>
          <ul class="night-sensor-list">
            <li><strong>Monitored Asset:</strong> ${escapeHTML(assetName)}</li>
            <li><strong>State Transition:</strong> <code>${escapeHTML(ev.from_state || 'NORMAL')} ➔ ${escapeHTML(ev.to_state || 'ALERT')}</code></li>
            <li><strong>Peak Water Stage:</strong> <code>${escapeHTML(peakStageStr)}</code></li>
            <li><strong>Timestamp:</strong> <code>${escapeHTML(phaseTime)}</code></li>
          </ul>
        </div>
        <p class="night-humility-note">
          Unilluminated rural webcam feeds capture pitch-black frames after dusk. Because dark frames show nothing useful, they are suppressed in favour of calibrated Environment Agency stage sensors.
        </p>
      </div>
    `;
  }

  _renderSequencePlayerHtml(ev, frames, keyframes) {
    const safeIdx = Math.max(0, Math.min(frames.length - 1, this.sequenceIndex));
    const currentFrame = frames[safeIdx];
    const frameTimeStr = formatShortGmt(currentFrame.timestamp);
    const assetName = ASSET_DISPLAY_NAMES[ev.asset_id] || ev.asset_id || 'Asset';
    const peakStageStr = typeof ev.peak_stage_mAOD === 'number' ? `${ev.peak_stage_mAOD.toFixed(2)}m AOD` : '';

    // Determine if current frame corresponds to Start, Peak, or End keyframe
    const startIdx = keyframes.start?.image_url ? this._findNearestSequenceIndex(frames, keyframes.start.timestamp) : -1;
    const peakIdx = keyframes.peak?.image_url ? this._findNearestSequenceIndex(frames, keyframes.peak.timestamp) : -1;
    const endIdx = keyframes.end?.image_url ? this._findNearestSequenceIndex(frames, keyframes.end.timestamp) : -1;

    let phaseOverlayBadge = '<span class="frame-phase-badge badge-seq-step">🎞️ TRANSITION SEQUENCE</span>';
    if (safeIdx === startIdx) {
      phaseOverlayBadge = '<span class="frame-phase-badge badge-seq-start">🟢 TRANSITION START</span>';
    } else if (safeIdx === endIdx) {
      phaseOverlayBadge = '<span class="frame-phase-badge badge-seq-end">🔵 TRANSITION END</span>';
    } else if (safeIdx === peakIdx) {
      phaseOverlayBadge = `<span class="frame-phase-badge badge-seq-peak">⭐ PEAK STAGE${peakStageStr ? ` • ${escapeHTML(peakStageStr)}` : ''}</span>`;
    }

    // Build pin markers along scrubber track (avoid duplicate overlapping pins on identical frame indices)
    const usedPinIndices = new Set();
    const buildPin = (idx, label, cls) => {
      if (idx < 0 || frames.length <= 1 || usedPinIndices.has(idx)) return '';
      usedPinIndices.add(idx);
      const pct = ((idx / (frames.length - 1)) * 100).toFixed(1);
      const alignStyle = idx === 0
        ? 'left: 0%; transform: translateX(0);'
        : (idx === frames.length - 1 ? 'left: 100%; transform: translateX(-100%);' : `left: ${pct}%; transform: translateX(-50%);`);
      return `<span class="scrubber-phase-pin ${cls}" style="${alignStyle}" title="${escapeAttr(label)} (Frame ${idx + 1})">${escapeHTML(label)}</span>`;
    };

    const nightNotes = [];
    if (keyframes.start?.fallback_mode === 'NIGHT_TELEMETRY') nightNotes.push('🌙 Start occurred in darkness');
    if (keyframes.end?.fallback_mode === 'NIGHT_TELEMETRY') nightNotes.push('🌙 End occurred in darkness');

    return `
      <div class="evidence-viewport-stage">
        <div class="evidence-frame-overlay-top">
          <span class="frame-counter-pill" id="evidence-live-counter" aria-live="polite">
            Frame ${safeIdx + 1} / ${frames.length} • ${escapeHTML(frameTimeStr)}
          </span>
          ${phaseOverlayBadge}
        </div>
        <img src="${escapeAttr(currentFrame.image_url)}"
             alt="${escapeAttr(`${assetName} optical camera frame ${safeIdx + 1} of ${frames.length} captured at ${frameTimeStr}`)}"
             class="evidence-frame-img"
             id="evidence-sequence-img"
             loading="eager" />
      </div>

      <div class="evidence-scrubber-wrap">
        <div class="scrubber-pins-track" aria-hidden="true">
          ${buildPin(startIdx, '🟢 Start', 'pin-start')}
          ${buildPin(peakIdx, '⭐ Peak', 'pin-peak')}
          ${buildPin(endIdx, '🔵 End', 'pin-end')}
        </div>
        <input type="range"
               id="evidence-scrubber-slider"
               class="evidence-scrubber-input"
               min="0"
               max="${Math.max(0, frames.length - 1)}"
               step="1"
               value="${safeIdx}"
               aria-label="Scrub event transition frame sequence from frame 1 to ${frames.length}" />
        <div class="scrubber-endpoints-row">
          <span>${escapeHTML(formatTimeOnlyGmt(frames[0]?.timestamp))} (Frame 1)</span>
          ${nightNotes.length > 0 ? `<span class="scrubber-night-note">${escapeHTML(nightNotes.join(' • '))}</span>` : ''}
          <span>${escapeHTML(formatTimeOnlyGmt(frames[frames.length - 1]?.timestamp))} (Frame ${frames.length})</span>
        </div>
      </div>

      <div class="evidence-transport-bar" role="toolbar" aria-label="Sequence Playback Controls">
        <div class="transport-left-group">
          <button type="button" class="evidence-transport-btn btn-play-toggle" id="evidence-play-btn" aria-label="${this.isPlaying ? 'Pause transition sequence' : 'Play transition sequence'}">
            <span aria-hidden="true">${this.isPlaying ? '⏸' : '▶'}</span>
            <span>${this.isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button type="button" class="evidence-transport-btn" id="evidence-prev-btn" aria-label="Previous frame">
            <span aria-hidden="true">◀</span> Prev
          </button>
          <button type="button" class="evidence-transport-btn" id="evidence-next-btn" aria-label="Next frame">
            Next <span aria-hidden="true">▶</span>
          </button>
        </div>

        <div class="transport-right-group">
          <span class="speed-label">Speed:</span>
          <button type="button" class="evidence-transport-btn speed-btn${this.playbackSpeed === 1 ? ' active' : ''}" data-playback-speed="1" aria-pressed="${this.playbackSpeed === 1}">1×</button>
          <button type="button" class="evidence-transport-btn speed-btn${this.playbackSpeed === 2 ? ' active' : ''}" data-playback-speed="2" aria-pressed="${this.playbackSpeed === 2}">2×</button>
        </div>
      </div>
    `;
  }

  _renderSingleKeyframeHtml(ev, keyframes) {
    const selected = keyframes[this.selectedPhase] || keyframes.peak || keyframes.start || keyframes.end;
    if (!selected || selected.fallback_mode === 'NIGHT_TELEMETRY') {
      return this._renderNightTelemetryCard(ev, selected);
    }
    if (!selected.image_url) {
      return this._renderFrameUnavailableCard(ev, selected);
    }

    const assetName = ASSET_DISPLAY_NAMES[ev.asset_id] || ev.asset_id || 'Asset';
    const timeStr = formatShortGmt(selected.timestamp);
    const deltaMins = typeof selected.delta_ms === 'number'
      ? `Δt ${(selected.delta_ms / 60000).toFixed(1)}m from gauge`
      : 'Matched keyframe';

    return `
      <div class="evidence-viewport-stage">
        <div class="evidence-frame-overlay-top">
          <span class="frame-counter-pill" aria-live="polite">
            ${escapeHTML(selected.label.toUpperCase())} KEYFRAME • ${escapeHTML(timeStr)}
          </span>
          <span class="frame-phase-badge badge-seq-peak">${escapeHTML(selected.phase)} • ${escapeHTML(deltaMins)}</span>
        </div>
        <img src="${escapeAttr(selected.image_url)}"
             alt="${escapeAttr(`${assetName} ${selected.label} keyframe captured at ${timeStr}`)}"
             class="evidence-frame-img"
             loading="eager" />
      </div>
    `;
  }

  _renderCompareModeHtml(ev, frames, keyframes) {
    const assetName = ASSET_DISPLAY_NAMES[ev.asset_id] || ev.asset_id || 'Asset';
    const earliestSeqFrame = frames.length > 0 ? frames[0] : null;

    let beforeItem = keyframes.start || (earliestSeqFrame ? {
      label: 'Pre-Transition (T-60m)',
      phase: 'PRE_EVENT',
      timestamp: earliestSeqFrame.timestamp,
      image_url: earliestSeqFrame.image_url,
      fallback_mode: null
    } : null);

    // Allow 1-click override if Start was at night but an early dawn sequence frame exists
    const canOfferDawnFallback = Boolean(
      beforeItem &&
      (beforeItem.fallback_mode === 'NIGHT_TELEMETRY' || !beforeItem.image_url) &&
      earliestSeqFrame &&
      earliestSeqFrame.image_url
    );

    if (canOfferDawnFallback && this.useDawnFallbackInCompare) {
      beforeItem = {
        label: 'Earliest Daylight Frame',
        phase: 'DAWN_SEQUENCE_START',
        timestamp: earliestSeqFrame.timestamp,
        image_url: earliestSeqFrame.image_url,
        fallback_mode: null
      };
    }

    const afterItem = (keyframes.end && keyframes.end.image_url)
      ? keyframes.end
      : (keyframes.peak && keyframes.peak.image_url ? keyframes.peak : (frames.length > 1 ? {
          label: 'Post-Transition Frame',
          phase: 'EVENT_TRANSITION',
          timestamp: frames[frames.length - 1].timestamp,
          image_url: frames[frames.length - 1].image_url,
          fallback_mode: null
        } : keyframes.end || keyframes.peak || keyframes.start));

    const panes = this.compareSwapped
      ? [{ role: 'AFTER (Post-Transition)', item: afterItem }, { role: 'BEFORE (Transition Start)', item: beforeItem }]
      : [{ role: 'BEFORE (Transition Start)', item: beforeItem }, { role: 'AFTER (Post-Transition)', item: afterItem }];

    const renderPane = (pane) => {
      const item = pane.item;
      if (!item || item.fallback_mode === 'NIGHT_TELEMETRY' || !item.image_url) {
        const isNightPane = !item || item.fallback_mode === 'NIGHT_TELEMETRY';
        return `
          <div class="evidence-compare-pane">
            <div class="compare-pane-header">
              <strong>${escapeHTML(pane.role)}</strong>
              <span>${escapeHTML(formatShortGmt(item?.timestamp || ev.start_time))}</span>
            </div>
            <div class="compare-pane-night">
              <span aria-hidden="true">🌙</span>
              <strong>${isNightPane ? 'Night Telemetry Active' : 'Optical Frame Unavailable'}</strong>
              <p>${isNightPane ? 'Frame obscured by darkness' : 'No archived frame'} at ${escapeHTML(formatTimeOnlyGmt(item?.timestamp || ev.start_time))}. Sensor stage verified.</p>
              ${canOfferDawnFallback && !this.useDawnFallbackInCompare ? `
                <button type="button" class="evidence-transport-btn" id="btn-use-dawn-compare">
                  ☀️ Compare Earliest Daylight Frame (${escapeHTML(formatTimeOnlyGmt(earliestSeqFrame.timestamp))})
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }

      return `
        <div class="evidence-compare-pane">
          <div class="compare-pane-header">
            <strong>${escapeHTML(pane.role)}</strong>
            <span>${escapeHTML(formatShortGmt(item.timestamp))}</span>
          </div>
          <div class="compare-pane-img-wrap">
            <img src="${escapeAttr(item.image_url)}"
                 alt="${escapeAttr(`${assetName} ${pane.role} captured at ${formatShortGmt(item.timestamp)}`)}"
                 class="evidence-frame-img" />
          </div>
        </div>
      `;
    };

    return `
      <div class="evidence-compare-toolbar">
        <span class="compare-toolbar-label">Side-by-side optical transition comparison (Pre-Transition Baseline vs. Peak/Transition Moment)</span>
        <button type="button" class="evidence-transport-btn" id="evidence-swap-compare-btn" aria-label="Swap Before and After comparison order">
          🔄 Swap A↔B
        </button>
      </div>
      <div class="evidence-compare-grid">
        ${panes.map(renderPane).join('')}
      </div>
    `;
  }

  _bindEvidencePanelEvents(container, frames, keyframes) {
    // Mode tabs
    container.querySelectorAll('[data-evidence-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-evidence-mode');
        this.stopSequencePlayback();
        this.evidenceViewMode = mode;
        this.renderVisualEvidencePanel();
      });
    });

    // Phase pills
    container.querySelectorAll('[data-evidence-phase]').forEach(btn => {
      btn.addEventListener('click', () => {
        const phase = btn.getAttribute('data-evidence-phase');
        this.stopSequencePlayback();
        this.selectedPhase = phase;
        const targetKf = keyframes[phase];

        if (this.evidenceViewMode === 'sequence') {
          if (targetKf?.fallback_mode === 'NIGHT_TELEMETRY' || !targetKf?.image_url) {
            // Switch to keyframes view to show the Night Telemetry card for that dark phase
            this.evidenceViewMode = 'keyframes';
          } else if (targetKf?.timestamp && frames.length > 0) {
            const idx = this._findNearestSequenceIndex(frames, targetKf.timestamp);
            if (idx >= 0) this.sequenceIndex = idx;
          }
        }
        this.renderVisualEvidencePanel();
      });
    });

    // Scrubber range input
    const slider = container.querySelector('#evidence-scrubber-slider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        this.stopSequencePlayback();
        this.jumpToSequenceIndex(parseInt(e.target.value, 10));
      });
    }

    // Play / Pause button
    const playBtn = container.querySelector('#evidence-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        this.toggleSequencePlayback();
      });
    }

    // Prev / Next frame buttons
    const prevBtn = container.querySelector('#evidence-prev-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.stopSequencePlayback();
        this.stepFrame(-1);
      });
    }

    const nextBtn = container.querySelector('#evidence-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.stopSequencePlayback();
        this.stepFrame(1);
      });
    }

    // Speed buttons
    container.querySelectorAll('[data-playback-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const spd = parseInt(btn.getAttribute('data-playback-speed'), 10);
        this.playbackSpeed = spd === 2 ? 2 : 1;
        if (this.isPlaying) {
          this.stopSequencePlayback();
          this.startSequencePlayback();
        } else {
          this.renderVisualEvidencePanel();
        }
      });
    });

    // Compare Swap button
    const swapBtn = container.querySelector('#evidence-swap-compare-btn');
    if (swapBtn) {
      swapBtn.addEventListener('click', () => {
        this.compareSwapped = !this.compareSwapped;
        this.renderVisualEvidencePanel();
      });
    }

    // Dawn fallback button in Compare mode
    const dawnBtn = container.querySelector('#btn-use-dawn-compare');
    if (dawnBtn) {
      dawnBtn.addEventListener('click', () => {
        this.useDawnFallbackInCompare = true;
        this.renderVisualEvidencePanel();
      });
    }
  }

  /**
   * Steps forward or backward by `delta` frames
   */
  stepFrame(delta) {
    if (!this.activeEvent) return;
    const frames = this._getPlayableSequenceFrames(this.activeEvent);
    if (this.evidenceViewMode === 'sequence' && frames.length > 0) {
      const nextIdx = (this.sequenceIndex + delta + frames.length) % frames.length;
      this.jumpToSequenceIndex(nextIdx);
    } else if (this.evidenceViewMode === 'keyframes') {
      const keyframes = this._normalizeKeyframes(this.activeEvent);
      const order = ['start', 'peak', 'end'].filter(k => Boolean(keyframes[k]));
      if (order.length > 0) {
        const currIdx = Math.max(0, order.indexOf(this.selectedPhase));
        const nextPhase = order[(currIdx + delta + order.length) % order.length];
        this.selectedPhase = nextPhase;
        this.renderVisualEvidencePanel();
      }
    }
  }

  /**
   * Updates sequence index and refreshes viewport DOM in-place without losing slider focus
   */
  jumpToSequenceIndex(index) {
    if (!this.activeEvent) return;
    const frames = this._getPlayableSequenceFrames(this.activeEvent);
    if (frames.length === 0) return;

    this.sequenceIndex = Math.max(0, Math.min(frames.length - 1, index));
    const currentFrame = frames[this.sequenceIndex];

    if (!this.backdrop) return;
    const imgEl = this.backdrop.querySelector('#evidence-sequence-img');
    const counterEl = this.backdrop.querySelector('#evidence-live-counter');
    const sliderEl = this.backdrop.querySelector('#evidence-scrubber-slider');

    if (imgEl && currentFrame) {
      const frameTimeStr = formatShortGmt(currentFrame.timestamp);
      const assetName = ASSET_DISPLAY_NAMES[this.activeEvent.asset_id] || this.activeEvent.asset_id || 'Asset';
      imgEl.src = currentFrame.image_url;
      imgEl.alt = `${assetName} optical camera frame ${this.sequenceIndex + 1} of ${frames.length} captured at ${frameTimeStr}`;
      if (counterEl) {
        counterEl.textContent = `Frame ${this.sequenceIndex + 1} / ${frames.length} • ${frameTimeStr}`;
      }
      if (sliderEl && Number(sliderEl.value) !== this.sequenceIndex) {
        sliderEl.value = String(this.sequenceIndex);
      }
    } else {
      this.renderVisualEvidencePanel();
    }
  }

  toggleSequencePlayback() {
    if (this.isPlaying) {
      this.stopSequencePlayback();
      this.renderVisualEvidencePanel();
    } else {
      this.startSequencePlayback();
    }
  }

  startSequencePlayback() {
    if (!this.activeEvent) return;
    const frames = this._getPlayableSequenceFrames(this.activeEvent);
    if (frames.length <= 1) return;

    this.stopSequencePlayback();
    this.isPlaying = true;
    this.renderVisualEvidencePanel();

    const intervalMs = this.playbackSpeed === 2 ? 325 : 650;
    this.playbackTimer = setInterval(() => {
      if (!this.isOpen() || this.activeTab !== 'evidence') {
        this.stopSequencePlayback();
        return;
      }
      const nextIdx = (this.sequenceIndex + 1) % frames.length;
      this.jumpToSequenceIndex(nextIdx);
    }, intervalMs);
  }

  stopSequencePlayback() {
    this.isPlaying = false;
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  /**
   * Closes the modal, stops any active sequence timer, and restores focus
   */
  close() {
    this.stopSequencePlayback();
    if (typeof document === 'undefined') return;
    const backdrop = this.backdrop || document.getElementById(this.modalId);
    if (backdrop && backdrop.classList.contains('open')) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
      if (this.activeTriggerElement && typeof this.activeTriggerElement.focus === 'function') {
        try {
          this.activeTriggerElement.focus();
        } catch (e) {
          // Ignore focus errors
        }
      }
    }
  }

  /**
   * Initializes delegated click listener on both Field Guide and Visual Evidence trigger buttons
   */
  initTriggers(container = document) {
    if (typeof container === 'undefined' || !container.addEventListener) return;
    if (container._cameraModalTriggersBound) return;
    container._cameraModalTriggersBound = true;

    container.addEventListener('click', (e) => {
      const evidenceTrigger = e.target.closest('[data-visual-evidence-event-id], [data-visual-evidence-asset], .visual-evidence-trigger');
      if (evidenceTrigger) {
        e.preventDefault();
        const eventId = evidenceTrigger.getAttribute('data-visual-evidence-event-id');
        const assetId = evidenceTrigger.getAttribute('data-visual-evidence-asset');
        this.openVisualEvidence(eventId || assetId, evidenceTrigger);
        return;
      }

      const guideTrigger = e.target.closest('[data-camera-guide], .camera-guide-trigger');
      if (guideTrigger) {
        e.preventDefault();
        const siteKey = guideTrigger.getAttribute('data-camera-guide') || guideTrigger.dataset.cameraGuide;
        this.open(siteKey, guideTrigger);
      }
    });
  }

  isOpen() {
    return Boolean(this.backdrop && this.backdrop.classList.contains('open'));
  }

  destroy() {
    this.stopSequencePlayback();
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this._handleKeyDown);
    }
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
      this.backdrop = null;
    }
  }
}

function formatShortGmt(isoStr) {
  if (!isoStr) return 'N/A';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC'
  }) + ' GMT';
}

function formatTimeOnlyGmt(isoStr) {
  if (!isoStr) return '--:--';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }) + ' GMT';
}

/**
 * Only same-origin archived event frames are ever rendered as images.
 */
export function isValidEventImageUrl(url) {
  return typeof url === 'string' && /^\/api\/events\/\d+\/frames\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+\.jpe?g$/i.test(url);
}

function safeImageUrl(url) {
  return isValidEventImageUrl(url) ? url : null;
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function createCameraModal(options) {
  return new CameraModalController(options);
}
