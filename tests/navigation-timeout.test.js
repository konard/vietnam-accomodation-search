import { describe, expect, it } from 'test-anywhere';

import { BrowserCollector, BrowserSourceDiscoverer } from '../src/index.js';

function recordingCommander(calls) {
  return {
    evaluate: async () => [],
    goto: async (options) => {
      calls.push(options);
    },
  };
}

const passThrough = { run: (_url, operation) => operation() };

describe('page navigation timeout', () => {
  it('bounds every collector and discoverer navigation', async () => {
    const calls = [];
    const commander = recordingCommander(calls);
    const collector = new BrowserCollector({ scheduler: passThrough });
    await collector.navigate(commander, 'https://t.me/s/rentals');
    await collector
      .collectListingRows(
        commander,
        'https://www.booking.com/searchresults.html',
        'web',
        { selectors: {} }
      )
      .catch(() => {});
    await new BrowserSourceDiscoverer({ scheduler: passThrough }).navigate(
      commander,
      'https://www.google.com/search?q=rent'
    );
    expect(calls.map(({ timeout }) => timeout)).toEqual([
      30_000, 30_000, 30_000,
    ]);
  });

  it('accepts a custom navigation timeout', async () => {
    const calls = [];
    await new BrowserCollector({
      navigationTimeoutMs: 5_000,
      scheduler: passThrough,
    }).navigate(recordingCommander(calls), 'https://t.me/s/rentals');
    expect(calls[0].timeout).toBe(5_000);
  });
});
