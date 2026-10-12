// Finite filesystem/daemon doubles exercise actual ownership and recovery APIs.
// No Docker daemon, Telegram, credentials or user resources are used.
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cleanup from './qa-cleanup.mjs';
import { dockerInventory, QaDockerCleanup } from './qa-docker-cleanup.mjs';
import { acquireQaStorageGuard } from './qa-storage-guard.mjs';
import {
  prepareDockerCapacityProbe,
  recoverDockerCapacityProbe,
} from './qa-docker-capacity.mjs';
import { capacityBootstrapDaemon } from './qa-capacity-bootstrap-fixture.mjs';
import { acquireQaBrowser } from './qa-browser.mjs';

const root = process.env.QA_RECOVERY_FIXTURE_ROOT;
assert(root);
const stateFile = join(root, 'external.json');
const reportFile = join(root, 'report.json');
const mode = process.argv[2];
const baseline = ['unrelated-baseline-resource'];

function imageDaemon({ recovering = false } = {}) {
  return async (args) => {
    const state = JSON.parse(await readFile(stateFile));
    if (args[0] === 'image' && args[1] === 'ls') {
      return state.resources
        .filter((ref) => ref !== baseline[0])
        .map((ref) => `sha256:self-authored ${ref}`)
        .join('\n');
    }
    if (args[0] === 'image' && args[1] === 'rm') {
      assert.equal(args[2], 'vac-qa-recovery-fixture:owned');
      if (!recovering) {
        throw new Error('Injected exact image disposal failure.');
      }
      state.resources = state.resources.filter((ref) => ref !== args[2]);
      await writeFile(stateFile, JSON.stringify(state));
    }
    return '';
  };
}

if (mode === 'recover') {
  const report = JSON.parse(await readFile(reportFile));
  const kind = process.argv[3];
  if (kind === 'image') {
    const cleaner = await QaDockerCleanup.restore(report.journal, {
      run: imageDaemon({ recovering: true }),
    });
    assert.equal((await cleaner.cleanup()).pass, true);
  } else if (kind === 'guest') {
    const daemon = capacityBootstrapDaemon(
      join(report.directory, 'heavy.lock')
    );
    daemon.images.add('busybox:1.37.0');
    await recoverDockerCapacityProbe(daemon.run, report.journal);
    assert.deepEqual(await dockerInventory(daemon.run), report.baseline);
    const state = JSON.parse(await readFile(stateFile));
    state.resources = baseline;
    await writeFile(stateFile, JSON.stringify(state));
  } else {
    const journal = JSON.parse(await readFile(report.journal));
    assert.equal(
      journal.owned,
      kind === 'browser'
        ? 'self-authored-owned-browser'
        : 'self-authored-owned-marker'
    );
    const state = JSON.parse(await readFile(stateFile));
    state.resources = state.resources.filter(
      (resource) => resource !== journal.owned
    );
    await writeFile(stateFile, JSON.stringify(state));
  }
  const state = JSON.parse(await readFile(stateFile));
  assert.deepEqual(state.resources, baseline);
  state.baselineVerified = true;
  await writeFile(stateFile, JSON.stringify(state));
  await rm(report.directory, { recursive: true });
} else {
  await cleanup
    .withQaCleanup(async (scope, signal) => {
      const disposable = await cleanup.qaTemporaryDirectory(scope);
      const directory =
        mode === 'browser'
          ? disposable
          : await cleanup.qaRecoveryDirectory(scope);
      let journal = join(directory, 'owned.json');
      const report = { directory, journal, disposable };
      await writeFile(stateFile, JSON.stringify({ resources: baseline }));
      await writeFile(
        journal,
        JSON.stringify({ owned: 'self-authored-owned-marker' })
      );
      if (mode === 'image') {
        const run = imageDaemon();
        const owned = new QaDockerCleanup({
          runId: 'vac-qa-recovery-fixture',
          baseline: await dockerInventory(run),
          journal,
          run,
        });
        owned.ownImage('vac-qa-recovery-fixture:owned');
        await owned.save();
        await writeFile(
          stateFile,
          JSON.stringify({
            resources: [...baseline, 'vac-qa-recovery-fixture:owned'],
          })
        );
        scope.defer('image resources', async () =>
          assert.equal((await owned.cleanup()).pass, true)
        );
      } else if (mode === 'guest') {
        const lockDirectory = join(directory, 'heavy.lock');
        const daemon = capacityBootstrapDaemon(lockDirectory, {
          failCleanup: true,
        });
        report.baseline = await dockerInventory(daemon.run);
        const paths = [root];
        paths.prepareCapacity = (scope, lock, signal) =>
          prepareDockerCapacityProbe(daemon.run, scope, lock, signal, {});
        await acquireQaStorageGuard(scope, {
          paths,
          lockDirectory,
          signal,
          statfsImpl: () =>
            Promise.resolve({ bavail: 20n * 1024n ** 3n, bsize: 1n }),
        });
        journal = join(lockDirectory, 'docker-capacity.json');
        report.journal = journal;
        await writeFile(
          stateFile,
          JSON.stringify({ resources: [...baseline, 'busybox:1.37.0'] })
        );
      } else if (mode === 'browser') {
        const browser = await acquireQaBrowser(scope, async (profile) => {
          report.directory = profile;
          report.journal = join(profile, 'owned.json');
          await writeFile(
            report.journal,
            JSON.stringify({ owned: 'self-authored-owned-browser' })
          );
          await writeFile(
            stateFile,
            JSON.stringify({
              resources: [...baseline, 'self-authored-owned-browser'],
            })
          );
          return {
            browser: {
              close: () => {
                throw new Error('Injected owned browser disposal failure.');
              },
            },
          };
        });
        assert.equal(browser.profile, report.directory);
      } else if (mode === 'marker') {
        await writeFile(
          stateFile,
          JSON.stringify({
            resources: [...baseline, 'self-authored-owned-marker'],
          })
        );
        scope.defer('external marker', () => {
          throw new Error('Injected external marker disposal failure.');
        });
      }
      await writeFile(reportFile, JSON.stringify(report));
      if (mode.endsWith('-failure')) {
        throw new Error('Injected ordinary failure.');
      }
      if (mode.startsWith('SIG')) {
        // IPC-style delivery also exercises the real handlers on Windows.
        process.emit(mode);
        signal.throwIfAborted();
      }
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
