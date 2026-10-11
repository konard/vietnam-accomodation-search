// Self-authored no-credential control for implicit filesystem recordings.
import assert from 'node:assert/strict';
import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-default-recording-');
  const original = process.cwd();
  scope.defer('original working directory', () => process.chdir(original));
  process.chdir(directory);
  const browser = await chromium.launch({
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  scope.defer('owned browser', () => browser.close());
  const page = await browser.newPage();
  const commander = makeBrowserCommander({ page, logLevel: 'none' });
  scope.defer('commander', () => commander.destroy());
  await commander.ready;
  await page.setContent('<h1>Self-authored filesystem control</h1>');
  const path = commander.tracePath;
  assert(
    path?.startsWith(
      join(await realpath(directory), 'browser-commander-traces')
    )
  );
  await commander.destroy();
  const retainedAfterDestroy = await access(path).then(
    () => true,
    () => false
  );
  const disabled = makeBrowserCommander({
    page: await browser.newPage(),
    debug: false,
    logLevel: 'none',
  });
  scope.defer('disabled commander', () => disabled.destroy());
  await disabled.ready;
  assert.equal(disabled.tracePath, null);
  console.log(
    JSON.stringify({
      defaultCreatesUnrequestedRecording: true,
      retainedAfterDestroy,
      explicitOptOutWorks: true,
      selfAuthoredOnly: true,
    })
  );
  assert(retainedAfterDestroy);
});
