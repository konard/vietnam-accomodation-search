#!/usr/bin/env node
// Read-only public-page inspection: no inquiries or access bypass.
import { resolve } from 'node:path';
import { createApplication } from '../src/application.js';
import { withQaCleanup } from './qa-cleanup.mjs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes('--url') || !args.includes('--directory')) {
  throw new Error(
    'Use --url OFFICIAL_DETAIL_URL --directory PRIVATE_EVIDENCE_CACHE.'
  );
}
withQaCleanup(async (_scope, signal) => {
  const app = createApplication({
    directory: resolve(option('--directory')),
    logger: { debug() {} },
  });
  const detail = await app.collector.inspectDetail(option('--url'), { signal });
  console.log(
    JSON.stringify({
      status: detail.status,
      evidenceRetained: true,
      availabilityVerified: detail.status !== 'unknown',
    })
  );
}).catch(() => {
  console.error('Detail status remains unverified; inspect private evidence.');
  process.exitCode = 1;
});
