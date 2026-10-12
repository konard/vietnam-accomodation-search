// Exact private capability recovery; age and PID are never release authority.
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export async function acquireOperationLock(path, context = {}) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Another deployment operation is already running.', {
        cause: error,
      });
    }
    throw error;
  }
  const owner = {
    ...context,
    version: 1,
    token: randomBytes(32).toString('hex'),
    host: hostname(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  try {
    await writeFile(join(path, 'owner.json'), JSON.stringify(owner), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    await rm(path, { recursive: true });
    throw error;
  }
  return {
    owner,
    release: async () => {
      const current = JSON.parse(
        await readFile(join(path, 'owner.json'), 'utf8')
      );
      if (current.token !== owner.token) {
        throw new Error('Operation lock ownership changed; recovery required.');
      }
      await rm(path, { recursive: true });
    },
  };
}

// eslint-disable-next-line complexity -- Every exact-owner recovery condition must hold before releasing serialization.
export async function recoverOperationLock(
  path,
  recoveryFile,
  {
    producersStopped = false,
    alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error.code !== 'ESRCH';
      }
    },
  } = {}
) {
  if (!producersStopped) {
    throw new Error(
      'Exact producer quiescence must be independently verified before recovery.'
    );
  }
  const info = await lstat(recoveryFile);
  if (!info.isFile() || (process.platform !== 'win32' && info.mode & 0o077)) {
    throw new Error('Recovery evidence must be a private regular file.');
  }
  const lockInfo = await lstat(path);
  const ownerInfo = await lstat(join(path, 'owner.json'));
  if (
    !lockInfo.isDirectory() ||
    !ownerInfo.isFile() ||
    ownerInfo.size > 8192 ||
    info.size > 8192
  ) {
    throw new Error('Invalid exact recovery evidence.');
  }
  const expected = JSON.parse(await readFile(recoveryFile, 'utf8'));
  const current = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
  if (
    !Number.isSafeInteger(current.pid) ||
    current.pid <= 0 ||
    !/^[a-f0-9]{32,64}$/u.test(current.token) ||
    expected.token !== current.token ||
    JSON.stringify(expected) !== JSON.stringify(current) ||
    current.host !== hostname() ||
    alive(current.pid)
  ) {
    throw new Error(
      'Recovery evidence does not prove an inactive exact lock owner.'
    );
  }
  // An atomic rename to quarantine would permit a new operation before removal.
  // Keep serialization until the exact verified owner's directory is removed.
  await rm(path, { recursive: true });
  return { recovered: true };
}
