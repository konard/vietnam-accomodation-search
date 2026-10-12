import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { it } from 'test-anywhere';
it('imports a larger synthetic corpus inside a fixed 128 MiB heap and streams its complete evidence', async () => {
  if (typeof Deno !== 'undefined' || typeof Bun !== 'undefined') {
    return;
  }
  for (const count of [40, 400]) {
    const child = spawn(process.execPath, [
      '--max-old-space-size=128',
      'experiments/revalidation-cache-import-memory.mjs',
      String(count),
    ]);
    let output = '';
    let errors = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      errors += data;
    });
    const code = await new Promise((done, reject) => {
      child.on('error', reject);
      child.on('close', done);
    });
    assert.equal(code, 0, errors);
    const result = JSON.parse(output.trim());
    assert.equal(result.retained, count);
    assert.ok(result.peakHeap <= 96 * 1024 * 1024);
    assert.equal(result.top[0], 'synthetic-0');
  }
});
