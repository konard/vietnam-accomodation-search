// Compares the stored LiNo size of a replayed pre-bounding offer with its
// bounded form (`node experiments/issue-85-replayed-offer-size.mjs`).
import { serializeOffers } from '../src/links-store.js';
import { boundStoredOffer } from '../src/offer-bounds.js';

const bytes = (length, value) => ({
  data: Array.from({ length }, () => value),
  type: 'Buffer',
});
const photos = Array.from({ length: 10 }, (_, index) => ({
  className: 'Photo',
  fileReference: bytes(32, 7),
  id: `5431${index}`,
  sizes: [{ bytes: bytes(900, 1), className: 'PhotoStrippedSize', type: 'i' }],
}));
const offer = {
  collectedAt: '2026-09-25T00:00:00.000Z',
  id: 'telegram:replay:5431',
  photos: photos.map(({ id }) => id),
  raw: { id: 5431, media: { photo: photos[0] }, photos, text: 'Studio' },
  sourceId: 'telegram:replay',
  title: 'Studio',
};
const size = (value) => Buffer.byteLength(serializeOffers([value]));
const raw = serializeOffers([offer]);
console.log({
  boundedBytes: size(boundStoredOffer(offer)),
  replayedBytes: size(offer),
  replayedByteLinks: (raw.match(/\/bytes\/data\/\d+/gu) || []).length,
});
