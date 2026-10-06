import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { Parser, formatLinks } from 'links-notation';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function syncDirectory(
  path,
  { openDirectory = open, platform = process.platform } = {}
) {
  const directory = await openDirectory(path, 'r');
  try {
    await directory.sync();
  } catch (error) {
    if (platform !== 'win32' || error?.code !== 'EPERM') {
      throw error;
    }
  } finally {
    await directory.close();
  }
}

async function linkOrCopy(source, target, linkFile) {
  try {
    await linkFile(source, target);
  } catch {
    // Hard links are unavailable across devices and on some file systems.
    await copyFile(source, target);
  }
}

const pendingWrites = new Map();

// Unique staging names prevent collisions, but concurrent replacement renames
// still contend for the destination on Windows. Keep each file's write/fsync/
// rename/directory-fsync transaction ordered; other files remain independent.
export async function durableWrite(path, contents) {
  const absolute = resolve(path);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const write = () => writeDurableFile(absolute, contents);
  const previous = pendingWrites.get(key) || Promise.resolve();
  const operation = previous.then(write, write);
  pendingWrites.set(key, operation);
  return await operation.finally(() => {
    if (pendingWrites.get(key) === operation) {
      pendingWrites.delete(key);
    }
  });
}

async function writeDurableFile(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  // Writers of one file in one process get distinct temporary names, so one
  // never removes the file another is about to rename.
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
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

export function runClink(
  command,
  arguments_,
  {
    heartbeatMs = 15_000,
    killGraceMs = 5_000,
    onProgress,
    timeoutMs = 10 * 60_000,
  } = {}
) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, arguments_, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderrBytes = 0;
    let timedOut = false;
    let spawnError;
    const report = (status) => {
      try {
        onProgress?.({
          elapsedMs: Date.now() - startedAt,
          phase: 'binary-projection',
          status,
          stderrBytes,
        });
      } catch {
        // Diagnostics must not change the storage transaction outcome.
      }
    };
    const heartbeat = globalThis.setInterval(
      () => report('running'),
      heartbeatMs
    );
    let killTimer;
    const deadline = setTimeout(() => {
      timedOut = true;
      report('timed-out');
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (code) => {
      globalThis.clearInterval(heartbeat);
      clearTimeout(deadline);
      clearTimeout(killTimer);
      report(timedOut ? 'timed-out' : 'finished');
      if (spawnError) {
        reject(spawnError);
      } else if (timedOut) {
        const error = new Error(
          `clink storage-timeout after ${Date.now() - startedAt} ms`
        );
        error.code = 'storage-timeout';
        reject(error);
      } else if (code === 0) {
        resolve();
      } else {
        const error = new Error(`clink exited with ${code}`);
        error.code = 'storage-process-failed';
        reject(error);
      }
    });
  });
}

function linkKey(link) {
  return JSON.stringify([link.id, link.values.map(({ id }) => id)]);
}

// links-notation rejects input longer than 10 MiB by default, a guard for
// untrusted text. Canonical snapshots are this application's own durable
// files and a real Telegram source already produced about 16 MiB (#43), so
// they are parsed with an explicit, larger bound instead.
export const MAX_NOTATION_LENGTH = 256 * 1024 * 1024;

let notationLength = MAX_NOTATION_LENGTH;

// The active parse bound. Storage sizes its single files and chunks from it,
// so tests can exercise collections larger than the bound without writing
// hundreds of mebibytes.
export function notationLimit() {
  return notationLength;
}

// Sets the parse bound and returns the one it replaced.
export function setNotationLimit(length = MAX_NOTATION_LENGTH) {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new TypeError('The notation limit must be a positive integer.');
  }
  const replaced = notationLength;
  notationLength = length;
  return replaced;
}

export function parseNotation(notation) {
  return new Parser({ maxInputSize: notationLength }).parse(notation);
}

// Compares a clink export with the canonical text it imported. The result
// holds only counts, so it is safe to log and to retain in failure.json.
export function compareExport(imported, exported) {
  const importedLinks = parseNotation(imported);
  const exportedLinks = parseNotation(exported);
  const expected = new Set(importedLinks.map(linkKey));
  const actual = new Set(exportedLinks.map(linkKey));
  const referenced = new Set(
    importedLinks.flatMap((link) => link.values.map(({ id }) => id))
  );
  const missing = importedLinks.filter((link) => !actual.has(linkKey(link)));
  const unexpected = exportedLinks.filter(
    (link) =>
      !expected.has(linkKey(link)) &&
      !(
        referenced.has(link.id) &&
        link.values.length === 2 &&
        link.values.every(({ id }) => id === link.id)
      )
  );
  const unexpectedIds = new Set(unexpected.map((link) => link.id));
  return {
    canonicalLinks: importedLinks.length,
    exportedLinks: exportedLinks.length,
    missingLinks: missing.length,
    // A missing link whose id reappears with other values is a name clink
    // rewrote on import (#55); a dropped link leaves no such id.
    rewrittenLinks: missing.filter((link) => unexpectedIds.has(link.id)).length,
    unexpectedLinks: unexpected.length,
    unreferencedUnexpectedLinks: unexpected.filter(
      (link) => !referenced.has(link.id)
    ).length,
  };
}

