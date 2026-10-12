import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { it } from 'test-anywhere';

const nodeIt = typeof Deno === 'undefined' ? it : it.skip;

nodeIt(
  'executes the real loader interop assertions without network access',
  async () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(
      'node',
      [
        '--test',
        '--import',
        './experiments/revalidation-use-module-offline.mjs',
        'tests/use-module-integration.test.js',
      ],
      { env }
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 0, output);
    assert.match(output, /Loaded command-stream/u);
    assert.doesNotMatch(output, /Skipping:/u);
  }
);
