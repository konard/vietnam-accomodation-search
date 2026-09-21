#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createApplication,
  formatSearchResults,
  parseSearchCommand,
} from '../src/index.js';

function usage() {
  return [
    'Usage: vietnam-accomodation-search <command> [options]',
    '',
    'Commands:',
    '  bot                         Start the Telegram bot',
    '  search [--cheapest [N]] Q  Search and cache accommodation offers',
    '  update-sources              Refresh all ranked source cohorts',
    '  check-availability ID [@U] Send an availability inquiry as a user',
  ].join('\n');
}

export async function runCli(
  argv,
  {
    application = createApplication(),
    env = process.env,
    stderr = console.error,
    stdout = console.log,
  } = {}
) {
  const [command, ...rest] = argv;
  try {
    if (!command || command === '--help' || command === '-h') {
      stdout(usage());
      return 0;
    }
    if (command === 'bot') {
      const bot = await application.createBot(env.TELEGRAM_BOT_TOKEN, {
        apiHash: env.TELEGRAM_API_HASH,
        apiId: env.TELEGRAM_API_ID,
        session: env.TELEGRAM_USER_SESSION,
      });
      await bot.start();
      return 0;
    }
    if (command === 'search') {
      const options = parseSearchCommand(`/search ${rest.join(' ')}`);
      stdout(formatSearchResults(await application.service.search(options)));
      return 0;
    }
    if (command === 'update-sources') {
      const updated = await application.registry.update({ count: 20 });
      stdout(
        `Updated ${updated.web.length} web and ${updated.telegram.length} Telegram sources.`
      );
      return 0;
    }
    if (command === 'check-availability') {
      const [offerId, recipient] = rest;
      if (!offerId) {
        throw new Error('An offer ID is required.');
      }
      const availabilityService = application.createAvailabilityService({
        apiHash: env.TELEGRAM_API_HASH,
        apiId: env.TELEGRAM_API_ID,
        session: env.TELEGRAM_USER_SESSION,
      });
      const result = await availabilityService.check(offerId, { recipient });
      stdout(
        `Availability inquiry sent to ${result.recipient} for ${result.offerId}.`
      );
      return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr(error.message);
    return 1;
  }
}

function isCliEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
