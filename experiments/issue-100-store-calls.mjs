#!/usr/bin/env node
// Counts and times LinksStore calls made by the search-service audit replay.
//   node experiments/issue-100-store-calls.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LinksStore } from '../src/index.js';
import { auditReplay } from './audit-search-service.mjs';
import { loadCorpus } from './field-corpus-metrics.mjs';

const stats = new Map();
for (const name of Object.getOwnPropertyNames(LinksStore.prototype)) {
  const original = LinksStore.prototype[name];
  if (
    ['constructor', 'pathFor'].includes(name) ||
    typeof original !== 'function'
  ) {
    continue;
  }
  LinksStore.prototype[name] = async function (...parts) {
    const started = globalThis.performance.now();
    try {
      return await original.apply(this, parts);
    } finally {
      const entry = stats.get(name) || { calls: 0, ms: 0 };
      entry.calls += 1;
      entry.ms += globalThis.performance.now() - started;
      stats.set(name, entry);
    }
  };
}
const directory = await mkdtemp(join(tmpdir(), 'vac-store-calls-'));
const started = globalThis.performance.now();
try {
  await auditReplay({ corpus: await loadCorpus(), directory });
} finally {
  await rm(directory, { force: true, recursive: true });
}
console.log('total ms', Math.round(globalThis.performance.now() - started));
for (const [name, { calls, ms }] of [...stats].sort(
  (a, b) => b[1].ms - a[1].ms
)) {
  console.log(name, calls, Math.round(ms));
}
