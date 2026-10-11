// Actual production launch/commander policy on an owned self-authored page.
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser, makeBrowserCommander } from 'browser-commander';
import { launchSettings, openCommander } from '../src/utils.js';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-recording-policy-');
  const original = process.cwd();
  const debug = process.env.BROWSER_COMMANDER_DEBUG;
  const temporary = Object.fromEntries(
    ['TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]])
  );
  const baseline = await readdir(original);
  scope.defer('original browser debug policy', () => {
    if (debug === undefined) {
      delete process.env.BROWSER_COMMANDER_DEBUG;
    } else {
      process.env.BROWSER_COMMANDER_DEBUG = debug;
    }
    process.chdir(original);
    for (const [key, value] of Object.entries(temporary)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
  process.chdir(directory);
  process.env.BROWSER_COMMANDER_DEBUG = '1';
  Object.assign(process.env, {
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
  });
  const launched = await launchBrowser(
    launchSettings({
      userDataDir: join(directory, 'profile'),
      args: ['--no-sandbox'],
    })
  );
  scope.defer('owned launch', () => launched.close());
  assert.equal(launched.tracePath, null);
  const commander = openCommander({ makeBrowserCommander }, launched.page);
  scope.defer('owned commander', () => commander.destroy());
  await commander.ready;
  await launched.page.setContent(
    '<h1>Self-authored recording policy control</h1>'
  );
  assert.equal(commander.tracePath, null);
  await commander.destroy();
  await launched.close();
  await assert.rejects(access(join(directory, 'browser-commander-traces')));
  assert.deepEqual(await readdir(original), baseline);
  console.log(
    JSON.stringify({
      productionLaunchTraceDisabled: true,
      productionCommanderTraceDisabled: true,
      hostDebugOverrideRejected: true,
      checkoutUnchanged: true,
    })
  );
});
