#!/usr/bin/env node
// Build the pinned production image in an isolated builder and dispose only
// this run's image, builder and cache. No credentials or production mounts.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withQaCleanup } from './qa-cleanup.mjs';
import {
  dockerCommand,
  dockerInventory,
  QaDockerCleanup,
} from './qa-docker-cleanup.mjs';
import {
  safeQaFailure,
  annotateDockerFailure,
} from './qa-docker-diagnostics.mjs';
import {
  acquireQaStorageGuard,
  qaDockerStoragePaths,
} from './qa-storage-guard.mjs';

assert.equal(process.env.QA_DOCKER_ACCEPTANCE, '1');
const command = (args, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit', signal });
    let failure;
    let escalation;
    const abort = () => {
      escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', (code) => {
      clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) {
        reject(signal.reason);
      } else if (code === 0 && !failure) {
        resolve();
      } else {
        reject(
          annotateDockerFailure(
            failure ||
              Object.assign(new Error('Docker acceptance failed.'), { code }),
            args
          )
        );
      }
    });
  });
await withQaCleanup(
  async (scope, signal) => {
    const guard = await acquireQaStorageGuard(scope, {
      signal,
      paths: await qaDockerStoragePaths(dockerCommand),
    });
    signal = guard.signal;
    const directory = await mkdtemp(join(tmpdir(), 'vac-docker-acceptance-'));
    let clean = false;
    scope.defer('private Docker recovery directory', async () => {
      if (clean) {
        await rm(directory, { recursive: true, force: true });
      }
    });
    const runId = `vac-qa-image-${randomBytes(8).toString('hex')}`;
    const tag = `${runId}:fixture`;
    const builder = `${runId}-builder`;
    const baseline = await dockerInventory();
    const owned = new QaDockerCleanup({
      runId,
      baseline,
      journal: join(directory, 'owned.json'),
      run: async (args) => {
        try {
          return await dockerCommand(args);
        } catch (error) {
          if (process.env.QA_DOCKER_DEBUG === '1') {
            console.error(
              JSON.stringify({ qaDockerFailure: safeQaFailure(error) })
            );
          }
          throw error;
        }
      },
    });
    scope.defer('production acceptance Docker resources', async () => {
      const result = await owned.cleanup();
      clean = result.pass;
      console.log(JSON.stringify({ dockerCleanup: result }));
      assert(result.pass);
    });
    owned.ownImage(tag);
    owned.ownBuilder(builder);
    if (
      !baseline.images.some((row) =>
        row.endsWith(' moby/buildkit:buildx-stable-1')
      )
    ) {
      owned.ownImage('moby/buildkit:buildx-stable-1');
    }
    await owned.save();
    await guard.check();
    await dockerCommand(
      ['buildx', 'create', '--name', builder, '--driver', 'docker-container'],
      { signal }
    );
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const date = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const version = JSON.parse(
      execFileSync(
        'node',
        ['-p', 'JSON.stringify(require("./package.json"))'],
        {
          encoding: 'utf8',
        }
      )
    ).version;
    await command(
      [
        'buildx',
        'build',
        '--builder',
        builder,
        '--load',
        '--progress=plain',
        '--tag',
        tag,
        '--build-arg',
        `VCS_REF=${revision}`,
        '--build-arg',
        `BUILD_DATE=${date}`,
        '--build-arg',
        `NPM_PACKAGE_VERSION=${version}`,
        '.',
      ],
      signal
    );
    await guard.check();
    await command(
      [
        'run',
        '--rm',
        '--label',
        owned.label,
        '--cap-drop=ALL',
        '--security-opt',
        'no-new-privileges',
        '--read-only',
        '--tmpfs',
        '/tmp:mode=1777',
        '--env',
        'BROWSER_NO_SANDBOX=1',
        '--volume',
        `${directory}:/data`,
        '--volume',
        `${process.cwd()}/experiments/issue-163-docker-smoke.mjs:/app/issue-163-docker-smoke.mjs:ro`,
        '--entrypoint',
        'node',
        tag,
        'issue-163-docker-smoke.mjs',
      ],
      signal
    );
    await guard.check();
  },
  { cleanupTimeoutMs: 120_000 }
);
