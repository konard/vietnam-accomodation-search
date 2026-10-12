import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as preflight from '../experiments/qa-cutover-preflight.mjs';
import { withQaCleanup } from '../experiments/qa-cleanup.mjs';
import { dockerInventory } from '../experiments/qa-docker-cleanup.mjs';
import { acquireQaStorageGuard } from '../experiments/qa-storage-guard.mjs';
import { prepareDockerCapacityProbe } from '../experiments/qa-docker-capacity.mjs';
import { capacityBootstrapDaemon } from '../experiments/qa-capacity-bootstrap-fixture.mjs';

it('checks the independent token boundary before capacity acquisition and verifies the whole baseline after cleanup', async () => {
  const containers = [];
  const events = [];
  await withQaCleanup(
    async (scope, signal) => {
      const result = await preflight.acquireDrillStorageGuard(
        { allowSharedToken: true },
        scope,
        signal,
        {
          inventory: async () => {
            events.push('inventory');
            return { containers: [...containers] };
          },
          storagePaths: async () => [],
          acquireGuard: (scope) => {
            events.push('guard');
            containers.push('exact-run-owned-helper');
            scope.defer('owned helper', () => {
              events.push('helper-cleanup');
              containers.pop();
            });
            return { signal };
          },
        }
      );
      assert.deepEqual(result.boundary.containers, []);
      assert.deepEqual(containers, ['exact-run-owned-helper']);
    },
    { signals: false }
  );
  assert.deepEqual(events, [
    'inventory',
    'guard',
    'helper-cleanup',
    'inventory',
  ]);
});

it('permits the actual guarded helper bootstrap and restores containers, images and lock before final inventory', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'vac-cutover-guard-test-'));
  const lockDirectory = join(root, 'heavy.lock');
  const daemon = capacityBootstrapDaemon(lockDirectory);
  try {
    await withQaCleanup(
      async (scope, signal) => {
        const { boundary, guard } = await preflight.acquireDrillStorageGuard(
          { allowSharedToken: true },
          scope,
          signal,
          {
            inventory: () => dockerInventory(daemon.run),
            storagePaths: async () => {
              const paths = [root];
              paths.prepareCapacity = (scope, lock, signal) =>
                prepareDockerCapacityProbe(daemon.run, scope, lock, signal, {});
              return paths;
            },
            acquireGuard: (scope, options) =>
              acquireQaStorageGuard(scope, {
                ...options,
                lockDirectory,
                statfsImpl: async () => ({
                  bavail: 20n * 1024n ** 3n,
                  bsize: 1n,
                }),
              }),
          }
        );
        assert.deepEqual(boundary.containers, []);
        const afterAcquisition = await dockerInventory(daemon.run);
        assert.deepEqual(afterAcquisition.containers, ['owned-fixture']);
        assert.equal(afterAcquisition.images.length, 1);
        await guard.check();
      },
      { signals: false }
    );
    assert.deepEqual((await dockerInventory(daemon.run)).containers, []);
    assert.equal(daemon.images.size, 0);
    await assert.rejects(stat(lockDirectory), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects every pre-existing container without acquiring a helper or reading credentials', async () => {
  for (const container of ['real-poller', 'vac-qa-capacity-spoofed-helper']) {
    let acquired = false;
    await assert.rejects(
      withQaCleanup(
        (scope, signal) =>
          preflight.acquireDrillStorageGuard(
            { allowSharedToken: true },
            scope,
            signal,
            {
              inventory: async () => ({ containers: [container] }),
              storagePaths: () => {
                acquired = true;
              },
              acquireGuard: () => {
                acquired = true;
              },
            }
          ),
        { signals: false }
      ),
      /empty container inventory/u
    );
    assert.equal(acquired, false);
  }
});

it('releases partially acquired helpers on preflight failure and fails a changed independent baseline', async () => {
  let present = false;
  const options = {
    inventory: async () => ({ containers: present ? ['helper'] : [] }),
    storagePaths: async () => [],
    acquireGuard: (scope) => {
      present = true;
      scope.defer('owned helper', () => {
        present = false;
      });
      throw new Error('Injected capacity failure.');
    },
  };
  await assert.rejects(
    withQaCleanup(
      (scope, signal) =>
        preflight.acquireDrillStorageGuard(
          { allowSharedToken: true },
          scope,
          signal,
          options
        ),
      { signals: false }
    ),
    /Injected capacity failure/u
  );
  assert.equal(present, false);
  options.acquireGuard = () => {
    present = true;
    return {};
  };
  await assert.rejects(
    withQaCleanup(
      (scope, signal) =>
        preflight.acquireDrillStorageGuard(
          { allowSharedToken: true },
          scope,
          signal,
          options
        ),
      { signals: false }
    ),
    /cutover Docker baseline/u
  );
});
