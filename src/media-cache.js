import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { stableHash } from './utils.js';

async function filesBelow(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return files;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path)));
    } else {
      const details = await stat(path);
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

  // Downloads up to ten photos per offer in parallel. Once `signal` aborts,
  // the remaining offers keep their photo URLs without cached copies.
  async cacheOffers(offers, { signal } = {}) {
    for (const offer of offers) {
      if (signal?.aborted) {
        offer.cachedPhotos = [];
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
      await unlink(file.path);
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
