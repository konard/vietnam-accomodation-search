#!/usr/bin/env node

// Manual loopback diagnostic. No external requests or real credentials.
// Deliberately exits 1 until upstream loadUseM bounds response body reads.
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { loadUseM } from 'use-m/load';
import { loadUse } from '../scripts/use-module.mjs';

const source = `/* ${'fixture '.repeat(50)} */ ({ use: async () => ({}) })`;
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/javascript' });
  if (request.url === '/stall') {
    response.write('/* unfinished self-authored fixture');
  } else {
    response.end(source);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function observe(operation, state, observationMs = 400) {
  let outcome = 'pending';
  const started = performance.now();
  const pending = operation().then(
    () => {
      outcome = 'fulfilled';
    },
    () => {
      outcome = 'rejected';
    }
  );
  let timer;
  try {
    await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(resolve, observationMs);
      }),
    ]);
    return {
      outcome,
      elapsedMs: Math.round(performance.now() - started),
      headersReceived: state.headersReceived,
      signalAborted: state.signal?.aborted ?? false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function trackedFetch(state) {
  return async (url, options) => {
    state.signal = options?.signal;
    const response = await fetch(url, options);
    state.headersReceived = true;
    return response;
  };
}

const rows = [];
try {
  for (const path of ['/ok', '/stall']) {
    const state = { headersReceived: false };
    const result = await observe(
      () =>
        loadUseM({
          fetch: trackedFetch(state),
          sources: [`${origin}${path}`],
          maxAttemptsPerSource: 1,
          timeoutMs: 100,
        }),
      state
    );
    rows.push({
      name: `upstream-${path.slice(1)}`,
      ...result,
      pass:
        result.headersReceived &&
        result.outcome === (path === '/ok' ? 'fulfilled' : 'rejected'),
    });
  }
  const state = { headersReceived: false };
  const result = await observe(
    () =>
      loadUse({
        fetchImpl: trackedFetch(state),
        url: `${origin}/stall`,
        attempts: 1,
        timeoutMs: 100,
      }),
    state
  );
  rows.push({
    name: 'application-stalled-body-control',
    ...result,
    pass: result.headersReceived && result.outcome === 'rejected',
  });
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ mode: 'self-authored-loopback', rows }, null, 2));
process.exitCode = rows.every((row) => row.pass) ? 0 : 1;
