import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Parser } from 'links-notation';

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

export async function durableWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
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

function verifyExport(imported, exported) {
  const importedLinks = new Parser().parse(imported);
  const exportedLinks = new Parser().parse(exported);
  const expected = new Set(importedLinks.map(linkKey));
  const actual = new Set(exportedLinks.map(linkKey));
  const referenced = new Set(
    importedLinks.flatMap((link) => link.values.map(({ id }) => id))
  );
  const missing = [...expected].filter((key) => !actual.has(key));
  const unexpected = exportedLinks.filter(
    (link) =>
      !expected.has(linkKey(link)) &&
      !(
        referenced.has(link.id) &&
        link.values.length === 2 &&
        link.values.every(({ id }) => id === link.id)
      )
  );
  if (missing.length || unexpected.length) {
    throw new Error(
      `clink export verification failed (${missing.length} links missing, ${unexpected.length} unexpected links)`
    );
  }
}

class SnapshotCorruptionError extends Error {}

async function verifyCandidate(candidate, kind, notation, digest) {
  const manifest = JSON.parse(
    await readFile(join(candidate, 'manifest.json'), 'utf8')
  );
  if (
    manifest.kind !== kind ||
    manifest.sha256 !== digest ||
    manifest.version !== 2
  ) {
    throw new SnapshotCorruptionError('Invalid clink manifest.');
  }
  const databasePath = join(candidate, 'data.links');
  await stat(databasePath);
  if ((await sha256File(databasePath)) !== manifest.databaseSha256) {
    throw new SnapshotCorruptionError(
      'The clink database does not match its manifest.'
    );
  }
  verifyExport(
    notation,
    await readFile(join(candidate, 'verified.lino'), 'utf8')
  );
}

function recoverableSnapshotError(error) {
  return (
    error.code === 'ENOENT' ||
    error instanceof SyntaxError ||
    error instanceof SnapshotCorruptionError ||
    error.message?.startsWith('clink export verification failed')
  );
}

async function pruneCandidates(root, kind, current) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (
      entry.isDirectory() &&
      entry.name.startsWith(`${kind}-`) &&
      !entry.name.includes('.failed-') &&
      path !== current
    ) {
      await rm(path, { force: true, recursive: true });
    }
  }
}

export class LinkCliMirror {
  constructor({
    command = 'clink',
    heartbeatMs,
    onProgress,
    run = runClink,
    statCandidate = stat,
    timeoutMs,
  } = {}) {
    this.command = command;
    this.run = run;
    this.statCandidate = statCandidate;
    this.runOptions = { heartbeatMs, onProgress, timeoutMs };
  }

  async preflight() {
    await this.run(this.command, ['--help'], this.runOptions);
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
          await verifyCandidate(expectedDirectory, kind, notation, digest);
          await pruneCandidates(root, kind, expectedDirectory);
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

  async stage({ directory, kind, notation }) {
    const digest = sha256(notation);
    const root = join(directory, '.binary');
    const candidate = join(root, `${kind}-${digest}`);
    const importPath = join(candidate, 'canonical.lino');
    const exportPath = join(candidate, 'verified.lino');
    const databasePath = join(candidate, 'data.links');
    const activate = async () => {
      await durableWrite(
        join(root, `${kind}.current.json`),
        `${JSON.stringify({ directory: candidate, sha256: digest, version: 1 })}\n`
      );
      await pruneCandidates(root, kind, candidate);
    };
    try {
      const pointer = JSON.parse(
        await readFile(join(root, `${kind}.current.json`), 'utf8')
      );
      if (pointer.sha256 === digest && pointer.directory === candidate) {
        await verifyCandidate(candidate, kind, notation, digest);
        return { activate: async () => {}, sha256: digest };
      }
    } catch (error) {
      if (!recoverableSnapshotError(error)) {
        throw error;
      }
    }
    try {
      await verifyCandidate(candidate, kind, notation, digest);
      return { activate, sha256: digest };
    } catch (error) {
      if (!recoverableSnapshotError(error)) {
        throw error;
      }
    }
    try {
      await this.statCandidate(candidate);
      await rename(candidate, `${candidate}.failed-${Date.now()}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    await mkdir(candidate, { recursive: true });
    try {
      await durableWrite(importPath, notation);
      await this.run(
        this.command,
        [
          '--db',
          databasePath,
          '--auto-create-missing-references',
          '--import',
          importPath,
          '--export',
          exportPath,
        ],
        this.runOptions
      );
      await stat(databasePath);
      verifyExport(notation, await readFile(exportPath, 'utf8'));
      await durableWrite(
        join(candidate, 'manifest.json'),
        `${JSON.stringify({ databaseSha256: await sha256File(databasePath), kind, sha256: digest, version: 2 })}\n`
      );
    } catch (error) {
      await durableWrite(
        join(candidate, 'failure.json'),
        `${JSON.stringify({ code: error.code || 'storage-error', failedAt: new Date().toISOString() })}\n`
      ).catch(() => {});
      throw error;
    }
    return { activate, sha256: digest };
  }
}
