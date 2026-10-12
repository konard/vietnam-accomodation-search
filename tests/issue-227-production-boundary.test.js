import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { createApplication } from '../src/application.js';
import { createTelegramBot } from '../src/telegram-bot.js';

it('installs QA boundaries on the real bot and its composed transport router before polling', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const botKey = Symbol.for('vac.qa.botBoundary');
  const capabilityKey = Symbol.for('vac.qa.capabilityBoundary');
  const previousBot = globalThis[botKey];
  const previousCapability = globalThis[capabilityKey];
  const previousMarker = process.env.VAC_QA_MARKER;
  const attached = [];
  let capability;
  try {
    process.env.VAC_QA_MARKER = 'synthetic';
    delete globalThis[botKey];
    await assert.rejects(
      createTelegramBot('synthetic', {}),
      /boundary was not installed/u
    );
    globalThis[botKey] = (bot) => {
      bot.qaBoundaryInstalled = true;
      attached.push(bot);
    };
    globalThis[capabilityKey] = (bot, context) => {
      capability = { bot, ...context };
    };
    const app = createApplication({
      environment: {},
      collector: {},
      discoverer: {},
      mediaCache: {},
      presetService: {},
      service: {},
      store: { loadRecords: async () => [], saveRecords: async () => {} },
      traceRecorder: { record: () => {}, persist: async () => {} },
    });
    const bot = await app.createBot('synthetic');
    assert.deepEqual(attached, [bot]);
    assert.equal(capability.bot, bot);
    assert.equal(capability.router.mode, 'bot-only');
    assert.equal(capability.user, undefined);
    assert.equal(bot.isRunning(), false);
    for (const resource of bot.resources) {
      await resource.destroy();
    }
  } finally {
    if (previousMarker === undefined) {
      delete process.env.VAC_QA_MARKER;
    } else {
      process.env.VAC_QA_MARKER = previousMarker;
    }
    if (previousBot === undefined) {
      delete globalThis[botKey];
    } else {
      globalThis[botKey] = previousBot;
    }
    if (previousCapability === undefined) {
      delete globalThis[capabilityKey];
    } else {
      globalThis[capabilityKey] = previousCapability;
    }
  }
});
