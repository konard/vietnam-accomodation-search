import { describe, expect, it } from 'test-anywhere';

import {
  MtcuteTelegramProvider,
  TelegramIngestionService,
} from '../src/index.js';

async function capturedFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

function emitter() {
  const listeners = [];
  return {
    add: (listener) => listeners.push(listener),
    emit: (value) => Promise.all(listeners.map((listener) => listener(value))),
    remove: (listener) => listeners.splice(listeners.indexOf(listener), 1),
  };
}

function clientFixture() {
  const calls = [];
  const client = {
    destroy: async () => calls.push('destroy'),
    downloadAsBuffer: async (file) => new Uint8Array([file.id]),
    getChat: async () => ({ id: -1007, membersCount: 42 }),
    getChatMember: async (options) => options,
    getMe: async () => ({ id: 99, username: 'owner' }),
    async *iterHistory() {
      yield {
        chat: { id: -1007, username: 'rentals' },
        date: new Date('2026-09-20T00:00:00Z'),
        editDate: null,
        groupedId: 55n,
        id: 8,
        isPinned: true,
        isService: false,
        media: { raw: { _: 'messageMediaPhoto', photo: { id: 88n } } },
        raw: { replyTo: { replyToTopId: 3 } },
        text: 'Studio 8,000,000 VND/month',
      };
      yield {
        chat: { id: -1007, username: 'rentals' },
        date: new Date('2026-09-19T00:00:00Z'),
        get link() {
          throw new Error('links are unavailable for service events');
        },
        id: 7,
        isService: true,
        text: '',
      };
      yield {
        chat: { id: -1007, username: 'rentals' },
        date: new Date('2026-06-01T00:00:00Z'),
        id: 1,
        text: 'old',
      };
    },
    onDeleteMessage: emitter(),
    onEditMessage: emitter(),
    onMessageGroup: emitter(),
    onNewMessage: emitter(),
    resolvePeer: async (_peer, force) => {
      calls.push(`resolve:${force}`);
      return { _: 'inputPeerChannel', channelId: 7 };
    },
    sendText: async (peer, text, options) => {
      calls.push({ sendOptions: options });
      return { id: 4, peer, text };
    },
    start: async ({ session }) => calls.push(`start:${session}`),
  };
  return { calls, client };
}

