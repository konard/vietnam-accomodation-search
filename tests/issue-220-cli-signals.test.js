import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { it } from 'test-anywhere';

it('joins actual deploy producers and releases serialization after SIGINT and SIGTERM', async () => {
  if (
    typeof Bun !== 'undefined' ||
    typeof Deno !== 'undefined' ||
    process.platform === 'win32'
  ) {
    return;
  }
  const child = spawn(process.execPath, [
    'scripts/test-with-cleanup.mjs',
    process.execPath,
    'experiments/revalidation-deploy-signal-lock.mjs',
  ]);
  let output = '';
  child.stdout.on('data', (bytes) => {
    output += bytes;
  });
  child.stderr.on('data', (bytes) => {
    output += bytes;
  });
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  assert.equal(code, 0, output);
  assert.equal(
    (output.match(/"operationLockReleased":true/gu) || []).length,
    2
  );
  assert.match(output, /"teardownVerified":true/u);
});
