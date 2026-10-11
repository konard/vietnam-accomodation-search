// Manual no-credential acceptance of the host/daemon capacity boundary.
// A healthy local Docker Desktop daemon must not be mistaken for unreadable
// storage merely because its Linux root is not a macOS host filesystem path.
import assert from 'node:assert/strict';
import { statfs } from 'node:fs/promises';
import { dockerCommand, dockerInventory } from './qa-docker-cleanup.mjs';
import {
  acquireQaStorageGuard,
  qaDockerStoragePaths,
} from './qa-storage-guard.mjs';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';
import { join } from 'node:path';

assert.equal(process.env.QA_DOCKER_CAPACITY, '1');
const baseline = await dockerInventory();
let accepted = false;
let failureCode;
await withQaCleanup(async (scope, signal) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-desktop-capacity-');
  const paths = await qaDockerStoragePaths(dockerCommand);
  const daemonRoot = (
    await dockerCommand(['info', '--format', '{{.DockerRootDir}}'])
  ).trim();
  const daemonRootReadableOnHost = await statfs(daemonRoot).then(
    () => true,
    () => false
  );
  try {
    await acquireQaStorageGuard(scope, {
      paths,
      signal,
      lockDirectory: join(directory, 'heavy.lock'),
    });
    accepted = true;
  } catch (error) {
    failureCode = ['QA_DISK_PREFLIGHT', 'QA_CAPACITY_UNAVAILABLE'].includes(
      error.code
    )
      ? error.code
      : 'unknown';
  }
  console.log(
    JSON.stringify({
      healthyDaemon: true,
      daemonRootReadableOnHost,
      capacityGuardAccepted: accepted,
      failureCode,
      noBuildStarted: true,
    })
  );
});
assert.deepEqual(await dockerInventory(), baseline);
console.log(JSON.stringify({ dockerBaselinePreserved: true }));
assert(accepted, 'Healthy Docker Desktop capacity acceptance remains blocked.');
