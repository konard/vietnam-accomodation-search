/* eslint local/no-changelog-comments: ["warn", {"allowDatesInStrings": true}] -- Dates are fixed fixture inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { TelegramPhotoScheduler } from '../src/telegram-photo-scheduler.js';
import { TelegramMediaRetries } from '../src/telegram-media-retries.js';
import { MediaCache } from '../src/media-cache.js';

it('shares a bounded lookup queue across sources, coalesces requests and reuses authenticated resolutions', async () => {
  const scheduler = new TelegramPhotoScheduler({ minIntervalMs: 0 });
  let active = 0;
  let peak = 0;
  let calls = 0;
  const lookup = (id) => async () => {
    calls += 1;
    peak = Math.max(peak, ++active);
    await wait(2);
    active -= 1;
    return { id };
  };
  const requests = Array.from({ length: 10 }, (_, index) =>
    scheduler.resolve(
      `source-${index % 2}:message:${index}`,
      lookup(String(index))
    )
  );
  requests.push(scheduler.resolve('source-0:message:0', lookup('0')));
  await Promise.all(requests);
  await scheduler.resolve('source-0:message:0', lookup('0'));
  assert.equal(peak, 1);
  assert.equal(calls, 10);
  await scheduler.resolve('changed:message:0', lookup('different'));
  await scheduler.resolve('changed:message:0', lookup('different'));
  assert.equal(calls, 12);
  const cancelled = new AbortController();
  cancelled.abort(new Error('cancelled'));
  await assert.rejects(
    scheduler.resolve('unused:0:0', lookup('0'), { signal: cancelled.signal }),
    /cancelled/
  );
});

it('applies server flood waits globally and cancels queued work without another RPC', async () => {
  let time = 0;
  let calls = 0;
  const scheduler = new TelegramPhotoScheduler({
    minIntervalMs: 0,
    now: () => time,
  });
  await assert.rejects(
    scheduler.resolve('first:1:1', () => {
      calls += 1;
      throw new Error('FLOOD_WAIT_45');
    }),
    /FLOOD_WAIT/
  );
  await assert.rejects(
    scheduler.resolve(
      'second:2:2',
      () => {
        calls += 1;
        return { id: '2' };
      },
      { signal: AbortSignal.timeout(10) }
    )
  );
  assert.equal(calls, 1);
  time = 45001;
  assert.equal(
    (await scheduler.resolve('second:2:2', () => ({ id: '2' }))).id,
    '2'
  );
});

it('honors short retry waits and bounds the resolution cache', async () => {
  let time = 0;
  let attempts = 0;
  const scheduler = new TelegramPhotoScheduler({
    minIntervalMs: 5,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  await scheduler.resolve('one:1:1', () => {
    if (++attempts === 1) {
      throw Object.assign(new Error('retry'), { status: 429, seconds: 0.02 });
    }
    return { id: '1' };
  });
  assert.equal(attempts, 2);
  for (let id = 2; id < 516; id += 1) {
    await scheduler.resolve(`one:${id}:${id}`, () => ({ id: String(id) }));
  }
  assert.equal(scheduler.resolved.size, 512);
});

it('persists deferred media work and completes it after restart without downloading successful photos twice', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'qa-media-retry-'));
  try {
    let time = Date.now();
    const calls = [];
    let flood = true;
    const provider = {
      photo: async (id) => {
        calls.push(id);
        if (id === '2' && flood) {
          throw Object.assign(new Error('FLOOD_WAIT_60'), {
            status: 429,
            seconds: 60,
          });
        }
        return new Uint8Array([1, 2, 3]);
      },
    };
    const material = { mediaIds: ['1', '2'] };
    const offer = { sourceId: 'telegram:fixture' };
    const cache = new MediaCache({ directory, now: () => time });
    await cache.cacheTelegramPhotos(offer, material, provider);
    assert.equal(offer.mediaStatus, 'incomplete');
    assert.equal(offer.mediaRetries[0].category, 'rate-limit');
    const restarted = new MediaCache({ directory, now: () => time });
    await restarted.cacheTelegramPhotos(offer, material, provider);
    assert.deepEqual([...calls].sort(), ['1', '2']);
    time += 60001;
    flood = false;
    await restarted.cacheTelegramPhotos(offer, material, provider);
    assert.equal(offer.mediaStatus, 'cached');
    assert.deepEqual([...calls].sort(), ['1', '2', '2']);
    assert.deepEqual(offer.mediaRetries, []);
    const cancelled = new AbortController();
    cancelled.abort(new Error('cancel'));
    await restarted.cacheTelegramPhotos(offer, { mediaIds: ['3'] }, provider, {
      signal: cancelled.signal,
    });
    assert.equal(offer.mediaStatus, 'incomplete');
    assert.equal(calls.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('reports ledger corruption and preserves deferred work', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'qa-media-ledger-'));
  try {
    const retries = new TelegramMediaRetries(directory);
    const record = await retries.update(
      'one',
      Object.assign(new Error('timeout'), { name: 'TimeoutError' })
    );
    assert(record.retryable);
    assert.equal(
      (await retries.update('one', new Error('unclassified'))).attempts,
      2
    );
    await retries.update('one');
    assert.deepEqual(await retries.records(), []);
    await writeFile(retries.path, 'invalid JSON');
    await assert.rejects(retries.records(), SyntaxError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('resolves canonical numeric peers when downloading native photo material without a public handle', async () => {
  const { MtcuteTelegramProvider } = await import('../src/telegram-mtcute.js');
  const client = {
    start: async () => {},
    getMe: async () => ({ id: 123 }),
    destroy: async () => {},
    getMessages: async (peer) => {
      assert.equal(peer, -1005);
      return [{ media: { type: 'photo', id: '77' } }];
    },
    async *downloadAsIterable() {
      yield new Uint8Array([1]);
    },
  };
  const provider = new MtcuteTelegramProvider({
    apiId: 1,
    apiHash: 'fixture',
    session: 'fixture',
    clientFactory: async () => client,
    photoScheduler: new TelegramPhotoScheduler({ minIntervalMs: 0 }),
  });
  try {
    assert.deepEqual(
      await provider.photo('77', {
        material: {
          members: [
            { id: '1', sourceId: 'telegram:peer:-1005', media: { id: '77' } },
          ],
        },
      }),
      new Uint8Array([1])
    );
  } finally {
    await provider.destroy();
  }
});
