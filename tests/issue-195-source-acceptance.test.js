import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  evaluateSourceAcceptance,
  reviewTemplate,
} from '../experiments/source-acceptance-lib.mjs';

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
          period: 'month',
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
          period: null,
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
