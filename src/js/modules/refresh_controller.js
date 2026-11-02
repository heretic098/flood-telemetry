/**
 * Shared Auto-Refresh Controller Module
 * 
 * Manages 60-second telemetry countdown lifecycle, scrubbing-pause coordination,
 * tab visibility changes (document.hidden), and manual refresh button triggers.
 * 
 * Used across:
 * - src/js/app.js (Main Dashboard)
 * - src/js/roads.js (Road Network Passability)
 * - src/js/topology.js (River Topology Map)
 */

export class RefreshController {
  /**
   * @param {object} options
   * @param {number} [options.intervalMs=60000] - Refresh loop duration in milliseconds
   * @param {string} [options.countdownPillId='countdown-pill'] - DOM ID of countdown indicator
   * @param {string} [options.refreshBtnId='btn-refresh-now'] - DOM ID of manual refresh button
   * @param {() => Promise<void>} [options.onRefresh] - Async callback executing view reload
   * @param {() => boolean} [options.isUserInspectingFn] - Returns true if user is actively inspecting
   */
  constructor(options = {}) {
    this.intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : 60000;
    this.countdownPillId = options.countdownPillId || 'countdown-pill';
    this.refreshBtnId = options.refreshBtnId || 'btn-refresh-now';
    this.onRefresh = options.onRefresh || (async () => {});
    this.isUserInspectingFn = options.isUserInspectingFn || (() => false);

    this.timer = null;
    this.remainingSec = Math.max(1, Math.round(this.intervalMs / 1000));
    this.isRefreshing = false;
    this.isScrubbing = false;
    this.refreshDeferred = false;
    this.lastRefreshTime = Date.now();

    // Bind event handlers
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    this._handleManualBtnClick = this._handleManualBtnClick.bind(this);

    this._bindEvents();
  }

  _bindEvents() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._handleVisibilityChange);

      const btn = document.getElementById(this.refreshBtnId);
      if (btn) {
        btn.addEventListener('click', this._handleManualBtnClick);
      }
    }
  }

  _unbindEvents() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._handleVisibilityChange);

      const btn = document.getElementById(this.refreshBtnId);
      if (btn) {
        btn.removeEventListener('click', this._handleManualBtnClick);
      }
    }
  }

  _handleVisibilityChange() {
    if (typeof document === 'undefined') return;

    if (document.hidden) {
      // User switched away to another tab: pause active timer
      this.pause();
    } else {
      // User returned: resume timer and trigger immediate refresh if interval elapsed
      this.resume();
      const elapsed = Date.now() - this.lastRefreshTime;
      if (elapsed >= this.intervalMs) {
        this.triggerManualRefresh();
      }
    }
  }

  async _handleManualBtnClick() {
    await this.triggerManualRefresh();
  }

  /**
   * Sets whether the user is actively scrubbing a chart / map crosshair
   * @param {boolean} scrubbing
   */
  setScrubbing(scrubbing) {
    this.isScrubbing = Boolean(scrubbing);
    if (!this.isScrubbing && this.refreshDeferred) {
      this.refreshDeferred = false;
      this.triggerManualRefresh();
    } else {
      this.updateDisplay();
    }
  }

  /**
   * Updates the countdown pill DOM display
   */
  updateDisplay() {
    if (typeof document === 'undefined') return;
    const pill = document.getElementById(this.countdownPillId);
    if (!pill) return;

    const isInspecting = this.isScrubbing || this.isUserInspectingFn();

    if (this.isRefreshing) {
      pill.classList.add('refreshing', 'syncing');
      pill.innerText = '🔄 Refreshing...';
    } else if (isInspecting) {
      pill.classList.remove('refreshing', 'syncing');
      pill.innerText = `⏱️ ${this.remainingSec}s (Paused)`;
    } else {
      pill.classList.remove('refreshing', 'syncing');
      pill.innerText = `⏱️ ${this.remainingSec}s`;
    }
  }

  /**
   * Starts the 1-second interval auto-refresh countdown
   * @param {number} [intervalMs]
   */
  start(intervalMs) {
    this.stop();
    if (typeof intervalMs === 'number') {
      this.intervalMs = intervalMs;
    }
    this.remainingSec = Math.max(1, Math.round(this.intervalMs / 1000));
    this.updateDisplay();

    this.timer = setInterval(async () => {
      const isInspecting = this.isScrubbing || this.isUserInspectingFn();

      // If user is currently inspecting or scrubbing, defer refresh
      if (isInspecting) {
        this.refreshDeferred = true;
        this.updateDisplay();
        return;
      }

      if (this.remainingSec > 1) {
        this.remainingSec--;
        this.updateDisplay();
      } else {
        this.remainingSec = Math.max(1, Math.round(this.intervalMs / 1000));
        this.updateDisplay();
        await this.triggerManualRefresh();
      }
    }, 1000);
  }

  /**
   * Pauses the countdown timer
   */
  pause() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.updateDisplay();
  }

  /**
   * Resumes countdown timer if currently stopped
   */
  resume() {
    if (!this.timer) {
      this.start(this.intervalMs);
    }
  }

  /**
   * Stops countdown timer and resets remaining time
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Triggers an immediate refresh cycle
   */
  async triggerManualRefresh() {
    if (this.isRefreshing) return;

    this.isRefreshing = true;
    this.remainingSec = Math.max(1, Math.round(this.intervalMs / 1000));
    this.updateDisplay();

    const btn = (typeof document !== 'undefined') ? document.getElementById(this.refreshBtnId) : null;
    if (btn) btn.setAttribute('aria-busy', 'true');

    try {
      await this.onRefresh();
      this.lastRefreshTime = Date.now();
    } catch (err) {
      console.warn('[RefreshController] Refresh callback error:', err);
    } finally {
      this.isRefreshing = false;
      if (btn) btn.setAttribute('aria-busy', 'false');
      this.updateDisplay();
    }
  }

  /**
   * Returns current operational state
   */
  getState() {
    const isInspecting = this.isScrubbing || this.isUserInspectingFn();
    return {
      isRunning: this.timer !== null,
      intervalMs: this.intervalMs,
      remainingSec: this.remainingSec,
      isRefreshing: this.isRefreshing,
      isUserInspecting: isInspecting,
      refreshDeferred: this.refreshDeferred
    };
  }

  /**
   * Teardown listeners and intervals
   */
  destroy() {
    this.stop();
    this._unbindEvents();
  }
}

/**
 * Factory helper
 */
export function createRefreshController(options) {
  return new RefreshController(options);
}