export function verifyExport(imported, exported) {
  const diagnostics = compareExport(imported, exported);
  if (diagnostics.missingLinks || diagnostics.unexpectedLinks) {
    const error = new Error(
      `clink export verification failed (${diagnostics.missingLinks} links missing, ${diagnostics.unexpectedLinks} unexpected links)`
    );
    error.code = 'storage-verification-failed';
    error.diagnostics = diagnostics;
    throw error;
  }
  return diagnostics;
}

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// clink 0.2.x imports in time quadratic in the database size (each update
// scans the whole store for uniqueness and usages), so one large import can
// take hours. Content-defined chunking over whole top-level links keeps each
// independently verified database small, and a local edit changes only the
// shard containing it, so unchanged shards are reused by digest. Boundaries
// depend on link ids only, never on offsets, so insertions do not shift them.
export function splitNotation(
  notation,
  { averageLinks = 64, maxLinks = 128, minLinks = 32 } = {}
) {
  const links = notation.trim() ? parseNotation(notation) : [];
  if (links.length <= maxLinks) {
    return [notation];
  }
  const groups = [[]];
  for (const link of links) {
    const current = groups.at(-1);
    if (
      current.length >= maxLinks ||
      (current.length >= minLinks &&
        fnv1a(link.id) % (averageLinks - minLinks) === 0)
    ) {
      groups.push([link]);
    } else {
      current.push(link);
    }
  }
  const shards = groups.map((group) => formatLinks(group));
  // Canonical LiNo stays authoritative: shard only when the shards are an
  // exact textual partition of it, otherwise project it as one database.
  return shards.join('\n') === notation ? shards : [notation];
}

class SnapshotCorruptionError extends Error {}

// Every file a projection is trusted by. `data.names.links` is written by
// clink's named-types decorator and is absent only for unnamed stores.
const REQUIRED_FILES = ['data.links', 'verified.lino'];
const PROJECTION_FILES = [...REQUIRED_FILES, 'data.names.links'];

async function fileDigests(directory) {
  const digests = {};
  for (const name of PROJECTION_FILES) {
    try {
      digests[name] = await sha256File(join(directory, name));
    } catch (error) {
      if (error.code !== 'ENOENT' || REQUIRED_FILES.includes(name)) {
        throw error;
      }
    }
  }
  return digests;
}

async function readManifest(directory, kind, digest) {
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8')
  );
  if (
    manifest.kind !== kind ||
    manifest.sha256 !== digest ||
    manifest.version !== 3
  ) {
    throw new SnapshotCorruptionError('Invalid clink manifest.');
  }
  return manifest;
}

// The export is compared link-by-link with its canonical shard once, before
// the manifest is written. Reuse then requires every trusted file to be
// byte-identical to that verified state, which avoids re-parsing unchanged
// shards on every save without accepting any unverified byte.
async function verifyDatabase(directory, kind, digest) {
  const manifest = await readManifest(directory, kind, digest);
  const expected = Object.entries(manifest.files || {});
  if (
    !REQUIRED_FILES.every((name) => manifest.files?.[name]) ||
    expected.some(([name]) => !PROJECTION_FILES.includes(name))
  ) {
    throw new SnapshotCorruptionError('Invalid clink manifest.');
  }
  for (const [name, fileSha256] of expected) {
    if ((await sha256File(join(directory, name))) !== fileSha256) {
      throw new SnapshotCorruptionError(
        'The clink projection does not match its manifest.'
      );
    }
  }
}

async function verifyCandidate(candidate, shardRoot, kind, shards, digest) {
  const manifest = await readManifest(candidate, kind, digest);
  if (!manifest.shards) {
    if (shards.length !== 1) {
      throw new SnapshotCorruptionError('The clink shard layout changed.');
    }
    await verifyDatabase(candidate, kind, digest);
    return manifest;
  }
  const digests = shards.map((shard) => sha256(shard));
  if (
    shards.length === 1 ||
    JSON.stringify(manifest.shards) !== JSON.stringify(digests)
  ) {
    throw new SnapshotCorruptionError('The clink shard layout changed.');
  }
  for (const shardDigest of digests) {
    await verifyDatabase(join(shardRoot, shardDigest), kind, shardDigest);
  }
  return manifest;
}

