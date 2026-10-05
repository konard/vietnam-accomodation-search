#!/usr/bin/env node
// Prints what the parser stores for chosen reviewed corpus cases.
//
//   node experiments/issue-100-trace-cases.mjs nha-trang-vn-001 be-jib-nha-trang-002
import { loadCorpus, predictCase } from './field-corpus-metrics.mjs';

const corpus = await loadCorpus(
  new globalThis.URL('./fixtures/reviewed-live-corpus.json', import.meta.url)
);
const ids = new Set(process.argv.slice(2));
for (const testCase of corpus.cases.filter(({ id }) => ids.has(id))) {
  const predicted = await predictCase(testCase, { rates: corpus.rates });
  console.log(testCase.id, JSON.stringify(predicted));
}