describe('concrete mtcute Telegram provider', () => {
  it('backfills only the requested window and preserves topics, albums, media, and flags', async () => {
    const { calls, client } = clientFixture();
    const provider = new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: '12',
      clientFactory: async () => client,
      expectedUserId: '99',
      session: 'session',
    });
    const messages = [];
    for await (const message of await provider.history(
      { id: 'telegram:rentals', url: 'https://t.me/rentals' },
      { since: new Date('2026-07-22T00:00:00Z') }
    )) {
      messages.push(message);
    }
    expect(messages.length).toBe(2);
    expect(messages[0].groupedId).toBe('55');
    expect(messages[0].id).toBe(8);
    expect(messages[0].isPinned).toBe(true);
    expect(messages[0].media).toEqual({
      id: '88',
      type: 'messageMediaPhoto',
    });
    expect(messages[0].sourceId).toBe('telegram:rentals');
    expect(messages[0].topicId).toBe(3);
    expect(messages[1].action).toEqual({ type: 'service' });
    expect(messages[1].url).toBe(undefined);
    expect(calls).toContain('start:session');
    expect(await provider.identity()).toEqual({ id: 99, username: 'owner' });
    expect(await provider.popularity('@rentals')).toEqual({ members: 42 });
    expect(await provider.membership('@rentals', 'me')).toEqual({
      chatId: '@rentals',
      userId: 'me',
    });
    expect(await provider.media({ id: 6 })).toEqual(new Uint8Array([6]));
    expect(
      (
        await provider.send('@rentals', 'hello', {
          idempotencyKey: 'internal-only',
          silent: true,
        })
      ).id
    ).toBe(4);
    expect(calls.find((value) => value?.sendOptions)).toEqual({
      sendOptions: { silent: true },
    });
    expect((await provider.resolveEntity('@rentals')).channelId).toBe(7);
    await provider.destroy();
    expect(calls).toContain('destroy');
  });

  it('subscribes to configured sources, refreshes entities, and removes every listener', async () => {
    const { calls, client } = clientFixture();
    const provider = new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: 12,
      clientFactory: async () => client,
      logger: { error: () => {} },
      session: 'session',
    });
    const events = [];
    const subscription = await provider.liveUpdates(
      async (event) => events.push(event),
      { sources: [{ id: 'telegram:rentals', url: 'https://t.me/rentals' }] }
    );
    await client.onNewMessage.emit({
      chat: { id: -1007, username: 'rentals' },
      date: new Date('2026-09-22T00:00:00Z'),
      id: 10,
      text: 'Room 5,000,000 VND/month',
    });
    await client.onEditMessage.emit({
      chat: { id: -1007, username: 'rentals' },
      date: new Date('2026-09-22T00:00:00Z'),
      editDate: new Date('2026-09-22T01:00:00Z'),
      id: 10,
      text: 'Room 4,000,000 VND/month',
    });
    await client.onDeleteMessage.emit({ channelId: 7, messageIds: [10] });
    await client.onNewMessage.emit({
      chat: { id: -1008, username: 'other' },
      date: new Date(),
      id: 11,
      text: 'ignored',
    });
    expect(events.map(({ type }) => type)).toEqual(['new', 'edit', 'delete']);
    expect(events[2]).toEqual({
      messageIds: [10],
      sourceId: 'telegram:rentals',
      type: 'delete',
    });
    expect(calls).toContain('resolve:true');
    subscription.stop();
    await client.onNewMessage.emit({
      chat: { id: -1007 },
      date: new Date(),
      id: 12,
      text: 'ignored after stop',
    });
    expect(events.length).toBe(3);
  });

  it('matches chat and user peer IDs and logs rejected update handlers', async () => {
    const { client } = clientFixture();
    client.resolvePeer = async (peer) => {
      if (peer === 'legacy-chat') {
        return { _: 'inputPeerChat', chatId: 4 };
      }
      if (peer === 'person') {
        return { _: 'inputPeerUser', userId: 5 };
      }
      return { _: 'inputPeerEmpty', id: 6 };
    };
    const errors = [];
    const provider = new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: 12,
      clientFactory: async () => client,
      logger: { error: (...arguments_) => errors.push(arguments_) },
      session: 'session',
    });
    const subscription = await provider.liveUpdates(
      async () => {
        throw new Error('handler failed');
      },
      {
        sources: [
          { id: 'telegram:chat', peerId: 'legacy-chat' },
          { id: 'telegram:user', username: 'person' },
          { id: 'telegram:unknown', peerId: 'unknown' },
        ],
      }
    );

    for (const id of [-4, 5, 6]) {
      expect(
        (
          await capturedFailure(() =>
            client.onNewMessage.emit({
              chat: { id },
              date: new Date('2026-09-22T00:00:00Z'),
              id,
              text: 'Room 5,000,000 VND/month',
            })
          )
        ).message
      ).toBe('handler failed');
    }
    await Promise.resolve();
    expect(errors.length).toBe(3);
    subscription.stop();
  });

  it('rejects absent credentials and destroys mismatched identity clients', async () => {
    const missing = new MtcuteTelegramProvider();
    expect((await capturedFailure(() => missing.identity())).message).toContain(
      'Telegram user credentials'
    );

    let destroyed = 0;
    const mismatched = new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: 12,
      clientFactory: async () => ({
        destroy: async () => {
          destroyed += 1;
        },
        getMe: async () => ({ id: 2 }),
        start: async () => {},
      }),
      expectedUserId: '1',
      session: 'session',
    });
    const mismatch = await capturedFailure(() => mismatched.identity());
    expect(mismatch.message).toContain('identity mismatch');
    expect(mismatch.message).not.toContain('expected 1');
    expect(mismatch.message).not.toContain('received 2');
    expect(destroyed).toBe(1);

    const failed = new MtcuteTelegramProvider({
      apiHash: 'hash',
      apiId: 12,
      clientFactory: async () => ({
        destroy: async () => {
          throw new Error('cleanup failed');
        },
        getMe: async () => {
          throw new Error('identity failed');
        },
        start: async () => {},
      }),
      session: 'session',
    });
    const failure = await capturedFailure(() => failed.identity());
    expect(failure instanceof AggregateError).toBe(true);
    expect(failure.errors.map(({ message }) => message)).toEqual([
      'identity failed',
      'cleanup failed',
    ]);
  });
});

