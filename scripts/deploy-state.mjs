import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import { syncDirectory } from '../src/link-cli-mirror.js';
import { DATA_SCHEMA_VERSION, SCHEMA_FILE } from './data-directory.mjs';

// The binary projection is rebuilt from its hash-matched canonical text and
// media is an evictable cache, so neither is part of a state snapshot.
const EXCLUDED_ROOTS = new Set(['.binary', 'media']);
const TRANSIENT =
  /^(?:\.write\.lock|\.write-probe-|\.preflight-|\.container-write-probe)/u;
const SNAPSHOT_MANIFEST = 'snapshot.json';
const RETAINED_SNAPSHOTS = 2;
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/u;

function excluded(relative) {
  const segments = relative.split(sep);
  return (
    EXCLUDED_ROOTS.has(segments[0]) ||
    segments.includes('.binary') ||
    TRANSIENT.test(segments.at(-1))
  );
}

async function listFiles(directory, prefix = '') {
  const files = [];
  const entries = await readdir(join(directory, prefix), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? join(prefix, entry.name) : entry.name;
    if (excluded(relative)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(
        `Data directory entry ${relative} is not a regular file or directory.`
      );
    }
  }
  return files;
}

async function copyDurable(source, destination, mode) {
  const contents = await readFile(source);
  await mkdir(dirname(destination), { mode: 0o700, recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    const file = await open(temporary, 'wx', mode);
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    await chmod(temporary, mode);
    await rename(temporary, destination);
    await syncDirectory(dirname(destination));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return createHash('sha256').update(contents).digest('hex');
}

/** The data schema recorded by the marker, or 0 before the first deploy. */
export async function readDataSchemaVersion(dataDirectory) {
  try {
    const marker = JSON.parse(
      await readFile(join(dataDirectory, SCHEMA_FILE), 'utf8')
    );
    return marker.schemaVersion;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

/** Record that the data directory now holds this release's schema. */
export async function writeDataSchemaMarker(
  dataDirectory,
  schemaVersion = DATA_SCHEMA_VERSION
) {
  const path = join(dataDirectory, SCHEMA_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify({ schemaVersion })}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  await syncDirectory(dataDirectory);
}

/**
 * Copy the durable state of a stopped service into a new private snapshot.
 * Only relative paths, digests, and modes are recorded in the manifest.
 */
export async function snapshotState(dataDirectory, snapshotDirectory) {
  await mkdir(snapshotDirectory, { mode: 0o700, recursive: true });
  const files = [];
  for (const path of await listFiles(dataDirectory)) {
    const mode = (await lstat(join(dataDirectory, path))).mode & 0o777;
    const sha256 = await copyDurable(
      join(dataDirectory, path),
      join(snapshotDirectory, 'data', path),
      mode
    );
    files.push({ mode, path, sha256 });
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    dataSchema: await readDataSchemaVersion(dataDirectory),
    files,
  };
  await writeManifest(snapshotDirectory, manifest);
  return manifest;
}

async function writeManifest(snapshotDirectory, manifest) {
  const path = join(snapshotDirectory, SNAPSHOT_MANIFEST);
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(snapshotDirectory);
}

/**
 * Make the durable state of a stopped service exactly match a snapshot:
 * files the candidate created are removed and every snapshot file is copied
 * back and checked against its recorded digest.
 */
export async function restoreState(dataDirectory, snapshotDirectory) {
  const manifest = JSON.parse(
    await readFile(join(snapshotDirectory, SNAPSHOT_MANIFEST), 'utf8')
  );
  const expected = new Set(manifest.files.map(({ path }) => path));
  for (const path of await listFiles(dataDirectory)) {
    if (!expected.has(path)) {
      await rm(join(dataDirectory, path), { force: true });
    }
  }
  for (const { mode, path, sha256 } of manifest.files) {
    const restored = await copyDurable(
      join(snapshotDirectory, 'data', path),
      join(dataDirectory, path),
      mode
    );
    if (restored !== sha256) {
      throw new Error(`Snapshot file ${path} does not match its digest.`);
    }
  }
  return manifest;
}

/** Remove all but the newest snapshots below a project's snapshot root. */
export async function pruneSnapshots(root, retain = RETAINED_SNAPSHOTS) {
  let names;
  try {
    names = (await readdir(root)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const removed = names.slice(0, Math.max(0, names.length - retain));
  for (const name of removed) {
    await rm(join(root, name), { force: true, recursive: true });
  }
  return removed;
}

/**
 * Deployment records are kept per Compose project, so an isolated drill
 * project never replaces the rollback record of the production project.
 */
export function projectStateDirectory(projectName, root = '.deploy') {
  if (!PROJECT_NAME.test(projectName)) {
    throw new Error(`Invalid Compose project name: ${projectName}`);
  }
  return join(root, projectName);
}

/**
 * Decide how to roll back. A previous image that only understands an older
 * data schema must not read data the current release has migrated, so the
 * pre-cutover snapshot has to be restored with it, which discards changes
 * written since that cutover.
 */
export function planRollback(state, { dataDirectory, dataSchema, restore }) {
  if (!state.previousImage) {
    throw new Error('No rollback image is recorded.');
  }
  if (state.dataDirectory && state.dataDirectory !== dataDirectory) {
    throw new Error(
      'The recorded deployment used a different data directory; roll back with the same --data-directory.'
    );
  }
  const previousSchema = state.previousDataSchema ?? 1;
  if (previousSchema >= dataSchema) {
    return { image: state.previousImage, snapshot: undefined };
  }
  if (!restore) {
    throw new Error(
      `${state.previousImage} supports data schema ${previousSchema}, but the data directory holds schema ${dataSchema}. Pass --restore-snapshot to restore the state captured before the last cutover; changes written since are discarded.`
    );
  }
  if (!state.snapshot) {
    throw new Error(
      'No pre-cutover snapshot is recorded; restore a compatible backup.'
    );
  }
  return { image: state.previousImage, snapshot: state.snapshot };
}
