#!/usr/bin/env node
// Offline, finite lifecycle-script ownership control. No native compilation.
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';
import { acquireQaStorageGuard } from './qa-storage-guard.mjs';

const INSTALL_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.QA_LIFECYCLE_ROOT;
const lock = path.join(root, 'lifecycle-lock');
try { fs.mkdirSync(lock); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  fs.writeFileSync(path.join(root, 'overlap'), 'observed');
  process.exit(0);
}
setTimeout(() => fs.rmdirSync(lock), 1000);
`;

async function fixture(root, configuration) {
  const dependencies = {};
  for (const name of ['owned-a', 'owned-b']) {
    const directory = join(root, 'packages', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        scripts: { postinstall: 'node install.cjs' },
      })
    );
    await writeFile(join(directory, 'install.cjs'), INSTALL_SCRIPT);
    dependencies[name] = `file:./packages/${name}`;
  }
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'owned-install-control',
      version: '1.0.0',
      dependencies,
      trustedDependencies: Object.keys(dependencies),
    })
  );
  if (configuration) {
    await writeFile(join(root, 'bunfig.toml'), configuration);
  }
}

async function install(scope, runtime, root, signal) {
  signal.throwIfAborted();
  const child = spawn(runtime, ['install', '--offline'], {
    cwd: root,
    env: {
      ...process.env,
      QA_LIFECYCLE_ROOT: root,
      BUN_INSTALL_CACHE_DIR: join(root, 'cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-16384);
    });
  }
  const closed = new Promise((done) => {
    child.once('error', () => {});
    child.once('close', (code) => done(code));
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timer);
  };
  const abort = () => {
    void stop();
  };
  signal.addEventListener('abort', abort, { once: true });
  scope.defer('offline Bun install', async () => {
    signal.removeEventListener('abort', abort);
    await stop();
  });
  if ((await closed) !== 0) {
    throw new Error(`Offline install failed: ${output}`);
  }
  return access(join(root, 'overlap')).then(
    () => true,
    () => false
  );
}

await withQaCleanup(async (scope, signal) => {
  const runtime = process.argv[2] ? resolve(process.argv[2]) : 'bun';
  const directory = await qaTemporaryDirectory(scope, 'vac-bun-install-');
  const guard = await acquireQaStorageGuard(scope, {
    paths: [directory],
    signal,
  });
  const configuration = await readFile('bunfig.toml', 'utf8');
  for (const mode of ['default', 'repository']) {
    const root = join(directory, mode);
    await fixture(root, mode === 'repository' ? configuration : '');
    const overlap = await install(scope, runtime, root, guard.signal);
    console.log(JSON.stringify({ mode, overlap }));
    if (overlap !== (mode === 'default')) {
      throw new Error(
        'Unexpected lifecycle concurrency: repository installs must serialize.'
      );
    }
    await guard.check();
  }
});
