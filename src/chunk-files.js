import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_SCHEMA_VERSION } from './data-schema.js';
import { durableWrite } from './link-cli-mirror.js';

const SCHEMA_FILE = '.state-schema.json';

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function readOrEmpty(path) {
  return readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  });
}

// An indexed collection needs readers that understand its index, so the
// data directory marker is raised before the first index is written.
export async function markIndexedSchema(directory) {
  const path = join(directory, SCHEMA_FILE);
  const existing = await readOrEmpty(path);
  if (existing) {
    const version = JSON.parse(existing).schemaVersion;
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('Data schema marker has an invalid version.');
    }
    if (version >= DATA_SCHEMA_VERSION) {
      return;
    }
  }
  await durableWrite(
    path,
    `${JSON.stringify({ schemaVersion: DATA_SCHEMA_VERSION })}\n`
  );
}

// Returns undefined for an unreadable index, whose chunks are left alone.
export function committedChunks(notation, field) {
  if (!notation) {
    return new Set();
  }
  try {
    return new Set(JSON.parse(notation)[field].map(({ sha256 }) => sha256));
  } catch {
    return undefined;
  }
}

export async function removeChunks(names, chunksPath, removeChunk = rm) {
  for (const name of names) {
    try {
      await removeChunk(join(chunksPath, name), {
        force: true,
        recursive: true,
      });
    } catch {
      // Cleanup is best effort; the next save prunes unindexed chunks again.
      return;
    }
  }
}

export async function pruneChunks(chunksPath, keep, removeChunk = rm) {
  let names;
  try {
    names = await readdir(chunksPath);
  } catch {
    return;
  }
  await removeChunks(
    names.filter((name) => !keep.has(name)),
    chunksPath,
    removeChunk
  );
}
