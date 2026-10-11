// Shows how long browser-commander's goto() waits for a server that accepts
// the request and never answers, with and without an explicit timeout.
// Usage: BROWSER_NO_SANDBOX=1 node experiments/issue-96-goto-timeout.mjs [timeoutMs]
import { createServer } from 'node:http';

import { launchSettings, openCommander } from '../src/utils.js';

import { withQaCleanup } from './qa-cleanup.mjs';

const timeoutMs = Number(process.argv[2] || 1000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
  throw new RangeError('Use a finite timeout between 1 and 30000 ms.');
}
await withQaCleanup(async (scope, signal) => {
  const server = createServer(() => {});
  scope.defer('server', () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/stalled`;
  const runtime = await import('browser-commander');
  const { browser, page } = await runtime.launchBrowser(
    launchSettings({
      args: process.env.BROWSER_NO_SANDBOX ? ['--no-sandbox'] : [],
    })
  );
  scope.defer('browser', () => browser.close());
  const commander = openCommander(runtime, page);
  scope.defer('commander', () => commander.destroy());
  console.log('launched');
  const started = Date.now();
  try {
    await commander.goto({
      url,
      waitForNetworkIdle: false,
      signal,
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    });
    console.log('loaded', Date.now() - started);
  } catch (error) {
    console.log('failed', Date.now() - started, error.message.slice(0, 120));
  } finally {
    console.log('closing', Date.now() - started);
  }
});
