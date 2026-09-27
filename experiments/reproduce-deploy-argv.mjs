/**
 * Compare Docker label argv across command-stream versions.
 * Usage: node experiments/reproduce-deploy-argv.mjs /path/to/command-stream/src/$.mjs
 */
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
try {
  const docker = join(directory, 'docker');
  await writeFile(
    docker,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );
  await chmod(docker, 0o700);
  const run = $({
    capture: true,
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    mirror: false,
  });
  const format = '{{json .Config.Labels}}';
  const result =
    await run`docker image inspect --format=${format} candidate:image`;
  const actual = JSON.parse(await result.text());
  const expected = [
    'image',
    'inspect',
    '--format={{json .Config.Labels}}',
    'candidate:image',
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('The Docker label template was split or changed.');
  }
  console.log(JSON.stringify({ argvPreserved: true }));
} finally {
  await rm(directory, { force: true, recursive: true });
}
