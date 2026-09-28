/**
 * Compare Docker label argv across command-stream versions.
 * Usage: node experiments/reproduce-deploy-argv.mjs /path/to/command-stream/src/$.mjs
 */
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) {
  throw new Error(
    'Usage: node experiments/reproduce-deploy-argv.mjs /path/to/command-stream/src/$.mjs'
  );
}
const imported = await import(pathToFileURL(process.argv[2]).href);
const $ = imported.$ || imported.default?.$;
const directory = await mkdtemp(join(tmpdir(), 'docker-label-argv-'));
const previousPath = process.env.PATH;
try {
  const docker = join(directory, 'docker');
  await writeFile(
    docker,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );
  await chmod(docker, 0o700);
  // command-stream invokes a login shell. On macOS that shell can reorder
  // PATH and select the real Docker executable before this fake one.
  process.env.PATH = `${directory}:${previousPath || ''}`;
  let fakeSelectedByLoginShell = true;
  if (process.platform !== 'win32') {
    const resolved = spawnSync('/bin/sh', ['-l', '-c', 'command -v docker'], {
      encoding: 'utf8',
      env: process.env,
    });
    fakeSelectedByLoginShell =
      resolved.status === 0 && resolved.stdout.trim() === docker;
  }
  const run = $({
    capture: true,
    env: { ...process.env },
    mirror: false,
  });
  const format = '{{json .Config.Labels}}';
  const result = fakeSelectedByLoginShell
    ? await run`docker image inspect --format=${format} candidate:image`
    : await run`${docker} image inspect --format=${format} candidate:image`;
  const output = await result.text();
  if (!output.trim()) {
    throw new Error(
      `Fake Docker produced no captured output (exit=${result.code ?? 'unknown'}, stderrBytes=${String(result.stderr ?? '').length}).`
    );
  }
  const actual = JSON.parse(output);
  const expected = [
    'image',
    'inspect',
    '--format={{json .Config.Labels}}',
    'candidate:image',
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('The Docker label template was split or changed.');
  }
  console.log(
    JSON.stringify({ argvPreserved: true, fakeSelectedByLoginShell })
  );
} finally {
  if (previousPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = previousPath;
  }
  await rm(directory, { force: true, recursive: true });
}
