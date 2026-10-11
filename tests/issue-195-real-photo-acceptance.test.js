import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { SearchService } from '../src/search-service.js';
import {
  selectRealPhotoCandidate,
  observePhotoNotification,
  observeNotificationSearch,
} from '../experiments/real-photo-acceptance.mjs';

describe('real photo acceptance selection and diagnostics', () => {
  it('skips an ineligible stored photo and selects the second final search result', async () => {
    const now = new Date();
    const base = {
      photos: ['fixture'],
      cachedPhotos: [{ url: 'fixture', path: '/self-authored.jpg' }],
      priceVnd: 8000000,
      price: { amount: 8000000, currency: 'VND', period: 'month' },
      collectedAt: now.toISOString(),
    };
    const offers = [
      {
        ...base,
        id: 'ineligible',
        attributes: { availability: 'unavailable', availableNow: false },
      },
      { ...base, id: 'eligible' },
    ];
    const store = { listOffers: async () => offers };
    const service = new SearchService({
      store,
      registry: { list: async () => [] },
      collector: {},
    });
    const diagnostics = {};
    const selected = await selectRealPhotoCandidate(
      service,
      store,
      diagnostics,
      { now }
    );
    assert.equal(selected.id, 'eligible');
    assert.equal(diagnostics.ineligiblePhotoCandidates, 1);
    assert.equal(diagnostics.selection, 'eligible-search-result');
  });

  it('keeps empty, rejected, text-only and accepted photos distinct', () => {
    const result = {};
    observePhotoNotification(result, 'sendMessage', {
      ok: true,
      result: { text: 'No new offers' },
    });
    assert.equal(result.notificationPhotoDelivered, false);
    assert.equal(result.notificationFailure, 'text-only-fallback');
    const empty = {};
    observeNotificationSearch(empty, []);
    assert.equal(empty.notificationFailure, 'empty-search-result');
    observePhotoNotification(result, 'sendPhoto', {
      ok: false,
      error_code: 400,
    });
    assert.equal(result.notificationFailure, 'bot-api-media-rejected');
    assert.equal(result.notificationMediaRejected, 1);
    observePhotoNotification(result, 'sendMediaGroup', {
      ok: true,
      result: [{ photo: [{}] }],
    });
    assert.equal(result.notificationPhotoDelivered, true);
    assert.equal(result.notificationFailure, undefined);
  });
});
