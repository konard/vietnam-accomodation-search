// Self-authored no-credential control for implicit filesystem recordings.
import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
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
  assert.equal(commander.tracePath, null);
  assert.equal(
    await access(join(directory, 'browser-commander-traces')).then(
      () => true,
      () => false
    ),
    false
  );
  await commander.destroy();
  const managedRoot = join(directory, 'owned-evidence');
  await mkdir(managedRoot, { mode: 0o700 });
  const sentinel = join(managedRoot, 'unrelated-sentinel');
  await writeFile(sentinel, 'self-authored preservation control', {
    mode: 0o600,
  });
  const managed = makeBrowserCommander({
    page: await browser.newPage(),
    logLevel: 'none',
    debug: {
      directory: managedRoot,
      retain: false,
      maxDurationMs: 30000,
    },
  });
  scope.defer('managed commander', () => managed.destroy());
  await managed.ready;
  const path = managed.tracePath;
  assert(
    path &&
      (await realpath(path)).startsWith(
        join(await realpath(directory), 'owned-evidence')
      )
  );
  assert.equal((await stat(path)).mode & 0o777, 0o700);
  await managed.page.setContent('<h1>Self-authored managed recording</h1>');
  await managed.stopDebug({ discard: true });
  assert.equal(
    await access(path).then(
      () => true,
      () => false
    ),
    false
  );
  assert.equal(
    await readFile(sentinel, 'utf8'),
    'self-authored preservation control'
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
      defaultCreatesUnrequestedRecording: false,
      managedOptInWorks: true,
      managedRecordingRemoved: true,
      unrelatedSentinelPreserved: true,
      privateManagedDirectory: true,
      explicitOptOutWorks: true,
      selfAuthoredOnly: true,
    })
  );
});
