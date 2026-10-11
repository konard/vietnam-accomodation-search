// No-network, no-credential counterexample for discarded QA gate diagnostics.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

let diagnosed = false;
await withQaCleanup(async (scope, signal) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-source-diagnostic-');
  const lock = join(directory, 'held.lock');
  await mkdir(lock, { mode: 0o700 });
  await writeFile(join(lock, 'owner.json'), 'self-authored held-lock control', {
    mode: 0o600,
  });
  const child = spawn(
    process.execPath,
    [
      'experiments/source-acceptance.mjs',
      'collect',
      '--source',
      'be-jib-nha-trang',
      '--output',
      join(directory, 'evidence'),
    ],
    {
      signal,
      env: {
        PATH: process.env.PATH,
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
        DATA_DIRECTORY: join(directory, 'data'),
        QA_HEAVY_LOCK_DIRECTORY: lock,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-16384);
    });
  }
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  scope.defer('owned diagnostic child', async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await closed;
      } finally {
        clearTimeout(escalation);
      }
    }
  });
  assert.equal(await closed, 1);
  clearTimeout(timer);
  // This directory is created only after matching the source, immediately
  // before guard acquisition. The unchanged held lock forces that guard's
  // deterministic QA_HEAVY_BUSY path before any browser can be acquired.
  await access(join(directory, 'data'));
  assert.equal(
    await readFile(join(lock, 'owner.json'), 'utf8'),
    'self-authored held-lock control'
  );
  diagnosed = output.includes('QA_HEAVY_BUSY');
  console.log(
    JSON.stringify({
      selfAuthoredOnly: true,
      networkAndCredentialsUnused: true,
      gateRejected: true,
      boundedGuardCausePreserved: diagnosed,
      rawFixturePathDisclosed: output.includes(directory),
    })
  );
});
assert(
  diagnosed,
  'Source acceptance discards the bounded guard failure cause.'
);
