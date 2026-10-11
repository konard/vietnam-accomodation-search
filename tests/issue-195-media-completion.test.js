import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { reconcileTelegramMaterials } from '../src/telegram-pipeline.js';

const messages = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1,
  sourceId: 'self-authored-media',
  groupedId: 'album',
  text: '',
  media: { id: `photo-${index}` },
}));

describe('explicit photo-only OCR coverage', () => {
  it('includes every native album photo in OCR completion accounting', async () => {
    const seen = [];
    const result = await reconcileTelegramMaterials(messages, {
      ocr: async (id) => {
        seen.push(id);
        return id === 'photo-3'
          ? 'Apartment for rent in Nha Trang, 8 million VND/month.'
          : '';
      },
    });
    assert.equal(seen.length, 4);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.mediaCoverage.ocrComplete, true);
    assert.equal(result.accepted[0].attributes.reviewRequired, true);
    assert.equal(result.complete, false);
  });

  it('keeps an explicitly bounded OCR subset incomplete', async () => {
    const result = await reconcileTelegramMaterials(messages, {
      maxOcrPhotos: 1,
      ocr: async () => 'Apartment for rent in Nha Trang, 8 million VND/month.',
    });
    assert.equal(result.mediaCoverage.ocrComplete, false);
    assert.equal(result.mediaCoverage.ocrProcessed, 1);
    assert.equal(result.mediaCoverage.photoOnlyPhotos, 4);
    assert.equal(result.complete, false);
  });
});
