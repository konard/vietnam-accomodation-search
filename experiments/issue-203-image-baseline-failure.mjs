// Bounded no-daemon control: fake only this child's Docker CLI and fail its
// initial inventory before any producer exists. The strict wrapper must find
// no orphan temporary recovery directory. Does not access a real Docker host.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-fake-docker-');
  const fake = join(directory, 'docker');
  await writeFile(
    fake,
    '#!/usr/bin/env node\nif (process.argv[2] === "info") console.log(process.cwd()); else process.exit(1);\n',
    { mode: 0o700 }
  );
  const result = await promisify(execFile)(
    process.execPath,
    [
      'scripts/test-with-cleanup.mjs',
      'node',
      'experiments/issue-177-docker-acceptance.mjs',
    ],
    {
      env: {
        ...process.env,
        QA_DOCKER_ACCEPTANCE: '1',
        PATH: `${directory}${delimiter}${process.env.PATH}`,
      },
      maxBuffer: 128 * 1024,
    }
  ).then(
    () => {
      throw new Error('The inventory fault must reject acceptance.');
    },
    (error) => error
  );
  const audit = result.stdout
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    })
    .find((row) => Object.hasOwn(row, 'cleanupAudit'));
  assert.equal(audit?.cleanupAudit, true);
  assert.deepEqual(audit.leftoverNames, []);
  console.log(
    JSON.stringify({
      inventoryFaultRejected: true,
      producerAcquired: false,
      orphanDirectories: 0,
    })
  );
});
