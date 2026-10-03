import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  statfs,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve, sep } from 'node:path';

import { DATA_SCHEMA_VERSION } from '../src/data-schema.js';
import { syncDirectory } from '../src/link-cli-mirror.js';

export { DATA_SCHEMA_VERSION };
export const SCHEMA_FILE = '.state-schema.json';
const SENSITIVE_SEGMENTS = new Set([
  '.aws',
  '.gnupg',
  '.kube',
  '.ssh',
  'secrets',
]);

async function rejectSymbolicLinkComponents(path) {
  const { root } = parse(path);
  let current = root;
  for (const segment of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new Error(
          `Data directory cannot traverse symbolic link ${current}.`
        );
      }
      if (!details.isDirectory()) {
        throw new Error(
          current === path
            ? `${current} is not a directory.`
            : `Data directory parent ${current} is not a directory.`
        );
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

async function writeDurable(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(contents, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function validateSchema(directory) {
  const path = join(directory, SCHEMA_FILE);
  let marker;
  try {
    marker = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Data schema marker is unreadable: ${error.message}`, {
        cause: error,
      });
    }
    // Unmarked existing data predates the marker and uses schema version 1.
    const existing = (await readdir(directory)).some(
      (name) => !name.startsWith('.write-probe-')
    );
    await writeDurable(
      path,
      `${JSON.stringify({ schemaVersion: existing ? 1 : DATA_SCHEMA_VERSION })}\n`
    );
    return;
  }
  if (!Number.isInteger(marker.schemaVersion) || marker.schemaVersion < 1) {
    throw new Error('Data schema marker has an invalid version.');
  }
  if (marker.schemaVersion > DATA_SCHEMA_VERSION) {
    throw new Error(
      `Data directory uses newer schema ${marker.schemaVersion}; this release supports ${DATA_SCHEMA_VERSION}. Roll back with a compatible backup.`
    );
  }
}

async function probeDurability(directory) {
  const source = join(directory, `.write-probe-${process.pid}`);
  const destination = `${source}.renamed`;
  try {
    const probe = await open(source, 'wx', 0o600);
    try {
      await probe.writeFile('durable-storage-probe\n', 'utf8');
      await probe.sync();
    } finally {
      await probe.close();
    }
    await rename(source, destination);
    await syncDirectory(directory);
  } finally {
    await rm(source, { force: true }).catch(() => {});
    await rm(destination, { force: true }).catch(() => {});
  }
}

/** The absolute data directory a user-supplied path names. */
export function resolveDataDirectory(value, { cwd = process.cwd() } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('A non-empty data directory is required.');
  }
  return resolve(cwd, value.trim());
}

/**
 * Validate and prepare the one host root that owns all durable state. With
 * `create: false` a missing directory is an error, so a mistyped path of an
 * existing deployment never becomes a new empty directory.
 */
export async function validateDataDirectory(
  value,
  {
    create = true,
    cwd = process.cwd(),
    homeDirectory = homedir(),
    minimumFreeBytes = 16 * 1024 ** 2,
  } = {}
) {
  const directory = resolveDataDirectory(value, { cwd });
  const filesystemRoot = parse(directory).root;
  if (directory === filesystemRoot) {
    throw new Error('The filesystem root is too broad for application data.');
  }
  if (directory === resolve(homeDirectory)) {
    throw new Error('The home directory is too broad for application data.');
  }
  const segments = directory
    .slice(filesystemRoot.length)
    .split(sep)
    .map((segment) => segment.toLowerCase());
  const sensitive = segments.find((segment) => SENSITIVE_SEGMENTS.has(segment));
  if (sensitive) {
    throw new Error(
      `Data directory cannot be a credential or secret path (${sensitive}).`
    );
  }

  await rejectSymbolicLinkComponents(directory);
  if (create) {
    await mkdir(directory, { mode: 0o700, recursive: true });
  }
  const details = await lstat(directory).catch((error) => {
    if (error.code === 'ENOENT') {
      throw new Error(`Data directory ${directory} does not exist.`, {
        cause: error,
      });
    }
    throw error;
  });
  if (!details.isDirectory()) {
    throw new Error(`${directory} is not a directory.`);
  }
  await chmod(directory, 0o700);
  await validateSchema(directory);
  await probeDurability(directory);

  const filesystem = await statfs(directory);
  const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  if (!Number.isFinite(freeBytes) || freeBytes < minimumFreeBytes) {
    throw new Error(
      `Data directory has insufficient free space (${freeBytes} bytes available; ${minimumFreeBytes} required).`
    );
  }
  return directory;
}
