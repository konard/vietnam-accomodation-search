#!/usr/bin/env node
// Disposable real Docker controls, including populated isolated build caches
// and journal recovery after an actual worker SIGKILL. Never prunes shared data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withQaCleanup } from './qa-cleanup.mjs';
import {
  dockerCommand as executeDocker,
  dockerInventory,
  QaDockerCleanup,
} from './qa-docker-cleanup.mjs';

assert.equal(process.env.QA_DOCKER_CLEANUP, '1');

async function dockerCommand(args) {
  try {
    return await executeDocker(args);
  } catch (error) {
    // Fixed operation names and categories only, never raw command output.
    error.qaOperation = args.slice(0, 2).join(' ');
    error.qaCategory = /timeout|timed out/iu.test(error.stderr || '')
      ? 'command-timeout'
      : /network|resolve|download|fetch|EOF/iu.test(error.stderr || '')
        ? 'external-acquisition'
        : 'command-failure';
    throw error;
  }
}

async function acquire(owned, directory, setupFailure = false) {
  const runId = owned.runId;
  await dockerCommand([
    'network',
    'create',
    '--label',
    owned.label,
    `${runId}-net`,
  ]);
  if (setupFailure) {
    throw new Error('QA_INJECTED_SETUP_FAILURE');
  }
  await dockerCommand([
    'volume',
    'create',
    '--label',
    owned.label,
    `${runId}-volume`,
  ]);
  const builder = [...owned.builders][0];
  const tag = `${runId}:fixture`;
  await dockerCommand([
    'buildx',
    'create',
    '--name',
    builder,
    '--driver',
    'docker-container',
  ]);
  await dockerCommand([
    'buildx',
    'build',
    '--builder',
    builder,
    '--load',
    '--tag',
    tag,
    directory,
  ]);
  const cache = await dockerCommand(['buildx', 'du', '--builder', builder]);
  assert.match(cache, /Total:/);
  assert(
    !/Total:\s+0B\b/u.test(cache),
    'The fixture must populate the isolated cache.'
  );
  await dockerCommand(['image', 'tag', tag, `${runId}:rollback`]);
  await dockerCommand([
    'create',
    '--name',
    `${runId}-container`,
    '--label',
    owned.label,
    '--network',
    `${runId}-net`,
    '--mount',
    `type=volume,src=${runId}-volume,dst=/data`,
    tag,
  ]);
}

if (process.argv[2] === '--hard-kill-worker') {
  const directory = process.argv[3];
  await acquire(
    await QaDockerCleanup.restore(join(directory, 'owned.json')),
    directory
  );
  process.send({ ready: true });
  setTimeout(() => process.exit(1), 120_000);
} else {
  const results = [];
  for (const mode of [
    'success',
    'setup-failure',
    'assertion-failure',
    'SIGTERM',
    'SIGINT',
    'SIGKILL-recovery',
  ]) {
    const directory = await mkdtemp(join(tmpdir(), 'vac-docker-controls-'));
    const runId = `vac-qa-cleanup-${randomBytes(8).toString('hex')}`;
    let owned = new QaDockerCleanup({
      runId,
      baseline: await dockerInventory(),
      journal: join(directory, 'owned.json'),
    });
    const report = { mode };
    let child;
    try {
      await withQaCleanup(
        async (scope, signal) => {
          scope.defer('Docker resources', async () => {
            report.cleanup = await owned.cleanup();
            assert(report.cleanup.pass);
          });
          scope.defer('worker', async () => {
            if (child && child.exitCode === null && child.signalCode === null) {
              const ended = new Promise((resolve) =>
                child.once('close', resolve)
              );
              child.kill('SIGKILL');
              await ended;
            }
          });
          owned.ownImage(`${runId}:fixture`);
          owned.ownImage(`${runId}:rollback`);
          owned.ownBuilder(`${runId}-builder`);
          if (
            !owned.baseline.images.some((row) =>
              row.endsWith(' moby/buildkit:buildx-stable-1')
            )
          ) {
            owned.ownImage('moby/buildkit:buildx-stable-1');
          }
          await owned.save();
          await writeFile(
            join(directory, 'payload'),
            'self-authored bounded cache fixture'
          );
          await writeFile(
            join(directory, 'Dockerfile'),
            'FROM scratch\nCOPY payload /payload\nCMD ["qa-fixture-not-executed"]\n'
          );
          if (mode === 'SIGKILL-recovery') {
            child = spawn(
              process.execPath,
              [process.argv[1], '--hard-kill-worker', directory],
              { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }
            );
            const ended = new Promise((resolve) =>
              child.once('close', resolve)
            );
            await new Promise((resolve, reject) => {
              child.once('error', reject);
              child.once('message', resolve);
              child.once('exit', () =>
                reject(new Error('Worker exited before acquisition.'))
              );
            });
            child.kill('SIGKILL');
            await ended;
            owned = await QaDockerCleanup.restore(
              join(directory, 'owned.json')
            );
            report.hardKillRecovered = true;
          } else {
            await acquire(owned, directory, mode === 'setup-failure');
          }
          report.populatedCache = true;
          if (mode === 'assertion-failure') {
            throw new Error('QA_INJECTED_ASSERTION_FAILURE');
          }
          if (mode.startsWith('SIG') && mode !== 'SIGKILL-recovery') {
            await new Promise((_resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('QA_SIGNAL_NOT_DELIVERED')),
                5000
              );
              signal.addEventListener('abort', () => reject(signal.reason), {
                once: true,
              });
              signal.addEventListener('abort', () => clearTimeout(timer), {
                once: true,
              });
              process.kill(process.pid, mode);
            });
          }
        },
        { cleanupTimeoutMs: 90_000 }
      );
      report.expectedOutcome = ['success', 'SIGKILL-recovery'].includes(mode);
    } catch (error) {
      report.failure = {
        operation: error.qaOperation,
        category: error.qaCategory,
        code: error.code,
        killed: error.killed,
        signal: error.signal,
        assertion: error.name === 'AssertionError',
      };
      report.expectedOutcome =
        (mode === 'setup-failure' &&
          error.message === 'QA_INJECTED_SETUP_FAILURE') ||
        (mode === 'assertion-failure' &&
          error.message === 'QA_INJECTED_ASSERTION_FAILURE') ||
        error.message === `QA interrupted by ${mode}.`;
    } finally {
      if (report.cleanup?.pass) {
        await rm(directory, { recursive: true, force: true });
      }
    }
    report.pass = report.expectedOutcome && report.cleanup?.pass;
    results.push(report);
  }
  console.log(JSON.stringify(results));
  process.exitCode = results.every((row) => row.pass) ? 0 : 1;
}
