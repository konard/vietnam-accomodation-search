#!/usr/bin/env node
// Reproduce the failed CI input with the actual checker and workflow arguments.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

const binary = process.argv[2] || 'lychee';
const workflow = readFileSync('.github/workflows/links.yml', 'utf8');
const argsBlock = workflow.match(/ {10}args: >-\n((?: {12}.*\n)+)/);
assert.ok(argsBlock, 'The workflow must expose its actual lychee arguments');
const tokens = [...argsBlock[1].matchAll(/'([^']*)'|(\S+)/g)].map(
  (match) => match[1] ?? match[2]
);
const args = tokens.filter((token) => !token.startsWith('./**/'));
mkdirSync('ci-logs', { recursive: true });

await withQaCleanup(async (scope, signal) => {
  const directory = await qaTemporaryDirectory(scope, 'issue-195-links-');
  async function check(name, input, expectedExit) {
    signal.throwIfAborted();
    const inputPath = path.join(directory, `${name}.md`);
    const reportPath = path.join(directory, `${name}-report.md`);
    writeFileSync(inputPath, input);
    const child = spawn(
      binary,
      [...args, '--format', 'markdown', '--output', reportPath, inputPath],
      {
        env: { ...process.env, RUST_LOG: 'warn' },
        // Keep lychee's cache inside this experiment's exact owned directory.
        cwd: directory,
        signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    let error;
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.once('error', (failure) => {
      error = failure;
    });
    const closed = new Promise((resolve) => child.once('close', resolve));
    scope.defer(`checker ${name}`, async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await closed;
      }
    });
    const code = await closed;
    writeFileSync(`ci-logs/links-${name}-acceptance.log`, output);
    assert.ifError(error);
    const report = readFileSync(reportPath, 'utf8');
    writeFileSync(
      `ci-logs/links-${name}-acceptance.log`,
      `${output}\n${report}`
    );
    assert.equal(code, expectedExit, `${name}: unexpected checker exit`);
    return report;
  }

  const input = readFileSync(
    'docs/case-studies/issue-195/links-failures.md',
    'utf8'
  );
  const urls = [...new Set([...input.matchAll(/<([^>]+)>/g)].map((m) => m[1]))];
  assert.equal(urls.length, 19, 'Retain every exact URL reported broken in CI');
  const healthyReport = await check('historical', urls.join('\n'), 0);
  assert.match(healthyReport, /Successful\s*\| 19/);
  assert.match(healthyReport, /Errors\s*\| 0/);

  const missing =
    'https://github.com/konard/vietnam-accomodation-search/blob/' +
    '49dcb1830094e8e7e14d40978c4974ab54dd4fcf/ci-link-missing-control.md';
  const missingReport = await check('missing', missing, 2);
  assert.match(
    missingReport,
    /\[404\] <https:\/\/raw\.githubusercontent\.com\//
  );
  assert.match(missingReport, /Errors\s*\| 1/);
  console.log(
    JSON.stringify({ historicalLinksPassed: 19, missingFileRejected: true })
  );
});
