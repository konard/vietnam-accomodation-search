#!/usr/bin/env node
// Two finite, cold Bun tool acquisitions; no C/C++ compilation. All package,
// temporary and Node-header caches are owned by this experiment's QA scope.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withQaCleanup, qaTemporaryDirectory } from './qa-cleanup.mjs';
import { acquireQaStorageGuard } from './qa-storage-guard.mjs';

function acquireTool(scope, runtime, directory, signal) {
  signal.throwIfAborted();
  const child = spawn(
    runtime,
    [
      'x',
      'node-gyp@latest',
      'install',
      '--target=22.23.3',
      '--ensure',
      '--devdir',
      join(directory, 'headers'),
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        BUN_INSTALL_CACHE_DIR: join(directory, 'cache'),
        TMPDIR: join(directory, 'tmp'),
        TMP: join(directory, 'tmp'),
        TEMP: join(directory, 'tmp'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-128 * 1024);
    });
  }
  child.once('error', () => {});
  const closed = new Promise((done) =>
    child.once('close', (code) =>
      done({
        code,
        incompleteTool:
          /Cannot find module|ENOENT.*node-gyp@latest|semver.*ENOENT/u.test(
            output
          ),
        output,
      })
    )
  );
  let stopping;
  const stop = () =>
    (stopping ||= (async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await closed;
        clearTimeout(timer);
      }
    })());
  const abort = () => {
    void stop();
  };
  signal.addEventListener('abort', abort, { once: true });
  scope.defer('Bun tool process', async () => {
    signal.removeEventListener('abort', abort);
    await stop();
  });
  return closed;
}

await withQaCleanup(async (scope, signal) => {
  const runtime = process.argv[2] ? resolve(process.argv[2]) : 'bun';
  const directory = await qaTemporaryDirectory(scope, 'vac-bun-gyp-race-');
  const guard = await acquireQaStorageGuard(scope, {
    paths: [directory],
    signal,
  });
  for (const mode of ['parallel', 'serial']) {
    const root = join(directory, mode);
    await mkdir(join(root, 'tmp'), { recursive: true });
    const first = acquireTool(scope, runtime, root, guard.signal);
    const outcomes =
      mode === 'parallel'
        ? await Promise.all([
            first,
            acquireTool(scope, runtime, root, guard.signal),
          ])
        : [await first, await acquireTool(scope, runtime, root, guard.signal)];
    console.log(
      JSON.stringify({
        mode,
        outcomes: outcomes.map(({ code, incompleteTool }) => ({
          code,
          incompleteTool,
        })),
      })
    );
    for (const outcome of outcomes.filter(({ code }) => code !== 0)) {
      process.stderr.write(outcome.output);
    }
    if (mode === 'serial' && outcomes.some(({ code }) => code !== 0)) {
      throw new Error('Serialized tool acquisition failed.');
    }
    await guard.check();
  }
});
