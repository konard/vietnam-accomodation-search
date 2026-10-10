import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  QaDockerCleanup,
  dockerInventory,
} from '../experiments/qa-docker-cleanup.mjs';

const runId = 'vac-qa-self-authored-1234';
function fixture({ refuseContainer = false } = {}) {
  const baseline = {
    containers: ['original-container'],
    networks: ['original-network'],
    volumes: ['original-volume'],
    images: ['original-id original:latest'],
    builders: ['default'],
  };
  const current = {
    ...baseline,
    containers: [...baseline.containers, 'qa-container'],
    networks: [...baseline.networks, 'qa-network'],
    volumes: [...baseline.volumes, 'qa-volume'],
    images: [...baseline.images, `qa-image ${runId}:fixture`],
    builders: ['default', `${runId}-builder`],
  };
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    const joined = args.join(' ');
    if (joined.startsWith('ps -aq')) {
      return (
        args.includes('--filter')
          ? ['qa-container'].filter((id) => current.containers.includes(id))
          : current.containers
      ).join('\n');
    }
    for (const kind of ['network', 'volume']) {
      if (joined.startsWith(`${kind} ls`)) {
        return (
          args.includes('--filter')
            ? [`qa-${kind}`].filter((id) => current[`${kind}s`].includes(id))
            : current[`${kind}s`]
        ).join('\n');
      }
    }
    if (joined.startsWith('image ls')) {
      return current.images.join('\n');
    }
    if (joined.startsWith('buildx ls')) {
      return current.builders.join('\n');
    }
    if (joined.startsWith('rm -f')) {
      if (refuseContainer) {
        throw new Error('injected deletion failure');
      }
      current.containers = current.containers.filter(
        (id) => id !== args.at(-1)
      );
    } else if (['network', 'volume'].includes(args[0]) && args[1] === 'rm') {
      current[`${args[0]}s`] = current[`${args[0]}s`].filter(
        (id) => id !== args.at(-1)
      );
    } else if (joined.startsWith('image rm')) {
      current.images = current.images.filter(
        (row) => !row.endsWith(` ${args.at(-1)}`)
      );
    } else if (joined.startsWith('buildx rm')) {
      current.builders = current.builders.filter(
        (name) => name !== args.at(-1)
      );
    } else {
      throw new Error(`Unexpected fixture command ${args[0]}`);
    }
    return '';
  };
  return { baseline, current, calls, run };
}

describe('scoped Docker QA cleanup', () => {
  it('removes every owned resource while preserving all original resources', async () => {
    const state = fixture();
    const cleanup = new QaDockerCleanup({
      runId,
      baseline: state.baseline,
      run: state.run,
    });
    cleanup.ownImage(`${runId}:fixture`);
    cleanup.ownBuilder(`${runId}-builder`);
    assert.equal((await cleanup.cleanup()).pass, true);
    assert.deepEqual(await dockerInventory(state.run), state.baseline);
    assert(!state.calls.some((args) => args.includes('prune')));
    assert.throws(() => cleanup.ownImage('original:latest'), /pre-existing/u);
    assert.throws(() => cleanup.ownBuilder('default'), /pre-existing/u);
  });

  it('continues other teardown phases after a refused container deletion', async () => {
    const state = fixture({ refuseContainer: true });
    const cleanup = new QaDockerCleanup({
      runId,
      baseline: state.baseline,
      run: state.run,
    });
    cleanup.ownImage(`${runId}:fixture`);
    cleanup.ownBuilder(`${runId}-builder`);
    assert.equal((await cleanup.cleanup()).pass, false);
    assert.deepEqual(state.current.volumes, state.baseline.volumes);
    assert.deepEqual(state.current.images, state.baseline.images);
    assert.deepEqual(state.current.builders, state.baseline.builders);
  });

  it('handles a registered acquisition that never created its image or builder', async () => {
    const state = fixture();
    const cleanup = new QaDockerCleanup({
      runId,
      baseline: state.baseline,
      run: state.run,
    });
    cleanup.ownImage(`${runId}:fixture`);
    cleanup.ownImage(`${runId}:never-created`);
    cleanup.ownBuilder(`${runId}-builder`);
    cleanup.ownBuilder(`${runId}-never-created`);
    assert.equal((await cleanup.cleanup()).pass, true);
  });
});
