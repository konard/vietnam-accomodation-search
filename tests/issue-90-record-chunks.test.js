import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  MAX_NOTATION_LENGTH,
  notationLimit,
  setNotationLimit,
  sha256,
} from '../src/link-cli-mirror.js';
import {
  LinkCliMirror,
  LinksStore,
  TelegramIngestionService,
  TraceRecorder,
  serializeRecords,
} from '../src/index.js';
import {
  indexedRecordBatches,
  mergeRecords,
  readRecordIndex,
  retainNewest,
} from '../src/record-chunks.js';

const isDeno = typeof globalThis.Deno !== 'undefined';
// A lowered parse bound stands in for the 256 MiB production bound, so the
// collections below are larger than it without writing hundreds of MiB.
const LIMIT = 64 * 1024;
const CHUNK = 12 * 1024;

function link(index, marker = '') {
  return {
    id: `subject:${index}#values.text`,
    object: `Căn hộ ${index}${marker}`,
    predicate: 'values.text',
    subject: `subject:${index}`,
    type: 'semantic-link',
  };
}

function links(count, start = 0) {
  return Array.from({ length: count }, (_, index) => link(start + index));
}

// Emulates clink: records every import and exports it exactly.
function fakeClink() {
  const imports = [];
  const run = async (_command, arguments_) => {
    const database = arguments_[arguments_.indexOf('--db') + 1];
    const source = arguments_[arguments_.indexOf('--import') + 1];
    const target = arguments_[arguments_.indexOf('--export') + 1];
    const notation = await readFile(source, 'utf8');
    imports.push(notation.length);
    await writeFile(database, `binary:${sha256(notation)}`);
    await writeFile(target, notation);
  };
  return { imports, run };
}

function realClink() {
  if (isDeno) {
    return undefined;
  }
  const command = process.env.CLINK_COMMAND || 'clink';
  const probe = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return probe.status === 0 ? command : undefined;
}

// Runs a case under the lowered bound in its own data directory.
async function withStore(task, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'issue-90-'));
  const previous = setNotationLimit(LIMIT);
  try {
    const clink = fakeClink();
    const store = new LinksStore({
      directory,
      maxRecordChunkBytes: CHUNK,
      mirror:
        options.mirror === false
          ? undefined
          : options.mirror || new LinkCliMirror({ run: clink.run }),
      ...options.store,
    });
    await task({ clink, directory, store });
  } finally {
    setNotationLimit(previous);
    await rm(directory, { force: true, recursive: true });
  }
}

async function indexOf(directory, kind = 'domain-records') {
  return JSON.parse(await readFile(join(directory, `${kind}.index.json`)));
}

// The `updateRecords` merge each production caller used before appends
// were chunk-aware; `appendRecords` must keep its result.
function mapMerge(existing, incoming, maxRecords) {
  const byId = new Map(existing.map((record) => [record.id, record]));
  for (const record of incoming) {
    byId.set(record.id, record);
  }
  return [...byId.values()].slice(-maxRecords);
}

async function failure(promise) {
  return promise.then(
    () => undefined,
    (error) => error
  );
}

