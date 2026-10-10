#!/usr/bin/env node
// Real disposable Docker resources. All created image references are tracked;
// no production image or shared cache is built, altered or pruned.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { withQaCleanup } from './qa-cleanup.mjs';
import {
  dockerCommand,
  dockerInventory,
  QaDockerCleanup,
} from './qa-docker-cleanup.mjs';

assert.equal(process.env.QA_DOCKER_CLEANUP, '1');
const result = [];
function importEmptyFixture(tag) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['import', '--change', 'CMD ["qa-fixture-not-executed"]', '-', tag],
      { stdio: ['pipe', 'ignore', 'ignore'] }
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error('QA_DOCKER_IMPORT_FAILED'));
    });
    child.stdin.end(Buffer.alloc(1024));
  });
}
for (const mode of ['success', 'assertion-failure', 'SIGTERM', 'SIGINT']) {
  const baseline = await dockerInventory();
  const runId = `vac-qa-cleanup-${randomBytes(8).toString('hex')}`;
  const owned = new QaDockerCleanup({ runId, baseline });
  const report = { mode };
  try {
    await withQaCleanup(async (scope, signal) => {
      scope.defer('Docker resources', async () => {
        report.cleanup = await owned.cleanup();
        assert(report.cleanup.pass);
      });
      const tag = `${runId}:fixture`;
      owned.ownImage(tag);
      await importEmptyFixture(tag);
      await dockerCommand([
        'network',
        'create',
        '--label',
        owned.label,
        `${runId}-net`,
      ]);
      await dockerCommand([
        'volume',
        'create',
        '--label',
        owned.label,
        `${runId}-volume`,
      ]);
      const builder = `${runId}-builder`;
      owned.ownBuilder(builder);
      await dockerCommand([
        'buildx',
        'create',
        '--name',
        builder,
        '--driver',
        'docker-container',
      ]);
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
      report.resourcesCreated = true;
      report.containerState = 'created-not-running';
      if (mode === 'assertion-failure') {
        throw new Error('QA_INJECTED_ASSERTION_FAILURE');
      }
      if (mode.startsWith('SIG')) {
        await new Promise((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('QA_SIGNAL_NOT_DELIVERED')),
            5_000
          );
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            { once: true }
          );
          process.kill(process.pid, mode);
        });
      }
    });
    report.expectedOutcome = mode === 'success';
  } catch (error) {
    report.expectedOutcome =
      (mode === 'assertion-failure' &&
        error.message === 'QA_INJECTED_ASSERTION_FAILURE') ||
      error.message === `QA interrupted by ${mode}.`;
  }
  report.pass =
    report.resourcesCreated && report.expectedOutcome && report.cleanup?.pass;
  result.push(report);
}
console.log(JSON.stringify(result));
process.exitCode = result.every((row) => row.pass) ? 0 : 1;
