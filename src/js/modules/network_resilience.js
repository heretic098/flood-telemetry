/**
 * Shared Network Resilience & Offline Banner Controller
 * 
 * Manages sticky network status banner, online/offline browser events,
 * deferred re-sync during chart scrubbing, and silent background reconnect polling.
 * 
 * Used across:
 * - src/js/app.js (Overview)
 * - src/js/roads.js (Roads & Access)
 * - src/js/topology.js (River Topology Map)
 */

export class NetworkResilienceController {
  /**
   * @param {object} options
   * @param {string} [options.bannerId='network-offline-banner'] - DOM element ID for offline banner
   * @param {() => Promise<void>} [options.onOnline] - Callback invoked when connection is restored
   * @param {() => Date|null} [options.getLastSyncTime] - Callback returning timestamp of last valid sync
   * @param {() => boolean} [options.isScrubbingFn] - Returns true if user is actively interacting with charts
   * @param {string} [options.pingEndpoint='/api/health'] - Lightweight endpoint to verify connectivity
   * @param {number} [options.pollIntervalMs=15000] - Interval for silent background reconnect checks
   */
  constructor(options = {}) {
    this.bannerId = options.bannerId || 'network-offline-banner';
    this.onOnline = options.onOnline || (async () => {});
    this.getLastSyncTime = options.getLastSyncTime || (() => null);
    this.isScrubbingFn = options.isScrubbingFn || (() => false);
    this.pingEndpoint = options.pingEndpoint || '/api/health';
    this.pollIntervalMs = typeof options.pollIntervalMs === 'number' ? options.pollIntervalMs : 15000;

    this.pollTimer = null;
    this.dismissTimer = null;
    this.refreshDeferred = false;
    this._isOnline = (typeof navigator !== 'undefined') ? navigator.onLine : true;

    this.handleOffline = this.handleOffline.bind(this);
    this.handleOnline = this.handleOnline.bind(this);
  }

  /**
   * Initializes listeners and displays offline banner if starting offline
   */
  init() {
    if (typeof window === 'undefined') return;

    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('online', this.handleOnline);

    if (!navigator.onLine) {
      this.handleOffline();
    }
  }

  /**
   * Handles offline transition
   */
  handleOffline() {
    this._isOnline = false;
    if (typeof document === 'undefined') return;

    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    const banner = document.getElementById(this.bannerId);
    if (banner) {
      const lastSync = this.getLastSyncTime();
      const timeStr = lastSync instanceof Date
        ? lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : (typeof lastSync === 'string' ? lastSync : '--:--');

      banner.textContent = `⚠️ Network Disconnected — Displaying cached data from ${timeStr}`;
      banner.className = 'network-offline-banner offline';
      banner.style.display = 'block';
    }

    this._startReconnectPolling();
  }

  /**
   * Handles online restoration
   */
  async handleOnline() {
    this._isOnline = true;
    this._stopReconnectPolling();

    if (typeof document !== 'undefined') {
      const banner = document.getElementById(this.bannerId);
      if (banner) {
        banner.textContent = '✅ Connection Restored — Refreshing data...';
        banner.className = 'network-offline-banner online';
        banner.style.display = 'block';

        if (this.dismissTimer) clearTimeout(this.dismissTimer);
        this.dismissTimer = setTimeout(() => {
          banner.style.display = 'none';
          this.dismissTimer = null;
        }, 2500);
      }
    }

    // If user is currently scrubbing, defer the view refresh
    if (this.isScrubbingFn()) {
      this.refreshDeferred = true;
      return;
    }

    try {
      await this.onOnline();
    } catch (err) {
      console.warn('[NetworkResilience] onOnline callback error:', err);
    }
  }

  /**
   * Signals scrubbing status. If scrubbing ends and a refresh was deferred, executes it.
   */
  setScrubbing(scrubbing) {
    if (!scrubbing && this.refreshDeferred && this._isOnline) {
      this.refreshDeferred = false;
      this.onOnline().catch(e => console.warn('[NetworkResilience] Deferred refresh error:', e));
    }
  }

  /**
   * Silent background polling during offline state
   */
  _startReconnectPolling() {
    this._stopReconnectPolling();
    if (typeof fetch === 'undefined') return;

    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(this.pingEndpoint, { method: 'HEAD', cache: 'no-store' });
        if (res.ok && !this._isOnline) {
          // Silent reconnect detected prior to browser online event
          await this.handleOnline();
        }
      } catch (e) {
        // Still offline; silently continue polling
      }
    }, this.pollIntervalMs);
  }

  _stopReconnectPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Teardown and unbind
   */
  destroy() {
    this._stopReconnectPolling();
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', this.handleOffline);
      window.removeEventListener('online', this.handleOnline);
    }
  }

  isOnline() {
    return this._isOnline;
  }
}

/**
 * Convenience helper matching legacy setupOfflineBanner signature
 */
export function setupOfflineBanner(options = {}) {
  const ctrl = new NetworkResilienceController(options);
  ctrl.init();
  return ctrl;
}