describe('MTProto ingestion lifecycle', () => {
  it('backfills, applies edits and deletes idempotently, and records service events', async () => {
    let currentTime = '2026-09-22T00:00:00Z';
    let updateHandler;
    const records = { offers: [], 'telegram-events': [] };
    const store = {
      deleteOffersByMessages: async (sourceId, ids) => {
        records.offers = records.offers.filter(
          (offer) =>
            offer.provenance?.sourceId !== sourceId ||
            !ids.includes(offer.provenance?.messageId)
        );
      },
      listOffers: async () => records.offers,
      loadRecords: async (kind) => records[kind] || [],
      saveOffers: async (offers) => records.offers.push(...offers),
      saveRecords: async (kind, values) => {
        records[kind] = values;
      },
      updateRecords: async (kind, update) => {
        records[kind] = await update(records[kind] || []);
        return records[kind];
      },
    };
    const source = { id: 'telegram:rentals', url: 'https://t.me/rentals' };
    const provider = {
      destroy: async () => {},
      history: async () => [
        {
          chat: { username: 'rentals' },
          date: '2026-09-20T00:00:00Z',
          id: 1,
          sourceId: source.id,
          text: 'Studio 8,000,000 VND/month, contact +84123456789',
        },
      ],
      liveUpdates: async (handler) => {
        updateHandler = handler;
        return { stop: () => {} };
      },
    };
    const service = new TelegramIngestionService({
      now: () => new Date(currentTime),
      provider,
      rates: { VND: 1 },
      store,
    });
    const result = await service.start([source]);
    expect(result.backfilled).toBe(1);
    expect(
      (await capturedFailure(() => service.start([source]))).message
    ).toContain('already running');
    expect(records.offers[0].provenance.messageId).toBe(1);
    await updateHandler({
      message: {
        chat: { username: 'rentals' },
        date: '2026-09-20T00:00:00Z',
        editDate: '2026-09-22T02:00:00Z',
        id: 1,
        sourceId: source.id,
        text: 'Studio 7,000,000 VND/month, contact +84123456789',
      },
      sourceId: source.id,
      type: 'edit',
    });
    expect(records.offers.at(-1).priceVnd).toBe(7_000_000);
    expect(records.offers.length).toBe(1);
    await updateHandler({
      messageIds: [1],
      sourceId: source.id,
      type: 'delete',
    });
    currentTime = '2026-09-22T03:00:00Z';
    await updateHandler({
      messageIds: [1],
      sourceId: source.id,
      type: 'delete',
    });
    expect(records.offers.length).toBe(0);
    expect(records['telegram-events'].map(({ type }) => type)).toEqual([
      'backfill',
      'edit',
      'delete',
    ]);
    expect(records['domain-records'].some(({ type }) => type === 'offer')).toBe(
      false
    );
    expect(
      records['domain-records'].some(({ type }) => type === 'parser-run')
    ).toBe(false);
    expect(
      records['domain-records'].some(({ type }) => type === 'contact')
    ).toBe(false);
    expect(
      records['domain-records'].some(
        ({ predicate, object }) =>
          predicate === 'deletion.eventType' && object === 'delete'
      )
    ).toBe(true);
    expect(records.traces.some(({ status }) => status === 'success')).toBe(
      true
    );
    await service.destroy();
  });

  it('contains and logs asynchronous live persistence failures', async () => {
    let handler;
    let failPersistence = false;
    let destroyed = 0;
    const errors = [];
    const service = new TelegramIngestionService({
      logger: { error: (...arguments_) => errors.push(arguments_) },
      provider: {
        destroy: async () => {
          destroyed += 1;
        },
        history: async () => [],
        liveUpdates: async (next) => {
          handler = next;
          return { stop: () => {} };
        },
      },
      store: {
        deleteOffersByMessages: async () => {},
        loadRecords: async () => [],
        saveOffers: async () => {},
        saveRecords: async () => {
          if (failPersistence) {
            throw new Error('disk unavailable');
          }
        },
      },
    });
    await service.start([{ id: 'telegram:rentals' }]);
    failPersistence = true;
    expect(
      (
        await capturedFailure(() =>
          handler({
            message: { id: 1 },
            sourceId: 'telegram:rentals',
            type: 'new',
          })
        )
      ).message
    ).toBe('disk unavailable');
    await service.destroy();
    expect(errors[0][0]).toBe('MTProto update persistence failed');
    expect(destroyed).toBe(1);
  });

  it('releases the provider when initial ingestion cannot complete', async () => {
    let destroyed = 0;
    const service = new TelegramIngestionService({
      provider: {
        destroy: async () => {
          destroyed += 1;
        },
        history: async () => {
          throw new Error('history unavailable');
        },
      },
      store: {
        loadRecords: async () => [],
      },
    });

    expect((await capturedFailure(() => service.start([{}]))).message).toBe(
      'history unavailable'
    );
    expect(destroyed).toBe(1);
  });

  it('reports both initial ingestion and provider cleanup failures', async () => {
    const service = new TelegramIngestionService({
      provider: {
        destroy: async () => {
          throw new Error('cleanup failed');
        },
        history: async () => {
          throw new Error('history unavailable');
        },
      },
      store: {
        loadRecords: async () => [],
      },
    });

    const error = await capturedFailure(() => service.start([{}]));
    expect(error instanceof AggregateError).toBe(true);
    expect(error.errors.map(({ message }) => message)).toEqual([
      'history unavailable',
      'cleanup failed',
    ]);
  });
});