describe('chunked generic collections', () => {
  it('bounds the parse limit and restores the production default', () => {
    const previous = setNotationLimit(1234);
    expect(notationLimit()).toBe(1234);
    expect(setNotationLimit()).toBe(1234);
    expect(notationLimit()).toBe(MAX_NOTATION_LENGTH);
    setNotationLimit(previous);
    expect(() => setNotationLimit(0)).toThrow(TypeError);
    expect(() => setNotationLimit(1.5)).toThrow(TypeError);
  });

  it('keeps the id-keyed merge and eviction semantics in memory', () => {
    const merged = mergeRecords(
      [{ id: 'a', v: 1 }, { id: 'b' }],
      [{ id: 'a', v: 2 }, { id: 'c' }, { id: 'c', v: 3 }],
      true
    );
    expect(merged).toEqual([{ id: 'a', v: 2 }, { id: 'b' }, { id: 'c', v: 3 }]);
    expect(
      mergeRecords([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }, { id: 'b' }], false)
    ).toEqual([{ id: 'a', v: 1 }, { id: 'b' }]);
    const records = links(10);
    expect(
      retainNewest('domain-record', records, {
        maxBytes: Infinity,
        maxRecords: 4,
      })
    ).toEqual(records.slice(-4));
    const single = Buffer.byteLength(
      serializeRecords('domain-record', [records[9]])
    );
    expect(
      retainNewest('domain-record', records, {
        maxBytes: single,
        maxRecords: Infinity,
      })
    ).toEqual([records[9]]);
  });

  // Deno runs the suite with read-only permissions.
  if (isDeno) {
    return;
  }

  it('writes a collection larger than the parse bound and round-trips it', async () => {
    await withStore(async ({ clink, directory, store }) => {
      const records = links(120);
      expect(
        Buffer.byteLength(serializeRecords('domain-record', records)) > LIMIT
      ).toBe(true);
      await store.saveRecords('domain-records', records);
      const index = await indexOf(directory);
      expect(index.version).toBe(1);
      expect(index.kind).toBe('domain-records');
      expect(index.count).toBe(120);
      expect(index.chunks.length > 1).toBe(true);
      expect(index.chunks.every(({ bytes }) => bytes <= CHUNK)).toBe(true);
      expect(Math.max(...clink.imports) <= LIMIT / 4).toBe(true);
      expect(
        JSON.parse(await readFile(join(directory, '.state-schema.json')))
          .schemaVersion
      ).toBe(4);
      const fresh = new LinksStore({
        directory,
        maxRecordChunkBytes: CHUNK,
        mirror: new LinkCliMirror({ run: clink.run }),
      });
      expect(await fresh.loadRecords('domain-records')).toEqual(records);
      expect(
        await fresh.queryRecords('domain-records', {
          path: 'subject',
          value: 'subject:77',
        })
      ).toEqual([records[77]]);
      for (const { sha256: digest } of index.chunks) {
        const chunk = join(directory, 'domain-records.chunks', digest);
        expect(
          JSON.parse(
            await readFile(
              join(chunk, '.binary', 'domain-records.current.json')
            )
          ).sha256
        ).toBe(digest);
        expect(JSON.parse(await readFile(join(chunk, 'ids.json'))).sha256).toBe(
          digest
        );
      }
      const batches = [];
      for await (const batch of indexedRecordBatches(
        {
          collection: 'domain-records',
          directory,
          kind: 'domain-record',
          maxChunkBytes: CHUNK,
        },
        index
      )) {
        batches.push(batch.length);
      }
      expect(batches).toEqual(index.chunks.map(({ count }) => count));
    });
  });

  it('rewrites only the chunks an update changes', async () => {
    await withStore(async ({ clink, directory, store }) => {
      const records = links(150);
      await store.saveRecords('domain-records', records);
      const before = await indexOf(directory);
      const imports = clink.imports.length;
      const next = await store.updateRecords('domain-records', (current) =>
        current.map((record, index) =>
          index === 90 ? { ...record, object: 'changed' } : record
        )
      );
      expect(next[90].object).toBe('changed');
      const after = await indexOf(directory);
      const kept = after.chunks.filter(({ sha256: digest }) =>
        before.chunks.some((chunk) => chunk.sha256 === digest)
      );
      expect(kept.length).toBe(after.chunks.length - 1);
      expect(clink.imports.length - imports <= 2).toBe(true);
      expect(await store.loadRecords('domain-records')).toEqual(next);
      expect(
        (await readdir(join(directory, 'domain-records.chunks'))).length
      ).toBe(after.chunks.length);
      await store.saveRecords('domain-records', []);
      expect((await indexOf(directory)).chunks).toEqual([]);
      expect(await store.loadRecords('domain-records')).toEqual([]);
      expect(await readdir(join(directory, 'domain-records.chunks'))).toEqual(
        []
      );
    });
  });

  it('appends with the merge semantics while touching only the tail', async () => {
    await withStore(async ({ directory, store }) => {
      let expected = [];
      await store.appendRecords('traces', []);
      for (let batch = 0; batch < 6; batch += 1) {
        const incoming = [
          ...links(30, batch * 25),
          { ...link(batch * 3), object: `replaced ${batch}` },
        ];
        await store.appendRecords('traces', incoming, { maxRecords: 100 });
        expected = mapMerge(expected, incoming, 100);
        expect(await store.loadRecords('traces')).toEqual(expected);
      }
      const index = await indexOf(directory, 'traces');
      expect(index.count).toBe(100);
      const tailOnly = links(3, 1000);
      const before = index.chunks.slice(0, -1).map(({ sha256: id }) => id);
      await store.appendRecords('traces', tailOnly, { maxRecords: 1000 });
      const after = (await indexOf(directory, 'traces')).chunks.map(
        ({ sha256: id }) => id
      );
      expect(after.slice(0, before.length)).toEqual(before);
      expect((await store.loadRecords('traces')).slice(-3)).toEqual(tailOnly);
    });
  });

  it('keeps the first record per id and evicts by bytes', async () => {
    await withStore(async ({ directory, store }) => {
      await store.appendRecords('telegram-events', links(80));
      await store.appendRecords(
        'telegram-events',
        [{ ...link(3), object: 'ignored' }, link(500), link(500)],
        { replace: false }
      );
      const kept = await store.loadRecords('telegram-events');
      expect(kept.length).toBe(81);
      expect(kept[3]).toEqual(link(3));
      expect(kept.at(-1)).toEqual(link(500));
      const budget = Math.floor(
        (await indexOf(directory, 'telegram-events')).bytes / 2
      );
      await store.appendRecords('telegram-events', links(5, 600), {
        maxBytes: budget,
      });
      const index = await indexOf(directory, 'telegram-events');
      expect(index.bytes <= budget).toBe(true);
      const remaining = await store.loadRecords('telegram-events');
      expect(remaining.slice(-5)).toEqual(links(5, 600));
      expect(remaining.length < 86).toBe(true);
      expect(remaining.length).toBe(index.count);
    });
  });

  it('evicts a single-file collection and splits it when it grows', async () => {
    await withStore(
      async ({ directory, store }) => {
        await store.appendRecords('traces', links(3), { maxRecords: 2 });
        expect(await store.loadRecords('traces')).toEqual(links(2, 1));
        expect(await readRecordIndex(directory, 'traces')).toBe(undefined);
        await store.appendRecords('traces', links(60, 10));
        expect((await indexOf(directory, 'traces')).count).toBe(62);
        expect(await readFile(join(directory, 'traces.lino'), 'utf8')).toBe(
          serializeRecords('trace', links(2, 1))
        );
      },
      { mirror: false }
    );
  });

  it('migrates an oversized single file one record at a time', async () => {
    for (const mirror of [undefined, false]) {
      await withStore(
        async ({ directory, store }) => {
          const records = links(100);
          const path = join(directory, 'domain-records.lino');
          await writeFile(path, serializeRecords('domain-record', records));
          expect((await stat(path)).size > LIMIT).toBe(true);
          expect(await store.loadRecords('domain-records')).toEqual(records);
          expect((await indexOf(directory)).count).toBe(100);
          await store.appendRecords('domain-records', [link(1000)]);
          expect((await store.loadRecords('domain-records')).length).toBe(101);
        },
        { mirror }
      );
    }
    await withStore(async ({ directory, store }) => {
      const records = links(100);
      await writeFile(
        join(directory, 'domain-records.lino'),
        serializeRecords('domain-record', records)
      );
      await store.appendRecords('domain-records', [link(5)]);
      expect((await store.loadRecords('domain-records')).length).toBe(100);
      await writeFile(
        join(directory, 'traces.lino'),
        Array.from({ length: 4000 }, (_, index) => `(legacy ${index})\n`).join(
          ''
        )
      );
      expect((await failure(store.loadRecords('traces'))).code).toBe(
        'legacy-collection-too-large'
      );
    });
  });

  it('refuses oversized records, budgets and single files', async () => {
    await withStore(
      async ({ directory, store }) => {
        const huge = { id: 'huge', text: 'x'.repeat(LIMIT / 2) };
        expect((await failure(store.saveRecords('notes', [huge]))).code).toBe(
          'record-too-large'
        );
        await store.saveRecords('notes', links(60));
        const index = await indexOf(directory, 'notes');
        const tight = new LinksStore({
          directory,
          maxBytes: 1000,
          maxRecordChunkBytes: CHUNK,
        });
        expect(
          (await failure(tight.saveRecords('notes', links(70)))).code
        ).toBe('record-budget-exhausted');
        expect(await indexOf(directory, 'notes')).toEqual(index);
        expect((await readdir(join(directory, 'notes.chunks'))).sort()).toEqual(
          index.chunks.map(({ sha256: id }) => id).sort()
        );
        await tight.saveRecords('memos', links(1));
        expect(await tight.loadRecords('memos')).toEqual(links(1));
        const defaults = new LinksStore({ directory });
        const many = links(200);
        expect(
          Buffer.byteLength(serializeRecords('draft', many))
        ).toBeGreaterThan(LIMIT / 4);
        await defaults.saveRecords('drafts', many);
        await defaults.updateRecords('drafts', (old) => [...old, link(200)]);
        expect(await defaults.loadRecords('drafts')).toEqual(links(201));
        expect((await indexOf(directory, 'drafts')).count).toBe(201);
        expect(
          (
            await failure(
              store.saveSearchState({ text: 'y'.repeat(LIMIT / 2) })
            )
          ).code
        ).toBe('notation-too-large');
        expect(() => store.appendRecords('offers', [])).toThrow(TypeError);
        expect(() => store.appendRecords('notes', [{ a: 1 }])).toThrow(
          TypeError
        );
        expect(() => store.appendRecords('notes', null)).toThrow(TypeError);
        expect(() =>
          store.appendRecords('notes', [], { maxRecords: 0 })
        ).toThrow(TypeError);
        expect(() => store.appendRecords('notes', [], { maxBytes: 0 })).toThrow(
          TypeError
        );
      },
      { mirror: false }
    );
  });

  it('verifies chunks against the index and rebuilds derived ids', async () => {
    await withStore(
      async ({ directory, store }) => {
        await store.saveRecords('notes', links(60));
        const index = await indexOf(directory, 'notes');
        const [first] = index.chunks;
        const chunk = join(directory, 'notes.chunks', first.sha256);
        await unlink(join(chunk, 'ids.json'));
        await store.appendRecords('notes', [{ ...link(0), object: 'new' }]);
        expect((await store.loadRecords('notes'))[0].object).toBe('new');
        const current = await indexOf(directory, 'notes');
        const tail = join(
          directory,
          'notes.chunks',
          current.chunks.at(-1).sha256
        );
        await writeFile(join(tail, 'ids.json'), '{"ids":[]}\n');
        await store.appendRecords('notes', [link(999)]);
        expect((await store.loadRecords('notes')).at(-1)).toEqual(link(999));
        const latest = await indexOf(directory, 'notes');
        await writeFile(
          join(
            directory,
            'notes.chunks',
            latest.chunks[0].sha256,
            'notes.lino'
          ),
          'tampered'
        );
        expect((await failure(store.loadRecords('notes'))).message).toBe(
          'Canonical notes chunk does not match its index.'
        );
        const text = serializeRecords('note', [link(1)]);
        const forged = join(directory, 'notes.chunks', sha256(text));
        await mkdir(forged, { recursive: true });
        await writeFile(join(forged, 'notes.lino'), text);
        const bytes = Buffer.byteLength(text);
        await writeFile(
          join(directory, 'notes.index.json'),
          JSON.stringify({
            bytes,
            chunks: [{ bytes, count: 2, sha256: sha256(text) }],
            count: 2,
            kind: 'notes',
            version: 1,
          })
        );
        expect((await failure(store.loadRecords('notes'))).message).toBe(
          'Canonical notes chunk count does not match its index.'
        );
        await writeFile(
          join(directory, 'notes.index.json'),
          JSON.stringify({ ...latest, count: latest.count + 1 })
        );
        expect((await failure(store.loadRecords('notes'))).message).toBe(
          'Invalid canonical notes index.'
        );
        await writeFile(join(directory, 'notes.index.json'), '{');
        expect((await failure(store.loadRecords('notes'))).message).toBe(
          'Invalid canonical notes index.'
        );
      },
      { mirror: false }
    );
  });

  it('appends Telegram events, domain records and traces in place', async () => {
    await withStore(
      async ({ store }) => {
        let handler;
        const source = { id: 'telegram:rentals' };
        const message = {
          chat: { username: 'rentals' },
          date: '2026-09-20T00:00:00Z',
          id: 1,
          sourceId: source.id,
          text: 'Studio 8,000,000 VND/month, contact +84123456789',
        };
        const service = new TelegramIngestionService({
          logger: { error: () => {} },
          maxEvents: 2,
          maxRecordBytes: 1024 ** 2,
          now: () => new Date('2026-09-22T00:00:00Z'),
          provider: {
            destroy: async () => {},
            history: async () => [message],
            liveUpdates: async (next) => {
              handler = next;
              return { stop: () => {} };
            },
          },
          rates: { VND: 1 },
          store,
        });
        await service.start([source]);
        const edit = {
          message: { ...message, editDate: '2026-09-22T02:00:00Z' },
          sourceId: source.id,
          type: 'edit',
        };
        await handler(edit);
        await handler(edit);
        await handler({ messageIds: [1], sourceId: source.id, type: 'delete' });
        expect(
          (await store.loadRecords('telegram-events')).map(({ type }) => type)
        ).toEqual(['edit', 'delete']);
        const records = await store.loadRecords('domain-records');
        expect(
          records.some(
            ({ predicate, object }) =>
              predicate === 'deletion.eventType' && object === 'delete'
          )
        ).toBe(true);
        expect(
          (await store.loadRecords('traces')).some(
            ({ status }) => status === 'success'
          )
        ).toBe(true);
        await service.destroy();
        const recorder = new TraceRecorder({ maxEvents: 2, store });
        for (const stage of ['one', 'two', 'three']) {
          recorder.record({ runId: 'run', stage, status: 'success' });
        }
        await recorder.persist();
        const traces = await store.loadRecords('traces');
        expect(traces.length).toBe(3);
        expect(traces.map(({ id }) => id)).toEqual([
          'trace-retention',
          'trace:run:2',
          'trace:run:3',
        ]);
      },
      { mirror: false }
    );
  });

  it('reads chunked sources through loadSources', async () => {
    await withStore(
      async ({ store }) => {
        const sources = Array.from({ length: 50 }, (_, index) => ({
          id: `source-${index}`,
          title: `Nha Trang ${index} `.repeat(20),
        }));
        await store.saveSources(sources);
        expect(await store.loadSources()).toEqual(sources);
      },
      { mirror: false }
    );
  });

  const command = realClink();
  if (command) {
    it('projects every chunk with the real clink binary', async () => {
      await withStore(
        async ({ directory, store }) => {
          const records = links(70);
          await store.saveRecords('domain-records', records);
          await store.appendRecords('domain-records', links(5, 70), {
            maxRecords: 60,
          });
          const fresh = new LinksStore({
            binaryMirror: true,
            directory,
            maxRecordChunkBytes: CHUNK,
          });
          expect(await fresh.loadRecords('domain-records')).toEqual(
            links(60, 15)
          );
        },
        { mirror: new LinkCliMirror({ command }) }
      );
    });
  }
});
