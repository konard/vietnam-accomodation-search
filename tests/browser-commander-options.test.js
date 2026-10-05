import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'test-anywhere';

import { BrowserCollector } from '../src/browser-collector.js';
import { BrowserSourceDiscoverer } from '../src/source-discovery.js';
import { openCommander } from '../src/utils.js';

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
  it('builds commanders without the network tracker', () => {
    const made = [];
    openCommander(recordingRuntime(made), 'page');
    expect(made).toEqual([{ enableNetworkTracking: false, page: 'page' }]);
  });

  it('opens the launch check commander without the network tracker', async () => {
    const made = [];
    await new BrowserCollector({
      browserRuntime: recordingRuntime(made),
    }).checkLaunch();
    expect(made).toEqual([{ enableNetworkTracking: false, page: {} }]);
  });

  it('opens the discovery commander without the network tracker', async () => {
    const made = [];
    await new BrowserSourceDiscoverer({
      browserRuntime: recordingRuntime(made),
    }).discover('web', { candidates: [] });
    expect(made).toEqual([{ enableNetworkTracking: false, page: {} }]);
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
