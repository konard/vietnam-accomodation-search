// Self-authored filesystem-only control: no Docker, credentials or network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

if (process.argv[2] === '--worker') {
  const report = process.argv[3];
  await withQaCleanup(async (scope) => {
    const directory = await mkdtemp(join(tmpdir(), 'vac-recovery-control-'));
    scope.defer('private recovery directory', () =>
      scope.cleanupFailed ? undefined : rm(directory, { recursive: true })
    );
    const journal = join(directory, 'owned.json');
    await writeFile(journal, '{"selfAuthored":true,"recoveryRequired":true}');
    await writeFile(report, JSON.stringify({ journal }));
    await writeFile(
      join(dirname(report), 'external-self-authored-resource'),
      'self-authored external resource whose disposal fails'
    );
    scope.defer('injected external cleanup failure', () => {
      throw new Error('Self-authored cleanup failure; journal is required.');
    });
  }).catch(() => {
    process.exitCode = 1;
  });
} else {
  await withQaCleanup(async (scope, signal) => {
    const directory = await qaTemporaryDirectory(scope, 'vac-recovery-parent-');
    const report = join(directory, 'report.json');
    const child = spawn(
      process.execPath,
      [
        'scripts/test-with-cleanup.mjs',
        process.execPath,
        fileURLToPath(import.meta.url),
        '--worker',
        report,
      ],
      { signal, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => (output = (output + chunk).slice(-8192)));
    }
    const closed = new Promise((done) => {
      child.once('error', () => {});
      child.once('close', (code) => done(code ?? 1));
    });
    scope.defer('owned recovery worker', async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await closed;
      }
    });
    assert.equal(await closed, 1);
    await access(join(directory, 'external-self-authored-resource'));
    const { journal } = JSON.parse(await readFile(report, 'utf8'));
    const recoveryJournalPreserved = await access(journal).then(
      () => true,
      () => false
    );
    console.log(
      JSON.stringify({
        selfAuthoredOnly: true,
        externalCleanupFailureObserved: true,
        recoveryJournalPreserved,
        runnerTmpTeardownVerified: output.includes('"teardownVerified":true'),
      })
    );
    assert(
      recoveryJournalPreserved,
      'Outer cleanup must not erase a failed external-resource recovery journal.'
    );
  });
}
