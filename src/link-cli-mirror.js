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

function defaultRun(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`clink exited with ${code}: ${stderr.trim()}`));
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
      path !== current
    ) {
      await rm(path, { force: true, recursive: true });
    }
  }
}

export class LinkCliMirror {
  constructor({ command = 'clink', run = defaultRun } = {}) {
    this.command = command;
    this.run = run;
  }

  async preflight() {
    await this.run(this.command, ['--help']);
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
          const manifest = JSON.parse(
            await readFile(join(expectedDirectory, 'manifest.json'), 'utf8')
          );
          if (
            manifest.kind !== kind ||
            manifest.sha256 !== digest ||
            manifest.version !== 2
          ) {
            throw new SnapshotCorruptionError('Invalid clink manifest.');
          }
          const databasePath = join(expectedDirectory, 'data.links');
          await stat(databasePath);
          if ((await sha256File(databasePath)) !== manifest.databaseSha256) {
            throw new SnapshotCorruptionError(
              'The clink database does not match its manifest.'
            );
          }
          verifyExport(
            notation,
            await readFile(join(expectedDirectory, 'verified.lino'), 'utf8')
          );
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
    await rm(candidate, { force: true, recursive: true });
    await mkdir(candidate, { recursive: true });
    try {
      await durableWrite(importPath, notation);
      await this.run(this.command, [
        '--db',
        databasePath,
        '--transactions',
        '--commit-mode',
        'sync',
        '--auto-create-missing-references',
        '--import',
        importPath,
        '--export',
        exportPath,
      ]);
      await stat(databasePath);
      verifyExport(notation, await readFile(exportPath, 'utf8'));
      await durableWrite(
        join(candidate, 'manifest.json'),
        `${JSON.stringify({ databaseSha256: await sha256File(databasePath), kind, sha256: digest, version: 2 })}\n`
      );
    } catch (error) {
      await rm(candidate, { force: true, recursive: true });
      throw error;
    }
    return {
      activate: async () => {
        await durableWrite(
          join(root, `${kind}.current.json`),
          `${JSON.stringify({ directory: candidate, sha256: digest, version: 1 })}\n`
        );
        await pruneCandidates(root, kind, candidate);
      },
      sha256: digest,
    };
  }
}
