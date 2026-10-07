import { trackedPackageLocks } from '../scripts/tracked-lockfiles.mjs';
import { describe, it, expect } from 'test-anywhere';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflowPath = '.github/workflows/security.yml';
const workflow = existsSync(workflowPath)
  ? readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n')
  : '';

function getJobBlock(jobName) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

describe('security workflow', () => {
  it('runs on main pushes, pull requests, weekly schedules, and manual dispatches', () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow).toContain('  push:\n    branches: [main]');
    expect(workflow).toContain('  pull_request:');
    expect(workflow).toContain("    - cron: '0 6 * * 1'");
    expect(workflow).toContain('  workflow_dispatch:');
  });

  it('analyzes JavaScript and GitHub Actions with CodeQL', () => {
    const codeql = getJobBlock('codeql');

    expect(codeql).toContain('    timeout-minutes: 30');
    expect(codeql).toContain(
      '      group: check-${{ github.workflow }}-${{ github.ref }}-codeql-${{ matrix.language }}\n      cancel-in-progress: true'
    );
    expect(codeql).toContain(
      '        language: [javascript-typescript, actions]'
    );
    expect(codeql).toContain('      actions: read');
    expect(codeql).toContain('      security-events: write');
    expect(codeql).toContain('uses: actions/checkout@v7');
    expect(codeql).toContain('uses: github/codeql-action/init@v4');
    expect(codeql).toContain('languages: ${{ matrix.language }}');
    expect(codeql).toContain('uses: github/codeql-action/autobuild@v4');
    expect(codeql).toContain('uses: github/codeql-action/analyze@v4');
  });

  it('rejects high-severity dependency changes only on pull requests', () => {
    const dependencyReview = getJobBlock('dependency-review');

    expect(dependencyReview).toContain(
      "    if: github.event_name == 'pull_request'"
    );
    expect(dependencyReview).toContain('    timeout-minutes: 10');
    expect(dependencyReview).toContain(
      '      group: check-${{ github.workflow }}-${{ github.ref }}-dependency-review\n      cancel-in-progress: true'
    );
    expect(dependencyReview).toContain('      pull-requests: write');
    expect(dependencyReview).toContain(
      'uses: actions/dependency-review-action@v5'
    );
    expect(dependencyReview).toContain('          fail-on-severity: high');
    expect(dependencyReview).toContain(
      '          comment-summary-in-pr: on-failure'
    );
  });

  it('fails closed on high-severity advisories in every npm lock', () => {
    const audit = getJobBlock('npm-audit');
    const directoryList = audit.match(/directory: \[([^\]]+)\]/)?.[1] ?? '';
    const auditedLocks = directoryList
      .split(',')
      .map((directory) => directory.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .map((directory) =>
        directory === '.'
          ? 'package-lock.json'
          : `${directory}/package-lock.json`
      )
      .sort();

    const tracked =
      typeof globalThis.Deno === 'undefined'
        ? trackedPackageLocks()
        : ['examples/universal-app/package-lock.json', 'package-lock.json'];
    expect(auditedLocks).toEqual(tracked);
    expect(audit).toContain('    timeout-minutes: 10');
    expect(audit).toContain('uses: actions/setup-node@v7');
    expect(audit).toContain('node-version: 24');
    expect(audit).toContain('working-directory: ${{ matrix.directory }}');
    expect(audit).toContain(
      'run: npm audit --package-lock-only --audit-level=high'
    );
  });

  it('keeps the desktop packaging download chain off http-cache-semantics', () => {
    // GHSA-ch52-4w7c-c8xp has no patched http-cache-semantics. The
    // fetch-based @electron/get 5 drops got, cacheable-request, and it.
    const directory = 'examples/universal-app';
    const manifest = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8')
    );
    const lock = JSON.parse(
      readFileSync(join(directory, 'package-lock.json'), 'utf8')
    );
    const installed = Object.entries(lock.packages).filter(([path]) =>
      path.includes('node_modules/')
    );
    const named = (name) =>
      installed.filter(([path]) => path.endsWith(`node_modules/${name}`));

    expect(manifest.overrides['@electron/get']).toBe('^5.1.0');
    expect(named('@electron/get').length > 0).toBe(true);
    for (const [, entry] of named('@electron/get')) {
      expect(Number(entry.version.split('.')[0]) >= 5).toBe(true);
    }
    for (const name of ['got', 'cacheable-request', 'http-cache-semantics']) {
      expect(named(name)).toEqual([]);
    }
  });
});
