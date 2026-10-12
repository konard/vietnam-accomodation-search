import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  evaluateSourceAcceptance,
  findMaterialOffer,
  nativeParseComplete,
  reviewTemplate,
} from '../experiments/source-acceptance-lib.mjs';
import { deduplicateOffers } from '../src/offers.js';

// Structural controls only. These fixtures are never live acceptance evidence.
function control() {
  const observation = {
    sourceId: 'self-authored-control',
    provenance: 'live',
    observedAt: new Date().toISOString(),
    type: 'web',
    fetchComplete: true,
    parseComplete: true,
    paginationComplete: true,
    materials: [
      {
        id: 'positive',
        digest: 'positive-version',
        prediction: {
          offer: true,
          bedrooms: 2,
          rooms: 3,
          beds: 4,
          quoteBasis: 'property',
          billingScope: 'whole-property',
          period: 'month',
          currency: 'VND',
        },
      },
      {
        id: 'negative',
        digest: 'negative-version',
        prediction: {
          offer: false,
          bedrooms: null,
          rooms: null,
          beds: null,
          quoteBasis: null,
          billingScope: null,
          period: null,
          currency: null,
        },
      },
    ],
  };
  const review = reviewTemplate(observation);
  review.origin = 'independent-live-review';
  review.independent = true;
  review.blindToPredictions = true;
  review.labels = observation.materials.map((material) => ({
    id: material.id,
    digest: material.digest,
    expected: { ...material.prediction },
    mediaReviewed: true,
  }));
  return { observation, review };
}

describe('independent source acceptance gate', () => {
  it('allows independent review of extracted OCR fields while retaining genuine native parse failures', () => {
    const checkpoint = { historyComplete: true, complete: false };
    const review = {
      state: 'review',
      accepted: true,
      reason: 'ocr-fields-unverified',
    };
    assert.equal(nativeParseComplete(checkpoint, [review]), true);
    for (const reviews of [
      [],
      [{ ...review, accepted: false }],
      [{ ...review, reason: 'conflicting-album-captions' }],
      [{ ...review, state: 'degraded' }],
      [{ ...review, state: 'error' }],
    ]) {
      assert.equal(nativeParseComplete(checkpoint, reviews), false);
    }
    assert.equal(
      nativeParseComplete({ ...checkpoint, retentionLoss: true }, [review]),
      false
    );
    assert.equal(
      nativeParseComplete({ ...checkpoint, historyComplete: false }, [review]),
      false
    );
    const { observation, review: labels } = control();
    assert.equal(
      evaluateSourceAcceptance(
        { ...observation, parseComplete: true },
        { ...labels, independent: false }
      ).pass,
      false
    );
  });
  it('reviews native provenance from the requested source even after cross-source deduplication', () => {
    const original = {
      id: 'unit-a',
      sourceId: 'native-a',
      provenance: { sourceId: 'native-a', messageIds: [7, 8] },
      title: 'Self-authored apartment',
      priceVnd: 12_000_000,
      price: { amount: 12_000_000, currency: 'VND', period: 'month' },
      identifiers: { propertyId: 'unit-a' },
      collectedAt: new Date().toISOString(),
    };
    const repeated = {
      ...original,
      id: 'unit-b',
      sourceId: 'native-b',
      provenance: { sourceId: 'native-b', messageId: 9 },
    };
    const merged = deduplicateOffers([original, repeated]);
    assert.equal(merged.length, 1);
    const found = findMaterialOffer(
      merged,
      { messageIds: ['8'] },
      { id: 'native-a', type: 'telegram' }
    );
    assert.equal(found.sourceId, 'native-a');
    assert.equal(
      findMaterialOffer(
        merged,
        { messageIds: [9] },
        { id: 'native-a', type: 'telegram' }
      ),
      undefined
    );
  });
  it('never produces labels from the parser prediction', () => {
    const { observation } = control();
    const template = reviewTemplate(observation);
    assert.equal(template.independent, false);
    assert.equal(template.labels[0].expected.offer, null);
    assert.equal(template.labels[0].expected.bedrooms, null);
  });
  it('scores false positives and false negatives separately for every required field', () => {
    const { observation, review } = control();
    observation.materials[0].prediction.beds = 3;
    observation.materials[1].prediction.rooms = 1;
    const result = evaluateSourceAcceptance(observation, review);
    assert.equal(result.pass, false);
    assert.equal(result.metrics.beds.falsePositive, 1);
    assert.equal(result.metrics.beds.falseNegative, 1);
    assert.equal(result.metrics.rooms.falsePositive, 1);
    assert.equal(result.globalOptimality, 'unverified');
  });
  it('requires live provenance, complete collection, matching fresh labels and independent review', () => {
    const { observation, review } = control();
    assert.equal(evaluateSourceAcceptance(observation, review).pass, true);
    for (const change of [
      { provenance: 'fixture' },
      { paginationComplete: false },
      { fetchComplete: false },
      { parseComplete: false },
      { retentionLoss: true },
      { observedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
    ]) {
      assert.equal(
        evaluateSourceAcceptance({ ...observation, ...change }, review).pass,
        false
      );
    }
    for (const change of [
      { independent: false },
      { blindToPredictions: false },
      { labels: review.labels.slice(0, 1) },
      { sourceId: 'other-source' },
      { origin: 'parser-generated' },
    ]) {
      assert.equal(
        evaluateSourceAcceptance(observation, { ...review, ...change }).pass,
        false
      );
    }
    review.labels[0].digest = 'old-version';
    assert.equal(evaluateSourceAcceptance(observation, review).pass, false);
  });
  it('requires full native history, OCR and independent photo-only review', () => {
    const { observation, review } = control();
    observation.type = 'telegram';
    observation.historyComplete = true;
    observation.materials[0].photoOnly = true;
    observation.mediaCoverage = { ocrComplete: true, uploadComplete: true };
    assert.equal(evaluateSourceAcceptance(observation, review).pass, true);
    for (const change of [
      { historyComplete: false },
      { mediaCoverage: { ocrComplete: false, uploadComplete: true } },
      { mediaCoverage: { ocrComplete: true, uploadComplete: false } },
    ]) {
      assert.equal(
        evaluateSourceAcceptance({ ...observation, ...change }, review).pass,
        false
      );
    }
    review.labels[0].mediaReviewed = false;
    assert.equal(evaluateSourceAcceptance(observation, review).pass, false);
  });
});
