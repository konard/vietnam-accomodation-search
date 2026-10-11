import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'test-anywhere';
import {
  acquireQaStorageGuard,
  qaDockerStoragePaths,
} from '../experiments/qa-storage-guard.mjs';
import { withQaCleanup } from '../experiments/qa-cleanup.mjs';
import {
  desktopDiskImage,
  recoverDockerCapacityProbe,
} from '../experiments/qa-docker-capacity.mjs';

function daemon(available = 20 * 1024 ** 2) {
  const calls = [];
  let owned = false;
  let token;
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'info') {
      return args.at(-1) === '{{.DockerRootDir}}'
        ? '/var/lib/docker'
        : JSON.stringify({
            DockerRootDir: '/var/lib/docker',
            OperatingSystem: 'Docker Desktop',
            OSType: 'linux',
          });
    }
    if (args[0] === 'context') {
      return JSON.stringify('unix:///self-authored/docker.sock');
    }
    if (args[0] === 'image') {
      return JSON.stringify({
        Id: `sha256:${'a'.repeat(64)}`,
        Config: { Volumes: {} },
      });
    }
    if (args[0] === 'create') {
      token = args[args.indexOf('--label') + 1];
      owned = true;
      return 'owned-fixture';
    }
    if (args[0] === 'start') {
      return '';
    }
    if (args[0] === 'exec') {
      return `Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 50000000 1000000 ${typeof available === 'function' ? available() : available} 2% /\n`;
    }
    if (args[0] === 'ps') {
      return owned && args.includes(`label=${token}`) ? 'owned-fixture' : '';
    }
    if (args[0] === 'rm') {
      owned = false;
      return '';
    }
    throw new Error('unexpected self-authored command');
  };
  return { run, calls, owned: () => owned };
}

