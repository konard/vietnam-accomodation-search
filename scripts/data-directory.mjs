import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  statfs,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve, sep } from 'node:path';

import { syncDirectory } from '../src/link-cli-mirror.js';

export const DATA_SCHEMA_VERSION = 1;
const SCHEMA_FILE = '.state-schema.json';
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
      throw new Error(`Data schema marker is unreadable: ${error.message}`);
    }
    await writeDurable(
      path,
      `${JSON.stringify({ schemaVersion: DATA_SCHEMA_VERSION })}\n`
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

/** Validate and prepare the one host root that owns all durable state. */
export async function validateDataDirectory(
  value,
  {
    cwd = process.cwd(),
    homeDirectory = homedir(),
    minimumFreeBytes = 16 * 1024 ** 2,
  } = {}
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('A non-empty data directory is required.');
  }
  const directory = resolve(cwd, value.trim());
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
  await mkdir(directory, { mode: 0o700, recursive: true });
  const details = await lstat(directory);
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
