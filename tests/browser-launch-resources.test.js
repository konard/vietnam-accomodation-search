import { describe, expect, it } from 'test-anywhere';

import { BrowserCollector } from '../src/browser-collector.js';
import { runSourcePool } from '../src/source-pool.js';
import { BrowserSourceDiscoverer } from '../src/source-discovery.js';
import { isLostPageError, launchSettings } from '../src/utils.js';

function launchRecorder(launches) {
  return {
    launchBrowser: async (options) => {
      launches.push(options);
      return { browser: { close: async () => {} }, page: {} };
    },
    makeBrowserCommander: () => ({
      destroy: async () => {},
      evaluate: async () => 'browser-check',
      goto: async () => {},
    }),
  };
}

describe('browser launch resources', () => {
  it('keeps shared memory off /dev/shm and keeps caller switches', () => {
    expect(launchSettings()).toEqual({
      args: ['--disable-dev-shm-usage'],
      engine: 'playwright',
      headless: true,
    });
    expect(launchSettings({ args: ['--no-sandbox'], headless: false })).toEqual(
      {
        args: ['--disable-dev-shm-usage', '--no-sandbox'],
        engine: 'playwright',
        headless: false,
      }
    );
    expect(launchSettings({ args: ['--disable-dev-shm-usage'] }).args).toEqual([
      '--disable-dev-shm-usage',
    ]);
  });

  it('launches the collector and discovery browsers with those settings', async () => {
    const launches = [];
    await new BrowserCollector({
      browserLaunchOptions: { args: ['--no-sandbox'] },
      browserRuntime: launchRecorder(launches),
    }).checkLaunch();
    await new BrowserSourceDiscoverer({
      browserLaunchOptions: { args: ['--no-sandbox'] },
      browserRuntime: launchRecorder(launches),
    }).discover('web', { candidates: [] });
    expect(launches.map(({ args }) => args)).toEqual([
      ['--disable-dev-shm-usage', '--no-sandbox'],
      ['--disable-dev-shm-usage', '--no-sandbox'],
    ]);
  });
});

describe('lost browser pages', () => {
  it('recognizes crashed and closed page errors', () => {
    for (const message of [
      'page.evaluate: Target crashed ',
      'page.goto: Target page, context or browser has been closed',
      'Protocol error (Runtime.callFunctionOn): Target closed.',
      'Session closed. Most likely the page has been closed.',
    ]) {
      expect(isLostPageError(new Error(message))).toBe(true);
    }
    expect(isLostPageError(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe(
      false
    );
    expect(isLostPageError(undefined)).toBe(false);
  });

  it('replaces a worker whose page crashed so later sources get a live page', async () => {
    const opened = [];
    const retired = [];
    const used = [];
    const result = await runSourcePool(
      ['a', 'b', 'c'].map((id) => ({ id })),
      {
        isWorkerLost: isLostPageError,
        openWorker: () => {
          const worker = { crashed: false, id: opened.length };
          opened.push(worker);
          return worker;
        },
        retireWorker: (worker) => retired.push(worker.id),
        run: async (source, { worker }) => {
          used.push([source.id, worker.id]);
          if (worker.crashed || source.id === 'a') {
            worker.crashed = true;
            throw new Error('page.evaluate: Target crashed ');
          }
          return [{ id: source.id }];
        },
      }
    );
    expect(used).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 1],
    ]);
    expect(retired).toEqual([0]);
    expect(result.outcomes.map(({ status }) => status)).toEqual([
      'error',
      'offers',
      'offers',
    ]);
  });
});
