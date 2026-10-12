import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { waitForRuntimeReadiness } from '../experiments/qa-runtime-readiness.mjs';
describe('bounded runtime readiness', () => {
  it('terminates after failed startup, a never-ready runtime, or cancellation', async () => {
    await assert.rejects(
      waitForRuntimeReadiness({
        runtime: () => undefined,
        running: Promise.reject(new Error('health bind failed')),
      }),
      /health bind failed/u
    );
    await assert.rejects(
      waitForRuntimeReadiness({
        runtime: () => ({ health: () => ({ status: 'starting' }) }),
        running: new Promise(() => {}),
        timeoutMs: 20,
      }),
      /deadline/u
    );
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await assert.rejects(
      waitForRuntimeReadiness({
        runtime: () => undefined,
        running: new Promise(() => {}),
        signal: controller.signal,
      }),
      /cancelled/u
    );
    const ready = { health: () => ({ status: 'ready' }) };
    assert.equal(
      await waitForRuntimeReadiness({
        runtime: () => ready,
        running: new Promise(() => {}),
      }),
      ready
    );
  });
});
