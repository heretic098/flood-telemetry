/**
 * Shared Accessible Camera Modal & Disambiguation Drawer Controller
 * 
 * Provides layperson guidance and optical ground-truth field-of-view fidelity (per [RULE-CAM-01])
 * for third-party community webcams hosted by thecfh.org and the Environment Agency.
 * 
 * Invariants:
 * - [RULE-CAM-01]: Optical Camera Ground-Truth Invariant (Field-of-View Fidelity).
 *   Strictly describe what camera lenses physically capture (weir crests, carriageways,
 *   staff gauges, pump discharge plumes). Never claim optical verification of internal
 *   submerged sluice gates, penstocks, pump impellers, or council gate padlocks.
 * - WCAG 2.1 AA Accessibility: role="dialog", aria-modal="true", keyboard focus trapping,
 *   Escape dismissal, and focus return to trigger element.
 */

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

    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleBackdropClick = this._handleBackdropClick.bind(this);
    this.close = this.close.bind(this);
  }

  /**
   * Normalizes arbitrary site strings to canonical guide keys
   */
  normalizeSiteKey(siteKey) {
    if (!siteKey || typeof siteKey !== 'string') return this.defaultSiteKey;
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
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = this.modalId;
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

    const closeBtn = backdrop.querySelector('#camera-guide-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', this.close);
    }

    backdrop.addEventListener('click', this._handleBackdropClick);
    document.addEventListener('keydown', this._handleKeyDown);

    document.body.appendChild(backdrop);
    this.backdrop = backdrop;
    return backdrop;
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

    if (e.key === 'Tab') {
      const focusableEls = this.backdrop.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
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
   * Opens modal for a designated camera site
   * @param {string} siteKey
   * @param {HTMLElement} [triggerEl=null]
   */
  open(siteKey, triggerEl = null) {
    if (typeof document === 'undefined') return;

    const normalizedKey = this.normalizeSiteKey(siteKey);
    const guide = this.fieldGuides[normalizedKey] || this.fieldGuides[this.defaultSiteKey] || {
      title: 'Camera Field Guide',
      subtitle: 'Optical Ground-Truth Verification',
      cfhUrl: 'https://thecfh.org',
      questions: [],
      checklist: []
    };

    this.activeTriggerElement = triggerEl || (typeof document.activeElement !== 'undefined' ? document.activeElement : null);

    const backdrop = this.getOrCreateModalDOM();
    if (!backdrop) return;

    // Populate dialog content
    const titleEl = backdrop.querySelector('#camera-guide-title');
    const subtitleEl = backdrop.querySelector('#camera-guide-subtitle');
    const questionsListEl = backdrop.querySelector('#camera-guide-questions');
    const checklistEl = backdrop.querySelector('#camera-guide-checklist');
    const ctaBtn = backdrop.querySelector('#camera-guide-cta-btn');

    if (titleEl) titleEl.textContent = guide.title;
    if (subtitleEl) subtitleEl.textContent = guide.subtitle;

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
            <span class="guide-box-label">⚠️ Physical Limitations [RULE-CAM-01]:</span>
            <p>${escapeHTML(item.physicalLimitation)}</p>
          </div>
        </div>
      `).join('');
    }

    if (ctaBtn) {
      ctaBtn.href = guide.cfhUrl || 'https://thecfh.org';
      ctaBtn.innerHTML = `Open Live Feeds on thecfh.org ↗ <span class="sr-only">(opens external link to ${guide.title})</span>`;
    }

    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');

    const closeBtn = backdrop.querySelector('#camera-guide-close');
    if (closeBtn) closeBtn.focus();
  }

  /**
   * Closes the modal and restores focus
   */
  close() {
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
   * Initializes delegated click listener on trigger buttons
   */
  initTriggers(container = document) {
    if (typeof container === 'undefined' || !container.addEventListener) return;

    container.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-camera-guide], .camera-guide-trigger');
      if (trigger) {
        e.preventDefault();
        const siteKey = trigger.getAttribute('data-camera-guide') || trigger.dataset.cameraGuide;
        this.open(siteKey, trigger);
      }
    });
  }

  isOpen() {
    return Boolean(this.backdrop && this.backdrop.classList.contains('open'));
  }

  destroy() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this._handleKeyDown);
    }
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
      this.backdrop = null;
    }
  }
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

export function createCameraModal(options) {
  return new CameraModalController(options);
}
