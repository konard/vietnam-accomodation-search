#!/usr/bin/env node

/**
 * Manual availability measurement to run alongside an authorized deploy drill.
 * This is deliberately read-only: getMe does not consume Telegram updates.
 * Supply TELEGRAM_BOT_TOKEN through a protected environment, never argv.
 */

import { performance } from 'node:perf_hooks';

const DEFAULT_READY_URL = 'http://127.0.0.1:8080/ready';

export function longestObservedOutage(samples, field) {
  let lastSuccess;
  let firstFailure;
  let longest = 0;
  for (const sample of samples) {
    if (sample[field]) {
      if (firstFailure !== undefined) {
        longest = Math.max(longest, sample.atMs - (lastSuccess ?? 0));
      }
      lastSuccess = sample.atMs;
      firstFailure = undefined;
    } else if (firstFailure === undefined) {
      firstFailure = sample.atMs;
    }
  }
  if (firstFailure !== undefined) {
    longest = Math.max(
      longest,
      samples.at(-1).atMs - (lastSuccess ?? firstFailure)
    );
  }
  return Math.round(longest);
}

export function summarizeSamples(samples) {
  return {
    samples: samples.length,
    ready: {
      passed: samples.filter((sample) => sample.ready).length,
      failed: samples.filter((sample) => !sample.ready).length,
      longestObservedOutageMs: longestObservedOutage(samples, 'ready'),
    },
    botApiGetMe: {
      passed: samples.filter((sample) => sample.botApiGetMe).length,
      failed: samples.filter((sample) => !sample.botApiGetMe).length,
      longestObservedOutageMs: longestObservedOutage(samples, 'botApiGetMe'),
    },
  };
}

export async function probeAvailability({ fetchImpl, readyUrl, token }) {
  const [ready, botApiGetMe] = await Promise.all([
    fetchImpl(readyUrl, { signal: AbortSignal.timeout(5_000) })
      .then((response) => response.ok)
      .catch(() => false),
    fetchImpl(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5_000),
    })
      .then(
        async (response) => response.ok && Boolean((await response.json()).ok)
      )
      .catch(() => false),
  ]);
  return { ready, botApiGetMe };
}

function options(argv) {
  const names = {
    '--duration-ms': 'durationMs',
    '--interval-ms': 'intervalMs',
    '--ready-url': 'readyUrl',
  };
  const result = {
    durationMs: 120_000,
    intervalMs: 1_000,
    readyUrl: DEFAULT_READY_URL,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !Object.hasOwn(names, key)) {
      throw new Error(
        'Usage: measure-deploy-handoff.mjs [--duration-ms N] [--interval-ms N] [--ready-url URL]'
      );
    }
    result[names[key]] = key === '--ready-url' ? value : Number(value);
  }
  if (
    !Number.isInteger(result.durationMs) ||
    result.durationMs < 1_000 ||
    !Number.isInteger(result.intervalMs) ||
    result.intervalMs < 100 ||
    result.intervalMs > result.durationMs
  ) {
    throw new RangeError(
      'Duration and interval must be positive bounded integers.'
    );
  }
  const url = new globalThis.URL(result.readyUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'The readiness URL must be HTTP(S) without credentials or query data.'
    );
  }
  return result;
}

export async function measure({
  durationMs,
  fetchImpl = fetch,
  intervalMs,
  readyUrl,
  token,
}) {
  const started = performance.now();
  const samples = [];
  do {
    const atMs = Math.round(performance.now() - started);
    const result = await probeAvailability({ fetchImpl, readyUrl, token });
    samples.push({ atMs, ...result });
    const remaining = durationMs - (performance.now() - started);
    if (remaining <= 0) {
      break;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(intervalMs, remaining))
    );
  } while (performance.now() - started < durationMs);
  return summarizeSamples(samples);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.CI) {
    throw new Error('The handoff probe is manual and must not run in CI.');
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is required in the protected environment.'
    );
  }
  const result = await measure({ ...options(process.argv.slice(2)), token });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
