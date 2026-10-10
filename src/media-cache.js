import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { stableHash } from './utils.js';

// Concurrent saves rename their temporary files while the budget walks the
// data directory, so a listed entry may be gone by the time it is read.
function unlessGone(error) {
  if (error.code === 'ENOENT') {
    return undefined;
  }
  throw error;
}

async function filesBelow(directory) {
  const files = [];
  const entries =
    (await readdir(directory, { withFileTypes: true }).catch(unlessGone)) || [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path)));
      continue;
    }
    const details = await stat(path).catch(unlessGone);
    if (details) {
      files.push({ path, size: details.size, modifiedAt: details.mtimeMs });
    }
  }
  return files;
}

export class MediaCache {
  constructor({
    directory = '.vietnam-accomodation-search',
    fetchImpl = globalThis.fetch,
    maxBytes = 10 * 1024 ** 3,
    photoTimeoutMs = 15_000,
  } = {}) {
    this.directory = directory;
    this.mediaDirectory = join(directory, 'media');
    this.fetchImpl = fetchImpl;
    this.maxBytes = maxBytes;
    this.photoTimeoutMs = photoTimeoutMs;
  }

  // Every download has its own timeout, so a photo host that accepts the
  // connection and then stalls cannot hold the caller for the HTTP client's
  // default timeout (300 s in Node).
  async cachePhoto(url, { signal } = {}) {
    const timeout = AbortSignal.timeout(this.photoTimeoutMs);
    const response = await this.fetchImpl(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      throw new Error(`Photo download returned HTTP ${response.status}`);
    }
    const pathname = new globalThis.URL(url).pathname;
    const extension = extname(pathname).slice(0, 8) || '.img';
    const path = join(this.mediaDirectory, `${stableHash(url)}${extension}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await mkdir(this.mediaDirectory, { recursive: true });
    await writeFile(path, bytes);
    return {
      cachedAt: new Date().toISOString(),
      path,
      size: bytes.byteLength,
      url,
    };
  }

  async cacheTelegramPhotos(offer, material, provider, { signal } = {}) {
    const downloads = await Promise.allSettled(
      (material.mediaIds || []).slice(0, 10).map(async (id) => {
        const bytes = await provider.photo(id, {
          material,
          signal,
          maxBytes: 10 * 1024 ** 2,
          timeoutMs: this.photoTimeoutMs,
        });
        const path = join(
          this.mediaDirectory,
          `${stableHash(`${offer.sourceId}:${id}`)}.jpg`
        );
        await mkdir(this.mediaDirectory, { recursive: true, mode: 0o700 });
        await writeFile(path, bytes, { mode: 0o600 });
        return {
          cachedAt: new Date().toISOString(),
          path,
          size: bytes.byteLength,
          url: id,
        };
      })
    );
    offer.cachedPhotos = downloads
      .filter(({ status }) => status === 'fulfilled')
      .map(({ value }) => value);
    offer.mediaStatus =
      offer.cachedPhotos.length === Math.min(10, material.mediaIds?.length || 0)
        ? 'cached'
        : 'incomplete';
    await this.enforceBudget([offer]);
    if (
      offer.cachedPhotos.length < Math.min(10, material.mediaIds?.length || 0)
    ) {
      offer.mediaStatus = 'incomplete';
    }
    return offer;
  }

  // Downloads up to ten photos per offer in parallel. Once `signal` aborts,
  // the remaining offers keep their photo URLs without cached copies.
  async cacheOffers(offers, { signal } = {}) {
    for (const offer of offers) {
      if (signal?.aborted) {
        continue;
      }
      if (offer.provenance?.transport === 'mtproto') {
        continue;
      }
      const downloads = await Promise.allSettled(
        (offer.photos || [])
          .slice(0, 10)
          .map((url) => this.cachePhoto(url, { signal }))
      );
      offer.cachedPhotos = downloads
        .filter(({ status }) => status === 'fulfilled')
        .map(({ value }) => value);
    }
    await this.enforceBudget(offers);
    return offers;
  }

  async enforceBudget(offers = []) {
    const allFiles = await filesBelow(this.directory);
    const mediaFiles = allFiles
      .filter((file) => file.path.startsWith(this.mediaDirectory))
      .sort((left, right) => left.modifiedAt - right.modifiedAt);
    let usage = allFiles.reduce((total, file) => total + file.size, 0);
    const removed = new Set();
    for (const file of mediaFiles) {
      if (usage <= this.maxBytes) {
        break;
      }
      await unlink(file.path).catch(unlessGone);
      usage -= file.size;
      removed.add(file.path);
    }

    for (const offer of offers) {
      offer.cachedPhotos = (offer.cachedPhotos || []).filter(
        (photo) => !removed.has(photo.path)
      );
    }
    return { removed: [...removed], usage };
  }
}
