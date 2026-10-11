import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'test-anywhere';
import {
  isolatedReleaseEnvironment,
  runReleaseFixtureCommand,
} from '../experiments/release-fixture.mjs';

describe('finite isolated release subprocesses', () => {
  it('does not inherit runtime preloads, Git configuration overrides or production tokens', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const inherited = {
      ...process.env,
      BUN_OPTIONS: '--preload missing-self-authored-file.mjs',
      NODE_OPTIONS: '--require missing-self-authored-file.cjs',
      GIT_CONFIG_COUNT: '1',
      GH_TOKEN: 'self-authored-private-fixture',
      JS_ROOT: 'unrelated',
    };
    const environment = isolatedReleaseEnvironment({}, inherited);
    const result = await runReleaseFixtureCommand(
      process.execPath,
      [
        '-e',
        'console.log(JSON.stringify({bun:process.env.BUN_OPTIONS,node:process.env.NODE_OPTIONS,git:process.env.GIT_CONFIG_COUNT,token:process.env.GH_TOKEN,root:process.env.JS_ROOT}))',
      ],
      { env: environment }
    );
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), {});
  });

  it('times out an owned parent and its pipe-holding descendant, then verifies termination', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const fixture = fileURLToPath(
      new globalThis.URL(
        '../experiments/release-process-tree.mjs',
        import.meta.url
      )
    );
    const result = await runReleaseFixtureCommand(process.execPath, [fixture], {
      timeoutMs: 1000,
    });
    assert.equal(result.timedOut, true);
    const { childPid } = JSON.parse(result.stdout.trim());
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
    assert.equal(result.teardownVerified, true);
  });
});
