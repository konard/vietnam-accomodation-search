#!/usr/bin/env node

/**
 * Offline-by-default release evidence assembler. It does not start a browser,
 * Telegram client, bot poller, or network request. Live evidence must be
 * produced by the dedicated manual audit runners and supplied as sanitized
 * JSON. The live mode refuses CI and requires an explicit operator opt-in.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { durableWrite } from '../src/link-cli-mirror.js';
import {
  compareReleaseAudit,
  createReleaseAudit,
} from '../src/release-audit.js';

function argumentsFrom(values) {
  const options = { mode: 'fixture' };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === '--live') {
      options.mode = 'live';
      continue;
    }
    const property = {
      '--baseline': 'baseline',
      '--evidence': 'evidence',
      '--output': 'output',
      '--release': 'release',
    }[name];
    if (!property || !values[index + 1]) {
      throw new Error(`Unknown or incomplete option: ${name}`);
    }
    options[property] = values[index + 1];
    index += 1;
  }
  return options;
}

async function json(path, fallback = {}) {
  return path ? JSON.parse(await readFile(path, 'utf8')) : fallback;
}

function assertLiveBoundary(environment) {
  if (environment.CI || environment.GITHUB_ACTIONS || environment.BUILDKITE) {
    throw new Error(
      'The live release audit is local/manual-only and refuses CI.'
    );
  }
  if (environment.RELEASE_AUDIT_LIVE !== '1') {
    throw new Error('Set RELEASE_AUDIT_LIVE=1 to authorize a live audit.');
  }
  if (environment.TELEGRAM_BOT_POLLER_ACTIVE === '1') {
    throw new Error('Stop the competing Telegram bot poller before auditing.');
  }
}

export async function runReleaseAudit(values, environment = process.env) {
  const options = argumentsFrom(values);
  if (options.mode === 'live') {
    assertLiveBoundary(environment);
  }
  const evidence = await json(options.evidence);
  const release = await json(options.release);
  const report = createReleaseAudit({
    competingPoller: environment.TELEGRAM_BOT_POLLER_ACTIVE === '1',
    credentials: Boolean(
      environment.TELEGRAM_API_ID &&
      environment.TELEGRAM_API_HASH &&
      environment.TELEGRAM_BOT_TOKEN &&
      environment.TELEGRAM_USER_SESSION
    ),
    gates: evidence.gates,
    mode: options.mode,
    release,
    runtime: evidence.runtime,
  });
  const baseline = await json(options.baseline, null);
  const result = {
    report,
    ...(baseline ? { comparison: compareReleaseAudit(baseline, report) } : {}),
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    await durableWrite(options.output, output);
  } else {
    process.stdout.write(output);
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runReleaseAudit(process.argv.slice(2));
  if (result.report.status === 'failure') {
    process.exitCode = 1;
  }
}
