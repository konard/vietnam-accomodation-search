import { describe, it, expect } from 'test-anywhere';
import { execFileSync, spawnSync } from 'node:child_process';
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
import { synchronizeReleaseCheckout } from '../scripts/synchronize-release-checkout.mjs';
import { loadCommandStream } from '../scripts/use-module.mjs';

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
    expect(script).toContain(
      'formattableStagedFiles(await stagedResult.text())'
    );
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

  it('captures the real NUL-delimited staged list through the release command boundary', async () => {
    if (
      typeof globalThis.Deno !== 'undefined' ||
      process.platform === 'win32'
    ) {
      return;
    }
    const root = mkdtempSync(join(tmpdir(), 'release-staged-command-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      writeFileSync(join(root, 'release notes\ncontinued.md'), '# Release\n');
      execFileSync('git', ['add', '-A'], { cwd: root });

      const { $ } = await loadCommandStream();
      const result =
        await $`git -C ${root} diff --cached --name-only -z --diff-filter=ACMR`.run(
          {
            capture: true,
          }
        );
      expect(formattableStagedFiles(await result.text())).toEqual([
        'release notes\ncontinued.md',
      ]);
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
    const recovery = script.indexOf('await synchronizeReleaseCheckout');
    const releasedOutput = script.indexOf(
      "setOutput('already_released', 'true')"
    );

    expect(recovery).toBeGreaterThan(-1);
    expect(releasedOutput).toBeGreaterThan(recovery);
  });

  it('synchronizes a stale release run before merging changesets', async () => {
    if (
      typeof globalThis.Deno !== 'undefined' ||
      (typeof process !== 'undefined' && process.platform === 'win32')
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'release-race-'));
    const remote = join(root, 'remote.git');
    const firstRun = join(root, 'first-run');
    const staleLegacyRun = join(root, 'stale-legacy-run');
    const staleFixedRun = join(root, 'stale-fixed-run');
    const staleInstantRun = join(root, 'stale-instant-run');
    const mergeScript = join(process.cwd(), 'scripts/merge-changesets.mjs');
    const run = (cwd, args) =>
      spawnSync('git', args, { cwd, encoding: 'utf8' });
    const runChecked = (cwd, args) => {
      const result = run(cwd, args);
      expect(result.status).toBe(0);
      return result.stdout.trim();
    };
    const configure = (cwd) => {
      runChecked(cwd, ['config', 'user.email', 'ci@example.com']);
      runChecked(cwd, ['config', 'user.name', 'CI Test']);
    };

    try {
      runChecked(root, ['init', '--bare', '--initial-branch=main', remote]);
      runChecked(root, ['clone', remote, firstRun]);
      configure(firstRun);
      mkdirSync(join(firstRun, '.changeset'));
      writeFileSync(
        join(firstRun, 'package.json'),
        '{"name":"fixture-package","version":"1.0.0"}\n'
      );
      for (const name of ['first', 'second']) {
        writeFileSync(
          join(firstRun, '.changeset', `${name}.md`),
          `---\n'fixture-package': patch\n---\n\n${name}\n`
        );
      }
      runChecked(firstRun, ['add', '.']);
      runChecked(firstRun, ['commit', '-m', 'pending release']);
      runChecked(firstRun, ['push', 'origin', 'HEAD:main']);

      runChecked(root, ['clone', remote, staleLegacyRun]);
      runChecked(root, ['clone', remote, staleFixedRun]);
      runChecked(root, ['clone', remote, staleInstantRun]);

      rmSync(join(firstRun, '.changeset', 'first.md'));
      rmSync(join(firstRun, '.changeset', 'second.md'));
      writeFileSync(
        join(firstRun, 'package.json'),
        '{"name":"fixture-package","version":"1.0.1"}\n'
      );
      runChecked(firstRun, ['add', '-A']);
      runChecked(firstRun, ['commit', '-m', '1.0.1']);
      runChecked(firstRun, ['push', 'origin', 'HEAD:main']);

      const merge = spawnSync(process.execPath, [mergeScript], {
        cwd: staleLegacyRun,
        encoding: 'utf8',
      });
      expect(merge.status).toBe(0);
      runChecked(staleLegacyRun, ['fetch', 'origin', 'main']);
      const legacyRebase = run(staleLegacyRun, ['rebase', 'origin/main']);
      expect(legacyRebase.status).not.toBe(0);
      expect(legacyRebase.stderr).toContain('unstaged changes');

      const result = await synchronizeReleaseCheckout({
        cwd: staleFixedRun,
        logger: { log() {} },
      });
      expect(result.status).toBe('already-released');
      expect(result.version).toBe('1.0.1');
      expect(runChecked(staleFixedRun, ['status', '--porcelain'])).toBe('');
      expect(runChecked(staleFixedRun, ['rev-parse', 'HEAD'])).toBe(
        runChecked(staleFixedRun, ['rev-parse', 'origin/main'])
      );

      const instant = await synchronizeReleaseCheckout({
        cwd: staleInstantRun,
        logger: { log() {} },
        mode: 'instant',
      });
      expect(instant.status).toBe('advanced');
      expect(instant.version).toBe('1.0.1');
      expect(runChecked(staleInstantRun, ['status', '--porcelain'])).toBe('');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('loadCommandStream shell semantics', () => {
  it('enables errexit, the semantics the release scripts are written for', () => {
    expect(useModule).toContain('shell.errexit(true)');
  });
});
