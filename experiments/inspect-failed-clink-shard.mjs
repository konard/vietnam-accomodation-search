#!/usr/bin/env node

// Inspect a retained private clink shard failure without printing link data.
// Usage: node experiments/inspect-failed-clink-shard.mjs PATH_TO_FAILED_SHARD

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseNotation, verifyExport } from '../src/link-cli-mirror.js';

if (!process.argv[2]) {
  throw new TypeError('Pass the retained failed shard directory.');
}

const directory = resolve(process.argv[2]);
const [canonical, exported, failure] = await Promise.all([
  readFile(join(directory, 'canonical.lino'), 'utf8'),
  readFile(join(directory, 'verified.lino'), 'utf8'),
  readFile(join(directory, 'failure.json'), 'utf8').then(JSON.parse),
]);
const canonicalLinks = parseNotation(canonical);
const exportedLinks = parseNotation(exported);
const linkKey = (link) =>
  JSON.stringify([link.id, link.values.map(({ id }) => id)]);
const expected = new Set(canonicalLinks.map(linkKey));
const actual = new Set(exportedLinks.map(linkKey));
const referenced = new Set(
  canonicalLinks.flatMap((link) => link.values.map(({ id }) => id))
);
const missing = canonicalLinks.filter((link) => !actual.has(linkKey(link)));
const unexpected = exportedLinks.filter(
  (link) =>
    !expected.has(linkKey(link)) &&
    !(
      referenced.has(link.id) &&
      link.values.length === 2 &&
      link.values.every(({ id }) => id === link.id)
    )
);
const result = {
  canonicalLinks: canonicalLinks.length,
  exportedLinks: exportedLinks.length,
  failureCode: failure.code,
  missingArities: missing.map((link) => link.values.length),
  missingIdMatchesUnexpected: missing.some((link) =>
    unexpected.some((candidate) => candidate.id === link.id)
  ),
  unexpectedArities: unexpected.map((link) => link.values.length),
  unexpectedIdsReferenced: unexpected.map((link) => referenced.has(link.id)),
};

try {
  verifyExport(canonical, exported);
  result.verification = 'pass';
} catch (error) {
  const counts = String(error?.message).match(
    /^clink export verification failed \((\d+) links missing, (\d+) unexpected links\)$/u
  );
  result.verification = counts ? 'link-mismatch' : 'other-error';
  if (counts) {
    result.missingLinks = Number(counts[1]);
    result.unexpectedLinks = Number(counts[2]);
  } else {
    result.errorType = error?.constructor?.name || 'Error';
  }
  process.exitCode = 1;
}

console.log(JSON.stringify(result));
