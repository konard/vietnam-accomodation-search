import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'test-anywhere';

import { BrowserCollector } from '../src/browser-collector.js';
import { BrowserSourceDiscoverer } from '../src/source-discovery.js';
import { gotoPage, openCommander } from '../src/utils.js';

// Records the options of every commander the code under test builds.
function recordingRuntime(made) {
  return {
    launchBrowser: async () => ({
      browser: { close: async () => {} },
      page: {},
    }),
    makeBrowserCommander: (options) => {
      made.push(options);
      return {
        destroy: async () => {},
        evaluate: async () => [],
        goto: async () => {},
      };
    },
  };
}

describe('browser commander options', () => {
  if (typeof globalThis.Deno === 'undefined') {
    it('uses the reviewed browser subprocess runner with literal argv', async () => {
      const { runCommand } = await import(
        new globalThis.URL(
          './utilities/subprocess.js',
          import.meta.resolve('browser-commander')
        )
      );
      const args = ['a b', '$literal', '"qa"'];
      const result = await runCommand(process.execPath, [
        '--max-old-space-size=64',
        '-e',
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        ...args,
      ]);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(args);
    });
  }
  it('propagates published navigation failure and the caller abort reason', async () => {
    const commander = {
      goto: async () => ({ navigated: false, status: 'timeout' }),
    };
    let error;
    try {
      await gotoPage(commander, 'https://example.com');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('BROWSER_NAVIGATION_FAILED');
    expect(error.message).toContain('timeout');
    const controller = new AbortController();
    const reason = new Error('Self-authored cancellation');
    controller.abort(reason);
    try {
      await gotoPage(commander, 'https://example.com', 1000, controller.signal);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBe(reason);
    expect(
      await gotoPage(
        { goto: async () => ({ navigated: false }) },
        'https://example.com'
      ).catch((caught) => caught.message)
    ).toContain('failed');
    expect(
      await gotoPage(
        { goto: async () => ({ navigated: true }) },
        'https://example.com'
      )
    ).toEqual({ navigated: true });
  });
  it('uses supported per-call readiness with the default network tracker', () => {
    const made = [];
    openCommander(recordingRuntime(made), 'page');
    expect(made).toEqual([{ page: 'page' }]);
  });

  it('opens the launch check commander with the supported default tracker', async () => {
    const made = [];
    await new BrowserCollector({
      browserRuntime: recordingRuntime(made),
    }).checkLaunch();
    expect(made).toEqual([{ page: {} }]);
  });

  it('opens the discovery commander with the supported default tracker', async () => {
    const made = [];
    await new BrowserSourceDiscoverer({
      browserRuntime: recordingRuntime(made),
    }).discover('web', { candidates: [] });
    expect(made).toEqual([{ page: {} }]);
  });

  it('builds every commander in src through openCommander', async () => {
    for (const file of ['browser-collector.js', 'source-discovery.js']) {
      const source = await readFile(
        new globalThis.URL(`../src/${file}`, import.meta.url),
        'utf8'
      );
      expect(source).not.toContain('makeBrowserCommander(');
    }
  });
});
