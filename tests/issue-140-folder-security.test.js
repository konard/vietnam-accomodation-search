import { describe, it, expect } from 'test-anywhere';
import {
  folderContainsDialog,
  folderUsesCategories,
} from '../experiments/telegram-folder-filter.mjs';
import { trackedPackageLocks } from '../scripts/tracked-lockfiles.mjs';
describe('custom folders and tracked dependency locks', () => {
  it('resolves category rules with explicit includes, exclusions and metadata', () => {
    const channel = { _: 'channel', id: 1 };
    const group = { _: 'channel', id: 2, megagroup: true };
    expect(folderUsesCategories({ groups: true })).toBe(true);
    expect(folderUsesCategories({ includePeers: [] })).toBe(false);
    expect(folderContainsDialog({ groups: true }, { entity: group })).toBe(
      true
    );
    expect(folderContainsDialog({ groups: true }, { entity: channel })).toBe(
      false
    );
    expect(
      folderContainsDialog(
        { broadcasts: true, excludeRead: true },
        { entity: channel, unreadCount: 0 }
      )
    ).toBe(false);
    expect(
      folderContainsDialog(
        { broadcasts: true, excludeMuted: true },
        { entity: channel, isMuted: true }
      )
    ).toBe(false);
    expect(
      folderContainsDialog(
        { broadcasts: true, excludeArchived: true },
        { entity: channel, folderId: 1 }
      )
    ).toBe(false);
    expect(
      folderContainsDialog(
        {
          includePeers: [{ _: 'inputPeerChannel', channelId: 1 }],
          excludeRead: true,
        },
        { entity: channel }
      )
    ).toBe(true);
    expect(
      folderContainsDialog(
        {
          broadcasts: true,
          excludePeers: [{ _: 'inputPeerChannel', channelId: 1 }],
        },
        { entity: channel }
      )
    ).toBe(false);
  });
  it('audits only git-tracked locks without walking private runtime data', () => {
    const calls = [];
    const locks = trackedPackageLocks({
      git: (command, args) => {
        calls.push({ command, args });
        return 'package-lock.json\0examples/universal-app/package-lock.json\0';
      },
    });
    expect(locks).toEqual([
      'examples/universal-app/package-lock.json',
      'package-lock.json',
    ]);
    expect(calls[0].args).toContain('ls-files');
    expect(
      locks.some((path) => path.includes('.vietnam-accomodation-search'))
    ).toBe(false);
  });
});

it('ignores runtime lockfiles but detects newly tracked application locks', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'tracked-lock-regression-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    await writeFile(
      join(directory, '.gitignore'),
      '.vietnam-accomodation-search/\n'
    );
    await writeFile(join(directory, 'package-lock.json'), '{}');
    await mkdir(
      join(
        directory,
        '.vietnam-accomodation-search',
        'telegram-live-audit',
        'deps'
      ),
      { recursive: true }
    );
    await writeFile(
      join(
        directory,
        '.vietnam-accomodation-search',
        'telegram-live-audit',
        'deps',
        'package-lock.json'
      ),
      '{}'
    );
    execFileSync('git', ['add', '.'], { cwd: directory });
    expect(trackedPackageLocks({ cwd: directory })).toEqual([
      'package-lock.json',
    ]);
    await mkdir(join(directory, 'examples', 'new-app'), { recursive: true });
    await writeFile(
      join(directory, 'examples', 'new-app', 'package-lock.json'),
      '{}'
    );
    execFileSync('git', ['add', 'examples'], { cwd: directory });
    expect(trackedPackageLocks({ cwd: directory })).toEqual([
      'examples/new-app/package-lock.json',
      'package-lock.json',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('does not query custom folder IDs and counts genuine resolution failures', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const { resolveFolderEntities } =
    await import('../experiments/audit-telegram-accommodations.mjs');
  const calls = [];
  const entity = {
    className: 'Channel',
    id: 1,
    username: 'fixture',
    title: 'Fixture',
  };
  const explicit = await resolveFolderEntities(
    {
      getEntity: async () => entity,
      getDialogs: async (args) => {
        calls.push(args);
        throw new Error('must not query explicit-only folder');
      },
    },
    { id: 2, includePeers: [{ className: 'InputPeerChannel', channelId: 1 }] }
  );
  expect(calls.length).toBe(0);
  expect(explicit.resolutionErrors).toBe(0);
  expect(explicit.entities.size).toBe(1);
  const rules = await resolveFolderEntities(
    {
      getDialogs: async (args) => {
        calls.push(args);
        return [{ entity }];
      },
    },
    { id: 2, broadcasts: true }
  );
  expect(calls.map((call) => call.folder)).toEqual([0, 1]);
  expect(rules.entities.size).toBe(1);
  const failed = await resolveFolderEntities(
    {
      getEntity: async () => {
        throw new Error('inaccessible');
      },
    },
    { includePeers: [{ className: 'InputPeerChannel', channelId: 1 }] }
  );
  expect(failed.resolutionErrors).toBe(1);
});
