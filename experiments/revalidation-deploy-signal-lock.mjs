// Actual deploy CLI control with synthetic command/configuration boundaries.
// No Docker daemon, network, credentials or original deployment state.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setInterval } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { mock } from 'node:test';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

const exists = (path) =>
  access(path).then(
    () => true,
    () => false
  );

if (process.argv[2] === '--worker') {
  const directory = process.argv[3];
  const lock = join(directory, '.deploy', 'operation.lock');
  const configuration = {
    projectName: 'vac-qa-signal-lock',
    dataDirectory: join(directory, 'data'),
    composeFile: join(directory, 'compose.yaml'),
    readyTimeout: 1,
    settleSeconds: 1,
    allowSharedToken: false,
  };
  const fakeCommand =
    () =>
    (strings, ...values) => {
      const command = String.raw({ raw: strings }, ...values);
      if (command.startsWith('git ')) {
        return Promise.resolve({
          text: () =>
            Promise.resolve(
              command.includes('rev-parse')
                ? '0'.repeat(40)
                : '2026-01-01T00:00:00+00:00'
            ),
        });
      }
      assert(command.startsWith('docker compose'));
      return exists(lock).then((acquired) => {
        assert(acquired, 'The real CLI must acquire its operation lock.');
        process.send({ operationLockAcquired: true });
        // A real command producer keeps the process alive at the same boundary.
        setInterval(() => {}, 1000);
        return new Promise(() => {});
      });
    };
  const dependencyUrl = new URL('../scripts/use-module.mjs', import.meta.url);
  const original = await import(dependencyUrl.href);
  mock.module(dependencyUrl.href, {
    exports: {
      ...original,
      loadCommandStream: () => Promise.resolve({ $: fakeCommand }),
      loadLinoArguments: () =>
        Promise.resolve({ makeConfig: () => configuration }),
    },
  });
  const { runDeployCli } = await import('../scripts/deploy.mjs');
  await runDeployCli(['deploy']);
} else {
  await withQaCleanup(async (scope, signal) => {
    const directory = await realpath(
      await qaTemporaryDirectory(scope, 'vac-deploy-signal-')
    );
    await writeFile(
      join(directory, 'package.json'),
      '{"name":"self-authored-qa","version":"0.0.0"}'
    );
    const child = spawn(
      process.execPath,
      [
        '--experimental-test-module-mocks',
        fileURLToPath(import.meta.url),
        '--worker',
        directory,
      ],
      { cwd: directory, signal, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }
    );
    const stopped = new Promise((done) => {
      child.once('error', () => {});
      child.once('close', (code, receivedSignal) =>
        done({ code, signal: receivedSignal })
      );
    });
    scope.defer('owned signal worker', async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await stopped;
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Controlled deploy did not reach its lock.')),
        10_000
      );
      child.once('message', (message) => {
        clearTimeout(timer);
        assert.equal(message.operationLockAcquired, true);
        resolve();
      });
      child.once('close', () => {
        clearTimeout(timer);
        reject(new Error('Controlled deploy exited before lock acquisition.'));
      });
    });
    child.kill('SIGTERM');
    const closed = await stopped;
    assert.equal(closed.signal, 'SIGTERM');
    const operationLockReleased = !(await exists(
      join(directory, '.deploy', 'operation.lock')
    ));
    console.log(
      JSON.stringify({
        selfAuthoredOnly: true,
        actualDeployCliInvoked: true,
        workerStopped: true,
        operationLockReleased,
        noNetworkOrDocker: true,
      })
    );
    assert(
      operationLockReleased,
      'Interrupted controlled deploy with no external resources must release its owned operation lock.'
    );
  });
}
