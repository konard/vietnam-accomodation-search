#!/usr/bin/env node
// Real, finite Lychee controls: HEAD checks availability without downloading
// rendered pages, while rejected HTTP statuses must still fail the check.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'vac-qa-link-methods-'));
const server = createServer((request, response) => {
  response.statusCode =
    request.url === '/method'
      ? request.method === 'HEAD'
        ? 200
        : 503
      : Number(request.url.slice(1));
  response.end('Fixture body');
});
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  for (const [method, route, expected] of [
    ['get', 'method', false],
    ['head', 'method', true],
    ['head', '404', false],
    ['head', '503', false],
  ]) {
    const input = join(directory, 'links.md');
    await writeFile(input, `[fixture](${base}/${route})`);
    let passed = true;
    let output;
    try {
      output = await exec(
        process.env.LYCHEE_COMMAND || 'lychee',
        [
          '--method',
          method,
          '--no-progress',
          '--max-retries',
          '0',
          '--timeout',
          '5',
          input,
        ],
        { cwd: directory, env: { ...process.env, RUST_LOG: 'warn' } }
      );
    } catch (error) {
      passed = false;
      output = error;
    }
    assert.equal(passed, expected, `${method} /${route}`);
    if (!expected) {
      assert.match(`${output.stdout}${output.stderr}`, /\[503\]|\[404\]/u);
    }
    results.push({ method, route, passed, expected });
  }
  console.log(JSON.stringify({ strictHttpControls: results }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
