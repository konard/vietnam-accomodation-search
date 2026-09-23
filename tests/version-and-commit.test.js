import { describe, it, expect } from 'test-anywhere';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formattableStagedFiles } from '../scripts/release-formatting.mjs';

const script = readFileSync('scripts/version-and-commit.mjs', 'utf8');
const releaseFormatting = readFileSync(
  'scripts/release-formatting.mjs',
  'utf8'
);
const useModule = readFileSync('scripts/use-module.mjs', 'utf8');

describe('version-and-commit.mjs formats the release commit', () => {
  it('checks staged files with prettier between staging and committing', () => {
    // The formatting logic lives in checkStagedFormatting(), which is defined
    // above main(); the ordering that matters is at the call site.
    const staged = script.indexOf('await $`git add -A`');
    const checkCall = script.indexOf('await checkStagedFormatting();');
    const prettier = script.indexOf('npx prettier --check');
    const commit = script.indexOf('await $`git commit');

    expect(staged).toBeGreaterThan(-1);
    expect(prettier).toBeGreaterThan(-1);
    expect(checkCall).toBeGreaterThan(staged);
    expect(commit).toBeGreaterThan(checkCall);
  });

  it('checks only the formattable staged files, not the whole tree', () => {
    expect(script).toContain('prettier --check ${formattable}');
    expect(releaseFormatting).toContain('/\\.(m?js|json|md|ts)$/');
    expect(script).toContain('--diff-filter=ACMR');
    expect(script).toContain('--name-only -z');
  });

  it('skips the check when nothing formattable is staged', () => {
    expect(script).toContain('formattable.length > 0');
  });

  it('never passes deleted changesets to Prettier and preserves unusual pathnames', () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const root = mkdtempSync(join(tmpdir(), 'release-formatting-'));
    const run = (args) =>
      execFileSync('git', args, { cwd: root, encoding: 'buffer' });
    // Windows forbids control characters in pathnames. POSIX runners retain
    // the newline regression while Windows still covers spacing and quoting.
    const unusual =
      process.platform === 'win32'
        ? 'release notes [continued].md'
        : 'release notes\ncontinued.md';
    try {
      run(['init', '-b', 'main']);
      run(['config', 'user.email', 'ci@example.com']);
      run(['config', 'user.name', 'CI Test']);
      mkdirSync(join(root, '.changeset'));
      writeFileSync(join(root, '.changeset', 'released.md'), '# Released\n');
      writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}\n');
      writeFileSync(join(root, unusual), '# Before\n');
      run(['add', '-A']);
      run(['commit', '-m', 'fixture']);

      rmSync(join(root, '.changeset', 'released.md'));
      writeFileSync(join(root, 'package.json'), '{ "version": "1.0.1" }\n');
      writeFileSync(join(root, unusual), '# After\n');
      run(['add', '-A']);

      const output = run([
        'diff',
        '--cached',
        '--name-only',
        '--diff-filter=ACMR',
        '-z',
      ]);
      expect(formattableStagedFiles(output)).toEqual(['package.json', unusual]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('version-and-commit.mjs push failure reporting', () => {
  // $ now rejects on non-zero (errexit), so a push that never landed reaches
  // the catch as a rejection and must say which version failed to land.
  it('reports the version when the push helper exits non-zero', () => {
    expect(script).toContain('Failed to push version');
    expect(script).not.toContain('resolves (it does not throw)');
    expect(script).not.toContain('pushResult.code');
  });
});

describe('version-and-commit.mjs partial-release recovery', () => {
  it('fast-forwards to the already-pushed version before candidate verification', () => {
    const recovery = script.indexOf('git merge --ff-only origin/main');
    const releasedOutput = script.indexOf(
      "setOutput('already_released', 'true')"
    );

    expect(recovery).toBeGreaterThan(-1);
    expect(releasedOutput).toBeGreaterThan(recovery);
  });
});

describe('loadCommandStream shell semantics', () => {
  it('enables errexit, the semantics the release scripts are written for', () => {
    expect(useModule).toContain('shell.errexit(true)');
  });
});
