import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NetworkResilienceController,
  setupOfflineBanner
} from '../src/js/modules/network_resilience.js';

test('NetworkResilienceController: instantiates with expected defaults', () => {
  const ctrl = new NetworkResilienceController({
    bannerId: 'network-offline-banner',
    pollIntervalMs: 10000
  });

  assert.equal(ctrl.bannerId, 'network-offline-banner');
  assert.equal(ctrl.pollIntervalMs, 10000);
  assert.equal(ctrl.isOnline(), true);

  ctrl.destroy();
});

test('NetworkResilienceController: handleOnline invokes callback when not scrubbing', async () => {
  let onlineInvoked = false;
  const ctrl = new NetworkResilienceController({
    onOnline: async () => {
      onlineInvoked = true;
    }
  });

  await ctrl.handleOnline();
  assert.equal(onlineInvoked, true);
  assert.equal(ctrl.isOnline(), true);

  ctrl.destroy();
});

test('NetworkResilienceController: defers refresh if user is actively scrubbing', async () => {
  let onlineInvoked = false;
  const ctrl = new NetworkResilienceController({
    onOnline: async () => {
      onlineInvoked = true;
    },
    isScrubbingFn: () => true // user is scrubbing!
  });

  await ctrl.handleOnline();
  assert.equal(onlineInvoked, false); // deferred!
  assert.equal(ctrl.refreshDeferred, true);

  // When user stops scrubbing:
  ctrl.setScrubbing(false);
  assert.equal(ctrl.refreshDeferred, false);

  ctrl.destroy();
});

test('NetworkResilienceController: destroy stops polling intervals cleanly', () => {
  const ctrl = new NetworkResilienceController({ pollIntervalMs: 5000 });
  ctrl._startReconnectPolling();
  assert.ok(ctrl.pollTimer !== null);

  ctrl.destroy();
  assert.equal(ctrl.pollTimer, null);
});