it('checks the Desktop backing host disk and actual guest capacity without host-reading the VM root', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'vac-desktop-test-'));
  try {
    for (const low of [false, true]) {
      const fixture = daemon(low ? 1 : undefined);
      const paths = await qaDockerStoragePaths(fixture.run, {
        platform: 'darwin',
        environment: { QA_DOCKER_DISK_IMAGE: '/self-authored/Docker.raw' },
        statImpl: async () => ({ isFile: () => true }),
      });
      const execute = () =>
        withQaCleanup(async (scope) => {
          const guard = await acquireQaStorageGuard(scope, {
            paths,
            lockDirectory: join(root, 'heavy.lock'),
            statfsImpl: async (path) => {
              assert.notEqual(path, '/var/lib/docker');
              return { bavail: 20n * 1024n ** 3n, bsize: 1n };
            },
          });
          await guard.check();
        });
      if (low) {
        await assert.rejects(execute(), /QA_DISK_PREFLIGHT/u);
      } else {
        await execute();
      }
      assert.equal(fixture.owned(), false);
      const create = fixture.calls.find(
        ([operation]) => operation === 'create'
      );
      assert(create.includes('--read-only'));
      assert(create.includes('never'));
      assert(create.includes('none'));
      assert(
        !fixture.calls.some(
          ([operation]) => operation === 'pull' || operation === 'build'
        )
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('uses a moved Desktop disk location and rejects missing, unreadable or invalid backing images', async () => {
  const visited = [];
  const backingImage = join('/moved/disk', 'Docker.raw');
  const settings = {
    platform: 'darwin',
    environment: {},
    home: '/self-authored',
    readFileImpl: async () => JSON.stringify({ dataFolder: '/moved/disk' }),
    statImpl: async (path) => {
      visited.push(path);
      return { isFile: () => path === backingImage };
    },
  };
  assert.equal(await desktopDiskImage(settings), backingImage);
  assert(visited.every((path) => path.startsWith(join('/moved/disk'))));
  await assert.rejects(
    desktopDiskImage({
      ...settings,
      readFileImpl: async () =>
        JSON.stringify({ dataFolder: { invalid: true } }),
    }),
    { code: 'QA_CAPACITY_UNAVAILABLE' }
  );
  await assert.rejects(
    desktopDiskImage({
      ...settings,
      statImpl: async () => ({ isFile: () => false }),
    }),
    { code: 'QA_CAPACITY_UNAVAILABLE' }
  );
  await assert.rejects(
    desktopDiskImage({
      ...settings,
      environment: { QA_DOCKER_DISK_IMAGE: '/missing/Docker.raw' },
      statImpl: async () => {
        throw Object.assign(new Error('private path'), { code: 'ENOENT' });
      },
    }),
    { code: 'QA_CAPACITY_UNAVAILABLE' }
  );
  await assert.rejects(
    desktopDiskImage({
      ...settings,
      environment: { QA_DOCKER_DISK_IMAGE: 'relative' },
    }),
    { code: 'QA_CAPACITY_UNAVAILABLE' }
  );
});

it('rejects remote endpoints and unknown guest measurements without weakening host or guest floors', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'vac-desktop-rejections-'));
  try {
    for (const mode of ['remote', 'host-low', 'guest-unknown', 'guest-floor']) {
      let available = 20 * 1024 ** 2;
      const fixture = daemon(() => available);
      const run = (args, options) => {
        if (mode === 'remote' && args[0] === 'context') {
          return JSON.stringify('ssh://self-authored');
        }
        if (mode === 'guest-unknown' && args[0] === 'exec') {
          return Promise.resolve('unknown');
        }
        return fixture.run(args, options);
      };
      const pathsPromise = qaDockerStoragePaths(run, {
        platform: 'darwin',
        environment: { QA_DOCKER_DISK_IMAGE: '/self-authored/Docker.raw' },
        statImpl: async () => ({ isFile: () => true }),
      });
      if (mode === 'remote') {
        await assert.rejects(pathsPromise, { code: 'QA_CAPACITY_UNAVAILABLE' });
        assert.equal(fixture.calls.length, 1);
        continue;
      }
      const paths = await pathsPromise;
      await assert.rejects(
        withQaCleanup(async (scope) => {
          const guard = await acquireQaStorageGuard(scope, {
            paths,
            lockDirectory: join(root, 'heavy.lock'),
            statfsImpl: async () => ({
              bavail: mode === 'host-low' ? 1n : 20n * 1024n ** 3n,
              bsize: 1n,
            }),
          });
          available = 1;
          await assert.rejects(guard.check(), { code: 'QA_DISK_FLOOR' });
          assert.equal(guard.signal.aborted, true);
          guard.signal.throwIfAborted();
        }),
        {
          code:
            mode === 'host-low'
              ? 'QA_DISK_PREFLIGHT'
              : mode === 'guest-floor'
                ? 'QA_DISK_FLOOR'
                : 'QA_CAPACITY_UNAVAILABLE',
        }
      );
      assert.equal(fixture.owned(), false);
      if (mode === 'host-low') {
        assert(!fixture.calls.some(([op]) => op === 'create'));
      }
      await assert.rejects(stat(join(root, 'heavy.lock')), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('retains the ownership journal and lock on failed helper teardown for exact recovery', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'vac-desktop-recovery-'));
  const fixture = daemon();
  let fail = true;
  const run = (args, options) => {
    if (args[0] === 'rm' && fail) {
      throw new Error('self-authored teardown failure');
    }
    return fixture.run(args, options);
  };
  const lock = join(root, 'heavy.lock');
  try {
    const paths = await qaDockerStoragePaths(run, {
      platform: 'darwin',
      environment: { QA_DOCKER_DISK_IMAGE: '/self-authored/Docker.raw' },
      statImpl: async () => ({ isFile: () => true }),
    });
    await assert.rejects(
      withQaCleanup((scope) =>
        acquireQaStorageGuard(scope, {
          paths,
          lockDirectory: lock,
          statfsImpl: async () => ({ bavail: 20n * 1024n ** 3n, bsize: 1n }),
        })
      ),
      AggregateError
    );
    assert(fixture.owned());
    const journal = join(lock, 'docker-capacity.json');
    assert(JSON.parse(await readFile(journal, 'utf8')).token);
    assert(await stat(join(lock, 'owner.json')));
    fail = false;
    await recoverDockerCapacityProbe(run, journal);
    assert.equal(fixture.owned(), false);
    await assert.rejects(stat(journal), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