function recoverableSnapshotError(error) {
  return (
    error.code === 'ENOENT' ||
    error instanceof SyntaxError ||
    error instanceof SnapshotCorruptionError ||
    error.message?.startsWith('clink export verification failed')
  );
}

// Failed candidates are retained for diagnosis, but only the newest few, so
// repeated failures cannot grow the private state directory without bound.
export const RETAINED_FAILURES = 3;

async function prune(root, keep, { prefix = '' } = {}) {
  const failures = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) {
      continue;
    }
    const failedAt = entry.name.match(/\.failed-(\d+)$/u);
    if (failedAt) {
      failures.push({ failedAt: Number(failedAt[1]), path });
    } else if (!keep.has(path)) {
      await rm(path, { force: true, recursive: true });
    }
  }
  failures.sort((left, right) => right.failedAt - left.failedAt);
  for (const { path } of failures.slice(RETAINED_FAILURES)) {
    await rm(path, { force: true, recursive: true });
  }
}

async function pruneCandidates(root, kind, current, manifest) {
  await prune(root, new Set([current]), { prefix: `${kind}-` });
  const shardRoot = join(root, `${kind}.shards`);
  if (manifest?.shards) {
    await prune(
      shardRoot,
      new Set(manifest.shards.map((digest) => join(shardRoot, digest)))
    );
  } else {
    await rm(shardRoot, { force: true, recursive: true });
  }
}

