// Participating storage-heavy acceptance commands share one per-host lock.
// A crashed run's lock is never stolen: recovery must verify its exact journal.
import { mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, hostname } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  desktopDiskImage,
  prepareDockerCapacityProbe,
} from './qa-docker-capacity.mjs';

const GIB = 1024 ** 3;
export const QA_DISK_PREFLIGHT_BYTES = 8 * GIB;
export const QA_DISK_FLOOR_BYTES = 2 * GIB;

function capacityError(code) {
  return Object.assign(new Error(code), { code });
}

async function checkCapacity(paths, minimum, statfsImpl, code, checkTimeoutMs) {
  for (const path of paths) {
    let available;
    let timer;
    try {
      const space = await Promise.race([
        Promise.resolve().then(() => statfsImpl(path, { bigint: true })),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(capacityError('QA_CAPACITY_UNAVAILABLE')),
            checkTimeoutMs
          );
        }),
      ]);
      available = BigInt(space.bavail) * BigInt(space.bsize);
      if (BigInt(space.bavail) < 0n || BigInt(space.bsize) <= 0n) {
        throw new Error('Invalid capacity.');
      }
    } catch {
      throw capacityError('QA_CAPACITY_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    if (available < BigInt(minimum)) {
      throw capacityError(code);
    }
  }
}

export async function qaDockerStoragePaths(run, options = {}) {
  const info = JSON.parse(await run(['info', '--format', '{{json .}}']));
  const environment = options.environment || process.env;
  const endpoint =
    !environment.DOCKER_CONTEXT && environment.DOCKER_HOST
      ? environment.DOCKER_HOST
      : JSON.parse(
          await run([
            'context',
            'inspect',
            '--format',
            '{{json .Endpoints.docker.Host}}',
          ])
        );
  if (!/^unix:\/\/\//u.test(endpoint) || info.OSType !== 'linux') {
    throw capacityError('QA_CAPACITY_UNAVAILABLE');
  }
  const root = info.DockerRootDir;
  if (typeof root !== 'string' || !isAbsolute(root) || /[\r\n]/u.test(root)) {
    throw capacityError('QA_CAPACITY_UNAVAILABLE');
  }
  const desktop = /Docker Desktop/iu.test(info.OperatingSystem || '');
  const backing = desktop ? await desktopDiskImage(options) : root;
  const paths = [...new Set([process.cwd(), tmpdir(), backing])];
  if (desktop) {
    paths.prepareCapacity = (scope, directory, signal) =>
      prepareDockerCapacityProbe(run, scope, directory, signal, environment);
  }
  return paths;
}

function validGuardSettings(paths, pollMs, checkTimeoutMs) {
  return (
    paths?.length &&
    Number.isInteger(pollMs) &&
    pollMs >= 1 &&
    pollMs <= 5000 &&
    Number.isInteger(checkTimeoutMs) &&
    checkTimeoutMs >= 1 &&
    checkTimeoutMs <= 5000
  );
}

export async function acquireQaStorageGuard(
  scope,
  {
    paths,
    signal,
    lockDirectory = process.env.QA_HEAVY_LOCK_DIRECTORY ||
      join(homedir(), '.cache', 'vietnam-accomodation-search', 'qa-heavy.lock'),
    statfsImpl = statfs,
    pollMs = 1000,
    checkTimeoutMs = 5000,
  } = {}
) {
  if (!validGuardSettings(paths, pollMs, checkTimeoutMs)) {
    throw capacityError('QA_CAPACITY_CONFIGURATION');
  }
  const prepareCapacity = paths.prepareCapacity;
  paths = [...new Set([process.cwd(), tmpdir(), ...paths])];
  signal?.throwIfAborted();
  await mkdir(dirname(lockDirectory), { recursive: true, mode: 0o700 });
  try {
    await mkdir(lockDirectory, { mode: 0o700 });
  } catch (error) {
    throw capacityError(
      error.code === 'EEXIST' ? 'QA_HEAVY_BUSY' : 'QA_HEAVY_LOCK_UNAVAILABLE'
    );
  }
  const owner = JSON.stringify({
    version: 1,
    host: hostname(),
    purpose: 'storage-heavy-acceptance',
    token: randomBytes(16).toString('hex'),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  let saved = false;
  scope.defer('storage-heavy lock', async () => {
    if (scope.cleanupFailed) {
      throw capacityError('QA_HEAVY_RECOVERY_REQUIRED');
    }
    if (
      saved &&
      (await readFile(join(lockDirectory, 'owner.json'), 'utf8')) !== owner
    ) {
      throw capacityError('QA_HEAVY_LOCK_CHANGED');
    }
    await rm(lockDirectory, { recursive: true });
  });
  await writeFile(join(lockDirectory, 'owner.json'), owner, {
    flag: 'wx',
    mode: 0o600,
  });
  saved = true;
  await checkCapacity(
    paths,
    QA_DISK_PREFLIGHT_BYTES,
    statfsImpl,
    'QA_DISK_PREFLIGHT',
    checkTimeoutMs
  );
  const daemonCapacity = await prepareCapacity?.(scope, lockDirectory, signal);
  const checkDaemon = async (minimum, code, signal) => {
    if (
      daemonCapacity &&
      (await daemonCapacity(checkTimeoutMs, signal)) < BigInt(minimum)
    ) {
      throw capacityError(code);
    }
  };
  await checkDaemon(QA_DISK_PREFLIGHT_BYTES, 'QA_DISK_PREFLIGHT', signal);
  const controller = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const check = async () => {
    combined.throwIfAborted();
    try {
      await checkCapacity(
        paths,
        QA_DISK_FLOOR_BYTES,
        statfsImpl,
        'QA_DISK_FLOOR',
        checkTimeoutMs
      );
      await checkDaemon(QA_DISK_FLOOR_BYTES, 'QA_DISK_FLOOR', combined);
    } catch (error) {
      controller.abort(error);
      throw error;
    }
    combined.throwIfAborted();
  };
  let closed = false;
  let timer;
  let checking = Promise.resolve();
  const poll = () => {
    timer = setTimeout(() => {
      checking = check()
        .catch(() => {})
        .finally(() => {
          if (!closed && !combined.aborted) {
            poll();
          }
        });
    }, pollMs);
  };
  scope.defer('storage capacity monitor', async () => {
    closed = true;
    clearTimeout(timer);
    await checking;
  });
  poll();
  return { signal: combined, check, owner: JSON.parse(owner), lockDirectory };
}
