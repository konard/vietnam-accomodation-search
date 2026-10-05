#!/usr/bin/env node
// Appends listing cards of web sources the reviewed corpus lacks, without
// rebuilding the cases already there.
//
//   CARD_SOURCES=be-jib-nha-trang,nha-trang-vn,nha-trang-renting \
//     node experiments/issue-97-collect-vi-cards.mjs /tmp/web-cards.json
//   node experiments/issue-100-append-web-cases.mjs /tmp/web-cards.json 8
//
// Text is anonymised before it is written. Expected values start from the
// parser's output and are replaced by the reviewed values in
// fixtures/reviewed-live-corpus-review.json.
import { readFile, writeFile } from 'node:fs/promises';

import { FIELDS, loadCorpus, predictCase } from './field-corpus-metrics.mjs';
import { anonymize } from './live-corpus-anonymize.mjs';

const [cardsFile = '/tmp/web-cards.json', perSource = '8'] =
  process.argv.slice(2);
const fixtures = new globalThis.URL('./fixtures/', import.meta.url);
const corpusUrl = new globalThis.URL('reviewed-live-corpus.json', fixtures);
const corpus = await loadCorpus(corpusUrl);
const review = JSON.parse(
  await readFile(
    new globalThis.URL('reviewed-live-corpus-review.json', fixtures),
    'utf8'
  )
);
const covered = new Set(corpus.cases.map(({ input }) => input.sourceId));
const cards = JSON.parse(await readFile(cardsFile, 'utf8'));
const seen = new Set();
const added = [];
for (const card of cards) {
  const text = anonymize(card.text || '').trim();
  const key = `${card.sourceId}\n${text}`;
  const count = added.filter(
    ({ input }) => input.sourceId === card.sourceId
  ).length;
  if (
    !text ||
    covered.has(card.sourceId) ||
    seen.has(key) ||
    count >= Number(perSource)
  ) {
    continue;
  }
  seen.add(key);
  const id = `${card.sourceId}-${String(count + 1).padStart(3, '0')}`;
  const input = {
    focus: 'nha-trang',
    postedAt: `${corpus.collectedAt}T00:00:00.000Z`,
    sourceId: card.sourceId,
    sourceType: 'web',
    text,
  };
  const language = /[а-яё]/iu.test(text)
    ? 'ru'
    : /[ăâđêôơưạảãáàặẳẵắằậẩẫấầ]/iu.test(text)
      ? 'vi'
      : 'en';
  const testCase = { id, language, input };
  const predicted = await predictCase(testCase, { rates: corpus.rates });
  const reviewed = review.reviews[id] || {};
  const expected = Object.fromEntries(
    FIELDS.map((field) => [
      field,
      field in reviewed ? reviewed[field] : predicted[field],
    ])
  );
  added.push({ ...testCase, expected: JSON.parse(JSON.stringify(expected)) });
}
corpus.cases.push(...added);
await writeFile(corpusUrl, `${JSON.stringify(corpus, null, 2)}\n`);
console.error(
  `${added.length} cases added: ${JSON.stringify(
    Object.fromEntries(
      Map.groupBy(added, ({ input }) => input.sourceId)
        .entries()
        .map(([sourceId, list]) => [sourceId, list.length])
    )
  )}`
);
