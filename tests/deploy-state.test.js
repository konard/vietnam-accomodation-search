import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  DATA_SCHEMA_VERSION,
  validateDataDirectory,
} from '../scripts/data-directory.mjs';
import {
  planRollback,
  projectStateDirectory,
  pruneSnapshots,
  readDataSchemaVersion,
  restoreState,
  snapshotState,
  writeDataSchemaMarker,
} from '../scripts/deploy-state.mjs';
import { deploymentStateMachine } from '../scripts/deploy.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';

async function failure(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function temporaryRoot() {
  // macOS exposes /var as a system symlink; resolve it once.
  return realpath(await mkdtemp(join(tmpdir(), 'deploy-state-')));
}

describe('deployment state snapshots (#57)', () => {
  it('restores the exact pre-cutover state after a candidate migrates it', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const root = await temporaryRoot();
    try {
      const data = join(root, 'data');
      await validateDataDirectory(data);
      await writeFile(join(data, 'offers.lino'), 'v2 offers\n', {
        mode: 0o600,
      });
      await mkdir(join(data, 'nested'));
      await writeFile(join(data, 'nested', 'cursor.lino'), 'cursor 1\n');
      await mkdir(join(data, '.binary'));
      await writeFile(join(data, '.binary', 'offers.current.json'), '{}');
      await mkdir(join(data, 'media'));
      await writeFile(join(data, 'media', 'photo'), 'cache');
      await writeFile(join(data, '.write.lock'), 'transient');

      const snapshot = join(root, 'snapshots', 'first');
      const manifest = await snapshotState(data, snapshot);
      expect(manifest.dataSchema).toBe(DATA_SCHEMA_VERSION);
      expect(manifest.files.map(({ path }) => path)).toEqual([
        '.state-schema.json',
        join('nested', 'cursor.lino'),
        'offers.lino',
      ]);
      expect(JSON.stringify(manifest)).not.toContain('v2 offers');
      expect((await lstat(snapshot)).mode & 0o777).toBe(0o700);

      // The candidate migrates, adds a collection, and bumps the marker.
      await writeFile(join(data, 'offers.lino'), 'v3 offers\n');
      await writeFile(join(data, 'nested', 'cursor.lino'), 'cursor 2\n');
      await writeFile(join(data, 'presets.lino'), 'new\n');
      await writeDataSchemaMarker(data, 9);
      expect(await readDataSchemaVersion(data)).toBe(9);

      await restoreState(data, snapshot);
      expect(await readFile(join(data, 'offers.lino'), 'utf8')).toBe(
        'v2 offers\n'
      );
      expect(await readFile(join(data, 'nested', 'cursor.lino'), 'utf8')).toBe(
        'cursor 1\n'
      );
      expect((await lstat(join(data, 'offers.lino'))).mode & 0o777).toBe(0o600);
      expect((await readdir(data)).includes('presets.lino')).toBe(false);
      expect(await readDataSchemaVersion(data)).toBe(DATA_SCHEMA_VERSION);
      // The projection and cache are left for the rebuild and eviction.
      expect(
        await readFile(join(data, '.binary', 'offers.current.json'), 'utf8')
      ).toBe('{}');
      expect(await readFile(join(data, 'media', 'photo'), 'utf8')).toBe(
        'cache'
      );

      await writeFile(join(snapshot, 'data', 'offers.lino'), 'tampered\n');
      expect((await failure(() => restoreState(data, snapshot))).message).toBe(
        'Snapshot file offers.lino does not match its digest.'
      );

      await symlink(join(data, 'offers.lino'), join(data, 'link.lino'));
      expect(
        (await failure(() => snapshotState(data, join(root, 'other')))).message
      ).toBe(
        'Data directory entry link.lino is not a regular file or directory.'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('marks unmarked existing data as the previous schema', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const root = await temporaryRoot();
    try {
      const empty = join(root, 'empty');
      expect(await readDataSchemaVersion(root)).toBe(0);
      await validateDataDirectory(empty);
      expect(await readDataSchemaVersion(empty)).toBe(2);
      const legacy = join(root, 'legacy');
      await mkdir(legacy, { mode: 0o700 });
      await writeFile(join(legacy, 'offers.lino'), 'v2\n');
      await validateDataDirectory(legacy);
      expect(await readDataSchemaVersion(legacy)).toBe(1);
      await writeFile(join(legacy, '.state-schema.json'), '{');
      expect((await failure(() => readDataSchemaVersion(legacy))).name).toBe(
        'SyntaxError'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps only the newest snapshots', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const root = await temporaryRoot();
    try {
      expect(await pruneSnapshots(join(root, 'missing'))).toEqual([]);
      for (const name of ['2026-01', '2026-02', '2026-03']) {
        await mkdir(join(root, name));
      }
      expect(await pruneSnapshots(root)).toEqual(['2026-01']);
      expect((await readdir(root)).sort()).toEqual(['2026-02', '2026-03']);
      await writeFile(join(root, 'file'), '');
      expect(
        (await failure(() => pruneSnapshots(join(root, 'file')))).code
      ).toBe('ENOTDIR');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps deployment records per Compose project', () => {
    expect(projectStateDirectory('drill-57')).toBe(join('.deploy', 'drill-57'));
    for (const name of ['', '../escape', 'Upper', '-leading']) {
      let error;
      try {
        projectStateDirectory(name);
      } catch (caught) {
        error = caught;
      }
      expect(error.message).toContain('Invalid Compose project name');
    }
  });

  it('refuses a rollback that would give an older image newer-schema data', () => {
    const state = {
      currentDataSchema: 2,
      currentImage: 'app:new',
      dataDirectory: '/srv/data',
      previousDataSchema: 1,
      previousImage: 'app:rollback-1',
      snapshot: '.deploy/app/snapshots/1',
    };
    const plan = (overrides, options = {}) =>
      planRollback(
        { ...state, ...overrides },
        { dataDirectory: '/srv/data', dataSchema: 2, ...options }
      );
    const message = (action) => {
      try {
        action();
      } catch (error) {
        return error.message;
      }
      return undefined;
    };
    expect(message(() => plan({}))).toContain('Pass --restore-snapshot');
    expect(plan({}, { restore: true })).toEqual({
      image: 'app:rollback-1',
      snapshot: '.deploy/app/snapshots/1',
    });
    expect(
      message(() => plan({ snapshot: undefined }, { restore: true }))
    ).toBe('No pre-cutover snapshot is recorded; restore a compatible backup.');
    expect(plan({ previousDataSchema: 2 })).toEqual({
      image: 'app:rollback-1',
      snapshot: undefined,
    });
    // A record without data schemas describes a schema 1 image.
    expect(message(() => plan({ previousDataSchema: undefined }))).toContain(
      'supports data schema 1'
    );
    expect(
      plan({ previousDataSchema: undefined }, { dataSchema: 1 }).snapshot
    ).toBe(undefined);
    expect(message(() => plan({ previousImage: undefined }))).toBe(
      'No rollback image is recorded.'
    );
    expect(message(() => plan({ dataDirectory: '/srv/other' }))).toContain(
      'different data directory'
    );
  });

  it('snapshots after the old service stops and restores it with the candidate failure', async () => {
    const calls = [];
    const hooks = {
      capture: async () => {
        calls.push('capture');
        return { directory: 'snapshot-1' };
      },
      inspectPrevious: async () => 'app:rollback-1',
      prepare: async () => 'app:candidate',
      record: async (result) =>
        calls.push(`record:${result.snapshot.directory}`),
      restore: async (image, snapshot) =>
        calls.push(`restore:${image}:${snapshot?.directory}`),
      start: async (image) => calls.push(`start:${image}`),
      stop: async () => calls.push('stop'),
      wait: async () => {
        throw new Error('health failed');
      },
    };
    const error = await failure(() => deploymentStateMachine(hooks));
    expect(error.message).toContain('previous image and state restored');
    expect(calls).toEqual([
      'stop',
      'capture',
      'start:app:candidate',
      'restore:app:rollback-1:snapshot-1',
    ]);

    calls.length = 0;
    const snapshotError = await failure(() =>
      deploymentStateMachine({
        ...hooks,
        capture: async () => {
          throw new Error('disk full');
        },
      })
    );
    expect(snapshotError.message).toBe(
      'State snapshot failed; previous image restored: disk full'
    );
    expect(calls).toEqual(['stop', 'restore:app:rollback-1:undefined']);

    calls.length = 0;
    expect(
      await deploymentStateMachine({ ...hooks, wait: async () => {} })
    ).toBe('app:candidate');
    expect(calls).toEqual([
      'stop',
      'capture',
      'start:app:candidate',
      'record:snapshot-1',
    ]);
  });
});
