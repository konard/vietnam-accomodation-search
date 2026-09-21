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
    '  update-sources              Refresh the top 20 source lists',
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
      const bot = await application.createBot(env.TELEGRAM_BOT_TOKEN);
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
