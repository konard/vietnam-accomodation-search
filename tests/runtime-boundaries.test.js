import { describe, expect, it } from 'test-anywhere';

import {
  TelegramAvailabilityService,
  add,
  createApplication,
  delay,
  multiply,
} from '../src/index.js';
import { loadDefaultBrowserRuntime } from '../src/browser-collector.js';
import { createMtcuteClient } from '../src/telegram-user.js';

describe('runtime dependency boundaries', () => {
  it('loads optional browser and Telegram runtimes without starting sessions', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const browserRuntime = await loadDefaultBrowserRuntime();
    expect(typeof browserRuntime.launchBrowser).toBe('function');

    const client = await createMtcuteClient({ apiHash: 'hash', apiId: 1 });
    expect(typeof client.start).toBe('function');
    await client.destroy();
  });

  it('constructs application helpers from injected dependencies', async () => {
    const collector = {};
    const mediaCache = {};
    const rateProvider = {};
    const registry = {};
    const service = {};
    const store = {};
    const application = createApplication({
      collector,
      discoverer: {},
      mediaCache,
      rateProvider,
      registry,
      service,
      store,
    });

    expect(application.collector).toBe(collector);
    expect(
      application.createAvailabilityService() instanceof
        TelegramAvailabilityService
    ).toBe(true);
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const bot = await application.createBot('123456:token', {
      apiHash: 'hash',
      apiId: 1,
      session: 'session',
    });
    expect(typeof bot.start).toBe('function');
  });
});

describe('dependency-free package helpers', () => {
  it('adds, multiplies, and delays', async () => {
    expect(add(2, 3)).toBe(5);
    expect(multiply(4, 5)).toBe(20);
    await delay(0);
  });
});
