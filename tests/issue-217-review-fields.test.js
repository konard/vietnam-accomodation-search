import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import * as acceptance from '../experiments/source-acceptance-lib.mjs';

// Structural fixtures only; these never supply independent live truth.
function evidence() {
  const prediction = {
    offer: true,
    bedrooms: 2,
    rooms: 3,
    beds: 4,
    billingScope: 'unit',
    quoteBasis: 'bed',
    period: 'month',
    currency: 'USD',
  };
  const negative = Object.fromEntries(
    Object.keys(prediction).map((field) => [
      field,
      field === 'offer' ? false : null,
    ])
  );
  const observation = {
    sourceId: 'self-authored-review-control',
    observedAt: new Date().toISOString(),
    provenance: 'live',
    type: 'web',
    fetchComplete: true,
    paginationComplete: true,
    parseComplete: true,
    materials: [
      { id: 'positive', digest: 'positive', prediction },
      { id: 'negative', digest: 'negative', prediction: negative },
    ],
  };
  const review = {
    sourceId: observation.sourceId,
    observedAt: observation.observedAt,
    origin: 'independent-live-review',
    independent: true,
    blindToPredictions: true,
    labels: observation.materials.map(({ id, digest, prediction }) => ({
      id,
      digest,
      expected: { ...prediction },
    })),
  };
  return { observation, review };
}

for (const field of ['billingScope', 'currency']) {
  it(`requires explicit independently reviewed ${field} labels and scores incorrect values`, () => {
    const { observation, review } = evidence();
    assert.equal(
      acceptance.evaluateSourceAcceptance(observation, review).pass,
      true
    );
    observation.materials[0].prediction[field] = 'incorrect';
    const measured = acceptance.evaluateSourceAcceptance(observation, review);
    assert.equal(measured.pass, false);
    assert.equal(measured.metrics[field].falsePositive, 1);
    assert.equal(measured.metrics[field].falseNegative, 1);
    delete review.labels[0].expected[field];
    assert(
      acceptance
        .evaluateSourceAcceptance(observation, review)
        .reasons.includes('missing-or-stale-label')
    );
    assert.equal(
      acceptance.reviewTemplate(observation).labels[0].expected[field],
      null
    );
  });
}

it('cannot pass an independently labelled sample containing only positive offers', () => {
  const { observation, review } = evidence();
  observation.materials.pop();
  review.labels.pop();
  assert.equal(
    acceptance.evaluateSourceAcceptance(observation, review).pass,
    false
  );
});

it('captures quote currency and billing scope without converting a per-person quote to a bed', () => {
  const predicted = acceptance.sourcePrediction({
    price: { currency: 'USD', basis: 'person', period: 'night' },
    attributes: { beds: 2 },
  });
  assert.equal(predicted.currency, 'USD');
  assert.equal(predicted.quoteBasis, 'person');
  assert.equal(predicted.billingScope, 'person');
  assert.equal(
    acceptance.sourcePrediction({ priceBasis: 'bed' }).billingScope,
    'unit'
  );
  assert.equal(
    acceptance.sourcePrediction({ priceBasis: 'property' }).billingScope,
    'whole-property'
  );
  assert.equal(
    acceptance.sourcePrediction({ priceBasis: 'unknown' }).billingScope,
    null
  );
  assert.equal(acceptance.sourcePrediction(undefined).currency, null);
});
