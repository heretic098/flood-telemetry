import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RefreshController,
  createRefreshController
} from '../src/js/modules/refresh_controller.js';

test('RefreshController: instantiates with expected initial state and defaults', () => {
  let refreshCount = 0;
  const ctrl = createRefreshController({
    intervalMs: 30000,
    onRefresh: async () => { refreshCount++; }
  });

  const state = ctrl.getState();
  assert.equal(state.isRunning, false);
  assert.equal(state.intervalMs, 30000);
  assert.equal(state.remainingSec, 30);
  assert.equal(state.isRefreshing, false);
  assert.equal(state.isUserInspecting, false);
  assert.equal(state.refreshDeferred, false);

  ctrl.destroy();
});

test('RefreshController: start, stop, pause, and resume control execution state', () => {
  const ctrl = new RefreshController({ intervalMs: 45000 });

  ctrl.start();
  assert.equal(ctrl.getState().isRunning, true);
  assert.equal(ctrl.getState().remainingSec, 45);

  ctrl.pause();
  assert.equal(ctrl.getState().isRunning, false);

  ctrl.resume();
  assert.equal(ctrl.getState().isRunning, true);

  ctrl.stop();
  assert.equal(ctrl.getState().isRunning, false);

  ctrl.destroy();
});

test('RefreshController: manual refresh triggers callback and resets remaining seconds', async () => {
  let refreshed = false;
  const ctrl = new RefreshController({
    intervalMs: 60000,
    onRefresh: async () => {
      refreshed = true;
    }
  });

  ctrl.remainingSec = 12; // simulated elapsed time
  await ctrl.triggerManualRefresh();

  assert.equal(refreshed, true);
  assert.equal(ctrl.remainingSec, 60);

  ctrl.destroy();
});

test('RefreshController: setScrubbing defers refresh and triggers upon release', async () => {
  let refreshCount = 0;
  const ctrl = new RefreshController({
    intervalMs: 60000,
    onRefresh: async () => { refreshCount++; }
  });

  ctrl.setScrubbing(true);
  assert.equal(ctrl.getState().isUserInspecting, true);

  // Simulate deferred state
  ctrl.refreshDeferred = true;

  // Release scrubbing
  ctrl.setScrubbing(false);
  assert.equal(ctrl.getState().isUserInspecting, false);
  assert.equal(ctrl.getState().refreshDeferred, false);
  assert.equal(refreshCount, 1);

  ctrl.destroy();
});

test('RefreshController: destroy stops timer and cleans up', () => {
  const ctrl = new RefreshController({ intervalMs: 10000 });
  ctrl.start();
  assert.equal(ctrl.getState().isRunning, true);

  ctrl.destroy();
  assert.equal(ctrl.getState().isRunning, false);
});
