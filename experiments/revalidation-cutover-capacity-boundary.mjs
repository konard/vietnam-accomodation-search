// Self-authored no-network control of the actual cutover preflight ordering.
import assert from 'node:assert/strict';
import { acquireDrillStorageGuard } from './qa-cutover-preflight.mjs';
import { withQaCleanup } from './qa-cleanup.mjs';

const containers = [];
const inventory = () => Promise.resolve({ containers: [...containers] });
await withQaCleanup(async (scope, signal) => {
  const { boundary } = await acquireDrillStorageGuard(
    { allowSharedToken: true },
    scope,
    signal,
    {
      inventory,
      storagePaths: () => Promise.resolve([]),
      acquireGuard: (scope) => {
        containers.push('self-authored-run-owned-capacity-helper');
        scope.defer('owned capacity helper', () => containers.pop());
        return { signal };
      },
    }
  );
  assert.deepEqual(boundary.containers, []);
  assert.equal(containers.length, 1);
});
assert.deepEqual(containers, []);
console.log(
  JSON.stringify({
    selfAuthoredOnly: true,
    helperMistakenForPreexistingContainer: false,
    independentBaselineRestored: true,
  })
);
