// QA-only gate. Reviewer independence is an explicit human attestation, not
// something a program can establish. No parser-generated ground truth.
import { quoteBasis } from '../src/value-pricing.js';

const FIELDS = [
  'offer',
  'bedrooms',
  'rooms',
  'beds',
  'billingScope',
  'quoteBasis',
  'period',
  'currency',
];
const THRESHOLDS = {
  offer: [0.95, 0.95],
  bedrooms: [0.95, 0.9],
  rooms: [0.95, 0.9],
  beds: [0.95, 0.9],
  quoteBasis: [0.98, 0.9],
  period: [0.98, 0.9],
  billingScope: [0.98, 0.9],
  currency: [0.98, 0.9],
};
const present = (value) =>
  value !== null && value !== undefined && value !== false;

export function sourcePrediction(offer) {
  const value = offer || {};
  const price = value.price || {};
  const attributes = value.attributes || {};
  const basis = offer
    ? price.basis ||
      value.priceBasis ||
      quoteBasis(value.raw?.text || value.title)
    : null;
  const scope = {
    property: 'whole-property',
    bedroom: 'unit',
    bed: 'unit',
    room: 'unit',
    person: 'person',
  };
  return {
    offer: Boolean(offer),
    bedrooms: attributes.bedrooms ?? null,
    rooms: attributes.rooms ?? null,
    beds: attributes.beds ?? null,
    billingScope: Object.hasOwn(scope, basis) ? scope[basis] : null,
    quoteBasis: basis,
    period: price.period ?? null,
    currency: price.currency ?? null,
  };
}

export function nativeParseComplete(checkpoint, reviews) {
  if (checkpoint?.historyComplete !== true || checkpoint.retentionLoss) {
    return false;
  }
  if (checkpoint.complete === true) {
    return true;
  }
  // Independently reviewed labels may resolve extracted OCR fields. They
  // cannot resolve missing extraction, conflicting captions or media failures.
  return (
    reviews.length > 0 &&
    reviews.every(
      (review) =>
        review.state === 'excluded' ||
        (review.state === 'review' &&
          review.accepted === true &&
          review.reason === 'ocr-fields-unverified')
    )
  );
}

export function findMaterialOffer(offers, material, source) {
  const members = new Set((material.messageIds || [material.id]).map(String));
  return offers
    .flatMap((offer) => (offer.variants?.length ? offer.variants : [offer]))
    .find((offer) => {
      if ((offer.provenance?.sourceId || offer.sourceId) !== source.id) {
        return false;
      }
      if (source.type !== 'telegram') {
        return offer.url === material.url || offer.raw?.url === material.url;
      }
      return [
        offer.provenance?.messageId,
        ...(offer.provenance?.messageIds || []),
      ]
        .filter((id) => id !== undefined)
        .some((id) => members.has(String(id)));
    });
}

export function reviewTemplate(observation) {
  return {
    sourceId: observation.sourceId,
    observedAt: observation.observedAt,
    origin: 'pending-independent-review',
    independent: false,
    blindToPredictions: false,
    labels: observation.materials.map(({ id, digest, photoOnly }) => ({
      id,
      digest,
      ...(photoOnly ? { mediaReviewed: false } : {}),
      expected: Object.fromEntries(FIELDS.map((field) => [field, null])),
    })),
  };
}

// eslint-disable-next-line complexity -- Metrics distinguish missing values, mismatches and negative controls.
function fieldMetrics(materials, labels, field) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let positiveLabels = 0;
  let negativeLabels = 0;
  for (const material of materials) {
    const actual = material.prediction?.[field] ?? null;
    const expected = labels.get(material.id)?.expected?.[field] ?? null;
    if (present(expected)) {
      positiveLabels += 1;
    } else {
      negativeLabels += 1;
    }
    if (present(actual) && actual === expected) {
      truePositive += 1;
    } else {
      if (present(actual)) {
        falsePositive += 1;
      }
      if (present(expected)) {
        falseNegative += 1;
      }
      if (!present(actual) && !present(expected)) {
        trueNegative += 1;
      }
    }
  }
  const precision =
    truePositive + falsePositive
      ? truePositive / (truePositive + falsePositive)
      : null;
  const recall =
    truePositive + falseNegative
      ? truePositive / (truePositive + falseNegative)
      : null;
  const [minimumPrecision, minimumRecall] = THRESHOLDS[field];
  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    positiveLabels,
    negativeLabels,
    precision,
    recall,
    minimumPrecision,
    minimumRecall,
    // Positive cases are required to measure precision and recall.
    pass:
      precision !== null &&
      recall !== null &&
      positiveLabels > 0 &&
      negativeLabels > 0 &&
      precision >= minimumPrecision &&
      recall >= minimumRecall,
  };
}

// eslint-disable-next-line complexity -- Every independent collection, freshness and review requirement fails closed.
export function evaluateSourceAcceptance(
  observation,
  review,
  { now = Date.now(), maxAgeMs = 6 * 60 * 60 * 1000 } = {}
) {
  const reasons = [];
  const reject = (condition, reason) => {
    if (condition) {
      reasons.push(reason);
    }
  };
  const age = now - Date.parse(observation.observedAt);
  reject(observation.provenance !== 'live', 'live-evidence-required');
  reject(
    !Number.isFinite(age) || age < 0 || age > maxAgeMs,
    'stale-observation'
  );
  reject(
    observation.fetchComplete !== true || observation.parseComplete !== true,
    'incomplete-fetch-or-parse'
  );
  reject(observation.paginationComplete !== true, 'incomplete-pagination');
  reject(observation.retentionLoss === true, 'retention-loss');
  reject(Boolean(observation.exclusion), 'source-excluded');
  if (observation.type === 'telegram') {
    reject(observation.historyComplete !== true, 'incomplete-native-history');
    reject(
      observation.mediaCoverage?.ocrComplete !== true ||
        observation.mediaCoverage?.uploadComplete !== true,
      'incomplete-native-media'
    );
  }
  reject(
    review?.sourceId !== observation.sourceId ||
      review?.observedAt !== observation.observedAt,
    'review-observation-mismatch'
  );
  reject(
    review?.origin !== 'independent-live-review' ||
      review?.independent !== true ||
      review?.blindToPredictions !== true,
    'independent-review-required'
  );
  const labels = new Map(
    (review?.labels || []).map((label) => [label.id, label])
  );
  const materials = observation.materials || [];
  reject(!materials.length, 'no-reviewed-materials');
  reject(
    labels.size !== materials.length || labels.size !== review?.labels?.length,
    'incomplete-or-duplicate-labels'
  );
  for (const material of materials) {
    const label = labels.get(material.id);
    reject(
      !label ||
        label.digest !== material.digest ||
        !FIELDS.every((field) => Object.hasOwn(label.expected || {}, field)) ||
        typeof label.expected?.offer !== 'boolean',
      'missing-or-stale-label'
    );
    reject(
      material.photoOnly && label?.mediaReviewed !== true,
      'photo-only-review-required'
    );
  }
  const metrics = Object.fromEntries(
    FIELDS.map((field) => [field, fieldMetrics(materials, labels, field)])
  );
  reject(
    Object.values(metrics).some((metric) => !metric.pass),
    'field-quality-unmeasured-or-below-threshold'
  );
  return {
    observedAt: observation.observedAt,
    pass: reasons.length === 0,
    state: reasons.length ? 'incomplete' : 'accepted',
    reasons: [...new Set(reasons)],
    metrics,
    reviewedMaterials: labels.size,
    globalOptimality: 'unverified',
  };
}
