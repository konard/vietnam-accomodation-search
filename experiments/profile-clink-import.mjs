#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Parser } from 'links-notation';

const mode = process.argv[2] || 'sync';
const count = Number(process.argv[3] || 5_000);
if (
  !['sync', 'async', 'bare'].includes(mode) ||
  !Number.isInteger(count) ||
  count < 1
) {
  throw new Error(
    'Usage: profile-clink-import.mjs sync|async|bare [link-count]'
  );
}
const directory = await mkdtemp(join(tmpdir(), 'clink-profile-'));
const notation = Array.from(
  { length: count },
  (_, index) => `(n${index + 1}: n${index + 1} n${index + 1})`
).join('\n');
const input = join(directory, 'canonical.lino');
const output = join(directory, 'verified.lino');
await writeFile(input, `${notation}\n`, { mode: 0o600 });
const startedAt = performance.now();
const child = spawn(
  process.env.CLINK_COMMAND || 'clink',
  [
    '--db',
    join(directory, 'data.links'),
    ...(mode === 'bare' ? [] : ['--transactions', '--commit-mode', mode]),
    '--auto-create-missing-references',
    '--import',
    input,
    '--export',
    output,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] }
);
let stderrBytes = 0;
child.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length;
});
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
const exported = exitCode === 0 ? await readFile(output, 'utf8') : '';
const importedLinks = new Parser().parse(notation);
const exportedLinks = exported ? new Parser().parse(exported) : [];
console.log(
  JSON.stringify({
    bytes: Buffer.byteLength(notation),
    directory,
    elapsedMs: Math.round(performance.now() - startedAt),
    exitCode,
    exportedLinks: exportedLinks.length,
    importedLinks: importedLinks.length,
    mode,
    stderrBytes,
  })
);
if (exitCode !== 0 || importedLinks.length !== exportedLinks.length) {
  process.exitCode = 1;
}
