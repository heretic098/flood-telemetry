/**
 * Contextual Plain-English Jargon Popovers Module
 * 
 * Provides accessible, zero-dependency explanatory popovers for laypersons
 * on Somerset hydraulic engineering terminology (mAOD, KSD, Clyse, Penning).
 * 
 * Invariants:
 * - [RULE-HUM-01] Epistemic humility & plain language
 * - [RULE-SUB-01] Empirical substantiation (only assert what sensors measure)
 * - [RULE-CALC-01] Governed strictly by Stage and Clearance (no cumecs)
 * - [UI-ACC-01] WCAG 2.1 AA & APCA contrast compliance (Lc >= 90)
 */

export const JARGON_DEFINITIONS = {
  mAOD: {
    term: 'mAOD',
    title: 'Metres Above Ordnance Datum (mAOD)',
    definition: 'Metres Above Ordnance Datum. Height relative to mean sea level at Newlyn. Not depth over the ground — ground levels here are ~2m to 4m AOD, so 5m AOD is within normal river banks.'
  },
  KSD: {
    term: 'KSD',
    title: "King's Sedgemoor Drain (KSD)",
    definition: "King's Sedgemoor Drain. An engineered 18km relief channel carrying diverted floodwater from the Parrett at Monk's Leaze Clyse directly out to sea at Dunball."
  },
  Clyse: {
    term: 'Clyse',
    title: 'Clyse (Somerset Sluice / Outfall)',
    definition: 'Somerset term for a sluice gate or gravity outfall structure with penstocks or tidal flap doors.'
  },
  Penning: {
    term: 'Penning',
    title: 'Penning (Seasonal Water Level Management)',
    definition: 'Routine seasonal water retention. In summer and autumn, gates hold water in rhynes for livestock drinking and wetland ecology, distinct from winter flood evacuation.'
  }
};

/**
 * Escapes attribute values for secure HTML injection.
 */
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generates an accessible jargon term trigger element.
 * 
 * @param {string} termKey - One of 'mAOD', 'KSD', 'Clyse', 'Penning'
 * @param {string} [displayText] - Optional custom display label
 * @returns {string} HTML string
 */
export function renderJargonTerm(termKey, displayText) {
  const def = JARGON_DEFINITIONS[termKey];
  const label = displayText !== undefined ? displayText : (def ? def.term : termKey);
  const key = def ? termKey : (JARGON_DEFINITIONS[termKey.trim()] ? termKey.trim() : 'mAOD');
  return `<span class="jargon-term" tabindex="0" role="button" aria-haspopup="dialog" aria-expanded="false" data-term="${escapeAttr(key)}">${escapeAttr(label)} <span class="jargon-help-icon" aria-hidden="true">?</span></span>`;
}

let activeTrigger = null;
let popoverElem = null;
let listenersInitialized = false;

/**
 * Retrieves or creates the single floating popover element in DOM.
 */
export function getOrCreatePopoverElement() {
  if (typeof document === 'undefined') return null;
  if (popoverElem && document.body.contains(popoverElem)) {
    return popoverElem;
  }

  popoverElem = document.getElementById('jargon-popover');
  if (!popoverElem) {
    popoverElem = document.createElement('div');
    popoverElem.id = 'jargon-popover';
    popoverElem.className = 'jargon-popover hidden';
    popoverElem.setAttribute('role', 'dialog');
    popoverElem.setAttribute('aria-modal', 'false');
    popoverElem.setAttribute('aria-labelledby', 'jargon-popover-title');
    popoverElem.setAttribute('tabindex', '-1');

    popoverElem.innerHTML = `
      <div class="jargon-popover-header">
        <h4 class="jargon-popover-title" id="jargon-popover-title"></h4>
        <button type="button" class="jargon-popover-close" id="jargon-popover-close" aria-label="Close jargon definition">✕</button>
      </div>
      <div class="jargon-popover-body" id="jargon-popover-body"></div>
    `;

    document.body.appendChild(popoverElem);

    const closeBtn = popoverElem.querySelector('#jargon-popover-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActiveJargonPopover();
      });
    }
  }

  return popoverElem;
}

