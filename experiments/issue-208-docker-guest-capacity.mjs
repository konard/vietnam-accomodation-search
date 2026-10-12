// Opt-in real Linux daemon test of the same guest helper used by Desktop.
// Any newly acquired tiny image is journalled and removed by the existing
// exact-ownership ledger. This is not macOS Desktop or cutover acceptance.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { qaRecoveryDirectory, withQaCleanup } from './qa-cleanup.mjs';
import { dockerCommand, dockerInventory } from './qa-docker-cleanup.mjs';
import { prepareDockerCapacityProbe } from './qa-docker-capacity.mjs';
import {
  acquireQaStorageGuard,
  qaDockerStoragePaths,
} from './qa-storage-guard.mjs';
import { safeQaFailure } from './qa-docker-diagnostics.mjs';

assert.equal(process.env.QA_DOCKER_CAPACITY, '1');
const baseline = await dockerInventory();
let failure;
for (let attempt = 0; attempt < 2 && !failure; attempt += 1) {
  await withQaCleanup(async (scope, signal) => {
    const directory = await qaRecoveryDirectory(scope, 'vac-guest-capacity-');
    const lockDirectory = join(directory, 'heavy.lock');
    const paths = await qaDockerStoragePaths(dockerCommand);
    // Desktop supplies this hook itself. Linux explicitly exercises the same
    // guest bootstrap here, after real host preflight and before heavy work.
    paths.prepareCapacity ||= (scope, directory, signal) =>
      prepareDockerCapacityProbe(dockerCommand, scope, directory, signal, {});
    const guard = await acquireQaStorageGuard(scope, {
      paths,
      lockDirectory,
      signal,
    });
    await guard.check();
    console.log(
      JSON.stringify({
        realGuestMeasurement: true,
        preflightPassed: true,
        credentialsUnused: true,
        platform: process.platform,
        attempt: attempt + 1,
      })
    );
  }).catch((error) => {
    failure = error;
  });
  assert.deepEqual(await dockerInventory(), baseline);
  console.log(JSON.stringify({ dockerBaselinePreserved: true }));
}
if (failure) {
  if (process.env.QA_DOCKER_DEBUG_FILE) {
    await writeFile(
      process.env.QA_DOCKER_DEBUG_FILE,
      JSON.stringify({
        message: failure.message,
        stderr: failure.stderr,
        stdout: failure.stdout,
        stack: failure.stack,
      }),
      { mode: 0o600 }
    );
  }
  console.error(
    JSON.stringify({
      guestCapacityAcceptanceFailed: true,
      ...safeQaFailure(failure),
    })
  );
  process.exitCode = 1;
}
