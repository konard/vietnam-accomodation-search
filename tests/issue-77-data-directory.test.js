import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  resolveDataDirectory,
  SCHEMA_FILE,
  validateDataDirectory,
} from '../scripts/data-directory.mjs';
import {
  inspectDataDirectory,
  planDataDirectory,
} from '../scripts/deploy-guards.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';

function failure(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function rejection(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

const missing = { exists: false, hasData: false, marked: false };
const empty = { exists: true, hasData: false, marked: false };
const live = { exists: true, hasData: true, marked: true };
const recorded = {
  currentImage: 'vac:1',
  dataDirectory: '/srv/vac/data',
};

describe('data directory of a recorded deployment', () => {
  it('refuses a mistyped path before anything is created', () => {
    const error = failure(() =>
      planDataDirectory({
        action: 'deploy',
        previous: live,
        requested: '/srv/vac/data-TYPO',
        state: recorded,
        target: missing,
      })
    );
    expect(error.message).toBe(
      'The recorded deployment uses data directory /srv/vac/data, not /srv/vac/data-TYPO. Pass --move-data-directory to move the deployment to /srv/vac/data-TYPO.'
    );
  });

  it('refuses a different existing path without the move flag', () => {
    const error = failure(() =>
      planDataDirectory({
        action: 'deploy',
        previous: live,
        requested: '/srv/vac/other',
        state: recorded,
        target: live,
      })
    );
    expect(error.message.includes('--move-data-directory')).toBe(true);
    expect(error.message.includes('/srv/vac/data,')).toBe(true);
  });

  it('never creates a missing directory, even with the move flag', () => {
    const error = failure(() =>
      planDataDirectory({
        action: 'deploy',
        moveDataDirectory: true,
        previous: live,
        requested: '/srv/vac/new',
        state: recorded,
        target: missing,
      })
    );
    expect(error.message).toBe(
      'Data directory /srv/vac/new does not exist; a recorded deployment never creates its data directory.'
    );
  });

  it('refuses an empty or unmarked move target while the old directory holds data', () => {
    for (const target of [empty, { ...empty, hasData: true }]) {
      const error = failure(() =>
        planDataDirectory({
          action: 'deploy',
          moveDataDirectory: true,
          previous: live,
          requested: '/srv/vac/new',
          state: recorded,
          target,
        })
      );
      expect(error.message.includes('--allow-empty-data-directory')).toBe(true);
    }
  });

  it('moves to a marked directory that holds data with the explicit flag', () => {
    expect(
      planDataDirectory({
        action: 'deploy',
        moveDataDirectory: true,
        previous: live,
        requested: '/srv/vac/copy',
        state: recorded,
        target: live,
      })
    ).toEqual({ create: false, validate: true });
  });

  it('moves to an empty directory when the old one is empty or with the override', () => {
    const move = {
      action: 'deploy',
      moveDataDirectory: true,
      requested: '/srv/vac/new',
      state: recorded,
      target: empty,
    };
    expect(planDataDirectory({ ...move, previous: empty })).toEqual({
      create: false,
      validate: true,
    });
    expect(
      planDataDirectory({
        ...move,
        allowEmptyDataDirectory: true,
        previous: live,
      })
    ).toEqual({ create: false, validate: true });
  });

  it('refuses its own directory after it lost the schema marker', () => {
    const same = {
      action: 'deploy',
      previous: empty,
      requested: '/srv/vac/data',
      state: recorded,
      target: empty,
    };
    expect(
      failure(() => planDataDirectory(same)).message.includes(SCHEMA_FILE)
    ).toBe(true);
    expect(
      planDataDirectory({ ...same, allowEmptyDataDirectory: true })
    ).toEqual({ create: false, validate: true });
    expect(
      planDataDirectory({ ...same, previous: live, target: live })
    ).toEqual({ create: false, validate: true });
  });

  it('creates the directory of a first deploy only', () => {
    const first = {
      requested: '/srv/vac/data',
      state: {},
      target: missing,
    };
    expect(planDataDirectory({ ...first, action: 'deploy' })).toEqual({
      create: true,
      validate: true,
    });
    expect(planDataDirectory({ ...first, action: 'status' })).toEqual({
      create: false,
      validate: false,
    });
    expect(planDataDirectory({ ...first, action: 'logs' })).toEqual({
      create: false,
      validate: false,
    });
    expect(
      failure(() => planDataDirectory({ ...first, action: 'stop' })).message
    ).toBe('Data directory /srv/vac/data does not exist.');
    expect(
      failure(() =>
        planDataDirectory({ ...first, action: 'rollback', state: recorded })
      ).message.includes('never creates')
    ).toBe(true);
  });

  it('lets other actions run against a different recorded directory', () => {
    expect(
      planDataDirectory({
        action: 'status',
        previous: live,
        requested: '/srv/vac/other',
        state: recorded,
        target: live,
      })
    ).toEqual({ create: false, validate: true });
  });
});

describe('data directory inspection on disk', () => {
  it('reports existence, data, and the marker without changing anything', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const root = await realpath(await mkdtemp(join(tmpdir(), 'issue-77-')));
    try {
      const data = join(root, 'data');
      expect(await inspectDataDirectory(data)).toEqual(missing);
      expect(
        (await rejection(() => validateDataDirectory(data, { create: false })))
          .message
      ).toBe(`Data directory ${data} does not exist.`);
      expect((await rejection(() => stat(data))).code).toBe('ENOENT');

      await mkdir(data, { mode: 0o700 });
      await writeFile(join(data, '.write-probe-1'), '');
      expect(await inspectDataDirectory(data)).toEqual(empty);
      // Validation marks the directory it accepts.
      expect(await validateDataDirectory(data, { create: false })).toBe(data);
      expect(await inspectDataDirectory(data)).toEqual({
        ...empty,
        marked: true,
      });
      await writeFile(join(data, 'offers.lino'), 'offer\n');
      expect(await inspectDataDirectory(data)).toEqual(live);
      expect(await validateDataDirectory(data, { create: false })).toBe(data);

      const file = join(root, 'file');
      await writeFile(file, '');
      expect((await rejection(() => inspectDataDirectory(file))).code).toBe(
        'ENOTDIR'
      );
      await mkdir(join(root, 'nested'));
      expect(resolveDataDirectory('nested', { cwd: root })).toBe(
        join(root, 'nested')
      );
      expect(() => resolveDataDirectory('  ')).toThrow(
        'A non-empty data directory is required.'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
