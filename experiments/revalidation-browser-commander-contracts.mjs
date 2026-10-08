#!/usr/bin/env node

// Headless, isolated profiles/pages only; no personal browser/session import.
// Optional argument selects a separately installed current upstream module.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const modulePath = resolve(
  process.argv[2] || 'node_modules/browser-commander/src/index.js'
);
const runtime = await import(pathToFileURL(modulePath).href);
const metadata = JSON.parse(
  await readFile(resolve(dirname(modulePath), '../package.json'), 'utf8')
);
const browser = await chromium.launch({ headless: true });
const rows = [];
try {
  for (const tracking of [false, true]) {
    const page = await browser.newPage();
    const commander = runtime.makeBrowserCommander({
      page,
      engine: 'playwright',
      enableNetworkTracking: tracking,
      logLevel: 'none',
    });
    const started = performance.now();
    try {
      const result = await commander.goto({
        url: 'data:text/html,<h1>Self-authored QA fixture</h1>',
        timeout: 4000,
        verify: false,
        waitForStableUrlBefore: false,
        waitForStableUrlAfter: false,
        waitForNetworkIdle: false,
      });
      const elapsedMs = Math.round(performance.now() - started);
      rows.push({
        name: tracking
          ? 'per-call-no-network-wait'
          : 'tracking-disabled-control',
        elapsedMs,
        requestedTimeoutMs: 4000,
        navigated: result.navigated,
        fixturePresent: (await page.locator('h1').textContent()).includes('QA'),
        pass: result.navigated === true && elapsedMs <= 4500,
      });
    } finally {
      await commander.destroy();
      await page.close();
    }
  }
} finally {
  await browser.close();
}
try {
  // Node is deliberately not Chrome. Its rejected Chrome switches provide
  // a deterministic early-exit control without touching an installed browser.
  const unexpected = await runtime.launchRealBrowser({
    engine: 'playwright',
    executablePath: process.execPath,
    headless: true,
    timeout: 2000,
  });
  await unexpected.close();
  rows.push({ name: 'early-exit-diagnostics', pass: false });
} catch (error) {
  const stderrPresent =
    typeof error.stderr === 'string' && error.stderr.length > 0;
  const causePresent = Boolean(error.cause);
  const reasonVisible = /bad option|unknown option/iu.test(error.message);
  rows.push({
    name: 'early-exit-diagnostics',
    errorType: error.constructor.name,
    stderrPresent,
    causePresent,
    reasonVisible,
    pass: stderrPresent || causePresent || reasonVisible,
  });
}
console.log(
  JSON.stringify({
    mode: 'self-authored-browser-diagnostic',
    version: metadata.version,
    rows,
  })
);
process.exitCode = rows.every((row) => row.pass) ? 0 : 1;
