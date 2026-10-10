#!/usr/bin/env node
// Run all automatic tests inside an owned TMPDIR. Leftovers fail acceptance;
// the wrapper removes that exact directory even after a failed/interrupted run.
import { spawn } from 'node:child_process';
import { readdir, rm, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  qaTemporaryDirectory,
  withQaCleanup,
} from '../experiments/qa-cleanup.mjs';

export function runCleanTests(args = process.argv.slice(2)) {
  return withQaCleanup(async (scope, signal) => {
    if (Number(process.versions.node.split('.')[0]) < 22) {
      throw new Error('The QA runner requires supported Node.js 22 or newer.');
    }
    const directory = await qaTemporaryDirectory(scope, 'vac-suite-');
    const coverage = args.includes('--coverage');
    const strict = args.includes('--strict');
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
      },
      stdio: 'inherit',
      signal,
    });
    const closed = new Promise((done) => {
      child.once('error', () => {});
      child.once('close', (code) => done(code ?? 1));
    });
    scope.defer('test process', async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        await closed;
        clearTimeout(timer);
      }
    });
    const code = await closed;
    const leftovers = await readdir(directory);
    // Runtime/compiler caches belong to this runner's TMPDIR, not to a test
    // fixture. Remove them explicitly; unexpected test residue still fails.
    const caches = new Set(['node-compile-cache', 'xcrun_db']);
    for (const name of leftovers.filter((name) => caches.has(name))) {
      await rm(`${directory}/${name}`, { force: true, recursive: true });
    }
    const testResidue = leftovers.filter((name) => !caches.has(name));
    // Names only: never report contents of a generated fixture.
    console.log(
      JSON.stringify({
        cleanupAudit: true,
        leftoverNames: testResidue,
        ownedRuntimeCachesRemoved: leftovers.filter((name) => caches.has(name)),
      })
    );
    const cleanup = await scope.close();
    const directoryGone = await access(directory).then(
      () => false,
      () => true
    );
    console.log(
      JSON.stringify({ teardownVerified: cleanup.pass && directoryGone })
    );
    return (
      code ||
      ((strict && testResidue.length) || !cleanup.pass || !directoryGone
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
