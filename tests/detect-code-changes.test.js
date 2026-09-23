import { describe, it, expect } from 'test-anywhere';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { classifyChangedFiles } from '../scripts/detect-code-changes.mjs';

const scriptPath = fileURLToPath(
  new URL('../scripts/detect-code-changes.mjs', import.meta.url)
);
const isDenoRuntime = typeof Deno !== 'undefined';
const canRunCliFixtures =
  !isDenoRuntime && typeof process !== 'undefined' && process.execPath;

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${
        result.stderr
      }`
    );
  }
}

function commit(root, message) {
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', message]);
}

function createMergeCommitFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'detect-code-changes-'));

  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);

  writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  commit(root, 'Initial commit');

  runGit(root, ['checkout', '-b', 'feature']);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'index.mjs'),
    'export const value = 1;\n'
  );
  commit(root, 'Add source change');

  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'notes.md'), '# Notes\n');
  commit(root, 'Add docs change');

  runGit(root, ['checkout', 'main']);
  runGit(root, ['merge', '--no-ff', 'feature', '-m', 'Merge feature']);

  return root;
}

function runDetectCodeChanges(root, eventName) {
  const outputFile = path.join(root, 'github-output.txt');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_OUTPUT: outputFile,
    },
  });

  return {
    outputs: readFileSync(outputFile, 'utf8'),
    result,
  };
}

describe('detect-code-changes CLI', () => {
  if (canRunCliFixtures) {
    it('detects code introduced by a real merge commit pushed to main', () => {
      const root = createMergeCommitFixture();

      try {
        const { outputs, result } = runDetectCodeChanges(root, 'push');

        expect(result.status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(outputs).toContain('docs-changed=true\n');
        expect(outputs).toContain('any-code-changed=true\n');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });

    it('keeps pull request merge commits scoped to the PR head commit diff', () => {
      const root = createMergeCommitFixture();

      try {
        const { outputs, result } = runDetectCodeChanges(root, 'pull_request');

        expect(result.status).toBe(0);
        expect(outputs).toContain('js-changed=false\n');
        expect(outputs).toContain('docs-changed=true\n');
        expect(outputs).toContain('any-code-changed=false\n');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });
  }

  for (const filePath of [
    'experiments/repro.mjs',
    'dev/log/repro.js',
    'docs/case-studies/issue-113/repro.md',
  ]) {
    it(`ignores ${filePath} without constructing a repository`, () => {
      expect(classifyChangedFiles([filePath])).toEqual({
        anyCodeChanged: false,
        codeChangedFiles: [],
        docsChanged: false,
        jsChanged: false,
        relevantChangedFiles: [],
      });
    });
  }

  for (const [filePath, expected] of [
    [
      'src/relevant.mjs',
      { anyCodeChanged: true, docsChanged: false, jsChanged: true },
    ],
    [
      'docs/relevant.md',
      { anyCodeChanged: false, docsChanged: true, jsChanged: false },
    ],
  ]) {
    it(`classifies ${filePath} directly`, () => {
      const actual = classifyChangedFiles([filePath]);
      expect({
        anyCodeChanged: actual.anyCodeChanged,
        docsChanged: actual.docsChanged,
        jsChanged: actual.jsChanged,
      }).toEqual(expected);
    });
  }

  it('normalizes package paths and excludes other language packages', () => {
    expect(
      classifyChangedFiles(
        [
          'js/examples/demo.mjs',
          'js/src/relevant.mjs',
          'js/docs/relevant.md',
          '.github/workflows/ci.yml',
          'rust/Cargo.toml',
        ],
        { packagePrefix: 'js/' }
      )
    ).toEqual({
      anyCodeChanged: true,
      codeChangedFiles: ['src/relevant.mjs', '.github/workflows/ci.yml'],
      docsChanged: true,
      jsChanged: true,
      relevantChangedFiles: [
        'src/relevant.mjs',
        'docs/relevant.md',
        '.github/workflows/ci.yml',
      ],
    });
  });

  it('runs code gates when only an ignored changeset is pending', () => {
    expect(
      classifyChangedFiles(['.changeset/repair.md'], {
        pendingChangeset: true,
      }).anyCodeChanged
    ).toBe(true);
  });
});

// A pull request can carry several commits, and a superseded run may never
// have tested the previous head. These fixtures exercise the push-range
// logic against a stub of the Actions API bound to GITHUB_API_URL, driving
// the real script - offline, no mocking of the code under test.
function createMultiCommitFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'detect-code-changes-push-'));

  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);

  writeFileSync(path.join(root, 'package.json'), '{ "name": "fixture" }\n');
  commit(root, 'Initial commit');
  const baseSha = spawnGit(root, ['rev-parse', 'HEAD']);

  runGit(root, ['checkout', '-b', 'feature']);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'feature.mjs'), 'export const x = 1;\n');
  commit(root, 'Add code change');
  const codeSha = spawnGit(root, ['rev-parse', 'HEAD']);

  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'notes.md'), '# Notes\n');
  commit(root, 'Add docs change');
  const headSha = spawnGit(root, ['rev-parse', 'HEAD']);

  runGit(root, ['checkout', 'main']);
  runGit(root, ['merge', '--no-ff', 'feature', '-m', 'Merge pull request']);

  return { root, baseSha, codeSha, headSha };
}

function spawnGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.stdout.trim();
}

function startStubApi(responder) {
  return new Promise((resolve) => {
    const requests = [];
    const server = createServer((req, res) => {
      req.on('end', () => {
        requests.push(req.url);
        responder(req, res);
      });
      req.resume();
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

async function runDetector(root, extraEnv) {
  const outputFile = path.join(root, 'github-output.txt');

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_OUTPUT: outputFile,
          ...extraEnv,
        },
      },
      (error) => {
        if (error) {
          reject(error);
        }
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({
        status,
        stdout,
        stderr,
        outputs: readFileSync(outputFile, 'utf8'),
      });
    });
  });
}

function pushRangeEnv(baseSha, beforeSha, afterSha, port) {
  return {
    GITHUB_API_URL: `http://127.0.0.1:${port}`,
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_WORKFLOW_REF:
      'owner/repo/.github/workflows/release.yml@refs/pull/1/merge',
    GITHUB_TOKEN: 'stub-token',
    GITHUB_BASE_SHA: baseSha,
    GITHUB_BEFORE_SHA: beforeSha,
    GITHUB_AFTER_SHA: afterSha,
  };
}

