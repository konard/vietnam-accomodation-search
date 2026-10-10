// Self-authored headless trace privacy probe; no credentials or personal tabs.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';

const directory = await mkdtemp(join(tmpdir(), 'vac-qa-trace-privacy-'));
const browser = await chromium.launch();
let commander;
try {
  const page = await browser.newPage();
  commander = makeBrowserCommander({ page, logLevel: 'none' });
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
} finally {
  await commander?.destroy();
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
