import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { it } from 'test-anywhere';
it('stops an escaped test timer and completes the cleanup audit', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const child = spawn(
    process.execPath,
    ['experiments/revalidation-suite-watchdog.mjs'],
    { env: { ...process.env, VAC_QA_RECOVERY_DIRECTORY: '' } }
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const code = await new Promise((done, reject) => {
    child.on('error', reject);
    child.on('close', done);
  });
  assert.equal(code, 1);
  assert.match(output, /watchdog expired/u);
  assert.match(output, /"teardownVerified":true/u);
});
