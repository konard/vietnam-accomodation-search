#!/usr/bin/env node
// Run all automatic tests inside an owned TMPDIR. Leftovers fail acceptance;
// the wrapper removes that exact directory even after a failed/interrupted run.
// Explicit external-resource journals live in a separate inherited namespace.
import { spawn } from 'node:child_process';
import { readdir, rm, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  qaTemporaryDirectory,
  qaRecoveryNamespace,
  withQaCleanup,
} from '../experiments/qa-cleanup.mjs';

// eslint-disable-next-line max-lines-per-function -- The wrapper keeps process-tree teardown and its independent audits in one scope.
export function runCleanTests(
  args = process.argv.slice(2),
  { idleTimeoutMs = 120_000, terminateGraceMs = 5_000 } = {}
) {
  if (
    !Number.isFinite(idleTimeoutMs) ||
    idleTimeoutMs <= 0 ||
    !Number.isFinite(terminateGraceMs) ||
    terminateGraceMs <= 0
  ) {
    throw new RangeError('Suite watchdog bounds must be positive.');
  }
  // eslint-disable-next-line max-lines-per-function, complexity -- Process ownership, watchdog and cleanup audits share one lifetime.
  return withQaCleanup(async (scope, signal) => {
    if (Number(process.versions.node.split('.')[0]) < 22) {
      throw new Error('The QA runner requires supported Node.js 22 or newer.');
    }
    const recovery = await qaRecoveryNamespace(scope);
    const directory = await qaTemporaryDirectory(scope, 'vac-suite-');
    const coverage = args.includes('--coverage');
    const external = args.filter(
      (arg) => !['--strict', '--coverage'].includes(arg)
    );
    const runtime = external[0] || process.execPath;
    const testArgs = external.length
      ? external.slice(1)
      : [
          '--test',
          '--test-concurrency=1',
          '--test-timeout=30000',
          ...(coverage
            ? [
                '--experimental-test-coverage',
                '--test-coverage-include=src/**/*.js',
                '--test-coverage-lines=100',
              ]
            : []),
          ...(await readdir('tests'))
            .filter((name) => name.endsWith('.test.js'))
            .map((name) => `tests/${name}`),
        ];
    const child = spawn(runtime, testArgs, {
      env: {
        ...process.env,
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
        VAC_QA_RECOVERY_DIRECTORY: recovery,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      signal,
    });
    const closed = new Promise((done) => {
      child.once('error', () => {});
      child.once('close', (code) => done(code ?? 1));
    });
    let escalation;
    let watchdog;
    let timedOut = false;
    const treeCleanup = new Set();
    const killTree = (name) => {
      if (process.platform === 'win32') {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          const cleanup = spawn(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            { stdio: 'ignore' }
          );
          cleanup.on('error', () => {});
          const completed = new Promise((done) => cleanup.once('close', done));
          treeCleanup.add(completed);
        }
      } else if (child.pid) {
        try {
          process.kill(-child.pid, name);
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
        }
      }
    };
    const abort = () => {
      clearTimeout(watchdog);
      killTree('SIGTERM');
      escalation ||= setTimeout(() => killTree('SIGKILL'), terminateGraceMs);
    };
    const heartbeat = () => {
      clearTimeout(watchdog);
      if (timedOut) {
        return;
      }
      watchdog = setTimeout(() => {
        timedOut = true;
        console.error(
          'Test suite inactivity watchdog expired; stopping the owned process tree.'
        );
        abort();
      }, idleTimeoutMs);
    };
    child.stdout.on('data', (data) => {
      process.stdout.write(data);
      heartbeat();
    });
    child.stderr.on('data', (data) => {
      process.stderr.write(data);
      heartbeat();
    });
    heartbeat();
    signal.addEventListener('abort', abort, { once: true });
    scope.defer('test process', async () => {
      if (child.exitCode === null && child.signalCode === null) {
        abort();
        await closed;
      }
      // Workers may outlive their parent even after the parent exits cleanly.
      killTree('SIGKILL');
      await Promise.allSettled([...treeCleanup]);
      clearTimeout(escalation);
      clearTimeout(watchdog);
      signal.removeEventListener('abort', abort);
    });
    const code = (await closed) || (timedOut ? 1 : 0);
    clearTimeout(escalation);
    clearTimeout(watchdog);
    signal.removeEventListener('abort', abort);
    killTree('SIGKILL');
    const leftovers = await readdir(directory);
    // Runtime/compiler caches belong to this runner's TMPDIR, not to a test
    // fixture. Remove them explicitly; unexpected test residue still fails.
    const caches = new Set(
      leftovers.filter(
        (name) =>
          ['node-compile-cache', 'xcrun_db'].includes(name) ||
          /^\.[a-f\d]{16}-\d+\.node-gyp$/u.test(name) ||
          /^bunx-\d+-node-gyp@latest$/u.test(name)
      )
    );
    for (const name of leftovers.filter((name) => caches.has(name))) {
      await rm(`${directory}/${name}`, { force: true, recursive: true });
    }
    const testResidue = leftovers.filter((name) => !caches.has(name));
    const recoveryResidue = await readdir(recovery);
    // Names only: never report contents of a generated fixture.
    console.log(
      JSON.stringify({
        cleanupAudit: true,
        leftoverNames: testResidue,
        ownedRuntimeCachesRemoved: leftovers.filter((name) => caches.has(name)),
        retainedRecoveryDirectories: recoveryResidue.length,
      })
    );
    const cleanup = await scope.close();
    const directoryGone = await access(directory).then(
      () => false,
      () => true
    );
    console.log(
      JSON.stringify({
        teardownVerified: cleanup.pass && directoryGone,
        temporaryTeardownVerified: cleanup.pass && directoryGone,
        // A runner cannot independently certify external teardown. A retained
        // journal proves recovery is required; no journal is not that proof.
        externalTeardownVerified: recoveryResidue.length ? false : null,
        recoveryRequired: recoveryResidue.length > 0,
      })
    );
    return (
      code ||
      (testResidue.length ||
      recoveryResidue.length ||
      !cleanup.pass ||
      !directoryGone
        ? 1
        : 0)
    );
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCleanTests()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
