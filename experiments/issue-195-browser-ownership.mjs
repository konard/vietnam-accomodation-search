// Finite actual-browser control; never touches pre-existing profiles/processes.
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readdir,
  readFile,
  access,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchSettings } from '../src/utils.js';
import { acquireQaBrowser, launchQaBrowser } from './qa-browser.mjs';
import { withQaCleanup } from './qa-cleanup.mjs';

async function ownedPids(profile) {
  const pids = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/u.test(entry)) {
      continue;
    }
    const args = await readFile(`/proc/${entry}/cmdline`, 'utf8').catch(
      () => ''
    );
    if (args.split('\0').includes(`--user-data-dir=${profile}`)) {
      pids.push(Number(entry));
    }
  }
  return pids;
}

const root = await mkdtemp(join(tmpdir(), 'vac-owned-browser-control-'));
const unrelated = join(root, 'unrelated-profile');
const evidence = join(root, 'evidence.json');
await writeFile(unrelated, 'preserve');
await writeFile(evidence, '{}');
const watchdog = setTimeout(() => {
  throw new Error('Finite browser ownership control exceeded 45 seconds.');
}, 45_000);
try {
  for (const scenario of [
    'success',
    'launch-failure',
    'navigation-failure',
    'SIGINT',
    'SIGTERM',
  ]) {
    let profile;
    let pids = [];
    let failed = false;
    try {
      await withQaCleanup(async (scope, signal) => {
        const owned = await acquireQaBrowser(
          scope,
          async (path) => {
            profile = path;
            if (scenario === 'launch-failure') {
              throw new Error('Self-authored launch failure.');
            }
            return await launchQaBrowser(
              launchSettings({
                channel: 'chrome',
                userDataDir: path,
                args: ['--no-sandbox'],
              })
            );
          },
          { signal, temporaryRoot: root }
        );
        pids = await ownedPids(profile);
        assert(pids.length > 0);
        const page = owned.page;
        if (scenario === 'navigation-failure') {
          await page.goto('http://127.0.0.1:1', { timeout: 1000 });
        } else {
          await page.goto('data:text/html,<h1>Owned browser control</h1>', {
            timeout: 1000,
          });
        }
        if (scenario.startsWith('SIG')) {
          process.kill(process.pid, scenario);
          await new Promise((resolve) => setTimeout(resolve, 20));
          signal.throwIfAborted();
        }
      });
    } catch {
      failed = true;
    }
    assert.equal(failed, scenario !== 'success');
    assert.equal(
      await access(profile).then(
        () => true,
        () => false
      ),
      false
    );
    assert.deepEqual(await ownedPids(profile), []);
    for (const pid of pids) {
      const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(
        () => ''
      );
      assert(!command.includes(`--user-data-dir=${profile}`));
    }
    assert.equal(await readFile(unrelated, 'utf8'), 'preserve');
    await access(evidence);
    console.log(
      JSON.stringify({
        scenario,
        profileAbsent: true,
        ownedProcessesAbsent: true,
        unrelatedPreserved: true,
      })
    );
  }
} finally {
  clearTimeout(watchdog);
  await rm(root, { recursive: true, force: true });
}
