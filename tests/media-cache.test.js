import { describe, expect, it } from 'test-anywhere';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MediaCache } from '../src/index.js';

describe('bounded photo cache', () => {
  it('offloads cached files while preserving their original URLs', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }

    const directory = await mkdtemp(join(tmpdir(), 'accommodation-cache-'));
    const url = 'https://img.example/room.jpg';
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'offers.lino'), '123456');
      const cache = new MediaCache({
        directory,
        fetchImpl: async () =>
          new globalThis.Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
        maxBytes: 10,
      });
      const offers = [{ photos: [url] }];

      await cache.cacheOffers(offers);

      expect(offers[0].photos).toEqual([url]);
      expect(offers[0].cachedPhotos).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('downloads at most ten photos for one offer', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }

    const directory = await mkdtemp(join(tmpdir(), 'accommodation-cache-'));
    let downloads = 0;
    try {
      const cache = new MediaCache({
        directory,
        fetchImpl: async () => {
          downloads += 1;
          return new globalThis.Response(new Uint8Array([1]));
        },
        maxBytes: 1024,
      });
      const offers = [
        {
          photos: Array.from(
            { length: 12 },
            (_, index) => `https://img.example/${index}.jpg`
          ),
        },
      ];

      await cache.cacheOffers(offers);

      expect(downloads).toBe(10);
      expect(offers[0].cachedPhotos.length).toBe(10);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
