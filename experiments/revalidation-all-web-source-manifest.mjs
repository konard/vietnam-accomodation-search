// Export the complete public web seed inventory for a manual, read-only audit.
// Disabled entries remain disabled in production; this does not enable them.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_WEB_SOURCES } from '../src/sources.js';

const output = resolve(process.argv[2] || '');
assert(
  output.includes('.vietnam-accomodation-search/') && output.endsWith('.json'),
  'Choose an explicit private QA JSON output path.'
);
const disabledOnly = process.argv[3] === '--disabled-only';
assert(process.argv.length <= 4);
assert(
  process.argv[3] === undefined || disabledOnly,
  'Unknown manifest option.'
);
const sources = disabledOnly
  ? DEFAULT_WEB_SOURCES.filter(({ enabled }) => enabled === false)
  : DEFAULT_WEB_SOURCES;
const manifest = sources.map((source) => ({
  id: source.id,
  name: source.name,
  url: (source.searchUrl || source.url).replaceAll(
    '{query}',
    encodeURIComponent('Nha Trang')
  ),
  languages: source.languages,
  enabledInProduction: source.enabled !== false,
  disabledReason: source.reason,
  provenance: 'current-public-source-manifest-read-only-qa',
}));
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
console.log(JSON.stringify({ sources: manifest.length, disabledOnly }));
