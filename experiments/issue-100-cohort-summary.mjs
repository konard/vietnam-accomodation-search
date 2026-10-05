#!/usr/bin/env node
// Folds several issue-96-source-cohort.mjs summaries into one per-source
// table: outcome per run plus collected and stored offer counts.
//
//   node experiments/issue-100-cohort-summary.mjs ci-logs/cohort-*.json \
//     > docs/case-studies/issue-100/source-cohort.json
import { readFile } from 'node:fs/promises';

import { DEFAULT_WEB_SOURCES } from '../src/index.js';

const runs = await Promise.all(
  process.argv
    .slice(2)
    .map(async (file) => JSON.parse(await readFile(file, 'utf8')))
);
const sources = DEFAULT_WEB_SOURCES.map(({ enabled, id, reason }) => ({
  enabled,
  id,
  ...(reason ? { reason } : {}),
  runs: runs.flatMap(({ outcomes, startedAt }) =>
    outcomes
      .filter(({ sourceId }) => sourceId === id)
      .map(({ category, collectedOffers, status, storedOffers }) => ({
        startedAt,
        status,
        ...(category ? { category } : {}),
        collectedOffers,
        storedOffers,
      }))
  ),
}));
console.log(
  JSON.stringify(
    {
      query: 'Nha Trang',
      runs: runs.map(({ startedAt }) => startedAt),
      sources,
    },
    null,
    2
  )
);
