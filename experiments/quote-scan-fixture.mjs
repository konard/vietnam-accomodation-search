import assert from 'node:assert/strict';
import {
  isolatedReleaseEnvironment,
  runReleaseFixtureCommand,
} from './release-fixture.mjs';

export async function runQuoteScanFixture({ inherited = process.env } = {}) {
  // Use actual Node so its existing worker heap/stack limits remain effective.
  const result = await runReleaseFixtureCommand(
    'node',
    ['--max-old-space-size=64', 'experiments/issue-177-quote-scan.mjs'],
    { env: isolatedReleaseEnvironment({}, inherited) }
  );
  assert.equal(
    result.code,
    0,
    `Quote scan failed: ${result.stdout}\n${result.stderr}`
  );
  assert.equal(result.timedOut, false);
  assert.equal(result.teardownVerified, true);
  return JSON.parse(result.stdout);
}
