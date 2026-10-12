import assert from 'node:assert/strict';
import { assertQaSharedTokenBoundary } from './deploy-cutover-drill-lib.mjs';
import { dockerCommand, dockerInventory } from './qa-docker-cleanup.mjs';
import {
  acquireQaStorageGuard,
  qaDockerStoragePaths,
} from './qa-storage-guard.mjs';

// The token boundary precedes all run-owned helpers. Docker ledgers created
// later still take their own post-helper baseline, while this independent
// audit runs last, after the guard releases its helper, images and lock.
export async function acquireDrillStorageGuard(
  options,
  scope,
  signal,
  {
    inventory = dockerInventory,
    storagePaths = () => qaDockerStoragePaths(dockerCommand),
    acquireGuard = acquireQaStorageGuard,
  } = {}
) {
  signal?.throwIfAborted();
  const boundary = await inventory();
  assertQaSharedTokenBoundary(options, boundary);
  scope.defer('cutover Docker baseline', async () => {
    assert.deepEqual(await inventory(), boundary);
  });
  const guard = await acquireGuard(scope, {
    signal,
    paths: await storagePaths(),
  });
  return { boundary, guard };
}
