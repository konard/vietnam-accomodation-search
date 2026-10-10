import { describe, it, expect } from 'test-anywhere';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { runCli } from '../bin/vietnam-accomodation-search.js';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const lockJson = JSON.parse(readFileSync('package-lock.json', 'utf8'));

describe('publishable package metadata', () => {
  it('uses the repository package identity', () => {
    expect(packageJson.name).toBe('vietnam-accomodation-search');
    expect(packageJson.publishConfig).toEqual({ access: 'public' });
    expect(lockJson.name).toBe('vietnam-accomodation-search');
    expect(lockJson.packages[''].name).toBe('vietnam-accomodation-search');
  });

  it('defines a globally installable CLI command', () => {
    expect(packageJson.bin).toEqual({
      'vietnam-accomodation-search': 'bin/vietnam-accomodation-search.js',
    });
    expect(existsSync('bin/vietnam-accomodation-search.js')).toBe(true);
  });

  it('keeps the CLI bin entry through npm publish normalization', () => {
    // npm publication runs on Node; its CLI dry run can outlast
    // Bun's five-second per-test default even when the package is valid.
    if (typeof Deno !== 'undefined' || typeof Bun !== 'undefined') {
      return;
    }
    // Windows cannot launch npm.cmd directly without a shell. npm supplies
    // its JavaScript entry point when it runs the test suite.
    const npmCli = process.env.npm_execpath;
    const npm = npmCli
      ? process.execPath
      : process.platform === 'win32'
        ? 'npm.cmd'
        : 'npm';
    const result = spawnSync(
      npm,
      [
        ...(npmCli ? [npmCli] : []),
        'publish',
        '--dry-run',
        '--json',
        '--ignore-scripts',
      ],
      {
        encoding: 'utf8',
        shell: process.platform === 'win32' && !npmCli,
      }
    );
    expect(result.error).toBe(undefined);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('bin[vietnam-accomodation-search]');
    const metadata = JSON.parse(result.stdout);
    const packageFiles = Array.isArray(metadata)
      ? metadata[0].files
      : metadata.files || metadata[packageJson.name]?.files;
    expect(Array.isArray(packageFiles)).toBe(true);
    expect(
      packageFiles.some(
        ({ path }) => path === packageJson.bin[packageJson.name]
      )
    ).toBe(true);
  });

  it('prints the package version without constructing the application', async () => {
    const stdout = [];
    expect(
      await runCli(['--version'], {
        env: {},
        stdout: (line) => stdout.push(line),
      })
    ).toBe(0);
    expect(stdout).toEqual([packageJson.version]);
  });

  it('runs accommodation searches through the CLI command', async () => {
    const stdout = [];
    const stderr = [];

    expect(
      await runCli(['search', '--cheapest', 'Da', 'Nang'], {
        application: {
          service: {
            search: async () => [
              {
                price: { period: 'month' },
                priceVnd: 5000000,
                title: 'Studio',
              },
            ],
          },
        },
        env: {},
        stderr: (line) => stderr.push(line),
        stdout: (line) => stdout.push(line),
      })
    ).toBe(0);

    expect(stdout[0]).toContain('5,000,000 VND/month');
    expect(stderr).toEqual([]);
  });

  it('runs when invoked through an npm-style bin symlink', () => {
    if (typeof Deno !== 'undefined') {
      return;
    }

    const tempRoot = mkdtempSync(join(tmpdir(), 'vietnam-accomodation-'));
    const linkPath = join(tempRoot, 'vietnam-accomodation-search');

    try {
      symlinkSync(resolve('bin/vietnam-accomodation-search.js'), linkPath);
    } catch (error) {
      rmSync(tempRoot, { force: true, recursive: true });

      if (process.platform === 'win32') {
        expect(error.code).toBe('EPERM');
        return;
      }

      throw error;
    }

    try {
      const result = spawnSync(process.execPath, [linkPath, '--help'], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('vietnam-accomodation-search');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('publishes only the package runtime surface', () => {
    expect(packageJson.files).toEqual([
      'bin/',
      'src/',
      'CHANGELOG.md',
      'LICENSE',
      'README.md',
    ]);
  });
});
