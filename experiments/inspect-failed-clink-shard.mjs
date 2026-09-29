#!/usr/bin/env node

// Inspect a retained private clink shard failure without printing link data.
// Only counts and the schema version are printed. `rewrittenLinks` counts
// missing links whose id reappears with other values, the signature of clink
// rewriting an imported name (#55); a dropped link leaves it at zero.
// Usage: node experiments/inspect-failed-clink-shard.mjs PATH_TO_FAILED_SHARD

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { compareExport } from '../src/link-cli-mirror.js';

if (!process.argv[2]) {
  throw new TypeError('Pass the retained failed shard directory.');
}

const directory = resolve(process.argv[2]);
const [canonical, exported, failure] = await Promise.all([
  readFile(join(directory, 'canonical.lino'), 'utf8'),
  readFile(join(directory, 'verified.lino'), 'utf8'),
  readFile(join(directory, 'failure.json'), 'utf8').then(JSON.parse),
]);
const diagnostics = compareExport(canonical, exported);
const schema = canonical.match(/schema:associative-records-v(\d+)/u);
const result = {
  ...diagnostics,
  failureCode: failure.code,
  schemaVersion: schema ? Number(schema[1]) : 'not-in-shard',
  verification:
    diagnostics.missingLinks || diagnostics.unexpectedLinks
      ? diagnostics.rewrittenLinks
        ? 'name-rewritten'
        : 'link-mismatch'
      : 'pass',
};
if (result.verification !== 'pass') {
  process.exitCode = 1;
}

console.log(JSON.stringify(result));
