// Self-authored SDK/provider/cache concurrency probe, without credentials.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Photo } from '@mtcute/core';
import { MediaCache, MtcuteTelegramProvider } from '../src/index.js';

let calls = 0;
let active = 0;
let maximumActive = 0;
const photos = new Map(
  Array.from({ length: 10 }, (_, index) => [
    index + 1,
    new Photo({
      _: 'photo',
      id: BigInt(index + 101),
      accessHash: 1n,
      fileReference: new Uint8Array([1]),
      dcId: 2,
      date: 1,
      sizes: [{ _: 'photoSize', type: 'x', w: 20, h: 20, size: 3 }],
    }),
  ])
);
const client = {
  start: () => Promise.resolve(),
  getMe: () => Promise.resolve({ id: 99 }),
  getMessages: async (_peer, id) => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await delay(5);
    active -= 1;
    return [{ media: photos.get(id) }];
  },
  async *downloadAsIterable() {
    yield new Uint8Array([1, 2, 3]);
  },
  destroy: () => Promise.resolve(),
};
const provider = new MtcuteTelegramProvider({
  apiId: 12,
  apiHash: 'qa-fixture',
  session: 'qa-fixture',
  clientFactory: () => Promise.resolve(client),
});
const directory = await mkdtemp(join(tmpdir(), 'vac-qa-photo-concurrency-'));
try {
  // Connect before the parallel cache operation so login is not under test.
  await provider.identity();
  const material = {
    mediaIds: [...photos.values()].map((photo) => String(photo.id)),
    members: [...photos].map(([id, photo]) => ({
      id,
      sourceId: 'telegram:qa_fixture',
      media: { id: String(photo.id) },
    })),
  };
  const cache = new MediaCache({ directory });
  const offer = { sourceId: 'telegram:qa_fixture' };
  await cache.cacheTelegramPhotos(offer, material, provider);
  assert.equal(offer.cachedPhotos.length, 10);
  const result = {
    cachePositiveControl: true,
    singleAlbumPhotoLookups: calls,
    maximumConcurrentPhotoLookups: maximumActive,
    hasSharedLookupBoundBelowAlbumSize: maximumActive < 10,
  };
  console.log(JSON.stringify(result));
  assert(
    result.hasSharedLookupBoundBelowAlbumSize,
    'Native media caching bursts one lookup per album photo without a shared lookup limit.'
  );
} finally {
  await provider.destroy();
  await rm(directory, { recursive: true, force: true });
}
