import { describe, expect, it } from 'test-anywhere';
import * as readiness from '../scripts/deploy.mjs';

describe('data-dependent deployment readiness (#107)', () => {
  it('allows a 40-second startup and Docker health at 60 seconds', async () => {
    expect(typeof readiness.waitForReadiness).toBe('function');
    let elapsed = 0;
    const result = await readiness.waitForReadiness({
      now: () => elapsed,
      sleep: async (ms) => {
        elapsed += ms;
      },
      inspect: async () => (elapsed >= 60_000 ? 'healthy' : 'starting'),
    });
    expect(result.elapsedMs).toBe(60_000);
  });

  it('obeys a configured elapsed deadline and fails terminal health early', async () => {
    expect(typeof readiness.waitForReadiness).toBe('function');
    for (const status of ['starting', 'unhealthy', 'exited', 'dead']) {
      let elapsed = 0;
      const error = await readiness
        .waitForReadiness({
          timeoutSeconds: 10,
          now: () => elapsed,
          sleep: async (ms) => {
            elapsed += ms;
          },
          inspect: async () => status,
        })
        .catch((caught) => caught);
      expect(error.message).toContain(status === 'starting' ? '10s' : status);
      expect(elapsed).toBe(status === 'starting' ? 10_000 : 0);
    }
  });

  it('recovers a stopped existing deployment from its recorded image and snapshot', async () => {
    const calls = [];
    const previous = await readiness.inspectPreviousDeployment({
      container: '',
      readState: async () => ({ currentImage: 'previous:recorded' }),
      inspectImage: async () => {
        throw new Error('no running container');
      },
      tagImage: async () => {
        throw new Error('no running container');
      },
    });
    const error = await readiness
      .deploymentStateMachine({
        prepare: async () => 'candidate',
        inspectPrevious: async () => previous,
        stop: async () => calls.push('stop'),
        capture: async () => 'snapshot',
        start: async () => {},
        wait: async () => {
          throw new Error('health failed');
        },
        restore: async (image, snapshot) => calls.push([image, snapshot]),
        discard: async () => {
          throw new Error('must restore recorded deployment');
        },
      })
      .catch((caught) => caught);
    expect(error.message).toContain('previous image and state restored');
    expect(calls).toEqual(['stop', ['previous:recorded', 'snapshot']]);
  });
});
