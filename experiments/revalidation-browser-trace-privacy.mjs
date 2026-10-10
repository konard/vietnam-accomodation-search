// Self-authored headless trace privacy probe; no credentials or personal tabs.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { withQaCleanup, qaTemporaryDirectory } from './qa-cleanup.mjs';

await withQaCleanup(async (scope) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-qa-trace-privacy-');
  const browser = await chromium.launch();
  scope.defer('browser', () => browser.close());
  const page = await browser.newPage();
  const commander = makeBrowserCommander({ page, logLevel: 'none' });
  scope.defer('commander', () => commander.destroy());
  const trace = await commander.startTrace({
    output: directory,
    mode: 'checkpoints',
    screenshots: false,
    privacy: { redactPatterns: [/QA_PRIVATE_SENTINEL/gu] },
  });
  await page.setContent(
    '<h1>Self-authored public control</h1><div>QA_PRIVATE_SENTINEL</div>'
  );
  await trace.checkpoint('self-authored-privacy-control');
  await trace.stop();
  const payloads = [];
  for (const name of await readdir(join(directory, 'checkpoints'))) {
    // Manifest privacy settings necessarily contain the pattern itself;
    // inspect only actual HTML checkpoint payloads, not configuration.
    if (name.endsWith('.html')) {
      payloads.push(
        await readFile(join(directory, 'checkpoints', name), 'utf8')
      );
    }
  }
  assert(
    payloads.some((html) => html.includes('Self-authored public control'))
  );
  const redactionApplied = payloads.every(
    (html) => !html.includes('QA_PRIVATE_SENTINEL')
  );
  console.log(
    JSON.stringify({ htmlCapturePositiveControl: true, redactionApplied })
  );
  assert(
    redactionApplied,
    'Configured trace text redaction must apply to checkpoint HTML payloads.'
  );
});
