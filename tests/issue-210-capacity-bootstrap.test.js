import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { it } from 'test-anywhere';
import { withQaCleanup } from '../experiments/qa-cleanup.mjs';
import { acquireQaStorageGuard } from '../experiments/qa-storage-guard.mjs';
import {
  prepareDockerCapacityProbe,
  recoverDockerCapacityProbe,
} from '../experiments/qa-docker-capacity.mjs';

import { capacityBootstrapDaemon as daemon } from '../experiments/qa-capacity-bootstrap-fixture.mjs';
import { dockerCommand } from '../experiments/qa-docker-cleanup.mjs';

async function fixture(action) {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'vac-bootstrap-test-'));
  try {
    await action(join(root, 'heavy.lock'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function guard(lock, daemon, { signal, hostLow = false } = {}) {
  const paths = ['/self-authored/backing'];
  let checkedHost = false;
  paths.prepareCapacity = (scope, directory, scopeSignal) => {
    assert(checkedHost, 'host preflight must precede bootstrap');
    return prepareDockerCapacityProbe(
      daemon.run,
      scope,
      directory,
      scopeSignal,
      {}
    );
  };
  return withQaCleanup(
    async (scope, scopeSignal) => {
      const result = await acquireQaStorageGuard(scope, {
        paths,
        lockDirectory: lock,
        signal: signal || scopeSignal,
        statfsImpl: async () => {
          checkedHost = true;
          return { bavail: hostLow ? 1n : 20n * 1024n ** 3n, bsize: 1n };
        },
      });
      await result.check();
    },
    { signals: false }
  );
}

it('bootstraps twice from an empty cache and restores the exact inventory each time', async () => {
  await fixture(async (lock) => {
    const state = daemon(lock);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await guard(lock, state);
      assert.equal(state.images.size, 0);
      assert.equal(state.owned(), false);
      await assert.rejects(stat(lock), { code: 'ENOENT' });
    }
    assert.equal(state.calls.filter(([op]) => op === 'pull').length, 2);
  });
});

it('preserves cached images and rejects low host capacity or pre-aborted work before acquisition', async () => {
  await fixture(async (lock) => {
    const cached = daemon(lock, { cached: true });
    await guard(lock, cached);
    assert.deepEqual([...cached.images], ['busybox:1.37.0']);
    assert(!cached.calls.some(([op]) => op === 'pull'));
    const empty = daemon(lock);
    await assert.rejects(guard(lock, empty, { hostLow: true }), {
      code: 'QA_DISK_PREFLIGHT',
    });
    assert.equal(empty.calls.length, 0);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(guard(lock, empty, { signal: controller.signal }), {
      name: 'AbortError',
    });
    assert.equal(empty.calls.length, 0);
  });
});

it('recovers partial pulls and helper setup failures without retaining acquired images', async () => {
  await fixture(async (lock) => {
    for (const failAt of ['pull', 'create', 'start']) {
      const state = daemon(lock, { failAt });
      await assert.rejects(guard(lock, state));
      assert.equal(state.images.size, 0);
      assert.equal(state.owned(), false);
      await assert.rejects(stat(lock), { code: 'ENOENT' });
    }
  });
});

it('retains both journals and the lock on image cleanup failure for exact recovery', async () => {
  await fixture(async (lock) => {
    const state = daemon(lock, { failCleanup: true });
    await assert.rejects(guard(lock, state), AggregateError);
    assert.equal(state.owned(), false);
    assert(await stat(join(lock, 'owner.json')));
    assert(await stat(join(lock, 'docker-capacity-image.json')));
    state.recover();
    await recoverDockerCapacityProbe(
      state.run,
      join(lock, 'docker-capacity.json')
    );
    assert.equal(state.images.size, 0);
    await assert.rejects(stat(join(lock, 'docker-capacity.json')), {
      code: 'ENOENT',
    });
  });
});

it('preserves a pre-existing shared image tag and cleans bootstrap after low guest capacity', async () => {
  await fixture(async (lock) => {
    const shared = daemon(lock, { sharedTag: true });
    await guard(lock, shared);
    assert.deepEqual([...shared.images], ['self-authored:shared']);
    const low = daemon(lock, { available: 1 });
    await assert.rejects(guard(lock, low), { code: 'QA_DISK_PREFLIGHT' });
    assert.equal(low.images.size, 0);
  });
});

it('settles owned bootstrap producers and restores inventory after SIGINT and SIGTERM', async () => {
  if (
    typeof globalThis.Deno !== 'undefined' ||
    typeof globalThis.Bun !== 'undefined'
  ) {
    return;
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const child = spawn(
      process.execPath,
      ['experiments/revalidation-capacity-bootstrap-signal.mjs'],
      {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      }
    );
    const ended = new Promise((resolve) => child.once('close', resolve));
    try {
      await new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', () =>
          reject(new Error('signal fixture exited before bootstrap'))
        );
      });
      if (process.platform === 'win32') {
        child.send(signal);
      } else {
        child.kill(signal);
      }
      assert.equal(await ended, 0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await ended;
    }
  }
});

it('awaits Docker CLI close after an abort callback before allowing resource cleanup', async () => {
  let producerClosed = false;
  const operation = Promise.reject(
    Object.assign(new Error('self-authored abort'), { code: 'ABORT_ERR' })
  );
  operation.child = new EventEmitter();
  operation.child.kill = () => {};
  const timer = setTimeout(() => {
    producerClosed = true;
    operation.child.emit('close');
  }, 20);
  try {
    await assert.rejects(
      dockerCommand(['pull', 'busybox:1.37.0'], { execute: () => operation })
    );
    assert(producerClosed);
  } finally {
    clearTimeout(timer);
  }
});
