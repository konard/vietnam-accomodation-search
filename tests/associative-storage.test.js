import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Parser } from 'links-notation';
import { describe, expect, it } from 'test-anywhere';

import {
  LinkCliMirror,
  LinksStore,
  deserializeRecords,
  queryRecords,
  serializeRecords,
} from '../src/index.js';
import { durableWrite, sha256 } from '../src/link-cli-mirror.js';
import { staleLock } from '../src/links-store.js';

describe('canonical associative storage', () => {
  it('round-trips typed nested and unknown fields as two-value links', () => {
    const records = [
      {
        active: true,
        contacts: { telegram: ['@owner'], unknown: null },
        id: 'offer:42',
        photos: [],
        priceVnd: 12_500_000,
        raw: { futureField: 'kept exactly' },
        title: 'Sea view (studio)',
      },
    ];

    const notation = serializeRecords('offer', records);
    const links = new Parser().parse(notation);

    expect(links.every((link) => link.values.length === 2)).toBe(true);
    expect(notation).toContain('Sea view (studio)');
    expect(notation).toContain('futureField');
    expect(notation).not.toContain('data:');
    expect(serializeRecords('offer', records)).toBe(notation);
    expect(deserializeRecords('offer', notation)).toEqual(records);
  });

  it('stores all entity kinds through the same schema and API', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'associative-store-'));
    const store = new LinksStore({ binaryMirror: false, directory });
    try {
      const entities = [
        { id: 'preset-1', filters: { types: ['hotel', 'studio'] } },
        { id: 'subscription-1', lastSuccessfulRunAt: null },
      ];
      await store.saveRecords('presets', entities);
      expect(await store.loadRecords('presets')).toEqual(entities);
      expect(await readFile(join(directory, 'presets.lino'), 'utf8')).toContain(
        'record:preset'
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('queries addressable relationships without decoding opaque JSON', () => {
    const notation = serializeRecords('subscription', [
      { id: 'one', presetName: 'beach', userId: '7' },
      { id: 'two', presetName: 'city', userId: '8' },
    ]);
    expect(
      queryRecords('subscription', notation, {
        path: 'presetName',
        value: 'beach',
      })
    ).toEqual([{ id: 'one', presetName: 'beach', userId: '7' }]);
  });

  it('does not publish text when the binary candidate fails', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'mirror-failure-'));
    const mirror = {
      stage: async () => {
        throw new Error('clink import failed');
      },
    };
    const store = new LinksStore({ directory, mirror });
    try {
      let failure;
      try {
        await store.saveSources([{ id: 'old', type: 'web' }]);
      } catch (error) {
        failure = error;
      }
      expect(failure.message).toContain('clink import failed');
      expect(await store.loadSources()).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('repairs a committed text snapshot when pointer activation was interrupted', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'mirror-recovery-'));
    let repaired = 0;
    const mirror = {
      ensure: async () => {
        repaired += 1;
      },
      stage: async () => ({
        activate: async () => {
          throw new Error('simulated crash before pointer commit');
        },
      }),
    };
    const store = new LinksStore({ directory, mirror });
    try {
      let failure;
      try {
        await store.saveRecords('presets', [{ id: 'complete' }]);
      } catch (error) {
        failure = error;
      }
      expect(failure.message).toContain('simulated crash');
      expect(
        deserializeRecords(
          'preset',
          await readFile(join(directory, 'presets.lino'), 'utf8')
        )
      ).toEqual([{ id: 'complete' }]);
      expect(await store.loadRecords('presets')).toEqual([{ id: 'complete' }]);
      expect(repaired).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('stages and activates an immutable clink database with a verified export', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'clink-adapter-'));
    const calls = [];
    const mirror = new LinkCliMirror({
      run: async (command, arguments_) => {
        calls.push([command, arguments_]);
        const databasePath = arguments_[arguments_.indexOf('--db') + 1];
        const exportPath = arguments_[arguments_.indexOf('--export') + 1];
        const importPath = arguments_[arguments_.indexOf('--import') + 1];
        const contents = await readFile(importPath, 'utf8');
        await writeFile(databasePath, 'binary');
        await writeFile(exportPath, contents);
      },
    });
    const store = new LinksStore({ directory, mirror });
    try {
      await store.saveSources([{ id: 'one', type: 'web' }]);
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toBe('clink');
      expect(calls[0][1]).toContain('--auto-create-missing-references');
      expect(calls[0][1]).toContain('--transactions');
      expect(calls[0][1]).toContain('sync');
      expect(calls[0][1]).toContain('--import');
      expect(calls[0][1]).toContain('--export');
      const pointer = JSON.parse(
        await readFile(
          join(directory, '.binary', 'sources.current.json'),
          'utf8'
        )
      );
      expect(pointer.sha256).toMatch(/^[a-f\d]{64}$/u);

      await rm(join(directory, '.binary', 'sources.current.json'));
      await store.loadSources();
      expect(calls.length).toBe(2);
      expect(
        JSON.parse(
          await readFile(
            join(directory, '.binary', 'sources.current.json'),
            'utf8'
          )
        ).sha256
      ).toBe(pointer.sha256);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps canonical and binary projections aligned after source-message deletion', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'clink-delete-'));
    const mirror = new LinkCliMirror({
      run: async (_command, arguments_) => {
        const databasePath = arguments_[arguments_.indexOf('--db') + 1];
        const exportPath = arguments_[arguments_.indexOf('--export') + 1];
        const importPath = arguments_[arguments_.indexOf('--import') + 1];
        await writeFile(databasePath, 'binary');
        await writeFile(exportPath, await readFile(importPath, 'utf8'));
      },
    });
    const store = new LinksStore({ directory, mirror });
    try {
      await store.saveOffers([
        {
          id: 'remove',
          provenance: { messageId: 7, sourceId: 'telegram-source' },
        },
        {
          id: 'keep',
          provenance: { messageId: 8, sourceId: 'telegram-source' },
        },
        {
          collectedAt: '2026-09-22T00:00:00.000Z',
          id: 'merged-remove',
          identityKeys: ['property:shared'],
          provenance: { messageId: 7, sourceId: 'telegram-source' },
          raw: { marker: 'removed-variant-marker' },
          sourceId: 'telegram-source',
        },
        {
          collectedAt: '2026-09-22T01:00:00.000Z',
          id: 'merged-keep',
          identityKeys: ['property:shared'],
          provenance: { messageId: 9, sourceId: 'other-source' },
          raw: { marker: 'kept-variant-marker' },
          sourceId: 'other-source',
        },
      ]);
      await store.deleteOffersByMessages('telegram-source', [7]);
      await store.deleteOffersByMessages('telegram-source', [999]);

      const remaining = await store.listOffers();
      expect(remaining.map(({ id }) => id).sort()).toEqual([
        'keep',
        'merged-remove',
      ]);
      const merged = remaining.find(({ id }) => id === 'merged-remove');
      expect(merged.raw.marker).toBe('kept-variant-marker');
      expect(merged.variants.map(({ id }) => id)).toEqual(['merged-keep']);
      expect(merged.sourceIds).toEqual(['other-source']);
      const pointer = JSON.parse(
        await readFile(
          join(directory, '.binary', 'offers.current.json'),
          'utf8'
        )
      );
      expect(pointer.sha256).toBe(
        sha256(await readFile(join(directory, 'offers.lino'), 'utf8'))
      );
      const verified = await readFile(
        join(pointer.directory, 'verified.lino'),
        'utf8'
      );
      expect(verified).not.toContain('record:offer:remove:field:/');
      expect(verified).not.toContain('removed-variant-marker');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('persists a deletion when only one variant of a merged offer changed', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'partial-delete-store-'));
    const store = new LinksStore({ binaryMirror: false, directory });
    try {
      await store.saveOffers([
        {
          collectedAt: '2026-09-22T00:00:00.000Z',
          id: 'telegram-variant',
          identityKeys: ['property:shared-partial'],
          provenance: { messageId: 7, sourceId: 'telegram-source' },
          sourceId: 'telegram-source',
        },
        {
          collectedAt: '2026-09-22T01:00:00.000Z',
          id: 'web-variant',
          identityKeys: ['property:shared-partial'],
          provenance: { messageId: 9, sourceId: 'web-source' },
          sourceId: 'web-source',
        },
      ]);

      await store.deleteOffersByMessages('telegram-source', [7]);

      const [remaining] = await store.listOffers();
      expect(remaining.variants.map(({ id }) => id)).toEqual(['web-variant']);
      expect(remaining.sourceIds).toEqual(['web-source']);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('serializes overlapping writes without losing either record', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'serialized-store-'));
    const store = new LinksStore({ binaryMirror: false, directory });
    try {
      await Promise.all([
        store.saveOffers([{ id: 'one', sourceId: 'a', title: 'One' }]),
        store.saveOffers([{ id: 'two', sourceId: 'b', title: 'Two' }]),
      ]);
      expect((await store.listOffers()).map(({ id }) => id).sort()).toEqual([
        'one',
        'two',
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('locks generic read-modify-write transactions across store instances', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'transactional-store-'));
    const first = new LinksStore({ binaryMirror: false, directory });
    const second = new LinksStore({ binaryMirror: false, directory });
    try {
      await Promise.all([
        first.updateRecords('presets', (records) => [
          ...records,
          { id: 'first' },
        ]),
        second.updateRecords('presets', (records) => [
          ...records,
          { id: 'second' },
        ]),
      ]);
      expect(
        (await first.loadRecords('presets')).map(({ id }) => id).sort()
      ).toEqual(['first', 'second']);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('holds the process lock while repairing a binary projection on read', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'repair-lock-store-'));
    const writer = new LinksStore({ binaryMirror: false, directory });
    let enterRepair;
    const repairing = new Promise((resolve) => {
      enterRepair = resolve;
    });
    let finishRepair;
    const repairGate = new Promise((resolve) => {
      finishRepair = resolve;
    });
    const reader = new LinksStore({
      directory,
      mirror: {
        ensure: async () => {
          enterRepair();
          await repairGate;
        },
        stage: async () => ({ activate: async () => {} }),
      },
    });
    try {
      await writer.saveRecords('presets', [{ id: 'before' }]);
      const read = reader.loadRecords('presets');
      await repairing;
      let writeFinished = false;
      const write = writer
        .updateRecords('presets', (records) => [...records, { id: 'after' }])
        .then(() => {
          writeFinished = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(writeFinished).toBe(false);
      finishRepair();
      expect(await read).toEqual([{ id: 'before' }]);
      await write;
      expect(await writer.loadRecords('presets')).toEqual([
        { id: 'before' },
        { id: 'after' },
      ]);
    } finally {
      finishRepair();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('validates generic transactions and cleans up failed durable writes', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'invalid-transaction-'));
    const store = new LinksStore({ binaryMirror: false, directory });
    try {
      expect(() => store.updateRecords('presets')).toThrow();
      const invalid = await Promise.allSettled([
        store.updateRecords('presets', async () => ({ id: 'not-an-array' })),
      ]);
      expect(invalid[0].reason.message).toContain('must return an array');

      const occupiedDirectory = join(directory, 'occupied-directory');
      await mkdir(occupiedDirectory);
      const failedWrite = await Promise.allSettled([
        durableWrite(occupiedDirectory, 'state'),
      ]);
      expect(failedWrite[0].status).toBe('rejected');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('recovers a write lock left behind by a terminated process', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'stale-lock-store-'));
    const lock = join(directory, '.write.lock');
    await mkdir(lock);
    await writeFile(
      join(lock, 'owner.json'),
      JSON.stringify({ pid: 2_147_483_647 })
    );
    try {
      const store = new LinksStore({ binaryMirror: false, directory });
      await store.saveRecords('presets', [{ id: 'recovered' }]);
      expect(await store.loadRecords('presets')).toEqual([{ id: 'recovered' }]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('recovers an old lock whose owner file was never committed', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'orphan-lock-store-'));
    const lock = join(directory, '.write.lock');
    await mkdir(lock);
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    try {
      const store = new LinksStore({ binaryMirror: false, directory });
      await store.saveRecords('presets', [{ id: 'recovered-orphan' }]);
      expect(await store.loadRecords('presets')).toEqual([
        { id: 'recovered-orphan' },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('surfaces unexpected lock metadata inspection failures', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'failed-lock-stat-'));
    const lock = join(directory, '.write.lock');
    await mkdir(lock);
    const inspectionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    try {
      let error;
      try {
        await staleLock(lock, async () => {
          throw inspectionError;
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBe(inspectionError);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('coordinates concurrent writers in separate processes', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'process-lock-store-'));
    const fixture = new globalThis.URL(
      'fixtures/concurrent-store-writer.mjs',
      import.meta.url
    );
    const run = (id) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [fixture.pathname, directory, id],
          {
            stdio: 'inherit',
          }
        );
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`writer exited ${code}`))
        );
      });
    try {
      await Promise.all([run('process-one'), run('process-two')]);
      expect(
        (await new LinksStore({ binaryMirror: false, directory }).listOffers())
          .map(({ id }) => id)
          .sort()
      ).toEqual(['process-one', 'process-two']);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
