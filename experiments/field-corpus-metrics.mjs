// Field-level precision and recall of the listing parser against the
// reviewed live corpus in experiments/fixtures/reviewed-live-corpus.json.
//
//   node experiments/field-corpus-metrics.mjs        # prints the report
//   node experiments/field-corpus-metrics.mjs --misses
//
// A field counts as extracted when the parser returns a value for it. An
// extracted value that matches the reviewed value is a true positive; one
// that does not is a false positive (and a false negative when the reviewer
// expected a value). Precision = TP / (TP + FP); recall = TP / (TP + FN).
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  classifyTelegramPost,
  normalizeOffer,
  parseTelegramOffer,
} from '../src/index.js';

export const CORPUS_URL = new globalThis.URL(
  './fixtures/reviewed-live-corpus.json',
  import.meta.url
);

const WEB_EXCLUDED_LABELS = new Set([
  'commercial',
  'request',
  'sale',
  'service',
]);

export const FIELDS = [
  'offer',
  'price',
  'period',
  'availability',
  'location',
  'rooms',
];

export const FIELD_THRESHOLDS = Object.freeze({
  offer: { precision: 0.95, recall: 0.95 },
  price: { precision: 0.98, recall: 0.9 },
  period: { precision: 0.98, recall: 0.9 },
  availability: { precision: 0.98, recall: 0.98 },
  location: { precision: 0.95, recall: 0.9 },
  rooms: { precision: 0.95, recall: 0.9 },
});

export async function loadCorpus(url = CORPUS_URL) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function fold(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('en');
}

// The collector classifies Telegram posts fully; web cards are dropped only
// on clear non-rental intent.
function eligibility(input) {
  const telegram = input.sourceType === 'telegram';
  const relevance = classifyTelegramPost(input.text, {
    targetLocation:
      telegram && input.focus === 'nha-trang' ? 'nha-trang' : null,
  });
  return telegram
    ? relevance.eligible
    : !WEB_EXCLUDED_LABELS.has(relevance.label);
}

function parseCase(input, postedAt, rates) {
  if (input.sourceType === 'telegram') {
    return parseTelegramOffer(
      {
        date: postedAt,
        inheritedLocation:
          input.focus === 'nha-trang' ? 'Nha Trang, Vietnam' : undefined,
        sourceId: input.sourceId,
        text: input.text,
      },
      { now: postedAt, rates }
    );
  }
  return normalizeOffer(
    { postedAt, sourceId: input.sourceId, sourceType: 'web', text: input.text },
    {
      locationHint:
        input.focus === 'nha-trang' ? 'Nha Trang, Vietnam' : undefined,
      now: postedAt,
      rates,
    }
  );
}

// What the collector would store for one corpus message.
export async function predictCase(testCase, { rates } = {}) {
  const { input } = testCase;
  const postedAt = new Date(input.postedAt);
  const offer = (await parseCase(input, postedAt, rates)) || {};
  const inherited = offer.locationProvenance?.method === 'source-inherited';
  return {
    offer: eligibility(input),
    price: offer.price ?? undefined,
    period: offer.price?.period ?? undefined,
    availability:
      offer.attributes?.availability === 'unavailable'
        ? 'unavailable'
        : undefined,
    location: (!inherited && offer.location) || undefined,
    rooms: offer.attributes?.bedrooms ?? undefined,
  };
}

// The reviewed location lists the acceptable names: any of them inside the
// extracted location counts as a match.
function matches(field, actual, expected) {
  if (field === 'price') {
    return ['amount', 'currency', 'period'].every(
      (key) => actual[key] === expected[key]
    );
  }
  if (field === 'location') {
    const names = Array.isArray(expected) ? expected : [expected];
    return names.some((name) => fold(actual).includes(fold(name)));
  }
  return actual === expected;
}

function present(value) {
  return value !== undefined && value !== null && value !== false;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

// `predict` maps one corpus case to the stored fields; the default runs the
// parser directly, and the search-service audit reads them from the store.
export async function fieldMetrics(
  corpus,
  { predict = predictCase, rates = corpus.rates } = {}
) {
  const counts = Object.fromEntries(
    FIELDS.map((field) => [field, { fn: 0, fp: 0, tp: 0 }])
  );
  const misses = [];
  for (const testCase of corpus.cases) {
    const actual = await predict(testCase, { rates });
    // Offer fields are reviewed only on offers; other posts score "offer".
    const fields = testCase.expected.offer ? FIELDS : ['offer'];
    for (const field of fields) {
      const expected = testCase.expected[field];
      const got = actual[field];
      const counter = counts[field];
      if (present(got) && present(expected) && matches(field, got, expected)) {
        counter.tp += 1;
        continue;
      }
      if (present(got)) {
        counter.fp += 1;
      }
      if (present(expected)) {
        counter.fn += 1;
      }
      if (present(got) || present(expected)) {
        misses.push({ actual: got, expected, field, id: testCase.id });
      }
    }
  }
  const fields = Object.fromEntries(
    Object.entries(counts).map(([field, { fn, fp, tp }]) => {
      const precision = ratio(tp, tp + fp);
      const recall = ratio(tp, tp + fn);
      const threshold = FIELD_THRESHOLDS[field];
      return [
        field,
        {
          falseNegative: fn,
          falsePositive: fp,
          // No expected positives means no evidence for recall, even if
          // predictions exist. Publish coverage separately from accuracy.
          status: tp + fn ? 'evaluated' : 'not-evaluated',
          pass:
            tp + fn
              ? (precision ?? 0) >= threshold.precision &&
                (recall ?? 0) >= threshold.recall
              : null,
          precision,
          recall,
          threshold,
          truePositive: tp,
        },
      ];
    })
  );
  return {
    cases: corpus.cases.length,
    corpusSchemaVersion: corpus.schemaVersion,
    fields,
    languages: [
      ...new Set(corpus.cases.map(({ language }) => language)),
    ].sort(),
    misses,
    pass:
      corpus.cases.length > 0 &&
      Object.values(fields).every(({ pass }) => pass !== false),
    sources: new Set(corpus.cases.map(({ input }) => input.sourceId)).size,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await fieldMetrics(await loadCorpus());
  const output = process.argv.includes('--misses')
    ? report
    : { ...report, misses: report.misses.length };
  console.log(JSON.stringify(output, null, 2));
}