/**
 * Positions the popover relative to the trigger element, clamping to viewport edges.
 */
export function positionPopover(trigger, popover) {
  if (!trigger || !popover || typeof window === 'undefined') return;

  const triggerRect = trigger.getBoundingClientRect();
  const popoverWidth = Math.min(320, window.innerWidth - 24);
  popover.style.width = `${popoverWidth}px`;

  // Horizontal alignment centered on trigger, clamped inside viewport margins
  let left = triggerRect.left + (triggerRect.width / 2) - (popoverWidth / 2);
  left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));

  // Determine vertical height
  const popoverHeight = popover.offsetHeight || 130;

  // Space below vs above
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;

  let top;
  if (spaceBelow < (popoverHeight + 16) && spaceAbove > (popoverHeight + 16)) {
    // Render above trigger
    top = triggerRect.top - popoverHeight - 8;
  } else {
    // Render below trigger
    top = triggerRect.bottom + 8;
  }

  // Clamp vertical position
  top = Math.max(8, Math.min(top, window.innerHeight - popoverHeight - 8));

  popover.style.position = 'fixed';
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

/**
 * Opens popover for a specified trigger element.
 */
export function openJargonPopover(trigger) {
  if (!trigger) return;
  const termKey = trigger.getAttribute('data-term');
  const def = JARGON_DEFINITIONS[termKey];
  if (!def) return;

  if (activeTrigger && activeTrigger !== trigger) {
    activeTrigger.setAttribute('aria-expanded', 'false');
  }

  const popover = getOrCreatePopoverElement();
  if (!popover) return;

  const titleElem = popover.querySelector('#jargon-popover-title');
  const bodyElem = popover.querySelector('#jargon-popover-body');

  if (titleElem) titleElem.textContent = def.title;
  if (bodyElem) bodyElem.textContent = def.definition;

  trigger.setAttribute('aria-expanded', 'true');
  activeTrigger = trigger;

  popover.classList.remove('hidden');
  popover.classList.add('visible');

  positionPopover(trigger, popover);
}

/**
 * Closes the active jargon popover and resets aria attributes.
 */
export function closeActiveJargonPopover() {
  if (popoverElem) {
    popoverElem.classList.remove('visible');
    popoverElem.classList.add('hidden');
  }
  if (activeTrigger) {
    activeTrigger.setAttribute('aria-expanded', 'false');
    if (popoverElem && popoverElem.contains(document.activeElement)) {
      activeTrigger.focus();
    }
    activeTrigger = null;
  }
}

/**
 * Toggles a jargon popover on trigger activation.
 */
export function toggleJargonPopover(trigger) {
  if (activeTrigger === trigger) {
    closeActiveJargonPopover();
  } else {
    openJargonPopover(trigger);
  }
}

/**
 * Initializes global event delegation listeners for jargon popovers.
 */
export function initJargonPopovers() {
  if (typeof document === 'undefined' || listenersInitialized) return;
  listenersInitialized = true;

  getOrCreatePopoverElement();

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.jargon-term');
    if (trigger) {
      e.preventDefault();
      toggleJargonPopover(trigger);
      return;
    }

    const popover = e.target.closest('#jargon-popover');
    if (!popover && activeTrigger) {
      closeActiveJargonPopover();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (activeTrigger) {
        e.preventDefault();
        closeActiveJargonPopover();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      const trigger = e.target.closest('.jargon-term');
      if (trigger) {
        e.preventDefault();
        toggleJargonPopover(trigger);
      }
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      if (activeTrigger && popoverElem && popoverElem.classList.contains('visible')) {
        positionPopover(activeTrigger, popoverElem);
      }
    });

    window.addEventListener('scroll', () => {
      if (activeTrigger && popoverElem && popoverElem.classList.contains('visible')) {
        positionPopover(activeTrigger, popoverElem);
      }
    }, { passive: true });
  }
}
