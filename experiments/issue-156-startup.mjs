#!/usr/bin/env node

// Finite startup comparison; evaluates only public use-m, never credentials.
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadUse } from '../scripts/use-module.mjs';

const baselineSha = '8834279005932a2ee3eabd96e245cc9b686def09';
const source = execFileSync(
  'git',
  ['show', `${baselineSha}:scripts/use-module.mjs`],
  { encoding: 'utf8' }
).replace(
  "'./debug-print.mjs'",
  JSON.stringify(pathToFileURL(resolve('scripts/debug-print.mjs')).href)
);
const baseline = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const rows = [];
for (const [name, loader] of [
  ['baseline-bootstrap', baseline.loadUse],
  ['pinned-bootstrap', loadUse],
]) {
  const started = performance.now();
  await loader();
  const loaded = performance.now();
  await loader();
  rows.push({
    name,
    firstMs: Math.round(loaded - started),
    cachedMs: Math.round(performance.now() - loaded),
  });
}
const startupMs = [];
for (let index = 0; index < 3; index += 1) {
  const started = performance.now();
  execFileSync(
    process.execPath,
    ['--max-old-space-size=512', '-e', "import('./src/index.js')"],
    { stdio: 'ignore' }
  );
  startupMs.push(Math.round(performance.now() - started));
}
rows.push({ name: 'unchanged-application-import', startupMs });
console.log(
  JSON.stringify(
    { baselineSha, mode: 'public-bootstrap-startup', rows },
    null,
    2
  )
);
