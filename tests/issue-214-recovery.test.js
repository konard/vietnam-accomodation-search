import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'test-anywhere';

const nativeNode =
  typeof globalThis.Deno === 'undefined' &&
  typeof globalThis.Bun === 'undefined';

function run(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => (output = (output + chunk).slice(-32768)));
    }
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

for (const kind of ['marker', 'image', 'guest', 'browser']) {
  it(`preserves ${kind} recovery through two strict wrappers and restores only exact ownership`, async () => {
    if (!nativeNode) {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-recovery-test-'));
    try {
      const recovery = join(root, 'recovery');
      const environment = {
        VAC_QA_RECOVERY_DIRECTORY: recovery,
        QA_RECOVERY_FIXTURE_ROOT: root,
      };
      const wrappers = [
        'scripts/test-with-cleanup.mjs',
        process.execPath,
        'scripts/test-with-cleanup.mjs',
        process.execPath,
      ];
      const failed = await run(
        [...wrappers, 'experiments/issue-214-recovery-fixture.mjs', kind],
        environment
      );
      assert.equal(failed.code, 1, failed.output);
      const report = JSON.parse(await readFile(join(root, 'report.json')));
      await access(report.journal);
      if (kind === 'guest') {
        await access(join(report.directory, 'heavy.lock', 'owner.json'));
        await access(
          join(report.directory, 'heavy.lock', 'docker-capacity-image.json')
        );
      }
      assert.equal(
        failed.output.includes('"externalTeardownVerified":false'),
        true
      );
      assert.equal(
        failed.output.includes('"temporaryTeardownVerified":true'),
        true
      );
      assert.equal((await readdir(recovery)).length, 1);
      await assert.rejects(access(report.disposable), { code: 'ENOENT' });
      const recovered = await run(
        [
          ...wrappers,
          'experiments/issue-214-recovery-fixture.mjs',
          'recover',
          kind,
        ],
        environment
      );
      assert.equal(recovered.code, 0, recovered.output);
      assert.deepEqual(await readdir(recovery), []);
      const state = JSON.parse(await readFile(join(root, 'external.json')));
      assert.deepEqual(state.resources, ['unrelated-baseline-resource']);
      assert.equal(state.baselineVerified, true);
      await assert.rejects(access(report.journal), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const mode of [
  'success',
  'setup-failure',
  'assertion-failure',
  'SIGINT',
  'SIGTERM',
]) {
  it(`clears disposable and recovery fixtures after ${mode} without an external failure`, async () => {
    if (!nativeNode) {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-recovery-test-'));
    try {
      const recovery = join(root, 'recovery');
      const result = await run(
        [
          'scripts/test-with-cleanup.mjs',
          process.execPath,
          'experiments/issue-214-recovery-fixture.mjs',
          mode,
        ],
        { VAC_QA_RECOVERY_DIRECTORY: recovery, QA_RECOVERY_FIXTURE_ROOT: root }
      );
      assert.equal(result.code, mode === 'success' ? 0 : 1, result.output);
      assert.deepEqual(await readdir(recovery), []);
      assert.equal(
        result.output.includes('"temporaryTeardownVerified":true'),
        true
      );
      const report = JSON.parse(await readFile(join(root, 'report.json')));
      await assert.rejects(access(report.directory), { code: 'ENOENT' });
      await assert.rejects(access(report.disposable), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
