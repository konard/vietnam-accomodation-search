import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// A finite daemon model, separate from the opt-in real Docker experiment.
export function capacityBootstrapDaemon(
  lock,
  {
    cached = false,
    failAt,
    failCleanup = false,
    onPull,
    available = 20000000,
    sharedTag = false,
  } = {}
) {
  const imageId = `sha256:${'a'.repeat(64)}`;
  const images = new Set(cached ? ['busybox:1.37.0'] : []);
  if (sharedTag) {
    images.add('self-authored:shared');
  }
  const calls = [];
  let owned = false;
  let token;
  let cleanupFailure = failCleanup;
  // eslint-disable-next-line complexity -- Finite daemon model enumerates Docker operations and injected failures.
  const run = async (args, { signal } = {}) => {
    signal?.throwIfAborted();
    calls.push(args);
    const [operation, subcommand] = args;
    if (operation === 'pull') {
      const journal = JSON.parse(
        await readFile(join(lock, 'docker-capacity-image.json'), 'utf8')
      );
      assert(journal.imageRefs.includes('busybox:1.37.0'));
      assert(await stat(join(lock, 'docker-capacity.json')));
      images.add('busybox:1.37.0');
      await onPull?.(signal);
      if (failAt === 'pull') {
        throw new Error('self-authored acquisition failure');
      }
      return '';
    }
    if (operation === 'image' && subcommand === 'inspect') {
      if (!images.has(args[2])) {
        throw new Error('self-authored absent image');
      }
      return JSON.stringify({ Id: imageId, Config: { Volumes: {} } });
    }
    if (operation === 'image' && subcommand === 'ls') {
      return [...images].map((ref) => `${imageId} ${ref}`).join('\n');
    }
    if (operation === 'image' && subcommand === 'rm') {
      assert.equal(owned, false, 'stop the helper before image cleanup');
      if (cleanupFailure) {
        throw new Error('self-authored cleanup failure');
      }
      images.delete(args[2]);
      return '';
    }
    if (operation === 'create') {
      token = args[args.indexOf('--label') + 1];
      owned = true;
    }
    if (operation === failAt) {
      throw new Error('self-authored setup failure');
    }
    if (operation === 'exec') {
      return `Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 50000000 1000000 ${available} 2% /\n`;
    }
    if (operation === 'ps') {
      return owned && args.includes(`label=${token}`) ? 'owned-fixture' : '';
    }
    if (operation === 'rm') {
      owned = false;
    }
    if (
      ['create', 'start', 'rm', 'network', 'volume', 'buildx'].includes(
        operation
      )
    ) {
      return '';
    }
    throw new Error('unexpected self-authored command');
  };
  return {
    run,
    calls,
    images,
    owned: () => owned,
    recover: () => {
      cleanupFailure = false;
    },
  };
}
