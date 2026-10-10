import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { gotoPage } from '../src/utils.js';

// Finite local stalled-response controls, no public-site load or credentials.
const server = createServer(() => {});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const results = [];
try {
  for (const callerAbort of [false, true]) {
    const page = await browser.newPage();
    const commander = makeBrowserCommander({ page });
    const controller = new AbortController();
    const reason = new Error('Self-authored caller abort');
    const timer = callerAbort
      ? setTimeout(() => controller.abort(reason), 100)
      : undefined;
    const started = Date.now();
    try {
      await gotoPage(
        commander,
        `http://127.0.0.1:${server.address().port}`,
        400,
        controller.signal
      );
      throw new Error('Stalled navigation unexpectedly succeeded');
    } catch (error) {
      const elapsedMs = Date.now() - started;
      assert.ok(elapsedMs < 1500);
      if (callerAbort) {
        assert.equal(error, reason);
      } else {
        assert.equal(error.code, 'BROWSER_NAVIGATION_FAILED');
      }
      results.push({
        name: callerAbort ? 'caller-abort' : 'deadline',
        elapsedMs,
        pass: true,
      });
    } finally {
      clearTimeout(timer);
      await commander.destroy();
      await page.close();
    }
  }
  console.log(
    JSON.stringify({ mode: 'self-authored-local-navigation', results })
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
