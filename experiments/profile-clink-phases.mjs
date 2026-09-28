#!/usr/bin/env node

/**
 * Manual, privacy-safe clink phase profiler. The input may contain private
 * LiNo; only aggregate sizes and durations are printed. No input is copied
 * into the repository or passed through argv to a shell.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { parseNotation, verifyExport } from '../src/link-cli-mirror.js';

function parseOptions(argv) {
  const options = { count: 1_000, mode: 'bare' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !['--count', '--input', '--mode'].includes(key)) {
      throw new Error(
        'Usage: profile-clink-phases.mjs [--count N | --input PATH] [--mode bare|sync|async]'
      );
    }
    options[key.slice(2)] = key === '--count' ? Number(value) : value;
  }
  if (
    !Number.isInteger(options.count) ||
    options.count < 1 ||
    !['bare', 'sync', 'async'].includes(options.mode)
  ) {
    throw new Error('Invalid count or transaction mode.');
  }
  if (options.input && process.env.CI) {
    throw new Error('Private input profiling is manual-only.');
  }
  return options;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderrBytes = 0;
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          elapsedMs: Math.round(performance.now() - started),
          stderrBytes,
        });
      } else {
        reject(new Error(`clink phase failed with exit code ${code}`));
      }
    });
  });
}

export async function profile(options) {
  const directory = await mkdtemp(join(tmpdir(), 'clink-phases-'));
  try {
    const notation = options.input
      ? await readFile(options.input, 'utf8').catch(() => {
          throw new Error('The private LiNo input could not be read.');
        })
      : `${Array.from(
          { length: options.count },
          (_, index) => `(n${index + 1}: n${index + 1} n${index + 1})`
        ).join('\n')}\n`;
    const input = options.input || join(directory, 'canonical.lino');
    const database = join(directory, 'data.links');
    const output = join(directory, 'verified.lino');
    if (!options.input) {
      await writeFile(input, notation, { mode: 0o600 });
    }
    const command = process.env.CLINK_COMMAND || 'clink';
    const transaction =
      options.mode === 'bare'
        ? []
        : ['--transactions', '--commit-mode', options.mode];
    const imported = await run(command, [
      '--db',
      database,
      ...transaction,
      '--auto-create-missing-references',
      '--import',
      input,
    ]);
    const exported = await run(command, ['--db', database, '--export', output]);
    const verificationStarted = performance.now();
    verifyExport(notation, await readFile(output, 'utf8'));
    return {
      databaseBytes: (await stat(database)).size,
      exportMs: exported.elapsedMs,
      importMs: imported.elapsedMs,
      inputBytes: Buffer.byteLength(notation),
      links: parseNotation(notation).length,
      mode: options.mode,
      stderrBytes: imported.stderrBytes + exported.stderrBytes,
      verifyMs: Math.round(performance.now() - verificationStarted),
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(
    `${JSON.stringify(await profile(parseOptions(process.argv.slice(2))))}\n`
  );
}