// Runs callbacks with bounded parallelism. After the first failure no new
// item starts, and the in-flight ones settle before the failure is rethrown,
// so no clink process outlives the transaction that started it.
async function mapConcurrent(items, concurrency, callback) {
  let next = 0;
  let failure;
  const worker = async () => {
    while (!failure && next < items.length) {
      const index = next;
      next += 1;
      try {
        await callback(items[index], index);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  if (failure) {
    throw failure.error;
  }
}

export class LinkCliMirror {
  constructor({
    averageShardLinks,
    command = 'clink',
    concurrency = Math.max(1, Math.min(4, availableParallelism())),
    heartbeatMs,
    linkFile = link,
    maxShardLinks,
    minShardLinks,
    onProgress,
    run = runClink,
    statCandidate = stat,
    timeoutMs,
  } = {}) {
    this.command = command;
    this.concurrency = concurrency;
    this.onProgress = onProgress;
    this.run = run;
    this.linkFile = linkFile;
    this.statCandidate = statCandidate;
    this.runOptions = { heartbeatMs, onProgress, timeoutMs };
    this.heartbeatMs = heartbeatMs ?? 15_000;
    this.shardOptions = {
      averageLinks: averageShardLinks,
      maxLinks: maxShardLinks,
      minLinks: minShardLinks,
    };
  }

  async preflight() {
    await this.run(this.command, ['--help'], this.runOptions);
  }

  #report(event) {
    try {
      this.onProgress?.({ phase: 'binary-projection', ...event });
    } catch {
      // Diagnostics must not change the storage transaction outcome.
    }
  }

  #split(notation) {
    return splitNotation(notation, this.shardOptions);
  }

  async ensure({ directory, kind, notation }) {
    const root = join(directory, '.binary');
    const pointerPath = join(root, `${kind}.current.json`);
    try {
      const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
      const digest = sha256(notation);
      const expectedDirectory = join(root, `${kind}-${digest}`);
      if (
        pointer.sha256 === digest &&
        pointer.directory === expectedDirectory
      ) {
        try {
          const manifest = await verifyCandidate(
            expectedDirectory,
            join(root, `${kind}.shards`),
            kind,
            this.#split(notation),
            digest
          );
          await pruneCandidates(root, kind, expectedDirectory, manifest);
          return pointer;
        } catch (error) {
          if (!recoverableSnapshotError(error)) {
            throw error;
          }
        }
      }
    } catch (error) {
      if (!recoverableSnapshotError(error)) {
        throw error;
      }
    }
    const staged = await this.stage({ directory, kind, notation });
    await staged.activate();
    return { sha256: staged.sha256 };
  }

  async #retire(directory) {
    try {
      await this.statCandidate(directory);
      await rename(directory, `${directory}.failed-${Date.now()}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async #build(directory, manifestFields, write) {
    await this.#retire(directory);
    await mkdir(directory, { recursive: true });
    try {
      await write();
      await durableWrite(
        join(directory, 'manifest.json'),
        `${JSON.stringify({ ...manifestFields, version: 3 })}\n`
      );
    } catch (error) {
      await durableWrite(
        join(directory, 'failure.json'),
        `${JSON.stringify({ code: error.code || 'storage-error', ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}), failedAt: new Date().toISOString() })}\n`
      ).catch(() => {});
      throw error;
    }
  }

  async #buildDatabase(directory, kind, notation, digest, runOptions) {
    const importPath = join(directory, 'canonical.lino');
    const exportPath = join(directory, 'verified.lino');
    const manifest = { kind, sha256: digest };
    await this.#build(directory, manifest, async () => {
      await durableWrite(importPath, notation);
      await this.run(
        this.command,
        [
          '--db',
          join(directory, 'data.links'),
          '--auto-create-missing-references',
          '--import',
          importPath,
          '--export',
          exportPath,
        ],
        runOptions
      );
      verifyExport(notation, await readFile(exportPath, 'utf8'));
      manifest.files = await fileDigests(directory);
    });
  }

  // Adopts a verified database with the same digest from another shard root,
  // so content that lands in a new collection chunk is not imported again.
  // Projection files are never modified in place, so hard links are safe;
  // the adopted copy is verified against its manifest before use.
  async #adopt(directory, kind, digest, roots) {
    for (const root of roots) {
      const source = join(root, digest);
      const staging = `${directory}.adopt-${process.pid}-${randomUUID()}`;
      try {
        await verifyDatabase(source, kind, digest);
        const { files } = await readManifest(source, kind, digest);
        await this.#retire(directory);
        await mkdir(staging, { recursive: true });
        for (const name of ['manifest.json', ...Object.keys(files)]) {
          await linkOrCopy(
            join(source, name),
            join(staging, name),
            this.linkFile
          );
        }
        await rename(staging, directory);
        await verifyDatabase(directory, kind, digest);
        return true;
      } catch {
        // Adoption only saves an import; any failure falls back to one.
        await rm(staging, { force: true, recursive: true });
      }
    }
    return false;
  }

  async #buildShards(candidate, shardRoot, kind, shards, digest, reuse) {
    const startedAt = Date.now();
    const digests = shards.map((shard) => sha256(shard));
    let completed = 0;
    let reused = 0;
    let reportedAt = startedAt;
    // Per-process heartbeats and timeouts stay on; per-shard completion is
    // aggregated below so progress remains bounded and free of content.
    const runOptions = {
      ...this.runOptions,
      onProgress: (event) => {
        if (event.status !== 'finished') {
          this.#report(event);
        }
      },
    };
    await this.#build(
      candidate,
      { kind, sha256: digest, shards: digests },
      async () => {
        await mapConcurrent(shards, this.concurrency, async (shard, index) => {
          const directory = join(shardRoot, digests[index]);
          try {
            await verifyDatabase(directory, kind, digests[index]);
            reused += 1;
          } catch (error) {
            if (!recoverableSnapshotError(error)) {
              throw error;
            }
            if (await this.#adopt(directory, kind, digests[index], reuse)) {
              reused += 1;
            } else {
              await this.#buildDatabase(
                directory,
                kind,
                shard,
                digests[index],
                runOptions
              );
            }
          }
          completed += 1;
          if (
            completed === shards.length ||
            Date.now() - reportedAt >= this.heartbeatMs
          ) {
            reportedAt = Date.now();
            this.#report({
              completed,
              elapsedMs: reportedAt - startedAt,
              reused,
              status: 'shards',
              total: shards.length,
            });
          }
        });
      }
    );
  }

  // `reuse` lists other shard roots whose verified databases may be adopted.
  async stage({ directory, kind, notation, reuse = [] }) {
    const digest = sha256(notation);
    const root = join(directory, '.binary');
    const candidate = join(root, `${kind}-${digest}`);
    const shardRoot = join(root, `${kind}.shards`);
    const shards = this.#split(notation);
    const activate = async () => {
      await durableWrite(
        join(root, `${kind}.current.json`),
        `${JSON.stringify({ directory: candidate, sha256: digest, version: 1 })}\n`
      );
      await pruneCandidates(
        root,
        kind,
        candidate,
        shards.length > 1
          ? { shards: shards.map((shard) => sha256(shard)) }
          : undefined
      );
    };
    try {
      const pointer = JSON.parse(
        await readFile(join(root, `${kind}.current.json`), 'utf8')
      );
      if (pointer.sha256 === digest && pointer.directory === candidate) {
        await verifyCandidate(candidate, shardRoot, kind, shards, digest);
        return { activate: async () => {}, sha256: digest };
      }
    } catch (error) {
      if (!recoverableSnapshotError(error)) {
        throw error;
      }
    }
    try {
      await verifyCandidate(candidate, shardRoot, kind, shards, digest);
      return { activate, sha256: digest };
    } catch (error) {
      if (!recoverableSnapshotError(error)) {
        throw error;
      }
    }
    if (shards.length === 1) {
      await this.#buildDatabase(
        candidate,
        kind,
        notation,
        digest,
        this.runOptions
      );
    } else {
      await this.#buildShards(
        candidate,
        shardRoot,
        kind,
        shards,
        digest,
        reuse
      );
    }
    return { activate, sha256: digest };
  }
}
