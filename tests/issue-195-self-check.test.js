import { describe, it, expect } from 'test-anywhere';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runFixtureSearch, withFixtureServer } from '../src/self-check.js';

function fixtureServer({ failure } = {}) {
  const server = new EventEmitter();
  server.address = () => ({ port: 1234 });
  server.listen = (_port, _host, ready) => {
    globalThis.queueMicrotask(() =>
      failure ? server.emit('error', failure) : ready()
    );
  };
  server.close = (done) => {
    server.closed = true;
    done();
  };
  return server;
}

async function failureOf(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected rejection');
}

describe('owned self-check server failure paths', () => {
  it('cancels a pending bind and surfaces owned close failures', async () => {
    const controller = new AbortController();
    const server = fixtureServer();
    server.listen = () => controller.abort(new Error('cancelled bind'));
    expect(
      (
        await failureOf(() =>
          withFixtureServer(() => {}, undefined, {
            serverFactory: () => server,
            signal: controller.signal,
          })
        )
      ).message
    ).toBe('cancelled bind');
    expect(server.closed).toBe(true);
    const failedClose = fixtureServer();
    failedClose.close = (done) => done(new Error('close failed'));
    expect(
      (
        await failureOf(() =>
          withFixtureServer(() => 'ok', undefined, {
            serverFactory: () => failedClose,
          })
        )
      ).message
    ).toBe('close failed');
    const notRunning = fixtureServer();
    notRunning.close = (done) =>
      done(
        Object.assign(new Error('not running'), {
          code: 'ERR_SERVER_NOT_RUNNING',
        })
      );
    expect(
      await withFixtureServer(() => 'ok', undefined, {
        serverFactory: () => notRunning,
      })
    ).toBe('ok');
  });

  it('rejects asynchronous bind errors and closes its server', async () => {
    const error = new Error('self-authored bind failure');
    const server = fixtureServer({ failure: error });
    expect(
      await failureOf(() =>
        withFixtureServer(
          () => {
            throw new Error('must not run');
          },
          undefined,
          { serverFactory: () => server }
        )
      )
    ).toBe(error);
    expect(server.closed).toBe(true);
    expect(server.listenerCount('error')).toBe(0);
  });

  it('closes on success, operation failure and cancellation', async () => {
    for (const outcome of ['success', 'failure', 'cancel']) {
      const server = fixtureServer();
      const controller = new AbortController();
      const action = () =>
        withFixtureServer(
          async (_origin, signal) => {
            if (outcome === 'failure') {
              throw new Error('operation failed');
            }
            if (outcome === 'cancel') {
              controller.abort(new Error('cancelled'));
              signal.throwIfAborted();
            }
            return 'ok';
          },
          undefined,
          { serverFactory: () => server, signal: controller.signal }
        );
      if (outcome === 'success') {
        expect(await action()).toBe('ok');
      } else {
        expect((await failureOf(action)).message).toContain(
          outcome === 'cancel' ? 'cancelled' : 'operation failed'
        );
      }
      expect(server.closed).toBe(true);
    }
  });

  it('removes only its fixture after setup failure', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-bind-test-'));
    const unrelated = await mkdtemp(join(root, 'unrelated-'));
    try {
      const error = new Error('bind rejected');
      expect(
        await failureOf(() =>
          runFixtureSearch({
            temporaryRoot: root,
            serverFactory: () => fixtureServer({ failure: error }),
            createApplication: () => {
              throw new Error('must not run');
            },
          })
        )
      ).toBe(error);
      expect(await readdir(root)).toEqual([basename(unrelated)]);
      await access(unrelated);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
