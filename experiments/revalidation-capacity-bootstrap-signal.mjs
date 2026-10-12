// Self-authored finite daemon plus actual process signals; no Docker/network.
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withQaCleanup } from './qa-cleanup.mjs';
import { acquireQaStorageGuard } from './qa-storage-guard.mjs';
import { prepareDockerCapacityProbe } from './qa-docker-capacity.mjs';
import { capacityBootstrapDaemon } from './qa-capacity-bootstrap-fixture.mjs';

const root = await mkdtemp(join(tmpdir(), 'vac-bootstrap-signal-'));
const lock = join(root, 'heavy.lock');
let producerSettled = false;
const state = capacityBootstrapDaemon(lock, {
  onPull: async (signal) => {
    process.send('bootstrap-acquired');
    await new Promise((resolve) =>
      signal.addEventListener('abort', resolve, { once: true })
    );
    producerSettled = true;
    signal.throwIfAborted();
  },
});
process.once('message', (signal) => process.emit(signal));
try {
  const paths = [root];
  paths.prepareCapacity = (scope, directory, signal) =>
    prepareDockerCapacityProbe(state.run, scope, directory, signal, {});
  await assert.rejects(
    withQaCleanup((scope, signal) =>
      acquireQaStorageGuard(scope, {
        paths,
        signal,
        lockDirectory: lock,
        statfsImpl: () =>
          Promise.resolve({ bavail: 20n * 1024n ** 3n, bsize: 1n }),
      })
    )
  );
  assert(producerSettled);
  assert.equal(state.images.size, 0);
  assert.equal(state.owned(), false);
  await assert.rejects(stat(lock), { code: 'ENOENT' });
} finally {
  if (process.connected) {
    process.disconnect();
  }
  await rm(root, { recursive: true, force: true });
}