describe('detect-code-changes push ranges', () => {
  if (canRunCliFixtures) {
    it('covers the whole push when the previous head passed', async () => {
      const fixture = createMultiCommitFixture();
      const { server, port, requests } = await startStubApi((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"total_count": 1}');
      });

      try {
        const { status, outputs } = await runDetector(
          fixture.root,
          pushRangeEnv(fixture.baseSha, fixture.baseSha, fixture.headSha, port)
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(requests).toEqual([
          `/repos/owner/repo/actions/workflows/release.yml/runs?head_sha=${fixture.baseSha}&status=success&per_page=1`,
        ]);
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    });

    it('widens to the full PR diff when the previous head never passed', async () => {
      const fixture = createMultiCommitFixture();
      const { server, port, requests } = await startStubApi((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"total_count": 0}');
      });

      try {
        const { status, stdout, outputs } = await runDetector(
          fixture.root,
          pushRangeEnv(fixture.baseSha, fixture.codeSha, fixture.headSha, port)
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(stdout).toContain('full PR diff');
        expect(requests.length).toBe(1);
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    });

    it('widens when the lookup fails', async () => {
      const fixture = createMultiCommitFixture();
      const { server, port } = await startStubApi((req, res) => {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end('{"message": "Forbidden"}');
      });

      try {
        const { status, outputs } = await runDetector(
          fixture.root,
          pushRangeEnv(fixture.baseSha, fixture.codeSha, fixture.headSha, port)
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    });

    it('keeps the push range when the lookup fails with no base SHA', async () => {
      const fixture = createMultiCommitFixture();
      const { server, port } = await startStubApi((req, res) => {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end('{"message": "Forbidden"}');
      });
      const env = pushRangeEnv('', fixture.codeSha, fixture.headSha, port);
      delete env.GITHUB_BASE_SHA;

      try {
        const { status, stdout, outputs } = await runDetector(
          fixture.root,
          env
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=false\n');
        expect(stdout).toContain(
          `Comparing ${fixture.codeSha} to ${fixture.headSha} (push range)`
        );
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    });

    it('skips the lookup entirely without push SHAs', async () => {
      const fixture = createMultiCommitFixture();
      const { server, port, requests } = await startStubApi((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"total_count": 1}');
      });
      const env = pushRangeEnv(
        fixture.baseSha,
        fixture.baseSha,
        fixture.headSha,
        port
      );
      delete env.GITHUB_BEFORE_SHA;
      delete env.GITHUB_AFTER_SHA;

      try {
        const { status, stdout, outputs } = await runDetector(
          fixture.root,
          env
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(stdout).toContain(`Comparing ${fixture.baseSha} to HEAD^2`);
        expect(requests).toEqual([]);
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    });
  }
});
