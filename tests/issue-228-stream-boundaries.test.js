import assert from 'node:assert/strict';
import fs, { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'test-anywhere';
import { iterateOffers, writeOfferStream } from '../src/offer-stream.js';
import { LinksStore } from '../src/links-store.js';

const offers = [
  { id: 'one', priceVnd: 5 },
  { id: 'two', priceVnd: 6 },
];
const consume = async (options) => {
  const rows = [];
  for await (const row of iterateOffers(options)) {
    rows.push(row);
  }
  return rows;
};
async function withDirectory(run) {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'vac-stream-bounds-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const publish = (directory, options = {}) =>
  writeOfferStream({ directory, offers, maxBytes: 8192, ...options });

it('rejects corrupt shard identities, counts, totals and duplicate order entries', () =>
  withDirectory(async (directory) => {
    await publish(directory);
    const path = join(directory, 'offers.index.json');
    const original = await readFile(path, 'utf8');
    const mutations = [
      [
        (index) => {
          index.version = 2;
        },
        /Invalid or oversized/u,
      ],
      [
        (index) => {
          index.count = 65537;
        },
        /Invalid or oversized/u,
      ],
      [
        (index) => {
          index.shards[0].sha256 = '../foreign';
        },
        /Invalid offer stream shard/u,
      ],
      [
        (index) => {
          index.shards[0].count++;
        },
        /shard count mismatch/u,
      ],
      [
        (index) => {
          index.shards.push(index.shards[0]);
        },
        /Duplicate offer stream identity/u,
      ],
      [
        (index) => {
          index.count++;
        },
        /totals or order mismatch/u,
      ],
      [
        (index) => {
          index.bytes++;
        },
        /totals or order mismatch/u,
      ],
      [
        (index) => {
          index.order = ['one'];
        },
        /totals or order mismatch/u,
      ],
      [
        (index) => {
          index.order = ['one', 'absent'];
        },
        /totals or order mismatch/u,
      ],
      [
        (index) => {
          index.order = ['one', 'one'];
        },
        /totals or order mismatch/u,
      ],
    ];
    for (const [mutate, error] of mutations) {
      const index = JSON.parse(original);
      mutate(index);
      await writeFile(path, JSON.stringify(index));
      await assert.rejects(consume({ directory }), error);
    }
  }));

it('enforces finite shard, total storage and metadata budgets before publication', () =>
  withDirectory(async (directory) => {
    for (const options of [
      { maxBytes: Infinity },
      { maxShardBytes: 0 },
      { maxIndexBytes: 0 },
    ]) {
      await assert.rejects(publish(directory, options), /positive finite/u);
    }
    await publish(directory);
    const indexPath = join(directory, 'offers.index.json');
    const baseline = await readFile(indexPath, 'utf8');
    await assert.rejects(
      publish(directory, { maxBytes: 1 }),
      /storage budget exceeded/u
    );
    await assert.rejects(
      publish(directory, { offers: [offers[0], offers[0]] }),
      /reconciled/u
    );
    await assert.rejects(
      publish(directory, { maxIndexBytes: 64 }),
      /metadata budget exceeded/u
    );
    await assert.rejects(
      publish(directory, { offers: [offers[0]], maxIndexBytes: 128 }),
      /metadata budget exceeded/u
    );
    assert.equal(await readFile(indexPath, 'utf8'), baseline);
    await assert.rejects(
      consume({ directory, maxIndexBytes: 16 }),
      /memory bound/u
    );
    await assert.rejects(
      consume({ directory, maxShardBytes: 1 }),
      /memory bound/u
    );
    await publish(directory, { offers: [] });
    assert.deepEqual(await consume({ directory }), []);
    const store = new LinksStore({ directory });
    for (const limit of [0, 1001, 1.5]) {
      await assert.rejects(store.topOffers({ limit }), /between 1 and 1000/u);
    }
  }));

it('stages and activates every binary projection and verifies it during streaming', () =>
  withDirectory(async (directory) => {
    const events = [];
    const mirror = {
      stage: async (request) => {
        assert.equal(request.kind, 'offers');
        assert.equal(
          await readFile(join(request.directory, 'offers.lino'), 'utf8'),
          request.notation
        );
        events.push('stage');
        return { activate: async () => events.push('activate') };
      },
      ensure: async (request) => {
        assert.equal(request.kind, 'offers');
        assert.equal(
          await readFile(join(request.directory, 'offers.lino'), 'utf8'),
          request.notation
        );
        events.push('ensure');
      },
    };
    await publish(directory, { mirror });
    assert.deepEqual(
      (await consume({ directory, mirror })).map((row) => row.id),
      ['one', 'two']
    );
    assert.deepEqual(events, ['stage', 'activate', 'ensure']);
  }));

it('rejects a shard that grows past its bound between stat and read', () =>
  withDirectory(async (directory) => {
    // Only Node synchronizes named builtin bindings; other runtimes exercise
    // ordinary oversized-file rejection above.
    if (globalThis.Bun) {
      return;
    }
    await publish(directory);
    const original = fs.stat;
    fs.stat = async (path, ...args) =>
      String(path).endsWith('offers.lino')
        ? { size: 0 }
        : original(path, ...args);
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        consume({ directory, maxShardBytes: 1 }),
        /grew beyond/u
      );
    } finally {
      fs.stat = original;
      syncBuiltinESMExports();
    }
  }));
