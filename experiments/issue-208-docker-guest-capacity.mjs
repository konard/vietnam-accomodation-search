// Opt-in real Linux daemon test of the same guest helper used by Desktop.
// Any newly acquired tiny image is journalled and removed by the existing
// exact-ownership ledger. This is not macOS Desktop or cutover acceptance.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { withQaCleanup } from './qa-cleanup.mjs';
import {
  QaDockerCleanup,
  dockerCommand,
  dockerInventory,
} from './qa-docker-cleanup.mjs';
import { prepareDockerCapacityProbe } from './qa-docker-capacity.mjs';
import {
  acquireQaStorageGuard,
  qaDockerStoragePaths,
  QA_DISK_PREFLIGHT_BYTES,
} from './qa-storage-guard.mjs';
import { safeQaFailure } from './qa-docker-diagnostics.mjs';

assert.equal(process.env.QA_DOCKER_CAPACITY, '1');
const baseline = await dockerInventory();
let failure;
await withQaCleanup(async (scope, signal) => {
  const directory = await mkdtemp(join(tmpdir(), 'vac-guest-capacity-'));
  scope.defer('capacity acceptance directory', () =>
    scope.cleanupFailed ? undefined : rm(directory, { recursive: true })
  );
  const lockDirectory = join(directory, 'heavy.lock');
  const guard = await acquireQaStorageGuard(scope, {
    paths: await qaDockerStoragePaths(dockerCommand),
    lockDirectory,
    signal,
  });
  const ownership = new QaDockerCleanup({
    baseline,
    runId: `vac-qa-capacity-${randomBytes(8).toString('hex')}`,
    journal: join(directory, 'images.json'),
  });
  scope.defer('owned acceptance image', async () => {
    assert((await ownership.cleanup()).pass);
  });
  const ref = 'busybox:1.37.0';
  if (!baseline.images.some((row) => row.endsWith(` ${ref}`))) {
    ownership.ownImage(ref);
    await ownership.save();
    await dockerCommand(['pull', ref], { signal: guard.signal });
  }
  const capacity = await prepareDockerCapacityProbe(
    dockerCommand,
    scope,
    lockDirectory,
    guard.signal,
    { QA_DOCKER_CAPACITY_IMAGE: ref }
  );
  assert(
    (await capacity(5000, guard.signal)) >= BigInt(QA_DISK_PREFLIGHT_BYTES)
  );
  await guard.check();
  console.log(
    JSON.stringify({
      realGuestMeasurement: true,
      preflightPassed: true,
      credentialsUnused: true,
      platform: process.platform,
    })
  );
}).catch((error) => {
  failure = error;
});
assert.deepEqual(await dockerInventory(), baseline);
console.log(JSON.stringify({ dockerBaselinePreserved: true }));
if (failure) {
  console.error(
    JSON.stringify({
      guestCapacityAcceptanceFailed: true,
      ...safeQaFailure(failure),
    })
  );
  process.exitCode = 1;
}
