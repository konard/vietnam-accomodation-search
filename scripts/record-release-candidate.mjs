#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { durableWrite } from '../src/link-cli-mirror.js';

const FULL_SHA = /^[\da-f]{40}$/u;

function execute(command, arguments_) {
  return execFileSync(command, arguments_, { encoding: 'utf8' }).trim();
}

function versionLine(value, prefix = '') {
  const line = String(value || '')
    .trim()
    .split(/\r?\n/u)[0];
  return prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

export function createCandidateEvidence({
  now = () => new Date(),
  packageJson,
  runCommand = execute,
}) {
  const dirty = runCommand('git', ['status', '--porcelain']);
  if (dirty) {
    throw new Error(
      'Release candidate worktree changed during verification; refusing evidence.'
    );
  }
  const commitSha = versionLine(runCommand('git', ['rev-parse', 'HEAD']));
  if (!FULL_SHA.test(commitSha)) {
    throw new Error('Release candidate must resolve to a full commit SHA.');
  }
  const packageVersion = packageJson?.version;
  if (!packageVersion) {
    throw new Error('Release candidate package version is missing.');
  }
  return {
    commitSha,
    observedAt: now().toISOString(),
    packageVersion,
    runtimes: {
      bun: versionLine(runCommand('bun', ['--version'])),
      deno: versionLine(runCommand('deno', ['--version']), 'deno '),
      node: versionLine(runCommand('node', ['--version'])),
    },
  };
}

export async function recordReleaseCandidate(
  values,
  { cwd = process.cwd() } = {}
) {
  if (values.length !== 2 || values[0] !== '--output' || !values[1]) {
    throw new Error('Usage: record-release-candidate.mjs --output <path>');
  }
  const packageJson = JSON.parse(
    await readFile(resolve(cwd, 'package.json'), 'utf8')
  );
  const evidence = createCandidateEvidence({ packageJson });
  await durableWrite(values[1], `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await recordReleaseCandidate(process.argv.slice(2));
}
